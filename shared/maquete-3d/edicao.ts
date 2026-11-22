// Maquete 3D (EPIC-028, Etapa 3) — modo edição dos ITENS do JSON-fonte (móveis, bancadas, balcão), puro e testável:
// catálogo procedural com medidas padrão, formato aceito pelo servidor (zod, lista fechada de materiais), encaixe de
// 5 cm e na face da parede, giro, troca de tipo dentro do grupo, novo item, desfazer/refazer e as regras (as MESMAS
// de `validarFonte`, da Etapa 1). A estrutura (paredes, aberturas, ambientes, cobertura) nunca é editada aqui.
import { z } from "zod";
import { TIPOS_MOVEL, type TipoMovel } from "./mobilia.js";
import { EPS_AREA, areaComum, contornoDoItem, eixoDaParede, ehOrtogonal, poligonoDoAmbiente, type AmbienteFonte, type FontePlanta, type ItemFonte } from "./fonte.js";
import { ehAuxiliar, type VistaCena } from "./fonte-cena.js";
import { pontoInterno } from "./geometria3d.js";
import { ROTULOS_MOVEL_FONTE } from "./rotulos-itens.js";
import { temErro, validarFonte, zonasDaPorta, type ProblemaFonte } from "./validacao-fonte.js";

// ── Limites e formato aceito pelo servidor ──

export const LIMITES_EDICAO = {
  /** Quantidade máxima de itens numa versão. */
  itens: 150,
  /** Coordenada em planta (m), larguras/profundidades e alturas (m). */
  coordenada: 60,
  medida: 6,
  altura: 3.5,
  /** Encaixe do arraste (m). */
  grade: 0.05,
  /** Distância até a face da parede em que o fundo do móvel encosta sozinho (m). */
  imaParede: 0.15,
  /** Passos de desfazer guardados. */
  historico: 100,
} as const;

/** Lista fechada de materiais (nada de texto livre vindo da tela). Os do JSON do Lote 4 estão todos aqui. */
export const MATERIAIS_ITEM = ["madeira", "laminado", "tecido", "granito", "pedra", "aço inox", "metal", "louça", "vidro", "pintura", "plástico"] as const;
export type MaterialItem = (typeof MATERIAIS_ITEM)[number];
export const ROTULOS_MATERIAL: Record<MaterialItem, string> = {
  madeira: "Madeira", laminado: "Laminado", tecido: "Tecido", granito: "Granito", pedra: "Pedra", "aço inox": "Aço inox",
  metal: "Metal", "louça": "Louça", vidro: "Vidro", pintura: "Pintura", "plástico": "Plástico",
};

export const COR_HEX = /^#[0-9a-fA-F]{6}$/;
/** Sem `<` nem `>`: nenhum HTML/SVG entra por texto. */
const textoSeguro = (max: number) => z.string().min(1).max(max).regex(/^[^<>]*$/, "Texto com caractere não permitido.");
const num = (min: number, max: number) => z.number().finite().min(min).max(max);

export const itemEditadoSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "Identificador do item inválido."),
  tipo: z.enum(TIPOS_MOVEL),
  ambiente: textoSeguro(80),
  alcanca: z.array(textoSeguro(80)).max(4).optional(),
  x: num(-LIMITES_EDICAO.coordenada, LIMITES_EDICAO.coordenada),
  z: num(-LIMITES_EDICAO.coordenada, LIMITES_EDICAO.coordenada),
  rot: num(-720, 720),
  larg: num(0.02, LIMITES_EDICAO.medida),
  prof: num(0.02, LIMITES_EDICAO.medida),
  alt: num(0.005, LIMITES_EDICAO.altura),
  elev: num(0, LIMITES_EDICAO.altura).optional(),
  material: z.enum(MATERIAIS_ITEM),
  cor: z.string().regex(COR_HEX, "Cor precisa ser #rrggbb."),
  editavel: z.boolean(),
  opcoes: z.record(z.string().regex(/^[a-z_]{1,24}$/), z.union([z.number().finite(), z.boolean(), z.string().max(40).regex(/^[^<>]*$/)]))
    .refine(o => Object.keys(o).length <= 8, "Opções demais.").optional(),
  fonte: textoSeguro(80),
  estimado: z.boolean().optional(),
  nota: z.string().max(300).regex(/^[^<>]*$/).optional(),
}).strict();
export const itensEdicaoSchema = z.array(itemEditadoSchema).max(LIMITES_EDICAO.itens);
export type ItemEditado = z.infer<typeof itemEditadoSchema>;

// ── Catálogo procedural (medidas padrão) ──

export type GrupoItem = "bancadas" | "eletro" | "assentos" | "mesas" | "dormir" | "guardar" | "banho" | "decoracao" | "externo" | "garagem";
export const ROTULOS_GRUPO: Record<GrupoItem, string> = {
  bancadas: "Bancadas e armários", eletro: "Eletrodomésticos", assentos: "Assentos", mesas: "Mesas", dormir: "Camas e criados",
  guardar: "Estantes e guarda-roupas", banho: "Banheiro e serviço", decoracao: "Decoração", externo: "Área externa", garagem: "Garagem",
};

export type PadraoItem = {
  grupo: GrupoItem; larg: number; prof: number; alt: number; elev?: number;
  material: MaterialItem; cor: string; opcoes?: Record<string, number | boolean | string>;
  /** Aparece na lista "Adicionar" (luminária de teto e cortina ficam só para troca de tipo). */
  noCatalogo: boolean;
};

const P = (grupo: GrupoItem, larg: number, prof: number, alt: number, material: MaterialItem, cor: string, extra: Partial<PadraoItem> = {}): PadraoItem =>
  ({ grupo, larg, prof, alt, material, cor, noCatalogo: true, ...extra });

/** Medidas padrão (largura × profundidade × altura, em metros) de cada tipo do catálogo. */
export const CATALOGO_ITENS: Record<TipoMovel, PadraoItem> = {
  bancada_cozinha: P("bancadas", 1.2, 0.6, 0.9, "granito", "#fafafa", { opcoes: { pia: true } }),
  balcao: P("bancadas", 1.2, 0.4, 1.1, "granito", "#e9e4da", { opcoes: { base_prof: 0.15, tampo_prof: 0.4 } }),
  armario_servico: P("bancadas", 0.8, 0.45, 1.8, "laminado", "#f2f1ee"),
  buffet: P("bancadas", 1.4, 0.45, 0.8, "madeira", "#9c6c48"),
  aparador: P("bancadas", 1.2, 0.35, 0.8, "madeira", "#9c6c48"),
  geladeira: P("eletro", 0.7, 0.7, 1.8, "aço inox", "#9aa0a4"),
  fogao: P("eletro", 0.55, 0.6, 0.85, "aço inox", "#c9ccce"),
  maquina_lavar: P("eletro", 0.6, 0.6, 0.9, "metal", "#fafafa"),
  sofa: P("assentos", 1.8, 0.85, 0.85, "tecido", "#5d6872"),
  poltrona: P("assentos", 0.75, 0.8, 0.85, "tecido", "#5d6872"),
  cadeira: P("assentos", 0.45, 0.5, 0.9, "tecido", "#5d6872"),
  cadeira_escritorio: P("assentos", 0.6, 0.6, 1.0, "tecido", "#3b3d40"),
  mesa_jantar: P("mesas", 1.2, 0.8, 0.76, "madeira", "#9c6c48", { opcoes: { lugares: 4 } }),
  mesa_centro: P("mesas", 0.9, 0.5, 0.4, "madeira", "#9c6c48"),
  mesa_externa: P("mesas", 1.2, 0.8, 0.75, "madeira", "#9c6c48"),
  escrivaninha: P("mesas", 1.0, 0.55, 0.75, "madeira", "#9c6c48"),
  cama: P("dormir", 1.38, 1.88, 1.0, "tecido", "#ece8df", { opcoes: { casal: true } }),
  criado_mudo: P("dormir", 0.45, 0.4, 0.5, "madeira", "#9c6c48"),
  guarda_roupa: P("guardar", 1.6, 0.6, 2.2, "laminado", "#f2f1ee"),
  estante: P("guardar", 0.8, 0.35, 1.8, "madeira", "#9c6c48"),
  rack_tv: P("guardar", 1.6, 0.4, 0.5, "madeira", "#9c6c48", { opcoes: { tv: true } }),
  prateleira: P("guardar", 0.8, 0.25, 0.3, "madeira", "#9c6c48", { elev: 1.4 }),
  armario_aereo: P("guardar", 1.2, 0.35, 0.7, "laminado", "#f2f1ee", { elev: 1.5 }),
  vaso_sanitario: P("banho", 0.4, 0.65, 0.75, "louça", "#fafafa"),
  lavatorio: P("banho", 0.45, 0.45, 0.85, "louça", "#fafafa"),
  box_chuveiro: P("banho", 0.8, 0.8, 2.0, "vidro", "#9fc3d6"),
  tanque: P("banho", 0.55, 0.6, 0.85, "louça", "#fafafa"),
  espelho: P("banho", 0.6, 0.03, 0.8, "vidro", "#e9eef0", { elev: 1.1 }),
  planta: P("decoracao", 0.4, 0.4, 1.0, "plástico", "#3a3c40"),
  luminaria_piso: P("decoracao", 0.35, 0.35, 1.6, "metal", "#2a2c2f"),
  tapete: P("decoracao", 2.0, 1.4, 0.01, "tecido", "#b9b6b0"),
  quadro: P("decoracao", 0.6, 0.04, 0.45, "madeira", "#1d1e20", { elev: 1.4 }),
  cortina: P("decoracao", 1.6, 0.1, 2.4, "tecido", "#e6e4df", { noCatalogo: false }),
  pendente: P("decoracao", 0.3, 0.3, 0.4, "metal", "#2a2c2f", { elev: 2.0, noCatalogo: false }),
  plafon: P("decoracao", 0.4, 0.4, 0.08, "plástico", "#f1f1ef", { elev: 2.7, noCatalogo: false }),
  churrasqueira: P("externo", 0.8, 0.5, 1.0, "pedra", "#8c8273"),
  carro: P("garagem", 1.8, 4.2, 1.45, "pintura", "#3f6f8f"),
};

/** Nome completo no editor (a planta 2D usa o curto de `ROTULOS_MOVEL_FONTE`). */
const NOME_COMPLETO: Partial<Record<TipoMovel, string>> = {
  bancada_cozinha: "Bancada da cozinha", balcao: "Balcão americano", armario_servico: "Armário de piso", maquina_lavar: "Máquina de lavar",
  mesa_jantar: "Mesa de jantar", criado_mudo: "Criado-mudo", cadeira_escritorio: "Cadeira de escritório", vaso_sanitario: "Vaso sanitário",
  box_chuveiro: "Box do chuveiro", luminaria_piso: "Luminária de piso", pendente: "Luminária pendente", plafon: "Luminária de teto",
};
export const rotuloDoTipo = (t: TipoMovel) => NOME_COMPLETO[t] ?? ROTULOS_MOVEL_FONTE[t] ?? t;
export const grupoDoTipo = (t: TipoMovel): GrupoItem => CATALOGO_ITENS[t].grupo;
/** Tipos do mesmo grupo (para "converter tipo"). */
export const tiposDoGrupo = (g: GrupoItem): TipoMovel[] => TIPOS_MOVEL.filter(t => CATALOGO_ITENS[t].grupo === g);

// ── Operações puras ──

const r4 = (n: number) => Math.round(n * 10000) / 10000;
/** Encaixe de 5 cm (ou o passo pedido). */
export const encaixar = (v: number, passo: number = LIMITES_EDICAO.grade) => r4(Math.round(v / passo) * passo);
/** Giro em [0, 360). */
export const normalizarGiro = (g: number) => r4(((g % 360) + 360) % 360) % 360;

/** Gira o item `delta` graus (botões de 90° e o ajuste fino de 15°). */
export const girar = <T extends Pick<ItemFonte, "rot">>(i: T, delta: number): T => ({ ...i, rot: normalizarGiro(i.rot + delta) });

/** Direção das costas do item em planta (costas em −z local; mesma fórmula de `contornoDoItem`). */
export function costasDoItem(rot: number) {
  const r = (rot * Math.PI) / 180;
  return { x: -Math.sin(r), z: -Math.cos(r) };
}

export type EncaixeParede = { paredeId: string; x: number; z: number; distancia: number };

/**
 * Encaixe na parede mais próxima: se as costas do item estão viradas para a face de uma parede (ou muro), a até
 * `alcance` dela (para fora ou um pouco para dentro), o item é empurrado até o fundo encostar na face. Só vale com o
 * item alinhado à parede (giro múltiplo de 90°, com 1° de folga) e quando ele fica de frente para o trecho da parede.
 */
export function encaixeNaParede(f: FontePlanta, i: Pick<ItemFonte, "x" | "z" | "rot" | "larg" | "prof">, alcance: number = LIMITES_EDICAO.imaParede): EncaixeParede | null {
  const b = costasDoItem(i.rot);
  let melhor: EncaixeParede | null = null;
  for (const w of f.estrutura.paredes) {
    if (!ehOrtogonal(w)) continue;
    const { comp, ux, uz, nx, nz } = eixoDaParede(w);
    for (const lado of [1, -1] as const) {
      const n = { x: nx * lado, z: nz * lado };
      if (b.x * n.x + b.z * n.z > -Math.cos(Math.PI / 180)) continue; // costas precisam apontar para a face
      const fx = w.x1 + n.x * (w.esp / 2), fz = w.z1 + n.z * (w.esp / 2);
      const centro = (i.x - fx) * n.x + (i.z - fz) * n.z;
      if (centro <= 0) continue; // o item tem de estar do lado de fora da face
      const fundo = centro - i.prof / 2; // > 0: folga; < 0: invadindo a parede
      if (Math.abs(fundo) > alcance + 1e-9) continue;
      const s = (i.x - w.x1) * ux + (i.z - w.z1) * uz;
      if (s + i.larg / 2 <= 0.02 || s - i.larg / 2 >= comp - 0.02) continue; // não está de frente para esta parede
      if (!melhor || Math.abs(fundo) < Math.abs(melhor.distancia))
        melhor = { paredeId: w.id, x: r4(i.x - fundo * n.x), z: r4(i.z - fundo * n.z), distancia: fundo };
    }
  }
  return melhor;
}

/** Posição do arraste: encaixe de 5 cm e, perto de uma parede, o fundo encostado na face. */
export function posicaoArrastada(f: FontePlanta, i: Pick<ItemFonte, "rot" | "larg" | "prof">, x: number, z: number) {
  const px = encaixar(x), pz = encaixar(z);
  const ima = encaixeNaParede(f, { ...i, x: px, z: pz });
  return ima ? { x: ima.x, z: ima.z, paredeId: ima.paredeId } : { x: px, z: pz, paredeId: null as string | null };
}

/**
 * Tipos suspensos por natureza (presos na parede ou no teto): os ÚNICOS que podem ter elevação (`elev` > 0). Lista
 * fechada: item de piso "flutuando" não escapa das regras da porta. Mesmo os suspensos respeitam o vão e o giro da porta
 * quando a base fica abaixo da altura dela (`validarFonte`).
 */
export const TIPOS_SUSPENSOS: readonly TipoMovel[] = ["armario_aereo", "prateleira", "espelho", "quadro", "pendente", "plafon"];
export const podeTerElevacao = (t: TipoMovel) => TIPOS_SUSPENSOS.includes(t);

/**
 * Tipos que podem passar para ambientes vizinhos (`alcanca`): só o balcão (cozinha → sala). O servidor nunca aceita a
 * lista da tela: ela é derivada da geometria (os ambientes que o item realmente ocupa) em `comAlcanceDerivado`.
 */
export const TIPOS_QUE_ALCANCAM: readonly TipoMovel[] = ["balcao"];

/**
 * Itens com `alcanca` derivado (nunca o valor vindo da tela): tipo que alcança → os outros ambientes sobre os quais o
 * contorno dele fica de fato (no máximo 4, na ordem da planta); outro tipo → sem `alcanca`. Itens travados NA FONTE
 * (`padrao`, nunca o `editavel` da tela: `comTravaDaFonte`) ficam como estão (o servidor exige que sejam iguais aos da planta).
 */
export function comAlcanceDerivado(f: FontePlanta, itens: ItemFonte[], padrao: ItemFonte[] = f.itens): ItemFonte[] {
  return comTravaDaFonte(padrao, itens).map(i => {
    if (!i.editavel) return i;
    const { alcanca: _a, ...sem } = i;
    if (!TIPOS_QUE_ALCANCAM.includes(i.tipo)) return sem;
    const c = contornoDoItem(i);
    const outros = f.estrutura.ambientes.filter(a => a.nome !== i.ambiente && areaComum(poligonoDoAmbiente(a), c) > EPS_AREA).map(a => a.nome).slice(0, 4);
    return outros.length ? { ...sem, alcanca: outros } : sem;
  });
}

/** Converte o item em outro tipo do MESMO grupo, mantendo posição, giro, medidas, material e cor. */
export function converterTipo(i: ItemFonte, novo: TipoMovel): ItemFonte {
  if (novo === i.tipo) return i;
  if (grupoDoTipo(novo) !== grupoDoTipo(i.tipo))
    throw new Error(`${rotuloDoTipo(i.tipo)} só pode virar outro item de "${ROTULOS_GRUPO[grupoDoTipo(i.tipo)]}".`);
  const pad = CATALOGO_ITENS[novo];
  const { opcoes: _o, elev: _e, ...resto } = i;
  // Elevação só para tipo suspenso: o de piso volta ao chão; o suspenso mantém a altura que tinha (ou a padrão).
  const elev = podeTerElevacao(novo) ? (i.elev || pad.elev) : undefined;
  return { ...resto, tipo: novo, ...(elev ? { elev } : {}), ...(pad.opcoes ? { opcoes: { ...pad.opcoes } } : {}) };
}

/** Ambientes onde se pode pôr item (sem as faixas auxiliares, como a divisa cozinha/sala). */
export const ambientesEditaveis = (f: FontePlanta): AmbienteFonte[] => f.estrutura.ambientes.filter(a => !ehAuxiliar(a));

/**
 * Vista do editor (computador) enquadrada num ambiente: a mesma direção da visão geral, mais de cima e mais perto, para
 * o contorno do item selecionado ficar bem visível. `null` se o ambiente não existe.
 */
export function vistaDoAmbiente(f: FontePlanta, geral: VistaCena, nome: string): VistaCena | null {
  const a = f.estrutura.ambientes.find(x => x.nome === nome);
  if (!a) return null;
  const pts = poligonoDoAmbiente(a);
  const xs = pts.map(q => q.x), zs = pts.map(q => q.y);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const alvo: [number, number, number] = [r4((x0 + x1) / 2), a.piso, r4((z0 + z1) / 2)];
  const d = [(geral.pos[0] - geral.alvo[0]) * 0.6, geral.pos[1] - geral.alvo[1], (geral.pos[2] - geral.alvo[2]) * 0.6];
  const n = Math.hypot(d[0], d[1], d[2]) || 1, dist = Math.max(7.5, Math.hypot(x1 - x0, z1 - z0) * 2.4);
  return {
    ...geral, id: `foco-${a.nome}`, nome: a.nome, ambiente: a.nome,
    pos: [r4(alvo[0] + (d[0] / n) * dist), r4(alvo[1] + (d[1] / n) * dist), r4(alvo[2] + (d[2] / n) * dist)], alvo,
  };
}

/** Ponto de partida de um item novo num ambiente (ponto interno, no encaixe de 5 cm). */
export function centroDoAmbiente(f: FontePlanta, nome: string) {
  const a = f.estrutura.ambientes.find(x => x.nome === nome);
  if (!a) throw new Error(`Ambiente "${nome}" não existe.`);
  const p = pontoInterno(poligonoDoAmbiente(a));
  return { x: encaixar(p.x), z: encaixar(p.y) };
}

/** Novo id único a partir do tipo (`geladeira-2`). */
export function novoId(tipo: TipoMovel, existentes: { id: string }[]): string {
  const base = tipo.replace(/_/g, "-"), usados = new Set(existentes.map(i => i.id));
  if (!usados.has(base)) return base;
  for (let n = 2; ; n++) if (!usados.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Item novo do catálogo no centro do ambiente, com as medidas padrão. */
export function novoItem(f: FontePlanta, tipo: TipoMovel, ambiente: string, existentes: ItemFonte[]): ItemFonte {
  const pad = CATALOGO_ITENS[tipo], { x, z } = centroDoAmbiente(f, ambiente);
  return {
    id: novoId(tipo, existentes), tipo, ambiente, x, z, rot: 0, larg: pad.larg, prof: pad.prof, alt: pad.alt,
    ...(pad.elev ? { elev: pad.elev } : {}), material: pad.material, cor: pad.cor, editavel: true,
    ...(pad.opcoes ? { opcoes: { ...pad.opcoes } } : {}), fonte: "editor",
  };
}

/** Troca um campo do item (o painel e o arraste passam por aqui). Mudar de ambiente leva o item para o centro dele. */
export function alterarItem(f: FontePlanta, itens: ItemFonte[], id: string, mudanca: Partial<ItemFonte>): ItemFonte[] {
  return itens.map(i => {
    if (i.id !== id) return i;
    let novo: ItemFonte = { ...i, ...mudanca };
    if (mudanca.ambiente && mudanca.ambiente !== i.ambiente) {
      const { alcanca: _a, ...sem } = novo;
      novo = { ...sem, ...centroDoAmbiente(f, mudanca.ambiente) };
    }
    if (mudanca.rot !== undefined) novo.rot = normalizarGiro(novo.rot);
    return novo;
  });
}

// ── Regras: as mesmas da Etapa 1 ──

export const fonteComItens = (f: FontePlanta, itens: ItemFonte[]): FontePlanta => ({ ...f, itens });

/** Problemas da planta com estes itens (`validarFonte`). Qualquer erro bloqueia salvar e publicar. */
export function problemasDaEdicao(f: FontePlanta, itens: ItemFonte[], padrao: ItemFonte[] = f.itens): ProblemaFonte[] {
  const derivados = comAlcanceDerivado(f, itens, padrao);
  const elevados: ProblemaFonte[] = derivados.filter(i => i.editavel && (i.elev ?? 0) > 0 && !podeTerElevacao(i.tipo)).map(i => ({
    nivel: "erro", codigo: "item_elevado", onde: i.id,
    mensagem: `O item "${i.id}" (${i.tipo}) é de piso e não pode ficar elevado do chão (${String(i.elev).replace(".", ",")} m). Só itens de parede ou teto têm elevação.`,
  }));
  return [...elevados, ...validarFonte(fonteComItens(f, derivados))];
}
export const bloqueiaSalvar = (ps: ProblemaFonte[]) => temErro(ps);

/** Itens citados num problema (`onde` é o id do item ou "a × b"). */
export function itensDoProblema(p: ProblemaFonte, itens: { id: string }[]): string[] {
  const ids = new Set(itens.map(i => i.id));
  return p.onde.split(" × ").filter(x => ids.has(x));
}

export type PortaBloqueada = { abertura: string; codigo: string; itens: string[]; zonas: [number, number][][] };

/**
 * Portas e portões bloqueados por algum item (vão, giro da folha ou faixa livre de 0,80 m), com as zonas proibidas
 * em planta, para a tela pintar de vermelho. Mesmas zonas de `validarFonte` (`zonasDaPorta`).
 */
export function portasBloqueadas(f: FontePlanta, itens: ItemFonte[]): PortaBloqueada[] {
  const { paredes, aberturas, ambientes } = f.estrutura;
  const out: PortaBloqueada[] = [];
  for (const ab of aberturas) {
    if (ab.tipo !== "porta" && ab.tipo !== "portao") continue;
    const w = paredes.find(p => p.id === ab.parede);
    if (!w) continue;
    const z = zonasDaPorta(w, ab, ambientes);
    const zonas = [z.vao, ...z.faixas, ...(z.giro ? [z.giro] : [])];
    const ids = itens.filter(i => (i.elev ?? 0) < ab.peitoril + ab.alt)
      .filter(i => { const c = contornoDoItem(i); return zonas.some(zn => areaComum(zn, c) > EPS_AREA); }).map(i => i.id);
    if (ids.length) out.push({ abertura: ab.id, codigo: ab.codigo, itens: ids, zonas: zonas.map(zn => zn.map(q => [q.x, q.y] as [number, number])) });
  }
  return out;
}

// ── Desfazer / refazer ──

export type Historico<T> = { passado: T[]; presente: T; futuro: T[]; chave: string | null };
export const criarHistorico = <T>(inicial: T): Historico<T> => ({ passado: [], presente: inicial, futuro: [], chave: null });

/**
 * Registra um estado novo. `chave` junta passos seguidos do mesmo gesto (um arraste inteiro, a digitação num campo)
 * num só "desfazer".
 */
export function registrar<T>(h: Historico<T>, novo: T, chave: string | null = null): Historico<T> {
  if (novo === h.presente) return h;
  if (chave && chave === h.chave) return { ...h, presente: novo, futuro: [] };
  const passado = [...h.passado, h.presente].slice(-LIMITES_EDICAO.historico);
  return { passado, presente: novo, futuro: [], chave };
}
export function desfazer<T>(h: Historico<T>): Historico<T> {
  if (!h.passado.length) return h;
  return { passado: h.passado.slice(0, -1), presente: h.passado[h.passado.length - 1], futuro: [h.presente, ...h.futuro], chave: null };
}
export function refazer<T>(h: Historico<T>): Historico<T> {
  if (!h.futuro.length) return h;
  return { passado: [...h.passado, h.presente], presente: h.futuro[0], futuro: h.futuro.slice(1), chave: null };
}
/** Encerra o gesto em curso: o próximo passo vira um "desfazer" separado. */
export const fecharGesto = <T>(h: Historico<T>): Historico<T> => (h.chave ? { ...h, chave: null } : h);

// ── Itens vindos do servidor × padrão ──

/**
 * `editavel` NUNCA vem da tela: quem decide se um item é travado (e por isso fica fora da regra de elevação e da
 * derivação de `alcanca`) é a FONTE do servidor — o item de mesmo `id` com `editavel: false` no JSON do repositório.
 * Qualquer outro item (inclusive o novo, que não existe na fonte) é editável e passa por todas as regras. Devolve o
 * mesmo objeto quando o valor já está certo (a tela reaproveita a peça já montada).
 */
export function comTravaDaFonte(padrao: ItemFonte[], itens: ItemFonte[]): ItemFonte[] {
  const travados = new Set(padrao.filter(p => !p.editavel).map(p => p.id));
  return itens.map(i => {
    const editavel = !travados.has(i.id);
    return i.editavel === editavel ? i : { ...i, editavel };
  });
}

/** Itens não editáveis da planta padrão precisam continuar iguais (o servidor recusa se mudarem ou sumirem). */
export function travadosAlterados(padrao: ItemFonte[], itens: ItemFonte[]): string[] {
  const porId = new Map(itens.map(i => [i.id, i] as const));
  return padrao.filter(p => !p.editavel).filter(p => canonico(porId.get(p.id) ?? null) !== canonico(p)).map(p => p.id);
}

/** JSON com as chaves em ordem (comparação e hash independem da ordem dos campos). */
export function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonico(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}
