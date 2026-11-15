// Maquete 3D (EPIC-022, 14/11/2026) — modelo único em três camadas, usado pela leitura do PDF, pela tela de
// revisão e (etapa 2) pelo visualizador. Uma casa térrea, um sobrado, um prédio, um condomínio e um loteamento
// são combinações das mesmas peças:
//   1. implantação  — terreno, vias, lotes e a posição de cada construção;
//   2. edificação   — pavimentos empilhados (paredes, aberturas, cômodos, escadas) e cobertura;
//   3. tipologia    — a mesma edificação posicionada várias vezes, ou o mesmo pavimento repetido (pavimento-tipo).
// Unidade: metros. Planta em (x, y), com y crescendo "para baixo" como no desenho. Todos os pavimentos de uma
// edificação usam a mesma origem, para escadas e prumadas coincidirem.
import { z } from "zod";

export const VERSAO_MODELO = 1;

export const TIPOS_MAQUETE = ["casa", "predio", "condominio", "loteamento"] as const;
export type TipoMaquete = (typeof TIPOS_MAQUETE)[number];
export const ROTULOS_TIPO: Record<TipoMaquete, string> = {
  casa: "Casa", predio: "Prédio", condominio: "Condomínio", loteamento: "Loteamento",
};

/** Toda medida lida do projeto diz de onde veio: cota escrita na prancha ou estimativa pela escala/desenho. */
export const ORIGENS_MEDIDA = ["confirmada", "estimada"] as const;
export type OrigemMedida = (typeof ORIGENS_MEDIDA)[number];

export const FUNCOES_COMODO = [
  "sala", "sala_jantar", "cozinha", "quarto", "suite", "banheiro", "lavabo", "area_servico", "garagem", "varanda",
  "circulacao", "escritorio", "closet", "despensa", "area_gourmet", "area_externa", "hall", "deposito",
  "area_comum", "comercial", "outro",
] as const;
export type FuncaoComodo = (typeof FUNCOES_COMODO)[number];
export const ROTULOS_FUNCAO: Record<FuncaoComodo, string> = {
  sala: "Sala", sala_jantar: "Sala de jantar", cozinha: "Cozinha", quarto: "Quarto", suite: "Suíte", banheiro: "Banheiro",
  lavabo: "Lavabo", area_servico: "Área de serviço", garagem: "Garagem", varanda: "Varanda", circulacao: "Circulação",
  escritorio: "Escritório", closet: "Closet", despensa: "Despensa", area_gourmet: "Área gourmet",
  area_externa: "Área externa", hall: "Hall", deposito: "Depósito", area_comum: "Área comum", comercial: "Comercial",
  outro: "Outro",
};

export const TIPOS_ABERTURA = ["porta", "janela", "porta_janela", "vao"] as const;
export const TIPOS_ESCADA = ["reta", "em_l", "em_u", "caracol", "rampa"] as const;
export const TIPOS_COBERTURA = ["laje", "platibanda", "uma_agua", "duas_aguas", "quatro_aguas"] as const;

const id = z.string().min(1).max(40);
const metros = z.number().finite();
const ponto = z.object({ x: metros, y: metros });
export type Ponto = z.infer<typeof ponto>;
const origem = z.enum(ORIGENS_MEDIDA).default("estimada");
const poligono = z.array(ponto).max(200);

export const paredeSchema = z.object({
  id, a: ponto, b: ponto,
  espessura: metros.min(0.03).max(1.5).default(0.15),
  externa: z.boolean().default(false),
  origem,
});
export type Parede = z.infer<typeof paredeSchema>;

export const aberturaSchema = z.object({
  id, paredeId: id,
  tipo: z.enum(TIPOS_ABERTURA),
  /** Distância do ponto `a` da parede até o centro da abertura. */
  posicao: metros.min(0),
  largura: metros.min(0.2).max(20),
  altura: metros.min(0.2).max(10).default(2.1),
  /** Altura do peitoril (0 para portas e vãos). */
  peitoril: metros.min(0).max(5).default(0),
  entradaPrincipal: z.boolean().default(false),
  origem,
});
export type Abertura = z.infer<typeof aberturaSchema>;

export const comodoSchema = z.object({
  id, nome: z.string().min(1).max(80),
  funcao: z.enum(FUNCOES_COMODO).default("outro"),
  poligono,
  /** Área escrita na prancha (m²), quando existe; serve para conferir a geometria lida. */
  areaInformada: metros.min(0).nullable().default(null),
  origem,
});
export type Comodo = z.infer<typeof comodoSchema>;

export const escadaSchema = z.object({
  id, tipo: z.enum(TIPOS_ESCADA).default("reta"),
  /** Contorno ocupado em planta. */
  poligono,
  /** Ponto onde se pisa no pavimento de baixo e ponto de chegada no de cima. */
  inicio: ponto, fim: ponto,
  /**
   * Eixo do caminho, da partida à chegada, passando pelos patamares (escadas em L e em U). Vazio = calculado
   * pelo tipo e pelo contorno (shared/maquete-3d/escadas.ts).
   */
  percurso: z.array(ponto).max(60).default([]),
  largura: metros.min(0.5).max(6).default(0.9),
  degraus: z.number().int().min(0).max(80).nullable().default(null),
  /** Pavimento a que ela leva (id). */
  destinoPavimentoId: id.nullable().default(null),
  origem,
});
export type Escada = z.infer<typeof escadaSchema>;

export const pavimentoSchema = z.object({
  id, nome: z.string().min(1).max(60),
  /** Cota do piso acabado em relação ao térreo (m). */
  nivel: metros.min(-30).max(400).default(0),
  peDireito: metros.min(1.8).max(12).default(2.7),
  origemPeDireito: origem,
  /** Pavimento-tipo: quantas vezes este pavimento se repete, empilhado (prédios). */
  repeticoes: z.number().int().min(1).max(100).default(1),
  paredes: z.array(paredeSchema).max(800).default([]),
  aberturas: z.array(aberturaSchema).max(800).default([]),
  comodos: z.array(comodoSchema).max(300).default([]),
  escadas: z.array(escadaSchema).max(20).default([]),
});
export type Pavimento = z.infer<typeof pavimentoSchema>;

export const edificacaoSchema = z.object({
  id, nome: z.string().min(1).max(80),
  pavimentos: z.array(pavimentoSchema).max(60).default([]),
  cobertura: z.object({
    tipo: z.enum(TIPOS_COBERTURA).default("duas_aguas"),
    /** Inclinação em % (30 = 30 cm de subida por metro). */
    inclinacao: metros.min(0).max(200).default(30),
    beiral: metros.min(0).max(3).default(0.5),
    origem,
  }).default({ tipo: "duas_aguas", inclinacao: 30, beiral: 0.5, origem: "estimada" }),
});
export type Edificacao = z.infer<typeof edificacaoSchema>;

/** Contornos da implantação podem ter muito mais vértices que um cômodo (divisa de terreno vinda de KML). */
const contorno = z.array(ponto).max(4000);
export const TIPOS_LOTE = ["vendavel", "area_publica", "nao_parcelavel"] as const;

/**
 * Relevo do terreno: grade regular de alturas em metros (0 = ponto mais baixo), nas coordenadas da planta.
 * `alturas` vai linha a linha, da linha y0 (norte) para baixo; cada linha da coluna x0 (oeste) para a direita.
 */
export const relevoSchema = z.object({
  x0: metros, y0: metros, dx: metros.positive(), dy: metros.positive(),
  colunas: z.number().int().min(2).max(96), linhas: z.number().int().min(2).max(96),
  alturas: z.array(metros).max(96 * 96),
  /** Altitude real do ponto mais baixo (m acima do nível do mar), só para informação. */
  altitudeBase: metros.default(0),
});
export type Relevo = z.infer<typeof relevoSchema>;

/** Altura do terreno em (x, y), por interpolação bilinear. Fora da grade vale a borda. Sem relevo, zero. */
export function alturaDoRelevo(r: Relevo | null | undefined, x: number, y: number): number {
  if (!r || r.alturas.length < r.colunas * r.linhas) return 0;
  const fc = Math.min(r.colunas - 1, Math.max(0, (x - r.x0) / r.dx)), fl = Math.min(r.linhas - 1, Math.max(0, (y - r.y0) / r.dy));
  const c = Math.min(r.colunas - 2, Math.floor(fc)), l = Math.min(r.linhas - 2, Math.floor(fl)), tc = fc - c, tl = fl - l;
  const h = (ll: number, cc: number) => r.alturas[ll * r.colunas + cc];
  return (h(l, c) * (1 - tc) + h(l, c + 1) * tc) * (1 - tl) + (h(l + 1, c) * (1 - tc) + h(l + 1, c + 1) * tc) * tl;
}

export const implantacaoSchema = z.object({
  terreno: contorno.default([]),
  relevo: relevoSchema.nullable().default(null),
  /** Leito das ruas como polígonos (é como o estudo de massa da Incorporação guarda o sistema viário). */
  ruas: z.array(contorno).max(400).default([]),
  vias: z.array(z.object({ id, nome: z.string().max(80).default(""), eixo: poligono, largura: metros.min(1).max(80).default(7) })).max(200).default([]),
  lotes: z.array(z.object({
    id, nome: z.string().max(40).default(""), quadra: z.string().max(40).default(""), poligono: contorno,
    areaInformada: metros.min(0).nullable().default(null),
    tipo: z.enum(TIPOS_LOTE).default("vendavel"),
    /** Código da unidade no inventário da Incorporação (incorporation_units.code), quando houver. */
    unidade: z.string().max(120).nullable().default(null),
  })).max(3000).default([]),
  /** Cada construção no terreno: qual edificação (tipologia), onde e girada quanto. */
  posicoes: z.array(z.object({
    id, edificacaoId: id, nome: z.string().max(60).default(""),
    x: metros, y: metros, rotacao: metros.min(-360).max(360).default(0),
    unidade: z.string().max(120).nullable().default(null),
  })).max(3000).default([]),
});
export type Implantacao = z.infer<typeof implantacaoSchema>;

/** Dado que o projeto não traz e que precisa de resposta de uma pessoa antes de publicar. */
export const pendenciaSchema = z.object({
  id, descricao: z.string().min(1).max(400),
  resolvida: z.boolean().default(false),
});
export type Pendencia = z.infer<typeof pendenciaSchema>;

export const modeloSchema = z.object({
  versao: z.literal(VERSAO_MODELO).default(VERSAO_MODELO),
  tipo: z.enum(TIPOS_MAQUETE),
  edificacoes: z.array(edificacaoSchema).max(60).default([]),
  implantacao: implantacaoSchema.nullable().default(null),
  pendencias: z.array(pendenciaSchema).max(200).default([]),
});
export type ModeloMaquete = z.infer<typeof modeloSchema>;

export const modeloVazio = (tipo: TipoMaquete): ModeloMaquete => modeloSchema.parse({ tipo });

export function lerModelo(texto: string | null | undefined): ModeloMaquete | null {
  if (!texto) return null;
  try { return modeloSchema.parse(JSON.parse(texto)); } catch { return null; }
}

// ── Geometria ──

const r2 = (n: number) => Math.round(n * 100) / 100;

export const comprimento = (p: { a: Ponto; b: Ponto }) => Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y);

/** Área de um polígono simples (fórmula do laço), em m². */
export function areaPoligono(pts: Ponto[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
}

export function centroide(pts: Ponto[]): Ponto {
  if (!pts.length) return { x: 0, y: 0 };
  return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
}

export function limites(pts: Ponto[]) {
  if (!pts.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, largura: 0, altura: 0 };
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, largura: maxX - minX, altura: maxY - minY };
}

export const pontosDoPavimento = (p: Pavimento): Ponto[] => [
  ...p.paredes.flatMap(w => [w.a, w.b]), ...p.comodos.flatMap(c => c.poligono), ...p.escadas.flatMap(e => e.poligono),
];

const AMBIENTES_FORA_DA_AREA_CONSTRUIDA: FuncaoComodo[] = ["area_externa"];
export const areaDoPavimento = (p: Pavimento) =>
  p.comodos.filter(c => !AMBIENTES_FORA_DA_AREA_CONSTRUIDA.includes(c.funcao)).reduce((s, c) => s + areaPoligono(c.poligono), 0);

// ── Resumo comercial (só o que o modelo comprova) ──

export type ResumoModelo = {
  areaTotal: number; pavimentos: number; quartos: number; suites: number; banheiros: number; vagas: number;
  comodos: number; edificacoes: number; lotes: number; construcoes: number;
};

/** Uma vaga a cada 12,5 m² de garagem (2,5 × 5 m), no mínimo uma quando há garagem. */
// Garagem coletiva (acima de 60 m²) precisa de corredor de manobra: 25 m² por vaga, a mesma conta do estacionamento
// do prédio padrão (shared/maquete-3d/padrao.ts).
const vagasDaGaragem = (area: number) => (area > 60 ? Math.floor(area / 25) : Math.max(1, Math.floor(area / 12.5)));

export function resumoModelo(m: ModeloMaquete): ResumoModelo {
  const r: ResumoModelo = { areaTotal: 0, pavimentos: 0, quartos: 0, suites: 0, banheiros: 0, vagas: 0, comodos: 0, edificacoes: m.edificacoes.length, lotes: m.implantacao?.lotes.length ?? 0, construcoes: m.implantacao?.posicoes.length ?? 0 };
  for (const e of m.edificacoes) for (const p of e.pavimentos) {
    const n = p.repeticoes;
    r.pavimentos += n;
    r.areaTotal += areaDoPavimento(p) * n;
    r.comodos += p.comodos.length * n;
    for (const c of p.comodos) {
      if (c.funcao === "quarto") r.quartos += n;
      if (c.funcao === "suite") { r.quartos += n; r.suites += n; }
      if (c.funcao === "banheiro" || c.funcao === "lavabo") r.banheiros += n;
      if (c.funcao === "garagem") r.vagas += vagasDaGaragem(areaPoligono(c.poligono)) * n;
    }
  }
  r.areaTotal = r2(r.areaTotal);
  return r;
}

// ── Validação (etapa 9 do prompt): o que impede publicar e o que só merece atenção ──

export type Problema = { nivel: "erro" | "aviso"; onde: string; mensagem: string };

/** Diferença tolerada entre a área escrita na prancha e a área da geometria lida. */
export const TOLERANCIA_AREA = 0.05;

export function validarModelo(m: ModeloMaquete): Problema[] {
  const ps: Problema[] = [];
  const erro = (onde: string, mensagem: string) => ps.push({ nivel: "erro", onde, mensagem });
  const aviso = (onde: string, mensagem: string) => ps.push({ nivel: "aviso", onde, mensagem });

  const precisaImplantacao = m.tipo === "condominio" || m.tipo === "loteamento";
  if (precisaImplantacao && !m.implantacao) erro("Implantação", "Falta a implantação (terreno, vias e lotes).");
  if (m.tipo !== "loteamento" && !m.edificacoes.length) erro("Edificações", "Nenhuma edificação foi lida.");
  if (m.tipo === "loteamento" && m.implantacao && !m.implantacao.lotes.length) erro("Implantação", "Nenhum lote foi lido.");

  const edificacoes = new Set(m.edificacoes.map(e => e.id));
  for (const pos of m.implantacao?.posicoes ?? []) {
    if (!edificacoes.has(pos.edificacaoId)) erro(`Implantação › ${pos.nome || pos.id}`, "Aponta para uma edificação que não existe.");
  }
  for (const l of m.implantacao?.lotes ?? []) {
    const onde = `Lote ${[l.quadra, l.nome].filter(Boolean).join("-") || l.id}`;
    if (l.poligono.length < 3) { erro(onde, "Contorno incompleto."); continue; }
    conferirArea(onde, l.poligono, l.areaInformada, aviso);
  }

  for (const e of m.edificacoes) {
    if (!e.pavimentos.length) { erro(e.nome, "Sem pavimentos."); continue; }
    const pavs = new Set(e.pavimentos.map(p => p.id));
    if (e.cobertura.origem === "estimada") aviso(e.nome, "Cobertura estimada: confira o tipo e a inclinação.");
    const ordenados = [...e.pavimentos].sort((a, b) => a.nivel - b.nivel);
    ordenados.forEach((p, i) => {
      const onde = `${e.nome} › ${p.nome}`;
      const proximo = ordenados[i + 1];
      if (proximo && proximo.nivel < p.nivel + p.peDireito * p.repeticoes - 0.01) {
        erro(onde, `O pavimento "${proximo.nome}" começa (${r2(proximo.nivel)} m) antes de este terminar.`);
      }
      if (proximo && !p.escadas.length && e.pavimentos.length > 1 && p.repeticoes === 1 && m.tipo !== "predio") {
        aviso(onde, `Não há escada ligando ao pavimento "${proximo.nome}".`);
      }
      if (!p.paredes.length) erro(onde, "Sem paredes.");
      if (!p.comodos.length) erro(onde, "Sem cômodos.");
      if (p.origemPeDireito === "estimada") aviso(onde, `Pé-direito estimado (${r2(p.peDireito)} m): confirme.`);

      const paredes = new Map(p.paredes.map(w => [w.id, w]));
      for (const w of p.paredes) {
        if (comprimento(w) < 0.05) erro(`${onde} › parede ${w.id}`, "Parede sem comprimento.");
      }
      for (const a of p.aberturas) {
        const rotulo = `${onde} › ${a.tipo} ${a.id}`;
        const w = paredes.get(a.paredeId);
        if (!w) { erro(rotulo, "Está em uma parede que não existe."); continue; }
        const c = comprimento(w);
        if (a.posicao - a.largura / 2 < -0.01 || a.posicao + a.largura / 2 > c + 0.01) erro(rotulo, `Não cabe na parede (parede com ${r2(c)} m).`);
        if (a.peitoril + a.altura > p.peDireito + 0.01) erro(rotulo, "Passa do pé-direito.");
      }
      for (const c of p.comodos) {
        const rotulo = `${onde} › ${c.nome}`;
        if (c.poligono.length < 3) { erro(rotulo, "Contorno incompleto."); continue; }
        conferirArea(rotulo, c.poligono, c.areaInformada, aviso);
        if (c.origem === "estimada") aviso(rotulo, "Medidas estimadas (sem cota na prancha).");
      }
      for (const s of p.escadas) {
        const rotulo = `${onde} › escada ${s.id}`;
        if (!s.destinoPavimentoId) erro(rotulo, "Sem pavimento de destino.");
        else if (!pavs.has(s.destinoPavimentoId)) erro(rotulo, "Leva a um pavimento que não existe.");
        else if (s.destinoPavimentoId === p.id) erro(rotulo, "Leva ao próprio pavimento.");
      }
    });
    const entradas = e.pavimentos.flatMap(p => p.aberturas).filter(a => a.entradaPrincipal).length;
    if (entradas === 0) aviso(e.nome, "Entrada principal não marcada (o tour começa por ela).");
    if (entradas > 1) aviso(e.nome, "Mais de uma entrada principal marcada.");
  }

  for (const p of m.pendencias) if (!p.resolvida) erro("Pendência", p.descricao);
  return ps;
}

function conferirArea(onde: string, pts: Ponto[], informada: number | null, aviso: (onde: string, m: string) => void) {
  if (!informada) return;
  const lida = areaPoligono(pts);
  if (Math.abs(lida - informada) / informada > TOLERANCIA_AREA) {
    aviso(onde, `Área da prancha ${r2(informada)} m², área do desenho lido ${r2(lida)} m².`);
  }
}

export const podePublicar = (m: ModeloMaquete) => !validarModelo(m).some(p => p.nivel === "erro");
