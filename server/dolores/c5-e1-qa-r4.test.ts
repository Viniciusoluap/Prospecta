// QA C5-E1 rodada 4 (commit de3dc8f, decisão do dono: memória com as últimas 100 mensagens das últimas 6 h). Prova os tetos no
// pior caso (100 mensagens enormes), a cobertura da reserva, a expiração, a gravação concorrente, o casamento com a migração 0143
// e que a memória continua presa à conversa do dono (só whatsapp.ts lê/grava). Banco em memória (PGlite); nada sai para a rede.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));

import { getDb } from "../db.js";
import {
  JANELA_CARACTERES, JANELA_HORAS, JANELA_MENSAGENS, MAX_CARACTERES_POR_ITEM, MAX_TEXTO_GRAVADO, RETENCAO_HORAS,
  caracteresDoHistorico, gravarNaConversa, janelaDe, lerJanela, montarMensagens, semCodigosReais, textoParaGravar, tokensEstimadosDoHistorico,
  type ItemDaConversa,
} from "./memoria.js";
import { AGORA, MIGRACAO_0143, criarBanco } from "./testes-banco.js";

let banco: Awaited<ReturnType<typeof criarBanco>>;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
const antes = (min: number) => new Date(AGORA.getTime() - min * 60_000).toISOString();

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
});

describe("QA r4 — pior caso: 100 mensagens enormes", () => {
  it("120 linhas de 4.000 caracteres (o máximo gravado) nas 6 h: a janela respeita 100 itens, 3.000 por item e 40.000 no total", async () => {
    const valores = Array.from({ length: 120 }, (_, i) => `('${antes(i + 1)}', '${i % 2 ? "dolores" : "dono"}', '${i % 2 ? "resposta" : "mensagem"}', '${String(i).padEnd(MAX_TEXTO_GRAVADO, "é")}', '[]')`);
    await banco.pg.exec(`INSERT INTO dolores_conversa (criado_em, papel, origem, texto, referencias) VALUES ${valores.join(",")}`);
    const h = await lerJanela(AGORA);
    expect(h.itens.length).toBeLessThanOrEqual(JANELA_MENSAGENS);
    expect(h.itens.every(i => i.texto.length <= MAX_CARACTERES_POR_ITEM)).toBe(true);
    const total = h.itens.reduce((s, i) => s + i.texto.length, 0);
    expect(total).toBeLessThanOrEqual(JANELA_CARACTERES);
    expect(h.itens).toHaveLength(13); // 13 × 3.000 = 39.000; a 14ª passaria de 40.000 e sai inteira
    // as que ficam são as MAIS NOVAS (a última é a linha 0)
    expect(h.itens.at(-1)!.texto.startsWith("0")).toBe(true);
  });

  it("a reserva cobre, em caracteres, TUDO o que o histórico manda ao modelo (rótulos e cabeçalho), com 100 itens curtos ou 13 longos", () => {
    const AG = AGORA;
    const item = (min: number, papel: ItemDaConversa["papel"], t: string): ItemDaConversa & { referencias: any[] } => ({
      papel, origem: papel === "dono" ? "encaminhada" : papel === "dolores" ? "resposta" : "aviso", criadoEm: new Date(AG.getTime() - min * 60_000), texto: t,
      referencias: [{ tipo: "cliente", id: min + 1, rotulo: "N".repeat(40) }],
    });
    for (const tam of [1, 400, 3_000]) {
      const linhas = Array.from({ length: 100 }, (_, i) => item(i, (["dono", "dolores", "sistema"] as const)[i % 3], "x".repeat(tam)));
      const h = janelaDe(linhas, AG);
      const comando = "ok";
      const enviado = montarMensagens(h, comando).flatMap(m => m.content).reduce((s, c) => s + c.text.length, 0) - comando.length;
      expect(caracteresDoHistorico(h)).toBeGreaterThanOrEqual(enviado);
    }
    // janela cheia: estimativa da 1ª reserva na casa de 17–18 mil tokens (≈ caracteres/3)
    const cheia = janelaDe(Array.from({ length: 100 }, (_, i) => item(i, i % 2 ? "dolores" : "dono", "w".repeat(400))), AG);
    expect(tokensEstimadosDoHistorico(cheia)).toBeLessThan(19_000);
  });

  it("cabe no prazo: gravar 100 textos de 20.000 caracteres cheios de palavras e montar a janela leva milissegundos (linear, sem ReDoS)", () => {
    const reais = new Set(Array.from({ length: 3_000 }, (_, i) => `K${i.toString(36).toUpperCase().padStart(4, "Z")}`));
    const enorme = Array.from({ length: 4_000 }, (_, i) => (i % 7 ? "aaaa" : "KZZZ1")).join(" ").slice(0, 20_000) + "a".repeat(5_000) + "!".repeat(5_000);
    const t0 = performance.now();
    const gravados = Array.from({ length: 100 }, () => textoParaGravar(enorme, reais));
    const h = janelaDe(gravados.map((t, i) => ({ papel: "dono" as const, origem: "mensagem" as const, criadoEm: new Date(AGORA.getTime() - i * 60_000), texto: t })), AGORA);
    montarMensagens(h, "ok");
    semCodigosReais("x".repeat(100_000), reais);
    expect(performance.now() - t0).toBeLessThan(5_000);
    expect(gravados[0].length).toBeLessThanOrEqual(MAX_TEXTO_GRAVADO);
  });
});

describe("QA r4 — expiração, retenção e concorrência", () => {
  it("mensagem com 6 h e 1 min não entra; linha com mais de 24 h é apagada na leitura; ref de 23 h ainda vale", async () => {
    await banco.pg.exec(`INSERT INTO dolores_conversa (criado_em, papel, origem, texto, referencias) VALUES
      ('${antes(JANELA_HORAS * 60 + 1)}', 'dono', 'mensagem', 'passou de 6 h', '[]'),
      ('${antes(23 * 60)}', 'dolores', 'resposta', 'de ontem', '[{"tipo":"cliente","id":9,"rotulo":"Fulana"}]'),
      ('${antes(RETENCAO_HORAS * 60 + 1)}', 'dono', 'mensagem', 'vencida', '[{"tipo":"cliente","id":7,"rotulo":"Velha"}]'),
      ('${antes(5)}', 'dono', 'mensagem', 'agora', '[]')`);
    const h = await lerJanela(AGORA);
    expect(h.itens.map(i => i.texto)).toEqual(["agora"]);
    expect(h.referencias).toEqual([{ tipo: "cliente", id: 9, rotulo: "Fulana" }]);
    expect((await q<{ texto: string }>("SELECT texto FROM dolores_conversa ORDER BY id")).map(r => r.texto)).not.toContain("vencida");
  });

  it("duas gravações ao mesmo tempo: duas linhas, nenhuma duplicada nem misturada, e a leitura simultânea não quebra", async () => {
    const [a, b, j] = await Promise.all([
      gravarNaConversa({ papel: "dono", origem: "mensagem", texto: "primeira", agora: AGORA }),
      gravarNaConversa({ papel: "dolores", origem: "resposta", texto: "segunda", agora: AGORA }),
      lerJanela(AGORA),
    ]);
    expect([a, b]).toEqual([true, true]);
    expect(Array.isArray(j.itens)).toBe(true);
    const linhas = await q<{ papel: string; texto: string }>("SELECT papel, texto FROM dolores_conversa ORDER BY id");
    expect(linhas.map(l => `${l.papel}:${l.texto}`).sort()).toEqual(["dolores:segunda", "dono:primeira"]);
  });

  it("segredos e dados bancários nunca são guardados, mesmo no texto longo da janela nova", async () => {
    const segredo = `senha: Abc!12345 token sk-ant-api03-${"q".repeat(40)} agência 1234 conta 98765-4 ${"texto ".repeat(500)}`;
    expect(await gravarNaConversa({ papel: "dono", origem: "mensagem", texto: segredo, agora: AGORA })).toBe(true);
    const [l] = await q<{ texto: string }>("SELECT texto FROM dolores_conversa");
    expect(l.texto).not.toMatch(/Abc!12345|sk-ant-api03|98765-4/);
  });
});

describe("QA r4 — migração 0143 e fronteira da memória", () => {
  it("a 0143 não precisou mudar: texto varchar(4000) = MAX_TEXTO_GRAVADO, aditiva (só CREATE ... IF NOT EXISTS)", () => {
    const sql = MIGRACAO_0143();
    expect(sql).toMatch(/"texto" varchar\(4000\)/);
    expect(MAX_TEXTO_GRAVADO).toBe(4_000);
    const comandos = sql.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
    expect(comandos.replace(/ON DELETE SET NULL/g, "")).not.toMatch(/\b(DROP|ALTER|DELETE|UPDATE|TRUNCATE)\b/i); // a FK "ON DELETE SET NULL" não é comando
    expect(comandos.match(/CREATE (TABLE|INDEX) IF NOT EXISTS/g)).toHaveLength(2);
  });

  it("só whatsapp.ts lê e grava a memória; cerebro.ts só monta (nenhum caminho de grupo/cliente importa memoria.js)", () => {
    const raiz = new URL("..", import.meta.url).pathname;
    const arquivos = (readdirSync(raiz, { recursive: true }) as string[]).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.replaceAll("\\", "/").endsWith("dolores/memoria.ts"));
    const importam = arquivos.filter(f => /from "\.\/memoria\.js"|from "\.\.\/dolores\/memoria\.js"|dolores\/memoria/.test(readFileSync(join(raiz, f), "utf8")));
    expect(importam.map(f => f.replaceAll("\\", "/")).sort()).toEqual(["dolores/cerebro.ts", "dolores/whatsapp.ts"]);
    const cerebro = readFileSync(join(raiz, "dolores/cerebro.ts"), "utf8");
    const importDaMemoria = cerebro.split("\n").find(l => l.includes("from \"./memoria.js\""))!;
    expect(importDaMemoria).not.toMatch(/lerJanela|gravarNaConversa|esquecerConversa/); // só monta; quem lê e grava é whatsapp.ts
  });
});
