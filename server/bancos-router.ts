// Pedido de 25/10: BPO › Bancos — contas por API (Asaas, Pluggy/Meu Pluggy) e por importação.
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { adminProcedure, router } from "./_core/trpc.js";
import { encryptSecret } from "./_core/secret-vault.js";
import { authenticatePluggy, createPluggyConnectToken, fetchPluggyItemAccounts, fetchPluggyItemConnector } from "./_core/pluggy.js";
import { fetchAsaasSaldo } from "./_core/asaas-extrato.js";
import { bankAccounts } from "../drizzle/schema.js";
import * as db from "./db.js";
import { confirmarImportacao, previaImportacao, registrarWebhookPluggy, sincronizarConta, tokenPluggy } from "./bancos.js";

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
      const token = await authenticatePluggy(input.clientId, input.clientSecret);
      if (!token) throw new TRPCError({ code: "BAD_REQUEST", message: "Credenciais Pluggy inválidas ou API indisponível" });
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

    create: adminProcedure
      .input(z.object({
        banco: z.string().trim().min(1),
        agencia: z.string().optional(),
        conta: z.string().trim().optional(),
        tipo: z.enum(["corrente", "poupanca", "pagamento", "investimento"]).optional(),
        descricao: z.string().optional(),
        saldoAtual: z.number().optional(),
        provedor: z.enum(["manual", "asaas"]).default("manual"),
        apiKey: z.string().trim().optional(),
        dataInicial: dataIsoSchema,
      }))
      .mutation(async ({ input }) => {
        let saldo = input.saldoAtual ?? 0;
        if (input.provedor === "asaas") {
          if (!input.apiKey) throw new TRPCError({ code: "BAD_REQUEST", message: "Informe a chave de API do Asaas." });
          try { saldo = await fetchAsaasSaldo(input.apiKey); }
          catch (e) { throw erro(e, "Chave do Asaas não aceita."); }
        }
        const conta = await db.createBankAccount({
          banco: input.banco,
          agencia: input.agencia || null,
          conta: input.conta || (input.provedor === "asaas" ? "Asaas" : "—"),
          tipo: input.tipo ?? "corrente",
          descricao: input.descricao || null,
          saldoAtual: saldo.toFixed(2),
          provedor: input.provedor,
          credencialEncrypted: input.apiKey ? encryptSecret(input.apiKey) : null,
          dataInicial: input.dataInicial ?? null,
        });
        return semSegredo(conta);
      }),

    update: adminProcedure
      .input(z.object({ id: z.number(), dataInicial: dataIsoSchema, descricao: z.string().optional(), apiKey: z.string().trim().optional() }))
      .mutation(async ({ input }) => {
        const atual = await db.getBankAccountById(input.id);
        if (!atual) throw new TRPCError({ code: "NOT_FOUND", message: "Conta não encontrada" });
        if (input.apiKey) {
          try { await fetchAsaasSaldo(input.apiKey); } catch (e) { throw erro(e, "Chave do Asaas não aceita."); }
        }
        await db.getDb().update(bankAccounts).set({
          ...(input.dataInicial !== undefined ? { dataInicial: input.dataInicial } : {}),
          ...(input.descricao !== undefined ? { descricao: input.descricao || null } : {}),
          ...(input.apiKey ? { credencialEncrypted: encryptSecret(input.apiKey) } : {}),
        }).where(eq(bankAccounts.id, input.id));
        return { success: true };
      }),

    delete: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      await db.deleteBankAccount(input.id);
      return { success: true };
    }),

    atualizarSaldo: adminProcedure.input(z.object({ id: z.number(), saldo: z.number() })).mutation(async ({ input }) => {
      await db.updateBankAccountSaldo(input.id, input.saldo);
      return { success: true };
    }),
  }),

  transacoes: router({
    listByConta: adminProcedure.input(z.object({ accountId: z.number() })).query(({ input }) => db.getBankTransactionsByAccount(input.accountId)),
    atualizarStatus: adminProcedure
      .input(z.object({ id: z.number(), status: z.enum(["pendente", "conciliado", "ignorado"]) }))
      .mutation(async ({ input }) => {
        await db.updateBankTransactionStatus(input.id, input.status);
        return { success: true };
      }),
  }),

  sincronizar: adminProcedure.input(z.object({ contaId: z.number() })).mutation(({ input }) => sincronizarConta(input.contaId)),

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
        })).min(1).max(20000),
      }))
      .mutation(({ input }) => confirmarImportacao(input.contaId, input.linhas)),
  }),
});

