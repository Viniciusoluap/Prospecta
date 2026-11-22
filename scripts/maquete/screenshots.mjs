// EPIC-028 (Etapas 2 e 3) — capturas da prévia do gerador (Playwright/Chromium com WebGL por SwiftShader), em computador
// (1440 × 900, escala 2) e celular (390 × 844, escala 2): visão geral em corte, com telhado, cada cômodo e a planta 2D.
// Uso: node scripts/maquete/screenshots.mjs [pasta] [--so=geral,sala] [--tela=desktop|celular]
// Etapa 3: `--editor` captura o MODO EDIÇÃO (item selecionado com contorno, painel de campos, aviso vermelho de porta
// bloqueada, catálogo) e confere o fluxo: arrastar a geladeira para a frente da P3 bloqueia "Salvar"; desfazer e mover
// para um lugar válido libera; salvar → rascunho não publicado; publicar → publicado.
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
const EDITOR = args.includes("--editor");
const saida = path.resolve(args.find(a => !a.startsWith("--")) ?? path.join(raiz, `docs/stories/epics/epic-028-maquete-editor/screenshots/${EDITOR ? "etapa-3" : "etapa-2"}`));
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
      "import os",
      "orig = Image.open(sys.argv[1]).convert('RGB')",
      "esc = 1.0",
      "while True:",
      "    im = orig if esc == 1.0 else orig.resize((round(orig.width * esc), round(orig.height * esc)), Image.LANCZOS)",
      "    im.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(sys.argv[1], optimize=True)",
      "    if os.path.getsize(sys.argv[1]) <= 600 * 1024 or esc < 0.5: break",
      "    esc -= 0.1",
    ].join("\n"), arquivo]);
  } catch (e) { console.warn(`não foi possível comprimir ${arquivo}: ${e.message}`); }
}

const browser = await playwright.chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const relatorio = [];
const checagens = [];
const conferir = (nome, ok) => { checagens.push(`${ok ? "OK " : "FALHOU"} ${nome}`); console.log(checagens.at(-1)); };

/** Ponto da tela (px) de uma coordenada da planta (m), pela matriz do SVG da planta do editor. */
const naTela = (page, x, z) => page.evaluate(([x, z]) => {
  const svg = document.querySelector("[data-teste=editor-planta] svg");
  const p = new DOMPoint(x, z).matrixTransform(svg.getScreenCTM());
  return { x: p.x, y: p.y };
}, [x, z]);

async function arrastar(page, de, para) {
  await page.locator("[data-teste=editor-planta]").scrollIntoViewIfNeeded();
  const a = await naTela(page, ...de), b = await naTela(page, ...para);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let k = 1; k <= 12; k++) await page.mouse.move(a.x + ((b.x - a.x) * k) / 12, a.y + ((b.y - a.y) * k) / 12);
  await page.mouse.up();
  await page.waitForTimeout(300);
}

async function capturar(page, nome, opcoes = {}) {
  const arquivo = path.join(saida, `${nome}.png`);
  if (opcoes.elemento) await page.locator(opcoes.elemento).screenshot({ path: arquivo, timeout: 300_000 });
  else {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await page.screenshot({ path: arquivo, fullPage: !!opcoes.inteira, timeout: 300_000 });
  }
  comprimir(arquivo);
  relatorio.push(`${nome}.png ${Math.round(statSync(arquivo).size / 1024)} KB`);
  console.log(relatorio.at(-1));
}

async function editor(t, page) {
  const celular = t.nome === "celular";
  const pronto3d = () => page.waitForSelector("[data-teste=editor][data-pronto=\"1\"]", { timeout: 240_000 });
  const verPlanta = async () => { if (celular) await page.getByRole("tab", { name: "Planta 2D" }).click(); };
  const ver3d = async () => { if (celular) { await page.getByRole("tab", { name: "3D" }).click(); await page.waitForTimeout(900); } };
  await page.goto("about:blank");
  await page.goto(`http://localhost:${porta}/?planta=lote4-qd18&admin=1#geral`);
  await page.waitForSelector("[data-teste=editar]");
  conferir(`[${t.nome}] botão Editar aparece para o admin`, await page.locator("[data-teste=editar]").isVisible());
  await page.click("[data-teste=editar]");
  await pronto3d();
  await page.waitForTimeout(800);

  // 1) Item selecionado (geladeira): contorno no 3D e na planta, painel de campos.
  await verPlanta();
  await page.locator("[data-teste=editor-planta] [data-item=geladeira] polygon").click();
  conferir(`[${t.nome}] painel abre com a geladeira`, (await page.locator("[data-teste=painel-item] h3").innerText()).includes("Geladeira"));
  await ver3d();
  await page.waitForTimeout(600);
  await capturar(page, `${t.nome}-editor-selecionado`);
  await capturar(page, `${t.nome}-editor-painel`, { elemento: "[data-teste=painel-item]" });
  if (!celular) {
    // Computador: a planta ampliada no lugar do 3D (e de volta).
    await page.click("[data-teste=ampliar-planta]");
    await page.waitForTimeout(400);
    await capturar(page, `${t.nome}-editor-planta-ampliada`);
    await page.click("[data-teste=ampliar-planta]");
    await page.waitForTimeout(900);
  }

  // 2) Arrastar a geladeira para a frente da P3: aviso vermelho, Salvar bloqueado.
  await verPlanta();
  await arrastar(page, [1.79, 3.3], [0.54, 1.36]);
  const erros = Number(await page.locator("[data-teste=editor]").getAttribute("data-erros"));
  const xz = await page.evaluate(() => [...document.querySelectorAll("[data-teste=painel-item] input[inputmode=decimal]")].slice(0, 2).map(i => i.value).join(" × "));
  console.log(`[${t.nome}] geladeira solta em X × Z = ${xz} (pedido 0,54 × 1,36)`);
  conferir(`[${t.nome}] geladeira na frente da P3 gera erro (${erros})`, erros > 0);
  conferir(`[${t.nome}] aviso cita a P3`, (await page.locator("[data-teste=avisos]").innerText()).includes("P3"));
  conferir(`[${t.nome}] Salvar bloqueado`, await page.locator("[data-teste=salvar]").isDisabled());
  await ver3d();
  await page.waitForTimeout(600);
  await capturar(page, `${t.nome}-editor-porta-bloqueada`, { inteira: celular });
  if (celular) { await verPlanta(); await capturar(page, `${t.nome}-editor-porta-bloqueada-planta`, { elemento: "[data-teste=editor-planta]" }); }

  // 3) Desfazer (Ctrl+Z) volta ao lugar; mover pelo campo X para um lugar válido libera o Salvar.
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(150);
  conferir(`[${t.nome}] Ctrl+Z desfaz (sem erros)`, Number(await page.locator("[data-teste=editor]").getAttribute("data-erros")) === 0);
  await page.keyboard.press("Control+Shift+z");
  await page.waitForTimeout(150);
  conferir(`[${t.nome}] Ctrl+Shift+Z refaz (erro de volta)`, Number(await page.locator("[data-teste=editor]").getAttribute("data-erros")) > 0);
  await page.keyboard.press("Control+z");
  const campoZ = page.getByLabel("Z (m)");
  await campoZ.fill("3,2");
  await campoZ.blur();
  await page.waitForTimeout(150);
  conferir(`[${t.nome}] campo Z move a geladeira e libera o Salvar`, !(await page.locator("[data-teste=salvar]").isDisabled()));
  await page.click("[data-teste=salvar]");
  await page.waitForFunction(() => document.querySelector("[data-teste=estado-edicao]")?.textContent?.includes("Rascunho não publicado"));
  conferir(`[${t.nome}] salvar → rascunho não publicado`, true);
  await page.click("[data-teste=publicar]");
  await page.waitForFunction(() => document.querySelector("[data-teste=estado-edicao]")?.textContent?.startsWith("Publicado"));
  conferir(`[${t.nome}] publicar → publicado`, true);

  // 4) Catálogo (e um item novo: fogão no centro da cozinha).
  await capturar(page, `${t.nome}-editor-catalogo`, { elemento: "[data-teste=catalogo]" });
  if (!celular) await capturar(page, `${t.nome}-editor-pagina`, { inteira: true });
}

for (const t of TELAS) {
  const ctx = await browser.newContext({ ...t, locale: "pt-BR", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const erros = [];
  page.on("pageerror", e => erros.push(String(e)));
  page.on("console", m => { if (m.type() === "error") erros.push(m.text()); });
  if (EDITOR) {
    await editor(t, page);
    if (erros.length) console.log(`[${t.nome}] erros no console:\n  ${Array.from(new Set(erros)).join("\n  ")}`);
    await ctx.close();
    continue;
  }
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
if (checagens.length) { console.log(checagens.join("\n")); if (checagens.some(c => c.startsWith("FALHOU"))) process.exitCode = 1; }
