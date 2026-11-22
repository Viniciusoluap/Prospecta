// EPIC-029 S-2 (22/11/2026) — relatório do contador "Notas × receita do mês".
// Parte das MESMAS linhas do cartão "Receita realizada" da aba Contabilidade (`linhasDaReceitaRealizada` e
// `receitaRealizada` do tax-router) e reparte cada linha em: com nota, sem nota (por motivo), a decidir, de outra empresa
// (quando filtrado) e diferença (linha sem rascunho, listada uma a uma). A soma das partes é a receita realizada, sempre.
import { sql } from "drizzle-orm";
import { MOTIVOS_SEM_NOTA, ROTULO_MOTIVO, type MotivoSemNota } from "../../shared/fiscal/motivos.js";
import { inicioDoDiaEmBrasilia, ROTULO_ORIGEM, type OrigemNota } from "../../shared/fiscal/origens.js";
import type { StatusNota } from "../../shared/fiscal/status.js";
import type { DrizzleDb } from "../db.js";
import { linhasDaReceitaRealizada, receitaRealizada } from "../tax-router.js";

const centavos = (v: unknown) => Math.round(Number(v ?? 0) * 100);

export type NotaDoRelatorio = {
  id: number;
  status: StatusNota;
  motivoSemNota: MotivoSemNota | null;
  emissorId: number | null;
  origemTipo: OrigemNota;
  origemId: number;
  dataEvento: string;
  /** Lançamento do BPO que esta nota cobre (o próprio, ou o ligado ao recebimento do módulo). */
  lancamentoBpoId: number | null;
  /** Valor do registro de origem (para repartir um lançamento ligado a mais de um recebimento). */
  valorOrigemCentavos: number;
};

export type Categoria = "com_nota" | "sem_nota" | "a_decidir" | "outra_empresa" | "diferenca";

export type LinhaRelatorio = {
  fonte: "bpo" | "financeiro";
  id: number;
  descricao: string;
  centavos: number;
  categoria: Categoria;
  motivo?: MotivoSemNota;
  notaId?: number;
  explicacao?: string;
};

export type Relatorio = {
  competencia: string;
  de: Date;
  ate: Date;
  emissorId: number | null;
  receitaRealizadaCentavos: number;
  comNotaCentavos: number;
  semNotaCentavos: number;
  semNotaPorMotivo: { motivo: MotivoSemNota; rotulo: string; centavos: number }[];
  aDecidirCentavos: number;
  outraEmpresaCentavos: number;
  diferencaCentavos: number;
  linhas: LinhaRelatorio[];
  diferencas: LinhaRelatorio[];
  /** Rascunhos do mês cuja origem não entra no cartão (ex.: recebimento de obra sem lançamento no BPO). Não somam. */
  foraDaReceita: { notaId: number; origem: string; centavos: number; status: StatusNota }[];
  fecha: boolean;
};

export function periodoDaCompetencia(competencia: string): { de: Date; ate: Date } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) throw new Error("Competência inválida (use AAAA-MM).");
  const [ano, mes] = competencia.split("-").map(Number) as [number, number];
  const proximo = mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, "0")}-01`;
  return { de: inicioDoDiaEmBrasilia(`${competencia}-01`), ate: new Date(inicioDoDiaEmBrasilia(proximo).getTime() - 1) };
}

/** Parte pura (testável): reparte as linhas da receita entre as categorias. */
export function montarRelatorio(e: {
  competencia: string;
  de: Date;
  ate: Date;
  emissorId?: number | null;
  movimentos: { id: number; type: string; amount: string | number; description?: string | null }[];
  lancamentosBpo: { id: number; tipo: string; valor: string | number; descricao?: string | null }[];
  notas: NotaDoRelatorio[];
}): Relatorio {
  const emissorId = e.emissorId ?? null;
  const total = Math.round(receitaRealizada(e.movimentos, e.lancamentosBpo).total * 100);
  const linhas: LinhaRelatorio[] = [];
  const usadas = new Set<number>();

  const categoriaDa = (n: NotaDoRelatorio): Pick<LinhaRelatorio, "categoria" | "motivo" | "explicacao"> => {
    if (emissorId != null && n.emissorId !== emissorId) {
      return { categoria: "outra_empresa", explicacao: n.emissorId == null ? "rascunho sem empresa emissora definida" : "rascunho de outra empresa" };
    }
    if (n.status === "EMITIDA") return { categoria: "com_nota" };
    if (n.status === "SEM_NOTA") return { categoria: "sem_nota", motivo: n.motivoSemNota ?? "outro" };
    if (n.status === "CANCELADA") return { categoria: "diferenca", explicacao: "nota cancelada" };
    return { categoria: "a_decidir" };
  };

  for (const m of e.movimentos) {
    if (m.type !== "income" && m.type !== "commission") continue;
    linhas.push({ fonte: "financeiro", id: m.id, descricao: m.description ?? "", centavos: centavos(m.amount), categoria: "diferenca",
      explicacao: "lançamento do financeiro antigo, sem origem fiscal" });
  }
  for (const l of e.lancamentosBpo) {
    if (l.tipo === "despesa") continue;
    const valor = centavos(l.valor);
    const daLinha = e.notas.filter(n => n.lancamentoBpoId === l.id);
    daLinha.forEach(n => usadas.add(n.id));
    if (!daLinha.length) {
      linhas.push({ fonte: "bpo", id: l.id, descricao: l.descricao ?? "", centavos: valor, categoria: "diferenca",
        explicacao: "sem rascunho de nota (antes da data de corte, gerador ainda não rodou ou lançamento combinado)" });
      continue;
    }
    if (daLinha.length === 1) {
      linhas.push({ fonte: "bpo", id: l.id, descricao: l.descricao ?? "", centavos: valor, notaId: daLinha[0]!.id, ...categoriaDa(daLinha[0]!) });
      continue;
    }
    // Lançamento repartido entre vários recebimentos do módulo: cada nota leva o valor do seu recebimento; o resto é diferença.
    let resto = valor;
    for (const n of daLinha) {
      const parte = Math.max(0, Math.min(resto, n.valorOrigemCentavos));
      resto -= parte;
      if (parte) linhas.push({ fonte: "bpo", id: l.id, descricao: l.descricao ?? "", centavos: parte, notaId: n.id, ...categoriaDa(n) });
    }
    if (resto) linhas.push({ fonte: "bpo", id: l.id, descricao: l.descricao ?? "", centavos: resto, categoria: "diferenca", explicacao: "parte do lançamento sem recebimento ligado" });
  }

  const soma = (c: Categoria) => linhas.filter(l => l.categoria === c).reduce((a, l) => a + l.centavos, 0);
  const semNotaPorMotivo = MOTIVOS_SEM_NOTA.map(motivo => ({
    motivo, rotulo: ROTULO_MOTIVO[motivo],
    centavos: linhas.filter(l => l.categoria === "sem_nota" && l.motivo === motivo).reduce((a, l) => a + l.centavos, 0),
  })).filter(m => m.centavos !== 0);
  const comNota = soma("com_nota"), semNota = soma("sem_nota"), aDecidir = soma("a_decidir"), outra = soma("outra_empresa"), dif = soma("diferenca");
  const deStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(e.de);
  const ateStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(e.ate);
  const foraDaReceita = e.notas
    .filter(n => !usadas.has(n.id) && n.dataEvento >= deStr && n.dataEvento <= ateStr && (emissorId == null || n.emissorId === emissorId))
    .map(n => ({ notaId: n.id, origem: ROTULO_ORIGEM[n.origemTipo], centavos: n.valorOrigemCentavos, status: n.status }));

  return {
    competencia: e.competencia, de: e.de, ate: e.ate, emissorId,
    receitaRealizadaCentavos: total,
    comNotaCentavos: comNota, semNotaCentavos: semNota, semNotaPorMotivo, aDecidirCentavos: aDecidir,
    outraEmpresaCentavos: outra, diferencaCentavos: dif,
    linhas, diferencas: linhas.filter(l => l.categoria === "diferenca"), foraDaReceita,
    fecha: comNota + semNota + aDecidir + outra + dif === total,
  };
}

/** Carrega do banco e monta (mesmo período e mesmas linhas do cartão). */
export async function relatorioMensal(db: DrizzleDb, competencia: string, emissorId?: number | null): Promise<Relatorio> {
  const { de, ate } = periodoDaCompetencia(competencia);
  const { movements, lancamentosBpo } = await linhasDaReceitaRealizada(db, de, ate);
  const idsBpo = lancamentosBpo.map(l => l.id);
  const deStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(de);
  const ateStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(ate);
  const r = await db.execute(sql`
    SELECT n.id, n.status, n.motivo_sem_nota, n.emissor_id, n.origem_tipo, n.origem_id, n.data_evento::text AS data_evento,
      CASE WHEN n.origem_tipo = 'bpo_lancamento' THEN n.origem_id ELSE COALESCE(om.bpo_lancamento_id, rr.bpo_lancamento_id) END AS lancamento,
      COALESCE(om.valor, rr.valor, l.valor, a.valor_servico, c.amount, 0) AS valor_origem
    FROM fiscal_notas n
    LEFT JOIN obra_movimentos om ON n.origem_tipo = 'obra_movimento' AND om.id = n.origem_id
    LEFT JOIN regularizacao_recebimentos rr ON n.origem_tipo = 'regularizacao_recebimento' AND rr.id = n.origem_id
    LEFT JOIN bpo_lancamentos l ON n.origem_tipo = 'bpo_lancamento' AND l.id = n.origem_id
    LEFT JOIN avaliacoes a ON n.origem_tipo = 'avaliacao' AND a.id = n.origem_id
    LEFT JOIN operational_commissions c ON n.origem_tipo = 'comissao_empresa' AND c.id = n.origem_id
    WHERE (n.data_evento BETWEEN ${deStr}::date AND ${ateStr}::date)
      ${idsBpo.length ? sql`OR (CASE WHEN n.origem_tipo = 'bpo_lancamento' THEN n.origem_id ELSE COALESCE(om.bpo_lancamento_id, rr.bpo_lancamento_id) END) IN (${sql.join(idsBpo.map(i => sql`${i}`), sql`, `)})` : sql``}
    ORDER BY n.id`);
  const notas: NotaDoRelatorio[] = ((r as { rows?: Record<string, unknown>[] }).rows ?? []).map(x => ({
    id: Number(x.id), status: x.status as StatusNota, motivoSemNota: (x.motivo_sem_nota as MotivoSemNota | null) ?? null,
    emissorId: x.emissor_id == null ? null : Number(x.emissor_id), origemTipo: x.origem_tipo as OrigemNota, origemId: Number(x.origem_id),
    dataEvento: String(x.data_evento), lancamentoBpoId: x.lancamento == null ? null : Number(x.lancamento), valorOrigemCentavos: centavos(x.valor_origem),
  }));
  return montarRelatorio({ competencia, de, ate, emissorId, movimentos: movements, lancamentosBpo, notas });
}

const ROTULO_CATEGORIA: Record<Categoria, string> = {
  com_nota: "Com nota", sem_nota: "Sem nota", a_decidir: "A decidir", outra_empresa: "Outra empresa", diferenca: "Diferença",
};

/** CSV (separador ";", vírgula decimal — abre direto no Excel em português). Sem CPF/CNPJ. */
export function relatorioEmCsv(r: Relatorio): string {
  // QA S-2 (M2): célula que começa com = + - @ (ou tab/CR) é fórmula no Excel/LibreOffice mesmo entre aspas — ganha "'" na
  // frente. A descrição pode vir de extrato bancário/importação (texto de terceiro). Valores numéricos são montados aqui.
  const campo = (v: string) => {
    const limpo = v.replace(/[\r\n]+/g, " ");
    const seguro = /^[=+\-@\t\r]/.test(v) && !/^-\d+(,\d+)?$/.test(v) ? `'${limpo}` : limpo;
    return `"${seguro.replace(/"/g, '""')}"`;
  };
  const valor = (c: number) => (c / 100).toFixed(2).replace(".", ",");
  const linhas = [
    ["Competência", "Fonte", "Registro", "Descrição", "Valor (R$)", "Situação", "Motivo", "Rascunho", "Observação"].map(campo).join(";"),
    ...r.linhas.map(l => [r.competencia, l.fonte === "bpo" ? "BPO" : "Financeiro", String(l.id), l.descricao, valor(l.centavos),
      ROTULO_CATEGORIA[l.categoria], l.motivo ? ROTULO_MOTIVO[l.motivo] : "", l.notaId ? String(l.notaId) : "", l.explicacao ?? ""].map(campo).join(";")),
    "",
    [campo("Receita realizada"), campo(valor(r.receitaRealizadaCentavos))].join(";"),
    [campo("Com nota"), campo(valor(r.comNotaCentavos))].join(";"),
    ...r.semNotaPorMotivo.map(m => [campo(`Sem nota — ${m.rotulo}`), campo(valor(m.centavos))].join(";")),
    [campo("A decidir"), campo(valor(r.aDecidirCentavos))].join(";"),
    [campo("Outra empresa"), campo(valor(r.outraEmpresaCentavos))].join(";"),
    [campo("Diferença"), campo(valor(r.diferencaCentavos))].join(";"),
  ];
  return "﻿" + linhas.join("\r\n");
}
