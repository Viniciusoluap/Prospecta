// EPIC-028 (Etapa 2) — capturas da prévia do gerador (Playwright/Chromium com WebGL por SwiftShader), em computador
// (1440 × 900, escala 2) e celular (390 × 844, escala 2): visão geral em corte, com telhado, cada cômodo e a planta 2D.
// Uso: node scripts/maquete/screenshots.mjs [pasta] [--so=geral,sala] [--tela=desktop|celular]
// Padrão de scripts/layout-check/check.mjs: Playwright global (sem dependência nova). PNG acima de 600 KB é
// reduzido a 256 cores (Python + Pillow, se houver).
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const aqui = path.dirname(new URL(import.meta.url).pathname);
const raiz = path.resolve(aqui, "..", "..");
const args = process.argv.slice(2);
const opcao = n => args.find(a => a.startsWith(`--${n}=`))?.split("=")[1];
const saida = path.resolve(args.find(a => !a.startsWith("--")) ?? path.join(raiz, "docs/stories/epics/epic-028-maquete-editor/screenshots/etapa-2"));
mkdirSync(saida, { recursive: true });

if (!args.includes("--sem-build")) execFileSync("npx", ["vite", "build", "--config", path.join(aqui, "harness", "vite.config.ts")], { cwd: raiz, stdio: "inherit" });

const require = createRequire(import.meta.url);
let playwright;
for (const c of ["playwright", "/opt/node22/lib/node_modules/playwright"]) {
  try { playwright = require(c); break; } catch { /* tenta o próximo */ }
}
if (!playwright) throw new Error("Playwright não encontrado.");

const dist = path.join(aqui, "harness", "dist");
const tipos = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const servidor = createServer((req, res) => {
  const p = path.join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/$/, "/index.html"));
  if (!p.startsWith(dist) || !existsSync(p)) { res.statusCode = 404; return res.end(); }
  res.setHeader("content-type", tipos[path.extname(p)] ?? "application/octet-stream");
  res.end(readFileSync(p));
}).listen(0);
const porta = servidor.address().port;

const MODOS = ["geral", "telhado", "sala", "cozinha", "quarto-1", "quarto-2", "banheiro", "area-de-servico", "garagem-e-frente", "planta"];
const so = opcao("so")?.split(",");
const TELAS = [
  { nome: "desktop", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
  { nome: "celular", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
].filter(t => !opcao("tela") || t.nome === opcao("tela"));

function comprimir(arquivo) {
  if (statSync(arquivo).size <= 600 * 1024) return;
  try {
    execFileSync("python3", ["-I", "-c", [
      "import sys", "from PIL import Image",
      "im = Image.open(sys.argv[1]).convert('RGB')",
      "im.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(sys.argv[1], optimize=True)",
    ].join("\n"), arquivo]);
  } catch (e) { console.warn(`não foi possível comprimir ${arquivo}: ${e.message}`); }
}

const browser = await playwright.chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const relatorio = [];
for (const t of TELAS) {
  const ctx = await browser.newContext({ ...t, locale: "pt-BR", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const erros = [];
  page.on("pageerror", e => erros.push(String(e)));
  page.on("console", m => { if (m.type() === "error") erros.push(m.text()); });
  for (const modo of MODOS.filter(m => !so || so.includes(m))) {
    const url = `http://localhost:${porta}/?planta=lote4-qd18#${modo}`;
    await page.goto("about:blank");
    await page.goto(url);
    const inicio = Date.now();
    await page.waitForSelector(`[data-teste=figura][data-modo="${modo}"][data-pronto="1"]`, { timeout: 240_000 });
    await page.waitForTimeout(modo === "planta" ? 300 : 800);
    const arquivo = path.join(saida, `${t.nome}-${modo}.png`);
    await page.screenshot({ path: arquivo, fullPage: modo === "planta", timeout: 300_000 });
    comprimir(arquivo);
    relatorio.push(`${t.nome}-${modo}.png ${Math.round(statSync(arquivo).size / 1024)} KB (${((Date.now() - inicio) / 1000).toFixed(1)} s)`);
    console.log(relatorio.at(-1));
  }
  if (erros.length) console.log(`[${t.nome}] erros no console:\n  ${Array.from(new Set(erros)).join("\n  ")}`);
  await ctx.close();
}
await browser.close();
servidor.close();
console.log(`\n${relatorio.length} capturas em ${saida}`);
