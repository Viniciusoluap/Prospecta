// EPIC-029 S-6 (22/11/2026) — regime tributário por empresa, limites de receita do ano e a soma das receitas pelas contas da empresa.
// Regras PURAS (sem banco nem rede): a tela (aba Contabilidade), o aviso da Dolores e a leitura dela usam as mesmas contas.
//
// Pedido do dono (22/11): "Quero que a Dolores me avise quando eu estiver perto de bater a movimentação anual máxima permitida naquela
// conta […] vincular a conta que estamos usando à empresa que irá emitir nota". Ampliação no mesmo dia: "As outras empresas que estão em
// outros regimes tributários terão os próprios regimes delas com vínculos de suas contas e movimentações; o nosso sistema tem que abranger
// tudo isso."
//
// O limite legal é sobre a RECEITA BRUTA da EMPRESA no ano-calendário (soma de todas as contas dela), não sobre uma conta. O que se soma
// aqui é a receita REGISTRADA no BPO; a apuração oficial é do contador (a tela e a Dolores dizem isso).

/** Regimes aceitos no perfil tributário. "a_confirmar": o contador ainda não disse — sem estimativa de tributo e sem limite. */
export const REGIMES_TRIBUTARIOS = ["simples_nacional", "lucro_presumido", "lucro_real", "ret", "outro", "a_confirmar"] as const;
export type RegimeTributario = (typeof REGIMES_TRIBUTARIOS)[number];
export const ROTULO_REGIME: Readonly<Record<string, string>> = Object.freeze({
  simples_nacional: "Simples Nacional",
  lucro_presumido: "Lucro Presumido",
  lucro_real: "Lucro Real",
  ret: "RET",
  outro: "Outro",
  a_confirmar: "A confirmar com o contador",
});
export const rotuloRegime = (r: string | null | undefined) => (r ? ROTULO_REGIME[r] ?? r : ROTULO_REGIME.a_confirmar);

/** Regime sem decisão do contador: não estima tributo (a estimativa ficaria com cara de número oficial). */
export const regimeAConfirmar = (r: string | null | undefined) => !r || r === "a_confirmar";

/**
 * A DPS da NFS-e informa a opção pelo Simples Nacional só para empresa do Simples (S-4 lê isto). `null` = não dá para dizer
 * (regime a confirmar): a emissão deve recusar até o contador definir.
 */
export function optanteDoSimples(regime: string | null | undefined): boolean | null {
  if (regimeAConfirmar(regime)) return null;
  return regime === "simples_nacional";
}

// ── Limites de receita (valores em CENTAVOS) ──────────────────────────────────────────────────────────────────────────────
// Fontes (texto da lei; conferir sempre com o contador):
//  - LC 123/2006, art. 3º, I — microempresa (ME): receita bruta até R$ 360.000,00 no ano-calendário.
//  - LC 123/2006, art. 3º, II (redação da LC 155/2016) — empresa de pequeno porte (EPP): até R$ 4.800.000,00 = teto do Simples.
//  - LC 123/2006, art. 3º, §§ 9º e 9º-A — passou do teto: exclusão do Simples no ano seguinte se o excesso não passar de 20%; acima de
//    20% (R$ 5.760.000,00), com efeito já no mês seguinte ao do excesso.
//  - LC 123/2006, art. 13-A (redação da LC 155/2016) — sublimite de R$ 3.600.000,00: acima dele o ISS (e o ICMS) sai do DAS e é
//    recolhido à parte (mesma regra dos 20% para o momento do efeito).
//  - Lei 9.718/1998, art. 13 (redação da Lei 12.814/2013) — Lucro Presumido: receita bruta total do ano-calendário ANTERIOR até
//    R$ 78.000.000,00 (ou R$ 6.500.000,00 × meses de atividade, quando menos de 12). Acima disso, no ano seguinte, Lucro Real obrigatório.
//  - Lucro Real: sem teto de receita.
// Conferência on-line em 22/11/2026: as páginas oficiais (planalto.gov.br e www8.receita.fazenda.gov.br) ficaram bloqueadas na rede
// desta sessão; as páginas de www.gov.br testadas não traziam os valores. Valores conferidos pelo texto das leis citadas — [o contador
// deve confirmar; ver S-6, seção "Fontes"].
export const LIMITE_ME_CENTAVOS = 360_000_00;
export const SUBLIMITE_SIMPLES_CENTAVOS = 3_600_000_00;
export const TETO_SIMPLES_CENTAVOS = 4_800_000_00;
/** Teto + 20%: acima disso a exclusão do Simples tem efeito já no mês seguinte. */
export const TETO_SIMPLES_MAIS_20_CENTAVOS = 5_760_000_00;
export const LIMITE_PRESUMIDO_CENTAVOS = 78_000_000_00;

export type ChaveLimite = "me" | "sublimite" | "teto_simples" | "presumido";
export type LimiteDoRegime = {
  chave: ChaveLimite;
  rotulo: string;
  valorCentavos: number;
  /** Só informa (passar não muda o regime): a ME passa a EPP no ano seguinte. */
  informativo: boolean;
  /** O que acontece ao passar (texto fixo, curto). */
  consequencia: string;
  fonte: string;
};

export const LIMITES: Readonly<Record<ChaveLimite, LimiteDoRegime>> = Object.freeze({
  me: { chave: "me", rotulo: "limite da microempresa (ME)", valorCentavos: LIMITE_ME_CENTAVOS, informativo: true,
    consequencia: "acima disso a empresa deixa de ser ME e passa a EPP no ano seguinte (continua no Simples; só informativo)",
    fonte: "LC 123/2006, art. 3º, I" },
  sublimite: { chave: "sublimite", rotulo: "sublimite do Simples (R$ 3,6 milhões)", valorCentavos: SUBLIMITE_SIMPLES_CENTAVOS, informativo: false,
    consequencia: "acima disso o ISS sai do DAS e passa a ser pago à parte",
    fonte: "LC 123/2006, art. 13-A" },
  teto_simples: { chave: "teto_simples", rotulo: "teto do Simples (R$ 4,8 milhões)", valorCentavos: TETO_SIMPLES_CENTAVOS, informativo: false,
    consequencia: "acima disso a empresa é excluída do Simples (no ano seguinte; se passar de R$ 5,76 milhões, já no mês seguinte)",
    fonte: "LC 123/2006, art. 3º, II e §§ 9º e 9º-A" },
  presumido: { chave: "presumido", rotulo: "limite do Lucro Presumido (R$ 78 milhões)", valorCentavos: LIMITE_PRESUMIDO_CENTAVOS, informativo: false,
    consequencia: "com a receita do ano acima disso, no ano que vem a empresa fica obrigada ao Lucro Real",
    fonte: "Lei 9.718/1998, art. 13" },
});

export type SituacaoDoLimite = "com_limite" | "sem_limite" | "a_confirmar";

/** Limites que valem para o regime (na ordem do menor para o maior) e a situação para a tela. */
export function limitesDoRegime(regime: string | null | undefined): { situacao: SituacaoDoLimite; limites: LimiteDoRegime[]; explicacao: string } {
  if (regime === "simples_nacional") return { situacao: "com_limite", limites: [LIMITES.me, LIMITES.sublimite, LIMITES.teto_simples], explicacao: "Simples Nacional: ME, sublimite e teto." };
  if (regime === "lucro_presumido") return { situacao: "com_limite", limites: [LIMITES.presumido], explicacao: "Lucro Presumido: limite de R$ 78 milhões de receita no ano." };
  if (regime === "lucro_real") return { situacao: "sem_limite", limites: [], explicacao: "Lucro Real não tem teto de receita." };
  return { situacao: "a_confirmar", limites: [], explicacao: regimeAConfirmar(regime)
    ? "Regime a confirmar com o contador: sem limite calculado e sem estimativa de tributo."
    : `Regime "${rotuloRegime(regime)}": o limite de receita depende do regime de apuração da empresa; confirme com o contador.` };
}

/** Faixas do aviso (% do limite). Cada uma é avisada UMA vez por empresa, por limite, por ano. */
export const FAIXAS_LIMITE = [70, 85, 95, 100] as const;
/** Faixa alcançada (0 = abaixo de 70%). Conta exata em centavos (sem arredondar para cima). */
export function faixaDoLimite(receitaCentavos: number, limiteCentavos: number): number {
  if (!(limiteCentavos > 0) || !(receitaCentavos > 0)) return 0;
  let f = 0;
  for (const p of FAIXAS_LIMITE) if (receitaCentavos * 100 >= limiteCentavos * p) f = p;
  return f;
}
/** Percentual com 1 casa (para a tela e o texto). */
export const percentualDe = (receitaCentavos: number, limiteCentavos: number) =>
  limiteCentavos > 0 ? Math.floor((receitaCentavos * 1000) / limiteCentavos) / 10 : 0;

// ── Ano em Brasília e projeção ───────────────────────────────────────────────────────────────────────────────────────────────

const dataBrasilia = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
export const anoEmBrasilia = (agora: Date) => Number(dataBrasilia(agora).slice(0, 4));
const bissexto = (a: number) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;

/** Dias do ano já corridos em Brasília (1º de janeiro = 1) e o total de dias do ano. */
export function diasDoAno(agora: Date): { decorridos: number; total: number } {
  const hoje = dataBrasilia(agora);
  const ano = Number(hoje.slice(0, 4));
  const decorridos = Math.round((Date.UTC(ano, Number(hoje.slice(5, 7)) - 1, Number(hoje.slice(8, 10))) - Date.UTC(ano, 0, 1)) / 86_400_000) + 1;
  return { decorridos, total: bissexto(ano) ? 366 : 365 };
}

/** Antes disto a projeção pelo ritmo do ano é pouco confiável (a tela avisa). */
export const DIAS_MINIMOS_PROJECAO = 30;
/** Projeção do ano pelo ritmo até hoje: receita ÷ dias corridos × dias do ano (centavos, arredondado). */
export function projecaoAnual(receitaCentavos: number, agora: Date): { centavos: number; confiavel: boolean } {
  const { decorridos, total } = diasDoAno(agora);
  return { centavos: Math.round((receitaCentavos * total) / Math.max(1, decorridos)), confiavel: decorridos >= DIAS_MINIMOS_PROJECAO };
}

// ── Regime vigente numa data (versões do perfil tributário) ─────────────────────────────────────────────────────────────────

export type PerfilParaRegime = { id: number; companyName: string; cnpj: string; regime: string; effectiveFrom: Date; effectiveTo: Date | null; isActive: boolean };

/**
 * O perfil (versão) vigente na data: a versão de início mais recente que já começou e não terminou. Trocar de regime cria uma versão
 * nova (tax-router), então uma troca no meio do ano faz o painel e o aviso usarem o regime NOVO a partir da data dela. Sem versão
 * começada → null (regime a confirmar).
 */
export function perfilVigenteNaData<T extends PerfilParaRegime>(perfis: readonly T[], data: Date): T | null {
  const t = data.getTime();
  const validos = perfis.filter(p => p.effectiveFrom.getTime() <= t && (!p.effectiveTo || p.effectiveTo.getTime() > t));
  validos.sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime() || Number(b.isActive) - Number(a.isActive) || b.id - a.id);
  return validos[0] ?? null;
}

// ── Contas: nome amigável e CNPJ ────────────────────────────────────────────────────────────────────────────────────────────

export const MAX_APELIDO = 80;
/** CNPJ só com os caracteres (aceita o alfanumérico da IN RFB 2.229/2024). */
export const cnpjDaEmpresa = (v: string | null | undefined) => (v ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
export const cnpjValido = (v: string) => /^[0-9A-Z]{12}[0-9]{2}$/.test(v);
/**
 * Pedido do dono (22/11): EMPRESA = raiz do CNPJ (8 primeiros caracteres) — regime e limites são dela, e o teto do Simples soma matriz +
 * filiais. ESTABELECIMENTO = CNPJ completo (matriz 0001 ou filial), quem emite a nota (inscrição municipal/município próprios) e a quem a
 * conta bancária se liga.
 */
export const raizDoCnpj = (v: string | null | undefined) => cnpjDaEmpresa(v).slice(0, 8);
export const ehMatriz = (v: string | null | undefined) => cnpjDaEmpresa(v).slice(8, 12) === "0001";
/** 41865900000189 → 41.865.900/0001-89 (aceita o alfanumérico). */
export const formatarCnpj = (v: string | null | undefined) => {
  const c = cnpjDaEmpresa(v);
  return c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c;
};

/** Nome da conta em todas as listas: o apelido, se houver; senão banco — descrição • número (como a tela sempre mostrou). */
export function nomeDaConta(c: { apelido?: string | null; banco: string; descricao?: string | null; conta?: string | null }): string {
  const apelido = (c.apelido ?? "").trim();
  if (apelido) return apelido;
  return `${c.banco}${c.descricao ? ` — ${c.descricao}` : ""}${c.conta && c.conta !== "—" ? ` • ${c.conta}` : ""}`;
}
/** Final do número da conta (para quem só vê; a Dolores não recebe nem isso). */
export const finalDaConta = (conta: string | null | undefined) => {
  const d = (conta ?? "").replace(/\D/g, "");
  return d.length >= 4 ? `•••${d.slice(-4)}` : null;
};

// ── Soma das receitas por empresa ───────────────────────────────────────────────────────────────────────────────────────────

/** Crédito que é estorno/devolução (dinheiro que VOLTOU, não venda de serviço): fica fora da receita. O BPO não tem marca própria. */
export function ehEstorno(...textos: (string | null | undefined)[]): boolean {
  const t = textos.map(x => x ?? "").join(" ").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return /\b(estorno|estornad[oa]|estornos|devolucao|devolucoes|devolvid[oa]|chargeback|reembolso de pix|pix devolvido)\b/.test(t);
}

export type ContaParaSoma = { id: number; banco: string; apelido: string | null; descricao: string | null; conta: string | null; empresaCnpj: string | null; ativo: boolean };
export type ReceitaParaSoma = {
  lancamentoId: number; contaId: number | null; tipo: string; valorCentavos: number; descricao: string | null; categoria: string | null;
  pagoEm: Date; txDescricao?: string | null;
};
export type DebitoParaSoma = { txId: number; contaId: number; valorCentavos: number; data: Date };

/** Janela (ms) para casar uma entrada com a saída de mesmo valor em outra conta da MESMA empresa. */
export const JANELA_TRANSFERENCIA_MS = 2 * 86_400_000;

export type ApuracaoLimite = LimiteDoRegime & { percentual: number; faixa: number; faltaCentavos: number; projecaoPercentual: number };
export type ApuracaoEmpresa = {
  /** Raiz do CNPJ (a empresa). */
  raiz: string;
  /** CNPJ da matriz (ou do primeiro estabelecimento conhecido). */
  cnpj: string;
  /** Matriz e filiais conhecidas (dos perfis e das contas). */
  estabelecimentos: { cnpj: string; matriz: boolean }[];
  nome: string; perfilId: number | null; perfilAtivo: boolean; regime: string; regimeRotulo: string;
  situacao: SituacaoDoLimite; explicacao: string;
  contas: { id: number; nome: string; banco: string; final: string | null; ativo: boolean; estabelecimento: string }[];
  receitaCentavos: number; reembolsosCentavos: number; lancamentos: number;
  foraDaSoma: { transferenciasCentavos: number; transferencias: number; estornosCentavos: number; estornos: number };
  projecaoCentavos: number; projecaoConfiavel: boolean;
  limites: ApuracaoLimite[];
};
export type Apuracao = {
  ano: number; diasDecorridos: number;
  empresas: ApuracaoEmpresa[];
  /** Contas sem empresa definida (pendência) e a receita delas no ano (não entra em empresa nenhuma). */
  semEmpresa: { contas: { id: number; nome: string; banco: string; final: string | null }[]; receitaCentavos: number };
  /** Receita registrada sem conta bancária (lançamento manual/sem extrato): não dá para dizer de que empresa é. */
  semConta: { receitaCentavos: number; lancamentos: number };
  aviso: string;
};

export const AVISO_APURACAO =
  "Soma da receita REGISTRADA no BPO neste ano (entradas pagas nas contas de cada empresa, sem transferências entre contas da mesma empresa e sem estornos). A apuração oficial da receita bruta é do contador.";

/**
 * Soma a receita do ano por EMPRESA (todas as contas dela), aplica o limite do regime vigente hoje e calcula a projeção pelo ritmo do ano.
 * - Entra: lançamento pago que não é despesa (mesma base da "Receita realizada" da aba; reembolso entra e aparece à parte).
 * - Sai: estorno/devolução (pela descrição); entrada casada com uma saída de mesmo valor, em até 2 dias, de OUTRA conta da MESMA empresa
 *   (transferência entre contas dela que não foi marcada como "Transferência interna" — a marcada nem vira lançamento).
 * - Conta sem empresa e lançamento sem conta ficam à parte (pendências), nunca somados numa empresa por chute.
 */
export function apurarReceitas(p: {
  agora: Date; perfis: readonly PerfilParaRegime[]; contas: readonly ContaParaSoma[]; receitas: readonly ReceitaParaSoma[]; debitos: readonly DebitoParaSoma[];
}): Apuracao {
  const ano = anoEmBrasilia(p.agora);
  const { decorridos } = diasDoAno(p.agora);
  // a EMPRESA é a raiz: perfis da matriz e das filiais caem na mesma empresa
  const cnpjs = Array.from(new Set(p.perfis.map(x => raizDoCnpj(x.cnpj)).filter(c => c.length === 8)));
  const contaPorId = new Map(p.contas.map(c => [c.id, c]));
  const empresaDaConta = (id: number | null) => {
    const c = id == null ? null : contaPorId.get(id);
    const raiz = c?.empresaCnpj ? raizDoCnpj(c.empresaCnpj) : "";
    return raiz && cnpjs.includes(raiz) ? raiz : null;
  };

  // saídas disponíveis para casar, por empresa (cada saída casa uma vez só)
  const debitosPorEmpresa = new Map<string, DebitoParaSoma[]>();
  for (const d of p.debitos) {
    const e = empresaDaConta(d.contaId);
    if (!e) continue;
    (debitosPorEmpresa.get(e) ?? debitosPorEmpresa.set(e, []).get(e)!).push(d);
  }
  const usados = new Set<number>();

  type Acumulado = { receita: number; reembolsos: number; n: number; trCent: number; tr: number; esCent: number; es: number };
  const zero = (): Acumulado => ({ receita: 0, reembolsos: 0, n: 0, trCent: 0, tr: 0, esCent: 0, es: 0 });
  const porEmpresa = new Map<string, Acumulado>(cnpjs.map(c => [c, zero()]));
  let semEmpresaReceita = 0;
  let semContaReceita = 0;
  let semContaN = 0;

  const ordenadas = [...p.receitas].sort((a, b) => a.pagoEm.getTime() - b.pagoEm.getTime() || a.lancamentoId - b.lancamentoId);
  for (const r of ordenadas) {
    if (r.tipo === "despesa" || !(r.valorCentavos > 0)) continue;
    if (r.categoria === "Transferência interna") continue;
    if (r.contaId == null) {
      if (!ehEstorno(r.descricao)) { semContaReceita += r.valorCentavos; semContaN++; }
      continue;
    }
    const e = empresaDaConta(r.contaId);
    if (!e) { if (!ehEstorno(r.descricao, r.txDescricao)) semEmpresaReceita += r.valorCentavos; continue; }
    const acc = porEmpresa.get(e)!;
    if (ehEstorno(r.descricao, r.txDescricao)) { acc.esCent += r.valorCentavos; acc.es++; continue; }
    const par = (debitosPorEmpresa.get(e) ?? []).find(d => !usados.has(d.txId) && d.contaId !== r.contaId && d.valorCentavos === r.valorCentavos
      && Math.abs(d.data.getTime() - r.pagoEm.getTime()) <= JANELA_TRANSFERENCIA_MS);
    if (par) { usados.add(par.txId); acc.trCent += r.valorCentavos; acc.tr++; continue; }
    acc.receita += r.valorCentavos;
    if (r.tipo === "reembolso") acc.reembolsos += r.valorCentavos;
    acc.n++;
  }

  const empresas: ApuracaoEmpresa[] = cnpjs.map(raiz => {
    const versoes = p.perfis.filter(x => raizDoCnpj(x.cnpj) === raiz);
    // o regime é da EMPRESA: a filial herda. Vale a versão vigente, preferindo a da matriz quando houver versões dos dois.
    const daMatriz = versoes.filter(v => ehMatriz(v.cnpj));
    const vigente = perfilVigenteNaData(daMatriz, p.agora) ?? perfilVigenteNaData(versoes, p.agora);
    const maisRecente = [...versoes].sort((a, b) => Number(ehMatriz(b.cnpj)) - Number(ehMatriz(a.cnpj)) || Number(b.isActive) - Number(a.isActive)
      || b.effectiveFrom.getTime() - a.effectiveFrom.getTime() || b.id - a.id)[0]!;
    const contasDela = p.contas.filter(c => c.empresaCnpj && raizDoCnpj(c.empresaCnpj) === raiz);
    const estab = Array.from(new Set([...versoes.map(v => v.cnpj), ...contasDela.map(c => cnpjDaEmpresa(c.empresaCnpj))])).sort();
    const cnpj = estab.find(ehMatriz) ?? maisRecente.cnpj;
    const regime = vigente?.regime ?? "a_confirmar";
    const regra = limitesDoRegime(regime);
    const acc = porEmpresa.get(raiz)!;
    const proj = projecaoAnual(acc.receita, p.agora);
    return {
      raiz, cnpj, estabelecimentos: estab.map(c => ({ cnpj: c, matriz: ehMatriz(c) })), nome: (vigente ?? maisRecente).companyName, perfilId: vigente?.id ?? null, perfilAtivo: versoes.some(v => v.isActive),
      regime, regimeRotulo: rotuloRegime(regime), situacao: regra.situacao, explicacao: regra.explicacao,
      contas: contasDela.map(c => ({ id: c.id, nome: nomeDaConta(c), banco: c.banco, final: finalDaConta(c.conta), ativo: c.ativo, estabelecimento: cnpjDaEmpresa(c.empresaCnpj) })),
      receitaCentavos: acc.receita, reembolsosCentavos: acc.reembolsos, lancamentos: acc.n,
      foraDaSoma: { transferenciasCentavos: acc.trCent, transferencias: acc.tr, estornosCentavos: acc.esCent, estornos: acc.es },
      projecaoCentavos: proj.centavos, projecaoConfiavel: proj.confiavel,
      limites: regra.limites.map(l => ({ ...l, percentual: percentualDe(acc.receita, l.valorCentavos), faixa: faixaDoLimite(acc.receita, l.valorCentavos),
        faltaCentavos: Math.max(0, l.valorCentavos - acc.receita), projecaoPercentual: percentualDe(proj.centavos, l.valorCentavos) })),
    };
  }).sort((a, b) => b.receitaCentavos - a.receitaCentavos || a.nome.localeCompare(b.nome));

  const contasSemEmpresa = p.contas.filter(c => c.ativo && !empresaDaConta(c.id));
  return {
    ano, diasDecorridos: decorridos, empresas,
    semEmpresa: { contas: contasSemEmpresa.map(c => ({ id: c.id, nome: nomeDaConta(c), banco: c.banco, final: finalDaConta(c.conta) })), receitaCentavos: semEmpresaReceita },
    semConta: { receitaCentavos: semContaReceita, lancamentos: semContaN },
    aviso: AVISO_APURACAO,
  };
}

/** "R$ 1,2 milhão" / "R$ 620 mil" / "R$ 950,00": valor redondo para o aviso e a conversa. */
export function reaisCurtos(centavos: number): string {
  const r = centavos / 100;
  const br = (n: number, casas: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: casas });
  if (r >= 1_000_000) { const m = Math.floor(r / 10_000) / 100; return `R$ ${br(m, 2)} ${m < 2 ? "milhão" : "milhões"}`; }
  if (r >= 10_000) return `R$ ${br(Math.floor(r / 1_000), 0)} mil`;
  return `R$ ${r.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
