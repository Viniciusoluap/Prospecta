// EPIC-026 C3 — portão de QA de SEGURANÇA (independente). Provas de achados e de defesas que seguram.
// Os testes marcados "ACHADO" descreviam o comportamento frágil; com as correções (achados 1, 2, 3 e 5) a expectativa foi invertida
// ("CORRIGIDO"). Os arquivos de exemplo passaram a ter a estrutura mínima válida (PNG com IDAT/IEND; Ogg sem lixo entre páginas).
// PGlite; nada sai para a rede.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn(), getDashboardSetting: vi.fn(), saveDashboardSetting: vi.fn() }));
vi.mock("../whatsapp-router.js", async orig => ({ ...(await orig<typeof import("../whatsapp-router.js")>()), configEvolution: vi.fn(async () => null) }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { conferirMidiaSaudacao, escopoMidiaSaudacao, lerAudioSaudacao } from "../../shared/whatsapp/saudacao-midia.js";
import { ENV } from "../_core/env.js";
import { getDashboardSetting, getDb, saveDashboardSetting } from "../db.js";
import { appRouter } from "../routers.js";
import { limparPausaDoAtendimento } from "./atendimento.js";
import { definirClienteModelo } from "./cerebro.js";
import { definirDependenciasMarcacao } from "./marcacao.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte } from "./ponte.js";
import { definirDependenciasRoteamento } from "./roteamento.js";
import { AGORA, CENARIO, criarBanco, MIGRACAO_0137 } from "./testes-banco.js";
import { definirDependenciasTranscricao } from "./transcricao.js";
import { definirDependenciasWhatsapp, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";

// ── Arquivos montados byte a byte ──

const pngComDimensao = (largura: number, altura: number) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0); ihdr.writeUInt32BE(altura, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from("IHDR"), ihdr, Buffer.alloc(4),
    Buffer.from([0, 0, 0, 8]), Buffer.from("IDAT"), Buffer.alloc(8, 1), Buffer.alloc(4), Buffer.from([0, 0, 0, 0]), Buffer.from("IEND"), Buffer.alloc(4)]);
};
const PNG = pngComDimensao(10, 10);
const paginaOgg = (granule: number, pacote: Buffer, serial = 0) => {
  const h = Buffer.alloc(27);
  h.write("OggS", 0, "latin1"); h[4] = 0;
  h.writeBigUInt64LE(BigInt(granule), 6); h.writeUInt32LE(serial, 14); h[26] = 1;
  if (pacote.subarray(0, 8).toString("latin1") === "OpusHead" || pacote[0] === 0x80) h[5] = 0x02; // início do fluxo
  return Buffer.concat([h, Buffer.from([pacote.length]), pacote]);
};
const opusHead = () => {
  const head = Buffer.alloc(19);
  head.write("OpusHead", 0, "latin1"); head[8] = 1; head[9] = 1; head.writeUInt16LE(312, 10); head.writeUInt32LE(48_000, 12);
  return head;
};
const mp3Frames = (segundos: number) => {
  // MPEG-2.5 camada III, 8 kbit/s, 8 kHz: quadro de 72 bytes = 0,072 s
  const q = Buffer.alloc(72, 0x55);
  q[0] = 0xff; q[1] = 0xe2; q[2] = 0x18; q[3] = 0x00;
  return Buffer.concat(Array.from({ length: Math.ceil(segundos / 0.072) }, () => q));
};
const caixa = (tipo: string, ...dentro: Buffer[]) => {
  const corpo = Buffer.concat(dentro);
  const h = Buffer.alloc(8); h.writeUInt32BE(8 + corpo.length, 0); h.write(tipo, 4, "latin1");
  return Buffer.concat([h, corpo]);
};
const m4a = (segundos: number, extra: Buffer[] = []) => {
  const mvhd = Buffer.alloc(100); mvhd.writeUInt32BE(1000, 12); mvhd.writeUInt32BE(Math.round(segundos * 1000), 16);
  const hdlr = Buffer.alloc(24); hdlr.write("soun", 8, "latin1");
  return Buffer.concat([caixa("ftyp", Buffer.from("M4A \x00\x00\x00\x00", "latin1")), caixa("moov", caixa("mvhd", mvhd), caixa("trak", caixa("mdia", caixa("hdlr", hdlr)))), ...extra]);
};

describe("conferência pelos bytes — tentativas de quebrar", () => {
  it("CORRIGIDO (achado 2): JPG só com o prefixo FF D8 FF não passa (poliglota/HTML/truncado)", () => {
    const poliglota = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("<html><script>alert(1)</script></html>")]);
    expect(conferirMidiaSaudacao("imagem", poliglota)).toMatchObject({ ok: false });
    expect(conferirMidiaSaudacao("imagem", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toMatchObject({ ok: false }); // 5 bytes, sem fim de imagem
  });
  it("CORRIGIDO (achado 2): PNG com dimensão gigante (bomba de descompressão) é recusado — teto de 8 000 px por lado e 40 MP", () => {
    expect(conferirMidiaSaudacao("imagem", pngComDimensao(100_000, 100_000))).toMatchObject({ ok: false, erro: expect.stringMatching(/grande demais em pixels/) });
    expect(conferirMidiaSaudacao("imagem", pngComDimensao(10, 10))).toMatchObject({ ok: true, mime: "image/png" });
  });
  it("SVG, HTML, GIF e MZ continuam recusados", () => {
    for (const s of ["<svg xmlns='http://www.w3.org/2000/svg'/>", "<!doctype html><html>", "GIF89a" + "x".repeat(50), "MZ" + "\0".repeat(100)])
      expect(conferirMidiaSaudacao("imagem", Buffer.from(s)).ok).toBe(false);
  });
  it("CORRIGIDO (achado 3): Ogg/Opus com 30 min de páginas e uma última página forjada de 10 s vale pela MAIOR posição (30 min) e é recusado", () => {
    const pacote = Buffer.alloc(200, 1);
    const paginas: Buffer[] = [paginaOgg(0, opusHead()), paginaOgg(0, Buffer.alloc(20, 1))];
    // 1 página a cada 20 ms de áudio até 30 min (granule crescente), depois a última página diz 10 s
    for (let g = 960; g <= 30 * 60 * 48_000; g += 960 * 50) paginas.push(paginaOgg(g + 312, pacote));
    paginas.push(paginaOgg(10 * 48_000 + 312, pacote));
    const b = Buffer.concat(paginas);
    expect(b.length).toBeLessThan(5 * 1024 * 1024);
    expect(lerAudioSaudacao(b)?.duracaoS).toBeGreaterThanOrEqual(30 * 60 - 1);
    expect(conferirMidiaSaudacao("audio", b)).toMatchObject({ ok: false, erro: expect.stringMatching(/máximo é 2 minutos/) });
  });
  it("CORRIGIDO (achado 3): Ogg com OpusHead e um 2º fluxo de vídeo (Theora) é recusado", () => {
    const theora = Buffer.concat([Buffer.from([0x80]), Buffer.from("theora"), Buffer.alloc(40)]);
    const b = Buffer.concat([paginaOgg(0, opusHead(), 1), paginaOgg(0, theora, 2), Buffer.alloc(1000, 7), paginaOgg(10 * 48_000 + 312, Buffer.alloc(30), 1)]);
    expect(lerAudioSaudacao(b)).toBeNull();
    expect(conferirMidiaSaudacao("audio", b).ok).toBe(false);
  });
  it("CORRIGIDO (achado 3): M4A que declara 10 s no mvhd e carrega 4 MB de 'mdat' é recusado (sem mdhd e tamanho incompatível)", () => {
    const b = m4a(10, [caixa("mdat", Buffer.alloc(4 * 1024 * 1024, 0x21))]);
    expect(conferirMidiaSaudacao("audio", b)).toMatchObject({ ok: false });
  });
  it("MP3: a duração é a soma dos quadros — 30 min a 8 kbit/s (cabe em 5 MB) é recusado", () => {
    const b = mp3Frames(30 * 60);
    expect(b.length).toBeLessThan(5 * 1024 * 1024);
    expect(conferirMidiaSaudacao("audio", b)).toMatchObject({ ok: false, erro: expect.stringMatching(/máximo é 2 minutos/) });
  });
  it("entradas degeneradas de 5 MB não travam nem demoram (sem laço infinito)", () => {
    const n = 5 * 1024 * 1024;
    const entradas: Record<string, Buffer> = {
      zeros: Buffer.alloc(n, 0),
      ffs: Buffer.alloc(n, 0xff),
      oggs: Buffer.alloc(n, Buffer.from("OggS\0")),
      cabecalhoMp3: Buffer.alloc(n, Buffer.from([0xff, 0xfb, 0x90, 0x00])),
      caixasZero: Buffer.concat([Buffer.from("\0\0\0\x10ftypM4A \0\0\0\0", "latin1"), Buffer.alloc(n - 16, 0)]),
      caixasMinimas: Buffer.concat([Buffer.from("\0\0\0\x10ftypM4A \0\0\0\0", "latin1"), Buffer.alloc(n - 16, Buffer.from("\0\0\0\x08moov", "latin1"))]),
      id3Gigante: Buffer.concat([Buffer.from("ID3\x03\x00\x00\x7f\x7f\x7f\x7f", "latin1"), Buffer.alloc(n - 10, 0xff)]),
      oggSemOpus: Buffer.concat([Buffer.from("OggS"), Buffer.alloc(n - 4, 0x4f)]),
    };
    for (const [nome, b] of Object.entries(entradas)) {
      const t = performance.now();
      conferirMidiaSaudacao("audio", b);
      conferirMidiaSaudacao("imagem", b);
      const ms = performance.now() - t;
      expect(ms, nome).toBeLessThan(3_000);
    }
  });
});

// ── Com banco ──

const DONO = "5599991234567";
const EMPRESA = "5599900001111";
const ESTRANHO = "5511955554444";
let banco: Awaited<ReturnType<typeof criarBanco>>;
let falhar: Set<string>;
let enviarTexto: ReturnType<typeof vi.fn>;
let enviarMidia: ReturnType<typeof vi.fn>;
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(s: string) => (await banco.pg.query<T>(s)).rows;
let seq = 0;
const direta = (p: { de?: string; texto?: string; fromMe?: boolean; id?: string; message?: Record<string, unknown> } = {}) => ({
  key: { remoteJid: `${p.de ?? ESTRANHO}@s.whatsapp.net`, fromMe: p.fromMe ?? false, id: p.id ?? `QA${++seq}` },
  message: p.message ?? { conversation: p.texto ?? "Oi, quero saber do lançamento" },
  messageTimestamp: Math.floor((AGORA.getTime() - 20_000) / 1000), pushName: "Contato",
});
const aviso = (item: unknown) => ({ event: "messages.upsert", instance: "prospecta-dolores", data: item });
const chamar = (body: unknown) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, body, ip: "203.0.113.9" } as never);
const caller = (role: string, id = 1, permissoes: string[] = ["whatsapp"]) =>
  appRouter.createCaller({ user: { id, role, active: true, permissions: JSON.stringify(permissoes) }, req: {}, res: {} } as never);
const anonimo = () => appRouter.createCaller({ user: null, req: {}, res: {} } as never);
async function campanhaAtiva() {
  const [c] = await q<{ id: number }>(`INSERT INTO whatsapp_campanhas (nome, texto, ativa) VALUES ('Lançamento', 'Olá! Conheça o Residencial.', true) RETURNING id`);
  return c.id;
}
async function subir(c: ReturnType<typeof caller>, campanhaId: number, tipo: "imagem" | "audio", bytes: Buffer, nome: string, uploadId = `qa-envio-${++seq}-abcdefghijklmnop`) {
  const total = Math.ceil(bytes.length / (1024 * 1024));
  for (let part = 0; part < total; part++)
    await c.documentChunks.part({ uploadId, part, total, scope: escopoMidiaSaudacao(campanhaId, tipo), fileName: nome, base64: bytes.subarray(part * 1024 * 1024, (part + 1) * 1024 * 1024).toString("base64") });
  return uploadId;
}
const OGG10 = Buffer.concat([paginaOgg(0, opusHead()), paginaOgg(0, Buffer.alloc(20, 1)), paginaOgg(5 * 48_000 + 312, Buffer.alloc(200, 9)), paginaOgg(10 * 48_000 + 312, Buffer.alloc(30, 2))]);

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`CREATE TABLE IF NOT EXISTS document_upload_chunks (
    upload_id varchar(64) NOT NULL, part integer NOT NULL CHECK (part BETWEEN 0 AND 19), total integer NOT NULL CHECK (total BETWEEN 1 AND 20),
    user_id integer NOT NULL, scope varchar(150) NOT NULL, file_name varchar(255) NOT NULL,
    data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 1048576), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (upload_id, part))`);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}',
      numero_dolores = '${EMPRESA}', ia_ligada = true WHERE id = 1;`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  esquecerUsuarioDolores();
  limparPausaDoAtendimento();
  definirDependenciasPonte({ agora: () => AGORA });
  definirDependenciasWhatsapp({ agora: () => AGORA, enviar: (async () => true) as never });
  falhar = new Set();
  enviarTexto = vi.fn(async () => (falhar.has("texto") ? null : `EVO${++seq}`));
  enviarMidia = vi.fn(async (p: { midia: { tipo: string } }) => (falhar.has(p.midia.tipo) ? null : `EVO${++seq}`));
  definirDependenciasRoteamento({ agora: () => AGORA, enviar: enviarTexto as never, enviarMidia: enviarMidia as never });
  definirClienteModelo((async () => { throw new Error("sem IA"); }) as never);
  definirDependenciasMarcacao({ agora: () => AGORA, enviar: (async () => { throw new Error("nada vai a grupo"); }) as never, contador: async () => 1_000,
    cliente: async () => { throw new Error("sem IA aqui"); } });
  const painel = new Map<string, string>();
  vi.mocked(getDashboardSetting).mockImplementation(async k => painel.get(k));
  vi.mocked(saveDashboardSetting).mockImplementation(async (k, v) => { painel.set(k, v); });
  definirDependenciasTranscricao({ baixar: async () => { throw new Error("sem download"); }, cliente: async () => { throw new Error("sem cliente"); } });
});
afterEach(() => {
  ENV.cookieSecret = segredoAntes;
  definirDependenciasPonte(); definirDependenciasWhatsapp(); definirClienteModelo(); definirDependenciasMarcacao();
  definirDependenciasRoteamento(); definirDependenciasTranscricao();
  vi.clearAllMocks();
});

describe("permissão e partes", () => {
  it("anônimo não chega a nenhuma das três rotas", async () => {
    const id = await campanhaAtiva();
    await expect(anonimo().dolores.atendimento.removerMidia({ campanhaId: id, tipo: "imagem" })).rejects.toMatchObject({ code: expect.stringMatching(/^(UNAUTHORIZED|FORBIDDEN)$/) });
    await expect(anonimo().dolores.atendimento.midiaDaCampanha({ campanhaId: id, tipo: "imagem", offset: 0 })).rejects.toMatchObject({ code: expect.stringMatching(/^(UNAUTHORIZED|FORBIDDEN)$/) });
    await expect(anonimo().dolores.atendimento.salvarMidia({ campanhaId: id, tipo: "imagem", uploadId: "x".repeat(24), nome: "a.png" })).rejects.toMatchObject({ code: expect.stringMatching(/^(UNAUTHORIZED|FORBIDDEN)$/) });
  });
  it("outro usuário não sobrescreve a parte do administrador (mesmo uploadId)", async () => {
    const id = await campanhaAtiva();
    const up = await subir(caller("admin"), id, "imagem", PNG, "foto.png");
    await expect(subir(caller("colaborador", 7), id, "imagem", Buffer.from("lixo-lixo"), "foto.png", up)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await caller("admin").dolores.atendimento.salvarMidia({ campanhaId: id, tipo: "imagem", uploadId: up, nome: "foto.png" });
    expect((await q<{ tamanho: number }>("SELECT tamanho FROM whatsapp_campanha_midias"))[0].tamanho).toBe(PNG.length);
  });
  it("partes de uma campanha não servem para outra (escopo)", async () => {
    const a = await campanhaAtiva();
    const [b] = await q<{ id: number }>(`INSERT INTO whatsapp_campanhas (nome, texto, ativa) VALUES ('B', 'Olá B.', false) RETURNING id`);
    const up = await subir(caller("admin"), a, "imagem", PNG, "foto.png");
    await expect(caller("admin").dolores.atendimento.salvarMidia({ campanhaId: b.id, tipo: "imagem", uploadId: up, nome: "foto.png" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller("admin").dolores.atendimento.salvarMidia({ campanhaId: a, tipo: "audio", uploadId: up, nome: "foto.png" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("ACHADO (pré-existente, herdado): qualquer usuário logado grava até 20 MB por uploadId no escopo da saudação, sem teto por usuário", async () => {
    const id = await campanhaAtiva();
    const corretor = caller("corretor", 9, []);
    for (let k = 0; k < 3; k++) await subir(corretor, id, "imagem", Buffer.alloc(2 * 1024 * 1024, 1), "x.png");
    expect((await q<{ n: string }>("SELECT count(*)::text AS n FROM document_upload_chunks WHERE user_id = 9"))[0].n).toBe("6");
  });
});

describe("eco de mídia reconhecido como automático (shared/dolores/roteamento.ts)", () => {
  it("CORRIGIDO (achado 1): depois de um áudio automático que FALHOU, o áudio da EQUIPE pelo celular é da equipe e cala a Dolores", async () => {
    const id = await campanhaAtiva();
    const admin = caller("admin");
    const up = await subir(admin, id, "audio", OGG10, "voz.ogg");
    await admin.dolores.atendimento.salvarMidia({ campanhaId: id, tipo: "audio", uploadId: up, nome: "voz.ogg" });
    falhar.add("audio");
    await chamar(aviso(direta()));
    expect((await q<{ status: string }>(`SELECT status FROM whatsapp_messages WHERE mensagem = '[áudio]'`)).map(r => r.status)).toEqual(["falhou"]);
    // a equipe grava um áudio para o mesmo contato pelo celular (fromMe, id novo, que o sistema nunca enviou)
    const r = await chamar(aviso(direta({ fromMe: true, id: "EQUIPE-AUDIO-1", message: { audioMessage: { seconds: 25, ptt: true } } })));
    expect(r.body.rota).toMatchObject({ "propria-equipe": 1 });
    expect((await q("SELECT * FROM whatsapp_silencio")).length).toBe(1); // a Dolores fica calada nesta conversa
    // a linha "falhou" da saudação fica como estava; o áudio da equipe entra como mensagem da equipe
    expect(await q("SELECT status, automatica, external_id FROM whatsapp_messages WHERE mensagem = '[áudio]' AND automatica")).toEqual([{ status: "falhou", automatica: true, external_id: null }]);
  });
  it("sem envio automático pendente, imagem/áudio da equipe pelo celular continuam calando a Dolores", async () => {
    await chamar(aviso(direta({ fromMe: true, id: "EQUIPE-IMG-1", message: { imageMessage: { caption: "planta" } } })));
    await chamar(aviso(direta({ fromMe: true, id: "EQUIPE-AUD-1", message: { audioMessage: { seconds: 5 } } })));
    expect((await q("SELECT * FROM whatsapp_silencio")).length).toBe(1);
  });
  it("mensagem de TERCEIRO com imagem/áudio nunca entra pelo caminho 'propria' (fromMe é exigido)", async () => {
    await campanhaAtiva();
    const r = await chamar(aviso(direta({ message: { audioMessage: { seconds: 5 } } })));
    expect(JSON.stringify(r.body.rota)).not.toMatch(/propria/);
  });
});

describe("idempotência, concorrência e migração", () => {
  it("duas mensagens simultâneas do mesmo número + reentrega: UMA saudação, mídia enviada uma vez", async () => {
    const id = await campanhaAtiva();
    const admin = caller("admin");
    const up = await subir(admin, id, "imagem", PNG, "foto.png");
    await admin.dolores.atendimento.salvarMidia({ campanhaId: id, tipo: "imagem", uploadId: up, nome: "foto.png" });
    const item = direta({ id: "MESMO-ID" });
    await Promise.all([chamar(aviso(direta())), chamar(aviso(direta())), chamar(aviso(item)), chamar(aviso(item))]);
    expect((await q("SELECT id FROM whatsapp_saudacoes")).length).toBe(1);
    expect(enviarMidia).toHaveBeenCalledTimes(1);
  });
  it("0137 aplicada mais 2× sobre banco com dados: sem erro, linha antiga intacta com NULL", async () => {
    const id = await campanhaAtiva();
    await q(`INSERT INTO whatsapp_saudacoes (campanha_id, chave_numero, remetente, situacao) VALUES (${id}, '551155554444', '55***', 'enviada')`);
    await banco.pg.exec(MIGRACAO_0137()); await banco.pg.exec(MIGRACAO_0137());
    expect(await q("SELECT situacao, texto_saiu, imagem_saiu, audio_saiu FROM whatsapp_saudacoes")).toEqual([{ situacao: "enviada", texto_saiu: null, imagem_saiu: null, audio_saiu: null }]);
    await expect(q(`INSERT INTO whatsapp_campanha_midias (campanha_id, tipo, mime, nome, tamanho, sha256, conteudo) VALUES (${id}, 'imagem', 'audio/ogg', 'x', 1, 'x', '\\x00')`)).rejects.toThrow();
    await q(`INSERT INTO whatsapp_campanha_midias (campanha_id, tipo, mime, nome, tamanho, sha256, conteudo) VALUES (${id}, 'imagem', 'image/png', 'x', 1, 'x', '\\x00')`);
    await q(`DELETE FROM whatsapp_campanhas WHERE id = ${id}`).catch(() => undefined); // saudações podem segurar (FK antiga)
  });
});

// ── Rodada 2 do portão (commit 7705439): tentar quebrar as correções e conferir que arquivos LEGÍTIMOS passam ──

const seg = (m: number, corpo: Buffer) => { const h = Buffer.alloc(4); h[0] = 0xff; h[1] = m; h.writeUInt16BE(corpo.length + 2, 2); return Buffer.concat([h, corpo]); };
const sof = (m: number, largura: number, altura: number) => { const c = Buffer.alloc(15); c[0] = 8; c.writeUInt16BE(altura, 1); c.writeUInt16BE(largura, 3); c[5] = 3; return seg(m, c); };
const sos = () => seg(0xda, Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]));
const dados = (n: number) => { const d = Buffer.alloc(n, 0x12); for (let k = 0; k < n; k += 97) { d[k] = 0xff; if (k + 1 < n) d[k + 1] = 0x00; } return d; };
const jpg = (...meio: Buffer[]) => Buffer.concat([Buffer.from([0xff, 0xd8]), ...meio, Buffer.from([0xff, 0xd9])]);
const app1ComMiniatura = () => seg(0xe1, Buffer.concat([Buffer.from("Exif\0\0"), jpg(sof(0xc0, 160, 120), seg(0xc4, Buffer.alloc(20)), sos(), dados(300))]));
const fullbox = (tipo: string, escalaOff: number, escala: number, dur: number, tam = 100) => { const c = Buffer.alloc(tam); c.writeUInt32BE(escala, escalaOff); c.writeUInt32BE(dur, escalaOff + 4); return caixa(tipo, c); };
const m4aCompleto = (p: { mvhdEscala: number; mvhdDur: number; mdhdEscala: number; mdhdDur: number; mdat: number; moovNoFim?: boolean; metaTrak?: boolean }) => {
  const hdlr = (t: string) => { const h = Buffer.alloc(24); h.write(t, 8, "latin1"); return caixa("hdlr", h); };
  const trak = caixa("trak", caixa("mdia", fullbox("mdhd", 12, p.mdhdEscala, p.mdhdDur, 24), hdlr("soun")));
  const meta = p.metaTrak ? [caixa("trak", caixa("mdia", fullbox("mdhd", 12, 1000, 1, 24), hdlr("meta")))] : [];
  const moov = caixa("moov", fullbox("mvhd", 12, p.mvhdEscala, p.mvhdDur), trak, ...meta);
  const ftyp = caixa("ftyp", Buffer.from("M4A \x00\x00\x00\x00", "latin1"));
  const mdat = caixa("mdat", Buffer.alloc(p.mdat, 0x21));
  return p.moovNoFim ? Buffer.concat([ftyp, mdat, moov]) : Buffer.concat([ftyp, moov, mdat]);
};

describe("rodada 2 — imagem: o parser novo", () => {
  it("JPG legítimos passam: baseline com EXIF e miniatura dentro do APP1; progressivo com vários SOS e DHT entre eles; reinícios", () => {
    const base = jpg(seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0")), app1ComMiniatura(), seg(0xdb, Buffer.alloc(65)), sof(0xc0, 4032, 3024), seg(0xc4, Buffer.alloc(30)), sos(), dados(5000));
    expect(conferirMidiaSaudacao("imagem", base)).toMatchObject({ ok: true, mime: "image/jpeg" });
    const prog = jpg(seg(0xdb, Buffer.alloc(65)), sof(0xc2, 1600, 1200), seg(0xc4, Buffer.alloc(30)), sos(), dados(800), seg(0xc4, Buffer.alloc(30)), sos(), dados(800), sos(), dados(800));
    expect(conferirMidiaSaudacao("imagem", prog)).toMatchObject({ ok: true });
    const reinicio = jpg(sof(0xc0, 100, 100), sos(), dados(100), Buffer.from([0xff, 0xd0]), dados(100), Buffer.from([0xff, 0xd1]), dados(100));
    expect(conferirMidiaSaudacao("imagem", reinicio)).toMatchObject({ ok: true });
  });
  it("a miniatura do EXIF não engana a dimensão: quadro principal gigante com miniatura pequena é recusado", () => {
    const b = jpg(app1ComMiniatura(), sof(0xc0, 30_000, 30_000), sos(), dados(500));
    expect(conferirMidiaSaudacao("imagem", b)).toMatchObject({ ok: false, erro: expect.stringMatching(/grande demais em pixels/) });
  });
  it("CORRIGIDO R2-2: DOIS quadros SOF (o 1º gigante e o 2º pequeno) são recusados como estrutura inválida", () => {
    const b = jpg(sof(0xc0, 60_000, 60_000), sof(0xc0, 100, 100), sos(), dados(500));
    expect(conferirMidiaSaudacao("imagem", b)).toMatchObject({ ok: false, erro: expect.stringMatching(/incompleta ou tem algo a mais/) });
    expect(conferirMidiaSaudacao("imagem", jpg(sof(0xc0, 100, 100), sof(0xc2, 100, 100), sos(), dados(500))).ok).toBe(false);
  });
  it("segmento de tamanho 0 ou 1, marcador solto e lixo depois do FF D9 são recusados", () => {
    expect(conferirMidiaSaudacao("imagem", Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), Buffer.alloc(40), Buffer.from([0xff, 0xd9])])).ok).toBe(false);
    expect(conferirMidiaSaudacao("imagem", Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1]), Buffer.alloc(40), Buffer.from([0xff, 0xd9])])).ok).toBe(false);
    const ok = jpg(sof(0xc0, 100, 100), sos(), dados(200));
    expect(conferirMidiaSaudacao("imagem", Buffer.concat([ok, Buffer.from("<html>")])).ok).toBe(false);
  });
  it("CORRIGIDO R2-3 (usabilidade): foto de celular com dados DEPOIS do FF D9 (foto com movimento / MPF / Samsung) passa, cortada no fim da imagem", () => {
    const imagem = jpg(sof(0xc0, 4000, 3000), sos(), dados(2000));
    const motion = Buffer.concat([imagem, caixa("ftyp", Buffer.from("mp42\0\0\0\0", "latin1")), Buffer.alloc(5000, 1)]);
    expect(conferirMidiaSaudacao("imagem", motion)).toMatchObject({ ok: true, mime: "image/jpeg", tamanho: imagem.length, fim: imagem.length });
    const mpf = Buffer.concat([imagem, jpg(sof(0xc0, 320, 240), sos(), dados(100))]);
    expect(conferirMidiaSaudacao("imagem", mpf)).toMatchObject({ ok: true, tamanho: imagem.length });
    const samsung = Buffer.concat([imagem, Buffer.from("SEFH"), Buffer.alloc(300, 2), Buffer.from("\0\0\0\x10SEFT", "latin1")]);
    expect(conferirMidiaSaudacao("imagem", samsung)).toMatchObject({ ok: true, tamanho: imagem.length });
  });
  it("PNG com muitos blocos legítimos passa; 5 MB de blocos mínimos e entradas degeneradas terminam rápido", () => {
    const bloco = (t: string, n: number) => { const h = Buffer.alloc(8); h.writeUInt32BE(n, 0); h.write(t, 4, "latin1"); return Buffer.concat([h, Buffer.alloc(n, 1), Buffer.alloc(4)]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2000, 0); ihdr.writeUInt32BE(1500, 4); ihdr[8] = 8; ihdr[9] = 6;
    const assinatura = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const cab = Buffer.concat([assinatura, Buffer.from([0, 0, 0, 13]), Buffer.from("IHDR"), ihdr, Buffer.alloc(4)]);
    const muitos = Buffer.concat([cab, bloco("tEXt", 30), bloco("iCCP", 3000), ...Array.from({ length: 500 }, () => bloco("IDAT", 8192)), bloco("IEND", 0)]);
    expect(conferirMidiaSaudacao("imagem", muitos)).toMatchObject({ ok: true, mime: "image/png" });
    const minimos = Buffer.concat([cab, Buffer.alloc(5 * 1024 * 1024 - cab.length - 12, Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from("IDAT"), Buffer.alloc(4)]))]);
    for (const b of [minimos, Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(5 * 1024 * 1024, 0xff)]),
      Buffer.concat([jpg(sof(0xc0, 10, 10)), Buffer.alloc(0)]).subarray(0, 12), Buffer.concat([Buffer.from([0xff, 0xd8]), sof(0xc0, 10, 10), sos(), Buffer.alloc(5 * 1024 * 1024, 0)])]) {
      const t = performance.now();
      conferirMidiaSaudacao("imagem", b);
      expect(performance.now() - t).toBeLessThan(3_000);
    }
  });
});

describe("rodada 2 — áudio: forjados e legítimos", () => {
  it("M4A forjado com mvhd e mdhd CONCORDANDO (10 s) e 4 MB de mdat: recusado pela taxa de bytes", () => {
    const b = m4aCompleto({ mvhdEscala: 1000, mvhdDur: 10_000, mdhdEscala: 44_100, mdhdDur: 441_000, mdat: 4 * 1024 * 1024 });
    expect(conferirMidiaSaudacao("audio", b)).toMatchObject({ ok: false, erro: expect.stringMatching(/dados demais/) });
  });
  it("M4A legítimo: moov no fim (gravador do iPhone), escalas diferentes (600 × 44100), faixa de metadados extra, 1 min a 64 kbit/s", () => {
    const b = m4aCompleto({ mvhdEscala: 600, mvhdDur: 36_000, mdhdEscala: 44_100, mdhdDur: 2_646_000 + 2112, mdat: 480_000, moovNoFim: true, metaTrak: true });
    expect(conferirMidiaSaudacao("audio", b)).toMatchObject({ ok: true, mime: "audio/mp4", duracaoS: 60 });
  });
  it("Opus legítimo (estilo WhatsApp: OpusHead, OpusTags, páginas de ~1 s, 16 kbit/s, 40 s) passa", () => {
    const tags = Buffer.concat([Buffer.from("OpusTags"), Buffer.alloc(16)]);
    const paginas = [paginaOgg(0, opusHead()), paginaOgg(0, tags)];
    for (let s = 1; s <= 40; s++) paginas.push(paginaOgg(s * 48_000 + 312, Buffer.alloc(250, 7)));
    expect(conferirMidiaSaudacao("audio", Buffer.concat(paginas))).toMatchObject({ ok: true, mime: "audio/ogg", duracaoS: 40 });
  });
  it("CORRIGIDO R2-4: Opus de 30 min a baixa taxa com as posições de amostra 'comprimidas' (todas ≤ 40 s) vale pela soma dos pacotes e é recusado", () => {
    // 90 000 pacotes de 20 ms (= 30 min) a ~6 kbit/s, em páginas cujo granule só vai até 40 s; o decodificador toca os pacotes
    const toc20ms = 0x08 << 3 | 0x00; // config de 20 ms (SILK), 1 quadro
    const paginas = [paginaOgg(0, opusHead()), paginaOgg(0, Buffer.concat([Buffer.from("OpusTags"), Buffer.alloc(16)]))];
    const nPaginas = 1800;
    for (let k = 1; k <= nPaginas; k++) {
      // cada página: 50 pacotes de 15 bytes (1 s de áudio de verdade); granule declara k × 40/1800 s
      const pacotes = Array.from({ length: 50 }, () => { const p = Buffer.alloc(15, 3); p[0] = toc20ms; return p; });
      const h = Buffer.alloc(27); h.write("OggS", 0, "latin1"); h.writeBigUInt64LE(BigInt(Math.round(k * 40 / nPaginas * 48_000) + 312), 6); h[26] = 50;
      paginas.push(Buffer.concat([h, Buffer.from(pacotes.map(p => p.length)), ...pacotes]));
    }
    const b = Buffer.concat(paginas);
    expect(b.length / 40).toBeLessThan(64 * 1024);
    expect(conferirMidiaSaudacao("audio", b)).toMatchObject({ ok: false, erro: expect.stringMatching(/máximo é 2 minutos/) });
  });
  it("MP3 VBR (quadros de taxas diferentes) e com capa de 200 kB em 10 s", () => {
    const quadro = (idx: number) => { const n = Math.floor(144 * [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][idx] * 1000 / 44_100); const q = Buffer.alloc(n, 0x55); q[0] = 0xff; q[1] = 0xfb; q[2] = idx << 4; return q; };
    const vbr = Buffer.concat(Array.from({ length: Math.ceil(30 * 44_100 / 1152) }, (_, k) => quadro([5, 9, 14, 7][k % 4])));
    expect(conferirMidiaSaudacao("audio", vbr)).toMatchObject({ ok: true, mime: "audio/mpeg" });
    const capa = 200 * 1024;
    const tam = Buffer.from([(capa >> 21) & 0x7f, (capa >> 14) & 0x7f, (capa >> 7) & 0x7f, capa & 0x7f]);
    const comCapa = Buffer.concat([Buffer.from("ID3\x03\x00\x00", "latin1"), tam, Buffer.alloc(capa, 1), Buffer.concat(Array.from({ length: Math.ceil(10 * 44_100 / 1152) }, () => quadro(9)))]);
    // R2-5 (usabilidade, limitação registrada na story): (200 kB + 160 kB) / 10 s ≈ 36 kB/s passa; uma capa de 600 kB num jingle de 10 s seria recusada
    expect(conferirMidiaSaudacao("audio", comCapa).ok).toBe(true);
  });
});

describe("rodada 2 — eco durante o envio e sem confirmação", () => {
  it("CORRIGIDO R2-1: áudio da EQUIPE pelo celular DURANTE o envio automático: ao terminar o envio vira mensagem da equipe e cala a Dolores, sem perder ids", async () => {
    const id = await campanhaAtiva();
    const admin = caller("admin");
    const up = await subir(admin, id, "audio", OGG10, "voz.ogg");
    await admin.dolores.atendimento.salvarMidia({ campanhaId: id, tipo: "audio", uploadId: up, nome: "voz.ogg" });
    let rotaDaEquipe: unknown;
    enviarMidia.mockImplementation(async () => {
      // enquanto a Evolution não respondeu, a equipe manda um áudio do celular para o mesmo contato
      rotaDaEquipe = (await chamar(aviso(direta({ fromMe: true, id: "EQUIPE-DURANTE", message: { audioMessage: { seconds: 8, ptt: true } } })))).body.rota;
      return "EVO-AUTOMATICO";
    });
    await chamar(aviso(direta()));
    expect(rotaDaEquipe).toMatchObject({ "propria-automatica": 1 }); // no instante do eco não dá para saber; o fim do envio desfaz
    expect((await q("SELECT * FROM whatsapp_silencio")).length).toBe(1);
    expect(await q("SELECT external_id, automatica, status FROM whatsapp_messages WHERE mensagem = '[áudio]' ORDER BY id")).toEqual([
      { external_id: "EVO-AUTOMATICO", automatica: true, status: "enviada" }, { external_id: "EQUIPE-DURANTE", automatica: false, status: "enviada" }]);
    // o eco verdadeiro do automático chega depois e é reconhecido pelo id: nada duplica
    await chamar(aviso(direta({ fromMe: true, id: "EVO-AUTOMATICO", message: { audioMessage: { seconds: 10, ptt: true } } })));
    expect(await q("SELECT count(*)::int AS n FROM whatsapp_messages WHERE mensagem = '[áudio]'")).toEqual([{ n: 2 }]);
  });
  it("R2-1: eco que casou durante um envio que FALHOU ou ficou sem confirmação também vira da equipe (na dúvida, lado humano)", async () => {
    const id = await campanhaAtiva();
    const admin = caller("admin");
    await admin.dolores.atendimento.salvarMidia({ campanhaId: id, tipo: "audio", uploadId: await subir(admin, id, "audio", OGG10, "voz.ogg"), nome: "voz.ogg" });
    enviarMidia.mockImplementation(async () => {
      await chamar(aviso(direta({ fromMe: true, id: "EQUIPE-NA-FALHA", message: { audioMessage: { seconds: 8, ptt: true } } })));
      throw new DOMException("timeout", "TimeoutError");
    });
    await chamar(aviso(direta()));
    expect((await q("SELECT * FROM whatsapp_silencio")).length).toBe(1);
    expect(await q("SELECT external_id, automatica, status FROM whatsapp_messages WHERE mensagem = '[áudio]' ORDER BY id")).toEqual([
      { external_id: null, automatica: true, status: "falhou" }, { external_id: "EQUIPE-NA-FALHA", automatica: false, status: "enviada" }]);
  });
  it("imagem sem confirmação (exceção no envio): texto e áudio NÃO vão; registrada; reentrega não reenvia", async () => {
    const id = await campanhaAtiva();
    const admin = caller("admin");
    await admin.dolores.atendimento.salvarMidia({ campanhaId: id, tipo: "imagem", uploadId: await subir(admin, id, "imagem", PNG, "f.png"), nome: "f.png" });
    await admin.dolores.atendimento.salvarMidia({ campanhaId: id, tipo: "audio", uploadId: await subir(admin, id, "audio", OGG10, "v.ogg"), nome: "v.ogg" });
    enviarMidia.mockImplementation(async () => { throw new DOMException("timeout", "TimeoutError"); });
    const r = await chamar(aviso(direta({ id: "X1" })));
    expect(r.body.rota).toMatchObject({ "saudacao-sem-confirmacao": 1 });
    expect(enviarMidia).toHaveBeenCalledTimes(1);
    expect(enviarTexto).not.toHaveBeenCalled();
    expect(await q("SELECT situacao, texto_saiu, imagem_saiu, audio_saiu, sem_confirmacao FROM whatsapp_saudacoes")).toEqual([{ situacao: "erro", texto_saiu: false, imagem_saiu: null, audio_saiu: false, sem_confirmacao: true }]);
    await chamar(aviso(direta({ id: "X1" }))); await chamar(aviso(direta({ texto: "oi?" })));
    expect(enviarMidia).toHaveBeenCalledTimes(1);
    expect(enviarTexto).not.toHaveBeenCalled();
  });
});
