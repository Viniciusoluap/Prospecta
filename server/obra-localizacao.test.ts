import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "./db.js";
import { salvarLocalizacaoObra } from "./obra-localizacao.js";
import { coordenadasSalvas, imovelDaObra, normalizarCoordenadas } from "../shared/obra-localizacao.js";

vi.mock("./db.js", () => ({ getDb: vi.fn() }));

/** Construtor fluente mínimo: cada select/insert/update/delete consome a próxima resposta. */
function fakeDb(respostas: unknown[]) {
  let i = 0;
  const chamadas: { metodo: string; dados?: unknown }[] = [];
  const cadeia = (metodo: string) => {
    let resultado: unknown;
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit", "returning"]) c[m] = () => c;
    c.values = (dados: unknown) => { chamadas.push({ metodo, dados }); return c; };
    c.set = (dados: unknown) => { chamadas.push({ metodo, dados }); return c; };
    c.then = (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => {
      if (metodo === "delete") chamadas.push({ metodo });
      resultado ??= respostas[i++];
      return Promise.resolve(resultado).then(ok, erro);
    };
    return c;
  };
  vi.mocked(getDb).mockReturnValue({ select: () => cadeia("select"), insert: () => cadeia("insert"), update: () => cadeia("update"), delete: () => cadeia("delete") } as never);
  return chamadas;
}
const obra = { id: 7, title: "Casa Maria", address: "Rua A, 10", city: "Parauapebas", state: "PA", imovelId: null as number | null };

describe("Obras — Localização exata → imóvel vinculado (etapa 3)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("sem vínculo: cria imóvel NÃO publicado, reservado, e vincula à obra", async () => {
    const chamadas = fakeDb([[obra], [{ id: 55 }], [{ id: 7 }]]);
    const r = await salvarLocalizacaoObra(7, { lat: -6.0675, lng: -49.9022 }, 99);
    expect(r).toEqual({ imovelId: 55, criado: true, coords: { lat: -6.0675, lng: -49.9022 } });
    const ins = chamadas.find(c => c.metodo === "insert")!.dados as Record<string, unknown>;
    expect(ins).toMatchObject({ titulo: "Obra — Casa Maria", endereco: "Rua A, 10", cidade: "Parauapebas", status: "reservado", publicadoSite: false, publicadoZap: false, publicadoOlx: false, publicadoViva: false, publicadoChavesNaMao: false, latitude: "-6.0675000", longitude: "-49.9022000", createdByUserId: 99 });
    expect(String(ins.slug)).toMatch(/^obra-7-[0-9a-f]{8}$/);
    expect(chamadas.find(c => c.metodo === "update")!.dados).toMatchObject({ imovelId: 55 });
  });

  it("com vínculo: atualiza só o ponto do mesmo imóvel, sem duplicar", async () => {
    const chamadas = fakeDb([[{ ...obra, imovelId: 55 }], []]);
    const r = await salvarLocalizacaoObra(7, { lat: -6.1, lng: -49.9 }, 99);
    expect(r).toMatchObject({ imovelId: 55, criado: false });
    expect(chamadas.filter(c => c.metodo === "insert")).toHaveLength(0);
    expect(Object.keys(chamadas[0].dados as object).sort()).toEqual(["latitude", "longitude", "updatedAt"]);
  });

  it("corrida: se outra gravação vinculou antes, apaga o imóvel recém-criado e atualiza o vencedor", async () => {
    const chamadas = fakeDb([[obra], [{ id: 56 }], [], [], [{ ...obra, imovelId: 55 }], []]);
    const r = await salvarLocalizacaoObra(7, { lat: -6.1, lng: -49.9 }, 99);
    expect(r).toMatchObject({ imovelId: 55, criado: false });
    expect(chamadas.map(c => c.metodo)).toEqual(["insert", "update", "delete", "update"]);
  });

  it("obra antiga sem ponto: remover não cria nada; ponto inválido é recusado", async () => {
    const chamadas = fakeDb([[obra]]);
    expect(await salvarLocalizacaoObra(7, null, 99)).toEqual({ imovelId: null, criado: false, coords: null });
    expect(chamadas).toHaveLength(0);
    await expect(salvarLocalizacaoObra(7, { lat: 95, lng: 0 }, 99)).rejects.toThrow("Localização inválida");
    await expect(salvarLocalizacaoObra(7, { lat: 0, lng: 0 }, 99)).rejects.toThrow("Localização inválida");
  });

  it("helpers: leitura de ponto salvo e dados do imóvel", () => {
    expect(coordenadasSalvas("-6.0675000", "-49.9022000")).toEqual({ lat: -6.0675, lng: -49.9022 });
    expect(coordenadasSalvas(null, "1")).toBeNull();
    expect(coordenadasSalvas("abc", "1")).toBeNull();
    expect(normalizarCoordenadas({ lat: -6.123456789, lng: 1 })).toEqual({ lat: -6.1234568, lng: 1 });
    expect(imovelDaObra({ id: 1, titulo: "X", endereco: " ", cidade: null, estado: "PAR" })).toMatchObject({ endereco: null, cidade: "Não informada", estado: "PA" });
  });
});
