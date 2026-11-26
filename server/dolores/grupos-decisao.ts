// EPIC-025 (Dolores, etapa 7) — a DECISÃO DO DONO sobre o tipo e o vínculo de um grupo: pelo WhatsApp ("grupo <código> <tipo>
// [nº]", reconhecido por código em shared/dolores/grupos-tipo.ts, só na conversa direta do número do dono) ou pela tela (só
// admin). É configuração da própria Dolores (não mexe no CRM): grava direto, auditado em dolores_acoes. Regras fixas:
// - Nunca apaga: "ignorar" DESATIVA o grupo (e o interruptor dele). Cliente/pós exigem cliente ativo do CRM; engenharia aceita
//   a obra (opcional). Tipos internos ficam sem vínculo.
// - O gatilho da 0133 só deixa tipo e vínculo mudarem com `decidido_em` gravado na mesma operação — é o que esta função faz.
// - Mensagem de grupo nunca chega aqui (o webhook trata grupo antes e nunca o transforma em comando).
// - EPIC-027 C3: pela tela (só o administrador — regra do dono de 21/11) se CLASSIFICA grupo já aceito, inclusive o "aguardando o
//   dono" de tipo indefinido que o dono adicionou/aceitou. O que segue (R2-3) passa a valer só para recusado / sem prova.
// - QA-SEG E7 (achado 6c; r2, R2-3): grupo RECUSADO ou automático "aguardando o dono" (sem prova de quem colocou a Dolores, ou
//   adicionado pelo dono mas de tipo indefinido) só sai desse estado pelo comando do DONO no WhatsApp. Pela tela (admin que pode não ser o dono) só se vê e se desativa ("ignorar"); o gatilho da 0133 exige o
//   mesmo ("decidido_por" começando por "whatsapp:").
import { and, asc, eq, gte, isNotNull, isNull, lte, ne, notInArray, or } from "drizzle-orm";
import { constructionProjects, leads } from "../../drizzle/schema.js";
import { doloresGrupos, type DoloresGrupo } from "../../drizzle/schema-dolores-grupos.js";
import { doloresMarcacoesGrupo } from "../../drizzle/schema-dolores-marcacoes.js";
import {
  JANELA_RESPOSTA_NUMERADA_MS, ROTULO_TIPO_GRUPO, TIPOS_GRUPO, perguntaDoTipo, precisaDoAceiteDoDono, semProvaDoDono, textoDaConfirmacaoDoTipo, tipoEfetivo,
  type DecisaoDeGrupo, type RespostaNumerada,
} from "../../shared/dolores/grupos-tipo.js";
import { limparNomeDeTerceiro } from "../../shared/dolores/operacao.js";
import { getDb } from "../db.js";
import { unicoComPonto } from "../../shared/dolores/ordem-direta.js";
import { registrarAcao } from "./auditoria.js";
import { erroParaLog } from "./erro-seguro.js";
import { clienteDoNomeDoGrupo, clientesPelasPalavras, grupoDoDono } from "./ordem-direta.js";
import { FRASE_SO_QUANDO_MARCADA } from "../../shared/dolores/ordem-direta.js";

/** `agora` (WhatsApp): o relógio do aviso, para a hora da PERGUNTA do tipo (a resposta só com o número vale por 30 min). */
export type OrigemDecisao = { via: "whatsapp"; autor: number | null; mensagemId: number; agora?: Date;
  /** Codex #341 (P2): quem chama não mostra ao dono o texto desta resposta (aceite vindo da fila) — nenhuma proposta nova é aberta. */
  semProposta?: boolean } | { via: "tela"; userId: number };

export type ResultadoDecisao = { ok: boolean; texto: string; grupoId: number | null;
  /** QA E11 (M3): esta resposta É a pergunta desta proposta ("pode"/"sim" confirma) — quem envia marca a pergunta como enviada. */
  pendenciaId?: number | null };

const aspas = (s: string | null | undefined) => { const t = limparNomeDeTerceiro(s); return t ? `«${t}»` : "(sem nome)"; };

/** Aplica a decisão do dono ao grupo (pelo código, no WhatsApp; pelo id, na tela). Devolve o texto para o dono. */
export async function decidirGrupo(alvo: { codigo: string } | { grupoId: number; instancia?: string }, decisao: Omit<DecisaoDeGrupo, "codigo">, origem: OrigemDecisao): Promise<ResultadoDecisao> {
  let d = decisao;
  const db = getDb();
  const pedidoId = origem.via === "whatsapp" ? `wa:${origem.mensagemId}` : `tela:grupos:${"grupoId" in alvo ? alvo.grupoId : "codigo"}`;
  const auditar = (resultado: "ok" | "recusada" | "erro", motivo: string, resumo: Record<string, unknown>) =>
    registrarAcao({ funcao: "grupo_decisao", resultado, motivo, canal: origem.via, pedidoId,
      // QA E4 (FKs): o admin da tela vai no resumo (dolores_acoes.autor_user_id é só a usuária Dolores)
      autorUserId: origem.via === "whatsapp" ? origem.autor : null,
      resumo: { ...resumo, ...(origem.via === "tela" ? { porUserId: origem.userId } : {}) } });
  let g: DoloresGrupo | undefined;
  try {
    // EPIC-027 (portão da C2): pela tela, só grupo da instância da empresa
    [g] = await db.select().from(doloresGrupos).where("codigo" in alvo ? eq(doloresGrupos.codigo, alvo.codigo)
      : alvo.instancia ? and(eq(doloresGrupos.id, alvo.grupoId), eq(doloresGrupos.instancia, alvo.instancia)) : eq(doloresGrupos.id, alvo.grupoId)).limit(1);
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
      if (tipoAtual === "indefinido") {
        // EPIC-025 E11 (regra do dono de 19/11, também logo depois do "aceitar"): o nome do grupo aponta UM cliente → liga sozinha e
        // avisa em uma linha; ele só responde se estiver errado. Mais de um → oferece os nomes; nenhum → uma pergunta curta.
        if (origem.via === "whatsapp") {
          const auto: Awaited<ReturnType<typeof clienteDoNomeDoGrupo>> = await clienteDoNomeDoGrupo(g, { parcial: true }).catch(() => ({ leadId: null, candidatos: [] }));
          // QA E11 (M3): grupo em que OUTRA pessoa (ou não se sabe quem) pôs a Dolores — o nome é texto de terceiro: não liga sozinha;
          // UMA pergunta curta com o cliente que o nome aponta ("pode"/"sim" confirma, pela proposta de sempre)
          if (auto.leadId && !grupoDoDono(g) && !origem.semProposta) {
            const p = await proporVinculo(g, auto.leadId, auto.tipo ?? "cliente", origem);
            if (p) return { ok: true, grupoId: g.id, pendenciaId: p.pendenciaId, texto: `Dolores: aceito o grupo ${nomeDoGrupo}. Pelo nome, ele parece ser de ${aspas(p.nome)}.\n${p.pergunta}` };
          }
          if (auto.leadId && grupoDoDono(g)) {
            const r = await decidirGrupo({ grupoId: g.id, instancia: g.instancia }, { tipo: auto.tipo ?? "cliente", numero: auto.leadId }, origem);
            if (r.ok) return { ...r, texto: r.texto.replace(/^Dolores: feito\. /, "Dolores: aceito. ") };
          }
          // QA 14 (C2): no aceite vindo da fila o dono NÃO vê esta pergunta — sem marcar, uma resposta solta só com um nome
          // ("Maria Dayane") não liga o grupo; ele diz o tipo pelo caminho de sempre ("grupo CÓDIGO 1")
          if (!origem.semProposta) await marcarPerguntaDoTipo(g.id, origem);
          return { ok: true, texto: `Dolores: aceito o grupo ${nomeDoGrupo}. ${perguntaDoCliente(auto.candidatos, g.codigo)}`, grupoId: g.id };
        }
        if (!("semProposta" in origem && origem.semProposta)) await marcarPerguntaDoTipo(g.id, origem);
      }
      const vinculo = tipoAtual === "cliente" || tipoAtual === "pos_atendimento" ? await nomeDoVinculo(g.leadId) : "";
      return { ok: true, texto: tipoAtual === "indefinido"
        ? `Dolores: aceito o grupo ${nomeDoGrupo}. Ainda não sei de que tipo ele é. ${perguntaDoTipo(g.nomeWhatsapp ?? g.nome, g.codigo ?? "CÓDIGO")}`
        : `Dolores: aceito o grupo ${nomeDoGrupo} (${g.codigo ?? g.id}) como ${ROTULO_TIPO_GRUPO[tipoAtual]}${vinculo}.${vinculo ? " Se estiver errado, me diga." : ""}`, grupoId: g.id };
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
      // EPIC-025 E11: sem o nº ("grupo CÓDIGO 1", "1"), o cliente sai do NOME do grupo (um só); senão, os nomes para ele escolher
      if (!d.numero) {
        const auto = await clienteDoNomeDoGrupo(g, { parcial: true });
        if (!auto.leadId) {
          await marcarPerguntaDoTipo(g.id, origem);
          await auditar("recusada", "cliente sem nº e o nome do grupo não aponta um cliente só: perguntado pelo nome; nada mudou", { grupoId: g.id, candidatos: auto.candidatos.length });
          return { ok: false, texto: `Dolores: ${perguntaDoCliente(auto.candidatos, g.codigo, nomeDoGrupo)}${d.tipo === "pos_atendimento"
            // Codex #341 (P2): a resposta só com o nome vale como "cliente"; para manter o PÓS pedido, ele responde "2 <nome>"
            ? " Para ficar como pós-atendimento, responda «2» e o nome (ex.: «2 Emily»); só o nome fica como cliente."
            : ""}`, grupoId: g.id };
        }
        // QA E11 (M3): grupo de terceiro — o cliente que o nome aponta vai como UMA pergunta, nunca ligado sozinho
        if (!grupoDoDono(g) && origem.via === "whatsapp") {
          const p = await proporVinculo(g, auto.leadId, d.tipo, origem);
          if (p) return { ok: false, grupoId: g.id, pendenciaId: p.pendenciaId, texto: `Dolores: pelo nome, o grupo ${nomeDoGrupo} parece ser de ${aspas(p.nome)}.\n${p.pergunta}` };
          // Codex #341 (P1): sem a pergunta de confirmação (ex.: o grupo ainda precisa ser aceito), o grupo de terceiro NUNCA é ligado sozinho
          await auditar("recusada", "grupo de terceiro: a proposta de vínculo não pôde ser criada; nada mudou", { grupoId: g.id });
          return { ok: false, grupoId: g.id, texto: `Dolores: não liguei o grupo ${nomeDoGrupo} a nenhum cliente. Como outra pessoa me colocou nele, primeiro aceite o grupo («grupo ${g.codigo ?? "CÓDIGO"} aceitar») e depois me diga o tipo. Nada mudou.` };
        }
        d = { ...d, numero: auto.leadId };
      }
      const [l] = await db.select({ id: leads.id, nome: leads.name }).from(leads).where(and(eq(leads.id, d.numero!), isNull(leads.deletedAt))).limit(1);
      if (!l) {
        await auditar("recusada", "cliente não encontrado no CRM; nada mudou", { grupoId: g.id, leadId: d.numero });
        return { ok: false, texto: `Dolores: não achei o cliente nº ${d.numero} no CRM (ou ele foi excluído). Nada mudou no grupo ${nomeDoGrupo}.`, grupoId: g.id };
      }
      leadId = l.id;
      descricao = `${ROTULO_TIPO_GRUPO[tipo as "cliente"]} ${aspas(l.nome)} (nº ${l.id})`;
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
      // EPIC-027 (portão da C2): classificar pela TELA não reativa grupo desativado; o comando do dono no WhatsApp reativa (como antes)
      await tx.update(doloresGrupos).set({ tipo, leadId, obraId, ...(origem.via === "whatsapp" ? { ativo: true } : {}), situacaoConfirmacao: "confirmado", decididoEm: agora, decididoPor, obraExcluidaEm: null,
        ...(semProva ? { provaAdicao: "aceito_pelo_dono" as const } : {}),
        atualizadoEm: agora, atualizadoPorUserId: origem.via === "tela" ? origem.userId : null }).where(eq(doloresGrupos.id, g!.id));
      // grupo confirmado nasce com o interruptor LIGADO (se ninguém mexeu nele antes); nada fala com o interruptor geral desligado
      await tx.insert(doloresMarcacoesGrupo).values({ grupoId: g!.id, responderLigado: true, atualizadoPor: origem.via === "tela" ? origem.userId : null }).onConflictDoNothing();
    });
    await auditar("ok", `tipo do grupo definido pelo dono: ${d.tipo}`, { grupoId: g.id, tipo: d.tipo, leadId, obraId, antes: g.tipo ?? null });
    // EPIC-025 E11: ligado a um cliente → uma linha, com como corrigir (ele só responde se estiver errado)
    // QA E11 (M2): o interruptor do grupo nasce ligado como sempre foi para grupo confirmado pelo dono — e a linha diz que lá ela só
    // responde quando marcada (o interruptor geral continua valendo por cima)
    if (leadId) return { ok: true, texto: `Dolores: feito. Liguei o grupo ${nomeDoGrupo} (${g.codigo ?? g.id}) como ${descricao}. ${FRASE_SO_QUANDO_MARCADA}. Se estiver errado, me diga.`, grupoId: g.id };
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
  // Revisão automática: a elegibilidade (tipo indefinido, entrada provada, pergunta dos últimos 30 min) vai no SQL, ANTES do limite —
  // senão 50 linhas inelegíveis escondem as elegíveis e uma resposta ambígua pareceria ter um grupo só. As mesmas regras são
  // conferidas de novo abaixo (tipoEfetivo/semProvaDoDono), e o limite folgado basta para ver que há 2 ou mais (pede o código).
  const desde = new Date(agora.getTime() - JANELA_RESPOSTA_NUMERADA_MS);
  const ate = new Date(agora.getTime() + 2 * 60_000);
  const conhecidos = TIPOS_GRUPO.filter(t => t !== "indefinido");
  const linhas = await getDb().select().from(doloresGrupos).where(and(
    eq(doloresGrupos.ativo, true), eq(doloresGrupos.situacaoConfirmacao, "aguardando_dono"),
    // tipo indefinido (tipoEfetivo): tipo gravado e fora dos tipos conhecidos (NULL vira cliente/engenharia — não é indefinido)
    isNotNull(doloresGrupos.tipo), notInArray(doloresGrupos.tipo, conhecidos),
    // entrada provada (não autoriaPendente): manual, ou adicionada pelo dono, ou aceita pelo dono
    or(ne(doloresGrupos.origem, "automatico"), eq(doloresGrupos.adicionadoPor, "dono"), eq(doloresGrupos.provaAdicao, "aceito_pelo_dono")),
    isNotNull(doloresGrupos.perguntaTipoEm), gte(doloresGrupos.perguntaTipoEm, desde), lte(doloresGrupos.perguntaTipoEm, ate),
  )).orderBy(asc(doloresGrupos.id)).limit(50);
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

/**
 * QA E11 (M3) — a proposta de ligar um grupo de TERCEIRO ao cliente que o nome aponta: o MESMO item da fila e a MESMA pergunta do sistema
 * da conversa (resumo exato + hash; "pode"/"sim" confirma — `tratarConfirmacao`). Falhou → null (quem chama segue a pergunta pelo nome).
 */
async function proporVinculo(g: DoloresGrupo, leadId: number, tipo: "cliente" | "pos_atendimento", origem: OrigemDecisao): Promise<{ pergunta: string; pendenciaId: number; nome: string | null } | null> {
  if (origem.via !== "whatsapp") return null;
  try {
    const [{ prepararClassificarGrupo }, { porNaFila }, { abrirPendencia }, { usuarioDolores }, { VALIDADE_ITEM_CONFIRMAVEL_MS }] = await Promise.all([
      import("./acoes/grupos-config.js"), import("./aprovacoes.js"), import("./pendencia.js"), import("./perfil.js"), import("../../shared/dolores/confirmacao.js")]);
    const agora = origem.agora ?? new Date();
    const autorId = origem.autor ?? await usuarioDolores();
    const ctx = { agora, autorId, mensagemId: origem.mensagemId, pedidoId: `wa:${origem.mensagemId}`, aprovacaoId: null, motivoContaminacao: null, validadeFilaMs: VALIDADE_ITEM_CONFIRMAVEL_MS };
    const preparo = await prepararClassificarGrupo({ grupoId: g.id, tipo, leadId }, ctx);
    const criados = await porNaFila("classificar_grupo", preparo, ctx);
    const p = await abrirPendencia({ mensagemId: origem.mensagemId, codigos: criados.map(c => c.codigo), agora, autor: autorId });
    if (!p) return null;
    const [l] = await getDb().select({ nome: leads.name }).from(leads).where(eq(leads.id, leadId)).limit(1);
    return { pergunta: p.pergunta, pendenciaId: p.id, nome: l?.nome ?? null };
  } catch (e) {
    console.error("[dolores/grupos-decisao] não consegui propor o vínculo do grupo de terceiro", erroParaLog(e));
    return null;
  }
}

/**
 * EPIC-025 E11 — a pergunta "de qual cliente é?" (texto do SISTEMA): com candidatos, os NOMES para ele escolher (nunca o nº do CRM);
 * sem candidato, uma pergunta curta. A resposta só com o nome vale por 30 min (`decidirPeloNome`).
 */
export function perguntaDoCliente(candidatos: ReadonlyArray<{ id: number; nome: string | null }>, codigo: string | null, nomeDoGrupo?: string): string {
  const doGrupo = nomeDoGrupo ? ` o grupo ${nomeDoGrupo}` : "";
  if (candidatos.length > 1) {
    const nomes = candidatos.slice(0, 5).map(c => aspas(c.nome));
    return `De qual cliente é${doGrupo || " o grupo"}: ${nomes.slice(0, -1).join(", ")} ou ${nomes.at(-1)}? Responda com o nome.`;
  }
  return `De qual cliente é${doGrupo || " o grupo"}? Responda com o nome dele${codigo ? ` (ou «grupo ${codigo} ignorar» para eu não participar)` : ""}.`;
}

/** " de «Fulano» (nº 3)" do cliente ligado (lido agora; sem cliente → ""). */
async function nomeDoVinculo(leadId: number | null): Promise<string> {
  if (!leadId) return "";
  const [l] = await getDb().select({ id: leads.id, nome: leads.name }).from(leads).where(eq(leads.id, leadId)).limit(1).catch(() => []);
  return l ? ` de ${aspas(l.nome)} (nº ${l.id})` : "";
}

/**
 * EPIC-025 E11 — o dono respondeu SÓ com o nome do cliente ("Maria dayane", "1 Emily") à pergunta do tipo/cliente de UM grupo que
 * espera (pergunta dos últimos 30 min, `gruposEsperandoTipo`). Liga quando as palavras dele apontam UM cliente ativo e TODAS as
 * palavras dele estão no nome desse cliente (um "bom dia" não liga ninguém). Nenhum grupo esperando, ou nada casando → null (a
 * mensagem segue o caminho comum). Mais de um cliente → os nomes para ele escolher (nada muda). Só a conversa direta do dono.
 */
export async function decidirPeloNome(r: { palavras: string[]; tipo: "cliente" | "pos_atendimento" }, origem: Extract<OrigemDecisao, { via: "whatsapp" }> & { agora: Date }): Promise<ResultadoDecisao | null> {
  const esperando = await gruposEsperandoTipo(origem.agora);
  if (esperando.length !== 1) return null;
  const [g] = esperando;
  const achados = await clientesPelasPalavras(r.palavras);
  // QA E11 (B2): passou do teto → ambíguo (nunca "único" por corte)
  if (achados.cortado) return null;
  const candidatos = achados.clientes.filter(c => {
    const nome = new Set((c.nome ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" "));
    return r.palavras.every(p => nome.has(p));
  });
  if (!candidatos.length) return null;
  // portão 2 (M-C): o ÚNICO com ponto (mais de um → os nomes para ele escolher)
  const u = unicoComPonto(r.palavras, candidatos);
  const escolha = { escolhido: u.escolhido, empatados: u.comPonto };
  if (!escolha.escolhido) {
    await auditar0(origem, "recusada", "nome do cliente aponta mais de um cliente: perguntado de novo pelo nome", { grupoId: g.id, candidatos: escolha.empatados.length });
    await marcarPerguntaDoTipo(g.id, origem);
    return { ok: false, grupoId: g.id, texto: `Dolores: ${perguntaDoCliente(candidatos.filter(c => escolha.empatados.includes(c.id)), g.codigo)}` };
  }
  return decidirGrupo({ grupoId: g.id, instancia: g.instancia }, { tipo: r.tipo, numero: escolha.escolhido }, origem);
}

const auditar0 = (origem: Extract<OrigemDecisao, { via: "whatsapp" }>, resultado: "ok" | "recusada", motivo: string, resumo: Record<string, unknown>) =>
  registrarAcao({ funcao: "grupo_decisao", resultado, motivo, canal: "whatsapp", pedidoId: `wa:${origem.mensagemId}`, autorUserId: origem.autor, resumo });
