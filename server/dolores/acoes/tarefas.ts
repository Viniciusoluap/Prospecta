// EPIC-025 (Dolores, etapa 3) — criar_tarefa (DIRETO: prompt mestre, seção 5 — "Criar tarefa … execução direta, com
// registro"). Mesmas regras da tela de Tarefas (`tasks.create` em server/routers.ts): responsável só admin/colaborador
// ativo (`getAssignableUserById`/`getAssignableUsers`), vínculo de cliente só com lead não excluído nem rejeitado
// (`getAssignableLeadById`), obra existente (`getProjectById`), gravação por `createTask`. Reversível: a equipe conclui,
// cancela ou edita a tarefa na tela. Nunca exclui nada.
import { hash } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { tasks } from "../../../drizzle/schema.js";
import { prefixoDaFila, lerPrazo, textoDeDado, umaLinha } from "../../../shared/dolores/fila.js";
import { diaFortaleza, isoFortaleza } from "../../../shared/dolores/formato.js";
import { createTask, getAssignableLeadById, getAssignableUsers, getProjectById } from "../../db.js";
import { bancoDaAcao } from "../escrita.js";
import { bancoDaLeitura, emTransacaoSomenteLeitura } from "../somente-leitura.js";
import {
  FRASE_TEXTO_LONGO, MARCA_DOLORES, RecusaAcao, comoMostrado, conferirMostrado, registrarAutoria, resumoDaFila, textoDoDono, type ContextoAcao, type ItemParaFila, type ResultadoAcao,
} from "./comum.js";

/** Título da tarefa: uma linha, sem caracteres de controle, até 150 caracteres (HTML fica como texto: a tela escapa). */
const MAX_TITULO = 150;
/** O título em uma linha, INTEIRO: passou de 150 caracteres → recusa (EPIC-025 E11 portão 5, I-2: nunca corta em silêncio). */
function tituloInteiro(bruto: string): string {
  const t = umaLinha(textoDoDono(bruto), MAX_TITULO + 1);
  if (t.length > MAX_TITULO) throw new RecusaAcao(`O texto da tarefa passa de ${MAX_TITULO} caracteres. Encurte, ou mande o resto como descrição. Nada foi criado.`);
  return t;
}
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
async function resolverResponsavel(nome: string, db = bancoDaAcao()) {
  const todos = (await getAssignableUsers(db)).filter(u => u.name?.trim());
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
  // EPIC-025 E11 portão 5 (I-2): acima do limite, recusa — o título nunca é cortado em silêncio
  const titulo = tituloInteiro(args.titulo);
  if (titulo.length < 3) throw new RecusaAcao("Título da tarefa vazio depois de limpar caracteres inválidos.");
  const descricaoDoDono = args.descricao ? textoDoDono(args.descricao) : null;
  // item aprovado da fila (QA R2 N3): título, responsável e descrição gravados têm de ser os que o dono leu no resumo
  conferirMostrado(ctx, [`criar a tarefa "${titulo}" para ${responsavel.name ?? ""}, `, ...(descricaoDoDono ? [`, descrição: "${descricaoDoDono}".`] : [])]);
  // Pedido repetido (o modelo chamou duas vezes, o dono mandou de novo): a tarefa aberta igual é devolvida, sem duplicar.
  const [igual] = await tx.select({ id: tasks.id }).from(tasks).where(and(
    sql`lower(${tasks.title}) = ${titulo.toLowerCase()}`, inArray(tasks.status, ["pending", "in_progress"]),
    relatedId ? and(eq(tasks.relatedType, relatedType), eq(tasks.relatedId, relatedId)) : isNull(tasks.relatedId),
  )).limit(1);
  if (igual) {
    return { dados: { tarefaId: igual.id, jaExistia: true, mensagem: "Já existe uma tarefa aberta igual; nada foi criado." }, resumo: { criada: false, jaExistia: true } };
  }
  const descricao = [descricaoDoDono, `— Criada por ${MARCA_DOLORES} a pedido do dono.`].filter(Boolean).join("\n\n");
  const criada = await createTask({
    title: titulo, description: descricao, assignedTo: responsavel.name || `Usuário #${responsavel.id}`,
    relatedType, relatedId, priority: PRIORIDADE[args.prioridade], status: "pending", dueAt,
  }, tx);
  const prazoTexto = dueAt ? diaFortaleza(dueAt)!.split("-").reverse().join("/") : "sem prazo";
  // EPIC-025 E11 portão 5 (I-2): o título inteiro (até 150) na linha do que foi feito — nunca cortado em silêncio
  const frase = textoDeDado(`Tarefa #${criada.id} "${titulo}" para ${responsavel.name} (${prazoTexto}; ${vinculo})`, 400);
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
 * Pedido de tarefa que surgiu DEPOIS de o comando ler dados ou numa mensagem com texto colado (regra de contaminação): não
 * grava nada; devolve o item da fila com o resumo que mostra ao dono TUDO o que será gravado (QA R2 N3): título,
 * responsável (já conferido na equipe), prazo, prioridade, vínculo e a descrição inteira. Os argumentos guardados são os
 * textos na forma mostrada; aprovado, `criarTarefa` roda com as mesmas conferências e confere que grava o que foi mostrado.
 * Não cabe no resumo → recusa (nunca corta em silêncio).
 */
export async function tarefaParaFila(args: z.infer<typeof entradaCriarTarefa>, ctx: ContextoAcao): Promise<ItemParaFila> {
  if (args.prazo) {
    const p = lerPrazo(args.prazo, ctx.agora);
    if (!p.ok) throw new RecusaAcao(`Prazo inválido: ${p.motivo}.`);
  }
  const titulo = comoMostrado(tituloInteiro(args.titulo));
  const descricao = args.descricao ? comoMostrado(textoDoDono(args.descricao)) : null;
  if (titulo.length > MAX_TITULO || (descricao?.length ?? 0) > 1000) throw new RecusaAcao(FRASE_TEXTO_LONGO);
  if (titulo.length < 3) throw new RecusaAcao("Título da tarefa vazio depois de limpar caracteres inválidos.");
  // o responsável é conferido JÁ (leitura): o dono lê o nome que será gravado
  const responsavel = await emTransacaoSomenteLeitura(() => resolverResponsavel(args.responsavel, bancoDaLeitura()));
  const nome = comoMostrado(responsavel.name);
  if (nome !== responsavel.name || nome.length > 100) {
    throw new RecusaAcao(`O nome do responsável (usuário ${responsavel.id}) tem formatação que não dá para mostrar exatamente; ajuste o cadastro em Usuários e acesso.`);
  }
  const partes = [
    `para ${nome}`,
    args.prazo ? `prazo ${args.prazo.replace("T", " ")}` : "sem prazo",
    `prioridade ${args.prioridade}`,
    args.vinculo ? `ligada ao ${args.vinculo.tipo} ${args.vinculo.id}` : "sem vínculo",
    ...(descricao ? [`descrição: "${descricao}"`] : []),
  ];
  const resumo = resumoDaFila(`${prefixoDaFila(ctx.motivoContaminacao)}criar a tarefa "${titulo}" ${partes.join(", ")}.`,
    [`criar a tarefa "${titulo}" para ${nome}, `, ...(descricao ? [`, descrição: "${descricao}".`] : [])]);
  const argumentos = { ...args, titulo, responsavel: nome, ...(descricao ? { descricao } : {}) };
  // QA R2 M4: a identidade do item é TODO o conteúdo — pedido com outra descrição, prazo ou prioridade é item novo (nunca
  // devolve o antigo como se fosse o novo); o mesmo pedido repetido continua devolvendo o código do que já aguarda
  return { alvo: alvoDoPedido("tarefa", [titulo.toLowerCase(), sem(nome), args.prazo ?? "", args.prioridade, args.vinculo?.tipo ?? "", args.vinculo?.id ?? "", descricao ?? ""]), resumo, argumentos };
}

/** Alvo do item (o mesmo pedido não fica duas vezes aguardando): função + resumo do conteúdo. */
export function alvoDoPedido(prefixo: string, partes: unknown[]): string {
  return `${prefixo}:${hash("sha256", JSON.stringify(partes)).slice(0, 24)}`;
}
