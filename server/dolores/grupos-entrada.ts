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
import { randomInt } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { leads } from "../../drizzle/schema.js";
import { doloresGrupos, type DoloresGrupo } from "../../drizzle/schema-dolores-grupos.js";
import { doloresMarcacoesContagem, doloresMarcacoesGrupo } from "../../drizzle/schema-dolores-marcacoes.js";
import { diaDeImperatriz, jidDeGrupoValido } from "../../shared/dolores/grupos.js";
import {
  avisoDoTetoDeEntrada, descobrirTipoDoGrupo, gerarCodigoDeGrupo, textoDoAvisoDeEntrada, type ClienteParaTipo, type TipoGrupo,
} from "../../shared/dolores/grupos-tipo.js";
import { textoDeDado, umaLinha } from "../../shared/dolores/fila.js";
import { sanitizarTexto } from "../../shared/dolores/sanitizar.js";
import { nomeDoGrupoEvolution } from "../_core/evolution.js";
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
  /** Nome do grupo pela Evolution (só leitura). null = não soube. */
  nomeDoGrupo: (instancia: string, jid: string, prazoMs: number) => Promise<string | null>;
  ms: () => number;
};
const padrao: Dependencias = {
  nomeDoGrupo: async (instancia, jid, prazoMs) => {
    const { configEvolution } = await import("../whatsapp-router.js");
    const c = await configEvolution();
    if (!c) return null;
    // a chave da Evolution nunca segue redirecionamento para outro host (QA E4 r2 N4)
    return nomeDoGrupoEvolution({ ...c, semRedirecionamento: true }, instancia, jid, fetch, prazoMs);
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
}): Promise<ResultadoEntrada> {
  if (!p.instancia || !jidDeGrupoValido(p.grupoJid)) return { resultado: "entrada-invalida", grupo: null };
  const db = getDb();
  try {
    const [ja] = await db.select().from(doloresGrupos).where(and(eq(doloresGrupos.instancia, p.instancia), eq(doloresGrupos.grupoJid, p.grupoJid))).limit(1);
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
    // o nome: da lista da Evolution (tela) ou perguntado agora (webhook, só com tempo de sobra). Nunca do texto de mensagem.
    let bruto = p.nomeNoWhatsapp ?? null;
    if (bruto === null && p.prazoFinal - deps.ms() >= MINIMO_PARA_PERGUNTAR_NOME_MS) {
      bruto = await deps.nomeDoGrupo(p.instancia, p.grupoJid, Math.min(5_000, p.prazoFinal - deps.ms() - 3_000))
        .catch(e => { console.error("[dolores/grupos-entrada] a Evolution não informou o nome do grupo", erroParaLog(e)); return null; });
    }
    const descoberto = bruto ? descobrirTipoDoGrupo(bruto, await clientesDoCrm()) : { tipo: "indefinido" as TipoGrupo, leadId: null, motivo: "a Evolution não informou o nome do grupo" };
    const nomeWhatsapp = nomeDoWhatsappParaGravar(bruto);
    const rotulo = nomeWhatsapp ?? `Grupo sem nome (final ${p.grupoJid.replace(/@g\.us$/, "").slice(-4)})`;
    const situacao = descoberto.tipo === "indefinido" ? "aguardando_dono" as const : "avisado" as const;
    let grupo: DoloresGrupo | undefined;
    // o código é sorteado aqui; colisão (índice único) → sorteia de novo
    for (let tentativa = 0; tentativa < 6 && !grupo; tentativa++) {
      const codigo = gerarCodigoDeGrupo(() => randomInt(0, 1_000_000) / 1_000_000);
      const [linha] = await db.insert(doloresGrupos).values({
        instancia: p.instancia, grupoJid: p.grupoJid, nome: rotulo, nomeWhatsapp, tipo: descoberto.tipo, leadId: descoberto.leadId, obraId: null,
        origem: "automatico", situacaoConfirmacao: situacao, codigo, ativo: true, criadoPorUserId: null, atualizadoPorUserId: null,
      }).onConflictDoNothing().returning();
      if (linha) { grupo = linha; break; }
      // outro aviso paralelo criou o mesmo grupo: usa o dele
      const [outro] = await db.select().from(doloresGrupos).where(and(eq(doloresGrupos.instancia, p.instancia), eq(doloresGrupos.grupoJid, p.grupoJid))).limit(1);
      if (outro) return { resultado: "existente", grupo: outro };
    }
    if (!grupo) return { resultado: "entrada-erro", grupo: null };
    // o interruptor do grupo nasce LIGADO para grupo de tipo conhecido; nada fala enquanto o interruptor GERAL estiver desligado
    if (descoberto.tipo !== "indefinido") {
      await db.insert(doloresMarcacoesGrupo).values({ grupoId: grupo.id, responderLigado: true, atualizadoPor: null }).onConflictDoNothing()
        .catch(e => console.error("[dolores/grupos-entrada] não liguei o interruptor do grupo", erroParaLog(e)));
    }
    await registrarAcao({ funcao: "grupo_entrada", resultado: "ok", autorUserId: p.autor, canal: p.canal, pedidoId: `grupo:${grupo.id}:entrada`,
      motivo: `grupo entrou sozinho: ${descoberto.motivo}`, resumo: { grupoId: grupo.id, tipo: descoberto.tipo, leadId: descoberto.leadId, situacao, comNome: !!bruto } });
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
  const texto = textoDoAvisoDeEntrada({ nomeDoGrupo: grupo.nomeWhatsapp, codigo: grupo.codigo, tipo: grupo.tipo ?? "indefinido", cliente: p.cliente });
  const r = await p.avisar(texto, { funcao: "grupo_entrada_aviso", pedidoId: `grupo:${grupo.id}:aviso`, autor: p.autor, prazoFinal: p.prazoFinal, canal: p.canal,
    resumo: { grupoId: grupo.id, tipo: grupo.tipo } }).catch(() => ({ ok: false, motivo: "falha" }));
  return r.ok;
}
