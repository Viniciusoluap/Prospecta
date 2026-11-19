// EPIC-025 (Dolores, etapa 7) — grupos entram sozinhos, POR TIPO (regra do dono de 19/11/2026: "eu não quero ter que cadastrar
// grupo por grupo; todos os grupos que a Dolores participar é porque ela deve participar"). Regras puras, sem banco nem rede:
// - O tipo do grupo é descoberto POR CÓDIGO, pelo NOME do grupo (metadado do WhatsApp) — nunca pela IA, nunca pelo texto das
//   mensagens. Nome com Jurídico/Administrativo/Parceiros/Engenharia (palavra inteira, sem acento nem caixa) → grupo interno
//   daquele tipo; senão, nome igual ao de UM ÚNICO cliente do CRM (ou contendo o nome completo dele) → cliente, ou pós-atendimento
//   se o nome também tiver "pós"/"pós-atendimento"/"pós venda". Dois clientes, nenhum, nome curto → indefinido (o dono decide).
// - O comando do dono para corrigir ("grupo <código> <tipo> [nº]") é reconhecido por CÓDIGO: a mensagem inteira, regex estrita.
// - O aviso ao dono é montado pelo SISTEMA (nome do grupo e do cliente são texto de terceiro: limpos e entre aspas angulares).
import { limparNomeDeTerceiro } from "./operacao.js";

export const TIPOS_GRUPO = ["cliente", "pos_atendimento", "juridico", "administrativo", "parceiros", "engenharia", "indefinido"] as const;
export type TipoGrupo = (typeof TIPOS_GRUPO)[number];
export const ORIGENS_GRUPO = ["manual", "automatico"] as const;
export type OrigemGrupo = (typeof ORIGENS_GRUPO)[number];
export const SITUACOES_CONFIRMACAO = ["confirmado", "avisado", "aguardando_dono"] as const;
export type SituacaoConfirmacao = (typeof SITUACOES_CONFIRMACAO)[number];

export const ROTULO_TIPO_GRUPO: Record<TipoGrupo, string> = {
  cliente: "cliente", pos_atendimento: "pós-atendimento", juridico: "jurídico", administrativo: "administrativo (sócios)",
  parceiros: "parceiros comerciais", engenharia: "engenharia", indefinido: "não identificado",
};
export const ROTULO_SITUACAO_CONFIRMACAO: Record<SituacaoConfirmacao, string> = {
  confirmado: "confirmado", avisado: "avisado ao dono", aguardando_dono: "aguardando o dono",
};

/** Padrões da entrada automática (os mesmos da migração 0133). */
export const PADRAO_ENTRADA = { entradaAutomaticaLigada: true, tetoGruposNovosDia: 20, tetoAvisosGruposDia: 25 } as const;
export const LIMITES_ENTRADA = { tetoGruposNovosDia: { min: 0, max: 200 }, tetoAvisosGruposDia: { min: 0, max: 200 } } as const;

/**
 * Tipo que vale para um grupo. Grupos cadastrados à mão antes da etapa 7 têm o tipo vazio (a migração não preenche em massa): com
 * cliente ligado valem como "cliente", com obra como "engenharia" e, sem vínculo, continuam como na etapa 4 — grupo de cliente
 * "sem card ainda" (o admin o cadastrou como grupo de cliente; o card vem pela fila). Grupo que entra sozinho sempre tem o tipo
 * gravado (o que não bate com nada nasce "indefinido").
 */
export function tipoEfetivo(g: { tipo?: string | null; leadId: number | null; obraId: number | null }): TipoGrupo {
  if (g.tipo && (TIPOS_GRUPO as readonly string[]).includes(g.tipo)) return g.tipo as TipoGrupo;
  if (g.tipo) return "indefinido"; // valor desconhecido: falha fechada (só observa)
  return g.obraId ? "engenharia" : "cliente";
}

// ── 1) Normalização do nome ──

/** Sem acento, minúsculo, só letras/dígitos separados por um espaço. */
export function normalizarNome(s: string | null | undefined): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
const palavras = (n: string) => (n ? n.split(" ") : []);
const letras = (n: string) => n.replace(/[^a-z]/g, "").length;

/** Nome de cliente bom o bastante para ligar sozinho: pelo menos 2 palavras e 6 letras. */
export const MIN_PALAVRAS_NOME = 2;
export const MIN_LETRAS_NOME = 6;
export const nomeLigavel = (normalizado: string) => palavras(normalizado).length >= MIN_PALAVRAS_NOME && letras(normalizado) >= MIN_LETRAS_NOME;

/** Palavras dos tipos internos (palavra inteira, já normalizada). */
const INTERNOS: Array<[Exclude<TipoGrupo, "cliente" | "pos_atendimento" | "indefinido">, readonly string[]]> = [
  ["juridico", ["juridico"]],
  ["administrativo", ["administrativo"]],
  ["parceiros", ["parceiros", "parceiro"]],
  ["engenharia", ["engenharia"]],
];
/** "pós", "pós-atendimento", "pós venda", "pós-venda", "posvenda" (já normalizados). */
const POS = new Set(["pos", "posvenda", "posatendimento"]);
/** Palavras que só indicam pós-atendimento (saem antes de comparar com o nome do cliente). */
const PALAVRAS_POS = new Set(["pos", "posvenda", "posatendimento", "venda", "vendas", "atendimento"]);

export type ClienteParaTipo = { id: number; nome: string | null };
export type TipoDescoberto = { tipo: TipoGrupo; leadId: number | null; motivo: string };

/**
 * Descobre o tipo do grupo pelo NOME do WhatsApp. Puro e determinístico. `clientes` = clientes ATIVOS do CRM (id e nome).
 * Homônimos, mais de um cliente casando, nome curto ou nada casando → "indefinido" (nunca liga sozinho na dúvida).
 */
export function descobrirTipoDoGrupo(nomeDoGrupo: string | null | undefined, clientes: readonly ClienteParaTipo[]): TipoDescoberto {
  const n = normalizarNome(nomeDoGrupo);
  if (!n) return { tipo: "indefinido", leadId: null, motivo: "grupo sem nome" };
  const ps = palavras(n);
  const internos = INTERNOS.filter(([, chaves]) => chaves.some(c => ps.includes(c))).map(([t]) => t);
  if (internos.length > 1) return { tipo: "indefinido", leadId: null, motivo: "nome com mais de um tipo interno" };
  if (internos.length === 1) return { tipo: internos[0], leadId: null, motivo: "nome com a palavra do tipo interno" };
  const pos = ps.some(p => POS.has(p)) || /\bpos (venda|vendas|atendimento)\b/.test(n);
  // o nome sem as palavras de pós-atendimento é o que precisa bater com o cliente
  const nucleo = ps.filter(p => !(pos && PALAVRAS_POS.has(p))).join(" ");
  if (!nomeLigavel(nucleo)) return { tipo: "indefinido", leadId: null, motivo: "nome do grupo curto demais para ligar a um cliente" };
  const comEspaco = ` ${nucleo} `;
  const casados = new Set<number>();
  for (const c of clientes) {
    const nc = normalizarNome(c.nome);
    if (!nc || !nomeLigavel(nc)) continue;
    if (nucleo === nc || comEspaco.includes(` ${nc} `)) casados.add(c.id);
  }
  if (casados.size > 1) return { tipo: "indefinido", leadId: null, motivo: "o nome bate com mais de um cliente do CRM" };
  if (casados.size === 0) return { tipo: "indefinido", leadId: null, motivo: "o nome não bate com nenhum cliente do CRM nem com um tipo interno" };
  const [leadId] = Array.from(casados);
  return { tipo: pos ? "pos_atendimento" : "cliente", leadId, motivo: pos ? "nome de um único cliente, com pós-atendimento" : "nome de um único cliente do CRM" };
}

// ── 2) Código curto do grupo (gerado pelo servidor) ──

/** Sem letras/dígitos que se confundem (0/O, 1/I/L, 5/S, 8/B). */
export const ALFABETO_CODIGO_GRUPO = "ACDEFGHJKMNPRTUVWXY234679";
export const TAMANHO_CODIGO_GRUPO = 4;
const CODIGO_GRUPO = new RegExp(`^[${ALFABETO_CODIGO_GRUPO}]{${TAMANHO_CODIGO_GRUPO}}$`);
export const codigoDeGrupoValido = (c: unknown): c is string => typeof c === "string" && CODIGO_GRUPO.test(c);
/** `aleatorio` devolve números em [0, 1) (crypto no servidor). */
export function gerarCodigoDeGrupo(aleatorio: () => number): string {
  let c = "";
  for (let i = 0; i < TAMANHO_CODIGO_GRUPO; i++) c += ALFABETO_CODIGO_GRUPO[Math.floor(aleatorio() * ALFABETO_CODIGO_GRUPO.length) % ALFABETO_CODIGO_GRUPO.length];
  return c;
}

// ── 3) O comando do dono ──

export type DecisaoDeGrupo = { codigo: string; tipo: Exclude<TipoGrupo, "indefinido">; numero: number | null } | { codigo: string; tipo: "ignorar"; numero: null };

const TIPO_DO_COMANDO: Record<string, Exclude<TipoGrupo, "indefinido"> | "ignorar"> = {
  cliente: "cliente", pos: "pos_atendimento", "pos atendimento": "pos_atendimento", "pos venda": "pos_atendimento", posvenda: "pos_atendimento",
  juridico: "juridico", administrativo: "administrativo", parceiros: "parceiros", parceiro: "parceiros", engenharia: "engenharia", ignorar: "ignorar",
};
// a mensagem INTEIRA (já normalizada: sem acento, minúscula, pontuação virou espaço): "grupo <código> <tipo> [nº]"
const COMANDO = /^grupo ([a-z0-9]{4}) (cliente|pos atendimento|pos venda|posvenda|pos|juridico|administrativo|parceiros|parceiro|engenharia|ignorar)(?: (?:n|no|numero)? ?(\d{1,9}))?$/;

/**
 * "grupo K7QM cliente 456", "grupo K7QM pós 456", "grupo K7QM jurídico", "grupo K7QM engenharia 12" (obra nº 12, opcional),
 * "grupo K7QM ignorar". Só a mensagem inteira; cliente e pós exigem o nº do cliente; jurídico, administrativo, parceiros e
 * ignorar não aceitam número. Qualquer outra coisa → null (a mensagem segue o caminho normal).
 */
export function lerDecisaoDeGrupo(texto: string | null | undefined): DecisaoDeGrupo | null {
  const bruto = String(texto ?? "");
  if (bruto.length > 80 || /[\r\n]/.test(bruto)) return null;
  const n = normalizarNome(bruto.replace(/[º°]/g, " "));
  const m = COMANDO.exec(n);
  if (!m) return null;
  // código fora do alfabeto ainda é o comando (o dono errou o código): a resposta é "não achei", nunca a IA
  const codigo = m[1].toUpperCase();
  const tipo = TIPO_DO_COMANDO[m[2]];
  const numero = m[3] ? Number(m[3]) : null;
  if (numero !== null && (!Number.isSafeInteger(numero) || numero <= 0 || numero > 2_147_483_647)) return null;
  if (tipo === "cliente" || tipo === "pos_atendimento") return numero ? { codigo, tipo, numero } : null;
  if (tipo === "engenharia") return { codigo, tipo, numero };
  if (numero !== null) return null;
  return { codigo, tipo, numero: null };
}

// ── 4) O aviso ao dono (texto do SISTEMA) ──

const entreAspas = (s: string | null | undefined, padrao: string) => {
  const t = limparNomeDeTerceiro(s);
  return t ? `«${t}»` : padrao;
};
const OPCOES = (codigo: string) =>
  `grupo ${codigo} cliente <nº> | grupo ${codigo} pós <nº> | grupo ${codigo} jurídico | grupo ${codigo} administrativo | grupo ${codigo} parceiros | grupo ${codigo} engenharia | grupo ${codigo} ignorar`;

/** Aviso de grupo novo. Tipo conhecido: "Entendi: …; se estiver errado, responda …". Indefinido: pergunta e fica em silêncio. */
export function textoDoAvisoDeEntrada(p: { nomeDoGrupo: string | null; codigo: string; tipo: TipoGrupo; cliente?: { id: number; nome: string | null } | null }): string {
  const grupo = entreAspas(p.nomeDoGrupo, "(sem nome)");
  if (p.tipo === "indefinido") {
    return `Dolores: entrei no grupo ${grupo} e não consegui saber de que tipo ele é. Enquanto você não responder, só observo — não falo nada lá, nem se me marcarem. Responda uma destas: ${OPCOES(p.codigo)}`;
  }
  const entendi = (p.tipo === "cliente" || p.tipo === "pos_atendimento") && p.cliente
    ? `${ROTULO_TIPO_GRUPO[p.tipo]} ${entreAspas(p.cliente.nome, "(sem nome)")} (nº ${p.cliente.id})`
    : `grupo ${ROTULO_TIPO_GRUPO[p.tipo]}`;
  return `Dolores: entrei no grupo ${grupo}. Entendi: ${entendi}. Se estiver errado, responda: ${OPCOES(p.codigo)}`;
}

/** Aviso único do dia quando o teto de grupos novos foi atingido. */
export const avisoDoTetoDeEntrada = (teto: number) =>
  `Dolores: hoje já entrei em ${teto} grupos novos (o teto do dia). Os próximos grupos novos de hoje ficam de fora — não leio nem falo neles — até amanhã, ou até você aumentar o teto em Dolores › Grupos.`;
