// EPIC-029 S-2 (22/11/2026) — rascunhos de nota: leitura (com os dados lidos das origens e dos cadastros, nunca copiados)
// e as decisões do dono (não emitir com motivo, depois, reabrir, editar). Emitir é RECUSADO até a homologação (S-4).
//
// Toda mudança passa por `mudar()`: confere a transição, exige a versão que a pessoa viu (edição concorrente é recusada)
// e grava `atualizado_por`/`alterado_via`, que o gatilho da 0154 copia no histórico imutável (fiscal_notas_historico).
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { fiscalEmissores, fiscalNotas, fiscalNotasHistorico, fiscalTiposServico, type FiscalNota, type ViaFiscal } from "../../drizzle/schema-fiscal.js";
import { problemaDoMotivo, type MotivoSemNota } from "../../shared/fiscal/motivos.js";
import { ROTULO_ORIGEM, type OrigemNota } from "../../shared/fiscal/origens.js";
import {
  AVISO_EMISSAO_INDISPONIVEL,
  EMISSAO_DISPONIVEL,
  exigeEmissao,
  transicaoValida,
  type StatusNota,
} from "../../shared/fiscal/status.js";
import type { DrizzleDb } from "../db.js";

type Linha = Record<string, unknown>;
const linhas = (r: unknown): Linha[] => (r as { rows?: Linha[] }).rows ?? [];
const centavos = (v: unknown) => Math.round(Number(v ?? 0) * 100);
const txt = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/** CNPJ só com os caracteres (aceita o alfanumérico). */
export function cnpjLimpo(valor: string | null | undefined): string {
  return (valor ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

export type DadosOrigem = {
  valorCentavos: number;
  descricao: string;
  competencia: string;
  centroCustos: string | null;
  /** Lançamento do BPO que representa esta receita no "Receita realizada" (o próprio, ou o ligado ao módulo). */
  bpoLancamentoId: number | null;
  /** Nome do tomador quando ele só existe no registro de origem (avaliação/regularização sem card do CRM). */
  tomadorNomeOrigem: string | null;
};

export type Tomador = { tipo: "bpo" | "crm" | "origem" | "nenhum"; nome: string | null; documento: string | null; cidade: string | null; uf: string | null };
export type EmissorLido = { id: number; cnpj: string; razaoSocial: string | null; regime: string | null; municipioNome: string | null; municipioUf: string | null; ambiente: string };

export type NotaDetalhada = FiscalNota & {
  origemRotulo: string;
  origem: DadosOrigem | null;
  valorSugeridoCentavos: number;
  valorCentavos: number;
  descricaoSugerida: string;
  descricao: string;
  tomador: Tomador;
  obra: { id: number; titulo: string; cidade: string | null; uf: string | null } | null;
  emissor: EmissorLido | null;
  tipoServico: { id: number; nome: string; codigoTributacaoNacional: string | null; codigoNbs: string | null; itemLc116: string | null; aliquotaIss: string | null; descricaoPadrao: string | null } | null;
  municipio: { nome: string | null; uf: string | null; fonte: "ajuste" | "obra" | "tomador" | "emissor" | "nenhum" };
};

const ids = (lista: number[]) => sql.join(lista.map(i => sql`${i}`), sql`, `);

async function origensPorTipo(db: DrizzleDb, notas: FiscalNota[]): Promise<Map<string, DadosOrigem>> {
  const mapa = new Map<string, DadosOrigem>();
  const porTipo = (t: OrigemNota) => notas.filter(n => n.origemTipo === t).map(n => n.origemId);
  const chave = (t: OrigemNota, id: unknown) => `${t}:${Number(id)}`;

  const bpo = porTipo("bpo_lancamento");
  if (bpo.length) for (const r of linhas(await db.execute(sql`
    SELECT id, valor, descricao, competencia, centro_custos, categoria FROM bpo_lancamentos WHERE id IN (${ids(bpo)})`))) {
    mapa.set(chave("bpo_lancamento", r.id), { valorCentavos: centavos(r.valor), descricao: String(r.descricao ?? ""), competencia: String(r.competencia ?? ""),
      centroCustos: txt(r.centro_custos) ?? txt(r.categoria), bpoLancamentoId: Number(r.id), tomadorNomeOrigem: null });
  }
  const obra = porTipo("obra_movimento");
  if (obra.length) for (const r of linhas(await db.execute(sql`
    SELECT om.id, om.valor, om.descricao, om.data::text AS data, om.bpo_lancamento_id, l.centro_custos, l.competencia
    FROM obra_movimentos om LEFT JOIN bpo_lancamentos l ON l.id = om.bpo_lancamento_id WHERE om.id IN (${ids(obra)})`))) {
    mapa.set(chave("obra_movimento", r.id), { valorCentavos: centavos(r.valor), descricao: String(r.descricao ?? ""),
      competencia: txt(r.competencia) ?? String(r.data).slice(0, 7), centroCustos: txt(r.centro_custos), bpoLancamentoId: r.bpo_lancamento_id == null ? null : Number(r.bpo_lancamento_id), tomadorNomeOrigem: null });
  }
  const reg = porTipo("regularizacao_recebimento");
  if (reg.length) for (const r of linhas(await db.execute(sql`
    SELECT rr.id, rr.valor, rr.data::text AS data, rr.bpo_lancamento_id, i.nome AS item, g.type AS tipo, g.client_name, l.centro_custos, l.competencia
    FROM regularizacao_recebimentos rr JOIN regularizacoes g ON g.id = rr.regularizacao_id
    LEFT JOIN regularizacao_itens_financeiros i ON i.id = rr.item_id LEFT JOIN bpo_lancamentos l ON l.id = rr.bpo_lancamento_id
    WHERE rr.id IN (${ids(reg)})`))) {
    mapa.set(chave("regularizacao_recebimento", r.id), { valorCentavos: centavos(r.valor), descricao: [r.item, r.tipo].filter(Boolean).join(" — "),
      competencia: txt(r.competencia) ?? String(r.data).slice(0, 7), centroCustos: txt(r.centro_custos), bpoLancamentoId: r.bpo_lancamento_id == null ? null : Number(r.bpo_lancamento_id), tomadorNomeOrigem: txt(r.client_name) });
  }
  const aval = porTipo("avaliacao");
  if (aval.length) for (const r of linhas(await db.execute(sql`
    SELECT id, numero, tipo, finalidade, valor_servico, cliente_nome, COALESCE(data_entrega, updated_at) AS quando FROM avaliacoes WHERE id IN (${ids(aval)})`))) {
    const n = notas.find(x => x.origemTipo === "avaliacao" && x.origemId === Number(r.id));
    mapa.set(chave("avaliacao", r.id), { valorCentavos: centavos(r.valor_servico), descricao: `Avaliação de imóvel nº ${r.numero} (${r.tipo}, ${r.finalidade})`,
      competencia: (n?.dataEvento ?? "").slice(0, 7), centroCustos: null, bpoLancamentoId: null, tomadorNomeOrigem: txt(r.cliente_nome) });
  }
  const com = porTipo("comissao_empresa");
  if (com.length) for (const r of linhas(await db.execute(sql`
    SELECT id, amount, business_type, property FROM operational_commissions WHERE id IN (${ids(com)})`))) {
    const n = notas.find(x => x.origemTipo === "comissao_empresa" && x.origemId === Number(r.id));
    mapa.set(chave("comissao_empresa", r.id), { valorCentavos: centavos(r.amount), descricao: `Comissão — ${r.business_type} — ${r.property}`,
      competencia: (n?.dataEvento ?? "").slice(0, 7), centroCustos: null, bpoLancamentoId: null, tomadorNomeOrigem: null });
  }
  return mapa;
}

/** Emissores com a razão social e o regime LIDOS do perfil tributário vigente do mesmo CNPJ (nunca copiados). */
export async function emissoresComPerfil(db: DrizzleDb): Promise<EmissorLido[]> {
  const emissores = await db.select().from(fiscalEmissores).orderBy(fiscalEmissores.id);
  if (!emissores.length) return [];
  const perfis = linhas(await db.execute(sql`
    SELECT DISTINCT ON (upper(regexp_replace(coalesce(cnpj, ''), '[^0-9A-Za-z]', '', 'g')))
      upper(regexp_replace(coalesce(cnpj, ''), '[^0-9A-Za-z]', '', 'g')) AS cnpj, company_name, regime
    FROM tax_profiles WHERE cnpj IS NOT NULL
    ORDER BY upper(regexp_replace(coalesce(cnpj, ''), '[^0-9A-Za-z]', '', 'g')), is_active DESC, effective_from DESC, id DESC`));
  return emissores.map(e => {
    const p = perfis.find(x => x.cnpj === e.cnpj);
    return { id: e.id, cnpj: e.cnpj, razaoSocial: txt(p?.company_name), regime: txt(p?.regime), municipioNome: e.municipioNome, municipioUf: e.municipioUf, ambiente: e.ambiente };
  });
}

export async function detalhar(db: DrizzleDb, notas: FiscalNota[]): Promise<NotaDetalhada[]> {
  if (!notas.length) return [];
  const origens = await origensPorTipo(db, notas);
  const uniq = (xs: (number | null)[]) => Array.from(new Set(xs.filter((x): x is number => x != null)));
  const clientes = uniq(notas.map(n => n.bpoClientId));
  const leads = uniq(notas.map(n => n.leadId));
  const obras = uniq(notas.map(n => n.obraId));
  const tiposIds = uniq(notas.map(n => n.tipoServicoId));
  const bc = clientes.length ? linhas(await db.execute(sql`SELECT id, razao_social, cnpj, cpf FROM bpo_clients WHERE id IN (${ids(clientes)})`)) : [];
  const ld = leads.length ? linhas(await db.execute(sql`SELECT id, name, cpf, city, state FROM leads WHERE id IN (${ids(leads)})`)) : [];
  const ob = obras.length ? linhas(await db.execute(sql`SELECT id, title, city, state FROM construction_projects WHERE id IN (${ids(obras)})`)) : [];
  const tipos = tiposIds.length ? await db.select().from(fiscalTiposServico).where(inArray(fiscalTiposServico.id, tiposIds)) : [];
  const emissores = await emissoresComPerfil(db);

  return notas.map(n => {
    const origem = origens.get(`${n.origemTipo}:${n.origemId}`) ?? null;
    const cliente = bc.find(c => Number(c.id) === n.bpoClientId);
    const lead = ld.find(l => Number(l.id) === n.leadId);
    const obraLinha = ob.find(o => Number(o.id) === n.obraId);
    const tipo = tipos.find(t => t.id === n.tipoServicoId) ?? null;
    const emissor = emissores.find(e => e.id === n.emissorId) ?? null;
    // Tomador por referência: cliente do BPO (PJ/PF) > card do CRM > nome do próprio registro de origem.
    const tomador: Tomador = cliente
      ? { tipo: "bpo", nome: txt(cliente.razao_social), documento: txt(cliente.cnpj) ?? txt(cliente.cpf), cidade: txt(lead?.city), uf: txt(lead?.state) }
      : lead
        ? { tipo: "crm", nome: txt(lead.name), documento: txt(lead.cpf), cidade: txt(lead.city), uf: txt(lead.state) }
        : origem?.tomadorNomeOrigem
          ? { tipo: "origem", nome: origem.tomadorNomeOrigem, documento: null, cidade: null, uf: null }
          : { tipo: "nenhum", nome: null, documento: null, cidade: null, uf: null };
    const obra = obraLinha ? { id: Number(obraLinha.id), titulo: String(obraLinha.title), cidade: txt(obraLinha.city), uf: txt(obraLinha.state) } : null;
    // ISS de obra é do município da obra; senão o do tomador; senão o do emissor.
    const municipio: NotaDetalhada["municipio"] = n.municipioIncidenciaNome
      ? { nome: n.municipioIncidenciaNome, uf: n.municipioIncidenciaUf, fonte: "ajuste" }
      : obra?.cidade
        ? { nome: obra.cidade, uf: obra.uf, fonte: "obra" }
        : tomador.cidade
          ? { nome: tomador.cidade, uf: tomador.uf, fonte: "tomador" }
          : emissor?.municipioNome
            ? { nome: emissor.municipioNome, uf: emissor.municipioUf, fonte: "emissor" }
            : { nome: null, uf: null, fonte: "nenhum" };
    const descricaoOrigem = origem?.descricao ?? "";
    const descricaoSugerida = [tipo?.descricaoPadrao, descricaoOrigem].filter(Boolean).join(" — ");
    const valorSugeridoCentavos = origem?.valorCentavos ?? 0;
    return {
      ...n,
      origemRotulo: ROTULO_ORIGEM[n.origemTipo],
      origem,
      valorSugeridoCentavos,
      valorCentavos: n.valorAjustadoCentavos ?? valorSugeridoCentavos,
      descricaoSugerida,
      descricao: n.descricaoAjustada ?? descricaoSugerida,
      tomador,
      obra,
      emissor,
      tipoServico: tipo ? { id: tipo.id, nome: tipo.nome, codigoTributacaoNacional: tipo.codigoTributacaoNacional, codigoNbs: tipo.codigoNbs, itemLc116: tipo.itemLc116, aliquotaIss: tipo.aliquotaIss, descricaoPadrao: tipo.descricaoPadrao } : null,
      municipio,
    };
  });
}

export type FiltrosNotas = {
  emissorId?: number | null;
  status?: StatusNota[];
  bpoClientId?: number;
  leadId?: number;
  obraId?: number;
  municipio?: string;
  de?: string;
  ate?: string;
};

export async function listarNotas(db: DrizzleDb, f: FiltrosNotas = {}): Promise<NotaDetalhada[]> {
  const conds: SQL[] = [];
  if (f.emissorId) conds.push(eq(fiscalNotas.emissorId, f.emissorId));
  if (f.status?.length) conds.push(inArray(fiscalNotas.status, f.status));
  if (f.bpoClientId) conds.push(eq(fiscalNotas.bpoClientId, f.bpoClientId));
  if (f.leadId) conds.push(eq(fiscalNotas.leadId, f.leadId));
  if (f.obraId) conds.push(eq(fiscalNotas.obraId, f.obraId));
  if (f.de) conds.push(gte(fiscalNotas.dataEvento, f.de));
  if (f.ate) conds.push(lte(fiscalNotas.dataEvento, f.ate));
  const notas = await db.select().from(fiscalNotas).where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(fiscalNotas.dataEvento), desc(fiscalNotas.id)).limit(500);
  const detalhadas = await detalhar(db, notas);
  const m = f.municipio?.trim().toLocaleLowerCase("pt-BR");
  return m ? detalhadas.filter(n => (n.municipio.nome ?? "").toLocaleLowerCase("pt-BR").includes(m)) : detalhadas;
}

export async function carregarNota(db: DrizzleDb, id: number): Promise<NotaDetalhada> {
  const [nota] = await db.select().from(fiscalNotas).where(eq(fiscalNotas.id, id)).limit(1);
  if (!nota) throw new TRPCError({ code: "NOT_FOUND", message: "Rascunho de nota não encontrado." });
  return (await detalhar(db, [nota]))[0]!;
}

export async function historicoDaNota(db: DrizzleDb, id: number) {
  const linhasHist = await db.select().from(fiscalNotasHistorico).where(eq(fiscalNotasHistorico.notaId, id)).orderBy(fiscalNotasHistorico.id);
  // Só o que mudou (sem repetir a linha inteira): quem, o quê, quando.
  const CAMPOS = ["status", "motivo_sem_nota", "motivo_texto", "adiada_ate", "valor_ajustado_centavos", "descricao_ajustada",
    "municipio_incidencia_nome", "municipio_incidencia_uf", "emissor_id", "tipo_servico_id", "alerta"] as const;
  const usuarios = Array.from(new Set(linhasHist.map(h => h.usuarioId).filter((x): x is number => x != null)));
  const nomes = usuarios.length ? linhas(await db.execute(sql`SELECT id, name FROM users WHERE id IN (${ids(usuarios)})`)) : [];
  return linhasHist.map(h => {
    const antes = (h.antes ?? {}) as Record<string, unknown>;
    const depois = (h.depois ?? {}) as Record<string, unknown>;
    const mudancas = CAMPOS.filter(c => h.antes == null ? depois[c] != null : JSON.stringify(antes[c]) !== JSON.stringify(depois[c]))
      .map(c => ({ campo: c, antes: h.antes == null ? null : antes[c] ?? null, depois: depois[c] ?? null }));
    return { id: h.id, acao: h.acao, via: h.via, quando: h.criadoEm, usuarioId: h.usuarioId,
      usuarioNome: txt(nomes.find(u => Number(u.id) === h.usuarioId)?.name), mudancas };
  });
}

type Autor = { usuarioId: number; via: ViaFiscal };

async function mudar(
  db: DrizzleDb,
  id: number,
  versao: number,
  autor: Autor,
  para: StatusNota | null,
  campos: Partial<typeof fiscalNotas.$inferInsert>,
): Promise<FiscalNota> {
  const [atual] = await db.select().from(fiscalNotas).where(eq(fiscalNotas.id, id)).limit(1);
  if (!atual) throw new TRPCError({ code: "NOT_FOUND", message: "Rascunho de nota não encontrado." });
  if (para && exigeEmissao(para)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: AVISO_EMISSAO_INDISPONIVEL });
  if (para && !transicaoValida(atual.status, para)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Não é possível passar de "${atual.status}" para "${para}".` });
  }
  if (!para && !["A_DECIDIR", "ADIADA"].includes(atual.status)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Só um rascunho a decidir (ou deixado para depois) pode ser editado. Reabra antes." });
  }
  const decisao = para && para !== "A_DECIDIR" ? { decididaPor: autor.usuarioId, decididaEm: new Date() } : {};
  const [salva] = await db.update(fiscalNotas)
    .set({ ...campos, ...(para ? { status: para } : {}), ...decisao, versao: sql`${fiscalNotas.versao} + 1`, atualizadoPor: autor.usuarioId, alteradoVia: autor.via })
    .where(and(eq(fiscalNotas.id, id), eq(fiscalNotas.versao, versao)))
    .returning();
  if (!salva) throw new TRPCError({ code: "CONFLICT", message: "Este rascunho foi alterado por outra pessoa. Atualize a tela e tente de novo." });
  return salva;
}

export function naoEmitir(db: DrizzleDb, e: { id: number; versao: number; motivo: MotivoSemNota | string; texto?: string | null } & Autor) {
  const problema = problemaDoMotivo(e.motivo, e.texto);
  if (problema) throw new TRPCError({ code: "BAD_REQUEST", message: problema });
  const texto = (e.texto ?? "").trim();
  return mudar(db, e.id, e.versao, e, "SEM_NOTA", {
    motivoSemNota: e.motivo as MotivoSemNota,
    motivoTexto: texto ? texto.slice(0, 500) : null,
    adiadaAte: null,
  });
}

export function adiar(db: DrizzleDb, e: { id: number; versao: number; ate?: string | null } & Autor) {
  return mudar(db, e.id, e.versao, e, "ADIADA", { adiadaAte: e.ate ?? null });
}

export function reabrir(db: DrizzleDb, e: { id: number; versao: number } & Autor) {
  return mudar(db, e.id, e.versao, e, "A_DECIDIR", { motivoSemNota: null, motivoTexto: null, adiadaAte: null });
}

export type Edicao = {
  id: number;
  versao: number;
  /** null = volta ao valor da origem. */
  valorCentavos?: number | null;
  descricao?: string | null;
  municipioNome?: string | null;
  municipioUf?: string | null;
  emissorId?: number | null;
  tipoServicoId?: number | null;
} & Autor;

export async function editar(db: DrizzleDb, e: Edicao) {
  const campos: Partial<typeof fiscalNotas.$inferInsert> = {};
  if (e.valorCentavos !== undefined) campos.valorAjustadoCentavos = e.valorCentavos;
  if (e.descricao !== undefined) campos.descricaoAjustada = e.descricao?.trim() ? e.descricao.trim() : null;
  if (e.municipioNome !== undefined) {
    const nome = e.municipioNome?.trim() || null;
    campos.municipioIncidenciaNome = nome;
    campos.municipioIncidenciaUf = nome ? (e.municipioUf ?? "").trim().toUpperCase() || null : null;
    campos.municipioIncidenciaIbge = null;
  }
  if (e.emissorId !== undefined) {
    if (e.emissorId != null) {
      const [em] = await db.select({ id: fiscalEmissores.id }).from(fiscalEmissores).where(eq(fiscalEmissores.id, e.emissorId)).limit(1);
      if (!em) throw new TRPCError({ code: "BAD_REQUEST", message: "Empresa emissora não encontrada." });
    }
    campos.emissorId = e.emissorId;
  }
  if (e.tipoServicoId !== undefined) {
    if (e.tipoServicoId != null) {
      const [t] = await db.select({ id: fiscalTiposServico.id }).from(fiscalTiposServico).where(eq(fiscalTiposServico.id, e.tipoServicoId)).limit(1);
      if (!t) throw new TRPCError({ code: "BAD_REQUEST", message: "Tipo de serviço não encontrado." });
    }
    campos.tipoServicoId = e.tipoServicoId;
  }
  if (!Object.keys(campos).length) throw new TRPCError({ code: "BAD_REQUEST", message: "Nada para alterar." });
  return mudar(db, e.id, e.versao, e, null, campos);
}

/** Emitir: SEMPRE recusado nesta etapa (o botão da tela também fica desabilitado). Nenhuma chamada de rede. */
// A S-4 troca esta função pela emissão real (e o gatilho da 0154); até lá `EMISSAO_DISPONIVEL` é false e nada muda.
export function emitir(): never {
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: EMISSAO_DISPONIVEL ? "Emissão ainda não implementada." : AVISO_EMISSAO_INDISPONIVEL,
  });
}

/** Contagem do cartão "Notas a decidir" (A_DECIDIR + ADIADA vencida), por empresa quando filtrado. */
export async function contarADecidir(db: DrizzleDb, emissorId?: number | null): Promise<number> {
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const r = linhas(await db.execute(sql`
    SELECT count(*)::int AS total FROM fiscal_notas
    WHERE (status = 'A_DECIDIR' OR (status = 'ADIADA' AND (adiada_ate IS NULL OR adiada_ate <= ${hoje}::date)))
      ${emissorId ? sql`AND emissor_id = ${emissorId}` : sql``}`));
  return Number(r[0]?.total ?? 0);
}
