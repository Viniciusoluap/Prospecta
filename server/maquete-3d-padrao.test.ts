// Maquete 3D (EPIC-023, S-C): construções padrão geradas pelo motor (sem PDF e sem IA) e distribuição nos lotes.
import { describe, expect, it } from "vitest";
import { dentroDoPoligono } from "../shared/maquete-3d/geometria3d.js";
import { mobiliarComodo } from "../shared/maquete-3d/mobilia.js";
import { areaPoligono, implantacaoSchema, modeloSchema, podePublicar, resumoModelo, validarModelo, type Ponto } from "../shared/maquete-3d/modelo.js";
import { ID_PADRAO, casaPadrao, distribuirNosLotes, ehPadrao, predioPadrao, tamanhoQueCabe } from "../shared/maquete-3d/padrao.js";
import { trechosDaEscada } from "../shared/maquete-3d/escadas.js";

const ret = (x0: number, y0: number, x1: number, y1: number): Ponto[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

describe("casa padrão", () => {
  it.each([[5, 7, 1, 1], [8, 12, 3, 1], [12, 9, 4, 1], [6.5, 7.5, 2, 2], [10, 20, 3, 2], [20, 30, 5, 2]] as const)(
    "%s × %s m, %s quarto(s), %s pavimento(s): planta válida, sem erro nem aviso, pronta para publicar", (frente, fundo, quartos, pavimentos) => {
      const e = casaPadrao({ frente, fundo, quartos, pavimentos, garagem: true });
      const m = modeloSchema.parse({ tipo: "casa", edificacoes: [e] });
      expect(validarModelo(m)).toEqual([]);
      expect(podePublicar(m)).toBe(true);
      expect(ehPadrao(e)).toBe(true);
      const r = resumoModelo(m);
      // A área construída é exatamente a do retângulo pedido, em cada pavimento.
      expect(r.areaTotal).toBeCloseTo(frente * fundo * pavimentos, 1);
      expect(r.pavimentos).toBe(pavimentos);
      expect(r.quartos).toBeGreaterThanOrEqual(1);
      expect(r.quartos).toBeLessThanOrEqual(quartos);
      expect(r.banheiros).toBeGreaterThanOrEqual(1);
      // Uma única entrada principal, numa parede externa (o tour começa por ela).
      const entradas = e.pavimentos.flatMap(p => p.aberturas.filter(a => a.entradaPrincipal).map(a => p.paredes.find(w => w.id === a.paredeId)!));
      expect(entradas).toHaveLength(1);
      expect(entradas[0].externa).toBe(true);
      // Todo cômodo tem ao menos uma passagem (porta ou vão) numa das suas paredes.
      for (const p of e.pavimentos) for (const c of p.comodos) {
        const [a, , b] = c.poligono;
        const temPassagem = p.aberturas.some(ab => {
          if (ab.tipo === "janela") return false;
          const w = p.paredes.find(x => x.id === ab.paredeId)!, t = ab.posicao / Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
          const x = w.a.x + (w.b.x - w.a.x) * t, y = w.a.y + (w.b.y - w.a.y) * t;
          return x >= a.x - 0.01 && x <= b.x + 0.01 && y >= a.y - 0.01 && y <= b.y + 0.01;
        });
        expect(temPassagem, `${p.nome} › ${c.nome}`).toBe(true);
      }
      // A mobília automática não quebra em nenhum cômodo (quarto pequeno derrubava o visualizador).
      for (const p of e.pavimentos) for (const c of p.comodos) expect(() => mobiliarComodo(c, p)).not.toThrow();
    });

  it("garagem só com frente a partir de 7,5 m; térrea estreita fica sem garagem", () => {
    expect(resumoModelo(modeloSchema.parse({ tipo: "casa", edificacoes: [casaPadrao({ frente: 6, fundo: 10, quartos: 2, pavimentos: 1, garagem: true })] })).vagas).toBe(0);
    expect(resumoModelo(modeloSchema.parse({ tipo: "casa", edificacoes: [casaPadrao({ frente: 8, fundo: 10, quartos: 2, pavimentos: 1, garagem: true })] })).vagas).toBe(1);
    expect(resumoModelo(modeloSchema.parse({ tipo: "casa", edificacoes: [casaPadrao({ frente: 8, fundo: 10, quartos: 2, pavimentos: 1, garagem: false })] })).vagas).toBe(0);
  });

  it("sobrado: escada em U sobe um andar inteiro, com patamar, e liga ao pavimento de cima; terreno pequeno demais vira térrea", () => {
    const e = casaPadrao({ frente: 10, fundo: 15, quartos: 3, pavimentos: 2, garagem: true });
    expect(e.pavimentos.map(p => p.nome)).toEqual(["Térreo", "Pavimento superior"]);
    const escada = e.pavimentos[0].escadas[0];
    expect(escada).toMatchObject({ tipo: "em_u", destinoPavimentoId: "p2" });
    const trechos = trechosDaEscada(escada);
    expect(trechos.some(t => t.patamar)).toBe(true);
    expect(trechos.at(-1)!.ate).toBeCloseTo(1, 5);
    // Partida e chegada ficam na circulação dos dois pavimentos.
    for (const [pv, ponto] of [[e.pavimentos[0], escada.inicio], [e.pavimentos[1], escada.fim]] as const) {
      const circulacao = pv.comodos.find(c => c.nome === "Circulação")!;
      expect(dentroDoPoligono({ x: ponto.x, y: ponto.y + 0.3 }, circulacao.poligono)).toBe(true);
    }
    expect(casaPadrao({ frente: 5, fundo: 7, quartos: 2, pavimentos: 2, garagem: false }).pavimentos).toHaveLength(1);
  });

  it("medidas fora da faixa são trazidas para o limite, nunca geram planta quebrada", () => {
    const e = casaPadrao({ frente: 2, fundo: 100, quartos: 40, pavimentos: 1, garagem: true });
    const m = modeloSchema.parse({ tipo: "casa", edificacoes: [e] });
    expect(validarModelo(m)).toEqual([]);
    expect(resumoModelo(m).areaTotal).toBeCloseTo(5 * 30, 1);
  });
});

describe("prédio padrão", () => {
  it("térreo comum + pavimento-tipo repetido: apartamentos com sala, quarto e banheiro, sem erro de validação", () => {
    const e = predioPadrao({ largura: 24, profundidade: 14, andares: 8, aptosPorAndar: 6 });
    const m = modeloSchema.parse({ tipo: "predio", edificacoes: [e] });
    expect(validarModelo(m)).toEqual([]);
    expect(e.id).toBe(ID_PADRAO);
    expect(e.pavimentos[1].repeticoes).toBe(8);
    expect(resumoModelo(m)).toMatchObject({ pavimentos: 9, quartos: 48, banheiros: 48, areaTotal: 24 * 14 * 9 });
    for (const p of e.pavimentos) for (const c of p.comodos) expect(() => mobiliarComodo(c, p)).not.toThrow();
  });
  it("apartamentos por andar limitados pela largura (cada um com ao menos 4,5 m de fachada)", () => {
    const e = predioPadrao({ largura: 10, profundidade: 12, andares: 3, aptosPorAndar: 12 });
    expect(e.pavimentos[1].comodos.filter(c => c.funcao === "quarto")).toHaveLength(4);
    expect(validarModelo(modeloSchema.parse({ tipo: "predio", edificacoes: [e] }))).toEqual([]);
  });
});

describe("distribuição nos lotes", () => {
  // Rua horizontal entre y = 30 e y = 42; lotes de 10 × 25 m dos dois lados, mais um lote estreito e uma área pública.
  const imp = implantacaoSchema.parse({
    ruas: [ret(0, 30, 60, 42)],
    lotes: [
      { id: "a1", nome: "1", quadra: "1", poligono: ret(0, 5, 10, 30), unidade: "Q1 / L1" },
      { id: "a2", nome: "2", quadra: "1", poligono: ret(10, 5, 20, 30) },
      { id: "b1", nome: "1", quadra: "2", poligono: ret(0, 42, 10, 67) },
      { id: "e1", nome: "9", quadra: "2", poligono: ret(20, 42, 24, 67) },
      { id: "v1", poligono: ret(30, 42, 50, 67), tipo: "area_publica" },
    ],
  });

  it("uma construção por lote vendável, inteira dentro do lote e com a frente virada para a rua", () => {
    const d = distribuirNosLotes(imp, 8, 12);
    expect(d.posicoes.map(p => p.nome)).toEqual(["Q1 L1", "Q1 L2", "Q2 L1"]);
    expect(d.semConstrucao).toEqual(["Q2 L9"]); // 4 m de frente: a casa de 8 m não cabe nem de lado
    expect(d.posicoes[0].unidade).toBe("Q1 / L1");
    for (const p of d.posicoes) {
      const lote = imp.lotes.find(l => [l.quadra && `Q${l.quadra}`, l.nome && `L${l.nome}`].filter(Boolean).join(" ") === p.nome)!;
      const rad = (p.rotacao * Math.PI) / 180, cs = Math.cos(rad), sn = Math.sin(rad);
      const mundo = (x: number, y: number) => ({ x: p.x + x * cs - y * sn, y: p.y + x * sn + y * cs });
      for (const c of [mundo(0, 0), mundo(8, 0), mundo(8, 12), mundo(0, 12)]) expect(dentroDoPoligono(c, lote.poligono), `${p.nome} canto`).toBe(true);
      // A frente da casa (y = fundo, no referencial dela) fica mais perto da rua do que o fundo.
      const ateRua = (q: Ponto) => Math.min(Math.abs(q.y - 30), Math.abs(q.y - 42));
      expect(ateRua(mundo(4, 12))).toBeLessThan(ateRua(mundo(4, 0)));
    }
    expect(d.posicoes.every(p => p.edificacaoId === ID_PADRAO)).toBe(true);
  });

  it("lote em leque: usa o centro de massa e a casa cabe; sem ruas, a frente é o menor lado", () => {
    const leque: Ponto[] = [{ x: 0, y: 0 }, { x: 14, y: -4 }, { x: 20, y: 30 }, { x: -6, y: 30 }];
    const sem = implantacaoSchema.parse({ lotes: [{ id: "f", nome: "1", quadra: "3", poligono: leque }] });
    const d = distribuirNosLotes(sem, 8, 12);
    expect(d.semConstrucao).toEqual([]);
    expect(areaPoligono(leque)).toBeGreaterThan(8 * 12);
  });

  it("sugere um tamanho menor quando a casa pedida não cabe na maioria dos lotes", () => {
    expect(tamanhoQueCabe(imp, 8, 12)).toBeNull(); // o lote estreito impede 90%
    expect(tamanhoQueCabe(imp, 8, 12, 0.7)).toEqual({ frente: 8, fundo: 12 });
    expect(tamanhoQueCabe(imp, 14, 20, 0.7)!.frente).toBeLessThan(10);
  });
});
