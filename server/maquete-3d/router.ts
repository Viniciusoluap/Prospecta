// Maquete 3D (EPIC-022) — router tRPC `maquete3d` (módulo "maquete3d" do painel). Colaborador com o módulo
// cria pedidos, roda a leitura e revisa a planta. Só o administrador: altera preços/configuração, confirma
// pagamento fora do sistema, autoriza maquete de Incorporação, recusa e exclui.
import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { incorporationStudies, leads, operationalProjects, projectDocuments, users } from "../../drizzle/schema.js";
import { maquete3dArquivos, maquetes3d, type Maquete3d } from "../../drizzle/schema-maquete-3d.js";
import { TIPOS_MAQUETE, areaPoligono, lerModelo, limites, modeloSchema, modeloVazio, podePublicar, pontosDoPavimento, resumoModelo, validarModelo, type Edificacao, type TipoMaquete } from "../../shared/maquete-3d/modelo.js";
import { LIMITES_CASA, LIMITES_M2_POR_VAGA, LIMITES_PREDIO, casaPadrao, contaDoEstacionamento, distribuirNosLotes, ehPadrao, predioPadrao, type ContaDoEstacionamento } from "../../shared/maquete-3d/padrao.js";
import { implantacaoDoEstudo, type GradeElevacao } from "../../shared/maquete-3d/implantacao.js";
import type { CenarioMassa } from "../../shared/incorporacao/massa.js";
import {
  FAIXAS_PRECO, MAX_BYTES_PDF_AVULSO, MAX_DOCUMENTOS, ORIGENS_MAQUETE, escopoEnvioMaquete, PODE_REVISAR, comercialSchema, configSchema, documentoSchema, lerComercial, lerEstadoLeitura,
  motorEfetivo, progressoLeitura, statusInicial, type ConfigMaquete, type DocumentoMaquete, type EstadoLeitura, type OrigemMaquete, type StatusMaquete,
} from "../../shared/maquete-3d/regras.js";
import { adminProcedure, publicProcedure, router } from "../_core/trpc.js";
import { avisarMaquetePronta, avisarPedidoAprovado, destinatario } from "./avisos.js";
import { LeituraIndisponivel, agora, alvoDoDocumento, carregarConfig, db, dependencias, modeloDaLeitura, salvarConfig } from "./base.js";
import { clearUpload, readUpload } from "../document-upload-chunks.js";
import { avancarLeitura, confirmarIA, iniciarLeitura, lerDocumentos, pularIA } from "./leitura.js";
import {
  PODE_IMPORTAR, aplicarImportacao, avancarImportacao, confirmarIAImportacao, descartarImportacao, iniciarImportacao, lerImportacao,
  pranchasDaLeitura, pranchasParaTela, pularIAImportacao, salvarCandidata, type Importacao,
} from "./importacao.js";
import { MENSAGEM_EM_CURSO, passoEmCurso, pendentesIA } from "./execucao-ia.js";
import { ConflitoDeVersao, HistoricoIndisponivel, gravarModelo, lerRevisao, listarRevisoes } from "./revisoes.js";

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

/** PDFs enviados direto neste pedido (EPIC-023, S-C). */
async function arquivosAvulsos(maqueteId: number): Promise<DocumentoMaquete[]> {
  const linhas = await db().select({ id: maquete3dArquivos.id, nome: maquete3dArquivos.nome }).from(maquete3dArquivos)
    .where(eq(maquete3dArquivos.maqueteId, maqueteId)).orderBy(desc(maquete3dArquivos.id));
  return linhas.map(l => ({ fonte: "avulso" as const, id: l.id, nome: l.nome }));
}

/** Tudo o que pode ser lido neste pedido: PDFs do projeto/estudo (se houver) e os avulsos. */
async function documentosDoPedido(m: { id: number | null; origem: OrigemMaquete; projectId: number | null; studyId: number | null }): Promise<DocumentoMaquete[]> {
  const alvoId = m.origem === "projeto" ? m.projectId : m.studyId;
  const [doAlvo, avulsos] = await Promise.all([alvoId ? documentosDisponiveis(m.origem, alvoId) : [], m.id ? arquivosAvulsos(m.id) : []]);
  return [...avulsos, ...doAlvo];
}

const chaveDoc = (d: { fonte: string; id: number }) => `${d.fonte}:${d.id}`;
async function conferirDocumentos(m: Parameters<typeof documentosDoPedido>[0], escolhidos: DocumentoMaquete[]): Promise<DocumentoMaquete[]> {
  const disponiveis = new Map((await documentosDoPedido(m)).map(d => [chaveDoc(d), d]));
  const chaves = Array.from(new Set(escolhidos.map(chaveDoc)));
  if (chaves.some(c => !disponiveis.has(c))) throw new TRPCError({ code: "BAD_REQUEST", message: "Um dos PDFs escolhidos não pertence a este pedido ou não está mais disponível." });
  return chaves.map(c => disponiveis.get(c)!);
}

function paraTela(m: Maquete3d) {
  const modelo = lerModelo(m.modelo);
  const leitura = lerEstadoLeitura(m.leitura);
  return {
    id: m.id, titulo: m.titulo, origem: m.origem as OrigemMaquete, projectId: m.projectId, studyId: m.studyId, leadId: m.leadId, tipo: m.tipo,
    status: m.status as StatusMaquete, faixaPreco: m.faixaPreco, preco: m.preco === null ? null : Number(m.preco),
    pagoEm: m.pagoEm, liberadoEm: m.liberadoEm, liberacaoNota: m.liberacaoNota, recusaMotivo: m.recusaMotivo,
    documentos: lerDocumentos(m.documentos), modeloVersao: m.modeloVersao, revisadoEm: m.revisadoEm, publicadoEm: m.publicadoEm,
    createdAt: m.createdAt, updatedAt: m.updatedAt, token: m.token, comercial: lerComercial(m.comercial),
    progresso: progressoLeitura(leitura),
    resumo: modelo ? resumoModelo(modelo) : null,
  };
}

const idInput = z.object({ id: z.number().int().positive() });

/** Guarda o PDF enviado em partes e o põe na lista de PDFs do pedido; devolve o índice dele na lista. */
async function guardarPdfAvulso(m: Maquete3d, uploadId: string, nome: string, userId: number): Promise<{ id: number; documentos: DocumentoMaquete[]; indice: number }> {
  if (!/\.pdf$/i.test(nome)) throw new TRPCError({ code: "BAD_REQUEST", message: "Envie um arquivo PDF." });
  const atuais = lerDocumentos(m.documentos);
  if (atuais.length >= MAX_DOCUMENTOS) throw new TRPCError({ code: "BAD_REQUEST", message: `Cada pedido aceita até ${MAX_DOCUMENTOS} PDFs. Tire um da lista antes de enviar outro.` });
  const dados = await readUpload(uploadId, userId, escopoEnvioMaquete(m.id), nome);
  if (dados.length > MAX_BYTES_PDF_AVULSO || dados.subarray(0, 5).toString("latin1") !== "%PDF-") {
    await clearUpload(uploadId, userId);
    throw new TRPCError({ code: "BAD_REQUEST", message: "O arquivo enviado não é um PDF válido." });
  }
  const [novo] = await db().insert(maquete3dArquivos).values({ maqueteId: m.id, nome, tamanho: dados.length, dados, enviadoPor: userId }).returning({ id: maquete3dArquivos.id });
  await clearUpload(uploadId, userId);
  const documentos = [...atuais, { fonte: "avulso" as const, id: novo.id, nome }];
  await db().update(maquetes3d).set({ documentos: JSON.stringify(documentos), updatedAt: agora() }).where(eq(maquetes3d.id, m.id));
  return { id: novo.id, documentos, indice: documentos.length - 1 };
}

/** Importação em andamento para a tela: passos, quem leu cada prancha, a candidata e o fundo de cada pavimento dela. */
function importacaoParaTela(imp: Importacao | null, m: Maquete3d, config: ConfigMaquete) {
  if (!imp) return null;
  return {
    doc: imp.doc, documento: imp.documento, iniciadaEm: imp.iniciadaEm, passos: passosParaTela(imp.estado), progresso: progressoLeitura(imp.estado),
    ia: resumoIA(imp.estado, m, config), tokens: { entrada: imp.estado.tokensEntrada, saida: imp.estado.tokensSaida },
    candidata: imp.candidata, pranchas: pranchasParaTela(imp.pranchas, m.documentos), avisos: imp.avisos.slice(0, 12),
    problemas: imp.candidata ? validarModelo(imp.candidata) : [],
  };
}
const retornoDaImportacao = (imp: Importacao) => {
  const r = retornoDoPasso(imp.estado, "em_leitura");
  return { ...r, pronta: !!imp.candidata };
};
/** Erros de domínio viram respostas claras para a tela. */
function traduzir(e: unknown): never {
  if (e instanceof LeituraIndisponivel || e instanceof ConflitoDeVersao) throw conflito(e.message);
  throw e;
}
const destinoSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("padrao") }),
  z.object({ tipo: z.literal("pavimento"), edificacaoId: z.string().min(1).max(40), pavimentoId: z.string().min(1).max(40), pavimentoCandidatoId: z.string().min(1).max(40).optional() }),
]);

/** Quem leu cada passo e o que está pendente da IA (EPIC-024 S-03), para o painel da leitura. */
function passosParaTela(leitura: EstadoLeitura) {
  return leitura.passos.map(({ chave, rotulo, estado, erro, tipo, motor, modelo, tokens, aguardando, motivoIA, envio }) => ({
    chave, rotulo, estado, erro: erro ?? null, tipo, motor: motor ?? null, modelo: modelo ?? null, tokens: tokens ?? null,
    aguardando: aguardando ?? null, motivoIA: motivoIA ?? null, envio: envio ?? null,
  }));
}
/**
 * Resumo da IA para a tela. `autorizadas`/`usadas`: a confirmação desta execução (expira ao usar todas);
 * `lidasNaMaquete`/`teto`: o contador da maquete (leituras + importações) e o teto das Configurações.
 */
function resumoIA(leitura: EstadoLeitura, m?: Pick<Maquete3d, "iaPranchasLidas">, config?: ConfigMaquete) {
  const ia = leitura.passos.filter(p => p.tipo === "prancha_ia");
  const c = leitura.confirmacaoIA;
  return {
    pranchas: ia.length, pendentes: ia.filter(p => p.estado !== "feito").length, lidas: ia.filter(p => p.motor === "ia").length,
    confirmadaEm: c?.em ?? null, autorizadas: c?.pranchas ?? 0, usadas: c?.usadas ?? 0, alemDoTeto: !!c?.alemDoTeto,
    lidasNaMaquete: m?.iaPranchasLidas ?? 0, teto: config?.limitePranchasIA ?? null,
    foraDoLimite: (leitura.foraDoLimiteIA ?? []).slice(0, 20),
    /** Um passo está sendo lido pela IA agora (reserva válida): a tela desabilita confirmar, pular e ler de novo (N1). */
    emCurso: !!passoEmCurso(leitura),
  };
}
const retornoDoPasso = (estado: EstadoLeitura, status: StatusMaquete) => {
  const progresso = progressoLeitura(estado);
  const p = progresso.proximo;
  return {
    ...progresso, status, erro: p?.estado === "erro" ? p.erro ?? "Falha no passo." : null,
    aguardando: p?.estado === "aguardando" ? { motivo: p.aguardando ?? "chave", mensagem: p.erro ?? "", pendentes: pendentesIA(estado) }
      // Outra aba está lendo este passo pela IA: a tela para o laço (não chama de novo) e avisa.
      : p?.estado === "executando" ? { motivo: "executando" as const, mensagem: MENSAGEM_EM_CURSO, pendentes: pendentesIA(estado) } : null,
  };
};

/** Situação de venda das unidades do estudo (só código e situação: nada de comprador nem de preço). */
export async function unidadesDoEstudo(studyId: number | null): Promise<{ codigo: string; status: string }[]> {
  if (!studyId) return [];
  const r = await db().execute(sql`SELECT code, status FROM incorporation_units WHERE study_id = ${studyId} AND deleted_at IS NULL`);
  return (r as unknown as { rows: { code: string; status: string }[] }).rows.map(u => ({ codigo: u.code, status: u.status }));
}
const PARTE_PDF_BYTES = 2 * 1024 * 1024;

/** Terreno, ruas, lotes e relevo que o estudo de Incorporação já tem (cenário escolhido do estudo de massa). */
async function lerImplantacaoDoEstudo(studyId: number) {
  const [estudo] = await db().select({
    geojson: incorporationStudies.geojson, lat: incorporationStudies.latitude, lng: incorporationStudies.longitude,
    cenarios: incorporationStudies.massScenariosJson, escolhido: incorporationStudies.selectedScenarioId, elevacao: incorporationStudies.elevationJson,
  }).from(incorporationStudies).where(eq(incorporationStudies.id, studyId)).limit(1);
  let cenario: CenarioMassa | null = null;
  try {
    const lista = (JSON.parse(estudo?.cenarios || "{}") as { cenarios?: CenarioMassa[] }).cenarios ?? [];
    cenario = lista.find(c => c.id === estudo?.escolhido) ?? lista[0] ?? null;
  } catch { cenario = null; }
  const centro = estudo?.lat && estudo?.lng ? [Number(estudo.lng), Number(estudo.lat)] as [number, number] : null;
  let elevacao: GradeElevacao | null = null;
  try { elevacao = estudo?.elevacao ? (JSON.parse(estudo.elevacao) as GradeElevacao) : null; } catch { elevacao = null; }
  const r = implantacaoDoEstudo(estudo?.geojson ?? null, centro, cenario, elevacao);
  if (!r || (!r.implantacao.terreno.length && !r.implantacao.lotes.length)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "O estudo ainda não tem o terreno (KML) nem um estudo de massa com lotes. Cadastre-os na Incorporação e tente de novo." });
  }
  return { r, cenario };
}


export const maquete3dRouter = router({
  config: adminProcedure.query(async () => {
    const config = await carregarConfig();
    const credencial = await dependencias().credencialIA().catch(() => null);
    return {
      ...config, motor: motorEfetivo(config, !!credencial), motorEscolhido: config.motor ?? null, iaConfigurada: !!credencial,
      /** De onde vem a chave da leitura por IA (o valor da chave nunca vai para a tela). */
      origemChaveIA: credencial?.origem ?? null, modeloEmUso: modeloDaLeitura(credencial, config),
    };
  }),

  salvarConfig: adminProcedure.input(configSchema).mutation(async ({ ctx, input }) => {
    exigirAdmin(ctx, "alterar preços e configurações da Maquete 3D");
    await salvarConfig(configSchema.parse(input), ctx.user.id);
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

  /** Clientes do CRM para ligar o pedido quando não há projeto cadastrado (busca por nome, telefone ou e-mail). */
  clientes: adminProcedure.input(z.object({ busca: z.string().trim().max(80).default("") })).query(async ({ input }) => {
    const termo = `%${input.busca.replace(/[%_\\]/g, "")}%`;
    return db().select({ id: leads.id, nome: leads.name, telefone: leads.phone, email: leads.email }).from(leads)
      .where(and(isNull(leads.deletedAt), input.busca ? sql`(${leads.name} ILIKE ${termo} OR ${leads.phone} ILIKE ${termo} OR ${leads.email} ILIKE ${termo})` : undefined))
      .orderBy(desc(leads.id)).limit(60);
  }),

  /** PDFs que podem ser lidos neste pedido (do projeto/estudo e os enviados avulsos). */
  documentosDoPedido: adminProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ input }) => {
    const m = await buscar(input.id);
    return documentosDoPedido({ id: m.id, origem: m.origem as OrigemMaquete, projectId: m.projectId, studyId: m.studyId });
  }),

  /**
   * Anexa um PDF avulso ao pedido. O arquivo sobe antes em partes (`documentChunks.part`, escopo `maquete3d:<id>`);
   * aqui ele é conferido, guardado e já entra na lista de PDFs da leitura.
   */
  anexarPdf: adminProcedure.input(z.object({ id: z.number().int().positive(), uploadId: z.string().min(20).max(64), nome: z.string().trim().min(1).max(255) })).mutation(async ({ ctx, input }) => {
    const m = await buscar(input.id);
    if (m.status === "em_leitura" || m.status === "publicada" || m.status === "recusada") throw conflito("Não é possível anexar PDF nesta situação.");
    const { id, documentos } = await guardarPdfAvulso(m, input.uploadId, input.nome, ctx.user.id);
    return { id, documentos };
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
    const idsL = Array.from(new Set(linhas.map(l => l.leadId).filter((v): v is number => !!v)));
    const [ps, es, ls] = await Promise.all([
      idsP.length ? db().select({ id: operationalProjects.id, nome: operationalProjects.name, cliente: operationalProjects.clientName }).from(operationalProjects).where(inArray(operationalProjects.id, idsP)) : [],
      idsE.length ? db().select({ id: incorporationStudies.id, nome: incorporationStudies.name }).from(incorporationStudies).where(inArray(incorporationStudies.id, idsE)) : [],
      idsL.length ? db().select({ id: leads.id, nome: leads.name }).from(leads).where(inArray(leads.id, idsL)) : [],
    ]);
    const nomeP = new Map(ps.map(p => [p.id, p])), nomeE = new Map(es.map(e => [e.id, e])), nomeL = new Map(ls.map(c => [c.id, c.nome]));
    return linhas.map(l => {
      const projeto = l.projectId ? nomeP.get(l.projectId) : undefined;
      const alvo = l.projectId ? projeto?.nome ?? `Projeto ${l.projectId}` : l.leadId ? nomeL.get(l.leadId) ?? `Cliente ${l.leadId}` : nomeE.get(l.studyId!)?.nome ?? `Estudo ${l.studyId}`;
      // O nome do projeto costuma já trazer o do cliente: não repete.
      const cliente = projeto?.cliente && !alvo.toLowerCase().includes(projeto.cliente.toLowerCase()) ? projeto.cliente : null;
      return { ...paraTela(l), alvo, cliente, porCliente: !!l.leadId };
    });
  }),

  detalhe: adminProcedure.input(idInput).query(async ({ input }) => {
    const m = await buscar(input.id);
    const modelo = lerModelo(m.modelo);
    const leitura = lerEstadoLeitura(m.leitura);
    const config = await carregarConfig();
    const [liberador] = m.liberadoPor ? await db().select({ nome: users.name }).from(users).where(eq(users.id, m.liberadoPor)).limit(1) : [];
    return {
      ...paraTela(m), modelo, problemas: modelo ? validarModelo(modelo) : [],
      passos: passosParaTela(leitura),
      ia: resumoIA(leitura, m, config),
      tokens: { entrada: leitura.tokensEntrada, saida: leitura.tokensSaida },
      /** Em que arquivo e página está a planta de cada pavimento (fundo da revisão), com o arquivo achado pela identidade. */
      pranchas: pranchasParaTela(pranchasDaLeitura(leitura), m.documentos),
      /** EPIC-024 S-05: planta arquitetônica importada em andamento (candidata, separada do modelo em uso). */
      importacao: importacaoParaTela(lerImportacao(m.importacao), m, config),
      /** O que o leitor não conseguiu ler (prancha escaneada, página sem planta): aviso para a revisão. */
      avisosDaLeitura: Array.isArray(leitura.parciais.avisosDaLeitura) ? (leitura.parciais.avisosDaLeitura as string[]).slice(0, 12) : [],
      /** Escala usada em cada planta lida pelo leitor próprio, para a pessoa conferir. */
      escalas: leitura.passos.filter(p => p.tipo === "prancha").flatMap(p => {
        const pr = leitura.parciais[p.chave] as { plantas?: { titulo: string; escala: number; escalaOrigem: string }[]; diagnostico?: { lidaPor?: string } } | undefined;
        return (pr?.plantas ?? []).map(pl => ({ titulo: pl.titulo, escala: pl.escala, origem: pl.escalaOrigem, lidaPor: pr?.diagnostico?.lidaPor === "ia" ? "ia" as const : "geometrico" as const }));
      }),
      liberadoPorNome: liberador?.nome ?? null,
      emailCliente: (await destinatario(m))?.email ?? null,
      unidades: await unidadesDoEstudo(m.studyId),
      /** Telefone do cliente do projeto, para enviar o link da maquete pelo WhatsApp. */
      clienteTelefone: m.projectId ? (await db().select({ t: operationalProjects.clientPhone }).from(operationalProjects).where(eq(operationalProjects.id, m.projectId)).limit(1))[0]?.t ?? null
        : m.leadId ? (await db().select({ t: leads.phone }).from(leads).where(eq(leads.id, m.leadId)).limit(1))[0]?.t ?? null : null,
      disponiveis: await documentosDoPedido({ id: m.id, origem: m.origem as OrigemMaquete, projectId: m.projectId, studyId: m.studyId }),
    };
  }),

  criar: adminProcedure.input(z.object({
    origem: z.enum(ORIGENS_MAQUETE), alvoId: z.number().int().positive().optional(), tipo: z.enum(TIPOS_MAQUETE),
    /** Projeto de cliente sem projeto cadastrado: o pedido fica ligado ao cliente do CRM (um dos dois, nunca ambos). */
    leadId: z.number().int().positive().optional(),
    titulo: z.string().trim().max(255).optional(), faixaPreco: z.enum(FAIXAS_PRECO).optional(),
    preco: z.number().min(0).max(100000).optional(),
    documentos: z.array(documentoSchema).max(MAX_DOCUMENTOS).default([]),
  })).mutation(async ({ ctx, input }) => {
    let nomeAlvo: string;
    const porCliente = input.origem === "projeto" && !!input.leadId;
    if (porCliente && input.alvoId) throw new TRPCError({ code: "BAD_REQUEST", message: "Ligue o pedido ao projeto ou ao cliente do CRM, não aos dois." });
    if (!porCliente && !input.alvoId) throw new TRPCError({ code: "BAD_REQUEST", message: input.origem === "projeto" ? "Escolha o projeto ou o cliente do CRM." : "Escolha o estudo de incorporação." });
    if (input.origem === "incorporacao" && input.leadId) throw new TRPCError({ code: "BAD_REQUEST", message: "Maquete de Incorporação é ligada ao estudo." });
    if (porCliente) {
      const [c] = await db().select({ nome: leads.name }).from(leads).where(and(eq(leads.id, input.leadId!), isNull(leads.deletedAt))).limit(1);
      if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente do CRM não encontrado." });
      if (!input.faixaPreco) throw new TRPCError({ code: "BAD_REQUEST", message: "Escolha a faixa de preço da maquete." });
      nomeAlvo = c.nome;
    } else if (input.origem === "projeto") {
      const [p] = await db().select({ nome: operationalProjects.name }).from(operationalProjects).where(eq(operationalProjects.id, input.alvoId!)).limit(1);
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Projeto não encontrado." });
      if (!input.faixaPreco) throw new TRPCError({ code: "BAD_REQUEST", message: "Escolha a faixa de preço da maquete." });
      nomeAlvo = p.nome;
    } else {
      const [e] = await db().select({ nome: incorporationStudies.name }).from(incorporationStudies).where(eq(incorporationStudies.id, input.alvoId!)).limit(1);
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
    const projectId = input.origem === "projeto" && !porCliente ? input.alvoId! : null;
    const studyId = input.origem === "incorporacao" ? input.alvoId! : null;
    const documentos = await conferirDocumentos({ id: null, origem: input.origem, projectId, studyId }, input.documentos);
    const [nova] = await db().insert(maquetes3d).values({
      token: randomBytes(24).toString("base64url"), titulo: input.titulo || `Maquete 3D — ${nomeAlvo}`.slice(0, 255),
      origem: input.origem, projectId, studyId, leadId: porCliente ? input.leadId! : null,
      tipo: input.tipo, status: statusInicial(input.origem), faixaPreco: input.origem === "projeto" ? input.faixaPreco! : null, preco,
      documentos: JSON.stringify(documentos), solicitadoPor: ctx.user.id, createdAt: agora(), updatedAt: agora(),
    }).returning({ id: maquetes3d.id });
    return { id: nova.id };
  }),

  definirDocumentos: adminProcedure.input(idInput.extend({ documentos: z.array(documentoSchema).min(1).max(MAX_DOCUMENTOS) })).mutation(async ({ input }) => {
    const m = await buscar(input.id);
    if (m.status === "em_leitura" || m.status === "publicada" || m.status === "recusada") throw conflito("Os PDFs não podem ser trocados nesta situação.");
    const documentos = await conferirDocumentos({ id: m.id, origem: m.origem as OrigemMaquete, projectId: m.projectId, studyId: m.studyId }, input.documentos);
    await db().update(maquetes3d).set({ documentos: JSON.stringify(documentos), updatedAt: agora() }).where(eq(maquetes3d.id, m.id));
    return { ok: true };
  }),

  /**
   * Aprova o pedido feito pelo cliente no portal: confirma (ou corrige) a faixa de preço e libera o pagamento.
   * A partir daí o cliente paga pelo Asaas e o sistema recebe; ele é avisado por e-mail.
   */
  aprovarPedido: adminProcedure.input(idInput.extend({ faixaPreco: z.enum(FAIXAS_PRECO), preco: z.number().min(0).max(100000).optional() })).mutation(async ({ ctx, input }) => {
    exigirAdmin(ctx, "aprovar o pedido de maquete");
    const preco = (input.preco ?? (await carregarConfig()).precos[input.faixaPreco]).toFixed(2);
    const r = await db().update(maquetes3d).set({ status: "aguardando_pagamento" satisfies StatusMaquete, faixaPreco: input.faixaPreco, preco, updatedAt: agora() })
      .where(and(eq(maquetes3d.id, input.id), eq(maquetes3d.status, "aguardando_aprovacao"), isNull(maquetes3d.deletedAt))).returning();
    if (!r.length) throw conflito("Este pedido não está aguardando aprovação.");
    return { preco: Number(preco), email: await avisarPedidoAprovado(r[0]) };
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

  /** PDF original em partes de 2 MiB (a resposta da função é limitada), para a revisão desenhar a prancha ao fundo. */
  pdfParte: adminProcedure.input(idInput.extend({ doc: z.number().int().min(0).max(MAX_DOCUMENTOS - 1), parte: z.number().int().min(0).max(40) })).query(async ({ input }) => {
    const m = await buscar(input.id);
    const d = lerDocumentos(m.documentos)[input.doc];
    if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Arquivo não encontrado nesta maquete." });
    let dados: Buffer;
    try { dados = await dependencias().lerPdf(d, alvoDoDocumento(m, d)); }
    catch { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível abrir o PDF original." }); }
    const partes = Math.max(1, Math.ceil(dados.length / PARTE_PDF_BYTES));
    if (input.parte >= partes) throw new TRPCError({ code: "BAD_REQUEST" });
    return { partes, nome: d.nome, base64: dados.subarray(input.parte * PARTE_PDF_BYTES, (input.parte + 1) * PARTE_PDF_BYTES).toString("base64") };
  }),

  iniciarLeitura: adminProcedure.input(idInput).mutation(async ({ input }) => {
    const m = await buscar(input.id);
    if (!lerDocumentos(m.documentos).length) throw new TRPCError({ code: "BAD_REQUEST", message: "Escolha ou envie ao menos um PDF antes de iniciar a leitura." });
    try { return progressoLeitura(await iniciarLeitura(m.id)); }
    catch (e) { if (e instanceof LeituraIndisponivel) throw conflito(e.message); throw e; }
  }),

  /** Executa um passo da leitura. A tela chama até `proximo` vir nulo ou um passo dar erro. */
  avancarLeitura: adminProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      const { estado, status } = await avancarLeitura(input.id, ctx.user.id);
      return retornoDoPasso(estado, status);
    } catch (e) { if (e instanceof LeituraIndisponivel) throw conflito(e.message); throw e; }
  }),

  /**
   * EPIC-024 S-03: o administrador confirma o envio das pranchas à IA (paga) para ESTA leitura — dentro do teto por
   * maquete; com `alemDoTeto`, também as que passam dele. A confirmação expira quando as autorizadas forem lidas.
   */
  confirmarIA: adminProcedure.input(idInput.extend({ alemDoTeto: z.boolean().default(false) })).mutation(async ({ ctx, input }) => {
    exigirAdmin(ctx, input.alemDoTeto ? "autorizar a leitura pela IA além do teto da maquete" : "autorizar a leitura paga pela IA");
    try { return retornoDoPasso(await confirmarIA(input.id, ctx.user.id, input.alemDoTeto), "em_leitura"); }
    catch (e) { if (e instanceof LeituraIndisponivel) throw conflito(e.message); throw e; }
  }),

  /** Segue a leitura sem a IA: fica o que o leitor próprio leu dessas pranchas (ou a planta é desenhada na revisão). */
  pularIA: adminProcedure.input(idInput).mutation(async ({ input }) => {
    try { return retornoDoPasso(await pularIA(input.id), "em_leitura"); }
    catch (e) { if (e instanceof LeituraIndisponivel) throw conflito(e.message); throw e; }
  }),

  /** Grava a planta corrigida na revisão. `versao` evita que duas pessoas se sobrescrevam. */
  salvarModelo: adminProcedure.input(idInput.extend({ versao: z.number().int().min(0), modelo: modeloSchema, motivo: z.string().trim().max(400).optional() })).mutation(async ({ ctx, input }) => {
    const m = await buscar(input.id);
    let versao: number;
    try {
      versao = await gravarModelo({
        de: m, versao: input.versao, modelo: input.modelo, status: PODE_REVISAR, origem: "edicao", motivo: input.motivo || "Planta corrigida na revisão", autorId: ctx.user.id,
        extra: { status: "em_revisao" satisfies StatusMaquete, revisadoPor: ctx.user.id, revisadoEm: agora() },
      });
    } catch (e) {
      if (e instanceof ConflitoDeVersao) throw conflito("A planta foi alterada por outra pessoa ou não está em revisão. Recarregue a página.");
      // A planta atual não pôde ir para o histórico: nada foi salvo (a edição continua na tela para tentar de novo).
      if (e instanceof HistoricoIndisponivel) throw conflito(e.message);
      throw e;
    }
    return { versao, problemas: validarModelo(input.modelo), resumo: resumoModelo(input.modelo) };
  }),

  // ── Planta arquitetônica importada na revisão (EPIC-024 S-05) ──

  /**
   * Começa a importação: um PDF novo (enviado em partes, guardado e posto na lista do pedido) ou um da lista.
   * Lê só esse PDF numa planta candidata; o modelo em uso não muda até "Aplicar".
   */
  importarPlanta: adminProcedure.input(idInput.extend({
    uploadId: z.string().min(20).max(64).optional(), nome: z.string().trim().min(1).max(255).optional(), doc: z.number().int().min(0).max(MAX_DOCUMENTOS - 1).optional(),
  })).mutation(async ({ ctx, input }) => {
    const m = await buscar(input.id);
    if (!PODE_IMPORTAR.includes(m.status as StatusMaquete)) throw conflito("Nesta situação não é possível importar uma planta.");
    if (m.status === "publicada") exigirAdmin(ctx, "importar planta numa maquete publicada");
    let doc = input.doc;
    if (input.uploadId) {
      if (!input.nome) throw new TRPCError({ code: "BAD_REQUEST", message: "Informe o nome do arquivo." });
      doc = (await guardarPdfAvulso(m, input.uploadId, input.nome, ctx.user.id)).indice;
    }
    if (doc === undefined) throw new TRPCError({ code: "BAD_REQUEST", message: "Envie o PDF da planta ou escolha um da lista." });
    try { return retornoDaImportacao(await iniciarImportacao(m.id, doc, ctx.user.id)); } catch (e) { traduzir(e); }
  }),

  avancarImportacao: adminProcedure.input(idInput).mutation(async ({ input }) => {
    try { return retornoDaImportacao(await avancarImportacao(input.id)); } catch (e) { traduzir(e); }
  }),

  confirmarIAImportacao: adminProcedure.input(idInput.extend({ alemDoTeto: z.boolean().default(false) })).mutation(async ({ ctx, input }) => {
    exigirAdmin(ctx, input.alemDoTeto ? "autorizar a leitura pela IA além do teto da maquete" : "autorizar a leitura paga pela IA");
    try { return retornoDaImportacao(await confirmarIAImportacao(input.id, ctx.user.id, input.alemDoTeto)); } catch (e) { traduzir(e); }
  }),

  pularIAImportacao: adminProcedure.input(idInput).mutation(async ({ input }) => {
    try { return retornoDaImportacao(await pularIAImportacao(input.id)); } catch (e) { traduzir(e); }
  }),

  /** Grava a candidata editada (antes de aplicar). */
  salvarCandidata: adminProcedure.input(idInput.extend({ modelo: modeloSchema })).mutation(async ({ input }) => {
    try { await salvarCandidata(input.id, input.modelo); } catch (e) { traduzir(e); }
    return { problemas: validarModelo(input.modelo) };
  }),

  descartarImportacao: adminProcedure.input(idInput).mutation(async ({ input }) => {
    try { await descartarImportacao(input.id); } catch (e) { traduzir(e); }
    return { ok: true };
  }),

  /** Aplica a candidata no que a pessoa escolheu, com a trava de versão. Publicada: só o admin, e ela sai do ar. */
  aplicarImportacao: adminProcedure.input(idInput.extend({ versao: z.number().int().min(0), destino: destinoSchema, motivo: z.string().trim().max(400).default("") })).mutation(async ({ ctx, input }) => {
    const m = await buscar(input.id);
    if (m.status === "publicada") exigirAdmin(ctx, "aplicar planta numa maquete publicada (ela sai do ar)");
    try {
      const r = await aplicarImportacao({ id: input.id, versao: input.versao, destino: input.destino, motivo: input.motivo, autorId: ctx.user.id });
      return { versao: r.versao, saiuDoAr: r.saiuDoAr, problemas: validarModelo(r.modelo), resumo: resumoModelo(r.modelo) };
    } catch (e) { traduzir(e); }
  }),

  /** Histórico das plantas (cada mudança do modelo). */
  revisoes: adminProcedure.input(idInput).query(async ({ input }) => {
    await buscar(input.id);
    return listarRevisoes(input.id);
  }),

  /** Volta a uma revisão anterior; a restauração é ela mesma uma revisão nova. Publicada: só o admin, e sai do ar. */
  restaurarRevisao: adminProcedure.input(idInput.extend({ revisaoId: z.number().int().positive(), versao: z.number().int().min(0) })).mutation(async ({ ctx, input }) => {
    const m = await buscar(input.id);
    if (!PODE_IMPORTAR.includes(m.status as StatusMaquete)) throw conflito("Nesta situação não é possível restaurar uma versão.");
    if (m.status === "publicada") exigirAdmin(ctx, "restaurar versão de uma maquete publicada (ela sai do ar)");
    const rev = await lerRevisao(m.id, input.revisaoId);
    const modelo = rev ? lerModelo(rev.modelo) : null;
    if (!rev || !modelo) throw new TRPCError({ code: "NOT_FOUND", message: "Versão não encontrada nesta maquete." });
    let documento: DocumentoMaquete | null = null;
    try { documento = rev.documento ? documentoSchema.parse(JSON.parse(rev.documento)) : null; } catch { documento = null; }
    try {
      const versao = await gravarModelo({
        de: m, versao: input.versao, modelo, status: PODE_IMPORTAR, origem: "restauracao", motivo: `Restaurada a versão ${rev.versao}`, documento, autorId: ctx.user.id,
        extra: { status: "em_revisao" satisfies StatusMaquete, revisadoPor: ctx.user.id, revisadoEm: agora(), ...(m.status === "publicada" ? { publicadoEm: null } : {}) },
      });
      return { versao, saiuDoAr: m.status === "publicada" };
    } catch (e) { traduzir(e); }
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

  /**
   * Incorporação: monta (ou atualiza) a implantação da maquete com o terreno, as ruas e os lotes que o estudo já
   * tem no cenário escolhido do estudo de massa. Não usa IA nem PDF. As edificações já lidas são mantidas.
   */
  implantacaoDoEstudo: adminProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const m = await buscar(input.id);
    if (m.origem !== "incorporacao" || !m.studyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Só maquetes de Incorporação têm implantação vinda do estudo." });
    if (!["liberada", "em_revisao", "validada"].includes(m.status)) throw conflito("A maquete precisa estar autorizada (e não publicada) para montar a implantação.");
    const { r, cenario } = await lerImplantacaoDoEstudo(m.studyId);
    const modelo = lerModelo(m.modelo) ?? modeloVazio(m.tipo as TipoMaquete);
    // As construções posicionadas à mão na revisão são mantidas quando a implantação é atualizada pelo estudo.
    const novo = modeloSchema.parse({ ...modelo, implantacao: { ...r.implantacao, posicoes: modelo.implantacao?.posicoes ?? [] } });
    try {
      await gravarModelo({
        de: m, versao: m.modeloVersao, modelo: novo, status: [m.status as StatusMaquete], origem: "implantacao_estudo", motivo: "Implantação montada a partir do estudo", autorId: ctx.user.id,
        extra: { status: "em_revisao" satisfies StatusMaquete, revisadoPor: ctx.user.id, revisadoEm: agora() },
      });
    } catch (e) {
      if (e instanceof ConflitoDeVersao) throw conflito("A maquete foi alterada por outra pessoa. Recarregue a página.");
      if (e instanceof HistoricoIndisponivel) throw conflito(e.message);
      throw e;
    }
    return { lotes: r.implantacao.lotes.length, ruas: r.implantacao.ruas.length, temTerreno: r.implantacao.terreno.length > 0, temRelevo: !!r.implantacao.relevo, descartados: r.descartados, semCenario: !cenario };
  }),

  /**
   * Troca o tipo da maquete e redesenha: em Casa/Condomínio e em Prédio, gera a construção PADRÃO do tamanho
   * informado (sem PDF e sem IA) e põe uma em cada lote vendável da implantação. Em Loteamento, ficam só os lotes.
   * Construções lidas de PDF são mantidas; só a padrão (id fixo) é trocada. Incorporação sem implantação ainda:
   * ela é montada do estudo na mesma chamada.
   */
  aplicarTipo: adminProcedure.input(idInput.extend({
    tipo: z.enum(TIPOS_MAQUETE),
    casa: z.object({ frente: z.number().min(LIMITES_CASA.frente[0]).max(LIMITES_CASA.frente[1]), fundo: z.number().min(LIMITES_CASA.fundo[0]).max(LIMITES_CASA.fundo[1]),
      quartos: z.number().int().min(LIMITES_CASA.quartos[0]).max(LIMITES_CASA.quartos[1]), pavimentos: z.union([z.literal(1), z.literal(2)]), garagem: z.boolean() }).optional(),
    predio: z.object({ largura: z.number().min(LIMITES_PREDIO.largura[0]).max(LIMITES_PREDIO.largura[1]), profundidade: z.number().min(LIMITES_PREDIO.profundidade[0]).max(LIMITES_PREDIO.profundidade[1]),
      andares: z.number().int().min(LIMITES_PREDIO.andares[0]).max(LIMITES_PREDIO.andares[1]), aptosPorAndar: z.number().int().min(LIMITES_PREDIO.aptosPorAndar[0]).max(LIMITES_PREDIO.aptosPorAndar[1]),
      // Estacionamento (regra do dono): os apartamentos nunca passam das vagas que o terreno comporta.
      vagasPorApto: z.number().min(LIMITES_PREDIO.vagasPorApto[0]).max(LIMITES_PREDIO.vagasPorApto[1]).default(1), pilotis: z.boolean().default(true),
      m2PorVaga: z.number().min(LIMITES_M2_POR_VAGA[0]).max(LIMITES_M2_POR_VAGA[1]).optional(),
      subsolos: z.number().int().min(LIMITES_PREDIO.subsolos[0]).max(LIMITES_PREDIO.subsolos[1]).default(0),
      /** Área do terreno do prédio, quando a maquete não tem lotes (prédio único). */
      areaTerreno: z.number().min(LIMITES_PREDIO.areaTerreno[0]).max(LIMITES_PREDIO.areaTerreno[1]).optional() }).optional(),
  })).mutation(async ({ ctx, input }) => {
    const m = await buscar(input.id);
    if (!["liberada", "em_revisao", "validada"].includes(m.status)) throw conflito("A maquete precisa estar liberada (e não publicada) para trocar o tipo.");
    const atual = lerModelo(m.modelo) ?? modeloVazio(input.tipo);
    let implantacao = atual.implantacao;
    if (!implantacao && m.origem === "incorporacao" && m.studyId) implantacao = { ...(await lerImplantacaoDoEstudo(m.studyId)).r.implantacao, posicoes: [] };
    const lidas = atual.edificacoes.filter(e => !ehPadrao(e));
    let padrao: Edificacao | null = null;
    let estacionamento: (ContaDoEstacionamento & { areaTerreno: number; vagasPorApto: number }) | null = null;
    if (input.tipo === "predio") {
      if (!input.predio && !lidas.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Informe as medidas do prédio." });
      if (input.predio) {
        // Área de terreno por prédio: o menor lote vendável em que ele cabe (cada lote recebe um prédio igual);
        // sem lotes, a área informada.
        const pr = input.predio, lotes = implantacao?.lotes.filter(l => l.tipo === "vendavel" && l.poligono.length >= 3) ?? [];
        let areaTerreno = pr.areaTerreno ?? 0;
        if (lotes.length) {
          const cabem = new Set(distribuirNosLotes(implantacao!, pr.largura, pr.profundidade).posicoes.map(c => c.nome));
          const rotulo = (l: (typeof lotes)[number]) => [l.quadra && `Q${l.quadra}`, l.nome && `L${l.nome}`].filter(Boolean).join(" ") || l.id;
          const areas = lotes.filter(l => cabem.has(rotulo(l))).map(l => areaPoligono(l.poligono));
          if (!areas.length) throw new TRPCError({ code: "BAD_REQUEST", message: `Um prédio de ${pr.largura} × ${pr.profundidade} m não cabe em nenhum lote vendável. Diminua a largura ou a profundidade.` });
          areaTerreno = Math.min(...areas);
        }
        if (!areaTerreno) throw new TRPCError({ code: "BAD_REQUEST", message: "Informe a área do terreno do prédio, para calcular o estacionamento." });
        if (areaTerreno < pr.largura * pr.profundidade) throw new TRPCError({ code: "BAD_REQUEST", message: `O prédio (${Math.round(pr.largura * pr.profundidade)} m² de projeção) é maior que o terreno informado (${Math.round(areaTerreno)} m²).` });
        estacionamento = { ...contaDoEstacionamento(pr, pr, areaTerreno), areaTerreno: Math.round(areaTerreno * 100) / 100, vagasPorApto: pr.vagasPorApto };
        if (estacionamento.inviavel) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `O estacionamento não comporta este prédio: cabem ${estacionamento.vagas.total} vaga(s) em ${Math.round(areaTerreno)} m² de terreno, menos que o necessário para um andar. Use pilotis, acrescente subsolo, reduza as vagas por apartamento ou aumente o terreno.` });
        }
        padrao = predioPadrao({ ...pr, andares: estacionamento.andares, aptosPorAndar: estacionamento.aptosPorAndar, vagasNoPilotis: estacionamento.vagas.pilotis });
      }
    } else if (input.tipo !== "loteamento") {
      if (!input.casa && !lidas.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Informe o tamanho da casa." });
      if (input.casa) padrao = casaPadrao(input.casa);
    }
    // Sem medidas novas, quem ocupa os lotes é a construção já lida do PDF.
    const modeloDoLote = padrao ?? (input.tipo === "loteamento" ? null : lidas[0] ?? null);
    let semConstrucao: string[] = [], construcoes = 0;
    if (implantacao) {
      if (modeloDoLote) {
        const pg = limites(pontosDoPavimento(modeloDoLote.pavimentos[0]));
        const d = distribuirNosLotes(implantacao, Math.max(pg.largura, 3), Math.max(pg.altura, 3), modeloDoLote.id);
        // A posição é o canto de origem da planta: desconta o deslocamento da planta lida (a padrão começa em 0,0).
        const posicoes = d.posicoes.map(c => {
          const rad = (c.rotacao * Math.PI) / 180;
          return { ...c, x: c.x - (pg.minX * Math.cos(rad) - pg.minY * Math.sin(rad)), y: c.y - (pg.minX * Math.sin(rad) + pg.minY * Math.cos(rad)) };
        });
        implantacao = { ...implantacao, posicoes };
        semConstrucao = d.semConstrucao; construcoes = posicoes.length;
      } else implantacao = { ...implantacao, posicoes: [] };
    }
    const novo = modeloSchema.parse({ ...atual, tipo: input.tipo, edificacoes: padrao ? [...lidas, padrao] : lidas, implantacao });
    try {
      await gravarModelo({
        de: m, versao: m.modeloVersao, modelo: novo, status: [m.status as StatusMaquete], origem: "tipo_padrao",
        motivo: `Tipo ${input.tipo}${padrao ? ` com ${padrao.nome.toLowerCase()}` : ""}`, autorId: ctx.user.id,
        extra: { tipo: input.tipo, status: "em_revisao" satisfies StatusMaquete, revisadoPor: ctx.user.id, revisadoEm: agora() },
      });
    } catch (e) {
      if (e instanceof ConflitoDeVersao) throw conflito("A maquete foi alterada por outra pessoa. Recarregue a página.");
      if (e instanceof HistoricoIndisponivel) throw conflito(e.message);
      throw e;
    }
    const lotes = implantacao?.lotes.filter(l => l.tipo === "vendavel").length ?? 0;
    return { construcoes, lotes, semConstrucao: semConstrucao.slice(0, 40), semConstrucaoTotal: semConstrucao.length, padrao: padrao?.nome ?? null, resumo: resumoModelo(novo), estacionamento };
  }),

  /** Dados da tela de apresentação (nome, localização, preço, WhatsApp). Campo vazio não aparece para o cliente. */
  salvarComercial: adminProcedure.input(idInput.extend({ comercial: comercialSchema })).mutation(async ({ input }) => {
    const m = await buscar(input.id);
    await db().update(maquetes3d).set({ comercial: JSON.stringify(input.comercial), updatedAt: agora() }).where(eq(maquetes3d.id, m.id));
    return { ok: true };
  }),

  /** Publica: o link /maquete/<token> passa a abrir para o cliente. Só planta validada, e só o admin. */
  publicar: adminProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    exigirAdmin(ctx, "publicar a maquete");
    const m = await buscar(input.id);
    const modelo = lerModelo(m.modelo);
    if (!modelo || !podePublicar(modelo)) throw new TRPCError({ code: "BAD_REQUEST", message: "A planta precisa estar validada, sem erros nem pendências." });
    const r = await db().update(maquetes3d).set({ status: "publicada" satisfies StatusMaquete, publicadoEm: agora(), updatedAt: agora() })
      .where(and(eq(maquetes3d.id, m.id), eq(maquetes3d.status, "validada"))).returning();
    if (!r.length) throw conflito("Só uma planta validada pode ser publicada.");
    // Projeto de cliente: o link segue por e-mail na hora. Incorporação é material interno de venda, sem destinatário.
    return { token: r[0].token, email: r[0].origem === "projeto" ? await avisarMaquetePronta(r[0]) : null };
  }),

  /** Manda de novo o e-mail com o link (maquete já publicada). */
  reenviarEmail: adminProcedure.input(idInput).mutation(async ({ input }) => {
    const m = await buscar(input.id);
    if (m.status !== "publicada") throw conflito("Só maquete publicada tem link para enviar.");
    return avisarMaquetePronta(m);
  }),

  /** Tira o link do ar e devolve a maquete para "validada" (para corrigir e publicar de novo). */
  despublicar: adminProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    exigirAdmin(ctx, "tirar a maquete do ar");
    const r = await db().update(maquetes3d).set({ status: "validada" satisfies StatusMaquete, publicadoEm: null, updatedAt: agora() })
      .where(and(eq(maquetes3d.id, input.id), eq(maquetes3d.status, "publicada"), isNull(maquetes3d.deletedAt))).returning({ id: maquetes3d.id });
    if (!r.length) throw conflito("Esta maquete não está publicada.");
    return { ok: true };
  }),
});

/** Leitura pública pelo link do cliente: só maquete publicada, só o necessário para desenhar e apresentar. */
export const maquetePublicaRouter = router({
  porToken: publicProcedure.input(z.object({ token: z.string().min(16).max(64) })).query(async ({ input }) => {
    const [m] = await db().select().from(maquetes3d)
      .where(and(eq(maquetes3d.token, input.token), eq(maquetes3d.status, "publicada"), isNull(maquetes3d.deletedAt))).limit(1);
    const modelo = m && lerModelo(m.modelo);
    if (!m || !modelo) throw new TRPCError({ code: "NOT_FOUND", message: "Maquete não encontrada ou ainda não publicada." });
    const comercial = lerComercial(m.comercial);
    return { titulo: comercial.nome || m.titulo, tipo: m.tipo, modelo, comercial, unidades: await unidadesDoEstudo(m.studyId) };
  }),
});
