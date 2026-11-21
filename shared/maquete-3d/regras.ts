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
 * é o padrão desde 15/11/2026 (pedido do dono). "hibrido" (EPIC-024 S-03): o leitor próprio primeiro e a IA só nas
 * pranchas que ele não consegue ler (imagem) ou lê de forma insuficiente; vale como padrão quando há chave da IA.
 * "ia": a leitura paga pela API em todos os passos, só se o administrador escolher.
 */
export const MOTORES_LEITURA = ["geometrico", "hibrido", "ia"] as const;
export type MotorLeitura = (typeof MOTORES_LEITURA)[number];
export const ROTULOS_MOTOR: Record<MotorLeitura, string> = {
  geometrico: "Leitor próprio (sem custo, nunca usa IA)",
  hibrido: "Híbrido: leitor próprio e IA só nas pranchas que ele não lê",
  ia: "IA em tudo (paga, exige chave)",
};
/** Teto padrão de pranchas enviadas à IA por maquete: um PDF de 60 páginas não gasta em silêncio. */
export const LIMITE_PRANCHAS_IA_PADRAO = 8;
export const ESFORCOS_IA = ["low", "medium", "high"] as const;

export const configSchema = z.object({
  precos: z.object({
    terrea_ate_70: z.number().min(0).max(100000).default(PRECOS_PADRAO.terrea_ate_70),
    terrea_70_150: z.number().min(0).max(100000).default(PRECOS_PADRAO.terrea_70_150),
    acima_150_ou_sobrado: z.number().min(0).max(100000).default(PRECOS_PADRAO.acima_150_ou_sobrado),
  }).default(PRECOS_PADRAO),
  /** Sem valor salvo: híbrido se houver chave da IA, senão leitor próprio (`motorEfetivo`). */
  motor: z.enum(MOTORES_LEITURA).optional(),
  limitePranchasIA: z.number().int().min(0).max(60).default(LIMITE_PRANCHAS_IA_PADRAO),
  modeloIA: z.string().min(1).max(80).default(MODELO_IA_PADRAO),
  esforcoIA: z.enum(ESFORCOS_IA).default("medium"),
});
export type ConfigMaquete = z.infer<typeof configSchema>;

/** Motor em uso: o escolhido pelo administrador; sem escolha, híbrido só quando existe chave da IA. */
export const motorEfetivo = (c: Pick<ConfigMaquete, "motor">, temChave: boolean): MotorLeitura => c.motor ?? (temChave ? "hibrido" : "geometrico");

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

/** Quem leu o passo: o leitor próprio, a IA, ou "pulada" (a pessoa seguiu sem a IA e ficou o que o leitor próprio leu). */
export type MotorDoPasso = "geometrico" | "ia" | "pulada";

export type PassoLeitura = {
  chave: string;
  /** "prancha_ia": a mesma prancha de um passo "prancha", lida pela IA (EPIC-024 S-03). */
  tipo: "inventario" | "prancha" | "prancha_ia" | "estrutura" | "ambientes" | "implantacao" | "montagem";
  rotulo: string;
  /**
   * "aguardando": parado sem erro, à espera da pessoa (chave da IA ou confirmação do custo); retoma deste passo.
   * "executando": a chamada paga à IA deste passo foi reservada e está em curso (outra aba não chama de novo).
   */
  estado: "pendente" | "feito" | "erro" | "aguardando" | "executando";
  erro?: string | null;
  /** Referência do passo: documento (índice na lista de PDFs quando o passo foi criado), página e pavimento. */
  doc?: number; pagina?: number; pavimentoId?: string; edificacaoId?: string;
  /** Identidade do PDF do passo (fonte + id): é por ela, e não pela posição na lista, que o arquivo é achado. */
  arquivo?: { fonte: DocumentoMaquete["fonte"]; id: number; nome: string };
  motor?: MotorDoPasso; modelo?: string | null; tokens?: { entrada: number; saida: number } | null;
  /** "teto": a maquete já usou o teto de pranchas pela IA; só passa dele com a confirmação "além do teto" do admin. */
  aguardando?: "chave" | "confirmacao" | "teto" | null;
  /**
   * Passo parado na confirmação do custo (ou no teto): o modelo que a confirmação vai gravar, como a tela mostra ao
   * admin. A tela o devolve ao confirmar; se o modelo mudou desde então, o servidor recusa (QA S-11 r2, achado 2).
   */
  modeloAConfirmar?: string | null;
  /** Quando a chamada paga foi reservada (passo "executando"): reserva velha demais é dada como interrompida. */
  reservadoEm?: string | null;
  /** Por que a prancha foi para a IA (critério objetivo, ver `motivoParaIA`). */
  motivoIA?: string | null;
  /** O que foi enviado à IA: a imagem da página, um PDF só daquela página, ou o PDF original com a instrução da página. */
  envio?: "imagem" | "pdf_pagina" | "pdf_original" | null;
  /** Vezes seguidas em que o passo devolveu o controle sem chamar a IA por falta de tempo na função (QA rodada 2, N7). */
  adiado?: number;
  /** Por que a prancha foi inteira para a IA (quando não deu para separar só a página): fica registrado no passo. */
  envioMotivo?: string | null;
  /**
   * EPIC-027 C1 — leitura em segundo plano: o lote da Anthropic com a requisição desta prancha. Gravado logo depois
   * de criado; enquanto houver lote, o passo fica "executando" (a reserva não vence pelo tempo) e cada "avançar"
   * só consulta. Sobrevive a recarregar e a fechar a página. O id do lote não é segredo (a chave nunca fica aqui).
   */
  lote?: LoteDoPasso | null;
  /**
   * QA C1, achados 1 e 2: o envio pode ter criado o lote sem que o id voltasse (tempo esgotado, função encerrada). O
   * passo fica "executando" e procura o lote pela janela de criação antes de dar a tentativa como usada.
   * `pedido`: o custom_id desta tentativa (único: passo + hora da reserva), conferido quando o lote terminar.
   */
  loteAProcurar?: { pedido: string; desde: string; tentativas: number; imagem?: boolean } | null;
  /** QA C1, achado 3: lote deixado de lado (consulta impossível) e se o cancelamento pedido à Anthropic foi aceito. */
  loteAbandonado?: { id: string; cancelamento: "aceito" | "recusado" } | null;
};

/** "em_andamento": a API não separa "na fila" de "sendo lida". "cancelando": o cancelamento foi pedido. */
export type SituacaoLote = "em_andamento" | "cancelando";
/** `imagem`: a prancha foi como imagem (a resposta é conferida como leitura de imagem, sem cotas confirmadas por traço). */
/** `adotado`: achado pela procura (achados 1 e 2), ainda sem o custom_id conferido (a conferência vem nos resultados). */
export type LoteDoPasso = { id: string; pedido: string; situacao: SituacaoLote; enviadoEm: string; imagem?: boolean; falhasDeConsulta?: number; adotado?: boolean };

/**
 * Confirmação do custo da IA (EPIC-024, correção do QA): vale só para a execução atual (esta leitura ou esta
 * importação) e para `pranchas` chamadas pagas; expira quando `usadas` chega a `pranchas`. "Ler de novo" e uma
 * importação nova nascem sem confirmação. `alemDoTeto`: o admin autorizou passar do teto por maquete.
 */
/**
 * `modelo` (EPIC-024 S-11, QA achado 3): o modelo da IA com que o custo foi confirmado. Se o modelo que vale na hora de
 * ler for outro (ex.: o admin trocou o modelo da função no painel), a confirmação não vale e a tela pede outra.
 * Confirmações gravadas antes disso não têm o modelo: não há como saber com qual foram feitas, então valem como
 * "modelo diferente" (lado seguro — o admin confirma de novo uma vez).
 */
export type ConfirmacaoIA = { em: string; por: number | null; pranchas: number; usadas?: number; alemDoTeto?: boolean; modelo?: string };
export const confirmacaoValida = (c: ConfirmacaoIA | null | undefined): boolean => !!c && (c.usadas ?? 0) < c.pranchas;
/** Confirmação válida E feita com este mesmo modelo. */
export const confirmacaoDoModelo = (c: ConfirmacaoIA | null | undefined, modelo: string): boolean => confirmacaoValida(c) && c!.modelo === modelo;

export type EstadoLeitura = {
  passos: PassoLeitura[];
  /** Resultados parciais por chave de passo (JSON já validado). */
  parciais: Record<string, unknown>;
  tokensEntrada: number; tokensSaida: number;
  iniciadaEm: string | null; concluidaEm: string | null;
  confirmacaoIA?: ConfirmacaoIA | null;
  /** Pranchas que precisariam da IA mas passaram do teto por maquete (ficou o que o leitor próprio leu). */
  foraDoLimiteIA?: string[];
};

export const leituraVazia = (): EstadoLeitura => ({ passos: [], parciais: {}, tokensEntrada: 0, tokensSaida: 0, iniciadaEm: null, concluidaEm: null, confirmacaoIA: null, foraDoLimiteIA: [] });

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
