// Maquete 3D (EPIC-028, Etapa 1) — JSON-fonte de uma planta escrita à mão a partir da prancha (ex.:
// `data/plantas/lote4-qd18.json`). Duas partes: `estrutura` (paredes, aberturas, ambientes, cobertura), travada, e
// `itens` (móveis, bancadas, balcão), editáveis. Aqui ficam só o formato (zod) e a geometria pura usada pelas
// validações; nada de three.js nem de banco.
//
// Convenção de eixos (a mesma do protótipo validado pelo dono): metros; x = largura do lote, de 0 (lado da cozinha
// e da sala, à esquerda na prancha) a 5,00 (lado dos quartos); z = profundidade, com z = 0 na face de fundo da casa
// (quarto 1 / cozinha) e z crescendo para a frente (rua). Níveis e `base` em metros acima da rua (0,00); peitoril e
// altura das aberturas medidos a partir da `base` da parede.
import { z } from "zod";
import { TIPOS_MOVEL } from "./mobilia.js";
import { FUNCOES_COMODO, areaPoligono, type Ponto } from "./modelo.js";

// ── Formato ──

const m = z.number().finite();
const texto = (max: number) => z.string().min(1).max(max);
/** De onde veio a medida: "planta", "corte A", "corte B", "quadro de esquadrias", "quadro de ambientes",
 *  "cobertura", "fachada norte", "protótipo", "dono" ou "estimado". Curto; o detalhe vai em `nota`. */
const marcas = {
  fonte: texto(80),
  estimado: z.boolean().optional(),
  nota: z.string().max(600).optional(),
};

export const cotaSchema = z.object({ valor: m, ...marcas });
export type Cota = z.infer<typeof cotaSchema>;

export const faixaSchema = z.object({
  medida: m.positive(),
  tipo: z.enum(["parede", "ambiente"]),
  nome: z.string().max(80).optional(),
});
export type Faixa = z.infer<typeof faixaSchema>;

export const paredeFonteSchema = z.object({
  id: texto(40),
  /** Eixo da parede: o retângulo da parede é este segmento alargado `esp/2` para cada lado (sem prolongar as pontas). */
  x1: m, z1: m, x2: m, z2: m,
  esp: m.min(0.03).max(1.5),
  /** Altura da parede acima de `base`. */
  h: m.positive().max(15),
  /** Nível do piso de referência da parede (de onde se medem altura e peitoril das aberturas). */
  base: m,
  /** Muro do lote (fica fora do contorno da casa e das faixas). */
  muro: z.boolean().optional(),
  ...marcas,
});
export type ParedeFonte = z.infer<typeof paredeFonteSchema>;

export const TIPOS_ABERTURA_FONTE = ["porta", "janela", "portao"] as const;
export const aberturaFonteSchema = z.object({
  id: texto(40),
  /** Código da prancha (P1, P2, J1, PT1…). */
  codigo: texto(10),
  tipo: z.enum(TIPOS_ABERTURA_FONTE),
  parede: texto(40),
  /** Distância do início da parede (x1, z1) até o começo do vão, ao longo do eixo. */
  offset: m.min(0),
  larg: m.positive().max(20),
  alt: m.positive().max(10),
  peitoril: m.min(0).max(5),
  /** `esq`: dobradiça no começo do vão (lado do `offset`); `dir`: dobradiça no fim do vão; `correr`: folhas de
   *  correr ou de enrolar, sem giro. */
  abertura: z.enum(["esq", "dir", "correr"]),
  /** Só em `correr`: qual metade do vão é a folha FIXA (`inicio` = lado do `offset`, `fim` = o outro). Declarada, o vão
   *  útil e a faixa livre valem só na metade que corre; sem ela, no vão inteiro. Regra das plantas da Prospecta: a
   *  folha que abre fica do lado OPOSTO ao sofá (decisão do dono em 21/11/2026). */
  folha_fixa: z.enum(["inicio", "fim"]).optional(),
  /** Ambiente para onde a folha gira (obrigatório em `esq`/`dir`). */
  abre_para: z.string().max(80).optional(),
  descricao: z.string().max(200).optional(),
  ...marcas,
});
export type AberturaFonte = z.infer<typeof aberturaFonteSchema>;

/** Acabamento do piso desenhado pelo gerador (Etapa 2). Ausente = deduzido do nome e de `interno` (`acabamentoDoAmbiente`). */
export const ACABAMENTOS_PISO = ["porcelanato", "ceramica", "cimentado", "concreto", "grama"] as const;
export type AcabamentoPiso = (typeof ACABAMENTOS_PISO)[number];

/** Ponto de vista do tour (Etapa 2): onde a pessoa fica em planta e para onde olha. A altura dos olhos não vem
 *  daqui: é sempre o piso do ambiente + 1,60 m (`ALTURA_OLHOS_TOUR`). */
export const cameraFonteSchema = z.object({
  x: m, z: m,
  /** Ponto olhado [x, y, z]; y em metros acima da rua. */
  alvo: z.tuple([m, m, m]),
  ...marcas,
});
export type CameraFonte = z.infer<typeof cameraFonteSchema>;

export const ambienteFonteSchema = z.object({
  nome: texto(80),
  /** Vértices [x, z] em ordem, sem repetir o primeiro. */
  poligono: z.array(z.tuple([m, m])).min(3).max(100),
  /** Área do quadro de ambientes da prancha (m²); `null` quando o ambiente não está no quadro. */
  area_planta: m.positive().nullable(),
  perimetro_planta: m.positive().nullable().optional(),
  /** Nível do piso (m acima da rua). */
  piso: m,
  /** Fica dentro da casa (coberto). */
  interno: z.boolean(),
  /** Opcionais (Etapa 2): acabamento do piso, função do cômodo no modelo 3D e ponto de vista do tour. */
  acabamento: z.enum(ACABAMENTOS_PISO).optional(),
  funcao: z.enum(FUNCOES_COMODO).optional(),
  camera: cameraFonteSchema.optional(),
  ...marcas,
});
export type AmbienteFonte = z.infer<typeof ambienteFonteSchema>;

export const coberturaFonteSchema = z.object({
  tipo: z.enum(["duas_aguas"]),
  material: texto(60),
  /** Inclinação das águas (0,20 = 20%). */
  inclinacao: m.positive().max(2),
  /** Cumeeira: linha paralela ao eixo `eixo`, na coordenada `em` do outro eixo. */
  cumeeira: z.object({ eixo: z.enum(["x", "z"]), em: m }),
  /** Topo das paredes / nível do forro (m acima da rua). */
  topo_paredes: m,
  forro: z.string().max(60),
  platibanda: z.object({ altura: m.positive(), esp: m.positive() }),
  calhas: z.boolean(),
  ...marcas,
});
export type CoberturaFonte = z.infer<typeof coberturaFonteSchema>;

/** Tipos de item: os do catálogo de móveis (`TIPOS_MOVEL`, que já inclui o balcão). */
export const itemFonteSchema = z.object({
  id: texto(40),
  tipo: z.enum(TIPOS_MOVEL),
  ambiente: texto(80),
  /** Outros ambientes que o item pode ocupar (ex.: o balcão fica na divisa da cozinha com a sala). */
  alcanca: z.array(texto(80)).max(4).optional(),
  /** Centro em planta. */
  x: m, z: m,
  /** Giro em graus em torno do eixo vertical: 0 = frente para +z, 90 = frente para +x, 180 = −z, 270 = −x. */
  rot: m,
  /** Largura (eixo local x), profundidade (eixo local z, costas em −z) e altura, em metros. */
  larg: m.positive().max(20),
  prof: m.positive().max(20),
  alt: m.positive().max(10),
  /** Altura da base acima do piso do ambiente (0 = no chão). */
  elev: m.min(0).max(10).optional(),
  material: z.string().max(60),
  cor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  editavel: z.boolean(),
  opcoes: z.record(z.string().max(40), z.union([z.number(), z.boolean(), z.string().max(80)])).optional(),
  ...marcas,
});
export type ItemFonte = z.infer<typeof itemFonteSchema>;

export const fonteSchema = z.object({
  versao: z.literal(1),
  nome: texto(120),
  lote: z.object({ w: m.positive(), d: m.positive(), ...marcas }),
  niveis: z.record(z.string().max(40), cotaSchema),
  /** Opcional (Etapa 2): direção do norte para a planta 2D, em graus a partir de +z (frente), girando para +x. */
  norte: z.object({ angulo: m, ...marcas }).optional(),
  estrutura: z.object({
    casa: z.object({
      w: m.positive(), d: m.positive(),
      /** Cadeias de cotas da prancha, de x = 0 para x = w e de z = 0 para z = d. */
      faixas_largura: z.array(faixaSchema).min(1).max(40),
      faixas_profundidade: z.array(faixaSchema).min(1).max(40),
      ...marcas,
    }),
    paredes: z.array(paredeFonteSchema).min(1).max(200),
    aberturas: z.array(aberturaFonteSchema).max(200),
    ambientes: z.array(ambienteFonteSchema).min(1).max(60),
    cobertura: coberturaFonteSchema,
  }),
  itens: z.array(itemFonteSchema).max(300),
});
export type FontePlanta = z.infer<typeof fonteSchema>;

/** Lê e confere o formato do JSON-fonte. Lança erro do zod se o formato estiver errado. */
export const lerFonte = (dados: unknown): FontePlanta => fonteSchema.parse(dados);

// ── Geometria pura ──
// Os pontos usam `Ponto` de `modelo.ts` com `y` = z da planta, para reaproveitar `areaPoligono`.

export const EPS_AREA = 1e-4; // 1 cm²: abaixo disso, encostar não é invadir.

const p = (x: number, z: number): Ponto => ({ x, y: z });

export const poligonoDoAmbiente = (a: Pick<AmbienteFonte, "poligono">): Ponto[] => a.poligono.map(([x, z]) => p(x, z));

/** Retângulo (4 cantos) de um item, girado — mesma fórmula de `mobilia.ts` (frente em +z local). */
export function contornoDoItem(i: Pick<ItemFonte, "x" | "z" | "rot" | "larg" | "prof">): Ponto[] {
  const r = (i.rot * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => {
    const lx = (sx * i.larg) / 2, lz = (sz * i.prof) / 2;
    return p(i.x + lx * cs + lz * sn, i.z - lx * sn + lz * cs);
  });
}

/** Direção unitária do eixo da parede, comprimento e normal (à esquerda do sentido x1→x2 no plano x/z). */
export function eixoDaParede(w: Pick<ParedeFonte, "x1" | "z1" | "x2" | "z2">) {
  const dx = w.x2 - w.x1, dz = w.z2 - w.z1, comp = Math.hypot(dx, dz) || 1;
  const ux = dx / comp, uz = dz / comp;
  return { comp, ux, uz, nx: -uz, nz: ux };
}

/** Retângulo de um trecho da parede: de `s0` a `s1` ao longo do eixo, de `t0` a `t1` na normal. */
export function retanguloNaParede(w: ParedeFonte, s0: number, s1: number, t0: number, t1: number): Ponto[] {
  const { ux, uz, nx, nz } = eixoDaParede(w);
  const at = (s: number, t: number) => p(w.x1 + ux * s + nx * t, w.z1 + uz * s + nz * t);
  return [at(s0, t0), at(s1, t0), at(s1, t1), at(s0, t1)];
}

export const contornoDaParede = (w: ParedeFonte): Ponto[] =>
  retanguloNaParede(w, 0, eixoDaParede(w).comp, -w.esp / 2, w.esp / 2);

export const ehOrtogonal = (w: Pick<ParedeFonte, "x1" | "z1" | "x2" | "z2">) =>
  Math.abs(w.x1 - w.x2) < 1e-6 || Math.abs(w.z1 - w.z2) < 1e-6;

function sentidoAntiHorario(pts: Ponto[]): Ponto[] {
  let s = 0;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s < 0 ? [...pts].reverse() : pts;
}

/**
 * Recorte de Sutherland–Hodgman: a parte de `sujeito` (qualquer polígono simples, côncavo ou não) dentro de `janela`
 * (polígono CONVEXO). A área do resultado é exata mesmo quando o sujeito é côncavo.
 */
export function recortar(sujeito: Ponto[], janela: Ponto[]): Ponto[] {
  const jan = sentidoAntiHorario(janela);
  let saida = sujeito;
  for (let k = 0; k < jan.length && saida.length; k++) {
    const a = jan[k], b = jan[(k + 1) % jan.length];
    const lado = (q: Ponto) => (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x);
    const corte = (q: Ponto, r: Ponto): Ponto => {
      const lq = lado(q), lr = lado(r), t = lq / (lq - lr);
      return { x: q.x + (r.x - q.x) * t, y: q.y + (r.y - q.y) * t };
    };
    const entrada = saida;
    saida = [];
    for (let j = 0; j < entrada.length; j++) {
      const atual = entrada[j], anterior = entrada[(j + entrada.length - 1) % entrada.length];
      const dentroA = lado(atual) >= -1e-12, dentroP = lado(anterior) >= -1e-12;
      if (dentroA) {
        if (!dentroP) saida.push(corte(anterior, atual));
        saida.push(atual);
      } else if (dentroP) saida.push(corte(anterior, atual));
    }
  }
  return saida;
}

/** Área comum entre um polígono qualquer e um polígono convexo (m²). */
export const areaComum = (qualquer: Ponto[], convexo: Ponto[]): number => {
  const r = recortar(qualquer, convexo);
  return r.length >= 3 ? areaPoligono(r) : 0;
};

/** Setor de 90° (folha de porta girando), aproximado por `passos` segmentos. É convexo. */
export function setor(centro: Ponto, de: { x: number; y: number }, para: { x: number; y: number }, raio: number, passos = 16): Ponto[] {
  const pts: Ponto[] = [centro];
  for (let k = 0; k <= passos; k++) {
    const t = (k / passos) * (Math.PI / 2), c = Math.cos(t), s = Math.sin(t);
    pts.push({ x: centro.x + (de.x * c + para.x * s) * raio, y: centro.y + (de.y * c + para.y * s) * raio });
  }
  return pts;
}

export { areaPoligono };
