// EPIC-025 (Dolores, etapa 7) — o grupo ENTRA SOZINHO (regra do dono de 19/11/2026: "eu não quero ter que cadastrar grupo por
// grupo"). Chamado pelo webhook na primeira mensagem de um grupo desconhecido daquela instância e pelo botão "Atualizar grupos"
// da tela. Regras fixas deste arquivo:
// - O NOME vem da Evolution (metadado do grupo: findGroupInfos ou a lista de grupos), nunca do texto de mensagem. Sem nome, o
//   tipo fica "indefinido" e o grupo só observa até o dono responder.
// - O tipo é descoberto por CÓDIGO (shared/dolores/grupos-tipo.ts, sem IA). Cliente/pós-atendimento só com UM cliente casando.
// - Teto de segurança: no máximo N grupos novos por dia (qualquer pessoa pode colocar o número num grupo). Passou: não cria e
//   avisa o dono UMA vez no dia. Interruptor próprio ("entrada automática", nasce ligado); desligado, grupo novo é ignorado.
// - Aviso ao dono: um por grupo (idempotente), teto diário de avisos, pelo envio do sistema ao número do dono
//   (`enviarAvisoAoDono`, mesmos filtros de saída). Nome do grupo e do cliente: texto de terceiro, limpo e entre «».
// - Nada aqui fala no grupo nem executa ação. Nada é apagado. A resposta quando marcada continua presa ao interruptor GERAL.
// - QUEM COLOCOU A DOLORES (regra do dono de 19/11/2026: "somente o número principal, que no caso foi cadastrado meu lá na
//   integração, pode adicionar o número da Dolores em grupo"), provado por CÓDIGO, nesta ordem:
//   Aceitação automática SÓ com PROVA POSITIVA (QA-SEG E7, achados 1 e 2):
//   1) aviso `group-participants.update` da Evolution (action "add", a Dolores entre os adicionados): o AUTOR (`author`, quem
//      executou) é o número do dono (`ehNumeroDoDono`); autor em @lid só vale resolvido para telefone pelos participantes do grupo
//      na Evolution. Aviso de "add" com autor NÃO provado (@lid sem resolver, sem `author`) → recusado, nunca a reserva;
//   (QA-SEG E7 r2, R2-1) o aviso `groups.upsert` NÃO aceita sozinho: a lista que ele traz não prova quem estava no grupo desde a
//   criação. Grupo NOVO criado agora pelo dono com a Dolores na lista entra "aguardando o dono" (prova "criador") e o dono é
//   perguntado; o upsert nunca muda grupo que já existe.
//   Reserva (sem aviso nenhum: primeira mensagem, "Atualizar grupos", grupos em que ela já estava): os dados do grupo na
//   Evolution com o dono PARTICIPANTE e criador/admin deixam o grupo no MÁXIMO "aguardando o dono" (só observa, interruptor do
//   grupo desligado, nada de IA) e perguntam "não sei quem me colocou; se foi você, responda: grupo <código> aceitar". Sem isso:
//   recusado (não lê, não registra, não responde) e UM aviso. Aviso de "add" feito por outra pessoa (ou sem autor provado) para
//   grupo automático ainda não decidido pelo dono REBAIXA para recusado. Só o dono aceita (comando no WhatsApp ou adicionando-a
//   ele mesmo). O texto das mensagens nunca é prova de nada. Trocar o número do dono depois não muda os grupos já aceitos.
// - Tetos (QA-SEG E7, achado 4): grupos sem prova (recusados/aguardando) têm contador próprio — terceiros não tiram a vaga do
//   grupo que o dono adicionou — e os avisos deles são agrupados (os N primeiros do dia, depois um resumo único). Rajada de
//   mensagens do mesmo grupo novo: uma só entrada por vez por grupo nesta instância (uma consulta à Evolution, uma vaga).
import { randomInt } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { leads } from "../../drizzle/schema.js";
import { doloresGrupos, type DoloresGrupo } from "../../drizzle/schema-dolores-grupos.js";
import { doloresMarcacoesContagem, doloresMarcacoesGrupo } from "../../drizzle/schema-dolores-marcacoes.js";
import { diaDeImperatriz, jidDeGrupoValido } from "../../shared/dolores/grupos.js";
import {
  MAX_AVISOS_SEM_PROVA_DIA, autorEhODono, autoriaPendente, avisoDoTetoDeEntrada, avisoDoTetoSemProva, criacaoRecente, descobrirTipoDoGrupo, donoNoMetadado, ehADolores,
  gerarCodigoDeGrupo, lerParticipante, numeroDoJid, textoDoAvisoDeAutoriaDesconhecida, textoDoAvisoDeClassificacaoPelaTela, textoDoAvisoDeEntrada, textoDoAvisoDeEntradaNoAdministrativo, textoDoAvisoDeRecolocada, textoDoAvisoDeRecusa,
  textoDoResumoDeSemProva, tipoEfetivo, type AdicionadoPor, type ClienteParaTipo, type MetadadoDoGrupo, type ProvaAdicao, type TipoGrupo,
} from "../../shared/dolores/grupos-tipo.js";
import type { DoloresWhatsappConfig } from "../../drizzle/schema-dolores-whatsapp.js";
import { textoDeDado, umaLinha } from "../../shared/dolores/fila.js";
import { sanitizarTexto } from "../../shared/dolores/sanitizar.js";
import { metadadoDoGrupoEvolution } from "../_core/evolution.js";
import { getDb } from "../db.js";
import { registrarAcao } from "./auditoria.js";
import { FILTRO_DO_REGISTRO } from "./dados-pessoais.js";
import { erroParaLog } from "./erro-seguro.js";
import { lerConfigGrupos } from "./grupos.js";

/** Teto de clientes lidos do CRM para comparar o nome (bem acima da carteira de hoje). */
export const MAX_CLIENTES_PARA_TIPO = 20_000;
/** Tempo mínimo que sobra no prazo do aviso para perguntar o nome do grupo à Evolution. */
const MINIMO_PARA_PERGUNTAR_NOME_MS = 8_000;

export type AvisoAoDono = (texto: string, ctx: { funcao: string; pedidoId: string; autor: number | null; prazoFinal: number; canal: "whatsapp" | "tela" | "cron"; resumo: Record<string, unknown> }) => Promise<{ ok: boolean; motivo: string | null }>;

// ── Dependências substituíveis nos testes ──
type Dependencias = {
  /** Dados do grupo pela Evolution (só leitura): nome, criador e participantes. null = não soube. */
  metadado: (instancia: string, jid: string, prazoMs: number) => Promise<MetadadoDoGrupo | null>;
  ms: () => number;
};
const padrao: Dependencias = {
  metadado: async (instancia, jid, prazoMs) => {
    const { configEvolution } = await import("../whatsapp-router.js");
    const c = await configEvolution();
    if (!c) return null;
    // a chave da Evolution nunca segue redirecionamento para outro host (QA E4 r2 N4)
    const m = await metadadoDoGrupoEvolution({ ...c, semRedirecionamento: true }, instancia, jid, fetch, prazoMs);
    return m ? { nome: m.nome, criador: m.criador, participantes: m.participantes.map(lerParticipante) } : null;
  },
  ms: () => Date.now(),
};
let deps: Dependencias = { ...padrao };
/** Só para testes. Sem argumento, volta ao padrão. Também esquece as entradas em curso e o cache curto do teto. */
export function definirDependenciasEntrada(d?: Partial<Dependencias>) { deps = d ? { ...deps, ...d } : { ...padrao }; emCurso.clear(); tetoRecente.clear(); }

// ── Uma entrada por vez por grupo nesta instância (QA-SEG E7, achado 4: rajada paralela do mesmo grupo novo) ──
const emCurso = new Map<string, Promise<ResultadoEntrada>>();
/** Grupo que bateu no teto: por 60 s as mensagens seguintes dele nem perguntam à Evolution. */
const tetoRecente = new Map<string, number>();
const CACHE_TETO_MS = 60_000;

// ── Contadores atômicos (a mesma tabela de contadores da 4b, chaves próprias) ──
async function vaga(chave: string, teto: number): Promise<boolean> {
  if (teto <= 0) return false;
  const [r] = await getDb().insert(doloresMarcacoesContagem).values({ chave, total: 1 })
    .onConflictDoUpdate({ target: doloresMarcacoesContagem.chave, set: { total: sql`${doloresMarcacoesContagem.total} + 1`, ultimaEm: sql`now()` },
      setWhere: sql`${doloresMarcacoesContagem.total} < ${teto}` })
    .returning({ total: doloresMarcacoesContagem.total });
  return !!r;
}
async function primeiraVez(chave: string): Promise<boolean> {
  const r = await getDb().insert(doloresMarcacoesContagem).values({ chave, total: 1 }).onConflictDoNothing().returning({ chave: doloresMarcacoesContagem.chave });
  return r.length === 1;
}

/** Nome do WhatsApp para gravar: uma linha, sem colchetes, filtro do registro (dados pessoais mascarados, segredos sempre). */
export const nomeDoWhatsappParaGravar = (s: string | null | undefined) => {
  const t = textoDeDado(sanitizarTexto(umaLinha(s, 200), FILTRO_DO_REGISTRO), 120).trim();
  return t || null;
};

/** Clientes ativos do CRM (id e nome) para comparar com o nome do grupo. */
async function clientesDoCrm(): Promise<ClienteParaTipo[]> {
  const linhas = await getDb().select({ id: leads.id, nome: leads.name }).from(leads).where(isNull(leads.deletedAt)).limit(MAX_CLIENTES_PARA_TIPO);
  return linhas;
}

/** Prova vinda de um aviso de grupo da Evolution: autor provado o dono, provado outra pessoa, ou aviso sem autor provado. */
export type Adicao = { autor: "dono" | "outro" | "nao_provado"; prova: ProvaAdicao;
  /** Quem adicionou (só para o aviso ao dono, nunca gravado): nome que veio no aviso e o final do número, se provado. */
  quem?: { nome: string | null; finalDoNumero: string | null } };

/** `decidido_por` gravado quando o grupo entra pelo aviso de "add" com o autor = número do dono (QA-SEG E7 r2, R2-2). */
export const DECISAO_ADD_DO_DONO = "whatsapp:add-do-dono";

export type ResultadoEntrada =
  | { resultado: "existente"; grupo: DoloresGrupo }
  | { resultado: "criado"; grupo: DoloresGrupo; avisado: boolean }
  | { resultado: "entrada-desligada" | "entrada-teto" | "entrada-invalida" | "entrada-erro"; grupo: null };

type PedidoDeEntrada = {
  instancia: string; grupoJid: string; nomeNoWhatsapp?: string | null; agora: Date; autor: number | null; prazoFinal: number;
  canal: "whatsapp" | "tela"; avisar: AvisoAoDono | null;
  /** Número do dono AGORA (configuração). */
  numeroDono: string | null;
  /** Prova de quem colocou a Dolores, vinda de um aviso de grupo da Evolution. Sem ela, só a reserva (no máximo aguardando o dono). */
  adicao?: Adicao | null;
  /** Dados do grupo já lidos (ex.: para resolver o @lid do autor), para não perguntar de novo. */
  metadado?: MetadadoDoGrupo | null;
  /** Sem aviso de "add": como gravar a prova da reserva (o upsert de criação grava "criador"; padrão: "metadado"/"sem_prova"). */
  provaReserva?: ProvaAdicao;
};

/**
 * Cria o grupo sozinho (origem "automatico"), se ainda não existir nesta instância. `nomeNoWhatsapp` vem da lista da Evolution
 * (botão da tela); sem ele, o nome é perguntado à Evolution (só com tempo de sobra no prazo). Devolve o grupo (novo ou o que já
 * existia — ativo ou não, quem chama decide) ou por que não criou. Pedidos do mesmo grupo nesta instância vão um de cada vez.
 */
export function entrarNoGrupo(p: PedidoDeEntrada): Promise<ResultadoEntrada> {
  if (!p.instancia || !jidDeGrupoValido(p.grupoJid)) return Promise.resolve({ resultado: "entrada-invalida", grupo: null });
  const chave = `${p.instancia}|${p.grupoJid}`;
  const anterior = emCurso.get(chave);
  const atual = (anterior ? anterior.catch(() => undefined) : Promise.resolve()).then(() => entrarAgora(p, chave));
  emCurso.set(chave, atual);
  void atual.finally(() => { if (emCurso.get(chave) === atual) emCurso.delete(chave); }).catch(() => undefined);
  return atual;
}

async function entrarAgora(p: PedidoDeEntrada, chave: string): Promise<ResultadoEntrada> {
  const db = getDb();
  try {
    const [ja] = await db.select().from(doloresGrupos).where(and(eq(doloresGrupos.instancia, p.instancia), eq(doloresGrupos.grupoJid, p.grupoJid))).limit(1);
    if (ja) return { resultado: "existente", grupo: await tratarExistente(ja, p) };
    const config = await lerConfigGrupos();
    if (!config.entradaAutomaticaLigada) return { resultado: "entrada-desligada", grupo: null };
    // bateu no teto há pouco (mensagem seguinte do mesmo grupo): nem pergunta à Evolution
    if (!p.adicao && (tetoRecente.get(chave) ?? 0) > deps.ms()) return { resultado: "entrada-teto", grupo: null };
    const dia = diaDeImperatriz(p.agora);
    // o nome e a prova de quem a colocou: dos avisos/lista da Evolution ou perguntados agora (só com tempo de sobra). Nunca do
    // texto de mensagem. Vem ANTES do teto: o contador depende da prova (achado 4).
    let meta = p.metadado ?? null;
    if (!meta && (!p.adicao || !p.nomeNoWhatsapp) && p.prazoFinal - deps.ms() >= MINIMO_PARA_PERGUNTAR_NOME_MS) {
      meta = await deps.metadado(p.instancia, p.grupoJid, Math.min(5_000, p.prazoFinal - deps.ms() - 3_000))
        .catch(e => { console.error("[dolores/grupos-entrada] a Evolution não informou o grupo", erroParaLog(e)); return null; });
    }
    // quem a colocou: só o aviso com autor PROVADO o dono aceita; a reserva (dados do grupo) no máximo deixa aguardando o dono
    let adicionadoPor: AdicionadoPor;
    let prova: ProvaAdicao;
    if (p.adicao) {
      adicionadoPor = p.adicao.autor === "dono" ? "dono" : p.adicao.autor === "outro" ? "outra_pessoa" : "desconhecido";
      prova = p.adicao.autor === "nao_provado" ? "sem_prova" : p.adicao.prova;
    } else {
      adicionadoPor = "desconhecido";
      prova = p.provaReserva ?? (meta ? "metadado" : "sem_prova");
    }
    const peloDono = adicionadoPor === "dono";
    const reserva = !p.adicao && donoNoMetadado(meta, p.numeroDono);
    // teto: o do dono não é gasto por grupos sem prova (contador próprio)
    const chaveTeto = peloDono ? `entrada:${dia}` : `entrada-sem-prova:${dia}`;
    if (!(await vaga(chaveTeto, config.tetoGruposNovosDia))) {
      tetoRecente.set(chave, deps.ms() + CACHE_TETO_MS);
      // uma vez por dia (por contador): auditoria e aviso ao dono
      if (await primeiraVez(`${chaveTeto.replace(`:${dia}`, "")}-teto:${dia}`)) {
        await registrarAcao({ funcao: "grupo_entrada", resultado: "recusada", autorUserId: p.autor, canal: p.canal, pedidoId: `grupo:${chaveTeto}:teto`,
          motivo: peloDono ? `teto de ${config.tetoGruposNovosDia} grupos novos por dia atingido; os grupos novos de hoje ficam de fora`
            : `teto de ${config.tetoGruposNovosDia} grupos sem prova de quem colocou a Dolores por dia atingido; os próximos desse tipo ficam de fora hoje`, resumo: { dia, semProva: !peloDono } });
        if (p.avisar) await p.avisar(peloDono ? avisoDoTetoDeEntrada(config.tetoGruposNovosDia) : avisoDoTetoSemProva(config.tetoGruposNovosDia),
          { funcao: "grupo_entrada_aviso", pedidoId: `grupo:${chaveTeto}:teto`, autor: p.autor, prazoFinal: p.prazoFinal, canal: p.canal, resumo: { dia, teto: config.tetoGruposNovosDia, semProva: !peloDono } })
          .catch(() => undefined);
      }
      return { resultado: "entrada-teto", grupo: null };
    }
    const bruto = p.nomeNoWhatsapp ?? meta?.nome ?? null;
    const descoberto = bruto ? descobrirTipoDoGrupo(bruto, await clientesDoCrm()) : { tipo: "indefinido" as TipoGrupo, leadId: null, motivo: "a Evolution não informou o nome do grupo" };
    const nomeWhatsapp = nomeDoWhatsappParaGravar(bruto);
    const rotulo = nomeWhatsapp ?? `Grupo sem nome (final ${p.grupoJid.replace(/@g\.us$/, "").slice(-4)})`;
    const situacao = peloDono ? (descoberto.tipo === "indefinido" ? "aguardando_dono" as const : "avisado" as const) : reserva ? "aguardando_dono" as const : "recusado" as const;
    let grupo: DoloresGrupo | undefined;
    // o código é sorteado aqui; colisão (índice único) → sorteia de novo
    for (let tentativa = 0; tentativa < 6 && !grupo; tentativa++) {
      const codigo = gerarCodigoDeGrupo(() => randomInt(0, 1_000_000) / 1_000_000);
      const [linha] = await db.insert(doloresGrupos).values({
        instancia: p.instancia, grupoJid: p.grupoJid, nome: rotulo, nomeWhatsapp, tipo: descoberto.tipo, leadId: descoberto.leadId, obraId: null,
        origem: "automatico", situacaoConfirmacao: situacao, codigo, ativo: true, criadoPorUserId: null, atualizadoPorUserId: null,
        adicionadoPor, provaAdicao: prova,
        // QA-SEG E7 r2 (R2-2): o add PROVADO do dono é decisão dele — um terceiro que remova e readicione a Dolores não rebaixa
        ...(peloDono && prova === "evento_add" ? { decididoEm: new Date(), decididoPor: DECISAO_ADD_DO_DONO } : {}),
      }).onConflictDoNothing().returning();
      if (linha) { grupo = linha; break; }
      // outro aviso paralelo (outra instância) criou o mesmo grupo: usa o dele (e confere a prova deste pedido nele)
      const [outro] = await db.select().from(doloresGrupos).where(and(eq(doloresGrupos.instancia, p.instancia), eq(doloresGrupos.grupoJid, p.grupoJid))).limit(1);
      if (outro) return { resultado: "existente", grupo: await tratarExistente(outro, p) };
    }
    if (!grupo) return { resultado: "entrada-erro", grupo: null };
    // o interruptor do grupo nasce LIGADO só para grupo que o DONO provadamente adicionou, de tipo conhecido; nada fala enquanto o
    // interruptor GERAL estiver desligado. Aguardando/recusado: sem linha (desligado).
    if (peloDono && descoberto.tipo !== "indefinido") {
      await db.insert(doloresMarcacoesGrupo).values({ grupoId: grupo.id, responderLigado: true, atualizadoPor: null }).onConflictDoNothing()
        .catch(e => console.error("[dolores/grupos-entrada] não liguei o interruptor do grupo", erroParaLog(e)));
    }
    await registrarAcao({ funcao: "grupo_entrada", resultado: "ok", autorUserId: p.autor, canal: p.canal, pedidoId: `grupo:${grupo.id}:entrada`,
      motivo: peloDono ? `grupo entrou sozinho: ${descoberto.motivo}` : reserva ? `grupo AGUARDANDO o dono: não sei quem colocou a Dolores (${prova}); só observa`
        : `grupo RECUSADO: não ficou provado que foi o dono quem colocou a Dolores (${prova})`,
      resumo: { grupoId: grupo.id, tipo: descoberto.tipo, leadId: descoberto.leadId, situacao, comNome: !!bruto, adicionadoPor, prova } });
    const avisado = await avisarEntrada(grupo, { ...p, cliente: peloDono && descoberto.leadId ? await nomeDoCliente(descoberto.leadId) : null, tetoAvisos: config.tetoAvisosGruposDia, dia });
    return { resultado: "criado", grupo, avisado };
  } catch (e) {
    console.error("[dolores/grupos-entrada] falha ao criar o grupo", erroParaLog(e));
    return { resultado: "entrada-erro", grupo: null };
  }
}

/**
 * Grupo que já existe e chegou um aviso de quem colocou a Dolores:
 * - autor PROVADO o dono (aviso de "add") e o grupo estava recusado ou esperando o dono dizer quem a colocou → aceito;
 * - autor que não é o dono (ou não provado), grupo automático que o dono ainda não decidiu → REBAIXADO para recusado (achado 1c).
 * A prova "criador" (groups.upsert) nunca muda grupo existente (achado 2). Sem aviso: nada muda.
 */
async function tratarExistente(ja: DoloresGrupo, p: PedidoDeEntrada): Promise<DoloresGrupo> {
  if (!p.adicao) return ja;
  if (p.adicao.autor === "dono") {
    if (p.adicao.prova === "evento_add" && (ja.situacaoConfirmacao === "recusado" || autoriaPendente(ja))) return aceitarPeloDono(ja, p);
    return ja;
  }
  if (ja.origem !== "automatico" || ja.situacaoConfirmacao === "recusado") return ja;
  // QA-SEG E7 r2 (R2-2): grupo que o dono já decidiu (adicionou ou aceitou) não é rebaixado por add de terceiro: o dono é avisado
  if (ja.decididoEm !== null) { await avisarRecolocada(ja, p); return ja; }
  return rebaixar(ja, p);
}

/** Um aviso por grupo por dia, com teto diário próprio; só ao número do dono. Nada muda no grupo. */
async function avisarRecolocada(g: DoloresGrupo, p: PedidoDeEntrada): Promise<void> {
  if (!p.avisar || !g.ativo) return;
  try {
    const dia = diaDeImperatriz(p.agora);
    if (!(await primeiraVez(`aviso-recolocada:${g.id}:${dia}`))) return;
    const config = await lerConfigGrupos();
    if (!(await vaga(`avisos-recolocada:${dia}`, config.tetoAvisosGruposDia))) return;
    await registrarAcao({ funcao: "grupo_entrada_aviso", resultado: "ok", autorUserId: p.autor, canal: p.canal, pedidoId: `grupo:${g.id}:recolocada:${dia}`,
      motivo: "outra pessoa recolocou a Dolores num grupo que o dono já decidiu: nada muda, dono avisado", resumo: { grupoId: g.id, autor: p.adicao?.autor ?? null } });
    await p.avisar(textoDoAvisoDeRecolocada({ quem: p.adicao?.quem?.nome ?? null, finalDoNumero: p.adicao?.quem?.finalDoNumero ?? null, nomeDoGrupo: g.nomeWhatsapp ?? g.nome, codigo: g.codigo }),
      { funcao: "grupo_entrada_aviso", pedidoId: `grupo:${g.id}:recolocada:${dia}`, autor: p.autor, prazoFinal: p.prazoFinal, canal: p.canal, resumo: { grupoId: g.id } }).catch(() => undefined);
  } catch (e) {
    console.error("[dolores/grupos-entrada] falha ao avisar que recolocaram a Dolores", erroParaLog(e));
  }
}

async function rebaixar(g: DoloresGrupo, p: PedidoDeEntrada): Promise<DoloresGrupo> {
  const db = getDb();
  const agora = new Date();
  const adicionadoPor: AdicionadoPor = p.adicao?.autor === "outro" ? "outra_pessoa" : "desconhecido";
  const [novo] = await db.update(doloresGrupos).set({ situacaoConfirmacao: "recusado", adicionadoPor, provaAdicao: p.adicao?.autor === "outro" ? "evento_add" : "sem_prova", atualizadoEm: agora })
    .where(and(eq(doloresGrupos.id, g.id), isNull(doloresGrupos.decididoEm), sql`${doloresGrupos.situacaoConfirmacao} <> 'recusado'`)).returning();
  if (!novo) return g;
  // o interruptor do grupo volta a desligado (nada fala lá)
  await db.insert(doloresMarcacoesGrupo).values({ grupoId: g.id, responderLigado: false, atualizadoPor: null })
    .onConflictDoUpdate({ target: doloresMarcacoesGrupo.grupoId, set: { responderLigado: false, atualizadoEm: agora } })
    .catch(e => console.error("[dolores/grupos-entrada] não desliguei o interruptor do grupo rebaixado", erroParaLog(e)));
  await registrarAcao({ funcao: "grupo_entrada", resultado: "ok", autorUserId: p.autor, canal: p.canal, pedidoId: `grupo:${g.id}:rebaixado`,
    motivo: "grupo REBAIXADO para recusado: o aviso de quem colocou a Dolores não mostra o dono", resumo: { grupoId: g.id, antes: g.situacaoConfirmacao, adicionadoPor } });
  const config = await lerConfigGrupos().catch(() => null);
  await avisarEntrada(novo, { ...p, cliente: null, tetoAvisos: config?.tetoAvisosGruposDia ?? 0, dia: diaDeImperatriz(p.agora), chave: `aviso-grupo:${g.id}:recusado` });
  return novo;
}

async function nomeDoCliente(leadId: number) {
  const [l] = await getDb().select({ id: leads.id, nome: leads.name }).from(leads).where(eq(leads.id, leadId)).limit(1);
  return l ?? null;
}

/**
 * Um aviso por grupo (para sempre) e no máximo o teto do dia. Só ao número do dono, pelo envio do sistema. Grupo que o dono
 * provadamente adicionou usa o teto configurado; recusado/sem prova tem contagem própria: os N primeiros do dia, depois UM
 * resumo no dia (achado 4) — terceiros não esgotam os avisos dos grupos do dono nem mandam dezenas de mensagens.
 */
async function avisarEntrada(grupo: DoloresGrupo, p: { avisar: AvisoAoDono | null; agora?: Date; autor: number | null; prazoFinal: number; canal: "whatsapp" | "tela"; cliente: { id: number; nome: string | null } | null; tetoAvisos: number; dia: string; chave?: string }): Promise<boolean> {
  if (!p.avisar || !grupo.codigo) return false;
  if (!(await primeiraVez(p.chave ?? `aviso-grupo:${grupo.id}`))) return false;
  const semProva = grupo.adicionadoPor !== "dono";
  const ctx = { funcao: "grupo_entrada_aviso", pedidoId: `grupo:${grupo.id}:aviso`, autor: p.autor, prazoFinal: p.prazoFinal, canal: p.canal, resumo: { grupoId: grupo.id, tipo: grupo.tipo, semProva } };
  if (semProva) {
    if (!(await vaga(`avisos-sem-prova:${p.dia}`, Math.min(MAX_AVISOS_SEM_PROVA_DIA, p.tetoAvisos)))) {
      await registrarAcao({ funcao: "grupo_entrada_aviso", resultado: "recusada", autorUserId: p.autor, canal: p.canal, pedidoId: `grupo:${grupo.id}:aviso`,
        motivo: "avisos de grupos sem prova agrupados no resumo do dia; o grupo aparece na tela", resumo: { grupoId: grupo.id } });
      if (await primeiraVez(`avisos-sem-prova-resumo:${p.dia}`)) {
        await p.avisar(textoDoResumoDeSemProva(Math.min(MAX_AVISOS_SEM_PROVA_DIA, p.tetoAvisos)), { ...ctx, pedidoId: `grupo:avisos-sem-prova:${p.dia}`, resumo: { dia: p.dia } }).catch(() => undefined);
      }
      return false;
    }
  } else if (!(await vaga(`avisos-grupos:${p.dia}`, p.tetoAvisos))) {
    await registrarAcao({ funcao: "grupo_entrada_aviso", resultado: "recusada", autorUserId: p.autor, canal: p.canal, pedidoId: `grupo:${grupo.id}:aviso`,
      motivo: `teto de ${p.tetoAvisos} avisos de grupo novo por dia atingido; o grupo aparece na tela e no relatório`, resumo: { grupoId: grupo.id } });
    return false;
  }
  const texto = grupo.situacaoConfirmacao === "recusado" ? textoDoAvisoDeRecusa({ nomeDoGrupo: grupo.nomeWhatsapp, codigo: grupo.codigo, provado: grupo.adicionadoPor === "outra_pessoa" })
    : autoriaPendente(grupo) ? textoDoAvisoDeAutoriaDesconhecida({ nomeDoGrupo: grupo.nomeWhatsapp, codigo: grupo.codigo })
    : textoDoAvisoDeEntrada({ nomeDoGrupo: grupo.nomeWhatsapp, codigo: grupo.codigo, tipo: grupo.tipo ?? "indefinido", cliente: p.cliente });
  const r = await p.avisar(texto, ctx).catch(() => ({ ok: false, motivo: "falha" }));
  // EPIC-027 C3: a pergunta do tipo saiu — a resposta só com o número vale por 30 min a partir daqui
  if (r.ok && grupo.situacaoConfirmacao !== "recusado" && !autoriaPendente(grupo) && tipoEfetivo(grupo) === "indefinido") {
    const { marcarPerguntaDoTipo } = await import("./grupos-decisao.js");
    await marcarPerguntaDoTipo(grupo.id, { agora: p.agora ?? new Date() });
  }
  return r.ok;
}

/**
 * Grupo recusado (ou esperando o dono dizer quem a colocou) que o DONO adicionou depois — provado pelo aviso de "add" da Evolution
 * com o autor = número dele: aceito, como decisão dele, e o aviso normal do tipo segue (uma vez).
 */
async function aceitarPeloDono(g: DoloresGrupo, p: PedidoDeEntrada): Promise<DoloresGrupo> {
  const agora = new Date();
  const tipo = tipoEfetivo(g);
  const [novo] = await getDb().update(doloresGrupos).set({ situacaoConfirmacao: tipo === "indefinido" ? "aguardando_dono" : "avisado", adicionadoPor: "dono", provaAdicao: "evento_add",
    decididoEm: agora, decididoPor: "whatsapp:dono-adicionou", atualizadoEm: agora })
    .where(and(eq(doloresGrupos.id, g.id), eq(doloresGrupos.situacaoConfirmacao, g.situacaoConfirmacao))).returning();
  if (!novo) return g;
  if (tipo !== "indefinido") {
    await getDb().insert(doloresMarcacoesGrupo).values({ grupoId: g.id, responderLigado: true, atualizadoPor: null })
      .onConflictDoUpdate({ target: doloresMarcacoesGrupo.grupoId, set: { responderLigado: true, atualizadoEm: agora } }).catch(() => undefined);
  }
  await registrarAcao({ funcao: "grupo_entrada", resultado: "ok", autorUserId: p.autor, canal: p.canal, pedidoId: `grupo:${g.id}:aceito`,
    motivo: "grupo aceito: o dono adicionou a Dolores (aviso de add com o autor = número do dono)", resumo: { grupoId: g.id, antes: g.situacaoConfirmacao, prova: "evento_add" } });
  const config = await lerConfigGrupos().catch(() => null);
  await avisarEntrada(novo, { ...p, cliente: novo.leadId ? await nomeDoCliente(novo.leadId) : null, tetoAvisos: config?.tetoAvisosGruposDia ?? 0, dia: diaDeImperatriz(p.agora), chave: `aviso-grupo:${g.id}:aceito` });
  return novo;
}

// ── Os avisos de grupo da Evolution (quem adicionou; criação do grupo) ──

export type IdentidadeParaEvento = { numero: string | null; lid: string | null };

/**
 * `group-participants.update` (action "add") e `groups.upsert`, vindos do webhook AUTENTICADO da instância da Dolores. Só servem
 * para provar quem colocou a Dolores no grupo e criar o grupo (com a mesma entrada, tetos e aviso). Nada aqui lê mensagem, fala no
 * grupo ou executa ação. Devolve a chave da contagem do aviso.
 */
export async function tratarEventoDeGrupo(cfg: DoloresWhatsappConfig, evento: "participantes" | "criacao", dados: unknown, ctx: {
  agora: Date; autor: number | null; prazoFinal: number; avisar: AvisoAoDono | null; identidade: IdentidadeParaEvento;
}): Promise<string> {
  if (!cfg.instancia) return "grupo-evento-ignorado";
  const base = { instancia: cfg.instancia, agora: ctx.agora, autor: ctx.autor, prazoFinal: ctx.prazoFinal, canal: "whatsapp" as const, avisar: ctx.avisar, numeroDono: cfg.numeroDono };
  if (evento === "participantes") {
    const d = (dados ?? {}) as Record<string, unknown>;
    const jid = typeof d.id === "string" ? d.id : typeof d.groupJid === "string" ? d.groupJid : "";
    if (!jidDeGrupoValido(jid) || String(d.action ?? "").toLowerCase() !== "add") return "grupo-evento-ignorado";
    const adicionados = (Array.isArray(d.participants) ? d.participants.slice(0, 1024) : []).map(lerParticipante);
    if (!adicionados.some(x => ehADolores(x, ctx.identidade))) return avisarEntradaNoAdministrativo(cfg.instancia, jid, adicionados.length, base);
    const autores = [d.author, d.authorPn, d.authorJid].filter((v): v is string => typeof v === "string" && !!v.trim());
    let meta: MetadadoDoGrupo | null = null;
    // aviso de "add" presente: o autor decide; sem autor provado (sem campo, @lid não resolvido) → não provado (recusado), nunca a
    // reserva pelos dados do grupo (achado 1a)
    let adicao: Adicao = { autor: "nao_provado", prova: "evento_add" };
    const porNumero = autores.find(a => /@s\.whatsapp\.net$/.test(a));
    // nome de quem adicionou, se o aviso trouxer (só vai no aviso ao dono, limpo; nunca gravado)
    const nomeDeQuem = [d.authorName, d.pushName, d.notify].find((v): v is string => typeof v === "string" && !!v.trim())?.slice(0, 120) ?? null;
    const quem = (numero: string | null) => ({ nome: nomeDeQuem, finalDoNumero: numero ? numero.slice(-4) : null });
    if (porNumero) adicao = { autor: autorEhODono(porNumero, cfg.numeroDono) ? "dono" : "outro", prova: "evento_add", quem: quem(numeroDoJid(porNumero)) };
    else if (autores.length && ctx.prazoFinal - deps.ms() >= MINIMO_PARA_PERGUNTAR_NOME_MS) {
      meta = await deps.metadado(cfg.instancia, jid, Math.min(5_000, ctx.prazoFinal - deps.ms() - 3_000)).catch(() => null);
      const mapa = new Map((meta?.participantes ?? []).filter(x => x.lid && x.numero).map(x => [x.lid!, x.numero!]));
      const resolvido = autores.find(a => mapa.has(a.trim()));
      if (resolvido) adicao = { autor: autorEhODono(resolvido, cfg.numeroDono, mapa) ? "dono" : "outro", prova: "evento_add", quem: quem(mapa.get(resolvido.trim()) ?? null) };
      else adicao = { ...adicao, quem: quem(null) };
    }
    const r = await entrarNoGrupo({ ...base, grupoJid: jid, adicao, metadado: meta });
    return `grupo-evento-${r.resultado}`;
  }
  // criação (QA-SEG E7 r2, R2-1): o `groups.upsert` NUNCA aceita sozinho. Ele chega tanto na criação quanto quando alguém coloca
  // a Dolores num grupo que já existe, e a lista de participantes que ele traz é a de AGORA — não prova que a Dolores estava
  // entre os participantes INICIAIS (num grupo do dono criado há 2 min, outro membro pode tê-la colocado). Grupo NOVO, criado
  // agora pelo dono, com a Dolores na lista: entra no máximo "aguardando o dono" (só observa) e o dono é perguntado ("grupo
  // <código> aceitar"). Aceitação automática só pelo aviso de "add" com o autor = número do dono. Grupo antigo, sem o campo de
  // criação ou de outro criador: nada aqui (fica para o aviso de "add", a primeira mensagem ou a tela).
  const lista = (Array.isArray(dados) ? dados : [dados]).slice(0, 20);
  let ultimo = "grupo-evento-ignorado";
  for (const g of lista) {
    const x = (g ?? {}) as Record<string, unknown>;
    const jid = typeof x.id === "string" ? x.id : "";
    if (!jidDeGrupoValido(jid)) continue;
    const participantes = (Array.isArray(x.participants) ? x.participants.slice(0, 1024) : []).map(lerParticipante);
    if (!participantes.some(p => ehADolores(p, ctx.identidade))) { ultimo = "grupo-evento-outro"; continue; }
    const meta: MetadadoDoGrupo = { nome: typeof x.subject === "string" ? x.subject.slice(0, 200) : null,
      criador: [x.owner, x.ownerPn, x.ownerJid].filter((v): v is string => typeof v === "string"), participantes };
    const mapa = new Map(participantes.filter(p => p.lid && p.numero).map(p => [p.lid!, p.numero!]));
    if (!criacaoRecente(x.creation, ctx.agora) || !meta.criador.some(c => autorEhODono(c, cfg.numeroDono, mapa))) { ultimo = "grupo-evento-sem-prova"; continue; }
    const [ja] = await getDb().select({ id: doloresGrupos.id }).from(doloresGrupos).where(and(eq(doloresGrupos.instancia, cfg.instancia), eq(doloresGrupos.grupoJid, jid))).limit(1);
    if (ja) { ultimo = "grupo-evento-existente"; continue; } // o criador nunca muda grupo que já existe
    const r = await entrarNoGrupo({ ...base, grupoJid: jid, nomeNoWhatsapp: meta.nome, adicao: null, metadado: meta, provaReserva: "criador" });
    ultimo = `grupo-evento-${r.resultado}`;
  }
  return ultimo;
}

/**
 * QA-SEG E7 (achado 6d) — alguém (não a Dolores) foi adicionado a um grupo ADMINISTRATIVO já aceito: avisa o dono (um aviso por
 * grupo por dia; nome do grupo limpo; sem número nem nome de quem entrou). Só leitura do cadastro; nada fala no grupo.
 */
async function avisarEntradaNoAdministrativo(instancia: string, jid: string, quantos: number, base: { agora: Date; autor: number | null; prazoFinal: number; avisar: AvisoAoDono | null }): Promise<string> {
  if (!quantos || !base.avisar) return "grupo-evento-outro";
  try {
    const [g] = await getDb().select().from(doloresGrupos).where(and(eq(doloresGrupos.instancia, instancia), eq(doloresGrupos.grupoJid, jid))).limit(1);
    if (!g || !g.ativo || tipoEfetivo(g) !== "administrativo" || (g.situacaoConfirmacao !== "avisado" && g.situacaoConfirmacao !== "confirmado")) return "grupo-evento-outro";
    const dia = diaDeImperatriz(base.agora);
    if (!(await primeiraVez(`aviso-adm-entrada:${g.id}:${dia}`))) return "grupo-evento-outro";
    const config = await lerConfigGrupos();
    // QA-SEG E7 r2 (item 6): contador próprio — não gasta (nem é gasto por) os avisos de grupo novo
    if (!(await vaga(`avisos-adm-entrada:${dia}`, config.tetoAvisosGruposDia))) return "grupo-evento-outro";
    await registrarAcao({ funcao: "grupo_entrada_aviso", resultado: "ok", autorUserId: base.autor, canal: "whatsapp", pedidoId: `grupo:${g.id}:adm-entrada:${dia}`,
      motivo: "alguém foi adicionado a um grupo administrativo aceito: dono avisado", resumo: { grupoId: g.id, quantos: Math.min(quantos, 1024) } });
    await base.avisar(textoDoAvisoDeEntradaNoAdministrativo({ nomeDoGrupo: g.nomeWhatsapp ?? g.nome, quantos: Math.min(quantos, 1024), codigo: g.codigo }),
      { funcao: "grupo_entrada_aviso", pedidoId: `grupo:${g.id}:adm-entrada:${dia}`, autor: base.autor, prazoFinal: base.prazoFinal, canal: "whatsapp", resumo: { grupoId: g.id } }).catch(() => undefined);
    return "grupo-evento-aviso-administrativo";
  } catch (e) {
    console.error("[dolores/grupos-entrada] falha ao conferir entrada no grupo administrativo", erroParaLog(e));
    return "grupo-evento-outro";
  }
}

/**
 * QA-SEG EPIC-027 (achado 1b) — classificação feita pela TELA (admin ou colaborador): aviso ao dono no WhatsApp (texto fixo, sem
 * IA) com o grupo, o tipo antes → depois, quem mudou e quando. Conta no teto diário de avisos de grupo (contador próprio). Passou do
 * teto (ou o envio falhou): a classificação continua valendo e o grupo fica marcado "aviso pendente" — entra no relatório diário.
 */
export async function avisarClassificacaoPelaTela(p: { grupo: DoloresGrupo; antes: TipoGrupo; depois: TipoGrupo; quem: string | null; userId: number; agora: Date; avisar: AvisoAoDono }): Promise<"avisado" | "pendente"> {
  const dia = diaDeImperatriz(p.agora);
  const quando = p.agora.toLocaleString("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "short", timeStyle: "short" });
  const texto = textoDoAvisoDeClassificacaoPelaTela({ nomeDoGrupo: p.grupo.nomeWhatsapp ?? p.grupo.nome, codigo: p.grupo.codigo, antes: p.antes, depois: p.depois, quem: p.quem, quando });
  let ok = false;
  try {
    const config = await lerConfigGrupos();
    if (await vaga(`avisos-classificacao-tela:${dia}`, config.tetoAvisosGruposDia)) {
      const r = await p.avisar(texto, { funcao: "grupo_classificacao_aviso", pedidoId: `tela:grupos:${p.grupo.id}:aviso`, autor: null, prazoFinal: Date.now() + 15_000, canal: "tela",
        resumo: { grupoId: p.grupo.id, antes: p.antes, depois: p.depois, porUserId: p.userId } });
      ok = r.ok;
    }
  } catch (e) { console.error("[dolores/grupos-entrada] falha no aviso da classificação pela tela", erroParaLog(e)); }
  await getDb().update(doloresGrupos).set({ avisoClassificacaoPendenteEm: ok ? null : p.agora }).where(eq(doloresGrupos.id, p.grupo.id))
    .catch(e => console.error("[dolores/grupos-entrada] não marquei o aviso pendente", erroParaLog(e)));
  if (!ok) await registrarAcao({ funcao: "grupo_classificacao_aviso", resultado: "recusada", autorUserId: null, canal: "tela", pedidoId: `tela:grupos:${p.grupo.id}:aviso`,
    motivo: "aviso ao dono da classificação pela tela não saiu (teto do dia ou falha): fica pendente e entra no relatório diário", resumo: { grupoId: p.grupo.id, porUserId: p.userId } }).catch(() => undefined);
  return ok ? "avisado" : "pendente";
}
