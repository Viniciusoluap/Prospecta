// Maquete 3D (EPIC-022) — router tRPC `maquete3d` (módulo "maquete3d" do painel). Colaborador com o módulo
// cria pedidos, roda a leitura e revisa a planta. Só o administrador: altera preços/configuração, confirma
// pagamento fora do sistema, autoriza maquete de Incorporação, recusa e exclui.
import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { incorporationStudies, operationalProjects, projectDocuments, users } from "../../drizzle/schema.js";
import { maquetes3d, type Maquete3d } from "../../drizzle/schema-maquete-3d.js";
import { TIPOS_MAQUETE, lerModelo, modeloSchema, podePublicar, resumoModelo, validarModelo } from "../../shared/maquete-3d/modelo.js";
import {
  FAIXAS_PRECO, MAX_DOCUMENTOS, ORIGENS_MAQUETE, PODE_REVISAR, configSchema, documentoSchema, lerEstadoLeitura,
  progressoLeitura, statusInicial, type DocumentoMaquete, type OrigemMaquete, type StatusMaquete,
} from "../../shared/maquete-3d/regras.js";
import { ENV } from "../_core/env.js";
import { adminProcedure, router } from "../_core/trpc.js";
import { LeituraIndisponivel, agora, carregarConfig, db, salvarConfig } from "./base.js";
import { avancarLeitura, iniciarLeitura, lerDocumentos } from "./leitura.js";

type Ctx = { user: { id: number; role: string } };
function exigirAdmin(ctx: Ctx, acao: string) {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: `Só o administrador pode ${acao}.` });
}
const naoEncontrada = () => new TRPCError({ code: "NOT_FOUND", message: "Maquete não encontrada." });
const conflito = (message: string) => new TRPCError({ code: "CONFLICT", message });

async function buscar(id: number): Promise<Maquete3d> {
  const [m] = await db().select().from(maquetes3d).where(and(eq(maquetes3d.id, id), isNull(maquetes3d.deletedAt))).limit(1);
  if (!m) throw naoEncontrada();
  return m;
}

/** PDFs ativos do projeto ou do estudo que podem ser lidos pelo motor. */
async function documentosDisponiveis(origem: OrigemMaquete, alvoId: number): Promise<DocumentoMaquete[]> {
  if (origem === "projeto") {
    const linhas = await db().select({ id: projectDocuments.id, nome: projectDocuments.originalName, mime: projectDocuments.mime })
      .from(projectDocuments)
      .where(and(eq(projectDocuments.projectId, alvoId), eq(projectDocuments.status, "active"), isNull(projectDocuments.deletedAt)))
      .orderBy(desc(projectDocuments.id));
    return linhas.filter(l => l.mime === "application/pdf" || /\.pdf$/i.test(l.nome)).map(l => ({ fonte: "projeto" as const, id: l.id, nome: l.nome }));
  }
  // Documentos da Incorporação são eventos: vale o último de cada item, se for um envio.
  const r = await db().execute(sql`SELECT id, file_name, mime_type FROM (
      SELECT DISTINCT ON (item_id) id, action, file_name, mime_type, drive_file_id, storage
      FROM incorporation_registration_documents WHERE study_id = ${alvoId} ORDER BY item_id, id DESC
    ) u WHERE action = 'uploaded' AND (drive_file_id IS NOT NULL OR storage = 'banco') ORDER BY id DESC`);
  const linhas = (r as unknown as { rows: { id: number; file_name: string | null; mime_type: string | null }[] }).rows;
  return linhas.filter(l => l.mime_type === "application/pdf" || /\.pdf$/i.test(l.file_name ?? ""))
    .map(l => ({ fonte: "incorporacao" as const, id: Number(l.id), nome: l.file_name ?? `Documento ${l.id}` }));
}

async function conferirDocumentos(origem: OrigemMaquete, alvoId: number, escolhidos: DocumentoMaquete[]): Promise<DocumentoMaquete[]> {
  const disponiveis = new Map((await documentosDisponiveis(origem, alvoId)).map(d => [d.id, d]));
  const ids = Array.from(new Set(escolhidos.map(d => d.id)));
  const faltando = ids.filter(i => !disponiveis.has(i));
  if (faltando.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Um dos PDFs escolhidos não pertence a este projeto/estudo ou não está mais disponível." });
  return ids.map(i => disponiveis.get(i)!);
}

function paraTela(m: Maquete3d) {
  const modelo = lerModelo(m.modelo);
  const leitura = lerEstadoLeitura(m.leitura);
  return {
    id: m.id, titulo: m.titulo, origem: m.origem as OrigemMaquete, projectId: m.projectId, studyId: m.studyId, tipo: m.tipo,
    status: m.status as StatusMaquete, faixaPreco: m.faixaPreco, preco: m.preco === null ? null : Number(m.preco),
    pagoEm: m.pagoEm, liberadoEm: m.liberadoEm, liberacaoNota: m.liberacaoNota, recusaMotivo: m.recusaMotivo,
    documentos: lerDocumentos(m.documentos), modeloVersao: m.modeloVersao, revisadoEm: m.revisadoEm, publicadoEm: m.publicadoEm,
    createdAt: m.createdAt, updatedAt: m.updatedAt,
    progresso: progressoLeitura(leitura),
    resumo: modelo ? resumoModelo(modelo) : null,
  };
}

const idInput = z.object({ id: z.number().int().positive() });

export const maquete3dRouter = router({
  config: adminProcedure.query(async () => ({ ...(await carregarConfig()), iaConfigurada: !!ENV.anthropicApiKey })),

  salvarConfig: adminProcedure.input(configSchema).mutation(async ({ ctx, input }) => {
    exigirAdmin(ctx, "alterar preços e configurações da Maquete 3D");
    await salvarConfig(input, ctx.user.id);
    return { ok: true };
  }),

  /** Projetos e estudos para o formulário de novo pedido. */
  opcoes: adminProcedure.query(async () => {
    const [projetos, estudos] = await Promise.all([
      db().select({ id: operationalProjects.id, nome: operationalProjects.name, cliente: operationalProjects.clientName })
        .from(operationalProjects).orderBy(desc(operationalProjects.id)).limit(500),
      db().select({ id: incorporationStudies.id, nome: incorporationStudies.name, cidade: incorporationStudies.city })
        .from(incorporationStudies).orderBy(desc(incorporationStudies.id)).limit(500),
    ]);
    return { projetos, estudos };
  }),

  documentosDisponiveis: adminProcedure.input(z.object({ origem: z.enum(ORIGENS_MAQUETE), alvoId: z.number().int().positive() }))
    .query(({ input }) => documentosDisponiveis(input.origem, input.alvoId)),

  listar: adminProcedure.input(z.object({
    origem: z.enum(ORIGENS_MAQUETE).optional(), projectId: z.number().int().positive().optional(), studyId: z.number().int().positive().optional(),
  }).default({})).query(async ({ input }) => {
    const linhas = await db().select().from(maquetes3d).where(and(
      isNull(maquetes3d.deletedAt),
      input.origem ? eq(maquetes3d.origem, input.origem) : undefined,
      input.projectId ? eq(maquetes3d.projectId, input.projectId) : undefined,
      input.studyId ? eq(maquetes3d.studyId, input.studyId) : undefined,
    )).orderBy(desc(maquetes3d.id)).limit(300);
    const idsP = Array.from(new Set(linhas.map(l => l.projectId).filter((v): v is number => !!v)));
    const idsE = Array.from(new Set(linhas.map(l => l.studyId).filter((v): v is number => !!v)));
    const [ps, es] = await Promise.all([
      idsP.length ? db().select({ id: operationalProjects.id, nome: operationalProjects.name, cliente: operationalProjects.clientName }).from(operationalProjects).where(inArray(operationalProjects.id, idsP)) : [],
      idsE.length ? db().select({ id: incorporationStudies.id, nome: incorporationStudies.name }).from(incorporationStudies).where(inArray(incorporationStudies.id, idsE)) : [],
    ]);
    const nomeP = new Map(ps.map(p => [p.id, p])), nomeE = new Map(es.map(e => [e.id, e]));
    return linhas.map(l => ({
      ...paraTela(l),
      alvo: l.projectId ? nomeP.get(l.projectId)?.nome ?? `Projeto ${l.projectId}` : nomeE.get(l.studyId!)?.nome ?? `Estudo ${l.studyId}`,
      cliente: l.projectId ? nomeP.get(l.projectId)?.cliente ?? null : null,
    }));
  }),

  detalhe: adminProcedure.input(idInput).query(async ({ input }) => {
    const m = await buscar(input.id);
    const modelo = lerModelo(m.modelo);
    const leitura = lerEstadoLeitura(m.leitura);
    const [liberador] = m.liberadoPor ? await db().select({ nome: users.name }).from(users).where(eq(users.id, m.liberadoPor)).limit(1) : [];
    return {
      ...paraTela(m), modelo, problemas: modelo ? validarModelo(modelo) : [],
      passos: leitura.passos.map(({ chave, rotulo, estado, erro }) => ({ chave, rotulo, estado, erro: erro ?? null })),
      tokens: { entrada: leitura.tokensEntrada, saida: leitura.tokensSaida },
      liberadoPorNome: liberador?.nome ?? null,
    };
  }),

  criar: adminProcedure.input(z.object({
    origem: z.enum(ORIGENS_MAQUETE), alvoId: z.number().int().positive(), tipo: z.enum(TIPOS_MAQUETE),
    titulo: z.string().trim().max(255).optional(), faixaPreco: z.enum(FAIXAS_PRECO).optional(),
    preco: z.number().min(0).max(100000).optional(),
    documentos: z.array(documentoSchema).max(MAX_DOCUMENTOS).default([]),
  })).mutation(async ({ ctx, input }) => {
    let nomeAlvo: string;
    if (input.origem === "projeto") {
      const [p] = await db().select({ nome: operationalProjects.name }).from(operationalProjects).where(eq(operationalProjects.id, input.alvoId)).limit(1);
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Projeto não encontrado." });
      if (!input.faixaPreco) throw new TRPCError({ code: "BAD_REQUEST", message: "Escolha a faixa de preço da maquete." });
      nomeAlvo = p.nome;
    } else {
      const [e] = await db().select({ nome: incorporationStudies.name }).from(incorporationStudies).where(eq(incorporationStudies.id, input.alvoId)).limit(1);
      if (!e) throw new TRPCError({ code: "NOT_FOUND", message: "Estudo de incorporação não encontrado." });
      nomeAlvo = e.nome;
    }
    // Preço: padrão da faixa; valor diferente do padrão é decisão do administrador.
    let preco: string | null = null;
    if (input.origem === "projeto") {
      const padrao = (await carregarConfig()).precos[input.faixaPreco!];
      if (input.preco !== undefined && input.preco !== padrao) exigirAdmin(ctx, "cobrar um valor diferente do preço padrão");
      preco = (input.preco ?? padrao).toFixed(2);
    }
    const documentos = await conferirDocumentos(input.origem, input.alvoId, input.documentos);
    const [nova] = await db().insert(maquetes3d).values({
      token: randomBytes(24).toString("base64url"), titulo: input.titulo || `Maquete 3D — ${nomeAlvo}`.slice(0, 255),
      origem: input.origem, projectId: input.origem === "projeto" ? input.alvoId : null, studyId: input.origem === "incorporacao" ? input.alvoId : null,
      tipo: input.tipo, status: statusInicial(input.origem), faixaPreco: input.origem === "projeto" ? input.faixaPreco! : null, preco,
      documentos: JSON.stringify(documentos), solicitadoPor: ctx.user.id, createdAt: agora(), updatedAt: agora(),
    }).returning({ id: maquetes3d.id });
    return { id: nova.id };
  }),

  definirDocumentos: adminProcedure.input(idInput.extend({ documentos: z.array(documentoSchema).min(1).max(MAX_DOCUMENTOS) })).mutation(async ({ input }) => {
    const m = await buscar(input.id);
    if (m.status === "em_leitura" || m.status === "publicada" || m.status === "recusada") throw conflito("Os PDFs não podem ser trocados nesta situação.");
    const documentos = await conferirDocumentos(m.origem as OrigemMaquete, (m.projectId ?? m.studyId)!, input.documentos);
    await db().update(maquetes3d).set({ documentos: JSON.stringify(documentos), updatedAt: agora() }).where(eq(maquetes3d.id, m.id));
    return { ok: true };
  }),

  /**
   * Libera o motor. Incorporação: é a autorização do administrador. Projeto: confirmação manual de pagamento
   * recebido fora do sistema (a cobrança pelo Asaas com liberação automática entra na etapa 3), com nota obrigatória.
   */
  liberar: adminProcedure.input(idInput.extend({ nota: z.string().trim().max(400).default("") })).mutation(async ({ ctx, input }) => {
    exigirAdmin(ctx, "liberar ou autorizar a maquete");
    const m = await buscar(input.id);
    const esperado: StatusMaquete = statusInicial(m.origem as OrigemMaquete);
    if (m.origem === "projeto" && input.nota.length < 5) throw new TRPCError({ code: "BAD_REQUEST", message: "Informe como o pagamento foi confirmado." });
    const r = await db().update(maquetes3d).set({
      status: "liberada" satisfies StatusMaquete, liberadoPor: ctx.user.id, liberadoEm: agora(), liberacaoNota: input.nota || null,
      pagoEm: m.origem === "projeto" ? agora() : null, updatedAt: agora(),
    }).where(and(eq(maquetes3d.id, m.id), eq(maquetes3d.status, esperado))).returning({ id: maquetes3d.id });
    if (!r.length) throw conflito("Esta maquete já foi liberada ou recusada.");
    return { ok: true };
  }),

  recusar: adminProcedure.input(idInput.extend({ motivo: z.string().trim().min(5).max(400) })).mutation(async ({ ctx, input }) => {
    exigirAdmin(ctx, "recusar a maquete");
    const r = await db().update(maquetes3d).set({ status: "recusada" satisfies StatusMaquete, recusaMotivo: input.motivo, updatedAt: agora() })
      .where(and(eq(maquetes3d.id, input.id), isNull(maquetes3d.deletedAt), sql`${maquetes3d.status} NOT IN ('publicada', 'recusada')`)).returning({ id: maquetes3d.id });
    if (!r.length) throw conflito("Esta maquete não pode ser recusada nesta situação.");
    return { ok: true };
  }),

  excluir: adminProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    exigirAdmin(ctx, "excluir a maquete");
    const m = await buscar(input.id);
    if (m.pagoEm && m.status !== "recusada") throw conflito("Maquete já paga: recuse o pedido antes de excluir.");
    await db().update(maquetes3d).set({ deletedAt: agora(), updatedAt: agora() }).where(eq(maquetes3d.id, m.id));
    return { ok: true };
  }),

  iniciarLeitura: adminProcedure.input(idInput).mutation(async ({ input }) => {
    const m = await buscar(input.id);
    if (!lerDocumentos(m.documentos).length) throw new TRPCError({ code: "BAD_REQUEST", message: "Escolha ao menos um PDF do projeto antes de iniciar a leitura." });
    try { return progressoLeitura(await iniciarLeitura(m.id)); }
    catch (e) { if (e instanceof LeituraIndisponivel) throw conflito(e.message); throw e; }
  }),

  /** Executa um passo da leitura. A tela chama até `proximo` vir nulo ou um passo dar erro. */
  avancarLeitura: adminProcedure.input(idInput).mutation(async ({ input }) => {
    try {
      const { estado, status } = await avancarLeitura(input.id);
      const progresso = progressoLeitura(estado);
      return { ...progresso, status, erro: progresso.proximo?.estado === "erro" ? progresso.proximo.erro ?? "Falha no passo." : null };
    } catch (e) { if (e instanceof LeituraIndisponivel) throw conflito(e.message); throw e; }
  }),

  /** Grava a planta corrigida na revisão. `versao` evita que duas pessoas se sobrescrevam. */
  salvarModelo: adminProcedure.input(idInput.extend({ versao: z.number().int().min(0), modelo: modeloSchema })).mutation(async ({ ctx, input }) => {
    const r = await db().update(maquetes3d).set({
      modelo: JSON.stringify(input.modelo), modeloVersao: input.versao + 1, status: "em_revisao" satisfies StatusMaquete,
      revisadoPor: ctx.user.id, revisadoEm: agora(), updatedAt: agora(),
    }).where(and(eq(maquetes3d.id, input.id), isNull(maquetes3d.deletedAt), eq(maquetes3d.modeloVersao, input.versao), inArray(maquetes3d.status, [...PODE_REVISAR])))
      .returning({ versao: maquetes3d.modeloVersao });
    if (!r.length) throw conflito("A planta foi alterada por outra pessoa ou não está em revisão. Recarregue a página.");
    return { versao: r[0].versao, problemas: validarModelo(input.modelo), resumo: resumoModelo(input.modelo) };
  }),

  /** Conclui a revisão: só passa se a planta não tiver erros nem pendências em aberto. */
  validar: adminProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const m = await buscar(input.id);
    const modelo = lerModelo(m.modelo);
    if (m.status !== "em_revisao" || !modelo) throw conflito("A maquete não está em revisão.");
    if (!podePublicar(modelo)) throw new TRPCError({ code: "BAD_REQUEST", message: "Ainda há erros ou pendências em aberto na planta." });
    await db().update(maquetes3d).set({ status: "validada" satisfies StatusMaquete, revisadoPor: ctx.user.id, revisadoEm: agora(), updatedAt: agora() })
      .where(and(eq(maquetes3d.id, m.id), eq(maquetes3d.status, "em_revisao"), eq(maquetes3d.modeloVersao, m.modeloVersao)));
    return { ok: true };
  }),
});
