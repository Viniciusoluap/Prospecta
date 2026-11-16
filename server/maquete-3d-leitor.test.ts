// Maquete 3D (EPIC-023, S-D): leitor geométrico do PDF — sem IA, sem rede. Lê as plantas de teste (PDF vetorial
// no estilo de CAD) e confere com o gabarito que as desenhou.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { areaPoligono, type Edificacao } from "../shared/maquete-3d/modelo.js";
import { arcosDePolilinhas, escalasDaPagina, funcaoDoNome, lerPagina, linhasDeTexto, metrosPorPonto, nomeDoPavimento, tipoDaVista, type Primitivas, type Segmento } from "./maquete-3d/geometrico.js";
import { abrirPdf } from "./maquete-3d/pdf-vetorial.js";
import { parciaisDasPranchas } from "./maquete-3d/leitura.js";

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
    expect(nomeDoPavimento("PLANTA DO 3º PAVIMENTO", 2)).toMatchObject({ nome: "3º pavimento", andar: 2 });
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

// Casos da revisão de QA (iteração 1): títulos comuns, marcadores de corte ao lado da planta, andares, recorte da
// construção, tempo limite e as regras novas de paredes, janelas e divisões.
describe("leitor geométrico — revisão de QA", () => {
  const prancha = (escala = 50) => {
    const k = 1 / metrosPorPonto(escala);
    const seg = (x1: number, y1: number, x2: number, y2: number): Segmento => ({ x1: x1 * k, y1: y1 * k, x2: x2 * k, y2: y2 * k });
    const parede = (x1: number, y1: number, x2: number, y2: number, e = 0.15): Segmento[] => {
      const h = e / 2;
      return y1 === y2 ? [seg(Math.min(x1, x2) - h, y1 - h, Math.max(x1, x2) + h, y1 - h), seg(Math.min(x1, x2) - h, y1 + h, Math.max(x1, x2) + h, y1 + h)]
        : [seg(x1 - h, Math.min(y1, y2) - h, x1 - h, Math.max(y1, y2) + h), seg(x1 + h, Math.min(y1, y2) - h, x1 + h, Math.max(y1, y2) + h)];
    };
    const arco = (cx: number, cy: number, r: number, a0: number, a1: number): Segmento[] =>
      Array.from({ length: 10 }, (_, i) => { const p = a0 + ((a1 - a0) * i) / 10, q = a0 + ((a1 - a0) * (i + 1)) / 10; return seg(cx + r * Math.cos(p), cy + r * Math.sin(p), cx + r * Math.cos(q), cy + r * Math.sin(q)); });
    const texto = (str: string, x: number, y: number, tam = 8) => ({ str, x: x * k, y: y * k, tam, largura: str.length * tam * 0.55 });
    type Desenho = { segmentos: Segmento[]; textos: Primitivas["textos"] };
    /** Casa 6 × 8 m (sala e cozinha abertas, porta de entrada com folha em polilinha). `titulo` com a escala embaixo, salvo `semEscala`. */
    const casa = (ox: number, oy: number, titulo: string, o: { nomes?: [string, string]; semEscala?: boolean; arco?: boolean } = {}): Desenho => {
      const [n1, n2] = o.nomes ?? ["SALA", "COZINHA"];
      return {
        segmentos: [...parede(ox, oy, ox + 2, oy), ...parede(ox + 2.9, oy, ox + 6, oy), ...parede(ox, oy + 8, ox + 6, oy + 8), ...parede(ox, oy, ox, oy + 8), ...parede(ox + 6, oy, ox + 6, oy + 8),
          ...parede(ox, oy + 4, ox + 3.5, oy + 4), ...(o.arco === false ? [] : arco(ox + 2.075, oy, 0.8, 0, Math.PI / 2))],
        textos: [texto(n1, ox + 3, oy + 2), texto("A= 22,50 m²", ox + 3, oy + 2.3), texto(n2, ox + 3, oy + 6), texto("A= 22,50 m²", ox + 3, oy + 6.3),
          ...(titulo ? [texto(titulo, ox + 3, oy + 9, 12), ...(o.semEscala ? [] : [texto(`1 : ${escala}`, ox + 3, oy + 9.4, 10)])] : [])],
      };
    };
    const cotas = Array.from({ length: 40 }, (_, i) => seg(38 + i * 0.01, 25, 38 + i * 0.01, 25.1));
    const pagina = (...ds: Desenho[]): Primitivas => ({ largura: 2384, altura: 1684, arcos: [], imagens: 0, segmentos: [...ds.flatMap(d => d.segmentos), ...cotas], textos: ds.flatMap(d => d.textos) });
    return { seg, parede, arco, texto, casa, pagina };
  };
  const P = prancha();

  it("título que diz planta baixa vale como planta, diga o que mais disser; os outros desenhos pelo começo do título", () => {
    for (const t of ["PLANTA BAIXA - LOTE 12", "PLANTA BAIXA - CASA 01 - QUADRA 3", "IMPLANTAÇÃO E PLANTA BAIXA", "PLANTA BAIXA (INDICAÇÃO DOS CORTES)", "PLANTA BAIXA E LOCAÇÃO",
      "PLANTA BAIXA - CASA FRONTAL", "PLANTA BAIXA - UNIDADE FRONTAL", "PLANTA BAIXA - VISTA SUPERIOR", "PLANTA BAIXA ESQUEMÁTICA", "PLANTA BAIXA - SITUAÇÃO EXISTENTE",
      "PLANTA BAIXA - QUADRA POLIESPORTIVA", "PLANTA DO PAVIMENTO TIPO", "PLANTA BAIXA - COBERTURA", "PLANTA DE COBERTURA DUPLEX", "PLANTA ÁTICO"]) expect(tipoDaVista(t), t).toBe("planta");
    for (const t of ["CORTE AA", "FACHADA FRONTAL", "ELEVAÇÃO NORTE", "VISTA 1", "PLANTA DE COBERTURA", "PLANTA DE SITUAÇÃO", "IMPLANTAÇÃO", "PLANTA URBANISMO", "FRONTAL", "LATERAL ESQUERDA", "TABELA DE ÁREAS"]) expect(tipoDaVista(t), t).toBe("outra");
    for (const t of ["PLANTA BAIXA HUMANIZADA", "PLANTA DECORADA", "PLANTA MOBILIADA - SUPERIOR", "PLANTA BAIXA TÉRREO - LAYOUT"]) expect(tipoDaVista(t), t).toBe("layout");
  });

  it("planta com título comum ('PLANTA BAIXA - LOTE 12') é lida", () => {
    expect(lerPagina(P.pagina(P.casa(2, 2, "PLANTA BAIXA - LOTE 12"))).plantas).toHaveLength(1);
  });

  it("título sem escala embaixo (escala no carimbo): marcador de corte ou de vista ao lado não toma o lugar do título", () => {
    for (const marcador of [["CORTE AA", 9, 6], ["FACHADA FRONTAL", 5, 10.4], ["VISTA 1", 0.8, 5]] as const) {
      const d = P.casa(2, 2, "PLANTA BAIXA", { semEscala: true });
      d.textos.push(P.texto(marcador[0], marcador[1], marcador[2]), P.texto("ESCALA: 1/50", 35, 28));
      const { plantas } = lerPagina(P.pagina(d));
      expect(plantas, marcador[0]).toHaveLength(1);
      expect(plantas[0].titulo).toBe("PLANTA BAIXA");
    }
  });

  it("rótulo fraco de outro desenho (sem escala embaixo) perde para a evidência: dois cômodos com nome fazem a planta", () => {
    const d = P.casa(2, 2, "");
    d.textos.push(P.texto("CORTE AA", 5, 10.5, 12));
    expect(lerPagina(P.pagina(d)).plantas).toHaveLength(1);
  });

  it("um título serve a um desenho só", () => {
    const a = P.casa(2, 2, "PLANTA BAIXA"), b = P.casa(10, 2, "", { nomes: ["QUARTO", "SUITE"] });
    const { plantas } = lerPagina(P.pagina(a, b));
    expect(plantas.map(p => p.titulo).sort()).toEqual(["", "PLANTA BAIXA"]);
  });

  it("vários andares na mesma prancha; a planta de layout de OUTRO andar fica", () => {
    expect(lerPagina(P.pagina(P.casa(2, 2, "PLANTA BAIXA - TÉRREO"), P.casa(14, 2, "PLANTA BAIXA - SUPERIOR", { nomes: ["QUARTO", "SUITE"] }))).plantas.map(p => p.titulo))
      .toEqual(["PLANTA BAIXA - TÉRREO", "PLANTA BAIXA - SUPERIOR"]);
    const { plantas } = lerPagina(P.pagina(P.casa(2, 2, "PLANTA BAIXA - TÉRREO"), P.casa(14, 2, "PLANTA LAYOUT - PAVIMENTO SUPERIOR", { nomes: ["QUARTO", "SUITE"] })));
    expect(plantas.map(p => p.vista)).toEqual(["planta", "layout"]);
  });

  it("planta em 1:200 com a escala escrita é lida em 1:200", () => {
    const X = prancha(200);
    expect(lerPagina(X.pagina(X.casa(2, 2, "PLANTA BAIXA"))).plantas[0]).toMatchObject({ escala: 200, escalaOrigem: "texto" });
  });

  it("porta sem arco nem ombreira desenhados vira vão: os cômodos não vazam para fora", () => {
    const p = lerPagina(P.pagina(P.casa(2, 2, "PLANTA BAIXA", { arco: false }))).plantas[0];
    expect(p.comodos.map(c => c.funcao).sort()).toEqual(["cozinha", "sala"]);
    expect(p.aberturas.map(a => a.tipo)).toEqual(["vao"]);
  });

  it("junta de piso em grade e hachura de 20 cm dentro do cômodo não mudam a espessura das paredes", () => {
    const d = P.casa(2, 2, "PLANTA BAIXA");
    for (let y = 2.3; y < 5.8; y += 0.2) d.segmentos.push(P.seg(2.2, y, 7.8, y));
    for (let y = 6.2; y < 9.8; y += 0.3) for (let x = 2.2; x < 7.8; x += 0.3) d.segmentos.push(P.seg(x, y, x + 0.3, y), P.seg(x, y, x, y + 0.3));
    const p = lerPagina(P.pagina(d)).plantas[0];
    expect(p.paredes.every(w => Math.abs(w.espessura - 0.15) < 0.03)).toBe(true);
    expect(p.comodos.map(c => c.funcao).sort()).toEqual(["cozinha", "sala"]);
  });

  it("ambiente aberto para o quintal é fechado pela linha de troca de piso que deixa a área igual à escrita", () => {
    const segmentos = [...P.parede(2, 2, 8, 2), ...P.parede(2, 10, 8, 10), ...P.parede(2, 2, 2, 10), ...P.parede(8, 2, 8, 10), P.seg(2.075, 6, 7.925, 6)];
    const d = { segmentos, textos: [P.texto("COZINHA", 5, 4), P.texto("A= 22,50 m²", 5, 4.3), P.texto("PLANTA BAIXA", 5, 11, 12), P.texto("1 : 50", 5, 11.4, 10)] };
    const coz = lerPagina(P.pagina(d)).plantas[0].comodos.find(c => c.funcao === "cozinha")!;
    expect(Math.abs(areaPoligono(coz.pontos) / 22.5 - 1)).toBeLessThan(0.1);
  });

  it("janela numa parede que parece contínua (peitoril desenhado nas faces) sai pelos marcos", () => {
    const d = P.casa(2, 2, "PLANTA BAIXA");
    // Parede do fundo (y = 10): marcos de 3 cm atravessando a espessura e o vidro no meio.
    for (const x of [4, 4.03, 5.2, 5.23]) d.segmentos.push(P.seg(x, 9.94, x, 10.06), P.seg(x, 9.95, x, 10.05));
    d.segmentos.push(P.seg(4.03, 10, 5.2, 10), P.seg(4.03, 10.02, 5.2, 10.02));
    const janelas = lerPagina(P.pagina(d)).plantas[0].aberturas.filter(a => a.tipo === "janela");
    expect(janelas).toHaveLength(1);
    expect(janelas[0].largura).toBeCloseTo(1.23, 1);
  });

  it("parede desenhada duas vezes (camada de revestimento deslocada) conta uma vez", () => {
    const base = lerPagina(P.pagina(P.casa(2, 2, "PLANTA BAIXA"))).plantas[0].paredes.length;
    const d = P.casa(2, 2, "PLANTA BAIXA");
    d.segmentos.push(...P.parede(2, 10.02, 8, 10.02));
    expect(lerPagina(P.pagina(d)).plantas[0].paredes).toHaveLength(base);
  });

  it("recorte da construção: anexo fechado sem porta sai com aviso; ala com rótulo e garagem com porta ficam", () => {
    const anexo = (comPorta: boolean, rotulo?: string) => {
      const d = P.casa(2, 2, "PLANTA BAIXA");
      d.segmentos.push(...P.parede(8, 2, 11, 2), ...P.parede(8, 10, 11, 10), ...P.parede(11, 2, 11, 10));
      if (comPorta) { // porta de 80 cm na parede comum (x = 8), entre y = 7 e 7,8
        d.segmentos = d.segmentos.filter(s => !(Math.abs(s.x1 - s.x2) < 1e-6 && Math.abs(s.x1 / (1 / metrosPorPonto(50)) - 8) < 0.1));
        d.segmentos.push(...P.parede(8, 2, 8, 7), ...P.parede(8, 7.8, 8, 10), ...P.arco(8, 7.8, 0.8, -Math.PI / 2, -Math.PI));
      }
      if (rotulo) d.textos.push(P.texto(rotulo, 9.5, 6));
      return lerPagina(P.pagina(d)).plantas[0];
    };
    const sem = anexo(false);
    expect(sem.largura).toBeLessThan(6.3);
    expect(sem.pendencias.join(" ")).toContain("sem nome e sem porta");
    expect(anexo(false, "PISCINA COBERTA").largura).toBeGreaterThan(8.5);
    expect(anexo(true).largura).toBeGreaterThan(8.5);
  });

  it("tempo limite: a leitura para no prazo e diz que a prancha é carregada demais", () => {
    const { plantas, diagnostico } = lerPagina(P.pagina(P.casa(2, 2, "PLANTA BAIXA")), { prazoMs: -1 });
    expect(plantas).toEqual([]);
    expect(diagnostico.motivo).toContain("carregada demais");
  });

  it("página pesada (50 mil traços soltos, hachura longa) volta em poucos segundos", () => {
    let s = 11;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const segmentos = Array.from({ length: 50_000 }, () => { const x = rnd() * 2200, y = rnd() * 1600; return { x1: x, y1: y, x2: x + 20, y2: y }; });
    for (let i = 0; i < 50_000; i++) segmentos.push({ x1: 50, y1: 10 + i * 0.016, x2: 1190, y2: 10 + i * 0.016 });
    const t0 = Date.now();
    lerPagina({ largura: 2384, altura: 1684, arcos: [], imagens: 0, segmentos, textos: [{ str: "PLANTA BAIXA", x: 100, y: 100, tam: 12, largura: 80 }, { str: "1 : 50", x: 100, y: 112, tam: 10, largura: 30 }] });
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("andares pelo título, em qualquer grafia, na ordem certa; a mesma planta repetida conta uma vez", () => {
    const pav = (t1: string, t2: string) => {
      const pr = [t1, t2].map((t, i) => ({ doc: 0, pagina: i + 1, ...lerPagina(P.pagina(P.casa(2, 2, t, { nomes: i ? ["QUARTO", "SUITE"] : ["SALA", "COZINHA"] }))) }));
      const inv = parciaisDasPranchas(pr, ["a.pdf"]).parciais.inventario as { edificacoes: { pavimentos: { nome: string }[] }[] };
      return inv.edificacoes[0].pavimentos.map(p => p.nome);
    };
    expect(pav("PLANTA BAIXA - PAVIMENTO 1", "PLANTA BAIXA - PAVIMENTO 2")).toEqual(["1º pavimento", "2º pavimento"]);
    expect(pav("PLANTA BAIXA - SEGUNDO PAVIMENTO", "PLANTA BAIXA - PRIMEIRO PAVIMENTO")).toEqual(["1º pavimento", "2º pavimento"]);
    expect(pav("PLANTA BAIXA - PAV. TÉRREO", "PLANTA BAIXA - PAV. 01")).toEqual(["Térreo", "1º pavimento"]);
    expect(pav("PLANTA BAIXA 01", "PLANTA BAIXA 02")).toEqual(["1º pavimento", "2º pavimento"]);
    expect(pav("PLANTA BAIXA TÉRREO", "PLANTA LAYOUT")).toEqual(["Térreo"]);
    expect(pav("PLANTA BAIXA", "PLANTA LAYOUT - SUPERIOR")).toEqual(["Térreo", "Pavimento superior"]);
  });
});

// Revisão de QA, iteração 2: na dúvida, o leitor guarda menos e diz isso — nunca devolve um prédio errado como certo.
describe("leitor geométrico — revisão de QA (2)", () => {
  const k = 1 / metrosPorPonto(50);
  const seg = (x1: number, y1: number, x2: number, y2: number): Segmento => ({ x1: x1 * k, y1: y1 * k, x2: x2 * k, y2: y2 * k });
  const parede = (x1: number, y1: number, x2: number, y2: number, e = 0.15): Segmento[] => {
    const h = e / 2;
    return y1 === y2 ? [seg(Math.min(x1, x2) - h, y1 - h, Math.max(x1, x2) + h, y1 - h), seg(Math.min(x1, x2) - h, y1 + h, Math.max(x1, x2) + h, y1 + h)]
      : [seg(x1 - h, Math.min(y1, y2) - h, x1 - h, Math.max(y1, y2) + h), seg(x1 + h, Math.min(y1, y2) - h, x1 + h, Math.max(y1, y2) + h)];
  };
  const arco = (cx: number, cy: number, r: number): Segmento[] => Array.from({ length: 10 }, (_, i) => { const p = (Math.PI / 2) * (i / 10), q = (Math.PI / 2) * ((i + 1) / 10); return seg(cx + r * Math.cos(p), cy + r * Math.sin(p), cx + r * Math.cos(q), cy + r * Math.sin(q)); });
  const texto = (str: string, x: number, y: number, tam = 8) => ({ str, x: x * k, y: y * k, tam, largura: str.length * tam * 0.55 });
  type Desenho = { segmentos: Segmento[]; textos: Primitivas["textos"] };
  const casa = (ox: number, oy: number, titulo: string, nomes: [string, string] = ["SALA", "COZINHA"]): Desenho => ({
    segmentos: [...parede(ox, oy, ox + 2, oy), ...parede(ox + 2.9, oy, ox + 6, oy), ...parede(ox, oy + 8, ox + 6, oy + 8), ...parede(ox, oy, ox, oy + 8), ...parede(ox + 6, oy, ox + 6, oy + 8), ...parede(ox, oy + 4, ox + 3.5, oy + 4), ...arco(ox + 2.075, oy, 0.8)],
    textos: [texto(nomes[0], ox + 3, oy + 2), texto("A= 22,50 m²", ox + 3, oy + 2.3), texto(nomes[1], ox + 3, oy + 6), texto("A= 22,50 m²", ox + 3, oy + 6.3), ...(titulo ? [texto(titulo, ox + 3, oy + 9, 12), texto("1 : 50", ox + 3, oy + 9.4, 10)] : [])],
  });
  /** Corte de sobrado: 2 × 2 ambientes entre lajes, com os nomes escritos dentro e sem porta (como se desenha um corte). */
  const corte = (ox: number, oy: number, titulo: string, ancorado: boolean): Desenho => ({
    segmentos: [...parede(ox, oy, ox, oy + 6), ...parede(ox + 7, oy, ox + 7, oy + 6), ...parede(ox + 3.5, oy, ox + 3.5, oy + 6), ...parede(ox, oy, ox + 7, oy), ...parede(ox, oy + 3, ox + 7, oy + 3), ...parede(ox, oy + 6, ox + 7, oy + 6)],
    textos: [texto("QUARTO", ox + 1.7, oy + 1.5), texto("SUÍTE", ox + 5.2, oy + 1.5), texto("SALA", ox + 1.7, oy + 4.5), texto("COZINHA", ox + 5.2, oy + 4.5), texto(titulo, ox + 3.5, oy + 7, 12), ...(ancorado ? [texto("1 : 50", ox + 3.5, oy + 7.4, 10)] : [])],
  });
  const cotas = Array.from({ length: 40 }, (_, i) => seg(38 + i * 0.01, 25, 38 + i * 0.01, 25.1));
  const pagina = (...ds: Desenho[]): Primitivas => ({ largura: 2384, altura: 1684, arcos: [], imagens: 0, segmentos: [...ds.flatMap(d => d.segmentos), ...cotas], textos: ds.flatMap(d => d.textos) });

  it("N1: o começo do título decide — corte, fachada, cobertura e plantas de outras disciplinas não são pavimento", () => {
    for (const t of ["CORTE AA - PLANTA BAIXA REF.", "CORTE TRANSVERSAL - 2º PAVIMENTO", "FACHADA FRONTAL - PAVIMENTO TÉRREO", "ELEVAÇÃO 2º PAVIMENTO", "PLANTA DE COBERTURA - PAVIMENTO SUPERIOR",
      "COBERTURA - 2º PAVIMENTO", "PLANTA DE TELHADO - 1º PAVIMENTO", "DETALHE - PLANTA BAIXA BANHEIRO", "AMPLIAÇÃO - PLANTA BAIXA COZINHA", "PLANTA ESTRUTURAL - 2º PAVIMENTO",
      "PLANTA DE FORMAS - 1º PAVIMENTO", "PLANTA DE PONTOS ELÉTRICOS - PAVIMENTO SUPERIOR", "PLANTA DE FORRO - PAVIMENTO TÉRREO", "PLANTA DE FORRO TÉRREO", "PLANTA BAIXA ELÉTRICA", "PLANTA BAIXA HIDRÁULICA - TÉRREO"]) expect(tipoDaVista(t), t).toBe("outra");
    for (const t of ["PLANTA BAIXA (INDICAÇÃO DOS CORTES)", "PLANTA BAIXA - LOTE 12", "IMPLANTAÇÃO E PLANTA BAIXA", "PLANTA BAIXA TÉRREO E COBERTURA", "PAVIMENTO TIPO", "A - PLANTA BAIXA"]) expect(tipoDaVista(t), t).toBe("planta");
  });

  it("N1: corte com os ambientes escritos dentro não vira pavimento — com título ancorado, com título no carimbo ou sem título", () => {
    for (const [t, ancorado] of [["CORTE TRANSVERSAL - 2º PAVIMENTO", true], ["CORTE AA", false], ["", false]] as const) {
      const { plantas, diagnostico } = lerPagina(pagina(corte(2, 2, t, ancorado)));
      expect(plantas, t).toEqual([]);
      expect(diagnostico.motivo, t).toContain("Nenhuma planta baixa");
    }
    // Prancha AutoCAD com planta e corte, títulos sem escala embaixo: só a planta vira pavimento, e o corte fica avisado.
    const p = casa(2, 2, ""); p.textos.push(texto("PLANTA BAIXA", 5, 11.2, 12));
    const { plantas, diagnostico } = lerPagina(pagina(p, corte(14, 2, "CORTE AA", false), { segmentos: [], textos: [texto("ESCALA: 1/50", 35, 28)] }));
    expect(plantas.map(x => x.titulo)).toEqual(["PLANTA BAIXA"]);
    expect((diagnostico.avisos ?? []).join(" ")).toContain("CORTE AA");
  });

  it("N2: juntas de piso de face a face não apagam a face da parede; shaft de três paredes paralelas fica", () => {
    // Casa 6 × 8 com parede interna em y = 6; piso da sala com juntas horizontais de face a face a cada 30 cm.
    const s = [...parede(2, 2, 8, 2), ...parede(2, 10, 8, 10), ...parede(2, 2, 2, 10), ...parede(8, 2, 8, 10), ...parede(2, 6, 8, 6)];
    for (let y = 2.375; y < 5.92; y += 0.3) s.push(seg(2.075, y, 7.925, y));
    const t = [texto("SALA", 4, 3.5), texto("A= 22,50 m²", 4, 3.8), texto("QUARTO", 4, 8), texto("A= 22,50 m²", 4, 8.3), texto("PLANTA BAIXA", 5, 11, 12), texto("1 : 50", 5, 11.4, 10)];
    expect(lerPagina(pagina({ segmentos: s, textos: t })).plantas[0].comodos.map(c => c.funcao).sort()).toEqual(["quarto", "sala"]);
    const shaft = [...parede(2, 2, 12, 2), ...parede(2, 8, 12, 8), ...parede(2, 2, 2, 8), ...parede(12, 2, 12, 8), ...parede(6, 2, 6, 8), ...parede(6.65, 2, 6.65, 8), ...parede(7.3, 2, 7.3, 8)];
    const p = lerPagina(pagina({ segmentos: shaft, textos: [texto("QUARTO", 3.5, 5), texto("SALA", 10, 5), texto("PLANTA BAIXA", 7, 9, 12), texto("1 : 50", 7, 9.4, 10)] })).plantas[0];
    expect(p.paredes.filter(w => Math.abs(w.ax - w.bx) < 0.01).length).toBe(5);
  });

  it("N3: prancha com várias plantas lê todas (sem corte silencioso de candidatas)", () => {
    const { plantas } = lerPagina(pagina(casa(2, 2, "PLANTA BAIXA - TÉRREO"), casa(12, 2, "PLANTA BAIXA - SUPERIOR", ["QUARTO", "SUITE"]), casa(22, 2, "PLANTA BAIXA - 3º PAVIMENTO", ["QUARTO", "SUITE"]), casa(2, 14, "PLANTA BAIXA - SUBSOLO", ["GARAGEM", "DEPOSITO"])));
    expect(plantas).toHaveLength(4);
    expect(plantas.every(p => p.comodos.length === 2 && p.paredes.every(w => w.confirmada))).toBe(true);
  });

  it("N4: mezanino entre os andares, layout e mesma planta repetida não viram andar a mais — e tudo isso é dito", () => {
    const pav = (...ts: [string, [string, string]][]) => {
      const pr = ts.map(([t, n], i) => ({ doc: 0, pagina: i + 1, ...lerPagina(pagina(casa(2, 2, t, n))) }));
      const { parciais } = parciaisDasPranchas(pr, ["a.pdf"]);
      const nomes = (parciais.inventario as { edificacoes: { pavimentos: { nome: string }[] }[] }).edificacoes[0].pavimentos.map(p => p.nome);
      const pend = Object.entries(parciais).filter(([c]) => c.startsWith("ambientes:")).flatMap(([, v]) => (v as { pendencias: string[] }).pendencias).join(" ");
      return { nomes, pend };
    };
    expect(pav(["PLANTA BAIXA - TÉRREO", ["SALA", "COZINHA"]], ["PLANTA BAIXA - MEZANINO", ["ESCRITORIO", "SALA"]], ["PLANTA BAIXA - PAVIMENTO SUPERIOR", ["QUARTO", "SUITE"]]).nomes).toEqual(["Térreo", "Mezanino", "Pavimento superior"]);
    expect(pav(["PLANTA BAIXA - TÉRREO", ["SALA", "COZINHA"]], ["PLANTA BAIXA - 1º PAVIMENTO", ["QUARTO", "SUITE"]], ["PLANTA BAIXA - PAVIMENTO TIPO", ["QUARTO", "SUITE"]]).nomes).toEqual(["Térreo", "1º pavimento", "Pavimento-tipo"]);
    const repetida = pav(["PLANTA BAIXA", ["SALA", "COZINHA"]], ["PLANTA BAIXA", ["SALA", "COZINHA"]]);
    expect(repetida.nomes).toEqual(["Térreo"]);
    expect(repetida.pend).toContain("mesmos cômodos e áreas");
    expect(pav(["PLANTA BAIXA", ["SALA", "COZINHA"]], ["PLANTA BAIXA - SUBSOLO", ["GARAGEM", "DEPOSITO"]]).nomes).toEqual(["Subsolo", "Térreo"]);
    const doisSemAndar = pav(["PLANTA BAIXA", ["SALA", "COZINHA"]], ["PLANTA BAIXA", ["QUARTO", "SUITE"]]);
    expect(doisSemAndar.nomes).toHaveLength(2);
    expect(doisSemAndar.pend).toContain("não diz o andar");
  });

  it("N5: título de planta com nome de cômodo dentro continua título (e dá o andar)", () => {
    for (const [t, nome] of [["PLANTA BAIXA - PAVIMENTO GARAGEM", "PLANTA BAIXA - PAVIMENTO GARAGEM"], ["PLANTA BAIXA - 2º PAVIMENTO (SUÍTES)", "PLANTA BAIXA - 2º PAVIMENTO (SUÍTES)"], ["PLANTA BAIXA - LOJA 01", "PLANTA BAIXA - LOJA 01"]]) {
      expect(lerPagina(pagina(casa(2, 2, t, ["QUARTO", "SALA"]))).plantas[0]?.titulo, t).toBe(nome);
    }
    expect(nomeDoPavimento("PLANTA BAIXA - 2º PAVIMENTO (SUÍTES)", 0).andar).toBe(1);
  });

  it("N6: ampliação 1:25 na prancha 1:50 não vira pavimento a mais", () => {
    const k25 = 1 / metrosPorPonto(25), s25 = (x1: number, y1: number, x2: number, y2: number): Segmento => ({ x1: x1 * k25, y1: y1 * k25, x2: x2 * k25, y2: y2 * k25 });
    const p25 = (x1: number, y1: number, x2: number, y2: number, e = 0.15) => { const h = e / 2; return y1 === y2 ? [s25(x1 - h, y1 - h, x2 + h, y1 - h), s25(x1 - h, y1 + h, x2 + h, y1 + h)] : [s25(x1 - h, y1 - h, x1 - h, y2 + h), s25(x1 + h, y1 - h, x1 + h, y2 + h)]; };
    const t25 = (str: string, x: number, y: number, tam = 8) => ({ str, x: x * k25, y: y * k25, tam, largura: str.length * tam * 0.55 });
    for (const titulo of ["AMPLIAÇÃO - PLANTA BAIXA BWC", "PLANTA BAIXA - BANHEIRO"]) {
      const det = { segmentos: [...p25(30, 2, 32.4, 2), ...p25(30, 5, 32.4, 5), ...p25(30, 2, 30, 5), ...p25(32.4, 2, 32.4, 5), ...p25(30, 3.6, 32.4, 3.6)],
        textos: [t25("BANHO", 31.2, 2.8), t25("A= 3,84 m²", 31.2, 3), t25("LAVABO", 31.2, 4.3), t25("A= 3,36 m²", 31.2, 4.5), t25(titulo, 31.2, 5.6, 12), t25("1 : 25", 31.2, 5.8, 10)] };
      const { plantas } = lerPagina(pagina(casa(2, 2, "PLANTA BAIXA"), det));
      expect(plantas.map(p => p.escala), titulo).toEqual([50]);
    }
  });

  it("N7: andares por extenso — faixa do pavimento-tipo, pilotis, inferior, semienterrado", () => {
    expect(nomeDoPavimento("PAVIMENTO TIPO - 2º AO 10º PAVIMENTO", 0)).toMatchObject({ nome: "Pavimento-tipo", andar: 1 });
    expect(nomeDoPavimento("PLANTA BAIXA - PILOTIS", 0).andar).toBe(0);
    expect(nomeDoPavimento("PLANTA BAIXA - PAVIMENTO INFERIOR", 0).andar).toBe(-1);
    expect(nomeDoPavimento("PLANTA BAIXA - PAVIMENTO SEMIENTERRADO", 0).andar).toBe(-1);
    expect(nomeDoPavimento("PLANTA BAIXA - MEZANINO", 0).andar).toBe(0.5);
  });

  it("N8: pilar no meio da parede não vira abertura; escala no fim do título é lida", () => {
    const q = (cx: number, cy: number, l: number) => [seg(cx - l / 2, cy - l / 2, cx + l / 2, cy - l / 2), seg(cx + l / 2, cy - l / 2, cx + l / 2, cy + l / 2), seg(cx + l / 2, cy + l / 2, cx - l / 2, cy + l / 2), seg(cx - l / 2, cy + l / 2, cx - l / 2, cy - l / 2)];
    const s = [...parede(2, 2, 6.6, 2), ...parede(7.4, 2, 12, 2), ...q(7, 2, 0.8), ...parede(2, 8, 6.6, 8), ...parede(7.4, 8, 12, 8), ...q(7, 8, 0.8), ...parede(2, 2, 2, 8), ...parede(12, 2, 12, 8), ...parede(7, 2.4, 7, 7.6)];
    const p = lerPagina(pagina({ segmentos: s, textos: [texto("QUARTO", 4.5, 5), texto("SALA", 9.5, 5), texto("PLANTA BAIXA 1:50", 7, 9, 12)] })).plantas[0];
    expect(p.escalaOrigem).toBe("texto");
    expect(p.aberturas).toEqual([]);
    expect(p.comodos.map(c => c.funcao).sort()).toEqual(["quarto", "sala"]);
  });
});

// Revisão de QA, iteração 3: "PISO" no título, edícula na mesma prancha, pilares, título longe do desenho.
describe("leitor geométrico — revisão de QA (3)", () => {
  const prancha = (escala = 50) => {
    const k = 1 / metrosPorPonto(escala);
    const seg = (x1: number, y1: number, x2: number, y2: number): Segmento => ({ x1: x1 * k, y1: y1 * k, x2: x2 * k, y2: y2 * k });
    const parede = (x1: number, y1: number, x2: number, y2: number, e = 0.15): Segmento[] => {
      const h = e / 2;
      return y1 === y2 ? [seg(Math.min(x1, x2) - h, y1 - h, Math.max(x1, x2) + h, y1 - h), seg(Math.min(x1, x2) - h, y1 + h, Math.max(x1, x2) + h, y1 + h)]
        : [seg(x1 - h, Math.min(y1, y2) - h, x1 - h, Math.max(y1, y2) + h), seg(x1 + h, Math.min(y1, y2) - h, x1 + h, Math.max(y1, y2) + h)];
    };
    const arco = (cx: number, cy: number, r: number): Segmento[] => Array.from({ length: 10 }, (_, i) => { const p = (Math.PI / 2) * (i / 10), q = (Math.PI / 2) * ((i + 1) / 10); return seg(cx + r * Math.cos(p), cy + r * Math.sin(p), cx + r * Math.cos(q), cy + r * Math.sin(q)); });
    const texto = (str: string, x: number, y: number, tam = 8) => ({ str, x: x * k, y: y * k, tam, largura: str.length * tam * 0.55 });
    type Desenho = { segmentos: Segmento[]; textos: Primitivas["textos"] };
    const casa = (ox: number, oy: number, titulo: string, o: { nomes?: [string, string]; arco?: boolean; tituloEm?: number } = {}): Desenho => {
      const [n1, n2] = o.nomes ?? ["SALA", "COZINHA"], ty = oy + (o.tituloEm ?? 9);
      return {
        segmentos: [...parede(ox, oy, ox + 2, oy), ...parede(ox + 2.9, oy, ox + 6, oy), ...parede(ox, oy + 8, ox + 6, oy + 8), ...parede(ox, oy, ox, oy + 8), ...parede(ox + 6, oy, ox + 6, oy + 8),
          ...parede(ox, oy + 4, ox + 3.5, oy + 4), ...(o.arco === false ? [] : arco(ox + 2.075, oy, 0.8))],
        textos: [texto(n1, ox + 3, oy + 2), texto("A= 22,50 m²", ox + 3, oy + 2.3), texto(n2, ox + 3, oy + 6), texto("A= 22,50 m²", ox + 3, oy + 6.3),
          ...(titulo ? [texto(titulo, ox + 3, ty, 12), texto(`1 : ${escala}`, ox + 3, ty + 0.4, 10)] : [])],
      };
    };
    const cotas = Array.from({ length: 40 }, (_, i) => seg(38 + i * 0.01, 25, 38 + i * 0.01, 25.1));
    const pagina = (...ds: Desenho[]): Primitivas => ({ largura: 2384, altura: 1684, arcos: [], imagens: 0, segmentos: [...ds.flatMap(d => d.segmentos), ...cotas], textos: ds.flatMap(d => d.textos) });
    return { seg, parede, arco, texto, casa, pagina };
  };
  const P = prancha();
  const montar = (...paginas: Primitivas[]) => {
    const pr = paginas.map((p, i) => ({ doc: 0, pagina: i + 1, ...lerPagina(p) }));
    const { parciais } = parciaisDasPranchas(pr, ["a.pdf"]);
    const nomes = (parciais.inventario as { edificacoes: { pavimentos: { nome: string }[] }[] }).edificacoes[0]?.pavimentos.map(p => p.nome) ?? [];
    const amb = Object.entries(parciais).filter(([c]) => c.startsWith("ambientes:")).map(([, v]) => v as { comodos: { nome: string; pontos: { x: number; y: number }[] }[]; pendencias: string[] });
    return { nomes, amb, pend: amb.flatMap(a => a.pendencias).join(" "), avisos: pr.flatMap(p => p.diagnostico.avisos ?? []).join(" ") };
  };

  it("H1: \"PISO\" no sentido de andar é pavimento; planta de piso e paginação continuam de fora", () => {
    for (const t of ["PLANTA BAIXA - PISO SUPERIOR", "PLANTA BAIXA - 1º PISO", "PRIMEIRO PISO", "PLANTA BAIXA - PISO TÉRREO", "2º PISO", "PLANTA DO PISO SUPERIOR", "PLANTA BAIXA - TERRAÇO DE COBERTURA", "SITUAÇÃO E PLANTA BAIXA"]) expect(tipoDaVista(t), t).toBe("planta");
    for (const t of ["PLANTA DE PISO", "PAGINAÇÃO DE PISO", "PLANTA DE COBERTURA", "PLANTA BAIXA ELÉTRICA"]) expect(tipoDaVista(t), t).toBe("outra");
    expect(nomeDoPavimento("PLANTA BAIXA - PISO SUPERIOR", 0).andar).toBe(1);
    expect(nomeDoPavimento("PLANTA BAIXA - PISO TÉRREO", 0).andar).toBe(0);
    expect(nomeDoPavimento("PLANTA BAIXA - 1º PISO", 0)).toEqual(nomeDoPavimento("PLANTA BAIXA - 1º PAVIMENTO", 0));
    expect(nomeDoPavimento("PRIMEIRO PISO", 0)).toEqual(nomeDoPavimento("PRIMEIRO PAVIMENTO", 0));
    expect(nomeDoPavimento("2º PISO", 0)).toEqual(nomeDoPavimento("2º PAVIMENTO", 0));
  });

  it("H1: térreo e \"PISO SUPERIOR\" na mesma prancha dão dois pavimentos", () => {
    const pg = P.pagina(P.casa(2, 2, "PLANTA BAIXA - TÉRREO"), P.casa(14, 2, "PLANTA BAIXA - PISO SUPERIOR", { nomes: ["QUARTO", "SUITE"] }));
    expect(lerPagina(pg).plantas.map(p => p.titulo)).toEqual(["PLANTA BAIXA - TÉRREO", "PLANTA BAIXA - PISO SUPERIOR"]);
    expect(montar(pg).nomes).toEqual(["Térreo", "Pavimento superior"]);
  });

  it("H1: desenho com título de planta de andar recusado vira aviso com o nome, mesmo com outra planta lida na página", () => {
    const { plantas, diagnostico } = lerPagina(P.pagina(P.casa(2, 2, "PLANTA BAIXA - TÉRREO"), P.casa(14, 2, "PLANTA BAIXA ELÉTRICA - TÉRREO")));
    expect(plantas.map(p => p.titulo)).toEqual(["PLANTA BAIXA - TÉRREO"]);
    expect((diagnostico.avisos ?? []).join(" ")).toContain("\"PLANTA BAIXA ELÉTRICA - TÉRREO\" não virou pavimento");
  });

  it("H2: edícula sem título ao lado do térreo entra no térreo, na posição desenhada — não vira andar", () => {
    const o = 12, ed = { segmentos: [...P.parede(o, 2, o + 1, 2), ...P.parede(o + 1.9, 2, o + 5, 2), ...P.parede(o, 6, o + 5, 6), ...P.parede(o, 2, o, 6), ...P.parede(o + 5, 2, o + 5, 6), ...P.parede(o + 3, 2, o + 3, 6), ...P.arco(o + 1.075, 2, 0.8)],
      textos: [P.texto("CHURRASQUEIRA", o + 1.5, 4), P.texto("WC", o + 4, 4)] };
    const r = montar(P.pagina(P.casa(2, 2, "PLANTA BAIXA - TÉRREO"), ed));
    expect(r.nomes).toEqual(["Térreo"]);
    expect(r.pend).toContain("Edícula/anexo sem título");
    const cs = r.amb[0].comodos, cx = (n: string) => { const c = cs.find(x => x.nome === n)!; return c.pontos.reduce((s, q) => s + q.x, 0) / c.pontos.length; };
    expect(cs.map(c => c.nome)).toEqual(expect.arrayContaining(["Sala", "Cozinha", "Churrasqueira", "Wc"]));
    expect(cx("Churrasqueira") - cx("Sala")).toBeGreaterThan(8); // 10 m entre as origens, menos o meio de cada um
    // Dois térreos na prancha: não dá para saber de qual é a edícula — fica de fora, com aviso.
    const dois = montar(P.pagina(P.casa(2, 2, "PLANTA BAIXA - TÉRREO - CASA A"), P.casa(2, 14, "PLANTA BAIXA - TÉRREO - CASA B", { nomes: ["QUARTO", "SALA"] }), ed));
    expect(dois.nomes.filter(n => /^Pavimento/.test(n))).toEqual([]);
    expect(dois.avisos).toContain("não foi incluído");
  });

  it("H2: desenho sem título dividindo \"PLANTAS BAIXAS\": vira outro andar, e isso fica dito", () => {
    const pg = P.pagina(P.casa(2, 2, "PLANTAS BAIXAS"), P.casa(12, 2, "", { nomes: ["QUARTO", "SUITE"] }));
    const r = montar(pg);
    expect(r.nomes).toHaveLength(2);
    expect(r.pend).toContain("divide \"PLANTAS BAIXAS\"");
  });

  it("M2: título de planta longe do desenho (4,5 m abaixo em 1:100, ou só no carimbo) é ligado a ele, com pendência", () => {
    const X = prancha(100);
    const p = lerPagina(X.pagina(X.casa(2, 2, "PLANTA BAIXA", { arco: false, tituloEm: 12.5 }))).plantas;
    expect(p).toHaveLength(1);
    expect(p[0].titulo).toBe("PLANTA BAIXA");
    expect(p[0].pendencias.join(" ")).toContain("foi ligado a ele");
  });

  it("L1: layout sem andar é dito como suposição; \"COBERTURA DUPLEX\" é \"Cobertura duplex\"", () => {
    expect(montar(P.pagina(P.casa(2, 2, "PLANTA BAIXA - TÉRREO")), P.pagina(P.casa(2, 2, "PLANTA DE LAYOUT", { nomes: ["QUARTO", "SUITE"] }))).pend).toContain("foi tomada como a planta de layout");
    expect(nomeDoPavimento("PLANTA BAIXA - COBERTURA DUPLEX", 0).nome).toBe("Cobertura duplex");
    expect(nomeDoPavimento("PLANTA BAIXA - DUPLEX SUPERIOR", 0).nome).toBe("Duplex superior");
  });

  it("2º e 3º pavimento iguais continuam dois andares", () => {
    const pg = (t: string, n: [string, string]) => P.pagina(P.casa(2, 2, t, { nomes: n }));
    expect(montar(pg("PLANTA BAIXA - TÉRREO", ["SALA", "COZINHA"]), pg("PLANTA BAIXA - 2º PAVIMENTO", ["QUARTO", "SUITE"]), pg("PLANTA BAIXA - 3º PAVIMENTO", ["QUARTO", "SUITE"])).nomes)
      .toEqual(["Térreo", "2º pavimento", "3º pavimento"]);
  });

  it("fileira de depósitos iguais (10 divisórias paralelas) mantém as divisórias", () => {
    const s: Segmento[] = [...P.parede(2, 2, 13.55, 2), ...P.parede(2, 5, 13.55, 5), ...P.parede(2, 2, 2, 5), ...P.parede(13.55, 2, 13.55, 5)], t: Primitivas["textos"] = [];
    for (let i = 1; i <= 10; i++) s.push(...P.parede(2 + i * 1.05, 2, 2 + i * 1.05, 5));
    for (let i = 0; i < 11; i++) t.push(P.texto(`DEP. ${i + 1}`, 2 + i * 1.05 + 0.5, 3.5, 5));
    t.push(P.texto("PLANTA BAIXA - SUBSOLO", 8, 6, 12), P.texto("1 : 50", 8, 6.4, 10));
    const p = lerPagina(P.pagina({ segmentos: s, textos: t })).plantas[0];
    expect(p.paredes.filter(w => Math.abs(w.ax - w.bx) < 0.01)).toHaveLength(12);
    expect(p.comodos.filter(c => c.funcao === "deposito")).toHaveLength(11);
  });

  it("M1: abertura entre dois pilares continua abertura (vidro → janela, porta de correr, vão livre); sem abertura nenhuma, pendência", () => {
    const ret = (x0: number, y0: number, x1: number, y1: number) => [P.seg(x0, y0, x1, y0), P.seg(x1, y0, x1, y1), P.seg(x1, y1, x0, y1), P.seg(x0, y1, x0, y0)];
    // Casa 10 × 6 com parede interna em x = 7; na parede da frente (y = 2), abertura de V m entre pilares L × Q.
    const casa = (V: number, L: number, Q: number, oque: "vidro" | "correr" | "nada" | "parede") => {
      const a = 4.5 - V / 2, b = 4.5 + V / 2, h = 0.075;
      const s = [...P.parede(2, 2, a - L, 2), ...P.parede(b + L, 2, 12, 2), ...ret(a - L, 2 - Q / 2, a, 2 + Q / 2), ...ret(b, 2 - Q / 2, b + L, 2 + Q / 2),
        ...P.parede(2, 8, 12, 8), ...P.parede(2, 2, 2, 8), ...P.parede(12, 2, 12, 8), ...P.parede(7, 2, 7, 8)];
      if (oque === "vidro") s.push(P.seg(a, 1.98, b, 1.98), P.seg(a, 2.02, b, 2.02), P.seg(a, 2 - h, b, 2 - h), P.seg(a, 2 + h, b, 2 + h));
      if (oque === "correr") s.push(P.seg(a, 1.97, (a + b) / 2 + 0.05, 1.97), P.seg((a + b) / 2 - 0.05, 2.03, b, 2.03));
      if (oque === "parede") s.push(P.seg(a, 2 - h, b, 2 - h), P.seg(a, 2 + h, b, 2 + h));
      return lerPagina(P.pagina({ segmentos: s, textos: [P.texto("QUARTO", 4.5, 5), P.texto("SALA", 9.5, 5), P.texto("PLANTA BAIXA", 7, 9, 12), P.texto("1 : 50", 7, 9.4, 10)] })).plantas[0];
    };
    for (const [V, L, Q] of [[0.9, 0.15, 0.3], [1.2, 0.3, 0.3], [1, 0.3, 0.15]] as const) {
      for (const [oque, tipos] of [["vidro", ["janela"]], ["correr", ["janela", "vao"]], ["nada", ["vao"]]] as const) {
        const p = casa(V, L, Q, oque);
        expect(p.comodos.map(c => c.funcao).sort(), `${V} ${L}x${Q} ${oque}`).toEqual(["quarto", "sala"]);
        expect(p.aberturas, `${V} ${L}x${Q} ${oque}`).toHaveLength(1);
        expect(tipos as readonly string[], `${V} ${L}x${Q} ${oque}`).toContain(p.aberturas[0].tipo);
        expect(p.aberturas[0].largura).toBeCloseTo(V, 1);
      }
    }
    // Entre os pilares, parede cheia (as duas faces, sem vidro): nenhuma abertura — e a pendência pede a entrada.
    const cheia = casa(0.9, 0.15, 0.3, "parede");
    expect(cheia.aberturas).toEqual([]);
    expect(cheia.pendencias.join(" ")).toContain("Nenhuma porta ou abertura lida");
  });

  it("N3: limite de candidatas atingido — o que saiu fica como parcial, nada confirmado; sem nada, o motivo diz", () => {
    const pg = P.pagina(P.casa(2, 2, "PLANTA BAIXA - TÉRREO"), P.casa(14, 2, "PLANTA BAIXA - SUPERIOR", { nomes: ["QUARTO", "SUITE"] }));
    const { plantas } = lerPagina(pg, { maxCandidatas: 10 }); // cada casa dá 6 pares de linhas: uma só termina
    expect(plantas).toHaveLength(1);
    expect(plantas[0].pendencias.join(" ")).toContain("resultado é parcial");
    expect([...plantas[0].paredes, ...plantas[0].aberturas, ...plantas[0].comodos].some(x => x.confirmada)).toBe(false);
    const r = lerPagina(pg, { maxCandidatas: 3 });
    expect(r.plantas).toEqual([]);
    expect(r.diagnostico.motivo).toContain("carregada demais");
    expect(lerPagina(pg).plantas).toHaveLength(2);
  });
});

// Revisão de QA, iteração 4: camadas de reboco entre pilares, título do desenho mais perto, anexos na prancha.
describe("leitor geométrico — revisão de QA (4)", () => {
  const k = 1 / metrosPorPonto(50);
  const seg = (x1: number, y1: number, x2: number, y2: number): Segmento => ({ x1: x1 * k, y1: y1 * k, x2: x2 * k, y2: y2 * k });
  const parede = (x1: number, y1: number, x2: number, y2: number, e = 0.15): Segmento[] => {
    const h = e / 2;
    return y1 === y2 ? [seg(Math.min(x1, x2) - h, y1 - h, Math.max(x1, x2) + h, y1 - h), seg(Math.min(x1, x2) - h, y1 + h, Math.max(x1, x2) + h, y1 + h)]
      : [seg(x1 - h, Math.min(y1, y2) - h, x1 - h, Math.max(y1, y2) + h), seg(x1 + h, Math.min(y1, y2) - h, x1 + h, Math.max(y1, y2) + h)];
  };
  const ret = (x0: number, y0: number, x1: number, y1: number) => [seg(x0, y0, x1, y0), seg(x1, y0, x1, y1), seg(x1, y1, x0, y1), seg(x0, y1, x0, y0)];
  const arco = (cx: number, cy: number, r: number): Segmento[] => Array.from({ length: 10 }, (_, i) => { const p = (Math.PI / 2) * (i / 10), q = (Math.PI / 2) * ((i + 1) / 10); return seg(cx + r * Math.cos(p), cy + r * Math.sin(p), cx + r * Math.cos(q), cy + r * Math.sin(q)); });
  const texto = (str: string, x: number, y: number, tam = 8) => ({ str, x: x * k, y: y * k, tam, largura: str.length * tam * 0.55 });
  type Desenho = { segmentos: Segmento[]; textos: Primitivas["textos"] };
  const cotas = Array.from({ length: 40 }, (_, i) => seg(38 + i * 0.01, 25, 38 + i * 0.01, 25.1));
  const pagina = (...ds: Desenho[]): Primitivas => ({ largura: 2384, altura: 1684, arcos: [], imagens: 0, segmentos: [...ds.flatMap(d => d.segmentos), ...cotas], textos: ds.flatMap(d => d.textos) });
  /** Casa 10 × 6 (2..12 × 2..8) com parede interna em x = 7: o QUARTO à esquerda, a SALA à direita. */
  const resto = () => [...parede(2, 8, 12, 8), ...parede(2, 2, 2, 8), ...parede(12, 2, 12, 8), ...parede(7, 2, 7, 8)];
  const nomes = () => [texto("QUARTO", 4.5, 5), texto("SALA", 9.5, 5), texto("PLANTA BAIXA", 7, 9, 12), texto("1 : 50", 7, 9.4, 10)];

  it("M-A: parede cheia com camadas de reboco e pilares embutidos não vira janela", () => {
    const h = 0.075, r = 0.05;
    // Parede da frente em 4 linhas (faces a ±7,5 cm, reboco a ±5 cm) e traços de pilar a cada 2,4–2,8 m.
    const s = [seg(1.925, 2 - h, 12.075, 2 - h), seg(1.925, 2 + h, 12.075, 2 + h), seg(2.075, 2 - r, 11.925, 2 - r), seg(2.075, 2 + r, 11.925, 2 + r), ...resto()];
    for (const x of [3.4, 3.6, 6.0, 6.2, 9.0, 9.2, 10.6, 10.8]) s.push(seg(x, 2 - h, x, 2 + h));
    const p = lerPagina(pagina({ segmentos: s, textos: nomes() })).plantas[0];
    expect(p.comodos.map(c => c.funcao).sort()).toEqual(["quarto", "sala"]);
    expect(p.aberturas).toEqual([]);
  });

  it("M-A: entre pilares salientes, linhas só dentro da parede (eixo ou duas camadas) dão janela NÃO confirmada, com pendência que nomeia a parede", () => {
    for (const [L, V] of [[0.15, 1.5], [0.3, 2.5]] as const) for (const linhas of [[0], [-0.05, 0.05]]) {
      const a = 4.5 - V / 2, b = 4.5 + V / 2, h = 0.075, Q = 0.3;
      const s = [...parede(2, 2, a - L, 2), ...parede(b + L, 2, 12, 2), ...ret(a - L, 2 - Q / 2, a, 2 + Q / 2), ...ret(b, 2 - Q / 2, b + L, 2 + Q / 2), ...resto(), seg(a, 2 - h, b, 2 - h), seg(a, 2 + h, b, 2 + h)];
      for (const d of linhas) s.push(seg(a, 2 + d, b, 2 + d));
      const p = lerPagina(pagina({ segmentos: s, textos: nomes() })).plantas[0], quem = `${L} ${V} ${JSON.stringify(linhas)}`;
      expect(p.aberturas.filter(x => x.confirmada), quem).toEqual([]);
      const j = p.aberturas.filter(x => x.tipo === "janela");
      expect(j, quem).toHaveLength(1);
      expect(p.pendencias.join(" "), quem).toContain(`na parede ${j[0].paredeId}`);
      expect(p.pendencias.join(" "), quem).toContain("camadas de reboco");
    }
  });

  it("M-A: janela de verdade entre pilares (marcos do caixilho nas duas pontas, ou folhas de correr) continua janela confirmada", () => {
    const V = 1.2, L = 0.3, Q = 0.3, a = 4.5 - V / 2, b = 4.5 + V / 2, h = 0.075;
    const base = () => [...parede(2, 2, a - L, 2), ...parede(b + L, 2, 12, 2), ...ret(a - L, 2 - Q / 2, a, 2 + Q / 2), ...ret(b, 2 - Q / 2, b + L, 2 + Q / 2), ...resto()];
    const comMarcos = [...base(), seg(a, 2 - h, b, 2 - h), seg(a, 2 + h, b, 2 + h), seg(a, 1.98, b, 1.98), seg(a, 2.02, b, 2.02), seg(a + 0.04, 2 - h, a + 0.04, 2 + h), seg(b - 0.04, 2 - h, b - 0.04, 2 + h)];
    const correr = [...base(), seg(a, 1.97, 4.55, 1.97), seg(4.45, 2.03, b, 2.03)];
    for (const s of [comMarcos, correr]) {
      const p = lerPagina(pagina({ segmentos: s, textos: nomes() })).plantas[0];
      expect(p.aberturas).toHaveLength(1);
      expect(p.aberturas[0]).toMatchObject({ tipo: "janela", confirmada: true });
      expect(p.aberturas[0].largura).toBeCloseTo(V, 1);
      expect(p.pendencias.join(" ")).not.toContain("camadas de reboco");
    }
  });
  /** Bloco w × h em (ox, oy), dividido ao meio por uma parede, com dois cômodos; porta com folha na frente, salvo `porta: false`. */
  const bloco = (ox: number, oy: number, w: number, h: number, n: [string, string], o: { porta?: boolean; titulo?: string } = {}): Desenho => ({
    segmentos: [...(o.porta === false ? parede(ox, oy, ox + w, oy) : [...parede(ox, oy, ox + 1, oy), ...parede(ox + 1.9, oy, ox + w, oy), ...arco(ox + 1.075, oy, 0.8)]),
      ...parede(ox, oy + h, ox + w, oy + h), ...parede(ox, oy, ox, oy + h), ...parede(ox + w, oy, ox + w, oy + h), ...parede(ox + w / 2, oy, ox + w / 2, oy + h)],
    textos: [texto(n[0], ox + w / 4, oy + h / 2), texto(n[1], ox + (3 * w) / 4, oy + h / 2), ...(o.titulo ? [texto(o.titulo, ox + w / 2, oy + h + 1, 12), texto("1 : 50", ox + w / 2, oy + h + 1.4, 10)] : [])],
  });
  const montar = (pg: Primitivas) => {
    const r = lerPagina(pg), { parciais } = parciaisDasPranchas([{ doc: 0, pagina: 1, ...r }], ["a.pdf"]);
    const nomes = (parciais.inventario as { edificacoes: { pavimentos: { nome: string }[] }[] }).edificacoes[0]?.pavimentos.map(p => p.nome) ?? [];
    return { r, nomes, avisos: (r.diagnostico.avisos ?? []).join(" ") };
  };
  const TERREO = "PLANTA BAIXA - TÉRREO";

  it("M-B: o título vai para o desenho mais perto — a garagem maior ao lado não leva o título nem empurra a casa para \"Pavimento 2\"", () => {
    for (const larg of [8, 7]) {
      const { r, nomes } = montar(pagina(bloco(2, 2, 6, 8, ["SALA", "QUARTO"], { titulo: TERREO }), bloco(10, 2, larg, 8, ["GARAGEM", "DEPÓSITO"])));
      expect(nomes, `garagem ${larg}`).toEqual(["Térreo"]);
      const p = r.plantas[0];
      expect(p.titulo).toBe(TERREO);
      expect(p.comodos.map(c => c.funcao).sort()).toEqual(["deposito", "garagem", "quarto", "sala"]);
      expect(p.pendencias.join(" ")).toContain("Edícula/anexo sem título");
    }
  });

  it("M-C: dois anexos sem título entram os dois no térreo, cada um com a sua pendência (a caixa do térreo já aumentada não conta)", () => {
    const { r, nomes } = montar(pagina(bloco(2, 2, 6, 8, ["SALA", "QUARTO"], { titulo: TERREO }), bloco(10, 2, 5, 4, ["CHURRASQUEIRA", "WC"]), bloco(10, 9, 4, 3, ["DEPÓSITO", "LAVANDERIA"])));
    expect(nomes).toEqual(["Térreo"]);
    expect(r.plantas[0].comodos.map(c => c.funcao)).toEqual(expect.arrayContaining(["area_gourmet", "banheiro", "deposito", "area_servico"]));
    expect(r.plantas[0].pendencias.filter(t => t.startsWith("Edícula/anexo sem título"))).toHaveLength(2);
  });

  it("M-D: edícula no canto de uma casa em L (dentro da caixa da casa, sem se sobrepor a cômodo nem parede) entra no térreo", () => {
    const L: Desenho = { segmentos: [...parede(2, 2, 3, 2), ...parede(3.9, 2, 14, 2), ...arco(3.075, 2, 0.8), ...parede(2, 2, 2, 14), ...parede(2, 14, 8, 14), ...parede(8, 8, 8, 14), ...parede(8, 8, 14, 8), ...parede(14, 2, 14, 8), ...parede(2, 8, 8, 8), ...parede(8, 2, 8, 8)],
      textos: [texto("SALA", 5, 5), texto("COZINHA", 11, 5), texto("QUARTO", 5, 11), texto(TERREO, 8, 16, 12), texto("1 : 50", 8, 16.4, 10)] };
    const { r, nomes } = montar(pagina(L, bloco(9.5, 9.5, 4, 3.5, ["CHURRASQUEIRA", "WC"])));
    expect(nomes).toEqual(["Térreo"]);
    const pend = r.plantas[0].pendencias.join(" ");
    expect(r.plantas[0].comodos.map(c => c.funcao)).toEqual(expect.arrayContaining(["sala", "cozinha", "quarto", "area_gourmet", "banheiro"]));
    expect(pend).toContain("Edícula/anexo sem título");
    expect(pend).not.toContain("sem paredes que os fechem");
  });

  it("B3: a entrada principal nunca é a porta do anexo; a pendência de falta de abertura diz que falta na construção principal", () => {
    const { r } = montar(pagina(bloco(2, 2, 6, 8, ["SALA", "QUARTO"], { titulo: TERREO, porta: false }), bloco(10, 2, 5, 4, ["CHURRASQUEIRA", "WC"])));
    const p = r.plantas[0];
    expect(p.aberturas.filter(a => a.tipo === "porta")).toHaveLength(1);
    expect(p.aberturas.some(a => a.entradaPrincipal)).toBe(false);
    const pend = p.pendencias.join(" ");
    expect(pend).not.toContain("Nenhuma porta ou abertura lida neste pavimento");
    expect(pend).toContain("Nenhuma porta ou abertura lida na construção principal");
  });

  it("B4: desenho sem título, menor, com quarto e suíte não entra como edícula: fica de fora, com aviso de que pode ser o andar de cima", () => {
    const { r, nomes, avisos } = montar(pagina(bloco(2, 2, 8, 10, ["SALA", "COZINHA"], { titulo: TERREO }), bloco(14, 2, 6, 7, ["QUARTO", "SUÍTE"])));
    expect(nomes).toEqual(["Térreo"]);
    expect(r.plantas[0].comodos.map(c => c.funcao).sort()).toEqual(["cozinha", "sala"]);
    expect(avisos).toContain("pode ser o andar de cima");
  });

  it("A1: duas casas geminadas iguais sob um título só ficam as duas no mesmo pavimento, lado a lado, com pendência", () => {
    for (const comTitulo of ["sob a primeira", "entre as duas"]) {
      const ds = comTitulo === "sob a primeira" ? [bloco(2, 2, 6, 8, ["SALA", "QUARTO"], { titulo: "PLANTA BAIXA" }), bloco(10, 2, 6, 8, ["SALA", "QUARTO"])]
        : [bloco(2, 2, 6, 8, ["SALA", "QUARTO"]), bloco(10, 2, 6, 8, ["SALA", "QUARTO"]), { segmentos: [], textos: [texto("PLANTA BAIXA", 9, 11, 12), texto("1 : 50", 9, 11.4, 10)] }];
      const { r, nomes } = montar(pagina(...ds));
      expect(nomes, comTitulo).toEqual(["Térreo"]);
      const p = r.plantas[0], cx = p.comodos.map(c => c.pontos.reduce((s, q) => s + q.x, 0) / c.pontos.length).sort((a, b) => a - b);
      expect(p.comodos, comTitulo).toHaveLength(4);
      expect(cx[3] - cx[0], comTitulo).toBeGreaterThan(9); // a segunda casa 8 m à direita, na posição desenhada
      expect(p.largura).toBeCloseTo(14, 0);
      expect(p.pendencias.join(" "), comTitulo).toContain("casas geminadas");
    }
  });

  it("M2c: desenho sem porta não ganha o título do carimbo, longe dele (pode ser corte) — fica de fora com aviso", () => {
    const { r, avisos } = montar(pagina(bloco(2, 2, 6, 8, ["SALA", "QUARTO"], { porta: false }), { segmentos: [], textos: [texto("PLANTA BAIXA", 40, 30, 12), texto("1 : 50", 40, 30.4, 10)] }));
    expect(r.plantas).toEqual([]);
    expect(avisos).toContain("pode ser corte ou elevação");
  });

  it("títulos com PISO: disciplina, escala e medida de peça não são andar; \"PISO -1\" é subsolo; \"PISO INTERMEDIÁRIO\" fica entre os andares", () => {
    for (const t of ["PLANTA BAIXA - PISOS", "PLANTA BAIXA PISO 20X20", "PLANTA BAIXA - PISO 1:50"]) {
      expect(tipoDaVista(t), t).toBe("outra");
      expect(nomeDoPavimento(t, 0).andar, t).toBeNull();
    }
    expect(nomeDoPavimento("PISO -1", 0)).toMatchObject({ nome: "1º subsolo", andar: -1 });
    expect(nomeDoPavimento("PLANTA BAIXA - PISO -2", 0)).toMatchObject({ nome: "2º subsolo", andar: -2 });
    expect(tipoDaVista("PISO -1")).toBe("planta");
    expect(nomeDoPavimento("PISO INTERMEDIÁRIO", 0)).toMatchObject({ nome: "Piso intermediário", andar: 0.5 });
    expect(nomeDoPavimento("PISO 2", 0).andar).toBe(1);
  });
});
