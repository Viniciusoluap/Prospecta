// EPIC-025 (Dolores, etapa 4) — regras puras dos grupos de clientes: leitura do aviso de GRUPO da Evolution (nunca vira
// comando), o enum FECHADO de tipos de documento, a saída validada da classificação pela IA, a sanitização de nome de
// arquivo e legenda, o formato real do arquivo pelos bytes e a forma do id do grupo. Sem banco nem rede.
import { z } from "zod";
import { codigoValido, textoDeDado, umaLinha } from "./fila.js";
import { tratarLinksDaResposta } from "./links.js";
import { INTERACOES, desembrulhar, foiEncaminhada, segundos } from "./whatsapp.js";

/** Id de grupo do WhatsApp: "<dígitos>[-<dígitos>]@g.us" (o mesmo CHECK da migração 0126). */
export const JID_GRUPO = /^[0-9]{5,40}(-[0-9]{1,20})?@g\.us$/;
export const jidDeGrupoValido = (v: unknown): v is string => typeof v === "string" && JID_GRUPO.test(v);

/**
 * QA E4, achado 7 — id de grupo para EXIBIR: no formato antigo ("<telefone de quem criou>-<data>@g.us") a primeira parte é
 * o telefone de quem criou o grupo; na tela ela aparece mascarada (só os 4 finais). O formato novo (só dígitos) não tem
 * telefone e fica igual. O id completo continua só nos dados (para cadastrar).
 */
export function jidDeGrupoParaExibir(jid: string): string {
  const m = /^(\d+)-(\d+)@g\.us$/.exec(jid);
  return m ? `${"•".repeat(Math.max(0, m[1].length - 4))}${m[1].slice(-4)}-${m[2]}@g.us` : jid;
}

/** Mensagem de grupo mais velha que isto (histórico ao entrar no grupo, reconexão) não é registrada. */
export const IDADE_MAXIMA_GRUPO_MS = 24 * 60 * 60_000;

export const TIPOS_MENSAGEM_GRUPO = ["texto", "imagem", "documento", "video", "audio", "figurinha"] as const;
export type TipoMensagemGrupo = (typeof TIPOS_MENSAGEM_GRUPO)[number];

/** Só isto é documento a classificar e salvar (vídeo, áudio e figurinha ficam só registrados). */
export const ehDocumento = (t: TipoMensagemGrupo) => t === "imagem" || t === "documento";

export const SITUACOES_DOCUMENTO_GRUPO = [
  "sem_documento", "a_classificar", "classificando", "classificado", "confira", "grande_demais", "formato", "erro", "salvo",
] as const;
export type SituacaoDocumentoGrupo = (typeof SITUACOES_DOCUMENTO_GRUPO)[number];

export const ROTULO_SITUACAO_GRUPO: Record<SituacaoDocumentoGrupo, string> = {
  sem_documento: "sem documento", a_classificar: "a classificar", classificando: "classificando", classificado: "classificado",
  confira: "classificado — confira (confiança baixa)", grande_demais: "grande demais (não baixado)", formato: "formato não aceito",
  erro: "não consegui classificar", salvo: "salvo no card",
};

/**
 * ENUM FECHADO dos tipos de documento (prompt mestre 4.4 + lista da etapa 4). A IA só pode devolver um destes; nada do
 * texto do documento vira tipo, pasta ou destino.
 */
export const TIPOS_DOCUMENTO_GRUPO = [
  "rg", "cnh", "comprovante_endereco", "comprovante_renda", "fgts", "certidao", "pis", "documento_conjuge",
  "matricula", "contrato", "planta", "foto_obra", "nota_fiscal", "outro",
] as const;
export type TipoDocumentoGrupo = (typeof TIPOS_DOCUMENTO_GRUPO)[number];

export const ROTULO_TIPO_DOCUMENTO: Record<TipoDocumentoGrupo, string> = {
  rg: "RG", cnh: "CNH", comprovante_endereco: "Comprovante de endereço", comprovante_renda: "Comprovante de renda", fgts: "Extrato do FGTS",
  certidao: "Certidão (nascimento ou casamento)", pis: "PIS", documento_conjuge: "Documento do cônjuge", matricula: "Matrícula do imóvel",
  contrato: "Contrato", planta: "Planta", foto_obra: "Foto de obra", nota_fiscal: "Nota fiscal", outro: "Outro documento",
};

/** Tipo do documento do cliente no CRM (lead_doc_type) e, por ele, a pasta do organizador do Drive. */
export const TIPO_NO_CARD: Record<TipoDocumentoGrupo, string> = {
  rg: "rg", cnh: "cnh", comprovante_endereco: "address_proof", comprovante_renda: "income_proof_formal", fgts: "fgts",
  certidao: "birth_marriage_certificate", pis: "pis", documento_conjuge: "spouse_docs",
  matricula: "other", contrato: "other", planta: "other", foto_obra: "other", nota_fiscal: "other", outro: "other",
};

/** Abaixo disto a classificação vira "confira". */
export const LIMIAR_CONFIANCA = 0.75;

/** Saída da classificação: só o enum, a confiança e um motivo curto (o resto é recusado). */
export const saidaClassificacao = z.object({
  tipo: z.enum(TIPOS_DOCUMENTO_GRUPO),
  confianca: z.number().min(0).max(1),
  motivo: z.string().max(400),
}).strict();
export type SaidaClassificacao = z.infer<typeof saidaClassificacao>;

/** JSON Schema da ferramenta que o modelo é obrigado a chamar (a única). */
export const FERRAMENTA_CLASSIFICACAO = {
  name: "registrar_classificacao",
  description: "Registra o tipo do documento. É a única resposta possível.",
  input_schema: {
    type: "object",
    properties: {
      tipo: { type: "string", enum: [...TIPOS_DOCUMENTO_GRUPO] },
      confianca: { type: "number", minimum: 0, maximum: 1, description: "0 a 1: quanto você tem certeza do tipo." },
      motivo: { type: "string", maxLength: 160, description: "Por que é desse tipo, em até 160 caracteres, sem copiar dados do documento (nada de nome, CPF, número)." },
    },
    required: ["tipo", "confianca", "motivo"],
    additionalProperties: false,
  },
} as const;

/** Lê a saída do modelo: válida → classificação; inválida (texto, campo a mais, tipo fora do enum) → null. */
export function lerSaidaClassificacao(bruta: unknown): SaidaClassificacao | null {
  const r = saidaClassificacao.safeParse(bruta);
  return r.success ? r.data : null;
}

/** Tamanho máximo do motivo da classificação gravado (texto curto do modelo). */
export const MAX_MOTIVO_IA = 160;

/**
 * QA E4, achado 4 — o motivo é texto LIVRE do modelo (que leu um documento de terceiro): só é gravado se for um texto curto,
 * de uma linha, sem link nem forma de host (a mesma regra de links da resposta ao dono, sem nenhum host permitido), sem
 * e-mail/menção, sem sequência longa de dígitos e sem nada com cara de decisão da fila ("aprovar"/"recusar" ou um código no
 * formato dos códigos da fila). QA E4 r2, N5: antes das conferências, `normalize("NFKC")` (largura total vira ASCII) e só
 * letras do alfabeto latino com os acentos do português (homóglifo cirílico/grego, marca combinante solta → recusa).
 * Na dúvida → null (quem chama grava um motivo do sistema no lugar).
 */
const LETRA_DO_PORTUGUES = /^[A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç]$/;
// (pelo construtor: o alvo do tsconfig não aceita a flag "u" em literal)
const MARCA_COMBINANTE = new RegExp(String.raw`\p{M}`, "u");
const QUALQUER_LETRA = new RegExp(String.raw`\p{L}`, "gu");
export function motivoDaIaSeguro(bruto: string | null | undefined): string | null {
  const original = String(bruto ?? "").normalize("NFKC");
  if (/[\r\n\u2028\u2029]/.test(original)) return null;
  const t = textoDeDado(umaLinha(original, 400), 400).normalize("NFKC");
  if (!t || t.length > MAX_MOTIVO_IA) return null;
  if (MARCA_COMBINANTE.test(t) || Array.from(t.matchAll(QUALQUER_LETRA)).some(m => !LETRA_DO_PORTUGUES.test(m[0]))) return null;
  if (tratarLinksDaResposta(t, null) !== t) return null;
  if (/[@\\/]|\bwww\b|\d{4,}/i.test(t)) return null;
  const semAcento = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/\b(aprov|recus|ignor|instru|comando)\w*/i.test(semAcento)) return null;
  // código da fila (5 do alfabeto, em maiúsculas) ou qualquer "palavra" com letras e dígitos (cara de código ou de id)
  if (semAcento.split(/[^A-Za-z0-9]+/).some(p => codigoValido(p) || (p.length >= 4 && /[A-Za-z]/.test(p) && /\d/.test(p)))) return null;
  return t;
}

/**
 * Nome de arquivo que veio do WhatsApp (texto de terceiro): sem caminho (só o último pedaço depois de / ou \), sem
 * caracteres de controle/invisíveis nem quebra de linha, colchetes viram parênteses, sem pontos no começo, até 120
 * caracteres. Vazio → null. No Drive, o nome é montado pelo sistema (rótulo + data + extensão): este só aparece no card.
 */
export function nomeSeguroDeArquivo(nome: string | null | undefined): string | null {
  const base = String(nome ?? "").split(/[\\/]/).pop() ?? "";
  const limpo = textoDeDado(umaLinha(base, 400), 400).replace(/[<>:"|?*]/g, "_").replace(/^[.\s]+/, "").trim().slice(0, 120);
  return limpo || null;
}

/** Legenda/texto de grupo: uma linha, sem controle/invisíveis, colchetes trocados, até `max`. */
export const legendaSegura = (s: string | null | undefined, max = 1000) => textoDeDado(s, max);

export type FormatoArquivo = { formato: "pdf" | "jpeg" | "png" | "webp" | "gif"; mime: string };
/** Formato REAL pelos primeiros bytes (o mime declarado pelo WhatsApp não é prova). */
export function formatoPorBytes(b: Uint8Array): FormatoArquivo | null {
  const h = (i: number) => b[i];
  if (b.length >= 5 && h(0) === 0x25 && h(1) === 0x50 && h(2) === 0x44 && h(3) === 0x46 && h(4) === 0x2d) return { formato: "pdf", mime: "application/pdf" };
  if (b.length >= 3 && h(0) === 0xff && h(1) === 0xd8 && h(2) === 0xff) return { formato: "jpeg", mime: "image/jpeg" };
  if (b.length >= 8 && h(0) === 0x89 && h(1) === 0x50 && h(2) === 0x4e && h(3) === 0x47 && h(4) === 0x0d && h(5) === 0x0a && h(6) === 0x1a && h(7) === 0x0a) return { formato: "png", mime: "image/png" };
  if (b.length >= 12 && h(0) === 0x52 && h(1) === 0x49 && h(2) === 0x46 && h(3) === 0x46 && h(8) === 0x57 && h(9) === 0x45 && h(10) === 0x42 && h(11) === 0x50) return { formato: "webp", mime: "image/webp" };
  if (b.length >= 6 && h(0) === 0x47 && h(1) === 0x49 && h(2) === 0x46 && h(3) === 0x38) return { formato: "gif", mime: "image/gif" };
  return null;
}
/** Formatos que vão para o card e o Drive (os mesmos da tela de documentos do cliente: PDF, JPG, PNG — e WEBP). */
export const formatoSalvavel = (f: FormatoArquivo | null) => !!f && f.formato !== "gif";

/**
 * Páginas de um PDF, por estimativa barata e CONSERVADORA (serve só para o teto de custo da classificação). Devolve null =
 * "não sei" — e quem chama NÃO envia o arquivo à IA — quando a contagem não é confiável (QA E4, achado 2):
 * - fluxo de objetos (/ObjStm) ou tabela xref em fluxo (/Type /XRef): os objetos de página podem estar comprimidos;
 * - nome da estrutura escrito com escape "#xx" (ex.: /P#61ge = /Page): a página pode estar escondida da contagem;
 * - lista /Kids com comentário "%" dentro (um "]" no comentário esconderia filhos) ou /Count em referência indireta ("7 0 R");
 * - nenhuma página encontrada.
 * Quando conta, vale o MAIOR entre os objetos "/Type /Page", as chaves "/Contents" (cada página com conteúdo tem a sua; não é
 * herdada), as chaves "/Parent" (toda página tem a sua, mesmo sem /Type), as referências nos "/Kids" e os "/Count" da árvore
 * de páginas (com sinal "+" ou decimal) — contar a mais só deixa de enviar o arquivo. Entre as palavras vale qualquer espaço do
 * PDF (inclusive NUL e \f) e comentário "%" (QA E4 r2, N1). Desde a r2 (N0) a trava de custo é a contagem prévia de tokens; esta
 * estimativa continua conservadora: na dúvida, "não sei".
 */
const ESPACO_PDF = String.raw`(?:[\s\0]|%[^\r\n]*[\r\n])*`;
const ESPACO_PDF_UM = String.raw`(?:[\s\0]|%[^\r\n]*[\r\n])+`;
const NOMES_DA_ESTRUTURA = new Set(["Type", "Page", "Pages", "ObjStm", "XRef", "Contents", "Count", "Kids", "Parent"]);
export function paginasPdfEstimadas(b: Uint8Array): number | null {
  const texto = new TextDecoder("latin1").decode(b);
  if (/\/ObjStm(?![\w])/.test(texto) || new RegExp(String.raw`\/Type${ESPACO_PDF}\/XRef(?![\w])`).test(texto)) return null;
  for (const m of Array.from(texto.matchAll(/\/([^\s\0/<>[\]()%{}]{0,40}#[0-9A-Fa-f]{2}[^\s\0/<>[\]()%{}]{0,40})/g))) {
    const nome = m[1].replace(/#([0-9A-Fa-f]{2})/g, (_: string, h: string) => String.fromCharCode(parseInt(h, 16)));
    if (NOMES_DA_ESTRUTURA.has(nome)) return null;
  }
  const objetos = (texto.match(new RegExp(String.raw`\/Type${ESPACO_PDF}\/Page(?![s\w])`, "g")) ?? []).length;
  const pais = (texto.match(/\/Parent(?![\w])/g) ?? []).length;
  if (objetos <= 0 && pais <= 0) return null;
  const conteudos = (texto.match(/\/Contents(?![\w])/g) ?? []).length;
  const listasDeFilhos = Array.from(texto.matchAll(new RegExp(String.raw`\/Kids${ESPACO_PDF}\[([^\]]{0,20000})\]`, "g")));
  // lista de filhos longa demais (ou sem fechar, ou indireta) para contar com segurança: "não sei"
  if (listasDeFilhos.length !== (texto.match(/\/Kids(?![\w])/g) ?? []).length) return null;
  if (listasDeFilhos.some(m => m[1].includes("%"))) return null;
  const referencia = new RegExp(String.raw`\d+${ESPACO_PDF_UM}\d+${ESPACO_PDF}R(?![\w])`, "g");
  const filhos = listasDeFilhos.reduce((n, m) => n + (m[1].match(referencia) ?? []).length, 0);
  // /Count em referência indireta: o valor está em outro objeto — "não sei"
  if (new RegExp(String.raw`\/Count${ESPACO_PDF}\d+${ESPACO_PDF_UM}\d+${ESPACO_PDF}R(?![\w])`).test(texto)) return null;
  const declarado = Array.from(texto.matchAll(new RegExp(String.raw`\/Count${ESPACO_PDF}\+?(\d{1,9})(?:\.\d*)?`, "g"))).reduce((n, m) => Math.max(n, Number(m[1]) + (m[0].includes(".") ? 1 : 0)), 0);
  return Math.max(objetos, pais, conteudos, filhos, declarado);
}

/** Tamanho dos bytes de um base64 sem decodificar (para recusar antes de ocupar memória). */
export const bytesDoBase64 = (b64: string) => Math.floor((b64.replace(/=+$/, "").length * 3) / 4);

const NUMERO_DO_JID = /^(\d{10,15})@s\.whatsapp\.net$/;

export type MidiaDeGrupo = { tipo: Exclude<TipoMensagemGrupo, "texto">; mime: string | null; nome: string | null; tamanho: number | null };
export type MensagemDeGrupo =
  | { tipo: "ignorar"; motivo: "propria" | "sem_id" | "reacao" | "edicao" | "interacao" | "vazia" }
  | {
    tipo: "grupo"; grupoJid: string; externalId: string; participante: string | null; enviadaEm: Date | null;
    texto: string; midia: MidiaDeGrupo | null; encaminhada: boolean;
    /** EPIC-027 C2: o nome que o participante usa no WhatsApp (pushName), bruto — texto de TERCEIRO (quem grava filtra). Nunca é comando. */
    nomeRemetente: string | null;
  };

function tamanhoDeclarado(v: unknown): number | null {
  const s = segundos(v); // mesmo formato (número, texto ou Long)
  return s === null ? null : Math.max(0, Math.floor(s));
}

function midiaDe(m: Record<string, any>): MidiaDeGrupo | null {
  const pares: Array<[string, MidiaDeGrupo["tipo"]]> = [
    ["imageMessage", "imagem"], ["documentMessage", "documento"], ["videoMessage", "video"], ["audioMessage", "audio"], ["stickerMessage", "figurinha"],
  ];
  const doc = m.documentWithCaptionMessage?.message?.documentMessage;
  for (const [chave, tipo] of pares) {
    const x = chave === "documentMessage" ? (m.documentMessage ?? doc) : m[chave];
    if (!x || typeof x !== "object") continue;
    const mime = typeof x.mimetype === "string" ? x.mimetype.split(";")[0].trim().slice(0, 120) || null : null;
    return { tipo, mime, nome: typeof x.fileName === "string" ? nomeSeguroDeArquivo(x.fileName) : null, tamanho: tamanhoDeclarado(x.fileLength) };
  }
  return null;
}

/** Texto escrito junto: conversa, texto estendido ou legenda da mídia. */
function textoDe(m: Record<string, any>): string {
  const doc = m.documentWithCaptionMessage?.message?.documentMessage;
  const v = [m.conversation, m.extendedTextMessage?.text, m.imageMessage?.caption, m.videoMessage?.caption, m.documentMessage?.caption, doc?.caption]
    .find(x => typeof x === "string" && x.trim());
  return typeof v === "string" ? v : "";
}

/**
 * Um item de `messages.upsert` vindo de GRUPO (remoteJid termina em @g.us). Fora de grupo → null (segue a leitura da
 * conversa direta). NUNCA produz comando: quem chama só registra (se o grupo for cadastrado e ativo). O que a própria
 * Dolores enviou (fromMe), reação, edição/apagamento e interação (enquete, botão, fixar) não são registrados.
 */
export function lerMensagemDeGrupo(item: unknown): MensagemDeGrupo | null {
  const d = (item ?? {}) as { key?: Record<string, unknown>; message?: Record<string, any> | null; messageTimestamp?: unknown; pushName?: unknown };
  const key = d.key ?? {};
  const jid = typeof key.remoteJid === "string" ? key.remoteJid : "";
  if (!jid.endsWith("@g.us")) return null;
  if (key.fromMe === true) return { tipo: "ignorar", motivo: "propria" };
  const id = typeof key.id === "string" ? key.id.trim().slice(0, 160) : "";
  if (!id) return { tipo: "ignorar", motivo: "sem_id" };
  const m = desembrulhar(d.message ?? {});
  if (m.reactionMessage) return { tipo: "ignorar", motivo: "reacao" };
  if (m.protocolMessage || m.editedMessage) return { tipo: "ignorar", motivo: "edicao" };
  const texto = textoDe(m).trim();
  const midia = midiaDe(m);
  if (!texto && !midia) return { tipo: "ignorar", motivo: INTERACOES.some(k => m[k]) ? "interacao" : "vazia" };
  let participante: string | null = null;
  for (const alt of [key.participantPn, key.participantAlt, key.participant]) {
    if (typeof alt === "string" && NUMERO_DO_JID.test(alt)) { participante = NUMERO_DO_JID.exec(alt)![1]; break; }
  }
  const s = segundos(d.messageTimestamp);
  return {
    tipo: "grupo", grupoJid: jid, externalId: id, participante, enviadaEm: s === null ? null : new Date(s * 1000),
    texto, midia, encaminhada: foiEncaminhada(m),
    nomeRemetente: typeof d.pushName === "string" && d.pushName.trim() ? d.pushName.slice(0, 200) : null,
  };
}

/** Sem data, velha demais (histórico) ou no futuro: não é registrada. */
export function mensagemDeGrupoAntiga(enviadaEm: Date | null, agora: Date): boolean {
  if (!enviadaEm || Number.isNaN(enviadaEm.getTime())) return true;
  const idade = agora.getTime() - enviadaEm.getTime();
  return idade > IDADE_MAXIMA_GRUPO_MS || idade < -2 * 60_000;
}

/** Venceu a retenção do pendente? (só deixa de ser oferecido; nada é apagado) */
export function pendenteVencido(criadoEm: Date, agora: Date, retencaoDias: number): boolean {
  return agora.getTime() - criadoEm.getTime() > retencaoDias * 86_400_000;
}

/** "16/11 09:05" no horário de Imperatriz (UTC−3 fixo). */
export function diaHoraCurta(d: Date | null | undefined): string {
  if (!d) return "(sem data)";
  const s = new Date(d.getTime() - 3 * 60 * 60_000).toISOString();
  return `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}`;
}

/** Dia civil de Imperatriz (AAAA-MM-DD), para as contagens diárias. */
export const diaDeImperatriz = (d: Date) => new Date(d.getTime() - 3 * 60 * 60_000).toISOString().slice(0, 10);

/** Nome e telefone de cliente para comparar duplicidade (sem acento, minúsculas, espaços simples). */
export const nomeComparavel = (s: string | null | undefined) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
