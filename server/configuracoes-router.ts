import { randomBytes } from "crypto";
import { TRPCError } from "@trpc/server";
import { and, count, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { brokerProfiles, engineerProfiles, leads, users } from "../drizzle/schema.js";
import { validarPerfilEngenheiro } from "../shared/engenheiro.js";
import { definirPerfilEngenheiroAtivo, gravarPerfilEngenheiro } from "./usuario-documentos.js";
import { normalizarPermissoes } from "../shared/perfis-acesso.js";
import { ADMIN_MODULES, normalizePermissions } from "../shared/admin-permissions.js";
import { tokenPrimeiroAcessoAindaValido } from "../shared/session.js";
import { hashPassword } from "./_core/auth-utils.js";
import { adminProcedure, publicProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";
import { lixeiraDaEntidade } from "./drive-organizacao.js";
import { VERSAO_DO_TERMO } from "../shared/termo-consentimento.js";
import { aceitesDoUsuario, aparelhoDoUserAgent, conferirAceite, createdAtEmUtc, ehPrimeiroAcesso, gravarSenhaComAceite, situacaoDoTermo, VALIDADE_DO_LINK_MS } from "./consentimento.js";

const managedRole = z.enum(["admin", "corretor", "colaborador", "cliente", "empreiteiro"]);
// EPIC-023 (S-A): comissão padrão e observações do corretor vieram da antiga tela
// "Corretores". Mesma validação de `brokerInput` (shared/operacional.ts): vazio = sem regra.
const comissaoPadrao = z.string().trim().transform(v => v.replace(",", "."))
  .refine(v => v === "" || (/^\d{1,3}(\.\d{1,4})?$/.test(v) && Number(v) <= 100), "Percentual de comissão inválido (0 a 100)")
  .optional().nullable();
const observacoes = z.string().trim().max(5000).optional().nullable();
const permissionsSchema = z.array(z.enum(ADMIN_MODULES)).max(ADMIN_MODULES.length);

const PRIMEIRO_ACESSO_VALIDADE_MS = VALIDADE_DO_LINK_MS;
const SITE_URL = "https://www.prospectaconstrucoes.com";

// Gera um token de primeiro acesso/redefinição de senha (7 dias) e envia o email para
// o usuário definir a própria senha — ela nunca passa pelo admin. Não lança se o envio
// falhar (fica registrado em email_logs com status "failed"); quem chama decide se
// avisa o admin.
async function enviarLinkDefinicaoSenha(
  userId: number,
  name: string,
  email: string,
  novoUsuario: boolean,
): Promise<boolean> {
  const token = randomBytes(32).toString("hex");
  const expiraEm = new Date(Date.now() + PRIMEIRO_ACESSO_VALIDADE_MS);
  await getDb().update(users).set({
    tokenPrimeiroAcesso: token,
    tokenPrimeiroAcessoExpiraEm: expiraEm,
    updatedAt: new Date(),
  }).where(eq(users.id, userId));

  const { sendEmail, primeiroAcessoTemplate } = await import("./_core/email-smtp.js");
  const template = primeiroAcessoTemplate({ name, link: `${SITE_URL}/definir-senha/${token}`, novoUsuario });
  return sendEmail({
    to: email,
    subject: template.subject,
    html: template.html,
    recipientName: name,
    templateType: "primeiro_acesso",
  });
}

async function ensureAnotherAdmin(userId: number) {
  const [result] = await getDb().select({ total: count() }).from(users)
    .where(and(eq(users.role, "admin"), eq(users.active, true), ne(users.id, userId)));
  if (!result?.total) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "O sistema precisa manter ao menos um administrador ativo" });
  }
}

export const configuracoesRouter = router({
  listUsers: adminProcedure.query(async () => getDb().select({
    id: users.id,
    name: users.name,
    email: users.email,
    phone: users.phone,
    creci: users.creci,
    role: users.role,
    active: users.active,
    permissions: users.permissions,
    leadId: users.leadId,
    // Item 12 (18/10): o cliente aparece pelo nome e telefone do CRM, não "cliente #71".
    leadName: leads.name,
    leadPhone: leads.phone,
    lastSignedIn: users.lastSignedIn,
    createdAt: users.createdAt,
    // Lote 2, correção 04: "Engenheiro" = colaborador com perfil de engenheiro ativo.
    engenheiro: sql<boolean>`coalesce(${engineerProfiles.active}, false) AND ${users.role} = 'colaborador'`,
    // EPIC-023 (S-A): dados do cadastro de corretor (antiga tela "Corretores").
    notes: brokerProfiles.notes,
    defaultCommissionPct: brokerProfiles.defaultCommissionPct,
  }).from(users).leftJoin(leads, eq(users.leadId, leads.id))
    .leftJoin(brokerProfiles, eq(brokerProfiles.userId, users.id))
    .leftJoin(engineerProfiles, eq(engineerProfiles.userId, users.id)).orderBy(users.name)),

  // A senha inicial nunca é digitada pelo admin: cria a conta com um hash placeholder
  // inutilizável (ninguém consegue logar com ele) e manda um email pro próprio usuário
  // definir a senha real pelo link de primeiro acesso.
  /** Item 05: clientes do CRM ainda sem conta (para ligar a conta de cliente). */
  leadsSemConta: adminProcedure.query(async () => getDb()
    .select({ id: leads.id, name: leads.name, email: leads.email, phone: leads.phone })
    .from(leads)
    .leftJoin(users, eq(users.leadId, leads.id))
    .where(and(isNull(leads.deletedAt), isNull(users.id)))
    .orderBy(leads.name)),

  // A senha inicial nunca é digitada pelo admin: cria a conta com um hash placeholder
  // inutilizável (ninguém consegue logar com ele) e manda um email pro próprio usuário
  // definir a senha real pelo link de primeiro acesso.
  // Item 05: cinco perfis com vínculo real — corretor com CRECI e cadastro de
  // corretor; cliente ligado ao lead do CRM (um lead, uma conta); colaborador com
  // módulos; empreiteiro com obras atribuídas na própria obra; admin.
  createUser: adminProcedure.input(z.object({
    name: z.string().trim().min(2).max(255),
    email: z.string().trim().email().max(320),
    role: managedRole,
    phone: z.string().trim().max(20).optional().nullable(),
    creci: z.string().trim().max(40).optional().nullable(),
    permissions: permissionsSchema.default([]),
    leadId: z.number().int().positive().optional().nullable(),
    // Lote 2, correção 04: perfil "Engenheiro" = colaborador + dados profissionais.
    engenheiro: z.boolean().optional(),
    crea: z.string().max(60).optional().nullable(),
    creaUf: z.string().max(4).optional().nullable(),
    // EPIC-023 (S-A): campos do corretor e cadastro sem e-mail de senha (como a antiga tela "Corretores").
    defaultCommissionPct: comissaoPadrao,
    notes: observacoes,
    enviarConvite: z.boolean().default(true),
  })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const email = input.email.toLowerCase();
    const perfilEngenheiro = input.engenheiro ? validarPerfilEngenheiro({ telefone: input.phone, crea: input.crea, creaUf: input.creaUf }) : null;
    if (perfilEngenheiro && input.role !== "colaborador") throw new TRPCError({ code: "BAD_REQUEST", message: "Engenheiro é cadastrado como colaborador." });
    if (perfilEngenheiro && !perfilEngenheiro.ok) throw new TRPCError({ code: "BAD_REQUEST", message: perfilEngenheiro.erro });
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) throw new TRPCError({ code: "CONFLICT", message: "E-mail já cadastrado" });
    if (input.role === "corretor" && (!input.creci?.trim() || !input.phone?.trim()))
      throw new TRPCError({ code: "BAD_REQUEST", message: "Corretor exige CRECI e telefone." });
    // Item 13 (18/10) + revisão do Codex (PR #133): nome e telefone do cliente
    // vêm sempre do cadastro do CRM, nunca do que foi digitado.
    let doCrm: { name: string; phone: string | null } | null = null;
    if (input.role === "cliente") {
      if (!input.leadId) throw new TRPCError({ code: "BAD_REQUEST", message: "Escolha o cliente do CRM a que esta conta pertence." });
      const [lead] = await db.select({ id: leads.id, deletedAt: leads.deletedAt, name: leads.name, phone: leads.phone }).from(leads).where(eq(leads.id, input.leadId)).limit(1);
      if (!lead || lead.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente do CRM não encontrado." });
      const [dono] = await db.select({ id: users.id }).from(users).where(eq(users.leadId, input.leadId)).limit(1);
      if (dono) throw new TRPCError({ code: "CONFLICT", message: "Este cliente do CRM já tem uma conta de acesso." });
      doCrm = { name: lead.name, phone: lead.phone };
    }
    const values = {
      openId: `admin:${email}`,
      name: doCrm?.name || input.name,
      email,
      passwordHash: hashPassword(randomBytes(32).toString("hex")),
      role: input.role,
      phone: doCrm ? doCrm.phone || null : input.phone || null,
      creci: input.creci || null,
      permissions: JSON.stringify(normalizarPermissoes(input.role, normalizePermissions(input.permissions), ADMIN_MODULES)),
      leadId: input.role === "cliente" ? input.leadId! : null,
      loginMethod: "password",
      active: true,
    };
    let created: { id: number };
    if (input.role === "corretor") {
      // Conta e cadastro de corretor na mesma instrução: nunca fica corretor sem perfil.
      const r = await db.execute(sql`WITH created AS (
          INSERT INTO users ("openId", name, email, "passwordHash", role, phone, creci, permissions, "loginMethod", active)
          VALUES (${values.openId}, ${values.name}, ${email}, ${values.passwordHash}, 'corretor', ${values.phone}, ${values.creci}, '[]', 'password', true)
          RETURNING id)
        INSERT INTO broker_profiles (user_id, specialties, notes, default_commission_pct) SELECT id, '[]', ${input.notes || ""}, ${input.defaultCommissionPct || null} FROM created RETURNING user_id AS id`);
      created = { id: Number((r as unknown as { rows: { id: number }[] }).rows[0].id) };
    } else {
      [created] = await db.insert(users).values(values).returning({ id: users.id });
    }
    if (perfilEngenheiro?.ok) await gravarPerfilEngenheiro(created.id, perfilEngenheiro.dados, ctx.user.id);
    // Só o corretor pode ser cadastrado sem convite (cadastro de diretório); o link sai depois por "Enviar link de redefinição".
    const convidar = input.enviarConvite || input.role !== "corretor";
    const emailEnviado = convidar ? await enviarLinkDefinicaoSenha(created.id, values.name, email, true) : false;
    return { ...created, emailEnviado, convidado: convidar };
  }),

  updateUser: adminProcedure.input(z.object({
    id: z.number().int().positive(),
    name: z.string().trim().min(2).max(255),
    role: managedRole,
    phone: z.string().trim().max(20).optional().nullable(),
    creci: z.string().trim().max(40).optional().nullable(),
    active: z.boolean(),
    permissions: permissionsSchema,
    leadId: z.number().int().positive().optional().nullable(),
    // Lote 2, correção 04: liga/desliga o perfil Engenheiro (dados preservados).
    engenheiro: z.boolean().optional(),
    defaultCommissionPct: comissaoPadrao,
    notes: observacoes,
  })).mutation(async ({ ctx, input }) => {
    if (input.engenheiro && input.role !== "colaborador") throw new TRPCError({ code: "BAD_REQUEST", message: "Engenheiro é cadastrado como colaborador." });
    const db = getDb();
    const [current] = await db.select().from(users).where(eq(users.id, input.id)).limit(1);
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado" });
    if (input.id === ctx.user.id && (!input.active || input.role !== "admin")) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Você não pode remover seu próprio acesso administrativo" });
    }
    if (current.role === "admin" && current.active && (input.role !== "admin" || !input.active)) await ensureAnotherAdmin(input.id);
    // Item 05: vínculo do cliente com o lead do CRM (um lead, uma conta).
    const leadId = input.role === "cliente" ? (input.leadId ?? current.leadId ?? null) : null;
    let doCrm: { name: string; phone: string | null } | null = null;
    if (input.role === "cliente") {
      if (!leadId) throw new TRPCError({ code: "BAD_REQUEST", message: "Escolha o cliente do CRM a que esta conta pertence." });
      const [dono] = await db.select({ id: users.id }).from(users).where(and(eq(users.leadId, leadId), ne(users.id, input.id))).limit(1);
      if (dono) throw new TRPCError({ code: "CONFLICT", message: "Este cliente do CRM já tem uma conta de acesso." });
      const [lead] = await db.select({ name: leads.name, phone: leads.phone, deletedAt: leads.deletedAt }).from(leads).where(eq(leads.id, leadId)).limit(1);
      if (!lead || lead.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente do CRM não encontrado." });
      doCrm = { name: lead.name, phone: lead.phone };
    }
    // Revisão do Codex (PR #111): mesma exigência do cadastro — corretor sempre
    // com telefone e CRECI, inclusive quando um usuário existente vira corretor.
    if (input.role === "corretor" && (!input.creci?.trim() || !input.phone?.trim()))
      throw new TRPCError({ code: "BAD_REQUEST", message: "Corretor exige CRECI e telefone." });
    if (input.role === "corretor") {
      // Garante o cadastro de corretor e grava comissão/observações quando vierem (undefined = preserva).
      const dados = {
        ...(input.notes === undefined ? {} : { notes: input.notes || "" }),
        ...(input.defaultCommissionPct === undefined ? {} : { defaultCommissionPct: input.defaultCommissionPct || null }),
      };
      const insercao = db.insert(brokerProfiles).values({ userId: input.id, ...dados });
      await (Object.keys(dados).length
        ? insercao.onConflictDoUpdate({ target: brokerProfiles.userId, set: dados })
        : insercao.onConflictDoNothing());
    }
    // Troca de perfil ou desativação encerra as sessões antigas (sessionVersion).
    const encerrarSessao = current.role !== input.role || (current.active && !input.active);
    const [updated] = await db.update(users).set({
      name: doCrm?.name || input.name,
      role: input.role,
      phone: doCrm ? doCrm.phone || null : input.phone || null,
      creci: input.creci || null,
      active: input.active,
      leadId,
      permissions: JSON.stringify(normalizarPermissoes(input.role, normalizePermissions(input.permissions), ADMIN_MODULES)),
      ...(encerrarSessao ? { sessionVersion: sql`${users.sessionVersion} + 1` } : {}),
      updatedAt: new Date(),
    }).where(eq(users.id, input.id)).returning({ id: users.id });
    if (input.engenheiro !== undefined) await definirPerfilEngenheiroAtivo(input.id, input.engenheiro && input.role === "colaborador", ctx.user.id);
    return updated;
  }),

  // O admin não digita mais a nova senha de outra pessoa: dispara um link de
  // redefinição por email, e o próprio usuário define a senha real. sessionVersion é
  // incrementado na hora (não só quando o link é usado) - qualquer sessão JWT já
  // emitida para este usuário (ex: alguém com acesso indevido) é invalidada
  // imediatamente, sem esperar o reset ser concluído - ver _core/context.ts / shared/session.ts.
  resetPassword: adminProcedure.input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const [current] = await getDb().select({ id: users.id, name: users.name, email: users.email })
        .from(users).where(eq(users.id, input.id)).limit(1);
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado" });
      if (!current.email) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Usuário sem email cadastrado - não é possível enviar o link" });

      await getDb().update(users).set({
        sessionVersion: sql`${users.sessionVersion} + 1`,
        updatedAt: new Date(),
      }).where(eq(users.id, input.id));

      const emailEnviado = await enviarLinkDefinicaoSenha(current.id, current.name ?? "", current.email, false);
      return { id: current.id, emailEnviado };
    }),

  deleteUser: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    if (input.id === ctx.user.id) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Você não pode excluir sua própria conta" });
    const db = getDb();
    const [current] = await db.select().from(users).where(eq(users.id, input.id)).limit(1);
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado" });
    if (current.role === "admin" && current.active) await ensureAnotherAdmin(input.id);
    await db.delete(users).where(eq(users.id, input.id));
    // Pedido de 29/10: Equipe/<Nome (nº id)> (documentos do usuário) vai para a lixeira do Drive.
    await lixeiraDaEntidade("equipe", input.id);
    return { success: true } as const;
  }),
});

// Router público (sem autenticação) para a página /definir-senha/:token — o usuário
// define a própria senha a partir do link enviado por email, sem nunca passar pelo
// admin. Mantido junto de configuracoesRouter porque compartilha a lógica de token.
export const primeiroAcessoRouter = router({
  // EPIC-024 S-12: a tela recebe também a situação do termo de consentimento ("obrigatorio", "opcional" ou "aceito").
  validarToken: publicProcedure.input(z.object({ token: z.string().min(1) })).query(async ({ input }) => {
    const db = getDb();
    const [usuario] = await db.select({ id: users.id, name: users.name, expiraEm: users.tokenPrimeiroAcessoExpiraEm, createdAt: createdAtEmUtc })
      .from(users).where(eq(users.tokenPrimeiroAcesso, input.token)).limit(1);
    const valido = tokenPrimeiroAcessoAindaValido(usuario?.expiraEm);
    if (!valido) return { valido, nome: null, termo: null, versaoDoTermo: VERSAO_DO_TERMO };
    const termo = situacaoDoTermo(await aceitesDoUsuario(db, usuario!.id), ehPrimeiroAcesso({ createdAt: usuario!.createdAt, tokenExpiraEm: usuario!.expiraEm }));
    return { valido, nome: usuario!.name, termo, versaoDoTermo: VERSAO_DO_TERMO };
  }),

  // EPIC-024 S-12: no primeiro acesso o servidor EXIGE `aceitouTermo: true` com a versão vigente; senha e aceite
  // são gravados na mesma transação (server/consentimento.ts › gravarSenhaComAceite).
  definirSenha: publicProcedure.input(z.object({
    token: z.string().min(1),
    novaSenha: z.string().min(8).max(128),
    aceitouTermo: z.boolean().optional(),
    versaoDoTermo: z.string().max(40).optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const [usuario] = await db.select({ id: users.id, expiraEm: users.tokenPrimeiroAcessoExpiraEm, createdAt: createdAtEmUtc })
      .from(users).where(eq(users.tokenPrimeiroAcesso, input.token)).limit(1);
    if (!usuario || !tokenPrimeiroAcessoAindaValido(usuario.expiraEm)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Link inválido ou expirado" });
    }
    const situacao = situacaoDoTermo(await aceitesDoUsuario(db, usuario.id), ehPrimeiroAcesso({ createdAt: usuario.createdAt, tokenExpiraEm: usuario.expiraEm }));
    const gravarAceite = conferirAceite(situacao, input.aceitouTermo, input.versaoDoTermo);
    const ua = (ctx?.req as { headers?: Record<string, string | undefined> } | undefined)?.headers?.["user-agent"];
    // Reivindica o token com guarda atômica (token ainda bate E ainda não expirou) —
    // evita reuso em corrida (duas abas enviando o mesmo link ao mesmo tempo).
    const ok = await gravarSenhaComAceite(db, { userId: usuario.id, token: input.token, novaSenha: input.novaSenha, gravarAceite, aparelho: aparelhoDoUserAgent(ua) });
    if (!ok) throw new TRPCError({ code: "BAD_REQUEST", message: "Link inválido ou expirado" });
    return { success: true } as const;
  }),
});
