// Maquete 3D (EPIC-023, S-G): sistema viário fiel — leitura das formas de rua, cruzamentos, balão, calçada que não
// invade lote, espaçamento de árvores e postes, determinismo, PARE × semáforo e assentamento no relevo.
import { describe, expect, it } from "vitest";
import { gerarEstudoMassa, type ParametrosMassa } from "../shared/incorporacao/massa.js";
import { implantacaoDoEstudo } from "../shared/maquete-3d/implantacao.js";
import { alturaDoRelevo, areaPoligono, implantacaoSchema, type Implantacao, type Ponto } from "../shared/maquete-3d/modelo.js";
import {
  ALTURA_MEIO_FIO, ELEVACAO, ESPACO_ARVORE, LADO_MALHA, ESPACO_POSTE, LARGURA_VIA_PRINCIPAL, alturaNaMalha, caixaDoTerreno, dentroDe, distanciaAoContorno,
  formaDaRua, perfilDaVia, sistemaViario, type Elemento,
} from "../shared/maquete-3d/vias.js";

const ret = (x0: number, y0: number, x1: number, y1: number): Ponto[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
/** Corredor de rua como o estudo de massa guarda: retângulo do leito, que passa meia largura além do eixo transversal. */
const ruaH = (y: number, x0: number, x1: number, w = 12) => ret(x0, y - w / 2, x1, y + w / 2);
const ruaV = (x: number, y0: number, y1: number, w = 12) => ret(x - w / 2, y0, x + w / 2, y1);
const circulo = (cx: number, cy: number, r: number, n = 24): Ponto[] => Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos((2 * Math.PI * i) / n), y: cy + r * Math.sin((2 * Math.PI * i) / n) }));
const imp = (o: Partial<Implantacao>) => implantacaoSchema.parse(o);
const doTipo = (els: Elemento[], t: Elemento["tipo"]) => els.filter(e => e.tipo === t);

describe("forma das ruas", () => {
  it("retângulo: eixo pelo lado maior e largura pelo menor", () => {
    const f = formaDaRua(ret(10, 20, 110, 32));
    expect(f?.tipo).toBe("reta");
    if (f?.tipo !== "reta") return;
    const [a, b] = f.eixo;
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(100, 1);
    expect(f.largura).toBeCloseTo(12, 1);
    expect(a.y).toBeCloseTo(26, 1);
    expect(b.y).toBeCloseTo(26, 1);
  });

  it("retângulo girado (malha a 30°): o eixo acompanha o giro", () => {
    const g = (30 * Math.PI) / 180, gira = (p: Ponto) => ({ x: p.x * Math.cos(g) - p.y * Math.sin(g), y: p.x * Math.sin(g) + p.y * Math.cos(g) });
    const f = formaDaRua(ret(0, 0, 80, 14).map(gira));
    expect(f?.tipo).toBe("reta");
    if (f?.tipo !== "reta") return;
    const [a, b] = f.eixo, ang = Math.abs(Math.atan2(b.y - a.y, b.x - a.x));
    expect(Math.min(ang, Math.PI - ang)).toBeCloseTo(g, 2);
    expect(f.largura).toBeCloseTo(14, 1);
  });

  it("círculo vira balão; anel (faixa curva) não", () => {
    const b = formaDaRua(circulo(50, 50, 11));
    expect(b?.tipo).toBe("balao");
    if (b?.tipo === "balao") { expect(b.raio).toBeCloseTo(11, 0); expect(b.centro.x).toBeCloseTo(50, 1); }
    const ext: Ponto[] = [], int: Ponto[] = [];
    for (let i = 0; i <= 16; i++) { const a = (i / 16) * (Math.PI / 2); ext.push({ x: 126 * Math.cos(a), y: 126 * Math.sin(a) }); int.push({ x: 114 * Math.cos(a), y: 114 * Math.sin(a) }); }
    const c = formaDaRua([...ext, ...int.reverse()]);
    expect(c?.tipo).toBe("curva");
    if (c?.tipo === "curva") {
      expect(c.largura).toBeGreaterThan(11);
      expect(c.largura).toBeLessThan(13);
      for (const p of c.eixo) expect(Math.hypot(p.x, p.y)).toBeCloseTo(120, 0);
    }
  });

  it("perfil: rua de 12 m tem pista de ~7 m e calçadas de ~2,5 m, que somam a largura do leito", () => {
    const p = perfilDaVia(12);
    expect(p.pista).toBeCloseTo(7.2, 1);
    expect(p.calcada).toBeCloseTo(2.4, 1);
    expect(p.pista + 2 * p.calcada).toBeCloseTo(12, 6);
    expect(p.faixaServico).toBeGreaterThan(0);
    const estreita = perfilDaVia(5);
    expect(estreita.pista).toBeGreaterThanOrEqual(3);
    expect(estreita.pista + 2 * estreita.calcada).toBeCloseTo(5, 6);
  });
});

describe("cruzamentos e balão", () => {
  it("cruz: dois corredores que se atravessam dão um nó de 4 braços no encontro dos eixos", () => {
    const sv = sistemaViario(imp({ ruas: [ruaH(100, 0, 200), ruaV(100, 0, 200)] }));
    const cruz = sv.nos.filter(n => n.tipo === "cruzamento");
    expect(cruz).toHaveLength(1);
    expect(cruz[0].bracos).toHaveLength(4);
    expect(cruz[0].p.x).toBeCloseTo(100, 1);
    expect(cruz[0].p.y).toBeCloseTo(100, 1);
    expect(sv.trechos).toHaveLength(4);
    expect(sv.pontas).toHaveLength(4);
  });

  it("T: a rua que termina na outra (o leito passa meia largura) liga no eixo, sem sobra", () => {
    const sv = sistemaViario(imp({ ruas: [ruaH(100, 0, 200), ruaV(100, 106, 200)] }));
    expect(sv.nos).toHaveLength(1);
    expect(sv.nos[0].bracos).toHaveLength(3);
    expect(sv.nos[0].p.y).toBeCloseTo(100, 1);
    expect(sv.trechos).toHaveLength(3);
  });

  it("L: duas ruas que se encontram no canto formam uma esquina (2 braços), com placa de asfalto", () => {
    const sv = sistemaViario(imp({ ruas: [ruaH(0, -6, 150), ruaV(0, -6, 150)] }));
    expect(sv.nos).toHaveLength(1);
    expect(sv.nos[0].tipo).toBe("esquina");
    expect(sv.nos[0].controle).toBe("nenhum");
    expect(sv.placas.length).toBeGreaterThanOrEqual(1);
  });

  it("balão: a rua sem saída termina no centro do balão, que ganha anel de calçada e pista", () => {
    const sv = sistemaViario(imp({ ruas: [ruaH(50, 0, 160), circulo(160, 50, 11)] }));
    expect(sv.baloes).toHaveLength(1);
    const b = sv.baloes[0];
    expect(b.trecho).toBe(sv.trechos[0].id);
    expect(b.raioPista).toBeCloseTo(11 - perfilDaVia(12).calcada, 1);
    const fim = sv.trechos[0].eixo[sv.trechos[0].eixo.length - 1];
    expect(Math.hypot(fim.x - 160, fim.y - 50)).toBeLessThan(0.5);
    // Só a outra ponta (x = 0) fica sem saída.
    expect(sv.pontas).toHaveLength(1);
    expect(sv.pontas[0].p.x).toBeCloseTo(0, 1);
  });

  it("eixo lido do PDF (imp.vias) é desenhado como trecho próprio, e o polígono do mesmo leito não duplica", () => {
    const sv = sistemaViario(imp({ ruas: [ruaH(30, 0, 120, 10)], vias: [{ id: "a1", nome: "Rua A", eixo: [{ x: 0, y: 30 }, { x: 120, y: 30 }], largura: 10 }] }));
    expect(sv.trechos).toHaveLength(1);
    expect(sv.trechos[0].origem).toBe("via");
    expect(sv.trechos[0].nome).toBe("Rua A");
    expect(sv.varreduras.length).toBeGreaterThan(0);
  });
});

describe("calçada, árvores e postes", () => {
  // Quadra de lotes 10 × 25 m entre duas ruas de 12 m, com uma transversal.
  const lotes = Array.from({ length: 12 }, (_, k) => ({ id: `l${k}`, poligono: ret(6 + k * 10, 6, 16 + k * 10, 31) }));
  const modelo = imp({ ruas: [ruaH(0, -6, 200), ruaV(0, -6, 80), ruaH(37, -6, 200)], lotes });
  const sv = sistemaViario(modelo);

  it("nenhuma parte da via (calçada, meio-fio, sarjeta, asfalto) entra num lote", () => {
    let conferidos = 0;
    for (const v of sv.varreduras) for (const col of v.colunas) for (const p of col) {
      conferidos++;
      for (const l of lotes) if (dentroDe(p, l.poligono)) expect(distanciaAoContorno(p, l.poligono)).toBeLessThan(0.05);
    }
    for (const pl of sv.placas) for (const p of pl.contorno) for (const l of lotes) expect(dentroDe(p, l.poligono) && distanciaAoContorno(p, l.poligono) > 0.05).toBe(false);
    expect(conferidos).toBeGreaterThan(500);
    // E nenhum elemento (árvore, poste, placa) fica dentro de lote nem na pista.
    for (const e of sv.elementos) for (const l of lotes) expect(dentroDe({ x: e.x, y: e.y }, l.poligono)).toBe(false);
  });

  it("árvores na faixa de serviço, nas divisas dos lotes e no espaçamento regular onde não há lotes", () => {
    const arv = doTipo(sv.elementos, "arvore");
    expect(arv.length).toBeGreaterThan(10);
    const pista = perfilDaVia(12).pista / 2;
    // Rua y = 0, lado dos lotes (y > 0): árvores em x = divisa (múltiplo de 10 a partir de 6).
    const ladoLotes = arv.filter(e => e.y > pista && e.y < 6 && e.x > 10 && e.x < 120).sort((a, b) => a.x - b.x);
    expect(ladoLotes.length).toBeGreaterThan(4);
    for (const e of ladoLotes) expect(Math.abs(((e.x - 6) % 10 + 10) % 10)).toBeLessThan(0.05);
    for (let i = 1; i < ladoLotes.length; i++) expect(ladoLotes[i].x - ladoLotes[i - 1].x).toBeGreaterThanOrEqual(ESPACO_ARVORE * 0.7 - 1e-6);
    // Lado de fora (y < 0, sem lotes): espaçamento regular.
    const fora = arv.filter(e => e.y < -pista && e.y > -6 && e.x > 10 && e.x < 190).sort((a, b) => a.x - b.x);
    expect(fora.length).toBeGreaterThan(8);
    for (let i = 1; i < fora.length; i++) {
      const d = fora[i].x - fora[i - 1].x;
      if (d < ESPACO_POSTE / 2) { expect(d).toBeGreaterThan(ESPACO_ARVORE * 0.6); expect(d).toBeLessThan(ESPACO_ARVORE * 1.5); }
    }
    // Sempre fora da pista (além do meio-fio).
    for (const e of arv) expect(Math.min(Math.abs(e.y), Math.abs(e.y - 37), Math.abs(e.x)) > pista || Math.abs(e.x) > pista).toBe(true);
  });

  it("postes a cada ~30 m, de um lado só na rua local e longe das árvores", () => {
    const p = doTipo(sv.elementos, "poste").filter(e => Math.abs(e.y) < 6 && e.x > 0).sort((a, b) => a.x - b.x);
    expect(p.length).toBeGreaterThanOrEqual(4);
    expect(new Set(p.map(e => Math.sign(e.y))).size).toBe(1);
    for (let i = 1; i < p.length; i++) expect(p[i].x - p[i - 1].x).toBeCloseTo(ESPACO_POSTE, 0);
    for (const q of p) for (const a of doTipo(sv.elementos, "arvore")) expect(Math.hypot(a.x - q.x, a.y - q.y)).toBeGreaterThan(2);
  });

  it("determinístico: a mesma implantação dá exatamente o mesmo sistema (árvores com o mesmo porte e cor)", () => {
    const outra = sistemaViario(implantacaoSchema.parse(JSON.parse(JSON.stringify(modelo))));
    expect(JSON.stringify(outra)).toBe(JSON.stringify(sv));
    const arv = doTipo(sv.elementos, "arvore");
    expect(new Set(arv.map(a => a.variante)).size).toBeGreaterThan(1);
    expect(new Set(arv.map(a => a.escala)).size).toBeGreaterThan(5);
  });

  it("sinalização: faixa de pedestres e linha de retenção junto do cruzamento, eixo amarelo no trecho", () => {
    expect(sv.pinturas.some(p => p.cor === "amarela")).toBe(true);
    const brancas = sv.pinturas.filter(p => p.cor === "branca");
    expect(brancas.length).toBeGreaterThan(20);
    for (const p of sv.pinturas) for (const h of p.h) expect(h).toBeGreaterThan(0);
  });
});

describe("PARE × semáforo (critério documentado em LARGURA_VIA_PRINCIPAL)", () => {
  it("cruzamento de duas vias principais (≥ 14 m): semáforo em cada chegada, nenhum PARE", () => {
    const sv = sistemaViario(imp({ ruas: [ruaH(100, 0, 200, 16), ruaV(100, 0, 200, LARGURA_VIA_PRINCIPAL)] }));
    expect(sv.nos[0].controle).toBe("semaforo");
    const s = doTipo(sv.elementos, "semaforo");
    expect(s).toHaveLength(4);
    expect(doTipo(sv.elementos, "pare")).toHaveLength(0);
    // A via preferencial fica no verde, a outra no vermelho.
    expect(s.filter(e => e.estado === "verde")).toHaveLength(2);
    expect(s.filter(e => e.estado === "vermelho")).toHaveLength(2);
  });

  it("avenida × rua local: PARE só na rua local (os dois braços dela), sem semáforo", () => {
    const sv = sistemaViario(imp({ ruas: [ruaH(100, 0, 200, 16), ruaV(100, 0, 200, 12)] }));
    expect(sv.nos[0].controle).toBe("pare");
    expect(doTipo(sv.elementos, "semaforo")).toHaveLength(0);
    const pare = doTipo(sv.elementos, "pare");
    expect(pare).toHaveLength(2);
    for (const e of pare) expect(Math.abs(e.x - 100)).toBeLessThan(7); // na rua vertical (local)
  });

  it("T entre ruas locais: PARE só na rua que chega; a que segue em frente é a preferencial", () => {
    const sv = sistemaViario(imp({ ruas: [ruaH(100, 0, 200), ruaV(100, 106, 200)] }));
    const pare = doTipo(sv.elementos, "pare");
    expect(pare).toHaveLength(1);
    expect(pare[0].y).toBeGreaterThan(100);
    // A placa fica do lado direito de quem chega (andando para o norte, direita = leste) e olha para ele (+y).
    expect(pare[0].x).toBeGreaterThan(100);
    expect(Math.cos(pare[0].giro)).toBeCloseTo(0, 3);
    expect(-Math.sin(pare[0].giro)).toBeCloseTo(1, 3);
  });

  it("esquina (2 braços) e trechos sem cruzamento não têm PARE nem semáforo", () => {
    const sv = sistemaViario(imp({ ruas: [ruaH(0, -6, 150, 16), ruaV(0, -6, 150, 16)] }));
    expect(doTipo(sv.elementos, "pare")).toHaveLength(0);
    expect(doTipo(sv.elementos, "semaforo")).toHaveLength(0);
  });
});

describe("relevo", () => {
  // Rampa de 6 % para leste e 3 % para sul, com ondulação.
  const colunas = 20, linhas = 20, x0 = -20, y0 = -20, dx = 12, dy = 12;
  const alturas = Array.from({ length: colunas * linhas }, (_, k) => { const x = x0 + (k % colunas) * dx, y = y0 + Math.floor(k / colunas) * dy; return 0.06 * (x - x0) + 0.03 * (y - y0) + 1.5 * Math.sin(x / 30); });
  const relevo = { x0, y0, dx, dy, colunas, linhas, alturas, altitudeBase: 0 };
  const modelo = imp({ relevo, ruas: [ruaH(100, 0, 200), ruaV(100, 0, 200)] });
  const sv = sistemaViario(modelo);
  const caixa = caixaDoTerreno(modelo);

  it("a altura da malha coincide com o relevo nos vértices e fica entre eles por interpolação", () => {
    // Vértices da malha do terreno (LADO_MALHA divisões sobre a caixa).
    for (const [i, j] of [[0, 0], [17, 40], [96, 96], [50, 3]]) {
      const x = caixa.x0 + (caixa.largura * i) / LADO_MALHA, y = caixa.z0 + (caixa.comprimento * j) / LADO_MALHA;
      expect(alturaNaMalha(relevo, caixa, x, y)).toBeCloseTo(alturaDoRelevo(relevo, x, y), 6);
    }
    for (const [x, y] of [[33.3, 71.9], [150.2, 10.4]]) expect(Math.abs(alturaNaMalha(relevo, caixa, x, y) - alturaDoRelevo(relevo, x, y))).toBeLessThan(0.15);
  });

  it("árvores, postes e placas ficam na cota do terreno (topo da calçada), não flutuam nem afundam", () => {
    expect(sv.elementos.length).toBeGreaterThan(10);
    for (const e of sv.elementos) expect(e.cota).toBeCloseTo(alturaNaMalha(relevo, caixa, e.x, e.y) + ELEVACAO + ALTURA_MEIO_FIO, 2);
    const altos = sv.elementos.map(e => e.cota);
    expect(Math.max(...altos) - Math.min(...altos)).toBeGreaterThan(5);
  });

  it("estações dos trechos amiudadas no relevo (no máximo meia célula da malha)", () => {
    const asfalto = sv.varreduras.find(v => v.materiais.includes("asfalto"))!;
    const col = asfalto.colunas[0];
    for (let i = 1; i < col.length; i++) expect(Math.hypot(col[i].x - col[i - 1].x, col[i].y - col[i - 1].y)).toBeLessThanOrEqual(3.01);
  });
});

describe("com o estudo de massa de verdade (Incorporação → implantação → vias)", () => {
  // Gleba irregular de ~300 × 220 m em Goiânia; mesmos parâmetros nas três tipologias.
  const centro: [number, number] = [-49.25, -16.68];
  const m = 1 / 111320, cosLat = Math.cos((centro[1] * Math.PI) / 180);
  const anel = [[0, 0], [300, 20], [320, 200], [150, 240], [-10, 210], [0, 0]].map(([x, y]) => [centro[0] + (x * m) / cosLat, centro[1] + y * m]);
  const geojson = JSON.stringify({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [anel] } });
  const base = { larguraViaM: 12, testadaLoteM: 10, profundidadeLoteM: 25, loteMinimoM2: 200, comprimentoMaxQuadraM: 150, percentInstitucional: 0.05, percentAreaVerde: 0.1, precoM2Lote: 500 };
  const casos = [["grade", { tipologia: "grid" }], ["cul-de-sac", { tipologia: "cul_de_sac" }], ["rua pela divisa", { tipologia: "rua_simples", tracadoVia: "divisa" }]] as const;

  for (const [rotulo, extra] of casos) {
    it(`${rotulo}: toda rua vira via 3D, sem invadir lote`, () => {
      const est = gerarEstudoMassa(anel, centro, { ...base, ...extra } as ParametrosMassa, { nCenarios: 1 });
      const cenario = est.cenarios[0];
      expect(cenario).toBeTruthy();
      const implantacao = implantacaoDoEstudo(geojson, centro, cenario, null)!.implantacao;
      const sv = sistemaViario(implantacao);
      expect(implantacao.ruas.length).toBeGreaterThan(0);
      // Só fica sem via 3D a ponta triangular que o recorte pela divisa deixa (pintada como asfalto no terreno).
      for (const i of sv.ruasSemGeometria) expect(areaPoligono(implantacao.ruas[i]), `rua ${i}`).toBeLessThan(200);
      expect(sv.ruasSemGeometria.length).toBeLessThanOrEqual(Math.ceil(implantacao.ruas.length / 4));
      expect(sv.trechos.length).toBeGreaterThan(0);
      if (extra.tipologia === "cul_de_sac") expect(sv.baloes.filter(b => b.trecho).length).toBeGreaterThan(0);
      for (const v of sv.varreduras) for (const col of v.colunas) for (const p of col) for (const l of implantacao.lotes) {
        if (dentroDe(p, l.poligono)) expect(distanciaAoContorno(p, l.poligono)).toBeLessThan(0.3);
      }
    }, 60_000); // o motor de massa da rua pela divisa leva alguns segundos
  }
});
