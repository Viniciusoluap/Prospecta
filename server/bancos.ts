// Pedido de 25/10: contas bancárias do BPO por API (Asaas, Pluggy/Meu Pluggy) e por importação
// de extrato (planilha, OFX, PDF), com data inicial por conta. Gêmeo de
// Grupo-Santa-Fe/web/src/lib/bancos.ts.
import { createHash, createHmac } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "./db.js";
import { bankAccounts, bankTransactions, paymentSettings, pluggySettings, userNotifications, users, type BankAccount } from "../drizzle/schema.js";
import { decryptSecret, encryptSecret, segredoEmTextoPuro } from "./_core/secret-vault.js";
import { autenticarPluggyDetalhado, fetchPluggyAccountBalance, mensagemRecusaPluggy, fetchPluggyTransactions, garantirWebhookPluggy } from "./_core/pluggy.js";
import { ENV } from "./_core/env.js";
import { chaveAsaasCentral } from "./_core/asaas.js";
import { fetchAsaasExtrato, fetchAsaasSaldo } from "./_core/asaas-extrato.js";
import { criarFetchMtls, fetchInterExtrato, fetchInterSaldo, interHabilitado, lerCredencialInter, tokenInter, type CredencialInter, type FetchInter } from "./_core/inter.js";
import {
  aplicarDataInicial,
  chavesImportacao,
  lerCsv,
  lerOfx,
  lerTabela,
  lerTextoPdf,
  type LinhaExtrato,
  type ResultadoLeitura,
} from "../shared/extrato-import.js";
import { saldoPorMovimentos } from "../shared/financeiro/bpo-extrato.js";
import { classificacaoInicial, completarMovimentacoesExistentes, contextoClassificacao, gerarLancamentosDoExtrato, recalcularSaldoConta } from "./bpo-extrato.js";
import { sincronizarCobrancasAsaas, vincularCobrancasAoExtrato, type ResultadoCobrancas } from "./bpo-asaas.js";

export type Provedor = "manual" | "asaas" | "pluggy" | "inter";
type Movimento = {
  externalId: string; data: string; descricao: string; valor: number; tipo: "credito" | "debito"; categoria?: string;
  // Pedido de 25/10 (noite): titular, descrição complementar e texto completo da linha.
  titular?: string | null; detalhe?: string | null; original?: string | null;
  identificadorBancario?: string | null;
  asaasPaymentId?: string | null;
};

const hoje = () => new Date().toISOString().slice(0, 10);
const diasAtras = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

/** Lê um segredo e, se ele foi gravado em texto puro (carga inicial), já o recriptografa. */
async function lerSegredo(valor: string, regravar: (cifrado: string) => Promise<unknown>) {
  const claro = decryptSecret(valor);
  if (segredoEmTextoPuro(valor)) await regravar(encryptSecret(claro));
  return claro;
}

export async function tokenPluggy(fetchImpl: typeof fetch = fetch): Promise<string> {
  const db = getDb();
  const [s] = await db.select().from(pluggySettings).limit(1);
  if (!s?.isActive) throw new Error("Configure o Client ID e o Client Secret da Pluggy em Configurações › Integrações.");
  const clientId = await lerSegredo(s.clientIdEncrypted, v => db.update(pluggySettings).set({ clientIdEncrypted: v }).where(eq(pluggySettings.id, s.id)));
  const clientSecret = await lerSegredo(s.clientSecretEncrypted, v => db.update(pluggySettings).set({ clientSecretEncrypted: v }).where(eq(pluggySettings.id, s.id)));
  const r = await autenticarPluggyDetalhado(clientId, clientSecret, fetchImpl);
  if (!r.ok) throw new Error(mensagemRecusaPluggy(r.status, r.mensagem));
  return r.token;
}

/**
 * LOTE B (25/10): conta Asaas sem chave própria usa a chave central (Integrações / ASAAS_API_KEY).
 * Contas antigas com chave própria continuam usando a delas.
 */
export async function credencialDaConta(conta: Pick<BankAccount, "id" | "provedor" | "credencialEncrypted">) {
  if (!conta.credencialEncrypted) {
    if (conta.provedor === "asaas") {
      const central = await chaveAsaasCentral();
      if (central) return central.apiKey;
      throw new Error("Cadastre a chave do Asaas em Configurações › Integrações.");
    }
    throw new Error("Esta conta não tem a chave de API cadastrada.");
  }
  const db = getDb();
  return lerSegredo(conta.credencialEncrypted, v => db.update(bankAccounts).set({ credencialEncrypted: v }).where(eq(bankAccounts.id, conta.id)));
}

/**
 * Grava movimentos (sem duplicar) respeitando a data inicial da conta. LOTE C (25/10): cada
 * movimentação nova recebe uma categoria sugerida e gera o seu lançamento pago no BPO (1:1).
 * Pedido de 25/10 (noite): grava titular e texto original, aplica a regra do titular (ou sugere o
 * cliente BPO pelo nome) e, nas que já existiam, completa titular/descrição sem duplicar.
 */
export async function gravarMovimentos(conta: Pick<BankAccount, "id" | "dataInicial">, movimentos: Movimento[], origem: string) {
  const { mantidas, antesDaDataInicial } = aplicarDataInicial(movimentos.map(m => ({ ...m, data: m.data.slice(0, 10) })), conta.dataInicial);
  const db = getDb();
  let novos = 0;
  const inseridas: { tipo: "credito" | "debito"; valor: string }[] = [];
  const jaExistentes: Movimento[] = [];
  const ctx = await contextoClassificacao(mantidas.map(m => m.titular));
  const detalhes = new Map(mantidas.map(m => [m.externalId, m.detalhe ?? null]));
  for (let i = 0; i < mantidas.length; i += 200) {
    const parte = mantidas.slice(i, i + 200);
    const lote = parte.map(m => ({
      accountId: conta.id,
      data: new Date(`${m.data}T12:00:00Z`),
      descricao: m.descricao.slice(0, 500),
      valor: m.valor.toFixed(2),
      tipo: m.tipo,
      ...classificacaoInicial(m, ctx),
      externalId: m.externalId,
      origem,
      titular: m.titular?.slice(0, 255) || null,
      descricaoOriginal: m.original || null,
      identificadorBancario: m.identificadorBancario?.slice(0, 255) || null,
      asaasPaymentId: m.asaasPaymentId || null,
    }));
    const r = await db
      .insert(bankTransactions)
      .values(lote)
      .onConflictDoNothing({ target: bankTransactions.externalId })
      .returning({ id: bankTransactions.id, externalId: bankTransactions.externalId });
    novos += r.length;
    const porChave = new Map(lote.map(l => [l.externalId, l]));
    const gravadas = r.flatMap(x => {
      const l = x.externalId ? porChave.get(x.externalId) : undefined;
      return l ? [{ ...l, id: x.id, detalhe: detalhes.get(l.externalId) ?? null }] : [];
    });
    inseridas.push(...gravadas);
    // Item 14: crédito de cobrança do Asaas já lançada assume aquele lançamento (não duplica).
    await vincularCobrancasAoExtrato(gravadas);
    await gerarLancamentosDoExtrato(gravadas);
    const novasChaves = new Set(r.map(x => x.externalId));
    jaExistentes.push(...parte.filter(m => !novasChaves.has(m.externalId)));
  }
  const completadas = await completarMovimentacoesExistentes(jaExistentes);
  return {
    completadas, novos, recebidos: movimentos.length, antesDaDataInicial, liquidoNovos: saldoPorMovimentos(inseridas) };
}

export type ResultadoSync = { ok: boolean; mensagem: string; novos?: number; saldo?: number | null; cobrancas?: ResultadoCobrancas | null };

export async function sincronizarConta(
  contaId: number,
  fetchImpl: typeof fetch = fetch,
  /** Lote 4: o Inter exige certificado de cliente (mTLS); nos testes vem simulado. */
  fetchInter: (c: CredencialInter) => FetchInter = criarFetchMtls,
): Promise<ResultadoSync> {
  const db = getDb();
  const [conta] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, contaId)).limit(1);
  if (!conta) throw new Error("Conta não encontrada.");
  try {
    let movimentos: Movimento[];
    let saldo: number | null;
    let chaveAsaas: string | null = null;
    // Releitura com folga: o banco pode lançar com atraso; a chave única evita duplicar.
    const ultima = conta.ultimaSincronizacao ? new Date(conta.ultimaSincronizacao.getTime() - 10 * 86400000).toISOString().slice(0, 10) : null;
    const desde = [conta.dataInicial, ultima].filter(Boolean).sort().pop() ?? diasAtras(365);
    if (conta.provedor === "asaas") {
      const chave = await credencialDaConta(conta);
      chaveAsaas = chave;
      movimentos = await fetchAsaasExtrato(chave, desde, hoje(), fetchImpl);
      saldo = await fetchAsaasSaldo(chave, fetchImpl);
    } else if (conta.provedor === "pluggy" && conta.pluggyAccountId) {
      const token = await tokenPluggy(fetchImpl);
      movimentos = await fetchPluggyTransactions(token, conta.pluggyAccountId, desde, fetchImpl, conta.pluggyItemId);
      saldo = await fetchPluggyAccountBalance(token, conta.pluggyAccountId, fetchImpl);
    } else if (conta.provedor === "inter") {
      // Lote 4: conector do Banco Inter (API Banking), desligado por padrão (BANCO_INTER_API=1 liga).
      if (!interHabilitado()) return { ok: false, mensagem: "O conector do Banco Inter está desligado (beta). Use Importar extrato." };
      const cred = lerCredencialInter(await credencialDaConta(conta));
      const f = fetchInter(cred);
      const token = await tokenInter(cred, f);
      movimentos = await fetchInterExtrato(token, cred, desde, hoje(), f);
      saldo = await fetchInterSaldo(token, cred, f);
    } else {
      return { ok: false, mensagem: "Esta conta é alimentada por importação de extrato (botão Importar extrato)." };
    }
    const r = await gravarMovimentos(conta, movimentos, conta.provedor);
    if (r.novos > 0) await avisarNovasMovimentacoes(conta, r.novos).catch(() => undefined);
    // Pedido de 25/10 (noite), item 14: cobranças emitidas no Asaas (depois do extrato, para reconciliar).
    let cobrancas: ResultadoCobrancas | null = null;
    let avisoCobrancas = "";
    if (chaveAsaas) {
      try {
        cobrancas = await sincronizarCobrancasAsaas(chaveAsaas, conta.dataInicial ?? diasAtras(365), fetchImpl);
        avisoCobrancas = ` Cobranças do Asaas: ${cobrancas.criadas} nova(s), ${cobrancas.atualizadas} atualizada(s), ${cobrancas.reconciliadas} reconciliada(s) com o extrato.`;
      } catch (e) {
        avisoCobrancas = ` (Cobranças do Asaas não lidas: ${e instanceof Error ? e.message : "falha"})`;
      }
    }
    await db.update(bankAccounts).set({
      ultimaSincronizacao: new Date(),
      ultimoErro: null,
      ...(saldo !== null ? { saldoAtual: saldo.toFixed(2), saldoFonte: "api" as const } : {}),
    }).where(eq(bankAccounts.id, conta.id));
    return { ok: true, novos: r.novos, saldo, cobrancas, mensagem: `${r.novos} movimentação(ões) nova(s).${avisoCobrancas}` };
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "Falha ao sincronizar.";
    await db.update(bankAccounts).set({ ultimoErro: mensagem.slice(0, 500) }).where(eq(bankAccounts.id, conta.id));
    return { ok: false, mensagem };
  }
}

/** Sincronização diária (cron): todas as contas ativas ligadas a uma API. */
export async function sincronizarTodasContas(fetchImpl: typeof fetch = fetch) {
  await recriptografarConfiguracaoAsaas().catch(() => undefined);
  const db = getDb();
  const contas = await db.select({ id: bankAccounts.id }).from(bankAccounts)
    .where(and(eq(bankAccounts.ativo, true), inArray(bankAccounts.provedor, interHabilitado() ? ["asaas", "pluggy", "inter"] : ["asaas", "pluggy"])));
  const resultados = [];
  for (const c of contas) resultados.push({ contaId: c.id, ...(await sincronizarConta(c.id, fetchImpl)) });
  return { contas: contas.length, ok: resultados.filter(r => r.ok).length, resultados };
}

// ── Importação de extrato ───────────────────────────────────────────────────

/** Lê o arquivo (CSV, Excel, OFX ou PDF) e devolve as linhas, sem gravar nada. */
export async function lerArquivoExtrato(nome: string, conteudo: Buffer, anoPadrao?: number): Promise<ResultadoLeitura> {
  const ext = nome.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") {
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(conteudo));
    const linhas: string[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const porY = new Map<number, { x: number; s: string }[]>();
      for (const it of tc.items as { str: string; transform: number[] }[]) {
        if (!it.str?.trim()) continue;
        const y = Math.round(it.transform[5]);
        const chave = Array.from(porY.keys()).find(k => Math.abs(k - y) <= 2) ?? y;
        porY.set(chave, [...(porY.get(chave) ?? []), { x: it.transform[4], s: it.str }]);
      }
      for (const y of Array.from(porY.keys()).sort((a, b) => b - a)) {
        linhas.push(porY.get(y)!.sort((a, b) => a.x - b.x).map(i => i.s).join(" "));
      }
    }
    return lerTextoPdf(linhas, anoPadrao);
  }
  if (ext === "xlsx" || ext === "xls") {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(conteudo, { type: "buffer", cellDates: true });
    const tabela = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
    return lerTabela(tabela, "Excel");
  }
  const texto = decodificar(conteudo);
  if (ext === "ofx" || /<OFX>|<STMTTRN>/i.test(texto)) return lerOfx(texto);
  if (ext === "csv" || ext === "txt") return lerCsv(texto);
  throw new Error("Formato não suportado. Use CSV, Excel (.xlsx/.xls), OFX ou PDF.");
}

function decodificar(buf: Buffer) {
  const utf8 = buf.toString("utf8");
  return utf8.includes("�") ? buf.toString("latin1") : utf8;
}

export type PreviaImportacao = {
  formato: string;
  /** `completaDados`: já importada, mas sem titular/descrição no banco — reimportar completa. */
  linhas: (LinhaExtrato & { jaImportada: boolean; completaDados: boolean })[];
  ignoradas: number;
  antesDaDataInicial: number;
  dataInicial: string | null;
  /** Saldo informado no arquivo (null quando o arquivo não traz saldo). */
  saldoFinal: number | null;
};

async function chavesCompativeisImportacao(contaId: number, linhas: LinhaExtrato[]) {
  const atuais = chavesImportacao(contaId, linhas, sha);
  if (!linhas.some(l => l.identificadorBancario)) return atuais;
  const legadas = chavesImportacao(contaId, linhas.map(l => ({ ...l, identificadorBancario: undefined })), sha);
  const encontradas = new Set<string>();
  const todas = [...atuais, ...legadas];
  for (let i = 0; i < todas.length; i += 500) {
    const rows = await getDb().select({ externalId: bankTransactions.externalId }).from(bankTransactions).where(inArray(bankTransactions.externalId, todas.slice(i, i + 500)));
    rows.forEach(r => r.externalId && encontradas.add(r.externalId));
  }
  return atuais.map((key, i) => encontradas.has(key) ? key : encontradas.has(legadas[i]) ? legadas[i] : key);
}

export async function previaImportacao(contaId: number, nome: string, conteudo: Buffer, anoPadrao?: number): Promise<PreviaImportacao> {
  const db = getDb();
  const [conta] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, contaId)).limit(1);
  if (!conta) throw new Error("Conta não encontrada.");
  const lido = await lerArquivoExtrato(nome, conteudo, anoPadrao);
  const { mantidas, antesDaDataInicial } = aplicarDataInicial(lido.linhas, conta.dataInicial);
  const chaves = await chavesCompativeisImportacao(conta.id, mantidas);
  const existentes = new Map<string, { titular: string | null; descricaoOriginal: string | null }>();
  for (let i = 0; i < chaves.length; i += 500) {
    const r = await db.select({ e: bankTransactions.externalId, titular: bankTransactions.titular, descricaoOriginal: bankTransactions.descricaoOriginal })
      .from(bankTransactions).where(inArray(bankTransactions.externalId, chaves.slice(i, i + 500)));
    r.forEach(x => x.e && existentes.set(x.e, x));
  }
  return {
    formato: lido.formato,
    linhas: mantidas.map((l, i) => {
      const e = existentes.get(chaves[i]);
      const completaDados = Boolean(e && ((l.titular && !e.titular) || (l.original && !e.descricaoOriginal)));
      return { ...l, jaImportada: Boolean(e), completaDados };
    }),
    ignoradas: lido.ignoradas,
    antesDaDataInicial,
    dataInicial: conta.dataInicial ?? null,
    saldoFinal: lido.saldoFinal ?? null,
  };
}

export async function confirmarImportacao(contaId: number, linhas: LinhaExtrato[], saldoFinal?: number | null) {
  const db = getDb();
  const [conta] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, contaId)).limit(1);
  if (!conta) throw new Error("Conta não encontrada.");
  // Mesmas chaves da prévia: filtra pela data inicial antes de numerar as ocorrências.
  const { mantidas, antesDaDataInicial } = aplicarDataInicial(linhas, conta.dataInicial);
  const chaves = await chavesCompativeisImportacao(conta.id, mantidas);
  const r = await gravarMovimentos(conta, mantidas.map((l, i) => ({ ...l, externalId: chaves[i] })), "importacao");
  const saldo = await atualizarSaldoAposImportacao(conta, r.liquidoNovos, saldoFinal);
  return { ...r, antesDaDataInicial, saldo };
}

/**
 * LOTE C (25/10): saldo da conta depois de importar.
 * 1) O arquivo trouxe saldo → vale o do arquivo.
 * 2) Conta por API (Asaas/Pluggy) → mantém o saldo informado pela API.
 * 3) Saldo anterior veio de um arquivo → soma o líquido das movimentações novas.
 * 4) Senão → créditos − débitos de todas as movimentações da conta.
 */
export async function atualizarSaldoAposImportacao(
  conta: Pick<BankAccount, "id" | "provedor" | "saldoAtual" | "saldoFonte">,
  liquidoNovos: number,
  saldoFinal?: number | null,
): Promise<number> {
  const db = getDb();
  if (saldoFinal !== null && saldoFinal !== undefined && Number.isFinite(saldoFinal)) {
    await db.update(bankAccounts).set({ saldoAtual: saldoFinal.toFixed(2), saldoFonte: "extrato" }).where(eq(bankAccounts.id, conta.id));
    return saldoFinal;
  }
  if (conta.provedor === "asaas" || conta.provedor === "pluggy") return Number(conta.saldoAtual ?? 0);
  if (conta.saldoFonte === "extrato") {
    const saldo = Math.round((Number(conta.saldoAtual ?? 0) + liquidoNovos) * 100) / 100;
    await db.update(bankAccounts).set({ saldoAtual: saldo.toFixed(2) }).where(eq(bankAccounts.id, conta.id));
    return saldo;
  }
  return recalcularSaldoConta(conta.id);
}

// ── Avisos em tempo real (pedido de 25/10) ──────────────────────────────────

const SITE = () => (process.env.PUBLIC_SITE_URL || "https://www.prospectaconstrucoes.com").replace(/\/+$/, "");
export const URL_WEBHOOK_PLUGGY = () => `${SITE()}/api/pluggy/webhook`;

/** Segredo do webhook da Pluggy, derivado do segredo do servidor (nada a configurar). */
export function segredoWebhookPluggy(): string {
  if (!ENV.cookieSecret) throw new Error("JWT_SECRET ausente.");
  return createHmac("sha256", ENV.cookieSecret).update("pluggy-webhook").digest("hex");
}

export async function registrarWebhookPluggy(fetchImpl: typeof fetch = fetch) {
  return garantirWebhookPluggy(await tokenPluggy(fetchImpl), URL_WEBHOOK_PLUGGY(), segredoWebhookPluggy(), fetchImpl);
}

/** Notificação no sistema para os administradores quando entram movimentações novas. */
async function avisarNovasMovimentacoes(conta: BankAccount, novos: number) {
  const db = getDb();
  const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
  const nome = conta.descricao ? `${conta.banco} — ${conta.descricao}` : conta.banco;
  if (!admins.length) return;
  await db.insert(userNotifications).values(admins.map(a => ({
    userId: a.id,
    title: `${novos} movimentação(ões) nova(s) — ${nome}`,
    message: `O extrato da conta ${nome} foi atualizado automaticamente.`,
    type: "system" as const,
    relatedId: conta.id,
    actionUrl: "/admin/bpo?aba=bancos",
  })));
}

/** Evento recebido (Asaas ou Pluggy): sincroniza na hora as contas afetadas, com trava de 30 s. */
export async function sincronizarPorEvento(filtro: { provedor: "asaas" } | { provedor: "pluggy"; itemId: string }, fetchImpl: typeof fetch = fetch) {
  const db = getDb();
  const contas = await db.select().from(bankAccounts).where(and(
    eq(bankAccounts.ativo, true),
    eq(bankAccounts.provedor, filtro.provedor),
    filtro.provedor === "pluggy" ? eq(bankAccounts.pluggyItemId, filtro.itemId) : undefined,
  ));
  const agora = Date.now();
  const resultados = [];
  for (const c of contas) {
    if (c.ultimaSincronizacao && agora - c.ultimaSincronizacao.getTime() < 30_000) continue;
    resultados.push({ contaId: c.id, ...(await sincronizarConta(c.id, fetchImpl)) });
  }
  return resultados;
}

/** Configuração de cobranças gravada como "plain:" (carga inicial) passa a ficar criptografada. */
export async function recriptografarConfiguracaoAsaas() {
  const db = getDb();
  const [s] = await db.select().from(paymentSettings).limit(1);
  if (!s) return;
  const set: Partial<typeof paymentSettings.$inferInsert> = {};
  if (segredoEmTextoPuro(s.asaasApiKeyEncrypted)) set.asaasApiKeyEncrypted = encryptSecret(decryptSecret(s.asaasApiKeyEncrypted));
  if (s.asaasWebhookTokenEncrypted && segredoEmTextoPuro(s.asaasWebhookTokenEncrypted)) set.asaasWebhookTokenEncrypted = encryptSecret(decryptSecret(s.asaasWebhookTokenEncrypted));
  if (Object.keys(set).length) await db.update(paymentSettings).set({ ...set, updatedAt: new Date() }).where(eq(paymentSettings.id, s.id));
}
