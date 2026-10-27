// Pedido de 25/10 (LOTE C): o extrato bancário alimenta todo o BPO Financeiro.
// Regras puras (sem banco/rede) — mesmo comportamento a portar no Grupo Santa Fé.
//
// Cada movimentação bancária vira um lançamento pago no BPO (1:1): crédito → receita
// (aba Cobranças), débito → despesa. "Transferência interna" (entre contas da própria
// empresa) não é receita nem despesa: não gera lançamento.

export const CATEGORIAS_BPO = [
  "Recebimento de cliente",
  "Financiamento/CAIXA",
  "Material",
  "Mão de obra",
  "Projetos e taxas",
  "Impostos",
  "Tarifas bancárias",
  "Pró-labore",
  "Administrativo",
  "Transferência interna",
  "Outros",
] as const;

export type CategoriaBpo = (typeof CATEGORIAS_BPO)[number];
export const TRANSFERENCIA_INTERNA: CategoriaBpo = "Transferência interna";

export type TipoMovimento = "credito" | "debito";

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Palavras-chave → categoria. A primeira regra que casar vence; a ordem importa. */
const REGRAS: { categoria: CategoriaBpo; padrao: RegExp; tipo?: TipoMovimento }[] = [
  { categoria: "Transferência interna", padrao: /\b(transferencia entre contas|entre contas|mesma titularidade|aplicacao|resgate)\b/ },
  { categoria: "Tarifas bancárias", padrao: /\b(tarifa|tarifas|taxa bancaria|anuidade|cesta de servicos|iof|manutencao de conta|taxa de boleto|taxa pix)\b/ },
  { categoria: "Impostos", padrao: /\b(darf|guia das|das simples|gps|gru|dae|imposto|impostos|tributo|tributos|inss|fgts|irpj|csll|pis|cofins|iss|issqn|iptu|simples nacional|receita federal)\b/ },
  { categoria: "Financiamento/CAIXA", padrao: /\b(caixa economica|cef|financiamento|habitacional|medicao|minha casa)\b/ },
  { categoria: "Pró-labore", padrao: /\b(pro[- ]?labore|prolabore)\b/ },
  { categoria: "Projetos e taxas", padrao: /\b(crea|cau|art|rrt|alvara|prefeitura|cartorio|projeto|projetos|habite[- ]?se|registro de imoveis)\b/ },
  { categoria: "Material", padrao: /\b(material|materiais|construcao|cimento|areia|tijolo|madeireira|ferragens?|deposito|home center|leroy|telhas?)\b/, tipo: "debito" },
  { categoria: "Mão de obra", padrao: /\b(mao de obra|empreiteir[oa]|pedreiro|servente|diaria|diarista|eletricista|encanador|pintor)\b/, tipo: "debito" },
  { categoria: "Administrativo", padrao: /\b(aluguel|energia|luz|agua|internet|telefone|contabilidade|contador|software|assinatura|material de escritorio|combustivel)\b/, tipo: "debito" },
];

/** Sugestão automática simples por palavras-chave; sem regra → crédito "Recebimento de cliente", débito "Outros". */
export function sugerirCategoria(descricao: string, tipo: TipoMovimento): CategoriaBpo {
  const d = sem(descricao ?? "");
  for (const r of REGRAS) {
    if (r.tipo && r.tipo !== tipo) continue;
    if (r.padrao.test(d)) return r.categoria;
  }
  return tipo === "credito" ? "Recebimento de cliente" : "Outros";
}

/** Categoria salva válida; texto desconhecido (ex.: categoria do provedor) é reavaliado pela sugestão. */
export function categoriaValida(categoria: string | null | undefined): CategoriaBpo | null {
  return (CATEGORIAS_BPO as readonly string[]).includes(categoria ?? "") ? (categoria as CategoriaBpo) : null;
}

export function contaNoResultado(categoria: string | null | undefined): boolean {
  return categoria !== TRANSFERENCIA_INTERNA;
}

export type MovimentoParaLancamento = {
  id: number;
  data: Date | string;
  descricao: string;
  valor: string | number;
  tipo: TipoMovimento;
  categoria: string | null;
  bpoClienteId?: number | null;
  // Pedido de 25/10 (noite): titular e descrição complementar entram na descrição do lançamento.
  titular?: string | null;
  detalhe?: string | null;
};

export type LancamentoDoExtrato = {
  bankTransactionId: number;
  tipo: "receita" | "despesa";
  categoria: CategoriaBpo;
  clienteId: number | null;
  descricao: string;
  valor: string;
  vencimento: Date;
  pago: true;
  pagoEm: Date;
  competencia: string;
};

/** Data do banco em AAAA-MM-DD (a movimentação é gravada ao meio-dia UTC). */
export function dataDoBanco(data: Date | string): string {
  return (typeof data === "string" ? data : data.toISOString()).slice(0, 10);
}

/** Lançamento pago que espelha a movimentação; `null` quando não conta no resultado (transferência interna). */
export function lancamentoDaMovimentacao(m: MovimentoParaLancamento): LancamentoDoExtrato | null {
  const categoria = categoriaValida(m.categoria) ?? sugerirCategoria(m.descricao, m.tipo);
  if (!contaNoResultado(categoria)) return null;
  const dia = dataDoBanco(m.data);
  const quando = new Date(`${dia}T12:00:00Z`);
  return {
    bankTransactionId: m.id,
    tipo: m.tipo === "credito" ? "receita" : "despesa",
    categoria,
    clienteId: m.bpoClienteId ?? null,
    descricao: descricaoDoLancamento(m),
    valor: Number(m.valor).toFixed(2),
    vencimento: quando,
    pago: true,
    pagoEm: quando,
    competencia: dia.slice(0, 7),
  };
}

/** Saldo calculado pelas movimentações: créditos − débitos (centavos, sem erro de arredondamento). */
export function saldoPorMovimentos(movs: { tipo: TipoMovimento; valor: string | number }[]): number {
  const centavos = movs.reduce((s, m) => s + (m.tipo === "credito" ? 1 : -1) * Math.round(Number(m.valor) * 100), 0);
  return centavos / 100;
}

// ── Pedido de 25/10 (noite), itens 9 e 10: titular, regra por titular e clientes ──

/** Nome comparável: sem acento, minúsculo, sem CPF/CNPJ/pontuação e sem espaços repetidos. */
export function normalizarTitular(nome: string | null | undefined): string {
  return sem(String(nome ?? ""))
    .replace(/[\d.\-/*]{6,}/g, " ")
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 255);
}

/** "Tipo — Titular — descrição", sem repetir partes vazias ou já contidas em outra parte. */
export function descricaoDoLancamento(m: { descricao?: string | null; titular?: string | null; detalhe?: string | null }): string {
  const partes: string[] = [];
  for (const p of [m.descricao, m.titular, m.detalhe]) {
    const t = String(p ?? "").replace(/\s+/g, " ").trim();
    if (!t) continue;
    const n = sem(t);
    if (partes.some(x => sem(x).includes(n))) continue;
    // Parte nova que já contém anteriores (ex.: detalhe = "Pix enviado Fulano") substitui as menores.
    const primeira = partes.findIndex(x => n.includes(sem(x)));
    if (primeira >= 0) {
      partes[primeira] = t;
      for (let i = partes.length - 1; i > primeira; i--) if (n.includes(sem(partes[i]))) partes.splice(i, 1);
      continue;
    }
    partes.push(t);
  }
  return (partes.join(" — ") || "Movimentação bancária").slice(0, 500);
}

export type ClienteParaSugestao = { id: number; razaoSocial: string; nomeLead?: string | null };

/** Cliente BPO cujo nome (ou o nome do lead vinculado) é igual ao titular; `null` se nenhum ou ambíguo. */
export function sugerirClientePorTitular(titular: string | null | undefined, clientes: ClienteParaSugestao[]): number | null {
  const alvo = normalizarTitular(titular);
  if (alvo.length < 3) return null;
  const achados = clientes.filter(c => normalizarTitular(c.razaoSocial) === alvo || (c.nomeLead && normalizarTitular(c.nomeLead) === alvo));
  return achados.length === 1 ? achados[0].id : null;
}

export type LancamentoResumo = { clienteId: number | null; tipo: string; valor: string | number; pago: boolean; categoria?: string | null; valorRecebido?: string | number | null };

export function recebidoDoLancamento(l: { valor: string | number; pago: boolean; valorRecebido?: string | number | null }) {
  return l.pago ? Number(l.valor) : Math.min(Number(l.valor), Math.max(0, Number(l.valorRecebido ?? 0)));
}

/** Por cliente: total recebido (cobranças pagas) e em aberto (cobranças não pagas), em reais. */
export function resumoPorCliente(lancamentos: LancamentoResumo[]) {
  const mapa = new Map<number, { recebido: number; emAberto: number; lancamentos: number }>();
  for (const l of lancamentos) {
    if (!l.clienteId || l.tipo === "despesa" || !contaNoResultado(l.categoria)) continue;
    const e = mapa.get(l.clienteId) ?? { recebido: 0, emAberto: 0, lancamentos: 0 };
    const centavos = Math.round(Number(l.valor) * 100);
    const recebido = Math.round(recebidoDoLancamento(l) * 100);
    e.recebido += recebido;
    e.emAberto += centavos - recebido;
    e.lancamentos++;
    mapa.set(l.clienteId, e);
  }
  return new Map(Array.from(mapa.entries()).map(([id, v]) => [id, { recebido: v.recebido / 100, emAberto: v.emAberto / 100, lancamentos: v.lancamentos }]));
}

export type LinhaDreCategoria = { categoria: string; entradas: number; saidas: number; resultado: number };

/** DRE por categoria (transferência interna fica fora; sem categoria → "Sem categoria"). */
export function dreDasCategorias(lancamentos: { tipo: string; valor: string | number; categoria?: string | null }[]): LinhaDreCategoria[] {
  const mapa = new Map<string, { entradas: number; saidas: number }>();
  for (const l of lancamentos) {
    if (!contaNoResultado(l.categoria)) continue;
    const chave = categoriaValida(l.categoria) ?? (l.categoria?.trim() || "Sem categoria");
    const e = mapa.get(chave) ?? { entradas: 0, saidas: 0 };
    const centavos = Math.round(Number(l.valor) * 100);
    if (l.tipo === "despesa") e.saidas += centavos; else e.entradas += centavos;
    mapa.set(chave, e);
  }
  const ordem = (c: string) => { const i = (CATEGORIAS_BPO as readonly string[]).indexOf(c); return i < 0 ? 999 : i; };
  return Array.from(mapa.entries())
    .map(([categoria, v]) => ({ categoria, entradas: v.entradas / 100, saidas: v.saidas / 100, resultado: (v.entradas - v.saidas) / 100 }))
    .sort((a, b) => ordem(a.categoria) - ordem(b.categoria) || a.categoria.localeCompare(b.categoria));
}

export type LinhaDre = { competencia: string; cobrancas: number; despesas: number; resultado: number };

/** DRE por competência a partir dos lançamentos do BPO (despesa x demais tipos). */
export function dreDosLancamentos(lancamentos: { competencia: string; tipo: string; valor: string | number; categoria?: string | null }[]): LinhaDre[] {
  const mapa = new Map<string, { cobrancas: number; despesas: number }>();
  for (const l of lancamentos) {
    if (!contaNoResultado(l.categoria)) continue;
    const e = mapa.get(l.competencia) ?? { cobrancas: 0, despesas: 0 };
    const centavos = Math.round(Number(l.valor) * 100);
    if (l.tipo === "despesa") e.despesas += centavos;
    else e.cobrancas += centavos;
    mapa.set(l.competencia, e);
  }
  return Array.from(mapa.entries())
    .map(([competencia, v]) => ({ competencia, cobrancas: v.cobrancas / 100, despesas: v.despesas / 100, resultado: (v.cobrancas - v.despesas) / 100 }))
    .sort((a, b) => b.competencia.localeCompare(a.competencia));
}
