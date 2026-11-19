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
//   1) aviso `group-participants.update` da Evolution (action "add", a Dolores entre os adicionados): o AUTOR (`author`, quem
//      executou) é o número do dono (`ehNumeroDoDono`); autor em @lid só vale resolvido para telefone pelos participantes do grupo
//      na Evolution;
//   2) aviso `groups.upsert` (grupo criado com a Dolores dentro): o CRIADOR (`owner`) é o dono;
//   3) sem aviso (perdido, grupo antigo, @lid não resolvido): os dados do grupo na Evolution — o dono é PARTICIPANTE e é o criador
//      ou admin.
//   Sem prova → NÃO foi o dono: o grupo fica "recusado" (não lê, não registra, não responde) e o dono recebe UM aviso; só ele
//   aceita ("grupo <código> aceitar" ou adicionando-a ele mesmo). O texto das mensagens nunca é prova de nada. Trocar o número do
//   dono depois não muda os grupos já aceitos; os novos seguem o número novo.
import { randomInt } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { leads } from "../../drizzle/schema.js";
import { doloresGrupos, type DoloresGrupo } from "../../drizzle/schema-dolores-grupos.js";
import { doloresMarcacoesContagem, doloresMarcacoesGrupo } from "../../drizzle/schema-dolores-marcacoes.js";
import { diaDeImperatriz, jidDeGrupoValido } from "../../shared/dolores/grupos.js";
import {
  autorEhODono, avisoDoTetoDeEntrada, descobrirTipoDoGrupo, donoNoMetadado, ehADolores, gerarCodigoDeGrupo, lerParticipante, textoDoAvisoDeEntrada,
  textoDoAvisoDeRecusa, tipoEfetivo, type ClienteParaTipo, type MetadadoDoGrupo, type ProvaAdicao, type TipoGrupo,
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
/** Só para testes. Sem argumento, volta ao padrão. */
export function definirDependenciasEntrada(d?: Partial<Dependencias>) { deps = d ? { ...deps, ...d } : { ...padrao }; }

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

export type ResultadoEntrada =
  | { resultado: "existente"; grupo: DoloresGrupo }
  | { resultado: "criado"; grupo: DoloresGrupo; avisado: boolean }
  | { resultado: "entrada-desligada" | "entrada-teto" | "entrada-invalida" | "entrada-erro"; grupo: null };

/**
 * Cria o grupo sozinho (origem "automatico"), se ainda não existir nesta instância. `nomeNoWhatsapp` vem da lista da Evolution
 * (botão da tela); sem ele, o nome é perguntado à Evolution (só com tempo de sobra no prazo). Devolve o grupo (novo ou o que já
 * existia — ativo ou não, quem chama decide) ou por que não criou.
 */
export async function entrarNoGrupo(p: {
  instancia: string; grupoJid: string; nomeNoWhatsapp?: string | null; agora: Date; autor: number | null; prazoFinal: number;
  canal: "whatsapp" | "tela"; avisar: AvisoAoDono | null;
  /** Número do dono AGORA (configuração). */
  numeroDono: string | null;
  /** Prova de quem colocou a Dolores, vinda de um aviso de grupo da Evolution. Sem ela, confere pelos dados do grupo. */
  adicao?: { dono: boolean; prova: ProvaAdicao } | null;
  /** Dados do grupo já lidos (ex.: para resolver o @lid do autor), para não perguntar de novo. */
  metadado?: MetadadoDoGrupo | null;
}): Promise<ResultadoEntrada> {
  if (!p.instancia || !jidDeGrupoValido(p.grupoJid)) return { resultado: "entrada-invalida", grupo: null };
  const db = getDb();
  try {
    const [ja] = await db.select().from(doloresGrupos).where(and(eq(doloresGrupos.instancia, p.instancia), eq(doloresGrupos.grupoJid, p.grupoJid))).limit(1);
    // recusado e agora o DONO a adicionou (provado pelo aviso): é decisão dele — aceita
    if (ja && ja.situacaoConfirmacao === "recusado" && p.adicao?.dono) return { resultado: "existente", grupo: await aceitarPeloDono(ja, p.adicao.prova, p) };
    if (ja) return { resultado: "existente", grupo: ja };
    const config = await lerConfigGrupos();
    if (!config.entradaAutomaticaLigada) return { resultado: "entrada-desligada", grupo: null };
    const dia = diaDeImperatriz(p.agora);
    if (!(await vaga(`entrada:${dia}`, config.tetoGruposNovosDia))) {
      // uma vez por dia: auditoria e aviso ao dono (os grupos de depois do teto ficam de fora até o dia seguinte)
      if (await primeiraVez(`entrada-teto:${dia}`)) {
        await registrarAcao({ funcao: "grupo_entrada", resultado: "recusada", autorUserId: p.autor, canal: p.canal, pedidoId: `grupo:entrada:teto:${dia}`,
          motivo: `teto de ${config.tetoGruposNovosDia} grupos novos por dia atingido; os grupos novos de hoje ficam de fora`, resumo: { dia } });
        if (p.avisar) await p.avisar(avisoDoTetoDeEntrada(config.tetoGruposNovosDia), { funcao: "grupo_entrada_aviso", pedidoId: `grupo:entrada:teto:${dia}`, autor: p.autor,
          prazoFinal: p.prazoFinal, canal: p.canal, resumo: { dia, teto: config.tetoGruposNovosDia } }).catch(() => undefined);
      }
      return { resultado: "entrada-teto", grupo: null };
    }
    // o nome e a prova de quem a colocou: dos avisos/lista da Evolution ou perguntados agora (só com tempo de sobra). Nunca do
    // texto de mensagem.
    let meta = p.metadado ?? null;
    if (!meta && (!p.adicao || !p.nomeNoWhatsapp) && p.prazoFinal - deps.ms() >= MINIMO_PARA_PERGUNTAR_NOME_MS) {
      meta = await deps.metadado(p.instancia, p.grupoJid, Math.min(5_000, p.prazoFinal - deps.ms() - 3_000))
        .catch(e => { console.error("[dolores/grupos-entrada] a Evolution não informou o grupo", erroParaLog(e)); return null; });
    }
    const bruto = p.nomeNoWhatsapp ?? meta?.nome ?? null;
    const prova: ProvaAdicao = p.adicao?.prova ?? (meta ? "metadado" : "sem_prova");
    const peloDono = p.adicao ? p.adicao.dono : donoNoMetadado(meta, p.numeroDono);
    const descoberto = bruto ? descobrirTipoDoGrupo(bruto, await clientesDoCrm()) : { tipo: "indefinido" as TipoGrupo, leadId: null, motivo: "a Evolution não informou o nome do grupo" };
    const nomeWhatsapp = nomeDoWhatsappParaGravar(bruto);
    const rotulo = nomeWhatsapp ?? `Grupo sem nome (final ${p.grupoJid.replace(/@g\.us$/, "").slice(-4)})`;
    const situacao = !peloDono ? "recusado" as const : descoberto.tipo === "indefinido" ? "aguardando_dono" as const : "avisado" as const;
    let grupo: DoloresGrupo | undefined;
    // o código é sorteado aqui; colisão (índice único) → sorteia de novo
    for (let tentativa = 0; tentativa < 6 && !grupo; tentativa++) {
      const codigo = gerarCodigoDeGrupo(() => randomInt(0, 1_000_000) / 1_000_000);
      const [linha] = await db.insert(doloresGrupos).values({
        instancia: p.instancia, grupoJid: p.grupoJid, nome: rotulo, nomeWhatsapp, tipo: descoberto.tipo, leadId: descoberto.leadId, obraId: null,
        origem: "automatico", situacaoConfirmacao: situacao, codigo, ativo: true, criadoPorUserId: null, atualizadoPorUserId: null,
        adicionadoPor: peloDono ? "dono" : "outra_pessoa", provaAdicao: prova,
      }).onConflictDoNothing().returning();
      if (linha) { grupo = linha; break; }
      // outro aviso paralelo criou o mesmo grupo: usa o dele
      const [outro] = await db.select().from(doloresGrupos).where(and(eq(doloresGrupos.instancia, p.instancia), eq(doloresGrupos.grupoJid, p.grupoJid))).limit(1);
      if (outro) return { resultado: "existente", grupo: outro };
    }
    if (!grupo) return { resultado: "entrada-erro", grupo: null };
    // o interruptor do grupo nasce LIGADO para grupo de tipo conhecido; nada fala enquanto o interruptor GERAL estiver desligado
    if (peloDono && descoberto.tipo !== "indefinido") {
      await db.insert(doloresMarcacoesGrupo).values({ grupoId: grupo.id, responderLigado: true, atualizadoPor: null }).onConflictDoNothing()
        .catch(e => console.error("[dolores/grupos-entrada] não liguei o interruptor do grupo", erroParaLog(e)));
    }
    await registrarAcao({ funcao: "grupo_entrada", resultado: "ok", autorUserId: p.autor, canal: p.canal, pedidoId: `grupo:${grupo.id}:entrada`,
      motivo: peloDono ? `grupo entrou sozinho: ${descoberto.motivo}` : `grupo RECUSADO: não ficou provado que foi o dono quem colocou a Dolores (${prova})`,
      resumo: { grupoId: grupo.id, tipo: descoberto.tipo, leadId: descoberto.leadId, situacao, comNome: !!bruto, adicionadoPor: peloDono ? "dono" : "outra_pessoa", prova } });
    const avisado = await avisarEntrada(grupo, { ...p, cliente: descoberto.leadId ? await nomeDoCliente(descoberto.leadId) : null, tetoAvisos: config.tetoAvisosGruposDia, dia });
    return { resultado: "criado", grupo, avisado };
  } catch (e) {
    console.error("[dolores/grupos-entrada] falha ao criar o grupo", erroParaLog(e));
    return { resultado: "entrada-erro", grupo: null };
  }
}

async function nomeDoCliente(leadId: number) {
  const [l] = await getDb().select({ id: leads.id, nome: leads.name }).from(leads).where(eq(leads.id, leadId)).limit(1);
  return l ?? null;
}

/** Um aviso por grupo (para sempre) e no máximo o teto do dia. Só ao número do dono, pelo envio do sistema. */
async function avisarEntrada(grupo: DoloresGrupo, p: { avisar: AvisoAoDono | null; autor: number | null; prazoFinal: number; canal: "whatsapp" | "tela"; cliente: { id: number; nome: string | null } | null; tetoAvisos: number; dia: string }): Promise<boolean> {
  if (!p.avisar || !grupo.codigo) return false;
  if (!(await primeiraVez(`aviso-grupo:${grupo.id}`))) return false;
  if (!(await vaga(`avisos-grupos:${p.dia}`, p.tetoAvisos))) {
    await registrarAcao({ funcao: "grupo_entrada_aviso", resultado: "recusada", autorUserId: p.autor, canal: p.canal, pedidoId: `grupo:${grupo.id}:aviso`,
      motivo: `teto de ${p.tetoAvisos} avisos de grupo novo por dia atingido; o grupo aparece na tela e no relatório`, resumo: { grupoId: grupo.id } });
    return false;
  }
  const texto = grupo.situacaoConfirmacao === "recusado" ? textoDoAvisoDeRecusa({ nomeDoGrupo: grupo.nomeWhatsapp, codigo: grupo.codigo })
    : textoDoAvisoDeEntrada({ nomeDoGrupo: grupo.nomeWhatsapp, codigo: grupo.codigo, tipo: grupo.tipo ?? "indefinido", cliente: p.cliente });
  const r = await p.avisar(texto, { funcao: "grupo_entrada_aviso", pedidoId: `grupo:${grupo.id}:aviso`, autor: p.autor, prazoFinal: p.prazoFinal, canal: p.canal,
    resumo: { grupoId: grupo.id, tipo: grupo.tipo } }).catch(() => ({ ok: false, motivo: "falha" }));
  return r.ok;
}

/** Grupo recusado que o DONO adicionou depois (provado pelo aviso da Evolution): aceito, como decisão dele. */
async function aceitarPeloDono(g: DoloresGrupo, prova: ProvaAdicao, p: { autor: number | null; canal: "whatsapp" | "tela" }): Promise<DoloresGrupo> {
  const agora = new Date();
  const tipo = tipoEfetivo(g);
  const [novo] = await getDb().update(doloresGrupos).set({ situacaoConfirmacao: tipo === "indefinido" ? "aguardando_dono" : "avisado", adicionadoPor: "dono", provaAdicao: prova,
    decididoEm: agora, decididoPor: "whatsapp:dono-adicionou", atualizadoEm: agora })
    .where(and(eq(doloresGrupos.id, g.id), eq(doloresGrupos.situacaoConfirmacao, "recusado"))).returning();
  if (!novo) return g;
  if (tipo !== "indefinido") await getDb().insert(doloresMarcacoesGrupo).values({ grupoId: g.id, responderLigado: true, atualizadoPor: null }).onConflictDoNothing().catch(() => undefined);
  await registrarAcao({ funcao: "grupo_entrada", resultado: "ok", autorUserId: p.autor, canal: p.canal, pedidoId: `grupo:${g.id}:aceito`,
    motivo: "grupo recusado aceito: o dono adicionou a Dolores", resumo: { grupoId: g.id, prova } });
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
    if (!adicionados.some(x => ehADolores(x, ctx.identidade))) return "grupo-evento-outro";
    const autores = [d.author, d.authorPn, d.authorJid].filter((v): v is string => typeof v === "string" && !!v.trim());
    let meta: MetadadoDoGrupo | null = null;
    let adicao: { dono: boolean; prova: ProvaAdicao } | null = null;
    // autor em telefone decide na hora; em @lid, só resolvido pelos participantes do grupo na Evolution
    const porNumero = autores.find(a => /@s\.whatsapp\.net$/.test(a));
    if (porNumero) adicao = { dono: autorEhODono(porNumero, cfg.numeroDono), prova: "evento_add" };
    else if (autores.length && ctx.prazoFinal - deps.ms() >= MINIMO_PARA_PERGUNTAR_NOME_MS) {
      meta = await deps.metadado(cfg.instancia, jid, Math.min(5_000, ctx.prazoFinal - deps.ms() - 3_000)).catch(() => null);
      const mapa = new Map((meta?.participantes ?? []).filter(x => x.lid && x.numero).map(x => [x.lid!, x.numero!]));
      const resolvido = autores.find(a => mapa.has(a.trim()));
      if (resolvido) adicao = { dono: autorEhODono(resolvido, cfg.numeroDono, mapa), prova: "evento_add" };
    }
    // sem autor provado: entrarNoGrupo confere pelos dados do grupo (participante + criador/admin)
    const r = await entrarNoGrupo({ ...base, grupoJid: jid, adicao, metadado: meta });
    return `grupo-evento-${r.resultado}`;
  }
  // criação: só serve de prova POSITIVA (criador = dono); sem isso, fica para o aviso de participantes ou a primeira mensagem
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
    if (!meta.criador.some(c => autorEhODono(c, cfg.numeroDono, mapa))) { ultimo = "grupo-evento-sem-prova"; continue; }
    const r = await entrarNoGrupo({ ...base, grupoJid: jid, nomeNoWhatsapp: meta.nome, adicao: { dono: true, prova: "criador" }, metadado: meta });
    ultimo = `grupo-evento-${r.resultado}`;
  }
  return ultimo;
}
