// Maquete 3D (EPIC-023, S-D): leitor geométrico do PDF — sem IA, sem rede. Lê as plantas de teste (PDF vetorial
// no estilo de CAD) e confere com o gabarito que as desenhou.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { areaPoligono, type Edificacao } from "../shared/maquete-3d/modelo.js";
import { escalasDaPagina, funcaoDoNome, lerPagina, linhasDeTexto, metrosPorPonto, nomeDoPavimento, type Primitivas, type Segmento } from "./maquete-3d/geometrico.js";
import { abrirPdf } from "./maquete-3d/pdf-vetorial.js";

const fixture = (nome: string) => readFileSync(new URL(`./fixtures/maquete-3d/${nome}`, import.meta.url));
const gabarito = (nome: string) => JSON.parse(fixture(`${nome}.json`).toString("utf8")) as Edificacao;
async function ler(nome: string, pagina: number) {
  const pdf = await abrirPdf(fixture(`${nome}.pdf`));
  try { return { paginas: pdf.paginas, ...lerPagina(await pdf.pagina(pagina)) }; } finally { await pdf.fechar(); }
}
const tipos = (as: { tipo: string; largura: number }[]) => as.map(a => `${a.tipo}:${a.largura.toFixed(2)}`).sort();

describe("leitor geométrico — plantas vetoriais", () => {
  it("térrea 8 × 12 m: todas as paredes, portas, janelas e vãos; cômodos com nome, função e área; escala achada pelas áreas", async () => {
    const g = gabarito("terrea").pavimentos[0], { plantas, diagnostico } = await ler("terrea", 1);
    expect(diagnostico).toMatchObject({ plantas: 1, imagens: 0, escalas: [], motivo: null });
    const p = plantas[0];
    expect(p.titulo).toBe("PLANTA BAIXA - TÉRREO");
    // A página não traz a escala: 1:50 sai das áreas escritas nos cômodos, e isso fica dito para a pessoa conferir.
    expect(p).toMatchObject({ escala: 50, escalaOrigem: "areas", largura: 8, comprimento: 12 });
    expect(p.pendencias.join(" ")).toContain("Escala não encontrada");
    expect(p.paredes).toHaveLength(g.paredes.length);
    expect(p.paredes.filter(w => w.externa)).toHaveLength(4);
    expect(tipos(p.aberturas)).toEqual(tipos(g.aberturas));
    expect(p.comodos.map(c => [c.nome, c.funcao]).sort()).toEqual(g.comodos.map(c => [c.nome, c.funcao]).sort());
    // Contorno de cada cômodo fecha no eixo das paredes: área a menos de 3% da do gabarito.
    for (const c of p.comodos) {
      const real = areaPoligono(g.comodos.find(x => x.nome === c.nome)!.poligono);
      expect(Math.abs(areaPoligono(c.pontos) - real) / real, c.nome).toBeLessThan(0.03);
      expect(c.areaInformada).toBeGreaterThan(0);
    }
    // Entrada principal: uma só, porta em parede externa.
    const entradas = p.aberturas.filter(a => a.entradaPrincipal);
    expect(entradas).toHaveLength(1);
    expect(entradas[0]).toMatchObject({ tipo: "porta", largura: 0.9 });
    expect(p.paredes.find(w => w.id === entradas[0].paredeId)!.externa).toBe(true);
    // Posição de cada abertura confere com o gabarito (a menos de 10 cm).
    for (const a of g.aberturas) {
      const w = g.paredes.find(x => x.id === a.paredeId)!, comp = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
      const alvo = { x: w.a.x + ((w.b.x - w.a.x) * a.posicao) / comp, y: w.a.y + ((w.b.y - w.a.y) * a.posicao) / comp };
      const perto = p.aberturas.some(l => {
        const v = p.paredes.find(x => x.id === l.paredeId)!, c = Math.hypot(v.bx - v.ax, v.by - v.ay);
        return l.tipo === a.tipo && Math.hypot(v.ax + ((v.bx - v.ax) * l.posicao) / c - alvo.x, v.ay + ((v.by - v.ay) * l.posicao) / c - alvo.y) < 0.1;
      });
      expect(perto, `${a.tipo} ${a.id}`).toBe(true);
    }
  });

  it("sobrado 10 × 14 m em 1:75, duas páginas: escala lida do texto, um pavimento por página e escada pelos degraus", async () => {
    const g = gabarito("sobrado"), terreo = await ler("sobrado", 1), superior = await ler("sobrado", 2);
    expect(terreo.paginas).toBe(2);
    expect(terreo.diagnostico.escalas).toEqual([75]);
    const t = terreo.plantas[0], s = superior.plantas[0];
    expect(t).toMatchObject({ titulo: "PLANTA BAIXA - TÉRREO", escala: 75, escalaOrigem: "texto", largura: 10, comprimento: 14 });
    expect(s).toMatchObject({ titulo: "PLANTA BAIXA - PAVIMENTO SUPERIOR", escala: 75, largura: 10, comprimento: 14 });
    expect(t.paredes).toHaveLength(g.pavimentos[0].paredes.length);
    expect(s.paredes).toHaveLength(g.pavimentos[1].paredes.length);
    expect(t.escadas).toHaveLength(1);
    expect(t.escadas[0].degraus).toBeGreaterThanOrEqual(8);
    expect(t.comodos.map(c => c.funcao)).toEqual(expect.arrayContaining(["lavabo", "area_servico", "escritorio", "garagem", "sala", "cozinha"]));
    expect(s.comodos.map(c => c.funcao)).toEqual(expect.arrayContaining(["quarto", "banheiro", "suite"]));
    // As áreas escritas confirmam a escala lida (razão entre a área desenhada e a escrita perto de 1).
    expect(t.razaoAreas).toBeGreaterThan(0.93);
    expect(t.razaoAreas).toBeLessThan(1.07);
  });

  it("rápido o bastante para um passo da leitura (bem abaixo do limite de 52 s)", async () => {
    const t0 = Date.now();
    await ler("sobrado", 1);
    expect(Date.now() - t0).toBeLessThan(8000);
  });
});

describe("leitor geométrico — o que não dá para ler é dito, não inventado", () => {
  const vazio: Primitivas = { largura: 842, altura: 595, segmentos: [], arcos: [], textos: [], imagens: 0 };
  it("prancha escaneada (imagem): avisa que precisa do PDF vetorial", () => {
    const { plantas, diagnostico } = lerPagina({ ...vazio, imagens: 1 });
    expect(plantas).toEqual([]);
    expect(diagnostico.motivo).toContain("escaneado");
  });
  it("página só com texto ou carimbo: nenhuma planta, com motivo", () => {
    expect(lerPagina(vazio).diagnostico.motivo).toContain("não tem desenho vetorial");
  });
  it("corte ou fachada (linhas sem ambientes fechados com nome) não vira pavimento", () => {
    // Um retângulo em linha dupla, sem texto de cômodo dentro: tem "paredes", mas não é planta baixa.
    const k = 1 / metrosPorPonto(50), seg = (x1: number, y1: number, x2: number, y2: number): Segmento => ({ x1: x1 * k, y1: y1 * k, x2: x2 * k, y2: y2 * k });
    const caixa = (x0: number, y0: number, x1: number, y1: number) => [seg(x0, y0, x1, y0), seg(x1, y0, x1, y1), seg(x1, y1, x0, y1), seg(x0, y1, x0, y0)];
    const segmentos = [...caixa(2, 2, 10, 5), ...caixa(2.15, 2.15, 9.85, 4.85), ...Array.from({ length: 40 }, (_, i) => seg(12 + i * 0.01, 1, 12 + i * 0.01, 1.1))];
    const { plantas, diagnostico } = lerPagina({ ...vazio, segmentos, textos: [{ str: "CORTE AA", x: 6 * k, y: 6 * k, tam: 10, largura: 50 }, { str: "ESC. 1:50", x: 6 * k, y: 6.4 * k, tam: 8, largura: 40 }] });
    expect(plantas).toEqual([]);
    expect(diagnostico.motivo).toContain("Nenhuma planta baixa");
  });
});

describe("leitor geométrico — textos", () => {
  it("junta os pedaços da mesma linha e acha a escala em várias grafias", () => {
    const t = (str: string, x: number, y: number, largura: number) => ({ str, x, y, tam: 10, largura });
    const linhas = linhasDeTexto([t("ESC.", 100, 500, 22), t("1:50", 126, 500, 20), t("PLANTA BAIXA", 100, 480, 70), t("ESCALA 1/100", 400, 300, 60), t("1 : 75", 600, 300, 30), t("12,50 m²", 200, 200, 40)]);
    expect(linhas.map(l => l.str)).toEqual(expect.arrayContaining(["ESC. 1:50", "PLANTA BAIXA", "ESCALA 1/100"]));
    expect(escalasDaPagina(linhas).map(e => e.n).sort((a, b) => a - b)).toEqual([50, 75, 100]);
    expect(escalasDaPagina(linhasDeTexto([t("2 QUARTOS 1:1", 0, 0, 80), t("12,50", 0, 50, 30)]))).toEqual([]);
  });
  it("função do cômodo pelo nome, com as abreviações de prancha", () => {
    expect(["SUÍTE MASTER", "Quarto 02", "BWC", "W.C.", "Banho social", "Sala de Estar/Jantar", "COZINHA", "Á. SERVIÇO", "Área de serviço", "GARAGEM", "Varanda gourmet", "CIRC.", "Hall", "Lavabo", "Depósito", "Closet", "Home office"].map(funcaoDoNome))
      .toEqual(["suite", "quarto", "banheiro", "banheiro", "banheiro", "sala_jantar", "cozinha", "area_servico", "area_servico", "garagem", "varanda", "circulacao", "hall", "lavabo", "deposito", "closet", "escritorio"]);
    expect(funcaoDoNome("PROJETO ARQUITETÔNICO")).toBeNull();
  });
  it("nome do pavimento pelo título da planta", () => {
    expect(nomeDoPavimento("PLANTA BAIXA - TÉRREO", 0)).toEqual({ nome: "Térreo", andar: 0 });
    expect(nomeDoPavimento("PLANTA BAIXA PAVIMENTO SUPERIOR", 1)).toEqual({ nome: "Pavimento superior", andar: 1 });
    expect(nomeDoPavimento("PLANTA DO 3º PAVIMENTO", 2)).toEqual({ nome: "3º pavimento", andar: 2 });
    expect(nomeDoPavimento("PLANTA SUBSOLO", 0).andar).toBe(-1);
    expect(nomeDoPavimento("", 0).nome).toBe("Térreo");
    expect(nomeDoPavimento("", 1).nome).toBe("Pavimento 2");
  });
});
