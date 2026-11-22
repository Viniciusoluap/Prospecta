// EPIC-029 (Módulo Fiscal), etapa 1 — cadastro automático por CNPJ e CEP: cache de 30 dias no Neon, limite de uso por
// usuário e os procedimentos tRPC usados pelas telas de cadastro que já existem.
// A consulta à rede fica em server/_core/brasilapi.ts; as regras comuns à tela, em shared/consulta-cadastral.ts.
// Story: docs/stories/epics/epic-029-modulo-fiscal/S-1-brasil-api.md.
//
// Quem pode consultar:
//   - CNPJ: administrador e colaborador ATIVO com um dos módulos das telas que têm CNPJ (BPO e Contabilidade, Obras) —
//     o mapa de módulos fica em server/_core/trpc.ts ("consultaCadastral"); corretor, cliente e empreiteiro, não;
//   - CEP: qualquer conta ativa logada, porque o CEP é usado também em "Meu perfil", que toda conta edita.
// Limite: 30 consultas por minuto por usuário (CNPJ e CEP somados), para o servidor não virar um repasse aberto.
// Nada de CNPJ/CPF em log: os erros devolvidos e registrados só dizem o tipo do problema.
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { consultasCadastraisCache } from "../drizzle/schema-consultas-cadastrais.js";
import {
  alertaDaSituacao, cepParaConsulta, cnpjParaConsulta, semCpf,
  type DadosCep, type DadosCnpj, type FonteConsulta, type RespostaConsulta, type TipoConsultaCadastral,
} from "../shared/consulta-cadastral.js";
import { buscarCep, buscarCnpjNaBrasilApi, FalhaConsultaCadastral, type Buscar, type MotivoFalha } from "./_core/brasilapi.js";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc.js";
import { getDb, type DrizzleDb } from "./db.js";

export const VALIDADE_DO_CACHE_MS = 30 * 24 * 60 * 60 * 1000;
export const LIMITE_POR_MINUTO = 30;
const JANELA_MS = 60_000;

export type CacheCadastral = {
  ler: (tipo: TipoConsultaCadastral, chave: string) => Promise<{ resposta: unknown; fonte: FonteConsulta; consultadoEm: Date } | null>;
  gravar: (tipo: TipoConsultaCadastral, chave: string, resposta: unknown, fonte: FonteConsulta, quando: Date) => Promise<void>;
};

/** Cache no banco (tabela consultas_cadastrais_cache). Falha do banco nunca impede a consulta: só fica sem cache. */
export function cacheNoBanco(db: () => DrizzleDb = getDb): CacheCadastral {
  return {
    async ler(tipo, chave) {
      try {
        const [linha] = await db().select().from(consultasCadastraisCache)
          .where(and(eq(consultasCadastraisCache.tipo, tipo), eq(consultasCadastraisCache.chave, chave))).limit(1);
        return linha ? { resposta: linha.resposta, fonte: linha.fonte, consultadoEm: new Date(linha.consultadoEm) } : null;
      } catch {
        console.warn("[consulta-cadastral] cache indisponível na leitura");
        return null;
      }
    },
    async gravar(tipo, chave, resposta, fonte, quando) {
      try {
        await db().insert(consultasCadastraisCache).values({ tipo, chave, resposta, fonte, consultadoEm: quando })
          .onConflictDoUpdate({ target: [consultasCadastraisCache.tipo, consultasCadastraisCache.chave], set: { resposta, fonte, consultadoEm: quando } });
      } catch {
        console.warn("[consulta-cadastral] cache indisponível na gravação");
      }
    },
  };
}

/** Limite por usuário em memória (janela deslizante de 1 minuto). Vale por instância da função da Vercel. */
export function criarLimitador(limite = LIMITE_POR_MINUTO, janelaMs = JANELA_MS) {
  const usos = new Map<number, number[]>();
  return {
    permitir(userId: number, agora = Date.now()): boolean {
      const recentes = (usos.get(userId) ?? []).filter(t => agora - t < janelaMs);
      if (recentes.length >= limite) {
        usos.set(userId, recentes);
        return false;
      }
      recentes.push(agora);
      usos.set(userId, recentes);
      if (usos.size > 5000) for (const [id, ts] of Array.from(usos)) if (!ts.some(t => agora - t < janelaMs)) usos.delete(id);
      return true;
    },
  };
}

export type DependenciasConsulta = {
  buscar?: Buscar;
  cache?: CacheCadastral;
  agora?: () => Date;
  tempoLimiteMs?: number;
};

const vigente = (consultadoEm: Date, agora: Date) => agora.getTime() - consultadoEm.getTime() < VALIDADE_DO_CACHE_MS && consultadoEm.getTime() <= agora.getTime() + 60_000;

const DadosCnpjNoCache = z.object({
  cnpj: z.string(), razaoSocial: z.string().min(1), nomeFantasia: z.string().nullable(), situacao: z.string().nullable(),
  cnaePrincipal: z.object({ codigo: z.string(), descricao: z.string().nullable() }).nullable(),
  endereco: z.object({
    cep: z.string().nullable(), logradouro: z.string().nullable(), numero: z.string().nullable(), complemento: z.string().nullable(),
    bairro: z.string().nullable(), cidade: z.string().nullable(), uf: z.string().nullable(), codigoIbge: z.string().nullable(),
  }),
});
const DadosCepNoCache = z.object({
  cep: z.string(), logradouro: z.string().nullable(), bairro: z.string().nullable(), cidade: z.string().min(1), uf: z.string().length(2),
  codigoIbge: z.string().nullable(),
});

/** CNPJ: cache de 30 dias; senão, Brasil API. CNPJ inválido não chega à rede nem ao cache. */
export async function consultarCnpj(valor: string, deps: DependenciasConsulta = {}): Promise<RespostaConsulta<DadosCnpj>> {
  const cnpj = cnpjParaConsulta(valor);
  if (!cnpj) throw new FalhaConsultaCadastral("invalido", "CNPJ inválido: confira os números.");
  const cache = deps.cache ?? cacheNoBanco();
  const agora = (deps.agora ?? (() => new Date()))();
  const guardado = await cache.ler("cnpj", cnpj);
  if (guardado && vigente(guardado.consultadoEm, agora)) {
    const lido = DadosCnpjNoCache.safeParse(guardado.resposta);
    // O alerta é recalculado (a regra pode mudar; a situação gravada é a da Receita).
    // semCpf também na leitura: linha gravada antes da correção do QA nunca devolve CPF de MEI.
    const razaoSocial = lido.success ? semCpf(lido.data.razaoSocial) : null;
    if (lido.success && razaoSocial) return { dados: { ...lido.data, razaoSocial, nomeFantasia: semCpf(lido.data.nomeFantasia), cnpj, alerta: alertaDaSituacao(lido.data.situacao) }, fonte: guardado.fonte, doCache: true, consultadoEm: guardado.consultadoEm.toISOString() };
  }
  const dados = await buscarCnpjNaBrasilApi(cnpj, deps.buscar, deps.tempoLimiteMs);
  const { alerta: _alerta, ...semAlerta } = dados;
  await cache.gravar("cnpj", cnpj, semAlerta, "brasilapi", agora);
  return { dados, fonte: "brasilapi", doCache: false, consultadoEm: agora.toISOString() };
}

/** CEP: cache de 30 dias; senão, Brasil API e, se ela falhar, ViaCEP. */
export async function consultarCep(valor: string, deps: DependenciasConsulta = {}): Promise<RespostaConsulta<DadosCep>> {
  const cep = cepParaConsulta(valor);
  if (!cep) throw new FalhaConsultaCadastral("invalido", "CEP inválido: são 8 números.");
  const cache = deps.cache ?? cacheNoBanco();
  const agora = (deps.agora ?? (() => new Date()))();
  const guardado = await cache.ler("cep", cep);
  if (guardado && vigente(guardado.consultadoEm, agora)) {
    const lido = DadosCepNoCache.safeParse(guardado.resposta);
    if (lido.success) return { dados: { ...lido.data, cep }, fonte: guardado.fonte, doCache: true, consultadoEm: guardado.consultadoEm.toISOString() };
  }
  const { dados, fonte } = await buscarCep(cep, deps.buscar, deps.tempoLimiteMs);
  await cache.gravar("cep", cep, dados, fonte, agora);
  return { dados, fonte, doCache: false, consultadoEm: agora.toISOString() };
}

export type ResultadoParaTela<T> = ({ ok: true } & RespostaConsulta<T>) | { ok: false; motivo: MotivoFalha; mensagem: string };

const MENSAGENS: Record<MotivoFalha, string> = {
  invalido: "Documento inválido: confira os números.",
  nao_encontrado: "Não encontrado na consulta pública. Preencha os campos à mão.",
  indisponivel: "A consulta pública não respondeu agora. Preencha os campos à mão ou tente de novo em instantes.",
  resposta_invalida: "A consulta pública respondeu fora do formato esperado. Preencha os campos à mão.",
};

async function paraTela<T>(consulta: () => Promise<RespostaConsulta<T>>): Promise<ResultadoParaTela<T>> {
  try {
    return { ok: true, ...(await consulta()) };
  } catch (e) {
    if (e instanceof FalhaConsultaCadastral) {
      return { ok: false, motivo: e.motivo, mensagem: e.motivo === "invalido" ? e.message : MENSAGENS[e.motivo] };
    }
    console.error("[consulta-cadastral] falha inesperada", e instanceof Error ? e.name : "erro");
    return { ok: false, motivo: "indisponivel", mensagem: MENSAGENS.indisponivel };
  }
}

let limitadorAtual = criarLimitador();
let depsDoRouter: DependenciasConsulta = {};
/** Só para os testes do router (fetch e cache simulados, limite novo). */
export function definirDependenciasDoRouterParaTeste(deps: DependenciasConsulta, novoLimitador?: ReturnType<typeof criarLimitador>) {
  depsDoRouter = deps;
  if (novoLimitador) limitadorAtual = novoLimitador;
}

function exigirLimite(user: { id: number; active?: boolean | null }) {
  if (user.active === false) throw new TRPCError({ code: "FORBIDDEN", message: "Conta inativa." });
  if (!limitadorAtual.permitir(user.id)) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `Muitas consultas seguidas (limite de ${LIMITE_POR_MINUTO} por minuto). Aguarde um instante.` });
  }
}

// Entrada: só caracteres de documento; o tamanho máximo corta texto longo antes de qualquer regra.
const entradaCnpj = z.object({ cnpj: z.string().trim().max(20).regex(/^[0-9A-Za-z./\-\s]*$/, "CNPJ com caracteres inválidos.") });
const entradaCep = z.object({ cep: z.string().trim().max(10).regex(/^[0-9.\-\s]*$/, "CEP com caracteres inválidos.") });

export const consultaCadastralRouter = router({
  /** Admin e colaborador com o módulo de uma tela que tem CNPJ (mapa em server/_core/trpc.ts). */
  cnpj: adminProcedure.input(entradaCnpj).mutation(({ ctx, input }) => {
    if (ctx.user.role !== "admin" && ctx.user.role !== "colaborador") throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para consultar CNPJ." });
    exigirLimite(ctx.user);
    return paraTela(() => consultarCnpj(input.cnpj, depsDoRouter));
  }),
  /** Qualquer conta ativa (o CEP também está em "Meu perfil"). */
  cep: protectedProcedure.input(entradaCep).mutation(({ ctx, input }) => {
    exigirLimite(ctx.user);
    return paraTela(() => consultarCep(input.cep, depsDoRouter));
  }),
});
