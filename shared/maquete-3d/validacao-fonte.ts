// Maquete 3D (EPIC-028, Etapa 1) — validações puras do JSON-fonte (`fonte.ts`). Mesma função para a tela (botão
// Salvar, nas próximas etapas) e para o servidor (recusa). Devolve erros e avisos em português; nunca corrige nada
// em silêncio.
import { areaPoligono, type Ponto } from "./modelo.js";
import {
  EPS_AREA, areaComum, contornoDaParede, contornoDoItem, ehOrtogonal, eixoDaParede, poligonoDoAmbiente,
  retanguloNaParede, setor, type AberturaFonte, type AmbienteFonte, type FontePlanta, type ItemFonte, type ParedeFonte,
} from "./fonte.js";

/** Tolerâncias num lugar só. */
export const TOLERANCIAS = {
  /** Área calculada × quadro de ambientes. */
  area: 0.02,
  /** Soma das cadeias de cotas, encaixe de aberturas e contorno (m). */
  medida: 0.01,
  /** Faixa livre de passagem em frente ao vão de portas e portões (m). */
  faixaLivre: 0.8,
  /** Profundidade, a partir da face da parede, considerada "debaixo da janela" (m). */
  sobJanela: 0.6,
  /** Item mais alto que isto não fica debaixo de janela (m acima do piso). A janela J1 tem peitoril 1,10. */
  alturaSobJanela: 1.1,
  /** O balcão da cozinha tem de ficar abaixo disto (m). */
  balcaoAlturaMax: 1.2,
} as const;

export type CodigoProblema =
  | "referencia" | "id_repetido"
  | "area_ambiente" | "faixas_soma" | "faixas_parede" | "casa_contorno"
  | "parede_obliqua" | "paredes_sobrepostas" | "paredes_cruzadas"
  | "abertura_fora" | "abertura_sobreposta" | "abertura_altura" | "abertura_tapada" | "abertura_sem_lado"
  | "item_parede" | "item_fora_ambiente" | "item_vao" | "item_giro_porta" | "item_faixa_livre" | "item_sob_janela"
  | "itens_sobrepostos" | "item_elevado" | "balcao_alto" | "balcao_parede" | "balcao_ausente" | "balcao_passagem";

export type ProblemaFonte = { nivel: "erro" | "aviso"; codigo: CodigoProblema; onde: string; mensagem: string };

const fmt = (n: number, casas = 2) => n.toFixed(casas).replace(".", ",");
const pct = (n: number) => `${fmt(n * 100, 1)}%`;

export type AreaConferida = { nome: string; quadro: number; calculada: number; desvio: number; ok: boolean };

/** Área de cada ambiente que está no quadro × área calculada pelo polígono. */
export function conferirAreas(f: FontePlanta): AreaConferida[] {
  return f.estrutura.ambientes.filter(a => a.area_planta != null).map(a => {
    const calculada = areaPoligono(poligonoDoAmbiente(a)), quadro = a.area_planta as number;
    const desvio = (calculada - quadro) / quadro;
    return { nome: a.nome, quadro, calculada, desvio, ok: Math.abs(desvio) <= TOLERANCIAS.area + 1e-9 };
  });
}

/** Lado da parede (+1 = normal de `eixoDaParede`, −1 = oposto) em que fica o ambiente, testando perto do vão. */
export function ladoDoAmbiente(w: ParedeFonte, s: number, amb: AmbienteFonte): 1 | -1 | null {
  const { ux, uz, nx, nz } = eixoDaParede(w);
  const pol = poligonoDoAmbiente(amb);
  for (const lado of [1, -1] as const) {
    const t = lado * (w.esp / 2 + 0.05);
    const q: Ponto = { x: w.x1 + ux * s + nx * t, y: w.z1 + uz * s + nz * t };
    if (dentro(q, pol)) return lado;
  }
  return null;
}

function dentro(q: Ponto, pol: Ponto[]): boolean {
  let c = false;
  for (let i = 0, j = pol.length - 1; i < pol.length; j = i++) {
    const a = pol[i], b = pol[j];
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** Áreas proibidas de uma porta/portão: o vão, o giro da folha e a faixa livre na frente, dos dois lados. */
export function zonasDaPorta(w: ParedeFonte, ab: AberturaFonte, ambientes: AmbienteFonte[]) {
  const s0 = ab.offset, s1 = ab.offset + ab.larg, e = w.esp / 2;
  const vao = retanguloNaParede(w, s0, s1, -e, e);
  const faixas = [retanguloNaParede(w, s0, s1, e, e + TOLERANCIAS.faixaLivre), retanguloNaParede(w, s0, s1, -e - TOLERANCIAS.faixaLivre, -e)];
  let giro: Ponto[] | null = null;
  if (ab.abertura !== "correr") {
    const amb = ambientes.find(a => a.nome === ab.abre_para);
    const lado = amb ? ladoDoAmbiente(w, (s0 + s1) / 2, amb) : null;
    if (lado) {
      const { ux, uz, nx, nz } = eixoDaParede(w);
      const sDob = ab.abertura === "esq" ? s0 : s1, sentido = ab.abertura === "esq" ? 1 : -1;
      const t = lado * e;
      const centro: Ponto = { x: w.x1 + ux * sDob + nx * t, y: w.z1 + uz * sDob + nz * t };
      giro = setor(centro, { x: ux * sentido, y: uz * sentido }, { x: nx * lado, y: nz * lado }, ab.larg);
    }
  }
  return { vao, faixas, giro };
}

/** Topo do item em relação à rua. */
const topoDoItem = (i: ItemFonte, piso: number) => piso + (i.elev ?? 0) + i.alt;

export function validarFonte(f: FontePlanta): ProblemaFonte[] {
  const out: ProblemaFonte[] = [];
  const add = (nivel: ProblemaFonte["nivel"], codigo: CodigoProblema, onde: string, mensagem: string) =>
    out.push({ nivel, codigo, onde, mensagem });
  const tol = TOLERANCIAS.medida;
  const { casa, paredes, aberturas, ambientes } = f.estrutura;
  const paredePorId = new Map(paredes.map(w => [w.id, w] as const));
  const ambPorNome = new Map(ambientes.map(a => [a.nome, a] as const));

  // ── Referências e ids ──
  const repetidos = (lista: string[]) => lista.filter((v, k) => lista.indexOf(v) !== k);
  for (const [o, lista] of [["paredes", paredes.map(w => w.id)], ["aberturas", aberturas.map(a => a.id)],
    ["ambientes", ambientes.map(a => a.nome)], ["itens", f.itens.map(i => i.id)]] as const)
    for (const v of Array.from(new Set(repetidos([...lista])))) add("erro", "id_repetido", o, `"${v}" aparece mais de uma vez em ${o}.`);

  // ── Áreas × quadro ──
  for (const a of conferirAreas(f))
    if (!a.ok) add("erro", "area_ambiente", a.nome,
      `${a.nome}: área calculada ${fmt(a.calculada)} m² × quadro ${fmt(a.quadro)} m² (desvio ${pct(a.desvio)}, limite ±${pct(TOLERANCIAS.area)}).`);

  // ── Cadeias de cotas e contorno da casa ──
  const casaParedes = paredes.filter(w => !w.muro);
  for (const [eixo, faixas, total] of [["largura", casa.faixas_largura, casa.w], ["profundidade", casa.faixas_profundidade, casa.d]] as const) {
    const soma = faixas.reduce((s, x) => s + x.medida, 0);
    if (Math.abs(soma - total) > tol)
      add("erro", "faixas_soma", `casa.faixas_${eixo}`, `As faixas da ${eixo} somam ${fmt(soma)} m, mas a casa tem ${fmt(total)} m.`);
    // Cada faixa "parede" tem de ser uma parede de verdade, perpendicular à cadeia, naquela posição.
    let ini = 0;
    for (const fx of faixas) {
      const fim = ini + fx.medida;
      if (fx.tipo === "parede") {
        const achou = casaParedes.some(w => {
          if (eixo === "largura") return Math.abs(w.x1 - w.x2) < 1e-6 && Math.abs(w.x1 - w.esp / 2 - ini) <= tol && Math.abs(w.x1 + w.esp / 2 - fim) <= tol;
          return Math.abs(w.z1 - w.z2) < 1e-6 && Math.abs(w.z1 - w.esp / 2 - ini) <= tol && Math.abs(w.z1 + w.esp / 2 - fim) <= tol;
        });
        if (!achou) add("erro", "faixas_parede", `casa.faixas_${eixo}`,
          `Na ${eixo}, a faixa de parede de ${fmt(ini)} a ${fmt(fim)} m não corresponde a nenhuma parede do modelo.`);
      }
      ini = fim;
    }
  }
  if (casaParedes.length) {
    const pts = casaParedes.flatMap(contornoDaParede);
    const xs = pts.map(q => q.x), zs = pts.map(q => q.y);
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    if (Math.abs(x0) > tol || Math.abs(x1 - casa.w) > tol || Math.abs(z0) > tol || Math.abs(z1 - casa.d) > tol)
      add("erro", "casa_contorno", "paredes", `As paredes da casa ocupam x ${fmt(x0)}→${fmt(x1)} e z ${fmt(z0)}→${fmt(z1)}, ` +
        `mas a casa é ${fmt(casa.w)} × ${fmt(casa.d)} m.`);
  }

  // ── Paredes ──
  for (const w of paredes) if (!ehOrtogonal(w)) add("erro", "parede_obliqua", w.id, `A parede ${w.id} não é paralela a x nem a z.`);
  const ret = new Map(paredes.map(w => [w.id, contornoDaParede(w)] as const));
  for (let a = 0; a < paredes.length; a++) for (let b = a + 1; b < paredes.length; b++) {
    const A = paredes[a], B = paredes[b];
    if (!ehOrtogonal(A) || !ehOrtogonal(B)) continue;
    const comum = areaComum(ret.get(A.id)!, ret.get(B.id)!);
    if (comum <= EPS_AREA) continue;
    const ua = eixoDaParede(A), ub = eixoDaParede(B);
    const paralelas = Math.abs(ua.ux * ub.ux + ua.uz * ub.uz) > 0.5;
    if (paralelas) {
      add("erro", "paredes_sobrepostas", `${A.id} × ${B.id}`, `As paredes ${A.id} e ${B.id} ocupam o mesmo lugar (${fmt(comum, 3)} m² em comum).`);
      continue;
    }
    // Perpendiculares: encontro em L ou T é normal (uma das duas termina dentro da outra); cruzamento em X não.
    const pontaDentro = (w: ParedeFonte, outra: ParedeFonte) =>
      [[w.x1, w.z1], [w.x2, w.z2]].some(([x, z]) => dentroOuBorda({ x, y: z }, ret.get(outra.id)!));
    if (!pontaDentro(A, B) && !pontaDentro(B, A))
      add("aviso", "paredes_cruzadas", `${A.id} × ${B.id}`, `As paredes ${A.id} e ${B.id} se cruzam no meio; confira na planta.`);
  }

  // ── Aberturas ──
  const porParede = new Map<string, AberturaFonte[]>();
  for (const ab of aberturas) {
    const w = paredePorId.get(ab.parede);
    if (!w) { add("erro", "referencia", ab.id, `A abertura ${ab.id} aponta para a parede "${ab.parede}", que não existe.`); continue; }
    porParede.set(w.id, [...(porParede.get(w.id) ?? []), ab]);
    const comp = eixoDaParede(w).comp;
    if (ab.offset < -tol || ab.offset + ab.larg > comp + tol)
      add("erro", "abertura_fora", ab.id, `${ab.codigo} (${ab.id}) vai de ${fmt(ab.offset)} a ${fmt(ab.offset + ab.larg)} m, mas a parede ${w.id} tem ${fmt(comp)} m.`);
    if (ab.peitoril + ab.alt > w.h + tol)
      add("erro", "abertura_altura", ab.id, `${ab.codigo} (${ab.id}) chega a ${fmt(ab.peitoril + ab.alt)} m, acima da altura da parede ${w.id} (${fmt(w.h)} m).`);
    if (ab.abertura !== "correr") {
      const amb = ab.abre_para ? ambPorNome.get(ab.abre_para) : undefined;
      if (!amb) add("erro", "referencia", ab.id, `${ab.codigo} (${ab.id}) é de abrir e precisa dizer para qual ambiente abre (abre_para).`);
      else if (!ladoDoAmbiente(w, ab.offset + ab.larg / 2, amb))
        add("erro", "abertura_sem_lado", ab.id, `${ab.codigo} (${ab.id}) abre para "${amb.nome}", mas esse ambiente não encosta na parede ${w.id}.`);
    }
    const vao = retanguloNaParede(w, ab.offset, ab.offset + ab.larg, -w.esp / 2, w.esp / 2);
    for (const outra of paredes) {
      if (outra.id === w.id || !ehOrtogonal(outra)) continue;
      if (areaComum(vao, ret.get(outra.id)!) > EPS_AREA)
        add("erro", "abertura_tapada", ab.id, `O vão de ${ab.codigo} (${ab.id}) fica tapado pela parede ${outra.id}.`);
    }
  }
  for (const [wid, lista] of Array.from(porParede)) {
    const ord = [...lista].sort((a, b) => a.offset - b.offset);
    for (let k = 1; k < ord.length; k++)
      if (ord[k].offset < ord[k - 1].offset + ord[k - 1].larg - tol)
        add("erro", "abertura_sobreposta", `${ord[k - 1].id} × ${ord[k].id}`, `${ord[k - 1].codigo} e ${ord[k].codigo} se sobrepõem na parede ${wid}.`);
  }

  // ── Itens ──
  const zonas = aberturas.flatMap(ab => {
    const w = paredePorId.get(ab.parede);
    return w && (ab.tipo === "porta" || ab.tipo === "portao") ? [{ ab, w, ...zonasDaPorta(w, ab, ambientes) }] : [];
  });
  const janelas = aberturas.flatMap(ab => {
    const w = paredePorId.get(ab.parede);
    if (!w || ab.tipo !== "janela") return [];
    const e = w.esp / 2, s0 = ab.offset, s1 = ab.offset + ab.larg;
    return [{ ab, w, zonas: [retanguloNaParede(w, s0, s1, e, e + TOLERANCIAS.sobJanela), retanguloNaParede(w, s0, s1, -e - TOLERANCIAS.sobJanela, -e)] }];
  });
  const contornos = new Map(f.itens.map(i => [i.id, contornoDoItem(i)] as const));
  const nome = (i: ItemFonte) => `"${i.id}" (${i.tipo})`;

  for (const i of f.itens) {
    const c = contornos.get(i.id)!, areaItem = i.larg * i.prof;
    const amb = ambPorNome.get(i.ambiente);
    if (!amb) { add("erro", "referencia", i.id, `O item ${nome(i)} aponta para o ambiente "${i.ambiente}", que não existe.`); continue; }
    const extras = (i.alcanca ?? []).map(n => ambPorNome.get(n));
    if (extras.some(x => !x)) add("erro", "referencia", i.id, `O item ${nome(i)} lista em "alcanca" um ambiente que não existe.`);
    const permitidos = [amb, ...extras.filter((x): x is AmbienteFonte => !!x)];

    // Não atravessa parede (o vão das portas não é parede: quem fica nele é cobrado pela regra do vão).
    for (const w of paredes) {
      if (!ehOrtogonal(w)) continue;
      const noVao = zonas.filter(zn => zn.w.id === w.id && zn.ab.peitoril === 0).reduce((s, zn) => s + areaComum(zn.vao, c), 0);
      if (areaComum(ret.get(w.id)!, c) - noVao > EPS_AREA)
        add("erro", "item_parede", i.id, `O item ${nome(i)} atravessa a parede ${w.id}.`);
    }
    // Fica inteiro dentro do(s) ambiente(s) dele.
    const coberto = permitidos.reduce((s, a) => s + areaComum(poligonoDoAmbiente(a), c), 0);
    if (coberto < areaItem - EPS_AREA)
      add("erro", "item_fora_ambiente", i.id, `O item ${nome(i)} sai do ambiente ${i.ambiente} (${fmt(areaItem - coberto, 3)} m² para fora).`);

    // Portas e portões: vão, giro da folha e faixa livre de 0,80 m. Item acima da porta (pendurado) não bloqueia.
    for (const zn of zonas) {
      if ((i.elev ?? 0) >= zn.ab.peitoril + zn.ab.alt) continue;
      const rot = `${zn.ab.codigo} (${zn.ab.id})`;
      if (areaComum(zn.vao, c) > EPS_AREA)
        add("erro", "item_vao", i.id, `O item ${nome(i)} ocupa o vão da porta ${rot}: porta bloqueada.`);
      if (zn.giro && areaComum(zn.giro, c) > EPS_AREA)
        add("erro", "item_giro_porta", i.id, `O item ${nome(i)} fica no giro da folha da porta ${rot}: porta bloqueada.`);
      if (zn.faixas.some(fx => areaComum(fx, c) > EPS_AREA))
        add("erro", "item_faixa_livre", i.id,
          `O item ${nome(i)} invade a faixa livre de ${fmt(TOLERANCIAS.faixaLivre)} m em frente à porta ${rot}: passagem bloqueada.`);
    }
    // Item alto não fica debaixo de janela.
    const topo = topoDoItem(i, amb.piso);
    for (const jn of janelas) {
      const limite = jn.w.base + Math.min(jn.ab.peitoril, TOLERANCIAS.alturaSobJanela);
      if (topo > limite + 1e-9 && jn.zonas.some(z => areaComum(z, c) > EPS_AREA))
        add("erro", "item_sob_janela", i.id, `O item ${nome(i)} tem ${fmt(topo - amb.piso)} m de altura e fica debaixo da janela ` +
          `${jn.ab.codigo} (${jn.ab.id}), de peitoril ${fmt(jn.ab.peitoril)} m.`);
    }
  }
  // Itens não se sobrepõem (em planta e na altura ao mesmo tempo).
  for (let a = 0; a < f.itens.length; a++) for (let b = a + 1; b < f.itens.length; b++) {
    const A = f.itens[a], B = f.itens[b];
    if (areaComum(contornos.get(A.id)!, contornos.get(B.id)!) <= EPS_AREA) continue;
    const pa = ambPorNome.get(A.ambiente)?.piso ?? 0, pb = ambPorNome.get(B.ambiente)?.piso ?? 0;
    const [a0, a1] = [pa + (A.elev ?? 0), topoDoItem(A, pa)], [b0, b1] = [pb + (B.elev ?? 0), topoDoItem(B, pb)];
    if (Math.min(a1, b1) - Math.max(a0, b0) > 1e-3)
      add("erro", "itens_sobrepostos", `${A.id} × ${B.id}`, `Os itens ${nome(A)} e ${nome(B)} ocupam o mesmo lugar.`);
  }

  // ── Balcão da cozinha ──
  const balcoes = f.itens.filter(i => i.tipo === "balcao" && (i.ambiente === "Cozinha" || i.alcanca?.includes("Cozinha")));
  if (!balcoes.length && ambPorNome.has("Cozinha"))
    add("aviso", "balcao_ausente", "itens", "A cozinha não tem balcão (item do tipo balcao).");
  for (const b of balcoes) {
    const alt = (b.elev ?? 0) + b.alt;
    if (alt >= TOLERANCIAS.balcaoAlturaMax)
      add("erro", "balcao_alto", b.id, `O balcão ${b.id} tem ${fmt(alt)} m; precisa ficar abaixo de ${fmt(TOLERANCIAS.balcaoAlturaMax)} m (é balcão, não parede).`);
    const c = contornos.get(b.id)!;
    for (const w of paredes)
      if (ehOrtogonal(w) && areaComum(ret.get(w.id)!, c) > EPS_AREA)
        add("erro", "balcao_parede", b.id, `Existe a parede ${w.id} no trecho do balcão ${b.id}: entre a cozinha e a sala é balcão, não parede.`);
    // A passagem ao lado do balcão (cozinha → sala) continua com pelo menos 0,80 m.
    const coz = ambPorNome.get("Cozinha");
    if (coz) {
      const xs = coz.poligono.map(([x]) => x), minX = Math.min(...xs), xb = Math.min(...c.map(q => q.x));
      if (xb - minX < TOLERANCIAS.faixaLivre - tol)
        add("aviso", "balcao_passagem", b.id, `A passagem ao lado do balcão ficou com ${fmt(xb - minX)} m (mínimo ${fmt(TOLERANCIAS.faixaLivre)} m).`);
    }
  }
  return out;
}

function dentroOuBorda(q: Ponto, pol: Ponto[]): boolean {
  if (dentro(q, pol)) return true;
  for (let k = 0; k < pol.length; k++) {
    const a = pol[k], b = pol[(k + 1) % pol.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const t = ((q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y)) / (len * len);
    if (t < -1e-9 || t > 1 + 1e-9) continue;
    const d = Math.abs((b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x)) / len;
    if (d < 1e-6) return true;
  }
  return false;
}

export const temErro = (ps: ProblemaFonte[]) => ps.some(p => p.nivel === "erro");
