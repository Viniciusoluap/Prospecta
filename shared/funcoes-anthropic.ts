// EPIC-024 S-11 (16/11): funções do sistema que usam a chave da Anthropic cadastrada em Integrações › Anthropic.
// Fonte única: o painel monta uma linha por função e a resolução do modelo (server/_core/modelo-por-funcao.ts) só
// aceita estas. Só nomes e textos — nenhuma chave nem acesso a banco aqui.
// Outras IAs do sistema (avaliação, mercado, Central de Vendas) usam a variável de ambiente e não entram nesta lista.

export const FUNCOES_ANTHROPIC = ["maquete_leitura", "dolores_whatsapp", "dolores_documentos", "dolores_grupo", "dolores_notas", "dolores_cliente", "dolores_avisos", "incorporacao_logotipo"] as const;
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
    recomendacao: "Prefira um modelo mais capaz: erros de leitura custam retrabalho na maquete.",
  },
  dolores_whatsapp: {
    id: "dolores_whatsapp",
    rotulo: "Dolores — conversa pelo WhatsApp",
    descricao: "Responde aos comandos do dono pelo WhatsApp da Dolores. Só gasta com o interruptor da IA dela ligado, a cada comando, até os limites mensais definidos no cartão da Dolores.",
    recomendacao: "Um modelo mais barato (ex.: Haiku) costuma bastar.",
  },
  dolores_documentos: {
    id: "dolores_documentos",
    rotulo: "Dolores — classificação de documentos",
    descricao: "Classifica os documentos e fotos que chegam nos grupos de clientes cadastrados (RG, CNH, comprovante…). Só gasta com o interruptor da IA da Dolores e a classificação ligados, um documento por vez, até os tetos diários e dentro do limite mensal do cartão da Dolores.",
    recomendacao: "Um modelo que leia imagem e PDF; o mais barato (ex.: Haiku) costuma bastar. Confiança baixa vira \"confira\".",
  },
  dolores_grupo: {
    id: "dolores_grupo",
    rotulo: "Dolores — resposta em grupo quando marcada",
    descricao: "Responde no grupo de cliente cadastrado só quando alguém marca o número da Dolores, e só sobre o andamento e os documentos daquele cliente. Só gasta com o interruptor da IA e o \"responder quando marcada\" (geral e do grupo) ligados, até os tetos por grupo e por pessoa e dentro do limite mensal do cartão da Dolores.",
    recomendacao: "Um modelo mais barato (ex.: Haiku) costuma bastar: a resposta é curta e as consultas já vêm prontas.",
  },
  dolores_cliente: {
    id: "dolores_cliente",
    rotulo: "Dolores — resposta a cliente cadastrado (conversa direta)",
    descricao: "Responde, no número da empresa, o cliente cadastrado que escreve (ou manda áudio transcrito) — só sobre o andamento, as pendências e os documentos que faltam do caso dele, sem valores. Só gasta com o interruptor da IA da Dolores e o \"Dolores responde clientes cadastrados\" ligados, até os tetos por cliente e por dia e dentro do orçamento próprio no limite mensal do cartão da Dolores.",
    recomendacao: "O modelo mais barato (ex.: Haiku) basta: a resposta é uma mensagem curta e as consultas já vêm prontas.",
  },
  dolores_notas: {
    id: "dolores_notas",
    rotulo: "Dolores — leitura de notas de obra",
    descricao: "Lê as notas fiscais e recibos que chegam nos grupos de OBRA cadastrados (emitente, CPF/CNPJ, número, data, valor, itens) e monta o rascunho para o dono conferir. Só gasta com o interruptor da IA da Dolores, a classificação de documentos e a leitura de notas ligados, uma nota por vez, dentro dos tetos diários e do orçamento dos documentos no limite mensal do cartão da Dolores.",
    recomendacao: "Um modelo que leia bem imagem e PDF com números; valores e CPF/CNPJ são conferidos pelo sistema, e o que tiver confiança baixa vira \"confira\".",
  },
  dolores_avisos: {
    id: "dolores_avisos",
    rotulo: "Dolores — texto dos avisos automáticos",
    descricao: "Escreve, em linguagem natural, o aviso que a Dolores manda sozinha ao dono (obras com atraso, tarefas vencidas, documentos pendentes…). Quem decide O QUE avisar são as regras do sistema; a IA só redige. Só gasta com os avisos ligados, a \"IA no texto\" ligada na tela de avisos e o interruptor da IA da Dolores ligado, no máximo 6 vezes por dia e dentro da parte \"avisos\" (5%) do limite mensal. Sem IA, sai o texto fixo.",
    recomendacao: "O modelo mais barato (ex.: Haiku) basta: o texto é curto e os dados já vêm prontos.",
  },
  incorporacao_logotipo: {
    id: "incorporacao_logotipo",
    rotulo: "Logotipo da incorporação",
    descricao: "Desenha uma proposta de logotipo (em SVG) a partir do nome, da cidade e do tipo do empreendimento. Só gasta quando alguém da Incorporação clica em \"Gerar logotipo com IA\", uma proposta por clique, até 5 por empreendimento e 5 por pessoa a cada dia. A proposta só substitui o logotipo atual depois de aprovada.",
    recomendacao: "Sem escolha, vale o mesmo padrão da Maquete 3D (Opus). Se a proposta passar do tempo limite de 40 segundos, escolha aqui um modelo intermediário (ex.: Sonnet) oferecido pela sua chave.",
  },
};

/**
 * Modelo usado pela função quando nem ela nem o preferencial do painel têm modelo escolhido. Só nomes de modelo.
 * Portão de QA C8 (21/11): o padrão do logotipo é o mesmo id já usado como padrão válido na Maquete 3D
 * (`MODELO_IA_PADRAO`, `claude-opus-5-5`, também na tabela oficial de preços da Dolores) — `claude-sonnet-5` não está
 * confirmado em nenhuma lista do projeto.
 */
export const MODELO_PADRAO_DA_FUNCAO: Partial<Record<FuncaoAnthropic, string>> = {
  incorporacao_logotipo: "claude-opus-5-5",
};

export const ehFuncaoAnthropic = (v: unknown): v is FuncaoAnthropic =>
  typeof v === "string" && (FUNCOES_ANTHROPIC as readonly string[]).includes(v);

/** O que a tela "Modelo por função" sabe de uma função (só nomes de modelo). */
export type EstadoModeloDaFuncao = {
  modelo: string | null;
  sumiu?: string | null;
  anteriorSumiu?: string | null;
  valendo: { modelo: string | null; origem: string | null };
};

/**
 * QA S-11 achado 1: o botão Salvar fica habilitado quando há o que gravar. Além de trocar o modelo escolhido, salvar
 * "Usar o preferencial" (valor vazio) também muda algo quando vale o modelo antigo do cartão da Dolores (ele é
 * descartado) ou quando há aviso de modelo sumido (o aviso sai).
 */
export function haAlgoParaSalvar(f: EstadoModeloDaFuncao, valor: string): boolean {
  if (valor !== (f.modelo ?? "")) return true;
  return valor === "" && (f.valendo.origem === "anterior" || !!f.sumiu || !!f.anteriorSumiu);
}

/** Salvar "Usar o preferencial" descarta o modelo antigo do cartão da Dolores? (a tela avisa no rótulo) */
export const descartaModeloAntigo = (f: EstadoModeloDaFuncao, valor: string) =>
  valor === "" && (f.valendo.origem === "anterior" || !!f.anteriorSumiu);
