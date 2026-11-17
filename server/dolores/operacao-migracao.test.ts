// EPIC-025 (Dolores, etapa 6) — migração 0131: aplicada duas vezes (testes-banco.ts), tudo desligado por padrão, rondas,
// relatórios e eventos só inserção, janela/chave únicas, e a exclusão de usuários continua funcionando.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { criarBanco } from "./testes-banco.js";

const SQL = readFileSync(new URL("../../drizzle/0131_dolores_operacao.sql", import.meta.url), "utf8");

describe("migração 0131 (operação contínua)", () => {
  it("é idempotente (aplicada mais uma vez sem erro) e começa com tudo desligado", async () => {
    const { pg } = await criarBanco();
    await pg.exec(SQL);
    const { rows } = await pg.query<any>("SELECT * FROM dolores_operacao_config");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 1, rondas_ligadas: false, relatorio_ligado: false, eventos_ligados: false, relatorio_hora: 7,
      preco_entrada_milhao: null, preco_saida_milhao: null });
    await expect(pg.exec("INSERT INTO dolores_operacao_config (id) VALUES (2)")).rejects.toThrow();
    await expect(pg.exec("UPDATE dolores_operacao_config SET relatorio_hora = 24")).rejects.toThrow();
  });

  it("só aditiva: nenhum ALTER, DROP, DELETE, TRUNCATE nem UPDATE no texto", () => {
    const semComentarios = SQL.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
    expect(semComentarios).not.toMatch(/\b(ALTER|DROP|DELETE\s+FROM|TRUNCATE\s+(TABLE\s+)?"|UPDATE\s+")\b/i);
  });

  it("rondas, relatórios e eventos: só inserção, janela e chave únicas", async () => {
    const { pg } = await criarBanco();
    await pg.exec(`INSERT INTO dolores_rondas (janela, origem) VALUES ('diaria:2026-11-17', 'cron')`);
    await expect(pg.exec(`INSERT INTO dolores_rondas (janela, origem) VALUES ('diaria:2026-11-17', 'cron')`)).rejects.toThrow();
    await expect(pg.exec(`INSERT INTO dolores_rondas (janela, origem) VALUES ('x', 'outra')`)).rejects.toThrow();
    await expect(pg.exec(`UPDATE dolores_rondas SET totais = '{"a":1}'`)).rejects.toThrow(/SOMENTE_INSERCAO/);
    await expect(pg.exec(`DELETE FROM dolores_rondas`)).rejects.toThrow(/SOMENTE_INSERCAO/);
    await expect(pg.exec(`TRUNCATE dolores_rondas CASCADE`)).rejects.toThrow(/SOMENTE_INSERCAO/);
    await pg.exec(`INSERT INTO dolores_relatorios (janela, tipo, origem, ronda_id, texto) VALUES ('diario:2026-11-17', 'diario', 'cron', 1, 'oi')`);
    await expect(pg.exec(`INSERT INTO dolores_relatorios (janela, tipo, origem, ronda_id, texto) VALUES ('diario:2026-11-17', 'diario', 'cron', 1, 'oi')`)).rejects.toThrow();
    await expect(pg.exec(`INSERT INTO dolores_relatorios (janela, tipo, origem, ronda_id, texto) VALUES ('y', 'diario', 'cron', 999, 'oi')`)).rejects.toThrow();
    await expect(pg.exec(`UPDATE dolores_relatorios SET texto = 'outro'`)).rejects.toThrow(/SOMENTE_INSERCAO/);
    await expect(pg.exec(`DELETE FROM dolores_relatorios`)).rejects.toThrow(/SOMENTE_INSERCAO/);
    await pg.exec(`INSERT INTO dolores_eventos (tipo, chave) VALUES ('nota_lida', 'nota:1')`);
    await expect(pg.exec(`INSERT INTO dolores_eventos (tipo, chave) VALUES ('nota_lida', 'nota:1')`)).rejects.toThrow();
    await expect(pg.exec(`INSERT INTO dolores_eventos (tipo, chave) VALUES ('pagar', 'p:1')`)).rejects.toThrow();
    await expect(pg.exec(`UPDATE dolores_eventos SET resumo = '{}'`)).rejects.toThrow(/SOMENTE_INSERCAO/);
    await expect(pg.exec(`DELETE FROM dolores_eventos`)).rejects.toThrow(/SOMENTE_INSERCAO/);
  });

  it("excluir um usuário que mexeu na configuração continua funcionando (ON DELETE SET NULL numa tabela sem guarda)", async () => {
    const { pg } = await criarBanco();
    await pg.exec(`INSERT INTO users ("openId", name, role, active, "passwordHash") VALUES ('adm', 'Admin', 'admin', true, 'h')`);
    await pg.exec(`UPDATE dolores_operacao_config SET atualizado_por = 1`);
    await pg.exec(`INSERT INTO dolores_rondas (janela, origem) VALUES ('sob-demanda:2026-11-17T09:00', 'tela')`);
    await pg.exec(`INSERT INTO dolores_relatorios (janela, tipo, origem, ronda_id, texto, pedido_por_user_id) VALUES ('sob-demanda:2026-11-17T09:00', 'sob_demanda', 'tela', 1, 't', 1)`);
    await pg.exec(`DELETE FROM users WHERE id = 1`);
    expect((await pg.query<any>("SELECT atualizado_por FROM dolores_operacao_config")).rows[0].atualizado_por).toBeNull();
    expect((await pg.query<any>("SELECT count(*)::int AS n FROM dolores_relatorios")).rows[0].n).toBe(1);
  });
});
