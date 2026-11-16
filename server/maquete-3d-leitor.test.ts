// Maquete 3D (EPIC-023, S-D): leitor geométrico do PDF — sem IA, sem rede. Lê as plantas de teste (PDF vetorial
// no estilo de CAD) e confere com o gabarito que as desenhou.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { areaPoligono, type Edificacao } from "../shared/maquete-3d/modelo.js";
import { arcosDePolilinhas, escalasDaPagina, funcaoDoNome, lerPagina, linhasDeTexto, metrosPorPonto, nomeDoPavimento, tipoDaVista, type Primitivas, type Segmento } from "./maquete-3d/geometrico.js";
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

// Traços de uma prancha real de escritório (Revit, 1:50), reproduzidos em memória: títulos com a escala embaixo,
// corte e planta de layout na mesma folha, ambientes abertos entre si, folha de porta exportada como polilinha.
describe("leitor geométrico — traços de prancha real (Revit)", () => {
  const k = 1 / metrosPorPonto(50);
  const seg = (x1: number, y1: number, x2: number, y2: number): Segmento => ({ x1: x1 * k, y1: y1 * k, x2: x2 * k, y2: y2 * k });
  /** Parede em linha dupla (só horizontal ou vertical), do eixo (x1,y1) ao eixo (x2,y2). */
  const parede = (x1: number, y1: number, x2: number, y2: number, e = 0.15): Segmento[] => {
    const h = e / 2;
    return y1 === y2 ? [seg(Math.min(x1, x2) - h, y1 - h, Math.max(x1, x2) + h, y1 - h), seg(Math.min(x1, x2) - h, y1 + h, Math.max(x1, x2) + h, y1 + h)]
      : [seg(x1 - h, Math.min(y1, y2) - h, x1 - h, Math.max(y1, y2) + h), seg(x1 + h, Math.min(y1, y2) - h, x1 + h, Math.max(y1, y2) + h)];
  };
  /** Folha de porta como o Revit exporta: quarto de círculo em 10 trechos retos, da folha fechada à aberta. */
  const arcoPolilinha = (cx: number, cy: number, r: number, a0: number, a1: number): Segmento[] =>
    Array.from({ length: 10 }, (_, i) => { const p = a0 + ((a1 - a0) * i) / 10, q = a0 + ((a1 - a0) * (i + 1)) / 10; return seg(cx + r * Math.cos(p), cy + r * Math.sin(p), cx + r * Math.cos(q), cy + r * Math.sin(q)); });
  const texto = (str: string, x: number, y: number, tam = 8) => ({ str, x: x * k, y: y * k, tam, largura: str.length * tam * 0.55 });
  /** Casa 6 × 8 m: sala e cozinha abertas entre si (toco de parede deixando 2,5 m livres), porta de entrada com folha em polilinha. */
  const casa = (ox: number, oy: number, titulo: string) => {
    const segmentos = [
      ...parede(ox, oy, ox + 2, oy), ...parede(ox + 2.9, oy, ox + 6, oy), // frente, com a porta de 90 cm
      ...parede(ox, oy + 8, ox + 6, oy + 8), ...parede(ox, oy, ox, oy + 8), ...parede(ox + 6, oy, ox + 6, oy + 8),
      ...parede(ox, oy + 4, ox + 3.5, oy + 4), // toco entre sala e cozinha
      ...arcoPolilinha(ox + 2.075, oy, 0.8, 0, Math.PI / 2),
    ];
    const textos = [
      texto("SALA", ox + 3, oy + 2), texto("A= 22,50 m²", ox + 3, oy + 2.3),
      texto("COZINHA", ox + 3, oy + 6), texto("A= 22,50 m²", ox + 3, oy + 6.3),
      texto(titulo, ox + 3, oy + 9, 12), texto("1 : 50", ox + 3, oy + 9.4, 10),
    ];
    return { segmentos, textos };
  };
  // Tiques de cota longe dos desenhos (uma prancha de verdade sempre tem mais que as paredes).
  const cotas = Array.from({ length: 40 }, (_, i) => seg(38 + i * 0.01, 25, 38 + i * 0.01, 25.1));
  const pagina = (...desenhos: { segmentos: Segmento[]; textos: Primitivas["textos"] }[]): Primitivas => ({
    largura: 2384, altura: 1684, arcos: [], imagens: 0, segmentos: [...desenhos.flatMap(d => d.segmentos), ...cotas], textos: desenhos.flatMap(d => d.textos),
  });

  it("folha de porta desenhada como polilinha volta a ser arco (dobradiça e raio)", () => {
    const [a] = arcosDePolilinhas(arcoPolilinha(1, 1, 0.8, 0, Math.PI / 2));
    expect(a.cx / k).toBeCloseTo(1, 2);
    expect(a.cy / k).toBeCloseTo(1, 2);
    expect(a.r / k).toBeCloseTo(0.8, 2);
    expect(a.pontas).toHaveLength(2);
    // Um círculo inteiro (louça, mesa) não é folha de porta.
    expect(arcosDePolilinhas(arcoPolilinha(1, 1, 0.3, 0, Math.PI * 2))).toEqual([]);
  });

  it("tipo do desenho pelo título: corte, fachada, cobertura e implantação não são planta", () => {
    expect(["PLANTA BAIXA", "PLANTA LAYOUT", "CORTE A", "FRONTAL", "FACHADA FRONTAL", "PLANTA COBERTURA", "PAVIMENTO COBERTURA", "PLANTA DE IMPLANTAÇÃO", "PLANTA URBANISMO", "TABELA DE ÁREA ÚTIL", "ESCALA:"].map(tipoDaVista))
      .toEqual(["planta", "layout", "outra", "outra", "outra", "outra", "planta", "outra", "outra", "outra", null]);
  });

  it("na mesma prancha, só a planta baixa vira planta: a de layout repetida e o corte ficam de fora", () => {
    const { plantas } = lerPagina(pagina(casa(2, 2, "PLANTA BAIXA"), casa(12, 2, "PLANTA LAYOUT"), casa(22, 2, "CORTE A")));
    expect(plantas).toHaveLength(1);
    expect(plantas[0]).toMatchObject({ titulo: "PLANTA BAIXA", vista: "planta", escala: 50, escalaOrigem: "texto" });
  });

  it("ambientes abertos entre si com nome e área escritos são separados pelo prolongamento do toco de parede", () => {
    const p = lerPagina(pagina(casa(2, 2, "PLANTA BAIXA"))).plantas[0];
    expect(p.comodos.map(c => c.funcao).sort()).toEqual(["cozinha", "sala"]);
    for (const c of p.comodos) expect(Math.abs(areaPoligono(c.pontos) / 22.5 - 1), c.nome).toBeLessThan(0.1);
    expect(p.pendencias.join(" ")).not.toContain("num ambiente só");
  });

  it("porta com folha em polilinha é lida como porta e vira a entrada principal", () => {
    const { plantas, diagnostico } = lerPagina(pagina(casa(2, 2, "PLANTA BAIXA")));
    expect(diagnostico.arcos).toBeGreaterThanOrEqual(1);
    const portas = plantas[0].aberturas.filter(a => a.tipo === "porta");
    expect(portas).toHaveLength(1);
    expect(portas[0].largura).toBeGreaterThan(0.6);
    expect(portas[0].largura).toBeLessThan(1);
    expect(portas[0].entradaPrincipal).toBe(true);
  });

  it("prancha só com corte não vira pavimento, e o motivo diz o que ela traz", () => {
    const { plantas, diagnostico } = lerPagina(pagina(casa(2, 2, "CORTE A")));
    expect(plantas).toEqual([]);
    expect(diagnostico.motivo).toContain("Nenhuma planta baixa");
    expect(diagnostico.motivo).toContain("CORTE A");
  });

  it("desenho sem título de planta precisa de pelo menos dois cômodos com nome", () => {
    const sem = (d: ReturnType<typeof casa>, fica: (s: string) => boolean) => ({ segmentos: d.segmentos, textos: d.textos.filter(t => fica(t.str)) });
    expect(lerPagina(pagina(sem(casa(2, 2, ""), s => !/^1 : 50$|^$/.test(s)))).plantas).toHaveLength(1);
    expect(lerPagina(pagina(sem(casa(2, 2, ""), s => /SALA|22,50/.test(s)))).plantas).toEqual([]);
  });

  it("ambiente com nome que as paredes não fecham vira pendência, não some", () => {
    const d = casa(2, 2, "PLANTA BAIXA");
    const p = lerPagina(pagina({ segmentos: d.segmentos, textos: [...d.textos, texto("LAVABO", 2.5, 2.5)] })).plantas[0];
    expect(p.pendencias.join(" ")).toContain("LAVABO");
  });

  it("prancha de urbanismo (escalas de implantação, quadro de lotes) sai na hora, com o motivo", () => {
    const segmentos = Array.from({ length: 3000 }, (_, i) => seg((i % 60) * 0.7, Math.floor(i / 60) * 0.5, (i % 60) * 0.7 + 0.6, Math.floor(i / 60) * 0.5));
    const textos = [texto("PLANTA DE URBANISMO", 20, 30, 12), texto("1 : 750", 20, 30.5, 10), texto("Tabela de Áreas - LOTES", 40, 2), texto("125,00 m²", 5, 5)];
    const { plantas, diagnostico } = lerPagina({ largura: 2384, altura: 1684, arcos: [], imagens: 0, segmentos, textos });
    expect(plantas).toEqual([]);
    expect(diagnostico.motivo).toContain("urbanismo");
    expect(diagnostico.tempoMs).toBeLessThan(500);
  });
});
