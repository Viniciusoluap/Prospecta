// Central de Vendas — etapa 6: checklist editável, lista de pendentes, classificação das mídias (só metadados),
// lembretes D+N e o encaminhamento automático para análise, exatamente uma vez.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", async orig => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste", anthropicApiKey: "" } }));

import { getDb } from "./db.js";
import { aviso, montarCenario, NUMERO_TESTE, type Cenario } from "./__fixtures__/central-vendas/cenario.js";
import { definirDependencias } from "./central-vendas/base.js";
import { agendarLembretes, verificarDocumentacao } from "./central-vendas/documentos.js";
import { processarFila } from "./central-vendas/envio.js";
import { processarEventoEvolution } from "./whatsapp-evolution-webhook.js";
import { classificarPorNome } from "../shared/central-vendas/regras.js";

let c: Cenario;
let seq = 0;
afterEach(async () => { definirDependencias(); await c?.pg.close(); c = undefined as never; });
const cliente = (texto: string) => processarEventoEvolution(aviso(`T${++seq}`, NUMERO_TESTE, texto));
const arquivo = (nome: string, legenda = "", id = `D${++seq}`) => processarEventoEvolution(aviso(id, NUMERO_TESTE, "", {
  message: { documentMessage: { fileName: nome, mimetype: "application/pdf", fileLength: 1200, caption: legenda } },
}));
const ITENS = [
  { chave: "rg", nome: "RG ou CNH", tipo: "rg", obrigatorio: true },
  { chave: "renda", nome: "Comprovante de renda", tipo: "income_proof_formal", obrigatorio: true },
  { chave: "residencia", nome: "Comprovante de residência", tipo: "address_proof", obrigatorio: true },
  { chave: "certidao", nome: "Certidão de casamento", tipo: "birth_marriage_certificate", obrigatorio: false },
];
const QUALIFICADO = { lgpdConsentimento: true, nome: "Ana Souza", cidade: "Imperatriz", renda: 3200, tipoRenda: "formal", fgts: 0, estadoCivil: "solteiro", composicaoRenda: false, produto: "teste" };

async function qualificar(config = {}) {
  c = await montarCenario(db => vi.mocked(getDb).mockReturnValue(db as never), { config });
  await c.pg.exec(`INSERT INTO central_vendas_checklists (slug, nome, documentos) VALUES ('mcmv', 'MCMV', '${JSON.stringify(ITENS)}');
    INSERT INTO central_vendas_produtos (slug, nome, checklist_id) VALUES ('teste', 'Residencial Teste', 1);`);
  c.ia("Olá! Posso usar seus dados (LGPD)?");
  await cliente("Olá [ref:teste]");
  c.ia("Perfeito, Ana! Já tenho tudo.", QUALIFICADO);
  await cliente("Sim. Ana Souza, Imperatriz, 3200 de carteira assinada, sem FGTS, solteira, sem composição, quero o Residencial Teste");
}
const cv = async () => (await c.linhas<Record<string, unknown>>("SELECT status_documental, status_analise, qualificado_em IS NOT NULL AS qualificado FROM central_vendas_leads"))[0];

describe("classificação por metadados", () => {
  it("usa nome do item, chave e sinônimos (nunca o conteúdo do arquivo)", () => {
    expect(classificarPorNome("holerite_outubro.pdf", ITENS)).toEqual({ chave: "renda", confianca: 0.8 });
    expect(classificarPorNome("Comprovante de residência - conta de luz.jpg", ITENS)).toEqual({ chave: "residencia", confianca: 0.9 });
    expect(classificarPorNome("cnh-digital.pdf", ITENS)).toEqual({ chave: "rg", confianca: 0.8 });
    expect(classificarPorNome("IMG_2033.jpg", ITENS)).toBeNull();
  });
});

describe("fluxo de documentos", () => {
  beforeEach(() => qualificar());

  it("qualificação completa → envia a lista de pendentes do checklist do produto", async () => {
    expect(await cv()).toMatchObject({ qualificado: true, status_documental: "aguardando_documentos" });
    expect(c.envios.at(-1)!.texto).toBe("Ana, para seguirmos, envie por aqui foto ou PDF destes documentos: RG ou CNH, Comprovante de renda e Comprovante de residência.");
    expect(await c.linhas("SELECT temperature FROM leads")).toEqual([{ temperature: "warm" }]);
  });

  it("classifica cada mídia, vincula a lead_documents, marca 'a conferir' sem parar e encaminha uma única vez", async () => {
    await arquivo("RG-frente.pdf");
    expect(await cv()).toMatchObject({ status_documental: "parcial" });
    await arquivo("holerite.pdf");
    // Sem pista no nome: a IA classifica só pelos metadados, com baixa confiança → "a conferir", conta mesmo assim.
    c.respostasIA.push(JSON.stringify({ chave: "residencia", confianca: 0.4 }));
    await arquivo("IMG_2033.pdf", "", "ULTIMO");
    expect(c.chamadasIA.at(-1)!.mensagens[0].content).toBe("Arquivo: IMG_2033.pdf; tipo: application/pdf; legenda: (sem legenda)");
    expect(await c.linhas("SELECT type, status, file_url FROM lead_documents ORDER BY id")).toEqual([
      { type: "rg", status: "received", file_url: expect.stringMatching(/^\/api\/whatsapp\/midia\/\d+$/) },
      { type: "income_proof_formal", status: "received", file_url: expect.stringMatching(/^\/api\/whatsapp\/midia\/\d+$/) },
      { type: "address_proof", status: "received", file_url: expect.stringMatching(/^\/api\/whatsapp\/midia\/\d+$/) },
    ]);
    expect(await c.linhas("SELECT chave, a_conferir FROM central_vendas_documentos ORDER BY id")).toEqual([
      { chave: "rg", a_conferir: false }, { chave: "renda", a_conferir: false }, { chave: "residencia", a_conferir: true },
    ]);
    expect(await cv()).toMatchObject({ status_documental: "completo", status_analise: "em_analise" });
    // Repetições: aviso repetido do último arquivo, nova verificação e outro arquivo depois → nada se repete.
    await arquivo("IMG_2033.pdf", "", "ULTIMO");
    await verificarDocumentacao(1);
    await arquivo("certidao-casamento.pdf");
    expect(await c.linhas("SELECT title, assigned_to, related_type, related_id FROM tasks")).toEqual([
      { title: "Análise — Ana Souza", assigned_to: "Ana Analista", related_type: "lead", related_id: 1 },
    ]);
    expect(c.envios.filter(e => e.texto.includes("encaminhado para análise"))).toHaveLength(1);
    expect(await c.linhas("SELECT count(*)::int AS n FROM central_vendas_eventos WHERE tipo = 'encaminhado_analise'")).toEqual([{ n: 1 }]);
    expect(await c.linhas("SELECT user_id FROM user_notifications WHERE title LIKE '%para análise%'")).toEqual([{ user_id: 4 }]);
  });

  it("lembretes D+1, D+3 e D+7 pelo cron, um de cada, com os pendentes atuais", async () => {
    await arquivo("RG-frente.pdf");
    expect(await agendarLembretes()).toBe(0);
    c.avancar(24 * 60);
    expect(await agendarLembretes()).toBe(1);
    expect(await agendarLembretes()).toBe(0);
    await processarFila();
    expect(c.envios.at(-1)!.texto).toBe("Olá, Ana! Ainda faltam estes documentos para seguirmos: Comprovante de renda e Comprovante de residência. Pode enviar por aqui mesmo.");
    c.avancar(2 * 24 * 60);
    expect(await agendarLembretes()).toBe(1);
    c.avancar(4 * 24 * 60);
    expect(await agendarLembretes()).toBe(1);
    c.avancar(30 * 24 * 60);
    expect(await agendarLembretes()).toBe(0);
  });
});

describe("sem checklist ou com a automação desligada", () => {
  it("sem checklist: registra e avisa o operador, sem inventar documentos", async () => {
    c = await montarCenario(db => vi.mocked(getDb).mockReturnValue(db as never));
    await c.pg.exec("INSERT INTO central_vendas_produtos (slug, nome) VALUES ('teste', 'Residencial Teste')");
    c.ia("Olá!");
    await cliente("Olá [ref:teste]");
    c.ia("Obrigada!", QUALIFICADO);
    await cliente("dados");
    expect(await c.linhas("SELECT count(*)::int AS n FROM central_vendas_eventos WHERE tipo = 'sem_checklist'")).toEqual([{ n: 1 }]);
    expect(await c.linhas("SELECT user_id FROM user_notifications WHERE title LIKE '%sem checklist%'")).toEqual([{ user_id: 2 }]);
    expect(c.envios.some(e => e.texto.includes("documentos"))).toBe(false);
  });

  it("automação de documentos desligada: não envia a lista", async () => {
    await qualificar({ automacoes: { ia: true, documentos: false, lembretes: true, followup: true, reativacao: true } });
    expect(await cv()).toMatchObject({ qualificado: true, status_documental: "nao_iniciado" });
  });
});
