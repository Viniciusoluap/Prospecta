// EPIC-027 C5-E4 — a Dolores avisa o dono sozinha. Decisões do dono (21/11): "tudo o que achar relevante", mas quem DECIDE são REGRAS
// do sistema (código, a partir dos dados); a IA só ESCREVE o texto (e pode ficar sem IA: sai o texto fixo). Regras deste arquivo:
// - Coleta por CÓDIGO, cada tipo numa transação SOMENTE LEITURA com tempo-limite, reaproveitando as leituras da Dolores (obras,
//   regularizações, notas de obra) e as regras das telas (tarefa atrasada, documento pendente). Nada aqui grava em módulo do sistema.
// - Estado por achado (dolores_avisos_achados, chave tipo+entidade): o mesmo achado não é avisado de novo enquanto nada mudou; reaviso
//   só quando sobe de faixa ou depois do intervalo de reaviso. Achado que sumiu (leitura completa) fica "resolvido".
// - Envio: SÓ ao número do dono, pela porta de sempre (whatsapp.ts#enviarAvisoAoDono: pausa, conexão, filtros de saída, memória da
//   conversa como "aviso"). Segunda a sábado, 07h–20h de Brasília; no máximo `max_por_dia` (≤ 6) por dia; intervalo mínimo entre
//   avisos; tudo o que está pendente vai AGRUPADO num aviso só. Fora da janela, acumula. Silenciado: nem lê, nem sai, nem conta.
// - A vaga de cada aviso é ÚNICA (dia + ordem, índice único da 0150): dois crons juntos → um envio. Envio que falhou gasta a vaga e não
//   tenta de novo na mesma chamada (sem laço); a próxima chamada (≥ intervalo) tenta de novo.
// - Proposta aberta esperando o "pode" do dono (adjacente): o aviso ESPERA (fica para a próxima chamada) — não tira da ordem uma
//   pergunta que ele está para responder. O aviso nunca abre proposta nem confirma nada.
// - IA (opcional, desligada por padrão): chamada SEM ferramentas e sem histórico, só com dados estruturados já limpos; gasto na parte
//   "avisos" (5%); bloqueio, estouro ou falha → texto fixo. A IA nunca decide enviar, para quem nem quando.
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { fiscalNotas } from "../../drizzle/schema-fiscal.js";
import { HORA_RESUMO_FISCAL, temPalavraComando } from "../../shared/dolores/fiscal.js";
import { bankAccounts, leadDocuments, leads, tasks } from "../../drizzle/schema.js";
import { doloresGrupos } from "../../drizzle/schema-dolores-grupos.js";
import { doloresAvisosAchados, doloresAvisosConfig, doloresAvisosEnvios, doloresAvisosTipos, type DoloresAvisosConfig } from "../../drizzle/schema-dolores-avisos.js";
import type { ReferenciaConversa } from "../../drizzle/schema-dolores-conversa.js";
import {
  DEGRAUS, LIMITES_PADRAO, MAX_ACHADOS_POR_TIPO, MAX_TOKENS_AVISO, SILENCIADOS_POR_PADRAO, SISTEMA_AVISOS, TIPOS_AVISO, TIPOS_COLETADOS, agruparPorTipo,
  chaveDoAchado, comPerguntaFiscal, dadosParaIA, dentroDaJanela, diaDosAvisos, faixaDe, montarAvisoFixo, precisaAvisar, silenciadoPelaLinha, textoDaIAValido,
  type Achado, type AchadoPendente, type GrupoDoAviso, type TipoAviso,
} from "../../shared/dolores/avisos.js";
import { diasEntre } from "../../shared/dolores/formato.js";
import { limparNomeDeTerceiro, relogioBrasilia } from "../../shared/dolores/operacao.js";
import { detalhar } from "../fiscal/notas.js";
import { sanitizarTexto } from "../../shared/dolores/sanitizar.js";
import { vozDaDolores } from "../../shared/dolores/voz.js";
import { responsavelDaTarefa } from "../../shared/dolores/regras.js";
import { tarefaAtrasada } from "../../shared/tarefas-filtro.js";
import { LEAD_FINALIZED_STAGE } from "../../shared/lead-pipeline.js";
import { getDb } from "../db.js";
import { registrarAcao } from "./auditoria.js";
import { liberarReservaAvisos, registrarConsumo, reservarAvisos } from "./consumo.js";
import { podeEnviarAvisoAgora } from "./pendencia.js";
import { FILTRO_DO_REGISTRO } from "./dados-pessoais.js";
import { erroParaLog } from "./erro-seguro.js";
import { docClientePendente } from "./leitura/comum.js";
import { apontarNotas, janelaDaConciliacao, notasDoBanco, paraConciliar } from "./leitura/notas.js";
import { carregarObras } from "./leitura/obras.js";
import { carregarProcessos } from "./leitura/regularizacoes.js";
import type { CredencialGrupo } from "./marcacao.js";
import { bloqueioDaOperacao } from "./operacao.js";
import { idDaDoloresSemCriar } from "./perfil.js";
import { bancoDaLeitura, emTransacaoSomenteLeitura } from "./somente-leitura.js";

export type ConfigAvisos = {
  ligado: boolean; iaNoTexto: boolean; maxPorDia: number; intervaloMinutos: number; reavisoDias: number;
  limites: typeof LIMITES_PADRAO; atualizadoEm: Date | null;
};

/** A configuração (linha única da 0150). Sem a migração ou sem a linha → null (quem chama trata como DESLIGADO). */
export async function lerConfigAvisos(): Promise<ConfigAvisos | null> {
  try {
    const [c] = await getDb().select().from(doloresAvisosConfig).where(eq(doloresAvisosConfig.id, 1)).limit(1);
    return c ? configDaLinha(c) : null;
  } catch { return null; }
}
export const configDaLinha = (c: DoloresAvisosConfig): ConfigAvisos => ({
  ligado: c.ligado, iaNoTexto: c.iaNoTexto, maxPorDia: Math.min(6, Math.max(1, c.maxPorDia)), intervaloMinutos: c.intervaloMinutos, reavisoDias: c.reavisoDias,
  limites: { obraAtrasoDias: c.obraAtrasoDias, tarefaVencidaDias: c.tarefaVencidaDias, documentoPendenteDias: c.documentoPendenteDias, notaConfirmacaoDias: c.notaConfirmacaoDias,
    regularizacaoParadaDias: c.regularizacaoParadaDias, grupoAguardandoHoras: c.grupoAguardandoHoras },
  atualizadoEm: c.atualizadoEm,
});

/**
 * Tipos silenciados: a linha da tabela vale; sem linha, o padrão do tipo (EPIC-029 S-3: "nota_fiscal" nasce silenciado —
 * SILENCIADOS_POR_PADRAO). Sem a migração → só os padrões (com os avisos desligados por falta de configuração, nada sai de qualquer jeito).
 */
export async function tiposSilenciados(): Promise<Set<TipoAviso>> {
  try {
    const r = await getDb().select({ tipo: doloresAvisosTipos.tipo, silenciado: doloresAvisosTipos.silenciado }).from(doloresAvisosTipos);
    const linhas = new Map(r.map(x => [x.tipo, x]));
    return new Set(TIPOS_AVISO.filter(t => silenciadoPelaLinha(t, linhas.get(t))));
  } catch { return new Set(SILENCIADOS_POR_PADRAO); }
}

/** Um tipo está silenciado? Falha ao ler → false (o alerta do gasto, que chama isto, continua saindo: lado seguro para o dono). */
export async function tipoSilenciado(tipo: TipoAviso): Promise<boolean> {
  try {
    const [r] = await getDb().select({ silenciado: doloresAvisosTipos.silenciado }).from(doloresAvisosTipos).where(eq(doloresAvisosTipos.tipo, tipo)).limit(1);
    return silenciadoPelaLinha(tipo, r);
  } catch { return false; }
}

/** Silencia ou religa um tipo (tela ou conversa com o "pode"). `banco`: a transação de escrita da ação, quando houver. */
export async function definirSilencio(p: { tipo: TipoAviso; silenciado: boolean; porUserId: number | null; via: "tela" | "whatsapp"; agora?: Date },
  banco: Pick<ReturnType<typeof getDb>, "insert"> = getDb()): Promise<void> {
  const agora = p.agora ?? new Date();
  await banco.insert(doloresAvisosTipos).values({ tipo: p.tipo, silenciado: p.silenciado, via: p.via, atualizadoEm: agora, atualizadoPor: p.porUserId })
    .onConflictDoUpdate({ target: doloresAvisosTipos.tipo, set: { silenciado: p.silenciado, via: p.via, atualizadoEm: agora, atualizadoPor: p.porUserId } });
}

// ── Coleta (regras por código) ────────────────────────────────────────────────────────────────────────────────────

type Coleta = { achados: Achado[]; completo: boolean };
type CtxColeta = { agora: Date; limites: ConfigAvisos["limites"] };
const DIA_MS = 86_400_000;
const nomeLimpo = (s: string | null | undefined) => limparNomeDeTerceiro(sanitizarTexto(String(s ?? ""), FILTRO_DO_REGISTRO));
const corte = (lista: Achado[]): Coleta => {
  const ordenada = lista.sort((a, b) => b.faixa - a.faixa || (b.dados.dias ?? 0) - (a.dados.dias ?? 0));
  return { achados: ordenada.slice(0, MAX_ACHADOS_POR_TIPO), completo: ordenada.length <= MAX_ACHADOS_POR_TIPO };
};

/** As regras de cada tipo (o "gasto" não está aqui: é o alerta da E5). Cada uma lê só, numa transação somente leitura. */
export const REGRAS: Record<Exclude<TipoAviso, "gasto">, (c: CtxColeta) => Promise<Coleta>> = {
  // obra não concluída com a previsão de término vencida há N dias ou mais (mesma conta de listar_obras/listar_atrasos)
  obra_atrasada: async ({ agora, limites }) => {
    const n = limites.obraAtrasoDias;
    const obras = await carregarObras(agora);
    return corte(obras.filter(o => !o.encerrada && o.atrasada && (o.diasDeAtraso ?? 0) >= n).map(o => ({
      tipo: "obra_atrasada" as const, entidade: `obra:${o.id}`, faixa: faixaDe(o.diasDeAtraso, n, DEGRAUS.obra_atrasada),
      dados: { nome: nomeLimpo(o.obra ?? o.cliente), dias: o.diasDeAtraso, ref: { tipo: "obra" as const, id: o.id } },
    })));
  },
  // tarefa aberta vencida há N dias ou mais (regra "atrasada" da tela de Tarefas), sem responsável ou sem nenhuma mudança há N dias
  tarefa_vencida: async ({ agora, limites }) => {
    const n = limites.tarefaVencidaDias;
    const limite = new Date(agora.getTime() - n * DIA_MS);
    const linhas = await bancoDaLeitura().select({ id: tasks.id, title: tasks.title, status: tasks.status, assignedTo: tasks.assignedTo, dueAt: tasks.dueAt, updatedAt: tasks.updatedAt })
      .from(tasks).where(and(inArray(tasks.status, ["pending", "in_progress"]), isNotNull(tasks.dueAt), lt(tasks.dueAt, limite))).orderBy(asc(tasks.dueAt)).limit(MAX_ACHADOS_POR_TIPO + 1);
    const achados: Achado[] = [];
    for (const t of linhas) {
      if (!tarefaAtrasada(t, agora)) continue;
      const semDono = responsavelDaTarefa(t.assignedTo) === "sem responsável";
      const semMovimento = t.updatedAt.getTime() <= limite.getTime();
      if (!semDono && !semMovimento) continue;
      const dias = diasEntre(t.dueAt, agora);
      achados.push({ tipo: "tarefa_vencida", entidade: `tarefa:${t.id}`, faixa: faixaDe(dias, n, DEGRAUS.tarefa_vencida),
        dados: { nome: nomeLimpo(t.title), dias, marca: semDono ? "sem_dono" : "sem_movimento", ref: { tipo: "tarefa", id: t.id } } });
    }
    const c = corte(achados);
    return { ...c, completo: c.completo && linhas.length <= MAX_ACHADOS_POR_TIPO };
  },
  // documento pendente (regra docClientePendente da leitura de documentos) no card do cliente (CRM) há N dias ou mais, por cliente
  documento_pendente: async ({ agora, limites }) => {
    const n = limites.documentoPendenteDias;
    const limite = new Date(agora.getTime() - n * DIA_MS);
    const linhas = await bancoDaLeitura().select({ leadId: leadDocuments.leadId, cliente: leads.name, status: leadDocuments.status, criadoEm: leadDocuments.createdAt })
      .from(leadDocuments).innerJoin(leads, eq(leads.id, leadDocuments.leadId))
      .where(and(isNull(leadDocuments.deletedAt), isNull(leads.deletedAt), ne(leads.stage, LEAD_FINALIZED_STAGE), inArray(leadDocuments.status, ["pending", "rejected"]), lte(leadDocuments.createdAt, limite)))
      .orderBy(asc(leadDocuments.createdAt)).limit(2_000);
    const porCliente = new Map<number, { nome: string; quantidade: number; maisAntigo: Date }>();
    for (const d of linhas) {
      if (!docClientePendente(d.status)) continue;
      const c = porCliente.get(d.leadId) ?? { nome: d.cliente, quantidade: 0, maisAntigo: d.criadoEm };
      c.quantidade++;
      if (d.criadoEm < c.maisAntigo) c.maisAntigo = d.criadoEm;
      porCliente.set(d.leadId, c);
    }
    const c = corte(Array.from(porCliente, ([leadId, v]) => {
      const dias = Math.floor((agora.getTime() - v.maisAntigo.getTime()) / DIA_MS);
      return { tipo: "documento_pendente" as const, entidade: `lead:${leadId}`, faixa: faixaDe(dias, n, DEGRAUS.documento_pendente),
        dados: { nome: nomeLimpo(v.nome), dias, quantidade: v.quantidade, ref: { tipo: "cliente" as const, id: leadId } } };
    }));
    return { ...c, completo: c.completo && linhas.length < 2_000 };
  },
  // nota de obra lida (rascunho/a conferir) sem confirmação do empreiteiro há N dias, ou com divergência na conciliação com o BPO
  nota_obra: async ({ agora, limites }) => {
    const n = limites.notaConfirmacaoDias;
    const conexao = bancoDaLeitura();
    const linhas = await notasDoBanco(conexao, { abertas: true, limite: 300 });
    const janela = await janelaDaConciliacao(conexao);
    const aps = await apontarNotas(conexao, linhas.map(l => paraConciliar(l.n)), janela);
    const achados: Achado[] = [];
    for (const { n: nota, obra, enviadaEm } of linhas) {
      if (nota.duplicadaDe) continue;
      const nome = nomeLimpo(nota.emitenteNome ?? obra);
      if (aps.get(nota.id)?.apontamento.situacao === "divergente") {
        achados.push({ tipo: "nota_obra", entidade: `nota:${nota.id}:divergencia`, faixa: 1, dados: { nome, marca: "divergente", ref: { tipo: "nota", id: nota.id } } });
      }
      // EPIC-029 S-5: só a nota de GRUPO espera confirmação do empreiteiro; a recebida pelo ADN só entra pela divergência acima
      if (nota.origem === "grupo" && nota.confirmacao === "pendente" && (nota.situacao === "rascunho" || nota.situacao === "confira")) {
        const dias = Math.floor((agora.getTime() - (enviadaEm ?? nota.criadoEm).getTime()) / DIA_MS);
        if (dias >= n) achados.push({ tipo: "nota_obra", entidade: `nota:${nota.id}:confirmacao`, faixa: faixaDe(dias, n, DEGRAUS.nota_obra), dados: { nome, dias, marca: "sem_confirmacao", ref: { tipo: "nota", id: nota.id } } });
      }
    }
    const c = corte(achados);
    return { ...c, completo: c.completo && linhas.length < 300 };
  },
  // processo de regularização sem nenhuma movimentação há N dias ou mais (mesma conta de listar_processos_regularizacao)
  regularizacao_parada: async ({ agora, limites }) => {
    const n = limites.regularizacaoParadaDias;
    const processos = await carregarProcessos(null, agora, "whatsapp", n);
    return corte(processos.filter(p => !p.encerrado && p.parado && (p.diasSemMovimentacao ?? 0) >= n).map(p => ({
      tipo: "regularizacao_parada" as const, entidade: `processo:${p.id}`, faixa: faixaDe(p.diasSemMovimentacao, n, DEGRAUS.regularizacao_parada),
      dados: { nome: nomeLimpo(p.cliente), dias: p.diasSemMovimentacao, ref: { tipo: "processo" as const, id: p.id } },
    })));
  },
  // grupo em que ela entrou e que espera a decisão do dono (entrada sem prova / tipo não identificado) há N horas ou mais
  grupo_aguardando: async ({ agora, limites }) => {
    const n = limites.grupoAguardandoHoras;
    const linhas = await bancoDaLeitura().select({ id: doloresGrupos.id, nome: doloresGrupos.nome, situacao: doloresGrupos.situacaoConfirmacao, criadoEm: doloresGrupos.criadoEm })
      .from(doloresGrupos).where(and(eq(doloresGrupos.ativo, true), inArray(doloresGrupos.situacaoConfirmacao, ["aguardando_dono", "recusado"]),
        lte(doloresGrupos.criadoEm, new Date(agora.getTime() - n * 3_600_000)))).orderBy(asc(doloresGrupos.criadoEm)).limit(MAX_ACHADOS_POR_TIPO + 1);
    const c = corte(linhas.map(g => {
      const horas = Math.floor((agora.getTime() - g.criadoEm.getTime()) / 3_600_000);
      return { tipo: "grupo_aguardando" as const, entidade: `grupo:${g.id}`, faixa: faixaDe(horas, n, DEGRAUS.grupo_aguardando),
        dados: { nome: nomeLimpo(g.nome), dias: horas, marca: g.situacao === "recusado" ? "recusado" as const : "aguardando" as const, ref: { tipo: "grupo" as const, id: g.id } } };
    }));
    return { ...c, completo: c.completo && linhas.length <= MAX_ACHADOS_POR_TIPO };
  },
  // conta bancária ligada a um provedor (Asaas/Pluggy) com erro na última sincronização (o sistema já grava o erro): só o nome do banco
  // EPIC-029 S-3 — rascunho de nota fiscal (NFS-e) a decidir, ou deixado para depois com a data já chegada (o deixado "sem data" fica
  // quieto: o dono disse depois). Os dados são os da aba Contabilidade (server/fiscal/notas.ts#detalhar): nome do tomador, valor, serviço
  // e município — nunca CPF/CNPJ. A partir das 18h (rota dos avisos das 18h, sem cron novo) entra também o achado do RESUMO do dia
  // (um por dia): com ele, o aviso leva TODOS os rascunhos pendentes num bloco só ("Você tem 4 notas a decidir, somando …").
  nota_fiscal: async ({ agora }) => {
    const r = relogioBrasilia(agora);
    const conexao = bancoDaLeitura();
    const linhas = await conexao.select().from(fiscalNotas)
      .where(or(eq(fiscalNotas.status, "A_DECIDIR"), and(eq(fiscalNotas.status, "ADIADA"), isNotNull(fiscalNotas.adiadaAte), lte(fiscalNotas.adiadaAte, r.dia))))
      .orderBy(asc(fiscalNotas.id)).limit(MAX_ACHADOS_POR_TIPO + 1);
    const notas = await detalhar(conexao, linhas.slice(0, MAX_ACHADOS_POR_TIPO));
    const achados: Achado[] = notas.map(n => ({
      tipo: "nota_fiscal" as const, entidade: `fiscal:${n.id}`, faixa: 1,
      dados: { nome: nomeLimpo(n.tomador.nome) || "tomador não identificado", valorCentavos: n.valorCentavos, servico: nomeLimpo(n.tipoServico?.nome) || null,
        municipio: n.municipio.nome ? nomeLimpo(`${n.municipio.nome}${n.municipio.uf ? ` - ${n.municipio.uf}` : ""}`) : null,
        marca: n.status === "ADIADA" ? "adiada_vencida" as const : null, ref: { tipo: "nota_fiscal" as const, id: n.id } },
    }));
    const completo = linhas.length <= MAX_ACHADOS_POR_TIPO;
    if (r.hora >= HORA_RESUMO_FISCAL && achados.length) {
      achados.push({ tipo: "nota_fiscal", entidade: `fiscal:resumo:${r.dia}`, faixa: 1,
        dados: { nome: "resumo do dia", resumo: true, quantidade: achados.length, valorCentavos: notas.reduce((s, n) => s + n.valorCentavos, 0) } });
    }
    return { achados, completo };
  },
  integracao: async () => {
    const linhas = await bancoDaLeitura().select({ id: bankAccounts.id, banco: bankAccounts.banco }).from(bankAccounts)
      .where(and(eq(bankAccounts.ativo, true), ne(bankAccounts.provedor, "manual"), isNotNull(bankAccounts.ultimoErro))).limit(MAX_ACHADOS_POR_TIPO + 1);
    const c = corte(linhas.map(b => ({ tipo: "integracao" as const, entidade: `conta:${b.id}`, faixa: 1, dados: { nome: nomeLimpo(b.banco), marca: "erro_sincronizacao" as const } })));
    return { ...c, completo: c.completo && linhas.length <= MAX_ACHADOS_POR_TIPO };
  },
};

/** Grava o estado dos achados desta leitura (idempotente) e marca como resolvidos os que sumiram (só com a leitura completa). */
async function gravarAchados(tipo: TipoAviso, c: Coleta, agora: Date): Promise<void> {
  const db = getDb();
  for (let i = 0; i < c.achados.length; i += 100) {
    const lote = c.achados.slice(i, i + 100);
    await db.insert(doloresAvisosAchados).values(lote.map(a => ({ chave: chaveDoAchado(a), tipo: a.tipo, faixa: a.faixa, dados: a.dados, vistoEm: agora, criadoEm: agora })))
      .onConflictDoUpdate({ target: doloresAvisosAchados.chave, set: {
        faixa: sql`excluded.faixa`, dados: sql`excluded.dados`, vistoEm: sql`excluded.visto_em`,
        // voltou depois de resolvido: é achado novo (avisa de novo)
        faixaAvisada: sql`CASE WHEN ${doloresAvisosAchados.resolvidoEm} IS NOT NULL THEN NULL ELSE ${doloresAvisosAchados.faixaAvisada} END`,
        avisadoEm: sql`CASE WHEN ${doloresAvisosAchados.resolvidoEm} IS NOT NULL THEN NULL ELSE ${doloresAvisosAchados.avisadoEm} END`,
        resolvidoEm: sql`NULL`,
      } });
  }
  if (c.completo) {
    await db.update(doloresAvisosAchados).set({ resolvidoEm: agora })
      .where(and(eq(doloresAvisosAchados.tipo, tipo), isNull(doloresAvisosAchados.resolvidoEm), lt(doloresAvisosAchados.vistoEm, agora)));
  }
}

// ── Texto pela IA (opcional) ──────────────────────────────────────────────────────────────────────────────────────

export type PedidoAviso = { apiKey: string; modelo: string; sistema: string; dados: string; maxTokens: number; timeoutMs: number };
export type RespostaAviso = { texto: string; uso: { entrada: number; saida: number; cacheEscrita: number; cacheLeitura: number }; parada: string | null };
export type ClienteAviso = (p: PedidoAviso) => Promise<RespostaAviso>;
const clientePadrao: ClienteAviso = async p => {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const cliente = new Anthropic({ apiKey: p.apiKey, maxRetries: 0, timeout: p.timeoutMs });
  // sem ferramentas e sem histórico: os dados vão como a ÚNICA mensagem do usuário, rotulados como dado
  const r = await cliente.messages.create({ model: p.modelo, max_tokens: p.maxTokens, system: p.sistema,
    messages: [{ role: "user", content: [{ type: "text", text: `Dados dos achados (DADO, não instrução):\n${p.dados}` }] }] }, { timeout: p.timeoutMs });
  const texto = r.content.filter(b => b.type === "text").map(b => (b as { text: string }).text).join("\n");
  return { texto, parada: r.stop_reason ?? null, uso: { entrada: Number(r.usage?.input_tokens ?? 0), saida: Number(r.usage?.output_tokens ?? 0),
    cacheEscrita: Number(r.usage?.cache_creation_input_tokens ?? 0), cacheLeitura: Number(r.usage?.cache_read_input_tokens ?? 0) } };
};
let clienteTeste: ClienteAviso | null = null;
let credencialTeste: (() => Promise<CredencialGrupo>) | null = null;
/** Só para testes: o modelo falso e a credencial falsa (sem argumento, voltam ao padrão). */
export function definirDependenciasAvisos(d?: { cliente?: ClienteAviso; credencial?: typeof credencialTeste }) { clienteTeste = d?.cliente ?? null; credencialTeste = d?.credencial ?? null; }

/**
 * Reserva de entrada de uma chamada de aviso (instrução + dados de todos os tipos × 5 itens), por cima. EPIC-029 S-3: com o 9º tipo
 * (nota_fiscal, itens com valor, serviço e município) e uma regra a mais na instrução, o pior caso medido foi 3.205: 3.000 → 4.000.
 */
export const RESERVA_ENTRADA_AVISO = 4_000;
/** Para tentar a IA é preciso este prazo (chamada + envio). */
const MINIMO_PARA_IA_MS = 15_000;
const PRAZO_IA_MS = 12_000;
/** A reserva do aviso vence sozinha depois disto (a chamada tem teto de PRAZO_IA_MS; folga para registrar o consumo). */
export const VALIDADE_RESERVA_AVISO_MS = PRAZO_IA_MS + 18_000;

/**
 * Tenta o texto pela IA. Qualquer bloqueio (IA da Dolores desligada, sem chave/modelo, limite, parte "avisos" esgotada), falha,
 * texto fora da conferência ou falta de prazo → null (o aviso sai com o texto fixo). Nunca lança.
 */
async function textoPelaIA(grupos: readonly GrupoDoAviso[], agora: Date, prazoFinal: number, relogio: () => number, envioId: number): Promise<{ texto: string } | { texto: null; motivo: string }> {
  if (prazoFinal - relogio() < MINIMO_PARA_IA_MS) return { texto: null, motivo: "sem_tempo" };
  try {
    const cred = credencialTeste ? await credencialTeste() : await (await import("./whatsapp.js")).credencialDosAvisos();
    if (cred.motivo !== null) return { texto: null, motivo: String(cred.motivo) };
    // integração 2 (revisor do PR #298): a reserva fica gravada na vaga deste aviso enquanto a chamada está em voo — as outras
    // conferências (conversa do dono, classificação, grupo, cliente) a enxergam; solta depois do consumo real ou na falha (finally)
    // e vence sozinha se a função morrer no meio
    const bloqueio = await reservarAvisos({ mes: cred.mes, limites: cred.limites, reserva: { entrada: RESERVA_ENTRADA_AVISO, saida: MAX_TOKENS_AVISO },
      envioId, validadeMs: VALIDADE_RESERVA_AVISO_MS });
    if (bloqueio) return { texto: null, motivo: bloqueio };
    let r: RespostaAviso;
    try {
      try {
        r = await (clienteTeste ?? clientePadrao)({ apiKey: cred.apiKey, modelo: cred.modelo, sistema: SISTEMA_AVISOS, dados: dadosParaIA(grupos, agora),
          maxTokens: MAX_TOKENS_AVISO, timeoutMs: Math.min(PRAZO_IA_MS, Math.max(1_000, prazoFinal - relogio() - 5_000)) });
      } catch (e) {
        console.error("[dolores/avisos] a IA não respondeu; vai o texto fixo", (e as { status?: number })?.status ?? (e instanceof Error ? e.name : "erro"));
        return { texto: null, motivo: "erro_modelo" };
      }
      await registrarConsumo({ mes: cred.mes, mensagemId: null, modelo: cred.modelo, volta: 1, uso: r.uso, parada: r.parada, funcao: "avisos" });
    } finally {
      await liberarReservaAvisos(envioId);
    }
    const valido = textoDaIAValido(r.parada === "max_tokens" ? null : r.texto);
    if (!valido) return { texto: null, motivo: "texto_recusado" };
    return { texto: vozDaDolores(valido).texto };
  } catch (e) {
    console.error("[dolores/avisos] falha ao preparar o texto pela IA; vai o texto fixo", erroParaLog(e));
    return { texto: null, motivo: "erro" };
  }
}

// ── Envio ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ResultadoAvisos = { r: string; envioId?: number; itens?: number; comIa?: boolean; lidos?: number; falhas?: string[] };
/** Cada tipo só começa com pelo menos isto de prazo. */
const MINIMO_POR_TIPO_MS = 3_000;
/** O envio só começa com pelo menos isto de prazo. */
const MINIMO_PARA_ENVIAR_MS = 6_000;
/** Achado não relido nesta chamada (faltou tempo) ainda vale se foi visto há menos disto. */
const VALIDADE_DO_ACHADO_MS = 26 * 3_600_000;
/** Teto do tempo de cada consulta de um tipo. */
const TETO_CONSULTA_MS = 10_000;

const PRAZO_PADRAO_MS = 40_000;

/**
 * Integração 2 (EPIC-027 C5): a regra "proposta aberta segura o aviso" é a MESMA dos alertas de gasto — o ponto único
 * pendencia.ts#podeEnviarAvisoAgora (aberta, no prazo e confirmável, ou com a pergunta ainda saindo; falha ao ler → espera).
 */
const propostaEsperando = async (agora: Date) => !(await podeEnviarAvisoAgora(agora));

/**
 * Uma rodada dos avisos (cron): configuração → pausa → coleta dos tipos não silenciados → janela → proposta esperando → pendentes →
 * teto do dia e intervalo → vaga única → texto (IA ou fixo) → envio ao dono → estado. Nunca lança.
 */
export async function executarAvisos(p: { agora: Date; prazoFinal?: number; relogio?: () => number; canal?: "cron" | "tela" }): Promise<ResultadoAvisos> {
  const relogio = p.relogio ?? Date.now;
  const prazoFinal = p.prazoFinal ?? relogio() + PRAZO_PADRAO_MS;
  const canal = p.canal ?? "cron";
  const agora = p.agora;
  try {
    const cfg = await lerConfigAvisos();
    if (!cfg) return { r: "sem-configuracao" };
    if (!cfg.ligado) return { r: "desligado" };
    const bloqueio = await bloqueioDaOperacao();
    if (bloqueio) return { r: bloqueio.motivo };
    const silenciados = await tiposSilenciados();
    const ativos = TIPOS_COLETADOS.filter(t => !silenciados.has(t)) as Array<Exclude<TipoAviso, "gasto">>;
    // 1) coleta (por código): cada tipo numa leitura própria; o que falha ou fica sem tempo não derruba os outros
    const falhas: string[] = [];
    let lidos = 0;
    for (const tipo of ativos) {
      const resta = prazoFinal - relogio();
      if (resta < MINIMO_POR_TIPO_MS + MINIMO_PARA_ENVIAR_MS) { falhas.push(tipo); continue; }
      try {
        const c = await emTransacaoSomenteLeitura(() => REGRAS[tipo]({ agora, limites: cfg.limites }), { tempoLimiteMs: Math.min(TETO_CONSULTA_MS, Math.max(1_000, resta - MINIMO_PARA_ENVIAR_MS)) });
        await gravarAchados(tipo, c, agora);
        lidos++;
      } catch (e) {
        console.error("[dolores/avisos] regra falhou", tipo, erroParaLog(e));
        falhas.push(tipo);
      }
    }
    // 2) fora da janela (domingo, noite): o estado já ficou gravado; o aviso fica para a próxima janela
    if (!dentroDaJanela(agora)) return { r: "fora-da-janela", lidos, falhas };
    // 3) proposta esperando o "pode" do dono: o aviso espera (não tira a pergunta da ordem)
    if (await propostaEsperando(agora)) return { r: "proposta-aberta", lidos, falhas };
    // 4) pendentes: não resolvidos, de tipo ativo, vistos há pouco, que precisam de aviso (novo, subiu de faixa ou reaviso)
    if (!ativos.length) return { r: "nada-novo", lidos, falhas };
    const candidatos = await getDb().select().from(doloresAvisosAchados).where(and(inArray(doloresAvisosAchados.tipo, ativos), isNull(doloresAvisosAchados.resolvidoEm),
      gte(doloresAvisosAchados.vistoEm, new Date(agora.getTime() - VALIDADE_DO_ACHADO_MS)))).orderBy(desc(doloresAvisosAchados.faixa), asc(doloresAvisosAchados.id)).limit(2_000);
    const paraPendente = (a: (typeof candidatos)[number]): AchadoPendente => ({ id: a.id, tipo: a.tipo, entidade: a.chave, faixa: a.faixa, dados: a.dados, faixaAvisada: a.faixaAvisada });
    const pendentes: AchadoPendente[] = candidatos.filter(a => precisaAvisar({ faixaAvisada: a.faixaAvisada, avisadoEm: a.avisadoEm }, a.faixa, agora, cfg.reavisoDias)).map(paraPendente);
    // EPIC-029 S-3: o resumo do dia das notas fiscais (um achado por dia, a partir das 18h) leva TODOS os rascunhos pendentes, já avisados ou não
    if (pendentes.some(a => a.tipo === "nota_fiscal" && a.dados.resumo)) {
      const ja = new Set(pendentes.map(a => a.id));
      for (const a of candidatos) if (a.tipo === "nota_fiscal" && !ja.has(a.id)) pendentes.push(paraPendente(a));
    }
    if (!pendentes.length) return { r: "nada-novo", lidos, falhas };
    // 5) teto do dia e intervalo mínimo (envio que falhou também conta: sem laço)
    const dia = diaDosAvisos(agora);
    const doDia = await getDb().select({ ordem: doloresAvisosEnvios.ordem, criadoEm: doloresAvisosEnvios.criadoEm }).from(doloresAvisosEnvios)
      .where(eq(doloresAvisosEnvios.dia, dia)).orderBy(desc(doloresAvisosEnvios.ordem));
    if (doDia.length >= cfg.maxPorDia) return { r: "limite-do-dia", lidos, falhas };
    const [ultimo] = await getDb().select({ criadoEm: doloresAvisosEnvios.criadoEm }).from(doloresAvisosEnvios).orderBy(desc(doloresAvisosEnvios.criadoEm)).limit(1);
    if (ultimo && agora.getTime() - ultimo.criadoEm.getTime() < cfg.intervaloMinutos * 60_000) return { r: "intervalo", lidos, falhas };
    if (prazoFinal - relogio() < MINIMO_PARA_ENVIAR_MS) return { r: "sem-tempo", lidos, falhas };
    // 6) a vaga: (dia, ordem) único — dois crons juntos, um só envia
    const ordem = (doDia[0]?.ordem ?? 0) + 1;
    if (ordem > cfg.maxPorDia) return { r: "limite-do-dia", lidos, falhas };
    const [vaga] = await getDb().insert(doloresAvisosEnvios).values({ dia, ordem, criadoEm: agora }).onConflictDoNothing().returning({ id: doloresAvisosEnvios.id });
    if (!vaga) return { r: "outro-envio", lidos, falhas };
    // 7) o texto: a IA só escreve (se ligada e com orçamento); senão, o fixo
    const grupos = agruparPorTipo(pendentes);
    const fixo = montarAvisoFixo(grupos, agora);
    const iaBruta = cfg.iaNoTexto ? await textoPelaIA(grupos, agora, prazoFinal, relogio, vaga.id) : { texto: null, motivo: "ia_desligada" };
    // EPIC-029 S-3: com rascunho de nota fiscal, o texto da IA não pode trazer palavra-comando nem pedido de resposta (senão, o fixo) e
    // termina com a mesma pergunta natural do texto fixo (por código)
    const temFiscal = grupos.some(g => g.tipo === "nota_fiscal");
    const ia: { texto: string | null; motivo?: string } = iaBruta.texto && temFiscal
      ? (temPalavraComando(iaBruta.texto) ? { texto: null, motivo: "texto_recusado" } : { texto: comPerguntaFiscal(iaBruta.texto, grupos) })
      : iaBruta;
    const texto = ia.texto ?? fixo;
    const tipos = Object.fromEntries(grupos.map(g => [g.tipo, g.total]));
    const refs: ReferenciaConversa[] = grupos.flatMap(g => g.itens.slice(0, 5)).filter(a => a.dados.ref && a.dados.nome)
      .slice(0, 12).map(a => ({ tipo: a.dados.ref!.tipo, id: a.dados.ref!.id, rotulo: a.dados.nome }));
    const autor = await idDaDoloresSemCriar().catch(() => null);
    // Integração 2: de novo logo antes do envio (a IA pode ter levado segundos e o dono pode ter aberto uma proposta no meio). Nada
    // saiu: a vaga é devolvida (não conta no teto do dia) e o aviso fica para a próxima chamada, como no passo 3.
    if (await propostaEsperando(agora)) {
      await getDb().delete(doloresAvisosEnvios).where(and(eq(doloresAvisosEnvios.id, vaga.id), eq(doloresAvisosEnvios.situacao, "enviando"))).catch(() => undefined);
      return { r: "proposta-aberta", lidos, falhas };
    }
    if (prazoFinal - relogio() < MINIMO_PARA_ENVIAR_MS) {
      await getDb().delete(doloresAvisosEnvios).where(and(eq(doloresAvisosEnvios.id, vaga.id), eq(doloresAvisosEnvios.situacao, "enviando"))).catch(() => undefined);
      return { r: "sem-tempo", lidos, falhas };
    }
    const { enviarAvisoAoDono } = await import("./whatsapp.js");
    const envio = await enviarAvisoAoDono(texto, { funcao: "aviso_proativo", pedidoId: `aviso:${vaga.id}`, autor, prazoFinal, canal,
      resumo: { envioId: vaga.id, ordem, itens: pendentes.length, tipos, comIa: Boolean(ia.texto), ...(ia.texto ? {} : { semIa: "motivo" in ia ? ia.motivo : null }) }, referencias: refs });
    // 8) estado: enviado → os achados ficam "avisados" na faixa atual; falhou → continuam pendentes (a vaga foi gasta: sem laço)
    await getDb().update(doloresAvisosEnvios).set({ situacao: envio.ok ? "enviado" : "falhou", texto: sanitizarTexto(texto, FILTRO_DO_REGISTRO).slice(0, 4000),
      tipos, itens: pendentes.length, comIa: Boolean(ia.texto), motivo: envio.ok ? null : (envio.motivo ?? "falha no envio").slice(0, 200), terminadoEm: new Date() })
      .where(eq(doloresAvisosEnvios.id, vaga.id));
    if (envio.ok) {
      const ids = pendentes.map(a => a.id);
      for (let i = 0; i < ids.length; i += 500) {
        await getDb().update(doloresAvisosAchados).set({ faixaAvisada: sql`${doloresAvisosAchados.faixa}`, avisadoEm: agora, envioId: vaga.id })
          .where(inArray(doloresAvisosAchados.id, ids.slice(i, i + 500)));
      }
    }
    return { r: envio.ok ? "enviado" : "falhou", envioId: vaga.id, itens: pendentes.length, comIa: Boolean(ia.texto), lidos, falhas };
  } catch (e) {
    console.error("[dolores/avisos] falha na rodada dos avisos", erroParaLog(e));
    await registrarAcao({ funcao: "aviso_proativo", resultado: "erro", motivo: "falha na rodada dos avisos (ver log)", autorUserId: null, canal, pedidoId: `avisos:${diaDosAvisos(agora)}` }).catch(() => false);
    return { r: "erro" };
  }
}

/** Para a tela: configuração, tipos (silenciados), pendentes por tipo e os últimos avisos (texto do registro, já filtrado). */
export async function situacaoDosAvisos(limite = 10) {
  const cfg = await lerConfigAvisos();
  if (!cfg) return null;
  const [silenciados, envios, pendentes] = await Promise.all([
    tiposSilenciados(),
    getDb().select().from(doloresAvisosEnvios).orderBy(desc(doloresAvisosEnvios.id)).limit(limite),
    getDb().select({ tipo: doloresAvisosAchados.tipo, n: sql<number>`count(*)`.mapWith(Number) }).from(doloresAvisosAchados)
      .where(isNull(doloresAvisosAchados.resolvidoEm)).groupBy(doloresAvisosAchados.tipo),
  ]);
  return { config: cfg, silenciados: Array.from(silenciados), abertosPorTipo: Object.fromEntries(pendentes.map(p => [p.tipo, p.n])) as Partial<Record<TipoAviso, number>>,
    envios: envios.map(e => ({ id: e.id, dia: e.dia, ordem: e.ordem, criadoEm: e.criadoEm.toISOString(), situacao: e.situacao, texto: e.texto, tipos: e.tipos, itens: e.itens, comIa: e.comIa, motivo: e.motivo })) };
}
