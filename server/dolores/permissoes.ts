// EPIC-025 (Dolores) — lista de funções AUTORIZADAS por etapa. A ponte só executa o que está liberado na etapa
// atual; o resto é recusado e auditado. Liberar uma função nova = escrevê-la aqui, com a etapa, depois do teste de aceite.
//
// Limites fixos (todas as etapas), que nenhuma função liberada aqui pode ferir: nunca excluir registro; nunca editar ou
// apagar lançamento financeiro confirmado; nunca pagar nem autorizar pagamento; nunca mexer em usuários, acessos,
// credenciais ou dados bancários; nunca assinar ou validar documento técnico/jurídico; nunca inventar dado.

export const ETAPA_ATUAL = 2;

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

const LIBERADAS: Record<number, readonly string[]> = { 1: LIBERADAS_ETAPA_1, 2: LIBERADAS_ETAPA_2 };

/** Funções previstas para etapas seguintes (ainda não liberadas): a recusa diz quando chegam. */
export const PREVISTAS: Record<string, number> = {
  criar_tarefa: 3, registrar_acompanhamento: 3, preparar_cobranca: 3, gerar_documento: 3,
  // mensagem para cliente/terceiro sai com as cobranças (etapa 3); na etapa 2 só o sistema responde ao dono
  enviar_mensagem_whatsapp: 3,
  ler_grupo_cliente: 4, ler_nota_obra: 5, relatorio_diario: 6,
};

export function funcaoLiberada(nome: string, etapa = ETAPA_ATUAL): boolean {
  for (let e = 1; e <= etapa; e++) if ((LIBERADAS[e] ?? []).includes(nome)) return true;
  return false;
}

export function motivoDaRecusa(nome: string): string {
  const prevista = PREVISTAS[nome];
  return prevista ? `Função "${nome}" prevista para a etapa ${prevista}; ainda não liberada (etapa atual: ${ETAPA_ATUAL}).`
    : `Função "${nome}" não existe na lista de funções autorizadas.`;
}
