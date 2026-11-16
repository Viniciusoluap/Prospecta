// S-I (EPIC-023): contorno da APP gravado no estudo — router com banco em memória (PGlite). Trocar o KML apaga o
// contorno (era do terreno anterior); o saveApp segue a regra de contornoAoSalvarApp.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// as funções do estudo em db.ts usam a conexão interna do módulo: aqui são refeitas sobre o banco em memória
vi.mock("./db.js", async orig => {
  const real = await orig<typeof import("./db.js")>();
  const { eq } = await import("drizzle-orm");
  const { incorporationStudies } = await import("../drizzle/schema.js");
  const getDb = vi.fn();
  return {
    ...real, getDb,
    getIncorporationStudyById: async (id: number) => (await getDb().select().from(incorporationStudies).where(eq(incorporationStudies.id, id)).limit(1))[0],
    updateIncorporationStudy: async (id: number, data: Record<string, unknown>) => { await getDb().update(incorporationStudies).set(data).where(eq(incorporationStudies.id, id)); },
  };
});
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste", anthropicApiKey: "" } }));

import * as schema from "../drizzle/schema.js";
import { getDb } from "./db.js";
import { appRouter } from "./routers.js";

const TABELAS = ["users", "leads", "incorporationStudies"];
let ddl: string | null = null;
let pg: PGlite;

const KML = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>
  -47.500,-5.520,0 -47.499,-5.520,0 -47.499,-5.519,0 -47.500,-5.519,0 -47.500,-5.520,0
</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;
const CONTORNO = { type: "MultiPolygon" as const, coordinates: [[[[-47.5, -5.52], [-47.4995, -5.52], [-47.4995, -5.519], [-47.5, -5.519], [-47.5, -5.52]]]] };

const inc = () => appRouter.createCaller({ user: { id: 1, role: "admin", permissions: "[]", active: true, name: "x" }, req: {}, res: {} } as never).incorporacao;
const linha = async () => (await pg.query<{ app_area_m2: string | null; app_geometry_json: string | null }>("SELECT app_area_m2, app_geometry_json FROM incorporation_studies WHERE id = 1")).rows[0];

beforeEach(async () => {
  if (!ddl) {
    const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)("drizzle-kit/api");
    const escolhidas: Record<string, unknown> = {};
    for (const [nome, valor] of Object.entries(schema)) if (TABELAS.includes(nome) || nome.endsWith("Enum")) escolhidas[nome] = valor;
    ddl = (await generateMigration(generateDrizzleJson({}), generateDrizzleJson(escolhidas)) as string[]).join(";\n");
  }
  pg = new PGlite();
  await pg.exec(ddl);
  await pg.exec(readFileSync(new URL("../drizzle/0117_contorno_app_estudo.sql", import.meta.url), "utf8"));
  await pg.exec(`INSERT INTO incorporation_studies (name, city) VALUES ('Gleba', 'Imperatriz')`);
  vi.mocked(getDb).mockReturnValue(drizzle(pg) as never);
});
afterEach(async () => { await pg.close(); });

describe("S-I — contorno da APP no router", () => {
  it("saveApp grava o contorno; cliente antigo sem o campo mantém; área mudando > 2% sem contorno apaga; null apaga", async () => {
    await inc().saveApp({ id: 1, areaM2: 5000, larguraM: 30, origem: "auto", contorno: CONTORNO });
    expect(JSON.parse((await linha()).app_geometry_json!)).toEqual(CONTORNO);
    await inc().saveApp({ id: 1, areaM2: 5050, larguraM: 30, origem: "auto" });
    expect((await linha()).app_geometry_json).not.toBeNull();
    await inc().saveApp({ id: 1, areaM2: 6000, larguraM: 30, origem: "auto" });
    expect((await linha()).app_geometry_json).toBeNull();
    await inc().saveApp({ id: 1, areaM2: 6000, larguraM: 30, origem: "auto", contorno: CONTORNO });
    await inc().saveApp({ id: 1, areaM2: 6000, larguraM: 30, origem: "auto", contorno: null });
    expect((await linha()).app_geometry_json).toBeNull();
  });

  it("saveApp recusa contorno com coordenada fora de longitude/latitude", async () => {
    await expect(inc().saveApp({ id: 1, areaM2: 5000, larguraM: 30, origem: "auto", contorno: { type: "MultiPolygon", coordinates: [[[[500, 1], [1, 1], [1, 2], [500, 1]]]] } })).rejects.toThrow();
  });

  it("trocar o KML apaga o contorno da APP (era do terreno anterior) e mantém a área até o mapa recalcular", async () => {
    await inc().saveApp({ id: 1, areaM2: 5000, larguraM: 30, origem: "auto", contorno: CONTORNO });
    await inc().uploadKml({ id: 1, kmlContent: KML });
    const l = await linha();
    expect(l.app_geometry_json).toBeNull();
    expect(Number(l.app_area_m2)).toBe(5000);
  });
});
