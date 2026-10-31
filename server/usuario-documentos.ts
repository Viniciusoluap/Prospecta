// Lote 2, correção 04 (AD-02): perfil Engenheiro (colaborador + dados profissionais)
// e documentos do usuário guardados no próprio banco. Mesma regra no Grupo Santa Fé
// (web/src/lib/engenheiros.ts + web/src/app/api/usuarios/[id]/documentos).
import { Router, type Request, type Response } from "express";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { engineerProfiles, userDocuments, users } from "../drizzle/schema.js";
import {
  acessoDocumentosUsuario,
  CATEGORIAS_DOCUMENTO_USUARIO,
  contentDisposition,
  lerCreasAdicionais,
  PARTE_DOCUMENTO_USUARIO_BYTES,
  podeVisualizarNoNavegador,
  validarArquivoDocumento,
  validarPerfilEngenheiro,
  type CreaAdicional,
  type PerfilEngenheiroDados,
} from "../shared/engenheiro.js";
import { sessaoAindaValida } from "../shared/session.js";
import { getTokenFromRequest, verifySessionToken } from "./_core/auth-utils.js";
import { protectedProcedure, router } from "./_core/trpc.js";
import { clearUpload, readUpload } from "./document-upload-chunks.js";
import { getDb, getUserById } from "./db.js";
import { copiarParaDrive, lixeiraDoArquivo } from "./drive-organizacao.js";

type Linhas<T> = { rows: T[] };

// ─── Consulta para os demais módulos ─────────────────────────────────────────

export type EngenheiroOpcao = {
  id: number;
  name: string | null;
  email: string | null;
  role: string;
  /** true = perfil Engenheiro ativo (colaborador com dados profissionais). */
  engenheiro: boolean;
  telefone: string | null;
  crea: string | null;
  creaUf: string | null;
  creasAdicionais: CreaAdicional[];
};

/**
 * Pessoas que podem ser escolhidas como engenheiro responsável (Projetos e, nas
 * próximas ondas, Obras, Gerador de PCI e Incorporação): colaboradores e admins
 * ativos, com os dados do perfil Engenheiro quando houver. `apenasEngenheiros`
 * restringe a quem tem o perfil ativo. CREA ausente vem null — nunca inventado.
 */
export async function listarEngenheiros(opcoes: { apenasEngenheiros?: boolean } = {}): Promise<EngenheiroOpcao[]> {
  const linhas = await getDb().select({
    id: users.id, name: users.name, email: users.email, role: users.role, phone: users.phone,
    perfilAtivo: engineerProfiles.active, perfilFone: engineerProfiles.phone,
    crea: engineerProfiles.creaNumber, creaUf: engineerProfiles.creaState, adicionais: engineerProfiles.additionalCreas,
  }).from(users)
    .leftJoin(engineerProfiles, eq(engineerProfiles.userId, users.id))
    .where(and(eq(users.active, true), inArray(users.role, ["colaborador", "admin"])))
    .orderBy(asc(users.name));
  return linhas
    .map((l) => {
      const engenheiro = l.role === "colaborador" && l.perfilAtivo === true;
      return {
        id: l.id, name: l.name, email: l.email, role: l.role, engenheiro,
        telefone: (l.perfilAtivo ? l.perfilFone : null) || l.phone || null,
        crea: l.perfilAtivo ? l.crea ?? null : null,
        creaUf: l.perfilAtivo ? l.creaUf ?? null : null,
        creasAdicionais: l.perfilAtivo ? lerCreasAdicionais(l.adicionais) : [],
      };
    })
    .filter((e) => !opcoes.apenasEngenheiros || e.engenheiro);
}

// ─── Perfil ──────────────────────────────────────────────────────────────────

/** Grava (ou reativa) o perfil Engenheiro. Só chamado depois da checagem de admin. */
export async function gravarPerfilEngenheiro(userId: number, dados: PerfilEngenheiroDados, autorId: number | null) {
  const valores = {
    ...(dados.cpf !== undefined ? { cpf: dados.cpf } : {}),
    active: true, phone: dados.telefone, cep: dados.cep, street: dados.logradouro, number: dados.numero,
    complement: dados.complemento, district: dados.bairro, city: dados.cidade, state: dados.uf,
    creaNumber: dados.crea, creaState: dados.creaUf, additionalCreas: dados.creasAdicionais,
    updatedAt: new Date(), updatedBy: autorId,
  };
  await getDb().insert(engineerProfiles).values({ userId, ...valores })
    .onConflictDoUpdate({ target: engineerProfiles.userId, set: valores });
}

/** Liga/desliga o perfil sem apagar os dados (trocar de perfil não perde CREA nem endereço). */
export async function definirPerfilEngenheiroAtivo(userId: number, ativo: boolean, autorId: number | null) {
  const db = getDb();
  if (ativo) {
    await db.insert(engineerProfiles).values({ userId, active: true, updatedBy: autorId })
      .onConflictDoUpdate({ target: engineerProfiles.userId, set: { active: true, updatedAt: new Date(), updatedBy: autorId } });
  } else {
    await db.update(engineerProfiles).set({ active: false, updatedAt: new Date(), updatedBy: autorId }).where(eq(engineerProfiles.userId, userId));
  }
}

function acessar(ator: { id: number; role: string; active?: boolean | null }, alvoId: number, gerenciar: boolean) {
  const acesso = acessoDocumentosUsuario({ id: ator.id, papel: ator.role, ativo: ator.active }, alvoId);
  if (gerenciar ? !acesso.gerenciar : !acesso.ver) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para os dados deste usuário." });
  return acesso;
}

async function usuarioExiste(id: number) {
  const [u] = await getDb().select({ id: users.id, name: users.name, email: users.email, role: users.role, phone: users.phone }).from(users).where(eq(users.id, id)).limit(1);
  if (!u) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado." });
  return u;
}

const idUsuario = z.object({ userId: z.number().int().positive() });
const categoria = z.enum(CATEGORIAS_DOCUMENTO_USUARIO);

export const engenheirosRouter = router({
  /** Perfil + documentos de um usuário (admin, ou o próprio usuário só para consulta). */
  perfil: protectedProcedure.input(idUsuario).query(async ({ ctx, input }) => {
    const acesso = acessar(ctx.user, input.userId, false);
    const u = await usuarioExiste(input.userId);
    const [p] = await getDb().select().from(engineerProfiles).where(eq(engineerProfiles.userId, input.userId)).limit(1);
    const documentos = await getDb().select({
      id: userDocuments.id, categoria: userDocuments.category, nome: userDocuments.originalName, mime: userDocuments.mime,
      tamanho: userDocuments.sizeBytes, enviadoEm: userDocuments.uploadedAt, enviadoPorNome: users.name,
    }).from(userDocuments).leftJoin(users, eq(users.id, userDocuments.uploadedBy))
      .where(eq(userDocuments.userId, input.userId)).orderBy(asc(userDocuments.category), desc(userDocuments.uploadedAt));
    return {
      usuario: { id: u.id, nome: u.name, email: u.email, papel: u.role },
      podeGerenciar: acesso.gerenciar,
      engenheiro: u.role === "colaborador" && p?.active === true,
      perfil: {
        cpf: p?.cpf ?? null,
        telefone: p?.phone ?? u.phone ?? null, cep: p?.cep ?? null, logradouro: p?.street ?? null, numero: p?.number ?? null,
        complemento: p?.complement ?? null, bairro: p?.district ?? null, cidade: p?.city ?? null, uf: p?.state ?? null,
        crea: p?.creaNumber ?? null, creaUf: p?.creaState ?? null, creasAdicionais: lerCreasAdicionais(p?.additionalCreas),
      },
      documentos: documentos.map((d) => ({ ...d, visualizavel: podeVisualizarNoNavegador(d.mime) })),
    };
  }),

  salvarPerfil: protectedProcedure.input(z.object({
    userId: z.number().int().positive(),
    cpf: z.string().max(20).nullish(),
    telefone: z.string().max(40).nullish(), cep: z.string().max(20).nullish(), logradouro: z.string().max(300).nullish(),
    numero: z.string().max(40).nullish(), complemento: z.string().max(200).nullish(), bairro: z.string().max(200).nullish(),
    cidade: z.string().max(200).nullish(), uf: z.string().max(4).nullish(), crea: z.string().max(60).nullish(), creaUf: z.string().max(4).nullish(),
    creasAdicionais: z.array(z.object({ numero: z.string().max(60), uf: z.string().max(4) })).max(30).default([]),
  })).mutation(async ({ ctx, input }) => {
    acessar(ctx.user, input.userId, true);
    const u = await usuarioExiste(input.userId);
    if (u.role !== "colaborador") throw new TRPCError({ code: "BAD_REQUEST", message: "O perfil Engenheiro é de colaborador. Altere o perfil do usuário para Engenheiro antes." });
    const v = validarPerfilEngenheiro(input);
    if (!v.ok) throw new TRPCError({ code: "BAD_REQUEST", message: v.erro });
    await gravarPerfilEngenheiro(input.userId, v.dados, ctx.user.id);
    return { success: true } as const;
  }),

  /** Finaliza um envio feito em partes (documentChunks.part) e grava o original no banco. */
  enviarDocumento: protectedProcedure.input(z.object({
    userId: z.number().int().positive(), categoria, uploadId: z.string(), fileName: z.string().min(1).max(255),
    substituirId: z.number().int().positive().optional(),
  })).mutation(async ({ ctx, input }) => {
    acessar(ctx.user, input.userId, true);
    await usuarioExiste(input.userId);
    const escopo = `usuario:${input.userId}:${input.categoria}`;
    const dados = await readUpload(input.uploadId, ctx.user.id, escopo, input.fileName);
    const v = validarArquivoDocumento(input.fileName, dados);
    if (!v.ok) throw new TRPCError({ code: "BAD_REQUEST", message: v.erro });
    const base64 = Buffer.from(dados).toString("base64");
    const db = getDb();
    let id: number;
    let driveAnterior: string | null = null;
    if (input.substituirId) {
      const [antes] = await db.select({ driveFileId: userDocuments.driveFileId }).from(userDocuments)
        .where(and(eq(userDocuments.id, input.substituirId), eq(userDocuments.userId, input.userId))).limit(1);
      driveAnterior = antes?.driveFileId ?? null;
      const r = await db.execute(sql`UPDATE user_documents SET category = ${input.categoria}, original_name = ${v.nome}, mime = ${v.mime},
          size_bytes = ${dados.length}, content = decode(${base64}, 'base64'), uploaded_by = ${ctx.user.id}, uploaded_at = now(), drive_file_id = NULL
        WHERE id = ${input.substituirId} AND user_id = ${input.userId} RETURNING id`);
      const linha = (r as unknown as Linhas<{ id: number }>).rows[0];
      if (!linha) throw new TRPCError({ code: "NOT_FOUND", message: "Documento a substituir não encontrado." });
      id = Number(linha.id);
    } else {
      const r = await db.execute(sql`INSERT INTO user_documents (user_id, category, original_name, mime, size_bytes, content, uploaded_by)
        VALUES (${input.userId}, ${input.categoria}, ${v.nome}, ${v.mime}, ${dados.length}, decode(${base64}, 'base64'), ${ctx.user.id}) RETURNING id`);
      id = Number((r as unknown as Linhas<{ id: number }>).rows[0].id);
    }
    await clearUpload(input.uploadId, ctx.user.id);
    // Pedido de 29/10: cópia em Equipe/<Nome (nº id)>/<Categoria> no Google Drive. O banco continua
    // servindo a tela; sem Drive (ou com falha) fica pendente para o "Organizar Drive".
    if (driveAnterior) await lixeiraDoArquivo(driveAnterior);
    const noDrive = await copiarParaDrive("usuario_documento", id);
    return { id, nome: v.nome, tamanho: dados.length, noDrive };
  }),

  excluirDocumento: protectedProcedure.input(z.object({ userId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      acessar(ctx.user, input.userId, true);
      const apagados = await getDb().delete(userDocuments)
        .where(and(eq(userDocuments.id, input.id), eq(userDocuments.userId, input.userId))).returning({ id: userDocuments.id, driveFileId: userDocuments.driveFileId });
      if (!apagados.length) throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado." });
      await lixeiraDoArquivo(apagados[0].driveFileId); // Pedido de 29/10: cópia do Drive para a lixeira
      return { success: true } as const;
    }),
});

// ─── Download (rota Express autenticada) ─────────────────────────────────────

async function usuarioDaSessao(req: Request) {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  const usuario = await getUserById(payload.userId);
  if (!usuario || !sessaoAindaValida(usuario, payload.sessionVersion) || !usuario.active) return null;
  return usuario;
}

const idValido = (v: string) => (/^\d{1,9}$/.test(v) ? Number(v) : null);

/**
 * GET /api/usuarios/:userId/documentos/:docId — arquivo original, com o nome original.
 * `?offset=N` devolve 1 MB a partir de N (cabeçalho X-Document-Size = tamanho total):
 * a tela baixa em partes por causa do limite de 4,5 MB de resposta da Vercel.
 * `?inline=1` abre no navegador (só PDF e imagem; o resto sempre baixa).
 */
const rotas = Router();
rotas.get("/usuarios/:userId/documentos/:docId", async (req: Request, res: Response) => {
  try {
    const usuario = await usuarioDaSessao(req);
    if (!usuario) return res.status(401).json({ error: "Sessão expirada. Entre novamente." });
    const userId = idValido(String(req.params.userId));
    const docId = idValido(String(req.params.docId));
    if (!userId || !docId) return res.status(404).json({ error: "Documento não encontrado." });
    if (!acessoDocumentosUsuario({ id: usuario.id, papel: usuario.role, ativo: usuario.active }, userId).ver)
      return res.status(404).json({ error: "Documento não encontrado." });
    const temOffset = req.query.offset !== undefined;
    const offset = temOffset ? Number(req.query.offset) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0) return res.status(400).json({ error: "Parte inválida." });
    const r = await getDb().execute(temOffset
      ? sql`SELECT original_name, mime, size_bytes, encode(substring(content FROM ${offset + 1} FOR ${PARTE_DOCUMENTO_USUARIO_BYTES}), 'base64') AS b64
          FROM user_documents WHERE id = ${docId} AND user_id = ${userId}`
      : sql`SELECT original_name, mime, size_bytes, encode(content, 'base64') AS b64 FROM user_documents WHERE id = ${docId} AND user_id = ${userId}`);
    const linha = (r as unknown as Linhas<{ original_name: string; mime: string; size_bytes: number; b64: string }>).rows[0];
    if (!linha) return res.status(404).json({ error: "Documento não encontrado." });
    if (temOffset && offset >= Number(linha.size_bytes)) return res.status(400).json({ error: "Parte inválida." });
    const corpo = Buffer.from(linha.b64, "base64");
    const inline = req.query.inline === "1" && podeVisualizarNoNavegador(linha.mime);
    res.setHeader("Content-Type", inline || !temOffset ? linha.mime : "application/octet-stream");
    res.setHeader("Content-Length", String(corpo.length));
    res.setHeader("Content-Disposition", contentDisposition(linha.original_name, inline));
    res.setHeader("X-Document-Size", String(linha.size_bytes));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.end(corpo);
  } catch (error) {
    console.error("[usuario-documentos] leitura:", error instanceof Error ? error.message : "falha");
    return res.status(500).json({ error: "Erro ao carregar o documento." });
  }
});

export default rotas;
