// Correção 11 (lote 3): validação visual automática (Playwright/Chromium) dos
// componentes compartilhados em 390x844 (iPhone), 820x1180 (iPad) e 1440x900.
// Uso: node scripts/layout-check/check.mjs [pasta-de-capturas]
// Limitação: Chromium não reproduz o motor do Safari; a regra específica de
// iOS para datas (index.css, @supports -webkit-touch-callout) não é exercitada.
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";

const aqui = path.dirname(new URL(import.meta.url).pathname);
const raiz = path.resolve(aqui, "..", "..");
const saida = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "layout-check-prospecta"));
mkdirSync(saida, { recursive: true });

execFileSync("npx", ["vite", "build", "--config", path.join(aqui, "vite.config.ts")], { cwd: raiz, stdio: "inherit" });

const require = createRequire(import.meta.url);
let playwright;
for (const c of ["playwright", "/opt/node22/lib/node_modules/playwright"]) {
  try { playwright = require(c); break; } catch { /* tenta o próximo */ }
}
if (!playwright) throw new Error("Playwright não encontrado.");

const dist = path.join(aqui, "dist");
const tipos = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const servidor = createServer((req, res) => {
  const p = path.join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/$/, "/index.html"));
  if (!p.startsWith(dist) || !existsSync(p)) { res.statusCode = 404; return res.end(); }
  res.setHeader("content-type", tipos[path.extname(p)] ?? "application/octet-stream");
  res.end(readFileSync(p));
}).listen(0);
const porta = servidor.address().port;

const VIEWPORTS = [[390, 844], [820, 1180], [1440, 900]];
const CASOS = ["editar", "tributario", "filtros"];
const falhas = [];
const browser = await playwright.chromium.launch();
for (const [w, h] of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, locale: "pt-BR", deviceScaleFactor: 1, isMobile: w < 1024, hasTouch: w < 1024 });
  for (const caso of CASOS) {
    await page.goto(`http://localhost:${porta}/?caso=${caso}`);
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const erros = [];
      const vw = window.innerWidth, vh = window.innerHeight;
      if (document.documentElement.scrollWidth > vw + 1) erros.push(`página com rolagem horizontal (${document.documentElement.scrollWidth} > ${vw})`);
      const painel = document.querySelector("[data-slot=dialog-content]");
      const cont = painel ?? document.querySelector("[data-teste=filtros]");
      const cr = cont.getBoundingClientRect();
      if (cr.left < -0.5 || cr.right > vw + 0.5) erros.push(`contêiner fora da tela (${Math.round(cr.left)}..${Math.round(cr.right)} de ${vw})`);
      if (painel && cr.height > vh + 0.5) erros.push(`modal mais alto que a tela (${Math.round(cr.height)} > ${vh})`);
      if (painel && getComputedStyle(painel).overflowY !== "auto") erros.push("modal sem rolagem interna");
      for (const el of cont.querySelectorAll("input:not([type=hidden]), select, textarea, button, [data-slot=select-trigger]")) {
        const b = el.getBoundingClientRect();
        if (b.width === 0) continue;
        if (b.left < cr.left - 0.5 || b.right > cr.right + 0.5) erros.push(`${el.tagName.toLowerCase()}[${el.type ?? ""}] sai do contêiner (${Math.round(b.left)}..${Math.round(b.right)} vs ${Math.round(cr.left)}..${Math.round(cr.right)})`);
      }
      const tabela = document.querySelector("[data-teste=rolagem-tabela]");
      if (tabela && tabela.getBoundingClientRect().right > vw + 0.5) erros.push("tabela empurra a página (sem rolagem própria)");
      const dinheiro = [...document.querySelectorAll("input[inputmode=decimal]")].map(i => i.value);
      return { erros, dinheiro };
    });
    if (caso === "editar") {
      if (!r.dinheiro.includes("1.234.567,89")) r.erros.push(`valor monetário fora do padrão: ${r.dinheiro.join(" | ")}`);
      await page.click("[data-slot=select-trigger]");
      await page.waitForTimeout(250);
      const menu = await page.evaluate(() => {
        const m = document.querySelector("[data-slot=select-content]");
        if (!m) return "menu não abriu";
        const b = m.getBoundingClientRect();
        return b.left < 0 || b.right > window.innerWidth || b.bottom > window.innerHeight || b.top < 0 ? `menu fora da tela (${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)})` : null;
      });
      if (menu) r.erros.push(menu);
    }
    if (caso === "tributario" && !r.dinheiro.includes("98.765,43")) r.erros.push(`valor do tributo fora do padrão: ${r.dinheiro.join(" | ")}`);
    if (caso === "tributario" && !r.dinheiro.includes("6,00")) r.erros.push(`percentual fora do padrão: ${r.dinheiro.join(" | ")}`);
    await page.screenshot({ path: path.join(saida, `${caso}-${w}x${h}.png`), fullPage: true });
    const status = r.erros.length ? "FALHA" : "OK";
    console.log(`${status} ${caso} ${w}x${h}${r.erros.length ? " — " + r.erros.join("; ") : ""}`);
    if (r.erros.length) falhas.push(`${caso} ${w}x${h}`);
  }
  await page.close();
}
await browser.close();
servidor.close();
console.log(`Capturas em ${saida}`);
if (falhas.length) { console.error(`Falhas: ${falhas.join(", ")}`); process.exit(1); }
