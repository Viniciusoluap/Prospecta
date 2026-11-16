// EPIC-025 (Dolores, etapa 1) — a ponte: única porta do agente (Claude Console) para o sistema.
//   POST /api/dolores/ponte        { funcao, argumentos?, pedidoId? } → executa UMA função autorizada e devolve JSON
//   GET  /api/dolores/ferramentas  → definições das funções liberadas (nome, descrição, JSON Schema da entrada)
// Autenticação: "Authorization: Bearer <DOLORES_PONTE_TOKEN>" (variável de ambiente, comparação em tempo constante;
// sem a variável, a ponte recusa tudo; o token nunca vai para log). Depois: pausa (dolores_config), limite por minuto,
// lista de funções liberadas (permissoes.ts), validação da entrada (zod), execução com prazo e resposta limitada.
// Toda chamada autenticada vira uma linha em dolores_acoes, no nome da usuária Dolores. Chamadas sem token válido NÃO são
// gravadas (um estranho não pode encher a auditoria nem gastar o limite dela): vão só para o log, sem o token.
import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { and, count, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { doloresAcoes, doloresConfig } from "../../drizzle/schema-dolores.js";
import { DESLOCAMENTO_FUSO, FUSO, MOEDA, isoFortaleza, limitarResposta } from "../../shared/dolores/formato.js";
import { getDb } from "../db.js";
import { registrarAcao } from "./auditoria.js";
import { FUNCOES, definicaoDaFerramenta, funcaoPorNome } from "./funcoes.js";
import { ETAPA_ATUAL, funcaoLiberada, motivoDaRecusa } from "./permissoes.js";
import { usuarioDolores } from "./perfil.js";

export const VARIAVEL_TOKEN = "DOLORES_PONTE_TOKEN";
/** Prazo de uma função (a função da Vercel tem 60 s no total). */
const PRAZO_MS = 25_000;
/** Tentativas sem token válido por IP e minuto, antes de 429 (memória da instância). */
const MAX_FALHAS_AUTH = 20;

type Dependencias = { agora: () => Date; prazoMs: number };
const padrao: Dependencias = { agora: () => new Date(), prazoMs: PRAZO_MS };
let deps: Dependencias = { ...padrao };
/** Só para testes: relógio e prazo. Sem argumento, volta ao padrão. */
export function definirDependenciasPonte(d?: Partial<Dependencias>) { deps = d ? { ...deps, ...d } : { ...padrao }; }

const resumoSha = (s: string) => createHash("sha256").update(s).digest();
/** Bearer confere com o token da variável? Hash dos dois lados: tempo constante e sem vazar o tamanho. */
export function tokenConfere(cabecalho: string | undefined, esperado: string | undefined): boolean {
  const recebido = /^Bearer\s+(.+)$/i.exec(String(cabecalho ?? ""))?.[1]?.trim();
  if (!recebido || !esperado) return false;
  return timingSafeEqual(resumoSha(recebido), resumoSha(esperado));
}

const falhas = new Map<string, { janela: number; total: number }>();
function contarFalha(ip: string, agora: Date): boolean {
  const janela = Math.floor(agora.getTime() / 60_000);
  const f = falhas.get(ip);
  const total = f && f.janela === janela ? f.total + 1 : 1;
  falhas.set(ip, { janela, total });
  if (falhas.size > 5000) falhas.clear();
  return total > MAX_FALHAS_AUTH;
}
const usoLocal = new Map<number, number>();

export type RespostaPonte = { status: number; body: Record<string, unknown> };
type Pedido = Pick<Request, "headers" | "body" | "ip">;

const envelope = z.object({
  funcao: z.string().trim().min(1).max(80),
  argumentos: z.record(z.string(), z.unknown()).optional(),
  pedidoId: z.string().trim().min(1).max(120).optional(),
}).strict();

function base(agora: Date) {
  return { etapa: ETAPA_ATUAL, geradoEm: isoFortaleza(agora), fuso: `${FUSO} (UTC${DESLOCAMENTO_FUSO})`, moeda: MOEDA };
}
const erroSeguro = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/Bearer\s+\S+/gi, "Bearer [omitido]").slice(0, 300);

/** Autenticação comum aos dois endereços. null = passou. */
function autenticar(req: Pedido, agora: Date): RespostaPonte | null {
  const esperado = process.env[VARIAVEL_TOKEN]?.trim();
  if (!esperado) {
    console.warn(`[dolores/ponte] chamada recusada: ${VARIAVEL_TOKEN} não configurado`);
    return { status: 503, body: { ok: false, erro: "Ponte da Dolores desativada: token não configurado no servidor." } };
  }
  if (!tokenConfere(req.headers.authorization as string | undefined, esperado)) {
    const ip = String(req.ip ?? "?");
    console.warn("[dolores/ponte] chamada sem token válido", ip);
    if (contarFalha(ip, agora)) return { status: 429, body: { ok: false, erro: "Muitas tentativas." } };
    return { status: 401, body: { ok: false, erro: "Não autorizado." } };
  }
  return null;
}

/** Pausa e limite. null = pode seguir. Lança se não conseguir ler a configuração (a ponte não roda às cegas). */
async function verificarOperacao(autor: number, agora: Date): Promise<{ status: number; motivo: string } | null> {
  const [cfg] = await getDb().select().from(doloresConfig).where(eq(doloresConfig.id, 1)).limit(1);
  if (!cfg) return { status: 503, motivo: "Configuração da Dolores ausente (migração 0123 não aplicada)." };
  if (cfg.pausada) return { status: 423, motivo: `Dolores pausada${cfg.motivoPausa ? `: ${cfg.motivoPausa.slice(0, 200)}` : "."}` };
  let usadas: number;
  try {
    const [r] = await getDb().select({ n: count() }).from(doloresAcoes)
      .where(and(eq(doloresAcoes.autorUserId, autor), gt(doloresAcoes.criadoEm, new Date(agora.getTime() - 60_000))));
    usadas = Number(r?.n ?? 0);
  } catch (e) {
    // sem a contagem do banco, conta na memória desta instância (nunca fica sem limite)
    console.error("[dolores/ponte] contagem do limite indisponível", erroSeguro(e));
    const minuto = Math.floor(agora.getTime() / 60_000);
    usadas = usoLocal.get(minuto) ?? 0;
    usoLocal.clear(); usoLocal.set(minuto, usadas + 1);
  }
  if (usadas >= cfg.limitePorMinuto) return { status: 429, motivo: `Limite de ${cfg.limitePorMinuto} chamadas por minuto atingido.` };
  return null;
}

function comPrazo<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error(`Consulta passou de ${Math.round(ms / 1000)} s.`)), ms); })])
    .finally(() => clearTimeout(t));
}

export async function tratarChamada(req: Pedido): Promise<RespostaPonte> {
  const agora = deps.agora();
  const inicio = Date.now();
  const negado = autenticar(req, agora);
  if (negado) return negado;

  const bruto = (req.body ?? {}) as Record<string, unknown>;
  const nomeBruto = typeof bruto.funcao === "string" ? bruto.funcao.slice(0, 80) : "(sem função)";
  const pedidoBruto = typeof bruto.pedidoId === "string" ? bruto.pedidoId.slice(0, 120) : null;
  let autor: number | null = null;
  const registrar = (resultado: "ok" | "recusada" | "erro", extra: { funcao?: string; argumentos?: unknown; motivo?: string; resumo?: Record<string, unknown>; pedidoId?: string | null }) =>
    registrarAcao({ funcao: extra.funcao ?? nomeBruto, argumentos: extra.argumentos ?? bruto.argumentos ?? null, resultado, motivo: extra.motivo ?? null,
      resumo: extra.resumo ?? null, duracaoMs: Date.now() - inicio, pedidoId: extra.pedidoId ?? pedidoBruto, autorUserId: autor });
  const responder = (status: number, corpo: Record<string, unknown>): RespostaPonte => ({ status, body: { ...base(agora), funcao: nomeBruto, pedidoId: pedidoBruto, ...corpo } });

  try {
    autor = await usuarioDolores();
  } catch (e) {
    await registrar("erro", { motivo: `usuária Dolores: ${erroSeguro(e)}` });
    return responder(503, { ok: false, erro: "Usuária Dolores indisponível ou alterada; ponte parada." });
  }
  let bloqueio: { status: number; motivo: string } | null;
  try {
    bloqueio = await verificarOperacao(autor, agora);
  } catch (e) {
    await registrar("erro", { motivo: `configuração: ${erroSeguro(e)}` });
    return responder(503, { ok: false, erro: "Não foi possível ler a configuração da Dolores; nada foi executado." });
  }
  if (bloqueio) {
    await registrar("recusada", { motivo: bloqueio.motivo });
    return responder(bloqueio.status, { ok: false, erro: bloqueio.motivo });
  }

  const env = envelope.safeParse(bruto);
  if (!env.success) {
    const campos = env.error.issues.map(i => i.path.join(".") || "(corpo)").slice(0, 10);
    await registrar("recusada", { motivo: `pedido inválido: ${campos.join(", ")}` });
    return responder(400, { ok: false, erro: "Pedido inválido: envie { funcao, argumentos?, pedidoId? }.", campos });
  }
  const { funcao, argumentos = {}, pedidoId = null } = env.data;
  const fn = funcaoPorNome(funcao);
  if (!fn || !funcaoLiberada(funcao)) {
    const motivo = motivoDaRecusa(funcao);
    await registrar("recusada", { funcao, argumentos, motivo, pedidoId });
    return responder(403, { ok: false, erro: motivo });
  }
  const args = fn.entrada.safeParse(argumentos);
  if (!args.success) {
    const problemas = args.error.issues.slice(0, 10).map(i => ({ campo: i.path.join(".") || "(argumentos)", problema: i.message }));
    await registrar("recusada", { funcao, argumentos, motivo: `argumentos inválidos: ${problemas.map(p => p.campo).join(", ")}`, pedidoId });
    return responder(400, { ok: false, erro: "Argumentos inválidos para a função.", problemas });
  }
  try {
    const r = await comPrazo(fn.executar(args.data as never, { agora }), deps.prazoMs);
    const { valor, truncado } = limitarResposta(r.dados);
    await registrar("ok", { funcao, argumentos: args.data, resumo: { ...r.resumo, truncado }, pedidoId });
    return responder(200, { ok: true, truncado, ...(truncado ? { aviso: "Resposta cortada para caber no contexto: filtre ou peça a próxima página." } : {}), dados: valor });
  } catch (e) {
    const motivo = erroSeguro(e);
    console.error("[dolores/ponte] falha na função", funcao, motivo);
    await registrar("erro", { funcao, argumentos: args.data, motivo, pedidoId });
    return responder(500, { ok: false, erro: "Falha ao consultar o sistema; nada foi alterado. Tente de novo ou informe o responsável." });
  }
}

export async function tratarFerramentas(req: Pedido): Promise<RespostaPonte> {
  const agora = deps.agora();
  const inicio = Date.now();
  const negado = autenticar(req, agora);
  if (negado) return negado;
  let autor: number | null = null;
  const registrar = (resultado: "ok" | "recusada" | "erro", motivo: string | null, resumo: Record<string, unknown> | null = null) =>
    registrarAcao({ funcao: "listar_ferramentas", resultado, motivo, resumo, duracaoMs: Date.now() - inicio, autorUserId: autor });
  try {
    autor = await usuarioDolores();
    const bloqueio = await verificarOperacao(autor, agora);
    if (bloqueio) { await registrar("recusada", bloqueio.motivo); return { status: bloqueio.status, body: { ...base(agora), ok: false, erro: bloqueio.motivo } }; }
  } catch (e) {
    await registrar("erro", erroSeguro(e));
    return { status: 503, body: { ...base(agora), ok: false, erro: "Ponte indisponível; nada foi executado." } };
  }
  const ferramentas = ferramentasLiberadas();
  await registrar("ok", null, { ferramentas: ferramentas.length });
  return { status: 200, body: { ...base(agora), ok: true, ferramentas } };
}

/** Definições das funções liberadas na etapa atual (também gravadas em docs/dolores/ferramentas-etapa1.json). */
export const ferramentasLiberadas = () => FUNCOES.filter(f => funcaoLiberada(f.nome)).map(definicaoDaFerramenta);

const router = Router();
const via = (fn: (req: Pedido) => Promise<RespostaPonte>) => async (req: Request, res: Response) => {
  const r = await fn(req);
  res.setHeader("Cache-Control", "no-store");
  res.status(r.status).json(r.body);
};
router.post("/dolores/ponte", via(tratarChamada));
router.get("/dolores/ferramentas", via(tratarFerramentas));
export default router;
