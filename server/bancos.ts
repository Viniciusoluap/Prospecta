// Pedido de 25/10: contas bancárias do BPO por API (Asaas, Pluggy/Meu Pluggy) e por importação
// de extrato (planilha, OFX, PDF), com data inicial por conta. Gêmeo de
// Grupo-Santa-Fe/web/src/lib/bancos.ts.
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "./db.js";
import { bankAccounts, bankTransactions, pluggySettings, type BankAccount } from "../drizzle/schema.js";
import { decryptSecret, encryptSecret, segredoEmTextoPuro } from "./_core/secret-vault.js";
import { authenticatePluggy, fetchPluggyAccountBalance, fetchPluggyTransactions } from "./_core/pluggy.js";
import { fetchAsaasExtrato, fetchAsaasSaldo } from "./_core/asaas-extrato.js";
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

export type Provedor = "manual" | "asaas" | "pluggy";
type Movimento = { externalId: string; data: string; descricao: string; valor: number; tipo: "credito" | "debito"; categoria?: string };

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
  if (!s?.isActive) throw new Error("Configure o Client ID e o Client Secret da Pluggy nesta aba.");
  const clientId = await lerSegredo(s.clientIdEncrypted, v => db.update(pluggySettings).set({ clientIdEncrypted: v }).where(eq(pluggySettings.id, s.id)));
  const clientSecret = await lerSegredo(s.clientSecretEncrypted, v => db.update(pluggySettings).set({ clientSecretEncrypted: v }).where(eq(pluggySettings.id, s.id)));
  const token = await authenticatePluggy(clientId, clientSecret, fetchImpl);
  if (!token) throw new Error("A Pluggy recusou o Client ID/Secret (ou está fora do ar).");
  return token;
}

async function credencialDaConta(conta: BankAccount) {
  if (!conta.credencialEncrypted) throw new Error("Esta conta não tem a chave de API cadastrada.");
  const db = getDb();
  return lerSegredo(conta.credencialEncrypted, v => db.update(bankAccounts).set({ credencialEncrypted: v }).where(eq(bankAccounts.id, conta.id)));
}

/** Grava movimentos (sem duplicar) respeitando a data inicial da conta. */
export async function gravarMovimentos(conta: Pick<BankAccount, "id" | "dataInicial">, movimentos: Movimento[], origem: string) {
  const { mantidas, antesDaDataInicial } = aplicarDataInicial(movimentos.map(m => ({ ...m, data: m.data.slice(0, 10) })), conta.dataInicial);
  const db = getDb();
  let novos = 0;
  for (let i = 0; i < mantidas.length; i += 200) {
    const lote = mantidas.slice(i, i + 200);
    const r = await db
      .insert(bankTransactions)
      .values(lote.map(m => ({
        accountId: conta.id,
        data: new Date(`${m.data}T12:00:00Z`),
        descricao: m.descricao.slice(0, 500),
        valor: m.valor.toFixed(2),
        tipo: m.tipo,
        categoria: m.categoria?.slice(0, 100) ?? null,
        externalId: m.externalId,
        origem,
      })))
      .onConflictDoNothing({ target: bankTransactions.externalId })
      .returning({ id: bankTransactions.id });
    novos += r.length;
  }
  return { novos, recebidos: movimentos.length, antesDaDataInicial };
}

export type ResultadoSync = { ok: boolean; mensagem: string; novos?: number; saldo?: number | null };

export async function sincronizarConta(contaId: number, fetchImpl: typeof fetch = fetch): Promise<ResultadoSync> {
  const db = getDb();
  const [conta] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, contaId)).limit(1);
  if (!conta) throw new Error("Conta não encontrada.");
  try {
    let movimentos: Movimento[];
    let saldo: number | null;
    // Releitura com folga: o banco pode lançar com atraso; a chave única evita duplicar.
    const ultima = conta.ultimaSincronizacao ? new Date(conta.ultimaSincronizacao.getTime() - 10 * 86400000).toISOString().slice(0, 10) : null;
    const desde = [conta.dataInicial, ultima].filter(Boolean).sort().pop() ?? diasAtras(365);
    if (conta.provedor === "asaas") {
      const chave = await credencialDaConta(conta);
      movimentos = await fetchAsaasExtrato(chave, desde, hoje(), fetchImpl);
      saldo = await fetchAsaasSaldo(chave, fetchImpl);
    } else if (conta.provedor === "pluggy" && conta.pluggyAccountId) {
      const token = await tokenPluggy(fetchImpl);
      movimentos = await fetchPluggyTransactions(token, conta.pluggyAccountId, desde, fetchImpl);
      saldo = await fetchPluggyAccountBalance(token, conta.pluggyAccountId, fetchImpl);
    } else {
      return { ok: false, mensagem: "Esta conta é alimentada por importação de extrato (botão Importar extrato)." };
    }
    const r = await gravarMovimentos(conta, movimentos, conta.provedor);
    await db.update(bankAccounts).set({
      ultimaSincronizacao: new Date(),
      ultimoErro: null,
      ...(saldo !== null ? { saldoAtual: saldo.toFixed(2) } : {}),
    }).where(eq(bankAccounts.id, conta.id));
    return { ok: true, novos: r.novos, saldo, mensagem: `${r.novos} movimentação(ões) nova(s).` };
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "Falha ao sincronizar.";
    await db.update(bankAccounts).set({ ultimoErro: mensagem.slice(0, 500) }).where(eq(bankAccounts.id, conta.id));
    return { ok: false, mensagem };
  }
}

/** Sincronização diária (cron): todas as contas ativas ligadas a uma API. */
export async function sincronizarTodasContas(fetchImpl: typeof fetch = fetch) {
  const db = getDb();
  const contas = await db.select({ id: bankAccounts.id }).from(bankAccounts)
    .where(and(eq(bankAccounts.ativo, true), inArray(bankAccounts.provedor, ["asaas", "pluggy"])));
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
  linhas: (LinhaExtrato & { jaImportada: boolean })[];
  ignoradas: number;
  antesDaDataInicial: number;
  dataInicial: string | null;
};

export async function previaImportacao(contaId: number, nome: string, conteudo: Buffer, anoPadrao?: number): Promise<PreviaImportacao> {
  const db = getDb();
  const [conta] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, contaId)).limit(1);
  if (!conta) throw new Error("Conta não encontrada.");
  const lido = await lerArquivoExtrato(nome, conteudo, anoPadrao);
  const { mantidas, antesDaDataInicial } = aplicarDataInicial(lido.linhas, conta.dataInicial);
  const chaves = chavesImportacao(conta.id, mantidas, sha);
  const existentes = new Set<string>();
  for (let i = 0; i < chaves.length; i += 500) {
    const r = await db.select({ e: bankTransactions.externalId }).from(bankTransactions).where(inArray(bankTransactions.externalId, chaves.slice(i, i + 500)));
    r.forEach(x => x.e && existentes.add(x.e));
  }
  return {
    formato: lido.formato,
    linhas: mantidas.map((l, i) => ({ ...l, jaImportada: existentes.has(chaves[i]) })),
    ignoradas: lido.ignoradas,
    antesDaDataInicial,
    dataInicial: conta.dataInicial ?? null,
  };
}

export async function confirmarImportacao(contaId: number, linhas: LinhaExtrato[]) {
  const db = getDb();
  const [conta] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, contaId)).limit(1);
  if (!conta) throw new Error("Conta não encontrada.");
  // Mesmas chaves da prévia: filtra pela data inicial antes de numerar as ocorrências.
  const { mantidas, antesDaDataInicial } = aplicarDataInicial(linhas, conta.dataInicial);
  const chaves = chavesImportacao(conta.id, mantidas, sha);
  const r = await gravarMovimentos(conta, mantidas.map((l, i) => ({ ...l, externalId: chaves[i] })), "importacao");
  return { ...r, antesDaDataInicial };
}
