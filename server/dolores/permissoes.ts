// EPIC-025 (Dolores) — lista de funções AUTORIZADAS por etapa. A ponte só executa o que está liberado na etapa
// atual; o resto é recusado e auditado. Liberar uma função nova = escrevê-la aqui, com a etapa, depois do teste de aceite.
//
// Limites fixos (todas as etapas), que nenhuma função liberada aqui pode ferir: nunca excluir registro; nunca editar ou
// apagar lançamento financeiro confirmado; nunca pagar nem autorizar pagamento; nunca mexer em usuários, acessos,
// credenciais ou dados bancários; nunca assinar ou validar documento técnico/jurídico; nunca inventar dado.

export const ETAPA_ATUAL = 4;

/** Etapa 1 — Leitura: somente consultas. */
export const LIBERADAS_ETAPA_1 = [
  "listar_processos_regularizacao",
  "detalhar_processo_regularizacao",
  "consultar_cliente",
  "historico_atendimento",
  "conversas_whatsapp",
  "listar_tarefas",
  "listar_documentos",
  "listar_atrasos",
  "listar_obras",
  "listar_medicoes",
  "listar_financiamentos",
  "listar_recebiveis_pendentes",
] as const;

/**
 * Etapa 2 — WhatsApp: nenhuma função nova. A etapa é o canal (comando do dono pelo WhatsApp e o laço de ferramentas no
 * servidor); a resposta ao dono é enviada pelo próprio sistema, não é uma ferramenta que o modelo possa chamar.
 */
export const LIBERADAS_ETAPA_2 = [] as const;

/**
 * Etapa 3 — Ações. O NÍVEL de cada uma (direto ou fila) está em acoes/registro.ts. Ações só executam por comando do dono
 * no WhatsApp (canal conferido em ponte.ts): a ponte HTTP continua só de leitura.
 */
export const LIBERADAS_ETAPA_3 = ["criar_tarefa", "registrar_acompanhamento", "preparar_cobranca", "gerar_documento"] as const;

/**
 * Etapa 4 — Grupos de clientes: as duas leituras dos grupos cadastrados e as duas ações da documentação, ambas de FILA
 * (o conteúdo do grupo é de terceiro; criar card e salvar documento só com a aprovação do dono). Nada fala no grupo.
 */
export const LIBERADAS_ETAPA_4 = ["listar_grupos", "ler_grupo_cliente", "criar_card_cliente", "salvar_documentos_grupo"] as const;

const LIBERADAS: Record<number, readonly string[]> = { 1: LIBERADAS_ETAPA_1, 2: LIBERADAS_ETAPA_2, 3: LIBERADAS_ETAPA_3, 4: LIBERADAS_ETAPA_4 };

/** Funções previstas para etapas seguintes (ainda não liberadas): a recusa diz quando chegam. */
export const PREVISTAS: Record<string, number> = {
  ler_nota_obra: 5, relatorio_diario: 6,
};

/**
 * Funções que NUNCA existem para a Dolores (limites fixos ou dependem de liberação do dono). A recusa diz o porquê; o
 * modelo nem as recebe como ferramenta. Envio a cliente/terceiro só depois de o dono liberar as categorias.
 */
export const PROIBIDAS: Record<string, string> = {
  enviar_mensagem_whatsapp: "envio de mensagem a cliente ou terceiro não foi liberado pelo dono (a Dolores só responde ao número dele)",
  enviar_email: "envio de e-mail a cliente ou terceiro não foi liberado pelo dono",
  enviar_cobranca: "a Dolores só PREPARA cobranças; o envio a cliente não foi liberado pelo dono",
  responder_grupo: "a Dolores não fala nos grupos: só lê os grupos cadastrados (nesta etapa nenhuma função exige falar)",
  enviar_mensagem_grupo: "a Dolores não fala nos grupos: só lê os grupos cadastrados (nesta etapa nenhuma função exige falar)",
  apagar_arquivo_drive: "limite fixo: a Dolores nunca apaga nem sobrescreve arquivo",
  aprovar_item: "só o dono aprova itens da fila (resposta \"aprovar CÓDIGO\" no WhatsApp ou a tela do administrador)",
  excluir_registro: "limite fixo: a Dolores nunca exclui registros",
  registrar_pagamento: "limite fixo: a Dolores nunca faz, autoriza, baixa ou estorna pagamento",
  editar_lancamento: "limite fixo: a Dolores nunca edita lançamento financeiro",
  alterar_usuario: "limite fixo: a Dolores nunca mexe em usuários, acessos, credenciais ou dados bancários",
  assinar_documento: "limite fixo: a Dolores nunca assina nem valida documento técnico ou jurídico",
};

export function funcaoLiberada(nome: string, etapa = ETAPA_ATUAL): boolean {
  for (let e = 1; e <= etapa; e++) if ((LIBERADAS[e] ?? []).includes(nome)) return true;
  return false;
}

export function motivoDaRecusa(nome: string): string {
  if (Object.hasOwn(PROIBIDAS, nome)) return `Função "${nome}" não permitida: ${PROIBIDAS[nome]}.`;
  const prevista = PREVISTAS[nome];
  return prevista ? `Função "${nome}" prevista para a etapa ${prevista}; ainda não liberada (etapa atual: ${ETAPA_ATUAL}).`
    : `Função "${nome}" não existe na lista de funções autorizadas.`;
}
