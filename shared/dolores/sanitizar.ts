// EPIC-025 (Dolores) — filtro de dados pessoais em TEXTO LIVRE (anotações, mensagens, títulos, observações), aplicado
// pela ponte a TODA string que sai para o agente, aos argumentos guardados na auditoria e à resposta ao dono no WhatsApp.
// Melhor esforço: pega os formatos comuns; não garante achar tudo o que alguém escreveu à mão. Campos estruturados já
// mascarados ("***.***.***-01", "(99) *****-4567") passam intactos (não têm a sequência de dígitos).
//
// Normalização (só o que serve para disfarçar): dígitos e sinais de largura total (１２３, ＠, ＋), invisíveis (zero-width,
// U+FEFF, hífen suave), hífens tipográficos entre dígitos e dígitos de outras escritas viram ASCII. O resto do texto
// (acentos, "m²", "nº", travessão na prosa) não muda. Grupos de dígitos ligados por até 3 caracteres de
// [espaço . - _ / ( ) | · • :] (ou por vários espaços) formam uma "cadeia".
//
// COMO DECIDE — duas fases, NESTA ORDEM (QA r4, S1: cada exceção que olhava rótulo abriu um vazamento novo).
//
//  FASE 1 — MASCARAR SEM EXCEÇÃO. Sai sempre, com qualquer rótulo antes ("nota", "chave", "protocolo", "valor"…), com
//  qualquer separação, sozinho ou dentro de uma cadeia maior (janela deslizante sobre os grupos da cadeia):
//    - CPF com dígito verificador válido; CNPJ válido;
//    - celular: 11 dígitos com DDD e 9; 10 com DDD e 6–9; 9 começando por 9; 8 começando por 6–9 com forma de telefone
//      (4-4, 1-3-4, ou colado depois de palavra de telefone);
//    - e-mail (inclusive "a @ b . com", "a arroba b ponto com", "a(at)b(dot)com").
//  Nenhum rótulo, nenhuma unidade de medida e nenhum reconhecimento de "documento" pelo rótulo livra esses.
//  Única ressalva, que é estrutura e não rótulo: valor em reais com centavos ("R$ 99991234567,50", "999.123.456,00").
//
//  FASE 2 — PRESERVAR documentos reconhecidos POR ESTRUTURA COMPLETA.
//   2a. Estrutura validada por inteiro: o trecho fica e a fase 1 não se aplica a ele.
//       QA r5 F1: a isenção só vale quando a FORMA ESCRITA também é a do documento — nunca basta os dígitos fecharem.
//       - Chave de acesso da NF-e (44 dígitos): DV módulo 11 válido E UF 11–53 E mês 01–12 E CNPJ válido nas posições
//         7–20 E modelo 55 ou 65, e só em 44 colados ou 11 blocos de 4 com o mesmo separador (" " ou "."). O rótulo
//         ("nota", "chave", "acesso", "nf-e", "danfe") sozinho NÃO isenta.
//       - Linha digitável de boleto (47 dígitos, moeda 9): "5.5 5.6 5.6 1 14" com os pontos, ou "10 11 11 1 14" só se o
//         DV geral do código de barras também fechar; sempre com o DV módulo 10 de CADA campo. Se não validar, fase 1.
//       - QA r5 F2: guia de arrecadação (IPTU, água, luz; 48 dígitos começando por 8): "48", "12 12 12 12" ou
//         "11-1 11-1 11-1 11-1" com separadores uniformes e o DV (módulo 10/11 pelo 3º dígito) de CADA bloco válido.
//       - Travas: palavra de telefone/contato/CPF nos ~50 caracteres antes, "(" ou "+" antes, parênteses ou hífen entre
//         os grupos, ou forma explícita de CPF/telefone dentro do trecho: não isenta.
//       - Código de barras de 44 dígitos colado é um grupo só: a fase 1 nunca acha nada dentro dele, então já fica.
//   2b. Só o que a fase 1 NÃO achou: telefone fixo (2–5), número de 11 dígitos sem forma conhecida ("na dúvida") e o
//       resto. Aqui o rótulo decide: documento (processo, protocolo, matrícula, nota fiscal, lote, quadra, R$…) ou
//       unidade de medida depois livram o fixo; par 4-4 começando por 2–5 também fica com rótulo de quantidade/valor/
//       faixa (valor, total, orçamento, renda, estoque, itens…) e na faixa crescente "2500-3000" (os dois terminando em
//       00). Palavra de telefone (tel, fone, celular, whats, zap, contato, ligar, recado) nos ~50 caracteres antes:
//       nada livra. Anos (2024-2026), datas, CEP, processo CNJ e valores com milhar/centavos ficam.
//  Chave de 44 dígitos que NÃO validou e tem algo achado dentro sai inteira (nunca pela metade).
//
// Senha: senha/password/token/pin/OTP mascaram a oração; "código" só com senha/acesso/token/OTP por perto ("código de
// barras", "código do imóvel" ficam). Banco: agência/conta/c/c com número de conta (3+ dígitos, não um ano, não valor
// com centavos); PIX só quando o que segue tem forma de chave (e-mail, CPF/CNPJ/telefone, chave aleatória) — "pix
// 1.500,00" fica. Na dúvida real, sai: o marcador é visível, e a Dolores nunca apresenta número alterado como dado.
import { isValidCPF } from "../cpf.js";

export const OMITIDO = "[dado pessoal omitido]";
export const SENHA_OMITIDA = "[senha omitida]";
export const BANCARIO_OMITIDO = "[dado bancário omitido]";

function cnpjValido(d: string): boolean {
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const dv = (base: string, pesos: number[]) => {
    const s = pesos.reduce((t, p, i) => t + Number(base[i]) * p, 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return dv(d, p1) === Number(d[12]) && dv(d, [6, ...p1]) === Number(d[13]);
}

/** Dígito verificador (módulo 11, pesos 2–9 da direita) da chave de acesso de 44 dígitos da NF-e. */
function chaveNfeValida(d: string): boolean {
  if (d.length !== 44 || /^(\d)\1+$/.test(d)) return false;
  let soma = 0, peso = 2;
  for (let k = 42; k >= 0; k--) { soma += Number(d[k]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const resto = soma % 11;
  return (resto < 2 ? 0 : 11 - resto) === Number(d[43]);
}

/**
 * QA r4 S1 / r5 F1: chave de NF-e reconhecida pela ESTRUTURA INTEIRA — DV, UF 11–53, mês 01–12, CNPJ do emitente válido
 * (posições 7–20), modelo 55/65 — e só na FORMA ESCRITA de chave: 44 dígitos colados ou 11 blocos de 4 (DANFE). Uma
 * lista de celulares "(15) 95115-9890 …" ou de CPFs "ddd ddd ddd dd" que fecha os DVs por acaso não é chave.
 * Os separadores (conferidos em documentosValidados) têm de ser todos iguais: só " " ou ".". Rótulo não conta.
 */
export function chaveNfeEstrutural(d: string, forma: string): boolean {
  if (!FORMAS_CHAVE_NFE.has(forma) || !chaveNfeValida(d)) return false;
  const uf = Number(d.slice(0, 2)), mes = Number(d.slice(4, 6)), modelo = d.slice(20, 22);
  return uf >= 11 && uf <= 53 && mes >= 1 && mes <= 12 && (modelo === "55" || modelo === "65") && cnpjValido(d.slice(6, 20));
}

/** Módulo 10 (pesos 2,1 da direita; produto > 9 soma os algarismos) — DV de cada campo da linha digitável. */
function mod10(base: string): number {
  let soma = 0, peso = 2;
  for (let k = base.length - 1; k >= 0; k--) {
    const v = Number(base[k]) * peso;
    soma += v > 9 ? v - 9 : v;
    peso = peso === 2 ? 1 : 2;
  }
  return (10 - (soma % 10)) % 10;
}

const FORMAS_CHAVE_NFE = new Set(["44", "4,4,4,4,4,4,4,4,4,4,4"]);

/** QA r5 F1: DV geral (módulo 11, pesos 2–9) do código de barras de 44 dígitos remontado a partir da linha digitável. */
function dvGeralDoBoleto(d: string): boolean {
  const barras = d.slice(0, 4) + d.slice(33) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31); // sem a posição 5 (o DV)
  let soma = 0, peso = 2;
  for (let k = barras.length - 1; k >= 0; k--) { soma += Number(barras[k]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const dv = 11 - (soma % 11);
  return (dv === 0 || dv > 9 ? 1 : dv) === Number(d[32]);
}

/**
 * QA r4 S2 / r5 F1: linha digitável de boleto (47 dígitos, moeda "9" na 4ª posição) com o DV de CADA um dos três campos
 * válido, e só nas formas escritas do boleto: 47 colados, "5.5 5.6 5.6 1 14" (com os pontos, conferidos em
 * documentosValidados) ou os campos colados "10 11 11 1 14" — esta última, que uma lista de telefones também tem, só
 * quando o DV geral do código de barras remontado também fecha.
 */
export function linhaDigitavelValida(d: string, forma: string): boolean {
  if (d.length !== 47 || d[3] !== "9") return false;
  if (forma !== "47" && forma !== "5,5,5,6,5,6,1,14" && forma !== "10,11,11,1,14") return false;
  if (mod10(d.slice(0, 9)) !== Number(d[9]) || mod10(d.slice(10, 20)) !== Number(d[20]) || mod10(d.slice(21, 31)) !== Number(d[31])) return false;
  return forma !== "10,11,11,1,14" || dvGeralDoBoleto(d);
}

// ── 1. Normalização ──
// Invisíveis: o ZWJ (U+200D) só fica quando junta emojis (família, profissões); nos outros lugares sai.
const INVISIVEIS = new RegExp("[\\u200B\\u200C\\u2060-\\u2064\\uFEFF\\u00AD\\u180E\\u034F]|(?<!\\p{Extended_Pictographic}\\uFE0F?)\\u200D", "gu");
const LARGURA_TOTAL = /[\uFF01-\uFF5E]/g;
const DIGITOS_MATEMATICOS = new RegExp("[\\u{1D7CE}-\\u{1D7FF}]", "gu");
/** QA r4 S6: dígitos sobrescritos e circulados — só em sequência de 4 ou mais ("m²" e "nº" não mudam). */
const DIGITOS_ENFEITADOS = /[\u2070\u00B9\u00B2\u00B3\u2074-\u2079\u2460-\u2468\u24EA]{4,}/g;
const HIFEN_ENTRE_DIGITOS = /(?<=\d\s{0,3})[\u2010-\u2015\u2212\uFE58\uFE63](?=\s{0,3}\d)/g; // QA r4 S6: "99123  –  4567"
/** QA r3 (informativo): dígitos de outras escritas (árabe-índico, persa, devanágari, bengali…) viram 0–9. */
const OUTROS_DIGITOS = new RegExp("\\p{Nd}", "gu");
const ZEROS_DE_ESCRITAS = [
  0x0660, 0x06F0, 0x07C0, 0x0966, 0x09E6, 0x0A66, 0x0AE6, 0x0B66, 0x0BE6, 0x0C66, 0x0CE6, 0x0D66, 0x0DE6, 0x0E50, 0x0ED0,
  0x0F20, 0x1040, 0x1090, 0x17E0, 0x1810, 0x1946, 0x19D0, 0x1A80, 0x1A90, 0x1B50, 0x1BB0, 0x1C40, 0x1C50, 0xA620, 0xA8D0,
  0xA900, 0xA9D0, 0xA9F0, 0xAA50, 0xABF0, 0x1E950, // QA r4 S6: Adlam
];
function digitoAscii(c: string): string {
  const cp = c.codePointAt(0)!;
  for (const z of ZEROS_DE_ESCRITAS) if (cp >= z && cp < z + 10) return String(cp - z);
  return c;
}

/** Tira os disfarces mais comuns de números e e-mails (ver o cabeçalho). Exportada para os testes. */
export function normalizarParaFiltro(texto: string): string {
  return texto
    .replace(INVISIVEIS, "")
    .replace(LARGURA_TOTAL, c => c.normalize("NFKC"))
    .replace(DIGITOS_MATEMATICOS, c => c.normalize("NFKC"))
    .replace(DIGITOS_ENFEITADOS, c => c.normalize("NFKC"))
    .replace(OUTROS_DIGITOS, c => (c.length === 1 && c.charCodeAt(0) < 0x80 ? c : digitoAscii(c)))
    .replace(HIFEN_ENTRE_DIGITOS, "-");
}

// ── Senha, banco, e-mail e os formatos canônicos (sempre saem) ──
const FIM_DA_ORACAO = "(?=[;\\n]|[.,!?](?:\\s|$)|$)";
// Palavra de senha: tudo até o fim da oração (ponto, ponto e vírgula, vírgula, quebra de linha).
const SENHA = new RegExp(`\\b(senhas?|password|passwd|token|pin|otp)\\b.*?${FIM_DA_ORACAO}`, "gi");
// QA r4 S5: "código" só é senha com senha/acesso/token/OTP por perto (40 caracteres depois ou 30 antes). "Código de
// barras", "código do imóvel 12345" ficam. A palavra sozinha não consome a oração (uma senha mais adiante ainda sai).
const CODIGO = new RegExp(
  "\\b(c[oó]digos?)\\b(?:(?=[^.;,\\n]{0,40}?\\b(?:senhas?|acesso|token|otp)\\b)|(?<=\\b(?:senhas?|acesso|token|otp)\\b[^.;\\n]{0,30}c[oó]digos?))"
  + `.*?${FIM_DA_ORACAO}`,
  "gi",
);
// Agência e conta: o rótulo fica, o número sai. QA r4 S3: o número começa logo depois do rótulo e é limitado (antes, um
// lookahead varria a palavra inteira a cada rótulo: "ag-ag-…" de 200 kB levava 20 s). QA r4 S5: só número de conta
// (3+ dígitos, não um ano, não valor com centavos): "cc 2 cópias", "conta 2026", "conta 1.500,00" ficam.
const BANCO = /\b(ag[eê]ncia|ag|conta(?:\s+corrente|\s+poupan[cç]a)?|c\/c|cc)\b(\s*(?:n[ºo°.]?|:|#|-)?\s*)(\d[\d.\-/]{0,30}[\dxX]?)(,\d)?/gi;
// PIX: QA r4 S5 — só quando o que segue tem forma de chave: e-mail, chave aleatória (uuid) ou 8–14 dígitos (CPF, CNPJ,
// telefone). "pagou via pix 1.500,00" fica (é o valor da cobrança).
const PIX = /\b(chave\s+pix|pix)\b(\s*(?:n[ºo°.]?|:|#|-|=)?\s*)([\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){0,6}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\+?\(?\d[\d.\-/() ]{6,24}\d)/gi;
// E-mail: "a@b.com", "a @ b.com", "a[at]b.com", "a (arroba) b.com" e, colado, sem domínio de topo ("a@b").
// QA r3 R4: o nome só começa no início de uma "palavra" de [\w.+-] (lookbehind). Sem a âncora, cada posição de uma
// sequência longa sem "@" (200 kB de dígitos, "12.12.…", "aaa…a1") tentava de novo até o fim: tempo quadrático (~60 s).
const EMAIL = /(?<![\w.+-])[\w.+-]+(?:\s?@\s?|\s?[[(]\s?(?:at|arroba)\s?[\])]\s?)[\w-]+(?:\.[\w-]+)+|(?<![\w.+-])[\w.+-]+@[\w-]+/gi;
// QA r4 S6: e-mail disfarçado com espaços ou por extenso ("fulano @ gmail . com", "fulano arroba gmail ponto com",
// "fulano(at)gmail(dot)com"). Exige domínio de topo conhecido no fim (senão "a arroba de café" viraria e-mail).
const ARROBA = "(?:\\s{0,3}@\\s{0,3}|\\s{0,3}[[(]\\s{0,3}(?:at|arroba)\\s{0,3}[\\])]\\s{0,3}|\\s{1,3}(?:at|arroba)\\s{1,3})";
const PONTO = "(?:\\s{0,3}\\.\\s{0,3}|\\s{0,3}[[(]\\s{0,3}(?:dot|ponto)\\s{0,3}[\\])]\\s{0,3}|\\s{1,3}(?:dot|ponto)\\s{1,3})";
const EMAIL_DISFARCADO = new RegExp(
  `(?<![\\w.+-])[\\w.+-]{1,64}${ARROBA}[\\w-]{1,63}(?:${PONTO}[\\w-]{1,63}){0,4}${PONTO}(?:com|br|net|org|gov|edu|io|me|info|biz|co)\\b`,
  "gi",
);
const CPF_FORMATADO = /(?<!\d)\d{3}[.,]\d{3}[.,]\d{3}[-.]?\d{2}(?!\d)/g;
const CNPJ_FORMATADO = /(?<!\d)\d{2}\.\d{3}\.\d{3}\/\d{4}-?\d{2}(?!\d)/g;
// QA r4 S6: "529982247,25" (vírgula antes do DV) — só quando o CPF é válido e não há "R$" logo antes.
const CPF_VIRGULA = /(?<![\d.,])(\d{9}),(\d{2})(?![\d,])/g;

// ── 2. Cadeias de dígitos ──
const GRUPO = /\d+/g;
/**
 * O que pode ficar entre dois grupos da mesma cadeia. Vírgula não entra: é o decimal ("R$ 1.234,56"). "/" e "|" ligam,
 * mas só valem dentro de telefone quando há palavra de telefone antes (datas e tabelas não viram telefone). "10:30-11:45"
 * liga, mas grupos de 2 no meio nunca são telefone nem CPF.
 */
const LIGACAO = /^(?:[\s._\-/()|·•:]{1,3}|\s{1,8}[._\-/|·•:]?\s{0,8})$/; // QA r4 S6: "·", "•", ":" e 4+ espaços
/**
 * Rótulo logo antes que diz o que o número é: a sequência de 11 dígitos sem forma conhecida fica (celular, CPF e CNPJ
 * válidos saem mesmo assim).
 */
const CONTEXTO_NAO_PESSOAL = new RegExp(
  "\\b(protocolos?|processos?|autos|matr[ií]culas?|requerimentos?|inscri[cç](?:[aã]o|[oõ]es)(?:\\s+imobili[aá]rias?)?|guias?|boletos?|"
  + "notas?\\s+fisca(?:l|is)|nf-?e?|nfs-?e|cupom|pedidos?|contratos?|[aá]reas?|valor(?:es)?|totais?|total|r\\$|lotes?|quadras?|unidades?|"
  + "casas?|apartamentos?|anos?|per[ií]odos?|c[oó]digo\\s+de\\s+barras|cep)\\s*(?:n[º°o.]*\\s*)?[:#-]?\\s*$",
  "i",
);
/**
 * QA r3 R1: para a FORMA DE TELEFONE FIXO, só rótulo de documento livra. Casa, apartamento, unidade, valor, total, ano e
 * pedido não livram ("fone casa 3523-4567", "unidade 3523 4567" são telefones): na dúvida entre vazar e mascarar, mascara.
 */
const CONTEXTO_NAO_TELEFONE = new RegExp(
  "\\b(protocolos?|processos?|autos|matr[ií]culas?|requerimentos?|inscri[cç](?:[aã]o|[oõ]es)(?:\\s+(?:imobili[aá]rias?|municipa(?:l|is)))?|iptu|guias?|boletos?|"
  + "notas?\\s+fisca(?:l|is)|nf-?e?|nfs-?e|cupom|contratos?|[aá]reas?|r\\$|lotes?|quadras?|per[ií]odos?|c[oó]digo\\s+de\\s+barras|cep)"
  + "\\s*(?:n[º°o.]*\\s*)?[:#-]?\\s*$",
  "i",
);
/**
 * QA r4 S4: rótulo de QUANTIDADE/VALOR/FAIXA logo antes livra o par 4-4 de fixo (2–5) — "valor 3523 4567", "estoque:
 * 3500 4200", "faixa de renda 4000-5000". Celular (6–9) não é afetado: sai sempre (fase 1).
 */
const ROTULO_QUANTIDADE = new RegExp(
  "\\b(valor(?:es)?|totais|total|r\\$|pre[cç]os?|custos?|or[cç]amentos?|rendas?|faixas?|quantidades?|qtde?|estoques?|itens|"
  + "parcelas?|saldos?|lotes?|quadras?)\\s*(?:de\\s+)?(?:n[º°o.]*\\s*)?[:#-]?\\s*$",
  "i",
);
/** QA r3 R1: palavra de telefone nos ~50 caracteres antes — nenhum rótulo nem unidade livra o número. */
const CONTEXTO_TELEFONE = /\b(?:tel(?:efone)?s?|fones?|cel|celular(?:es)?|whats\w*|zap\w*|wpp|contatos?|lig(?:ar|ue|uem|a|ou)|recados?)\b/i;
/** Unidade logo depois: é medida, não documento nem telefone. */
const UNIDADE_DEPOIS = /^\s?(?:m²|m2|cm²|cm2|km²|km2|m³|m3|ha|metros|km|kg|toneladas|litros|un\b|unidades|reais|centavos)/i;
const ANO = /^(?:19|20)\d\d$/;

type Grupo = { inicio: number; fim: number; digitos: string };
type Achado = { tipo: "cpf" | "cnpj" | "celular" | "fixo" | "duvida"; };

const formaDe = (gs: Grupo[]) => gs.map(g => g.digitos.length).join(",");
const FORMAS_CPF = new Set(["11", "9,2", "3,3,3,2", "3,3,5", "3,8"]);
const FORMAS_CNPJ = new Set(["14", "12,2", "8,6", "8,4,2", "2,3,3,4,2", "2,3,3,6", "2,6,4,2", "2,3,3,4,1,1"]);

/** Telefone brasileiro plausível nos grupos (já sem barra entre eles). */
function telefone(gs: Grupo[], ligacoes: string[], maisAntes: boolean, contextoTel: () => boolean): "celular" | "fixo" | null {
  if (ligacoes.some(l => /[/|]/.test(l)) && !contextoTel()) return null;
  let g = gs.map(x => x.digitos);
  let ddi = maisAntes;
  // DDI: grupo "55" separado, ou colado num grupo único de 12/13 dígitos
  if (g.length > 1 && g[0] === "55") { g = g.slice(1); ddi = true; }
  else if (g.length === 1 && /^55\d{10,11}$/.test(g[0])) { g = [g[0].slice(2)]; ddi = true; }
  else if (maisAntes) return null; // "+" com outro código de país
  // Grupos curtos só onde o telefone os tem: DDD (2) no começo, "9" sozinho; o último grupo tem 4+ (ou 3-3-3).
  const tamanhos = g.map(x => x.length);
  const n = g.length;
  for (let i = 0; i < n; i++) {
    const t = tamanhos[i];
    if (t === 1 && g[i] !== "9") return null;
    if (t === 2 && i !== 0) return null;
  }
  const tresTresTres = n >= 3 && tamanhos.slice(-3).join(",") === "3,3,3";
  if (n > 1 && tamanhos[n - 1] < 4 && !tresTresTres) return null;
  const d = g.join("");
  const dddValido = /^[1-9][1-9]/.test(d);
  if (d.length === 11 && dddValido && d[2] === "9") return "celular";
  if (d.length === 10 && dddValido && /[2-9]/.test(d[2])) return /[6-9]/.test(d[2]) ? "celular" : "fixo";
  if (ddi) return null;
  if (d.length === 9 && d[0] === "9") return "celular";
  if (d.length === 8 && /[2-9]/.test(d[0])) {
    // QA r3 R1: 8 dígitos começando com 6–9 é celular antigo (sem o 9 na frente): sai sempre, como celular.
    const tipo = /[6-9]/.test(d[0]) ? "celular" : "fixo";
    if (n === 1) return contextoTel() ? tipo : null; // "fone 35234567"; sem palavra de telefone, 8 dígitos colados ficam
    if (g.every(x => ANO.test(x)) && !contextoTel()) return null; // "2024-2026", "anos 2024 2025"
    return tamanhos.join(",") === "4,4" || tamanhos.join(",") === "1,3,4" ? tipo : null;
  }
  return null;
}

/**
 * O que a sub-cadeia é, considerando o contexto antes e depois. null = fica. `lista` = início da cadeia quando os grupos
 * antes desta janela são todos de 4 dígitos ("lotes 3201 3202 3203": o rótulo da lista vale para o par do meio), senão -1.
 */
function classificar(gs: Grupo[], ligacoes: string[], texto: string, sozinho: boolean, lista = -1): Achado | null {
  const forma = formaDe(gs);
  const d = gs.map(g => g.digitos).join("");
  if (d.length === 11 && FORMAS_CPF.has(forma) && isValidCPF(d)) return { tipo: "cpf" };
  if (d.length === 14 && FORMAS_CNPJ.has(forma) && cnpjValido(d)) return { tipo: "cnpj" };
  const inicio = gs[0].inicio, fim = gs[gs.length - 1].fim;
  const antes = texto.slice(Math.max(0, inicio - 50), inicio);
  const maisAntes = /\+\s?\(?\s?$/.test(antes);
  // o contexto só é calculado quando decide (texto patológico com milhares de grupos não paga as regex à toa)
  let ctx: boolean | undefined;
  const contextoTelDe = () => (ctx ??= CONTEXTO_TELEFONE.test(antes));
  const tel = telefone(gs, ligacoes, maisAntes, contextoTelDe);
  const unicaInteira = sozinho && gs.length === 1;
  if (tel === null && !sozinho) return null;
  const contextoTel = contextoTelDe();
  const depois = texto.slice(fim, fim + 12);
  // Número com centavos ("999.123.456,00", "R$ 99991234567,50"): é valor. QA r3 R2: só vírgula + 1–2 dígitos ("tels
  // 99991234567,99987654321" é lista) e, se a forma é de celular, só quando o número tem cara de dinheiro (milhar com
  // ponto ou "R$" antes) — "tel (99) 99123-4567,1" sai.
  if (/^,\d{1,2}(?!\d)/.test(depois)) {
    const cara = /r\$\s*$/i.test(antes)
      || (gs.length > 1 && ligacoes.every(l => l === ".") && gs.slice(1).every(g => g.digitos.length === 3));
    if (tel === null || cara) return null;
  }
  const antesLimpo = antes.replace(/[(+\s]+$/, " ");
  const medida = !contextoTel && UNIDADE_DEPOIS.test(depois);
  const rotulado = !contextoTel && CONTEXTO_NAO_PESSOAL.test(antesLimpo) || medida;
  if (tel === "celular") return { tipo: "celular" };
  if (tel === "fixo") {
    // FASE 2b: o fixo (2–5) não é fase 1 — o rótulo de documento ou a medida depois livram (nunca com palavra de telefone)
    // QA r5 F3: palavra de telefone nos ~25 caracteres DEPOIS (na mesma linha) também cancela a isenção — "protocolo
    // 3523-4567 fone", "valor 3523 4567 (fone)"
    if (contextoTel || CONTEXTO_TELEFONE.test(texto.slice(fim, fim + 25).split(/[\n;]/)[0])) return { tipo: "fixo" };
    if (CONTEXTO_NAO_TELEFONE.test(antesLimpo) || medida) return null;
    if (forma === "4,4") {
      // QA r4 S4: par 4-4 sem DDD com rótulo de quantidade/valor/faixa, ou faixa crescente "2500-3000" (terminando em 00)
      if (ROTULO_QUANTIDADE.test(antesLimpo)) return null;
      const [a, b] = gs.map(g => g.digitos);
      if (/^\s?-\s?$/.test(ligacoes[0]) && a.endsWith("00") && b.endsWith("00") && Number(b) > Number(a)) return null;
      if (lista >= 0) {
        const antesDaLista = texto.slice(Math.max(0, lista - 50), lista);
        if (!CONTEXTO_TELEFONE.test(antesDaLista)) {
          const rotulo = antesDaLista.replace(/[(+\s]+$/, " ");
          if (ROTULO_QUANTIDADE.test(rotulo) || CONTEXTO_NAO_TELEFONE.test(rotulo)) return null;
        }
      }
    }
    return { tipo: "fixo" };
  }
  // Palavra de telefone antes e a cadeia inteira tem 8–13 dígitos sem cara de data ("fone 9912345678", "tel 9 9 1 2 3 4
  // 5 6 7"): na dúvida, sai.
  if (contextoTel && sozinho && !ligacoes.some(l => l.includes("/")) && !/^(?:2,2,4|4,2,2)$/.test(formaDe(gs))
    && !gs.every(g => ANO.test(g.digitos)) && d.length <= 13) return { tipo: "duvida" };
  // Sequência única, sem forma conhecida (só quando é a cadeia inteira: um pedaço de número maior não conta)
  if (unicaInteira) {
    if (d.length === 11 && !rotulado) return { tipo: "duvida" }; // CPF digitado errado ou celular: na dúvida, sai
    if ((d.length === 12 || d.length === 13) && d.startsWith("55") && !rotulado) return { tipo: "duvida" }; // telefone com DDI
  }
  return null;
}

/**
 * Pré-filtro barato (QA r4 S3): a janela [i..j] só pode ser CPF, CNPJ ou telefone se o último grupo tiver o tamanho
 * certo. Grupo de 1 dígito que não é "9" só existe no CNPJ "2,3,3,4,1,1". Evita classificar milhões de janelas em
 * texto patológico ("1 1 1 …", "9 9 9 …") — não muda o resultado: classificar() devolveria null para todas elas.
 */
function formaPossivel(tamanhos: number[], ruins: number[], i: number, j: number, total: number): boolean {
  const ultimo = tamanhos[j];
  if (ultimo === 1) return total === 14 && j - i === 5;
  if (ruins[j + 1] - ruins[i] > 0) return false;
  if (ultimo >= 4) return true;
  if (ultimo === 3) return j - i >= 2 && tamanhos[j - 1] === 3 && tamanhos[j - 2] === 3;
  return total === 11 || total === 14; // termina em 2: CPF "9,2"/"3,3,3,2" ou CNPJ
}

/**
 * FASE 2a: trechos da cadeia que são um documento validado por inteiro (chave de NF-e, linha digitável de boleto, guia de
 * arrecadação).
 * Devolve pares [i, j] de grupos, sem sobreposição. "|" separa células de tabela: não atravessa.
 */
function documentosValidados(c: Grupo[], tamanhos: number[], ligacoes: string[], soma: number[], texto: string): Array<[number, number]> {
  const r: Array<[number, number]> = [];
  for (let i = 0; i < c.length;) {
    let fim = -1;
    if (tamanhos[i] >= 2) {
      for (let j = i; j < c.length && j - i < 13 && soma[j + 1] - soma[i] <= 48; j++) {
        if (j > i && ligacoes[j - 1].includes("|")) break;
        const total = soma[j + 1] - soma[i];
        if (total !== 44 && total !== 47 && total !== 48) continue;
        const forma = tamanhos.slice(i, j + 1).join(",");
        const d = c.slice(i, j + 1).map(g => g.digitos).join("");
        const ligs = ligacoes.slice(i, j);
        const guia = total === 48 && guiaDeArrecadacaoValida(d, forma, ligs);
        const ok = guia || (total === 44
          ? chaveNfeEstrutural(d, forma) && separacaoDeChave(ligs)
          : total === 47 && linhaDigitavelValida(d, forma) && separacaoDeBoleto(forma, ligs));
        if (ok && !armadilhaDeTelefone(c, i, j, texto, guia && forma !== "48" && forma !== "12,12,12,12")) { fim = j; break; }
      }
    }
    if (fim >= 0) { r.push([i, fim]); i = fim + 1; } else i++;
  }
  return r;
}

/** QA r5 F1: chave de NF-e em blocos — todos os separadores iguais, só " " ou "." (numa única linha). */
function separacaoDeChave(ligs: string[]): boolean {
  return !ligs.length || ((ligs[0] === " " || ligs[0] === ".") && ligs.every(l => l === ligs[0]));
}

/**
 * QA r5 F1: linha digitável "5.5 5.6 5.6 1 14" — ponto dentro dos três campos e o MESMO espaço em branco entre os campos;
 * "10 11 11 1 14" — o mesmo espaço em branco (sem quebra de linha) entre todos.
 */
function separacaoDeBoleto(forma: string, ligs: string[]): boolean {
  if (!ligs.length) return true;
  if (forma === "5,5,5,6,5,6,1,14") {
    const entre = [ligs[1], ligs[3], ligs[5], ligs[6]];
    return ligs[0] === "." && ligs[2] === "." && ligs[4] === "." && /^\s{1,3}$/.test(entre[0]) && entre.every(l => l === entre[0]);
  }
  return /^ {1,3}$/.test(ligs[0]) && ligs.every(l => l === ligs[0]);
}

/** Módulo 11 da guia de arrecadação (pesos 2–9 da direita; resto 0 ou 1 → 0). */
function mod11Arrecadacao(base: string): number {
  let soma = 0, peso = 2;
  for (let k = base.length - 1; k >= 0; k--) { soma += Number(base[k]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/**
 * QA r5 F2: linha digitável de guia de arrecadação (IPTU, água, luz, taxas): 48 dígitos começando por 8, em 4 blocos de
 * 11 + DV — colados ("48"), "12 12 12 12" com o mesmo separador, ou "11-1 11-1 11-1 11-1" com o mesmo separador antes do
 * DV e o mesmo espaço entre os blocos — com o DV de CADA bloco válido: módulo 10 se o 3º dígito é 6 ou 7, módulo 11 se
 * é 8 ou 9 (outro valor não é guia).
 */
export function guiaDeArrecadacaoValida(d: string, forma: string, ligs: string[] = []): boolean {
  if (d.length !== 48 || d[0] !== "8" || !/[6-9]/.test(d[2])) return false;
  if (forma === "12,12,12,12") {
    if (!/^[ .]$|^\s{1,3}$/.test(ligs[0]) || !ligs.every(l => l === ligs[0])) return false;
  } else if (forma === "11,1,11,1,11,1,11,1") {
    const dv = [ligs[0], ligs[2], ligs[4], ligs[6]], entre = [ligs[1], ligs[3], ligs[5]];
    if (!/^(?:-| ?- ?| |\.)$/.test(dv[0]) || !dv.every(l => l === dv[0])) return false;
    if (!/^\s{1,3}$/.test(entre[0]) || !entre.every(l => l === entre[0])) return false;
  } else if (forma !== "48") return false;
  const dvDe = /[67]/.test(d[2]) ? mod10 : mod11Arrecadacao;
  for (let k = 0; k < 48; k += 12) if (dvDe(d.slice(k, k + 11)) !== Number(d[k + 11])) return false;
  return true;
}

const CONTEXTO_DOCUMENTO_PESSOAL = /\b(?:cpfs?|cnpjs?)\b/i;
const FORMA_EXPLICITA_PESSOAL = /(?<!\d)(\d{3})\.(\d{3})\.(\d{3})-(\d{2})(?!\d)|\(\s?\d{2}\s?\)\s?\d{4,5}-\d{4}(?!\d)/;
/**
 * QA r5 F1: travas da isenção da fase 2a. Nunca isenta com palavra de telefone/contato/CPF nos ~50 caracteres antes, com
 * "(" ou "+" colado no primeiro grupo, com parênteses ou hífen entre os grupos, nem quando há dentro do trecho uma FORMA
 * explícita de CPF ("ddd.ddd.ddd-dd", válido) ou de telefone ("(dd) ddddd-dddd").
 */
function armadilhaDeTelefone(c: Grupo[], i: number, j: number, texto: string, hifenDoDv = false): boolean {
  const inicio = c[i].inicio, fim = c[j].fim;
  const antes = texto.slice(Math.max(0, inicio - 50), inicio);
  if (CONTEXTO_TELEFONE.test(antes) || CONTEXTO_DOCUMENTO_PESSOAL.test(antes) || /[(+]\s?$/.test(antes)) return true;
  const trecho = texto.slice(inicio, fim);
  // na guia "11-1" o hífen antes do DV de cada bloco é da forma do documento (conferido em guiaDeArrecadacaoValida)
  if (hifenDoDv ? /[()]/.test(trecho) : /[()\-]/.test(trecho)) return true;
  const m = FORMA_EXPLICITA_PESSOAL.exec(trecho);
  return !!m && (!m[1] || isValidCPF(m[1] + m[2] + m[3] + m[4]));
}

/** Procura e mascara CPF, CNPJ e telefone dentro de cada cadeia de grupos de dígitos (fases 1 e 2, ver o cabeçalho). */
function mascararCadeias(texto: string): string {
  const grupos: Grupo[] = Array.from(texto.matchAll(GRUPO), m => ({ inicio: m.index!, fim: m.index! + m[0].length, digitos: m[0] }));
  if (!grupos.length) return texto;
  // cadeias: grupos consecutivos ligados por separador curto
  const cadeias: Grupo[][] = [];
  for (const g of grupos) {
    const ultima = cadeias[cadeias.length - 1];
    const anterior = ultima?.[ultima.length - 1];
    if (anterior && LIGACAO.test(texto.slice(anterior.fim, g.inicio))) ultima.push(g);
    else cadeias.push([g]);
  }
  const trocas: Array<{ inicio: number; fim: number }> = [];
  for (const c of cadeias) {
    const n = c.length;
    const ligacoes = c.slice(1).map((g, k) => texto.slice(c[k].fim, g.inicio));
    const tamanhos = c.map(g => g.digitos.length);
    // somas de prefixo: dígitos, grupos de 4 dígitos (listas) e grupos de 1 dígito que não é "9" (pré-filtro)
    const soma = [0], quatro = [0], ruins = [0];
    for (const g of c) {
      soma.push(soma[soma.length - 1] + g.digitos.length);
      quatro.push(quatro[quatro.length - 1] + (g.digitos.length === 4 ? 1 : 0));
      ruins.push(ruins[ruins.length - 1] + (g.digitos.length === 1 && g.digitos !== "9" ? 1 : 0));
    }
    // FASE 2a: documentos validados por inteiro ficam; a fase 1 roda nos trechos entre eles
    const isentos = soma[n] >= 44 ? documentosValidados(c, tamanhos, ligacoes, soma, texto) : [];
    const trechos: Array<[number, number]> = [];
    let a = 0;
    for (const [x, y] of isentos) { if (x > a) trechos.push([a, x - 1]); a = y + 1; }
    if (a < n) trechos.push([a, n - 1]);
    const trocasAntes = trocas.length;
    for (const [ini, fimTrecho] of trechos) {
      // QA r3 R3: janela deslizante (no máximo 16 grupos a partir de i) sobre o trecho inteiro. Só sub-cadeias de 8 a
      // 14 dígitos podem ser telefone, CPF ou CNPJ: as outras nem são classificadas (tempo linear). `minJ`: a janela tem
      // de terminar em minJ ou depois (QA r5 F4).
      const achar = (i: number, minJ: number): { j: number; tipo: Achado["tipo"] } | null => {
        for (let j = Math.min(fimTrecho, i + 15); j >= Math.max(i, minJ); j--) {
          const total = soma[j + 1] - soma[i];
          if (total < 8 || total > 14) continue;
          // "sozinho": a sub-cadeia é o trecho inteiro, ou uma célula de tabela (entre "|", sem "|" dentro)
          const inteiro = i === ini && j === fimTrecho;
          const sozinho = inteiro || ((i === ini || ligacoes[i - 1].includes("|")) && (j === fimTrecho || ligacoes[j].includes("|"))
            && (j === i || !ligacoes.slice(i, j).some(l => l.includes("|"))));
          if (!sozinho && !formaPossivel(tamanhos, ruins, i, j, total)) continue;
          const lista = i > ini && quatro[i] - quatro[ini] === i - ini ? c[ini].inicio : -1;
          const r = classificar(c.slice(i, j + 1), ligacoes.slice(i, j), texto, sozinho, lista);
          if (r) return { j, tipo: r.tipo };
        }
        return null;
      };
      const forte = (t: Achado["tipo"]) => t === "cpf" || t === "cnpj" || t === "celular";
      let i = ini;
      while (i <= fimTrecho) {
        const achado = achar(i, i);
        if (!achado) { i++; continue; }
        let achou = achado.j, tipo = achado.tipo;
        // QA r5 F4: a janela que começa antes engolia o grupo anterior ("dia 15/11/2026 9123-4567" → "2026 9123" fixo) e
        // deixava a cauda à vista. Testa as janelas que começam dentro e passam do fim: se a de dentro é fase 1 e a de
        // antes não (ou a de antes começa num ano), fica só a de dentro; senão, sai a união.
        for (let k = i + 1; k <= achou; k++) {
          const outro = achar(k, achou + 1);
          if (!outro) continue;
          if (!forte(tipo) && (forte(outro.tipo) || ANO.test(c[i].digitos))) { i = k; tipo = outro.tipo; }
          else if (forte(outro.tipo)) tipo = outro.tipo;
          achou = outro.j;
        }
        let inicio = c[i].inicio, fim = c[achou].fim;
        // leva junto "+55 (" antes e o ")" de um DDD entre parênteses
        const antes = /(?:\+\s?)?\(\s?$|\+\s?$/.exec(texto.slice(Math.max(0, inicio - 3), inicio));
        if (antes) inicio -= antes[0].length;
        const trecho = texto.slice(inicio, fim);
        if ((trecho.match(/\(/g)?.length ?? 0) > (trecho.match(/\)/g)?.length ?? 0) && texto[fim] === ")") fim++;
        trocas.push({ inicio, fim });
        i = achou + 1;
      }
    }
    // cadeia de 44 dígitos em blocos que NÃO validou como chave e tem algo achado dentro: sai inteira (nunca pela metade).
    // Lista de 4 CPFs/celulares (4 blocos de 11) sai item por item.
    const chave44 = !isentos.length && soma[n] === 44 && n > 1 && tamanhos.join(",") !== "11,11,11,11"
      && ligacoes.every(l => /^[\s.]+$/.test(l));
    if (chave44 && trocas.length > trocasAntes) trocas.splice(trocasAntes, trocas.length - trocasAntes, { inicio: c[0].inicio, fim: c[n - 1].fim });
  }
  if (!trocas.length) return texto;
  const partes: string[] = [];
  let pos = 0;
  for (const t of trocas) { partes.push(texto.slice(pos, t.inicio), OMITIDO); pos = t.fim; }
  partes.push(texto.slice(pos));
  return partes.join("");
}

const COLADO_EM_LETRA = new RegExp("^[\\p{L}\\d]", "u");
/** Banco: só número de conta (3+ dígitos, não um ano, não valor com centavos, não colado em letra). */
function trocarBanco(m: string, rotulo: string, sep: string, valor: string, centavos: string | undefined, pos: number, t: string): string {
  if (centavos) return m;
  const resto = /[.\-/]+$/.exec(valor)?.[0] ?? "";
  const nucleo = valor.slice(0, valor.length - resto.length);
  if (nucleo.replace(/\D/g, "").length < 3 || ANO.test(nucleo) || COLADO_EM_LETRA.test(t.slice(pos + m.length))) return m;
  return `${rotulo}${sep}${BANCARIO_OMITIDO}${resto}`;
}

/** PIX: e-mail ou uuid sempre; número só com 8–14 dígitos e sem centavos logo depois. */
function trocarPix(m: string, rotulo: string, sep: string, valor: string, pos: number, t: string): string {
  if (!valor.includes("@") && !/^[0-9a-f]{8}-/i.test(valor)) {
    const digitos = valor.replace(/\D/g, "").length;
    if (digitos < 8 || digitos > 14 || /^,\d/.test(t.slice(pos + m.length))) return m;
  }
  return `${rotulo}${sep}${BANCARIO_OMITIDO}`;
}

/** Texto livre com CPF/CNPJ, e-mail, telefone, dados bancários e senhas trocados por marcadores visíveis. */
export function sanitizarTexto(texto: string): string {
  if (!texto) return texto;
  const t = normalizarParaFiltro(texto);
  if (!/[\d@]|senha|password|passwd|c[oó]digo|token|\bpin\b|\botp\b|\bat\b|arroba/i.test(t)) return texto;
  const r = mascararCadeias(t
    .replace(SENHA, (_m, palavra: string) => `${palavra} ${SENHA_OMITIDA}`)
    .replace(CODIGO, (_m, palavra: string) => `${palavra} ${SENHA_OMITIDA}`)
    .replace(PIX, (m, rotulo: string, sep: string, valor: string, pos: number, s: string) => trocarPix(m, rotulo, sep, valor, pos, s))
    .replace(BANCO, (m, rotulo: string, sep: string, valor: string, cent: string | undefined, pos: number, s: string) =>
      trocarBanco(m, rotulo, sep, valor, cent, pos, s))
    .replace(EMAIL, OMITIDO)
    .replace(EMAIL_DISFARCADO, OMITIDO)
    .replace(CNPJ_FORMATADO, OMITIDO)
    .replace(CPF_FORMATADO, OMITIDO)
    .replace(CPF_VIRGULA, (m, a: string, b: string, pos: number, s: string) =>
      isValidCPF(a + b) && !/r\$\s*$/i.test(s.slice(Math.max(0, pos - 6), pos)) ? OMITIDO : m));
  return r === t ? texto : r; // nada mascarado: devolve o texto original, sem a normalização
}

/** Percorre a resposta e filtra toda string (chaves ficam como estão). */
export function sanitizarResposta<T>(valor: T): T {
  if (typeof valor === "string") return sanitizarTexto(valor) as T;
  if (Array.isArray(valor)) return valor.map(v => sanitizarResposta(v)) as T;
  if (valor && typeof valor === "object" && !(valor instanceof Date)) {
    const r: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) r[k] = sanitizarResposta(v);
    return r as T;
  }
  return valor;
}
