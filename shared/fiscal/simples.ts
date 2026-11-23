// EPIC-029 S-8 (22/11/2026) — alíquota do Simples Nacional calculada pelo sistema (decisão do dono de 22/11, noite, item 3:
// "RBT12 dos 12 meses anteriores × anexo de cada tipo de serviço, LC 123, e não um número fixo").
// Módulo PURO: sem banco, sem rede, sem relógio. Fonte das tabelas: ALIQUOTAS.md §3 (LC 123/2006, Anexos III, IV e V, redação
// da LC 155/2016, em vigor desde 01/01/2018; conferidas em várias fontes secundárias que concordam e cada linha de repartição
// soma 100,00% — o texto do Planalto não abriu na sessão da pesquisa).
//
// Unidades (para a conta ser EXATA, em inteiros):
// - alíquotas e percentuais de repartição em "u" = 0,0001 ponto percentual (1% = 10.000 u; 100% = 1.000.000 u);
// - dinheiro em centavos.
// Arredondamento (documentado na story S-8): as frações são exatas (BigInt); só o resultado final é arredondado para 4 casas
// percentuais (1 u), meio para cima. A parte de cada tributo sai da alíquota efetiva EXATA (não da arredondada).

export type Anexo = "III" | "IV" | "V";
export type Tributo = "irpj" | "csll" | "cofins" | "pis" | "cpp" | "iss";
export const TRIBUTOS: readonly Tributo[] = ["irpj", "csll", "cofins", "pis", "cpp", "iss"];
export const ROTULO_TRIBUTO: Record<Tributo, string> = { irpj: "IRPJ", csll: "CSLL", cofins: "Cofins", pis: "PIS/Pasep", cpp: "CPP", iss: "ISS" };

/** 1 ponto percentual em u. */
export const U_POR_PONTO = 10_000;
/** 100% em u. */
export const U_TOTAL = 1_000_000;
const p = (pontos: number) => Math.round(pontos * U_POR_PONTO);
const reais = (v: number) => Math.round(v * 100);

export type Faixa = {
  /** Limite superior da faixa (inclusive), em centavos de RBT12. */
  ate: number;
  /** Alíquota nominal (u). */
  nominal: number;
  /** Parcela a deduzir (centavos). */
  deduzir: number;
  /** Repartição dos tributos na faixa (u, soma 100%). Sem `iss` = ISS fora do DAS (6ª faixa: sublimite, art. 13-A e 19). */
  reparticao: Partial<Record<Tributo, number>>;
  /**
   * Teto do ISS (5ª faixa dos Anexos III e IV): ISS efetivo máximo de 5%; o excedente (efetiva − 5%) vai aos tributos
   * federais da mesma faixa pelos percentuais da lei (soma 100%).
   */
  teto?: { issMaximo: number; excedente: Partial<Record<Tributo, number>> };
};

export type TabelaSimples = {
  id: string;
  /** AAAA-MM-DD, inclusive. */
  vigenteDe: string;
  /** AAAA-MM-DD, inclusive (null = sem fim conhecido). */
  vigenteAte: string | null;
  fonte: string;
  /** null = período conhecido, mas os números ainda não foram lidos em fonte oficial (lacuna, nunca inventar). */
  anexos: Record<Anexo, Faixa[]> | null;
  lacuna?: string;
};

const ANEXO_III: Faixa[] = [
  { ate: reais(180_000), nominal: p(6), deduzir: 0, reparticao: { irpj: p(4), csll: p(3.5), cofins: p(12.82), pis: p(2.78), cpp: p(43.4), iss: p(33.5) } },
  { ate: reais(360_000), nominal: p(11.2), deduzir: reais(9_360), reparticao: { irpj: p(4), csll: p(3.5), cofins: p(14.05), pis: p(3.05), cpp: p(43.4), iss: p(32) } },
  { ate: reais(720_000), nominal: p(13.5), deduzir: reais(17_640), reparticao: { irpj: p(4), csll: p(3.5), cofins: p(13.64), pis: p(2.96), cpp: p(43.4), iss: p(32.5) } },
  { ate: reais(1_800_000), nominal: p(16), deduzir: reais(35_640), reparticao: { irpj: p(4), csll: p(3.5), cofins: p(13.64), pis: p(2.96), cpp: p(43.4), iss: p(32.5) } },
  { ate: reais(3_600_000), nominal: p(21), deduzir: reais(125_640), reparticao: { irpj: p(4), csll: p(3.5), cofins: p(12.82), pis: p(2.78), cpp: p(43.4), iss: p(33.5) },
    teto: { issMaximo: p(5), excedente: { irpj: p(6.02), csll: p(5.26), cofins: p(19.28), pis: p(4.18), cpp: p(65.26) } } },
  { ate: reais(4_800_000), nominal: p(33), deduzir: reais(648_000), reparticao: { irpj: p(35), csll: p(15), cofins: p(16.03), pis: p(3.47), cpp: p(30.5) } },
];

/** Anexo IV (construção, §5º-C): a CPP fica FORA do DAS (20% + RAT sobre a folha, paga à parte) — não é custo total. */
const ANEXO_IV: Faixa[] = [
  { ate: reais(180_000), nominal: p(4.5), deduzir: 0, reparticao: { irpj: p(18.8), csll: p(15.2), cofins: p(17.67), pis: p(3.83), iss: p(44.5) } },
  { ate: reais(360_000), nominal: p(9), deduzir: reais(8_100), reparticao: { irpj: p(19.8), csll: p(15.2), cofins: p(20.55), pis: p(4.45), iss: p(40) } },
  { ate: reais(720_000), nominal: p(10.2), deduzir: reais(12_420), reparticao: { irpj: p(20.8), csll: p(15.2), cofins: p(19.73), pis: p(4.27), iss: p(40) } },
  { ate: reais(1_800_000), nominal: p(14), deduzir: reais(39_780), reparticao: { irpj: p(17.8), csll: p(19.2), cofins: p(18.9), pis: p(4.1), iss: p(40) } },
  { ate: reais(3_600_000), nominal: p(22), deduzir: reais(183_780), reparticao: { irpj: p(18.8), csll: p(19.2), cofins: p(18.08), pis: p(3.92), iss: p(40) },
    teto: { issMaximo: p(5), excedente: { irpj: p(31.33), csll: p(32), cofins: p(30.13), pis: p(6.54) } } },
  { ate: reais(4_800_000), nominal: p(33), deduzir: reais(828_000), reparticao: { irpj: p(53.5), csll: p(21.5), cofins: p(20.55), pis: p(4.45) } },
];

/** Anexo V (§5º-I, quando r < 28%). Sem teto: a maior efetiva da 5ª faixa (21,275%) × 23,5% = 4,9996% < 5%. */
const ANEXO_V: Faixa[] = [
  { ate: reais(180_000), nominal: p(15.5), deduzir: 0, reparticao: { irpj: p(25), csll: p(15), cofins: p(14.1), pis: p(3.05), cpp: p(28.85), iss: p(14) } },
  { ate: reais(360_000), nominal: p(18), deduzir: reais(4_500), reparticao: { irpj: p(23), csll: p(15), cofins: p(14.1), pis: p(3.05), cpp: p(27.85), iss: p(17) } },
  { ate: reais(720_000), nominal: p(19.5), deduzir: reais(9_900), reparticao: { irpj: p(24), csll: p(15), cofins: p(14.92), pis: p(3.23), cpp: p(23.85), iss: p(19) } },
  { ate: reais(1_800_000), nominal: p(20.5), deduzir: reais(17_100), reparticao: { irpj: p(21), csll: p(15), cofins: p(15.74), pis: p(3.41), cpp: p(23.85), iss: p(21) } },
  { ate: reais(3_600_000), nominal: p(23), deduzir: reais(62_100), reparticao: { irpj: p(23), csll: p(12.5), cofins: p(14.1), pis: p(3.05), cpp: p(23.85), iss: p(23.5) } },
  { ate: reais(4_800_000), nominal: p(30.5), deduzir: reais(540_000), reparticao: { irpj: p(35), csll: p(15.5), cofins: p(16.44), pis: p(3.56), cpp: p(29.5) } },
];

/**
 * Tabelas por período de vigência (ALIQUOTAS.md §3, "o sistema deve guardar as tabelas por período de vigência").
 * 2027 em diante: a LC 214/2025 reescreve a REPARTIÇÃO (PIS/Cofins saem; entram CBS e IBS). Os números não foram lidos em
 * fonte oficial — ficam como lacuna (anexos: null) até a próxima pesquisa. Nada é inventado.
 */
export const TABELAS_SIMPLES: readonly TabelaSimples[] = [
  {
    id: "lc123-lc155-2018",
    vigenteDe: "2018-01-01",
    vigenteAte: "2026-12-31",
    fonte: "LC 123/2006, Anexos III, IV e V (redação da LC 155/2016) — ALIQUOTAS.md §3",
    anexos: { III: ANEXO_III, IV: ANEXO_IV, V: ANEXO_V },
  },
  {
    id: "lc214-2027-2028",
    vigenteDe: "2027-01-01",
    vigenteAte: "2028-12-31",
    fonte: "LC 214/2025 (anexos com CBS e IBS) — a pesquisar",
    anexos: null,
    lacuna: "a tabela do Simples de 2027–2028 (LC 214/2025) ainda não foi cadastrada: os números precisam ser lidos no texto oficial",
  },
  {
    id: "lc214-2029-2032",
    vigenteDe: "2029-01-01",
    vigenteAte: "2032-12-31",
    fonte: "LC 214/2025 — a pesquisar",
    anexos: null,
    lacuna: "a tabela do Simples de 2029–2032 (LC 214/2025) ainda não foi cadastrada",
  },
  {
    id: "lc214-2033",
    vigenteDe: "2033-01-01",
    vigenteAte: null,
    fonte: "LC 214/2025 — a pesquisar",
    anexos: null,
    lacuna: "a tabela do Simples de 2033 em diante (LC 214/2025) ainda não foi cadastrada",
  },
];

export class ErroSimples extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErroSimples";
  }
}

/** Tabela do período que contém a competência ("AAAA-MM" ou "AAAA-MM-DD"). null = data fora de qualquer período. */
export function tabelaDoPeriodo(competencia: string): TabelaSimples | null {
  const dia = /^\d{4}-\d{2}$/.test(competencia) ? `${competencia}-01` : competencia.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  return TABELAS_SIMPLES.find(t => dia >= t.vigenteDe && (t.vigenteAte == null || dia <= t.vigenteAte)) ?? null;
}

/** A tabela em vigor hoje no código (a única com números): LC 123/LC 155. */
export const TABELA_LC155 = TABELAS_SIMPLES[0]!;

function faixasDo(anexo: Anexo, tabela: TabelaSimples): Faixa[] {
  if (!tabela.anexos) throw new ErroSimples(tabela.lacuna ?? `a tabela ${tabela.id} ainda não foi cadastrada`);
  return tabela.anexos[anexo];
}

function conferirRbt12(rbt12: number) {
  if (!Number.isSafeInteger(rbt12) || rbt12 < 0) throw new ErroSimples("RBT12 inválido (centavos inteiros, zero ou mais)");
}

/** Faixa (1 a 6) do RBT12. Acima de R$ 4,8 milhões: fora do limite do Simples (erro — o contador decide). */
export function faixaDoRbt12(rbt12: number, anexo: Anexo, tabela: TabelaSimples = TABELA_LC155): { numero: number; faixa: Faixa } {
  conferirRbt12(rbt12);
  const faixas = faixasDo(anexo, tabela);
  const i = faixas.findIndex(f => rbt12 <= f.ate);
  if (i < 0) throw new ErroSimples("RBT12 acima de R$ 4.800.000,00: fora do limite do Simples Nacional (LC 123, art. 3º) — falar com o contador");
  return { numero: i + 1, faixa: faixas[i]! };
}

/** Fração exata num/den (BigInt), não negativa. */
type Fracao = { num: bigint; den: bigint };
/** Arredonda a fração para o inteiro mais próximo, meio para cima (só para valores ≥ 0). */
function arredondar(f: Fracao): number {
  if (f.num < BigInt(0)) throw new ErroSimples("conta negativa no Simples (tabela inconsistente)");
  return Number((BigInt(2) * f.num + f.den) / (BigInt(2) * f.den));
}

/** Efetiva exata em u: (RBT12 × nominal − deduzir) ÷ RBT12. RBT12 = 0 → nominal da 1ª faixa (sem receita, não há dedução). */
function efetivaExata(rbt12: number, faixa: Faixa): Fracao {
  if (rbt12 === 0) return { num: BigInt(faixa.nominal), den: BigInt(1) };
  const r = BigInt(rbt12);
  return { num: r * BigInt(faixa.nominal) - BigInt(faixa.deduzir) * BigInt(U_TOTAL), den: r };
}

export type Efetiva = {
  faixa: number;
  nominal: number;
  deduzirCentavos: number;
  /** Alíquota efetiva em u (4 casas percentuais, meio para cima). */
  efetiva: number;
};

/** Alíquota efetiva do Simples (LC 123, art. 18, §1º-A). */
export function aliquotaEfetiva(rbt12: number, anexo: Anexo, tabela: TabelaSimples = TABELA_LC155): Efetiva {
  const { numero, faixa } = faixaDoRbt12(rbt12, anexo, tabela);
  return { faixa: numero, nominal: faixa.nominal, deduzirCentavos: faixa.deduzir, efetiva: arredondar(efetivaExata(rbt12, faixa)) };
}

export type Reparticao = {
  /** Parte de cada tributo em u (arredondada; a soma pode diferir da efetiva em 1 u por arredondamento). */
  partes: Partial<Record<Tributo, number>>;
  /** false = ISS fora do DAS (6ª faixa — pago ao município pela alíquota municipal). */
  issDentroDoDas: boolean;
  /** true = o ISS bateu no teto de 5% e o excedente foi para os federais. */
  tetoAplicado: boolean;
};

/** Repartição da efetiva entre os tributos (§1º-B), com o teto do ISS na 5ª faixa. */
export function reparticao(rbt12: number, anexo: Anexo, tabela: TabelaSimples = TABELA_LC155): Reparticao {
  const { faixa } = faixaDoRbt12(rbt12, anexo, tabela);
  const ef = efetivaExata(rbt12, faixa);
  const vezes = (pct: number): Fracao => ({ num: ef.num * BigInt(pct), den: ef.den * BigInt(U_TOTAL) });
  const issDentroDoDas = faixa.reparticao.iss != null;
  const partes: Partial<Record<Tributo, number>> = {};
  // Teto: efetiva × %ISS > 5%  ⇔  ef.num × %ISS > 5% × ef.den × 100%.
  const passou = faixa.teto && issDentroDoDas
    && ef.num * BigInt(faixa.reparticao.iss!) > BigInt(faixa.teto.issMaximo) * ef.den * BigInt(U_TOTAL);
  if (passou && faixa.teto) {
    partes.iss = faixa.teto.issMaximo;
    // Excedente exato = efetiva − 5% = (ef.num − 5% × ef.den) / ef.den.
    const exc = { num: ef.num - BigInt(faixa.teto.issMaximo) * ef.den, den: ef.den };
    for (const t of TRIBUTOS) {
      const pct = faixa.teto.excedente[t];
      if (pct != null) partes[t] = arredondar({ num: exc.num * BigInt(pct), den: exc.den * BigInt(U_TOTAL) });
    }
    return { partes, issDentroDoDas, tetoAplicado: true };
  }
  for (const t of TRIBUTOS) {
    const pct = faixa.reparticao[t];
    if (pct != null) partes[t] = arredondar(vezes(pct));
  }
  return { partes, issDentroDoDas, tetoAplicado: false };
}

/** Parte do ISS dentro do DAS (u), com o teto de 5% na 5ª faixa. null = ISS fora do DAS (6ª faixa). */
export function parteDoIss(rbt12: number, anexo: Anexo, tabela: TabelaSimples = TABELA_LC155): { iss: number | null; tetoAplicado: boolean } {
  const r = reparticao(rbt12, anexo, tabela);
  return { iss: r.issDentroDoDas ? r.partes.iss ?? null : null, tetoAplicado: r.tetoAplicado };
}

export type RegraRbt12 = "doze_meses" | "primeiro_mes" | "media_dos_meses";
/**
 * RBT12 com menos de 12 meses de atividade (LC 123, art. 18, §2º; Res. CGSN 140/2018, art. 22 — [NÃO CONFIRMADO no texto
 * oficial nesta sessão]):
 * - 12 meses ou mais antes da competência → soma dos 12 meses anteriores;
 * - 1º mês de atividade (nenhum mês anterior) → receita do próprio mês × 12;
 * - do 2º ao 12º mês → média aritmética dos meses anteriores × 12 (arredondada ao centavo, meio para cima).
 * `mesesAnteriores`: receita (centavos) de CADA mês de atividade antes da competência, do mais antigo ao mais recente
 * (no máximo os 12 últimos contam).
 */
export function rbt12Proporcional(mesesAnteriores: readonly number[], receitaDoMes: number): { rbt12: number; regra: RegraRbt12; meses: number } {
  for (const v of [...mesesAnteriores, receitaDoMes]) conferirRbt12(v);
  if (mesesAnteriores.length >= 12) {
    return { rbt12: mesesAnteriores.slice(-12).reduce((a, b) => a + b, 0), regra: "doze_meses", meses: 12 };
  }
  if (mesesAnteriores.length === 0) return { rbt12: receitaDoMes * 12, regra: "primeiro_mes", meses: 0 };
  const soma = mesesAnteriores.reduce((a, b) => a + b, 0);
  return { rbt12: arredondar({ num: BigInt(soma) * BigInt(12), den: BigInt(mesesAnteriores.length) }), regra: "media_dos_meses", meses: mesesAnteriores.length };
}

/** Fator r mínimo para o Anexo III (§5º-J e §5º-M): 28%. */
export const FATOR_R_MINIMO = p(28);

export type FatorR = { r: number | null; atinge: boolean | null; motivo: string };
/**
 * Fator r = folha dos 12 meses ÷ receita bruta do mesmo período (§5º-J, §24: salários + pró-labore + FGTS + CPP).
 * `folha` null → "a informar". Receita 0 → não calculável. r em u (arredondado); a comparação com 28% é EXATA.
 */
export function fatorR(folha: number | null, receita: number): FatorR {
  if (folha == null) return { r: null, atinge: null, motivo: "folha dos 12 meses a informar" };
  conferirRbt12(folha);
  conferirRbt12(receita);
  if (receita === 0) return { r: null, atinge: null, motivo: "sem receita no período: o fator r não se calcula" };
  const atinge = BigInt(folha) * BigInt(U_TOTAL) >= BigInt(FATOR_R_MINIMO) * BigInt(receita);
  const r = arredondar({ num: BigInt(folha) * BigInt(U_TOTAL), den: BigInt(receita) });
  return { r, atinge, motivo: atinge ? "r ≥ 28%" : "r < 28%" };
}

export type AnexoEscolhido = {
  anexo: Anexo;
  /** "nao_se_aplica" = atividade sem Fator R; "a_informar" = Fator R sem dado → Anexo V (lado de pagar mais). */
  fatorR: "nao_se_aplica" | "anexo_iii" | "anexo_v" | "a_informar";
  motivo: string;
};

/**
 * Anexo do serviço pelo cAtvSN (Anexo VIII da NFS-e v01.02.00, ALIQUOTAS.md §4): 7 e 8 → III; 12 → III (construção no III);
 * 13 e 14 → IV; 9 → Fator R (III se r ≥ 28%, senão V). Fator R sem dado → Anexo V: o lado de pagar mais — o sistema nunca
 * subestima o imposto em silêncio. Outro código (ou "IMP", impeditiva) → erro.
 */
export function anexoDoServico(cAtvSN: string | null | undefined, r: FatorR | null): AnexoEscolhido {
  switch ((cAtvSN ?? "").trim()) {
    case "7": return { anexo: "III", fatorR: "nao_se_aplica", motivo: "cAtvSN 7: atividade do Anexo III" };
    case "8": return { anexo: "III", fatorR: "nao_se_aplica", motivo: "cAtvSN 8: contábil, Anexo III" };
    case "12": return { anexo: "III", fatorR: "nao_se_aplica", motivo: "cAtvSN 12: construção (7.02/7.05) no Anexo III" };
    case "13": return { anexo: "IV", fatorR: "nao_se_aplica", motivo: "cAtvSN 13: construção (7.02/7.05) no Anexo IV — CPP fora do DAS" };
    case "14": return { anexo: "IV", fatorR: "nao_se_aplica", motivo: "cAtvSN 14: serviço do Anexo IV — CPP fora do DAS" };
    case "9": {
      if (!r || r.atinge == null) {
        return { anexo: "V", fatorR: "a_informar", motivo: `cAtvSN 9 (Fator R): ${r?.motivo ?? "folha dos 12 meses a informar"} — usado o Anexo V (o lado de pagar mais) até o admin informar a folha` };
      }
      return r.atinge
        ? { anexo: "III", fatorR: "anexo_iii", motivo: "cAtvSN 9 (Fator R): r ≥ 28% → Anexo III" }
        : { anexo: "V", fatorR: "anexo_v", motivo: "cAtvSN 9 (Fator R): r < 28% → Anexo V" };
    }
    default:
      throw new ErroSimples("código da atividade do Simples (cAtvSN) do tipo de serviço ausente ou não reconhecido");
  }
}

export type EntradaSimples = {
  /** Competência da nota (AAAA-MM ou AAAA-MM-DD). */
  competencia: string;
  cAtvSN: string | null | undefined;
  rbt12: number;
  /** Fator r já calculado (o servidor sabe a folha e a receita do mesmo período). null = sem folha. */
  fatorR: FatorR | null;
  /**
   * QA S-8 (M3): o ISS sai do DAS pelo SUBLIMITE (receita do ano-calendário — `sublimiteDoIss`), e não pela faixa do RBT12.
   * true = ISS fora do DAS (pago ao município pela alíquota municipal). Ausente/false = ISS no DAS.
   */
  issForaDoDas?: boolean;
};

export type CalculoSimples = {
  tabela: { id: string; vigenteDe: string; vigenteAte: string | null; fonte: string };
  anexo: AnexoEscolhido;
  rbt12: number;
  faixa: number;
  nominal: number;
  deduzirCentavos: number;
  efetiva: number;
  reparticao: Reparticao;
  /** Parte do ISS dentro do DAS (u); null = ISS fora do DAS (6ª faixa → alíquota municipal). */
  iss: number | null;
};

/** Cálculo completo (tabela do período da competência + anexo + faixa + efetiva + repartição). Lança ErroSimples. */
export function calcularSimples(e: EntradaSimples): CalculoSimples {
  const tabela = tabelaDoPeriodo(e.competencia);
  if (!tabela) throw new ErroSimples("competência fora de qualquer tabela do Simples cadastrada");
  if (!tabela.anexos) throw new ErroSimples(tabela.lacuna ?? `a tabela ${tabela.id} ainda não foi cadastrada`);
  const anexo = anexoDoServico(e.cAtvSN, e.fatorR);
  const ef = aliquotaEfetiva(e.rbt12, anexo.anexo, tabela);
  let rep = reparticao(e.rbt12, anexo.anexo, tabela);
  if (e.issForaDoDas) {
    // Sublimite ultrapassado: o ISS sai do DAS em qualquer faixa.
    const { iss: _fora, ...federais } = rep.partes;
    rep = { partes: federais, issDentroDoDas: false, tetoAplicado: false };
  } else if (!rep.issDentroDoDas) {
    // 6ª faixa SEM excesso de sublimite no ano: o ISS continua no DAS, pela fórmula da 5ª faixa, com o teto de 5%.
    const iss = issNaSextaFaixa(e.rbt12, anexo.anexo, tabela);
    rep = { partes: { ...rep.partes, iss: iss.iss }, issDentroDoDas: true, tetoAplicado: iss.tetoAplicado };
  }
  return {
    tabela: { id: tabela.id, vigenteDe: tabela.vigenteDe, vigenteAte: tabela.vigenteAte, fonte: tabela.fonte },
    anexo, rbt12: e.rbt12, faixa: ef.faixa, nominal: ef.nominal, deduzirCentavos: ef.deduzirCentavos, efetiva: ef.efetiva,
    reparticao: rep, iss: rep.issDentroDoDas ? rep.partes.iss ?? null : null,
  };
}

/** Teto do ISS (LC 116, art. 8º, II: alíquota máxima de 5%). */
export const ISS_MAXIMO = p(5);

/**
 * QA S-8 (M3) — ISS de quem está na 6ª faixa do RBT12 mas NÃO ultrapassou o sublimite no ano-calendário: continua no DAS,
 * calculado com a alíquota nominal, a parcela a deduzir e o percentual de ISS da 5ª faixa, limitado a 5% (Res. CGSN 140/2018,
 * art. 25 e Anexo; LC 123, art. 18 §1º-B) — [NÃO CONFIRMADO no texto oficial nesta sessão; conferir com o contador].
 * Os tributos federais seguem a repartição da 6ª faixa sobre a efetiva da 6ª faixa.
 */
export function issNaSextaFaixa(rbt12: number, anexo: Anexo, tabela: TabelaSimples = TABELA_LC155): { iss: number; tetoAplicado: boolean } {
  conferirRbt12(rbt12);
  const quinta = faixasDo(anexo, tabela)[4]!;
  const ef = efetivaExata(rbt12, quinta);
  const pct = BigInt(quinta.reparticao.iss!);
  const maximo = BigInt(quinta.teto?.issMaximo ?? ISS_MAXIMO);
  if (ef.num * pct > maximo * ef.den * BigInt(U_TOTAL)) return { iss: Number(maximo), tetoAplicado: true };
  return { iss: arredondar({ num: ef.num * pct, den: ef.den * BigInt(U_TOTAL) }), tetoAplicado: false };
}

/** Sublimite do ISS e do ICMS no Simples (LC 123, art. 19): R$ 3,6 milhões no ano-calendário. */
export const SUBLIMITE_ANUAL = reais(3_600_000);
/** Limite proporcional por mês de atividade no ano de início (LC 123, art. 3º §2º/§10; R$ 3,6 mi ÷ 12). */
export const SUBLIMITE_MENSAL = reais(300_000);

export type Sublimite = {
  /** false = ISS fora do DAS (pago ao município pela alíquota municipal). */
  issNoDas: boolean;
  motivo: string;
  /** Excesso de até 20% no ano em curso: o efeito é só no ano seguinte (aviso, não muda a nota). */
  aviso: string | null;
  limiteAnoAnterior: number;
  limiteAnoAtual: number;
};

/** Limite do ano (centavos): integral, ou R$ 300 mil × meses entre o início de atividade e dezembro, no ano do início. */
function limiteDoAno(ano: number, inicioAtividade: string | null | undefined): number {
  if (!inicioAtividade || !/^\d{4}-\d{2}/.test(inicioAtividade)) return SUBLIMITE_ANUAL;
  const [ai, mi] = inicioAtividade.slice(0, 7).split("-").map(Number) as [number, number];
  if (ai < ano) return SUBLIMITE_ANUAL;
  if (ai > ano) return 0;
  return SUBLIMITE_MENSAL * (12 - mi + 1);
}

/**
 * QA S-8 (M3) — o ISS sai do DAS pela RECEITA DO ANO-CALENDÁRIO (RBA), não pelo RBT12 (LC 123, arts. 13-A, 19 e 20;
 * Res. CGSN 140/2018, arts. 9º a 13 — [conferir com o contador]). Duas direções:
 * - ano ANTERIOR acima do sublimite → ISS fora do DAS no ano todo da competência (o excesso de até 20% produz efeito a partir
 *   de janeiro; acima de 20% já tinha produzido no mês seguinte ao excesso e continua);
 * - ano EM CURSO (janeiro até o mês anterior à competência) acima do sublimite em MAIS de 20% → ISS fora do DAS a partir do
 *   mês seguinte ao do excesso (logo, na competência); em ATÉ 20% → continua no DAS e o efeito fica para o ano seguinte (aviso).
 * Com RBT12 acima de R$ 3,6 mi mas sem excesso no ano, o ISS continua no DAS (`issNaSextaFaixa`).
 * No ano de início de atividade, o sublimite é proporcional (R$ 300 mil × meses até dezembro). "Ultrapassar" = estritamente maior.
 */
export function sublimiteDoIss(e: { competencia: string; rbaAnoAnterior: number; rbaAnoAtualAteMesAnterior: number; inicioAtividade?: string | null }): Sublimite {
  conferirRbt12(e.rbaAnoAnterior);
  conferirRbt12(e.rbaAnoAtualAteMesAnterior);
  const ano = Number(e.competencia.slice(0, 4));
  const limiteAnoAnterior = limiteDoAno(ano - 1, e.inicioAtividade);
  const limiteAnoAtual = limiteDoAno(ano, e.inicioAtividade);
  const base = { limiteAnoAnterior, limiteAnoAtual };
  if (limiteAnoAnterior > 0 && e.rbaAnoAnterior > limiteAnoAnterior) {
    return { ...base, issNoDas: false, aviso: null, motivo: `receita de ${ano - 1} acima do sublimite: o ISS sai do DAS em ${ano} (pago ao município)` };
  }
  // Mais de 20% acima: 5 × RBA > 6 × limite (conta exata em centavos).
  if (limiteAnoAtual > 0 && 5 * e.rbaAnoAtualAteMesAnterior > 6 * limiteAnoAtual) {
    return { ...base, issNoDas: false, aviso: null, motivo: `receita de ${ano} passou o sublimite em mais de 20%: o ISS sai do DAS a partir do mês seguinte ao excesso` };
  }
  if (limiteAnoAtual > 0 && e.rbaAnoAtualAteMesAnterior > limiteAnoAtual) {
    return { ...base, issNoDas: true, motivo: "sublimite ultrapassado em até 20% no ano: o ISS continua no DAS neste ano",
      aviso: `A receita de ${ano} passou o sublimite de R$ 3,6 milhões em até 20%: o ISS sai do DAS a partir de janeiro de ${ano + 1}.` };
  }
  return { ...base, issNoDas: true, aviso: null, motivo: "receita do ano dentro do sublimite: ISS no DAS" };
}

/** u → "7,7160%" (4 casas, vírgula). */
export function percentualTexto(u: number): string {
  const s = (u / U_POR_PONTO).toFixed(4);
  return `${s.replace(".", ",")}%`;
}

/**
 * Casas decimais do `pAliq` da DPS: 2. Os percentuais do leiaute nacional são decimais de 2 casas (tipo TSDec1V2 do XSD
 * `tiposSimples`) — [NÃO CONFIRMADO linha a linha: o XSD não está no repositório; a fixture sintética da S-5 usa "5.00"].
 * Ajustar só aqui se o XSD disser outro número.
 */
export const CASAS_PALIQ = 2;

/** u → "3.09" (ponto decimal, CASAS_PALIQ casas, meio para cima) — formato do `pAliq` da DPS. */
export function percentualDps(u: number): string {
  if (!Number.isSafeInteger(u) || u < 0) throw new ErroSimples("alíquota inválida");
  const passo = 10 ** (4 - CASAS_PALIQ);
  const arred = Math.floor((u + passo / 2) / passo) * passo;
  return (arred / U_POR_PONTO).toFixed(CASAS_PALIQ);
}

/** Texto de alíquota ("5.0000", "5") → formato do `pAliq` (null se vazio ou inválido). */
export function aliquotaTextoParaDps(texto: string | null | undefined): string | null {
  if (texto == null || String(texto).trim() === "") return null;
  const n = Number(texto);
  if (!Number.isFinite(n) || n < 0) return null;
  return percentualDps(Math.round(n * U_POR_PONTO));
}

/** u → "7.7160" (ponto decimal, 4 casas). */
export function percentualDecimal(u: number): string {
  return (u / U_POR_PONTO).toFixed(4);
}

/** Valor em centavos × alíquota (u), arredondado ao centavo, meio para cima. */
export function centavosDaAliquota(valorCentavos: number, u: number): number {
  conferirRbt12(valorCentavos);
  if (!Number.isSafeInteger(u) || u < 0) throw new ErroSimples("alíquota inválida");
  return arredondar({ num: BigInt(valorCentavos) * BigInt(u), den: BigInt(U_TOTAL) });
}

/** "AAAA-MM" de n meses antes (n ≥ 0) da competência "AAAA-MM". */
export function mesAntes(competencia: string, n: number): string {
  const [a, m] = competencia.slice(0, 7).split("-").map(Number) as [number, number];
  const total = a * 12 + (m - 1) - n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Último dia do mês "AAAA-MM" → "AAAA-MM-DD". */
export function ultimoDiaDoMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** Meses completos de atividade antes da competência (início no meio do mês conta o mês do início). null = sem data. */
export function mesesDeAtividadeAntes(inicioAtividade: string | null | undefined, competencia: string): number | null {
  if (!inicioAtividade || !/^\d{4}-\d{2}/.test(inicioAtividade)) return null;
  const [ai, mi] = inicioAtividade.slice(0, 7).split("-").map(Number) as [number, number];
  const [ac, mc] = competencia.slice(0, 7).split("-").map(Number) as [number, number];
  return Math.max(0, ac * 12 + mc - (ai * 12 + mi));
}
