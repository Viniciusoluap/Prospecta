// EPIC-025 (Dolores, etapa 4) — leitura dos grupos CADASTRADOS (prompt mestre, seção 6: "Hoje o sistema descarta mensagens de
// grupo. Ele passará a registrar apenas os grupos cadastrados em dolores_grupos; os demais continuam ignorados.").
// Regras fixas deste arquivo:
// - Mensagem de grupo é dado de TERCEIRO: só é registrada. Nada aqui responde, envia, reage, marca como lida, chama a IA de
//   conversa, aprova item da fila ou executa ação — nem quando quem escreveu no grupo é o dono.
// - Etapa 7 (regra do dono de 19/11/2026): grupo DESCONHECIDO entra sozinho na primeira mensagem (`ctx.entrar`, de
//   grupos-entrada.ts: tipo pelo nome, teto diário, aviso ao dono) e a mensagem passa a ser registrada. Grupo DESATIVADO (pelo
//   admin ou pelo "ignorar" do dono): nada é gravado. Banco sem a migração 0126/0133: idem (falha fechada = ignora).
// - Documento só é oferecido à classificação em grupo de cliente/pós-atendimento COM cliente ligado; grupo de obra vai para a
//   leitura de nota (etapa 5). Nos demais (internos, aguardando o dono), o documento fica registrado e não chama a IA.
// - Idempotência por instância + id da mensagem; teto diário de mensagens por grupo (spam só soma a contagem).
// - Texto e nome de arquivo gravados pelo filtro do REGISTRO (dados pessoais mascarados; segredos e bancários sempre); o arquivo
//   nunca é guardado no banco (só os metadados; baixado sob demanda).
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { constructionProjects, leads } from "../../drizzle/schema.js";
import {
  doloresGrupoMensagens, doloresGrupos, doloresGruposConfig, doloresGruposContagem, type DoloresGrupo, type DoloresGruposConfig,
} from "../../drizzle/schema-dolores-grupos.js";
import type { DoloresWhatsappConfig } from "../../drizzle/schema-dolores-whatsapp.js";
import { doloresAprovacoes } from "../../drizzle/schema-dolores-fila.js";
import { tipoEfetivo } from "../../shared/dolores/grupos-tipo.js";
import {
  diaDeImperatriz, ehDocumento, jidDeGrupoValido, legendaSegura, lerMensagemDeGrupo, mensagemDeGrupoAntiga, nomeSeguroDeArquivo, type TipoMensagemGrupo,
} from "../../shared/dolores/grupos.js";
import { sanitizarTexto } from "../../shared/dolores/sanitizar.js";
import { ehNumeroDoDono, mascararNumero } from "../../shared/dolores/whatsapp.js";
import { getDb, type DrizzleDb } from "../db.js";
import { registrarAcao } from "./auditoria.js";
import { FILTRO_DO_REGISTRO } from "./dados-pessoais.js";
import { erroParaLog } from "./erro-seguro.js";
import { gravarNomeDoRemetente } from "./grupo-mensagens-nome.js";

/** Padrões da configuração (os mesmos da migração), usados se a linha ainda não existir. */
export const CONFIG_GRUPOS_PADRAO: Omit<DoloresGruposConfig, "atualizadoEm" | "atualizadoPor"> = {
  id: 1, classificacaoLigada: false, tetoClassificacoesDia: 30, tetoClassificacoesGrupoDia: 10, maxMensagensGrupoDia: 300,
  tamanhoMaximoBytes: 10_485_760, retencaoDias: 30, orcamentoClassificacaoPct: 20,
  entradaAutomaticaLigada: true, tetoGruposNovosDia: 20, tetoAvisosGruposDia: 25,
};

/**
 * Etapa 7 — o documento deste grupo pode ir à IA? Grupo de obra: sim (leitura de nota, etapa 5). Senão, só grupo de cliente ou
 * pós-atendimento COM cliente ligado (classificação, etapa 4). Internos e "aguardando o dono": não.
 */
export function grupoLeDocumentos(g: Pick<DoloresGrupo, "tipo" | "leadId" | "obraId" | "situacaoConfirmacao">): boolean {
  if (g.situacaoConfirmacao === "aguardando_dono" || g.situacaoConfirmacao === "recusado") return false;
  if (g.obraId !== null) return true;
  // grupo cadastrado à mão antes da etapa 7, sem tipo: segue a etapa 4 (grupo de cliente, mesmo "sem card ainda")
  if (g.tipo === null) return true;
  const t = tipoEfetivo(g);
  return (t === "cliente" || t === "pos_atendimento") && g.leadId !== null;
}

/** A mesma regra de `grupoLeDocumentos`, em SQL (pendências, classificação pela tela e ronda). */
export const sqlGrupoLeDocumentos = () => sql`((${doloresGrupos.obraId} IS NOT NULL OR ${doloresGrupos.tipo} IS NULL OR (${doloresGrupos.leadId} IS NOT NULL AND ${doloresGrupos.tipo} IN ('cliente', 'pos_atendimento'))) AND ${doloresGrupos.situacaoConfirmacao} NOT IN ('aguardando_dono', 'recusado'))`;

/** QA-SEG E7 — a linha NÃO espera o dono no WhatsApp (nem recusada, nem automática "aguardando o dono"). A mesma regra de `precisaDoAceiteDoDono`. */
export const sqlSemAceitePendente = () => sql`NOT (${doloresGrupos.situacaoConfirmacao} = 'recusado' OR (${doloresGrupos.origem} = 'automatico' AND ${doloresGrupos.situacaoConfirmacao} = 'aguardando_dono'))`;

export async function lerConfigGrupos(conexao: DrizzleDb = getDb()): Promise<typeof CONFIG_GRUPOS_PADRAO> {
  const [c] = await conexao.select().from(doloresGruposConfig).where(eq(doloresGruposConfig.id, 1)).limit(1);
  return c ?? CONFIG_GRUPOS_PADRAO;
}

/** Grupo cadastrado e ATIVO desta instância (null = ignorar a mensagem, como sempre foi). */
export async function grupoAtivo(instancia: string, jid: string) {
  const [g] = await getDb().select().from(doloresGrupos)
    .where(and(eq(doloresGrupos.instancia, instancia), eq(doloresGrupos.grupoJid, jid), eq(doloresGrupos.ativo, true))).limit(1);
  return g ?? null;
}

/** Texto de grupo para gravar: uma linha por trecho, sem controle/invisíveis, e o filtro do registro (sempre mascarado). */
export const textoDeGrupoParaGravar = (s: string | null | undefined, max = 2000) =>
  sanitizarTexto(legendaSegura(s, 4000), FILTRO_DO_REGISTRO).slice(0, max) || null;

/** EPIC-027 C2 — nome do participante (pushName) para gravar: uma linha, sem colchetes, filtro do registro, até 80 caracteres. */
export const nomeDoRemetenteParaGravar = (s: string | null | undefined) =>
  sanitizarTexto(legendaSegura(s, 200), FILTRO_DO_REGISTRO).slice(0, 80).trim() || null;

export type ResultadoGrupo = {
  /** Chave da contagem do aviso (o "grupo" de antes continua sendo "grupo não cadastrado: ignorada"). */
  resultado: "grupo" | "grupo-registrada" | "grupo-repetida" | "grupo-teto" | "grupo-antiga" | "grupo-ignorada" | "grupo-erro";
  mensagemId?: number;
  /** Documento novo que pode ser classificado agora (quem decide é o webhook: teto, prazo e interruptores). */
  aClassificar?: boolean;
};

/**
 * Trata UM item de grupo do aviso da Evolution. Não responde nada a ninguém. Devolve o que aconteceu (só para a contagem
 * do aviso e para o webhook decidir se tenta classificar um documento).
 */
export async function tratarMensagemDeGrupo(cfg: DoloresWhatsappConfig, item: unknown, ctx: {
  agora: Date; autor: number | null;
  /** Etapa 7: cria o grupo desconhecido (grupos-entrada.ts). Sem ele (ou se não criar), o grupo desconhecido é ignorado. */
  entrar?: (jid: string) => Promise<DoloresGrupo | null>;
}): Promise<ResultadoGrupo> {
  const jid = String((item as { key?: { remoteJid?: unknown } } | null)?.key?.remoteJid ?? "");
  let grupo: DoloresGrupo | null;
  let existe = false;
  try {
    const [g] = cfg.instancia ? await getDb().select().from(doloresGrupos).where(and(eq(doloresGrupos.instancia, cfg.instancia), eq(doloresGrupos.grupoJid, jid))).limit(1) : [];
    existe = !!g;
    // Etapa 7: grupo RECUSADO (outra pessoa colocou a Dolores) é como desativado: nada gravado
    grupo = g?.ativo && g.situacaoConfirmacao !== "recusado" ? g : null;
  } catch (e) {
    // banco sem a 0126/0133 ou fora do ar: ignora como antes (nada gravado)
    console.error("[dolores/grupos] não consegui conferir o cadastro do grupo", erroParaLog(e));
    return { resultado: "grupo" };
  }
  // desativado (admin ou "ignorar" do dono): nada gravado
  if (existe && !grupo) return { resultado: "grupo" };
  const m = lerMensagemDeGrupo(item);
  if (!m || m.tipo === "ignorar") return { resultado: "grupo-ignorada" };
  if (mensagemDeGrupoAntiga(m.enviadaEm, ctx.agora)) return { resultado: "grupo-antiga" };
  // Etapa 7: grupo desconhecido entra sozinho (só com mensagem válida e recente: histórico não cria grupo)
  if (!grupo) {
    if (!ctx.entrar || !jidDeGrupoValido(jid)) return { resultado: "grupo" };
    grupo = await ctx.entrar(jid).catch(e => { console.error("[dolores/grupos] falha na entrada automática", erroParaLog(e)); return null; });
    if (!grupo || !grupo.ativo || grupo.situacaoConfirmacao === "recusado") return { resultado: "grupo" };
  }
  try {
    const db = getDb();
    const [ja] = await db.select({ id: doloresGrupoMensagens.id }).from(doloresGrupoMensagens)
      .where(and(eq(doloresGrupoMensagens.instancia, grupo.instancia), eq(doloresGrupoMensagens.externalId, m.externalId))).limit(1);
    if (ja) return { resultado: "grupo-repetida" };
    const config = await lerConfigGrupos();
    const dia = diaDeImperatriz(ctx.agora);
    // teto diário de mensagens registradas por grupo (spam não infla a tabela): só sobe se ainda estiver abaixo do teto
    const [vaga] = await db.insert(doloresGruposContagem).values({ grupoId: grupo.id, dia, mensagens: 1 })
      .onConflictDoUpdate({
        target: [doloresGruposContagem.grupoId, doloresGruposContagem.dia],
        set: { mensagens: sql`${doloresGruposContagem.mensagens} + 1`, ultimaEm: sql`now()` },
        setWhere: sql`${doloresGruposContagem.mensagens} < ${config.maxMensagensGrupoDia}`,
      }).returning({ mensagens: doloresGruposContagem.mensagens });
    if (!vaga) {
      const [c] = await db.update(doloresGruposContagem).set({ ignoradas: sql`${doloresGruposContagem.ignoradas} + 1`, ultimaEm: sql`now()` })
        .where(and(eq(doloresGruposContagem.grupoId, grupo.id), eq(doloresGruposContagem.dia, dia))).returning({ ignoradas: doloresGruposContagem.ignoradas });
      // auditoria: uma linha só, na primeira mensagem acima do teto do dia
      if (Number(c?.ignoradas ?? 0) === 1) {
        await registrarAcao({ funcao: "grupo_mensagem", resultado: "recusada", autorUserId: ctx.autor, canal: "whatsapp", pedidoId: `grupo:${grupo.id}:teto:${dia}`,
          motivo: `teto diário de ${config.maxMensagensGrupoDia} mensagens registradas no grupo atingido; as demais de hoje só são contadas`,
          resumo: { grupoId: grupo.id, dia } });
      }
      return { resultado: "grupo-teto" };
    }
    const tipo: TipoMensagemGrupo = m.midia?.tipo ?? "texto";
    const documento = ehDocumento(tipo);
    const grande = documento && m.midia?.tamanho != null && m.midia.tamanho > config.tamanhoMaximoBytes;
    // Etapa 7: documento em grupo que não lê documentos (interno, aguardando o dono, sem cliente) fica registrado, sem IA
    const le = grupoLeDocumentos(grupo);
    const nome = m.midia?.nome ? nomeSeguroDeArquivo(m.midia.nome) : null;
    const [linha] = await db.insert(doloresGrupoMensagens).values({
      grupoId: grupo.id, instancia: grupo.instancia, externalId: m.externalId, enviadaEm: m.enviadaEm,
      remetente: m.participante ? mascararNumero(m.participante) : null,
      // só informativo (a leitura diz "o dono escreveu no grupo"); NUNCA torna a mensagem um comando
      doDono: ehNumeroDoDono(m.participante, cfg.numeroDono), encaminhada: m.encaminhada, tipo,
      texto: textoDeGrupoParaGravar(m.texto), midiaMime: m.midia?.mime?.slice(0, 120) ?? null,
      midiaNome: nome ? sanitizarTexto(nome, FILTRO_DO_REGISTRO).slice(0, 160) : null,
      midiaTamanho: m.midia?.tamanho != null && Number.isFinite(m.midia.tamanho) ? Math.min(m.midia.tamanho, 2_147_483_647) : null,
      situacao: !documento ? "sem_documento" : grande ? "grande_demais" : "a_classificar",
    }).onConflictDoNothing().returning({ id: doloresGrupoMensagens.id });
    if (!linha) return { resultado: "grupo-repetida" };
    // EPIC-027 C2: o nome do participante, para a Central mostrar quem escreveu (texto de terceiro: uma linha, filtro do registro).
    // Em separado e tolerante (achado 2 do portão): sem a coluna da 0142, a mensagem fica registrada sem o nome.
    await gravarNomeDoRemetente(linha.id, nomeDoRemetenteParaGravar(m.nomeRemetente));
    return { resultado: "grupo-registrada", mensagemId: linha.id, aClassificar: documento && !grande && le };
  } catch (e) {
    console.error("[dolores/grupos] falha ao registrar a mensagem do grupo", erroParaLog(e));
    return { resultado: "grupo-erro" };
  }
}

/**
 * Liga o grupo a um cliente do CRM (card criado ou achado), só se ele ainda não tiver vínculo — dentro da transação de
 * escrita da ação aprovada. Devolve false se o grupo já tinha vínculo ou não está ativo (aí nada muda).
 */
export async function ligarGrupoAoCliente(tx: DrizzleDb, grupoId: number, leadId: number, userId: number | null, aprovacaoId: number | null = null): Promise<boolean> {
  // Etapa 7: é decisão de quem aprovou o item da fila — grava a decisão junto (o gatilho só deixa o vínculo mudar assim).
  // EPIC-027 (0144, regra do dono de 21/11): o gatilho só aceita o dono no WhatsApp ('whatsapp:…') ou um admin ativo pela tela
  // ('tela:<id>'); quem aprovou vem da própria aprovação. Sem aprovação conferida, nada muda (falha fechada).
  if (!aprovacaoId) return false;
  const [ap] = await tx.select({ via: doloresAprovacoes.decididoVia, por: doloresAprovacoes.decididoPorUserId }).from(doloresAprovacoes).where(eq(doloresAprovacoes.id, aprovacaoId)).limit(1);
  const decididoPor = ap?.via === "whatsapp" ? `whatsapp:fila:${aprovacaoId}` : ap?.via === "tela" && ap.por ? `tela:${ap.por}` : null;
  if (!decididoPor) return false;
  const agora = new Date();
  const r = await tx.update(doloresGrupos).set({ leadId, tipo: sql`CASE WHEN ${doloresGrupos.tipo} = 'pos_atendimento' THEN 'pos_atendimento' ELSE 'cliente' END`, situacaoConfirmacao: "confirmado", decididoEm: agora,
    decididoPor: decididoPor.slice(0, 40), atualizadoEm: agora, atualizadoPorUserId: userId })
    .where(and(eq(doloresGrupos.id, grupoId), eq(doloresGrupos.ativo, true), isNull(doloresGrupos.leadId), isNull(doloresGrupos.obraId),
      // grupo interno (jurídico, administrativo, parceiros, engenharia) nunca vira grupo de cliente pela fila
      or(isNull(doloresGrupos.tipo), inArray(doloresGrupos.tipo, ["indefinido", "cliente", "pos_atendimento"])),
      // QA-SEG E7 (6c): grupo recusado ou sem prova de quem colocou a Dolores não é aceito pela fila (só o dono, no WhatsApp)
      sqlSemAceitePendente()))
    .returning({ id: doloresGrupos.id });
  return r.length === 1;
}

/** Marca o documento do grupo como salvo no card (dentro da transação da ação aprovada). */
export async function marcarDocumentoSalvo(tx: DrizzleDb, mensagemId: number, leadDocumentId: number, agora: Date): Promise<boolean> {
  const r = await tx.update(doloresGrupoMensagens).set({ situacao: "salvo", leadDocumentId, salvoEm: agora })
    .where(and(eq(doloresGrupoMensagens.id, mensagemId), sql`${doloresGrupoMensagens.situacao} <> 'salvo'`)).returning({ id: doloresGrupoMensagens.id });
  return r.length === 1;
}

// ── Tela do administrador ──

/** Grupos cadastrados com o vínculo e as contagens (sem texto de mensagem). */
export async function listarGruposParaTela() {
  const db = getDb();
  const grupos = await db.select({
    id: doloresGrupos.id, grupoJid: doloresGrupos.grupoJid, nome: doloresGrupos.nome, ativo: doloresGrupos.ativo, leadId: doloresGrupos.leadId,
    obraId: doloresGrupos.obraId, criadoEm: doloresGrupos.criadoEm, cliente: leads.name, obra: constructionProjects.title,
    tipo: doloresGrupos.tipo, origem: doloresGrupos.origem, situacaoConfirmacao: doloresGrupos.situacaoConfirmacao, nomeWhatsapp: doloresGrupos.nomeWhatsapp,
    codigo: doloresGrupos.codigo, decididoEm: doloresGrupos.decididoEm, adicionadoPor: doloresGrupos.adicionadoPor, provaAdicao: doloresGrupos.provaAdicao, obraExcluidaEm: doloresGrupos.obraExcluidaEm,
  }).from(doloresGrupos).leftJoin(leads, eq(leads.id, doloresGrupos.leadId)).leftJoin(constructionProjects, eq(constructionProjects.id, doloresGrupos.obraId))
    .orderBy(desc(doloresGrupos.ativo), asc(doloresGrupos.nome)).limit(200);
  const ids = grupos.map(g => g.id);
  const contagens = ids.length ? await db.select({
    grupoId: doloresGrupoMensagens.grupoId, situacao: doloresGrupoMensagens.situacao, n: sql<number>`count(*)`.mapWith(Number),
  }).from(doloresGrupoMensagens).where(inArray(doloresGrupoMensagens.grupoId, ids)).groupBy(doloresGrupoMensagens.grupoId, doloresGrupoMensagens.situacao) : [];
  return grupos.map(g => {
    const c = contagens.filter(x => x.grupoId === g.id);
    const soma = (...s: string[]) => c.filter(x => s.includes(x.situacao)).reduce((a, x) => a + Number(x.n), 0);
    return {
      ...g, tipo: tipoEfetivo(g), mensagens: c.reduce((a, x) => a + Number(x.n), 0),
      documentos: { aClassificar: soma("a_classificar", "classificando", "erro"), classificados: soma("classificado"), confira: soma("confira"), salvos: soma("salvo"), naoBaixados: soma("grande_demais", "formato") },
    };
  });
}

/** Documentos que esperam classificação ou conferência (para a tela). Só metadados e o resultado da classificação. */
/** Pendências da tela: só dentro da retenção (vencido não é mais oferecido para classificar nem salvar — QA E4, achado 8). */
export async function pendenciasDeClassificacao(limite = 50, agora = new Date()) {
  const { retencaoDias } = await lerConfigGrupos();
  const corte = new Date(agora.getTime() - retencaoDias * 86_400_000);
  return getDb().select({
    id: doloresGrupoMensagens.id, grupoId: doloresGrupoMensagens.grupoId, grupo: doloresGrupos.nome, tipo: doloresGrupoMensagens.tipo,
    nome: doloresGrupoMensagens.midiaNome, tamanho: doloresGrupoMensagens.midiaTamanho, situacao: doloresGrupoMensagens.situacao,
    classificacao: doloresGrupoMensagens.classificacao, confianca: doloresGrupoMensagens.confianca, motivo: doloresGrupoMensagens.motivo,
    criadoEm: doloresGrupoMensagens.criadoEm, tentativas: doloresGrupoMensagens.tentativas,
  }).from(doloresGrupoMensagens).innerJoin(doloresGrupos, eq(doloresGrupos.id, doloresGrupoMensagens.grupoId))
    .where(and(inArray(doloresGrupoMensagens.situacao, ["a_classificar", "classificando", "erro", "confira", "classificado"]), gte(doloresGrupoMensagens.criadoEm, corte), sqlGrupoLeDocumentos()))
    .orderBy(asc(doloresGrupoMensagens.id)).limit(Math.min(200, limite));
}
