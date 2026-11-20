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
/** Tamanho máximo compatível com a duração: 64 kB por segundo (512 kbit/s; MP3 de 320 kbit/s dá 40 kB/s). */
export const MAX_BYTES_POR_SEGUNDO_AUDIO = 64 * 1024;
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

/** QA-SEG C3 achado 2: teto de pixels (contra "bomba de descompressão"): 8 000 px por lado e 40 megapixels. */
export const MAX_LADO_IMAGEM_SAUDACAO = 8_000;
export const MAX_PIXELS_IMAGEM_SAUDACAO = 40_000_000;
/**
 * Depois do fim da imagem (EOI / IEND). QA-SEG C3 R2-3: o que o CELULAR põe depois do fim é CORTADO antes de gravar e enviar —
 * zeros de preenchimento, imagens extras do MPF (iPhone/câmeras: outro JPG, "FF D8 FF"), o vídeo da foto com movimento (caixa
 * MP4 "ftyp") e o rodapé da Samsung ("SEFH"/"SEFT"). Qualquer outra coisa (HTML, ZIP, script…) continua RECUSADA: não é de câmera.
 */
function sobraDeCelular(b: Uint8Array, de: number): boolean {
  if (de >= b.length) return true;
  const resto = b.subarray(de);
  if (resto.every(x => x === 0)) return true;
  let i = 0;
  while (i < resto.length && resto[i] === 0) i++; // zeros antes do apêndice
  if (comeca(resto, [0xff, 0xd8, 0xff], i)) return true;
  // caixa MP4 (4 bytes de tamanho + "ftyp"), logo depois do fim ou de zeros de preenchimento (o tamanho começa com zeros)
  for (let j = 0; j <= Math.min(i, 64); j++) if (ascii(resto, j + 4, 4) === "ftyp") return true;
  const fim = ascii(resto, Math.max(0, resto.length - 8), 8);
  return fim.includes("SEFT") || ascii(resto, i, 4) === "SEFH";
}

type ImagemLida = { mime: MimeImagemSaudacao; largura: number; altura: number; fim: number } | { erro: "formato" | "estrutura" | "dimensao" };

/** PNG: assinatura, IHDR primeiro (13 bytes), ao menos um IDAT e o IEND no fim; blocos encadeados até o fim, sem lixo depois. */
function lerPng(b: Uint8Array): ImagemLida {
  if (b.length < 8 + 25 + 12 || u32(b, 8) !== 13 || ascii(b, 12, 4) !== "IHDR") return { erro: "estrutura" };
  const largura = u32(b, 16);
  const altura = u32(b, 20);
  let i = 8;
  let idat = false;
  let blocos = 0;
  while (i + 12 <= b.length && blocos++ < 100_000) {
    const n = u32(b, i);
    const tipo = ascii(b, i + 4, 4);
    if (!/^[A-Za-z]{4}$/.test(tipo) || i + 12 + n > b.length) return { erro: "estrutura" };
    if (tipo === "IDAT") idat = true;
    i += 12 + n;
    if (tipo === "IEND") {
      if (!idat || n !== 0 || !sobraDeCelular(b, i)) return { erro: "estrutura" };
      return { mime: "image/png", largura, altura, fim: i };
    }
  }
  return { erro: "estrutura" };
}

/**
 * JPG: SOI, segmentos com tamanho, um quadro SOF0/SOF1/SOF2 (largura e altura), o SOS com os dados e o EOI (FF D9) no fim,
 * sem lixo depois. Marcadores de reinício (FF D0–D7) e bytes de preenchimento (FF 00) dentro dos dados são aceitos.
 */
function lerJpg(b: Uint8Array): ImagemLida {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return { erro: "formato" };
  let i = 2;
  let largura = 0;
  let altura = 0;
  let sof = false;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return { erro: "estrutura" };
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; } // preenchimento entre marcadores
    if (m === 0xd9 || m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) return { erro: "estrutura" }; // fim/reinício fora dos dados
    const n = (b[i + 2] << 8) | b[i + 3];
    if (n < 2 || i + 2 + n > b.length) return { erro: "estrutura" };
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) {
      if (n < 8 || sof) return { erro: "estrutura" }; // QA-SEG C3 R2-2: um quadro só (segundo SOF = estrutura inválida)
      altura = (b[i + 5] << 8) | b[i + 6];
      largura = (b[i + 7] << 8) | b[i + 8];
      sof = true;
    } else if (m >= 0xc3 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { erro: "formato" }; // outros tipos de quadro (sem perda, aritmético…): fora
    }
    i += 2 + n;
    if (m !== 0xda) continue;
    // dados comprimidos depois do SOS: até o próximo marcador de verdade
    if (!sof) return { erro: "estrutura" };
    while (i + 1 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const x = b[i + 1];
      if (x === 0x00 || (x >= 0xd0 && x <= 0xd7) || x === 0xff) { i += x === 0xff ? 1 : 2; continue; }
      break;
    }
    if (i + 1 >= b.length) return { erro: "estrutura" };
    if (b[i + 1] === 0xd9) {
      if (!sobraDeCelular(b, i + 2)) return { erro: "estrutura" };
      return largura && altura ? { mime: "image/jpeg", largura, altura, fim: i + 2 } : { erro: "estrutura" };
    }
    // outro segmento (ex.: SOS seguinte de JPG progressivo): continua o laço
  }
  return { erro: "estrutura" };
}

/** Lê a imagem pelos bytes: tipo, largura e altura, com a estrutura conferida e o teto de pixels. */
export function lerImagemSaudacao(b: Uint8Array): ImagemLida {
  const r = b.length > 8 && comeca(b, PNG) ? lerPng(b) : b.length > 3 && comeca(b, [0xff, 0xd8, 0xff]) ? lerJpg(b) : { erro: "formato" as const };
  if ("erro" in r) return r;
  if (!r.largura || !r.altura || r.largura > MAX_LADO_IMAGEM_SAUDACAO || r.altura > MAX_LADO_IMAGEM_SAUDACAO || r.largura * r.altura > MAX_PIXELS_IMAGEM_SAUDACAO)
    return { erro: "dimensao" };
  return r;
}

/** JPG ou PNG válido pelos bytes (estrutura e tamanho em pixels). null = não é imagem aceita. */
export function tipoDaImagemSaudacao(b: Uint8Array): MimeImagemSaudacao | null {
  const r = lerImagemSaudacao(b);
  return "erro" in r ? null : r.mime;
}

// ── Duração do áudio, pelos bytes ──

/**
 * Ogg/Opus (QA-SEG C3 achado 3): percorre TODAS as páginas, encadeadas do começo ao fim (sem lixo entre elas). A primeira é o
 * início do fluxo com "OpusHead"; UM fluxo só (mesmo número de série, nenhum segundo início). Duração = MAIOR posição de
 * amostra − pre-skip, a 48 kHz.
 */
/** Duração (s) de UM pacote Opus pelo byte TOC (RFC 6716 §3.1): tamanho do quadro pela config × número de quadros. null = inválido. */
function duracaoDoPacoteOpus(primeiros: number[], tamanho: number): number | null {
  if (tamanho === 0) return 0; // pacote vazio (DTX)
  const toc = primeiros[0];
  const config = toc >> 3;
  const quadroMs = config < 12 ? [10, 20, 40, 60][config % 4] : config < 16 ? [10, 20][config % 2] : [2.5, 5, 10, 20][config % 4];
  const codigo = toc & 0x03;
  const quadros = codigo === 0 ? 1 : codigo < 3 ? 2 : (tamanho >= 2 && primeiros.length >= 2 ? primeiros[1] & 0x3f : 0);
  if (!quadros || quadros * quadroMs > 120) return null; // o Opus não passa de 120 ms por pacote
  return quadros * quadroMs / 1000;
}

function duracaoOggOpus(b: Uint8Array): number | null {
  if (!comeca(b, [0x4f, 0x67, 0x67, 0x53]) || b.length < 47) return null; // "OggS"
  let i = 0;
  let serial = -1;
  let preSkip = 0;
  let maior = 0;
  let paginas = 0;
  // QA-SEG C3 R2-4: além da posição de amostra (forjável), soma a duração REAL dos pacotes de áudio pelo byte TOC de cada um; vale
  // a MAIOR das duas. Os pacotes são remontados pelo "lacing" (segmento < 255 fecha o pacote; pacote pode atravessar páginas).
  let pacotes = 0;
  let tamanhoDoPacote = 0;
  let primeiros: number[] = [];
  let somaDosPacotes = 0;
  while (i < b.length) {
    if (i + 27 > b.length || b[i] !== 0x4f || b[i + 1] !== 0x67 || b[i + 2] !== 0x67 || b[i + 3] !== 0x53 || b[i + 4] !== 0) return null;
    const flags = b[i + 5];
    const s = (b[i + 14] | (b[i + 15] << 8) | (b[i + 16] << 16) | (b[i + 17] << 24)) >>> 0;
    const nseg = b[i + 26];
    if (i + 27 + nseg > b.length) return null;
    let corpo = 0;
    for (let k = 0; k < nseg; k++) corpo += b[i + 27 + k];
    const inicio = i + 27 + nseg;
    if (inicio + corpo > b.length) return null;
    let pos = inicio;
    for (let k = 0; k < nseg; k++) {
      const len = b[i + 27 + k];
      for (let t = 0; t < len && primeiros.length < 2; t++) primeiros.push(b[pos + t]);
      tamanhoDoPacote += len;
      pos += len;
      if (len < 255) {
        if (pacotes >= 2) { // os dois primeiros são cabeçalhos (OpusHead, OpusTags)
          const d = duracaoDoPacoteOpus(primeiros, tamanhoDoPacote);
          if (d === null) return null;
          somaDosPacotes += d;
        }
        pacotes++;
        tamanhoDoPacote = 0;
        primeiros = [];
      }
    }
    if (paginas === 0) {
      if (!(flags & 0x02) || corpo < 19 || ascii(b, inicio, 8) !== "OpusHead") return null;
      serial = s;
      preSkip = b[inicio + 10] | (b[inicio + 11] << 8);
    } else if (s !== serial || (flags & 0x02)) {
      return null; // segundo fluxo (vídeo, outro áudio…) ou segundo início
    }
    // posição de amostra (-1 = página sem fim de pacote: não conta)
    let semFim = true;
    for (let k = 0; k < 8; k++) if (b[i + 6 + k] !== 0xff) { semFim = false; break; }
    if (!semFim) {
      let g = 0;
      for (let k = 7; k >= 0; k--) g = g * 256 + b[i + 6 + k];
      if (g >= 2 ** 52) return null;
      if (g > maior) maior = g;
    }
    paginas++;
    i = inicio + corpo;
  }
  if (paginas < 2 || maior <= preSkip) return null;
  return Math.max((maior - preSkip) / 48_000, somaDosPacotes - preSkip / 48_000);
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

const duracaoDoCabecalho = (b: Uint8Array, c: Caixa, v0: number, v1: number): { escala: number; duracao: number } | null => {
  if (c.fim - c.inicio < (b[c.inicio] === 1 ? v1 + 12 : v0 + 8)) return null;
  return b[c.inicio] === 1
    ? { escala: u32(b, c.inicio + v1), duracao: u32(b, c.inicio + v1 + 4) * 2 ** 32 + u32(b, c.inicio + v1 + 8) }
    : { escala: u32(b, c.inicio + v0), duracao: u32(b, c.inicio + v0 + 4) };
};

/**
 * M4A (MP4 só de som; QA-SEG C3 achado 3): duração do "mvhd", conferida com o "mdhd" da faixa de som (as duas precisam
 * concordar); exige UMA faixa de som, nenhuma de vídeo e o "mdat" com os dados (o tamanho é conferido contra a duração em
 * `conferirMidiaSaudacao`).
 */
function duracaoM4a(b: Uint8Array): number | null {
  if (b.length < 16 || ascii(b, 4, 4) !== "ftyp") return null;
  const topo = caixas(b, 0, b.length);
  const moov = topo.find(c => c.tipo === "moov");
  if (topo.some(c => c.tipo === "moof")) return null; // QA-SEG C3 R3-2: arquivo fragmentado (gravado em partes): fora
  const mdat = topo.filter(c => c.tipo === "mdat").reduce((t, c) => t + (c.fim - c.inicio), 0);
  if (!moov || mdat <= 0) return null;
  const dentro = caixas(b, moov.inicio, moov.fim);
  if (dentro.some(c => c.tipo === "mvex")) return null; // fragmentado
  const mvhdCaixa = dentro.find(c => c.tipo === "mvhd");
  const mvhd = mvhdCaixa ? duracaoDoCabecalho(b, mvhdCaixa, 12, 20) : null;
  if (!mvhd || !mvhd.escala) return null;
  const segundos = mvhd.duracao / mvhd.escala;
  let som = 0;
  for (const trak of dentro.filter(c => c.tipo === "trak")) {
    const mdia = caixas(b, trak.inicio, trak.fim).find(c => c.tipo === "mdia");
    const dentroMdia = mdia ? caixas(b, mdia.inicio, mdia.fim) : [];
    const hdlr = dentroMdia.find(c => c.tipo === "hdlr");
    const tipo = hdlr ? ascii(b, hdlr.inicio + 8, 4) : "";
    if (tipo === "vide") return null;
    if (tipo !== "soun") continue;
    som++;
    const mdhdCaixa = dentroMdia.find(c => c.tipo === "mdhd");
    const mdhd = mdhdCaixa ? duracaoDoCabecalho(b, mdhdCaixa, 12, 20) : null;
    if (!mdhd || !mdhd.escala) return null;
    const daFaixa = mdhd.duracao / mdhd.escala;
    if (Math.abs(daFaixa - segundos) > Math.max(1, segundos * 0.05)) return null; // cabeçalhos que não concordam
    // QA-SEG C3 R2-4/R3-2: a tabela de tempos das amostras (stts) da faixa de som é OBRIGATÓRIA (ao menos uma entrada) e precisa
    // somar a mesma duração do mdhd
    const minf = dentroMdia.find(c => c.tipo === "minf");
    const stbl = minf ? caixas(b, minf.inicio, minf.fim).find(c => c.tipo === "stbl") : undefined;
    const stts = stbl ? caixas(b, stbl.inicio, stbl.fim).find(c => c.tipo === "stts") : undefined;
    if (!stts) return null;
    {
      const n = stts.fim - stts.inicio >= 8 ? u32(b, stts.inicio + 4) : -1;
      if (n < 1 || stts.inicio + 8 + n * 8 > stts.fim) return null;
      let total = 0;
      for (let k = 0; k < n; k++) total += u32(b, stts.inicio + 8 + k * 8) * u32(b, stts.inicio + 12 + k * 8);
      if (Math.abs(total / mdhd.escala - daFaixa) > Math.max(1, daFaixa * 0.05)) return null;
    }
  }
  return som === 1 ? segundos : null;
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
  /** `tamanho` = só a imagem validada (até o fim dela); `fim` = onde cortar (o apêndice do celular não é gravado nem enviado). */
  | { ok: true; tipo: "imagem"; mime: MimeImagemSaudacao; tamanho: number; duracaoS: null; fim: number }
  | { ok: true; tipo: "audio"; mime: MimeAudioSaudacao; tamanho: number; duracaoS: number }
  | { ok: false; erro: string };

/** A conferência que vale (tela e servidor): tipo pelos bytes, tamanho e duração. Mensagens em linguagem simples. */
export function conferirMidiaSaudacao(tipo: TipoMidiaSaudacao, b: Uint8Array): MidiaConferida {
  if (!b.length) return { ok: false, erro: "O arquivo está vazio." };
  if (tipo === "imagem") {
    if (b.length > LIMITE_IMAGEM_SAUDACAO) return { ok: false, erro: `A imagem passa de ${mb(LIMITE_IMAGEM_SAUDACAO)}. Diminua a foto e tente de novo.` };
    const img = lerImagemSaudacao(b);
    if ("erro" in img) return { ok: false, erro: img.erro === "dimensao"
      ? `A imagem é grande demais em pixels (máximo ${MAX_LADO_IMAGEM_SAUDACAO.toLocaleString("pt-BR")} px por lado e 40 megapixels). Diminua a foto e tente de novo.`
      : img.erro === "estrutura"
        ? "Esta imagem está incompleta ou tem algo a mais depois do fim. Abra a foto e salve de novo como JPG ou PNG comum."
        : "Este arquivo não é uma imagem JPG ou PNG. Envie uma foto em JPG ou PNG." };
    return { ok: true, tipo, mime: img.mime, tamanho: img.fim, duracaoS: null, fim: img.fim };
  }
  if (b.length > LIMITE_AUDIO_SAUDACAO) return { ok: false, erro: `O áudio passa de ${mb(LIMITE_AUDIO_SAUDACAO)}. Envie um áudio menor.` };
  const audio = lerAudioSaudacao(b);
  if (!audio) return { ok: false, erro: b.length >= 8 && ascii(b, 4, 4) === "ftyp"
    ? "Não consegui conferir este M4A (formato incomum ou incompleto). Salve o áudio de novo em MP3 ou M4A comum."
    : "Não reconheci este áudio. Envie em OGG (Opus, o do WhatsApp), MP3 ou M4A." };
  if (audio.duracaoS > DURACAO_MAX_AUDIO_SAUDACAO_S + FOLGA_DURACAO_S)
    return { ok: false, erro: `O áudio tem ${Math.round(audio.duracaoS)} segundos; o máximo é 2 minutos (${DURACAO_MAX_AUDIO_SAUDACAO_S} segundos).` };
  if (audio.duracaoS < 0.5) return { ok: false, erro: "O áudio está vazio ou curto demais." };
  // QA-SEG C3 achado 3: tamanho compatível com a duração (mais de 64 kB por segundo = cabeçalho mentindo ou carga escondida)
  if (b.length / audio.duracaoS > MAX_BYTES_POR_SEGUNDO_AUDIO)
    return { ok: false, erro: "Este áudio tem dados demais para a duração dele. Grave ou exporte de novo em OGG, MP3 ou M4A comum." };
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
