// Maquete 3D (EPIC-024, S-04): muro de divisa do condomínio — geometria fechada no contorno (quadrado e côncavo),
// por dentro do terreno, aberta no portão onde a rua sai, igual nos dois sentidos de desenho, assentada no relevo,
// rápida com 4.000 pontos; regras do tipo (condomínio liga, casa não) e validação sem contorno.
import { describe, expect, it } from "vitest";
import { gerarEstudoMassa, type ParametrosMassa } from "../shared/incorporacao/massa.js";
import { implantacaoDoEstudo } from "../shared/maquete-3d/implantacao.js";
import {
  alturaDoRelevo, implantacaoSchema, lerModelo, modeloSchema, muroDaMaquete, muroParaTipo, muroSchema, validarModelo,
  type Implantacao, type ModeloMaquete, type Muro, type Ponto,
} from "../shared/maquete-3d/modelo.js";
import { ENTERRO_MURO, FOLGA_DIVISA, FOLGA_PORTAO, geometriaDoMuro, perimetroDoTerreno, pontosDosPortoes, portoesAutomaticos, type GeometriaMuro } from "../shared/maquete-3d/muro.js";
import { alturaNaMalha, caixaDoTerreno, dentroDe, distanciaAoContorno, sistemaViario } from "../shared/maquete-3d/vias.js";

const ret = (x0: number, y0: number, x1: number, y1: number): Ponto[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const imp = (o: Partial<Implantacao>) => implantacaoSchema.parse(o);
const muro = (o: Partial<Muro> = {}) => muroSchema.parse(o);
/** Em "L": côncavo, com um canto reentrante. */
const L: Ponto[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 100 }, { x: 0, y: 100 }];
const perimetro = (pts: Ponto[]) => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + Math.hypot(q.x - p.x, q.y - p.y); }, 0);
const comprimentoDosTrechos = (g: GeometriaMuro) => g.trechos.reduce((s, t) => s + t.reduce((a, p, i) => (i ? a + Math.hypot(p.x - t[i - 1].x, p.y - t[i - 1].y) : 0), 0), 0);
/** Vértices (planta) de uma malha. */
function vertices(g: GeometriaMuro, mat: "muro" | "capa" | "portao" = "muro") {
  const m = g.malhas[mat], out: { x: number; h: number; y: number }[] = [];
  if (!m) return out;
  for (let i = 0; i < m.posicoes.length; i += 3) out.push({ x: m.posicoes[i], h: m.posicoes[i + 1], y: m.posicoes[i + 2] });
  return out;
}
/** Distância de um ponto a uma polilinha aberta. */
const distanciaAPolilinha = (p: Ponto, linha: Ponto[]) => linha.slice(1).reduce((m, b, k) => {
  const a = linha[k], abx = b.x - a.x, aby = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby || 1)));
  return Math.min(m, Math.hypot(p.x - a.x - abx * t, p.y - a.y - aby * t));
}, Infinity);
/** Dentro do terreno ou sobre a divisa (face externa com recuo zero). */
const noTerreno = (p: Ponto, pol: Ponto[]) => dentroDe(p, pol) || distanciaAoContorno(p, pol) < 1e-3;
/** Muro com portões editados (fixos), para medir sem depender das ruas. */
const comPortoes = (portoes: { posicao: number; largura: number; tipo?: "veiculos" | "pedestres" }[], o: Partial<Muro> = {}) =>
  muro({ ...o, portoesEditados: true, portoes: portoes.map((p, i) => ({ id: `p${i + 1}`, tipo: "veiculos", ...p })) });

describe("geometria do muro", () => {
  it("quadrado: muro fechado do tamanho do contorno menos o portão, com capa e pilares", () => {
    const g = geometriaDoMuro(imp({ terreno: ret(0, 0, 100, 80) }), comPortoes([{ posicao: 50, largura: 8 }]))!;
    expect(g).toBeTruthy();
    expect(g.resumo.perimetro).toBeCloseTo(360, 6);
    // Eixo do muro: o contorno deslocado meia espessura (mais a folga) para dentro — cada canto encurta 2δ.
    const d = 0.1 + FOLGA_DIVISA;
    expect(g.resumo.comprimento).toBeCloseTo(360 - 8 * d - 8, 6);
    expect(comprimentoDosTrechos(g)).toBeCloseTo(g.resumo.comprimento, 0);
    expect(g.trechos.length).toBe(1); // um trecho só: o portão é a única abertura
    expect(g.malhas.muro?.indices.length).toBeGreaterThan(0);
    expect(g.malhas.capa?.indices.length).toBeGreaterThan(0);
    expect(g.malhas.portao?.indices.length).toBeGreaterThan(0);
    expect(g.resumo.aberturas).toEqual([{ id: "p1", tipo: "veiculos", posicao: 50, largura: 8, principal: true, area: 0 }]);
    // Sem portão: o muro dá a volta inteira e o trecho fecha no ponto de partida.
    const fechado = geometriaDoMuro(imp({ terreno: ret(0, 0, 100, 80) }), comPortoes([]))!;
    expect(fechado.resumo.comprimento).toBeCloseTo(360 - 8 * d, 6);
    const t = fechado.trechos[0];
    expect(Math.hypot(t[0].x - t[t.length - 1].x, t[0].y - t[t.length - 1].y)).toBeLessThan(1e-6);
  });

  it("côncavo (em L): cantos fechados, muro todo dentro do terreno e da altura pedida", () => {
    const g = geometriaDoMuro(imp({ terreno: L }), comPortoes([{ posicao: 20, largura: 6 }], { altura: 3, espessura: 0.25, recuo: 0.5 }))!;
    // Eixo a δ = 0,625 m (mais a folga) da divisa: 5 cantos convexos encurtam 2δ cada e o reentrante alonga 2δ.
    const d = 0.625 + FOLGA_DIVISA;
    expect(g.resumo.comprimento).toBeCloseTo(perimetro(L) - 6 - 4 * 2 * d, 6);
    for (const v of vertices(g)) {
      expect(dentroDe(v, L), `(${v.x}, ${v.y})`).toBe(true);
      expect(distanciaAoContorno(v, L)).toBeGreaterThanOrEqual(0.5 - 1e-6);
    }
    for (const v of vertices(g, "capa")) expect(dentroDe(v, L)).toBe(true);
    // Topo da capa = 3 m + 6 cm (terreno plano); pé enterrado 30 cm.
    const hs = vertices(g).map(v => v.h);
    expect(Math.min(...hs)).toBeCloseTo(-ENTERRO_MURO, 6);
    expect(Math.max(...vertices(g, "capa").map(v => v.h))).toBeCloseTo(3 + 0.25 + 0.06, 6); // capa do pilar do portão
    // Canto reentrante (40, 40): o muro passa nele sem fresta — o eixo dobra na meia-esquadria, a 0,625 m de cada lado.
    const eixo = g.trechos.flat();
    expect(Math.min(...eixo.map(p => Math.hypot(p.x - (40 - d), p.y - (40 - d))))).toBeLessThan(1e-6);
  });

  it("sentido horário e anti-horário dão o mesmo muro (portão na mesma posição medida no desenho)", () => {
    const anti = L, horario = [L[0], ...L.slice(1).reverse()];
    const a = geometriaDoMuro(imp({ terreno: anti }), comPortoes([{ posicao: 30, largura: 6 }]))!;
    const b = geometriaDoMuro(imp({ terreno: horario }), comPortoes([{ posicao: perimetro(L) - 30, largura: 6 }]))!;
    expect(b.resumo.comprimento).toBeCloseTo(a.resumo.comprimento, 6);
    expect(b.resumo.vertices).toBe(a.resumo.vertices);
    const caixa = (g: GeometriaMuro) => { const vs = vertices(g); return [Math.min(...vs.map(v => v.x)), Math.max(...vs.map(v => v.x)), Math.min(...vs.map(v => v.y)), Math.max(...vs.map(v => v.y))]; };
    caixa(b).forEach((v, i) => expect(v).toBeCloseTo(caixa(a)[i], 6));
    // O portão abre o mesmo vão: (30 ± 3) no lado de cima, nos dois casos.
    for (const g of [a, b]) for (const v of vertices(g)) if (v.y < 1) expect(v.x <= 27 + 1e-4 || v.x >= 33 - 1e-4, `(${v.x}, ${v.y})`).toBe(true);
    // Portões automáticos também coincidem (a rua sai pelo lado de cima).
    const rua = [ret(54, -10, 66, 30)];
    const pa = portoesAutomaticos(imp({ terreno: anti, ruas: rua })), pb = portoesAutomaticos(imp({ terreno: horario, ruas: rua }));
    expect(pa.portoes.length).toBe(1);
    expect(pb.portoes[0].posicao).toBeCloseTo(perimetro(L) - pa.portoes[0].posicao, 1);
    expect(pb.portoes[0].largura).toBeCloseTo(pa.portoes[0].largura, 6);
  });

  it("acompanha o relevo: pé na cota da malha do terreno (menos a fundação) e topo a altura constante", () => {
    const relevo = { x0: -10, y0: -10, dx: 4, dy: 4, colunas: 31, linhas: 31, alturas: Array.from({ length: 31 * 31 }, (_, k) => 0.08 * (k % 31) * 4 + 3 * Math.sin((Math.floor(k / 31) * 4) / 20)), altitudeBase: 0 };
    const i = imp({ terreno: ret(0, 0, 100, 100), relevo });
    const g = geometriaDoMuro(i, comPortoes([{ posicao: 50, largura: 6 }]))!;
    const caixa = caixaDoTerreno(i);
    const ms = vertices(g);
    let pes = 0;
    for (const v of ms) {
      const chao = alturaNaMalha(relevo, caixa, v.x, v.y);
      // Todo vértice do corpo do muro fica entre o pé enterrado e o topo (2,5 m acima do chão, mais o pilar do portão).
      expect(v.h).toBeGreaterThanOrEqual(chao - ENTERRO_MURO - 0.1);
      expect(v.h).toBeLessThanOrEqual(chao + 2.5 + 0.25 + 0.1);
      // Os pés: abaixo do chão, sempre na fundação (nunca flutuando acima do terreno).
      if (v.h < chao) { pes++; expect(v.h).toBeCloseTo(chao - ENTERRO_MURO, 1); }
      // A malha do terreno é a interpolação do relevo: a diferença para alturaDoRelevo é pequena.
      expect(Math.abs(chao - alturaDoRelevo(relevo, v.x, v.y))).toBeLessThan(0.15);
    }
    expect(pes).toBeGreaterThan(ms.length / 3);
    // Topo da capa: 2,5 m + 6 cm acima do chão no eixo, em todo o percurso.
    for (const v of vertices(g, "capa")) {
      const chao = alturaNaMalha(relevo, caixa, v.x, v.y);
      expect(v.h).toBeGreaterThan(chao + 2.4);
    }
  });

  it("contorno de 4.000 pontos: rápido, dentro do orçamento de vértices e fechado", () => {
    const n = 4000, pts: Ponto[] = [];
    for (let k = 0; k < n; k++) { const t = (2 * Math.PI * k) / n, r = 220 + 35 * Math.sin(3 * t) + 12 * Math.cos(7 * t) + 3 * Math.sin(29 * t); pts.push({ x: 300 + r * Math.cos(t), y: 300 + r * Math.sin(t) }); }
    const i = imp({ terreno: pts });
    const t0 = performance.now();
    const g = geometriaDoMuro(i, comPortoes([{ posicao: 100, largura: 10 }]))!;
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(2500);
    expect(g.resumo.vertices).toBeLessThan(400_000);
    expect(g.resumo.comprimento).toBeGreaterThan(perimetroDoTerreno(pts) - 10 - 5);
    expect(g.resumo.comprimento).toBeLessThan(perimetroDoTerreno(pts) - 10);
    // Amostra: nenhum vértice fora do terreno.
    const vs = vertices(g);
    for (let k = 0; k < vs.length; k += 37) expect(noTerreno(vs[k], pts)).toBe(true);
  });

  it("sem contorno do terreno: não há muro (nada é inventado)", () => {
    expect(geometriaDoMuro(imp({ terreno: [] }), muro())).toBeNull();
    expect(geometriaDoMuro(imp({ terreno: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }), muro())).toBeNull();
    expect(portoesAutomaticos(imp({ terreno: [] })).portoes).toEqual([]);
  });
});

describe("portão automático", () => {
  it("rua que sai pela divisa: portão no eixo dela, da largura do leito, e nenhum muro no corredor da rua", () => {
    // Terreno 120 × 90; rua de 12 m entrando pelo lado de baixo (y = 90) em x = 60, e uma rua interna transversal.
    const ruas = [ret(54, 30, 66, 95), ret(10, 24, 110, 36)];
    const i = imp({ terreno: ret(0, 0, 120, 90), ruas });
    const auto = portoesAutomaticos(i);
    expect(auto.portoes.length).toBe(1);
    const p = auto.portoes[0];
    // Posição ao longo do desenho: 120 (lado de cima) + 90 (direita) + (120 − 60) no lado de baixo.
    expect(p.posicao).toBeCloseTo(120 + 90 + 60, 0);
    expect(p.largura).toBeCloseTo(12 + 2 * FOLGA_PORTAO, 1);
    const g = geometriaDoMuro(i, muro())!;
    expect(g.resumo.aberturas[0].principal).toBe(true);
    // Corredor da rua junto da divisa: nada do muro (corpo e capa) entre x 54 e 66.
    for (const v of [...vertices(g), ...vertices(g, "capa")]) if (v.y > 85) expect(v.x <= 54 + 1e-6 || v.x >= 66 - 1e-6, `(${v.x}, ${v.y})`).toBe(true);
    // A folha do portão (aberta) também não fica no corredor.
    for (const v of vertices(g, "portao")) expect(v.x <= 54 || v.x >= 66).toBe(true);
  });

  it("com os acessos do estudo de massa: portaria no acesso principal (via pública mapeada) e portão secundário nos outros", () => {
    const ruas = [ret(54, 30, 66, 95), ret(-5, 39, 30, 51), ret(10, 24, 110, 36)];
    const i = imp({ terreno: ret(0, 0, 120, 90), ruas, acessos: [{ x: 0, y: 45, viaExistente: false }, { x: 60, y: 90, viaExistente: true, distancia: 12 }] });
    const auto = portoesAutomaticos(i);
    expect(auto.portoes[0].posicao).toBeCloseTo(270, 0);
    expect(auto.candidatos.length).toBe(2);
    expect(auto.candidatos[1].posicao).toBeCloseTo(120 + 90 + 120 + 45, 0);
    // Toda rua que chega à divisa ganha abertura: a principal é a portaria, a outra, portão secundário.
    expect(auto.portoes.map(p => p.posicao)).toEqual(auto.candidatos.map(p => p.posicao));
    expect(auto.notas.join(" ")).toMatch(/2 ruas chegam à divisa/);
    const g = geometriaDoMuro(i, muro())!;
    expect(g.resumo.aberturas.filter(a => a.principal).map(a => a.posicao)).toEqual([auto.portoes[0].posicao]);
  });

  it("nenhuma rua encosta na divisa: portão no ponto mais perto da rua principal, com nota", () => {
    const i = imp({ terreno: ret(0, 0, 120, 90), ruas: [ret(20, 50, 100, 62)] });
    const auto = portoesAutomaticos(i);
    expect(auto.portoes.length).toBe(1);
    expect(auto.notas.join(" ")).toMatch(/Nenhuma rua chega à divisa/);
    // O ponto do eixo (y = 56) mais perto da divisa fica a 20 m do lado esquerdo ou direito, ou a 34 m do de baixo:
    // o portão vai para um dos lados verticais.
    const g = geometriaDoMuro(i, muro())!;
    const ab = g.resumo.aberturas[0];
    const u = ab.posicao; // lado direito: 120..210; lado esquerdo: 330..420
    expect((u > 120 && u < 210) || (u > 330 && u < 420)).toBe(true);
  });

  it("estudo de massa real (grade): o portão sai numa rua que chega à divisa e o muro fica dentro do terreno", () => {
    const centro: [number, number] = [-49.25, -16.68];
    const m = 1 / 111320, cosLat = Math.cos((centro[1] * Math.PI) / 180);
    const anel = [[0, 0], [300, 20], [320, 200], [150, 240], [-10, 210], [0, 0]].map(([x, y]) => [centro[0] + (x * m) / cosLat, centro[1] + y * m]);
    const geojson = JSON.stringify({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [anel] } });
    const est = gerarEstudoMassa(anel, centro, { larguraViaM: 12, testadaLoteM: 10, profundidadeLoteM: 25, loteMinimoM2: 200, comprimentoMaxQuadraM: 150, percentInstitucional: 0.05, percentAreaVerde: 0.1, precoM2Lote: 500, tipologia: "grid" } as ParametrosMassa, { nCenarios: 1 });
    const i = implantacaoDoEstudo(geojson, centro, est.cenarios[0], null)!.implantacao;
    expect(i.acessos?.length).toBeGreaterThan(0);
    const sv = sistemaViario(i);
    const g = geometriaDoMuro(i, muro(), { sistema: sv })!;
    // Na grade, as ruas terminam na divisa: cada uma ganha abertura, e só uma é a portaria.
    const auto = portoesAutomaticos(i, muro(), sv);
    expect(g.resumo.aberturas.length).toBe(auto.portoes.length);
    expect(g.resumo.aberturas.length).toBeGreaterThan(1);
    expect(g.resumo.aberturas.filter(a => a.principal).length).toBe(1);
    expect(auto.portoes[0].posicao).toBe(g.resumo.aberturas.find(a => a.principal)!.posicao);
    // O centro de cada portão fica a menos de 3 m do eixo de alguma rua (nenhum portão "no nada").
    for (const q of pontosDosPortoes(i, auto.portoes)) expect(Math.min(...sv.trechos.map(t => distanciaAPolilinha(q!, t.eixo)))).toBeLessThan(3);
    for (const v of vertices(g)) expect(noTerreno(v, i.terreno)).toBe(true);
    // Os lotes continuam intactos e não há muro entre eles: todo vértice do muro fica a menos de 1 m da divisa.
    for (const v of vertices(g)) expect(distanciaAoContorno(v, i.terreno)).toBeLessThan(1);
  }, 60_000);
});

describe("modelo e regras do tipo", () => {
  const base = (tipo: ModeloMaquete["tipo"], o: Partial<Implantacao> = {}) => modeloSchema.parse({ tipo, implantacao: { terreno: ret(0, 0, 50, 40), ...o } });

  it("maquete antiga (sem muro nem acessos) continua abrindo: condomínio vale com muro automático, casa sem", () => {
    const antigo = JSON.stringify({ versao: 1, tipo: "condominio", edificacoes: [], implantacao: { terreno: ret(0, 0, 50, 40), ruas: [], lotes: [], posicoes: [] }, pendencias: [] });
    const m = lerModelo(antigo)!;
    expect(m).toBeTruthy();
    expect(m.implantacao?.muro ?? null).toBeNull();
    expect(m.implantacao?.acessos ?? []).toEqual([]);
    expect(muroDaMaquete(m)?.ativo).toBe(true);
    expect(muroDaMaquete(m)?.portoesEditados).toBe(false);
    expect(muroDaMaquete(base("casa"))).toBeNull();
    expect(muroDaMaquete(base("loteamento"))).toBeNull();
    expect(muroDaMaquete(base("predio"))).toBeNull();
  });

  it("trocar o tipo: condomínio liga o muro; sair dele desliga o automático, mas mantém o editado", () => {
    expect(muroParaTipo("condominio", null)?.ativo).toBe(true);
    expect(muroParaTipo("casa", muroParaTipo("condominio", null))).toBeNull();
    const editado = muro({ editado: true, altura: 3.2 });
    expect(muroParaTipo("casa", editado)).toEqual(editado);
    // Casa com muro ligado pela pessoa.
    expect(muroDaMaquete(base("casa", { muro: muro({ editado: true }) }))?.ativo).toBe(true);
  });

  it("validação: condomínio com contorno e sem muro é erro; sem contorno é aviso claro, não erro de muro", () => {
    const desligado = base("condominio", { muro: muro({ ativo: false, editado: true }) });
    expect(validarModelo(desligado).some(p => p.nivel === "erro" && p.onde === "Muro")).toBe(true);
    expect(validarModelo(base("condominio")).some(p => p.onde === "Muro")).toBe(false);
    const semContorno = modeloSchema.parse({ tipo: "condominio", implantacao: { terreno: [], lotes: [{ id: "l1", poligono: ret(0, 0, 10, 20) }] } });
    const ps = validarModelo(semContorno).filter(p => p.onde === "Muro");
    expect(ps.length).toBe(1);
    expect(ps[0].nivel).toBe("aviso");
    expect(ps[0].mensagem).toMatch(/Sem o contorno do terreno/);
    // Casa sem muro: nada a dizer.
    expect(validarModelo(base("casa")).some(p => p.onde.startsWith("Muro"))).toBe(false);
    // Portão editado fora da divisa e sem portão de veículos: avisos.
    const fora = base("condominio", { muro: comPortoes([{ posicao: 500, largura: 2, tipo: "pedestres" }], { editado: true }) });
    const avisos = validarModelo(fora).filter(p => p.onde.startsWith("Muro"));
    expect(avisos.some(p => /Fora da divisa/.test(p.mensagem))).toBe(true);
    expect(avisos.some(p => /portão de veículos/.test(p.mensagem))).toBe(true);
    expect(avisos.every(p => p.nivel === "aviso")).toBe(true);
  });
});
