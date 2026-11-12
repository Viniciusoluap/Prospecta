// Central de Vendas (12/11/2026) — rotina: SLA, lembretes, sequências e fila. Roda no cron diário existente
// (/api/cron/lead-card-due, sem cron novo na Vercel) e, para o SLA de minutos, a cada aviso do WhatsApp e ao
// abrir o painel — no máximo uma vez por minuto (reivindicação em central_vendas_limites).
import { sql } from "drizzle-orm";
import { agora, carregarConfig, erroSeguro, linhas, registrarEvento } from "./base.js";
import { verificarSla } from "./distribuicao.js";
import { agendarLembretes } from "./documentos.js";
import { marcarIncertos, processarFila } from "./envio.js";
import { agendarSequencias } from "./sequencias.js";

export async function executarRotinaCentralVendas(opcoes: { limiteMs?: number } = {}) {
  const config = await carregarConfig();
  if (!config.ativo) return { ativo: false };
  const etapa = async <T>(nome: string, f: () => Promise<T>) => {
    try { return await f(); }
    catch (e) { await registrarEvento({ tipo: `erro_rotina_${nome}`, resultado: "erro", erro: erroSeguro(e) }).catch(() => undefined); return null; }
  };
  const sla = await etapa("sla", verificarSla);
  const lembretes = await etapa("lembretes", agendarLembretes);
  const sequencias = await etapa("sequencias", agendarSequencias);
  const incertos = await etapa("incertos", marcarIncertos);
  const fila = await etapa("fila", () => processarFila({ limiteMs: opcoes.limiteMs ?? 30_000 }));
  // Janelas de limitação de taxa com mais de 1 dia não servem mais.
  await etapa("limpeza", () => linhas(sql`DELETE FROM central_vendas_limites WHERE janela < ${new Date(agora().getTime() - 86_400_000).toISOString()} RETURNING chave`));
  return { ativo: true, sla, lembretes, sequencias, incertos, fila };
}

/** Rodada curta (SLA + fila), no máximo uma por minuto entre todas as instâncias. */
export async function rotinaSeNecessario() {
  if (!(await carregarConfig()).ativo) return null;
  const janela = new Date(Math.floor(agora().getTime() / 60_000) * 60_000);
  const r = await linhas<{ total: number }>(sql`INSERT INTO central_vendas_limites (chave, janela, total) VALUES ('rotina', ${janela.toISOString()}, 1)
    ON CONFLICT (chave, janela) DO UPDATE SET total = central_vendas_limites.total + 1 RETURNING total`);
  if (Number(r[0]?.total) !== 1) return null;
  await verificarSla().catch(() => null);
  return processarFila({ limiteMs: 8_000 });
}

/** Limitação de taxa dos endpoints de entrada: `limite` chamadas por minuto por chave. */
export async function dentroDoLimite(chave: string, limite = 30): Promise<boolean> {
  const janela = new Date(Math.floor(agora().getTime() / 60_000) * 60_000);
  const r = await linhas<{ total: number }>(sql`INSERT INTO central_vendas_limites (chave, janela, total) VALUES (${chave.slice(0, 120)}, ${janela.toISOString()}, 1)
    ON CONFLICT (chave, janela) DO UPDATE SET total = central_vendas_limites.total + 1 RETURNING total`);
  return Number(r[0]?.total ?? 0) <= limite;
}
