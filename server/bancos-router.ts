// Pedido de 25/10: BPO › Bancos — contas por API (Asaas, Pluggy/Meu Pluggy) e por importação.
import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { adminProcedure, router } from "./_core/trpc.js";
import { encryptSecret } from "./_core/secret-vault.js";
import { autenticarPluggyDetalhado, createPluggyConnectToken, mensagemRecusaPluggy, fetchPluggyItemAccounts, fetchPluggyItemConnector } from "./_core/pluggy.js";
import { fetchAsaasSaldo } from "./_core/asaas-extrato.js";
import { criarFetchMtls, fetchInterSaldo, interHabilitado, tokenInter, validarCredencialInter } from "./_core/inter.js";
import { chaveAsaasCentral } from "./_core/asaas.js";
import { bankAccounts } from "../drizzle/schema.js";
import * as db from "./db.js";
import { confirmarImportacao, previaImportacao, registrarWebhookPluggy, sincronizarConta, tokenPluggy } from "./bancos.js";
import { classificarMovimentacao, movimentacoesDaConta, reprocessarMovimentacoes } from "./bpo-extrato.js";
import { CATEGORIAS_BPO } from "../shared/financeiro/bpo-extrato.js";
import { limparContaComBackup, previaLimpezaConta } from "./bpo-auditoria.js";
import { MAX_APELIDO, cnpjDaEmpresa, cnpjValido, ehMatriz, formatarCnpj, raizDoCnpj, rotuloRegime } from "../shared/fiscal/regimes.js";
import { ensureTaxSchema } from "./tax-router.js";

/** EPIC-029 S-6: apelido (renomear a conta; vazio = volta ao nome do banco). */
const apelidoSchema = z.string().trim().max(MAX_APELIDO, `O apelido tem no máximo ${MAX_APELIDO} caracteres.`).nullable().optional();
/** EPIC-029 S-6: CNPJ da empresa dona da conta (de um perfil tributário que já existe); null = sem empresa definida. */
const empresaSchema = z.string().trim().max(20).nullable().optional();

/**
 * Confere o ESTABELECIMENTO (CNPJ completo, matriz ou filial): a empresa (raiz do CNPJ) precisa ter perfil tributário e o estabelecimento
 * precisa já ser conhecido — um perfil com esse CNPJ ou o complemento fiscal (emissor) da filial. Nada é digitado de novo aqui.
 */
async function empresaDoCadastro(valor: string | null | undefined): Promise<string | null | undefined> {
  if (valor === undefined) return undefined;
  if (valor === null || valor === "") return null;
  const cnpj = cnpjDaEmpresa(valor);
  if (!cnpjValido(cnpj)) throw new TRPCError({ code: "BAD_REQUEST", message: "CNPJ da empresa inválido." });
  await ensureTaxSchema();
  const conhecido = (await estabelecimentos()).find(e => e.cnpj === cnpj);
  if (!conhecido) throw new TRPCError({ code: "BAD_REQUEST", message: "Cadastre primeiro o perfil tributário desta empresa (BPO › Contabilidade) ou, para uma filial, o complemento fiscal dela." });
  return cnpj;
}

/** Estabelecimentos conhecidos: CNPJs dos perfis tributários + filiais com complemento fiscal cuja raiz tem perfil. Regime/nome: da empresa. */
async function estabelecimentos() {
  await ensureTaxSchema();
  const perfis = (((await db.getDb().execute(sql`
    SELECT DISTINCT ON (upper(regexp_replace(cnpj, '[^0-9A-Za-z]', '', 'g')))
      upper(regexp_replace(cnpj, '[^0-9A-Za-z]', '', 'g')) AS cnpj, company_name, regime, is_active
    FROM tax_profiles WHERE coalesce(cnpj, '') <> ''
    ORDER BY upper(regexp_replace(cnpj, '[^0-9A-Za-z]', '', 'g')), is_active DESC, effective_from DESC, id DESC`)) as { rows?: Record<string, unknown>[] }).rows ?? [])
    .map(x => ({ cnpj: String(x.cnpj), nome: String(x.company_name), regime: String(x.regime), ativo: Boolean(x.is_active) }));
  let emissores: string[] = [];
  try {
    emissores = (((await db.getDb().execute(sql`SELECT cnpj FROM fiscal_emissores WHERE ativo = true`)) as { rows?: Record<string, unknown>[] }).rows ?? []).map(x => String(x.cnpj));
  } catch { /* sem a migração 0154: só os perfis */ }
  const lista = perfis.map(p => ({ ...p, raiz: raizDoCnpj(p.cnpj), matriz: ehMatriz(p.cnpj) }));
  for (const c of emissores) {
    if (lista.some(e => e.cnpj === c)) continue;
    const daEmpresa = lista.find(e => e.raiz === raizDoCnpj(c) && e.matriz) ?? lista.find(e => e.raiz === raizDoCnpj(c));
    if (daEmpresa) lista.push({ cnpj: c, nome: daEmpresa.nome, regime: daEmpresa.regime, ativo: daEmpresa.ativo, raiz: raizDoCnpj(c), matriz: ehMatriz(c) });
  }
  return lista.sort((a, b) => a.raiz.localeCompare(b.raiz) || Number(b.matriz) - Number(a.matriz) || a.cnpj.localeCompare(b.cnpj));
}
const apelidoLimpo = (v: string | null | undefined) => (v === undefined ? undefined : v && v.trim() ? v.trim() : null);

const dataIsoSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida").nullable().optional();
const erro = (e: unknown, padrao: string) =>
  new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : padrao });

/** Nunca devolve a chave da API para a tela. */
function semSegredo<T extends { credencialEncrypted?: string | null }>(c: T) {
  const { credencialEncrypted, ...resto } = c;
  return { ...resto, temCredencial: Boolean(credencialEncrypted) };
}

export const pluggySettingsRouter = router({
  status: adminProcedure.query(async () => {
    const setting = await db.getPluggySetting();
    return { configured: Boolean(setting?.clientIdEncrypted), active: Boolean(setting?.isActive) };
  }),

  save: adminProcedure
    .input(z.object({ clientId: z.string().trim().min(1), clientSecret: z.string().trim().min(1) }))
    .mutation(async ({ input }) => {
      const r = await autenticarPluggyDetalhado(input.clientId, input.clientSecret);
      if (!r.ok) throw new TRPCError({ code: "BAD_REQUEST", message: mensagemRecusaPluggy(r.status, r.mensagem) });
      await db.savePluggySetting({
        clientIdEncrypted: encryptSecret(input.clientId),
        clientSecretEncrypted: encryptSecret(input.clientSecret),
        isActive: true,
      });
      return { success: true };
    }),

  testar: adminProcedure.mutation(async () => {
    try {
      await tokenPluggy();
      // Avisos em tempo real: garante o webhook da Pluggy apontando para o sistema.
      const aviso = await registrarWebhookPluggy().then(() => " Avisos em tempo real ativos.").catch(e => ` (Avisos em tempo real: ${e instanceof Error ? e.message : "falhou"})`);
      return { ok: true, mensagem: `Pluggy conectada.${aviso}` };
    }
    catch (e) { return { ok: false, mensagem: e instanceof Error ? e.message : "Falha na Pluggy." }; }
  }),

  /** Token para abrir o Pluggy Connect na tela (escolher "Meu Pluggy" e autorizar). */
  connectToken: adminProcedure.mutation(async () => {
    try { return { accessToken: await createPluggyConnectToken(await tokenPluggy()) }; }
    catch (e) { throw erro(e, "Falha ao abrir a Pluggy."); }
  }),

  /** Cadastra sozinho as contas de uma conexão (item) da Pluggy. */
  importarItem: adminProcedure
    .input(z.object({ itemId: z.string().trim().min(8), dataInicial: dataIsoSchema }))
    .mutation(async ({ input }) => {
      try {
        const token = await tokenPluggy();
        const [contas, banco] = await Promise.all([
          fetchPluggyItemAccounts(token, input.itemId),
          fetchPluggyItemConnector(token, input.itemId),
        ]);
        const existentes = await db.getAllBankAccounts();
        let criadas = 0;
        for (const c of contas) {
          if (existentes.some(e => e.pluggyAccountId === c.id)) continue;
          await db.createBankAccount({
            banco: banco ?? "Pluggy",
            conta: c.numero ?? c.nome,
            descricao: c.nome,
            tipo: "corrente",
            provedor: "pluggy",
            pluggyItemId: input.itemId,
            pluggyAccountId: c.id,
            saldoAtual: (c.saldo ?? 0).toFixed(2),
            dataInicial: input.dataInicial ?? null,
          });
          criadas++;
        }
        await registrarWebhookPluggy().catch(() => undefined);
        return { encontradas: contas.length, criadas };
      } catch (e) { throw erro(e, "Falha ao ler a conexão da Pluggy."); }
    }),
});

export const bancarioRouter = router({
  contas: router({
    list: adminProcedure.query(async () => (await db.getAllBankAccounts()).map(semSegredo)),
    /**
     * EPIC-029 S-6: estabelecimentos (matriz/filial) que podem ser donos de uma conta = os CNPJs dos perfis tributários e as filiais com
     * complemento fiscal; a empresa é a raiz do CNPJ. Nada é cadastrado aqui.
     */
    empresas: adminProcedure.query(async () => (await estabelecimentos()).map(e => ({
      cnpj: e.cnpj, cnpjFormatado: formatarCnpj(e.cnpj), raiz: e.raiz, matriz: e.matriz, nome: e.nome, regime: e.regime, regimeRotulo: rotuloRegime(e.regime), ativo: e.ativo,
    }))),
    /** Lote 4: o cadastro mostra "API do Banco Inter (beta)" só com BANCO_INTER_API=1. */
    interHabilitado: adminProcedure.query(() => interHabilitado()),

    create: adminProcedure
      .input(z.object({
        banco: z.string().trim().min(1),
        agencia: z.string().optional(),
        conta: z.string().trim().optional(),
        tipo: z.enum(["corrente", "poupanca", "pagamento", "investimento"]).optional(),
        descricao: z.string().optional(),
        apelido: apelidoSchema,
        empresaCnpj: empresaSchema,
        saldoAtual: z.number().optional(),
        provedor: z.enum(["manual", "asaas", "inter"]).default("manual"),
        apiKey: z.string().trim().optional(),
        dataInicial: dataIsoSchema,
        // Lote 4 (beta, desligado por padrão): credencial da integração do Banco Inter PJ.
        inter: z.object({
          clientId: z.string().max(200), clientSecret: z.string().max(500),
          certificado: z.string().max(20000), chave: z.string().max(20000), contaCorrente: z.string().max(30).nullish(),
        }).optional(),
      }))
      .mutation(async ({ input }) => {
        const empresaCnpj = (await empresaDoCadastro(input.empresaCnpj)) ?? null;
        let saldo = input.saldoAtual ?? 0;
        if (input.provedor === "asaas") {
          // LOTE B (25/10): sem chave própria, valida e usa a chave central (Integrações).
          let chave = input.apiKey;
          if (!chave) {
            const central = await chaveAsaasCentral().catch(() => null);
            if (!central) throw new TRPCError({ code: "BAD_REQUEST", message: "Cadastre a chave do Asaas em Configurações › Integrações." });
            chave = central.apiKey;
          }
          try { saldo = await fetchAsaasSaldo(chave); }
          catch (e) { throw erro(e, "Chave do Asaas não aceita."); }
        }
        let credencialInter: string | null = null;
        if (input.provedor === "inter") {
          // Lote 4: valida a credencial no próprio Inter (token + saldo) antes de salvar, criptografada.
          if (!interHabilitado()) throw new TRPCError({ code: "BAD_REQUEST", message: "O conector do Banco Inter está desligado (beta)." });
          try {
            const cred = validarCredencialInter(input.inter ?? {});
            const f = criarFetchMtls(cred);
            saldo = (await fetchInterSaldo(await tokenInter(cred, f), cred, f)) ?? 0;
            credencialInter = JSON.stringify(cred);
          } catch (e) { throw erro(e, "Credencial do Inter não aceita."); }
        }
        const conta = await db.createBankAccount({
          banco: input.banco,
          agencia: input.agencia || null,
          conta: input.conta || (input.provedor === "asaas" ? "Asaas" : input.provedor === "inter" ? "Inter" : "—"),
          tipo: input.tipo ?? "corrente",
          descricao: input.descricao || null,
          apelido: apelidoLimpo(input.apelido) ?? null,
          empresaCnpj,
          saldoAtual: saldo.toFixed(2),
          provedor: input.provedor,
          credencialEncrypted: credencialInter ? encryptSecret(credencialInter) : input.apiKey ? encryptSecret(input.apiKey) : null,
          dataInicial: input.dataInicial ?? null,
        });
        return semSegredo(conta);
      }),

    update: adminProcedure
      .input(z.object({
        id: z.number(), dataInicial: dataIsoSchema, descricao: z.string().optional(), apiKey: z.string().trim().optional(),
        // EPIC-029 S-6: renomear (apelido) e vincular à empresa; ausente = não muda; null = limpa.
        apelido: apelidoSchema, empresaCnpj: empresaSchema,
      }))
      .mutation(async ({ input }) => {
        const atual = await db.getBankAccountById(input.id);
        if (!atual) throw new TRPCError({ code: "NOT_FOUND", message: "Conta não encontrada" });
        const empresaCnpj = await empresaDoCadastro(input.empresaCnpj);
        const apelido = apelidoLimpo(input.apelido);
        if (input.apiKey) {
          try { await fetchAsaasSaldo(input.apiKey); } catch (e) { throw erro(e, "Chave do Asaas não aceita."); }
        }
        await db.getDb().update(bankAccounts).set({
          ...(input.dataInicial !== undefined ? { dataInicial: input.dataInicial } : {}),
          ...(input.descricao !== undefined ? { descricao: input.descricao || null } : {}),
          ...(apelido !== undefined ? { apelido } : {}),
          ...(empresaCnpj !== undefined ? { empresaCnpj } : {}),
          ...(input.apiKey ? { credencialEncrypted: encryptSecret(input.apiKey) } : {}),
        }).where(eq(bankAccounts.id, input.id));
        return { success: true };
      }),

    previaExclusao: adminProcedure.input(z.object({ id: z.number().int().positive() }))
      .query(({ input }) => previaLimpezaConta(input.id)),

    // Lote 3, item 13B: confirmação digitando EXCLUIR; auditoria = backup com usuário e data.
    delete: adminProcedure.input(z.object({ id: z.number().int().positive(), confirmacao: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        try { return await limparContaComBackup(input.id, input.confirmacao, ctx.user.id); }
        catch (e) { throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Falha ao excluir a conta." }); }
      }),

    atualizarSaldo: adminProcedure.input(z.object({ id: z.number(), saldo: z.number() })).mutation(async ({ input }) => {
      await db.updateBankAccountSaldo(input.id, input.saldo);
      return { success: true };
    }),
  }),

  transacoes: router({
    // LOTE C (25/10): cada movimentação vem com categoria, Cliente BPO e o lançamento vinculado.
    listByConta: adminProcedure.input(z.object({ accountId: z.number() })).query(({ input }) => movimentacoesDaConta(input.accountId)),
    atualizar: adminProcedure
      .input(z.object({
        id: z.number(),
        categoria: z.enum(CATEGORIAS_BPO).optional(),
        bpoClienteId: z.number().int().positive().nullable().optional(),
        // Pedido de 25/10 (noite): grava a regra do titular e reclassifica as demais dele.
        aplicarATodasDoTitular: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        try {
          return await classificarMovimentacao(input.id, {
            categoria: input.categoria, bpoClienteId: input.bpoClienteId, aplicarATodasDoTitular: input.aplicarATodasDoTitular,
          });
        }
        catch (e) { throw erro(e, "Não foi possível atualizar a movimentação."); }
      }),
    atualizarStatus: adminProcedure
      .input(z.object({ id: z.number(), status: z.enum(["pendente", "conciliado", "ignorado"]) }))
      .mutation(async ({ input }) => {
        await db.updateBankTransactionStatus(input.id, input.status);
        return { success: true };
      }),
  }),

  sincronizar: adminProcedure.input(z.object({ contaId: z.number() })).mutation(({ input }) => sincronizarConta(input.contaId)),

  /** LOTE C (25/10): gera os lançamentos do BPO que faltam (idempotente) e recalcula saldos. */
  reprocessar: adminProcedure.mutation(async () => {
    try { return await reprocessarMovimentacoes(); }
    catch (e) { throw erro(e, "Falha ao reprocessar as movimentações."); }
  }),

  importar: router({
    previa: adminProcedure
      .input(z.object({
        contaId: z.number(),
        nome: z.string().min(1).max(255),
        base64: z.string().min(1).max(4_300_000),
        anoPadrao: z.number().int().min(1990).max(2100).optional(),
      }))
      .mutation(async ({ input }) => {
        try { return await previaImportacao(input.contaId, input.nome, Buffer.from(input.base64, "base64"), input.anoPadrao); }
        catch (e) { throw erro(e, "Não foi possível ler o arquivo."); }
      }),
    confirmar: adminProcedure
      .input(z.object({
        contaId: z.number(),
        linhas: z.array(z.object({
          data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          descricao: z.string().max(500),
          valor: z.number().positive(),
          tipo: z.enum(["credito", "debito"]),
          titular: z.string().max(255).optional(),
          detalhe: z.string().max(500).optional(),
          original: z.string().max(2000).optional(),
        })).min(1).max(20000),
        saldoFinal: z.number().finite().nullable().optional(),
      }))
      .mutation(({ input }) => confirmarImportacao(input.contaId, input.linhas, input.saldoFinal)),
  }),
});

