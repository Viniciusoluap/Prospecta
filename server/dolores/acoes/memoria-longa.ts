// EPIC-027 C5 (memória de longo prazo) — o dono pede, na conversa direta dele, para a Dolores LEMBRAR, CORRIGIR ou ESQUECER um fato
// permanente. As três são de FILA e de nível "registro": aqui só se confere e se monta o resumo exato (nada é gravado); a gravação roda
// depois do "pode" dele (proposta da E2, server/dolores/pendencia.ts) e só se a decisão veio do WhatsApp dele (`ctx.via`).
//
// Nunca por inferência, nunca a partir de dado: o preparo RECUSA se a mensagem do dono que originou o pedido não pede memória por
// código (`ctx.pedidoDeMemoria`, montado por cerebro.ts só quando a mensagem dele diz "lembra que…", "guarda isso", "a partir de
// agora…", "esquece que…", "corrige…", sem texto colado, sem anexo, não encaminhada) e se o texto não veio das palavras dele
// (`veioDasPalavrasDoDono`: um texto tirado de consulta, grupo, cliente ou documento não vira memória). Grupo e cliente não têm estas
// ferramentas (laços próprios). Texto: server/dolores/memoria-longa.ts#textoDaMemoria (recusa segredo/link; mascara CPF/telefone/e-mail).
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { constructionProjects, leads } from "../../../drizzle/schema.js";
import { CATEGORIAS_MEMORIA, MAX_MEMORIAS_ATIVAS, MAX_TEXTO_MEMORIA, ROTULO_CATEGORIA_MEMORIA, veioDasPalavrasDoDono, type CategoriaMemoria } from "../../../shared/dolores/memoria-longa.js";
import { prefixoDaFila } from "../../../shared/dolores/fila.js";
import { bancoDaAcao, emTransacaoDeEscrita } from "../escrita.js";
import {
  FRASE_MEMORIA_CHEIA, atualizarMemoria, auditarMemoria, contarAtivas, inserirMemoria, lerMemoria, memoriaIgualAtiva, mudarSituacao, textoDaMemoria,
} from "../memoria-longa.js";
import { bancoDaLeitura, emTransacaoSomenteLeitura } from "../somente-leitura.js";
import { RecusaAcao, conferirMostrado, registrarAutoria, resumoDaFila, type ContextoAcao, type Preparo, type ResultadoAcao } from "./comum.js";
import { mostrar } from "./grupos.js";
import { alvoDoPedido } from "./tarefas.js";

const id32 = z.number().int().positive().max(2_147_483_647);
const textoEntrada = z.string().trim().min(3).max(MAX_TEXTO_MEMORIA);

export const entradaGuardarMemoria = z.object({
  texto: textoEntrada.describe("O fato, curto, com as palavras do dono (ex.: \"Prefere resumo das obras às segundas de manhã\")."),
  categoria: z.enum(CATEGORIAS_MEMORIA).describe("preferencia_dono, fato_negocio, regra_trabalho ou pessoa."),
  leadId: id32.optional().describe("Cliente do CRM a que o fato se refere (opcional)."),
  obraId: id32.optional().describe("Obra a que o fato se refere (opcional; nunca junto com leadId)."),
}).strict();
export const entradaCorrigirMemoria = z.object({
  memoriaId: id32.describe("O número N do item mN da memória."),
  texto: textoEntrada.describe("O texto novo, com as palavras do dono."),
  categoria: z.enum(CATEGORIAS_MEMORIA).optional(),
}).strict();
export const entradaEsquecerMemoria = z.object({ memoriaId: id32.describe("O número N do item mN da memória.") }).strict();

const categoria = z.enum(CATEGORIAS_MEMORIA);
const idOuNulo = id32.nullable();
export const entradaGuardarAprovado = z.object({ texto: z.string().max(MAX_TEXTO_MEMORIA), categoria, leadId: idOuNulo, obraId: idOuNulo }).strict();
export const entradaCorrigirAprovado = z.object({ memoriaId: id32, texto: z.string().max(MAX_TEXTO_MEMORIA), categoria, antes: z.string().max(MAX_TEXTO_MEMORIA) }).strict();
export const entradaEsquecerAprovado = z.object({ memoriaId: id32, antes: z.string().max(MAX_TEXTO_MEMORIA) }).strict();

export const FRASE_MEMORIA_SO_DO_DONO = "Só guardo, corrijo ou esqueço na memória o que você me pede com as suas palavras, numa mensagem direta (\"lembra que…\", \"guarda isso…\", \"esquece que…\"), sem texto colado nem encaminhado. Nada foi mudado.";
export const FRASE_MEMORIA_NAO_E_DO_DONO = "O texto a guardar precisa sair das suas palavras nesta mensagem (não guardo o que li numa consulta, num grupo ou num documento). Diga com as suas palavras o que devo lembrar. Nada foi guardado.";
const FRASE_SO_PELO_WHATSAPP = "A memória pela conversa vale só com a sua resposta no WhatsApp; pela tela, use Integrações › Memória da Dolores. Nada mudou.";

const soPeloWhatsapp = (ctx: ContextoAcao) => { if (ctx.via !== "whatsapp") throw new RecusaAcao(FRASE_SO_PELO_WHATSAPP); };
/** O pedido veio da mensagem do dono pedindo memória (por código, em cerebro.ts)? Senão, nada. */
function mensagemDoDono(ctx: ContextoAcao): string {
  const t = ctx.pedidoDeMemoria?.texto;
  if (typeof t !== "string" || !t.trim()) throw new RecusaAcao(FRASE_MEMORIA_SO_DO_DONO);
  return t;
}
const texto = (bruto: string) => {
  const r = textoDaMemoria(bruto);
  if (!r.ok) throw new RecusaAcao(`${r.motivo} Nada foi guardado.`);
  return r;
};
const aspas = (t: string) => `"${t}"`;
const AVISO_MASCARA = " (CPF, telefone e e-mail ficam mascarados na memória)";

/** O nome do cliente/obra do vínculo (lido do banco, só leitura) — conta como palavra do dono na conferência. */
async function vinculo(leadId: number | null, obraId: number | null): Promise<{ texto: string; nome: string | null }> {
  if (leadId && obraId) throw new RecusaAcao("Uma lembrança fica ligada a um cliente OU a uma obra, não aos dois. Nada foi guardado.");
  if (leadId) {
    const [l] = await emTransacaoSomenteLeitura(() => bancoDaLeitura().select({ id: leads.id, nome: leads.name }).from(leads).where(and(eq(leads.id, leadId), isNull(leads.deletedAt))).limit(1));
    if (!l) throw new RecusaAcao(`Não achei o cliente ${leadId} no CRM (ou ele foi excluído). Nada foi guardado.`);
    return { texto: `, sobre o cliente «${mostrar(l.nome, 60, `cliente ${l.id}`)}» (cliente nº ${l.id})`, nome: l.nome };
  }
  if (obraId) {
    const [o] = await emTransacaoSomenteLeitura(() => bancoDaLeitura().select({ id: constructionProjects.id, titulo: constructionProjects.title }).from(constructionProjects).where(eq(constructionProjects.id, obraId)).limit(1));
    if (!o) throw new RecusaAcao(`Não achei a obra ${obraId}. Nada foi guardado.`);
    return { texto: `, sobre a obra «${mostrar(o.titulo, 60, `obra ${o.id}`)}» (obra nº ${o.id})`, nome: o.titulo };
  }
  return { texto: "", nome: null };
}
const lerAtiva = async (id: number) => {
  const m = await emTransacaoSomenteLeitura(() => lerMemoria(id, bancoDaLeitura()));
  if (!m || m.situacao !== "ativa") throw new RecusaAcao(`Não achei a lembrança ${id} entre as ativas da memória. Nada foi mudado.`);
  return m;
};

export async function prepararGuardarMemoria(args: z.infer<typeof entradaGuardarMemoria>, ctx: ContextoAcao): Promise<Preparo> {
  const doDono = mensagemDoDono(ctx);
  const t = texto(args.texto);
  const leadId = args.leadId ?? null;
  const obraId = args.obraId ?? null;
  const v = await vinculo(leadId, obraId);
  if (!veioDasPalavrasDoDono(t.texto, doDono, v.nome ? [v.nome] : [])) throw new RecusaAcao(FRASE_MEMORIA_NAO_E_DO_DONO);
  const [igual, ativas] = await emTransacaoSomenteLeitura(async () => [await memoriaIgualAtiva(t.texto, bancoDaLeitura()), await contarAtivas(bancoDaLeitura())] as const);
  if (igual) throw new RecusaAcao("Isso já está guardado na memória; nada a mudar.");
  if (ativas >= MAX_MEMORIAS_ATIVAS) throw new RecusaAcao(FRASE_MEMORIA_CHEIA);
  const resumo = resumoDaFila(`${prefixoDaFila(ctx.motivoContaminacao)}guardar na memória (${ROTULO_CATEGORIA_MEMORIA[args.categoria]}${v.texto}): ${aspas(t.texto)}${t.mascarou ? AVISO_MASCARA : ""}`, [aspas(t.texto)]);
  return { itens: [{ alvo: alvoDoPedido("memoria", [t.texto.toLowerCase()]), resumo, argumentos: { texto: t.texto, categoria: args.categoria, leadId, obraId } }], recusados: [] };
}

export async function executarGuardarAprovado(args: z.infer<typeof entradaGuardarAprovado>, ctx: ContextoAcao): Promise<ResultadoAcao> {
  soPeloWhatsapp(ctx);
  const t = texto(args.texto);
  if (t.texto !== args.texto) throw new RecusaAcao("O texto não é exatamente o que foi mostrado; nada foi guardado. Peça de novo.");
  conferirMostrado(ctx, [aspas(t.texto)]);
  const m = await emTransacaoDeEscrita(async () => {
    const db = bancoDaAcao();
    if (await memoriaIgualAtiva(t.texto, db)) throw new RecusaAcao("Isso já está guardado na memória; não repeti.");
    if ((await contarAtivas(db)) >= MAX_MEMORIAS_ATIVAS) throw new RecusaAcao(FRASE_MEMORIA_CHEIA);
    const nova = await inserirMemoria({ texto: t.texto, categoria: args.categoria as CategoriaMemoria, leadId: args.leadId, obraId: args.obraId, origem: "conversa",
      autor: ctx.autorId, mensagemId: ctx.mensagemId, agora: ctx.agora }, db);
    await registrarAutoria(ctx, { tabela: "dolores_memoria_longa", registroId: nova.id, funcao: "guardar_memoria", descricao: `memória ${nova.id} (${args.categoria})` });
    return nova;
  });
  await auditarMemoria({ resultado: "ok", motivo: "guardada pela conversa do dono", canal: "whatsapp", autor: ctx.autorId, memoriaId: m.id, resumo: { operacao: "criar", origem: "conversa", categoria: m.categoria } });
  return { dados: { memoriaId: m.id }, resumo: { memoriaId: m.id, categoria: m.categoria }, feitos: [`guardei na memória: ${aspas(t.texto)}`] };
}

export async function prepararCorrigirMemoria(args: z.infer<typeof entradaCorrigirMemoria>, ctx: ContextoAcao): Promise<Preparo> {
  const doDono = mensagemDoDono(ctx);
  const m = await lerAtiva(args.memoriaId);
  const t = texto(args.texto);
  const cat = (args.categoria ?? m.categoria) as CategoriaMemoria;
  const v = await vinculo(m.leadId, m.obraId);
  if (t.texto === m.texto && cat === m.categoria) throw new RecusaAcao("A lembrança já está assim; nada a mudar.");
  if (!veioDasPalavrasDoDono(t.texto, doDono, [m.texto, ...(v.nome ? [v.nome] : [])])) throw new RecusaAcao(FRASE_MEMORIA_NAO_E_DO_DONO);
  const resumo = resumoDaFila(`${prefixoDaFila(ctx.motivoContaminacao)}corrigir a memória (${ROTULO_CATEGORIA_MEMORIA[cat]}${v.texto}) — hoje: ${aspas(m.texto)} → passa a ser: ${aspas(t.texto)}${t.mascarou ? AVISO_MASCARA : ""}`, [aspas(t.texto), aspas(m.texto)]);
  return { itens: [{ alvo: `memoria:${m.id}:corrigir`, resumo, argumentos: { memoriaId: m.id, texto: t.texto, categoria: cat, antes: m.texto } }], recusados: [] };
}

export async function executarCorrigirAprovado(args: z.infer<typeof entradaCorrigirAprovado>, ctx: ContextoAcao): Promise<ResultadoAcao> {
  soPeloWhatsapp(ctx);
  const t = texto(args.texto);
  if (t.texto !== args.texto) throw new RecusaAcao("O texto não é exatamente o que foi mostrado; nada mudou. Peça de novo.");
  conferirMostrado(ctx, [aspas(t.texto)]);
  await emTransacaoDeEscrita(async () => {
    const db = bancoDaAcao();
    const m = await lerMemoria(args.memoriaId, db);
    if (!m || m.situacao !== "ativa" || m.texto !== args.antes) throw new RecusaAcao("A lembrança mudou (ou foi arquivada) depois da proposta; nada mudou. Peça de novo.");
    if (await memoriaIgualAtiva(t.texto, db, m.id)) throw new RecusaAcao("Já existe outra lembrança com esse mesmo texto; nada mudou.");
    if (!(await atualizarMemoria(m.id, { texto: t.texto, categoria: args.categoria as CategoriaMemoria, leadId: m.leadId, obraId: m.obraId, por: ctx.autorId, agora: ctx.agora, antes: args.antes }, db))) {
      throw new RecusaAcao("A lembrança mudou depois da proposta; nada mudou. Peça de novo.");
    }
    await registrarAutoria(ctx, { tabela: "dolores_memoria_longa", registroId: m.id, funcao: "corrigir_memoria", descricao: `memória ${m.id} corrigida` });
  });
  await auditarMemoria({ resultado: "ok", motivo: "corrigida pela conversa do dono", canal: "whatsapp", autor: ctx.autorId, memoriaId: args.memoriaId, resumo: { operacao: "editar", origem: "conversa", categoria: args.categoria } });
  return { dados: { memoriaId: args.memoriaId }, resumo: { memoriaId: args.memoriaId, corrigida: true }, feitos: [`corrigi a memória: agora é ${aspas(t.texto)}`] };
}

export async function prepararEsquecerMemoria(args: z.infer<typeof entradaEsquecerMemoria>, ctx: ContextoAcao): Promise<Preparo> {
  mensagemDoDono(ctx);
  const m = await lerAtiva(args.memoriaId);
  const resumo = resumoDaFila(`${prefixoDaFila(ctx.motivoContaminacao)}esquecer (arquivar) a lembrança ${aspas(m.texto)} — sai da memória que eu uso; dá para restaurar na tela`, [aspas(m.texto)]);
  return { itens: [{ alvo: `memoria:${m.id}:esquecer`, resumo, argumentos: { memoriaId: m.id, antes: m.texto } }], recusados: [] };
}

export async function executarEsquecerAprovado(args: z.infer<typeof entradaEsquecerAprovado>, ctx: ContextoAcao): Promise<ResultadoAcao> {
  soPeloWhatsapp(ctx);
  conferirMostrado(ctx, [aspas(args.antes)]);
  await emTransacaoDeEscrita(async () => {
    const db = bancoDaAcao();
    if (!(await mudarSituacao(args.memoriaId, "arquivada", { por: ctx.autorId, agora: ctx.agora, antes: args.antes }, db))) {
      throw new RecusaAcao("A lembrança mudou (ou já foi arquivada) depois da proposta; nada mudou.");
    }
    await registrarAutoria(ctx, { tabela: "dolores_memoria_longa", registroId: args.memoriaId, funcao: "esquecer_memoria", descricao: `memória ${args.memoriaId} arquivada` });
  });
  await auditarMemoria({ resultado: "ok", motivo: "arquivada pela conversa do dono", canal: "whatsapp", autor: ctx.autorId, memoriaId: args.memoriaId, resumo: { operacao: "arquivar", origem: "conversa" } });
  return { dados: { memoriaId: args.memoriaId }, resumo: { memoriaId: args.memoriaId, arquivada: true }, feitos: [`esqueci: ${aspas(args.antes)}`] };
}
