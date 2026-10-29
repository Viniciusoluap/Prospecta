import { afterEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as banco from "./db.js";
import { regularizacaoRouter } from "./regularizacao-router.js";
import { ITENS_FINANCEIROS_PADRAO, VALORES_PREVISTOS_PADRAO, paginarProcessos, planejarValoresPadrao } from "../shared/financeiro/regularizacao.js";

afterEach(() => vi.restoreAllMocks());

describe("paginação dos processos", () => {
  it.each([0, 1, 4, 5, 32])("mantém todos os %i registros acessíveis de quatro em quatro", total => {
    const registros = Array.from({ length: total }, (_, id) => id);
    const primeira = paginarProcessos(registros, 1);
    const reunidos = Array.from({ length: primeira.totalPaginas }, (_, i) => paginarProcessos(registros, i + 1).registros).flat();
    expect(reunidos).toEqual(registros);
    expect(primeira.totalPaginas).toBe(Math.max(1, Math.ceil(total / 4)));
    expect(primeira.registros.length).toBeLessThanOrEqual(4);
  });
  it("corrige página após exclusão e preserva a lista original", () => {
    const registros = [1, 2, 3, 4];
    expect(paginarProcessos(registros, 2)).toEqual({ paginaAtual: 1, totalPaginas: 1, registros });
    expect(paginarProcessos([], 8)).toEqual({ paginaAtual: 1, totalPaginas: 1, registros: [] });
    expect(registros).toEqual([1, 2, 3, 4]);
  });
});

describe("tabela padrão independente", () => {
  it("contém os 17 previstos conferidos", () => {
    expect(ITENS_FINANCEIROS_PADRAO.map(i => VALORES_PREVISTOS_PADRAO[i.chave])).toEqual([
      250000, 200000, 10000, 30000, 200000, 10200, 40000, 60000, 75000,
      200000, 70000, 70000, 200000, 0, 70000, 200000, 200000,
    ]);
  });
  it("preserva IDs de itens legados e rejeita ambiguidade", () => {
    const legado = { id: 88, chavePadrao: null, nome: "agua", grupo: "durante_obra", previsto: "10.00" };
    const plano = planejarValoresPadrao([legado]);
    expect(plano.find(i => i.padrao.chave === "agua")).toMatchObject({ atual: { id: 88 }, previsto: "300.00", substituir: true });
    expect(() => planejarValoresPadrao([legado, { ...legado, id: 89 }])).toThrow("mais de um item");
  });
});

async function prepararBanco() {
  const pg = new PGlite();
  await pg.exec(`
    CREATE TABLE regularizacoes (id integer PRIMARY KEY, updated_at timestamp NOT NULL DEFAULT now());
    CREATE TABLE regularizacao_itens_financeiros (
      id serial PRIMARY KEY, regularizacao_id integer NOT NULL REFERENCES regularizacoes(id),
      chave_padrao varchar(40), nome varchar(120) NOT NULL, grupo varchar(20) NOT NULL,
      ordem integer NOT NULL, previsto numeric(15,2) NOT NULL DEFAULT 0,
      created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX padrao_idx ON regularizacao_itens_financeiros (regularizacao_id,chave_padrao) WHERE chave_padrao IS NOT NULL;
    CREATE TABLE recebimentos_teste (item_id integer REFERENCES regularizacao_itens_financeiros(id), valor numeric(15,2));
    INSERT INTO regularizacoes(id) VALUES (1);
    INSERT INTO regularizacao_itens_financeiros(regularizacao_id,chave_padrao,nome,grupo,ordem,previsto) VALUES (1,'projetos','Projetos','durante_obra',1,800);
    INSERT INTO recebimentos_teste VALUES(1,150);
  `);
  vi.spyOn(banco, "getDb").mockReturnValue(drizzle(pg) as never);
  return pg;
}
const caller = () => regularizacaoRouter.createCaller({ user: { id: 1, role: "admin", active: true }, req: {}, res: {} } as never);

describe("aplicação transacional do padrão", () => {
  it("exige confirmação no servidor, preserva recebimentos e permite reaplicar sem duplicar", async () => {
    const pg = await prepararBanco();
    try {
      await expect(caller().financeiro.gerarValorPadrao({ regularizacaoId: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await pg.query<{ previsto: string }>("SELECT previsto FROM regularizacao_itens_financeiros WHERE id=1")).rows[0].previsto).toBe("800.00");
      await caller().financeiro.gerarValorPadrao({ regularizacaoId: 1, confirmarSubstituicao: true });
      await caller().financeiro.gerarValorPadrao({ regularizacaoId: 1 });
      expect((await pg.query("SELECT id FROM regularizacao_itens_financeiros")).rows).toHaveLength(17);
      expect((await pg.query("SELECT * FROM recebimentos_teste")).rows).toEqual([{ item_id: 1, valor: "150.00" }]);
      expect((await pg.query<{ previsto: string }>("SELECT previsto FROM regularizacao_itens_financeiros WHERE id=1")).rows[0].previsto).toBe("2500.00");
      await pg.exec("UPDATE regularizacao_itens_financeiros SET previsto=999 WHERE id=1");
      await expect(caller().financeiro.gerarValorPadrao({ regularizacaoId: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    } finally { await pg.close(); }
  });
  it("desfaz todos os previstos se um item falhar", async () => {
    const pg = await prepararBanco();
    try {
      await pg.exec(`ALTER TABLE regularizacao_itens_financeiros ADD CONSTRAINT falha_teste CHECK(chave_padrao <> 'averbacao')`);
      await expect(caller().financeiro.gerarValorPadrao({ regularizacaoId: 1, confirmarSubstituicao: true })).rejects.toThrow();
      expect((await pg.query("SELECT id,previsto FROM regularizacao_itens_financeiros")).rows).toEqual([{ id: 1, previsto: "800.00" }]);
    } finally { await pg.close(); }
  });
});
