// EPIC-024 S-12 (17/11/2026) — termo de consentimento: regra do primeiro acesso, gravação do aceite junto com a senha,
// a opção (DESLIGADA) de pedir o aceite no próximo login e a consulta do administrador.
//
// Regra do primeiro acesso (mesmo link `/definir-senha/:token` serve para primeiro acesso e para redefinição):
//   - já há aceite da versão vigente → "aceito": a caixa não aparece e nada é exigido;
//   - conta criada a partir de INICIO_DO_TERMO, ou link que é o convite da criação da conta → "obrigatorio";
//   - senão (conta antiga redefinindo a senha) → "opcional": a caixa aparece, mas não bloqueia (decisão do dono pendente).
//
// Conta criada já com senha pelo admin (portal.admin.provisionAccess, /api/auth/setup-admin) a partir de INICIO_DO_TERMO:
// aceita o termo no PRIMEIRO LOGIN (modal ConsentimentoNoLogin), com a opção abaixo desligada (QA S-12, achado 1).
//
// Opção "pedir o aceite uma vez no próximo login" (para TODOS): DESLIGADA por padrão. Para ligar, defina na Vercel a variável
// CONSENTIMENTO_PEDIR_NO_LOGIN=1 e publique de novo. Ligada, quem entrar sem aceite da versão vigente vê o termo uma vez
// (componente client/src/components/consentimento/ConsentimentoNoLogin.tsx) e o aceite fica com canal "login".
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { consentimentos, type AparelhoDoConsentimento } from "../drizzle/schema-consentimentos.js";
import { users } from "../drizzle/schema.js";
import { AVISO_TEXTO_PROVISORIO, PENDENCIAS_DO_JURIDICO, VERSAO_DO_TERMO, type CanalDoConsentimento } from "../shared/termo-consentimento.js";
import { hashPassword } from "./_core/auth-utils.js";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc.js";
import { getDb, type DrizzleDb } from "./db.js";

/** A partir desta data (17/11/2026, 00:00 UTC — 16/11 21:00 em Brasília; a folga só deixa a regra mais rigorosa) toda conta nova passa pelo termo ao criar a senha. */
export const INICIO_DO_TERMO = new Date("2026-11-17T00:00:00Z");
/** Validade do link de primeiro acesso/redefinição (a mesma de configuracoes-router.ts). */
export const VALIDADE_DO_LINK_MS = 7 * 24 * 60 * 60 * 1000;
/** Folga para reconhecer o convite da criação da conta (link gerado logo depois do cadastro). */
const FOLGA_DO_CONVITE_MS = 10 * 60 * 1000;

export type SituacaoDoTermo = "aceito" | "obrigatorio" | "opcional";

export const MENSAGEM_SEM_ACEITE = "Para criar a senha, é preciso marcar que você leu e concorda com o termo de consentimento.";
export const MENSAGEM_VERSAO_ERRADA = "O termo de consentimento foi atualizado. Recarregue a página, leia a versão atual e marque de novo.";

/** Opção do item 4 (pedir o aceite no próximo login). Desligada, salvo CONSENTIMENTO_PEDIR_NO_LOGIN=1. */
export function pedirAceiteNoLogin(env: Record<string, string | undefined> = process.env): boolean {
  return env.CONSENTIMENTO_PEDIR_NO_LOGIN === "1";
}

/** Resumo técnico mínimo: só a categoria do aparelho; o user-agent em si não é guardado. */
export function aparelhoDoUserAgent(ua: string | undefined | null): AparelhoDoConsentimento {
  if (!ua) return "desconhecido";
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) return "tablet";
  if (/Mobi|iPhone|Android/i.test(ua)) return "celular";
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return "computador";
  return "desconhecido";
}

/** Primeiro acesso = conta nova (depois do início do termo) ou link que é o convite enviado no cadastro. */
export function ehPrimeiroAcesso(conta: { createdAt: Date | null; tokenExpiraEm: Date | null }, inicio = INICIO_DO_TERMO): boolean {
  if (!conta.createdAt) return true;
  if (conta.createdAt.getTime() >= inicio.getTime()) return true;
  if (!conta.tokenExpiraEm) return false;
  const emitidoEm = conta.tokenExpiraEm.getTime() - VALIDADE_DO_LINK_MS;
  return Math.abs(emitidoEm - conta.createdAt.getTime()) <= FOLGA_DO_CONVITE_MS;
}

/**
 * Quem já aceitou uma versão anterior já criou a senha antes: não é primeiro acesso. Mudar a versão não bloqueia
 * ninguém (o novo aceite, se marcado, é gravado; pedir de novo a todos é a opção desligada do item 4).
 */
export function situacaoDoTermo(aceites: { atual: boolean; algum: boolean }, primeiroAcesso: boolean): SituacaoDoTermo {
  if (aceites.atual) return "aceito";
  if (aceites.algum) return "opcional";
  return primeiroAcesso ? "obrigatorio" : "opcional";
}

/** Conta criada a partir de INICIO_DO_TERMO (comparação em memória, com o `createdAt` da sessão). */
export function contaCriadaNoTermo(createdAt: Date | string | null | undefined, inicio = INICIO_DO_TERMO): boolean {
  if (!createdAt) return false;
  return new Date(createdAt).getTime() >= inicio.getTime();
}

/**
 * Pedir o aceite no login? Com a opção do item 4 ligada: falta a versão vigente. Desligada (só conta nova): falta
 * qualquer aceite — trocar a versão do termo não volta a perguntar a quem já aceitou uma versão anterior.
 */
export function precisaAceitarNoLogin(aceites: { atual: boolean; algum: boolean }, pedirATodos: boolean): boolean {
  return pedirATodos ? !aceites.atual : !aceites.algum;
}

/** Se a conta aceitou a versão vigente e se aceitou alguma versão. */
export async function aceitesDoUsuario(db: DrizzleDb, userId: number): Promise<{ atual: boolean; algum: boolean }> {
  const linhas = await db.selectDistinct({ versao: consentimentos.versaoTermo }).from(consentimentos).where(eq(consentimentos.userId, userId));
  return { atual: linhas.some(l => l.versao === VERSAO_DO_TERMO), algum: linhas.length > 0 };
}

/**
 * Confere o aceite enviado pela tela. Devolve se o aceite deve ser gravado. Lança quando é obrigatório e não veio,
 * ou quando veio com versão diferente da vigente (a pessoa leu um texto que não é o atual).
 */
export function conferirAceite(situacao: SituacaoDoTermo, aceitouTermo: boolean | undefined, versaoDoTermo: string | undefined): boolean {
  const marcou = aceitouTermo === true;
  if (marcou && versaoDoTermo !== VERSAO_DO_TERMO) throw new TRPCError({ code: "BAD_REQUEST", message: MENSAGEM_VERSAO_ERRADA });
  if (situacao === "obrigatorio" && !marcou) throw new TRPCError({ code: "BAD_REQUEST", message: MENSAGEM_SEM_ACEITE });
  return marcou && situacao !== "aceito";
}

/**
 * Grava a senha do link e (quando for o caso) o aceite NA MESMA TRANSAÇÃO: se um falhar, o outro é desfeito.
 * A senha só é gravada se o token ainda bate e não venceu (guarda atômica contra reuso do link).
 */
export async function gravarSenhaComAceite(db: DrizzleDb, dados: {
  userId: number; token: string; novaSenha: string; gravarAceite: boolean; aparelho: AparelhoDoConsentimento; agora?: Date;
}): Promise<boolean> {
  const agora = dados.agora ?? new Date();
  return db.transaction(async tx => {
    const [claimed] = await tx.update(users).set({
      passwordHash: hashPassword(dados.novaSenha),
      tokenPrimeiroAcesso: null,
      tokenPrimeiroAcessoExpiraEm: null,
      sessionVersion: sql`${users.sessionVersion} + 1`,
      updatedAt: agora,
    }).where(and(eq(users.id, dados.userId), eq(users.tokenPrimeiroAcesso, dados.token), gt(users.tokenPrimeiroAcessoExpiraEm, agora)))
      .returning({ id: users.id });
    if (!claimed) return false;
    if (dados.gravarAceite) await registrarAceite(tx as unknown as DrizzleDb, dados.userId, "definir_senha", dados.aparelho, true);
    return true;
  });
}

async function registrarAceite(db: DrizzleDb, userId: number, canal: CanalDoConsentimento, aparelho: AparelhoDoConsentimento, comSenha: boolean) {
  await db.insert(consentimentos).values({ userId, versaoTermo: VERSAO_DO_TERMO, canal, aparelho, comSenha });
}

/** adminProcedure confere o módulo; a consulta dos aceites vale pelo PAPEL: só admin. */
const soAdmin = adminProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Só o administrador consulta os aceites do termo." });
  return next();
});

export const consentimentoRouter = router({
  /**
   * Quem deve ver o termo ao entrar (modal ConsentimentoNoLogin):
   *   - conta criada a partir de INICIO_DO_TERMO que ainda não tem NENHUM aceite (QA S-12, achado 1: contas que o admin
   *     cria já com senha — `portal.admin.provisionAccess` e `/api/auth/setup-admin` — não passam pela tela de criar
   *     senha, então aceitam aqui, no primeiro login). Vale com a opção do item 4 desligada;
   *   - com a opção do item 4 ligada (CONSENTIMENTO_PEDIR_NO_LOGIN=1), também quem não aceitou a versão vigente.
   * Conta antiga com a opção desligada: `pedir: false` decidido em memória (sem consultar o banco).
   * Pública de propósito: o cliente redireciona ao login em qualquer UNAUTHORIZED, e esta consulta roda nas áreas
   * logadas sem esperar o auth.me.
   * LIMITAÇÃO (documentada na story): o servidor não bloqueia as demais rotas de quem ainda não aceitou; quem impede o
   * uso da área logada é o modal no cliente.
   */
  minhaSituacao: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.user) return { pedir: false, versao: VERSAO_DO_TERMO };
    const todos = pedirAceiteNoLogin();
    const nova = contaCriadaNoTermo(ctx.user.createdAt);
    if (!todos && !nova) return { pedir: false, versao: VERSAO_DO_TERMO };
    const aceites = await aceitesDoUsuario(getDb(), ctx.user.id);
    return { pedir: precisaAceitarNoLogin(aceites, todos), versao: VERSAO_DO_TERMO };
  }),

  /** Aceite pelo modal do login: conta nova sem aceite, ou qualquer conta com a opção do item 4 ligada. */
  aceitar: protectedProcedure.input(z.object({ aceitouTermo: z.boolean(), versaoDoTermo: z.string().max(40) }))
    .mutation(async ({ ctx, input }) => {
      const todos = pedirAceiteNoLogin();
      const nova = contaCriadaNoTermo(ctx.user.createdAt);
      if (!todos && !nova) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "O pedido de aceite no login está desligado." });
      const db = getDb();
      if (!precisaAceitarNoLogin(await aceitesDoUsuario(db, ctx.user.id), todos)) return { ok: true as const, jaAceito: true };
      conferirAceite("obrigatorio", input.aceitouTermo, input.versaoDoTermo);
      const ua = (ctx.req as { headers?: Record<string, string | undefined> } | undefined)?.headers?.["user-agent"];
      await registrarAceite(db, ctx.user.id, "login", aparelhoDoUserAgent(ua), false);
      return { ok: true as const, jaAceito: false };
    }),

  admin: router({
    /** Por usuário: último aceite (quando e versão) e se cobre a versão vigente; total de usuários por versão. */
    resumo: soAdmin.query(async () => {
      const db = getDb();
      const ultimos = await db.selectDistinctOn([consentimentos.userId], {
        userId: consentimentos.userId, versao: consentimentos.versaoTermo, aceitoEm: consentimentos.aceitoEm, canal: consentimentos.canal,
      }).from(consentimentos).orderBy(consentimentos.userId, desc(consentimentos.aceitoEm), desc(consentimentos.id));
      const atuais = await db.selectDistinct({ userId: consentimentos.userId }).from(consentimentos)
        .where(eq(consentimentos.versaoTermo, VERSAO_DO_TERMO));
      const porVersao = await db.select({ versao: consentimentos.versaoTermo, usuarios: sql<number>`count(distinct ${consentimentos.userId})::int` })
        .from(consentimentos).groupBy(consentimentos.versaoTermo).orderBy(desc(consentimentos.versaoTermo));
      const comAtual = new Set(atuais.map(a => a.userId));
      return {
        versaoAtual: VERSAO_DO_TERMO,
        pedirNoLogin: pedirAceiteNoLogin(),
        avisoProvisorio: AVISO_TEXTO_PROVISORIO,
        pendenciasDoJuridico: [...PENDENCIAS_DO_JURIDICO],
        porVersao: porVersao.map(v => ({ versao: v.versao, usuarios: Number(v.usuarios) })),
        usuarios: ultimos.map(u => ({ ...u, aceitouVersaoAtual: comAtual.has(u.userId) })),
      };
    }),
  }),
});
