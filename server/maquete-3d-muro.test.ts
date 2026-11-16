// Maquete 3D (EPIC-024, S-04): muro de divisa do condomínio — geometria fechada no contorno (quadrado e côncavo),
// por dentro do terreno, aberta no portão onde a rua sai, igual nos dois sentidos de desenho, assentada no relevo,
// rápida com 4.000 pontos; regras do tipo (condomínio liga, casa não) e validação sem contorno.
import { describe, expect, it } from "vitest";
import { gerarEstudoMassa, type ParametrosMassa } from "../shared/incorporacao/massa.js";
import { implantacaoDoEstudo } from "../shared/maquete-3d/implantacao.js";
import {
  alturaDoRelevo, assinaturaDoContorno, comMuroGravado, implantacaoSchema, lerModelo, modeloParaLinkPublico, modeloSchema, muroDaMaquete, muroParaTipo, muroSchema, publicadoSemMuro, validarModelo,
  type Implantacao, type ModeloMaquete, type Muro, type Ponto,
} from "../shared/maquete-3d/modelo.js";
import { ENTERRO_MURO, FOLGA_DIVISA, FOLGA_PORTAO, geometriaDoMuro, perimetroDoTerreno, pontosDosPortoes, portoesAutomaticos, reancorarPortoes, ruasFechadasPeloMuro, validarComMuro, type GeometriaMuro } from "../shared/maquete-3d/muro.js";
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

  it("com os acessos do estudo de massa: portaria só no acesso ligado à via pública; ponto de divisa sem via fica fechado", () => {
    const ruas = [ret(54, 30, 66, 95), ret(-5, 39, 30, 51), ret(10, 24, 110, 36)];
    const i = imp({ terreno: ret(0, 0, 120, 90), ruas, acessos: [{ x: 0, y: 45, viaExistente: false }, { x: 60, y: 90, viaExistente: true, distancia: 12, nomeVia: "Av. Brasil" }] });
    const auto = portoesAutomaticos(i);
    expect(auto.portoes.map(p => p.posicao)).toEqual([270]);
    expect(auto.notas.join(" ")).toMatch(/Portaria no acesso pela via Av\. Brasil/);
    // O ponto (0, 45) não tem via pública: não é acesso; a rua que termina ali é fechada pelo muro.
    expect(auto.ruasFechadas.map(p => p.posicao)).toEqual([375]);
    expect(auto.candidatos.map(p => p.posicao)).toEqual([270, 375]);
    const g = geometriaDoMuro(i, muro())!;
    expect(g.resumo.aberturas.map(a => [a.posicao, a.principal])).toEqual([[270, true]]);
    expect(vertices(g).some(v => v.x < 1 && Math.abs(v.y - 45) < 3)).toBe(true);
    // Dois acessos reais: o mais perto da via é a portaria, o outro é portão secundário.
    const dois = imp({ ...i, acessos: [{ x: 0, y: 45, viaExistente: true, distancia: 30 }, { x: 60, y: 90, viaExistente: true, distancia: 12 }] });
    const g2 = geometriaDoMuro(dois, muro())!;
    expect(g2.resumo.aberturas.map(a => [a.posicao, a.principal])).toEqual([[270, true], [375, false]]);
    expect(portoesAutomaticos(dois).ruasFechadas).toEqual([]);
  });

  it("nenhuma rua encosta na divisa: portão no ponto mais perto da rua principal, com nota", () => {
    const i = imp({ terreno: ret(0, 0, 120, 90), ruas: [ret(20, 50, 100, 62)] });
    const auto = portoesAutomaticos(i);
    expect(auto.portoes.length).toBe(1);
    expect(auto.notas.join(" ")).toMatch(/não tem acesso ligado a uma via pública.*no ponto da divisa mais perto da rua principal.*Confira/);
    // O ponto do eixo (y = 56) mais perto da divisa fica a 20 m do lado esquerdo ou direito, ou a 34 m do de baixo:
    // o portão vai para um dos lados verticais.
    const g = geometriaDoMuro(i, muro())!;
    const ab = g.resumo.aberturas[0];
    const u = ab.posicao; // lado direito: 120..210; lado esquerdo: 330..420
    expect((u > 120 && u < 210) || (u > 330 && u < 420)).toBe(true);
  });

  it("estudo de massa real (grade): condomínio fechado — uma portaria; as ruas que só terminam na divisa ficam fechadas, com UM aviso", () => {
    const centro: [number, number] = [-49.25, -16.68];
    const m = 1 / 111320, cosLat = Math.cos((centro[1] * Math.PI) / 180);
    const anel = [[0, 0], [300, 20], [320, 200], [150, 240], [-10, 210], [0, 0]].map(([x, y]) => [centro[0] + (x * m) / cosLat, centro[1] + y * m]);
    const geojson = JSON.stringify({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [anel] } });
    const est = gerarEstudoMassa(anel, centro, { larguraViaM: 12, testadaLoteM: 10, profundidadeLoteM: 25, loteMinimoM2: 200, comprimentoMaxQuadraM: 150, percentInstitucional: 0.05, percentAreaVerde: 0.1, precoM2Lote: 500, tipologia: "grid" } as ParametrosMassa, { nCenarios: 1 });
    const i = implantacaoDoEstudo(geojson, centro, est.cenarios[0], null)!.implantacao;
    expect(i.acessos?.length).toBeGreaterThan(0);
    const sv = sistemaViario(i);
    const g = geometriaDoMuro(i, muro(), { sistema: sv })!;
    // A grade traça as ruas "de divisa a divisa", mas sem via pública mapeada nenhum ponto é acesso: 1 portaria
    // (1 + o número de acessos reais, que aqui é zero), e as outras ruas terminam no muro.
    const reais = (i.acessos ?? []).filter(a => a.viaExistente).length;
    expect(reais).toBe(0);
    const auto = portoesAutomaticos(i, muro(), sv);
    expect(g.resumo.aberturas.length).toBe(1 + reais);
    expect(g.resumo.aberturas[0].principal).toBe(true);
    expect(auto.ruasFechadas.length).toBeGreaterThan(5);
    // A portaria fica na ponta de uma rua (a menos de 3 m do eixo dela), não "no nada".
    const [q] = pontosDosPortoes(i, auto.portoes);
    expect(Math.min(...sv.trechos.map(t => distanciaAPolilinha(q!, t.eixo)))).toBeLessThan(3);
    // Validação: UM aviso com a contagem (não é erro e não se repete por rua).
    const modelo = modeloSchema.parse({ tipo: "condominio", implantacao: i });
    const avisos = validarComMuro(modelo).filter(p => /terminam no muro/.test(p.mensagem));
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ nivel: "aviso", onde: "Muro" });
    expect(avisos[0].mensagem).toMatch(new RegExp(`^${auto.ruasFechadas.length} rua\\(s\\)`));
    expect(validarComMuro(modelo).some(p => p.nivel === "erro" && p.onde.startsWith("Muro"))).toBe(false);
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

// ── Correções do QA (gate 1, 16/11/2026) ──

/** Maior distância de um vértice do muro para fora do terreno (0 = nenhum fora). */
function maiorSaida(g: GeometriaMuro, pol: Ponto[]) {
  let m = 0;
  for (const mat of ["muro", "capa", "portao"] as const) for (const v of vertices(g, mat)) if (!dentroDe(v, pol)) m = Math.max(m, distanciaAoContorno(v, pol));
  return m;
}

describe("QA: muro em todas as áreas do terreno", () => {
  it("KML com duas áreas separadas: as duas viram contorno, cada uma com o seu muro e o seu portão", () => {
    const centro: [number, number] = [0.0005, 0.0005], g = 0.001;
    const anel = (x0: number, y0: number, x1: number, y1: number) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
    const geojson = JSON.stringify({ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: [[anel(g * 1.5, 0, g * 2, g / 2)], [anel(0, 0, g, g)]] } });
    const cenario = { id: "c", lotes: [
      { anel: anel(g * 0.1, g * 0.1, g * 0.4, g * 0.4), areaM2: 1100, tipo: "vendavel", quadra: "1", numero: "1" },
      { anel: anel(g * 1.6, g * 0.1, g * 1.9, g * 0.4), areaM2: 1100, tipo: "vendavel", quadra: "2", numero: "1" },
    ], ruas: [], vias: [] } as unknown as Parameters<typeof implantacaoDoEstudo>[2];
    const i = implantacaoDoEstudo(geojson, centro, cenario, null)!.implantacao;
    // A maior fica em `terreno` (compatível com tudo o que já lia um contorno só); a outra em `terrenosExtras`.
    expect(perimetro(i.terreno)).toBeCloseTo(4 * 111.3, -1);
    expect(i.terrenosExtras).toHaveLength(1);
    const geo = geometriaDoMuro(i, muro())!;
    expect(geo.resumo.areas.map(a => a.indice)).toEqual([0, 1]);
    expect(geo.resumo.perimetro).toBeCloseTo(perimetro(i.terreno) + perimetro(i.terrenosExtras![0]), 0);
    expect(geo.resumo.aberturas.map(a => [a.area, a.principal])).toEqual([[0, true], [1, true]]);
    // Cada vértice do muro fica junto da divisa de UMA das áreas — nunca entre elas.
    for (const v of vertices(geo)) expect(Math.min(distanciaAoContorno(v, i.terreno), distanciaAoContorno(v, i.terrenosExtras![0]))).toBeLessThan(1);
    expect(vertices(geo).some(v => dentroDe(v, i.terrenosExtras![0]))).toBe(true);
    // Validação: nada de "lote fora do contorno" quando as duas áreas estão na implantação.
    const m = modeloSchema.parse({ tipo: "condominio", implantacao: i });
    expect(validarModelo(m).some(p => /fora do contorno/.test(p.mensagem))).toBe(false);
    // Maquete antiga (só a maior área salva) com lote na outra: aviso para atualizar a implantação.
    const antiga = modeloSchema.parse({ tipo: "condominio", implantacao: { ...i, terrenosExtras: undefined } });
    expect(validarModelo(antiga).find(p => /fora do contorno/.test(p.mensagem))?.mensagem).toMatch(/1 lote\(s\).*Atualize a implantação a partir do estudo/);
  });

  it("portão editado na segunda área abre só a segunda área", () => {
    const i = imp({ terreno: ret(0, 0, 100, 80), terrenosExtras: [ret(150, 0, 200, 40)] });
    const g = geometriaDoMuro(i, muro({ portoesEditados: true, portoes: [{ id: "p1", posicao: 20, largura: 6, tipo: "veiculos" }, { id: "p2", posicao: 25, largura: 4, tipo: "veiculos", area: 1 }] }))!;
    // Área 1: vão de 6 m em x 17..23 no lado de cima; área 2: vão de 4 m em x 173..177.
    for (const v of vertices(g)) if (v.y < 1 && v.x < 120) expect(v.x <= 17 + 1e-4 || v.x >= 23 - 1e-4).toBe(true);
    for (const v of vertices(g)) if (v.y < 1 && v.x > 120) expect(v.x <= 173 + 1e-4 || v.x >= 177 - 1e-4).toBe(true);
    expect(g.resumo.aberturas.map(a => [a.id, a.area, a.principal])).toEqual([["p1", 0, true], ["p2", 1, true]]);
  });
});

describe("QA: condomínio fechado — portão só nos acessos reais", () => {
  const vias = [{ id: "v1", nome: "A", eixo: [{ x: 50, y: 40 }, { x: 50, y: -5 }], largura: 10 }, { id: "v2", nome: "B", eixo: [{ x: 20, y: 40 }, { x: 20, y: -5 }], largura: 8 }];
  const semMuroNoCorredor = (g: GeometriaMuro, x: number, meia: number) => {
    for (const v of [...vertices(g), ...vertices(g, "capa"), ...vertices(g, "portao")]) if (v.y < 1) expect(Math.abs(v.x - x) >= meia - 1e-4, `corredor em ${x} (${v.x})`).toBe(true);
  };

  it("sem acesso real: UMA portaria na rua principal (a mais larga que chega à divisa); a outra rua termina no muro", () => {
    const i = imp({ terreno: ret(0, 0, 100, 80), vias });
    const auto = portoesAutomaticos(i);
    expect(auto.portoes.map(p => p.posicao)).toEqual([50]);
    expect(auto.ruasFechadas.map(p => p.posicao)).toEqual([20]);
    const g = geometriaDoMuro(i, muro())!;
    expect(g.resumo.aberturas.map(a => [a.posicao, a.principal])).toEqual([[50, true]]);
    semMuroNoCorredor(g, 50, 5); // nunca há muro no corredor da rua que leva à portaria
    expect(vertices(g).some(v => v.y < 1 && Math.abs(v.x - 20) < 3)).toBe(true); // a rua B é fechada
    // Rua que atravessa a divisa e segue para fora também é candidata (e, sem outra, vira a portaria).
    const atravessa = imp({ terreno: ret(0, 0, 100, 80), vias: [{ id: "v3", nome: "C", eixo: [{ x: 30, y: 40 }, { x: 30, y: -40 }], largura: 10 }] });
    expect(portoesAutomaticos(atravessa).portoes.map(p => p.posicao)).toEqual([30]);
  });

  it("dois acessos reais: portaria e portão secundário, sem muro nos dois corredores", () => {
    const i = imp({ terreno: ret(0, 0, 100, 80), vias, acessos: [{ x: 20, y: 0, viaExistente: true, distancia: 15 }, { x: 50, y: 0, viaExistente: true, distancia: 5 }] });
    const g = geometriaDoMuro(i, muro())!;
    expect(g.resumo.aberturas.map(a => [a.posicao, a.principal])).toEqual([[50, true], [20, false]]);
    semMuroNoCorredor(g, 50, 5);
    semMuroNoCorredor(g, 20, 4);
  });

  it("abrir portão numa rua fechada (editor) tira o muro do corredor dela; o aviso de ruas fechadas some", () => {
    const i = imp({ terreno: ret(0, 0, 100, 80), vias });
    const auto = portoesAutomaticos(i);
    const m = modeloSchema.parse({ tipo: "condominio", implantacao: i });
    expect(validarComMuro(m).filter(p => /terminam no muro/.test(p.mensagem)).map(p => p.mensagem)).toEqual([expect.stringMatching(/^1 rua\(s\)/)]);
    const aberto = muro({ editado: true, portoesEditados: true, portoes: [...auto.portoes, { ...auto.ruasFechadas[0], id: "p2" }] });
    const g = geometriaDoMuro(i, aberto)!;
    semMuroNoCorredor(g, 20, 4);
    expect(ruasFechadasPeloMuro(i, aberto)).toEqual([]);
    expect(validarComMuro(modeloSchema.parse({ tipo: "condominio", implantacao: { ...i, muro: aberto } })).some(p => /terminam no muro/.test(p.mensagem))).toBe(false);
  });
});

describe("QA: contornos hostis", () => {
  const casos: [string, Ponto[]][] = [
    ["agulha", [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 0, y: 3 }]],
    ["ponta de 3°", [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 200, y: 45 }, { x: 100, y: 45.5 }, { x: 100, y: 80 }, { x: 0, y: 80 }]],
    ["buraco de fechadura (encosta em si)", [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 50, y: 100 }, { x: 50, y: 50 }, { x: 60, y: 60 }, { x: 50, y: 100 }, { x: 0, y: 100 }]],
    ["faixa de 0,3 m", ret(0, 0, 100, 0.3)],
    ["serrilhado de 4.000 pontos", Array.from({ length: 4000 }, (_, k) => { const a = (2 * Math.PI * k) / 4000, r = 150 + (k % 2 ? 3 : 0); return { x: r * Math.cos(a), y: r * Math.sin(a) }; })],
  ];
  for (const [nome, pol] of casos) it(`${nome}: nenhum vértice do muro fora do terreno`, () => {
    const g = geometriaDoMuro(imp({ terreno: pol }), muro())!;
    expect(g).toBeTruthy();
    expect(maiorSaida(g, pol)).toBeLessThan(1e-3); // conferência exaustiva (lenta no serrilhado: 240 mil vértices × 4.000 lados)
  }, 60_000);

  it("gravata-borboleta (sem área): erro de validação claro, em vez de condomínio sem muro calado", () => {
    const borboleta = [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 50, y: 0 }, { x: 0, y: 50 }];
    expect(geometriaDoMuro(imp({ terreno: borboleta }), muro())).toBeNull();
    const ps = validarModelo(modeloSchema.parse({ tipo: "condominio", implantacao: { terreno: borboleta } }));
    expect(ps.find(p => p.nivel === "erro" && p.onde === "Muro")?.mensagem).toMatch(/não tem área.*gravata-borboleta/);
    // Contorno que se cruza mas tem área: aviso (o muro sai, mas torto).
    const cruzado = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 60, y: -20 }, { x: 0, y: 100 }];
    expect(validarModelo(modeloSchema.parse({ tipo: "condominio", implantacao: { terreno: cruzado } })).some(p => p.nivel === "aviso" && /se cruza/.test(p.mensagem))).toBe(true);
    expect(validarModelo(modeloSchema.parse({ tipo: "condominio", implantacao: { terreno: L } })).some(p => /se cruza|não tem área/.test(p.mensagem))).toBe(false);
  });
});

describe("QA: relevo íngreme sem fresta sob o muro", () => {
  const grade = (f: (x: number, y: number) => number, lado = 110) => {
    const dx = lado / 95, alturas: number[] = [];
    for (let j = 0; j < 96; j++) for (let k = 0; k < 96; k++) alturas.push(f(-5 + k * dx, -5 + j * dx));
    return { x0: -5, y0: -5, dx, dy: dx, colunas: 96, linhas: 96, alturas, altitudeBase: 0 };
  };
  for (const [nome, f] of [["vala a 45° fora das estações", (x: number) => Math.abs(x - 50.7)], ["barranco 2:1", (x: number) => Math.min(2, Math.max(0, (x - 30) * 2))]] as const) {
    it(`${nome}: o pé de cada face fica sempre abaixo do chão`, () => {
      const relevo = grade(f), i = imp({ terreno: ret(0, 0, 100, 80), relevo }), caixa = caixaDoTerreno(i);
      const m = geometriaDoMuro(i, comPortoes([]))!.malhas.muro!;
      let fresta = -Infinity;
      for (let q = 0; q < m.posicoes.length / 12; q++) {
        const p = (k: number) => ({ x: m.posicoes[q * 12 + k * 3], h: m.posicoes[q * 12 + k * 3 + 1], y: m.posicoes[q * 12 + k * 3 + 2] });
        const a = p(0), b = p(1), d = p(3);
        if (Math.hypot(b.x - a.x, b.y - a.y) < 0.05 || d.h - a.h < 1) continue;
        for (let s = 0; s <= 20; s++) { const t = s / 20; fresta = Math.max(fresta, a.h + (b.h - a.h) * t - alturaNaMalha(relevo, caixa, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)); }
      }
      expect(fresta).toBeLessThan(-0.3); // o pé fica enterrado (a fundação de 0,5 m inteira, menos a tolerância)
    });
  }
});

describe("QA: portões editados quando o contorno muda", () => {
  it("cada portão vai ao ponto da nova divisa mais perto de onde estava, e a revisão avisa", () => {
    const antiga = imp({ terreno: ret(0, 0, 100, 80) });
    const m = muro({ editado: true, portoesEditados: true, portoes: [{ id: "p1", posicao: 50, largura: 6, tipo: "veiculos" }], contorno: assinaturaDoContorno(antiga) });
    // O terreno ganha 10 m a oeste: o mesmo ponto (50, 0) agora está a 60 m do novo vértice 1.
    const nova = imp({ terreno: ret(-10, 0, 100, 80) });
    const r = reancorarPortoes(antiga, nova, m);
    expect(r.mudou).toBe(true);
    expect(r.muro!.portoes[0].posicao).toBeCloseTo(60, 6);
    expect(r.muro!.reancorado).toBe(true);
    expect(validarModelo(modeloSchema.parse({ tipo: "condominio", implantacao: { ...nova, muro: r.muro } })).some(p => /foram levados ao ponto da nova divisa/.test(p.mensagem))).toBe(true);
    // Sem mudança no contorno, nada muda.
    expect(reancorarPortoes(antiga, antiga, m).mudou).toBe(false);
    // Assinatura guardada e contorno diferente (mudado por outro caminho): aviso para conferir.
    expect(validarModelo(modeloSchema.parse({ tipo: "condominio", implantacao: { ...nova, muro: m } })).some(p => /mudou depois que os portões foram editados/.test(p.mensagem))).toBe(true);
  });
});

describe("QA: link publicado antes do muro", () => {
  it("o link público desenha o modelo salvo sem muro como antes; salvar/publicar gravam o muro do tipo", () => {
    const antigo = lerModelo(JSON.stringify({ versao: 1, tipo: "condominio", edificacoes: [], implantacao: { terreno: ret(0, 0, 50, 40) }, pendencias: [] }))!;
    expect(publicadoSemMuro(antigo)).toBe(true);
    expect(muroDaMaquete(modeloParaLinkPublico(antigo))).toBeNull();
    expect(muroDaMaquete(antigo)?.ativo).toBe(true); // na revisão aparece o automático
    const gravado = comMuroGravado(antigo);
    expect(gravado.implantacao!.muro?.ativo).toBe(true);
    expect(publicadoSemMuro(gravado)).toBe(false);
    expect(muroDaMaquete(modeloParaLinkPublico(gravado))?.ativo).toBe(true);
    // Casa sem muro continua sem.
    const casa = modeloSchema.parse({ tipo: "casa", implantacao: { terreno: ret(0, 0, 50, 40) } });
    expect(muroDaMaquete(modeloParaLinkPublico(comMuroGravado(casa)))).toBeNull();
  });
});

describe("QA: campos numéricos do editor do muro", () => {
  it("só limitam a faixa ao confirmar: o texto digitado fica como está até sair do campo", async () => {
    const { numeroConfirmado } = await import("../client/src/components/maquete-3d/EditorMuro.js");
    // Durante a digitação nada é chamado; ao confirmar "1" (a caminho de "1,2"), aí sim vale o mínimo de 1,8.
    expect(numeroConfirmado("2,75", 2.5, [1.8, 4])).toBe(2.75);
    expect(numeroConfirmado("1", 2.5, [1.8, 4])).toBe(1.8);
    expect(numeroConfirmado("9", 2.5, [1.8, 4])).toBe(4);
    expect(numeroConfirmado("", 2.5, [1.8, 4])).toBe(2.5);
    expect(numeroConfirmado("abc", 0.2, [0.1, 0.5])).toBe(0.2);
    expect(numeroConfirmado("0.123", 0.2, [0.1, 0.5])).toBe(0.12);
  });
});
