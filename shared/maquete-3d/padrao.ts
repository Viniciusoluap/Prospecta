// Maquete 3D (EPIC-023, S-C — pedido do dono de 15/11/2026) — construções PADRÃO geradas pelo motor, sem PDF e sem
// IA: uma casa (térrea ou sobrado) ou um prédio simples, do tamanho informado, só para representar o
// empreendimento inteiro (uma construção em cada lote). Não é a planta do projeto: quando o PDF real for lido,
// ele substitui a construção padrão. Unidade: metros; a frente da construção fica em y = fundo (lado de baixo).
import {
  areaPoligono, type Abertura, type Comodo, type Edificacao, type Escada, type FuncaoComodo, type Implantacao, type Parede, type Pavimento, type Ponto,
} from "./modelo.js";

/** Id fixo da edificação gerada: é por ele que o sistema sabe o que pode ser trocado ao gerar de novo. */
export const ID_PADRAO = "padrao";
export const ehPadrao = (e: { id: string }) => e.id === ID_PADRAO;

export type CasaPadrao = { frente: number; fundo: number; quartos: number; pavimentos: 1 | 2; garagem: boolean };
export type PredioPadrao = { largura: number; profundidade: number; andares: number; aptosPorAndar: number; /** Térreo aberto (pilotis) usado como estacionamento. */ pilotis?: boolean; /** Vagas sob o pilotis, para o nome do ambiente. */ vagasNoPilotis?: number };

export const LIMITES_CASA = { frente: [5, 20], fundo: [7, 30], quartos: [1, 5] } as const;
export const LIMITES_PREDIO = { largura: [10, 60], profundidade: [9, 30], andares: [1, 40], aptosPorAndar: [2, 12], vagasPorApto: [0, 3], subsolos: [0, 3], areaTerreno: [100, 100000] } as const;

// ── Estacionamento do prédio (regra do dono, 15/11/2026): nunca sugerir mais apartamentos do que o terreno
//    comporta em vagas. A conta é feita antes de gerar o prédio; se não fechar, os andares são reduzidos. ──

/** Área por vaga já com a circulação (vaga de 2,5 × 5 m + metade do corredor de manobra de 5 m). */
export const M2_POR_VAGA = 25;
/** Parte da área que vira vaga em cada lugar: no pátio do lote sobram recuos, jardim e acessos; sob o pilotis, hall e pilares; no subsolo, rampa e caixa de escada. */
export const APROVEITAMENTO_VAGAS = { patio: 0.7, pilotis: 0.75, subsolo: 0.85 } as const;

export type EstacionamentoPredio = { vagasPorApto: number; pilotis: boolean; subsolos: number };
export type ContaDoEstacionamento = {
  vagas: { patio: number; pilotis: number; subsolos: number; total: number };
  aptosPorAndar: number; andaresPedidos: number; andares: number; apartamentos: number; vagasNecessarias: number;
  /** Os andares (ou os apartamentos por andar) foram reduzidos para caber no estacionamento. */
  reduzido: boolean;
  /** Nem um andar cabe: o prédio não é gerado. */
  inviavel: boolean;
};

/** Apartamentos por andar que a largura comporta (cada um com ao menos 4,5 m de fachada, dos dois lados do corredor). */
export const aptosPorAndarQueCabem = (largura: number, pedidos: number) =>
  Math.max(2, Math.min(Math.round(entre(pedidos, LIMITES_PREDIO.aptosPorAndar)), Math.floor(entre(largura, LIMITES_PREDIO.largura) / 4.5) * 2));

/** Vagas que cabem no terreno: pátio (área livre do lote), pilotis (sob o prédio) e subsolos (sob o lote). */
export function vagasDoTerreno(areaTerreno: number, largura: number, profundidade: number, e: EstacionamentoPredio): ContaDoEstacionamento["vagas"] {
  const projecao = entre(largura, LIMITES_PREDIO.largura) * entre(profundidade, LIMITES_PREDIO.profundidade);
  const patio = Math.floor((Math.max(0, areaTerreno - projecao) * APROVEITAMENTO_VAGAS.patio) / M2_POR_VAGA);
  const pilotis = e.pilotis ? Math.floor((projecao * APROVEITAMENTO_VAGAS.pilotis) / M2_POR_VAGA) : 0;
  const subsolos = Math.round(entre(e.subsolos, LIMITES_PREDIO.subsolos)) * Math.floor((Math.max(areaTerreno, projecao) * APROVEITAMENTO_VAGAS.subsolo) / M2_POR_VAGA);
  return { patio, pilotis, subsolos, total: patio + pilotis + subsolos };
}

/**
 * Fecha a conta do estacionamento: se os apartamentos pedidos precisam de mais vagas do que cabem, reduz os
 * andares até caber (e, se nem um andar couber, os apartamentos por andar). `vagasPorApto` 0 = sem exigência.
 */
export function contaDoEstacionamento(p: PredioPadrao, e: EstacionamentoPredio, areaTerreno: number): ContaDoEstacionamento {
  const vagas = vagasDoTerreno(areaTerreno, p.largura, p.profundidade, e);
  const porApto = entre(e.vagasPorApto, LIMITES_PREDIO.vagasPorApto), andaresPedidos = Math.round(entre(p.andares, LIMITES_PREDIO.andares));
  let aptosPorAndar = aptosPorAndarQueCabem(p.largura, p.aptosPorAndar), andares = andaresPedidos, inviavel = false;
  if (porApto > 0) {
    const aptosQueCabem = Math.floor(vagas.total / porApto + 1e-9);
    andares = Math.min(andaresPedidos, Math.floor(aptosQueCabem / aptosPorAndar));
    if (andares < 1) {
      // Nem um andar inteiro: tenta um andar com menos apartamentos (sempre em número par, dos dois lados do corredor).
      aptosPorAndar = Math.floor(aptosQueCabem / 2) * 2;
      andares = aptosPorAndar >= 2 ? 1 : 0;
      inviavel = andares === 0;
    }
  }
  const apartamentos = andares * aptosPorAndar;
  return { vagas, aptosPorAndar, andaresPedidos, andares, apartamentos, vagasNecessarias: Math.max(0, Math.ceil(apartamentos * porApto - 1e-9)),
    reduzido: andares < andaresPedidos || aptosPorAndar < aptosPorAndarQueCabem(p.largura, p.aptosPorAndar), inviavel };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const entre = (v: number, [a, b]: readonly [number, number]) => Math.min(b, Math.max(a, v));
const PE_DIREITO = 2.85, LAJE = 0.15;

type Ret = { nome: string; funcao: FuncaoComodo; x0: number; y0: number; x1: number; y1: number };
type Vao = { tipo: Abertura["tipo"]; x: number; y: number; largura: number; altura?: number; peitoril?: number; entrada?: boolean };

/** Monta um pavimento a partir de cômodos retangulares: as paredes saem das bordas (unidas) e as aberturas caem na parede do ponto. */
function pavimento(id: string, nome: string, nivel: number, comodos: Ret[], vaos: Vao[], extra: Partial<Pavimento> = {}): Pavimento {
  const xs = comodos.flatMap(c => [c.x0, c.x1]), ys = comodos.flatMap(c => [c.y0, c.y1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  // Bordas agrupadas por linha e unidas em trechos contínuos.
  const linhas = new Map<string, [number, number][]>();
  const borda = (eixo: "h" | "v", fixo: number, a: number, b: number) => {
    const k = `${eixo}:${r2(fixo)}`;
    linhas.set(k, [...(linhas.get(k) ?? []), [Math.min(a, b), Math.max(a, b)]]);
  };
  for (const c of comodos) { borda("h", c.y0, c.x0, c.x1); borda("h", c.y1, c.x0, c.x1); borda("v", c.x0, c.y0, c.y1); borda("v", c.x1, c.y0, c.y1); }
  const paredes: Parede[] = [];
  linhas.forEach((trechos, k) => {
    const [eixo, f] = k.split(":"), fixo = Number(f);
    const ordenados = [...trechos].sort((p, q) => p[0] - q[0]), unidos: [number, number][] = [];
    for (const t of ordenados) {
      const ultimo = unidos[unidos.length - 1];
      if (ultimo && t[0] <= ultimo[1] + 0.001) ultimo[1] = Math.max(ultimo[1], t[1]); else unidos.push([t[0], t[1]]);
    }
    for (const [a, b] of unidos) {
      if (b - a < 0.05) continue;
      const externa = eixo === "h" ? Math.abs(fixo - minY) < 0.001 || Math.abs(fixo - maxY) < 0.001 : Math.abs(fixo - minX) < 0.001 || Math.abs(fixo - maxX) < 0.001;
      paredes.push({
        id: `w${paredes.length + 1}`, a: eixo === "h" ? { x: r2(a), y: fixo } : { x: fixo, y: r2(a) }, b: eixo === "h" ? { x: r2(b), y: fixo } : { x: fixo, y: r2(b) },
        espessura: externa ? 0.2 : 0.14, externa, origem: "confirmada",
      });
    }
  });
  const aberturas: Abertura[] = [];
  for (const v of vaos) {
    const w = paredes.find(p => (p.a.y === p.b.y ? Math.abs(p.a.y - v.y) < 0.02 && v.x >= p.a.x - 0.01 && v.x <= p.b.x + 0.01 : Math.abs(p.a.x - v.x) < 0.02 && v.y >= p.a.y - 0.01 && v.y <= p.b.y + 0.01));
    if (!w) continue;
    const comp = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y), largura = Math.min(v.largura, comp - 0.3);
    if (largura < 0.5) continue;
    const pos = w.a.y === w.b.y ? v.x - w.a.x : v.y - w.a.y;
    const porta = v.tipo !== "janela";
    aberturas.push({
      id: `a${aberturas.length + 1}`, paredeId: w.id, tipo: v.tipo, posicao: r2(Math.min(comp - largura / 2 - 0.1, Math.max(largura / 2 + 0.1, pos))), largura: r2(largura),
      altura: v.altura ?? (porta ? 2.1 : 1.1), peitoril: v.peitoril ?? (porta ? 0 : 1), entradaPrincipal: !!v.entrada, origem: "confirmada",
    });
  }
  const cs: Comodo[] = comodos.map((c, i) => {
    const poligono = [{ x: r2(c.x0), y: r2(c.y0) }, { x: r2(c.x1), y: r2(c.y0) }, { x: r2(c.x1), y: r2(c.y1) }, { x: r2(c.x0), y: r2(c.y1) }];
    return { id: `c${i + 1}`, nome: c.nome, funcao: c.funcao, poligono, areaInformada: null, origem: "confirmada" };
  });
  return { id, nome, nivel, peDireito: PE_DIREITO, origemPeDireito: "confirmada", repeticoes: 1, paredes, aberturas, comodos: cs, escadas: [], ...extra };
}

const meio = (c: Ret) => ({ x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2 });

/** Fileira de quartos com um banheiro depois do primeiro. `porta`: em que y ficam as portas; `janela`: em que y ficam as janelas. */
function fileira(x0: number, x1: number, y0: number, y1: number, quartos: number, porta: number, janela: number, primeiro: number, comBanheiro = true) {
  const comodos: Ret[] = [], vaos: Vao[] = [];
  const banho = comBanheiro ? 1.7 : 0, cabem = Math.max(1, Math.min(quartos, Math.floor((x1 - x0 - banho) / 2.5)));
  const largura = (x1 - x0 - banho) / cabem;
  let x = x0;
  for (let i = 0; i < cabem; i++) {
    const q: Ret = { nome: `Quarto ${primeiro + i}`, funcao: "quarto", x0: x, y0, x1: x + largura, y1 };
    comodos.push(q); x += largura;
    vaos.push({ tipo: "porta", x: meio(q).x, y: porta, largura: 0.8 }, { tipo: "janela", x: meio(q).x, y: janela, largura: Math.min(1.5, largura - 1) });
    if (i === 0 && comBanheiro) {
      const b: Ret = { nome: "Banheiro", funcao: "banheiro", x0: x, y0, x1: x + banho, y1 };
      comodos.push(b); x += banho;
      vaos.push({ tipo: "porta", x: meio(b).x, y: porta, largura: 0.7 }, { tipo: "janela", x: meio(b).x, y: janela, largura: 0.6, altura: 0.6, peitoril: 1.5 });
    }
  }
  return { comodos, vaos, feitos: cabem };
}

/** Casa padrão: sala, cozinha, garagem (se couber), circulação, quartos e banheiro; sobrado leva os quartos para cima. */
export function casaPadrao(p: CasaPadrao): Edificacao {
  const W = r2(entre(p.frente, LIMITES_CASA.frente)), D = r2(entre(p.fundo, LIMITES_CASA.fundo));
  const quartos = Math.round(entre(p.quartos, LIMITES_CASA.quartos)), sobrado = p.pavimentos === 2 && W >= 6.5 && D >= 7.5;
  // Três faixas, do fundo (y = 0) para a frente (y = D): íntima, circulação (1 m) e social.
  // No sobrado a faixa do fundo precisa de 3,4 m para a caixa da escada em U.
  const minimoFundo = sobrado ? 3.4 : 2.7;
  const social = r2(Math.min(6, Math.max(2.8, Math.min(D * 0.42, D - 1 - minimoFundo))));
  const yb = r2(D - social - 1), yc = r2(D - social);
  const garagem = p.garagem && W >= 7.5 ? 3 : 0, cozinha = r2(Math.min(3.6, Math.max(2.3, W * 0.28)));
  const sala: Ret = { nome: "Sala", funcao: "sala", x0: garagem, y0: yc, x1: W - cozinha, y1: D };
  const frente: Ret[] = [sala, { nome: "Cozinha", funcao: "cozinha", x0: W - cozinha, y0: yc, x1: W, y1: D }];
  if (garagem) frente.unshift({ nome: "Garagem", funcao: "garagem", x0: 0, y0: yc, x1: garagem, y1: D });
  const circ: Ret = { nome: "Circulação", funcao: "circulacao", x0: 0, y0: yb, x1: W, y1: yc };
  const larguraSala = sala.x1 - sala.x0;
  const vaosFrente: Vao[] = [
    { tipo: "porta", x: sala.x0 + Math.min(0.9, larguraSala / 3), y: D, largura: 0.9, entrada: true },
    { tipo: "vao", x: meio(sala).x, y: yc, largura: Math.min(2, larguraSala - 0.8) },
    { tipo: "vao", x: W - cozinha, y: (yc + D) / 2, largura: Math.min(1.4, social - 0.8) },
    { tipo: "janela", x: W - cozinha / 2, y: D, largura: Math.min(1.2, cozinha - 0.8) },
  ];
  if (larguraSala >= 3.4) vaosFrente.push({ tipo: "janela", x: sala.x1 - Math.min(1.2, larguraSala / 3), y: D, largura: 1.5 });
  if (garagem) vaosFrente.push({ tipo: "vao", x: garagem / 2, y: D, largura: 2.4, altura: 2.2 }, { tipo: "porta", x: garagem, y: (yc + D) / 2, largura: 0.8 });
  const cobertura: Edificacao["cobertura"] = { tipo: "duas_aguas", inclinacao: 30, beiral: 0.5, origem: "confirmada" };

  if (!sobrado) {
    const intima = fileira(0, W, 0, yb, quartos, yb, 0, 1);
    return { id: ID_PADRAO, nome: "Casa padrão", cobertura, pavimentos: [pavimento("p1", "Térreo", 0, [...intima.comodos, circ, ...frente], [...intima.vaos, ...vaosFrente])] };
  }

  // Sobrado: escada em U numa caixa de 2 × 3,2 m no canto do fundo; parte da circulação e chega nela, um andar acima.
  const subida = PE_DIREITO + LAJE, xe = r2(W - 2), ye = r2(yb - 3.2);
  const escada: Escada = {
    id: "e1", tipo: "em_u", largura: 0.95, degraus: Math.ceil(subida / 0.18), destinoPavimentoId: "p2", origem: "confirmada", percurso: [],
    poligono: [{ x: xe, y: ye }, { x: W, y: ye }, { x: W, y: yb }, { x: xe, y: yb }],
    inicio: { x: r2(xe + 0.5), y: r2(yb - 0.05) }, fim: { x: r2(W - 0.5), y: r2(yb - 0.05) },
  };
  const caixa: Ret = { nome: "Escada", funcao: "circulacao", x0: xe, y0: 0, x1: W, y1: yb };
  const vaoDaCaixa: Vao = { tipo: "vao", x: xe + 1, y: yb, largura: 1.75, altura: 2.4 };
  const servico = xe >= 6.2 ? r2(1.6 + (xe - 1.6) / 2) : xe;
  const terreoFundo: Ret[] = [
    { nome: "Lavabo", funcao: "lavabo", x0: 0, y0: 0, x1: 1.6, y1: yb },
    { nome: "Área de serviço", funcao: "area_servico", x0: 1.6, y0: 0, x1: servico, y1: yb },
  ];
  if (servico < xe) terreoFundo.push({ nome: "Escritório", funcao: "escritorio", x0: servico, y0: 0, x1: xe, y1: yb });
  const vaosTerreo: Vao[] = terreoFundo.flatMap(c => [
    { tipo: "porta" as const, x: meio(c).x, y: yb, largura: c.funcao === "lavabo" ? 0.7 : 0.8 },
    c.funcao === "lavabo" ? { tipo: "janela" as const, x: meio(c).x, y: 0, largura: 0.6, altura: 0.6, peitoril: 1.5 } : { tipo: "janela" as const, x: meio(c).x, y: 0, largura: Math.min(1.2, c.x1 - c.x0 - 1) },
  ]);
  const terreo = pavimento("p1", "Térreo", 0, [...terreoFundo, caixa, circ, ...frente], [...vaosTerreo, vaoDaCaixa, ...vaosFrente], { escadas: [escada] });
  // Em cima: quartos e banheiro no fundo; na frente, a suíte (e os quartos que faltarem).
  const fundo = fileira(0, xe, 0, yb, Math.max(1, quartos - 1), yb, 0, 1);
  const faltam = quartos - fundo.feitos;
  const frenteCima = faltam > 1 ? fileira(0, W, yc, D, faltam, yc, D, fundo.feitos + 1, false)
    : { comodos: [{ nome: "Suíte", funcao: "suite" as const, x0: 0, y0: yc, x1: W, y1: D }], vaos: [{ tipo: "porta" as const, x: W / 3, y: yc, largura: 0.8 }, { tipo: "janela" as const, x: W / 2, y: D, largura: 1.8 }] };
  const superior = pavimento("p2", "Pavimento superior", r2(subida), [...fundo.comodos, caixa, circ, ...frenteCima.comodos], [...fundo.vaos, vaoDaCaixa, ...frenteCima.vaos]);
  return { id: ID_PADRAO, nome: "Sobrado padrão", cobertura, pavimentos: [terreo, superior] };
}

/** Prédio padrão: térreo de uso comum e um pavimento-tipo repetido, com corredor central e apartamentos dos dois lados. */
export function predioPadrao(p: PredioPadrao): Edificacao {
  const W = r2(entre(p.largura, LIMITES_PREDIO.largura)), D = r2(entre(p.profundidade, LIMITES_PREDIO.profundidade));
  const andares = Math.round(entre(p.andares, LIMITES_PREDIO.andares));
  const porAndar = aptosPorAndarQueCabem(W, p.aptosPorAndar);
  const c0 = r2((D - 1.6) / 2), c1 = r2(c0 + 1.6);
  // Térreo: hall de entrada; com pilotis, o hall fica no meio e os dois lados são estacionamento aberto para a frente.
  const h0 = r2(W / 2 - 2.5), h1 = r2(W / 2 + 2.5), rotuloVagas = p.vagasNoPilotis ? ` (${p.vagasNoPilotis} vagas)` : "";
  const terreo = p.pilotis
    ? pavimento("p1", "Térreo", 0,
      [{ nome: `Estacionamento sob pilotis${rotuloVagas}`, funcao: "garagem", x0: 0, y0: 0, x1: h0, y1: D }, { nome: "Hall de entrada", funcao: "hall", x0: h0, y0: 0, x1: h1, y1: D },
        { nome: `Estacionamento sob pilotis${rotuloVagas}`, funcao: "garagem", x0: h1, y0: 0, x1: W, y1: D }],
      [{ tipo: "porta_janela", x: W / 2, y: D, largura: 2.4, altura: 2.4, entrada: true },
        { tipo: "vao", x: h0 / 2, y: D, largura: Math.max(2.4, h0 - 1.2), altura: 2.4 }, { tipo: "vao", x: (h1 + W) / 2, y: D, largura: Math.max(2.4, W - h1 - 1.2), altura: 2.4 },
        { tipo: "porta", x: h0, y: D / 2, largura: 0.9 }, { tipo: "porta", x: h1, y: D / 2, largura: 0.9 }])
    : pavimento("p1", "Térreo", 0,
      [{ nome: "Hall e áreas comuns", funcao: "area_comum", x0: 0, y0: 0, x1: W, y1: D }],
      [{ tipo: "porta_janela", x: W / 2, y: D, largura: 2.4, altura: 2.4, entrada: true },
        ...Array.from({ length: Math.max(1, Math.floor(W / 6)) }, (_, i) => ({ tipo: "janela" as const, x: ((i + 0.5) * W) / Math.max(1, Math.floor(W / 6)), y: 0, largura: 1.6 }))]);
  const comodos: Ret[] = [{ nome: "Hall dos apartamentos", funcao: "hall", x0: 0, y0: c0, x1: W, y1: c1 }], vaos: Vao[] = [];
  const fileiraDeAptos = (quantos: number, y0: number, y1: number, corredor: number, fachada: number, primeiro: number) => {
    const largura = W / quantos, fundoBanho = corredor === y1 ? y1 - 1.9 : y0 + 1.9;
    for (let i = 0; i < quantos; i++) {
      const x0 = i * largura, xm = r2(x0 + largura * 0.58), x1 = x0 + largura, n = primeiro + i;
      const sala: Ret = { nome: `Apto ${n} · Sala e cozinha`, funcao: "sala", x0, y0, x1: xm, y1 };
      const banho: Ret = corredor === y1 ? { nome: `Apto ${n} · Banheiro`, funcao: "banheiro", x0: xm, y0: fundoBanho, x1, y1 } : { nome: `Apto ${n} · Banheiro`, funcao: "banheiro", x0: xm, y0, x1, y1: fundoBanho };
      const quarto: Ret = corredor === y1 ? { nome: `Apto ${n} · Quarto`, funcao: "quarto", x0: xm, y0, x1, y1: fundoBanho } : { nome: `Apto ${n} · Quarto`, funcao: "quarto", x0: xm, y0: fundoBanho, x1, y1 };
      comodos.push(sala, quarto, banho);
      vaos.push(
        { tipo: "porta", x: meio(sala).x, y: corredor, largura: 0.9 },
        { tipo: "janela", x: meio(sala).x, y: fachada, largura: Math.min(1.8, xm - x0 - 1) },
        { tipo: "porta", x: xm, y: meio(quarto).y, largura: 0.8 },
        { tipo: "janela", x: meio(quarto).x, y: fachada, largura: Math.min(1.4, x1 - xm - 0.8) },
        { tipo: "porta", x: meio(banho).x, y: fundoBanho, largura: 0.7 },
      );
    }
  };
  const emCima = Math.ceil(porAndar / 2);
  fileiraDeAptos(emCima, 0, c0, c0, 0, 1);
  fileiraDeAptos(porAndar - emCima, c1, D, c1, D, emCima + 1);
  const tipo = pavimento("p2", `Pavimento-tipo (${andares}×)`, r2(PE_DIREITO + LAJE), comodos, vaos, { repeticoes: andares });
  return { id: ID_PADRAO, nome: "Prédio padrão", cobertura: { tipo: "platibanda", inclinacao: 0, beiral: 0, origem: "confirmada" }, pavimentos: [terreo, tipo] };
}

// ── Distribuição nos lotes ──

const dentro = (p: Ponto, pts: Ponto[]) => {
  let d = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) d = !d;
  }
  return d;
};
/** Centro de massa do polígono (não a média dos vértices: lote em leque tem vértices concentrados numa ponta). */
function centroDeMassa(pts: Ponto[]): Ponto {
  let a = 0, x = 0, y = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length], f = p.x * q.y - q.x * p.y;
    a += f; x += (p.x + q.x) * f; y += (p.y + q.y) * f;
  }
  return Math.abs(a) < 1e-9 ? pts[0] : { x: x / (3 * a), y: y / (3 * a) };
}
const distanciaAoSegmento = (p: Ponto, a: Ponto, b: Ponto) => {
  const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
};

export type ResultadoDistribuicao = { posicoes: Implantacao["posicoes"]; semConstrucao: string[] };

/**
 * Uma construção em cada lote vendável, com a frente virada para a rua mais próxima (ou, sem ruas, alinhada ao
 * maior lado). A construção só entra se couber inteira no lote; tenta de frente e, se não der, de lado.
 * Lotes em que não cabe ficam sem construção e voltam na lista, para a tela avisar.
 */
export function distribuirNosLotes(imp: Implantacao, largura: number, fundo: number, edificacaoId = ID_PADRAO): ResultadoDistribuicao {
  const posicoes: Implantacao["posicoes"] = [], semConstrucao: string[] = [];
  const ruas = [...imp.ruas, ...imp.vias.map(v => v.eixo)].filter(r => r.length >= 2);
  const ateRua = (p: Ponto) => {
    let menor = Infinity;
    for (const r of ruas) for (let i = 0; i < r.length - 1 + (r.length > 2 ? 1 : 0); i++) menor = Math.min(menor, distanciaAoSegmento(p, r[i], r[(i + 1) % r.length]));
    return menor;
  };
  for (const l of imp.lotes) {
    if (l.tipo !== "vendavel" || l.poligono.length < 3) continue;
    const rotulo = [l.quadra && `Q${l.quadra}`, l.nome && `L${l.nome}`].filter(Boolean).join(" ") || l.id;
    const c = centroDeMassa(l.poligono);
    // Frente do lote: o lado mais perto de uma rua; sem ruas, o menor lado (testada costuma ser o lado curto).
    let frente = { x: 0, y: 1 }, melhor = Infinity;
    l.poligono.forEach((a, k) => {
      const b = l.poligono[(k + 1) % l.poligono.length], m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const nota = ruas.length ? ateRua(m) : Math.hypot(b.x - a.x, b.y - a.y);
      const d = Math.hypot(m.x - c.x, m.y - c.y);
      if (nota < melhor - 0.01 && d > 0.01) { melhor = nota; frente = { x: (m.x - c.x) / d, y: (m.y - c.y) / d }; }
    });
    const base = Math.atan2(-frente.x, frente.y);
    let posta = false;
    for (const giro of [0, Math.PI / 2, -Math.PI / 2]) {
      const ang = base + giro, cs = Math.cos(ang), sn = Math.sin(ang);
      const canto = (x: number, y: number): Ponto => ({ x: c.x + (x - largura / 2) * cs - (y - fundo / 2) * sn, y: c.y + (x - largura / 2) * sn + (y - fundo / 2) * cs });
      const cantos = [canto(0, 0), canto(largura, 0), canto(largura, fundo), canto(0, fundo)];
      if (!cantos.every(p => dentro(p, l.poligono))) continue;
      posicoes.push({ id: `i${posicoes.length + 1}`, edificacaoId, nome: rotulo, x: r2(cantos[0].x), y: r2(cantos[0].y), rotacao: r2((ang * 180) / Math.PI), unidade: l.unidade });
      posta = true;
      break;
    }
    if (!posta) semConstrucao.push(rotulo);
  }
  return { posicoes, semConstrucao };
}

/** Maior construção retangular (frente × fundo) que cabe em pelo menos `fracao` dos lotes vendáveis; ajuda a sugerir o tamanho. */
export function tamanhoQueCabe(imp: Implantacao, frente: number, fundo: number, fracao = 0.9): { frente: number; fundo: number } | null {
  const vendaveis = imp.lotes.filter(l => l.tipo === "vendavel" && l.poligono.length >= 3 && areaPoligono(l.poligono) > 1).length;
  if (!vendaveis) return null;
  for (let escala = 1; escala >= 0.4; escala -= 0.05) {
    const f = r2(frente * escala), d = r2(fundo * escala);
    if (f < LIMITES_CASA.frente[0] || d < LIMITES_CASA.fundo[0]) break;
    if (distribuirNosLotes(imp, f, d).posicoes.length >= vendaveis * fracao) return { frente: f, fundo: d };
  }
  return null;
}
