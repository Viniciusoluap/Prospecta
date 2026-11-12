// Central de Vendas — etapa 9: indicadores (só dados reais), CSV, permissões e telas de configuração (router).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", async orig => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste", anthropicApiKey: "" } }));

import { getDb } from "./db.js";
import { montarCenario, type Cenario } from "./__fixtures__/central-vendas/cenario.js";
import { definirDependencias } from "./central-vendas/base.js";
import { appRouter } from "./routers.js";
import { calcularIndicadores, type LinhaIndicador } from "../shared/central-vendas/indicadores.js";

let c: Cenario;
beforeEach(async () => { c = await montarCenario(db => vi.mocked(getDb).mockReturnValue(db as never)); });
afterEach(async () => { definirDependencias(); await c.pg.close(); });

const caller = (id: number, role: string, permissions = "[]") => appRouter.createCaller({ user: { id, role, permissions, active: true, name: "x" }, req: {}, res: {} } as never);
const admin = () => caller(1, "admin");
const operadora = () => caller(2, "colaborador", JSON.stringify(["crm"]));

describe("indicadores", () => {
  const d = (s: string) => new Date(s);
  const base: Omit<LinhaIndicador, "leadId"> = {
    nome: "x", criadoEm: d("2026-11-01T12:00:00Z"), origem: "instagram", campanha: null, produtoId: 1, operadorId: 2, primeiraMensagemEm: null,
    primeiraRespostaEm: null, qualificadoEm: null, docsCompletosEm: null, enviadoAnaliseEm: null, decisaoEm: null,
    statusAtendimento: "novo", statusDocumental: "nao_iniciado", statusAnalise: "nao_enviado",
  };
  it("sem leads: tudo zero ou null (nada estimado)", () => {
    const i = calcularIndicadores([]);
    expect(i).toMatchObject({ recebidos: 0, taxaConversao: null, tempoPrimeiraRespostaMin: null, origens: [], atendimentosPorOperador: [] });
    expect(i.tempoMedioEtapasMin).toEqual({ entradaAteQualificacao: null, qualificacaoAteDocumentos: null, documentosAteDecisao: null });
  });
  it("batem com os dados de teste e respeitam os filtros", () => {
    const linhas: LinhaIndicador[] = [
      { ...base, leadId: 1, primeiraMensagemEm: d("2026-11-01T12:00:00Z"), primeiraRespostaEm: d("2026-11-01T12:02:00Z"), qualificadoEm: d("2026-11-01T13:00:00Z"),
        docsCompletosEm: d("2026-11-02T13:00:00Z"), enviadoAnaliseEm: d("2026-11-02T13:00:00Z"), decisaoEm: d("2026-11-03T13:00:00Z"), statusDocumental: "completo", statusAnalise: "aprovado" },
      { ...base, leadId: 2, primeiraMensagemEm: d("2026-11-01T12:00:00Z"), primeiraRespostaEm: d("2026-11-01T12:04:00Z"), qualificadoEm: d("2026-11-01T14:00:00Z"), statusDocumental: "parcial" },
      { ...base, leadId: 3, origem: "site", operadorId: 3, produtoId: 2, statusDocumental: "completo", docsCompletosEm: d("2026-11-04T00:00:00Z"), enviadoAnaliseEm: d("2026-11-04T00:00:00Z"), statusAnalise: "pendente" },
      { ...base, leadId: 4, criadoEm: d("2026-10-01T12:00:00Z"), origem: null },
    ];
    const i = calcularIndicadores(linhas, { de: d("2026-11-01T00:00:00Z") });
    expect(i).toMatchObject({
      recebidos: 3, qualificados: 2, tempoPrimeiraRespostaMin: 3, aguardandoDocumentos: 1, documentacaoCompleta: 2, enviadosAnalise: 2,
      pendencias: 1, aprovados: 1, reprovados: 0, taxaConversao: 33.3,
      atendimentosPorOperador: [{ operadorId: 2, total: 2 }, { operadorId: 3, total: 1 }],
      origens: [{ origem: "instagram", total: 2 }, { origem: "site", total: 1 }],
    });
    expect(i.tempoMedioEtapasMin).toEqual({ entradaAteQualificacao: 90, qualificacaoAteDocumentos: 1440, documentosAteDecisao: 1440 });
    expect(calcularIndicadores(linhas, { operadorId: 3 }).recebidos).toBe(1);
    expect(calcularIndicadores(linhas, { produtoId: 1, origem: "instagram" }).recebidos).toBe(2);
    expect(calcularIndicadores(linhas, { origem: "sem origem" }).recebidos).toBe(1);
  });
});

describe("router centralVendas", () => {
  beforeEach(async () => {
    await c.pg.exec(`INSERT INTO leads (name, phone, source_channel) VALUES ('Ana', '99988887777', 'instagram'), ('Bia', '99911112222', 'site');
      INSERT INTO central_vendas_leads (lead_id, operador_id, status_analise, enviado_analise_em) VALUES (1, 2, 'em_analise', now()), (2, 3, 'nao_enviado', null);`);
  });

  it("painel e CSV com dados reais; operadora vê só os próprios atendimentos; CSV sem telefone", async () => {
    const p = await admin().centralVendas.painel({});
    expect(p.indicadores).toMatchObject({ recebidos: 2, enviadosAnalise: 1, emAnalise: 1, aprovados: 0, taxaConversao: 0 });
    expect(p.indicadores.atendimentosPorOperador).toEqual([{ operadorId: 2, total: 1, nome: "Olga Operadora" }, { operadorId: 3, total: 1, nome: "Otto Operador" }]);
    expect((await operadora().centralVendas.painel({ operadorId: 3 })).indicadores.recebidos).toBe(1);
    expect((await operadora().centralVendas.atendimentos({})).map(a => a.nome)).toEqual(["Ana"]);
    const { csv } = await admin().centralVendas.exportarCsv({});
    expect(csv.startsWith("﻿Lead;Nome;Entrada")).toBe(true);
    expect(csv).not.toContain("99988887777");
    expect(csv.split("\r\n")).toHaveLength(3);
  });

  it("configurações, produtos, checklists, campanhas e templates: só o admin", async () => {
    await expect(operadora().centralVendas.configuracao()).rejects.toThrow(/administrador/);
    await expect(operadora().centralVendas.salvarProduto({ nome: "Produto X", tipo: "produto" })).rejects.toThrow(/administrador/);
    await expect(caller(9, "corretor").centralVendas.painel({})).rejects.toThrow(/permissão/);
    await expect(caller(5, "colaborador", JSON.stringify(["obras"])).centralVendas.painel({})).rejects.toThrow(/permissão/);
    // Operadora não decide a análise (não é analista).
    await expect(operadora().centralVendas.registrarDecisao({ leadId: 1, decisao: "aprovado" })).rejects.toThrow(/analista/);
  });

  it("token de entrada é mostrado uma vez e fica cifrado; a tela só sabe que existe", async () => {
    const { token } = await admin().centralVendas.gerarToken({ nome: "tokenSite" });
    expect(token.length).toBeGreaterThan(20);
    const cfg = await admin().centralVendas.configuracao();
    expect(cfg.config.segredosDefinidos.tokenSite).toBe(true);
    expect(JSON.stringify(cfg)).not.toContain(token);
    const [{ dados }] = await c.linhas<{ dados: string }>("SELECT dados FROM central_vendas_config");
    expect(dados).not.toContain(token);
  });

  it("produto, checklist, campanha com link wa.me e template validado", async () => {
    await admin().centralVendas.salvarChecklist({ nome: "MCMV", itens: [{ chave: "rg", nome: "RG", tipo: "rg", obrigatorio: true }], ativo: true });
    await admin().centralVendas.salvarProduto({ nome: "Colina Park", tipo: "empreendimento", descricao: "", requisitos: "", condicoes: "", checklistId: 1, ativo: true });
    expect((await admin().centralVendas.produtos())[0]).toMatchObject({ slug: "colina-park", checklistId: 1 });
    expect(await admin().centralVendas.criarCampanha({ canal: "Instagram", nome: "Lançamento", produtoId: 1 })).toEqual({ codigo: "instagram-colina-park" });
    expect(await admin().centralVendas.criarCampanha({ canal: "Instagram", nome: "Lançamento 2", produtoId: 1 })).toEqual({ codigo: "instagram-colina-park-2" });
    const camp = await admin().centralVendas.campanhas();
    expect(camp.campanhas.map(k => k.link)).toContain("https://wa.me/5599900000000?text=Ol%C3%A1!%20%5Bref%3Ainstagram-colina-park%5D");
    await expect(admin().centralVendas.salvarTemplate({ slug: "cv-reativacao", conteudo: "Oi {{cpf}}" })).rejects.toThrow(/Variáveis inválidas/);
    await admin().centralVendas.salvarTemplate({ slug: "cv-reativacao", conteudo: "Oi, {{nome}}! Vamos retomar?" });
    expect((await admin().centralVendas.templates()).find(t => t.slug === "cv-reativacao")).toMatchObject({ personalizado: true, conteudo: "Oi, {{nome}}! Vamos retomar?" });
    // Os templates padrão da Central WhatsApp continuam aparecendo com um cv-* no banco.
    expect((await admin().whatsapp.templates()).length).toBeGreaterThan(1);
  });
});
