import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "./db.js";
import { router } from "./_core/trpc.js";
import { mapaRouter } from "./operacional-router.js";
import { coordenadaPciDecimal, coordenadasDaPci, enderecoCompleto } from "../shared/obra-localizacao.js";

vi.mock("./db.js", () => ({ getDb: vi.fn() }));
const app = router({ mapa: mapaRouter });
const admin = () => ({ user: { id: 1, role: "admin", active: true }, req: {}, res: {} }) as never;

/** Cada select consome a próxima resposta (imóveis, obras, PCIs). */
function fakeDb(respostas: unknown[]) {
  let i = 0;
  const cadeia = () => {
    let r: unknown;
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy", "leftJoin", "limit"]) c[m] = () => c;
    c.then = (ok: (v: unknown) => unknown) => { r ??= respostas[i++]; return Promise.resolve(r).then(ok); };
    return c;
  };
  vi.mocked(getDb).mockReturnValue({ select: cadeia } as never);
}

describe("Coordenadas da PCI da CAIXA", () => {
  it("lê os formatos que existem em produção (Sul/Oeste negativos)", () => {
    expect(coordenadasDaPci("52948 S", "472641 W")).toEqual({ lat: -5.4966667, lng: -47.4447222 });
    expect(coordenadasDaPci(`5°30'29.0" S`, "47°26'39.8 W")).toEqual({ lat: -5.5080556, lng: -47.4443889 });
    expect(coordenadasDaPci("5°32'06'' S", `47°26'48" W`)).toEqual({ lat: -5.535, lng: -47.4466667 });
    expect(coordenadasDaPci(`05° 45' 22" S`, `47° 22' 16" W`)).toEqual({ lat: -5.7561111, lng: -47.3711111 });
    expect(coordenadaPciDecimal("-5.5079")).toBe(-5.5079);
  });
  it("valor vazio, zerado ou ilegível não vira ponto", () => {
    expect(coordenadasDaPci("", "")).toBeNull();
    expect(coordenadasDaPci("000000 S", "472641 W")).toBeNull();
    expect(coordenadasDaPci("abc", "472641 W")).toBeNull();
    expect(coordenadaPciDecimal("5°75'00\" S")).toBeNull();
  });
  it("latitude/longitude trocadas, ou sem hemisfério no formato da PCI, não viram ponto", () => {
    expect(coordenadasDaPci("472641 W", "52948 S")).toBeNull();
    expect(coordenadaPciDecimal(52948)).toBeNull();
    expect(coordenadaPciDecimal("5°30′29″ S")).toBeCloseTo(-5.5080556, 6);
  });
  it("endereço em uma linha sem repetir partes", () => {
    expect(enderecoCompleto(["Morada do Bosque, Imperatriz Maranhão", "Imperatriz", null, " "])).toBe("Morada do Bosque, Imperatriz Maranhão");
    expect(enderecoCompleto(["Rua A, 10", "Centro", "Parauapebas", "PA"])).toBe("Rua A, 10, Centro, Parauapebas, PA");
    expect(enderecoCompleto([null, ""])).toBeNull();
    expect(enderecoCompleto(["Morada do Bosque, Imperatriz/MA", "Imperatriz", "MA"])).toBe("Morada do Bosque, Imperatriz/MA");
    expect(enderecoCompleto(["Rua Centro, 10", "Centro", "Imperatriz"])).toBe("Rua Centro, 10, Centro, Imperatriz");
  });
});

describe("Mapa operacional — imóveis + obras", () => {
  beforeEach(() => vi.resetAllMocks());

  it("imóvel da obra mostra VGV e endereço da obra; obra do CRM usa o VGV simulado do lead (não o aprovado/digitado); obra sem imóvel entra pela PCI; obra sem ponto fica fora", async () => {
    fakeDb([
      [
        { id: 4, title: "Obra — MYLCA", status: "reservado", type: "casa", address: null, city: "Não informada", neighborhood: null, state: null, price: "0.00", latitude: "-5.5079369", longitude: "-47.4442404", slug: "obra-18-x" },
        { id: 9, title: "Casa à venda", status: "disponivel", type: "casa", address: "Rua B, 5", city: "Imperatriz", neighborhood: "Centro", state: "MA", price: "350000.00", latitude: null, longitude: null, slug: "casa" },
      ],
      [
        { id: 18, title: "MYLCA", address: "Morada do Bosque, Imperatriz Maranhão", city: null, state: null, vgv: "200000.00", imovelId: 4, leadId: null, simulationValue: null },
        { id: 21, title: "JOAO", address: "Rua México, Jardim América", city: null, state: null, vgv: "999.00", imovelId: null, leadId: 7, simulationValue: "250000.00" },
        { id: 30, title: "SEM PCI", address: "Rua X", city: null, state: null, vgv: "1.00", imovelId: null, leadId: null, simulationValue: null },
      ],
      [
        { projectId: 18, parsed: { identificacao: { latitude: `5°30'29.0" S`, longitude: "47°26'39.8 W" } } },
        { projectId: 21, parsed: { identificacao: { latitude: "52948 S", longitude: "472641 W" } } },
      ],
    ]);
    const r = await app.createCaller(admin()).mapa.list();
    expect(r.map(p => p.key)).toEqual(["imovel-4", "imovel-9", "obra-21"]);
    expect(r[0]).toMatchObject({ obraId: 18, price: "200000.00", address: "Morada do Bosque, Imperatriz Maranhão", hasCoordinates: true });
    expect(r[1]).toMatchObject({ obraId: null, price: "350000.00", address: "Rua B, 5, Centro, Imperatriz, MA", hasCoordinates: false });
    expect(r[2]).toMatchObject({ kind: "obra", obraId: 21, title: "Obra — JOAO", price: "250000.00", latitude: "-5.4966667", longitude: "-47.4447222", status: "obra", hasCoordinates: true });
  });

  it("imóvel vinculado sem ponto usa a PCI; obra com imóvel vendido entra pela PCI", async () => {
    fakeDb([
      [{ id: 5, title: "Obra — ANA", status: "reservado", type: "casa", address: null, city: "Imperatriz", neighborhood: null, state: "MA", price: "0.00", latitude: null, longitude: null, slug: "obra-27" }],
      [
        { id: 27, title: "ANA", address: "Residencial Aurora, Imperatriz Maranhão", city: null, state: null, vgv: "180000.00", imovelId: 5, leadId: null, simulationValue: null },
        { id: 28, title: "LUCIA", address: "Residencial Aurora", city: "Imperatriz", state: "MA", vgv: "190000.00", imovelId: 77, leadId: null, simulationValue: null },
      ],
      [
        { projectId: 27, parsed: { identificacao: { latitude: "52948 S", longitude: "472641 W" } } },
        { projectId: 28, parsed: { identificacao: { latitude: `5°30'29.0" S`, longitude: "47°26'39.8 W" } } },
      ],
    ]);
    const r = await app.createCaller(admin()).mapa.list();
    expect(r.map(p => p.key)).toEqual(["imovel-5", "obra-28"]);
    expect(r[0]).toMatchObject({ obraId: 27, price: "180000.00", latitude: "-5.4966667", longitude: "-47.4447222", hasCoordinates: true });
    expect(r[1]).toMatchObject({ kind: "obra", obraId: 28, address: "Residencial Aurora, Imperatriz, MA", latitude: "-5.5080556", hasCoordinates: true });
  });
});
