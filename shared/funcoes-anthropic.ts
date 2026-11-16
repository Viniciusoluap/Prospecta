// EPIC-024 S-11 (16/11): funções do sistema que usam a chave da Anthropic cadastrada em Integrações › Anthropic.
// Fonte única: o painel monta uma linha por função e a resolução do modelo (server/_core/modelo-por-funcao.ts) só
// aceita estas. Só nomes e textos — nenhuma chave nem acesso a banco aqui.
// Outras IAs do sistema (avaliação, mercado, Central de Vendas) usam a variável de ambiente e não entram nesta lista.

export const FUNCOES_ANTHROPIC = ["maquete_leitura", "dolores_whatsapp"] as const;
export type FuncaoAnthropic = (typeof FUNCOES_ANTHROPIC)[number];

export type DescricaoFuncaoAnthropic = {
  id: FuncaoAnthropic;
  rotulo: string;
  /** O que faz e quando gasta, para o dono. */
  descricao: string;
  recomendacao: string;
};

export const DESCRICAO_FUNCOES_ANTHROPIC: Record<FuncaoAnthropic, DescricaoFuncaoAnthropic> = {
  maquete_leitura: {
    id: "maquete_leitura",
    rotulo: "Leitura de plantas em PDF — Maquete 3D",
    descricao: "Lê as pranchas em PDF que o leitor próprio não consegue ler (ex.: PDF que é só imagem). Só gasta quando o administrador confirma o custo da leitura de uma maquete.",
    recomendacao: "Leitura de planta: prefira um modelo mais capaz (erros de leitura custam retrabalho na maquete).",
  },
  dolores_whatsapp: {
    id: "dolores_whatsapp",
    rotulo: "Dolores — conversa pelo WhatsApp",
    descricao: "Responde aos comandos do dono pelo WhatsApp da Dolores. Só gasta com o interruptor da IA dela ligado, a cada comando, até os limites mensais definidos no cartão da Dolores.",
    recomendacao: "Conversa: um modelo mais barato (ex.: Haiku) costuma bastar.",
  },
};

export const ehFuncaoAnthropic = (v: unknown): v is FuncaoAnthropic =>
  typeof v === "string" && (FUNCOES_ANTHROPIC as readonly string[]).includes(v);
