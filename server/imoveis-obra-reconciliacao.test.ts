// Pedido de 25/10 (noite), item 3: imóveis gerados de obra mostram endereço e valor = VGV (mesma fonte do Mapa).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "./db.js";
import { constructionProjects, imoveis, leads } from "../drizzle/schema.js";
import { previaReconciliacao, reconciliarImoveisGeradosDeObras, sincronizarImovelGeradoDaObra, garantirImovelCatalogoObra } from "./obra-localizacao.js";
import { cidadeEstadoDoEndereco, imovelDaObra, localizacaoImovel, vgvDaObra } from "../shared/obra-localizacao.js";

vi.mock("./db.js", () => ({ getDb: vi.fn() }));

function fakeDb(respostas: Map<unknown, unknown[][]>) {
  const escritas: { op: string; tabela: unknown; dados?: unknown }[] = [];
  const select = () => {
    let tabela: unknown;
    const c: Record<string, unknown> = {};
    for (const m of ["where", "orderBy", "leftJoin", "limit"]) c[m] = () => c;
    c.from = (t: unknown) => { tabela = t; return c; };
    c.then = (ok: (v: unknown) => unknown) => Promise.resolve((respostas.get(tabela) ?? []).shift() ?? []).then(ok);
    return c;
  };
  const escrita = (op: string) => (tabela: unknown) => {
    const c: Record<string, unknown> = {};
    let dados: unknown; let ret: unknown[] = [];
    c.values = (d: unknown) => { dados = d; return c; };
    c.set = (d: unknown) => { dados = d; return c; };
    c.where = () => c;
    c.returning = () => { ret = op === "insert" ? [{ id: 90 }] : [{ id: 1 }]; return c; };
    c.then = (ok: (v: unknown) => unknown) => { escritas.push({ op, tabela, dados }); return Promise.resolve(ret).then(ok); };
    return c;
  };
  vi.mocked(getDb).mockReturnValue({ select, insert: escrita("insert"), update: escrita("update"), delete: escrita("delete") } as never);
  return escritas;
}

describe("endereço e cidade do imóvel gerado da obra", () => {
  it("deduz cidade/UF só quando o endereço termina com o estado", () => {
    expect(cidadeEstadoDoEndereco("Residencial Aurora, Vila Esmeralda, Imperatriz Maranhão")).toEqual({ cidade: "Imperatriz", estado: "MA" });
    expect(cidadeEstadoDoEndereco("Morada do Bosque, Imperatriz/MA")).toEqual({ cidade: "Imperatriz", estado: "MA" });
    expect(cidadeEstadoDoEndereco("Rua A, 10, Parauapebas - PA")).toEqual({ cidade: "Parauapebas", estado: "PA" });
    expect(cidadeEstadoDoEndereco("Rua México, Jardim América")).toBeNull();
    expect(cidadeEstadoDoEndereco("Rua X, Vila Maranhão")).toBeNull();
    expect(cidadeEstadoDoEndereco("Rua X, 120")).toBeNull();
    expect(imovelDaObra({ id: 1, titulo: "A", endereco: "Residencial Aurora, Imperatriz Maranhão", cidade: null, estado: null }))
      .toMatchObject({ cidade: "Imperatriz", estado: "MA" });
  });

  it("coluna Localização usa o endereço e não repete 'Não informada'", () => {
    expect(localizacaoImovel({ endereco: "Residencial Aurora, Vila Esmeralda, Imperatriz Maranhão", cidade: "Não informada" }))
      .toBe("Residencial Aurora, Vila Esmeralda, Imperatriz Maranhão");
    expect(localizacaoImovel({ endereco: "Rua B, 5", bairro: "Centro", cidade: "Imperatriz", estado: "MA" })).toBe("Rua B, 5, Centro, Imperatriz, MA");
    expect(localizacaoImovel({ endereco: null, cidade: "Não informada" })).toBe("Não informada");
  });

  it("VGV: obra do CRM usa o simulado do lead; sem lead, o VGV digitado (igual ao Mapa)", () => {
    expect(vgvDaObra({ leadId: 7, simulationValue: "250000.00", vgv: "999.00" })).toBe("250000.00");
    expect(vgvDaObra({ leadId: null, simulationValue: null, vgv: "200000.00" })).toBe("200000.00");
  });
});

describe("reconciliação dos imóveis já gerados", () => {
  beforeEach(() => vi.resetAllMocks());
  const obras = [
    { id: 18, title: "MYLCA", address: "Morada do Bosque, Imperatriz Maranhão", city: null, state: null, vgv: "200000.00", leadId: null, imovelId: 4, simulationValue: null },
    { id: 21, title: "JOAO", address: "Rua México", city: null, state: null, vgv: "1.00", leadId: 7, imovelId: 5, simulationValue: "250000.00" },
    { id: 30, title: "MANUAL", address: "Rua Z", city: "Imperatriz", state: "MA", vgv: "300000.00", leadId: null, imovelId: 6, simulationValue: null },
  ];
  const gerados = () => [
    { id: 4, slug: "obra-18-ab12cd34", titulo: "Obra — MYLCA", endereco: null, cidade: "Não informada", estado: null, preco: "0.00" },
    { id: 5, slug: "obra-21-ffffffff", titulo: "Obra — JOAO", endereco: "Rua México", cidade: "Não informada", estado: null, preco: "180000.00" },
  ];

  it("prévia lista só o que muda; anúncio manual e preço já preenchido ficam", async () => {
    const escritas = fakeDb(new Map<unknown, unknown[][]>([[constructionProjects, [obras]], [imoveis, [gerados()]]]));
    const r = await previaReconciliacao();
    expect(r).toEqual([
      { imovelId: 4, obraId: 18, titulo: "Obra — MYLCA", antes: { endereco: null, cidade: "Não informada", estado: null, preco: "0.00" },
        depois: { endereco: "Morada do Bosque, Imperatriz Maranhão", cidade: "Imperatriz", estado: "MA", preco: "200000.00" } },
    ]);
    expect(escritas).toHaveLength(0);
  });

  it("reconciliar grava e é idempotente (segunda rodada não muda nada)", async () => {
    let escritas = fakeDb(new Map<unknown, unknown[][]>([[constructionProjects, [obras]], [imoveis, [gerados()]]]));
    expect((await reconciliarImoveisGeradosDeObras()).atualizados).toBe(1);
    expect(escritas.filter(e => e.op === "update")).toHaveLength(1);
    const depois = gerados().map(i => i.id === 4 ? { ...i, endereco: "Morada do Bosque, Imperatriz Maranhão", cidade: "Imperatriz", estado: "MA", preco: "200000.00" } : i);
    escritas = fakeDb(new Map<unknown, unknown[][]>([[constructionProjects, [obras]], [imoveis, [depois]]]));
    expect((await reconciliarImoveisGeradosDeObras()).atualizados).toBe(0);
    expect(escritas).toHaveLength(0);
  });

  it("sincronizar: preço zerado vira o VGV (simulado do lead); preço preenchido não muda", async () => {
    let escritas = fakeDb(new Map<unknown, unknown[][]>([
      [constructionProjects, [[{ id: 21, title: "JOAO", address: "Rua México, Imperatriz - MA", city: null, state: null, imovelId: 5, vgv: "1.00", leadId: 7 }]]],
      [imoveis, [[{ id: 5, slug: "obra-21-ffffffff", titulo: "Obra — JOAO", preco: "0.00" }]]],
      [leads, [[{ v: "250000.00" }]]],
    ]));
    await sincronizarImovelGeradoDaObra(21, "JOAO");
    expect(escritas[0].dados).toMatchObject({ cidade: "Imperatriz", estado: "MA", preco: "250000.00" });

    escritas = fakeDb(new Map<unknown, unknown[][]>([
      [constructionProjects, [[{ id: 21, title: "JOAO", address: "Rua México", city: "Imperatriz", state: "MA", imovelId: 5, vgv: "1.00", leadId: null }]]],
      [imoveis, [[{ id: 5, slug: "obra-21-ffffffff", titulo: "Obra — JOAO", preco: "180000.00" }]]],
    ]));
    await sincronizarImovelGeradoDaObra(21, "JOAO");
    expect(escritas[0].dados).not.toHaveProperty("preco");
  });

  it("imóvel novo do catálogo nasce com preço = VGV da obra", async () => {
    const escritas = fakeDb(new Map<unknown, unknown[][]>([
      [constructionProjects, [[{ id: 30, title: "ANA", address: "Residencial Aurora, Imperatriz Maranhão", city: null, state: null, imovelId: null, vgv: "180000.00", leadId: null }]]],
    ]));
    await garantirImovelCatalogoObra(30, 1);
    expect(escritas.find(e => e.op === "insert")!.dados).toMatchObject({ preco: "180000.00", cidade: "Imperatriz", estado: "MA", publicadoSite: false });
  });
});
