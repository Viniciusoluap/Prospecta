// Maquete 3D (EPIC-022, etapa 3) — venda ao cliente: ele solicita a maquete do próprio projeto no portal, paga
// pelo Asaas e, quando o webhook confirma, o pedido é liberado sozinho para a equipe rodar o motor. A liquidação
// usa a mesma tabela payment_orders e a mesma regra de idempotência dos outros pagamentos (um efeito por cobrança).
import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { operationalProjects, paymentOrders, projectDocuments, type PaymentOrder } from "../../drizzle/schema.js";
import { maquetes3d, type Maquete3d } from "../../drizzle/schema-maquete-3d.js";
import { FAIXAS_PRECO, MAX_DOCUMENTOS, ROTULOS_FAIXA, type DocumentoMaquete, type StatusMaquete } from "../../shared/maquete-3d/regras.js";
import { protectedProcedure, router } from "../_core/trpc.js";
import * as bd from "../db.js";
import { clientLeadId } from "../portal-router.js";
import { agora, carregarConfig, db, dependencias, erroSeguro, type Cobranca, type MetodoPagamento, type Pagador } from "./base.js";

const NOTA_ASAAS = "Pagamento confirmado pelo Asaas";
/** Pedidos que ainda contam como "o projeto já tem maquete pedida". */
const EM_ABERTO: StatusMaquete[] = ["aguardando_aprovacao", "aguardando_pagamento", "liberada", "em_leitura", "em_revisao", "validada", "publicada"];

/** Chamado pela liquidação do pagamento: libera a maquete ligada à cobrança. Uma vez só, mesmo com webhook repetido. */
export async function liberarPorPagamento(pedido: PaymentOrder): Promise<boolean> {
  const r = await db().update(maquetes3d)
    .set({ status: "liberada" satisfies StatusMaquete, pagoEm: agora(), liberadoEm: agora(), liberacaoNota: NOTA_ASAAS, updatedAt: agora() })
    .where(and(eq(maquetes3d.paymentOrderId, pedido.id), eq(maquetes3d.status, "aguardando_pagamento"), isNull(maquetes3d.deletedAt)))
    .returning({ id: maquetes3d.id });
  return r.length > 0;
}

async function pdfsDoProjeto(projectId: number): Promise<DocumentoMaquete[]> {
  const linhas = await db().select({ id: projectDocuments.id, nome: projectDocuments.originalName, mime: projectDocuments.mime }).from(projectDocuments)
    .where(and(eq(projectDocuments.projectId, projectId), eq(projectDocuments.status, "active"), isNull(projectDocuments.deletedAt))).orderBy(desc(projectDocuments.id));
  return linhas.filter(l => l.mime === "application/pdf" || /\.pdf$/i.test(l.nome)).slice(0, MAX_DOCUMENTOS).map(l => ({ fonte: "projeto" as const, id: l.id, nome: l.nome }));
}

/** Cria a cobrança de uma maquete que ainda não tem, ou devolve a que já existe. */
async function cobrar(m: Maquete3d, pagador: Pagador, metodo: MetodoPagamento): Promise<Cobranca> {
  const cobrador = dependencias().cobrador;
  if (m.paymentOrderId) {
    const [pedido] = await db().select().from(paymentOrders).where(eq(paymentOrders.id, m.paymentOrderId)).limit(1);
    if (pedido?.status === "pending") return cobrador.consultar(pedido.providerPaymentId);
  }
  const valor = Number(m.preco);
  if (!(valor > 0)) throw new TRPCError({ code: "BAD_REQUEST", message: "Esta maquete não tem valor a cobrar." });
  let cobranca: Cobranca;
  try { cobranca = await cobrador.criar({ pagador, valor, descricao: m.titulo.slice(0, 200), referencia: `maquete_3d_${m.id}`, metodo }); }
  catch (e) {
    const texto = erroSeguro(e);
    throw new TRPCError({ code: "BAD_REQUEST", message: /cpf|cnpj/i.test(texto) ? "Para gerar a cobrança é preciso ter o CPF no cadastro. Fale com a nossa equipe." : `Não foi possível gerar a cobrança agora. ${texto}` });
  }
  const pedido = await bd.createPaymentOrder({ providerPaymentId: cobranca.id, purpose: "maquete_3d", userId: pagador.id, principalAmount: Math.round(valor * 100) });
  await db().update(maquetes3d).set({ paymentOrderId: pedido.id, updatedAt: agora() }).where(eq(maquetes3d.id, m.id));
  return cobranca;
}

const paraCliente = (m: Maquete3d) => ({
  id: m.id, titulo: m.titulo, status: m.status as StatusMaquete, preco: m.preco === null ? null : Number(m.preco),
  faixaPreco: m.faixaPreco, criadaEm: m.createdAt, pagoEm: m.pagoEm, recusaMotivo: m.status === "recusada" ? m.recusaMotivo : null,
  /** O link só existe para o cliente depois que o administrador publica. */
  link: m.status === "publicada" ? `/maquete/${m.token}` : null,
});

const metodo = z.enum(["pix", "boleto", "cartao"]).default("pix");

/** Portal do cliente: maquetes dos projetos ligados ao cadastro (lead) dele. */
export const portalMaqueteRouter = router({
  resumo: protectedProcedure.query(async ({ ctx }) => {
    const leadId = clientLeadId(ctx);
    const projetos = await db().select({ id: operationalProjects.id, nome: operationalProjects.name }).from(operationalProjects)
      .where(eq(operationalProjects.leadId, leadId)).orderBy(desc(operationalProjects.id));
    const ids = projetos.map(p => p.id);
    const [maquetes, config] = await Promise.all([
      ids.length ? db().select().from(maquetes3d).where(and(inArray(maquetes3d.projectId, ids), isNull(maquetes3d.deletedAt))).orderBy(desc(maquetes3d.id)) : [],
      carregarConfig(),
    ]);
    const pdfs = new Map(await Promise.all(ids.map(async id => [id, (await pdfsDoProjeto(id)).length] as const)));
    return {
      precos: FAIXAS_PRECO.map(f => ({ faixa: f, rotulo: ROTULOS_FAIXA[f], preco: config.precos[f] })),
      projetos: projetos.map(p => ({
        ...p, temPdf: (pdfs.get(p.id) ?? 0) > 0,
        maquete: (() => { const m = maquetes.find(x => x.projectId === p.id && x.status !== "recusada") ?? maquetes.find(x => x.projectId === p.id); return m ? paraCliente(m) : null; })(),
      })),
    };
  }),

  /**
   * O cliente pede a maquete do próprio projeto, na faixa de preço da tabela. O pedido vai para o administrador
   * aprovar; só depois da aprovação a cobrança existe. Pedir de novo devolve o pedido em aberto.
   */
  solicitar: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), faixaPreco: z.enum(FAIXAS_PRECO) })).mutation(async ({ ctx, input }) => {
    const leadId = clientLeadId(ctx);
    const [projeto] = await db().select({ id: operationalProjects.id, nome: operationalProjects.name }).from(operationalProjects)
      .where(and(eq(operationalProjects.id, input.projectId), eq(operationalProjects.leadId, leadId))).limit(1);
    if (!projeto) throw new TRPCError({ code: "NOT_FOUND", message: "Projeto não encontrado." });
    const [aberta] = await db().select().from(maquetes3d)
      .where(and(eq(maquetes3d.projectId, projeto.id), isNull(maquetes3d.deletedAt), inArray(maquetes3d.status, EM_ABERTO))).orderBy(desc(maquetes3d.id)).limit(1);
    if (aberta) return { maquete: paraCliente(aberta) };
    const documentos = await pdfsDoProjeto(projeto.id);
    if (!documentos.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "O seu projeto ainda não tem o PDF cadastrado. Fale com a nossa equipe para liberar a maquete." });
    const preco = (await carregarConfig()).precos[input.faixaPreco];
    const [nova] = await db().insert(maquetes3d).values({
      token: randomBytes(24).toString("base64url"), titulo: `Maquete 3D — ${projeto.nome}`.slice(0, 255), origem: "projeto", projectId: projeto.id,
      tipo: "casa", status: "aguardando_aprovacao" satisfies StatusMaquete, faixaPreco: input.faixaPreco, preco: preco.toFixed(2),
      documentos: JSON.stringify(documentos), solicitadoPor: ctx.user.id, createdAt: agora(), updatedAt: agora(),
    }).returning();
    return { maquete: paraCliente(nova) };
  }),

  /** Pedido aprovado pelo administrador: o cliente gera (ou reabre) a cobrança do Asaas. */
  pagar: protectedProcedure.input(z.object({ id: z.number().int().positive(), metodo })).mutation(async ({ ctx, input }) => {
    const leadId = clientLeadId(ctx);
    const [linha] = await db().select({ m: maquetes3d }).from(maquetes3d).innerJoin(operationalProjects, eq(operationalProjects.id, maquetes3d.projectId))
      .where(and(eq(maquetes3d.id, input.id), eq(operationalProjects.leadId, leadId), isNull(maquetes3d.deletedAt))).limit(1);
    if (!linha) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado." });
    if (linha.m.status !== "aguardando_pagamento") throw new TRPCError({ code: "CONFLICT", message: linha.m.status === "aguardando_aprovacao" ? "O pedido ainda está em aprovação." : "Este pedido não está aguardando pagamento." });
    const pagador: Pagador = { id: ctx.user.id, name: ctx.user.name ?? null, email: ctx.user.email ?? null, cpf: (ctx.user as { cpf?: string | null }).cpf ?? null };
    return { cobranca: await cobrar(linha.m, pagador, input.metodo) };
  }),
});
