// Maquete 3D (EPIC-022) — regras de negócio aprovadas pelo dono em 14/11/2026: faixas de preço, situações do
// pedido e quem pode avançar cada passo. Projeto de cliente é pago; maquete de Incorporação não tem cobrança,
// mas só é gerada depois da autorização de um administrador.
import { z } from "zod";

export const ORIGENS_MAQUETE = ["projeto", "incorporacao"] as const;
export type OrigemMaquete = (typeof ORIGENS_MAQUETE)[number];

export const FAIXAS_PRECO = ["terrea_ate_70", "terrea_70_150", "acima_150_ou_sobrado"] as const;
export type FaixaPreco = (typeof FAIXAS_PRECO)[number];
export const ROTULOS_FAIXA: Record<FaixaPreco, string> = {
  terrea_ate_70: "Casa térrea até 70 m²",
  terrea_70_150: "Casa térrea de 70 a 150 m²",
  acima_150_ou_sobrado: "Acima de 150 m² ou sobrado",
};
export const PRECOS_PADRAO: Record<FaixaPreco, number> = { terrea_ate_70: 197, terrea_70_150: 297, acima_150_ou_sobrado: 497 };

/** Faixa pela área construída e pelo número de pavimentos (sobrado sempre cai na faixa maior). */
export function faixaPorArea(areaM2: number, pavimentos: number): FaixaPreco {
  if (pavimentos > 1 || areaM2 > 150) return "acima_150_ou_sobrado";
  return areaM2 > 70 ? "terrea_70_150" : "terrea_ate_70";
}

export const MODELO_IA_PADRAO = "claude-opus-5-5";
/**
 * Quem lê o PDF. "geometrico": o leitor próprio do sistema (linhas, arcos e textos do PDF vetorial), sem custo —
 * é o padrão desde 15/11/2026 (pedido do dono). "ia": a leitura paga pela API, só se o administrador escolher.
 */
export const MOTORES_LEITURA = ["geometrico", "ia"] as const;
export type MotorLeitura = (typeof MOTORES_LEITURA)[number];
export const ROTULOS_MOTOR: Record<MotorLeitura, string> = { geometrico: "Leitor próprio (sem custo)", ia: "IA (paga, exige chave)" };
export const ESFORCOS_IA = ["low", "medium", "high"] as const;

export const configSchema = z.object({
  precos: z.object({
    terrea_ate_70: z.number().min(0).max(100000).default(PRECOS_PADRAO.terrea_ate_70),
    terrea_70_150: z.number().min(0).max(100000).default(PRECOS_PADRAO.terrea_70_150),
    acima_150_ou_sobrado: z.number().min(0).max(100000).default(PRECOS_PADRAO.acima_150_ou_sobrado),
  }).default(PRECOS_PADRAO),
  motor: z.enum(MOTORES_LEITURA).default("geometrico"),
  modeloIA: z.string().min(1).max(80).default(MODELO_IA_PADRAO),
  esforcoIA: z.enum(ESFORCOS_IA).default("medium"),
});
export type ConfigMaquete = z.infer<typeof configSchema>;

export function lerConfig(texto: string | null | undefined): ConfigMaquete {
  try { return configSchema.parse(JSON.parse(texto || "{}")); } catch { return configSchema.parse({}); }
}

export const STATUS_MAQUETE = [
  "aguardando_aprovacao",   // pedido feito pelo cliente no portal: o administrador confere a faixa e aprova
  "aguardando_pagamento",   // projeto de cliente: pedido aprovado, cobrança em aberto
  "aguardando_autorizacao", // incorporação: espera o administrador autorizar
  "liberada",               // paga ou autorizada: pode rodar o motor
  "em_leitura",             // motor lendo os PDFs
  "em_revisao",             // leitura pronta: a equipe confere e corrige a planta
  "validada",               // planta conferida, sem erros: pronta para o visualizador
  "publicada",              // link entregue
  "recusada",               // pedido recusado (PDF inviável, cancelamento)
] as const;
export type StatusMaquete = (typeof STATUS_MAQUETE)[number];
export const ROTULOS_STATUS: Record<StatusMaquete, string> = {
  aguardando_aprovacao: "Aguardando aprovação", aguardando_pagamento: "Aguardando pagamento", aguardando_autorizacao: "Aguardando autorização", liberada: "Liberada",
  em_leitura: "Lendo o projeto", em_revisao: "Em revisão", validada: "Validada", publicada: "Publicada", recusada: "Recusada",
};

/** Situações em que o motor pode (re)ler os PDFs. Reler apaga a planta revisada, por isso a tela confirma antes. */
export const PODE_LER: readonly StatusMaquete[] = ["liberada", "em_leitura", "em_revisao", "validada"];
/** Situações em que a planta pode ser editada na revisão. */
export const PODE_REVISAR: readonly StatusMaquete[] = ["em_revisao", "validada"];
export const statusInicial = (origem: OrigemMaquete): StatusMaquete =>
  origem === "projeto" ? "aguardando_pagamento" : "aguardando_autorizacao";

// ── Leitura em passos ──
// Cada passo é uma chamada curta, para caber no limite de tempo da função (60 s na Vercel). A tela chama
// "avançar" até acabar; se um passo falhar, só ele é repetido.

export const TIPOS_PRANCHA = ["planta_baixa", "corte", "fachada", "implantacao", "cobertura", "outro"] as const;
export type TipoPrancha = (typeof TIPOS_PRANCHA)[number];

export type PassoLeitura = {
  chave: string;
  tipo: "inventario" | "prancha" | "estrutura" | "ambientes" | "implantacao" | "montagem";
  rotulo: string;
  estado: "pendente" | "feito" | "erro";
  erro?: string | null;
  /** Referência do passo: documento (índice na lista de PDFs), página e pavimento. */
  doc?: number; pagina?: number; pavimentoId?: string; edificacaoId?: string;
};

export type EstadoLeitura = {
  passos: PassoLeitura[];
  /** Resultados parciais por chave de passo (JSON já validado). */
  parciais: Record<string, unknown>;
  tokensEntrada: number; tokensSaida: number;
  iniciadaEm: string | null; concluidaEm: string | null;
};

export const leituraVazia = (): EstadoLeitura => ({ passos: [], parciais: {}, tokensEntrada: 0, tokensSaida: 0, iniciadaEm: null, concluidaEm: null });

export function lerEstadoLeitura(texto: string | null | undefined): EstadoLeitura {
  try {
    const v = JSON.parse(texto || "null");
    if (v && Array.isArray(v.passos) && typeof v.parciais === "object") return { ...leituraVazia(), ...v };
  } catch { /* cai no vazio */ }
  return leituraVazia();
}

export const progressoLeitura = (e: EstadoLeitura) => ({
  total: e.passos.length, feitos: e.passos.filter(p => p.estado === "feito").length,
  proximo: e.passos.find(p => p.estado !== "feito") ?? null,
});

/** PDF escolhido para a leitura. `fonte` diz em que tabela o arquivo está cadastrado ("avulso" = enviado direto no pedido). */
export const documentoSchema = z.object({
  fonte: z.enum(["projeto", "incorporacao", "avulso"]),
  id: z.number().int().positive(),
  nome: z.string().max(255),
});
export type DocumentoMaquete = z.infer<typeof documentoSchema>;

/** Limites do que é enviado à IA em cada passo (o PDF vai inteiro; a soma não pode passar do teto da API). */
export const MAX_DOCUMENTOS = 6;
export const MAX_BYTES_DOCUMENTOS = 22 * 1024 * 1024;
/** PDF avulso: o envio em partes do sistema aceita até 20 MiB por arquivo. */
export const MAX_BYTES_PDF_AVULSO = 20 * 1024 * 1024;
export const escopoEnvioMaquete = (maqueteId: number) => `maquete3d:${maqueteId}`;

// ── Apresentação comercial da maquete publicada (etapa 2) ──
// Só o que o admin informar aparece na tela inicial; campo vazio não é mostrado e nada é inventado.

export const comercialSchema = z.object({
  nome: z.string().trim().max(160).default(""),
  localizacao: z.string().trim().max(200).default(""),
  preco: z.number().min(0).max(1_000_000_000).nullable().default(null),
  /** Telefone do consultor para o botão do WhatsApp (só dígitos, com DDI e DDD). */
  whatsapp: z.string().trim().regex(/^\d{0,15}$/, "Só números, com DDI e DDD").default(""),
});
export type ComercialMaquete = z.infer<typeof comercialSchema>;

export function lerComercial(texto: string | null | undefined): ComercialMaquete {
  try { return comercialSchema.parse(JSON.parse(texto || "{}")); } catch { return comercialSchema.parse({}); }
}

/** Situações em que a maquete pode ser publicada (ganhar link) ou voltar para revisão. */
export const PODE_PUBLICAR: readonly StatusMaquete[] = ["validada"];
