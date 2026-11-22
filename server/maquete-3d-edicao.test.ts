// EPIC-028 (Etapa 3) — modo edição dos itens, puro: cada regra bloqueia salvar (as mesmas de validarFonte), encaixe
// de 5 cm e na face da parede, giro, troca de tipo mantendo posição e medidas, catálogo com medidas padrão,
// desfazer/refazer e o formato aceito pelo servidor (lista fechada, sem HTML).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lerFonte, type ItemFonte } from "../shared/maquete-3d/fonte.js";
import {
  CATALOGO_ITENS, MATERIAIS_ITEM, TIPOS_SUSPENSOS, alterarItem, comAlcanceDerivado, comTravaDaFonte, vistaDoAmbiente, ambientesEditaveis, bloqueiaSalvar, canonico, converterTipo, costasDoItem, criarHistorico,
  desfazer, encaixar, encaixeNaParede, fecharGesto, girar, itemEditadoSchema, itensDoProblema, itensEdicaoSchema, novoId, novoItem,
  posicaoArrastada, problemasDaEdicao, refazer, registrar, tiposDoGrupo, travadosAlterados,
} from "../shared/maquete-3d/edicao.js";
import { TIPOS_MOVEL } from "../shared/maquete-3d/mobilia.js";
import { cenaDaFonte } from "../shared/maquete-3d/fonte-cena.js";
import { planta2d } from "../shared/maquete-3d/planta2d.js";

const FONTE = lerFonte(JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../data/plantas/lote4-qd18.json"), "utf8")));
const ITENS = FONTE.itens;
const item = (id: string) => ITENS.find(i => i.id === id)!;
const com = (id: string, mudanca: Partial<ItemFonte>, lista = ITENS) => lista.map(i => (i.id === id ? { ...i, ...mudanca } : i));
const codigos = (itens: ItemFonte[]) => problemasDaEdicao(FONTE, itens).filter(p => p.nivel === "erro").map(p => p.codigo);

describe("regras de edição (mesmas de validarFonte): cada uma bloqueia salvar", () => {
  it("a planta padrão não tem erro e pode ser salva", () => {
    const ps = problemasDaEdicao(FONTE, ITENS);
    expect(ps.filter(p => p.nivel === "erro")).toEqual([]);
    expect(bloqueiaSalvar(ps)).toBe(false);
  });

  it("geladeira na frente da P3: giro da folha e faixa livre de 0,80 m → bloqueia", () => {
    const itens = com("geladeira", { x: 0.54, z: 1.36, rot: 0 }, ITENS.filter(i => i.id !== "bancada-pia"));
    const c = codigos(itens);
    expect(c).toContain("item_giro_porta");
    expect(c).toContain("item_faixa_livre");
    expect(bloqueiaSalvar(problemasDaEdicao(FONTE, itens))).toBe(true);
    const msg = problemasDaEdicao(FONTE, itens).find(p => p.codigo === "item_giro_porta")!;
    expect(msg.mensagem).toMatch(/P3.*porta bloqueada/);
    expect(itensDoProblema(msg, itens)).toEqual(["geladeira"]);
  });

  it("atravessar parede → bloqueia", () => {
    expect(codigos(com("geladeira", { x: 2.0 }))).toContain("item_parede");
  });

  it("sair do ambiente → bloqueia", () => {
    expect(codigos(com("cama-q1", { ambiente: "Sala" }))).toContain("item_fora_ambiente");
  });

  it("ocupar o vão de uma porta → bloqueia", () => {
    expect(codigos(com("criado-q1-a", { x: 2.67, z: 3.725 }))).toContain("item_vao");
  });

  it("item alto debaixo da janela → bloqueia; item baixo (até 1,10 m) pode", () => {
    const semPia = ITENS.filter(i => i.id !== "bancada-pia");
    expect(codigos(com("geladeira", { x: 1.48, z: 1.36, rot: 0 }, semPia))).toContain("item_sob_janela");
    // A mesma geladeira com 1,10 m de altura (item baixo) fica sob a J1 (peitoril 1,10) sem erro de janela.
    expect(codigos(com("geladeira", { x: 1.48, z: 1.36, rot: 0, alt: 1.1 }, semPia))).not.toContain("item_sob_janela");
    // A cama do quarto 1 (1,00 m) já fica sob a J1 do quarto na planta padrão.
    expect(codigos(ITENS)).toEqual([]);
  });

  it("dois itens no mesmo lugar → bloqueia", () => {
    expect(codigos(com("cadeira-1", { x: 1.15, z: 4.7 }))).toContain("itens_sobrepostos");
  });

  it("id repetido → bloqueia", () => {
    expect(codigos([...ITENS, { ...item("cadeira-1"), x: 1.15, z: 6.9 }])).toContain("id_repetido");
  });
});

describe("encaixe, giro e conversão", () => {
  it("encaixe de 5 cm", () => {
    expect(encaixar(1.234)).toBe(1.25);
    expect(encaixar(1.224)).toBe(1.2);
    expect(encaixar(-0.026)).toBe(-0.05);
    expect(encaixar(3.3)).toBe(3.3);
  });

  it("encaixe na parede: o fundo do móvel encosta na face da parede mais próxima", () => {
    // Geladeira (costas para +x, giro 270) a 10 cm da parede cozinha/quarto 1: encosta.
    const g = item("geladeira");
    const longe = { ...g, x: g.x - 0.1 };
    const ima = encaixeNaParede(FONTE, longe)!;
    expect(ima.paredeId).toBe("par-cozinha-q1");
    expect(ima.x).toBeCloseTo(g.x, 6);
    expect(ima.z).toBe(longe.z);
    // Fundo da geladeira na face: centro + costas × prof/2 = face da parede (x 2,14).
    expect(ima.x + costasDoItem(270).x * (g.prof / 2)).toBeCloseTo(2.14, 6);
    // Longe demais (30 cm): não encaixa.
    expect(encaixeNaParede(FONTE, { ...g, x: g.x - 0.3 })).toBeNull();
    // Desalinhado (giro 15°): não encaixa.
    expect(encaixeNaParede(FONTE, { ...longe, rot: 285 })).toBeNull();
  });

  it("arraste: grade de 5 cm e, perto da parede, a face manda", () => {
    const g = item("geladeira");
    const solto = posicaoArrastada(FONTE, g, 1.2312, 2.987);
    expect(solto).toEqual({ x: 1.25, z: 3, paredeId: null });
    const perto = posicaoArrastada(FONTE, g, 1.71, 2.987);
    expect(perto.paredeId).toBe("par-cozinha-q1");
    expect(perto.x).toBeCloseTo(1.79, 6);
    expect(perto.z).toBe(3);
  });

  it("girar: botões de 90° e ajuste fino de 15°, sempre em [0, 360)", () => {
    const g = item("geladeira");
    expect(girar(g, 90).rot).toBe(0);
    expect(girar(g, -90).rot).toBe(180);
    expect(girar({ rot: 0 }, -15).rot).toBe(345);
    expect(girar({ rot: 350 }, 15).rot).toBe(5);
    expect(girar(girar({ rot: 0 }, 15), -15).rot).toBe(0);
  });

  it("converter tipo dentro do grupo mantém posição, giro e medidas (bancada ↔ balcão ↔ armário)", () => {
    const b = item("bancada-pia");
    const balcao = converterTipo(b, "balcao");
    expect(balcao).toMatchObject({ tipo: "balcao", x: b.x, z: b.z, rot: b.rot, larg: b.larg, prof: b.prof, alt: b.alt, id: b.id, material: b.material, cor: b.cor });
    expect(balcao.opcoes).toEqual(CATALOGO_ITENS.balcao.opcoes);
    const armario = converterTipo(balcao, "armario_servico");
    expect(armario).toMatchObject({ tipo: "armario_servico", x: b.x, z: b.z, larg: b.larg, prof: b.prof, alt: b.alt });
    expect(armario.opcoes).toBeUndefined();
    expect(converterTipo(armario, "bancada_cozinha").tipo).toBe("bancada_cozinha");
    expect(tiposDoGrupo("bancadas")).toEqual(expect.arrayContaining(["bancada_cozinha", "balcao", "armario_servico"]));
    // Fora do grupo, não.
    expect(() => converterTipo(b, "cama")).toThrow(/só pode virar/);
  });

  it("mudar o ambiente no painel leva o item para dentro do ambiente novo", () => {
    const itens = alterarItem(FONTE, ITENS, "criado-q2", { ambiente: "Sala" });
    const c = itens.find(i => i.id === "criado-q2")!;
    expect(c.ambiente).toBe("Sala");
    expect(codigos(itens)).not.toContain("item_fora_ambiente");
  });
});

describe("catálogo procedural", () => {
  it("todo tipo tem medidas padrão e as pedidas pelo dono", () => {
    for (const t of TIPOS_MOVEL) expect(CATALOGO_ITENS[t]).toBeDefined();
    expect(CATALOGO_ITENS.geladeira).toMatchObject({ larg: 0.7, prof: 0.7, alt: 1.8 });
    expect(CATALOGO_ITENS.fogao).toMatchObject({ larg: 0.55, prof: 0.6, alt: 0.85 });
  });

  it("adicionar: item novo no centro do ambiente, com id único e medidas padrão; remover", () => {
    const f = novoItem(FONTE, "fogao", "Sala", ITENS);
    expect(f).toMatchObject({ id: "fogao", tipo: "fogao", ambiente: "Sala", larg: 0.55, prof: 0.6, alt: 0.85, editavel: true });
    expect(novoId("cadeira", ITENS)).toBe("cadeira");
    expect(novoId("geladeira", ITENS)).toBe("geladeira-2");
    const lista = [...ITENS, f];
    expect(itensEdicaoSchema.safeParse(lista).success).toBe(true);
    const sem = lista.filter(i => i.id !== "sofa");
    expect(sem).toHaveLength(ITENS.length);
    expect(ambientesEditaveis(FONTE).map(a => a.nome)).not.toContain("Divisa cozinha/sala");
  });
});

describe("desfazer / refazer", () => {
  it("cada gesto vira um passo; o arraste inteiro é um só", () => {
    let h = criarHistorico(ITENS);
    const a = com("sofa", { x: 0.6 }), b = com("sofa", { x: 0.7 }, a), c = com("sofa", { x: 0.8 }, b);
    h = registrar(h, a, "arrastar:sofa:1");
    h = registrar(h, b, "arrastar:sofa:1");
    h = registrar(h, c, "arrastar:sofa:1");
    h = fecharGesto(h);
    const d = girar(c.find(i => i.id === "sofa")!, 90);
    h = registrar(h, c.map(i => (i.id === "sofa" ? d : i)), "girar");
    expect(h.passado).toHaveLength(2);
    h = desfazer(h);
    expect(h.presente).toBe(c);
    h = desfazer(h);
    expect(h.presente).toBe(ITENS);
    expect(desfazer(h)).toBe(h);
    h = refazer(h);
    expect(h.presente).toBe(c);
    h = refazer(h);
    expect(h.presente.find(i => i.id === "sofa")!.rot).toBe(180);
    expect(refazer(h)).toBe(h);
    // Mudança nova depois de desfazer apaga o "refazer".
    h = registrar(desfazer(h), ITENS);
    expect(h.futuro).toEqual([]);
  });
});

describe("formato aceito pelo servidor", () => {
  const base = item("geladeira");
  it("todo material do JSON está na lista fechada; os itens padrão passam", () => {
    for (const i of ITENS) expect(MATERIAIS_ITEM).toContain(i.material);
    expect(itensEdicaoSchema.safeParse(ITENS).success).toBe(true);
  });
  it("recusa HTML, cor fora de #rrggbb, material fora da lista, tipo desconhecido, número infinito e campo a mais", () => {
    for (const ruim of [
      { ...base, ambiente: "<img src=x onerror=alert(1)>" }, { ...base, nota: "<svg/onload=1>" }, { ...base, cor: "red" },
      { ...base, cor: "#12345" }, { ...base, material: "ouro" }, { ...base, tipo: "piano" }, { ...base, x: Number.POSITIVE_INFINITY },
      { ...base, larg: 50 }, { ...base, id: "Geladeira 1" }, { ...base, estilo: "url(javascript:1)" }, { ...base, opcoes: { pia: "<b>" } },
    ]) expect(itemEditadoSchema.safeParse(ruim).success, JSON.stringify(ruim).slice(0, 80)).toBe(false);
    expect(itensEdicaoSchema.safeParse(Array.from({ length: 151 }, (_, k) => ({ ...base, id: `g-${k}` }))).success).toBe(false);
  });
  it("item travado (editavel: false) da planta não pode mudar nem sumir", () => {
    const padrao = com("carro", { editavel: false });
    expect(travadosAlterados(padrao, padrao)).toEqual([]);
    expect(travadosAlterados(padrao, com("carro", { x: 2.6 }, padrao))).toEqual(["carro"]);
    expect(travadosAlterados(padrao, padrao.filter(i => i.id !== "carro"))).toEqual(["carro"]);
    expect(canonico({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe('{"a":[1,{"d":2}],"b":1}');
  });
  it("editavel enviado pela tela não desliga regra: a trava é a da FONTE (item novo é sempre editável)", () => {
    // Geladeira elevada na frente da P3 marcada como "travada" pela tela: continua recusada (elevação e porta).
    const ruim = com("geladeira", { x: 0.54, z: 1.36, rot: 0, elev: 2.2, alt: 0.3, editavel: false }, ITENS.filter(i => i.id !== "bancada-pia"));
    expect(codigos(ruim)).toContain("item_elevado");
    expect(bloqueiaSalvar(problemasDaEdicao(FONTE, ruim))).toBe(true);
    // Item novo (não existe na fonte) com editavel:false também é validado.
    const novo = { ...item("sofa"), id: "sofa-extra", elev: 1.5, editavel: false };
    expect(codigos([...ITENS, novo])).toContain("item_elevado");
    // `alcanca` também é sempre derivado para quem não é travado na fonte.
    expect(comAlcanceDerivado(FONTE, com("sofa", { alcanca: ["Quarto 1"], editavel: false })).find(i => i.id === "sofa")!.alcanca).toBeUndefined();
    // A trava vem da fonte: o item travado lá fica travado mesmo que a tela mande editavel:true.
    const padrao = com("carro", { editavel: false });
    const n = comTravaDaFonte(padrao, com("carro", { editavel: true }, com("sofa", { editavel: false })));
    expect(n.find(i => i.id === "carro")!.editavel).toBe(false);
    expect(n.find(i => i.id === "sofa")!.editavel).toBe(true);
    expect(n.every(i => i.id === "carro" || i.editavel)).toBe(true);
    expect(comTravaDaFonte(ITENS, ITENS)[0]).toBe(ITENS[0]); // sem mudança: mesmo objeto
  });
});

describe("portas bloqueadas (zonas em vermelho na tela)", () => {
  it("a geladeira na frente da P3 marca a P3, com o vão, as faixas e o giro da folha", async () => {
    const { portasBloqueadas } = await import("../shared/maquete-3d/edicao.js");
    expect(portasBloqueadas(FONTE, ITENS)).toEqual([]);
    const itens = com("geladeira", { x: 0.54, z: 1.36, rot: 0 }, ITENS.filter(i => i.id !== "bancada-pia"));
    const b = portasBloqueadas(FONTE, itens);
    expect(b.map(x => [x.abertura, x.itens])).toEqual([["p3-cozinha", ["geladeira"]]]);
    expect(b[0].zonas).toHaveLength(4);
  });
});

describe("correções do portão de QA (E3)", () => {
  it("elevação só para tipo suspenso: geladeira elevada bloqueia; armário aéreo elevado sobre o vão da P3 continua bloqueando", () => {
    expect(codigos(com("geladeira", { elev: 2.2, alt: 0.3 }))).toContain("item_elevado");
    const aereo = { ...item("geladeira"), id: "aereo-teste", tipo: "armario_aereo" as const, x: 0.54, z: 1.36, rot: 0, larg: 0.6, prof: 0.35, alt: 0.3, elev: 1.0 };
    const c = codigos([...ITENS.filter(i => i.id !== "bancada-pia"), aereo]);
    expect(c).not.toContain("item_elevado");
    expect(c.some(x => x === "item_giro_porta" || x === "item_faixa_livre" || x === "item_vao")).toBe(true);
    for (const t of TIPOS_SUSPENSOS) expect(CATALOGO_ITENS[t].elev ?? 0).toBeGreaterThan(0);
  });
  it("trocar armário aéreo por guarda-roupa tira a elevação; o contrário usa a padrão", () => {
    const aereo = { ...item("geladeira"), tipo: "armario_aereo" as const, elev: 1.5 };
    expect(converterTipo(aereo, "guarda_roupa").elev).toBeUndefined();
    expect(converterTipo({ ...aereo, tipo: "estante", elev: undefined }, "prateleira").elev).toBe(CATALOGO_ITENS.prateleira.elev);
  });
  it("alcanca é derivado da geometria: lista da tela é ignorada; só o balcão alcança", () => {
    const d = comAlcanceDerivado(FONTE, com("sofa", { alcanca: ["Quarto 1"] }, com("balcao", { alcanca: ["Quarto 1", "Banheiro"] })));
    expect(d.find(i => i.id === "sofa")!.alcanca).toBeUndefined();
    expect(d.find(i => i.id === "balcao")!.alcanca).toEqual(item("balcao").alcanca);
  });
});

describe("correções visuais do portão de QA (E3)", () => {
  it("rótulos das portas na planta 2D não se sobrepõem (P3 do banheiro × P4 do quarto 2) e cada P3 fica junto do seu vão", () => {
    const abs = planta2d(FONTE).aberturas;
    for (let a = 0; a < abs.length; a++) for (let b = a + 1; b < abs.length; b++) {
      const A = abs[a].rotulo, B = abs[b].rotulo;
      expect(Math.abs(A.x - B.x) >= 0.26 || Math.abs(A.z - B.z) >= 0.17, `${abs[a].id} × ${abs[b].id}`).toBe(true);
    }
    for (const ab of abs.filter(x => x.codigo === "P3")) {
      const cx = ab.vao.reduce((s, p) => s + p[0], 0) / ab.vao.length, cz = ab.vao.reduce((s, p) => s + p[1], 0) / ab.vao.length;
      expect(Math.hypot(ab.rotulo.x - cx, ab.rotulo.z - cz), ab.id).toBeLessThan(0.6);
    }
  });
  it("vista do editor enquadrada no ambiente: alvo no centro dele, mais perto que a visão geral", () => {
    const geral = cenaDaFonte(FONTE).vistas.find(v => v.tipo === "geral")!;
    const v = vistaDoAmbiente(FONTE, geral, "Cozinha")!;
    expect(v.tipo).toBe("geral");
    const dist = (x: typeof v) => Math.hypot(x.pos[0] - x.alvo[0], x.pos[1] - x.alvo[1], x.pos[2] - x.alvo[2]);
    expect(dist(v)).toBeLessThan(dist(geral));
    expect(vistaDoAmbiente(FONTE, geral, "Inexistente")).toBeNull();
  });
});
