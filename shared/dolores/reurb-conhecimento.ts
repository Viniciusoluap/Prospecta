// EPIC-027 C5 (REURB) — conhecimento destilado para a análise de regularização fundiária urbana pela Dolores.
// Fonte única: o roteiro do agente "A.68 — Agente REURB" (skill interna) e a Lei federal 13.465/2017 que ele cita. Artigo IV
// (No Invention): nada aqui vai além dessas duas fontes. Nenhum coeficiente, prazo, valor, renda-limite ou marco temporal com
// data: o que depende de lei, decreto ou regulamento sai marcado para CONFERIR. Texto próprio e enxuto (vai ao modelo a cada
// análise, dentro do resultado da consulta — nunca no texto do sistema). Módulo puro: sem banco, sem rede.

/** Nome da ferramenta de leitura (server/dolores/leitura/reurb.ts). */
export const FUNCAO_REURB = "analisar_regularizacao_reurb";

/** Fontes declaradas no parecer (o modelo não cita outra). */
export const FONTES_REURB = [
  "Lei federal 13.465/2017 (regularização fundiária urbana — REURB)",
  "roteiro interno de REURB do escritório (agente A.68)",
] as const;

/** Aviso fixo que fecha TODO parecer de REURB (o código acrescenta se o modelo não puser). */
export const AVISO_REURB =
  "Rascunho para revisão: o enquadramento e o rito dependem da legislação municipal (lei e decreto de REURB do município) e precisam da conferência do jurídico e do engenheiro responsável (com ART) antes de qualquer uso. Nada aqui garante aprovação.";

/** Modalidades (Lei 13.465/2017). Quem define é o município; a Dolores só aponta o enquadramento PROVÁVEL. */
export const MODALIDADES_REURB = [
  { sigla: "REURB-S", quando: "núcleo urbano informal ocupado predominantemente por população de baixa renda, assim reconhecido pelo município" },
  { sigla: "REURB-E", quando: "os demais casos (núcleo que não se enquadra como de baixa renda)" },
] as const;
export const NOTA_MODALIDADES = "As duas modalidades têm custos e responsabilidades diferentes [CONFERIR no regulamento e no decreto municipal]. A modalidade é definida pelo município: nunca afirmar como decidida.";

/** Etapas do rito, na ordem (Lei 13.465/2017, conforme o roteiro). */
export const ETAPAS_REURB = [
  "Requerimento (pelos legitimados)",
  "Processamento administrativo, com notificação dos titulares e dos confrontantes",
  "Projeto de regularização fundiária",
  "Saneamento do processo",
  "Decisão da autoridade competente",
  "Expedição da CRF (Certidão de Regularização Fundiária) pelo município",
  "Registro da CRF e do projeto no cartório de registro de imóveis",
] as const;

/** Peças técnicas que o município e o cartório costumam exigir (roteiro). */
export const PECAS_TECNICAS_REURB = [
  "Levantamento planialtimétrico cadastral georreferenciado",
  "Planta do perímetro do núcleo",
  "Memoriais descritivos",
  "Projeto urbanístico",
  "Cronograma das obras de infraestrutura",
  "Cadastro social e físico dos lotes (famílias e ocupações)",
  "Estudo técnico específico se houver área de risco ou de preservação (APP) no perímetro",
  "ART do engenheiro para levantamentos, projetos e estudos",
] as const;

/** Dados do núcleo sem os quais o parecer fica incompleto: o que faltar sai como [FALTA: …] no ponto exato. */
export const DADOS_DO_NUCLEO = [
  "Núcleo: quantos lotes, área pública ou particular, desde quando ocupado",
  "Modalidade pretendida e renda declarada das famílias",
  "Quem contrata (prefeitura, associação, particular)",
  "Riscos e restrições (córrego, encosta, APP, faixa de servidão)",
  "Infraestrutura existente (água, esgoto, energia, pavimento)",
] as const;

/** Cuidados do roteiro: entram no parecer como limites. */
export const CUIDADOS_REURB = [
  "Área de risco ou de preservação no perímetro exige estudo técnico e pode exigir obra ou realocação: nunca ignorar.",
  "Legitimação fundiária e legitimação de posse têm requisitos próprios, inclusive marco temporal em alguns casos [CONFERIR na lei].",
  "Nunca prometer título individual antes do registro da CRF.",
  "Nunca afirmar requisito, prazo ou valor sem marcar [CONFERIR na lei, no decreto ou no regulamento vigente].",
  "Nunca prometer aprovação na prefeitura nem resultado garantido; o parecer não substitui vistoria nem a responsabilidade técnica do engenheiro.",
] as const;

/** Formato do parecer pedido ao modelo (curto: vai por WhatsApp). */
export const FORMATO_PARECER_REURB = [
  "*Enquadramento provável* (REURB-S ou REURB-E, com o porquê tirado dos dados do caso; sem dado de renda/núcleo, diga [FALTA: …])",
  "*Etapa do rito* (em qual das etapas o caso parece estar, pelas etapas e observações registradas; e as que faltam)",
  "*Documentos e peças que faltam* (os pendentes registrados no sistema + as peças técnicas do roteiro que não aparecem no caso)",
  "*Próximos passos* (2 a 4, práticos)",
  "*Pontos para revisão do jurídico e do engenheiro*",
] as const;

/** Bloco de conhecimento que acompanha os dados do caso no resultado da consulta. */
export function conhecimentoReurb() {
  return {
    fontes: [...FONTES_REURB],
    modalidades: MODALIDADES_REURB.map(m => ({ ...m })),
    notaModalidades: NOTA_MODALIDADES,
    etapasDoRito: [...ETAPAS_REURB],
    pecasTecnicas: [...PECAS_TECNICAS_REURB],
    dadosDoNucleoNecessarios: [...DADOS_DO_NUCLEO],
    cuidados: [...CUIDADOS_REURB],
  };
}

/** Instrução ao modelo, junto do resultado (curta; o parecer é dele, os limites são estes). */
export function instrucaoDoParecerReurb() {
  return {
    formato: [...FORMATO_PARECER_REURB],
    tamanho: "curto: no máximo uns 15 itens no total, frases diretas, para ler no WhatsApp",
    regras: "Use só os dados do caso e este conhecimento; não invente número, prazo, valor, artigo ou renda-limite. O que faltar, marque [FALTA: …]; o que depende de norma, [CONFERIR …]. Não diga valores em dinheiro. Termine com o aviso fixo (avisoObrigatorio), sem mudar o texto.",
    avisoObrigatorio: AVISO_REURB,
  };
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const PADRAO_REURB = /\breurb\b|regularizacao\s+fundiaria/;

/** O cadastro identifica o caso como REURB (por código, nunca pela IA)? Só campos de cadastro: tipo do processo e nomes das etapas. */
export function textoIndicaReurb(...textos: ReadonlyArray<string | null | undefined>): boolean {
  return textos.some(t => !!t && PADRAO_REURB.test(semAcento(t)));
}

/**
 * Garante o aviso fixo no FIM da resposta quando o pedido fez uma análise de REURB que deu parecer (por código: o modelo pode
 * esquecer ou mudar de lugar; o aviso, não). No envio, partesDaResposta reserva o espaço dele: o corte nunca o leva (QA M1).
 */
export function comAvisoReurb(texto: string, analisou: boolean): string {
  if (!analisou) return texto;
  // QA B1: o aviso FECHA o parecer — tirado de onde estiver (o modelo, ou texto que ele repetiu, pode pô-lo no começo) e posto no fim
  const corpo = texto.split(AVISO_REURB).join("").replace(/\n{3,}/g, "\n\n").trim();
  return corpo ? `${corpo}\n\n${AVISO_REURB}` : AVISO_REURB;
}
