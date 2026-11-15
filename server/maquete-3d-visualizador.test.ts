// Maquete 3D (EPIC-022, etapa 2): geometria do visualizador (paredes recortadas, colisão, escadas, cobertura,
// roteiro do tour) e motor de mobília (o que entra em cada cômodo e sem bloquear portas nem sobrepor móveis).
import { describe, expect, it } from "vitest";
import { modeloSchema, type Pavimento } from "../shared/maquete-3d/modelo.js";
import {
  apoio, blocosDaParede, comodoEm, cruzaParede, destaqueDoComodo, entrada, resolverColisao, rota, roteiroTour, segmentosDeColisao, telhado, topoDaEdificacao,
} from "../shared/maquete-3d/geometria3d.js";
import { eixoDaCaracol, fracaoDaSubida, percursoDaEscada, trechosDaEscada } from "../shared/maquete-3d/escadas.js";
import { mobiliarComodo, mobiliarPavimento, sobrepoe, type PecaMobilia } from "../shared/maquete-3d/mobilia.js";

const R = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const P = (id: string, ax: number, ay: number, bx: number, by: number, externa = false) => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, espessura: externa ? 0.2 : 0.12, externa });
const A = (id: string, paredeId: string, tipo: string, posicao: number, largura: number, extra = {}) => ({ id, paredeId, tipo, posicao, largura, altura: tipo === "janela" ? 1.2 : 2.1, peitoril: tipo === "janela" ? 1 : 0, ...extra });

// Sobrado 8 × 10 m: térreo com sala, cozinha, banheiro e hall com escada; superior com suíte, quarto e circulação.
const modelo = modeloSchema.parse({
  tipo: "casa",
  edificacoes: [{
    id: "ed1", nome: "Casa", cobertura: { tipo: "quatro_aguas", inclinacao: 30, beiral: 0.6 },
    pavimentos: [{
      id: "t", nome: "Térreo", nivel: 0, peDireito: 2.8,
      paredes: [P("p1", 0, 0, 8, 0, true), P("p2", 8, 0, 8, 10, true), P("p3", 8, 10, 0, 10, true), P("p4", 0, 10, 0, 0, true), P("p5", 0, 6, 8, 6), P("p6", 5, 6, 5, 10), P("p7", 5.5, 0, 5.5, 2.5), P("p8", 5.5, 2.5, 8, 2.5)],
      aberturas: [A("a1", "p3", "porta", 1.5, 0.9, { entradaPrincipal: true }), A("a2", "p1", "janela", 2.5, 1.6), A("a3", "p5", "porta", 6.5, 0.8), A("a4", "p8", "porta", 0.6, 0.7), A("a5", "p5", "vao", 2.5, 1.2), A("a6", "p4", "janela", 2, 1.5)],
      comodos: [
        { id: "sala", nome: "Sala", funcao: "sala", poligono: [{ x: 0.1, y: 0.1 }, { x: 5.44, y: 0.1 }, { x: 5.44, y: 2.56 }, { x: 7.9, y: 2.56 }, { x: 7.9, y: 5.94 }, { x: 0.1, y: 5.94 }] },
        { id: "wc", nome: "Banheiro", funcao: "banheiro", poligono: R(5.56, 0.1, 2.34, 2.34) },
        { id: "coz", nome: "Cozinha", funcao: "cozinha", poligono: R(0.1, 6.06, 4.84, 3.84) },
        { id: "hall", nome: "Hall", funcao: "hall", poligono: R(5.06, 6.06, 2.84, 3.84) },
      ],
      escadas: [{ id: "e1", tipo: "reta", poligono: R(6.9, 6.2, 1, 3.6), inicio: { x: 7.4, y: 9.8 }, fim: { x: 7.4, y: 6.2 }, largura: 1, destinoPavimentoId: "s" }],
    }, {
      id: "s", nome: "Superior", nivel: 2.95, peDireito: 2.7,
      paredes: [P("p1", 0, 0, 8, 0, true), P("p2", 8, 0, 8, 10, true), P("p3", 8, 10, 0, 10, true), P("p4", 0, 10, 0, 0, true), P("p5", 0, 5, 8, 5), P("p6", 4, 0, 4, 5)],
      aberturas: [A("a1", "p1", "janela", 2, 1.5), A("a2", "p1", "janela", 6, 1.5), A("a3", "p5", "porta", 2, 0.8), A("a4", "p5", "porta", 6, 0.8)],
      comodos: [
        { id: "suite", nome: "Suíte", funcao: "suite", poligono: R(0.1, 0.1, 3.84, 4.84) },
        { id: "q2", nome: "Quarto 2", funcao: "quarto", poligono: R(4.06, 0.1, 3.84, 4.84) },
        { id: "circ", nome: "Circulação", funcao: "circulacao", poligono: R(0.1, 5.06, 7.8, 4.84) },
      ],
    }],
  }],
});
const ed = modelo.edificacoes[0], [terreo, superior] = ed.pavimentos;

describe("geometria do visualizador", () => {
  it("recorta a parede: cheia nos lados, peitoril e verga na janela, só verga na porta", () => {
    const janela = blocosDaParede(terreo.paredes[0], terreo.aberturas, 2.8);
    expect(janela.map(b => [b.a.x, b.b.x, b.base, +b.altura.toFixed(2)])).toEqual([[0, 1.7, 0, 2.8], [1.7, 3.3, 0, 1], [1.7, 3.3, 2.2, 0.6], [3.3, 8, 0, 2.8]]);
    const porta = blocosDaParede(terreo.paredes[2], terreo.aberturas, 2.8);
    expect(porta.filter(b => b.base === 0).length).toBe(2); // nada embaixo da porta
    expect(porta.some(b => b.base === 2.1 && +b.altura.toFixed(2) === 0.7)).toBe(true);
  });

  it("colisão: janela barra, porta deixa passar; o visitante é empurrado para fora da parede", () => {
    const segs = segmentosDeColisao(terreo);
    expect(cruzaParede({ x: 2.5, y: 0.5 }, { x: 2.5, y: -0.5 }, segs)).toBe(true);   // pela janela, não
    expect(cruzaParede({ x: 6.5, y: 9.5 }, { x: 6.5, y: 10.5 }, segs)).toBe(false);  // pela porta de entrada (p3 corre de x=8 a 0: 1,5 m → x=6,5)
    expect(cruzaParede({ x: 3, y: 9.5 }, { x: 3, y: 10.5 }, segs)).toBe(true);
    const p = resolverColisao({ x: 3, y: 0.15 }, 0.3, segs);
    expect(p.y).toBeCloseTo(0.3, 5);
  });

  it("sabe o cômodo, sobe e desce a escada trocando de pavimento", () => {
    expect(comodoEm(terreo, { x: 6.5, y: 1 })?.nome).toBe("Banheiro");
    expect(comodoEm(terreo, { x: 7, y: 4 })?.nome).toBe("Sala");
    expect(apoio(ed, "t", { x: 6, y: 8 })).toEqual({ pavimentoId: "t", y: 0, naEscada: false });
    const meio = apoio(ed, "t", { x: 7.4, y: 8 });
    expect(meio.naEscada).toBe(true);
    expect(meio.y).toBeCloseTo(2.95 / 2, 2);
    expect(apoio(ed, "t", { x: 7.4, y: 6.21 })).toMatchObject({ pavimentoId: "s" });
    expect(apoio(ed, "s", { x: 7.4, y: 8 }).y).toBeCloseTo(2.95 / 2, 2);     // descendo, mesma altura
    expect(apoio(ed, "s", { x: 7.4, y: 9.79 })).toMatchObject({ pavimentoId: "t" });
    expect(apoio(ed, "s", { x: 2, y: 2 })).toEqual({ pavimentoId: "s", y: 2.95, naEscada: false });
  });

  it("cobertura de quatro águas com beiral e cumeeira no lado maior; laje é plana", () => {
    const t = telhado(ed)!;
    const topo = topoDaEdificacao(ed);
    expect(topo).toBeCloseTo(2.95 + 2.7 + 0.15, 5);
    expect(t.altura).toBeCloseTo(((8 + 1.2) / 2) * 0.3, 5);
    expect(t.triangulos.length).toBe(6 * 9);
    const xs = t.triangulos.filter((_, i) => i % 3 === 0), ys = t.triangulos.filter((_, i) => i % 3 === 1);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([-0.6, 8.6]);
    expect(Math.min(...ys)).toBeCloseTo(topo, 5);
    expect(telhado({ ...ed, cobertura: { ...ed.cobertura, tipo: "laje" } })).toMatchObject({ plano: true, altura: 0 });
  });

  it("entrada pela porta principal e roteiro do tour seguindo as portas, térreo antes do superior", () => {
    const e = entrada(ed)!;
    expect(e.pavimentoId).toBe("t");
    expect(comodoEm(terreo, e.dentro)?.nome).toBe("Hall");
    expect(e.fora.y).toBeGreaterThan(10);
    expect(roteiroTour(ed).map(p => p.comodo.nome)).toEqual(["Hall", "Sala", "Banheiro", "Cozinha", "Circulação", "Suíte", "Quarto 2"]);
  });
});

describe("rota do tour", () => {
  it("vai da sala ao banheiro pela porta, sem cruzar parede", () => {
    const r = rota(ed, { pavimentoId: "t", p: { x: 2, y: 3 } }, { pavimentoId: "t", p: { x: 6.7, y: 1.2 } });
    expect(r.length).toBeGreaterThanOrEqual(4);
    const segs = segmentosDeColisao(terreo);
    for (let i = 1; i < r.length; i++) expect(cruzaParede(r[i - 1].p, r[i].p, segs), `trecho ${i}`).toBe(false);
  });
  it("sobe ao pavimento superior pela escada", () => {
    const r = rota(ed, { pavimentoId: "t", p: { x: 2, y: 3 } }, { pavimentoId: "s", p: { x: 2, y: 2 } });
    const troca = r.findIndex(x => x.pavimentoId === "s");
    expect(troca).toBeGreaterThan(0);
    expect(r[troca - 1].p).toEqual({ x: 7.4, y: 9.8 }); // pé da escada
    expect(r[troca].p).toEqual({ x: 7.4, y: 6.2 });     // topo da escada
    expect(r.at(-1)).toEqual({ pavimentoId: "s", p: { x: 2, y: 2 } });
  });
  it("destaque do cômodo só com o que o projeto comprova", () => {
    expect(destaqueDoComodo(terreo, terreo.comodos[0])).toBe("Janela com iluminação natural");
    expect(destaqueDoComodo(terreo, terreo.comodos[1])).toBeNull();
  });
});

describe("escadas com a forma real", () => {
  const base = { id: "e", largura: 1, degraus: null, destinoPavimentoId: "s", origem: "confirmada" as const, percurso: [] };
  const comp = (pts: { x: number; y: number }[]) => pts.slice(1).reduce((t, p, i) => t + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);

  it("em L: dobra na quina, dentro do contorno, com patamar plano", () => {
    // Contorno em L: sobe 3 m para o norte e vira 2 m para o leste.
    const s = { ...base, tipo: "em_l" as const, inicio: { x: 0.5, y: 3.5 }, fim: { x: 3, y: 0.5 }, poligono: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 4 }, { x: 0, y: 4 }] };
    expect(percursoDaEscada(s)).toEqual([{ x: 0.5, y: 3.5 }, { x: 0.5, y: 0.5 }, { x: 3, y: 0.5 }]);
    const t = trechosDaEscada(s);
    expect(t.map(x => x.patamar)).toEqual([false, true, true, false]);
    expect(t[1].de).toBeCloseTo(t[2].ate, 6);                 // o patamar não sobe
    expect(t[0].de).toBe(0); expect(t.at(-1)!.ate).toBeCloseTo(1, 6);
    expect(fracaoDaSubida(s, { x: 0.5, y: 0.5 })).toBeCloseTo(t[1].de, 6); // na quina, altura do patamar
    expect(fracaoDaSubida(s, { x: 3, y: 0.5 })).toBeCloseTo(1, 6);
  });

  it("em U: vai até o fundo, atravessa o patamar e volta", () => {
    const s = { ...base, tipo: "em_u" as const, inicio: { x: 0.5, y: 4 }, fim: { x: 1.5, y: 4 }, poligono: R(0, 0, 2, 4) };
    expect(percursoDaEscada(s)).toEqual([{ x: 0.5, y: 4 }, { x: 0.5, y: 0.5 }, { x: 1.5, y: 0.5 }, { x: 1.5, y: 4 }]);
    const t = trechosDaEscada(s), meio = t.find(x => x.patamar)!;
    expect(meio.de).toBeCloseTo(0.5, 2);                       // o patamar fica a meia altura
    expect(fracaoDaSubida(s, { x: 0.5, y: 2 })).toBeLessThan(0.5);
    expect(fracaoDaSubida(s, { x: 1.5, y: 2 })).toBeGreaterThan(0.5);
  });

  it("caracol: gira em torno do centro, sem patamar", () => {
    const s = { ...base, tipo: "caracol" as const, inicio: { x: 2, y: 1 }, fim: { x: 1, y: 0 }, poligono: R(0, 0, 2, 2) };
    const pts = percursoDaEscada(s);
    expect(pts.length).toBeGreaterThan(10);
    for (const p of pts) expect(Math.hypot(p.x - 1, p.y - 1)).toBeCloseTo(1, 5); // sempre a 1 m do mastro
    expect(comp(pts)).toBeGreaterThan(Math.PI);                 // mais de meia volta
    expect(trechosDaEscada(s).every(t => !t.patamar)).toBe(true);
    expect(eixoDaCaracol(s)).toEqual({ x: 1, y: 1 });
  });

  it("reta continua um lance só; percurso informado é respeitado; o tour sobe pela forma da escada", () => {
    const reta = terreo.escadas[0];
    expect(percursoDaEscada(reta)).toEqual([reta.inicio, reta.fim]);
    expect(percursoDaEscada({ ...reta, percurso: [{ x: 7.4, y: 8 }] })).toEqual([reta.inicio, { x: 7.4, y: 8 }, reta.fim]);
    const emL = { ...ed, pavimentos: [{ ...terreo, escadas: [{ ...reta, tipo: "em_l" as const, poligono: [{ x: 5.9, y: 6.2 }, { x: 7.9, y: 6.2 }, { x: 7.9, y: 9.9 }, { x: 6.9, y: 9.9 }, { x: 6.9, y: 7.2 }, { x: 5.9, y: 7.2 }], fim: { x: 6.1, y: 6.7 } }] }, superior] };
    const r = rota(emL, { pavimentoId: "t", p: { x: 6, y: 8.5 } }, { pavimentoId: "s", p: { x: 2, y: 7 } });
    const naEscada = r.filter(x => x.y !== undefined);
    expect(naEscada.length).toBeGreaterThanOrEqual(2);
    expect(naEscada.map(x => x.y!)).toEqual([...naEscada.map(x => x.y!)].sort((a, b) => a - b)); // sempre subindo
    expect(naEscada.some(x => Math.abs(x.p.x - 7.4) < 0.01 && Math.abs(x.p.y - 6.7) < 0.6)).toBe(true); // passa pela quina
  });
});

describe("motor de mobília", () => {
  const caixa = (p: PecaMobilia) => ({ x: p.x, z: p.z, rot: p.rot, w: p.largura, d: p.profundidade });
  const noPiso = (ps: PecaMobilia[]) => ps.filter(p => p.elevacao === 0 && !["tapete", "cortina", "cadeira", "cadeira_escritorio"].includes(p.tipo));
  const tipos = (ps: PecaMobilia[]) => ps.map(p => p.tipo);

  it("cada cômodo recebe a mobília da sua função", () => {
    const por = (pv: Pavimento, id: string) => tipos(mobiliarComodo(pv.comodos.find(c => c.id === id)!, pv));
    expect(por(terreo, "sala")).toEqual(expect.arrayContaining(["sofa", "rack_tv", "tapete", "mesa_centro", "quadro", "planta", "cortina", "plafon"]));
    expect(por(terreo, "coz")).toEqual(expect.arrayContaining(["bancada_cozinha", "geladeira", "armario_aereo"]));
    expect(por(terreo, "wc")).toEqual(expect.arrayContaining(["vaso_sanitario", "lavatorio", "espelho", "box_chuveiro"]));
    expect(por(superior, "suite")).toEqual(expect.arrayContaining(["cama", "criado_mudo", "guarda_roupa", "cortina"]));
    expect(por(superior, "q2").filter(t => t === "cama")).toHaveLength(1);
  });

  it("móveis de piso não se sobrepõem, ficam dentro do cômodo e não tapam as portas", () => {
    for (const pv of [terreo, superior]) {
      const pecas = mobiliarPavimento(pv);
      expect(pecas.length).toBeGreaterThan(8);
      for (const c of pv.comodos) {
        const chao = noPiso(pecas.filter(p => p.comodoId === c.id));
        for (let i = 0; i < chao.length; i++) for (let j = i + 1; j < chao.length; j++) {
          expect(sobrepoe(caixa(chao[i]), caixa(chao[j])), `${c.nome}: ${chao[i].tipo} × ${chao[j].tipo}`).toBe(false);
        }
        for (const p of chao) expect(comodoEm(pv, { x: p.x, y: p.z })?.id, `${c.nome}: ${p.tipo} fora do cômodo`).toBe(c.id);
      }
      // Meio metro para dentro de cada porta fica livre dos dois lados.
      for (const a of pv.aberturas.filter(x => x.tipo !== "janela")) {
        const w = pv.paredes.find(x => x.id === a.paredeId)!, c = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
        const m = { x: w.a.x + ((w.b.x - w.a.x) * a.posicao) / c, y: w.a.y + ((w.b.y - w.a.y) * a.posicao) / c };
        for (const s of [1, -1]) {
          const zona = { x: m.x - ((w.b.y - w.a.y) / c) * 0.5 * s, z: m.y + ((w.b.x - w.a.x) / c) * 0.5 * s, rot: 0, w: 0.5, d: 0.5 };
          for (const p of noPiso(pecas)) expect(sobrepoe(caixa(p), zona), `${p.tipo} na frente da ${a.tipo} ${a.id}`).toBe(false);
        }
      }
    }
  });

  it("cama de casal na suíte e nos quartos grandes; cômodo minúsculo fica sem mobília", () => {
    expect(mobiliarComodo(superior.comodos[0], superior).find(p => p.tipo === "cama")!.opcoes.casal).toBe(true);
    const mini = { ...superior.comodos[1], poligono: R(4.06, 0.1, 2.6, 2.9) };
    expect(mobiliarComodo(mini, superior).find(p => p.tipo === "cama")!.largura).toBe(0.95);
    expect(mobiliarComodo({ ...mini, poligono: R(4.06, 0.1, 1, 1) }, superior)).toEqual([]);
  });

  it("garagem recebe carro: um na vaga simples, dois quando cabe; sem bater nas paredes", () => {
    const garagem = (w: number, h: number) => ({ id: "g", nome: "Garagem", funcao: "garagem" as const, poligono: R(0, 0, w, h), areaInformada: null, origem: "confirmada" as const });
    const pv = { ...superior, paredes: [], aberturas: [], comodos: [] };
    const um = mobiliarComodo(garagem(3.2, 5.5), pv).filter(p => p.tipo === "carro");
    expect(um).toHaveLength(1);
    expect(um[0]).toMatchObject({ largura: 1.8, profundidade: 4.3 });
    expect(Math.abs(Math.sin(um[0].rot))).toBeLessThan(0.01); // comprido no sentido do maior lado (5,5 m, ao longo de y)
    expect(mobiliarComodo(garagem(6, 6), pv).filter(p => p.tipo === "carro")).toHaveLength(2);
    expect(mobiliarComodo(garagem(2.2, 3), pv).filter(p => p.tipo === "carro")).toHaveLength(0); // não cabe: fica sem
  });

  it("é determinístico: a mesma planta gera sempre a mesma mobília", () => {
    expect(mobiliarPavimento(terreo)).toEqual(mobiliarPavimento(terreo));
  });
});
