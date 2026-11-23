// EPIC-029 S-8 (22/11/2026) — alíquota do Simples da NOTA: RBT12 da empresa (raiz do CNPJ: matriz + filiais) na competência
// da nota, Fator R com a folha informada pelo admin e o anexo do tipo de serviço. A conta é pura (shared/fiscal/simples.ts);
// aqui só se LÊ o banco. Nada sai do sistema e nenhum dado pessoal é devolvido (só valores da empresa).
//
// Receita: `receitaDoPeriodo(raiz, de, ate)` é a interface. A implementação daqui é MÍNIMA e provisória:
//   (a) notas fiscais EMITIDAS de emissores da mesma raiz, pela data do evento (competência);
//   (b) receitas pagas do BPO lançadas em contas bancárias da empresa — só quando o banco tiver a conta por empresa
//       (`bank_accounts.empresa_cnpj`, migração 0164 da S-6). Sem a coluna, o BPO não entra e o resultado sai INCOMPLETO.
//   Um lançamento do BPO que já está numa nota emitida não é somado duas vezes.
// A S-6 (server/fiscal/teto.ts, apuração de receitas por empresa, com transferências entre contas) SUBSTITUI esta
// implementação quando chegar à main: basta trocar `fonteReceitaMinima` por uma FonteReceita que use a apuração dela.
import { sql } from "drizzle-orm";
import { fiscalNotas } from "../../drizzle/schema-fiscal.js";
import {
  ErroSimples, aliquotaTextoParaDps, calcularSimples, fatorR, mesAntes, mesesDeAtividadeAntes, percentualDps, rbt12Proporcional, sublimiteDoIss,
  ultimoDiaDoMes, type CalculoSimples, type FatorR, type RegraRbt12, type Sublimite,
} from "../../shared/fiscal/simples.js";
import type { AliquotaSimplesDps } from "../../shared/fiscal/dps-campos.js";
import type { DrizzleDb } from "../db.js";
import { cnpjLimpo, detalhar, type NotaDetalhada } from "./notas.js";

type Linha = Record<string, unknown>;
type Conexao = Pick<DrizzleDb, "execute">;
const linhas = (r: unknown): Linha[] => (r as { rows?: Linha[] }).rows ?? [];
const centavos = (v: unknown) => Math.round(Number(v ?? 0) * 100);

/** Raiz do CNPJ (8 primeiros caracteres; aceita o alfanumérico). */
export function raizDoCnpj(cnpj: string | null | undefined): string {
  return cnpjLimpo(cnpj).slice(0, 8);
}

export type ReceitaApurada = {
  centavos: number;
  /** Parte de cada fonte (centavos). `bpo` null = fonte indisponível neste banco. */
  fontes: { notasEmitidas: number; bpo: number | null };
  /** false = alguma fonte não pôde ser lida (o RBT12 pode estar subestimado). */
  completo: boolean;
  avisos: string[];
};

/** Interface da receita bruta da empresa num período (datas AAAA-MM-DD, inclusive, em Brasília). */
export interface FonteReceita {
  receitaDoPeriodo(raiz: string, de: string, ate: string): Promise<ReceitaApurada>;
}

export const AVISO_BPO_SEM_CONTA_POR_EMPRESA =
  "As receitas do BPO ainda não entram: o banco não tem a conta bancária por empresa (S-6). O RBT12 soma só as notas emitidas e pode estar abaixo do real — confira com o extrato do PGDAS-D.";

/** "AAAA-MM-DD" à meia-noite de Brasília, como instante UTC sem fuso (as colunas são `timestamp` gravadas em UTC). */
function meiaNoiteBrasilia(dia: string): string {
  return `${dia} 03:00:00`;
}
function diaSeguinte(dia: string): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function temColuna(db: Conexao, tabela: string, coluna: string): Promise<boolean> {
  const [r] = linhas(await db.execute(sql`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = ${tabela} AND column_name = ${coluna}) AS existe`));
  return Boolean(r?.existe);
}

/** Implementação mínima (ver o cabeçalho). A S-6 substitui. */
export function fonteReceitaMinima(db: DrizzleDb): FonteReceita {
  return {
    async receitaDoPeriodo(raiz, de, ate) {
      // (a) Notas EMITIDAS da mesma raiz, pela data do evento. O valor é o da nota (ajustado ou o da origem — `detalhar`).
      const emitidas = await db.select().from(fiscalNotas).where(sql`${fiscalNotas.status} = 'EMITIDA'
        AND ${fiscalNotas.dataEvento} >= ${de}::date AND ${fiscalNotas.dataEvento} <= ${ate}::date
        AND ${fiscalNotas.emissorId} IN (SELECT id FROM fiscal_emissores WHERE left(cnpj, 8) = ${raiz})`);
      const detalhadas = await detalhar(db, emitidas);
      const notasEmitidas = detalhadas.reduce((a, n) => a + n.valorCentavos, 0);
      const jaNaNota = Array.from(new Set(detalhadas.map(n => n.origem?.bpoLancamentoId).filter((x): x is number => x != null)));

      // (b) BPO nas contas da empresa — só com a conta por empresa (S-6, 0164). QA S-8 (M1): só receita de verdade
      //     (honorário e receita); reembolso de despesa do cliente não é receita bruta (LC 123, art. 3º §1º).
      if (!(await temColuna(db, "bank_accounts", "empresa_cnpj"))) {
        return { centavos: notasEmitidas, fontes: { notasEmitidas, bpo: null }, completo: false, avisos: [AVISO_BPO_SEM_CONTA_POR_EMPRESA] };
      }
      const fora = jaNaNota.length ? sql`AND l.id NOT IN (${sql.join(jaNaNota.map(i => sql`${i}`), sql`, `)})` : sql``;
      const [r] = linhas(await db.execute(sql`
        SELECT coalesce(sum(l.valor), 0) AS total
        FROM bpo_lancamentos l JOIN bank_transactions bt ON bt.id = l.bank_transaction_id JOIN bank_accounts ba ON ba.id = bt.account_id
        WHERE l.tipo IN ('honorario', 'receita') AND l.pago = true AND l.a_classificar = false AND l.combinada_em_id IS NULL AND l.exclusao_lote_backup_id IS NULL
          AND left(upper(regexp_replace(coalesce(ba.empresa_cnpj, ''), '[^0-9A-Za-z]', '', 'g')), 8) = ${raiz}
          AND l.pago_em >= ${meiaNoiteBrasilia(de)}::timestamp AND l.pago_em < ${meiaNoiteBrasilia(diaSeguinte(ate))}::timestamp ${fora}`));
      const bpo = centavos(r?.total);
      return { centavos: notasEmitidas + bpo, fontes: { notasEmitidas, bpo }, completo: true, avisos: [] };
    },
  };
}

export type DadosSimplesEmpresa = { folha12mCentavos: number | null; folhaAte: string | null; inicioAtividade: string | null };
/**
 * QA S-8 (M2): a folha (salários + pró-labore) é dado sensível da empresa — só o admin vê o valor. Os outros veem a situação
 * (válida / a informar / desatualizada) e o anexo resultante; o r também sai (com o RBT12, revelaria a folha).
 */
export function semValorDaFolha<T extends ResultadoSimplesNota>(r: T): T {
  if (!r.aplica) return r;
  return { ...r, folha: { ...r.folha, folha12mCentavos: null, folhaOculta: r.folha.folha12mCentavos != null },
    fatorR: r.fatorR ? { ...r.fatorR, r: null } : null };
}

const SEM_DADOS: DadosSimplesEmpresa = { folha12mCentavos: null, folhaAte: null, inicioAtividade: null };

/** Folha e início de atividade da empresa (0168). Sem a tabela ou sem a linha → tudo "a informar". */
export async function dadosSimplesDaEmpresa(db: Conexao, raiz: string): Promise<DadosSimplesEmpresa> {
  const [existe] = linhas(await db.execute(sql`SELECT to_regclass('fiscal_dados_simples') IS NOT NULL AS ok`));
  if (!existe?.ok) return SEM_DADOS;
  const [r] = linhas(await db.execute(sql`
    SELECT folha_12m_centavos, folha_ate, inicio_atividade::text AS inicio_atividade FROM fiscal_dados_simples WHERE raiz = ${raiz}`));
  if (!r) return SEM_DADOS;
  return {
    folha12mCentavos: r.folha_12m_centavos == null ? null : Number(r.folha_12m_centavos),
    folhaAte: r.folha_ate == null ? null : String(r.folha_ate),
    inicioAtividade: r.inicio_atividade == null ? null : String(r.inicio_atividade).slice(0, 10),
  };
}

/** Mapa raiz → dados (para a tela "Dados fiscais do perfil"). Sem a tabela, vazio. */
export async function dadosSimplesPorRaiz(db: Conexao): Promise<Map<string, DadosSimplesEmpresa>> {
  const mapa = new Map<string, DadosSimplesEmpresa>();
  const [existe] = linhas(await db.execute(sql`SELECT to_regclass('fiscal_dados_simples') IS NOT NULL AS ok`));
  if (!existe?.ok) return mapa;
  for (const r of linhas(await db.execute(sql`
    SELECT raiz, folha_12m_centavos, folha_ate, inicio_atividade::text AS inicio_atividade FROM fiscal_dados_simples`))) {
    mapa.set(String(r.raiz), {
      folha12mCentavos: r.folha_12m_centavos == null ? null : Number(r.folha_12m_centavos),
      folhaAte: r.folha_ate == null ? null : String(r.folha_ate),
      inicioAtividade: r.inicio_atividade == null ? null : String(r.inicio_atividade).slice(0, 10),
    });
  }
  return mapa;
}

export type ResultadoSimplesNota =
  | { aplica: false; motivo: string }
  | {
    aplica: true;
    ok: boolean;
    /** Motivo de não ter calculado (ok = false). */
    erro: string | null;
    competencia: string;
    raiz: string;
    /** Meses somados no RBT12 (AAAA-MM-DD, inclusive). */
    periodo: { de: string; ate: string };
    rbt12: { centavos: number; regra: RegraRbt12; meses: number };
    receita: { completo: boolean; notasEmitidas: number; bpo: number | null };
    /** QA S-8 (M3): sublimite pela receita do ano-calendário (anterior e em curso até o mês anterior). */
    sublimite: (Sublimite & { rbaAnoAnterior: number; rbaAnoAtual: number; completo: boolean }) | null;
    /** QA S-8 (M4): sem a data, a DPS de produção é recusada. */
    inicioAtividadeInformado: boolean;
    folha: DadosSimplesEmpresa & { situacao: "nao_se_aplica" | "a_informar" | "desatualizada" | "valida"; folhaOculta?: boolean };
    fatorR: FatorR | null;
    calculo: CalculoSimples | null;
    /** O que vai em `pAliq` da DPS: a parte do ISS (Simples) ou, na 6ª faixa, a alíquota municipal do tipo. */
    aliquotaDps: string | null;
    avisos: string[];
  };

function somar(a: ReceitaApurada, b: ReceitaApurada): ReceitaApurada {
  return {
    centavos: a.centavos + b.centavos,
    fontes: { notasEmitidas: a.fontes.notasEmitidas + b.fontes.notasEmitidas, bpo: a.fontes.bpo == null || b.fontes.bpo == null ? null : a.fontes.bpo + b.fontes.bpo },
    completo: a.completo && b.completo,
    avisos: Array.from(new Set([...a.avisos, ...b.avisos])),
  };
}

/**
 * Alíquota do Simples de UMA nota. Regime diferente de Simples ("a confirmar", Presumido, Real, desconhecido) → não calcula.
 * Competência = mês da data do evento da nota; RBT12 = os 12 meses anteriores (art. 18, §1º), com a regra proporcional para
 * empresa com menos de 12 meses (precisa do início de atividade).
 */
export async function aliquotaSimplesDaNota(db: DrizzleDb, nota: NotaDetalhada, fonte: FonteReceita = fonteReceitaMinima(db)): Promise<ResultadoSimplesNota> {
  const regime = nota.emissor?.regime ?? null;
  if (!nota.emissor) return { aplica: false, motivo: "empresa emissora ainda não escolhida" };
  if (regime !== "simples_nacional") {
    return { aplica: false, motivo: regime ? `regime "${regime}" do perfil: a alíquota do Simples não se aplica` : "regime tributário desconhecido: não calcula" };
  }
  const raiz = raizDoCnpj(nota.emissor.cnpj);
  const competencia = nota.dataEvento.slice(0, 7);
  const cAtvSN = nota.tipoServico?.codigoAtividadeSimples ?? null;
  const dados = await dadosSimplesDaEmpresa(db, raiz);
  const avisos: string[] = [];
  const atividade = mesesDeAtividadeAntes(dados.inicioAtividade, competencia);
  if (atividade == null) avisos.push("Início de atividade não informado: a empresa foi tratada como tendo 12 meses ou mais de atividade.");

  // RBT12 e a receita-base do Fator R (mesmos meses).
  let rbt: { rbt12: number; regra: RegraRbt12; meses: number };
  let receita: ReceitaApurada;
  let receitaBaseFatorR: number;
  let periodo: { de: string; ate: string };
  if (atividade == null || atividade >= 12) {
    periodo = { de: `${mesAntes(competencia, 12)}-01`, ate: ultimoDiaDoMes(mesAntes(competencia, 1)) };
    receita = await fonte.receitaDoPeriodo(raiz, periodo.de, periodo.ate);
    rbt = { rbt12: receita.centavos, regra: "doze_meses", meses: 12 };
    receitaBaseFatorR = rbt.rbt12;
  } else {
    // Menos de 12 meses: receita de cada mês de atividade antes da competência (+ o próprio mês no 1º mês).
    const meses: number[] = [];
    receita = { centavos: 0, fontes: { notasEmitidas: 0, bpo: 0 }, completo: true, avisos: [] };
    for (let k = atividade; k >= 1; k--) {
      const mes = mesAntes(competencia, k);
      const r = await fonte.receitaDoPeriodo(raiz, `${mes}-01`, ultimoDiaDoMes(mes));
      meses.push(r.centavos);
      receita = somar(receita, r);
    }
    let doMes = 0;
    if (atividade === 0) {
      // 1º mês: receita do próprio mês (até agora) + esta nota, se ainda não emitida — provisório até o mês fechar.
      const r = await fonte.receitaDoPeriodo(raiz, `${competencia}-01`, ultimoDiaDoMes(competencia));
      doMes = r.centavos + (nota.status === "EMITIDA" ? 0 : nota.valorCentavos);
      receita = somar(receita, r);
      avisos.push("1º mês de atividade: RBT12 = receita do próprio mês × 12 (provisório até o mês fechar).");
      periodo = { de: `${competencia}-01`, ate: ultimoDiaDoMes(competencia) };
    } else {
      periodo = { de: `${mesAntes(competencia, atividade)}-01`, ate: ultimoDiaDoMes(mesAntes(competencia, 1)) };
      avisos.push(`Empresa com ${atividade} ${atividade === 1 ? "mês" : "meses"} de atividade: RBT12 = média dos meses anteriores × 12.`);
    }
    rbt = rbt12Proporcional(meses, doMes);
    receitaBaseFatorR = meses.reduce((a, b) => a + b, 0);
  }
  avisos.push(...receita.avisos);

  // QA S-8 (M3): sublimite pela receita do ANO-CALENDÁRIO (anterior inteiro; em curso, de janeiro ao mês anterior).
  const ano = Number(competencia.slice(0, 4));
  const anterior = await fonte.receitaDoPeriodo(raiz, `${ano - 1}-01-01`, `${ano - 1}-12-31`);
  const mesNum = Number(competencia.slice(5, 7));
  const atual = mesNum > 1
    ? await fonte.receitaDoPeriodo(raiz, `${ano}-01-01`, ultimoDiaDoMes(mesAntes(competencia, 1)))
    : { centavos: 0, fontes: { notasEmitidas: 0, bpo: 0 }, completo: true, avisos: [] };
  const sub = sublimiteDoIss({ competencia, rbaAnoAnterior: anterior.centavos, rbaAnoAtualAteMesAnterior: atual.centavos, inicioAtividade: dados.inicioAtividade });
  const sublimite = { ...sub, rbaAnoAnterior: anterior.centavos, rbaAnoAtual: atual.centavos, completo: anterior.completo && atual.completo };
  if (sub.aviso) avisos.push(sub.aviso);

  // Fator R (só para o cAtvSN 9). A folha vale para a competência seguinte ao último mês que ela inclui.
  let situacao: "nao_se_aplica" | "a_informar" | "desatualizada" | "valida" = "nao_se_aplica";
  let r: FatorR | null = null;
  if (cAtvSN === "9") {
    const esperado = mesAntes(competencia, 1);
    if (dados.folha12mCentavos == null || dados.folhaAte == null) {
      situacao = "a_informar";
      r = fatorR(null, receitaBaseFatorR);
    } else if (dados.folhaAte !== esperado) {
      situacao = "desatualizada";
      r = { r: null, atinge: null, motivo: `folha informada até ${dados.folhaAte}; para esta nota precisa ir até ${esperado}` };
    } else if (atividade === 0) {
      situacao = "a_informar";
      r = { r: null, atinge: null, motivo: "1º mês de atividade: sem meses anteriores para o fator r" };
    } else {
      situacao = "valida";
      r = fatorR(dados.folha12mCentavos, receitaBaseFatorR);
      // QA S-8 (baixo): receita incompleta deixa o r ACIMA do real (denominador menor). Se daria Anexo III, usa o V.
      if (r.atinge && !receita.completo) {
        r = { r: r.r, atinge: null, motivo: "receita dos 12 meses incompleta: o fator r pode estar acima do real — usado o Anexo V até a receita fechar" };
      }
    }
  }

  const base = {
    aplica: true as const, competencia, raiz, periodo,
    rbt12: { centavos: rbt.rbt12, regra: rbt.regra, meses: rbt.meses },
    receita: { completo: receita.completo, notasEmitidas: receita.fontes.notasEmitidas, bpo: receita.fontes.bpo },
    sublimite, inicioAtividadeInformado: dados.inicioAtividade != null,
    folha: { ...dados, situacao }, fatorR: r,
  };
  try {
    const calculo = calcularSimples({ competencia, cAtvSN, rbt12: rbt.rbt12, fatorR: r, issForaDoDas: !sub.issNoDas });
    let aliquotaDps: string | null;
    if (calculo.iss != null) {
      aliquotaDps = percentualDps(calculo.iss);
      if (calculo.faixa === 6) avisos.push("RBT12 na 6ª faixa sem excesso de sublimite no ano: o ISS continua no DAS pela fórmula da 5ª faixa, com teto de 5% (conferir com o contador).");
    } else {
      aliquotaDps = aliquotaTextoParaDps(nota.tipoServico?.aliquotaIss);
      avisos.push(`Sublimite: ${sub.motivo}. A nota leva a alíquota municipal do tipo de serviço.`);
    }
    if (calculo.anexo.fatorR === "a_informar") avisos.push("Folha dos 12 meses a informar: usado o Anexo V (o lado de pagar mais).");
    if (calculo.anexo.anexo === "IV") avisos.push("Anexo IV: a CPP (INSS patronal) fica fora do DAS e é paga à parte sobre a folha.");
    return { ...base, ok: true, erro: null, calculo, aliquotaDps, avisos };
  } catch (e) {
    if (!(e instanceof ErroSimples)) throw e;
    return { ...base, ok: false, erro: e.message, calculo: null, aliquotaDps: null, avisos };
  }
}

/** O que a DPS precisa do cálculo (pAliq e a falta, se não calculou). null = regime fora do Simples. */
export function paraDps(r: ResultadoSimplesNota): AliquotaSimplesDps | null {
  if (!r.aplica) return null;
  const receitaCompleta = r.receita.completo && (r.sublimite?.completo ?? true);
  const inicioAtividadeInformado = r.inicioAtividadeInformado;
  if (!r.ok) return { aliquotaIss: null, falta: `alíquota do Simples: ${r.erro}`, receitaCompleta, inicioAtividadeInformado };
  return {
    aliquotaIss: r.aliquotaDps,
    falta: r.aliquotaDps ? null : "alíquota municipal do ISS no tipo de serviço (sublimite do Simples ultrapassado: ISS fora do DAS)",
    receitaCompleta,
    inicioAtividadeInformado,
  };
}
