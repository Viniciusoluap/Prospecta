// EPIC-026 C3 — saudação de campanha com imagem e áudio. Cada regra: tentativa → resultado conferido no banco e no que saiu.
// PGlite; nada sai para a rede (Evolution simulada pelas dependências do roteamento).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn(), getDashboardSetting: vi.fn(), saveDashboardSetting: vi.fn() }));
vi.mock("../whatsapp-router.js", async orig => ({ ...(await orig<typeof import("../whatsapp-router.js")>()), configEvolution: vi.fn(async () => null) }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { lerParaRoteamento } from "../../shared/dolores/roteamento.js";
import {
  conferirMidiaSaudacao, escopoMidiaSaudacao, lerAudioSaudacao, LIMITE_IMAGEM_SAUDACAO, nomeSeguroDaMidia, tipoDaImagemSaudacao,
} from "../../shared/whatsapp/saudacao-midia.js";
import { enviarAudioEvolution, enviarImagemEvolution } from "../_core/evolution.js";
import { ENV } from "../_core/env.js";
import { getDashboardSetting, getDb, saveDashboardSetting } from "../db.js";
import { appRouter } from "../routers.js";
import { limparPausaDoAtendimento } from "./atendimento.js";
import { definirClienteModelo } from "./cerebro.js";
import { definirDependenciasMarcacao } from "./marcacao.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte } from "./ponte.js";
import { definirDependenciasRoteamento } from "./roteamento.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";
import { definirDependenciasTranscricao } from "./transcricao.js";
import { definirDependenciasWhatsapp, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";

// ── Arquivos de teste, montados byte a byte ──

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from("IHDR"), Buffer.alloc(200, 7)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.from("JFIF"), Buffer.alloc(200, 3), Buffer.from([0xff, 0xd9])]);

/** Ogg/Opus com a duração pedida (pre-skip 312, 48 kHz). */
function ogg(segundos: number) {
  const pagina = (granule: number, pacote: Buffer) => {
    const h = Buffer.alloc(27);
    h.write("OggS", 0, "latin1");
    h[4] = 0;
    h.writeBigUInt64LE(BigInt(granule), 6);
    h[26] = 1;
    return Buffer.concat([h, Buffer.from([pacote.length]), pacote]);
  };
  const head = Buffer.alloc(19);
  head.write("OpusHead", 0, "latin1");
  head[8] = 1; head[9] = 1; head.writeUInt16LE(312, 10); head.writeUInt32LE(48_000, 12);
  return Buffer.concat([pagina(0, head), pagina(0, Buffer.alloc(20, 1)), Buffer.alloc(500, 9), pagina(Math.round(segundos * 48_000) + 312, Buffer.alloc(30, 2))]);
}
/** MP3 MPEG-1 camada III, 128 kbit/s, 44,1 kHz: quadros de 417 bytes, 1152 amostras cada. */
function mp3(segundos: number) {
  const quadros = Math.ceil(segundos * 44_100 / 1152);
  const q = Buffer.alloc(417, 0x55);
  q[0] = 0xff; q[1] = 0xfb; q[2] = 0x90; q[3] = 0x00;
  return Buffer.concat([Buffer.from("ID3\x03\x00\x00\x00\x00\x00\x0a", "latin1"), Buffer.alloc(10), ...Array.from({ length: quadros }, () => q)]);
}
const caixa = (tipo: string, ...dentro: Buffer[]) => {
  const corpo = Buffer.concat(dentro);
  const h = Buffer.alloc(8);
  h.writeUInt32BE(8 + corpo.length, 0); h.write(tipo, 4, "latin1");
  return Buffer.concat([h, corpo]);
};
/** M4A: ftyp + moov(mvhd + uma faixa com o manipulador pedido). */
function m4a(segundos: number, manipulador = "soun") {
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12); mvhd.writeUInt32BE(Math.round(segundos * 1000), 16);
  const hdlr = Buffer.alloc(24); hdlr.write(manipulador, 8, "latin1");
  return Buffer.concat([caixa("ftyp", Buffer.from("M4A \x00\x00\x00\x00", "latin1")), caixa("moov", caixa("mvhd", mvhd), caixa("trak", caixa("mdia", caixa("hdlr", hdlr))))]);
}

describe("conferência pelos bytes (tela e servidor)", () => {
  it("imagem: o tipo vem dos bytes, não do nome nem do tipo declarado", () => {
    expect(tipoDaImagemSaudacao(PNG)).toBe("image/png");
    expect(tipoDaImagemSaudacao(JPG)).toBe("image/jpeg");
    expect(tipoDaImagemSaudacao(Buffer.from("GIF89a" + "x".repeat(100)))).toBeNull();
    expect(tipoDaImagemSaudacao(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
    expect(conferirMidiaSaudacao("imagem", Buffer.from("isto é um texto com nome foto.png"))).toMatchObject({ ok: false, erro: expect.stringMatching(/não é uma imagem JPG ou PNG/) });
    // áudio no lugar da imagem e imagem no lugar do áudio
    expect(conferirMidiaSaudacao("imagem", ogg(10)).ok).toBe(false);
    expect(conferirMidiaSaudacao("audio", PNG).ok).toBe(false);
  });
  it("áudio: OGG/Opus, MP3 e M4A, com a duração lida dos bytes", () => {
    expect(lerAudioSaudacao(ogg(30))).toEqual({ mime: "audio/ogg", duracaoS: 30 });
    const m = lerAudioSaudacao(mp3(20))!;
    expect(m.mime).toBe("audio/mpeg");
    expect(m.duracaoS).toBeGreaterThan(19.9);
    expect(m.duracaoS).toBeLessThan(20.1);
    expect(lerAudioSaudacao(m4a(45))).toEqual({ mime: "audio/mp4", duracaoS: 45 });
    // vídeo MP4 (faixa "vide") não passa como áudio; lixo também não
    expect(lerAudioSaudacao(m4a(45, "vide"))).toBeNull();
    expect(lerAudioSaudacao(Buffer.alloc(5000, 0xff))).toBeNull();
  });
  it("limites: imagem até 5 MB; áudio até 2 minutos (e 5 MB)", () => {
    const grande = Buffer.concat([PNG, Buffer.alloc(LIMITE_IMAGEM_SAUDACAO)]);
    expect(conferirMidiaSaudacao("imagem", grande)).toMatchObject({ ok: false, erro: expect.stringMatching(/passa de 5 MB/) });
    expect(conferirMidiaSaudacao("audio", ogg(120))).toMatchObject({ ok: true, duracaoS: 120 });
    expect(conferirMidiaSaudacao("audio", ogg(125))).toMatchObject({ ok: false, erro: expect.stringMatching(/máximo é 2 minutos/) });
    expect(conferirMidiaSaudacao("audio", mp3(130))).toMatchObject({ ok: false, erro: expect.stringMatching(/máximo é 2 minutos/) });
    expect(conferirMidiaSaudacao("audio", m4a(121))).toMatchObject({ ok: false });
    expect(conferirMidiaSaudacao("audio", Buffer.alloc(0))).toMatchObject({ ok: false, erro: "O arquivo está vazio." });
  });
  it("nome sanitizado: sem caminho, sem caracteres estranhos, com a extensão do tipo REAL", () => {
    expect(nomeSeguroDaMidia("../../etc/passwd.png", "image/jpeg")).toBe("passwd.jpg");
    expect(nomeSeguroDaMidia("C:\\fotos\\Lançamento <script>.PNG", "image/png")).toBe("Lançamento _script_.png");
    expect(nomeSeguroDaMidia("...", "audio/ogg")).toBe("arquivo.ogg");
  });
});

describe("Evolution: mídia vai em base64 no pedido (nunca URL)", () => {
  it("imagem com legenda numa mensagem só; áudio como mensagem de voz", async () => {
    const pedidos: { url: string; corpo: Record<string, unknown> }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      pedidos.push({ url, corpo: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ key: { id: `ID${pedidos.length}` } }), { status: 201 });
    }) as unknown as typeof fetch;
    const c = { url: "https://evo.example", apiKey: "k", semRedirecionamento: true };
    expect(await enviarImagemEvolution(c, "inst", "99988887777", { base64: "QUJD", mime: "image/png", nome: "a.png", legenda: "Olá!" }, f)).toBe("ID1");
    expect(await enviarAudioEvolution(c, "inst", "5599988887777", "REVG", f)).toBe("ID2");
    expect(pedidos[0]).toEqual({ url: "https://evo.example/message/sendMedia/inst", corpo: { number: "5599988887777", mediatype: "image", mimetype: "image/png", caption: "Olá!", media: "QUJD", fileName: "a.png" } });
    expect(pedidos[1]).toEqual({ url: "https://evo.example/message/sendWhatsAppAudio/inst", corpo: { number: "5599988887777", audio: "REVG", encoding: true } });
  });
});

// ── Com banco ──

const DONO = "5599991234567";
const EMPRESA = "5599900001111";
const ESTRANHO = "5511955554444";
let banco: Awaited<ReturnType<typeof criarBanco>>;
let ordem: string[];
let falhar: Set<string>;
let enviarTexto: ReturnType<typeof vi.fn>;
let enviarMidia: ReturnType<typeof vi.fn>;
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
let seq = 0;

const direta = (p: { de?: string; texto?: string; fromMe?: boolean; id?: string; message?: Record<string, unknown> } = {}) => ({
  key: { remoteJid: `${p.de ?? ESTRANHO}@s.whatsapp.net`, fromMe: p.fromMe ?? false, id: p.id ?? `C3${++seq}` },
  message: p.message ?? { conversation: p.texto ?? "Oi, quero saber do lançamento" },
  messageTimestamp: Math.floor((AGORA.getTime() - 20_000) / 1000), pushName: "Contato",
});
const aviso = (item: unknown) => ({ event: "messages.upsert", instance: "prospecta-dolores", data: item });
const chamar = (body: unknown) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, body, ip: "203.0.113.9" } as never);
const caller = (role: string, id = 1, permissoes: string[] = ["whatsapp"]) =>
  appRouter.createCaller({ user: { id, role, active: true, permissions: JSON.stringify(permissoes) }, req: {}, res: {} } as never);

async function campanhaAtiva(texto = "Olá! Conheça o Residencial Prospecta.") {
  const [c] = await q<{ id: number }>(`INSERT INTO whatsapp_campanhas (nome, texto, ativa) VALUES ('Lançamento', '${texto}', true) RETURNING id`);
  return c.id;
}
/** Sobe o arquivo em partes (como a tela) e grava pela rota do administrador. */
async function anexar(c: ReturnType<typeof caller>, campanhaId: number, tipo: "imagem" | "audio", bytes: Buffer, nome: string) {
  const uploadId = `c3-envio-${++seq}-abcdefghijklmnop`;
  const total = Math.ceil(bytes.length / (1024 * 1024));
  for (let part = 0; part < total; part++)
    await c.documentChunks.part({ uploadId, part, total, scope: escopoMidiaSaudacao(campanhaId, tipo), fileName: nome, base64: bytes.subarray(part * 1024 * 1024, (part + 1) * 1024 * 1024).toString("base64") });
  return c.dolores.atendimento.salvarMidia({ campanhaId, tipo, uploadId, nome });
}
const saudacoes = () => q<{ situacao: string; texto_saiu: boolean | null; imagem_saiu: boolean | null; audio_saiu: boolean | null }>(
  "SELECT situacao, texto_saiu, imagem_saiu, audio_saiu FROM whatsapp_saudacoes ORDER BY id");
const central = () => q<{ mensagem: string; automatica: boolean; status: string }>(`SELECT mensagem, automatica, status FROM whatsapp_messages WHERE destinatario = '${ESTRANHO}' AND direcao = 'saida' ORDER BY id`);

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}',
      numero_dolores = '${EMPRESA}', ia_ligada = true WHERE id = 1;`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  esquecerUsuarioDolores();
  limparPausaDoAtendimento();
  definirDependenciasPonte({ agora: () => AGORA });
  definirDependenciasWhatsapp({ agora: () => AGORA, enviar: (async () => true) as never });
  ordem = [];
  falhar = new Set();
  enviarTexto = vi.fn(async (p: { texto: string }) => { ordem.push(`texto:${p.texto}`); return falhar.has("texto") ? null : `EVO${++seq}`; });
  enviarMidia = vi.fn(async (p: { midia: { tipo: string }; legenda: string }) => {
    ordem.push(p.midia.tipo === "imagem" ? `imagem:${p.legenda}` : "audio");
    return falhar.has(p.midia.tipo) ? null : `EVO${++seq}`;
  });
  definirDependenciasRoteamento({ agora: () => AGORA, enviar: enviarTexto as never, enviarMidia: enviarMidia as never });
  definirClienteModelo((async () => { throw new Error("o laço do dono não roda aqui"); }) as never);
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

describe("permissão: só o administrador por PAPEL (pelo appRouter)", () => {
  it("colaborador e corretor com o módulo do WhatsApp não gravam, não removem e não veem a mídia", async () => {
    const id = await campanhaAtiva();
    await anexar(caller("admin"), id, "imagem", PNG, "foto.png");
    for (const role of ["colaborador", "corretor"]) {
      const c = caller(role, 1, ["whatsapp", "dolores"]);
      await expect(anexar(c, id, "imagem", JPG, "outra.jpg")).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(c.dolores.atendimento.removerMidia({ campanhaId: id, tipo: "imagem" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(c.dolores.atendimento.midiaDaCampanha({ campanhaId: id, tipo: "imagem", offset: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await q("SELECT tipo, mime FROM whatsapp_campanha_midias")).toEqual([{ tipo: "imagem", mime: "image/png" }]);
  });
  it("o administrador não usa partes enviadas por OUTRO usuário (nenhum arquivo de fora entra)", async () => {
    const id = await campanhaAtiva();
    const uploadId = "c3-de-outro-usuario-abcdefghijkl";
    await caller("colaborador", 7).documentChunks.part({ uploadId, part: 0, total: 1, scope: escopoMidiaSaudacao(id, "imagem"), fileName: "foto.png", base64: PNG.toString("base64") });
    await expect(caller("admin").dolores.atendimento.salvarMidia({ campanhaId: id, tipo: "imagem", uploadId, nome: "foto.png" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await q("SELECT * FROM whatsapp_campanha_midias")).toEqual([]);
  });
  it("não há campo de URL: entrada com URL é recusada pelo esquema estrito", async () => {
    const id = await campanhaAtiva();
    await expect(caller("admin").dolores.atendimento.salvarMidia({ campanhaId: id, tipo: "imagem", url: "http://169.254.169.254/" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("gravação pela tela do administrador", () => {
  it("grava pelos bytes (PNG com nome .jpg vira .png), mostra os metadados, pré-visualiza e remove", async () => {
    const admin = caller("admin");
    const id = await campanhaAtiva();
    const r = await anexar(admin, id, "imagem", PNG, "../foto.jpg");
    expect(r.campanhas[0].imagem).toMatchObject({ tipo: "imagem", mime: "image/png", nome: "foto.png", tamanho: PNG.length, duracaoS: null });
    await anexar(admin, id, "audio", ogg(42), "voz.ogg");
    const s = await admin.dolores.atendimento.status();
    expect(s.campanhas[0].audio).toMatchObject({ mime: "audio/ogg", duracaoS: 42 });
    const p = await admin.dolores.atendimento.midiaDaCampanha({ campanhaId: id, tipo: "imagem", offset: 0 });
    expect(Buffer.from(p.base64, "base64").equals(PNG)).toBe(true);
    await admin.dolores.atendimento.removerMidia({ campanhaId: id, tipo: "imagem" });
    expect(await q("SELECT tipo FROM whatsapp_campanha_midias")).toEqual([{ tipo: "audio" }]);
    expect(JSON.stringify(await q("SELECT resumo FROM dolores_acoes WHERE funcao = 'campanha_saudacao'"))).not.toMatch(/foto|voz/); // nome do arquivo fora da auditoria
  });
  it("recusa arquivo falso, imagem acima de 5 MB (em partes de 1 MB) e áudio acima de 2 minutos, com mensagem clara", async () => {
    const admin = caller("admin");
    const id = await campanhaAtiva();
    await expect(anexar(admin, id, "imagem", Buffer.from("MZ executável disfarçado de foto"), "foto.png")).rejects.toThrow(/não é uma imagem JPG ou PNG/);
    await expect(anexar(admin, id, "imagem", Buffer.concat([JPG, Buffer.alloc(LIMITE_IMAGEM_SAUDACAO)]), "grande.jpg")).rejects.toThrow(/acima de 5 MB|passa de 5 MB/);
    await expect(anexar(admin, id, "audio", ogg(150), "longo.ogg")).rejects.toThrow(/máximo é 2 minutos/);
    await expect(anexar(admin, id, "audio", m4a(30, "vide"), "video.m4a")).rejects.toThrow(/Não reconheci este áudio/);
    expect(await q("SELECT * FROM whatsapp_campanha_midias")).toEqual([]);
  });
  it("criar campanha devolve o id (a tela já oferece anexar)", async () => {
    const r = await caller("admin").dolores.atendimento.criarCampanha({ nome: "Nova", texto: "Olá, nova campanha!" });
    expect(r.criadaId).toBe((await q<{ id: number }>("SELECT id FROM whatsapp_campanhas WHERE nome = 'Nova'"))[0].id);
  });
});

describe("envio da saudação: ordem, queda para texto e uma vez por número", () => {
  it("imagem com o texto como legenda (uma mensagem só) e depois o áudio como mensagem de voz", async () => {
    const id = await campanhaAtiva();
    await anexar(caller("admin"), id, "imagem", JPG, "foto.jpg");
    await anexar(caller("admin"), id, "audio", mp3(15), "voz.mp3");
    const r = await chamar(aviso(direta()));
    expect(r.body.rota).toMatchObject({ "saudacao-enviada": 1 });
    expect(ordem).toEqual(["imagem:Olá! Conheça o Residencial Prospecta.", "audio"]);
    expect(enviarTexto).not.toHaveBeenCalled();
    expect(enviarMidia.mock.calls[0][0].midia).toMatchObject({ tipo: "imagem", mime: "image/jpeg", base64: JPG.toString("base64") });
    expect(enviarMidia.mock.calls[1][0].midia).toMatchObject({ tipo: "audio", mime: "audio/mpeg" });
    expect(await saudacoes()).toEqual([{ situacao: "enviada", texto_saiu: true, imagem_saiu: true, audio_saiu: true }]);
    expect(await central()).toEqual([
      { mensagem: "[imagem] Olá! Conheça o Residencial Prospecta.", automatica: true, status: "enviada" },
      { mensagem: "[áudio]", automatica: true, status: "enviada" },
    ]);
  });
  it("sem imagem: o texto e depois o áudio; sem mídia: só o texto (como antes)", async () => {
    const id = await campanhaAtiva();
    await anexar(caller("admin"), id, "audio", ogg(10), "voz.ogg");
    await chamar(aviso(direta()));
    expect(ordem).toEqual(["texto:Olá! Conheça o Residencial Prospecta.", "audio"]);
    expect(await saudacoes()).toEqual([{ situacao: "enviada", texto_saiu: true, imagem_saiu: null, audio_saiu: true }]);
    await caller("admin").dolores.atendimento.removerMidia({ campanhaId: id, tipo: "audio" });
    ordem = [];
    await chamar(aviso(direta({ de: "5511900000009" })));
    expect(ordem).toEqual(["texto:Olá! Conheça o Residencial Prospecta."]);
    expect((await saudacoes())[1]).toEqual({ situacao: "enviada", texto_saiu: true, imagem_saiu: null, audio_saiu: null });
  });
  it("a imagem falhou: o texto sai sozinho, o áudio segue, e fica registrado", async () => {
    const id = await campanhaAtiva();
    await anexar(caller("admin"), id, "imagem", PNG, "foto.png");
    await anexar(caller("admin"), id, "audio", ogg(10), "voz.ogg");
    falhar.add("imagem");
    const r = await chamar(aviso(direta()));
    expect(ordem).toEqual(["imagem:Olá! Conheça o Residencial Prospecta.", "texto:Olá! Conheça o Residencial Prospecta.", "audio"]);
    expect(r.body.rota).toMatchObject({ "saudacao-enviada-parcial": 1 });
    expect(await saudacoes()).toEqual([{ situacao: "enviada", texto_saiu: true, imagem_saiu: false, audio_saiu: true }]);
    expect((await central()).map(x => x.status)).toEqual(["falhou", "enviada", "enviada"]);
  });
  it("a imagem saiu e o áudio falhou: nada é reenviado depois (nem a imagem), e o que saiu fica registrado", async () => {
    const id = await campanhaAtiva();
    await anexar(caller("admin"), id, "imagem", PNG, "foto.png");
    await anexar(caller("admin"), id, "audio", ogg(10), "voz.ogg");
    falhar.add("audio");
    await chamar(aviso(direta()));
    expect(await saudacoes()).toEqual([{ situacao: "enviada", texto_saiu: true, imagem_saiu: true, audio_saiu: false }]);
    falhar.clear();
    ordem = [];
    const r = await chamar(aviso(direta({ texto: "alô?" })));
    expect(r.body.rota).toMatchObject({ "saudacao-ja-enviada": 1 });
    expect(ordem).toEqual([]);
  });
  it("o texto não saiu (imagem e texto falharam): o áudio sozinho não vai; registrada como erro", async () => {
    const id = await campanhaAtiva();
    await anexar(caller("admin"), id, "imagem", PNG, "foto.png");
    await anexar(caller("admin"), id, "audio", ogg(10), "voz.ogg");
    falhar.add("imagem"); falhar.add("texto");
    await chamar(aviso(direta()));
    expect(ordem).toEqual(["imagem:Olá! Conheça o Residencial Prospecta.", "texto:Olá! Conheça o Residencial Prospecta."]);
    expect(await saudacoes()).toEqual([{ situacao: "erro", texto_saiu: false, imagem_saiu: false, audio_saiu: false }]);
  });
  it("mídia gravada que não passa mais na conferência não sai: só o texto", async () => {
    const id = await campanhaAtiva();
    await banco.pg.query(`INSERT INTO whatsapp_campanha_midias (campanha_id, tipo, mime, nome, tamanho, sha256, conteudo) VALUES ($1, 'imagem', 'image/png', 'x.png', 5, 'x', $2)`, [id, Buffer.from("falso")]);
    await chamar(aviso(direta()));
    expect(ordem).toEqual(["texto:Olá! Conheça o Residencial Prospecta."]);
    expect(enviarMidia).not.toHaveBeenCalled();
  });
  it("o eco da imagem e do áudio da saudação é reconhecido como automático (não cala a Dolores nem duplica)", async () => {
    expect(lerParaRoteamento(direta({ fromMe: true, message: { imageMessage: { caption: " Olá! " } } }))).toMatchObject({ tipo: "propria", texto: "[imagem] Olá!" });
    expect(lerParaRoteamento(direta({ fromMe: true, message: { audioMessage: { seconds: 10, ptt: true } } }))).toMatchObject({ tipo: "propria", texto: "[áudio]" });
    const id = await campanhaAtiva();
    await anexar(caller("admin"), id, "imagem", PNG, "foto.png");
    await anexar(caller("admin"), id, "audio", ogg(10), "voz.ogg");
    // o eco chega ANTES de o envio gravar o id: segura o id da Evolution até os ecos passarem
    const ecos: Promise<unknown>[] = [];
    enviarMidia.mockImplementation(async (p: { midia: { tipo: string }; legenda: string }) => {
      const message = p.midia.tipo === "imagem" ? { imageMessage: { caption: p.legenda } } : { audioMessage: { seconds: 10, ptt: true } };
      ecos.push(chamar(aviso(direta({ fromMe: true, message }))));
      await ecos[ecos.length - 1];
      return `EVO${++seq}`;
    });
    await chamar(aviso(direta()));
    expect(ecos).toHaveLength(2);
    expect((await central()).map(x => x.automatica)).toEqual([true, true]);
    expect(await q("SELECT * FROM whatsapp_silencio")).toEqual([]);
  });
});
