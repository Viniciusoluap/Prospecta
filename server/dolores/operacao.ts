// EPIC-025 (Dolores, etapa 6) — configuração da operação contínua, a porta da PAUSA GERAL e o registro de EVENTOS.
// Regras fixas deste arquivo:
// - Pausa geral = dolores_config.pausada (etapa 1). `bloqueioDaOperacao` é a porta comum: pausa ligada, configuração que não
//   se lê ou migração ausente → BLOQUEIA (falha fechada). Rondas, relatórios, eventos e a resposta do empreiteiro passam por
//   ela; a IA (bloqueioAtual), a ponte e a aprovação da fila já conferiam a mesma pausa.
// - Evento é só um REGISTRO (dolores_eventos, só inserção, chave única): nunca dispara ação de escrita, mensagem ou IA. No
//   máximo entra na ronda e no relatório. Desligado por padrão.
// - `podeFalarNoGrupo` é a porta da resposta nos grupos (etapa 4b, server/dolores/marcacao.ts): chamada antes da vaga, da
//   chave, da IA e de qualquer envio, e de novo no envio (pausa geral ou conta desativada → silêncio, só registrada).
import { eq } from "drizzle-orm";
import { doloresEventos, doloresOperacaoConfig, type TipoEventoDolores } from "../../drizzle/schema-dolores-operacao.js";
import { users } from "../../drizzle/schema.js";
import { getDb } from "../db.js";
import { DOLORES_OPEN_ID } from "./perfil.js";
import { lerPausa } from "./consumo.js";
import { erroParaLog } from "./erro-seguro.js";

export type ConfigOperacao = {
  rondasLigadas: boolean; relatorioLigado: boolean; relatorioHora: number; eventosLigados: boolean;
  precoEntradaMilhao: number | null; precoSaidaMilhao: number | null; atualizadoEm: Date | null;
};
export const CONFIG_OPERACAO_PADRAO: ConfigOperacao = {
  rondasLigadas: false, relatorioLigado: false, relatorioHora: 7, eventosLigados: false, precoEntradaMilhao: null, precoSaidaMilhao: null, atualizadoEm: null,
};

const numero = (v: string | null) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Configuração da operação (linha única da 0131). Sem a migração ou sem a linha → null (quem chama trata como DESLIGADO). */
export async function lerConfigOperacao(): Promise<ConfigOperacao | null> {
  try {
    const [c] = await getDb().select().from(doloresOperacaoConfig).where(eq(doloresOperacaoConfig.id, 1)).limit(1);
    if (!c) return null;
    return {
      rondasLigadas: c.rondasLigadas, relatorioLigado: c.relatorioLigado, relatorioHora: c.relatorioHora, eventosLigados: c.eventosLigados,
      precoEntradaMilhao: numero(c.precoEntradaMilhao), precoSaidaMilhao: numero(c.precoSaidaMilhao), atualizadoEm: c.atualizadoEm,
    };
  } catch { return null; }
}

export type BloqueioOperacao = { motivo: "pausada"; detalhe: string | null } | { motivo: "indisponivel" } | { motivo: "usuaria_desativada" };

/** Porta comum da pausa geral. null = pode operar. Sem conseguir ler a pausa → bloqueia (falha fechada). */
export async function bloqueioDaOperacao(): Promise<BloqueioOperacao | null> {
  let pausa: Awaited<ReturnType<typeof lerPausa>>;
  try { pausa = await lerPausa(); } catch { return { motivo: "indisponivel" }; }
  if (!pausa) return { motivo: "indisponivel" };
  if (pausa.pausada) return { motivo: "pausada", detalhe: pausa.motivo };
  // desativar a conta da Dolores em "Usuários e acesso" também para a operação (o botão de parada do administrador)
  try {
    const [u] = await getDb().select({ ativo: users.active }).from(users).where(eq(users.openId, DOLORES_OPEN_ID)).limit(1);
    if (u && !u.ativo) return { motivo: "usuaria_desativada" };
  } catch { return { motivo: "indisponivel" }; }
  return null;
}

/** Porta da etapa 4b (resposta no grupo quando marcada, marcacao.ts): pausa geral ou conta desativada → a Dolores não fala no grupo. */
export async function podeFalarNoGrupo(): Promise<boolean> {
  return (await bloqueioDaOperacao()) === null;
}

/**
 * Registra um evento (só com os eventos ligados e sem pausa). Idempotente pela chave. Nunca lança; devolve se ENTROU agora
 * (false: desligado, pausado, já existia ou falhou). Não guarda texto de terceiro: só tabela, id e contagens.
 */
export async function registrarEvento(e: { tipo: TipoEventoDolores; chave: string; origemTabela?: string | null; origemId?: number | null; resumo?: Record<string, number | string | boolean | null> },
  o: { config?: ConfigOperacao | null; jaConferiuPausa?: boolean } = {}): Promise<boolean> {
  try {
    const config = o.config !== undefined ? o.config : await lerConfigOperacao();
    if (!config?.eventosLigados) return false;
    if (!o.jaConferiuPausa && (await bloqueioDaOperacao())) return false;
    const r = await getDb().insert(doloresEventos).values({
      tipo: e.tipo, chave: e.chave.slice(0, 160), origemTabela: e.origemTabela?.slice(0, 60) ?? null,
      origemId: e.origemId != null && Number.isInteger(e.origemId) && e.origemId <= 2_147_483_647 ? e.origemId : null, resumo: e.resumo ?? {},
    }).onConflictDoNothing().returning({ id: doloresEventos.id });
    return r.length > 0;
  } catch (err) {
    console.error("[dolores/operacao] falha ao registrar evento", e.tipo, erroParaLog(err));
    return false;
  }
}
