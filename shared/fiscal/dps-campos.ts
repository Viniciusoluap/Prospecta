// EPIC-029 S-4 (22/11/2026) — campos da DPS (Declaração de Prestação de Serviço) do leiaute nacional da NFS-e.
// Fonte: PESQUISA.md (2ª rodada, 22/11 tarde, documentos oficiais lidos) §1.4, §2, §3 e §5. Marcado [OFICIAL] o que foi
// lido nos XSD/Anexo I; o resto está [NÃO CONFIRMADO]. Tudo num lugar só, para ajustar fácil.
// Nenhum valor tributário é inventado: o que é do contador chega por `ParametrosContador` e, faltando, a DPS é recusada
// com a lista do que falta. IBS/CBS: a DPS leva só a CLASSIFICAÇÃO; a Sefin calcula os valores (PESQUISA §5).

/** [OFICIAL] namespace sem prefixo (E1228) e versão do leiaute (IBS/CBS só a partir de 1.01 — E0854). */
export const NAMESPACE_NFSE = "http://www.sped.fazenda.gov.br/nfse";
export const VERSAO_LEIAUTE_DPS = "1.01";
/** Identificação do aplicativo emissor (campo verAplic). */
export const VERSAO_APLICATIVO = "Prospecta-1.0";

/**
 * [OFICIAL, PESQUISA §3.1] Dois leiautes vigentes ao mesmo tempo:
 * - produção restrita = XSD v1.01 de 20/10/2026, já com a NT 009 (`finNFSe` em infDPS; CST/cClassTrib em IBSCBS/valores/trib;
 *   `cIndOp` opcional);
 * - produção = XSD v1.01 de 09/02/2026 (sem a NT 009: `finNFSe` dentro de IBSCBS; CST/cClassTrib em valores/trib/gIBSCBS
 *   [posição exata do leiaute antigo: NÃO CONFIRMADO linha a linha]). Produção continua BLOQUEADA nesta etapa.
 */
export type VarianteLeiaute = "producao_restrita_20261020" | "producao_20260209";
export const VARIANTE_DO_AMBIENTE: Record<"producao_restrita" | "producao", VarianteLeiaute> = {
  producao_restrita: "producao_restrita_20261020",
  producao: "producao_20260209",
};

/** [OFICIAL] tpAmb: 1 = produção, 2 = homologação (produção restrita). */
export const TP_AMB = { producao: "1", producao_restrita: "2" } as const;
/** [OFICIAL] tipo de inscrição no Id da DPS: 1 = CPF, 2 = CNPJ. */
export const TIPO_INSCRICAO_ID = { cpf: "1", cnpj: "2" } as const;
/** [OFICIAL] tpEmit: 1 = prestador. */
export const TP_EMIT_PRESTADOR = "1";
/** [OFICIAL] finNFSe: 0 = NFS-e regular (as notas de ajuste ficam fora da S-4). */
export const FIN_NFSE_REGULAR = "0";
/** [OFICIAL] série: `[0-9]{1,4}|[0-8][0-9]{4}`; aplicativo próprio (API) usa 00001–49999 (E0010). */
export const SERIE_MIN_API = 1;
export const SERIE_MAX_API = 49999;
/** [OFICIAL] nDPS: `[1-9][0-9]{0,14}` — sem zero à esquerda; número usado nunca é reutilizado. */
export const PADRAO_NUMERO_DPS = /^[1-9][0-9]{0,14}$/;
/** [OFICIAL] Id da DPS (45). */
export const PADRAO_ID_DPS = /^DPS[0-9]{7}(1[0-9]{14}|2[0-9A-Z]{14})[0-9]{20}$/;
/** [OFICIAL] chave de acesso da NFS-e (50; inscrição pode ter letras — CNPJ alfanumérico). */
export const PADRAO_CHAVE_NFSE = /^[0-9]{6}[0-9A-Z]{14}[0-9]{30}$/;

/**
 * Parâmetros que só o contador define (DIAGNOSTICO §7 / EPIC §7). `null` = ainda não informado → a DPS não é montada.
 * Os valores são códigos do leiaute, passados como texto, sem tradução nem padrão inventado aqui.
 */
export type ParametrosContador = {
  /** regTrib/opSimpNac — situação perante o Simples Nacional (deve ser coerente com o regime do perfil tributário). */
  opSimpNac: string | null;
  /** regTrib/regApTribSN — regime de apuração do Simples (só para ME/EPP optante). */
  regApTribSN?: string | null;
  /** regTrib/regEspTrib — regime especial de tributação. */
  regEspTrib: string | null;
  /** tribMun/tribISSQN — tributação do ISSQN. */
  tribIssqn: string | null;
  /** tribMun/tpRetISSQN — retenção do ISSQN. */
  tpRetIssqn: string | null;
  /** totTrib/indTotTrib — indicador de total aproximado de tributos. */
  indTotTrib: string | null;
  /**
   * Grupo IBSCBS — só a CLASSIFICAÇÃO declarada pelo emitente (a Sefin calcula os valores — PESQUISA §5).
   * Obrigatórios: indDest, CST, cClassTrib. `cIndOp` é exigido só quando o cClassTrib pede (E0860); `indFinal` opcional.
   */
  ibscbs: {
    indFinal: string | null;
    cIndOp: string | null;
    indDest: string | null;
    cst: string | null;
    cClassTrib: string | null;
  };
};

/**
 * regTrib/opSimpNac — códigos do leiaute [conferir no Anexo I]: 1 = não optante; 2 = optante MEI; 3 = optante ME/EPP.
 * Decisão do dono (22/11/2026): TODAS as empresas emissoras estão no Simples Nacional — o código vem do contador, mas a
 * DPS é recusada se não for coerente com o regime do perfil tributário (`tax_profiles.regime`).
 */
export const OP_SIMPLES = { naoOptante: "1", mei: "2", meEpp: "3" } as const;

/**
 * Calculadora pública da Receita (beta, sem chave) — PESQUISA §5: `GET /calculadora/dados-abertos/classificacoes-tributarias/
 * cbs-ibs/{siglaDfe}/{cClassTrib}` devolve `ind_gIBSCBS` (decide se gIBSCBS/cIndOp entram). Só consulta OPCIONAL com cache,
 * nunca dependência para emitir. AINDA NÃO USADA no código.
 */
export const CALCULADORA_RECEITA_BASE = "https://consumo.tributos.gov.br/servico/calcular-tributos-consumo/api";

/**
 * cAtvSN — código da atividade do Simples (Anexo VIII v01.02.00; regra 449 do Anexo VI): obrigatório para optante.
 * 7 = Anexo III; 9 = sujeito ao Fator R (Anexo III ou V); 12 = construção 7.02/7.05 no Anexo III; 13 = construção
 * 7.02/7.05 no Anexo IV. "IMP" (atividade impeditiva) não é aceito. Mesma lista no CHECK de fiscal_tipos_servico (0162).
 */
export const CODIGOS_ATIVIDADE_SIMPLES = ["7", "9", "12", "13"] as const;
export type CodigoAtividadeSimples = (typeof CODIGOS_ATIVIDADE_SIMPLES)[number];

export const PARAMETROS_VAZIOS: ParametrosContador = {
  opSimpNac: null, regApTribSN: null, regEspTrib: null, tribIssqn: null, tpRetIssqn: null, indTotTrib: null,
  ibscbs: { indFinal: null, cIndOp: null, indDest: null, cst: null, cClassTrib: null },
};

export type EntradaDps = {
  ambiente: string;
  emitidoEm: Date;
  /** dCompet (AAAA-MM-DD): data do evento financeiro da nota. */
  competencia: string;
  serie: string | null;
  numero: number | null;
  prestador: { cnpj: string; inscricaoMunicipal: string | null; municipioIbge: string | null };
  tomador: { documento: string | null; nome: string | null } | null;
  servico: {
    municipioIncidenciaIbge: string | null;
    codigoTributacaoNacional: string | null;
    codigoNbs: string | null;
    /** Item da LC 116 (ex.: "7.02"): 7.02 e 7.05 exigem o grupo "obra" (ISS no local da obra). */
    itemLc116?: string | null;
    /** cAtvSN do tipo de serviço (obrigatório para emissor do Simples). */
    codigoAtividadeSimples?: string | null;
    descricao: string;
    /** CNO da obra, quando construção civil e o leiaute exigir [a confirmar]. */
    cno: string | null;
  };
  valorCentavos: number;
  /**
   * Reembolso/repasse de despesa embutido no valor (ex.: cartório repassado). AINDA NÃO TRATADO: produção usa
   * `vCalcReeRepRes` (dedução tipo 04) e a NT 009 (produção restrita) usa `vCalcAjusteBCIBSCBS` com tipos 103/104/199
   * (ou 99 autorizado pelo município, só no ISS). Enquanto não for tratado por variante, a DPS com reembolso é recusada.
   */
  reembolsoCentavos?: number | null;
  /** Regime do perfil tributário do emissor (`tax_profiles.regime`: simples_nacional, lucro_presumido…). */
  regimeTributario: string | null;
  /** Alíquota do ISS do tipo de serviço (cadastrada pelo contador), em texto. */
  aliquotaIss: string | null;
  parametros: ParametrosContador;
};
