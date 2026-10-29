// Lote 3 (29/10/2026) — BPO itens 12, 13B, 15, 16 e 17. Regras puras + banco em memória (PGlite).
// Nenhum teste chama serviço externo.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", async orig => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste" } }));

import { getDb } from "./db.js";
import { bpoRouter, categoriaNaEdicao } from "./bpo-router.js";
import { previaVinculosEmMassa, sugestoesDoLancamento, vincularLancamentoACliente } from "./bpo-vinculo-cliente.js";
import { combinarPagamentos, excluirLancamentosEmLote, previaExclusaoLote } from "./bpo-lote.js";
import { categoriaContabilDaOperacional, validarDetalhesOperacionais } from "../shared/financeiro/bpo-operacional.js";
import { montarCandidatos, normalizarTelefone, similaridadeNome, sugerirClientesParaLancamento } from "../shared/financeiro/bpo-vinculo-cliente.js";
import { confirmacaoExclusaoValida, filtrarLancamentosLote, motivosProtecao, validarCombinacao } from "../shared/financeiro/bpo-lote.js";
import { competenciaNoFiltro, dreDasCategorias, dreDosLancamentos, filtrarPorCompetencia } from "../shared/financeiro/bpo-extrato.js";

describe("item 12 — categoria contábil derivada da Categoria Operacional", () => {
  it("mapeia as categorias novas e as de obra/cobrança para o enum existente", () => {
    expect(categoriaContabilDaOperacional("despesa", "impostos")).toBe("Impostos");
    expect(categoriaContabilDaOperacional("despesa", "tarifas_bancarias")).toBe("Tarifas bancárias");
    expect(categoriaContabilDaOperacional("despesa", "pro_labore")).toBe("Pró-labore");
    expect(categoriaContabilDaOperacional("despesa", "administrativo")).toBe("Administrativo");
    expect(categoriaContabilDaOperacional("cobranca", "projetos_taxas")).toBe("Projetos e taxas");
    expect(categoriaContabilDaOperacional("cobranca", "outros")).toBe("Outros");
    expect(categoriaContabilDaOperacional("despesa", "obras", "material")).toBe("Material");
    expect(categoriaContabilDaOperacional("despesa", "obras", "mao_de_obra")).toBe("Mão de obra");
    expect(categoriaContabilDaOperacional("despesa", "obras", "Mão de obra")).toBe("Mão de obra");
    expect(categoriaContabilDaOperacional("despesa", "obras", "empreiteiro")).toBe("Mão de obra");
    expect(categoriaContabilDaOperacional("despesa", "obras", "terreno")).toBe("Outros");
    expect(categoriaContabilDaOperacional("cobranca", "obras")).toBe("Recebimento de cliente");
    expect(categoriaContabilDaOperacional("cobranca", "financiamentos")).toBe("Financiamento/CAIXA");
    expect(categoriaContabilDaOperacional("despesa", "regularizacoes")).toBe("Outros");
  });

  it("novas categorias não exigem (nem aceitam) vínculo; as antigas continuam exigindo", () => {
    for (const c of ["projetos_taxas", "impostos", "tarifas_bancarias", "pro_labore", "administrativo", "outros"]) {
      expect(() => validarDetalhesOperacionais({ tipo: "despesa", categoriaOperacional: c })).not.toThrow();
      expect(() => validarDetalhesOperacionais({ tipo: "cobranca", categoriaOperacional: c })).not.toThrow();
      expect(() => validarDetalhesOperacionais({ tipo: "despesa", categoriaOperacional: c, vinculoOperacionalId: "1" })).toThrow();
    }
    expect(() => validarDetalhesOperacionais({ tipo: "despesa", categoriaOperacional: "regularizacoes" })).toThrow(/registro operacional/);
    for (const proibida of ["recebimento_cliente", "financiamento_caixa", "material", "mao_de_obra"]) {
      expect(() => validarDetalhesOperacionais({ tipo: "despesa", categoriaOperacional: proibida })).toThrow(/inválida/);
    }
  });

  it("edição preserva a categoria gravada e só recalcula quando a operacional muda", () => {
    const antes = { categoria: "Tarifas bancárias", categoriaOperacional: null, tipoDespesaObra: null };
    expect(categoriaNaEdicao("despesa", antes, { categoriaOperacional: null })).toBe("Tarifas bancárias");
    expect(categoriaNaEdicao("despesa", antes, { categoriaOperacional: "impostos" })).toBe("Impostos");
    const obra = { categoria: "Material", categoriaOperacional: "obras", tipoDespesaObra: "material" };
    expect(categoriaNaEdicao("despesa", obra, { categoriaOperacional: "obras", tipoDespesaObra: "material" })).toBe("Material");
    expect(categoriaNaEdicao("despesa", obra, { categoriaOperacional: "obras", tipoDespesaObra: "mao_de_obra" })).toBe("Mão de obra");
  });
});

describe("item 17 — sugestão de vínculo (regra pura)", () => {
  const candidatos = montarCandidatos(
    [{ id: 1, razaoSocial: "Maria Souza", cpf: "123.456.789-00", telefone: "(91) 98888-7777", leadId: 10 }, { id: 2, razaoSocial: "Fornecedor X", cnpj: "11.222.333/0001-44", telefone: "" }],
    [{ id: 10, nome: "Maria Souza", cpf: "12345678900", telefone: "91988887777" }, { id: 11, nome: "João Lima", telefone: "+55 91 3222-1111" }, { id: 12, nome: "Joao Lima", telefone: "91 3222-1111" }],
  );

  it("normaliza telefone e similaridade de nome", () => {
    expect(normalizarTelefone("+55 (91) 98888-7777")).toBe("91988887777");
    expect(normalizarTelefone("123")).toBe("");
    expect(similaridadeNome("José da Silva", "Jose Silva")).toBe(1);
    expect(similaridadeNome("Maria Souza", "Mario Sousa")).toBeLessThan(0.9);
  });

  it("vínculo automático só com exatamente um candidato forte (CPF único)", () => {
    const r = sugerirClientesParaLancamento({ nome: "Maria S.", textos: ["Pix Maria 123.456.789-00"] }, candidatos);
    expect(r.automatico?.candidato).toMatchObject({ chave: "l:10", clienteId: "1" });
    expect(r.automatico?.motivos).toContain("documento");
  });

  it("ID interno (lead do registro operacional) tem prioridade máxima", () => {
    const r = sugerirClientesParaLancamento({ leadIds: ["11"], nome: "Maria Souza" }, candidatos);
    expect(r.sugestoes[0]).toMatchObject({ prioridade: 1, grau: "forte" });
    expect(r.automatico?.candidato.leadId).toBe("11");
  });

  it("telefone em dois leads é ambíguo: nada automático", () => {
    const r = sugerirClientesParaLancamento({ nome: "Cliente", textos: ["(91) 3222-1111"] }, candidatos);
    expect(r.sugestoes.filter(s => s.grau === "forte")).toHaveLength(2);
    expect(r.automatico).toBeNull();
    expect(r.ambiguo).toBe(true);
  });

  it("nome parecido sozinho nunca vincula automaticamente", () => {
    const r = sugerirClientesParaLancamento({ nome: "MARIA SOUZA" }, candidatos);
    expect(r.sugestoes[0]).toMatchObject({ grau: "media", motivos: ["nome"] });
    expect(r.automatico).toBeNull();
  });
});

describe("itens 13B e 16 — confirmação, proteção, filtros e combinação (regras puras)", () => {
  it("EXCLUIR é case-sensitive e sem acento", () => {
    expect(confirmacaoExclusaoValida("EXCLUIR")).toBe(true);
    expect(confirmacaoExclusaoValida(" EXCLUIR ")).toBe(true);
    for (const x of ["excluir", "Excluir", "EXCLUÍR", "", null]) expect(confirmacaoExclusaoValida(x)).toBe(false);
  });

  it("protegidos: Asaas, extrato, baixa, obra, regularização e combinação", () => {
    expect(motivosProtecao({})).toEqual([]);
    expect(motivosProtecao({ asaasPaymentId: "pay", transacaoBancaria: 3, valorRecebido: "10", movimentosObra: 1, recebimentosRegularizacao: 1, combinadaEmId: 9 }))
      .toEqual(["asaas", "extrato", "baixa", "obra", "regularizacao", "combinada"]);
    expect(motivosProtecao({ pago: true })).toEqual(["baixa"]);
  });

  it("filtros da aba aplicados no servidor (mês, ano, status, busca)", () => {
    const agora = new Date("2026-10-15T12:00:00Z");
    const base = { tipo: "honorario", clienteId: 1, clienteNome: "Ana", descricao: "Honorário", pago: false, valorRecebido: 0 };
    const itens = [
      { ...base, id: 1, competencia: "2026-09", vencimento: "2026-09-10" },
      { ...base, id: 2, competencia: "2026-10", vencimento: "2026-10-30" },
      { ...base, id: 3, competencia: "2026-10", vencimento: "2026-10-01", pago: true },
    ];
    expect(filtrarLancamentosLote(itens, { mes: "10", ano: "2026" }, agora).map(i => i.id)).toEqual([2, 3]);
    expect(filtrarLancamentosLote(itens, { status: "vencidas" }, agora).map(i => i.id)).toEqual([1]);
    expect(filtrarLancamentosLote(itens, { status: "pendentes" }, agora).map(i => i.id)).toEqual([2]);
    expect(filtrarLancamentosLote(itens, { busca: "bia" }, agora)).toEqual([]);
  });

  it("combinação válida soma em centavos, vence no mais próximo e lista as originais", () => {
    const base = { tipo: "receita", clienteId: 5, pago: false, competencia: "2026-10", categoria: "Recebimento de cliente" };
    const r = validarCombinacao([
      { ...base, id: 1, descricao: "Parcela A", valor: "100.10", vencimento: "2026-11-10" },
      { ...base, id: 2, descricao: "Parcela B", valor: "200.20", vencimento: "2026-10-20", competencia: "2026-09" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.total).toBe(300.3);
    expect(r.vencimento.toISOString().slice(0, 10)).toBe("2026-10-20");
    expect(r.competencia).toBe("2026-09");
    expect(r.descricao).toMatch(/#2 Parcela B.*#1 Parcela A/);
    expect(r.categoria).toBe("Recebimento de cliente");
  });

  it("combinação bloqueada: clientes diferentes, Asaas, extrato ou já paga", () => {
    const base = { tipo: "receita", clienteId: 5, pago: false, competencia: "2026-10", descricao: "x", valor: 1, vencimento: "2026-10-10" };
    const r = validarCombinacao([{ ...base, id: 1 }, { ...base, id: 2, clienteId: 6, asaasPaymentId: "pay_1" }, { ...base, id: 3, transacaoBancaria: 9 }, { ...base, id: 4, pago: true }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros).toContain("As cobranças precisam ser do mesmo cliente.");
    expect(r.bloqueados.map(b => b.id)).toEqual([2, 3, 4]);
    expect(validarCombinacao([{ ...base, id: 1 }]).ok).toBe(false);
  });
});

describe("item 15 — filtro Mês/Ano do DRE", () => {
  const lancs = [
    { competencia: "2026-09", tipo: "receita", valor: "100", categoria: "Recebimento de cliente" },
    { competencia: "2026-10", tipo: "receita", valor: "50.25", categoria: "Recebimento de cliente" },
    { competencia: "2026-10", tipo: "despesa", valor: "20", categoria: "Impostos" },
    { competencia: "2025-10", tipo: "despesa", valor: "7", categoria: "Outros" },
  ];
  it("filtra por competência nas duas visões; vazio = todos", () => {
    expect(competenciaNoFiltro("2026-10", { mes: "10" })).toBe(true);
    expect(competenciaNoFiltro("2026-10", { ano: "2025" })).toBe(false);
    expect(dreDosLancamentos(filtrarPorCompetencia(lancs, {}))).toHaveLength(3);
    expect(dreDosLancamentos(filtrarPorCompetencia(lancs, { mes: "10", ano: "2026" }))).toEqual([{ competencia: "2026-10", cobrancas: 50.25, despesas: 20, resultado: 30.25 }]);
    expect(dreDosLancamentos(filtrarPorCompetencia(lancs, { mes: "10" })).map(l => l.competencia)).toEqual(["2026-10", "2025-10"]);
    expect(dreDasCategorias(filtrarPorCompetencia(lancs, { ano: "2026" })).map(c => [c.categoria, c.resultado])).toEqual([["Recebimento de cliente", 150.25], ["Impostos", -20]]);
  });
});

// ── Banco em memória ─────────────────────────────────────────────────────────
const sqlDe = (arquivo: string) => readFileSync(new URL(`../drizzle/${arquivo}`, import.meta.url), "utf8");
const BASE = `
  CREATE TYPE bpo_client_status AS ENUM ('ativo','pausado','encerrado');
  CREATE TYPE bpo_lancamento_tipo AS ENUM ('honorario','despesa','reembolso');
  CREATE TYPE bank_transaction_tipo AS ENUM ('credito','debito');
  CREATE TYPE bank_transaction_status AS ENUM ('pendente','conciliado','ignorado');
  CREATE TABLE leads (id serial PRIMARY KEY, name varchar(255) NOT NULL, phone varchar(20) NOT NULL, email varchar(320), cpf varchar(14), deleted_at timestamp);
  CREATE TABLE users (id serial PRIMARY KEY);
  CREATE TABLE bpo_clients (
    id serial PRIMARY KEY, razao_social varchar(255) NOT NULL, cnpj varchar(20), cpf varchar(14),
    responsavel varchar(255) NOT NULL, email varchar(255), telefone varchar(20) NOT NULL,
    servicos text DEFAULT '[]' NOT NULL, status bpo_client_status DEFAULT 'ativo' NOT NULL,
    honorarios numeric(15,2) NOT NULL, dia_vencimento integer DEFAULT 10 NOT NULL, data_inicio timestamp NOT NULL,
    observacoes text DEFAULT '' NOT NULL, created_at timestamp DEFAULT now() NOT NULL, updated_at timestamp DEFAULT now() NOT NULL);
  CREATE TABLE bpo_lancamentos (
    id serial PRIMARY KEY, cliente_id integer REFERENCES bpo_clients(id) ON DELETE SET NULL, cliente_nome_livre varchar(255),
    tipo bpo_lancamento_tipo NOT NULL, descricao varchar(500) NOT NULL, valor numeric(15,2) NOT NULL, vencimento timestamp NOT NULL,
    pago boolean DEFAULT false NOT NULL, pago_em timestamp, competencia varchar(7) NOT NULL, centro_custos varchar(100),
    created_at timestamp DEFAULT now() NOT NULL);
  CREATE TABLE bank_accounts (id serial PRIMARY KEY, banco varchar(255) NOT NULL, conta varchar(30) NOT NULL DEFAULT '—',
    provedor varchar(20) DEFAULT 'manual' NOT NULL, ativo boolean DEFAULT true NOT NULL);
  CREATE TABLE bank_transactions (
    id serial PRIMARY KEY, account_id integer NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE, data timestamp NOT NULL,
    descricao varchar(500) NOT NULL, valor numeric(15,2) NOT NULL, tipo bank_transaction_tipo NOT NULL, categoria varchar(100),
    status bank_transaction_status DEFAULT 'pendente' NOT NULL, external_id varchar(255) UNIQUE, origem varchar(20) DEFAULT 'manual' NOT NULL,
    created_at timestamp DEFAULT now() NOT NULL);
`;
let pg: PGlite;
const linhas = async <T = Record<string, unknown>>(q: string) => (await pg.query<T>(q)).rows;
const admin = () => bpoRouter.createCaller({ user: { id: 1, role: "admin", active: true }, req: {}, res: {} } as never);

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(BASE);
  for (const f of ["0072_bpo_extrato.sql", "0075_bpo_titular_clientes.sql", "0077_banco_identificador_pluggy_v2.sql", "0080_bpo_vinculos_operacionais.sql",
    "0081_bpo_exclusao_edicao_auditavel.sql", "0082_bpo_request_key.sql", "0083_bpo_recebimentos_parciais.sql", "0095_bpo_lote3.sql", "0095_bpo_lote3.sql"]) await pg.exec(sqlDe(f));
  await pg.exec(`
    CREATE TABLE obra_movimentos (id serial PRIMARY KEY, bpo_lancamento_id integer REFERENCES bpo_lancamentos(id) ON DELETE RESTRICT);
    CREATE TABLE regularizacao_recebimentos (id serial PRIMARY KEY, bpo_lancamento_id integer REFERENCES bpo_lancamentos(id) ON DELETE RESTRICT);
    INSERT INTO users DEFAULT VALUES;
    INSERT INTO bank_accounts (banco) VALUES ('Cora');
    INSERT INTO bank_transactions (account_id, data, descricao, valor, tipo) VALUES (1, now(), 'Pix', 10, 'credito');`);
  vi.mocked(getDb).mockReturnValue(drizzle(pg) as never);
});
afterEach(async () => { await pg.close(); });

const lanc = (extra: string, valores: string) =>
  pg.exec(`INSERT INTO bpo_lancamentos (tipo, descricao, valor, vencimento, competencia${extra}) VALUES ${valores}`);

describe("item 12 — criação sem classificação contábil (banco)", () => {
  it("grava a categoria derivada e aceita categoria sem vínculo", async () => {
    const criado = await admin().lancamentos.create({ requestKey: "8d0a3f4e-1d55-4a8c-9c16-7a9a2c0d1e01", tipo: "despesa", descricao: "DAS outubro", valor: 321.45, vencimento: "2026-10-20", competencia: "2026-10", categoriaOperacional: "impostos" });
    expect(criado).toMatchObject({ categoria: "Impostos", categoriaOperacional: "impostos", vinculoOperacionalId: null, centroCustos: null });
  });
});

describe("item 16 — exclusão em lote e combinar pagamentos (banco)", () => {
  beforeEach(async () => {
    await lanc(", cliente_nome_livre, asaas_payment_id, bank_transaction_id, pago, valor_recebido", `
      ('receita','Livre 1',100,'2026-10-10','2026-10','Ana',NULL,NULL,false,0),
      ('receita','Livre 2',50,'2026-10-05','2026-10','Ana',NULL,NULL,false,0),
      ('receita','Asaas',70,'2026-10-05','2026-10','Ana','pay_1',NULL,false,0),
      ('receita','Extrato',10,'2026-10-05','2026-10','Ana',NULL,1,true,10),
      ('receita','Parcial',90,'2026-10-05','2026-09','Ana',NULL,NULL,false,30),
      ('receita','Obra',40,'2026-10-05','2026-10','Ana',NULL,NULL,false,0),
      ('despesa','Despesa livre',15,'2026-10-05','2026-10','Loja',NULL,NULL,false,0)`);
    await pg.exec("INSERT INTO obra_movimentos (bpo_lancamento_id) VALUES (6)");
  });

  it("prévia do Excluir tudo mostra total, alcançados, excluíveis e protegidos; filtro respeitado", async () => {
    expect(await previaExclusaoLote({ aba: "cobrancas", modo: "tudo" })).toMatchObject({ totalAba: 6, alcancados: 6, excluiveis: 2, protegidos: 4, porMotivo: { asaas: 1, extrato: 1, baixa: 2, obra: 1 } });
    expect(await previaExclusaoLote({ aba: "cobrancas", modo: "tudo", filtros: { mes: "09" } })).toMatchObject({ alcancados: 1, excluiveis: 0, protegidos: 1 });
    expect(await previaExclusaoLote({ aba: "cobrancas", modo: "selecionados", ids: [1, 3] })).toMatchObject({ selecionados: 2, excluiveis: 1, protegidos: 1 });
  });

  it("Excluir tudo apaga só os excluíveis, preserva protegidos, grava backup e histórico", async () => {
    await expect(excluirLancamentosEmLote({ aba: "cobrancas", modo: "tudo", confirmacao: "excluir" }, 1)).rejects.toThrow(/EXCLUIR/);
    const r = await excluirLancamentosEmLote({ aba: "cobrancas", modo: "tudo", confirmacao: "EXCLUIR" }, 1);
    expect(r).toMatchObject({ excluidos: 2, protegidos: 4 });
    expect((await linhas<{ descricao: string }>("SELECT descricao FROM bpo_lancamentos ORDER BY id")).map(l => l.descricao))
      .toEqual(["Asaas", "Extrato", "Parcial", "Obra", "Despesa livre"]);
    const [backup] = await linhas<{ quantidade: number; protegidos: number; snapshot_json: string; criado_por_user_id: number }>("SELECT * FROM bpo_lancamento_exclusoes_backup");
    expect(backup).toMatchObject({ quantidade: 2, protegidos: 4, criado_por_user_id: 1 });
    expect(JSON.parse(backup.snapshot_json).map((l: { descricao: string }) => l.descricao).sort()).toEqual(["Livre 1", "Livre 2"]);
    expect(await linhas("SELECT lancamento_id, lancamento_referencia FROM bpo_lancamento_historico ORDER BY lancamento_referencia")).toEqual([
      { lancamento_id: null, lancamento_referencia: 1 }, { lancamento_id: null, lancamento_referencia: 2 },
    ]);
  });

  it("combinar: válido cria a soma e marca as originais; bloqueado não altera nada", async () => {
    await expect(combinarPagamentos({ ids: [1, 3], requestKey: "8d0a3f4e-1d55-4a8c-9c16-7a9a2c0d1e02" }, 1)).rejects.toThrow(/Asaas/);
    expect(await linhas("SELECT count(*)::int n FROM bpo_lancamentos WHERE combinada_em_id IS NOT NULL")).toEqual([{ n: 0 }]);
    const r = await combinarPagamentos({ ids: [1, 2], requestKey: "8d0a3f4e-1d55-4a8c-9c16-7a9a2c0d1e03" }, 1);
    expect(r).toMatchObject({ total: 150, combinadas: 2 });
    const [nova] = await linhas<{ valor: string; vencimento: Date; cliente_nome_livre: string; descricao: string }>(`SELECT * FROM bpo_lancamentos WHERE id = ${r.novaId}`);
    expect(nova.valor).toBe("150.00");
    expect(new Date(nova.vencimento).toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(nova.cliente_nome_livre).toBe("Ana");
    expect(await linhas("SELECT id, combinada_em_id FROM bpo_lancamentos WHERE id IN (1,2) ORDER BY id")).toEqual([{ id: 1, combinada_em_id: r.novaId }, { id: 2, combinada_em_id: r.novaId }]);
    // Originais saem da lista/DRE; a nova cobrança e as originais ficam protegidas contra exclusão.
    expect((await admin().lancamentos.list()).map(l => l.id)).not.toContain(1);
    expect(await previaExclusaoLote({ aba: "cobrancas", modo: "selecionados", ids: [r.novaId] })).toMatchObject({ excluiveis: 0, porMotivo: { combinada: 1 } });
  });
});

describe("item 17 — vincular Cadastro livre ao CRM (banco)", () => {
  beforeEach(async () => {
    await pg.exec(`
      INSERT INTO leads (name, phone, cpf) VALUES ('Maria Souza', '(91) 98888-7777', '123.456.789-00'), ('Pedro Alves', '91 3222-1111', NULL), ('Pedro A. Alves', '9132221111', NULL);
      INSERT INTO bpo_clients (razao_social, responsavel, telefone, honorarios, data_inicio) VALUES ('Cliente Livre', 'X', '', 0, now());`);
    await lanc(", cliente_nome_livre", `('receita','Pix 91988887777',100,'2026-10-10','2026-10','Maria S'), ('receita','Pix',50,'2026-10-05','2026-10','Pedro')`);
  });

  it("único candidato forte: sugere; confirmação cria o cliente BPO do lead sem duplicar e audita", async () => {
    const s = await sugestoesDoLancamento(1, {});
    expect(s.automatico?.candidato).toMatchObject({ leadId: "1", clienteId: null });
    expect(s.automatico?.descricao).toMatch(/telefone/);
    const r = await vincularLancamentoACliente({ id: 1, version: 1, leadId: 1, motivo: "teste" }, 1);
    expect(r).toMatchObject({ clienteCriado: true, version: 2 });
    expect(await linhas("SELECT cliente_id, cliente_nome_livre FROM bpo_lancamentos WHERE id = 1")).toEqual([{ cliente_id: r.clienteId, cliente_nome_livre: null }]);
    const [h] = await linhas<{ motivo: string; antes_json: string }>("SELECT * FROM bpo_lancamento_historico WHERE lancamento_referencia = 1");
    expect(h.motivo).toMatch(/Vínculo com cliente do CRM/);
    expect(JSON.parse(h.antes_json).clienteNomeLivre).toBe("Maria S");
    // Segundo vínculo ao mesmo lead reaproveita o cliente (não duplica).
    await pg.exec("UPDATE bpo_lancamentos SET cliente_id = NULL, cliente_nome_livre = 'Maria' WHERE id = 1");
    const r2 = await vincularLancamentoACliente({ id: 1, version: 2, leadId: 1, motivo: "de novo" }, 1);
    expect(r2).toMatchObject({ clienteCriado: false, clienteId: r.clienteId });
    expect(await linhas("SELECT count(*)::int n FROM bpo_clients WHERE lead_id = 1")).toEqual([{ n: 1 }]);
  });

  it("telefone repetido em dois leads fica ambíguo (sem automático) na prévia em massa", async () => {
    await pg.exec("UPDATE bpo_lancamentos SET descricao = 'Pix (91) 3222-1111' WHERE id = 2");
    const p = await previaVinculosEmMassa({});
    const pedro = p.itens.find(i => i.lancamentoId === 2)!;
    expect(pedro.automatico).toBeNull();
    expect(pedro.ambiguo).toBe(true);
    expect(p.itens.find(i => i.lancamentoId === 1)?.automatico).not.toBeNull();
  });

  it("versão desatualizada não altera nada", async () => {
    await expect(vincularLancamentoACliente({ id: 1, version: 9, clienteId: 1, motivo: "x" }, 1)).rejects.toThrow(/alterado/);
  });
});
