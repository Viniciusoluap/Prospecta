// EPIC-024 S-08 — terreno em KML ou KMZ, enviado em partes (limite de corpo da Vercel).
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as db from "./db.js";
import { appRouter } from "./routers.js";
import { parseKmlTerreno } from "./_core/geo/kml";
import { LIMITE_KML_DESCOMPACTADO, lerArquivoTerreno } from "./_core/geo/kmz";
import { avisoDoKmz } from "./incorporacao-terreno-arquivo";

const anel = (o: number, l: number, s: number, n: number) => `${o},${s},0 ${l},${s},0 ${l},${n},0 ${o},${n},0 ${o},${s},0`;
// dois lotes que se sobrepõem + um com furo: a área não pode contar a sobreposição duas vezes
const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Gleba São João</name>
<Placemark><name>A</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${anel(-47.5, -47.499, -5.52, -5.519)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>B</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${anel(-47.4995, -47.4985, -5.52, -5.519)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>C</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${anel(-47.49, -47.488, -5.52, -5.518)}</coordinates></LinearRing></outerBoundaryIs>
<innerBoundaryIs><LinearRing><coordinates>${anel(-47.4895, -47.4885, -5.5195, -5.5185)}</coordinates></LinearRing></innerBoundaryIs></Polygon></Placemark>
</Document></kml>`;

const kmz = (arquivos: Record<string, Uint8Array>) => zipSync(arquivos, { level: 6 });

describe("lerArquivoTerreno", () => {
  it("KML e KMZ equivalentes dão a mesma geometria, área e perímetro", () => {
    const doKml = parseKmlTerreno(lerArquivoTerreno(strToU8(KML), "gleba.kml").kml);
    const lido = lerArquivoTerreno(kmz({ "doc.kml": strToU8(KML), "files/foto.png": new Uint8Array([137, 80, 78, 71]) }), "gleba.kmz");
    expect(lido.formato).toBe("kmz");
    expect(lido.kmlInterno).toBe("doc.kml");
    const doKmz = parseKmlTerreno(lido.kml);
    expect(doKmz).toEqual(doKml);
    expect(doKmz.feature.geometry.type).toBe("MultiPolygon");
    // A ∪ B = 1,5 × A (sobreposição contada uma vez); C tem furo de 1/4
    const a = parseKmlTerreno(`<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>${anel(-47.5, -47.499, -5.52, -5.519)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></kml>`).areaM2;
    expect(Math.abs(doKmz.areaM2 - (1.5 * a + 3 * a)) / doKmz.areaM2).toBeLessThan(0.01);
  });

  it("KMZ sem compressão (stored) também é lido", () => {
    const lido = lerArquivoTerreno(zipSync({ "doc.kml": strToU8(KML) }, { level: 0 }), "a.kmz");
    expect(parseKmlTerreno(lido.kml)).toEqual(parseKmlTerreno(KML));
  });

  it("com vários KML usa o doc.kml e avisa; ignora __MACOSX e ._", () => {
    const outro = KML.replace("-47.5,", "-47.6,");
    const lido = lerArquivoTerreno(kmz({
      "__MACOSX/._doc.kml": strToU8("lixo"), "a-primeiro.kml": strToU8(outro), "doc.kml": strToU8(KML),
    }), "t.kmz");
    expect(lido.kmlInterno).toBe("doc.kml");
    expect(lido.kmlsNoKmz).toBe(2);
    expect(avisoDoKmz(lido)).toContain("doc.kml");
    const semDoc = lerArquivoTerreno(kmz({ "__MACOSX/x.kml": strToU8("lixo"), "pasta/terreno.kml": strToU8(KML), "z.kml": strToU8(outro) }), "t.kmz");
    expect(semDoc.kmlInterno).toBe("pasta/terreno.kml");
    expect(lerArquivoTerreno(kmz({ "../fora.kml": strToU8(KML), "ok.kml": strToU8(outro) }), "t.kmz").kmlInterno).toBe("ok.kml");
  });

  it("KMZ sem KML é recusado com mensagem clara", () => {
    expect(() => lerArquivoTerreno(kmz({ "files/foto.jpg": new Uint8Array([255, 216, 255]), "__MACOSX/doc.kml": strToU8(KML) }), "t.kmz"))
      .toThrow(/KMZ sem arquivo KML/);
  });

  it("bomba de compressão é recusada, mesmo mentindo o tamanho declarado", () => {
    const enorme = new Uint8Array(LIMITE_KML_DESCOMPACTADO + 1024 * 1024).fill(32);
    const bomba = kmz({ "doc.kml": enorme });
    expect(bomba.length).toBeLessThan(200 * 1024);
    expect(() => lerArquivoTerreno(bomba, "b.kmz")).toThrow(/passa de 20 MB/);
    // altera o tamanho declarado no diretório central para 1 KB: o limite continua valendo
    const mentiroso = bomba.slice();
    for (let i = mentiroso.length - 22; i >= 0; i--) {
      if (mentiroso[i] === 0x50 && mentiroso[i + 1] === 0x4b && mentiroso[i + 2] === 1 && mentiroso[i + 3] === 2) {
        new DataView(mentiroso.buffer).setUint32(i + 24, 1024, true);
        break;
      }
    }
    expect(() => lerArquivoTerreno(mentiroso, "b.kmz")).toThrow(/passa de 20 MB/);
  });

  it("recusa KMZ com arquivos internos demais, .kmz que não é ZIP e ZIP corrompido", () => {
    const muitos: Record<string, Uint8Array> = {};
    for (let i = 0; i < 1001; i++) muitos[`f${i}.txt`] = new Uint8Array([1]);
    expect(() => lerArquivoTerreno(kmz(muitos), "m.kmz")).toThrow(/arquivos internos/);
    expect(() => lerArquivoTerreno(strToU8(KML), "x.kmz")).toThrow(/não é um KMZ válido/);
    expect(() => lerArquivoTerreno(kmz({ "doc.kml": strToU8(KML) }).subarray(0, 60), "c.kmz")).toThrow(/KMZ inválido/);
  });
});

describe("incorporacao.uploadKml em partes", () => {
  const TERRENO_SALVO = { id: 1, geojson: '{"salvo":true}', areaM2: "123" };
  const admin = () => appRouter.createCaller({ user: { id: 7, role: "admin", active: true }, req: {}, res: {} } as never);
  let pg: PGlite;
  beforeAll(() => { pg = new PGlite(); });
  afterEach(() => vi.restoreAllMocks());

  function preparar() {
    vi.spyOn(db, "getDb").mockReturnValue(drizzle(pg) as never);
    vi.spyOn(db, "getIncorporationStudyById").mockResolvedValue(TERRENO_SALVO as never);
    return vi.spyOn(db, "updateIncorporationStudy").mockResolvedValue(undefined as never);
  }
  async function enviar(bytes: Uint8Array, fileName: string, uploadId: string) {
    const c = admin();
    const PARTE = 1024 * 1024, total = Math.ceil(bytes.length / PARTE);
    for (let part = 0; part < total; part++) {
      const base64 = Buffer.from(bytes.subarray(part * PARTE, (part + 1) * PARTE)).toString("base64");
      await c.documentChunks.part({ uploadId, part, total, scope: "incorporacao-terreno:1", fileName, base64 });
    }
    return c.incorporacao.uploadKml({ id: 1, uploadId, fileName });
  }

  it("KMZ enviado em partes grava o mesmo terreno que o KML", async () => {
    const gravar = preparar();
    const r1 = await enviar(strToU8(KML), "g.kml", "envio-kml-000000000001");
    const r2 = await enviar(kmz({ "doc.kml": strToU8(KML) }), "g.kmz", "envio-kmz-000000000001");
    expect(r2.areaM2).toBe(r1.areaM2);
    expect(r2.geojson).toBe(r1.geojson);
    expect(gravar).toHaveBeenCalledTimes(2);
    expect(gravar.mock.calls[0][1]).toEqual(gravar.mock.calls[1][1]);
  });

  it("arquivo acima de 4,5 MB passa pelas partes", async () => {
    const gravar = preparar();
    const recheio = `<!-- ${"x".repeat(5 * 1024 * 1024)} -->`;
    const grande = strToU8(KML.replace("<Document>", `<Document>${recheio}`));
    expect(grande.length).toBeGreaterThan(5 * 1024 * 1024);
    const r = await enviar(grande, "grande.kml", "envio-grande-0000000001");
    expect(r.areaM2).toBeGreaterThan(0);
    expect(gravar).toHaveBeenCalledTimes(1);
  });

  it("falha (KMZ sem KML, bomba, KML sem polígono) não apaga o terreno salvo", async () => {
    const gravar = preparar();
    await expect(enviar(kmz({ "foto.jpg": new Uint8Array([255, 216]) }), "s.kmz", "envio-falha-00000000001")).rejects.toThrow(/KMZ sem arquivo KML/);
    await expect(enviar(kmz({ "doc.kml": new Uint8Array(LIMITE_KML_DESCOMPACTADO + 10).fill(32) }), "b.kmz", "envio-falha-00000000002")).rejects.toThrow(/20 MB/);
    await expect(enviar(strToU8("<kml></kml>"), "v.kml", "envio-falha-00000000003")).rejects.toThrow(/Nenhum polígono/);
    expect(gravar).not.toHaveBeenCalled();
  });

  it("sem permissão do módulo é recusado", async () => {
    preparar();
    const c = appRouter.createCaller({ user: { id: 8, role: "colaborador", active: true, permissions: JSON.stringify(["obras"]) }, req: {}, res: {} } as never);
    await expect(c.incorporacao.uploadKml({ id: 1, kmlContent: KML })).rejects.toThrow();
  });
});
