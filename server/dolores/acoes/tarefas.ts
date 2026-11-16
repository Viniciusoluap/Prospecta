// EPIC-025 (Dolores, etapa 3) — criar_tarefa (DIRETO: prompt mestre, seção 5 — "Criar tarefa … execução direta, com
// registro"). Mesmas regras da tela de Tarefas (`tasks.create` em server/routers.ts): responsável só admin/colaborador
// ativo (`getAssignableUserById`/`getAssignableUsers`), vínculo de cliente só com lead não excluído nem rejeitado
// (`getAssignableLeadById`), obra existente (`getProjectById`), gravação por `createTask`. Reversível: a equipe conclui,
// cancela ou edita a tarefa na tela. Nunca exclui nada.
import { hash } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { tasks } from "../../../drizzle/schema.js";
import { avisoDaFila, lerPrazo, textoDeDado, umaLinha } from "../../../shared/dolores/fila.js";
import { diaFortaleza, isoFortaleza } from "../../../shared/dolores/formato.js";
import { sanitizarTexto } from "../../../shared/dolores/sanitizar.js";
import { createTask, getAssignableLeadById, getAssignableUsers, getProjectById } from "../../db.js";
import { bancoDaAcao } from "../escrita.js";
import { MARCA_DOLORES, RecusaAcao, registrarAutoria, type ContextoAcao, type ItemParaFila, type ResultadoAcao } from "./comum.js";

/** Título da tarefa: uma linha, sem caracteres de controle, até 150 caracteres (HTML fica como texto: a tela escapa). */
const MAX_TITULO = 150;
const PRIORIDADE = { baixa: "low", media: "medium", alta: "high", critica: "critical" } as const;
const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export const entradaCriarTarefa = z.object({
  titulo: z.string().trim().min(3).max(MAX_TITULO).describe("O que precisa ser feito (frase curta, até 150 caracteres)."),
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
  // QA R2 N2: os nomes vêm do banco (o próprio colaborador edita o dele): cada um vai cortado numa linha de até 60
  // caracteres e a recusa CONTAMINA o comando — depois dela, ação direta só pela fila.
  const nomes = (candidatos.length ? candidatos : todos).slice(0, 12).map(u => textoDeDado(u.name, 60)).join(", ");
  throw new RecusaAcao(candidatos.length
    ? `Mais de um responsável combina com "${textoDeDado(nome, 40)}": ${nomes}. Diga qual.`
    : `Ninguém ativo da equipe (administrador ou colaborador) com o nome "${textoDeDado(nome, 40)}". Possíveis: ${nomes || "nenhum"}.`, { comDados: true });
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
  const titulo = umaLinha(sanitizarTexto(args.titulo), MAX_TITULO);
  if (titulo.length < 3) throw new RecusaAcao("Título da tarefa vazio depois de limpar caracteres inválidos.");
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
  const frase = textoDeDado(`Tarefa #${criada.id} "${titulo.slice(0, 80)}" para ${responsavel.name} (${prazoTexto}; ${vinculo})`, 300);
  await registrarAutoria(ctx, { tabela: "tasks", registroId: criada.id, funcao: "criar_tarefa", descricao: frase });
  return {
    // QA R2 N2: ao modelo vão só ids, datas e códigos do sistema — nenhum texto do banco (o nome do responsável e o do
    // cliente/obra aparecem para o dono no quadro "Registrado no sistema por mim", montado pelo sistema).
    dados: { tarefaId: criada.id, responsavelId: responsavel.id, prazo: isoFortaleza(dueAt), prioridade: args.prioridade, vinculo: relatedId ? `${args.vinculo!.tipo} ${relatedId}` : "sem vínculo" },
    resumo: { criada: true, tarefaId: criada.id, comPrazo: Boolean(dueAt), vinculo: relatedType },
    feitos: [frase],
  };
}

/**
 * Pedido de tarefa que surgiu DEPOIS de o comando ler dados (regra de contaminação): não grava nada; devolve o item da
 * fila com o resumo legível (o que será criado, para quem, prazo e vínculo). Aprovado, `criarTarefa` roda com as mesmas
 * conferências (responsável, prazo, vínculo, repetição) na hora da aprovação.
 */
export async function tarefaParaFila(args: z.infer<typeof entradaCriarTarefa>, ctx: ContextoAcao): Promise<ItemParaFila> {
  if (args.prazo) {
    const p = lerPrazo(args.prazo, ctx.agora);
    if (!p.ok) throw new RecusaAcao(`Prazo inválido: ${p.motivo}.`);
  }
  const titulo = umaLinha(sanitizarTexto(args.titulo), MAX_TITULO);
  const partes = [
    `para ${umaLinha(args.responsavel, 60)}`,
    args.prazo ? `prazo ${args.prazo.replace("T", " ")}` : "sem prazo",
    `prioridade ${args.prioridade}`,
    args.vinculo ? `ligada ao ${args.vinculo.tipo} ${args.vinculo.id}` : "sem vínculo",
  ];
  const resumo = textoDeDado(`${avisoDaFila(ctx.motivoContaminacao)} criar a tarefa "${titulo}" ${partes.join(", ")}.`, 600);
  return { alvo: alvoDoPedido("tarefa", [titulo.toLowerCase(), sem(args.responsavel), args.vinculo?.tipo ?? "", args.vinculo?.id ?? ""]), resumo, argumentos: args };
}

/** Alvo do item (o mesmo pedido não fica duas vezes aguardando): função + resumo do conteúdo. */
export function alvoDoPedido(prefixo: string, partes: unknown[]): string {
  return `${prefixo}:${hash("sha256", JSON.stringify(partes)).slice(0, 24)}`;
}
