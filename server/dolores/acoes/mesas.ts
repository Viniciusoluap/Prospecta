// EPIC-027 C5 (criadora de mesas) — o dono pede uma função nova ("quero que você passe a fazer X", "cria uma mesa para acompanhar Y") e a
// Dolores escreve a PROPOSTA DE MESA; ela não programa nem passa a fazer nada sozinha. Quatro ações de FILA:
//   propor_mesa (registro, "pode") · revisar_mesa (registro: versão nova) · recusar_mesa (registro) · propor_aprovacao_mesa (SÉRIA, "confirmo").
// Aprovar NÃO liga nada: só muda a situação para "aprovada" e diz que agora depende da construção pelo time de desenvolvimento.
//
// Aqui só se confere e se monta o resumo exato (nada é gravado no preparo); a gravação roda depois da resposta do dono (pendencia.ts) e só
// se a decisão veio do WhatsApp dele (`ctx.via`). O preparo RECUSA se a mensagem do dono não pede aquilo por código (`ctx.pedidoDeMesa`,
// montado por cerebro.ts só sem colagem, sem anexo e não encaminhada). Grupo, cliente e a ponte HTTP não têm estas ferramentas. Tudo o
// que a IA cita como leitura/ação é conferido contra o registro real (nome inexistente → "precisa de função nova"); o resumo é do servidor.
import { z } from "zod";
import {
  FAIXAS_CUSTO, MAX_MESA, MAX_MESAS_ABERTAS, MAX_VERSOES_MESA, QUEM_APROVA, ROTULO_FAIXA_CUSTO, ROTULO_QUEM_APROVA, ROTULO_SITUACAO_MESA, SITUACOES_RECUSAVEIS,
  SITUACOES_REVISAVEIS, faltaNaProposta, normalizarMesa, situacaoDaProposta, type CatalogoDeCapacidades, type PropostaMesa, type SituacaoMesa, type TipoPedidoMesa,
} from "../../../shared/dolores/mesas.js";
import { ROTULO_CONSULTA } from "../../../shared/dolores/voz.js";
import { prefixoDaFila } from "../../../shared/dolores/fila.js";
import { bancoDaAcao, emTransacaoDeEscrita } from "../escrita.js";
import {
  FRASE_MESAS_CHEIAS, SEM_MIGRACAO_MESAS, auditarMesa, conferirProposta, contarAbertas, inserirMesa, inserirRevisao, lerMesa, lerVersao, mudarSituacaoMesa,
  pedidoOriginalFiltrado, revalidarProposta, semTabelaDasMesas, semearMesasIniciais, tituloIgualAberto,
} from "../mesas.js";
import { erroParaLog } from "../erro-seguro.js";
import { bancoDaLeitura, emTransacaoSomenteLeitura } from "../somente-leitura.js";
import { MAX_RESUMO_FILA, RecusaAcao, conferirMostrado, registrarAutoria, resumoDaFila, type ContextoAcao, type Preparo, type ResultadoAcao } from "./comum.js";
import { alvoDoPedido } from "./tarefas.js";

const id32 = z.number().int().positive().max(2_147_483_647);
const nomes = (max: number) => z.array(z.string().trim().min(2).max(60)).max(max).optional();
const itens = (max: number) => z.array(z.string().trim().min(3).max(MAX_MESA.item)).max(max).optional();
/** Os campos sem descrição (a revisão usa os mesmos; as descrições vão só em propor_mesa: o prefixo de toda chamada fica menor). */
const base = {
  titulo: z.string().trim().min(3).max(MAX_MESA.titulo), objetivo: z.string().trim().min(10).max(MAX_MESA.objetivo),
  quandoAge: z.string().trim().min(5).max(MAX_MESA.quandoAge), le: nomes(MAX_MESA.leituras), escreve: nomes(MAX_MESA.acoes),
  funcoesNovas: itens(MAX_MESA.funcoesNovasDoModelo), quemAprova: z.enum(QUEM_APROVA), exemplosBons: itens(MAX_MESA.exemplos),
  exemplosRuins: itens(MAX_MESA.exemplos), riscos: itens(MAX_MESA.riscos), custo: z.enum(FAIXAS_CUSTO),
};
export const entradaProporMesa = z.object({
  ...base,
  objetivo: base.objetivo.describe("O problema, com as palavras do dono."),
  quandoAge: base.quandoAge.describe("Quando agiria (ex.: quando o dono pede; toda segunda)."),
  le: base.le.describe("Nomes exatos das suas consultas que usaria."),
  escreve: base.escreve.describe("Nomes exatos das suas ações que usaria."),
  funcoesNovas: base.funcoesNovas.describe("O que ainda não existe (curto)."),
  exemplosBons: base.exemplosBons.describe("O que deve fazer."),
  exemplosRuins: base.exemplosRuins.describe("O que não deve fazer."),
}).strict();
export const entradaRevisarMesa = z.object({
  mesaId: z.number().int().positive().max(2_147_483_647),
  titulo: base.titulo.optional(), objetivo: base.objetivo.optional(), quandoAge: base.quandoAge.optional(), le: base.le, escreve: base.escreve,
  funcoesNovas: base.funcoesNovas, quemAprova: base.quemAprova.optional(), exemplosBons: base.exemplosBons, exemplosRuins: base.exemplosRuins,
  riscos: base.riscos, custo: base.custo.optional(),
}).strict();
export const entradaMesaSo = z.object({ mesaId: id32 }).strict();

const txt = (max: number) => z.string().max(max);
const propostaGuardada = z.object({
  titulo: txt(MAX_MESA.titulo), objetivo: txt(MAX_MESA.objetivo), quandoAge: txt(MAX_MESA.quandoAge),
  le: z.array(txt(60)).max(MAX_MESA.leituras), escreve: z.array(txt(60)).max(MAX_MESA.acoes), funcoesNovas: z.array(txt(MAX_MESA.item)).max(MAX_MESA.funcoesNovas),
  quemAprova: z.enum(QUEM_APROVA), exemplosBons: z.array(txt(MAX_MESA.item)).max(MAX_MESA.exemplos), exemplosRuins: z.array(txt(MAX_MESA.item)).max(MAX_MESA.exemplos),
  riscos: z.array(txt(MAX_MESA.item)).max(MAX_MESA.riscos), custo: z.enum(FAIXAS_CUSTO),
}).strict();
const situacaoDaFila = z.enum(["rascunho", "aguardando_dono"]);
export const entradaProporAprovado = z.object({ proposta: propostaGuardada, pedidoOriginal: txt(MAX_MESA.pedido), situacao: situacaoDaFila }).strict();
export const entradaRevisarAprovado = z.object({
  mesaId: id32, versaoAntes: z.number().int().min(1).max(MAX_VERSOES_MESA), situacaoAntes: z.enum(["rascunho", "aguardando_dono", "aprovada"]),
  proposta: propostaGuardada, situacao: situacaoDaFila,
}).strict();
export const entradaMesaAprovado = z.object({ mesaId: id32, versao: z.number().int().min(1).max(MAX_VERSOES_MESA), titulo: txt(MAX_MESA.titulo) }).strict();

export const FRASE_MESA_SO_DO_DONO = "Só registro, reviso, aprovo ou recuso uma proposta de mesa quando você pede, com as suas palavras, numa mensagem direta (\"cria uma mesa para…\", \"quero que você passe a…\", \"aprova a mesa 3\"), sem texto colado nem encaminhado. Nada foi feito.";
const FRASE_SO_PELO_WHATSAPP = "As mesas pela conversa valem só com a sua resposta no WhatsApp; pela tela só se muda para em construção, em operação ou arquivada. Nada mudou.";
const FRASE_PROPOSTA_LONGA = "A proposta ficou longa demais para você ler inteira no WhatsApp: encurte o objetivo, os exemplos ou os riscos. Nada foi guardado.";
const NADA_LIGA = "Nada passa a funcionar agora: só depois da sua aprovação e de a função ser construída pelo time de desenvolvimento";

const soPeloWhatsapp = (ctx: ContextoAcao) => { if (ctx.via !== "whatsapp") throw new RecusaAcao(FRASE_SO_PELO_WHATSAPP); };
/** O pedido veio da mensagem do dono pedindo ISTO (por código, em cerebro.ts)? Senão, nada. */
function pedidoDoDono(ctx: ContextoAcao, tipo: TipoPedidoMesa): string {
  const p = ctx.pedidoDeMesa;
  if (!p || typeof p.texto !== "string" || !p.texto.trim() || !p.tipos.includes(tipo)) throw new RecusaAcao(FRASE_MESA_SO_DO_DONO);
  return p.texto;
}
const aspas = (t: string) => `"${t}"`;
const rotulo = (n: string) => ROTULO_CONSULTA[n] ?? n;
async function catalogo(): Promise<CatalogoDeCapacidades> {
  // import DINÂMICO: o catálogo lê registro.ts, que importa este arquivo (evita o ciclo)
  const { catalogoDeCapacidades } = await import("../mesas-capacidades.js");
  return catalogoDeCapacidades();
}
/** Banco sem a 0151 → recusa explicada (nada foi feito); outro erro segue para a porta (500, "nada foi gravado"). */
async function comTabela<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) { if (semTabelaDasMesas(e)) throw new RecusaAcao(`${SEM_MIGRACAO_MESAS} Nada foi feito.`); throw e; }
}

type Parte = { chave: keyof PropostaMesa; texto: string; trechos: string[] };
/** O resumo da proposta em partes (montado pelo SERVIDOR): cada texto livre entre aspas, leituras/ações pelo nome de gente. */
function partesDaProposta(p: PropostaMesa): Parte[] {
  const lista = (xs: readonly string[]) => xs.map(aspas).join(", ");
  const partes: Parte[] = [
    { chave: "titulo", texto: `título: ${aspas(p.titulo)}`, trechos: [aspas(p.titulo)] },
    { chave: "objetivo", texto: `objetivo: ${aspas(p.objetivo)}`, trechos: [aspas(p.objetivo)] },
    { chave: "quandoAge", texto: `quando age: ${aspas(p.quandoAge)}`, trechos: [aspas(p.quandoAge)] },
    { chave: "le", texto: `lê: ${p.le.length ? p.le.map(rotulo).join(", ") : "nada"}`, trechos: [] },
    { chave: "escreve", texto: `grava: ${p.escreve.length ? p.escreve.map(rotulo).join(", ") : "nada"}`, trechos: [] },
    { chave: "funcoesNovas", texto: `precisa de função nova: ${p.funcoesNovas.length ? lista(p.funcoesNovas) : "nenhuma"}`, trechos: p.funcoesNovas.map(aspas) },
    { chave: "quemAprova", texto: `quem aprova: ${ROTULO_QUEM_APROVA[p.quemAprova]}`, trechos: [] },
    { chave: "exemplosBons", texto: `deve fazer: ${p.exemplosBons.length ? lista(p.exemplosBons) : "nenhum exemplo"}`, trechos: p.exemplosBons.map(aspas) },
    { chave: "exemplosRuins", texto: `não deve fazer: ${p.exemplosRuins.length ? lista(p.exemplosRuins) : "nenhum exemplo"}`, trechos: p.exemplosRuins.map(aspas) },
    { chave: "riscos", texto: `riscos: ${p.riscos.length ? lista(p.riscos) : "nenhum"}`, trechos: p.riscos.map(aspas) },
    { chave: "custo", texto: `custo mensal estimado: ${ROTULO_FAIXA_CUSTO[p.custo]}`, trechos: [] },
  ];
  return partes;
}
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const partesMudadas = (antes: PropostaMesa, depois: PropostaMesa) => partesDaProposta(depois).filter(x => !igual(antes[x.chave], depois[x.chave]));
const comoFica = (situacao: "rascunho" | "aguardando_dono", p: PropostaMesa) =>
  situacao === "rascunho" ? `fica como rascunho (falta: ${faltaNaProposta(p).join(", ")})` : "fica aguardando a sua aprovação";
const notaDeAjustes = (ajustes: readonly string[]) =>
  (ajustes.length ? ` (o sistema ajustou: ${ajustes.slice(0, 4).join("; ")}${ajustes.length > 4 ? "; …" : ""})` : "");
function resumoOuRecusa(texto: string, trechos: string[]): string {
  if (texto.length > MAX_RESUMO_FILA) throw new RecusaAcao(FRASE_PROPOSTA_LONGA);
  return resumoDaFila(texto, trechos);
}

// ── propor_mesa ──

export async function prepararProporMesa(args: z.infer<typeof entradaProporMesa>, ctx: ContextoAcao): Promise<Preparo> {
  const pedido = pedidoDoDono(ctx, "propor");
  const c = conferirProposta(args, await catalogo());
  if (!c.ok) throw new RecusaAcao(`${c.motivo} Nada foi guardado.`);
  const p = c.proposta;
  const [mesmo, abertas] = await comTabela(() => emTransacaoSomenteLeitura(async () => [await tituloIgualAberto(p.titulo, bancoDaLeitura()), await contarAbertas(bancoDaLeitura())] as const));
  if (mesmo) throw new RecusaAcao(`Já existe a mesa ${mesmo} com esse título; para mudar, peça para revisar a mesa ${mesmo}. Nada foi guardado.`);
  if (abertas >= MAX_MESAS_ABERTAS) throw new RecusaAcao(FRASE_MESAS_CHEIAS);
  const situacao = situacaoDaProposta(p);
  const partes = partesDaProposta(p).filter(x => x.chave !== "titulo");
  const texto = `${prefixoDaFila(ctx.motivoContaminacao)}registrar a proposta de mesa ${aspas(p.titulo)} — ${partes.map(x => x.texto).join("; ")}${notaDeAjustes(c.ajustes)}. `
    + `${c.mascarou ? "CPF, telefone e e-mail ficam mascarados. " : ""}A proposta ${comoFica(situacao, p)}. ${NADA_LIGA}.`;
  const resumo = resumoOuRecusa(texto, [aspas(p.titulo), ...partes.flatMap(x => x.trechos)]);
  return { itens: [{ alvo: alvoDoPedido("mesa", [normalizarMesa(p.titulo)]), resumo, argumentos: { proposta: p, pedidoOriginal: pedidoOriginalFiltrado(pedido), situacao } }], recusados: [] };
}

export async function executarProporAprovado(args: z.infer<typeof entradaProporAprovado>, ctx: ContextoAcao): Promise<ResultadoAcao> {
  soPeloWhatsapp(ctx);
  const cat = await catalogo();
  const p = args.proposta as PropostaMesa;
  const motivo = revalidarProposta(p, cat);
  if (motivo) throw new RecusaAcao(motivo);
  if (situacaoDaProposta(p) !== args.situacao) throw new RecusaAcao("A situação da proposta não confere com o que foi mostrado; nada foi guardado. Peça de novo.");
  conferirMostrado(ctx, [aspas(p.titulo), ...partesDaProposta(p).flatMap(x => x.trechos)]);
  // as mesas que já existem entram antes (idempotente; falha não impede a proposta)
  await comTabela(() => semearMesasIniciais(cat, ctx.agora)).catch(e => { if (e instanceof RecusaAcao) throw e; console.error("[dolores/mesas] falha na semeadura", erroParaLog(e)); });
  const m = await comTabela(() => emTransacaoDeEscrita(async () => {
    const db = bancoDaAcao();
    const mesmo = await tituloIgualAberto(p.titulo, db);
    if (mesmo) throw new RecusaAcao(`Já existe a mesa ${mesmo} com esse título; não repeti.`);
    if ((await contarAbertas(db)) >= MAX_MESAS_ABERTAS) throw new RecusaAcao(FRASE_MESAS_CHEIAS);
    const nova = await inserirMesa({ proposta: p, pedidoOriginal: args.pedidoOriginal, situacao: args.situacao, origem: "conversa", autor: ctx.autorId, mensagemId: ctx.mensagemId, agora: ctx.agora }, db);
    await registrarAutoria(ctx, { tabela: "dolores_mesas_propostas", registroId: nova.id, funcao: "propor_mesa", descricao: `mesa ${nova.id} proposta (versão 1)` });
    return nova;
  }));
  await auditarMesa({ resultado: "ok", motivo: "proposta registrada pela conversa do dono", canal: "whatsapp", autor: ctx.autorId, mesaId: m.id, resumo: { operacao: "propor", situacao: m.situacao, versao: 1 } });
  const fica = args.situacao === "rascunho" ? `ficou como rascunho (falta: ${faltaNaProposta(p).join(", ")})` : "está aguardando a sua aprovação (é só dizer \"aprova a mesa " + m.id + "\")";
  return { dados: { mesaId: m.id }, resumo: { mesaId: m.id, situacao: m.situacao },
    feitos: [`registrei a proposta de mesa ${m.id}, ${aspas(p.titulo)}: ${fica}. Nada passou a funcionar`] };
}

// ── revisar_mesa ──

async function lerComVersao(id: number) {
  return comTabela(() => emTransacaoSomenteLeitura(async () => {
    const m = await lerMesa(id, bancoDaLeitura());
    const v = m ? await lerVersao(m.id, m.versaoAtual, bancoDaLeitura()) : null;
    return { m, v };
  }));
}

export async function prepararRevisarMesa(args: z.infer<typeof entradaRevisarMesa>, ctx: ContextoAcao): Promise<Preparo> {
  pedidoDoDono(ctx, "revisar");
  const { m, v } = await lerComVersao(args.mesaId);
  if (!m || !v) throw new RecusaAcao(`Não achei a mesa ${args.mesaId}. Nada foi mudado.`);
  if (!(SITUACOES_REVISAVEIS as readonly string[]).includes(m.situacao)) {
    throw new RecusaAcao(`A mesa ${m.id} está ${ROTULO_SITUACAO_MESA[m.situacao]}: não muda mais por aqui (a mudança vira uma mesa nova). Nada foi mudado.`);
  }
  if (m.versaoAtual >= MAX_VERSOES_MESA) throw new RecusaAcao(`A mesa ${m.id} já tem ${MAX_VERSOES_MESA} versões; proponha uma mesa nova. Nada foi mudado.`);
  const atual = v.proposta;
  const { mesaId: _id, ...novos } = args;
  const definidos = Object.fromEntries(Object.entries(novos).filter(([, x]) => x !== undefined));
  // as funções novas que já estavam na versão anterior não contam no teto da IA (só no total)
  const c = conferirProposta({ ...atual, ...definidos }, await catalogo(), definidos.funcoesNovas ? undefined : MAX_MESA.funcoesNovas);
  if (!c.ok) throw new RecusaAcao(`${c.motivo} Nada foi mudado.`);
  const p = c.proposta;
  const mudou = partesMudadas(atual, p);
  if (!mudou.length) throw new RecusaAcao(`A mesa ${m.id} já está assim; nada a mudar.`);
  if (normalizarMesa(p.titulo) !== normalizarMesa(atual.titulo)) {
    const mesmo = await comTabela(() => emTransacaoSomenteLeitura(() => tituloIgualAberto(p.titulo, bancoDaLeitura(), m.id)));
    if (mesmo) throw new RecusaAcao(`Já existe a mesa ${mesmo} com esse título. Nada foi mudado.`);
  }
  const situacao = situacaoDaProposta(p);
  const desfaz = m.situacao === "aprovada" ? " A aprovação anterior deixa de valer: ela volta a esperar a sua aprovação." : "";
  const texto = `${prefixoDaFila(ctx.motivoContaminacao)}revisar a mesa ${m.id}, ${aspas(m.titulo)} (versão ${m.versaoAtual} → ${m.versaoAtual + 1}) — passa a ser: `
    + `${mudou.map(x => x.texto).join("; ")}; o resto fica igual${notaDeAjustes(c.ajustes)}. ${c.mascarou ? "CPF, telefone e e-mail ficam mascarados. " : ""}`
    + `A proposta ${comoFica(situacao, p)}.${desfaz} ${NADA_LIGA}.`;
  const resumo = resumoOuRecusa(texto, [aspas(m.titulo), ...mudou.flatMap(x => x.trechos)]);
  return { itens: [{ alvo: `mesa:${m.id}:v${m.versaoAtual}:revisar`, resumo,
    argumentos: { mesaId: m.id, versaoAntes: m.versaoAtual, situacaoAntes: m.situacao, proposta: p, situacao } }], recusados: [] };
}

export async function executarRevisarAprovado(args: z.infer<typeof entradaRevisarAprovado>, ctx: ContextoAcao): Promise<ResultadoAcao> {
  soPeloWhatsapp(ctx);
  const p = args.proposta as PropostaMesa;
  const motivo = revalidarProposta(p, await catalogo());
  if (motivo) throw new RecusaAcao(motivo);
  if (situacaoDaProposta(p) !== args.situacao) throw new RecusaAcao("A situação da proposta não confere com o que foi mostrado; nada mudou. Peça de novo.");
  await comTabela(() => emTransacaoDeEscrita(async () => {
    const db = bancoDaAcao();
    const m = await lerMesa(args.mesaId, db);
    const v = m ? await lerVersao(m.id, args.versaoAntes, db) : null;
    if (!m || !v || m.versaoAtual !== args.versaoAntes || m.situacao !== args.situacaoAntes) throw new RecusaAcao("A mesa mudou depois da proposta; nada mudou. Peça de novo.");
    // o que muda tem de estar, byte a byte, no resumo que o dono leu (QA R2 N3)
    conferirMostrado(ctx, partesMudadas(v.proposta, p).flatMap(x => x.trechos));
    if (normalizarMesa(p.titulo) !== normalizarMesa(m.titulo) && (await tituloIgualAberto(p.titulo, db, m.id))) throw new RecusaAcao("Já existe outra mesa com esse título; nada mudou.");
    if (!(await inserirRevisao({ mesaId: m.id, versaoAntes: args.versaoAntes, situacaoAntes: args.situacaoAntes as SituacaoMesa, proposta: p, situacao: args.situacao,
      autor: ctx.autorId, mensagemId: ctx.mensagemId, agora: ctx.agora }, db))) throw new RecusaAcao("A mesa mudou depois da proposta; nada mudou. Peça de novo.");
    await registrarAutoria(ctx, { tabela: "dolores_mesas_propostas", registroId: m.id, funcao: "revisar_mesa", descricao: `mesa ${m.id} revisada (versão ${args.versaoAntes + 1})` });
  }));
  await auditarMesa({ resultado: "ok", motivo: "proposta revisada pela conversa do dono", canal: "whatsapp", autor: ctx.autorId, mesaId: args.mesaId,
    resumo: { operacao: "revisar", versao: args.versaoAntes + 1, situacao: args.situacao, desfezAprovacao: args.situacaoAntes === "aprovada" } });
  return { dados: { mesaId: args.mesaId, versao: args.versaoAntes + 1 }, resumo: { mesaId: args.mesaId, versao: args.versaoAntes + 1 },
    feitos: [`revisei a mesa ${args.mesaId} (agora na versão ${args.versaoAntes + 1}, ${args.situacao === "rascunho" ? "como rascunho" : "aguardando a sua aprovação"}). Nada passou a funcionar`] };
}

// ── propor_aprovacao_mesa (SÉRIA: "confirmo") e recusar_mesa ──

export async function prepararAprovarMesa(args: z.infer<typeof entradaMesaSo>, ctx: ContextoAcao): Promise<Preparo> {
  pedidoDoDono(ctx, "aprovar");
  const { m, v } = await lerComVersao(args.mesaId);
  if (!m || !v) throw new RecusaAcao(`Não achei a mesa ${args.mesaId}. Nada foi feito.`);
  if (m.situacao === "rascunho") throw new RecusaAcao(`A mesa ${m.id} ainda é rascunho (falta: ${faltaNaProposta(v.proposta).join(", ")}); complete antes de aprovar. Nada foi feito.`);
  if (m.situacao !== "aguardando_dono") throw new RecusaAcao(`A mesa ${m.id} está ${ROTULO_SITUACAO_MESA[m.situacao]}; só aprovo a que está aguardando a sua aprovação. Nada foi feito.`);
  const texto = `${prefixoDaFila(ctx.motivoContaminacao)}dar a sua aprovação à mesa ${m.id}, ${aspas(m.titulo)} (versão ${m.versaoAtual}) — a aprovação NÃO liga nada: ela passa a "aprovada" `
    + "e só entra em operação depois de construída pelo time de desenvolvimento (a proposta completa fica na tela, pronta para copiar)";
  const resumo = resumoOuRecusa(texto, [aspas(m.titulo)]);
  return { itens: [{ alvo: `mesa:${m.id}:v${m.versaoAtual}:aprovar`, resumo, argumentos: { mesaId: m.id, versao: m.versaoAtual, titulo: m.titulo } }], recusados: [] };
}

export async function executarAprovarAprovado(args: z.infer<typeof entradaMesaAprovado>, ctx: ContextoAcao): Promise<ResultadoAcao> {
  soPeloWhatsapp(ctx);
  conferirMostrado(ctx, [aspas(args.titulo)]);
  await comTabela(() => emTransacaoDeEscrita(async () => {
    const db = bancoDaAcao();
    if (!(await mudarSituacaoMesa(args.mesaId, ["aguardando_dono"], "aprovada", { por: ctx.autorId, agora: ctx.agora, versao: args.versao, aprovadaMensagemId: ctx.decisaoMensagemId ?? null }, db))) {
      throw new RecusaAcao("A mesa mudou (outra versão ou outra situação) depois da proposta; nada foi aprovado. Peça de novo.");
    }
    await registrarAutoria(ctx, { tabela: "dolores_mesas_propostas", registroId: args.mesaId, funcao: "propor_aprovacao_mesa", descricao: `mesa ${args.mesaId} aprovada (versão ${args.versao}); nada ligado` });
  }));
  await auditarMesa({ resultado: "ok", motivo: "aprovada pelo dono na conversa (nada ligado: depende da construção)", canal: "whatsapp", autor: ctx.autorId, mesaId: args.mesaId,
    resumo: { operacao: "aprovar", versao: args.versao } });
  return { dados: { mesaId: args.mesaId, situacao: "aprovada" }, resumo: { mesaId: args.mesaId, aprovada: true, ligada: false },
    feitos: [`aprovei a mesa ${args.mesaId}, ${aspas(args.titulo)}. Nada foi ligado: agora ela depende de ser construída pelo time de desenvolvimento (a proposta completa, pronta para copiar, está em Integrações, no cartão de operação da Dolores, em Mesas)`] };
}

export async function prepararRecusarMesa(args: z.infer<typeof entradaMesaSo>, ctx: ContextoAcao): Promise<Preparo> {
  pedidoDoDono(ctx, "recusar");
  const { m } = await lerComVersao(args.mesaId);
  if (!m) throw new RecusaAcao(`Não achei a mesa ${args.mesaId}. Nada foi feito.`);
  if (!(SITUACOES_RECUSAVEIS as readonly string[]).includes(m.situacao)) throw new RecusaAcao(`A mesa ${m.id} está ${ROTULO_SITUACAO_MESA[m.situacao]}; não dá para recusar por aqui. Nada foi feito.`);
  const resumo = resumoOuRecusa(`${prefixoDaFila(ctx.motivoContaminacao)}deixar de lado (recusada) a mesa ${m.id}, ${aspas(m.titulo)} — ela sai das abertas (o registro e as versões ficam)`, [aspas(m.titulo)]);
  return { itens: [{ alvo: `mesa:${m.id}:v${m.versaoAtual}:recusar`, resumo, argumentos: { mesaId: m.id, versao: m.versaoAtual, titulo: m.titulo } }], recusados: [] };
}

export async function executarRecusarAprovado(args: z.infer<typeof entradaMesaAprovado>, ctx: ContextoAcao): Promise<ResultadoAcao> {
  soPeloWhatsapp(ctx);
  conferirMostrado(ctx, [aspas(args.titulo)]);
  await comTabela(() => emTransacaoDeEscrita(async () => {
    const db = bancoDaAcao();
    if (!(await mudarSituacaoMesa(args.mesaId, SITUACOES_RECUSAVEIS, "recusada", { por: ctx.autorId, agora: ctx.agora, versao: args.versao }, db))) {
      throw new RecusaAcao("A mesa mudou depois da proposta; nada foi recusado. Peça de novo.");
    }
    await registrarAutoria(ctx, { tabela: "dolores_mesas_propostas", registroId: args.mesaId, funcao: "recusar_mesa", descricao: `mesa ${args.mesaId} recusada` });
  }));
  await auditarMesa({ resultado: "ok", motivo: "recusada pelo dono na conversa", canal: "whatsapp", autor: ctx.autorId, mesaId: args.mesaId, resumo: { operacao: "recusar", versao: args.versao } });
  return { dados: { mesaId: args.mesaId, situacao: "recusada" }, resumo: { mesaId: args.mesaId, recusada: true }, feitos: [`recusei a mesa ${args.mesaId}, ${aspas(args.titulo)}`] };
}
