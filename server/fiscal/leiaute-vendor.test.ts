// EPIC-029 S-7 — correção do deploy (23/11/2026): o validador XSD vem da cópia em shared/fiscal/xsd/vendor/xmllint-wasm/,
// nunca de node_modules (link do pnpm → "invalid deployment package … symlinked directories" na Vercel).
// Prova: (1) a cópia bate com o SHA-256 do README e do código; (2) carrega e valida uma DPS válida e recusa uma inválida;
// (3) cópia adulterada ou ausente → falha FECHADA; (4) vercel.json não inclui node_modules e a pasta incluída não tem link;
// (5) o módulo compilado roda num diretório SEM node_modules (como a função da Vercel empacota shared/fiscal/xsd/**).
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { montarDps } from "./dps.js";
import {
  ARQUIVOS_DO_VALIDADOR, carregarValidador, conferirArquivosDoValidador, ErroLeiaute, FRASE_VALIDADOR_INDISPONIVEL,
  pastaDoValidador, SHA256_DO_VALIDADOR, SUBPASTA_DO_VALIDADOR, validarLeiaute,
} from "./leiaute.js";

const RAIZ = fileURLToPath(new URL("../../", import.meta.url));
const XSD = join(RAIZ, "shared/fiscal/xsd");
const VENDOR = join(XSD, SUBPASTA_DO_VALIDADOR);
const ENTRADA = {
  ambiente: "producao_restrita", emitidoEm: new Date("2026-11-22T13:00:00.000Z"), competencia: "2026-11-20", serie: "1", numero: 42,
  prestador: { cnpj: "11222333000181", inscricaoMunicipal: null, municipioIbge: "2105302" },
  tomador: { documento: "123.456.789-09", nome: "Fulano de Tal" },
  servico: { municipioIncidenciaIbge: "2105302", codigoTributacaoNacional: "171901", codigoNbs: null, descricao: "Assessoria", cno: null },
  valorCentavos: 150_000, regimeTributario: "lucro_presumido", aliquotaIss: "5",
  parametros: { opSimpNac: "1", regApTribSN: null, regEspTrib: "0", tribIssqn: "1", tpRetIssqn: "1", indTotTrib: "0", ibscbs: { indFinal: null, cIndOp: null, indDest: "0", cst: "000", cClassTrib: "000001" } },
} as Parameters<typeof montarDps>[0];
const temp = () => mkdtempSync(join(tmpdir(), "leiaute-vendor-"));

describe("validador XSD — cópia dentro do repositório (sem node_modules)", () => {
  it("a cópia é a escolhida, tem os arquivos e bate com o SHA-256 do código e do README", () => {
    expect(pastaDoValidador()).toBe(VENDOR);
    for (const f of ARQUIVOS_DO_VALIDADOR) expect(lstatSync(join(VENDOR, f)).isFile()).toBe(true);
    expect(lstatSync(join(VENDOR, "LICENSE")).isFile()).toBe(true);
    expect(readFileSync(join(VENDOR, "LICENSE"), "utf8")).toMatch(/MIT/);
    expect(JSON.parse(readFileSync(join(VENDOR, "package.json"), "utf8"))).toEqual({ type: "commonjs" });
    const readme = readFileSync(join(VENDOR, "README.md"), "utf8");
    expect(readme).toContain("5.3.0");
    for (const [f, sha] of Object.entries(SHA256_DO_VALIDADOR)) { expect(readme).toContain(`| \`${f}\` |`); expect(readme).toContain(sha); }
    expect(conferirArquivosDoValidador()).toBe(VENDOR);
    expect(typeof carregarValidador()).toBe("function");
  });

  it("carrega da cópia e valida: DPS válida passa, inválida é recusada", async () => {
    const { xml } = montarDps(ENTRADA);
    expect(await validarLeiaute(xml, "dps", "producao_restrita")).toEqual({ valido: true, erros: [] });
    const r = await validarLeiaute(xml.replace("<CPF>12345678909</CPF>", "<CPF>1234567890X</CPF>"), "dps", "producao_restrita");
    expect(r.valido).toBe(false);
    expect(r.erros.join(" ")).toContain("campo CPF");
  });

  it("cópia ausente, incompleta ou adulterada → falha FECHADA (ErroLeiaute, nada validado)", async () => {
    const dir = temp();
    try {
      await expect(validarLeiaute("<a/>", "dps", "producao_restrita", { pastaValidador: dir })).rejects.toThrow(FRASE_VALIDADOR_INDISPONIVEL);
      for (const f of ARQUIVOS_DO_VALIDADOR) copyFileSync(join(VENDOR, f), join(dir, f));
      writeFileSync(join(dir, "xmllint.wasm"), Buffer.concat([readFileSync(join(VENDOR, "xmllint.wasm")), Buffer.from([0])]));
      expect(() => conferirArquivosDoValidador(dir)).toThrow(ErroLeiaute);
      await expect(validarLeiaute(montarDps(ENTRADA).xml, "dps", "producao_restrita", { pastaValidador: dir })).rejects.toThrow(ErroLeiaute);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("vercel.json não inclui node_modules (link do pnpm) e a pasta incluída não tem link simbólico", () => {
    const vercel = JSON.parse(readFileSync(join(RAIZ, "vercel.json"), "utf8")) as { functions: Record<string, { includeFiles?: string }> };
    for (const f of Object.values(vercel.functions)) expect(f.includeFiles ?? "").not.toMatch(/node_modules/);
    expect(vercel.functions["api/index.ts"]!.includeFiles).toContain("shared/fiscal/xsd/**");
    const semLink = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        expect(e.isSymbolicLink(), join(dir, e.name)).toBe(false);
        if (e.isDirectory()) semLink(join(dir, e.name));
      }
    };
    semLink(XSD);
    expect(readFileSync(join(RAIZ, "server/fiscal/leiaute.ts"), "utf8")).not.toMatch(/from\s+["']xmllint-wasm["']|import\(\s*["']xmllint-wasm["']\s*\)|require\(\s*["']xmllint-wasm["']\s*\)/);
  });

  it("o módulo compilado roda num diretório SEM node_modules/xmllint-wasm (pastas relativas ao arquivo e ao cwd)", async () => {
    const dir = temp();
    try {
      cpSync(XSD, join(dir, "shared/fiscal/xsd"), { recursive: true });
      await build({ entryPoints: [join(RAIZ, "server/fiscal/leiaute.ts")], outfile: join(dir, "server/fiscal/leiaute.mjs"), format: "esm", platform: "node", bundle: true, logLevel: "silent" });
      expect(readFileSync(join(dir, "server/fiscal/leiaute.mjs"), "utf8")).not.toContain("node_modules");
      const { xml } = montarDps(ENTRADA);
      writeFileSync(join(dir, "valida.xml"), xml);
      writeFileSync(join(dir, "invalida.xml"), xml.replace(/<cLocEmi>\d+<\/cLocEmi>/, ""));
      const script = `import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const m = await import(process.argv[1]);
let pacote = "ausente"; try { createRequire(process.argv[1]).resolve("xmllint-wasm"); pacote = "presente"; } catch {}
const ok = await m.validarLeiaute(readFileSync("valida.xml", "utf8"), "dps", "producao_restrita");
const ruim = await m.validarLeiaute(readFileSync("invalida.xml", "utf8"), "dps", "producao_restrita");
console.log(JSON.stringify({ pacote, pasta: m.pastaDoValidador(), ok: ok.valido, ruim: ruim.valido }));`;
      const rodar = (cwd: string) => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script, join(dir, "server/fiscal/leiaute.mjs")], { cwd, env: { PATH: process.env.PATH ?? "" }, encoding: "utf8" })) as { pacote: string; pasta: string; ok: boolean; ruim: boolean };
      const r = rodar(dir);
      expect(r).toEqual({ pacote: "ausente", pasta: join(dir, "shared/fiscal/xsd", SUBPASTA_DO_VALIDADOR), ok: true, ruim: false });
      // servidor empacotado noutra pasta (ex.: dist/): a relativa ao arquivo não existe, vale a do cwd
      await build({ entryPoints: [join(RAIZ, "server/fiscal/leiaute.ts")], outfile: join(dir, "dist/x/y/leiaute.mjs"), format: "esm", platform: "node", bundle: true, logLevel: "silent" });
      const r2 = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script, join(dir, "dist/x/y/leiaute.mjs")], { cwd: dir, env: { PATH: process.env.PATH ?? "" }, encoding: "utf8" })) as typeof r;
      expect(r2).toEqual(r);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);
});
