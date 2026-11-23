// EPIC-029 S-3 (22/11/2026) — ações fiscais da Dolores, na conversa NATURAL do dono (decisão dele: sem comandos para decorar).
// As três são de FILA: aqui só se confere e se monta o resumo exato (nada é gravado); a gravação roda depois da resposta dele no
// WhatsApp, reconhecida por código (server/dolores/pendencia.ts): "pode", "sim", "isso"… para REGISTRO (sem nota, depois, editar) e
// "confirmo" para a ação SÉRIA (emitir) — o nível é de shared/dolores/confirmacao.ts#nivelDoItem, nunca da IA.
//
// Travas (todas por código):
// - só com `ctx.pedidoFiscal` (a mensagem DIRETA do dono, sem colagem, sem anexo, com o assunto fiscal aberto — cerebro.ts);
// - só executa com a decisão vinda do WhatsApp dele (`ctx.via === "whatsapp"`; a tela tem os botões próprios da aba Contabilidade);
// - motivo de "sem nota" da lista fechada (shared/fiscal/motivos.ts); texto livre só no motivo "outro", e saído das palavras dele;
// - a gravação usa as MESMAS funções da tela (server/fiscal/notas.ts: transição, versão lida, histórico imutável com via "whatsapp");
// - emitir/cancelar (S-7): enquanto EMISSAO_DISPONIVEL for false a execução RECUSA ("a emissão ainda não está ativa") — nenhuma
//   chamada de rede, status intacto. Ligada (23/11/2026), roda server/fiscal/emissao.ts (mesmas travas da tela + gatilho da
//   0167): com a empresa não liberada ou o ambiente desligado, recusa sem rede.
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { fiscalNotas } from "../../../drizzle/schema-fiscal.js";
import { FRASE_EMISSAO_INATIVA, centavosDoValor, reaisDeCentavos } from "../../../shared/dolores/fiscal.js";
import { prefixoDaFila } from "../../../shared/dolores/fila.js";
import { veioDasPalavrasDoDono } from "../../../shared/dolores/memoria-longa.js";
import { limparNomeDeTerceiro } from "../../../shared/dolores/operacao.js";
import { MOTIVOS_SEM_NOTA, ROTULO_MOTIVO, problemaDoMotivo, type MotivoSemNota } from "../../../shared/fiscal/motivos.js";
import { EMISSAO_DISPONIVEL } from "../../../shared/fiscal/status.js";
import { adiar, detalhar, editar, naoEmitir, type NotaDetalhada } from "../../fiscal/notas.js";
import { UFS } from "../../fiscal/router.js";
import { getDb } from "../../db.js";
import { bancoDaAcao, emTransacaoDeEscrita } from "../escrita.js";
import { bancoDaLeitura, emTransacaoSomenteLeitura } from "../somente-leitura.js";
import { RecusaAcao, conferirMostrado, registrarAutoria, resumoDaFila, textoDoDono, type ContextoAcao, type Preparo, type ResultadoAcao } from "./comum.js";

const id32 = z.number().int().positive().max(2_147_483_647);
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD.")
  .refine(d => !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime()) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d, "Data inválida.");
const uf = z.enum(UFS);

export const entradaDecidirNotaFiscal = z.object({
  notaFiscalId: id32.describe("notaFiscalId de listar_notas_fiscais / ver_nota_fiscal."),
  decisao: z.enum(["sem_nota", "adiada"]).describe("sem_nota = não emitir (precisa do motivo); adiada = deixar para depois."),
  motivo: z.enum(MOTIVOS_SEM_NOTA).optional().describe("Só em sem_nota: reembolso_custas (custas/cartório), itbi_repassado, taxa_caixa_repassada, servico_nao_faturavel, emitida_fora ou outro."),
  motivoTexto: z.string().trim().min(3).max(300).optional().describe("Só com motivo outro: o motivo com as palavras do dono."),
  adiadaAte: data.optional().describe("Só em adiada, se o dono disse até quando (AAAA-MM-DD)."),
}).strict();
export const entradaDecidirAprovado = z.object({
  notaFiscalId: id32, versao: z.number().int().positive(), decisao: z.enum(["sem_nota", "adiada"]),
  motivo: z.enum(MOTIVOS_SEM_NOTA).nullable(), motivoTexto: z.string().max(300).nullable(), adiadaAte: data.nullable(),
}).strict();

export const entradaEditarRascunhoNota = z.object({
  notaFiscalId: id32.describe("notaFiscalId de listar_notas_fiscais / ver_nota_fiscal."),
  valorReais: z.number().positive().max(1_000_000_000).optional().describe("Valor novo em reais, como o dono disse (ex.: 1200 ou 1200.5)."),
  voltarAoValorDaOrigem: z.literal(true).optional().describe("true quando o dono quer desfazer o ajuste de valor (volta ao do recebimento)."),
  descricao: z.string().trim().min(3).max(600).optional().describe("Descrição nova, com as palavras do dono."),
  municipio: z.string().trim().min(2).max(100).optional().describe("Município de incidência novo, como o dono disse (com a UF)."),
  uf: uf.optional(),
}).strict();
export const entradaEditarAprovado = z.object({
  notaFiscalId: id32, versao: z.number().int().positive(),
  valorCentavos: z.number().int().positive().nullable().optional(), descricao: z.string().max(600).optional(),
  municipio: z.string().max(100).optional(), uf: uf.optional(),
}).strict();

export const entradaEmitirNotaFiscal = z.object({ notaFiscalId: id32.describe("notaFiscalId de listar_notas_fiscais / ver_nota_fiscal.") }).strict();
/**
 * QA S-7 (I1): o item aprovado amarra o que o dono viu no resumo — o AMBIENTE do emissor e se a emissão estava liberada
 * (`EMISSAO_DISPONIVEL` E `emissao_liberada`) na preparação. A versão da NOTA não muda quando o EMISSOR muda; por isso a execução
 * confere os dois de novo e recusa se mudaram ("prepare de novo"). Ausente = "não liberada" (o lado seguro).
 */
export const entradaEmitirAprovado = z.object({
  notaFiscalId: id32, versao: z.number().int().positive(),
  ambiente: z.enum(["desligado", "producao_restrita", "producao"]),
  liberada: z.boolean().default(false),
}).strict();

export const FRASE_FISCAL_SO_DO_DONO = "Mudanças nas notas fiscais pela conversa só valem com o seu pedido direto (sem texto colado, sem anexo). Nada foi mudado.";
const FRASE_SO_PELO_WHATSAPP = "As decisões das notas fiscais pela Dolores valem só com a sua resposta no WhatsApp; pela tela, use BPO › Contabilidade › Notas a decidir. Nada mudou.";
const FRASE_NAO_E_DO_DONO = "O texto a gravar precisa sair das suas palavras nesta mensagem (não uso o que li no cadastro ou numa consulta). Diga com as suas palavras. Nada foi mudado.";

const soPeloWhatsapp = (ctx: ContextoAcao) => { if (ctx.via !== "whatsapp") throw new RecusaAcao(FRASE_SO_PELO_WHATSAPP); };
function pedidoDoDono(ctx: ContextoAcao): string {
  const t = ctx.pedidoFiscal?.texto;
  if (typeof t !== "string" || !t.trim()) throw new RecusaAcao(FRASE_FISCAL_SO_DO_DONO);
  return t;
}
const aspas = (t: string) => `"${t}"`;
const diaBr = (d: string) => d.split("-").reverse().join("/");
const hoje = (agora: Date) => new Date(agora.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
const local = (m: NotaDetalhada["municipio"]) => (m.nome ? `${limparNomeDeTerceiro(m.nome, 60)}${m.uf ? `/${m.uf}` : ""}` : "município não definido");
/** Como a nota aparece no resumo: nome do tomador limpo, valor e serviço/município (dados do cadastro: o dono confere). */
function rotulo(n: NotaDetalhada): string {
  const nome = limparNomeDeTerceiro(n.tomador.nome, 60) || "tomador não identificado";
  const servico = n.tipoServico?.nome ? `${limparNomeDeTerceiro(n.tipoServico.nome, 40)}, ` : "";
  return `a nota de «${nome}», ${reaisDeCentavos(n.valorCentavos)} (${servico}${local(n.municipio)}; rascunho nº ${n.id})`;
}

/** O rascunho, lido numa transação só de leitura; precisa estar a decidir (ou deixado para depois). */
async function rascunhoAberto(id: number): Promise<NotaDetalhada> {
  const n = await emTransacaoSomenteLeitura(async () => {
    const linhas = await bancoDaLeitura().select().from(fiscalNotas).where(eq(fiscalNotas.id, id)).limit(1);
    return (await detalhar(bancoDaLeitura(), linhas))[0] ?? null;
  }).catch(() => { throw new RecusaAcao("Não consegui ler os rascunhos de nota agora (o módulo fiscal pode não estar ativo). Nada foi mudado."); });
  if (!n) throw new RecusaAcao(`Não achei o rascunho de nota ${id}. Nada foi mudado.`);
  if (n.status !== "A_DECIDIR" && n.status !== "ADIADA") {
    throw new RecusaAcao(`Esse rascunho já está decidido (${n.status === "SEM_NOTA" ? "sem nota" : n.status.toLowerCase()}); para mudar, reabra na aba Contabilidade. Nada foi mudado.`);
  }
  return n;
}

/** Erro da regra fiscal (transição, versão antiga, motivo) vira recusa explicada; o resto sobe (a porta diz "nada foi gravado"). */
async function gravarFiscal<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof TRPCError) {
      throw new RecusaAcao(e.code === "CONFLICT" ? "O rascunho mudou depois da proposta; nada mudou. Peça de novo." : `${e.message} Nada mudou.`);
    }
    throw e;
  }
}

// ── decidir_nota_fiscal: sem nota (motivo da lista) ou deixar para depois — REGISTRO ("pode") ──

export async function prepararDecidirNotaFiscal(args: z.infer<typeof entradaDecidirNotaFiscal>, ctx: ContextoAcao): Promise<Preparo> {
  const doDono = pedidoDoDono(ctx);
  const n = await rascunhoAberto(args.notaFiscalId);
  let motivo: MotivoSemNota | null = null;
  let motivoTexto: string | null = null;
  let adiadaAte: string | null = null;
  let resumo: string;
  if (args.decisao === "sem_nota") {
    // motivo fora da lista nem passa do zod; aqui, motivo ausente e "outro" sem texto (a mesma regra da tela e do CHECK do banco)
    const problema = problemaDoMotivo(args.motivo, args.motivoTexto);
    if (problema) throw new RecusaAcao(`${problema} Nada foi mudado.`);
    motivo = args.motivo!;
    if (motivo === "outro") {
      motivoTexto = textoDoDono(args.motivoTexto!.replace(/\s+/g, " "));
      if (!veioDasPalavrasDoDono(motivoTexto, doDono)) throw new RecusaAcao(FRASE_NAO_E_DO_DONO);
    }
    resumo = `marcar ${rotulo(n)} como SEM NOTA — motivo: ${ROTULO_MOTIVO[motivo]}${motivoTexto ? ` (${aspas(motivoTexto)})` : ""}`;
  } else {
    if (args.adiadaAte) {
      if (args.adiadaAte < hoje(ctx.agora)) throw new RecusaAcao("A data para retomar já passou; diga outra data (ou sem data). Nada foi mudado.");
      if (args.adiadaAte > `${Number(hoje(ctx.agora).slice(0, 4)) + 1}${hoje(ctx.agora).slice(4)}`) throw new RecusaAcao("Deixar para depois vale por no máximo um ano. Nada foi mudado.");
      adiadaAte = args.adiadaAte;
    }
    resumo = `deixar ${rotulo(n)} para DEPOIS${adiadaAte ? `, até ${diaBr(adiadaAte)}` : ", sem data"} (continua na lista de notas a decidir)`;
  }
  const final = resumoDaFila(`${prefixoDaFila(ctx.motivoContaminacao)}${resumo}`, motivoTexto ? [aspas(motivoTexto)] : []);
  return { itens: [{ alvo: `nota_fiscal:${n.id}:decidir`, resumo: final, argumentos: { notaFiscalId: n.id, versao: n.versao, decisao: args.decisao, motivo, motivoTexto, adiadaAte } }], recusados: [] };
}

export async function executarDecidirAprovado(args: z.infer<typeof entradaDecidirAprovado>, ctx: ContextoAcao): Promise<ResultadoAcao> {
  soPeloWhatsapp(ctx);
  if (args.motivoTexto) conferirMostrado(ctx, [aspas(args.motivoTexto)]);
  const autor = { usuarioId: ctx.autorId, via: "whatsapp" as const };
  await emTransacaoDeEscrita(async () => {
    const db = bancoDaAcao();
    await gravarFiscal(() => args.decisao === "sem_nota"
      ? naoEmitir(db, { id: args.notaFiscalId, versao: args.versao, motivo: args.motivo ?? "", texto: args.motivoTexto, ...autor })
      : adiar(db, { id: args.notaFiscalId, versao: args.versao, ate: args.adiadaAte, ...autor }));
    await registrarAutoria(ctx, { tabela: "fiscal_notas", registroId: args.notaFiscalId, funcao: "decidir_nota_fiscal",
      descricao: `rascunho de nota ${args.notaFiscalId}: ${args.decisao === "sem_nota" ? `sem nota (${args.motivo})` : "deixado para depois"}` });
  });
  const feito = args.decisao === "sem_nota"
    ? `marquei o rascunho de nota nº ${args.notaFiscalId} como sem nota (${ROTULO_MOTIVO[args.motivo as MotivoSemNota]})`
    : `deixei o rascunho de nota nº ${args.notaFiscalId} para depois${args.adiadaAte ? `, até ${diaBr(args.adiadaAte)}` : ""}`;
  return { dados: { notaFiscalId: args.notaFiscalId, decisao: args.decisao }, resumo: { notaFiscalId: args.notaFiscalId, decisao: args.decisao }, feitos: [feito] };
}

// ── editar_rascunho_nota: valor, descrição, município — REGISTRO ("pode"), com o antes e o depois ──

export async function prepararEditarRascunhoNota(args: z.infer<typeof entradaEditarRascunhoNota>, ctx: ContextoAcao): Promise<Preparo> {
  const doDono = pedidoDoDono(ctx);
  const n = await rascunhoAberto(args.notaFiscalId);
  const mudancas: string[] = [];
  const trechos: string[] = [];
  const argumentos: Record<string, unknown> = { notaFiscalId: n.id, versao: n.versao };
  if (args.valorReais !== undefined && args.voltarAoValorDaOrigem) throw new RecusaAcao("Diga um valor novo OU que volta ao valor do recebimento, não os dois. Nada foi mudado.");
  if (args.valorReais !== undefined) {
    const c = centavosDoValor(args.valorReais);
    if (c === null) throw new RecusaAcao("Esse valor não é um valor em reais válido (até dois centavos). Nada foi mudado.");
    if (c !== n.valorCentavos) { mudancas.push(`valor ${reaisDeCentavos(n.valorCentavos)} → ${reaisDeCentavos(c)}`); argumentos.valorCentavos = c; }
  } else if (args.voltarAoValorDaOrigem) {
    if (n.valorAjustadoCentavos != null) { mudancas.push(`valor ${reaisDeCentavos(n.valorCentavos)} → ${reaisDeCentavos(n.valorSugeridoCentavos)} (o do recebimento)`); argumentos.valorCentavos = null; }
  }
  if (args.descricao !== undefined) {
    const d = textoDoDono(args.descricao.replace(/\s+/g, " "));
    if (!veioDasPalavrasDoDono(d, doDono)) throw new RecusaAcao(FRASE_NAO_E_DO_DONO);
    if (d !== n.descricao) { mudancas.push(`descrição ${aspas(limparNomeDeTerceiro(n.descricao, 120) || "(vazia)")} → ${aspas(d)}`); trechos.push(aspas(d)); argumentos.descricao = d; }
  }
  if (args.municipio !== undefined) {
    if (!args.uf) throw new RecusaAcao("Diga também a UF do município (ex.: Parauapebas/PA). Nada foi mudado.");
    const m = textoDoDono(args.municipio.replace(/\s+/g, " "));
    if (!veioDasPalavrasDoDono(m, doDono)) throw new RecusaAcao(FRASE_NAO_E_DO_DONO);
    const novo = `${m}/${args.uf}`;
    if (novo.toLocaleLowerCase("pt-BR") !== `${n.municipio.nome ?? ""}/${n.municipio.uf ?? ""}`.toLocaleLowerCase("pt-BR")) {
      mudancas.push(`município ${local(n.municipio)} → ${novo}`); trechos.push(novo); argumentos.municipio = m; argumentos.uf = args.uf;
    }
  }
  if (!mudancas.length) throw new RecusaAcao("Não há o que mudar nesse rascunho (o que você disse já é o que está lá). Nada foi mudado.");
  const resumo = resumoDaFila(`${prefixoDaFila(ctx.motivoContaminacao)}corrigir ${rotulo(n)}: ${mudancas.join("; ")}`, trechos);
  return { itens: [{ alvo: `nota_fiscal:${n.id}:editar`, resumo, argumentos }], recusados: [] };
}

export async function executarEditarAprovado(args: z.infer<typeof entradaEditarAprovado>, ctx: ContextoAcao): Promise<ResultadoAcao> {
  soPeloWhatsapp(ctx);
  conferirMostrado(ctx, [...(args.descricao ? [aspas(args.descricao)] : []), ...(args.municipio ? [`${args.municipio}/${args.uf}`] : [])]);
  await emTransacaoDeEscrita(async () => {
    await gravarFiscal(() => editar(bancoDaAcao(), {
      id: args.notaFiscalId, versao: args.versao, usuarioId: ctx.autorId, via: "whatsapp",
      ...(args.valorCentavos !== undefined ? { valorCentavos: args.valorCentavos } : {}),
      ...(args.descricao !== undefined ? { descricao: args.descricao } : {}),
      ...(args.municipio !== undefined ? { municipioNome: args.municipio, municipioUf: args.uf ?? null } : {}),
    }));
    await registrarAutoria(ctx, { tabela: "fiscal_notas", registroId: args.notaFiscalId, funcao: "editar_rascunho_nota", descricao: `rascunho de nota ${args.notaFiscalId} corrigido` });
  });
  return { dados: { notaFiscalId: args.notaFiscalId }, resumo: { notaFiscalId: args.notaFiscalId, editada: true }, feitos: [`corrigi o rascunho de nota nº ${args.notaFiscalId}`] };
}

// ── emitir_nota_fiscal: SÉRIA ("confirmo"). S-7: executa pela MESMA função da tela (server/fiscal/emissao.ts#emitirNota), com as
// mesmas travas (EMISSAO_DISPONIVEL, interruptor do emissor, ambiente). Fora da transação de escrita da Dolores DE PROPÓSITO: o
// envio à Sefin não pode ser desfeito por um rollback (o registro EMITINDO e o retorno ficam gravados sempre). ──

/** A nota (qualquer situação), lida numa transação só de leitura. */
async function notaLida(id: number): Promise<NotaDetalhada> {
  const n = await emTransacaoSomenteLeitura(async () => {
    const linhas = await bancoDaLeitura().select().from(fiscalNotas).where(eq(fiscalNotas.id, id)).limit(1);
    return (await detalhar(bancoDaLeitura(), linhas))[0] ?? null;
  }).catch(() => { throw new RecusaAcao("Não consegui ler as notas agora. Nada foi mudado."); });
  if (!n) throw new RecusaAcao(`Não achei a nota ${id}. Nada foi mudado.`);
  return n;
}

/** Nota que pode ir para emissão: a decidir, adiada, com erro ou com emissão em andamento (retomada consulta antes). */
async function notaParaEmitir(id: number): Promise<NotaDetalhada> {
  const n = await notaLida(id);
  if (!["A_DECIDIR", "ADIADA", "ERRO", "EMITINDO"].includes(n.status)) throw new RecusaAcao(`Essa nota não pode ser emitida (situação: ${n.status.toLowerCase()}). Nada foi mudado.`);
  return n;
}

type AmbienteMostrado = z.infer<typeof entradaEmitirAprovado>["ambiente"];
/** O que o resumo mostrou: ambiente do emissor (o que não for de emissão conta como "desligado") e se a emissão estava liberada. */
function estadoDaEmissao(n: Pick<NotaDetalhada, "emissor">, disponivel: boolean): { ambiente: AmbienteMostrado; liberada: boolean } {
  const a = n.emissor?.ambiente;
  const ambiente: AmbienteMostrado = a === "producao" || a === "producao_restrita" ? a : "desligado";
  return { ambiente, liberada: disponivel && n.emissor?.emissaoLiberada === true && ambiente !== "desligado" };
}
export const FRASE_EMISSAO_MUDOU = "A situação da emissão mudou depois da proposta (ambiente da empresa emissora ou liberação da emissão). Nada foi enviado. Peça de novo para eu preparar com a situação atual.";

export async function prepararEmitirNotaFiscal(args: z.infer<typeof entradaEmitirNotaFiscal>, ctx: ContextoAcao): Promise<Preparo> {
  pedidoDoDono(ctx);
  const n = await notaParaEmitir(args.notaFiscalId);
  const estado = estadoDaEmissao(n, EMISSAO_DISPONIVEL);
  // O resumo diz o motivo REAL de nada sair (sistema desligado, ambiente desligado ou empresa não liberada): nunca promete envio
  // com uma trava fechada. A execução confere tudo de novo (I1 + emissao.ts).
  const atencao = !EMISSAO_DISPONIVEL ? "a emissão ainda não está ativa; com a sua confirmação eu só confiro, nada sai do sistema"
    : !estado.liberada ? `${estado.ambiente === "desligado" ? "o ambiente de emissão desta empresa está desligado" : "a emissão desta empresa ainda não foi liberada pelo administrador"}; com a sua confirmação eu só confiro, nada sai do sistema`
      : estado.ambiente === "producao" ? "a nota sai pela API Nacional, COM VALOR FISCAL" : "a nota sai no AMBIENTE DE TESTES, sem valor fiscal";
  const resumo = resumoDaFila(`${prefixoDaFila(ctx.motivoContaminacao)}EMITIR ${rotulo(n)} — atenção: ${atencao}`);
  return { itens: [{ alvo: `nota_fiscal:${n.id}:emitir`, resumo, argumentos: { notaFiscalId: n.id, versao: n.versao, ...estado } }], recusados: [] };
}

export async function executarEmitirAprovado(args: z.infer<typeof entradaEmitirAprovado>, ctx: ContextoAcao, deps: { emissaoDisponivel?: boolean } = {}): Promise<ResultadoAcao> {
  soPeloWhatsapp(ctx);
  if (!(deps.emissaoDisponivel ?? EMISSAO_DISPONIVEL)) {
    // Nenhuma chamada de rede e nenhuma gravação enquanto a emissão não estiver ativa no código.
    const frase = FRASE_EMISSAO_INATIVA.charAt(0).toUpperCase() + FRASE_EMISSAO_INATIVA.slice(1);
    throw new RecusaAcao(`${frase}.`);
  }
  // I1: o que foi mostrado (ambiente + liberada) tem de ser o de agora; senão recusa sem rede e pede nova preparação.
  // (Nota já emitida segue para emitirNota, que devolve "já emitida" sem rede.)
  const n = await notaLida(args.notaFiscalId);
  const atual = estadoDaEmissao(n, deps.emissaoDisponivel ?? EMISSAO_DISPONIVEL);
  if (n.status !== "EMITIDA" && (atual.ambiente !== args.ambiente || atual.liberada !== args.liberada)) throw new RecusaAcao(FRASE_EMISSAO_MUDOU);
  const ambienteEsperado = args.ambiente;
  const { emitirNota, fraseDeErroConhecido } = await import("../../fiscal/emissao.js");
  let r;
  // O ambiente aprovado vai junto: emitirNota confere de novo dentro da reserva (FOR UPDATE), fechando a corrida até o envio.
  try { r = await emitirNota(getDb(), { id: args.notaFiscalId, versao: args.versao, usuarioId: ctx.autorId, via: "whatsapp", ambienteEsperado }, { emissaoDisponivel: deps.emissaoDisponivel }); }
  catch (e) {
    const frase = fraseDeErroConhecido(e);
    if (frase) throw new RecusaAcao(frase);
    throw e;
  }
  await emTransacaoDeEscrita(() => registrarAutoria(ctx, { tabela: "fiscal_notas", registroId: args.notaFiscalId, funcao: "emitir_nota_fiscal", descricao: `nota ${args.notaFiscalId}: ${r.situacao}` }));
  if (r.situacao === "emitida" || r.situacao === "ja_emitida") return { dados: { notaFiscalId: r.notaId, numero: r.numero }, resumo: { notaFiscalId: r.notaId, situacao: r.situacao }, feitos: [r.mensagem] };
  throw new RecusaAcao(r.mensagem);
}

// ── cancelar_nota_fiscal: SÉRIA ("confirmo"). Só nota emitida; motivo da lista do leiaute; justificativa com as palavras do dono ──

const MOTIVO_DA_FALA = { erro_na_emissao: 1, servico_nao_prestado: 2, outros: 9 } as const;
export const entradaCancelarNotaFiscal = z.object({
  notaFiscalId: id32,
  motivo: z.enum(["erro_na_emissao", "servico_nao_prestado", "outros"]),
  justificativa: z.string().trim().min(15).max(255).describe("Palavras do dono."),
}).strict();
export const entradaCancelarAprovado = z.object({
  notaFiscalId: id32, versao: z.number().int().positive(), motivo: z.union([z.literal(1), z.literal(2), z.literal(9)]), justificativa: z.string().min(15).max(255),
}).strict();

export async function prepararCancelarNotaFiscal(args: z.infer<typeof entradaCancelarNotaFiscal>, ctx: ContextoAcao): Promise<Preparo> {
  const doDono = pedidoDoDono(ctx);
  const n = await emTransacaoSomenteLeitura(async () => {
    const linhas = await bancoDaLeitura().select().from(fiscalNotas).where(eq(fiscalNotas.id, args.notaFiscalId)).limit(1);
    return (await detalhar(bancoDaLeitura(), linhas))[0] ?? null;
  }).catch(() => { throw new RecusaAcao("Não consegui ler as notas agora. Nada foi mudado."); });
  if (!n) throw new RecusaAcao(`Não achei a nota ${args.notaFiscalId}. Nada foi mudado.`);
  if (n.status !== "EMITIDA") throw new RecusaAcao("Só uma nota já emitida pode ser cancelada. Nada foi mudado.");
  const justificativa = textoDoDono(args.justificativa.replace(/\s+/g, " "));
  if (!veioDasPalavrasDoDono(justificativa, doDono)) throw new RecusaAcao(FRASE_NAO_E_DO_DONO);
  const motivo = MOTIVO_DA_FALA[args.motivo];
  const rotuloMotivo = { 1: "erro na emissão", 2: "serviço não prestado", 9: "outros" }[motivo];
  const resumo = resumoDaFila(`${prefixoDaFila(ctx.motivoContaminacao)}CANCELAR a NFS-e nº ${n.numeroNfse ?? "?"} de ${rotulo(n)} — motivo: ${rotuloMotivo} (${aspas(justificativa)}). Cancelamento não se desfaz.`, [aspas(justificativa)]);
  return { itens: [{ alvo: `nota_fiscal:${n.id}:cancelar`, resumo, argumentos: { notaFiscalId: n.id, versao: n.versao, motivo, justificativa } }], recusados: [] };
}

export async function executarCancelarAprovado(args: z.infer<typeof entradaCancelarAprovado>, ctx: ContextoAcao, deps: { emissaoDisponivel?: boolean } = {}): Promise<ResultadoAcao> {
  soPeloWhatsapp(ctx);
  conferirMostrado(ctx, [aspas(args.justificativa)]);
  if (!(deps.emissaoDisponivel ?? EMISSAO_DISPONIVEL)) {
    const frase = FRASE_EMISSAO_INATIVA.charAt(0).toUpperCase() + FRASE_EMISSAO_INATIVA.slice(1);
    throw new RecusaAcao(`${frase}.`);
  }
  const { cancelarNota, fraseDeErroConhecido } = await import("../../fiscal/emissao.js");
  let r;
  try { r = await cancelarNota(getDb(), { id: args.notaFiscalId, versao: args.versao, motivo: args.motivo, justificativa: args.justificativa, usuarioId: ctx.autorId, via: "whatsapp" }, { emissaoDisponivel: deps.emissaoDisponivel }); }
  catch (e) {
    const frase = fraseDeErroConhecido(e);
    if (frase) throw new RecusaAcao(frase);
    throw e;
  }
  await emTransacaoDeEscrita(() => registrarAutoria(ctx, { tabela: "fiscal_notas", registroId: args.notaFiscalId, funcao: "cancelar_nota_fiscal", descricao: `nota ${args.notaFiscalId}: ${r.situacao}` }));
  if (r.situacao === "incerta") throw new RecusaAcao(r.mensagem);
  return { dados: { notaFiscalId: r.notaId }, resumo: { notaFiscalId: r.notaId, situacao: r.situacao }, feitos: [r.mensagem] };
}
