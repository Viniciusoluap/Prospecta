// EPIC-029 S-6 — 2º portão de QA (@qa Quinn, 22/11/2026), depois das correções A1–A10. Achados NOVOS como `it.fails` (o teste
// descreve o comportamento CERTO; enquanto o código não for corrigido, "falha como esperado"). Corrigido, trocar `it.fails` por `it`.
// Banco em memória (PGlite), sem rede. Lado seguro fiscal: na dúvida, CONTAR A MAIS (nunca esconder receita e, com ela, o teto).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => {
  const real = await orig<typeof import("../db.js")>();
  const getDb = vi.fn();
  return { ...real, getDb };
});

import * as schema from "../../drizzle/schema.js";
import { getDb } from "../db.js";
import { apurarLimites } from "./teto.js";
import { faltasDps } from "./dps.js";
import { consultarLimitesReceita } from "../dolores/leitura/limites-receita.js";
import { apurarReceitas, perfilVigenteNaData, type ContaParaSoma, type DebitoParaSoma, type PerfilParaRegime, type ReceitaParaSoma } from "../../shared/fiscal/regimes.js";
import { sanitizarResposta } from "../../shared/dolores/sanitizar.js";
import type { EntradaDps } from "../../shared/fiscal/dps-campos.js";

const ler = (n: string) => readFileSync(new URL(`../../drizzle/${n}`, import.meta.url), "utf8");
const M0164 = ler("0164_contas_empresa_limite_receita.sql");
const M0150 = ler("0150_dolores_avisos.sql");
const TABELAS = [
  "users", "leads", "leadServices", "imoveis", "bpoClients", "bpoLancamentos", "bpoRecebimentos", "bankAccounts", "bankTransactions", "constructionProjects",
  "financialTransactions", "taxProfiles",
];
let ddl = "";
beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)("drizzle-kit/api");
  const escolhidas: Record<string, unknown> = {};
  for (const [nome, valor] of Object.entries(schema)) if (TABELAS.includes(nome) || nome.endsWith("Enum")) escolhidas[nome] = valor;
  ddl = (await generateMigration(generateDrizzleJson({}), generateDrizzleJson(escolhidas)) as string[]).join(";\n")
    .replace(/,\s*"apelido" varchar\(80\)/, "").replace(/,\s*"empresa_cnpj" varchar\(14\)/, "");
}, 60_000);

const AGORA = new Date("2026-11-20T15:00:00.000Z");
const PROSPECTA = "41865900000189";

// ── Puro ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const perfil = (id: number, regime: string, desde: string, ativo: boolean): PerfilParaRegime =>
  ({ id, companyName: "Prospecta", cnpj: PROSPECTA, regime, effectiveFrom: new Date(`${desde}T12:00:00Z`), effectiveTo: null, isActive: ativo });
const contaP = (id: number): ContaParaSoma => ({ id, banco: "Cora", apelido: null, descricao: null, conta: `000${id}`, empresaCnpj: PROSPECTA, ativo: true });
const rec = (contaId: number, reais: number, dia: string): ReceitaParaSoma =>
  ({ lancamentoId: 1, contaId, tipo: "receita", valorCentavos: reais * 100, descricao: "Recebimento de cliente", categoria: "Recebimento de cliente", pagoEm: new Date(`${dia}T12:00:00Z`) });
const deb = (contaId: number, reais: number, dia: string, classificacao: DebitoParaSoma["classificacao"]): DebitoParaSoma =>
  ({ txId: 1, contaId, valorCentavos: reais * 100, data: new Date(`${dia}T12:00:00Z`), classificacao });

describe("QA2 S-6 — regras puras", () => {
  // ACHADO N1 (IMPORTANTE — A1 só parcialmente corrigido): a saída SEM lançamento ainda casa e tira a entrada da soma. No BPO, movimentação
  // NOVA sem regra de titular vai para "A classificar" SEM lançamento (server/bpo-extrato.ts:89-99) — ou seja, quase todo pagamento recém-
  // importado (fornecedor, empreiteiro, medição) é `classificacao: null` e casa com um recebimento de cliente JÁ CLASSIFICADO como receita
  // de mesmo valor em outra conta da empresa em até 2 dias. shared/fiscal/regimes.ts:321-325 e :348-350; server/fiscal/teto.ts:64-68 (ELSE NULL).
  // E o valor tirado nem entra em `receitaPossivelCentavos` (o aviso usa a "possível"): o teto some do aviso. Lado seguro: só a saída marcada
  // como Transferência interna casa; a sem classificação no máximo vira pendência ("possível"), nunca sai da soma em silêncio.
  it.fails("N1: pagamento a fornecedor ainda 'a classificar' (sem lançamento) não esconde o recebimento de cliente de mesmo valor", () => {
    const a = apurarReceitas({ agora: AGORA, perfis: [perfil(1, "simples_nacional", "2021-05-07", true)], contas: [contaP(1), contaP(2)],
      receitas: [rec(1, 10_000, "2026-11-10")], debitos: [deb(2, 10_000, "2026-11-10", null)] });
    const p = a.empresas[0]!;
    expect(p.receitaPossivelCentavos).toBe(10_000_00);
  });

  // ACHADO N4 (baixo): versão MAIS NOVA desativada à mão (cadastrada errada) não devolve a vigência à anterior, que foi desativada só por
  // causa dela: a empresa fica "regime a confirmar" → SEM limite e SEM aviso (lado inseguro). shared/fiscal/regimes.ts:155-162.
  // O histórico (tax_profiles_historico: "desativado_por_nova_versao" × "desativado") diz qual foi a troca normal.
  it.fails("N4: desativar à mão a versão nova (errada) volta a valer a anterior (Simples) e não deixa a empresa sem limite", () => {
    const v = perfilVigenteNaData([perfil(1, "simples_nacional", "2021-05-07", false), perfil(2, "lucro_real", "2026-06-01", false)], AGORA);
    expect(v?.regime).toBe("simples_nacional");
  });

  // ACHADO N3 (médio — junção S-6 × S-4): a S-6 criou o regime "a_confirmar" e promete que "a S-4 deve recusar emitir"
  // (EmissorLido.optanteSimples = null), mas a DPS usa `nota.emissor?.regime` (server/fiscal/dps.ts:228), que vem como a STRING "a_confirmar"
  // (server/fiscal/notas.ts emissorNaData), e faltasDps só recusa regime VAZIO (dps.ts:99). Com opSimpNac = 1 (não optante) a DPS passa
  // sem falta nenhuma: nota emitida como não optante sem o contador ter dito o regime.
  it.fails("N3: regime 'a confirmar' bloqueia a DPS (falta o regime), mesmo com opSimpNac de não optante", () => {
    const entrada: EntradaDps = {
      ambiente: "producao_restrita", emitidoEm: new Date("2026-11-22T13:00:00.000Z"), competencia: "2026-11-20", serie: "1", numero: 42,
      prestador: { cnpj: "11.222.333/0001-81", inscricaoMunicipal: "12345", municipioIbge: "2105302" },
      tomador: { documento: "123.456.789-09", nome: "Cliente" },
      servico: { municipioIncidenciaIbge: "2105302", codigoTributacaoNacional: "070201", codigoNbs: "114011000", itemLc116: "7.02", codigoAtividadeSimples: "13",
        descricao: "Administração de obra", cno: null },
      valorCentavos: 1_234_56, regimeTributario: "a_confirmar", aliquotaIss: "5.0000",
      parametros: { opSimpNac: "1", regApTribSN: null, regEspTrib: "0", tribIssqn: "1", tpRetIssqn: "1", indTotTrib: "0",
        ibscbs: { indFinal: "0", cIndOp: "100301", indDest: "0", cst: "000", cClassTrib: "000001" } },
    };
    expect(faltasDps(entrada).join(" | ")).toMatch(/regime/i);
  });
});

// ── Com banco ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
let pg: PGlite;
const q = async <T = Record<string, unknown>>(texto: string, params: unknown[] = []) => (await pg.query<T>(texto, params)).rows;

describe("QA2 S-6 — com banco", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: AGORA });
    pg = new PGlite();
    await pg.exec(ddl);
    await pg.exec(M0150);
    await pg.exec(M0164);
    vi.mocked(getDb).mockReturnValue(drizzle(pg) as never);
    await pg.exec(`
      INSERT INTO users (id, "openId", name, role) VALUES (1, 'admin', 'Dono', 'admin');
      INSERT INTO tax_profiles (company_name, cnpj, regime, estimated_rate, effective_from, is_active) VALUES
        ('Prospecta', '41.865.900/0001-89', 'simples_nacional', 6, '2021-05-07', true);
    `);
  });
  afterEach(async () => { vi.useRealTimers(); await pg.close(); });

  let tx = 0;
  async function conta(apelido: string | null = null) {
    const [c] = await q<{ id: number }>("INSERT INTO bank_accounts (banco, conta, empresa_cnpj, apelido) VALUES ('Cora', '999', $1, $2) RETURNING id", [PROSPECTA, apelido]);
    return c!.id;
  }
  async function mov(contaId: number, tipo: "credito" | "debito", reais: number, quando: string, aClassificar = false) {
    const [t] = await q<{ id: number }>(`INSERT INTO bank_transactions (account_id, data, descricao, valor, tipo, external_id, a_classificar) VALUES ($1, $2, 'PIX', $3, $4, $5, $6) RETURNING id`,
      [contaId, quando, tipo === "debito" ? -reais : reais, tipo, `qa2-${++tx}`, aClassificar]);
    return t!.id;
  }
  async function lanc(tipo: string, reais: number, quando: string, btId: number | null) {
    const [l] = await q<{ id: number }>(`INSERT INTO bpo_lancamentos (tipo, descricao, valor, vencimento, pago, pago_em, competencia, bank_transaction_id)
      VALUES ($1, 'Recebimento de cliente', $2, $3, true, $3, $4, $5) RETURNING id`, [tipo, reais, quando, quando.slice(0, 7), btId]);
    return l!.id;
  }

  // N1 com o banco: o pagamento importado do extrato fica "a classificar" (bank_transactions.a_classificar = true, sem lançamento) — o estado
  // PADRÃO de movimentação nova — e esconde um recebimento de cliente classificado de mesmo valor.
  it.fails("N1 (banco): saída 'a classificar' de outra conta da empresa não tira da soma o recebimento classificado de mesmo valor", async () => {
    const c1 = await conta(); const c2 = await conta();
    await lanc("receita", 50_000, "2026-10-10T12:00:00Z", await mov(c1, "credito", 50_000, "2026-10-10T12:00:00Z"));
    await mov(c2, "debito", 50_000, "2026-10-10T15:00:00Z", true); // pagamento ao empreiteiro, ainda a classificar
    const pro = (await apurarLimites(getDb() as never, AGORA)).empresas.find(e => e.raiz === "41865900")!;
    expect(pro.receitaPossivelCentavos).toBe(50_000_00);
  });

  // N1b: saída usada na "divisão de pagamentos" (darBaixaComMovimentacao, bpo_recebimentos) quitou DESPESAS, mas não tem lançamento próprio
  // (server/bpo-a-classificar.ts:177-178, :191-205) → classificação null → casa como se fosse transferência.
  it.fails("N1b (banco): saída que deu baixa em despesas pela divisão de pagamentos não é transferência", async () => {
    const c1 = await conta(); const c2 = await conta();
    await lanc("receita", 30_000, "2026-10-10T12:00:00Z", await mov(c1, "credito", 30_000, "2026-10-10T12:00:00Z"));
    const d = await mov(c2, "debito", 30_000, "2026-10-11T12:00:00Z");
    for (const [i, v] of [[1, 10_000], [2, 20_000]] as const) {
      const l = await lanc("despesa", v, "2026-10-11T12:00:00Z", null);
      await q("INSERT INTO bpo_recebimentos (lancamento_id, request_key, valor, recebido_em, bank_transaction_id) VALUES ($1, $2, $3, '2026-10-11T12:00:00Z', $4)", [l, `k${i}`, v, d]);
    }
    await q("UPDATE bank_transactions SET status = 'conciliado' WHERE id = $1", [d]);
    const pro = (await apurarLimites(getDb() as never, AGORA)).empresas.find(e => e.raiz === "41865900")!;
    expect(pro.receitaCentavos).toBe(30_000_00);
  });

  // ACHADO N2 (médio): recebimento de cliente usado na divisão de pagamentos (1 crédito quita N cobranças pelo bpo_recebimentos) — as
  // cobranças quitadas não têm bank_transaction_id, então caem em "receita sem conta" (semConta) e o crédito, sem lançamento próprio, cai em
  // "a classificar" da empresa: a receita registrada da empresa fica 0, o valor aparece em DUAS pendências e o crédito já conciliado é
  // mostrado como "ainda a classificar". server/fiscal/teto.ts:52-56 (só l.bank_transaction_id) e :77-81 (NOT EXISTS só por lançamento).
  it.fails("N2 (banco): cobranças quitadas por divisão de pagamentos entram na receita da empresa da conta e não ficam 'a classificar'", async () => {
    const c1 = await conta();
    const cr = await mov(c1, "credito", 30_000, "2026-10-10T12:00:00Z");
    for (const [i, v] of [[1, 10_000], [2, 20_000]] as const) {
      const l = await lanc("receita", v, "2026-10-10T12:00:00Z", null);
      await q("INSERT INTO bpo_recebimentos (lancamento_id, request_key, valor, recebido_em, bank_transaction_id) VALUES ($1, $2, $3, '2026-10-10T12:00:00Z', $4)", [l, `r${i}`, v, cr]);
    }
    await q("UPDATE bank_transactions SET status = 'conciliado', a_classificar = false WHERE id = $1", [cr]);
    const r = await apurarLimites(getDb() as never, AGORA);
    const pro = r.empresas.find(e => e.raiz === "41865900")!;
    expect({ receita: pro.receitaCentavos, aClassificar: pro.aClassificar.centavos, semConta: r.semConta.receitaCentavos })
      .toEqual({ receita: 30_000_00, aClassificar: 0, semConta: 0 });
  });

  // ACHADO N5 (baixo — A9 residual): o apelido é texto livre digitado e vai INTEIRO à Dolores (nomeSeguroDaConta devolve o apelido sem
  // filtro: shared/fiscal/regimes.ts:210-215). A correção do A9 tirou a descrição livre justamente porque "pode ter número digitado" — o
  // apelido tem o mesmo risco ("Cora 98765-4"), e o filtro geral (sanitizar) só pega número de conta com contexto bancário por perto.
  // O aviso de integração já corta no 1º dígito (limparNomeDeTerceiro); a leitura consultar_limites_receita não.
  it.fails("N5: número de conta digitado no apelido não chega à Dolores pela leitura de limites", async () => {
    await conta("Cora 98765-4");
    const leitura = sanitizarResposta((await consultarLimitesReceita({}, { agora: AGORA })).dados, { mascararDadosPessoais: false });
    expect(JSON.stringify(leitura)).not.toMatch(/98765/);
  });

  // Controles (passam hoje): o que já está certo continua certo.
  it("controle: saída marcada como Transferência interna continua casando (transferência real fora da soma)", async () => {
    const c1 = await conta(); const c2 = await conta();
    await lanc("receita", 20_000, "2026-10-12T12:00:00Z", await mov(c1, "credito", 20_000, "2026-10-12T12:00:00Z"));
    await q(`INSERT INTO bank_transactions (account_id, data, descricao, valor, tipo, external_id, categoria) VALUES ($1, '2026-10-12T12:00:00Z', 'TED', -20000, 'debito', 'qa2-tr', 'Transferência interna')`, [c2]);
    const pro = (await apurarLimites(getDb() as never, AGORA)).empresas.find(e => e.raiz === "41865900")!;
    expect(pro.receitaCentavos).toBe(0);
    expect(pro.foraDaSoma.transferenciasCentavos).toBe(20_000_00);
  });

  it("controle: sem apelido, a leitura da Dolores leva só banco + final mascarado", async () => {
    await q("INSERT INTO bank_accounts (banco, conta, empresa_cnpj) VALUES ('Inter', '1234567-8', $1)", [PROSPECTA]);
    const leitura = JSON.stringify((await consultarLimitesReceita({}, { agora: AGORA })).dados);
    expect(leitura).not.toMatch(/1234567/);
    expect(leitura).toMatch(/Inter •••5678/);
  });
});
