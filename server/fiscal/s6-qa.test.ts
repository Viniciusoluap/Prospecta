// EPIC-029 S-6 — portão de QA (@qa Quinn, 22/11/2026): tentativas de quebrar contas por empresa, regime por empresa, limite de receita,
// gerador e aviso da Dolores. Achados ficam como `it.fails` (o teste descreve o comportamento CERTO; enquanto o código não for corrigido,
// o teste "falha como esperado"). Corrigido o código, trocar `it.fails` por `it`.
// Banco em memória (PGlite), sem rede. Lado seguro fiscal: na dúvida, CONTAR A MAIS (nunca esconder receita e, com ela, o teto).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => {
  const real = await orig<typeof import("../db.js")>();
  const { bankAccounts } = await import("../../drizzle/schema.js");
  const { eq } = await import("drizzle-orm");
  const getDb = vi.fn();
  return { ...real, getDb,
    createBankAccount: async (data: never) => (await getDb().insert(bankAccounts).values(data).returning())[0],
    getBankAccountById: async (id: number) => (await getDb().select().from(bankAccounts).where(eq(bankAccounts.id, id)).limit(1))[0] };
});
vi.mock("../_core/env.js", async orig => ({ ENV: { ...(await orig<typeof import("../_core/env.js")>()).ENV, cookieSecret: "segredo-de-teste" } }));

import * as schema from "../../drizzle/schema.js";
import { getDb } from "../db.js";
import { canAccessAdminProcedure, router } from "../_core/trpc.js";
import { bancarioRouter } from "../bancos-router.js";
import { taxRouter } from "../tax-router.js";
import { fiscalRouter } from "./router.js";
import { gerarRascunhos } from "./gerador.js";
import { emissoresComPerfil } from "./notas.js";
import { apurarLimites, inicioDoAnoEmBrasilia } from "./teto.js";
import { consultarLimitesReceita } from "../dolores/leitura/limites-receita.js";
import {
  LIMITES, apurarReceitas, ehEstorno, faixaDoLimite, limitesDoRegime, optanteDoSimples, type ContaParaSoma, type DebitoParaSoma,
  type PerfilParaRegime, type ReceitaParaSoma,
} from "../../shared/fiscal/regimes.js";
import { sanitizarResposta } from "../../shared/dolores/sanitizar.js";
import { SILENCIADOS_POR_PADRAO, TIPOS_AVISO, TIPOS_SEM_REAVISO, silenciadoPelaLinha } from "../../shared/dolores/avisos.js";

const ler = (n: string) => readFileSync(new URL(`../../drizzle/${n}`, import.meta.url), "utf8");
const M0154 = ler("0154_fiscal_notas.sql");
const M0162 = ler("0162_fiscal_certificados.sql"); // S-4: coluna codigo_atividade_simples do tipo de serviço (junção com a main)
const M0167 = ler("0167_fiscal_emissao.sql"); // S-7: travas da emissão do emissor (emissao_liberada etc.) — junção S-6 × S-7
const M0150 = ler("0150_dolores_avisos.sql");
const M0164 = ler("0164_contas_empresa_limite_receita.sql");
const TABELAS = [
  "users", "leads", "leadServices", "imoveis", "bpoClients", "bpoLancamentos", "bankAccounts", "bankTransactions", "constructionProjects",
  "obraMovimentos", "regularizacoes", "regularizacaoItensFinanceiros", "regularizacaoRecebimentos", "avaliacoes", "operationalCommissions",
  "financialTransactions", "taxProfiles", "taxObligations", "retProjects",
];
let ddl = "";
beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)("drizzle-kit/api");
  const escolhidas: Record<string, unknown> = {};
  for (const [nome, valor] of Object.entries(schema)) if (TABELAS.includes(nome) || nome.endsWith("Enum")) escolhidas[nome] = valor;
  // bank_accounts nasce SEM as colunas novas (como em produção antes da 0164)
  ddl = (await generateMigration(generateDrizzleJson({}), generateDrizzleJson(escolhidas)) as string[]).join(";\n")
    .replace(/,\s*"apelido" varchar\(80\)/, "").replace(/,\s*"empresa_cnpj" varchar\(14\)/, "");
}, 60_000);

const AGORA = new Date("2026-11-20T15:00:00.000Z");
const PROSPECTA = "41865900000189";
const VFX = "58121993000100";
const EFFICAZ = "04578232000182";
const EFFICAZ_FILIAL = "04578232000263";

// ── Base pura (sem banco) ────────────────────────────────────────────────────────────────────────────────────────────────────
const perfil = (id: number, cnpj: string, regime: string, desde: string, ativo = true, ate: string | null = null): PerfilParaRegime =>
  ({ id, companyName: `Empresa ${cnpj.slice(0, 8)}`, cnpj, regime, effectiveFrom: new Date(`${desde}T12:00:00Z`), effectiveTo: ate ? new Date(`${ate}T12:00:00Z`) : null, isActive: ativo });
const contaP = (id: number, empresaCnpj: string | null): ContaParaSoma => ({ id, banco: "Cora", apelido: null, descricao: null, conta: `000${id}`, empresaCnpj, ativo: true });
let lid = 0;
const rec = (contaId: number | null, reais: number, dia: string, extra: Partial<ReceitaParaSoma> = {}): ReceitaParaSoma =>
  ({ lancamentoId: ++lid, contaId, tipo: "receita", valorCentavos: Math.round(reais * 100), descricao: "Recebimento de cliente", categoria: "Recebimento de cliente",
    pagoEm: new Date(`${dia}T12:00:00Z`), txDescricao: "PIX RECEBIDO", ...extra });
let did = 0;
const deb = (contaId: number, reais: number, dia: string, classificacao: DebitoParaSoma["classificacao"] = null): DebitoParaSoma =>
  ({ txId: ++did, contaId, valorCentavos: Math.round(reais * 100), data: new Date(`${dia}T12:00:00Z`), classificacao });
const apurar = (p: { perfis?: PerfilParaRegime[]; contas?: ContaParaSoma[]; receitas?: ReceitaParaSoma[]; debitos?: DebitoParaSoma[]; agora?: Date }) =>
  apurarReceitas({ agora: p.agora ?? AGORA, perfis: p.perfis ?? [perfil(1, PROSPECTA, "simples_nacional", "2021-05-07")],
    contas: p.contas ?? [contaP(1, PROSPECTA), contaP(2, PROSPECTA)], receitas: p.receitas ?? [], debitos: p.debitos ?? [] });
const prospecta = (a: ReturnType<typeof apurar>) => a.empresas.find(e => e.raiz === "41865900")!;

describe("QA S-6 — 3. cálculo (função pura)", () => {
  it("limites por regime: Simples 360 mil / 3,6 mi / 4,8 mi; Presumido 78 mi; Real sem; RET/Outro/a confirmar sem limite calculado", () => {
    expect(limitesDoRegime("simples_nacional").limites.map(l => l.valorCentavos)).toEqual([360_000_00, 3_600_000_00, 4_800_000_00]);
    expect(limitesDoRegime("lucro_presumido").limites.map(l => l.valorCentavos)).toEqual([78_000_000_00]);
    expect(limitesDoRegime("lucro_real")).toMatchObject({ situacao: "sem_limite", limites: [] });
    for (const r of ["ret", "outro", "a_confirmar", null, "", "qualquer"]) expect(limitesDoRegime(r as string)).toMatchObject({ situacao: "a_confirmar", limites: [] });
    expect(LIMITES.teto_simples.consequencia).toMatch(/5,76/);
    expect(optanteDoSimples("simples_nacional")).toBe(true);
    expect(optanteDoSimples("lucro_presumido")).toBe(false);
    expect(optanteDoSimples("a_confirmar")).toBeNull();
    expect(optanteDoSimples(null)).toBeNull();
  });

  it("faixas exatas em centavos: 69,99% não avisa; 70% exato avisa; 100% exato = 100; valores grandes sem estouro", () => {
    expect(faixaDoLimite(4_800_000_00 * 0.7 - 1, 4_800_000_00)).toBe(0);
    expect(faixaDoLimite(4_800_000_00 * 0.7, 4_800_000_00)).toBe(70);
    expect(faixaDoLimite(4_800_000_00, 4_800_000_00)).toBe(100);
    expect(faixaDoLimite(78_000_000_00 * 3, 78_000_000_00)).toBe(100);
    expect(faixaDoLimite(-5, 100)).toBe(0);
    expect(faixaDoLimite(5, 0)).toBe(0);
  });

  it("transferência só casa na MESMA empresa, em OUTRA conta, mesmo valor, até 2 dias, e cada saída casa uma vez só", () => {
    const perfis = [perfil(1, PROSPECTA, "simples_nacional", "2021-05-07"), perfil(2, VFX, "simples_nacional", "2021-05-07")];
    const contas = [contaP(1, PROSPECTA), contaP(2, PROSPECTA), contaP(3, VFX)];
    const a = apurar({ perfis, contas,
      // QA3 S-6 (Q1/Q2): transferência real = os DOIS lados marcados; só a entrada marcada pode sair da soma
      receitas: [rec(1, 10_000, "2026-11-10", { marcadaTransferencia: true }), rec(1, 10_000, "2026-11-10", { marcadaTransferencia: true }),
        rec(1, 7_000, "2026-11-10", { marcadaTransferencia: true }), rec(1, 5_000, "2026-11-01", { marcadaTransferencia: true }), rec(1, 3_000, "2026-11-10", { marcadaTransferencia: true })],
      // QA2 S-6 (N1): as saídas do cenário são transferências MARCADAS (só elas casam)
      debitos: [deb(2, 10_000, "2026-11-11", "transferencia"), deb(3, 7_000, "2026-11-10", "transferencia"), deb(2, 5_000, "2026-11-04", "transferencia"),
        deb(1, 3_000, "2026-11-10", "transferencia")] });
    const p = prospecta(a);
    // só UMA das duas entradas de 10 mil sai (uma saída casa uma vez); 7 mil vindo da VFX (outra empresa) conta; 5 mil com 3 dias conta;
    // 3 mil com saída na MESMA conta conta
    expect(p.foraDaSoma).toMatchObject({ transferencias: 1, transferenciasCentavos: 10_000_00 });
    expect(p.receitaCentavos).toBe((10_000 + 7_000 + 5_000 + 3_000) * 100);
  });

  // ACHADO A1 (importante — segurança fiscal): a entrada é tirada da soma por COINCIDÊNCIA de valor com qualquer saída de outra conta da
  // mesma empresa em até 2 dias — inclusive pagamento a fornecedor/empreiteiro. Valores redondos (parcela de R$ 10.000 recebida e
  // medição de R$ 10.000 paga) são comuns na operação; a receita é SUBCONTADA e o aviso do teto pode não sair. shared/fiscal/regimes.ts:263-265
  // (a saída não precisa ser transferência: DebitoParaSoma não traz classificação nem contraparte; server/fiscal/teto.ts:56-60 pega todo débito).
  it("A1: recebimento de cliente NÃO pode sair da soma só porque outra conta da empresa pagou um fornecedor no mesmo valor", () => {
    // corrigido: a saída de outra conta tem lançamento de DESPESA no BPO (pagamento) → não casa; a entrada conta
    const a = apurar({ receitas: [rec(1, 10_000, "2026-11-10", { txDescricao: "PIX RECEBIDO MARIA SOUZA" })], debitos: [deb(2, 10_000, "2026-11-11", "despesa")] });
    expect(prospecta(a).receitaCentavos).toBe(10_000_00);
    // marcada como transferência continua casando (sem classificação NÃO casa — QA2 N1)
    expect(prospecta(apurar({ receitas: [rec(1, 10_000, "2026-11-10", { marcadaTransferencia: true })], debitos: [deb(2, 10_000, "2026-11-11", "transferencia")] })).receitaCentavos).toBe(0);
    // QA3 (Q2): entrada NÃO marcada (receita de cliente) nunca é anulada, nem por saída marcada — só fica para conferir
    expect(prospecta(apurar({ receitas: [rec(1, 10_000, "2026-11-10")], debitos: [deb(2, 10_000, "2026-11-11", "transferencia")] })))
      .toMatchObject({ receitaCentavos: 10_000_00, possiveisTransferencias: { entradas: 1 } });
  });

  it("escala do A1 (corrigido): 40 pagamentos de obra de R$ 100 mil (despesa lançada) NÃO escondem as parcelas recebidas; o teto aparece", () => {
    const receitas: ReceitaParaSoma[] = [];
    const debitos: DebitoParaSoma[] = [];
    for (let i = 0; i < 48; i++) {
      const dia = `2026-${String(1 + Math.floor(i / 5)).padStart(2, "0")}-${String(1 + (i % 5) * 5).padStart(2, "0")}`;
      receitas.push(rec(1, 100_000, dia));
      if (i < 40) debitos.push(deb(2, 100_000, dia, "despesa")); // pagamentos de obra (empreiteiro) no mesmo valor, outra conta
    }
    const p = prospecta(apurar({ receitas, debitos }));
    // receita real 4,8 mi (100% do teto): nada sai da soma
    expect(p.foraDaSoma.transferenciasCentavos).toBe(0);
    expect(p.receitaCentavos).toBe(4_800_000_00);
    expect(p.limites.find(l => l.chave === "teto_simples")!.faixa).toBe(100);
  });

  it("estorno: palavras do próprio banco tiram da soma (crédito que voltou)", () => {
    expect(ehEstorno("ESTORNO PIX")).toBe(true);
    expect(ehEstorno("Pix devolvido")).toBe(true);
    expect(ehEstorno("DEVOLUÇÃO TED")).toBe(true);
    expect(ehEstorno("Recebimento de cliente", "PIX RECEBIDO")).toBe(false);
  });

  // ACHADO A2 (médio): ehEstorno lê também a descrição da MOVIMENTAÇÃO do extrato (txDescricao), que inclui a mensagem escrita pelo PAGADOR
  // no PIX/TED. Texto livre de terceiro com "devolvido"/"devolução"/"reembolso de pix" tira um recebimento normal da receita.
  // shared/fiscal/regimes.ts:180-183 e :259-261 (sem conferir tipo do lançamento, categoria nem valor de uma saída anterior).
  it("A2: recebimento normal com a palavra 'devolvido' na mensagem do pagador continua na receita", () => {
    const a = apurar({ receitas: [rec(1, 50_000, "2026-11-10", { descricao: "Parcela 3 — contrato de obra", txDescricao: "PIX RECEBIDO JOAO - parcela 3 (cheque devolvido substituido)" })] });
    expect(prospecta(a).receitaCentavos).toBe(50_000_00);
  });

  it("reembolso entra na soma e aparece à parte; sem conta e sem empresa ficam como pendência, nunca numa empresa", () => {
    const a = apurar({
      perfis: [perfil(1, PROSPECTA, "simples_nacional", "2021-05-07")],
      contas: [contaP(1, PROSPECTA), contaP(2, null), contaP(3, "11222333000181")], // raiz sem perfil = sem empresa
      receitas: [rec(1, 1_000, "2026-11-10", { tipo: "reembolso" }), rec(2, 2_000, "2026-11-10"), rec(3, 3_000, "2026-11-10"), rec(null, 4_000, "2026-11-10"),
        rec(1, 9_999, "2026-11-10", { tipo: "despesa" }), rec(1, 8_888, "2026-11-10", { categoria: "Transferência interna" })],
    });
    // QA3 (Q1): o lançamento marcado como Transferência interna sem saída correspondente CONTA (e fica para conferir)
    expect(prospecta(a)).toMatchObject({ receitaCentavos: 1_000_00 + 8_888_00, reembolsosCentavos: 1_000_00, possiveisTransferencias: { centavos: 8_888_00, entradas: 1 } });
    expect(a.semEmpresa.receitaCentavos).toBe(5_000_00);
    expect(a.semEmpresa.contas.map(c => c.id).sort()).toEqual([2, 3]);
    expect(a.semConta).toEqual({ receitaCentavos: 4_000_00, lancamentos: 1 });
  });

  it("empresa = raiz: conta da filial soma no teto da matriz, mesmo sem perfil próprio da filial", () => {
    const a = apurar({ perfis: [perfil(1, EFFICAZ, "simples_nacional", "2010-01-01")], contas: [contaP(1, EFFICAZ), contaP(2, EFFICAZ_FILIAL)],
      receitas: [rec(1, 2_000_000, "2026-03-10"), rec(2, 2_000_000, "2026-04-10")] });
    const e = a.empresas.find(x => x.raiz === "04578232")!;
    expect(e.receitaCentavos).toBe(4_000_000_00);
    expect(e.limites.find(l => l.chave === "teto_simples")!.faixa).toBe(70);
    expect(e.estabelecimentos.map(x => x.cnpj)).toEqual([EFFICAZ, EFFICAZ_FILIAL]);
  });

  it("regime vigente na data: versão nova com início FUTURO (planejamento de 2027) não muda o limite de hoje", () => {
    const perfis = [perfil(1, PROSPECTA, "simples_nacional", "2021-05-07", false), perfil(2, PROSPECTA, "lucro_presumido", "2027-01-01", true)];
    expect(prospecta(apurar({ perfis })).regime).toBe("simples_nacional");
  });

  // ACHADO A3 (médio): perfilVigenteNaData ignora isActive (só desempate). Um perfil DESATIVADO pelo admin (tax.profiles.desativar — ex.:
  // cadastrado errado como Presumido em 01/03) continua vigente e vence a versão correta e ativa com início anterior (Simples desde 01/01):
  // o painel e o aviso usam o limite de R$ 78 mi em vez dos R$ 4,8 mi. shared/fiscal/regimes.ts:131-136.
  it("A3: perfil desativado (erro corrigido) não pode continuar valendo sobre a versão ativa", () => {
    const perfis = [perfil(1, PROSPECTA, "lucro_presumido", "2026-03-01", false), perfil(2, PROSPECTA, "simples_nacional", "2026-01-01", true)];
    expect(prospecta(apurar({ perfis })).regime).toBe("simples_nacional");
  });

  // ACHADO A4 (médio): o excesso de 20% do teto (R$ 5,76 mi — exclusão com efeito no mês seguinte, LC 123 art. 3º §9º-A) não é faixa própria:
  // passou de 100% do teto, nenhum aviso novo sai (FAIXAS_LIMITE termina em 100). O texto só menciona. shared/fiscal/regimes.ts:83-91 e :97.
  it("A4: passar de R$ 5,76 mi (teto + 20%) gera um aviso próprio, além do de 100% do teto", () => {
    const p = prospecta(apurar({ receitas: [rec(1, 5_800_000, "2026-06-10")] }));
    expect(p.limites.some(l => l.valorCentavos === 5_760_000_00 && l.faixa >= 100)).toBe(true);
  });
});

describe("QA S-6 — correções (regras puras)", () => {
  it("A3: troca de regime normal continua valendo (a versão anterior desativada pela nova vale até a nova começar)", () => {
    const perfis = [perfil(1, PROSPECTA, "simples_nacional", "2021-05-07", false), perfil(2, PROSPECTA, "lucro_presumido", "2026-07-01", true)];
    expect(prospecta(apurar({ perfis, agora: new Date("2026-05-10T15:00:00Z") })).regime).toBe("simples_nacional");
    expect(prospecta(apurar({ perfis })).regime).toBe("lucro_presumido");
    // só a versão desativada à mão, sem substituta: regime a confirmar (nunca o desativado)
    expect(prospecta(apurar({ perfis: [perfil(1, PROSPECTA, "lucro_presumido", "2026-03-01", false)] })).regime).toBe("a_confirmar");
  });

  it("A4: R$ 5,76 mi tem faixa só de 100% (não avisa a 70% dele); abaixo dele, nada", () => {
    const abaixo = prospecta(apurar({ receitas: [rec(1, 5_000_000, "2026-06-10")] })).limites.find(l => l.chave === "excesso_simples")!;
    expect(abaixo).toMatchObject({ faixa: 0, valorCentavos: 5_760_000_00 });
    expect(limitesDoRegime("simples_nacional").limites.map(l => l.chave)).not.toContain("excesso_simples");
    expect(limitesDoRegime("lucro_presumido").limites.map(l => l.chave)).toEqual(["presumido"]);
  });

  it("A6: créditos a classificar não somem — pendência por empresa, total geral listado e faixa 'possível' (lado seguro)", () => {
    const a = apurarReceitas({ agora: AGORA, perfis: [perfil(1, PROSPECTA, "simples_nacional", "2021-05-07")], contas: [contaP(1, PROSPECTA), contaP(2, null)],
      receitas: [rec(1, 3_000_000, "2026-03-10")], debitos: [],
      pendentes: [{ txId: 7, contaId: 1, valorCentavos: 1_000_000_00, data: new Date("2026-10-10T12:00:00Z") },
        { txId: 8, contaId: 2, valorCentavos: 50_00, data: new Date("2026-10-10T12:00:00Z") },
        { txId: 9, contaId: 1, valorCentavos: 99_00, data: new Date("2025-10-10T12:00:00Z") }] }); // outro ano: fora
    const p = prospecta(a);
    expect(p.receitaCentavos).toBe(3_000_000_00);
    expect(p.aClassificar).toEqual({ centavos: 1_000_000_00, movimentos: 1 });
    expect(p.receitaPossivelCentavos).toBe(4_000_000_00);
    const teto = p.limites.find(l => l.chave === "teto_simples")!;
    expect([teto.faixa, teto.faixaPossivel]).toEqual([0, 70]);
    expect(a.semEmpresa.aClassificarCentavos).toBe(50_00);
    expect(a.aClassificar).toMatchObject({ centavos: 1_000_050_00, movimentos: 2 });
    expect(a.aClassificar.maiores[0]).toEqual({ txId: 7, contaId: 1, raiz: "41865900", valorCentavos: 1_000_000_00, data: "2026-10-10", motivo: "a_classificar" });
  });

  it("A9: nome seguro da conta — apelido, ou banco + 4 últimos dígitos mascarados; nunca descrição nem número inteiro", () => {
    const a = apurar({ contas: [{ id: 1, banco: "Cora", apelido: null, descricao: "PJ conta 12345-6", conta: "12345-6", empresaCnpj: PROSPECTA, ativo: true }] });
    expect(prospecta(a).contas[0]!.nome).toBe("Cora •••3456");
  });
});

describe("QA S-6 — 4. Dolores (regras puras do aviso)", () => {
  it("limite_receita nasce silenciado (sem linha) e respeita a linha; sem reaviso na mesma faixa", () => {
    expect(TIPOS_AVISO).toContain("limite_receita");
    expect(SILENCIADOS_POR_PADRAO).toEqual(["nota_fiscal", "limite_receita"]); // junção com a S-3
    expect(silenciadoPelaLinha("limite_receita", undefined)).toBe(true);
    expect(silenciadoPelaLinha("limite_receita", null)).toBe(true);
    expect(silenciadoPelaLinha("limite_receita", { silenciado: false })).toBe(false);
    // os tipos antigos continuam NÃO silenciados por padrão (sem regressão)
    for (const t of TIPOS_AVISO.filter(x => x !== "limite_receita" && x !== "nota_fiscal")) expect(silenciadoPelaLinha(t, undefined), t).toBe(false);
    expect(TIPOS_SEM_REAVISO).toEqual(["limite_receita"]);
  });
});

// ── Com banco (PGlite) ───────────────────────────────────────────────────────────────────────────────────────────────────────
let pg: PGlite;
let fetchVigia: ReturnType<typeof vi.spyOn>;
const q = async <T = Record<string, unknown>>(texto: string, params: unknown[] = []) => (await pg.query<T>(texto, params)).rows;
const app = router({ bancario: bancarioRouter, fiscal: fiscalRouter, tax: taxRouter });
const caller = (role: string, permissoes: string[] = [], active = true) =>
  app.createCaller({ user: { id: role === "admin" ? 1 : 2, role, active, permissions: JSON.stringify(permissoes) }, req: { headers: {} }, res: {} } as never);
const admin = () => caller("admin");

describe("QA S-6 — com banco", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: AGORA });
    pg = new PGlite();
    await pg.exec(ddl);
    await pg.exec(M0154);
    await pg.exec(M0162);
    await pg.exec(M0167);
    await pg.exec(M0150);
    vi.mocked(getDb).mockReturnValue(drizzle(pg) as never);
    fetchVigia = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("rede proibida no teste"); });
    await pg.exec(`
      INSERT INTO users (id, "openId", name, role) VALUES (1, 'admin', 'Dono', 'admin'), (2, 'colab', 'Colaboradora', 'colaborador');
      INSERT INTO fiscal_config (id, ligado, inicio_em) VALUES (true, false, '2026-11-01');
      INSERT INTO tax_profiles (company_name, cnpj, regime, estimated_rate, effective_from, is_active) VALUES
        ('Prospecta', '41.865.900/0001-89', 'simples_nacional', 6, '2021-05-07', true),
        ('VFX Capital', '58.121.993/0001-00', 'lucro_real', 0, '2025-01-01', true),
        ('Efficaz', '04.578.232/0001-82', 'simples_nacional', 6, '2010-01-01', true);
    `);
  });
  afterEach(async () => {
    expect(fetchVigia).not.toHaveBeenCalled();
    fetchVigia.mockRestore();
    vi.useRealTimers();
    await pg.close();
  });
  const migrar = async () => { await pg.exec(M0164); };

  describe("1. migração 0164", () => {
    it("texto: só ADD COLUMN/ADD CONSTRAINT/CREATE INDEX IF NOT EXISTS e a troca do CHECK de tipo; nada de UPDATE/DELETE/INSERT/DROP de tabela ou coluna", () => {
      const sem = M0164.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
      expect(sem).not.toMatch(/\b(UPDATE|DELETE|INSERT|TRUNCATE)\b/i);
      expect(sem).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX|TYPE)/i);
      const drops = sem.match(/DROP\s+CONSTRAINT[^;]*/gi) ?? [];
      expect(drops).toEqual(['DROP CONSTRAINT IF EXISTS "dolores_avisos_tipos_tipo_check"']);
      expect(sem.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(2);
      expect(sem).toMatch(/BEGIN;[\s\S]*COMMIT;/);
    });

    it("linhas existentes de bank_accounts e dolores_avisos_tipos ficam idênticas; aplicar 3 vezes não muda nada", async () => {
      await pg.exec(`INSERT INTO bank_accounts (banco, conta, descricao) VALUES ('Cora', '123', 'PJ'), ('Inter', '456', NULL);
        INSERT INTO dolores_avisos_tipos (tipo, silenciado) VALUES ('obra_atrasada', true), ('tarefa_vencida', false), ('documento_pendente', true),
          ('nota_obra', true), ('regularizacao_parada', false), ('grupo_aguardando', true), ('integracao', true), ('gasto', false);`);
      const antesContas = await q("SELECT * FROM bank_accounts ORDER BY id");
      const antesTipos = await q("SELECT * FROM dolores_avisos_tipos ORDER BY tipo");
      await migrar(); await migrar(); await migrar();
      const depoisContas = await q<Record<string, unknown>>("SELECT * FROM bank_accounts ORDER BY id");
      expect(depoisContas.map(({ apelido: _a, empresa_cnpj: _e, ...resto }) => resto)).toEqual(antesContas);
      expect(depoisContas.every(c => c.apelido === null && c.empresa_cnpj === null)).toBe(true);
      expect(await q("SELECT * FROM dolores_avisos_tipos ORDER BY tipo")).toEqual(antesTipos);
      expect(await q("SELECT count(*)::int AS n FROM pg_constraint WHERE conname IN ('bank_accounts_empresa_cnpj_check', 'bank_accounts_apelido_check', 'dolores_avisos_tipos_tipo_check')"))
        .toEqual([{ n: 3 }]);
      expect(await q("SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'bank_accounts_empresa_cnpj_idx'")).toEqual([{ n: 1 }]);
    });

    it("CHECK novo de tipo = lista completa: os 8 de antes + nota_fiscal + limite_receita; recusa o resto", async () => {
      await migrar();
      for (const t of ["obra_atrasada", "tarefa_vencida", "documento_pendente", "nota_obra", "regularizacao_parada", "grupo_aguardando", "integracao", "gasto", "nota_fiscal", "limite_receita"]) {
        await pg.query("INSERT INTO dolores_avisos_tipos (tipo, silenciado) VALUES ($1, true)", [t]);
      }
      await expect(pg.query("INSERT INTO dolores_avisos_tipos (tipo) VALUES ('qualquer')")).rejects.toThrow();
      const def = (await q<{ d: string }>("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'dolores_avisos_tipos_tipo_check'"))[0]!.d;
      for (const t of TIPOS_AVISO) expect(def).toContain(`'${t}'`);
    });

    it("CHECK de CNPJ aceita só 14 caracteres limpos (aceita o alfanumérico) e apelido não pode ser só espaço", async () => {
      await migrar();
      await pg.query("INSERT INTO bank_accounts (banco, conta, empresa_cnpj, apelido) VALUES ('X', '1', '12ABC34501DE35', 'ok')");
      for (const v of ["4186590000018", "41865900000189X", "41.865.900/0001", "41865900000lAB"]) {
        await expect(pg.query("INSERT INTO bank_accounts (banco, conta, empresa_cnpj) VALUES ('X', '2', $1)", [v]), v).rejects.toThrow();
      }
      await expect(pg.query("INSERT INTO bank_accounts (banco, conta, apelido) VALUES ('X', '3', '   ')")).rejects.toThrow();
    });

    // ACHADO A10 (baixo): o CHECK do apelido usa btrim() (só espaço): apelido só com TAB/quebra de linha passa no banco. Pela API o zod
    // .trim() já limpa, então só vale para gravação direta. drizzle/0164_contas_empresa_limite_receita.sql:33.
    it("A10: apelido só com TAB/quebra de linha é recusado pelo banco", async () => {
      await migrar();
      await expect(pg.query("INSERT INTO bank_accounts (banco, conta, apelido) VALUES ('X', '3', E'\\t\\n')")).rejects.toThrow();
    });
  });

  describe("2. permissões e IDOR", () => {
    beforeEach(migrar);
    const contaManual = async (banco: string, numero: string, extra: { apelido?: string | null; empresaCnpj?: string | null } = {}) =>
      (await admin().bancario.contas.create({ provedor: "manual", banco, conta: numero, descricao: "Conta PJ", ...extra })).id;

    it("bancario.* não tem módulo para colaborador (só admin), qualquer combinação de módulos; inativo recusado até admin", () => {
      const todos = JSON.stringify(["bpo", "crm", "financeiro", "obras", "fiscal", "contabilidade", "admin", "usuarios", "integracoes"]);
      for (const path of ["bancario.contas.update", "bancario.contas.create", "bancario.contas.empresas", "bancario.contas.list"]) {
        expect(canAccessAdminProcedure({ role: "admin", permissions: null }, path), path).toBe(true);
        expect(canAccessAdminProcedure({ role: "admin", permissions: null, active: false }, path), path).toBe(false);
        expect(canAccessAdminProcedure({ role: "colaborador", permissions: todos }, path), path).toBe(false);
        for (const role of ["corretor", "cliente", "empreiteiro", "parceiro", ""]) expect(canAccessAdminProcedure({ role, permissions: todos }, path), `${role} ${path}`).toBe(false);
      }
      expect(canAccessAdminProcedure({ role: "colaborador", permissions: JSON.stringify(["bpo"]) }, "fiscal.limitesReceita")).toBe(true);
      expect(canAccessAdminProcedure({ role: "colaborador", permissions: JSON.stringify(["bpo"]), active: false }, "fiscal.limitesReceita")).toBe(false);
      for (const role of ["corretor", "cliente"]) expect(canAccessAdminProcedure({ role, permissions: JSON.stringify(["bpo"]) }, "fiscal.limitesReceita")).toBe(false);
    });

    it("empreiteiro e admin inativo recusados no tRPC (limites e edição de conta)", async () => {
      const id = await contaManual("Cora", "1");
      for (const c of [caller("empreiteiro"), caller("admin", [], false)]) {
        await expect(c.fiscal.limitesReceita()).rejects.toThrow();
        await expect(c.bancario.contas.update({ id, apelido: "x", empresaCnpj: PROSPECTA })).rejects.toThrow();
      }
      expect((await q<any>("SELECT apelido, empresa_cnpj FROM bank_accounts WHERE id = $1", [id]))[0]).toEqual({ apelido: null, empresa_cnpj: null });
    });

    it("conta inexistente: NOT_FOUND e nada gravado; estabelecimento com complemento fiscal DESATIVADO não é aceito", async () => {
      await expect(admin().bancario.contas.update({ id: 9_999, apelido: "x" })).rejects.toThrow(/não encontrada/);
      await admin().fiscal.emissores.salvar({ cnpj: EFFICAZ_FILIAL, municipioNome: "Canaã dos Carajás", municipioUf: "PA" });
      await pg.exec(`UPDATE fiscal_emissores SET ativo = false WHERE cnpj = '${EFFICAZ_FILIAL}'`);
      await expect(contaManual("Sicoob", "7", { empresaCnpj: EFFICAZ_FILIAL })).rejects.toThrow(/perfil tributário/);
      // CNPJ com pontuação/minúscula é normalizado, nunca gravado cru
      const id = await contaManual("Cora", "8", { empresaCnpj: " 41.865.900/0001-89 " });
      expect((await q<any>("SELECT empresa_cnpj FROM bank_accounts WHERE id = $1", [id]))[0].empresa_cnpj).toBe(PROSPECTA);
      await expect(contaManual("Cora", "9", { empresaCnpj: "' OR 1=1 --" })).rejects.toThrow(/inválido/);
    });

    it("limites (tela): a resposta não leva a agência; o final da conta vem mascarado", async () => {
      const id = await contaManual("Cora", "12345-6", { empresaCnpj: PROSPECTA });
      await pg.exec(`UPDATE bank_accounts SET agencia = '0001-9' WHERE id = ${id}`);
      const r = await caller("colaborador", ["bpo"]).fiscal.limitesReceita();
      expect(JSON.stringify(r)).not.toMatch(/0001-9|agencia/);
      expect(r.empresas.find(e => e.raiz === "41865900")!.contas[0]!.final).toBe("•••3456");
    });

    // ACHADO A9 (IMPORTANTE — segurança/Dolores): sem apelido, nomeDaConta() devolve "banco — descrição • NÚMERO COMPLETO DA CONTA"
    // (shared/fiscal/regimes.ts:166-170), e a leitura consultar_limites_receita manda esse nome à IA e ao WhatsApp
    // (server/dolores/leitura/limites-receita.ts:28 `contas: e.contas.map(c => c.nome)` e :36 `contasSemEmpresa`). Regra do dono (16/11):
    // dados bancários continuam SEMPRE mascarados para a Dolores. O comentário da própria leitura promete "nunca agência, número".
    // Hoje toda conta já existente nasce sem apelido (0164), então o vazamento é o caso PADRÃO.
    it("A9: o nome de conta que vai para a Dolores nunca leva o número da conta", async () => {
      await contaManual("Cora", "12345-6", { empresaCnpj: PROSPECTA });
      await contaManual("Inter", "998877-1"); // sem empresa: vai em pendencias.contasSemEmpresa
      const r = await apurarLimites(getDb() as never, AGORA);
      const nomes = [...r.empresas.flatMap(e => e.contas.map(c => c.nome)), ...r.semEmpresa.contas.map(c => c.nome)];
      // o mesmo filtro que a ponte aplica a TODA leitura antes de ir à IA (ponte.ts:311, filtroDaSaida("whatsapp"))
      const paraDolores = sanitizarResposta({ contas: nomes }, { mascararDadosPessoais: false });
      expect(JSON.stringify(paraDolores)).not.toMatch(/12345|998877/);
      // e o que a leitura consultar_limites_receita devolve de fato (texto que vai à IA e ao WhatsApp)
      const leitura = JSON.stringify((await consultarLimitesReceita({}, { agora: AGORA })).dados);
      expect(leitura).not.toMatch(/12345|998877|0001-9/);
      expect(leitura).toMatch(/Cora •••3456/);
    });

    // ACHADO A5 (médio; permissão anterior à S-6, AMPLIADA por ela): colaborador com BPO cria versão nova do perfil tributário
    // (tax.profiles.create é adminProcedure com tax → "bpo", sem conferir o papel), e agora o regime decide o limite e o aviso: trocar a
    // Prospecta para "lucro_real" ou "a_confirmar" apaga o teto do Simples do painel e silencia o aviso. server/tax-router.ts:255-266
    // (o desativar, ao lado, já exige admin por papel: :308).
    it("A5: colaborador com BPO não pode trocar o regime da empresa (isso esconde o limite de receita)", async () => {
      await expect(caller("colaborador", ["bpo"]).tax.profiles.create({ companyName: "Prospecta", cnpj: PROSPECTA, regime: "lucro_real", estimatedRate: 0,
        effectiveFrom: new Date("2026-11-01T12:00:00Z") })).rejects.toThrow();
    });
  });

  describe("3. cálculo com a leitura do banco (teto.ts)", () => {
    beforeEach(migrar);
    let tx = 0;
    async function conta(cnpj: string | null) {
      const [c] = await q<{ id: number }>("INSERT INTO bank_accounts (banco, conta, empresa_cnpj) VALUES ('Cora', '999', $1) RETURNING id", [cnpj]);
      return c!.id;
    }
    async function credito(contaId: number, reais: number, quando: string, lanc: { aClassificar?: boolean } | null = {}) {
      const [t] = await q<{ id: number }>(`INSERT INTO bank_transactions (account_id, data, descricao, valor, tipo, external_id) VALUES ($1, $2, 'PIX RECEBIDO', $3, 'credito', $4) RETURNING id`,
        [contaId, quando, reais, `qa-${++tx}`]);
      if (lanc) await q(`INSERT INTO bpo_lancamentos (tipo, descricao, valor, vencimento, pago, pago_em, competencia, bank_transaction_id, a_classificar)
        VALUES ('receita', 'Recebimento', $1, $2, true, $2, $3, $4, $5)`, [reais, quando, quando.slice(0, 7), t!.id, lanc.aClassificar ?? false]);
    }

    // ACHADO A6 (médio): entrada importada do extrato e ainda "a classificar" (ou crédito sem lançamento) numa conta da empresa não entra na
    // soma e não aparece em pendência nenhuma: a receita some do painel e do aviso até alguém classificar. server/fiscal/teto.ts:46-49
    // (l.a_classificar = false). Lado seguro: somar (ou ao menos mostrar como pendência com o valor).
    it("A6: crédito 'a classificar' na conta da empresa aparece na soma ou como pendência com valor", async () => {
      const c = await conta(PROSPECTA);
      await credito(c, 3_000_000, "2026-10-10T12:00:00Z", { aClassificar: true });
      await credito(c, 1_000_000, "2026-10-11T12:00:00Z", null);
      const r = await apurarLimites(getDb() as never, AGORA);
      const pro = r.empresas.find(e => e.raiz === "41865900")!;
      expect(pro.receitaCentavos > 0 || /3\.?000\.?000|300000000/.test(JSON.stringify({ ...r, empresas: [] }))).toBe(true);
    });

    it("ano em Brasília: recebimento às 23h de 31/12 (Brasília) entra no ano que termina", async () => {
      const c = await conta(PROSPECTA);
      await credito(c, 1_000, "2026-12-31T12:00:00Z");
      const r = await apurarLimites(getDb() as never, new Date("2026-12-31T20:00:00Z"));
      expect(r.ano).toBe(2026);
      expect(r.empresas.find(e => e.raiz === "41865900")!.receitaCentavos).toBe(1_000_00);
    });

    it("fuso no corte do ano: 22h de 31/12 em Brasília (01h UTC do dia 1º) é do ano que termina; 23h de 31/12/2025 não é de 2026", async () => {
      expect(inicioDoAnoEmBrasilia(2026)).toBe("2026-01-01 03:00:00.000");
      const c = await conta(PROSPECTA);
      await credito(c, 1_000, "2027-01-01T01:00:00Z"); // 31/12/2026 22h em Brasília → 2026
      await credito(c, 2_000, "2026-01-01T02:00:00Z"); // 31/12/2025 23h em Brasília → fora de 2026
      await credito(c, 3_000, "2026-01-01T03:00:00Z"); // 01/01/2026 00h em Brasília → 2026
      const r = await apurarLimites(getDb() as never, new Date("2026-12-31T20:00:00Z"));
      expect(r.empresas.find(e => e.raiz === "41865900")!.receitaCentavos).toBe(4_000_00);
    });

    it("A1 com o banco: saída com lançamento de despesa não casa; saída marcada como Transferência interna casa", async () => {
      const c1 = await conta(PROSPECTA);
      const c2 = await conta(PROSPECTA);
      await credito(c1, 10_000, "2026-10-10T12:00:00Z");
      // QA3 (Q1/Q2): transferência real tem a ENTRADA marcada também (sem lançamento)
      await q(`INSERT INTO bank_transactions (account_id, data, descricao, valor, tipo, external_id, categoria) VALUES ($1, '2026-10-12T12:00:00Z', 'TED ENTRE CONTAS', 20000, 'credito', 'qa-c2', 'Transferência interna')`, [c1]);
      const [d1] = await q<{ id: number }>(`INSERT INTO bank_transactions (account_id, data, descricao, valor, tipo, external_id) VALUES ($1, '2026-10-11T12:00:00Z', 'PIX ENVIADO EMPREITEIRO', 10000, 'debito', 'qa-d1') RETURNING id`, [c2]);
      await q(`INSERT INTO bpo_lancamentos (tipo, descricao, valor, vencimento, pago, pago_em, competencia, bank_transaction_id) VALUES ('despesa', 'Mão de obra', 10000, '2026-10-11', true, '2026-10-11', '2026-10', $1)`, [d1!.id]);
      await q(`INSERT INTO bank_transactions (account_id, data, descricao, valor, tipo, external_id, categoria) VALUES ($1, '2026-10-12T12:00:00Z', 'TED ENTRE CONTAS', 20000, 'debito', 'qa-d2', 'Transferência interna')`, [c2]);
      const pro = (await apurarLimites(getDb() as never, AGORA)).empresas.find(e => e.raiz === "41865900")!;
      expect(pro.receitaCentavos).toBe(10_000_00);
      expect(pro.foraDaSoma).toMatchObject({ transferencias: 1, transferenciasCentavos: 20_000_00 });
    });

    it("A6 com o banco: a classificar e sem lançamento entram na pendência da empresa; marcada como Transferência interna não", async () => {
      const c = await conta(PROSPECTA);
      await credito(c, 3_000_000, "2026-10-10T12:00:00Z", { aClassificar: true });
      await credito(c, 1_000_000, "2026-10-11T12:00:00Z", null);
      await q(`INSERT INTO bank_transactions (account_id, data, descricao, valor, tipo, external_id, categoria) VALUES ($1, '2026-10-12T12:00:00Z', 'TED', 500, 'credito', 'qa-tr', 'Transferência interna')`, [c]);
      const pro = (await apurarLimites(getDb() as never, AGORA)).empresas.find(e => e.raiz === "41865900")!;
      expect(pro.aClassificar).toEqual({ centavos: 4_000_000_00, movimentos: 2 });
      expect(pro.limites.find(l => l.chave === "teto_simples")!.faixaPossivel).toBe(70);
    });

    it("Receita realizada do Financeiro (financial_transactions) aparece como pendência com valor (sem conta, sem empresa)", async () => {
      await q(`INSERT INTO financial_transactions (type, amount, description, status, paid_at) VALUES
        ('income', 1500, 'Entrada', 'paid', '2026-05-10T12:00:00Z'), ('commission', 500, 'Comissão', 'paid', '2026-06-10T12:00:00Z'),
        ('expense', 900, 'Saída', 'paid', '2026-06-10T12:00:00Z'), ('income', 700, 'Pendente', 'pending', '2026-06-10T12:00:00Z'),
        ('income', 800, 'Ano passado', 'paid', '2025-06-10T12:00:00Z')`);
      const r = await apurarLimites(getDb() as never, AGORA);
      expect(r.financeiro).toEqual({ receitaCentavos: 2_000_00, lancamentos: 2 });
      const d = (await consultarLimitesReceita({}, { agora: AGORA })).dados as { pendencias: Record<string, unknown> };
      expect(d.pendencias).toMatchObject({ receitaDoFinanceiroSemEmpresa: "R$\u00a02.000,00", lancamentosDoFinanceiro: 2 });
    });
  });

  describe("5. gerador e emissor", () => {
    beforeEach(migrar);
    let tx = 0;
    async function entradaNaConta(contaId: number, reais: number) {
      const [t] = await q<{ id: number }>(`INSERT INTO bank_transactions (account_id, data, descricao, valor, tipo, external_id) VALUES ($1, '2026-11-10T12:00:00Z', 'PIX', $2, 'credito', $3) RETURNING id`,
        [contaId, reais, `g-${++tx}`]);
      const [l] = await q<{ id: number }>(`INSERT INTO bpo_lancamentos (tipo, descricao, valor, vencimento, pago, pago_em, competencia, bank_transaction_id)
        VALUES ('honorario', 'Honorário', $1, '2026-11-10T12:00:00Z', true, '2026-11-10T12:00:00Z', '2026-11', $2) RETURNING id`, [reais, t!.id]);
      return l!.id;
    }
    const contaDe = async (cnpj: string) => (await admin().bancario.contas.create({ provedor: "manual", banco: "Cora", conta: "1", empresaCnpj: cnpj })).id;

    it("a conta vence o tipo de serviço: tipo apontando para a VFX não leva a nota da conta da Prospecta para a VFX", async () => {
      await admin().fiscal.emissores.salvar({ cnpj: PROSPECTA, municipioNome: "Imperatriz", municipioUf: "MA" });
      await admin().fiscal.emissores.salvar({ cnpj: VFX, municipioNome: "Imperatriz", municipioUf: "MA" });
      const [emP, emV] = await q<{ id: number }>("SELECT id FROM fiscal_emissores ORDER BY id");
      await q("INSERT INTO fiscal_tipos_servico (nome, emissor_id, origens) VALUES ('Honorário', $1, '[\"bpo_lancamento:honorario\"]'::jsonb)", [emV!.id]);
      const l = await entradaNaConta(await contaDe(PROSPECTA), 900);
      await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
      const [n] = await q<{ origem_id: number; emissor_id: number }>("SELECT origem_id, emissor_id FROM fiscal_notas");
      expect(n).toEqual({ origem_id: l, emissor_id: emP!.id });
    });

    // ACHADO A7 (médio): conta da Prospecta SEM complemento fiscal da Prospecta → cai no emissor do tipo de serviço ou no emissor ÚNICO, que
    // pode ser de OUTRA raiz (VFX). O dinheiro entrou na conta da Prospecta e o rascunho nasce pela VFX. Com a empresa da conta conhecida,
    // emissor de outra raiz não deveria ser escolhido (fica "a escolher"). server/fiscal/gerador.ts:265.
    it("A7: com a empresa da conta conhecida, o rascunho nunca nasce com emissor de outra raiz de CNPJ", async () => {
      await admin().fiscal.emissores.salvar({ cnpj: VFX, municipioNome: "Imperatriz", municipioUf: "MA" }); // único emissor
      await entradaNaConta(await contaDe(PROSPECTA), 900);
      await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
      const [n] = await q<{ emissor_id: number | null; cnpj: string | null }>("SELECT n.emissor_id, e.cnpj FROM fiscal_notas n LEFT JOIN fiscal_emissores e ON e.id = n.emissor_id");
      expect(n!.cnpj === null || n!.cnpj.slice(0, 8) === PROSPECTA.slice(0, 8)).toBe(true);
      // sem emissor, com o motivo claro na tela
      const nota = (await admin().fiscal.notas.listar({})).itens[0]!;
      expect(nota.motivoSemEmissor).toMatch(/41\.865\.900\/0001-89.*não tem dados fiscais/);
    });

    // ACHADO A8 (médio, para a S-4): EmissorLido.regime/optanteSimples vem do perfil ATIVO mais recente (notas.ts:156-166), e não do VIGENTE
    // na data. Ao cadastrar hoje a versão de 2027 (Presumido a partir de 01/01/2027 — exatamente o estudo "qual regime adotar em 2027"),
    // a nota de novembro/2026 sairia como "não optante" enquanto o painel de limites (vigente) continua dizendo Simples. Incoerente.
    it("A8: optanteSimples do emissor segue o regime VIGENTE hoje (igual ao painel de limites)", async () => {
      await admin().fiscal.emissores.salvar({ cnpj: PROSPECTA, municipioNome: "Imperatriz", municipioUf: "MA" });
      await admin().tax.profiles.create({ companyName: "Prospecta", cnpj: PROSPECTA, regime: "lucro_presumido", estimatedRate: 11.33, effectiveFrom: new Date("2027-01-01T12:00:00Z") });
      const painel = (await admin().fiscal.limitesReceita()).empresas.find(e => e.raiz === "41865900")!;
      expect(painel.regime).toBe("simples_nacional");
      const em = (await emissoresComPerfil(getDb())).find(e => e.cnpj === PROSPECTA)!;
      expect(em.optanteSimples).toBe(true);
    });

    it("filial herda o regime da MATRIZ da mesma raiz, nunca de outra raiz", async () => {
      await admin().fiscal.emissores.salvar({ cnpj: EFFICAZ_FILIAL, municipioNome: "Canaã dos Carajás", municipioUf: "PA" });
      const em = (await emissoresComPerfil(getDb())).find(e => e.cnpj === EFFICAZ_FILIAL)!;
      expect(em).toMatchObject({ razaoSocial: "Efficaz", regime: "simples_nacional", optanteSimples: true });
      // emissor de raiz SEM perfil não nasce (o salvar exige perfil da mesma raiz)
      await expect(admin().fiscal.emissores.salvar({ cnpj: "11222333000181", municipioNome: "Xis", municipioUf: "MA" })).rejects.toThrow(/perfil tributário/);
    });
  });
});
