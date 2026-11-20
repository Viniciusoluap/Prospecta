// EPIC-026 C3 (pedido do dono de 20/11/2026: "na tela de saudação permita também adicionar imagem e áudio") — regras PURAS da
// mídia da saudação de campanha, usadas pela tela (aviso antes de enviar) e pelo servidor (a decisão que vale).
// O tipo do arquivo é decidido pelos BYTES (assinatura do formato), nunca pela extensão nem pelo tipo declarado pelo navegador.
// A duração do áudio também é lida dos bytes (Ogg/Opus: posição final; MP3: soma dos quadros; M4A: cabeçalho "mvhd").

/** Teto da imagem (JPG/PNG): 5 MB. Sobe em partes de 1 MB (cada pedido fica bem abaixo do limite de 4,5 MB da Vercel). */
export const LIMITE_IMAGEM_SAUDACAO = 5 * 1024 * 1024;
/** Teto do áudio: 5 MB (2 minutos em MP3 de 128 kbit/s dão cerca de 1,9 MB). */
export const LIMITE_AUDIO_SAUDACAO = 5 * 1024 * 1024;
/** Duração máxima do áudio: 2 minutos. */
export const DURACAO_MAX_AUDIO_SAUDACAO_S = 120;
/** Folga de arredondamento na duração (cabeçalhos de alguns gravadores). */
const FOLGA_DURACAO_S = 0.5;

export const TIPOS_IMAGEM_SAUDACAO = ["image/jpeg", "image/png"] as const;
export const TIPOS_AUDIO_SAUDACAO = ["audio/ogg", "audio/mpeg", "audio/mp4"] as const;
export type MimeImagemSaudacao = (typeof TIPOS_IMAGEM_SAUDACAO)[number];
export type MimeAudioSaudacao = (typeof TIPOS_AUDIO_SAUDACAO)[number];
export type TipoMidiaSaudacao = "imagem" | "audio";

export const ACCEPT_IMAGEM_SAUDACAO = ".jpg,.jpeg,.png,image/jpeg,image/png";
export const ACCEPT_AUDIO_SAUDACAO = ".ogg,.opus,.mp3,.m4a,audio/ogg,audio/opus,audio/mpeg,audio/mp4,audio/x-m4a";

const EXTENSAO: Record<MimeImagemSaudacao | MimeAudioSaudacao, string> = {
  "image/jpeg": "jpg", "image/png": "png", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a",
};

const comeca = (b: Uint8Array, assinatura: readonly number[], em = 0) =>
  b.length >= em + assinatura.length && assinatura.every((x, i) => b[em + i] === x);
const ascii = (b: Uint8Array, em: number, n: number) => {
  let s = "";
  for (let i = 0; i < n && em + i < b.length; i++) s += String.fromCharCode(b[em + i]);
  return s;
};
const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** JPG ou PNG pelos bytes (PNG exige o bloco IHDR logo depois da assinatura). null = não é imagem aceita. */
export function tipoDaImagemSaudacao(b: Uint8Array): MimeImagemSaudacao | null {
  if (b.length > 16 && comeca(b, PNG) && ascii(b, 12, 4) === "IHDR") return "image/png";
  if (b.length > 4 && comeca(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  return null;
}

// ── Duração do áudio, pelos bytes ──

/** Ogg/Opus: (posição de amostra da última página − pre-skip) / 48 000. Só Opus (cabeçalho "OpusHead"). */
function duracaoOggOpus(b: Uint8Array): number | null {
  if (!comeca(b, [0x4f, 0x67, 0x67, 0x53]) || b.length < 47) return null; // "OggS"
  const segmentos = b[26];
  const inicioDoPacote = 27 + segmentos;
  if (ascii(b, inicioDoPacote, 8) !== "OpusHead") return null;
  const preSkip = b[inicioDoPacote + 10] | (b[inicioDoPacote + 11] << 8);
  // última página: procura "OggS" de trás para frente
  for (let i = b.length - 27; i >= 0; i--) {
    if (b[i] !== 0x4f || b[i + 1] !== 0x67 || b[i + 2] !== 0x67 || b[i + 3] !== 0x53 || b[i + 4] !== 0) continue;
    let granule = 0;
    for (let k = 7; k >= 0; k--) granule = granule * 256 + b[i + 6 + k];
    if (granule <= 0 || granule >= 2 ** 52) return null;
    return Math.max(0, granule - preSkip) / 48_000;
  }
  return null;
}

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const TAXAS = { 3: [44_100, 48_000, 32_000], 2: [22_050, 24_000, 16_000], 0: [11_025, 12_000, 8_000] } as Record<number, number[]>;

/** MP3 (MPEG camada III): soma os quadros, um a um (vale para taxa fixa e variável). Precisa de quadros seguidos e válidos. */
function duracaoMp3(b: Uint8Array): number | null {
  let i = 0;
  if (ascii(b, 0, 3) === "ID3" && b.length > 10) {
    const tamanho = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
    i = 10 + tamanho + ((b[5] & 0x10) ? 10 : 0);
  }
  let segundos = 0;
  let quadros = 0;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) {
      if (quadros === 0 && i < 4096 && b[i] === 0) { i++; continue; } // preenchimento antes do 1º quadro
      if (ascii(b, i, 3) === "TAG") break; // ID3v1 no fim
      break;
    }
    const versao = (b[i + 1] >> 3) & 0x03; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const camada = (b[i + 1] >> 1) & 0x03; // 1 = camada III
    const indiceTaxa = (b[i + 2] >> 4) & 0x0f;
    const indiceAmostra = (b[i + 2] >> 2) & 0x03;
    if (versao === 1 || camada !== 1 || indiceTaxa === 0 || indiceTaxa === 15 || indiceAmostra === 3) break;
    const kbps = (versao === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3)[indiceTaxa];
    const amostragem = TAXAS[versao][indiceAmostra];
    const amostrasPorQuadro = versao === 3 ? 1152 : 576;
    const enchimento = (b[i + 2] >> 1) & 0x01;
    const tamanho = Math.floor((amostrasPorQuadro / 8) * kbps * 1000 / amostragem) + enchimento;
    if (tamanho < 4) break;
    segundos += amostrasPorQuadro / amostragem;
    quadros++;
    i += tamanho;
  }
  // exige um áudio de verdade: vários quadros e o arquivo lido quase inteiro (não aceita lixo depois de um quadro solto)
  if (quadros < 10 || i < b.length - 1024) return null;
  return segundos;
}

type Caixa = { tipo: string; inicio: number; fim: number };
function caixas(b: Uint8Array, de: number, ate: number): Caixa[] {
  const lista: Caixa[] = [];
  let i = de;
  while (i + 8 <= ate && lista.length < 200) {
    let tamanho = u32(b, i);
    const tipo = ascii(b, i + 4, 4);
    let cabecalho = 8;
    if (tamanho === 1) { if (i + 16 > ate) break; tamanho = u32(b, i + 8) * 2 ** 32 + u32(b, i + 12); cabecalho = 16; }
    else if (tamanho === 0) tamanho = ate - i;
    if (tamanho < cabecalho || i + tamanho > ate) break;
    lista.push({ tipo, inicio: i + cabecalho, fim: i + tamanho });
    i += tamanho;
  }
  return lista;
}

/** M4A (MP4 só de som): duração do "mvhd"; exige uma faixa de som ("soun") e nenhuma de vídeo ("vide"). */
function duracaoM4a(b: Uint8Array): number | null {
  if (b.length < 16 || ascii(b, 4, 4) !== "ftyp") return null;
  const moov = caixas(b, 0, b.length).find(c => c.tipo === "moov");
  if (!moov) return null;
  const dentro = caixas(b, moov.inicio, moov.fim);
  const mvhd = dentro.find(c => c.tipo === "mvhd");
  if (!mvhd) return null;
  const versao = b[mvhd.inicio];
  let escala: number; let duracao: number;
  if (versao === 1) { escala = u32(b, mvhd.inicio + 20); duracao = u32(b, mvhd.inicio + 24) * 2 ** 32 + u32(b, mvhd.inicio + 28); }
  else { escala = u32(b, mvhd.inicio + 12); duracao = u32(b, mvhd.inicio + 16); }
  if (!escala) return null;
  const manipuladores: string[] = [];
  for (const trak of dentro.filter(c => c.tipo === "trak")) {
    const mdia = caixas(b, trak.inicio, trak.fim).find(c => c.tipo === "mdia");
    const hdlr = mdia ? caixas(b, mdia.inicio, mdia.fim).find(c => c.tipo === "hdlr") : undefined;
    if (hdlr) manipuladores.push(ascii(b, hdlr.inicio + 8, 4));
  }
  if (!manipuladores.includes("soun") || manipuladores.includes("vide")) return null;
  return duracao / escala;
}

/** Formato e duração do áudio, pelos bytes. null = não é Ogg/Opus, MP3 ou M4A legível. */
export function lerAudioSaudacao(b: Uint8Array): { mime: MimeAudioSaudacao; duracaoS: number } | null {
  const ogg = duracaoOggOpus(b);
  if (ogg !== null) return { mime: "audio/ogg", duracaoS: ogg };
  const m4a = duracaoM4a(b);
  if (m4a !== null) return { mime: "audio/mp4", duracaoS: m4a };
  const mp3 = duracaoMp3(b);
  if (mp3 !== null) return { mime: "audio/mpeg", duracaoS: mp3 };
  return null;
}

const mb = (n: number) => `${(n / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} MB`;

export type MidiaConferida =
  | { ok: true; tipo: "imagem"; mime: MimeImagemSaudacao; tamanho: number; duracaoS: null }
  | { ok: true; tipo: "audio"; mime: MimeAudioSaudacao; tamanho: number; duracaoS: number }
  | { ok: false; erro: string };

/** A conferência que vale (tela e servidor): tipo pelos bytes, tamanho e duração. Mensagens em linguagem simples. */
export function conferirMidiaSaudacao(tipo: TipoMidiaSaudacao, b: Uint8Array): MidiaConferida {
  if (!b.length) return { ok: false, erro: "O arquivo está vazio." };
  if (tipo === "imagem") {
    if (b.length > LIMITE_IMAGEM_SAUDACAO) return { ok: false, erro: `A imagem passa de ${mb(LIMITE_IMAGEM_SAUDACAO)}. Diminua a foto e tente de novo.` };
    const mime = tipoDaImagemSaudacao(b);
    if (!mime) return { ok: false, erro: "Este arquivo não é uma imagem JPG ou PNG. Envie uma foto em JPG ou PNG." };
    return { ok: true, tipo, mime, tamanho: b.length, duracaoS: null };
  }
  if (b.length > LIMITE_AUDIO_SAUDACAO) return { ok: false, erro: `O áudio passa de ${mb(LIMITE_AUDIO_SAUDACAO)}. Envie um áudio menor.` };
  const audio = lerAudioSaudacao(b);
  if (!audio) return { ok: false, erro: "Não reconheci este áudio. Envie em OGG (Opus, o do WhatsApp), MP3 ou M4A." };
  if (audio.duracaoS > DURACAO_MAX_AUDIO_SAUDACAO_S + FOLGA_DURACAO_S)
    return { ok: false, erro: `O áudio tem ${Math.round(audio.duracaoS)} segundos; o máximo é 2 minutos (${DURACAO_MAX_AUDIO_SAUDACAO_S} segundos).` };
  if (audio.duracaoS < 0.5) return { ok: false, erro: "O áudio está vazio ou curto demais." };
  return { ok: true, tipo, mime: audio.mime, tamanho: b.length, duracaoS: Math.round(audio.duracaoS * 10) / 10 };
}

// (construtor, não literal: a flag "u" em regex literal quebra o tsc deste projeto)
const FORA_DO_NOME = new RegExp("[^\\p{L}\\p{N} ._()-]+", "gu");

/** Nome seguro para guardar e mostrar: sem caminho, sem caracteres de controle, extensão a do tipo REAL (pelos bytes). */
export function nomeSeguroDaMidia(nome: string, mime: MimeImagemSaudacao | MimeAudioSaudacao): string {
  const base = (nome.split(/[\\/]/).pop() ?? "")
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(FORA_DO_NOME, "_")
    .replace(/^[.\s_]+/, "")
    .slice(0, 80)
    .trim();
  return `${base || "arquivo"}.${EXTENSAO[mime]}`;
}

/** Escopo do envio em partes (documentChunks.part) da mídia de UMA campanha. */
export const escopoMidiaSaudacao = (campanhaId: number, tipo: TipoMidiaSaudacao) => `saudacao-midia:${campanhaId}:${tipo}`;
