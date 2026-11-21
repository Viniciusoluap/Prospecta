// EPIC-027 C5 (E2, "a Dolores resolve") — o dono configura os grupos da Dolores PELA CONVERSA: ligar um grupo a um cliente ou
// obra (classificar o tipo), aceitar grupo em que outra pessoa a colocou, deixar um grupo de lado e ligar/desligar a resposta dela
// num grupo. Todas são de FILA: aqui só se CONFERE e se monta o resumo exato (nada é gravado); a execução roda só depois do
// "pode"/"confirmo" do dono, reconhecido por código (server/dolores/pendencia.ts), e só se a decisão veio do WhatsApp dele
// (`ctx.via === "whatsapp"`): aceitar grupo é só do dono (regra de 19/11) e pela fila da tela isso não vale. A execução reaproveita
// `decidirGrupo` (mesmas regras, mesmo gatilho 0133, mesma auditoria "grupo_decisao") e `definirRespostaDoGrupo`.
//
// | função                 | nível ("pode" / "confirmo")                                    | por quê                                           |
// | classificar_grupo      | registro (cliente, pós, engenharia); sério (sócios, jurídico,   | o tipo decide o que ela pode dizer no grupo        |
// |                        | parceiros)                                                       |                                                   |
// | aceitar_grupo          | sério                                                            | outra pessoa (ou não se sabe quem) a colocou lá    |
// | ignorar_grupo          | registro                                                         | só a deixa calada e sem ler (reversível)          |
// | ligar_resposta_grupo   | desligar: registro; ligar: registro, ou sério nos tipos internos | ligar amplia o que ela fala                        |
// O nível é calculado por código em shared/dolores/confirmacao.ts (`nivelDoItem`), só pela função e pelos argumentos guardados.
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { constructionProjects, leads } from "../../../drizzle/schema.js";
import { doloresGrupos, type DoloresGrupo } from "../../../drizzle/schema-dolores-grupos.js";
import { doloresMarcacoesConfig } from "../../../drizzle/schema-dolores-marcacoes.js";
import { prefixoDaFila } from "../../../shared/dolores/fila.js";
import { ALFABETO_CODIGO_GRUPO, ROTULO_TIPO_GRUPO, categoriaDoTipo, semProvaDoDono, tipoEfetivo } from "../../../shared/dolores/grupos-tipo.js";
import { lerConfigWhatsapp } from "../consumo.js";
import { decidirGrupo } from "../grupos-decisao.js";
import { definirRespostaDoGrupo, motivoParaNaoLigar } from "../grupos-config.js";
import { bancoDaLeitura, emTransacaoSomenteLeitura } from "../somente-leitura.js";
import { RecusaAcao, resumoDaFila, type ContextoAcao, type Preparo, type ResultadoAcao } from "./comum.js";
import { mostrar } from "./grupos.js";

const id32 = z.number().int().positive().max(2_147_483_647);
const TIPOS_CLASSIFICAVEIS = ["cliente", "pos_atendimento", "juridico", "administrativo", "parceiros", "engenharia"] as const;
type TipoClassificavel = (typeof TIPOS_CLASSIFICAVEIS)[number];

export const entradaClassificarGrupo = z.object({
  grupoId: id32.describe("Id do grupo (listar_grupos)."),
  tipo: z.enum(TIPOS_CLASSIFICAVEIS).describe("Tipo do grupo: cliente, pos_atendimento, juridico, administrativo (sócios), parceiros (corretores e correspondentes) ou engenharia."),
  leadId: id32.optional().describe("Cliente do CRM (leadId): obrigatório para cliente e pos_atendimento."),
  obraId: id32.optional().describe("Obra (obraId), opcional, só para engenharia."),
}).strict();
export const entradaGrupoSo = z.object({ grupoId: id32.describe("Id do grupo (listar_grupos).") }).strict();
export const entradaLigarResposta = z.object({
  grupoId: id32.describe("Id do grupo (listar_grupos)."),
  ligado: z.boolean().describe("true = ela passa a responder quando for marcada no grupo; false = fica calada lá."),
}).strict();

/** Argumentos guardados no item (validados de novo na execução). `frase`: o que vai ao dono depois de feito (montada pelo sistema). */
export const entradaClassificarAprovado = z.object({ grupoId: id32, tipo: z.enum(TIPOS_CLASSIFICAVEIS), numero: id32.nullable(), frase: z.string().max(400) }).strict();
export const entradaGrupoAprovado = z.object({ grupoId: id32, frase: z.string().max(400) }).strict();
export const entradaLigarAprovado = z.object({ grupoId: id32, ligado: z.boolean(), tipo: z.string().max(20), frase: z.string().max(400) }).strict();

const FRASE_SO_PELO_WHATSAPP = "Configurar grupo da Dolores vale só com a resposta do dono na conversa do WhatsApp dele (pela fila da tela, não). Nada mudou; para classificar pela tela, use Integrações › Dolores › Grupos.";
const CODIGO_DE_GRUPO = new RegExp(`\\s*\\([${ALFABETO_CODIGO_GRUPO}]{4}\\)`, "g");
/** Texto de decidirGrupo para o dono, sem o "Dolores:" do começo e sem o código do grupo (o modelo e a memória não veem código). */
const semCodigoDoGrupo = (t: string) => t.replace(/^Dolores:\s*/, "").replace(CODIGO_DE_GRUPO, "").replace(/"grupo [A-Z0-9]{4} [^"]*"/g, "a pergunta do grupo");

/** Nome do grupo para o resumo: limpo, na forma mostrada; se a saída o alteraria, só o número. */
const nomeDoGrupo = (g: Pick<DoloresGrupo, "id" | "nome" | "nomeWhatsapp">) => `«${mostrar(g.nomeWhatsapp ?? g.nome, 60, `grupo ${g.id}`)}» (grupo nº ${g.id})`;

/** O grupo, lido agora (somente leitura), e só se for da conexão da empresa (a mesma da Dolores). */
async function grupoDaEmpresa(grupoId: number): Promise<DoloresGrupo> {
  const cfg = await lerConfigWhatsapp().catch(() => null);
  const [g] = await emTransacaoSomenteLeitura(() => bancoDaLeitura().select().from(doloresGrupos).where(eq(doloresGrupos.id, grupoId)).limit(1));
  if (!g || (cfg?.instancia && g.instancia !== cfg.instancia)) throw new RecusaAcao(`Não achei o grupo ${grupoId} entre os grupos da Dolores. Nada foi feito.`);
  return g;
}

const soPeloWhatsapp = (ctx: ContextoAcao) => { if (ctx.via !== "whatsapp") throw new RecusaAcao(FRASE_SO_PELO_WHATSAPP); };
const mensagemDaDecisao = (ctx: ContextoAcao) => ctx.decisaoMensagemId ?? ctx.mensagemId ?? 0;

export async function prepararClassificarGrupo(args: z.infer<typeof entradaClassificarGrupo>, ctx: ContextoAcao): Promise<Preparo> {
  const g = await grupoDaEmpresa(args.grupoId);
  // grupo recusado / sem prova de quem colocou a Dolores: classificar também o aceitaria — isso pede a ação séria própria
  if (semProvaDoDono(g)) {
    throw new RecusaAcao(`O grupo ${nomeDoGrupo(g)} é um em que outra pessoa me colocou (ou não sei quem). Antes de dizer o tipo, ele precisa ser aceito por você: peça para eu aceitar esse grupo. Nada foi feito.`, { comDados: true });
  }
  const tipo = args.tipo as TipoClassificavel;
  const cat = categoriaDoTipo(tipo)!;
  let numero: number | null = null;
  let vinculo = "";
  if (tipo === "cliente" || tipo === "pos_atendimento") {
    if (!args.leadId) throw new RecusaAcao("Para grupo de cliente (ou pós-atendimento) preciso do cliente do CRM; diga de qual cliente é. Nada foi feito.");
    const [l] = await emTransacaoSomenteLeitura(() => bancoDaLeitura().select({ id: leads.id, nome: leads.name }).from(leads).where(and(eq(leads.id, args.leadId!), isNull(leads.deletedAt))).limit(1));
    if (!l) throw new RecusaAcao(`Não achei o cliente ${args.leadId} no CRM (ou ele foi excluído). Nada foi feito.`);
    numero = l.id;
    vinculo = ` de «${mostrar(l.nome, 60, `cliente ${l.id}`)}» (cliente nº ${l.id})`;
  } else if (tipo === "engenharia" && args.obraId) {
    const [o] = await emTransacaoSomenteLeitura(() => bancoDaLeitura().select({ id: constructionProjects.id, titulo: constructionProjects.title }).from(constructionProjects).where(eq(constructionProjects.id, args.obraId!)).limit(1));
    if (!o) throw new RecusaAcao(`Não achei a obra ${args.obraId}. Nada foi feito.`);
    numero = o.id;
    vinculo = ` da obra «${mostrar(o.titulo, 60, `obra ${o.id}`)}» (obra nº ${o.id})`;
  } else if (args.leadId || args.obraId) {
    throw new RecusaAcao(`Grupo do tipo ${ROTULO_TIPO_GRUPO[tipo]} não fica ligado a cliente nem a obra; peça sem o vínculo. Nada foi feito.`);
  }
  const comCliente = tipo === "cliente" || tipo === "pos_atendimento";
  const mesmoVinculo = comCliente ? g.leadId === numero : tipo === "engenharia" ? (g.obraId ?? null) === numero : true;
  if (tipoEfetivo(g) === tipo && mesmoVinculo && g.situacaoConfirmacao === "confirmado" && g.ativo) {
    throw new RecusaAcao(`O grupo ${nomeDoGrupo(g)} já é do tipo ${ROTULO_TIPO_GRUPO[tipo]}${vinculo}; nada a mudar.`, { comDados: true });
  }
  const frase = `o grupo ${nomeDoGrupo(g)} agora é do tipo ${cat.rotulo}${vinculo}`;
  const resumo = resumoDaFila(`${prefixoDaFila(ctx.motivoContaminacao)}ligar o grupo ${nomeDoGrupo(g)} como do tipo ${cat.rotulo}${vinculo} — o que eu respondo lá quando me marcam: ${cat.explica}${g.ativo ? "" : " (o grupo estava desativado e volta a valer)"}.`);
  return { itens: [{ alvo: `grupo:${g.id}:tipo`, resumo, argumentos: { grupoId: g.id, tipo, numero, frase } }], recusados: [] };
}

export async function executarClassificarAprovado(args: z.infer<typeof entradaClassificarAprovado>, ctx: ContextoAcao): Promise<ResultadoAcao> {
  soPeloWhatsapp(ctx);
  const g = await grupoDaEmpresa(args.grupoId);
  if (semProvaDoDono(g)) throw new RecusaAcao("Esse grupo passou a esperar o seu aceite; nada mudou. Peça para eu aceitar o grupo antes.");
  const r = await decidirGrupo({ grupoId: g.id, instancia: g.instancia }, { tipo: args.tipo, numero: args.numero }, { via: "whatsapp", autor: ctx.autorId, mensagemId: mensagemDaDecisao(ctx), agora: ctx.agora });
  if (!r.ok) throw new RecusaAcao(semCodigoDoGrupo(r.texto));
  return { dados: { grupoId: g.id, tipo: args.tipo }, resumo: { grupoId: g.id, tipo: args.tipo, comVinculo: args.numero !== null }, feitos: [args.frase] };
}

export async function prepararAceitarGrupo(args: z.infer<typeof entradaGrupoSo>, ctx: ContextoAcao): Promise<Preparo> {
  const g = await grupoDaEmpresa(args.grupoId);
  if (!semProvaDoDono(g)) throw new RecusaAcao(`O grupo ${nomeDoGrupo(g)} já está aceito; nada a fazer.`, { comDados: true });
  const quem = g.adicionadoPor === "outra_pessoa" ? "outra pessoa me colocou" : "não sei quem me colocou";
  const tipo = tipoEfetivo(g);
  const depois = tipo === "indefinido" ? "depois você me diz de que tipo ele é" : `ele vale como do tipo ${ROTULO_TIPO_GRUPO[tipo]}`;
  const frase = `aceitei o grupo ${nomeDoGrupo(g)}${tipo === "indefinido" ? "; falta você me dizer de que tipo ele é" : ""}`;
  const resumo = resumoDaFila(`${prefixoDaFila(ctx.motivoContaminacao)}aceitar o grupo ${nomeDoGrupo(g)}, em que ${quem}: a partir daí eu leio as mensagens de lá e ${depois}.`);
  return { itens: [{ alvo: `grupo:${g.id}:aceitar`, resumo, argumentos: { grupoId: g.id, frase } }], recusados: [] };
}

export async function executarAceitarAprovado(args: z.infer<typeof entradaGrupoAprovado>, ctx: ContextoAcao): Promise<ResultadoAcao> {
  soPeloWhatsapp(ctx);
  const g = await grupoDaEmpresa(args.grupoId);
  if (!semProvaDoDono(g)) return { dados: { grupoId: g.id, jaAceito: true }, resumo: { grupoId: g.id, jaAceito: true }, feitos: [`o grupo ${nomeDoGrupo(g)} já estava aceito`] };
  const r = await decidirGrupo({ grupoId: g.id, instancia: g.instancia }, { tipo: "aceitar", numero: null }, { via: "whatsapp", autor: ctx.autorId, mensagemId: mensagemDaDecisao(ctx), agora: ctx.agora });
  if (!r.ok) throw new RecusaAcao(semCodigoDoGrupo(r.texto));
  return { dados: { grupoId: g.id }, resumo: { grupoId: g.id, aceito: true }, feitos: [args.frase] };
}

export async function prepararIgnorarGrupo(args: z.infer<typeof entradaGrupoSo>, ctx: ContextoAcao): Promise<Preparo> {
  const g = await grupoDaEmpresa(args.grupoId);
  if (!g.ativo) throw new RecusaAcao(`O grupo ${nomeDoGrupo(g)} já está deixado de lado; nada a fazer.`, { comDados: true });
  const frase = `deixei de lado o grupo ${nomeDoGrupo(g)}: não leio nem falo nada lá`;
  const resumo = resumoDaFila(`${prefixoDaFila(ctx.motivoContaminacao)}deixar de lado o grupo ${nomeDoGrupo(g)}: não leio nem falo nada lá (dá para voltar depois).`);
  return { itens: [{ alvo: `grupo:${g.id}:ignorar`, resumo, argumentos: { grupoId: g.id, frase } }], recusados: [] };
}

export async function executarIgnorarAprovado(args: z.infer<typeof entradaGrupoAprovado>, ctx: ContextoAcao): Promise<ResultadoAcao> {
  soPeloWhatsapp(ctx);
  const g = await grupoDaEmpresa(args.grupoId);
  const r = await decidirGrupo({ grupoId: g.id, instancia: g.instancia }, { tipo: "ignorar", numero: null }, { via: "whatsapp", autor: ctx.autorId, mensagemId: mensagemDaDecisao(ctx), agora: ctx.agora });
  if (!r.ok) throw new RecusaAcao(semCodigoDoGrupo(r.texto));
  return { dados: { grupoId: g.id }, resumo: { grupoId: g.id, ignorado: true }, feitos: [args.frase] };
}

export async function prepararLigarResposta(args: z.infer<typeof entradaLigarResposta>, ctx: ContextoAcao): Promise<Preparo> {
  const g = await grupoDaEmpresa(args.grupoId);
  const tipo = tipoEfetivo(g);
  if (args.ligado) {
    const motivo = motivoParaNaoLigar(g);
    if (motivo) throw new RecusaAcao(`Não dá para ligar a minha resposta no grupo ${nomeDoGrupo(g)}: ${motivo}. Nada foi feito.`, { comDados: true });
  }
  const [geral] = await emTransacaoSomenteLeitura(() => bancoDaLeitura().select({ ligado: doloresMarcacoesConfig.responderLigado }).from(doloresMarcacoesConfig).where(eq(doloresMarcacoesConfig.id, 1)).limit(1));
  const cat = categoriaDoTipo(tipo);
  const aviso = args.ligado && !geral?.ligado ? " Atenção: a resposta em grupos está desligada no geral; nada muda lá até ela ser ligada em Integrações › Dolores." : "";
  const frase = `${args.ligado ? "liguei" : "desliguei"} a minha resposta quando me marcarem no grupo ${nomeDoGrupo(g)}`;
  const resumo = resumoDaFila(`${prefixoDaFila(ctx.motivoContaminacao)}${args.ligado ? "ligar" : "desligar"} a minha resposta quando me marcarem no grupo ${nomeDoGrupo(g)} (tipo ${ROTULO_TIPO_GRUPO[tipo]})${args.ligado && cat ? ` — o que eu respondo lá: ${cat.explica}` : ""}.${aviso}`);
  return { itens: [{ alvo: `grupo:${g.id}:resposta`, resumo, argumentos: { grupoId: g.id, ligado: args.ligado, tipo, frase } }], recusados: [] };
}

export async function executarLigarAprovado(args: z.infer<typeof entradaLigarAprovado>, ctx: ContextoAcao): Promise<ResultadoAcao> {
  soPeloWhatsapp(ctx);
  const g = await grupoDaEmpresa(args.grupoId);
  if (args.ligado) {
    const motivo = motivoParaNaoLigar(g);
    if (motivo) throw new RecusaAcao(`Não liguei: ${motivo}. Nada mudou.`);
    // o nível ("pode" ou "confirmo") foi decidido pelo tipo de antes: tipo diferente agora → nada muda
    if (tipoEfetivo(g) !== args.tipo) throw new RecusaAcao("O tipo do grupo mudou depois da proposta; nada mudou. Peça de novo.");
  }
  await definirRespostaDoGrupo(g.id, args.ligado, null);
  return { dados: { grupoId: g.id, ligado: args.ligado }, resumo: { grupoId: g.id, ligado: args.ligado }, feitos: [args.frase] };
}
