// EPIC-025 (Dolores) — lista de funções AUTORIZADAS por etapa. A ponte só executa o que está liberado na etapa
// atual; o resto é recusado e auditado. Liberar uma função nova = escrevê-la aqui, com a etapa, depois do teste de aceite.
//
// Limites fixos (todas as etapas), que nenhuma função liberada aqui pode ferir: nunca excluir registro; nunca editar ou
// apagar lançamento financeiro confirmado; nunca pagar nem autorizar pagamento; nunca mexer em usuários, acessos,
// credenciais ou dados bancários; nunca assinar ou validar documento técnico/jurídico; nunca inventar dado.

export const ETAPA_ATUAL = 7;

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
 * (o conteúdo do grupo é de terceiro; criar card e salvar documento só com a aprovação do dono). Nenhuma delas fala no grupo;
 * a etapa 4b (resposta quando marcada) não é ferramenta do laço do dono: tem laço e leituras próprios (marcacao.ts).
 */
export const LIBERADAS_ETAPA_4 = ["listar_grupos", "ler_grupo_cliente", "criar_card_cliente", "salvar_documentos_grupo"] as const;

/**
 * Etapa 5 — Notas de obra: a leitura das notas lidas nos grupos de obra e as duas ações, ambas de FILA (a nota é de terceiro;
 * ligar ao BPO e salvar no Drive só com a aprovação do dono). A leitura da nota em si não é ferramenta: o sistema a faz quando
 * o documento chega no grupo da obra. Nada fala no grupo; a confirmação do empreiteiro é reconhecida por código.
 */
export const LIBERADAS_ETAPA_5 = ["listar_notas_obra", "conciliar_nota_obra", "salvar_nota_obra"] as const;

/**
 * Etapa 6 — Operação contínua: a leitura da última ronda e do último relatório (somente leitura). A ronda e o relatório em si
 * não são ferramentas: rodam por código (cron, tela ou o comando "relatório" do dono), sem IA.
 */
export const LIBERADAS_ETAPA_6 = [
  "relatorio_diario",
  // Etapa 8 (respostas longas e custo): leitura DERIVADA de listar_atrasos (a mesma lista, só distribuída por dia, por código).
  // Somente leitura; entra junto da etapa 6 para não mudar a etapa em vigor.
  "plano_de_atrasos",
] as const;

/**
 * Etapa 7 — EPIC-027 C5 (E2, "a Dolores resolve"): o dono configura os grupos dela pela conversa. Todas de FILA e só com a resposta
 * dele no WhatsApp ("pode"; "confirmo" no que é sério), reconhecida por código. Nenhuma envia, paga, apaga ou mexe em usuário.
 */
export const LIBERADAS_ETAPA_7 = ["classificar_grupo", "aceitar_grupo", "ignorar_grupo", "ligar_resposta_grupo"] as const;

/**
 * Etapa 7 (cont.) — EPIC-027 C5 (memória de longo prazo, decisão do dono de 21/11): lembrar, corrigir e esquecer fatos permanentes
 * pela conversa. De FILA, nível "registro" ("pode"), só quando a mensagem do dono pede memória (por código); esquecer só ARQUIVA.
 */
export const LIBERADAS_ETAPA_7_MEMORIA = ["guardar_memoria", "corrigir_memoria", "esquecer_memoria"] as const;

/**
 * Etapa 7 (cont.) — EPIC-027 C5-COM (mesa comercial ligada à maquete, aprovada pelo dono em 21/11): SÓ na conversa direta do dono.
 * Duas leituras (o lote e a lista dos lotes com maquete: link, status, motivo), o rascunho de mensagem ao cliente (só texto devolvido
 * ao dono; nada é enviado nem gravado) e a ação de gerar/trocar o link (de FILA: "pode" para gerar, "confirmo" para trocar). As
 * leituras não entram na ponte HTTP nem nos grupos (funcoes.ts#LEITURAS_DO_DONO, mecanismo único com as mesas).
 */
export const LIBERADAS_ETAPA_7_MAQUETE = ["consultar_maquete_lote", "listar_maquetes_lotes", "rascunhar_mensagem_lote", "gerar_link_maquete_lote"] as const;

/**
 * Etapa 7 (cont.) — EPIC-027 C5 (criadora de mesas, pedido do dono aprovado em 21/11): o dono pede uma função nova e a Dolores só escreve a
 * PROPOSTA (nada passa a funcionar). Todas só na conversa direta dele: propor/revisar/recusar com "pode", aprovar com "confirmo" — e aprovar
 * não liga nada (só muda a situação; a função é construída pelo processo normal de desenvolvimento). listar_mesas fica fora da ponte HTTP.
 */
export const LIBERADAS_ETAPA_7_MESAS = ["listar_mesas", "propor_mesa", "revisar_mesa", "propor_aprovacao_mesa", "recusar_mesa"] as const;

/**
 * Etapa 7 (cont.) — EPIC-027 C5-E4 (avisos automáticos, decisão do dono de 21/11: "ele pode silenciar um tipo"): silenciar ou religar um
 * tipo de aviso pela conversa. De FILA, nível "registro" ("pode"); é configuração dela, reversível. Nunca envia nada a ninguém.
 */
export const LIBERADAS_ETAPA_7_AVISOS = ["silenciar_aviso"] as const;

/**
 * Etapa 7 (cont.) — EPIC-027 C5 (REURB, plano aprovado pelo dono em 21–22/11): análise de regularização fundiária de um processo
 * cadastrado. SOMENTE LEITURA e só na conversa direta do dono (ponte HTTP, grupo e cliente recusam — ponte.ts e funcoes.ts).
 */
export const LIBERADAS_ETAPA_7_REURB = ["analisar_regularizacao_reurb"] as const;

const LIBERADAS: Record<number, readonly string[]> = { 1: LIBERADAS_ETAPA_1, 2: LIBERADAS_ETAPA_2, 3: LIBERADAS_ETAPA_3, 4: LIBERADAS_ETAPA_4, 5: LIBERADAS_ETAPA_5, 6: LIBERADAS_ETAPA_6, 7: [...LIBERADAS_ETAPA_7, ...LIBERADAS_ETAPA_7_MEMORIA, ...LIBERADAS_ETAPA_7_MAQUETE, ...LIBERADAS_ETAPA_7_MESAS, ...LIBERADAS_ETAPA_7_AVISOS, ...LIBERADAS_ETAPA_7_REURB] };

/** Funções previstas para etapas seguintes (ainda não liberadas): a recusa diz quando chegam. Nenhuma depois da etapa 6. */
export const PREVISTAS: Record<string, number> = {};

/**
 * Funções que NUNCA existem para a Dolores (limites fixos ou dependem de liberação do dono). A recusa diz o porquê; o
 * modelo nem as recebe como ferramenta. Envio a cliente/terceiro só depois de o dono liberar as categorias.
 */
export const PROIBIDAS: Record<string, string> = {
  enviar_mensagem_whatsapp: "envio de mensagem a cliente ou terceiro não foi liberado pelo dono (a Dolores só responde ao número dele)",
  enviar_email: "envio de e-mail a cliente ou terceiro não foi liberado pelo dono",
  enviar_cobranca: "a Dolores só PREPARA cobranças; o envio a cliente não foi liberado pelo dono",
  responder_grupo: "o modelo não escreve em grupo: só o sistema responde, quando a Dolores é marcada num grupo cadastrado com o interruptor ligado, e só sobre aquele cliente",
  enviar_mensagem_grupo: "o modelo não escreve em grupo: só o sistema responde, quando a Dolores é marcada num grupo cadastrado com o interruptor ligado, e só sobre aquele cliente",
  pedir_confirmacao_nota: "a Dolores não fala no grupo nem com o empreiteiro: a tela e listar_notas_obra mostram o texto sugerido para o DONO enviar",
  apagar_arquivo_drive: "limite fixo: a Dolores nunca apaga nem sobrescreve arquivo",
  aprovar_item: "só o dono aprova o que você propõe (a resposta dele, reconhecida pelo sistema, ou a tela do administrador)",
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
