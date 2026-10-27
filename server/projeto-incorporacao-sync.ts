// Lote 2, correção 07 (AD-07): Incorporação › Projeto Aprovado ↔ módulo Projetos.
// Regras puras e mapeamento documentado em shared/incorporacao/projeto-sincronizacao.ts.
// Mesmo comportamento no Grupo Santa Fé (web/src/lib/projeto-incorporacao-sync.ts).
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { incorporationStudies, operationalProjects as projects, users } from "../drizzle/schema.js";
import type { ProcessoAprovacao } from "../shared/incorporacao/aprovacao-projeto.js";
import {
  STATUS_INTERNO_INICIAL,
  STATUS_INTERNO_PROCESSO_EXCLUIDO,
  TIPOS_POR_ORGAO,
  lerProcessosAprovacao,
  nomeProjetoDoProcesso,
  normalizarProcessos,
  notaProcessoExcluido,
  planejarSincronizacao,
  processoComDadosDoProjeto,
  statusInternoAposSituacaoExterna,
} from "../shared/incorporacao/projeto-sincronizacao.js";
import { projectChecklist } from "../shared/projeto-documentos.js";
import { PROJECT_TYPE_LABELS } from "../shared/operacional.js";
import { diaPrazoProjeto, persistirDiaPrazoProjeto } from "../shared/projetos-prazo.js";
import { requireModule } from "./_core/rbac.js";
import { protectedProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";
import { listarEngenheiros } from "./usuario-documentos.js";

const badRequest = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });

/** Engenheiro escolhido no processo = colaborador/admin ativo; o nome exibido vem do cadastro. */
async function resolverEngenheiros(processos: ProcessoAprovacao[]): Promise<ProcessoAprovacao[]> {
  const ids = Array.from(new Set(processos.flatMap((p) => (p.engenheiroId ? [p.engenheiroId] : []))));
  const validos = new Map<number, string>();
  if (ids.length) {
    const linhas = await getDb().select({ id: users.id, name: users.name, role: users.role, active: users.active })
      .from(users).where(inArray(users.id, ids));
    for (const u of linhas) if (u.active && ["colaborador", "admin"].includes(u.role)) validos.set(u.id, u.name ?? "");
  }
  return processos.map((p) => {
    if (!p.engenheiroId) return { ...p, engenheiro: undefined, engenheiroRegistro: p.engenheiroRegistro };
    const nome = validos.get(p.engenheiroId);
    if (nome === undefined) throw badRequest("Escolha um colaborador ativo como engenheiro do processo.");
    return { ...p, engenheiro: nome || undefined };
  });
}

const prazo = (p: ProcessoAprovacao) => (p.prazoPrevisto ? persistirDiaPrazoProjeto(p.prazoPrevisto) : null);

function camposCompartilhados(p: ProcessoAprovacao) {
  return {
    approvalAuthority: p.orgao,
    approvalProtocol: p.numeroProtocolo ?? null,
    approvalStatus: p.status,
    approvalNotes: p.observacoes ?? null,
    deadline: prazo(p),
    engineerUserId: p.engenheiroId ?? null,
    engineer: p.engenheiro ?? "",
    engineerRegistration: p.engenheiroRegistro ?? null,
  };
}

export type VinculoProcesso = { processoId: string; projetoId: number; status: string };

/**
 * Salva a aba Projeto Aprovado e sincroniza o módulo Projetos: cria o projeto do
 * processo novo, atualiza o existente (upsert pela chave estudo+processo, nunca
 * duplica) e arquiva como cancelado o projeto do processo excluído.
 */
export async function salvarAprovacaoProjetoSincronizado(estudoId: number, dadosJson: string): Promise<{ vinculos: VinculoProcesso[] }> {
  let bruto: unknown;
  try { bruto = JSON.parse(dadosJson); } catch { throw badRequest("Dados do Projeto Aprovado inválidos."); }
  const lista = (bruto as { processos?: unknown })?.processos;
  if (!Array.isArray(lista)) throw badRequest("Dados do Projeto Aprovado inválidos.");
  if (lista.length > 100) throw badRequest("Cadastre no máximo 100 processos.");
  const processos = await resolverEngenheiros(normalizarProcessos(lista));

  const db = getDb();
  const [estudo] = await db.select({ id: incorporationStudies.id, name: incorporationStudies.name })
    .from(incorporationStudies).where(eq(incorporationStudies.id, estudoId)).limit(1);
  if (!estudo) throw new TRPCError({ code: "NOT_FOUND", message: "Estudo não encontrado." });

  await db.update(incorporationStudies)
    .set({ projectApprovalJson: JSON.stringify({ ...(bruto as object), processos }), updatedAt: new Date() })
    .where(eq(incorporationStudies.id, estudoId));

  const vinculados = await db.select().from(projects)
    .where(and(eq(projects.incorporationStudyId, estudoId), isNotNull(projects.approvalProcessId)));
  const plano = planejarSincronizacao(processos, vinculados);
  const agora = new Date();

  const atualizar = async (projeto: (typeof vinculados)[number], p: ProcessoAprovacao) => {
    const nomeAnterior = nomeProjetoDoProcesso(projeto.approvalAuthority ?? "", projeto.clientName);
    await db.update(projects).set({
      ...camposCompartilhados(p),
      // Nome e cliente acompanham o estudo/órgão enquanto não forem editados em Projetos.
      ...(projeto.name === nomeAnterior ? { name: nomeProjetoDoProcesso(p.orgao, estudo.name) } : {}),
      clientName: estudo.name,
      status: statusInternoAposSituacaoExterna(projeto.status, projeto.approvalStatus, p.status),
      updatedAt: agora,
    }).where(eq(projects.id, projeto.id));
  };

  for (const { processo, projeto } of plano.atualizar) await atualizar(projeto, processo);
  for (const p of plano.criar) {
    const tipos = TIPOS_POR_ORGAO[p.orgao] ?? [];
    const [criado] = await db.insert(projects).values({
      ...camposCompartilhados(p),
      name: nomeProjetoDoProcesso(p.orgao, estudo.name),
      types: JSON.stringify(tipos),
      status: STATUS_INTERNO_INICIAL,
      clientName: estudo.name,
      clientPhone: "",
      value: "0",
      paidValue: "0",
      leadId: null,
      description: "",
      checklist: JSON.stringify(projectChecklist(tipos, [], PROJECT_TYPE_LABELS)),
      files: "[]",
      incorporationStudyId: estudoId,
      approvalProcessId: p.id,
    }).onConflictDoNothing().returning({ id: projects.id });
    if (!criado) {
      // Outro salvamento simultâneo criou o mesmo processo: atualiza em vez de duplicar.
      const [existente] = await db.select().from(projects)
        .where(and(eq(projects.incorporationStudyId, estudoId), eq(projects.approvalProcessId, p.id))).limit(1);
      if (existente) await atualizar(existente, p);
    }
  }
  for (const projeto of plano.desvincular) {
    await db.update(projects).set({
      approvalProcessId: null,
      status: STATUS_INTERNO_PROCESSO_EXCLUIDO,
      approvalNotes: notaProcessoExcluido(projeto.approvalNotes, agora),
      updatedAt: agora,
    }).where(eq(projects.id, projeto.id));
  }
  return { vinculos: await vinculosDoEstudo(estudoId) };
}

export async function vinculosDoEstudo(estudoId: number): Promise<VinculoProcesso[]> {
  const linhas = await getDb().select({ id: projects.id, processoId: projects.approvalProcessId, status: projects.status })
    .from(projects).where(and(eq(projects.incorporationStudyId, estudoId), isNotNull(projects.approvalProcessId)));
  return linhas.map((l) => ({ processoId: l.processoId!, projetoId: l.id, status: l.status }));
}

/** Edição feita em Projetos → processo correspondente no estudo (dados compartilhados). */
export async function refletirProjetoNoEstudo(projetoId: number): Promise<void> {
  const db = getDb();
  const [projeto] = await db.select().from(projects).where(eq(projects.id, projetoId)).limit(1);
  if (!projeto?.incorporationStudyId || !projeto.approvalProcessId) return;
  const [estudo] = await db.select({ json: incorporationStudies.projectApprovalJson })
    .from(incorporationStudies).where(eq(incorporationStudies.id, projeto.incorporationStudyId)).limit(1);
  if (!estudo) return;
  const processos = lerProcessosAprovacao(estudo.json);
  if (!processos.some((p) => p.id === projeto.approvalProcessId)) return;
  const atualizados = processos.map((p) => p.id !== projeto.approvalProcessId ? p : processoComDadosDoProjeto(p, {
    approvalAuthority: projeto.approvalAuthority,
    approvalProtocol: projeto.approvalProtocol,
    approvalStatus: projeto.approvalStatus,
    approvalNotes: projeto.approvalNotes,
    deadlineDia: diaPrazoProjeto(projeto.deadline),
    engineerUserId: projeto.engineerUserId,
    engineer: projeto.engineer,
    engineerRegistration: projeto.engineerRegistration,
  }));
  await gravarProcessos(projeto.incorporationStudyId, estudo.json, atualizados);
}

/** Projeto excluído em Projetos → o processo sai do Projeto Aprovado (não renasce no próximo salvamento). */
export async function removerProcessoDoEstudo(vinculo: { incorporationStudyId: number | null; approvalProcessId: string | null }): Promise<void> {
  if (!vinculo.incorporationStudyId || !vinculo.approvalProcessId) return;
  const [estudo] = await getDb().select({ json: incorporationStudies.projectApprovalJson })
    .from(incorporationStudies).where(eq(incorporationStudies.id, vinculo.incorporationStudyId)).limit(1);
  if (!estudo) return;
  const processos = lerProcessosAprovacao(estudo.json);
  if (!processos.some((p) => p.id === vinculo.approvalProcessId)) return;
  await gravarProcessos(vinculo.incorporationStudyId, estudo.json, processos.filter((p) => p.id !== vinculo.approvalProcessId));
}

async function gravarProcessos(estudoId: number, jsonAnterior: string | null, processos: ProcessoAprovacao[]) {
  let base: object = {};
  try { const v = jsonAnterior ? JSON.parse(jsonAnterior) : {}; if (v && typeof v === "object") base = v; } catch { /* corrompido → só processos */ }
  await getDb().update(incorporationStudies)
    .set({ projectApprovalJson: JSON.stringify({ ...base, processos }), updatedAt: new Date() })
    .where(eq(incorporationStudies.id, estudoId));
}

/** Dados do vínculo antes de excluir um projeto (para remover o processo depois). */
export async function vinculoDoProjeto(projetoId: number) {
  const [r] = await getDb().select({ incorporationStudyId: projects.incorporationStudyId, approvalProcessId: projects.approvalProcessId })
    .from(projects).where(eq(projects.id, projetoId)).limit(1);
  return r ?? null;
}

const estudoInput = z.object({ estudoId: z.number().int().positive() });

/** Consultas da aba Projeto Aprovado (módulo Incorporação). */
export const projetoIncorporacaoRouter = router({
  /** Colaboradores/admins ativos com o perfil Engenheiro (CREA) quando houver — seletor da linha do processo. */
  engenheiros: protectedProcedure.query(async ({ ctx }) => {
    requireModule(ctx, "incorporacao");
    return listarEngenheiros();
  }),
  /** Projeto de cada processo (link "Abrir em Projetos" e andamento técnico). */
  vinculos: protectedProcedure.input(estudoInput).query(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    return vinculosDoEstudo(input.estudoId);
  }),
});
