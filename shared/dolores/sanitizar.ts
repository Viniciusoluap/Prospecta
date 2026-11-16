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
// INTERRUPTOR (decisão do dono em 16/11/2026, opção B): `sanitizarTexto(texto, { mascararDadosPessoais })`. Com false,
// CPF, CNPJ, telefone e e-mail saem intactos e nenhuma das fases abaixo roda; senhas, chaves de API e dados bancários
// saem sempre. O padrão desta função é true (falha fechada); o servidor decide em server/dolores/dados-pessoais.ts.
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
// barras", "código do imóvel" ficam). Banco e PIX rodam DEPOIS da fase 1 (QA r5 F5): agência/conta/c/c com número de conta (3+ dígitos, não um ano, não valor
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

/** Códigos de UF do IBGE (os dois primeiros dígitos da chave de acesso). */
const UFS_IBGE = new Set(["11", "12", "13", "14", "15", "16", "17", "21", "22", "23", "24", "25", "26", "27", "28", "29", "31", "32",
  "33", "35", "41", "42", "43", "50", "51", "52", "53"]);
/** Ano (AA) plausível na chave: a NF-e existe desde 2006; no máximo o ano que vem. */
const ANO_MAXIMO_NFE = (new Date().getFullYear() % 100) + 1;

/**
 * QA r4 S1 / r5 F1 / r6 N4: ESTRUTURA da chave de NF-e — DV, UF da lista do IBGE, ano 06 até o ano que vem, mês 01–12,
 * CNPJ do emitente válido (posições 7–20), modelo 55/65 — e só nas formas de chave: 44 colados ou 11 blocos de 4. Uma
 * lista de celulares ou de CPFs que fecha os DVs por acaso não é chave. Sozinha NÃO isenta: ver documentosValidados
 * (rótulo + forma + estrutura, as três).
 */
export function chaveNfeEstrutural(d: string, forma: string): boolean {
  if (!FORMAS_CHAVE_NFE.has(forma) || !chaveNfeValida(d)) return false;
  const ano = Number(d.slice(2, 4)), mes = Number(d.slice(4, 6)), modelo = d.slice(20, 22);
  return UFS_IBGE.has(d.slice(0, 2)) && ano >= 6 && ano <= ANO_MAXIMO_NFE && mes >= 1 && mes <= 12
    && (modelo === "55" || modelo === "65") && cnpjValido(d.slice(6, 20));
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
 * QA r4 S2 / r5 F1 / r6 N3: ESTRUTURA da linha digitável de boleto (47 dígitos, moeda "9" na 4ª posição): o DV de CADA
 * um dos três campos E o DV geral do código de barras remontado, só nas formas do boleto — 47 colados, "5.5 5.6 5.6 1 14"
 * (com os pontos, conferidos em documentosValidados) ou "10 11 11 1 14". Nesta última, que uma lista de telefones e
 * documentos também tem, os campos 2 e 3 (11 dígitos) não podem ser celular (DDD + 9), CPF válido nem "0" + DDD + número
 * (telefone com o 0 da operadora), e o campo 5 (14 dígitos) não pode ser CNPJ válido nem "000" + CPF válido. O campo 1
 * fica de fora: banco + moeda 9 ("2379…", "7569…") tem a forma de um celular de 10 dígitos.
 * Sozinha NÃO isenta: ver documentosValidados (rótulo + forma + estrutura, as três).
 */
export function linhaDigitavelValida(d: string, forma: string): boolean {
  if (d.length !== 47 || d[3] !== "9") return false;
  if (forma !== "47" && forma !== "5,5,5,6,5,6,1,14" && forma !== "10,11,11,1,14") return false;
  if (mod10(d.slice(0, 9)) !== Number(d[9]) || mod10(d.slice(10, 20)) !== Number(d[20]) || mod10(d.slice(21, 31)) !== Number(d[31])) return false;
  if (!dvGeralDoBoleto(d)) return false;
  if (forma !== "10,11,11,1,14") return true;
  const pessoal = (x: string) => /^[1-9][1-9]9/.test(x) || isValidCPF(x) || /^0[1-9][1-9][2-9]/.test(x);
  const campo5 = d.slice(33);
  return !pessoal(d.slice(10, 21)) && !pessoal(d.slice(21, 32)) && !cnpjValido(campo5) && !(campo5.startsWith("000") && isValidCPF(campo5.slice(3)));
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
// QA r7 A1(c): "senha, X", "senha: X", "senha — X", "senha é X" e "senha\nX" levam junto a palavra X (antes, a vírgula ou a
// quebra de linha logo depois fechava a oração e a senha ficava à vista). A palavra não leva a pontuação final.
const DEPOIS_DA_SENHA = "(?:[ \\t]*(?:[,:=]|[-–—]+>?)[ \\t]*(?:\\r?\\n[ \\t]*)?|[ \\t]*\\r?\\n[ \\t]*|[ \\t]+é[ \\t]+)[^\\s,;]*[^\\s,;.!?]";
const SENHA = new RegExp(`\\b(senhas?|password|passwd|pwd|pass|token|tkn|pin|otp)\\b(?:${DEPOIS_DA_SENHA})?.*?${FIM_DA_ORACAO}`, "gi");
/**
 * QA r7 A1(b): gatilho de credencial. Depois dele, na mesma linha (e na linha seguinte quando ele fecha a linha), a
 * palavra com cara de senha (ver pareceSenha) sai. O CPF ou o usuário ao lado seguem a regra de dado pessoal.
 */
const PALAVRAS_CREDENCIAL = "senhas?|logins?|acessos?|credencia(?:l|is)|usu[aá]rios?|user(?:name)?|gov\\.?\\s?br|gov|meu\\s+inss|inss|e-?cac|conecta|portal|pwd|pass(?:word)?|passwd";
const GATILHO_CREDENCIAL = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${PALAVRAS_CREDENCIAL})(?![\\p{L}\\p{N}_])`, "iu");
const GATILHO_NO_FIM_DA_LINHA = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${PALAVRAS_CREDENCIAL})[\\s:=>\\-–—,.;]*$`, "iu");
/** Palavra do texto: sequência sem espaço nem separador (",", ";", ":", "/", "|", parênteses, aspas, colchetes). */
const PALAVRA = new RegExp(String.raw`(?<![^\s,;:/|()<>"'[\]{}])[^\s,;:/|()<>"'[\]{}]{6,}`, "gu");
const EMAIL_DE_VERDADE = new RegExp(String.raw`^[^@]+@[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*\.[\p{L}\p{N}_-]*\p{L}[\p{L}\p{N}_-]*[.!?]?$`, "u");
const TEM_LETRA = new RegExp("\\p{L}", "u");
/** Cara de senha: 6+ caracteres, letra misturada com dígito ou símbolo, e não é e-mail de verdade. */
export function pareceSenha(p: string): boolean {
  return p.length >= 6 && TEM_LETRA.test(p) && /[\d!@#$%&*?_+=~^]/.test(p) && !EMAIL_DE_VERDADE.test(p);
}
function mascararCredenciais(x: string): string {
  if (!GATILHO_CREDENCIAL.test(x)) return x;
  const linhas = x.split("\n");
  let linhaSeguinte = false;
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    const m = GATILHO_CREDENCIAL.exec(l);
    const ini = linhaSeguinte ? 0 : m ? m.index + m[0].length : -1;
    if (ini >= 0) linhas[i] = l.slice(0, ini) + l.slice(ini).replace(PALAVRA, p => (pareceSenha(p) ? SENHA_OMITIDA : p));
    linhaSeguinte = !!m && GATILHO_NO_FIM_DA_LINHA.test(l.slice(-48));
  }
  return linhas.join("\n");
}
/**
 * QA r7 A1(a): "x@y" sem ponto no domínio não é e-mail ("Maria@2025", formato de senha muito comum): sai como senha no
 * modo liberado (no modo mascarado, a fase de e-mail já o tira). E-mail com domínio ("maria@gmail.com") fica.
 */
const ARROBA_SEM_DOMINIO = new RegExp(String.raw`(?<![\p{L}\p{N}_.+!#$%&*-])[\p{L}\p{N}_.+!#$%&*-]+@[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*`, "gu");
const trocarArrobaSemDominio = (m: string) => (EMAIL_DE_VERDADE.test(m) ? m : SENHA_OMITIDA);
// QA r4 S5: "código" só é senha com senha/acesso/token/OTP por perto (40 caracteres depois ou 30 antes). "Código de
// barras", "código do imóvel 12345" ficam. A palavra sozinha não consome a oração (uma senha mais adiante ainda sai).
// QA r7 A6: também "código de verificação/segurança/confirmação/autenticação", "código 2FA" e "cód." abreviado.
const PERTO_DO_CODIGO = "(?:senhas?|acesso|token|otp|verifica[cç][aã]o|seguran[cç]a|confirma[cç][aã]o|autentica[cç][aã]o|2fa|mfa)";
const CODIGO = new RegExp(
  `\\b(c[oó]d(?:igos?\\b|\\.))(?:(?=[^.;,\\n]{0,40}?\\b${PERTO_DO_CODIGO}\\b)|(?<=\\b${PERTO_DO_CODIGO}\\b[^.;\\n]{0,30}c[oó]digos?))`
  + `.*?${FIM_DA_ORACAO}`,
  "gi",
);
// Agência e conta: o rótulo fica, o número sai. QA r4 S3: o número começa logo depois do rótulo e é limitado (antes, um
// lookahead varria a palavra inteira a cada rótulo: "ag-ag-…" de 200 kB levava 20 s). QA r4 S5: só número de conta
// (3+ dígitos, não um ano, não valor com centavos): "cc 2 cópias", "conta 2026", "conta 1.500,00" ficam.
// 16/11 (opção B): o número sai INTEIRO mesmo com espaço entre os grupos ("conta 529 982 247 25" → só o rótulo fica).
/**
 * QA r7 A5: bancos comuns — o nome sozinho funciona como rótulo ("Itaú 0001 12345-6") e vale depois de "conta do/da/no"
 * ("conta do Bradesco 12345-6"). Só com o nome do banco, o número precisa ter forma de conta (dígito depois de hífen ou
 * dois grupos): "Caixa 1000 litros" fica.
 */
const BANCOS = "bradesco|ita[uú]|santander|caixa(?:\\s+econ[oô]mica(?:\\s+federal)?)?|cef|bb|banco\\s+do\\s+brasil|nubank|inter|sicoob|sicredi|c6(?:\\s+bank)?|banrisul|bnb|banco\\s+do\\s+nordeste|pagbank|pagseguro|mercado\\s+pago|picpay|neon|btg(?:\\s+pactual)?|safra";
const SO_BANCO = new RegExp(`^(?:${BANCOS})$`, "iu");
// QA r7 A5: separador também "é" ("o número da conta é 12345-6"), o banco no meio ("conta do Bradesco 12345-6"), grupos
// ligados por " / " ("BB 1234-5 / 67890-1") e rótulo colado no número ("ag1234 cc56789", "cta 56789-0").
const BANCO = new RegExp(
  `(?<![\\p{L}\\p{N}_])(ag[eê]ncia|ag|conta(?:\\s+corrente|\\s+poupan[cç]a)?(?:\\s+(?:do|da|no|na)\\s+(?:${BANCOS}))?|c\\/c|cc|cta|${BANCOS})(?![\\p{L}_])`
  + `(\\s*(?:n[ºo°.]?|:|#|-|é|eh)?\\s*)(\\d[\\d.\\-/]{0,30}(?:(?: | ?[/|] ?)\\d[\\d.\\-/]{0,30}){0,5}[\\dxX]?)(,\\d)?`,
  "giu",
);
// PIX: QA r4 S5 — só quando o que segue tem forma de chave: e-mail, chave aleatória (uuid) ou 8–14 dígitos (CPF, CNPJ,
// telefone). "pagou via pix 1.500,00" fica (é o valor da cobrança).
// QA r7 A5: entre "pix" e a chave valem também "é", "é o", "->", "=>", "—", "pra/para", "do/da" e o tipo da chave
// ("PIX CNPJ …", "chave pix é o CPF …", "pix aleatória <uuid>"); uuid também sem hífens (32 hexadecimais).
const SEP_PIX = String.raw`((?:\s*(?:=>|->|[:#=–—-]|(?:n[ºo°.]?|é|eh|o|a|pra|para|pro|do|da|no|na|cpf|cnpj|telefone|celular|cel|e-?mail|aleat[oó]ria|chave)(?![\p{L}\p{N}]))){0,5}\s*)`;
const VALOR_PIX_TEXTO = String.raw`[\p{L}\p{N}_.+-]{1,64}@[\p{L}\p{N}_-]{1,63}(?:\.[\p{L}\p{N}_-]{1,63}){0,6}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}(?![0-9a-z])`;
/** Chave PIX em forma de e-mail ou aleatória (uuid): sai como dado bancário antes do filtro de e-mail. */
const PIX_EMAIL = new RegExp(String.raw`\b(chave\s+pix|pix)\b${SEP_PIX}(?:${VALOR_PIX_TEXTO})`, "giu");
const PIX = new RegExp(String.raw`\b(chave\s+pix|pix)\b${SEP_PIX}(${VALOR_PIX_TEXTO}|\+?\(?\d[\d.\-/() ]{6,24}\d)`, "giu");
// E-mail: "a@b.com", "a @ b.com", "a[at]b.com", "a (arroba) b.com" e, colado, sem domínio de topo ("a@b").
// QA r5 F6: letras e números de qualquer escrita (\p{L}\p{N}, flag u) — "maria.conceição@uol.com.br" sai inteiro.
// QA r3 R4: o nome só começa no início de uma "palavra" de [\p{L}\p{N}_.+-] (lookbehind). Sem a âncora, cada posição de uma
// sequência longa sem "@" (200 kB de dígitos, "12.12.…", "aaa…a1") tentava de novo até o fim: tempo quadrático (~60 s).
const EMAIL = new RegExp(String.raw`(?<![\p{L}\p{N}_.+-])[\p{L}\p{N}_.+-]+(?:\s?@\s?|\s?[[(]\s?(?:at|arroba)\s?[\])]\s?)[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)+|(?<![\p{L}\p{N}_.+-])[\p{L}\p{N}_.+-]+@[\p{L}\p{N}_-]+`, "giu");
// QA r4 S6: e-mail disfarçado com espaços ou por extenso ("fulano @ gmail . com", "fulano arroba gmail ponto com",
// "fulano(at)gmail(dot)com"). Exige domínio de topo conhecido no fim (senão "a arroba de café" viraria e-mail).
const ARROBA = "(?:\\s{0,3}@\\s{0,3}|\\s{0,3}[[(]\\s{0,3}(?:at|arroba)\\s{0,3}[\\])]\\s{0,3}|\\s{1,3}(?:at|arroba)\\s{1,3})";
const PONTO = "(?:\\s{0,3}\\.\\s{0,3}|\\s{0,3}[[(]\\s{0,3}(?:dot|ponto)\\s{0,3}[\\])]\\s{0,3}|\\s{1,3}(?:dot|ponto)\\s{1,3})";
const EMAIL_DISFARCADO = new RegExp(
  `(?<![\\p{L}\\p{N}_.+-])[\\p{L}\\p{N}_.+-]{1,64}${ARROBA}[\\p{L}\\p{N}_-]{1,63}(?:${PONTO}[\\p{L}\\p{N}_-]{1,63}){0,4}${PONTO}(?:com|br|net|org|gov|edu|io|me|info|biz|co)(?![\\p{L}\\p{N}])`,
  "giu",
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
const ANO_ATUAL = new Date().getFullYear();

type Grupo = { inicio: number; fim: number; digitos: string };
type Achado = { tipo: "cpf" | "cnpj" | "celular" | "fixo" | "duvida"; };

const formaDe = (gs: Grupo[]) => gs.map(g => g.digitos.length).join(",");
const FORMAS_CPF = new Set(["11", "9,2", "3,3,3,2", "3,3,5", "3,8"]);
const FORMAS_CNPJ = new Set(["14", "12,2", "8,6", "8,4,2", "2,3,3,4,2", "2,3,3,6", "2,6,4,2", "2,3,3,4,1,1"]);

/** Telefone brasileiro plausível nos grupos (já sem barra entre eles). */
function telefone(gs: Grupo[], ligacoes: string[], maisAntes: boolean, contextoTel: () => boolean, contextoLinha = contextoTel,
  isolado: () => boolean = () => true): "celular" | "fixo" | null {
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
    // "fone 35234567"; sem palavra de telefone, 8 dígitos colados ficam. QA r6 (F): a palavra de telefone vale na LINHA
    // inteira ("fones: 9123-4567, …, 35234567" a mais de 50 caracteres do rótulo)
    if (n === 1) return contextoTel() || contextoLinha() ? tipo : null;
    // "2024-2026", "anos 2024 2025": par de anos plausível, em ordem crescente (QA r6 F: "2038-1965", "2097-2027" e
    // "2020 2061" são telefones; a main os mascarava)
    // e só quando o par está sozinho, sem número logo antes nem logo depois (numa lista de telefones, "2003 2034" é fixo)
    if (g.every(x => ANO.test(x)) && Number(g[0]) <= Number(g[1]) && Number(g[1]) <= ANO_ATUAL + 30 && !contextoTel() && isolado()) return null;
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
  // QA r5 F7: CPF com zeros à esquerda num grupo só ("052998224725", "00052998224725" — o campo de 14 dígitos zerado)
  if (gs.length === 1 && d.length > 11 && d.length <= 14 && /^0+$/.test(d.slice(0, -11)) && isValidCPF(d.slice(-11))) return { tipo: "cpf" };
  const inicio = gs[0].inicio, fim = gs[gs.length - 1].fim;
  const antes = texto.slice(Math.max(0, inicio - 50), inicio);
  const maisAntes = /\+\s?\(?\s?$/.test(antes);
  // o contexto só é calculado quando decide (texto patológico com milhares de grupos não paga as regex à toa)
  let ctx: boolean | undefined;
  const contextoTelDe = () => (ctx ??= CONTEXTO_TELEFONE.test(antes));
  const contextoLinha = () => contextoTelDe()
    || CONTEXTO_TELEFONE.test(texto.slice(Math.max(0, inicio - 200), inicio).split("\n").pop()!);
  // QA r6 (F): sem outro número logo antes ou logo depois, na mesma linha (lista de telefones separada por vírgula,
  // espaço, "|", "-", "/" ou "("); um marcador já posto (CPF/CNPJ formatado, e-mail) conta como número
  const isolado = () => sozinho && !/(?:\d|\])[\s,;|\-/()+]{0,4}$/.test(texto.slice(Math.max(0, inicio - 6), inicio))
    && !/^[\s,;|\-/()+]{0,4}(?:\d|\[(?:dado|senha))/.test(texto.slice(fim, fim + 12));
  const tel = telefone(gs, ligacoes, maisAntes, contextoTelDe, contextoLinha, isolado);
  const unicaInteira = sozinho && gs.length === 1;
  // QA r6 N3: "0" + DDD + número em 11 dígitos colados (telefone com o 0 da operadora), mesmo no meio de uma cadeia —
  // a main mascarava como dúvida; só rótulo de documento logo antes livra
  if (gs.length === 1 && /^0[1-9][1-9][2-9]\d{7}$/.test(d)) {
    const rotuloDoc = !CONTEXTO_TELEFONE.test(antes) && CONTEXTO_NAO_PESSOAL.test(antes.replace(/[(+\s]+$/, " "));
    if (!rotuloDoc) return { tipo: "duvida" };
  }
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
      // QA r6 (F): a faixa só fica sozinha e com palavra de faixa logo antes ("entre 2500-3000", "de 2500-3000") — numa
      // lista de números ou depois de "vizinhos:", "3800-6600" é telefone
      if (/^\s?-\s?$/.test(ligacoes[0]) && a.endsWith("00") && b.endsWith("00") && Number(b) > Number(a) && isolado()
        && /\b(?:entre|de|da|até|cerca\s+de|aprox\.?|aproximadamente)\s*$/i.test(antesLimpo)) return null;
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

// QA r6 (A): RÓTULO do documento nos ~60 caracteres antes, na mesma linha ou na linha imediatamente anterior.
const ROTULO_NFE = /\b(?:chave(?:\s+de\s+acesso)?|nf-?e|danfe|notas?\s+fisca(?:l|is))\b/i;
const ROTULO_BOLETO = /\b(?:boletos?|linha\s+digit[aá]vel|c[oó]d(?:igo|\.)?\s*(?:de\s+)?barras)\b/i;
const ROTULO_GUIA = /\b(?:guias?|iptu|darf|dae|dam|gru|gps|arrecada[cç][aã]o|conta\s+de\s+(?:[aá]gua|luz|energia)|faturas?)\b/i;
function rotuloAntes(texto: string, inicio: number, rotulo: RegExp): boolean {
  const linhas = texto.slice(Math.max(0, inicio - 60), inicio).split("\n");
  return rotulo.test(linhas.slice(-2).join("\n"));
}

/**
 * FASE 2a (QA r6, A): trecho da cadeia que é documento — chave de NF-e, linha digitável de boleto ou guia de arrecadação —
 * só quando há as TRÊS coisas ao mesmo tempo:
 *   (i) RÓTULO do documento logo antes (rotuloAntes);
 *   (ii) FORMA escrita do documento, numa linha, com o separador uniforme (separacaoDeChave, separacaoDeBoleto,
 *        guiaDeArrecadacaoValida);
 *   (iii) ESTRUTURA validada (chaveNfeEstrutural, linhaDigitavelValida, guiaDeArrecadacaoValida);
 * e sem nenhuma trava (armadilhaDeTelefone). Faltando qualquer uma, não há isenção: valem a fase 1 e a 2b (o trecho pode
 * sair mascarado em parte — é o lado seguro; o marcador é visível).
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
        let ok = false, hifenDoDv = false;
        if (total === 44) ok = separacaoDeChave(ligs) && chaveNfeEstrutural(d, forma) && rotuloAntes(texto, c[i].inicio, ROTULO_NFE);
        else if (total === 47) {
          ok = linhaDigitavelValida(d, forma) && rotuloAntes(texto, c[i].inicio, ROTULO_BOLETO) && separacaoDeBoleto(forma, ligs);
        } else {
          ok = guiaDeArrecadacaoValida(d, forma, ligs) && rotuloAntes(texto, c[i].inicio, ROTULO_GUIA);
          hifenDoDv = forma === "11,1,11,1,11,1,11,1";
        }
        if (ok && !armadilhaDeTelefone(c, i, j, texto, hifenDoDv)) { fim = j; break; }
      }
    }
    if (fim >= 0) { r.push([i, fim]); i = fim + 1; } else i++;
  }
  return r;
}

/** QA r5 F1 / r6 N5: chave de NF-e em blocos — todos os separadores iguais: 1 a 3 espaços, ou "." (numa única linha). */
function separacaoDeChave(ligs: string[]): boolean {
  return !ligs.length || ((/^ {1,3}$/.test(ligs[0]) || ligs[0] === ".") && ligs.every(l => l === ligs[0]));
}

/**
 * QA r5 F1 / r6 N5: linha digitável "5.5 5.6 5.6 1 14" — ponto dentro dos três campos e o MESMO espaço (1 a 3) entre os
 * campos; uma única quebra de linha no lugar de um desses espaços também vale (os pontos já dão a forma: PDF e WhatsApp
 * quebram a linha). "10 11 11 1 14" — o mesmo espaço (1 a 3) entre todos, numa linha só.
 */
function separacaoDeBoleto(forma: string, ligs: string[]): boolean {
  if (!ligs.length) return true;
  if (forma === "5,5,5,6,5,6,1,14") {
    if (ligs[0] !== "." || ligs[2] !== "." || ligs[4] !== ".") return false;
    const entre = [ligs[1], ligs[3], ligs[5], ligs[6]];
    const quebras = entre.filter(l => /^[ \t]{0,3}\r?\n[ \t]{0,3}$/.test(l));
    const espacos = entre.filter(l => !quebras.includes(l));
    return quebras.length <= 1 && espacos.length + quebras.length === 4 && /^ {1,3}$/.test(espacos[0])
      && espacos.every(l => l === espacos[0]);
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
 * QA r5 F2 / r6 N2: FORMA e ESTRUTURA da linha digitável de guia de arrecadação (IPTU, água, luz, taxas): 48 dígitos
 * começando por 8, em 4 blocos de 11 + DV — colados ("48"), "12 12 12 12" com o mesmo espaço (1 a 3), ou
 * "11-1 11-1 11-1 11-1" com HÍFEN antes do DV (só "-" ou " - ", o mesmo nos quatro; espaço ou ponto no lugar do hífen
 * não vale) e o mesmo espaço entre os blocos — numa linha só — com o DV de CADA bloco válido: módulo 10 se o 3º dígito
 * é 6 ou 7, módulo 11 se é 8 ou 9 (outro valor não é guia). Sozinha NÃO isenta: ver documentosValidados.
 */
export function guiaDeArrecadacaoValida(d: string, forma: string, ligs: string[] = []): boolean {
  if (d.length !== 48 || d[0] !== "8" || !/[6-9]/.test(d[2])) return false;
  if (forma === "12,12,12,12") {
    if (!/^ {1,3}$/.test(ligs[0]) || !ligs.every(l => l === ligs[0])) return false;
  } else if (forma === "11,1,11,1,11,1,11,1") {
    const dv = [ligs[0], ligs[2], ligs[4], ligs[6]], entre = [ligs[1], ligs[3], ligs[5]];
    if (!/^ ?- ?$/.test(dv[0]) || !dv.every(l => l === dv[0])) return false;
    if (!/^ {1,3}$/.test(entre[0]) || !entre.every(l => l === entre[0])) return false;
  } else if (forma !== "48") return false;
  const dvDe = /[67]/.test(d[2]) ? mod10 : mod11Arrecadacao;
  for (let k = 0; k < 48; k += 12) if (dvDe(d.slice(k, k + 11)) !== Number(d[k + 11])) return false;
  return true;
}

const CONTEXTO_DOCUMENTO_PESSOAL = /\b(?:cpfs?|cnpjs?|comprador(?:a|es|as)?)\b/i;
const FORMA_EXPLICITA_PESSOAL = /(?<!\d)(\d{3})\.(\d{3})\.(\d{3})-(\d{2})(?!\d)|\(\s?\d{2}\s?\)\s?\d{4,5}-\d{4}(?!\d)/;
/**
 * QA r5 F1 / r6: travas da isenção da fase 2a. Nunca isenta com palavra de telefone/contato/CPF/comprador nos ~60 caracteres antes, com
 * "(" ou "+" colado no primeiro grupo, com parênteses ou hífen entre os grupos, nem quando há dentro do trecho uma FORMA
 * explícita de CPF ("ddd.ddd.ddd-dd", válido) ou de telefone ("(dd) ddddd-dddd").
 */
function armadilhaDeTelefone(c: Grupo[], i: number, j: number, texto: string, hifenDoDv = false): boolean {
  const inicio = c[i].inicio, fim = c[j].fim;
  const antes = texto.slice(Math.max(0, inicio - 60), inicio);
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
      const achar = (i: number, minJ: number, maxJ: number): { j: number; tipo: Achado["tipo"] } | null => {
        for (let j = Math.min(maxJ, i + 15); j >= Math.max(i, minJ); j--) {
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
      const emitir = (de: number, ate: number) => {
        let inicio = c[de].inicio, fim = c[ate].fim;
        // leva junto "+55 (" antes e o ")" de um DDD entre parênteses
        const antes = /(?:\+\s?)?\(\s?$|\+\s?$/.exec(texto.slice(Math.max(0, inicio - 3), inicio));
        if (antes) inicio -= antes[0].length;
        const trecho = texto.slice(inicio, fim);
        if ((trecho.match(/\(/g)?.length ?? 0) > (trecho.match(/\)/g)?.length ?? 0) && texto[fim] === ")") fim++;
        trocas.push({ inicio, fim });
      };
      // Varre os grupos [de..ate] (as janelas não passam de `ate`).
      const varrer = (de: number, ate: number): void => {
        let i = de;
        while (i <= ate) {
          const achado = achar(i, i, ate);
          if (!achado) { i++; continue; }
          let achou = achado.j, tipo = achado.tipo, origem = i;
          // QA r5 F4: a janela que começa antes engolia o grupo anterior ("dia 15/11/2026 9123-4567" → "2026 9123" fixo) e
          // deixava a cauda à vista. Testa as janelas que começam dentro e passam do fim: se a de dentro é fase 1 e a de
          // antes não (ou a de antes começa num ano), a de dentro vira um achado à parte; senão, sai a união.
          // QA r6 N1: ao passar para a janela de dentro, o que veio ANTES dela é varrido de novo como trecho próprio — um
          // fixo inteiro antes ("fone 3523 4567 9123 4567") continua sendo achado; só o que não é nada (ano, data) fica.
          // O pulo por causa do ano não varre na hora (o ano fica); se depois vier uma janela forte, varre desde a
          // `origem` — "2080 5591 6820 6569": "2080" parecia ano, mas "2080 5591" é um fixo inteiro.
          for (let k = i + 1; k <= achou; k++) {
            const outro = achar(k, achou + 1, ate);
            if (!outro) continue;
            if (!forte(tipo) && forte(outro.tipo)) { varrer(origem, k - 1); i = origem = k; tipo = outro.tipo; }
            else if (!forte(tipo) && ANO.test(c[i].digitos)) { i = k; tipo = outro.tipo; }
            else if (forte(outro.tipo)) tipo = outro.tipo;
            achou = outro.j;
          }
          // os grupos pulados por parecerem ano ("2033-2005" depois de dois pulos) são varridos de novo
          if (origem < i) varrer(origem, i - 1);
          emitir(i, achou);
          i = achou + 1;
        }
      };
      varrer(ini, fimTrecho);
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
  // QA r7 A5: só o nome do banco antes — o número precisa ter forma de conta/agência (hífen + dígito ou dois grupos)
  if (SO_BANCO.test(rotulo.trim()) && !/\d{3,}-[\dxX]|\d{3,}(?: | ?[/|] ?)\d{3,}/.test(nucleo)) return m;
  return `${rotulo}${sep}${BANCARIO_OMITIDO}${resto}`;
}

/** PIX: e-mail ou uuid sempre; número só com 8–14 dígitos e sem centavos logo depois. */
function trocarPix(m: string, rotulo: string, sep: string, valor: string, pos: number, t: string): string {
  if (!valor.includes("@") && !/^[0-9a-f]{8}-/i.test(valor) && !/^[0-9a-f]{32}$/i.test(valor)) {
    const digitos = valor.replace(/\D/g, "").length;
    if (digitos < 8 || digitos > 14 || /^,\d/.test(t.slice(pos + m.length))) return m;
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(valor.trim())) return m; // data ("pix pra 16/11/2026")
  }
  return `${rotulo}${sep}${BANCARIO_OMITIDO}`;
}

// ── Interruptor dos dados pessoais (decisão do dono em 16/11: opção B) ──
/**
 * `mascararDadosPessoais`:
 *  - true  — CPF, CNPJ, telefone e e-mail viram "[dado pessoal omitido]" (fases 1, 2a e 2b, ver o cabeçalho). É o
 *            PADRÃO desta função pura (falha fechada) e o que vale SEMPRE para o que é gravado ou vai para log: auditoria
 *            (dolores_acoes), comando guardado (dolores_mensagens.texto), mensagens de erro.
 *  - false — dados pessoais saem intactos (nenhuma das fases roda: sem custo, sem estragar boleto, guia, nota, lote, valor).
 * Nos dois modos saem SEMPRE: senha, token, PIN, OTP, código de acesso, chave de API ("sk-ant-…", "Bearer …", JWT) e
 * dados bancários (agência, conta, chave PIX). Quem decide o modo do que vai ao modelo e ao dono é o servidor, num ponto
 * só: server/dolores/dados-pessoais.ts (variável DOLORES_MASCARAR_DADOS_PESSOAIS).
 */
export type OpcoesFiltro = { mascararDadosPessoais?: boolean };
export const CHAVE_OMITIDA = "[chave de acesso omitida]";
/** Chave de API ou credencial em forma reconhecível (sempre sai, com ou sem palavra de senha antes). */
const CHAVE_API = /\bsk-ant-[\w-]{4,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}|\bgithub_pat_\w{20,}|\bAIza[\w-]{30,}|\b(?:sk|rk|pk)_(?:live|test)_\w{10,}|-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]{0,40}PRIVATE KEY-----|$)|\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}|\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}|\bxox[abprs]-[\w-]{10,}/g;
/** QA r7 A6: "bearer" em qualquer caixa, com ":" opcional ("Bearer: …", "bearer abc…"). */
const BEARER = /\bbearer\b\s*:?\s*[\w.~+/=-]{8,}/gi;
/**
 * QA r7 A6: rótulo de chave seguido do valor ("apikey=<hex>", "api_key: …", "client_secret=…", "x-api-key: …"). Sem ":"
 * nem "=", só valor longo (16+) com dígito ("apikey 0a1b…", como no erro da Evolution).
 */
const ROTULO_CHAVE = /\b(x-api-key|api[_-]?key|apikey|client[_-]?secret|secret(?:[_-]?key)?|access[_-]?key|aws[_ -]secret(?:[_ -]access)?[_ -]key)\b(\s*["']?\s*[:=]?\s*["']?)([^\s"',;]{6,})/gi;
function trocarRotuloChave(m: string, rotulo: string, sep: string, valor: string): string {
  if (!/[:=]/.test(sep) && (valor.length < 16 || !/\d/.test(valor))) return m;
  return `${rotulo}${sep}${CHAVE_OMITIDA}`;
}

/** Texto livre com senhas, chaves, dados bancários e (se ligado) CPF/CNPJ, e-mail e telefone trocados por marcadores. */
export function sanitizarTexto(texto: string, opcoes: OpcoesFiltro = {}): string {
  if (!texto) return texto;
  const mascararPessoais = opcoes.mascararDadosPessoais ?? true;
  const t = normalizarParaFiltro(texto);
  if (!/[\d@!#$%&*_+=~^]|senha|password|passwd|c[oó]digo|token|\bpin\b|\botp\b|\bat\b|arroba|sk-|sk_|pk_|bearer|eyJ|AIza|github_pat|BEGIN|apikey|api_key|secret|login|acesso|credencia|usu[aá]rio|user|gov|inss|cac|conecta|portal|pwd|pass|tkn|c[oó]d/i.test(t)) return texto;
  const segredos = (x: string) => {
    let s = x
      .replace(CHAVE_API, CHAVE_OMITIDA)
      .replace(BEARER, CHAVE_OMITIDA)
      .replace(ROTULO_CHAVE, trocarRotuloChave)
      .replace(SENHA, (_m, palavra: string) => `${palavra} ${SENHA_OMITIDA}`)
      .replace(CODIGO, (_m, palavra: string) => `${palavra} ${SENHA_OMITIDA}`)
      .replace(PIX_EMAIL, (_m, rotulo: string, sep: string) => `${rotulo}${sep}${BANCARIO_OMITIDO}`);
    // QA r7 A1(a): no modo mascarado, "x@y" sem domínio já sai pela fase de e-mail (marcador de dado pessoal)
    if (!mascararPessoais) s = s.replace(ARROBA_SEM_DOMINIO, trocarArrobaSemDominio);
    return mascararCredenciais(s);
  };
  const bancarios = (x: string) => x
    .replace(PIX, (m, rotulo: string, sep: string, valor: string, pos: number, s: string) => trocarPix(m, rotulo, sep, valor, pos, s))
    .replace(BANCO, (m, rotulo: string, sep: string, valor: string, cent: string | undefined, pos: number, s: string) =>
      trocarBanco(m, rotulo, sep, valor, cent, pos, s));
  if (!mascararPessoais) {
    const r = bancarios(segredos(t));
    return r === t ? texto : r;
  }
  // QA r5 F5: a fase 1 (cadeias: CPF, CNPJ, celular em qualquer separação) roda ANTES de PIX e banco — antes, "conta
  // 529 982 247 25" ou "cc 2026.12/889 767 151 95" tinham só o 1º grupo trocado pelo marcador bancário e o resto do
  // CPF ficava à vista. Depois, o que sobrou de número de conta/chave ainda sai como dado bancário.
  const pessoaisFormatados = segredos(t)
    .replace(EMAIL, OMITIDO)
    .replace(EMAIL_DISFARCADO, OMITIDO)
    .replace(CNPJ_FORMATADO, OMITIDO)
    .replace(CPF_FORMATADO, OMITIDO)
    .replace(CPF_VIRGULA, (m, a: string, b: string, pos: number, s: string) =>
      isValidCPF(a + b) && !/r\$\s*$/i.test(s.slice(Math.max(0, pos - 6), pos)) ? OMITIDO : m);
  const r = bancarios(mascararCadeias(pessoaisFormatados));
  return r === t ? texto : r; // nada mascarado: devolve o texto original, sem a normalização
}

/** Percorre a resposta e filtra toda string (chaves ficam como estão). */
export function sanitizarResposta<T>(valor: T, opcoes: OpcoesFiltro = {}): T {
  if (typeof valor === "string") return sanitizarTexto(valor, opcoes) as T;
  if (Array.isArray(valor)) return valor.map(v => sanitizarResposta(v, opcoes)) as T;
  if (valor && typeof valor === "object" && !(valor instanceof Date)) {
    const r: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) r[k] = sanitizarResposta(v, opcoes);
    return r as T;
  }
  return valor;
}
