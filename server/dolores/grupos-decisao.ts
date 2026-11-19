// EPIC-025 (Dolores, etapa 7) — a DECISÃO DO DONO sobre o tipo e o vínculo de um grupo: pelo WhatsApp ("grupo <código> <tipo>
// [nº]", reconhecido por código em shared/dolores/grupos-tipo.ts, só na conversa direta do número do dono) ou pela tela (só
// admin). É configuração da própria Dolores (não mexe no CRM): grava direto, auditado em dolores_acoes. Regras fixas:
// - Nunca apaga: "ignorar" DESATIVA o grupo (e o interruptor dele). Cliente/pós exigem cliente ativo do CRM; engenharia aceita
//   a obra (opcional). Tipos internos ficam sem vínculo.
// - O gatilho da 0133 só deixa tipo e vínculo mudarem com `decidido_em` gravado na mesma operação — é o que esta função faz.
// - Mensagem de grupo nunca chega aqui (o webhook trata grupo antes e nunca o transforma em comando).
import { and, eq, isNull } from "drizzle-orm";
import { constructionProjects, leads } from "../../drizzle/schema.js";
import { doloresGrupos, type DoloresGrupo } from "../../drizzle/schema-dolores-grupos.js";
import { doloresMarcacoesGrupo } from "../../drizzle/schema-dolores-marcacoes.js";
import { ROTULO_TIPO_GRUPO, tipoEfetivo, type DecisaoDeGrupo } from "../../shared/dolores/grupos-tipo.js";
import { limparNomeDeTerceiro } from "../../shared/dolores/operacao.js";
import { getDb } from "../db.js";
import { registrarAcao } from "./auditoria.js";
import { erroParaLog } from "./erro-seguro.js";

export type OrigemDecisao = { via: "whatsapp"; autor: number | null; mensagemId: number } | { via: "tela"; userId: number };

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
  try {
    // "aceitar": grupo em que outra pessoa colocou a Dolores (recusado) passa a valer, por decisão do dono
    if (d.tipo === "aceitar") {
      if (g.situacaoConfirmacao !== "recusado") {
        await auditar("recusada", "aceitar: o grupo não estava recusado; nada mudou", { grupoId: g.id });
        return { ok: true, texto: `Dolores: o grupo ${nomeDoGrupo} (${g.codigo ?? g.id}) já estava aceito; nada mudou.`, grupoId: g.id };
      }
      const tipoAtual = tipoEfetivo(g);
      await db.transaction(async tx => {
        await tx.update(doloresGrupos).set({ ativo: true, situacaoConfirmacao: tipoAtual === "indefinido" ? "aguardando_dono" : "confirmado", provaAdicao: "aceito_pelo_dono",
          decididoEm: agora, decididoPor, atualizadoEm: agora, atualizadoPorUserId: origem.via === "tela" ? origem.userId : null }).where(eq(doloresGrupos.id, g!.id));
        if (tipoAtual !== "indefinido") await tx.insert(doloresMarcacoesGrupo).values({ grupoId: g!.id, responderLigado: true, atualizadoPor: origem.via === "tela" ? origem.userId : null }).onConflictDoNothing();
      });
      await auditar("ok", "grupo recusado aceito pelo dono", { grupoId: g.id, tipo: tipoAtual });
      return { ok: true, texto: tipoAtual === "indefinido"
        ? `Dolores: aceito o grupo ${nomeDoGrupo}. Ainda não sei de que tipo ele é; responda: grupo ${g.codigo} cliente <nº> | jurídico | administrativo | parceiros | engenharia.`
        : `Dolores: aceito o grupo ${nomeDoGrupo} (${g.codigo ?? g.id}) como ${ROTULO_TIPO_GRUPO[tipoAtual]}.`, grupoId: g.id };
    }
    if (d.tipo === "ignorar") {
      await db.transaction(async tx => {
        // recusado continua recusado (só fica também desativado)
        await tx.update(doloresGrupos).set({ ativo: false, situacaoConfirmacao: g!.situacaoConfirmacao === "recusado" ? "recusado" : "confirmado", decididoEm: agora, decididoPor, atualizadoEm: agora,
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
      // definir o tipo de um grupo recusado também o aceita (é a decisão do dono)
      await tx.update(doloresGrupos).set({ tipo, leadId, obraId, ativo: true, situacaoConfirmacao: "confirmado", decididoEm: agora, decididoPor,
        ...(g!.situacaoConfirmacao === "recusado" ? { provaAdicao: "aceito_pelo_dono" as const } : {}),
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
