// Central de Vendas — etapa 11: critério de pronto (seção 8 do prompt) ponta a ponta, em modo de teste, com o
// webhook real da Evolution, banco em memória e IA/envio simulados. Nenhuma ação manual além da decisão do analista.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", async orig => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste", anthropicApiKey: "" } }));

import { getDb } from "./db.js";
import { aviso, montarCenario, NUMERO_TESTE, OUTRO_NUMERO, type Cenario } from "./__fixtures__/central-vendas/cenario.js";
import { definirDependencias } from "./central-vendas/base.js";
import { appRouter } from "./routers.js";
import { processarEventoEvolution } from "./whatsapp-evolution-webhook.js";

let c: Cenario;
beforeEach(async () => {
  c = await montarCenario(db => vi.mocked(getDb).mockReturnValue(db as never));
  const admin = appRouter.createCaller({ user: { id: 1, role: "admin", active: true, permissions: "[]" }, req: {}, res: {} } as never);
  // Configuração feita uma vez pelo admin, pela tela (router): checklist, produto "teste" e campanha.
  await admin.centralVendas.salvarChecklist({ nome: "MCMV", itens: [
    { chave: "rg", nome: "RG ou CNH", tipo: "rg", obrigatorio: true },
    { chave: "renda", nome: "Comprovante de renda", tipo: "income_proof_formal", obrigatorio: true },
    { chave: "residencia", nome: "Comprovante de residência", tipo: "address_proof", obrigatorio: true },
  ], ativo: true });
  await admin.centralVendas.salvarProduto({ nome: "Residencial Teste", slug: "teste", tipo: "empreendimento", cidade: "Imperatriz", descricao: "Casas de 2 quartos.", requisitos: "", condicoes: "", checklistId: 1, ativo: true });
});
afterEach(async () => { definirDependencias(); await c.pg.close(); });

let seq = 0;
const cliente = (texto: string, numero = NUMERO_TESTE) => processarEventoEvolution(aviso(`E${++seq}`, numero, texto));
const documento = (nome: string) => processarEventoEvolution(aviso(`E${++seq}`, NUMERO_TESTE, "", { message: { documentMessage: { fileName: nome, mimetype: "application/pdf", fileLength: 2048 } } }));

describe("critério de pronto em modo de teste", () => {
  it("'Olá [ref:teste]' → lead, atribuição, IA, qualificação, documentos, análise, decisão e mensagem — tudo no painel e na auditoria", async () => {
    // 1) Número autorizado manda o link da campanha; um número fora da lista não é atendido.
    c.ia("Olá! Sou a assistente da Prospecta. Posso usar seus dados só neste atendimento (LGPD)? Responda SIM.");
    await cliente("Olá [ref:teste]");
    await cliente("Olá [ref:teste]", OUTRO_NUMERO);
    // "[ref:teste]" é o código do produto: canal WhatsApp, campanha "teste", empreendimento Residencial Teste.
    expect(await c.linhas("SELECT campanha, produto_id FROM central_vendas_leads")).toEqual([{ campanha: "teste", produto_id: 1 }]);
    expect(await c.linhas("SELECT id, phone, source_channel, responsible_user_id FROM leads")).toEqual([{ id: 1, phone: "99988887777", source_channel: "whatsapp", responsible_user_id: 2 }]);

    // 2) Consentimento e qualificação pela IA (respostas simuladas).
    c.ia("Obrigada! Qual é o seu nome completo e cidade?", { lgpdConsentimento: true });
    await cliente("SIM");
    c.ia("Perfeito, Ana! Vou te mandar a lista de documentos.", { nome: "Ana Souza", cidade: "Imperatriz", renda: 3200, tipoRenda: "formal", fgts: 5000, estadoCivil: "solteiro", composicaoRenda: false, produto: "teste" });
    await cliente("Ana Souza, Imperatriz, ganho 3200 de carteira assinada, tenho 5 mil de FGTS, solteira, sem composição, quero o Residencial Teste");
    expect(await c.linhas("SELECT name, city, income, income_type, fgts_amount, lgpd_consent, stage FROM leads WHERE id = 1")).toEqual([
      { name: "Ana Souza", city: "Imperatriz", income: "3200.00", income_type: "formal", fgts_amount: "5000.00", lgpd_consent: true, stage: "attending" },
    ]);
    expect(c.envios.at(-1)!.texto).toContain("RG ou CNH, Comprovante de renda e Comprovante de residência");

    // 3) Documentos pelo WhatsApp → encaminhado para análise automaticamente.
    await documento("rg-ana.pdf");
    await documento("holerite-outubro.pdf");
    await documento("conta de luz - comprovante de residencia.pdf");
    expect(await c.linhas("SELECT status_documental, status_analise FROM central_vendas_leads")).toEqual([{ status_documental: "completo", status_analise: "em_analise" }]);
    expect(await c.linhas("SELECT assigned_to FROM tasks")).toEqual([{ assigned_to: "Ana Analista" }]);
    expect(c.envios.at(-1)!.texto).toContain("encaminhado para análise");

    // 4) Única ação humana: a analista registra a decisão; a mensagem sai sozinha.
    const analista = appRouter.createCaller({ user: { id: 4, role: "colaborador", active: true, permissions: JSON.stringify(["crm"]) }, req: {}, res: {} } as never);
    // Não é a operadora do lead, mas como analista vê o que aguarda decisão e decide.
    expect((await analista.centralVendas.atendimentos({})).map(a => ({ leadId: a.leadId, podeDecidir: a.podeDecidir }))).toEqual([{ leadId: 1, podeDecidir: true }]);
    await analista.centralVendas.registrarDecisao({ leadId: 1, decisao: "aprovado" });
    expect(c.envios.at(-1)!.texto).toContain("resultado positivo");
    expect(await c.linhas("SELECT stage FROM leads WHERE id = 1")).toEqual([{ stage: "approved_projects" }]);

    // 5) Nada duplicado, nada para fora da lista de teste.
    expect(c.envios.every(e => e.numero === "5599988887777" || e.numero === "99988887777")).toBe(true);
    expect(await c.linhas("SELECT count(*)::int AS n FROM central_vendas_fila WHERE status <> 'concluido'")).toEqual([{ n: 0 }]);
    expect(c.envios.map(e => e.texto.slice(0, 25))).toEqual([
      "Olá! Sou a assistente da ", "Obrigada! Qual é o seu no", "Perfeito, Ana! Vou te man", "Ana, para seguirmos, envi",
      "Ana, recebemos todos os d", "Ana, sua análise foi conc",
    ]);

    // 6) Visível no painel e na auditoria.
    const admin = appRouter.createCaller({ user: { id: 1, role: "admin", active: true, permissions: "[]" }, req: {}, res: {} } as never);
    const painel = await admin.centralVendas.painel({});
    expect(painel.indicadores).toMatchObject({ recebidos: 1, qualificados: 1, documentacaoCompleta: 1, enviadosAnalise: 1, aprovados: 1, taxaConversao: 100, origens: [{ origem: "whatsapp", total: 1 }] });
    expect(painel.indicadores.tempoPrimeiraRespostaMin).toBe(0);
    const { eventos } = await admin.centralVendas.auditoria({ leadId: 1 });
    expect(eventos.map(e => e.tipo).reverse()).toEqual(expect.arrayContaining([
      "lead_criado", "atribuido", "ia_respondeu", "qualificado", "documentos_solicitados", "documento_recebido", "encaminhado_analise", "analise_aprovado", "mensagem_enviada",
    ]));
    // Auditoria sem dados pessoais (telefone, renda, nome).
    expect(JSON.stringify(eventos)).not.toMatch(/99988887777|3200|Ana Souza/);
  });
});
