// EPIC-025 (Dolores, etapa 7) — a DECISÃO DO DONO sobre o tipo e o vínculo de um grupo: pelo WhatsApp ("grupo <código> <tipo>
// [nº]", reconhecido por código em shared/dolores/grupos-tipo.ts, só na conversa direta do número do dono) ou pela tela (só
// admin). É configuração da própria Dolores (não mexe no CRM): grava direto, auditado em dolores_acoes. Regras fixas:
// - Nunca apaga: "ignorar" DESATIVA o grupo (e o interruptor dele). Cliente/pós exigem cliente ativo do CRM; engenharia aceita
//   a obra (opcional). Tipos internos ficam sem vínculo.
// - O gatilho da 0133 só deixa tipo e vínculo mudarem com `decidido_em` gravado na mesma operação — é o que esta função faz.
// - Mensagem de grupo nunca chega aqui (o webhook trata grupo antes e nunca o transforma em comando).
// - EPIC-027 C3: pela tela (admin ou colaborador com o módulo WhatsApp) se CLASSIFICA grupo já aceito, inclusive o "aguardando o
//   dono" de tipo indefinido que o dono adicionou/aceitou. O que segue (R2-3) passa a valer só para recusado / sem prova.
// - QA-SEG E7 (achado 6c; r2, R2-3): grupo RECUSADO ou automático "aguardando o dono" (sem prova de quem colocou a Dolores, ou
//   adicionado pelo dono mas de tipo indefinido) só sai desse estado pelo comando do DONO no WhatsApp. Pela tela (admin que pode não ser o dono) só se vê e se desativa ("ignorar"); o gatilho da 0133 exige o
//   mesmo ("decidido_por" começando por "whatsapp:").
import { and, eq, isNull } from "drizzle-orm";
import { constructionProjects, leads } from "../../drizzle/schema.js";
import { doloresGrupos, type DoloresGrupo } from "../../drizzle/schema-dolores-grupos.js";
import { doloresMarcacoesGrupo } from "../../drizzle/schema-dolores-marcacoes.js";
import {
  JANELA_RESPOSTA_NUMERADA_MS, ROTULO_TIPO_GRUPO, perguntaDoTipo, precisaDoAceiteDoDono, semProvaDoDono, textoDaConfirmacaoDoTipo, tipoEfetivo,
  type DecisaoDeGrupo, type RespostaNumerada,
} from "../../shared/dolores/grupos-tipo.js";
import { limparNomeDeTerceiro } from "../../shared/dolores/operacao.js";
import { getDb } from "../db.js";
import { registrarAcao } from "./auditoria.js";
import { erroParaLog } from "./erro-seguro.js";

/** `agora` (WhatsApp): o relógio do aviso, para a hora da PERGUNTA do tipo (a resposta só com o número vale por 30 min). */
export type OrigemDecisao = { via: "whatsapp"; autor: number | null; mensagemId: number; agora?: Date } | { via: "tela"; userId: number };

export type ResultadoDecisao = { ok: boolean; texto: string; grupoId: number | null };

const aspas = (s: string | null | undefined) => { const t = limparNomeDeTerceiro(s); return t ? `«${t}»` : "(sem nome)"; };

/** Aplica a decisão do dono ao grupo (pelo código, no WhatsApp; pelo id, na tela). Devolve o texto para o dono. */
export async function decidirGrupo(alvo: { codigo: string } | { grupoId: number }, d: Omit<DecisaoDeGrupo, "codigo">, origem: OrigemDecisao): Promise<ResultadoDecisao> {
  const db = getDb();
  const pedidoId = origem.via === "whatsapp" ? `wa:${origem.mensagemId}` : `tela:grupos:${"grupoId" in alvo ? alvo.grupoId : "codigo"}`;
  const auditar = (resultado: "ok" | "recusada" | "erro", motivo: string, resumo: Record<string, unknown>) =>
    registrarAcao({ funcao: "grupo_decisao", resultado, motivo, canal: origem.via, pedidoId,
      // QA E4 (FKs): o admin da tela vai no resumo (dolores_acoes.autor_user_id é só a usuária Dolores)
      autorUserId: origem.via === "whatsapp" ? origem.autor : null,
      resumo: { ...resumo, ...(origem.via === "tela" ? { porUserId: origem.userId } : {}) } });
  let g: DoloresGrupo | undefined;
  try {
    [g] = await db.select().from(doloresGrupos).where("codigo" in alvo ? eq(doloresGrupos.codigo, alvo.codigo) : eq(doloresGrupos.id, alvo.grupoId)).limit(1);
  } catch (e) {
    console.error("[dolores/grupos-decisao] grupos indisponíveis", erroParaLog(e));
    return { ok: false, texto: "Dolores: não consegui ler os grupos agora (a migração 0133 foi aplicada?); nada mudou.", grupoId: null };
  }
  if (!g) {
    await auditar("recusada", "grupo não encontrado pelo código; nada mudou", { codigo: "codigo" in alvo ? alvo.codigo : null });
    return { ok: false, texto: `Dolores: não achei nenhum grupo com o código ${"codigo" in alvo ? alvo.codigo : ""}. Nada mudou. Os códigos estão no aviso de entrada e em Dolores › Grupos.`, grupoId: null };
  }
  const agora = new Date();
  const decididoPor = (origem.via === "whatsapp" ? "whatsapp:dono" : `tela:${origem.userId}`).slice(0, 40);
  const nomeDoGrupo = aspas(g.nomeWhatsapp ?? g.nome);
  // pendente: recusado ou automático "aguardando o dono" (inclusive o que o dono adicionou mas ficou de tipo indefinido — QA-SEG
  // E7 r2, R2-3); semProva: recusado ou sem prova de quem colocou a Dolores (o que o "aceitar" resolve)
  const pendente = precisaDoAceiteDoDono(g);
  const semProva = semProvaDoDono(g);
  // EPIC-027 C3 (decisão do dono de 20/11, noite): CLASSIFICAR (tipo e vínculo) pela tela vale para grupo já ACEITO — inclusive o
  // "não identificado · aguardando o dono" que ele adicionou ou aceitou. ACEITAR grupo recusado ou sem prova de quem colocou a
  // Dolores continua só do dono, no WhatsApp (regra de 19/11): pela tela, nem aceitar nem definir o tipo desses (que os aceitaria).
  if (semProva && origem.via === "tela" && d.tipo !== "ignorar") {
    await auditar("recusada", "pela tela não se aceita grupo recusado/sem prova de quem colocou a Dolores (só o dono, no WhatsApp)", { grupoId: g.id, pedido: d.tipo });
    return { ok: false, texto: `Dolores: só o dono aceita o grupo ${nomeDoGrupo}, pelo WhatsApp: "grupo ${g.codigo ?? "CÓDIGO"} aceitar". Pela tela dá para ver e desativar; nada mudou.`, grupoId: g.id };
  }
  if (origem.via === "tela" && d.tipo === "aceitar") {
    await auditar("recusada", "pela tela não se aceita grupo (só o dono, no WhatsApp)", { grupoId: g.id });
    return { ok: false, texto: "Dolores: a tela não aceita grupo; nada mudou.", grupoId: g.id };
  }
  try {
    // "aceitar": grupo recusado ou esperando o dono dizer quem a colocou passa a valer, por decisão do dono
    if (d.tipo === "aceitar") {
      if (!semProva) {
        await auditar("recusada", "aceitar: o grupo não estava recusado; nada mudou", { grupoId: g.id });
        if (tipoEfetivo(g) === "indefinido") await marcarPerguntaDoTipo(g.id, origem);
        return { ok: true, texto: tipoEfetivo(g) === "indefinido"
          ? `Dolores: o grupo ${nomeDoGrupo} já estava aceito; falta só o tipo. ${perguntaDoTipo(g.nomeWhatsapp ?? g.nome, g.codigo ?? "CÓDIGO")}`
          : `Dolores: o grupo ${nomeDoGrupo} (${g.codigo ?? g.id}) já estava aceito; nada mudou.`, grupoId: g.id };
      }
      const tipoAtual = tipoEfetivo(g);
      await db.transaction(async tx => {
        await tx.update(doloresGrupos).set({ ativo: true, situacaoConfirmacao: tipoAtual === "indefinido" ? "aguardando_dono" : "confirmado", provaAdicao: "aceito_pelo_dono",
          decididoEm: agora, decididoPor, atualizadoEm: agora, atualizadoPorUserId: origem.via === "tela" ? origem.userId : null }).where(eq(doloresGrupos.id, g!.id));
        if (tipoAtual !== "indefinido") await tx.insert(doloresMarcacoesGrupo).values({ grupoId: g!.id, responderLigado: true, atualizadoPor: origem.via === "tela" ? origem.userId : null }).onConflictDoNothing();
      });
      await auditar("ok", g.situacaoConfirmacao === "recusado" ? "grupo recusado aceito pelo dono" : "grupo sem prova de quem colocou a Dolores aceito pelo dono", { grupoId: g.id, tipo: tipoAtual });
      if (tipoAtual === "indefinido") await marcarPerguntaDoTipo(g.id, origem);
      return { ok: true, texto: tipoAtual === "indefinido"
        ? `Dolores: aceito o grupo ${nomeDoGrupo}. Ainda não sei de que tipo ele é. ${perguntaDoTipo(g.nomeWhatsapp ?? g.nome, g.codigo ?? "CÓDIGO")}`
        : `Dolores: aceito o grupo ${nomeDoGrupo} (${g.codigo ?? g.id}) como ${ROTULO_TIPO_GRUPO[tipoAtual]}.`, grupoId: g.id };
    }
    if (d.tipo === "ignorar") {
      await db.transaction(async tx => {
        // recusado continua recusado e o que espera o dono dizer quem a colocou continua esperando (só ficam também desativados)
        await tx.update(doloresGrupos).set({ ativo: false, situacaoConfirmacao: pendente ? g!.situacaoConfirmacao : "confirmado", decididoEm: agora, decididoPor, atualizadoEm: agora,
          atualizadoPorUserId: origem.via === "tela" ? origem.userId : null }).where(eq(doloresGrupos.id, g!.id));
        await tx.insert(doloresMarcacoesGrupo).values({ grupoId: g!.id, responderLigado: false, atualizadoPor: origem.via === "tela" ? origem.userId : null })
          .onConflictDoUpdate({ target: doloresMarcacoesGrupo.grupoId, set: { responderLigado: false, atualizadoEm: agora } });
      });
      await auditar("ok", "grupo desativado pelo dono (ignorar)", { grupoId: g.id });
      return { ok: true, texto: `Dolores: combinado, vou ignorar o grupo ${nomeDoGrupo} (${g.codigo ?? g.id}): não leio nem falo nada lá. Para voltar, responda "grupo ${g.codigo ?? "CÓDIGO"} <tipo>" ou reative em Dolores › Grupos.`, grupoId: g.id };
    }
    const tipo = d.tipo;
    let leadId: number | null = null;
    let obraId: number | null = null;
    let descricao = `grupo ${ROTULO_TIPO_GRUPO[d.tipo]}`;
    if (d.tipo === "cliente" || d.tipo === "pos_atendimento") {
      const [l] = await db.select({ id: leads.id, nome: leads.name }).from(leads).where(and(eq(leads.id, d.numero!), isNull(leads.deletedAt))).limit(1);
      if (!l) {
        await auditar("recusada", "cliente não encontrado no CRM; nada mudou", { grupoId: g.id, leadId: d.numero });
        return { ok: false, texto: `Dolores: não achei o cliente nº ${d.numero} no CRM (ou ele foi excluído). Nada mudou no grupo ${nomeDoGrupo}.`, grupoId: g.id };
      }
      leadId = l.id;
      descricao = `${ROTULO_TIPO_GRUPO[d.tipo]} ${aspas(l.nome)} (nº ${l.id})`;
    } else if (d.tipo === "engenharia" && d.numero) {
      const [o] = await db.select({ id: constructionProjects.id, titulo: constructionProjects.title }).from(constructionProjects).where(eq(constructionProjects.id, d.numero)).limit(1);
      if (!o) {
        await auditar("recusada", "obra não encontrada; nada mudou", { grupoId: g.id, obraId: d.numero });
        return { ok: false, texto: `Dolores: não achei a obra nº ${d.numero}. Nada mudou no grupo ${nomeDoGrupo}.`, grupoId: g.id };
      }
      obraId = o.id;
      descricao = `engenharia da obra ${aspas(o.titulo)} (nº ${o.id})`;
    }
    await db.transaction(async tx => {
      // definir o tipo de um grupo recusado (ou sem prova de quem colocou a Dolores) também o aceita — é a decisão do dono no
      // WhatsApp (pela tela, recusado acima)
      await tx.update(doloresGrupos).set({ tipo, leadId, obraId, ativo: true, situacaoConfirmacao: "confirmado", decididoEm: agora, decididoPor,
        ...(semProva ? { provaAdicao: "aceito_pelo_dono" as const } : {}),
        atualizadoEm: agora, atualizadoPorUserId: origem.via === "tela" ? origem.userId : null }).where(eq(doloresGrupos.id, g!.id));
      // grupo confirmado nasce com o interruptor LIGADO (se ninguém mexeu nele antes); nada fala com o interruptor geral desligado
      await tx.insert(doloresMarcacoesGrupo).values({ grupoId: g!.id, responderLigado: true, atualizadoPor: origem.via === "tela" ? origem.userId : null }).onConflictDoNothing();
    });
    await auditar("ok", `tipo do grupo definido pelo dono: ${d.tipo}`, { grupoId: g.id, tipo: d.tipo, leadId, obraId, antes: g.tipo ?? null });
    return { ok: true, texto: `Dolores: anotado. O grupo ${nomeDoGrupo} (${g.codigo ?? g.id}) agora é: ${descricao}.`, grupoId: g.id };
  } catch (e) {
    console.error("[dolores/grupos-decisao] falha ao gravar a decisão", erroParaLog(e));
    await auditar("erro", `falha ao gravar a decisão: ${erroParaLog(e)}`, { grupoId: g.id });
    return { ok: false, texto: "Dolores: não consegui gravar a decisão agora; nada mudou. Tente de novo em instantes.", grupoId: g.id };
  }
}

/** A Dolores perguntou ao dono o tipo do grupo agora (a resposta só com o número vale por 30 min). Nunca lança. */
export async function marcarPerguntaDoTipo(grupoId: number, origem: OrigemDecisao | { agora: Date }): Promise<void> {
  const quando = "agora" in origem && origem.agora ? origem.agora : new Date();
  await getDb().update(doloresGrupos).set({ perguntaTipoEm: quando }).where(eq(doloresGrupos.id, grupoId))
    .catch(e => console.error("[dolores/grupos-decisao] não gravei a hora da pergunta do tipo", erroParaLog(e)));
}

/**
 * Grupos que esperam o dono dizer o TIPO (aceitos, de tipo indefinido, ativos) e cuja PERGUNTA saiu há no máximo 30 min (QA-SEG
 * EPIC-027, achado 2): os únicos que a resposta só com o número resolve.
 */
export async function gruposEsperandoTipo(agora: Date): Promise<DoloresGrupo[]> {
  const linhas = await getDb().select().from(doloresGrupos).where(and(eq(doloresGrupos.ativo, true), eq(doloresGrupos.situacaoConfirmacao, "aguardando_dono"))).limit(50);
  return linhas.filter(g => tipoEfetivo(g) === "indefinido" && !semProvaDoDono(g) && !!g.perguntaTipoEm
    && agora.getTime() - g.perguntaTipoEm.getTime() <= JANELA_RESPOSTA_NUMERADA_MS && agora.getTime() - g.perguntaTipoEm.getTime() >= -2 * 60_000);
}

/**
 * EPIC-027 C3 — o dono respondeu SÓ com o número da opção ("3 sim", "1 456"). Vale para o ÚNICO grupo esperando o tipo com pergunta
 * dos últimos 30 min; nenhum → null (a mensagem segue o caminho normal); mais de um → pede o código (nada muda). Jurídico e
 * administrativo sem o "sim" → pede a confirmação dizendo o que o tipo libera (nada muda). Só chega aqui mensagem do número do
 * dono, na conversa direta, não encaminhada e sem mídia (whatsapp.ts).
 */
export async function decidirPelaOpcao(r: RespostaNumerada, origem: Extract<OrigemDecisao, { via: "whatsapp" }> & { agora: Date }): Promise<ResultadoDecisao | null> {
  const esperando = await gruposEsperandoTipo(origem.agora);
  if (!esperando.length) return null;
  if (esperando.length > 1) {
    const lista = esperando.slice(0, 6).map(g => `${aspas(g.nomeWhatsapp ?? g.nome)} (código ${g.codigo ?? g.id})`).join("; ");
    return { ok: false, grupoId: null, texto: `Dolores: tenho ${esperando.length} grupos esperando o tipo: ${lista}${esperando.length > 6 ? "; …" : ""}. Responda com o código: «grupo <código> <número da opção>». Nada mudou.` };
  }
  const [g] = esperando;
  if (!r.confirmado) {
    await auditar0(origem, "recusada", "resposta só com o número para tipo que libera mais: pedida a confirmação", { grupoId: g.id, tipo: r.tipo });
    return { ok: false, grupoId: g.id, texto: textoDaConfirmacaoDoTipo(g.nomeWhatsapp ?? g.nome, g.codigo ?? String(g.id), r.tipo) };
  }
  return decidirGrupo({ grupoId: g.id }, { tipo: r.tipo, numero: r.numero }, origem);
}

const auditar0 = (origem: Extract<OrigemDecisao, { via: "whatsapp" }>, resultado: "ok" | "recusada", motivo: string, resumo: Record<string, unknown>) =>
  registrarAcao({ funcao: "grupo_decisao", resultado, motivo, canal: "whatsapp", pedidoId: `wa:${origem.mensagemId}`, autorUserId: origem.autor, resumo });
