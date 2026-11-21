// Maquete 3D (EPIC-028, Etapa 2) — conversor do JSON-fonte (`shared/maquete-3d/fonte-cena.ts`) e planta 2D com cotas
// (`shared/maquete-3d/planta2d.ts`): tudo o que está no JSON aparece no que o visualizador desenha, nas alturas e
// níveis do JSON; o balcão nunca vira parede; os itens substituem a mobília automática; as cotas fecham 5,00 e 9,45.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lerFonte, type FontePlanta } from "../shared/maquete-3d/fonte.js";
import {
  ALTURA_OLHOS_TOUR, APOIO_TELHADO, cenaDaFonte, cortesDasParedes, fonteParaModelo, gradeCoberta, legendaDasAberturas,
  pecasDaFonte, retangulosDaGrade, trechosDaParede, type BlocoCena,
} from "../shared/maquete-3d/fonte-cena.js";
import { mobiliarPavimento, pecasDoPavimento } from "../shared/maquete-3d/mobilia.js";
import { validarModelo } from "../shared/maquete-3d/modelo.js";
import { cadeiasDaCasa, planta2d } from "../shared/maquete-3d/planta2d.js";
import { validarFonte } from "../shared/maquete-3d/validacao-fonte.js";

const ARQUIVO = path.resolve(import.meta.dirname, "../data/plantas/lote4-qd18.json");
const original = (): FontePlanta => lerFonte(JSON.parse(readFileSync(ARQUIVO, "utf8")));
const perto = (a: number, b: number, tol = 1e-3) => Math.abs(a - b) <= tol;

/** Caixa (em planta) de um bloco ortogonal da cena. */
function caixa(b: BlocoCena) {
  const horizontal = Math.abs(Math.sin(b.ang)) < 1e-6;
  const hx = (horizontal ? b.comp : b.esp) / 2, hz = (horizontal ? b.esp : b.comp) / 2;
  return { x0: b.cx - hx, x1: b.cx + hx, z0: b.cz - hz, z1: b.cz + hz, y0: b.y0, y1: b.y1 };
}
const volumeComum = (a: ReturnType<typeof caixa>, b: ReturnType<typeof caixa>) =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

describe("JSON-fonte → cena 3D", () => {
  const f = original(), cena = cenaDaFonte(f);

  it("o JSON de referência continua sem erro nem aviso", () => {
    expect(validarFonte(f)).toEqual([]);
  });

  it("toda parede e todo muro do JSON viram blocos; toda abertura vira esquadria", () => {
    for (const w of f.estrutura.paredes) expect(cena.blocos.some(b => b.paredeId === w.id), w.id).toBe(true);
    expect(cena.esquadrias.map(e => e.id).sort()).toEqual(f.estrutura.aberturas.map(a => a.id).sort());
    expect(cena.blocos.filter(b => b.muro).map(b => b.paredeId)).toEqual(expect.arrayContaining(f.estrutura.paredes.filter(w => w.muro).map(w => w.id)));
  });

  it("esquadrias com o modelo pedido: J1 correr 4 folhas, P1 pivotante, P2 correr de vidro, P3/P4 de abrir, PT1 portão gradeado", () => {
    const por = (id: string) => cena.esquadrias.find(e => e.id === id)!;
    for (const id of ["j1-q1", "j1-q2", "j1-cozinha"]) expect([por(id).modelo, por(id).folhas, por(id).vidro]).toEqual(["janela_correr", 4, true]);
    expect(por("p1").modelo).toBe("pivotante");
    expect([por("p2-sala").modelo, por("p2-sala").folhas, por("p2-sala").vidro]).toEqual(["porta_correr", 2, true]);
    for (const id of ["p3-cozinha", "p3-banho", "p4-q1", "p4-q2"]) {
      expect(por(id).modelo).toBe("abrir");
      expect(por(id).giro).not.toBeNull();
      expect(por(id).dobradica).not.toBeNull();
    }
    expect(por("pt1").modelo).toBe("portao_gradeado");
  });

  it("paredes recortadas: peitoril e verga nas alturas do JSON (base + peitoril, base + peitoril + altura)", () => {
    const blocosDe = (id: string) => trechosDaParede(f.estrutura.paredes.find(w => w.id === id)!, f.estrutura.aberturas);
    // J1 do quarto 1: piso +0,40, peitoril 1,10, altura 1,20, topo +3,20.
    const j1 = blocosDe("par-fundo-q1").filter(t => t.aberturaId === "j1-q1");
    expect(j1.find(t => t.tipo === "peitoril")).toMatchObject({ y0: 0, y1: 1.5 });
    expect(j1.find(t => t.tipo === "verga")).toMatchObject({ y0: 2.7, y1: 3.2 });
    // P3 da cozinha: verga a partir de +2,50; embaixo só o embasamento até o piso (+0,40).
    const p3 = blocosDe("par-fundo-cozinha").filter(t => t.aberturaId === "p3-cozinha");
    expect(p3.find(t => t.tipo === "verga")).toMatchObject({ y0: 2.5, y1: 3.2 });
    expect(p3.find(t => t.tipo === "peitoril")).toMatchObject({ y0: 0, y1: 0.4 });
    // Portão PT1 no muro da frente (3,00 de altura): vão até 2,40, verga até 3,00, nada embaixo.
    const pt1 = blocosDe("muro-frente").filter(t => t.aberturaId === "pt1");
    expect(pt1.map(t => t.tipo)).toEqual(["verga"]);
    expect(pt1[0]).toMatchObject({ y0: 2.4, y1: 3 });
    // O vão fica livre: nenhum bloco da parede ocupa a altura da abertura no trecho dela.
    const w = f.estrutura.paredes.find(p => p.id === "par-fundo-q1")!, ab = f.estrutura.aberturas.find(a => a.id === "j1-q1")!;
    const noVao = blocosDe(w.id).filter(t => t.s1 > ab.offset + 1e-6 && t.s0 < ab.offset + ab.larg - 1e-6);
    expect(noVao.every(t => t.y1 <= w.base + ab.peitoril + 1e-6 || t.y0 >= w.base + ab.peitoril + ab.alt - 1e-6)).toBe(true);
  });

  it("muros com a altura do JSON, do chão", () => {
    for (const w of f.estrutura.paredes.filter(p => p.muro && p.id !== "muro-frente"))
      expect(cena.blocos.filter(b => b.paredeId === w.id).every(b => b.y0 === 0 && perto(b.y1, w.base + w.h))).toBe(true);
  });

  it("encontros em L e T sem dois blocos ocupando o mesmo lugar (sem cintilação)", () => {
    const cx = cena.blocos.map(caixa);
    let comum = 0;
    for (let i = 0; i < cx.length; i++) for (let j = i + 1; j < cx.length; j++) comum += volumeComum(cx[i], cx[j]);
    expect(comum).toBeLessThan(1e-6);
    expect(Array.from(cortesDasParedes(f.estrutura.paredes).values()).some(c => c.length > 0)).toBe(true);
  });

  it("o balcão não vira parede: nenhum bloco no trecho dele e o item tem 1,10 m", () => {
    const b = f.itens.find(i => i.id === "balcao")!;
    const area = { x0: b.x - b.larg / 2 + 0.01, x1: b.x + b.larg / 2 - 0.01, z0: b.z - b.prof / 2 + 0.01, z1: b.z + b.prof / 2 - 0.01 };
    const noTrecho = cena.blocos.map(caixa).filter(k => k.x0 < area.x1 && k.x1 > area.x0 && k.z0 < area.z1 && k.z1 > area.z0 && k.y1 > 0.41);
    expect(noTrecho).toEqual([]);
    expect(fonteParaModelo(f).edificacoes[0].pavimentos[0].paredes.some(w => Math.min(w.a.x, w.b.x) < 2.14 && perto(w.a.y, 3.725, 0.01) && perto(w.b.y, 3.725, 0.01))).toBe(false);
    const peca = pecasDaFonte(f).find(p => p.id === "balcao")!;
    expect(peca).toMatchObject({ tipo: "balcao", altura: 1.1, y: 0.4 });
  });

  it("pisos nos níveis do JSON, com acabamento por ambiente", () => {
    const piso = (n: string) => cena.pisos.find(p => p.nome === n)!;
    expect([piso("Sala").y1, piso("Banheiro").y1, piso("Área de serviço").y1, piso("Varanda").y1, piso("Garagem e frente").y1]).toEqual([0.4, 0.39, 0.35, 0.35, 0.2]);
    expect([piso("Sala").acabamento, piso("Banheiro").acabamento, piso("Área de serviço").acabamento, piso("Quintal").acabamento, piso("Garagem e frente").acabamento])
      .toEqual(["porcelanato", "ceramica", "cimentado", "grama", "concreto"]);
    for (const a of f.estrutura.ambientes) expect(cena.pisos.some(p => p.nome === a.nome), a.nome).toBe(true);
    // A fresta de 3 cm entre a sala e o hall ganha piso no nível interno.
    expect(cena.pisos.filter(p => p.nome.startsWith("Ajuste")).every(p => p.y1 === 0.4)).toBe(true);
  });

  it("soleira em toda porta e portão, no nível do piso mais alto dos dois lados", () => {
    const portas = f.estrutura.aberturas.filter(a => a.tipo !== "janela");
    expect(cena.soleiras.map(s => s.id).sort()).toEqual(portas.map(a => `soleira-${a.id}`).sort());
    const s = (id: string) => cena.soleiras.find(x => x.id === `soleira-${id}`)!;
    expect(perto(s("p2-sala").y1, 0.404)).toBe(true);
    expect(perto(s("pt1").y1, 0.204)).toBe(true);
    expect(s("pt1").y0).toBe(0);
    expect(cena.pingadeiras).toHaveLength(f.estrutura.aberturas.filter(a => a.tipo === "janela").length);
  });

  it("cobertura: duas águas com a inclinação do JSON, cumeeira escondida pela platibanda, forro só na parte coberta", () => {
    const c = cena.cobertura, cob = f.estrutura.cobertura;
    expect(perto(c.yCumeeira, cob.topo_paredes + APOIO_TELHADO + cob.inclinacao * 4.725)).toBe(true);
    expect(perto(c.yPlatibanda, cob.topo_paredes + cob.platibanda.altura)).toBe(true);
    expect(c.avisos).toEqual([]);
    expect(c.telhas.posicoes.length % 9).toBe(0);
    const ys = c.telhas.posicoes.filter((_, k) => k % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(c.yCumeeira, 6);
    const coberto = (x: number, z: number) => c.forro.some(([x0, z0, x1, z1]) => x > x0 && x < x1 && z > z0 && z < z1);
    expect(coberto(1.0, 5.0)).toBe(true); // sala
    expect(coberto(1.0, 0.3)).toBe(false); // área de serviço (descoberta)
    expect(coberto(1.0, 8.8)).toBe(false); // varanda (interno: false)
    expect(c.calhas.length).toBeGreaterThan(0);
    // Fácil de trocar: com 25% (prancha) e a platibanda de 1,15 a cumeeira passa e o gerador avisa.
    const g = original();
    g.estrutura.cobertura.inclinacao = 0.25;
    expect(cenaDaFonte(g).cobertura.avisos).toHaveLength(1);
    g.estrutura.cobertura.platibanda.altura = 1.6;
    expect(cenaDaFonte(g).cobertura.avisos).toEqual([]);
  });

  it("grade coberta fecha só frestas estreitas", () => {
    const g = gradeCoberta(f);
    const fresta = retangulosDaGrade(g, (_i, _j, v) => v === 2);
    expect(fresta).toEqual([[2.14, 3.8, 2.17, 5.65]]);
  });

  it("tour: uma vista por cômodo com os olhos a 1,60 m do piso; visão geral olhando para a casa", () => {
    const ids = cena.vistas.map(v => v.id);
    expect(ids).toEqual(["geral", "sala", "cozinha", "quarto-1", "quarto-2", "banheiro", "area-de-servico", "garagem-e-frente"]);
    for (const v of cena.vistas.filter(x => x.tipo === "comodo")) {
      const a = f.estrutura.ambientes.find(x => x.nome === v.ambiente)!;
      expect(perto(v.pos[1], a.piso + ALTURA_OLHOS_TOUR), v.id).toBe(true);
    }
    const geral = cena.vistas[0];
    expect(geral.alvo).toEqual([2.5, 0.4, 4.725]);
    expect(cena.luzes.map(l => l.ambiente).sort()).toEqual(["Banheiro", "Cozinha", "Hall", "Quarto 1", "Quarto 2", "Sala"]);
  });

  it("legenda do cômodo só com o que está no JSON", () => {
    expect(legendaDasAberturas(f, "Cozinha")).toEqual([
      "Janela J1 1,00 × 1,20 m, peitoril 1,10, de correr 4 folhas, com vidro",
      "Porta P3 0,60 × 2,10 m, de abrir",
    ]);
  });
});

describe("JSON-fonte → ModeloMaquete e itens", () => {
  const f = original(), m = fonteParaModelo(f), pv = m.edificacoes[0].pavimentos[0];

  it("toda parede da casa e toda abertura dela aparecem no modelo; muros ficam na implantação", () => {
    expect(pv.paredes.map(w => w.id).sort()).toEqual(f.estrutura.paredes.filter(w => !w.muro).map(w => w.id).sort());
    const daCasa = new Set(pv.paredes.map(w => w.id));
    expect(pv.aberturas.map(a => a.id).sort()).toEqual(f.estrutura.aberturas.filter(a => daCasa.has(a.parede)).map(a => a.id).sort());
    for (const a of pv.aberturas) {
      const o = f.estrutura.aberturas.find(x => x.id === a.id)!;
      expect([a.posicao, a.largura, a.altura, a.peitoril]).toEqual([o.offset + o.larg / 2, o.larg, o.alt, o.peitoril]);
    }
    expect(pv.aberturas.find(a => a.entradaPrincipal)?.id).toBe("p2-sala");
    expect(m.implantacao?.terreno).toHaveLength(4);
  });

  it("nível, pé-direito e cobertura do JSON", () => {
    expect([pv.nivel, pv.peDireito]).toEqual([0.4, 2.8]);
    expect(m.edificacoes[0].cobertura).toMatchObject({ tipo: "duas_aguas", inclinacao: 20 });
    expect(pv.comodos.find(c => c.funcao === "garagem")?.vagas).toBe(1);
    expect(validarModelo(m).filter(p => p.nivel === "erro")).toEqual([]);
  });

  it("todo item vira peça com as medidas e o giro do JSON", () => {
    const pecas = pecasDaFonte(f);
    expect(pecas.map(p => p.id)).toEqual(f.itens.map(i => i.id));
    for (const i of f.itens) {
      const p = pecas.find(x => x.id === i.id)!;
      expect([p.tipo, p.x, p.z, p.largura, p.profundidade, p.altura]).toEqual([i.tipo, i.x, i.z, i.larg, i.prof, i.alt]);
      expect(p.rot).toBeCloseTo((i.rot * Math.PI) / 180, 9);
    }
  });

  it("com itens, nada de mobília automática; sem itens, a mobília automática de sempre", () => {
    const pecas = pecasDaFonte(f);
    expect(pecasDoPavimento(pv, pecas)).toBe(pecas);
    const automatica = pecasDoPavimento(pv, []);
    expect(automatica).toEqual(mobiliarPavimento(pv));
    expect(automatica.length).toBeGreaterThan(0);
  });
});

describe("planta 2D com cotas", () => {
  const f = original(), p = planta2d(f);

  it("as cadeias de cotas somam 5,00 e 9,45", () => {
    const [largura, profundidade] = cadeiasDaCasa(f);
    expect(largura.total).toBeCloseTo(5, 6);
    expect(profundidade.total).toBeCloseTo(9.45, 6);
    expect(largura.segmentos.at(-1)!.ate).toBeCloseTo(5, 6);
    expect(profundidade.segmentos.at(-1)!.ate).toBeCloseTo(9.45, 6);
    const textos = p.cotas.map(c => c.texto);
    expect(textos).toEqual(expect.arrayContaining(["5,00", "9,45", "1,99", "2,56", "3,50", "1,85", "0,15"]));
  });

  it("toda abertura da casa tem símbolo; as portas de abrir têm o arco de giro", () => {
    const daCasa = f.estrutura.aberturas.filter(a => !f.estrutura.paredes.find(w => w.id === a.parede)!.muro);
    expect(p.aberturas.map(a => a.id).sort()).toEqual(daCasa.map(a => a.id).sort());
    for (const id of ["p3-cozinha", "p3-banho", "p4-q1", "p4-q2"]) expect(p.aberturas.find(a => a.id === id)!.arco).toMatch(/^M.*A0\.6|^M.*A0\.7/);
    expect(p.aberturas.find(a => a.id === "p2-sala")!.arco).toBeNull();
  });

  it("itens da casa em contorno, ambientes com nome, área e medidas; norte e escala", () => {
    const dentro = f.itens.filter(i => i.tipo !== "carro").map(i => i.id).sort();
    expect(p.itens.map(i => i.id).sort()).toEqual(dentro);
    const q1 = p.ambientes.find(a => a.nome === "Quarto 1")!;
    expect([q1.areaPlanta, q1.medidas]).toEqual([9.07, "2,56 × 3,50"]);
    expect(p.ambientes.some(a => a.nome.startsWith("Divisa"))).toBe(false);
    expect(p.norte).toMatchObject({ angulo: 0, estimado: true });
    expect(p.escala.metros).toBe(2);
    expect(p.quadroEsquadrias.map(e => `${e.codigo}×${e.quantidade}`)).toEqual(["J1×3", "P1×1", "P2×1", "P3×2", "P4×2", "PT1×1"]);
  });
});
