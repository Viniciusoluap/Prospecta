// EPIC-025 (Dolores, etapa 3) — criar_tarefa (DIRETO: prompt mestre, seção 5 — "Criar tarefa … execução direta, com
// registro"). Mesmas regras da tela de Tarefas (`tasks.create` em server/routers.ts): responsável só admin/colaborador
// ativo (`getAssignableUserById`/`getAssignableUsers`), vínculo de cliente só com lead não excluído nem rejeitado
// (`getAssignableLeadById`), obra existente (`getProjectById`), gravação por `createTask`. Reversível: a equipe conclui,
// cancela ou edita a tarefa na tela. Nunca exclui nada.
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { tasks } from "../../../drizzle/schema.js";
import { lerPrazo } from "../../../shared/dolores/fila.js";
import { diaFortaleza, isoFortaleza } from "../../../shared/dolores/formato.js";
import { sanitizarTexto } from "../../../shared/dolores/sanitizar.js";
import { createTask, getAssignableLeadById, getAssignableUsers, getProjectById } from "../../db.js";
import { bancoDaAcao } from "../escrita.js";
import { MARCA_DOLORES, RecusaAcao, registrarAutoria, type ContextoAcao, type ResultadoAcao } from "./comum.js";

const PRIORIDADE = { baixa: "low", media: "medium", alta: "high", critica: "critical" } as const;
const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export const entradaCriarTarefa = z.object({
  titulo: z.string().trim().min(3).max(200).describe("O que precisa ser feito (frase curta)."),
  descricao: z.string().trim().max(1000).optional().describe("Detalhes, se o dono deu."),
  responsavel: z.string().trim().min(2).max(100).describe("Nome do responsável (administrador ou colaborador ativo), como o dono disse."),
  prazo: z.string().trim().max(16).optional().describe("AAAA-MM-DD (vale às 18:00) ou AAAA-MM-DDTHH:MM, horário de Imperatriz; de hoje a 1 ano."),
  prioridade: z.enum(["baixa", "media", "alta", "critica"]).default("media"),
  vinculo: z.object({
    tipo: z.enum(["cliente", "obra"]),
    id: z.number().int().positive().max(2_147_483_647),
  }).strict().optional().describe("Cliente do CRM (leadId) ou obra (obraId) a que a tarefa se refere."),
}).strict();

/** Responsável pelo nome: exato primeiro; senão, um único que contenha o texto. Ambíguo ou ninguém → recusa com a lista. */
async function resolverResponsavel(nome: string) {
  const todos = (await getAssignableUsers(bancoDaAcao())).filter(u => u.name?.trim());
  const alvo = sem(nome);
  const exatos = todos.filter(u => sem(u.name!) === alvo);
  const candidatos = exatos.length ? exatos : todos.filter(u => sem(u.name!).includes(alvo));
  if (candidatos.length === 1) return candidatos[0];
  const nomes = (candidatos.length ? candidatos : todos).slice(0, 12).map(u => u.name).join(", ");
  throw new RecusaAcao(candidatos.length
    ? `Mais de um responsável combina com "${nome.slice(0, 40)}": ${nomes}. Diga qual.`
    : `Ninguém ativo da equipe (administrador ou colaborador) com o nome "${nome.slice(0, 40)}". Possíveis: ${nomes || "nenhum"}.`);
}

export async function criarTarefa(args: z.infer<typeof entradaCriarTarefa>, ctx: ContextoAcao): Promise<ResultadoAcao> {
  const tx = bancoDaAcao();
  const responsavel = await resolverResponsavel(args.responsavel);
  let dueAt: Date | undefined;
  if (args.prazo) {
    const p = lerPrazo(args.prazo, ctx.agora);
    if (!p.ok) throw new RecusaAcao(`Prazo inválido: ${p.motivo}.`);
    dueAt = p.data;
  }
  let relatedType: "lead" | "obra" | "general" = "general";
  let relatedId: number | undefined;
  let vinculo = "sem vínculo";
  if (args.vinculo?.tipo === "cliente") {
    const lead = await getAssignableLeadById(args.vinculo.id, tx);
    if (!lead) throw new RecusaAcao(`Cliente ${args.vinculo.id} não encontrado no CRM (ou excluído/rejeitado).`);
    relatedType = "lead"; relatedId = lead.id; vinculo = `cliente ${lead.name}`;
  } else if (args.vinculo?.tipo === "obra") {
    const obra = await getProjectById(args.vinculo.id, tx);
    if (!obra) throw new RecusaAcao(`Obra ${args.vinculo.id} não encontrada.`);
    relatedType = "obra"; relatedId = obra.id; vinculo = `obra ${obra.title}`;
  }
  const titulo = sanitizarTexto(args.titulo).slice(0, 200);
  // Pedido repetido (o modelo chamou duas vezes, o dono mandou de novo): a tarefa aberta igual é devolvida, sem duplicar.
  const [igual] = await tx.select({ id: tasks.id }).from(tasks).where(and(
    sql`lower(${tasks.title}) = ${titulo.toLowerCase()}`, inArray(tasks.status, ["pending", "in_progress"]),
    relatedId ? and(eq(tasks.relatedType, relatedType), eq(tasks.relatedId, relatedId)) : isNull(tasks.relatedId),
  )).limit(1);
  if (igual) {
    return { dados: { tarefaId: igual.id, jaExistia: true, mensagem: "Já existe uma tarefa aberta igual; nada foi criado." }, resumo: { criada: false, jaExistia: true } };
  }
  const descricao = [args.descricao ? sanitizarTexto(args.descricao) : null, `— Criada por ${MARCA_DOLORES} a pedido do dono.`].filter(Boolean).join("\n\n");
  const criada = await createTask({
    title: titulo, description: descricao, assignedTo: responsavel.name || `Usuário #${responsavel.id}`,
    relatedType, relatedId, priority: PRIORIDADE[args.prioridade], status: "pending", dueAt,
  }, tx);
  const prazoTexto = dueAt ? diaFortaleza(dueAt)!.split("-").reverse().join("/") : "sem prazo";
  const frase = `Tarefa #${criada.id} "${titulo.slice(0, 80)}" para ${responsavel.name} (${prazoTexto}; ${vinculo})`;
  await registrarAutoria(ctx, { tabela: "tasks", registroId: criada.id, funcao: "criar_tarefa", descricao: frase });
  return {
    dados: { tarefaId: criada.id, responsavel: responsavel.name, prazo: isoFortaleza(dueAt), prioridade: args.prioridade, vinculo },
    resumo: { criada: true, tarefaId: criada.id, comPrazo: Boolean(dueAt), vinculo: relatedType },
    feitos: [frase],
  };
}
