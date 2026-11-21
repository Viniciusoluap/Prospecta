// Maquete 3D (EPIC-028, Etapa 1) — JSON-fonte do Lote 4 Qd 18 e validações puras (`shared/maquete-3d/validacao-fonte.ts`).
// Cada regra tem um caso que passa (o JSON de referência) e um caso que falha (uma alteração mínima nele).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { areaComum, contornoDoItem, fonteSchema, lerFonte, recortar, type FontePlanta, type ItemFonte } from "../shared/maquete-3d/fonte.js";
import { TIPOS_MOVEL } from "../shared/maquete-3d/mobilia.js";
import { areaPoligono } from "../shared/maquete-3d/modelo.js";
import { TOLERANCIAS, conferirAreas, temErro, validarFonte, type CodigoProblema } from "../shared/maquete-3d/validacao-fonte.js";

const ARQUIVO = path.resolve(import.meta.dirname, "../data/plantas/lote4-qd18.json");
const original = (): FontePlanta => lerFonte(JSON.parse(readFileSync(ARQUIVO, "utf8")));
const codigos = (f: FontePlanta) => validarFonte(f).filter(p => p.nivel === "erro").map(p => p.codigo);
const erros = (f: FontePlanta, codigo: CodigoProblema) => validarFonte(f).filter(p => p.nivel === "erro" && p.codigo === codigo);
const item = (f: FontePlanta, id: string) => f.itens.find(i => i.id === id)!;
/** Põe o item na caixa (x0, z0, x1, z1), mantendo o giro (0/180: largura em x; 90/270: largura em z). */
function mover(i: ItemFonte, x0: number, z0: number, x1: number, z1: number) {
  const deitado = i.rot === 90 || i.rot === 270;
  Object.assign(i, { x: (x0 + x1) / 2, z: (z0 + z1) / 2, larg: deitado ? z1 - z0 : x1 - x0, prof: deitado ? x1 - x0 : z1 - z0 });
}

describe("JSON-fonte do Lote 4 Qd 18", () => {
  it("tem o formato do schema e passa em todas as validações, sem erro nem aviso", () => {
    const f = original();
    expect(() => fonteSchema.parse(f)).not.toThrow();
    expect(validarFonte(f)).toEqual([]);
  });

  it("estrutura conforme a planta: casa 5,00 × 9,45, lote 5,00 × 30,00, pé-direito 2,80, esquadrias do quadro", () => {
    const f = original();
    expect([f.lote.w, f.lote.d, f.estrutura.casa.w, f.estrutura.casa.d]).toEqual([5, 30, 5, 9.45]);
    expect(f.niveis.interno.valor).toBe(0.4);
    expect(f.niveis.forro.valor - f.niveis.interno.valor).toBeCloseTo(2.8, 6);
    const ab = (codigo: string) => f.estrutura.aberturas.filter(a => a.codigo === codigo);
    expect(ab("J1")).toHaveLength(3);
    expect(ab("J1").every(a => a.larg === 1 && a.alt === 1.2 && a.peitoril === 1.1 && a.abertura === "correr")).toBe(true);
    expect(ab("P1").map(a => [a.larg, a.alt])).toEqual([[1, 2.5]]);
    expect(ab("P2").map(a => [a.larg, a.alt, a.abertura])).toEqual([[1.6, 2.5, "correr"]]);
    expect(ab("P3").map(a => [a.larg, a.alt])).toEqual([[0.6, 2.1], [0.6, 2.1]]);
    expect(ab("P4").map(a => [a.larg, a.alt])).toEqual([[0.7, 2.1], [0.7, 2.1]]);
    expect(ab("PT1").map(a => [a.larg, a.alt])).toEqual([[3, 2.4]]);
  });

  it("a mureta de 1,19 m não é parede: vira o item balcão (1,10 m, tampo avançando para a sala)", () => {
    const f = original();
    const naLinha = f.estrutura.paredes.filter(w => Math.abs(w.z1 - 3.725) < 0.01 && Math.abs(w.z2 - 3.725) < 0.01 && Math.min(w.x1, w.x2) < 2.14);
    expect(naLinha).toEqual([]);
    const b = item(f, "balcao");
    expect(b.tipo).toBe("balcao");
    expect(TIPOS_MOVEL).toContain("balcao");
    const xs = contornoDoItem(b).map(p => p.x), zs = contornoDoItem(b).map(p => p.y);
    expect([Math.min(...xs), Math.max(...xs)].map(v => +v.toFixed(3))).toEqual([0.95, 2.14]);
    expect(+Math.min(...zs).toFixed(3)).toBe(3.65); // face da cozinha na linha 3,65
    expect(Math.max(...zs)).toBeGreaterThan(3.8); // o tampo avança para o lado da sala
    expect(b.alt).toBeLessThan(TOLERANCIAS.balcaoAlturaMax);
    // Altura 1,10 aprovada pelo dono em 21/11/2026 (deixou de ser estimada).
    expect(b.estimado).toBe(false);
    expect(b.fonte).toBe("dono");
  });

  it("toda medida marcada como estimada diz a fonte", () => {
    const f = original();
    const marcados = [f.lote, f.estrutura.casa, f.estrutura.cobertura, ...Object.values(f.niveis), ...f.estrutura.paredes,
      ...f.estrutura.aberturas, ...f.estrutura.ambientes, ...f.itens];
    expect(marcados.every(o => typeof o.fonte === "string" && o.fonte.length > 0)).toBe(true);
    expect(marcados.filter(o => o.estimado).length).toBeGreaterThan(0);
  });
});

describe("áreas × quadro de ambientes (±2%)", () => {
  it("as sete áreas do quadro conferem dentro da tolerância", () => {
    const a = conferirAreas(original());
    expect(a.map(x => x.nome).sort()).toEqual(["Banheiro", "Cozinha", "Hall", "Quarto 1", "Quarto 2", "Sala", "Área de serviço"].sort());
    expect(a.every(x => x.ok)).toBe(true);
    expect(Math.max(...a.map(x => Math.abs(x.desvio)))).toBeLessThanOrEqual(0.02);
  });
  it("falha quando o polígono foge do quadro (hall só com a cota de 0,91: 1,68 m² × 1,90)", () => {
    const f = original();
    const hall = f.estrutura.ambientes.find(a => a.nome === "Hall")!;
    hall.poligono = [[2.29, 3.8], [3.2, 3.8], [3.2, 5.65], [2.29, 5.65]];
    const e = erros(f, "area_ambiente");
    expect(e).toHaveLength(1);
    expect(e[0].mensagem).toMatch(/Hall: área calculada 1,68 m² × quadro 1,90 m²/);
  });
});

describe("cadeias de cotas e contorno", () => {
  it("as faixas somam 5,00 e 9,45 e cada faixa de parede é uma parede do modelo", () => {
    const f = original();
    const soma = (l: { medida: number }[]) => l.reduce((s, x) => s + x.medida, 0);
    expect(soma(f.estrutura.casa.faixas_largura)).toBeCloseTo(5, 6);
    expect(soma(f.estrutura.casa.faixas_profundidade)).toBeCloseTo(9.45, 6);
    expect(codigos(f)).toEqual([]);
  });
  it("soma errada → erro", () => {
    const f = original();
    f.estrutura.casa.faixas_largura[1].medida = 2.09;
    expect(erros(f, "faixas_soma")).toHaveLength(1);
  });
  it("faixa de parede sem parede no lugar → erro", () => {
    const f = original();
    // As duas paredes da faixa 0,15 entre 1,99 e 2,56 saem do lugar.
    for (const id of ["par-cozinha-q1", "par-sala-q2"]) {
      const w = f.estrutura.paredes.find(p => p.id === id)!;
      w.x1 = w.x2 = 2.3;
    }
    expect(erros(f, "faixas_parede").length).toBeGreaterThan(0);
  });
  it("parede da casa fora do contorno 5,00 × 9,45 → erro", () => {
    const f = original();
    const w = f.estrutura.paredes.find(p => p.id === "par-frente-q2")!;
    w.z1 = w.z2 = 9.5;
    expect(erros(f, "casa_contorno")).toHaveLength(1);
  });
});

describe("paredes e aberturas", () => {
  it("parede oblíqua → erro", () => {
    const f = original();
    f.estrutura.paredes.find(p => p.id === "par-hall-banho")!.x2 = 3.3;
    expect(erros(f, "parede_obliqua")).toHaveLength(1);
  });
  it("encontros em L e T passam; parede duplicada por cima de outra → erro", () => {
    const f = original();
    expect(codigos(f)).not.toContain("paredes_sobrepostas");
    f.estrutura.paredes.push({ ...f.estrutura.paredes.find(p => p.id === "par-q1-hall")!, id: "par-dupla", x1: 3, x2: 4 });
    expect(erros(f, "paredes_sobrepostas").map(e => e.onde)).toEqual(["par-q1-hall × par-dupla"]);
  });
  it("abertura maior que a parede → erro", () => {
    const f = original();
    f.estrutura.aberturas.find(a => a.id === "p2-sala")!.offset = 0.8; // 0,80 + 1,60 > 2,14
    expect(erros(f, "abertura_fora")).toHaveLength(1);
  });
  it("abertura mais alta que a parede → erro", () => {
    const f = original();
    f.estrutura.aberturas.find(a => a.id === "j1-q1")!.peitoril = 1.7; // 1,70 + 1,20 > 2,80
    expect(erros(f, "abertura_altura")).toHaveLength(1);
  });
  it("duas aberturas no mesmo trecho → erro", () => {
    const f = original();
    f.estrutura.aberturas.find(a => a.id === "j1-cozinha")!.offset = 0.5; // em cima da P3 (0,24–0,84)
    expect(erros(f, "abertura_sobreposta")).toHaveLength(1);
  });
  it("vão tapado por outra parede → erro", () => {
    const f = original();
    f.estrutura.aberturas.find(a => a.id === "p3-cozinha")!.offset = 0; // começa dentro da divisa esquerda
    expect(erros(f, "abertura_tapada")).toHaveLength(1);
  });
  it("porta de abrir para um ambiente que não encosta na parede → erro", () => {
    const f = original();
    f.estrutura.aberturas.find(a => a.id === "p4-q1")!.abre_para = "Quarto 2";
    expect(erros(f, "abertura_sem_lado")).toHaveLength(1);
  });
});

describe("itens × portas (vão, giro da folha, faixa livre de 0,80 m)", () => {
  it("REGRESSÃO: geladeira na posição antiga do protótipo (x 0,15–0,85, z 1,01–1,70) → porta P3 bloqueada", () => {
    const f = original();
    mover(item(f, "geladeira"), 0.15, 1.01, 0.85, 1.7);
    const e = validarFonte(f).filter(p => p.nivel === "erro" && p.onde === "geladeira");
    expect(e.map(x => x.codigo)).toEqual(expect.arrayContaining(["item_giro_porta", "item_faixa_livre"]));
    expect(e.find(x => x.codigo === "item_giro_porta")!.mensagem).toMatch(/P3 \(p3-cozinha\): porta bloqueada/);
  });
  it("giro: item no quadrante da folha (lado para onde ela abre) → erro; do outro lado da parede, só a faixa", () => {
    const f = original();
    const t = item(f, "tanque"); // na área de serviço, lado oposto ao giro da P3
    mover(t, 0.3, 0.2, 0.84, 0.8);
    expect(validarFonte(f).filter(p => p.onde === "tanque").map(p => p.codigo)).toEqual(["item_faixa_livre"]);
    const g = original();
    mover(item(g, "geladeira"), 0.3, 1.2, 0.8, 1.55); // dentro do quadrante de raio 0,60 da P3 na cozinha
    expect(erros(g, "item_giro_porta").map(e => e.onde)).toEqual(["geladeira"]);
  });
  it("porta de correr não tem giro, mas tem a faixa livre (sofá na frente da P2 → erro)", () => {
    const f = original();
    expect(erros(f, "item_giro_porta")).toEqual([]);
    mover(item(f, "sofa"), 0.15, 6.0, 0.95, 7.8); // posição do protótipo
    const e = validarFonte(f).filter(p => p.onde === "sofa").map(p => p.codigo);
    expect(e).toEqual(["item_faixa_livre"]);
  });
  it("item dentro do vão da porta → erro", () => {
    const f = original();
    const c = item(f, "cadeira-1");
    Object.assign(c, { ambiente: "Sala", alcanca: ["Varanda"], x: 1.2, z: 8.02 });
    expect(erros(f, "item_vao").map(e => e.onde)).toEqual(["cadeira-1"]);
  });
  it("item pendurado acima da altura da porta não bloqueia", () => {
    const f = original();
    const g = item(f, "geladeira");
    mover(g, 0.3, 1.2, 0.8, 1.55);
    g.elev = 2.2; g.alt = 0.3; // como um armário aéreo acima de 2,10
    expect(validarFonte(f).filter(p => p.onde === "geladeira")).toEqual([]);
  });
});

describe("itens × paredes, ambientes e janelas", () => {
  it("item atravessando parede → erro", () => {
    const f = original();
    mover(item(f, "criado-q1-a"), 2.2, 0.15, 2.65, 0.55); // entra na parede cozinha × quarto 1
    expect(erros(f, "item_parede").map(e => e.onde)).toEqual(["criado-q1-a"]);
  });
  it("item saindo do ambiente → erro", () => {
    const f = original();
    mover(item(f, "lavatorio"), 4.4, 5.3, 4.85, 5.75); // invade o hall/quarto 2 pela linha z 5,65
    expect(codigos(f)).toContain("item_fora_ambiente");
  });
  it("item alto (> 1,10 m) debaixo de janela → erro; baixo (bancada de 0,90) passa", () => {
    const f = original();
    expect(erros(f, "item_sob_janela")).toEqual([]);
    mover(item(f, "geladeira"), 1.0, 1.01, 1.7, 1.71); // debaixo da J1 da cozinha (x 0,98–1,98)
    item(f, "bancada-pia").x = 9; // tira a bancada para isolar a regra (vira "fora do ambiente", irrelevante aqui)
    expect(erros(f, "item_sob_janela").map(e => e.onde)).toEqual(["geladeira"]);
  });
  it("itens no mesmo lugar e na mesma altura → erro; TV/rack empilhados em alturas diferentes não", () => {
    const f = original();
    mover(item(f, "criado-q1-a"), 3.2, 0.5, 3.6, 0.9); // em cima da cama
    expect(erros(f, "itens_sobrepostos").map(e => e.onde)).toEqual(["cama-q1 × criado-q1-a"]);
  });
});

describe("balcão da cozinha", () => {
  it("REGRESSÃO: recolocar a mureta como parede (x 0,95–2,14, z 3,65–3,80) → erro", () => {
    const f = original();
    f.estrutura.paredes.push({ id: "mureta", x1: 0.95, z1: 3.725, x2: 2.14, z2: 3.725, esp: 0.15, h: 1.19, base: 0.4, fonte: "protótipo" });
    const c = codigos(f);
    expect(c).toContain("balcao_parede");
    expect(c).toContain("item_parede");
    expect(temErro(validarFonte(f))).toBe(true);
  });
  it("balcão com 1,20 m ou mais → erro", () => {
    const f = original();
    item(f, "balcao").alt = 1.2;
    expect(erros(f, "balcao_alto")).toHaveLength(1);
  });
  it("sem balcão → aviso; passagem ao lado do balcão menor que 0,80 → aviso", () => {
    const f = original();
    f.itens = f.itens.filter(i => i.id !== "balcao");
    expect(validarFonte(f).map(p => [p.nivel, p.codigo])).toEqual([["aviso", "balcao_ausente"]]);
    const g = original();
    const b = item(g, "balcao");
    b.larg = 1.5; b.x = 2.14 - 0.75; // começa em x 0,64: passagem de 0,49
    expect(validarFonte(g).some(p => p.codigo === "balcao_passagem" && p.nivel === "aviso")).toBe(true);
  });
});

describe("geometria", () => {
  it("recorte de polígono côncavo por retângulo dá a área exata", () => {
    const L = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 }];
    const q = [{ x: 0.5, y: 0.5 }, { x: 1.5, y: 0.5 }, { x: 1.5, y: 1.5 }, { x: 0.5, y: 1.5 }];
    expect(areaComum(L, q)).toBeCloseTo(0.75, 9);
    expect(areaPoligono(recortar(q, q))).toBeCloseTo(1, 9);
  });
  it("contorno do item girado 90° troca largura e profundidade em planta", () => {
    const pts = contornoDoItem({ x: 1, z: 1, rot: 90, larg: 2, prof: 1 });
    const xs = pts.map(p => p.x), zs = pts.map(p => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1, 9);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2, 9);
  });
});
