// EPIC-024 S-06 — proposta formal de aquisição do terreno (PDF e e-mail). Dados FICTÍCIOS de teste.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "./db.js";
import * as email from "./_core/email-smtp.js";
import { appRouter } from "./routers.js";
import { ERRO_PROPOSTA_MUDOU, hojeBrasil } from "./incorporacao-proposta-router.js";
import { gerarPdfPropostaTerreno, secoesPropostaTerreno, type DadosPropostaTerreno } from "../shared/incorporacao/proposta-terreno-pdf";
import { parseNegociacao, type Proposta } from "../shared/incorporacao/negociacao";

const PROPOSTA: Proposta = {
  id: "prop-1", data: "2026-11-10", autor: "grupo", tipo: "compra_parcelada", valorTotal: 1_500_000, entradaPct: 20,
  prazoParcelamentoMeses: 24, condicoes: "Escritura em até 60 dias após a aprovação.", status: "enviada",
};
const BASE: DadosPropostaTerreno = {
  empreendimento: { nome: "Residencial Exemplo", cidade: "Cidade Teste", uf: "MA", endereco: "Rua Fictícia, 100", tipo: "vertical" },
  terreno: { areaM2: 12_000, matricula: "MAT-0001" },
  proprietario: { nome: "Proprietário Fictício", contato: "(00) 0000-0000", email: "dono@exemplo.test" },
  proposta: PROPOSTA,
  proponente: { empresa: "Prospecta Construções - VFX Capital", responsavel: "Usuária Teste" },
  dataEmissao: "2026-11-16",
};
/** Textos desenhados no PDF (operandos de Tj, sem os escapes de parênteses). */
const textoDoPdf = (b: Uint8Array) => Array.from(Buffer.from(b).toString("latin1").matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g), (m) => m[1].replace(/\\([()\\])/g, "$1")).join("\n");

describe("conteúdo do PDF — só o que está registrado", () => {
  it("traz cada campo registrado", () => {
    const pdf = textoDoPdf(gerarPdfPropostaTerreno(BASE));
    for (const t of ["PROSPECTA", "PROPOSTA DE AQUISIÇÃO DE TERRENO", "Residencial Exemplo", "Vertical", "Cidade Teste/MA", "Proprietário Fictício",
      "(00) 0000-0000", "dono@exemplo.test", "Rua Fictícia, 100", "12.000 m²", "1,2 ha", "MAT-0001", "Compra parcelada", "10/11/2026",
      "R$ 1.500.000,00", "20% do valor proposto", "24 meses", "Escritura em até 60 dias", "Emitida em 16/11/2026", "Usuária Teste", "De acordo"]) {
      expect(pdf, t).toContain(t);
    }
  });

  it("campos vazios são omitidos, sem marcador nem valor inventado", () => {
    const minimo: DadosPropostaTerreno = {
      ...BASE, empreendimento: { nome: "Gleba Mínima" }, terreno: {}, proprietario: {},
      proposta: { id: "p", data: "2026-11-01", autor: "grupo", tipo: "compra_avista", valorTotal: 0, status: "enviada" },
      proponente: { empresa: "Prospecta Construções - VFX Capital" },
    };
    const secoes = secoesPropostaTerreno(minimo);
    expect(secoes.map((s) => s.titulo)).toEqual(["Empreendimento", "Proposta", "Proponente"]);
    expect(secoes.find((s) => s.titulo === "Proposta")!.linhas).toEqual([["Modalidade", "Compra à vista"], ["Data da proposta", "01/11/2026"]]);
    const pdf = textoDoPdf(gerarPdfPropostaTerreno(minimo));
    for (const ausente of ["Valor proposto", "Entrada", "Prazo de parcelamento", "Matrícula", "E-mail", "undefined", "null", "NaN", "R$ 0,00", "Responsável", "Permuta ("])
      expect(pdf, ausente).not.toContain(ausente);
  });

  it("permuta financeira mostra o percentual registrado, não um valor calculado", () => {
    const s = secoesPropostaTerreno({ ...BASE, proposta: { ...PROPOSTA, tipo: "permuta_financeira", valorTotal: undefined, entradaPct: undefined, prazoParcelamentoMeses: undefined, permutaPctVgv: 12.5 } });
    expect(s.find((x) => x.titulo === "Proposta")!.linhas).toContainEqual(["Permuta (percentual do VGV)", "12,5%"]);
    expect(JSON.stringify(s)).not.toContain("R$");
  });

  it("mesma entrada → mesmos bytes (data de criação e identificador fixos)", async () => {
    const a = gerarPdfPropostaTerreno(BASE);
    await new Promise((r) => setTimeout(r, 1100));
    expect(Buffer.from(gerarPdfPropostaTerreno(BASE)).equals(Buffer.from(a))).toBe(true);
    expect(Buffer.from(gerarPdfPropostaTerreno({ ...BASE, dataEmissao: "2026-11-15" })).equals(Buffer.from(a))).toBe(false);
  });
});

describe("rotas de PDF e envio", () => {
  let pg: PGlite;
  let gravado: string;
  const usuario = { id: 1, name: "Usuária Teste", role: "admin", active: true };
  const admin = () => appRouter.createCaller({ user: usuario, req: {}, res: {} } as never);
  const hoje = hojeBrasil();
  const estudo = () => ({ id: 1, name: "Residencial Exemplo", city: "Cidade Teste", state: "MA", address: "Rua Fictícia, 100", incorporationType: "vertical",
    areaM2: "12000.00", propertyRegistration: "MAT-0001", landNegotiationJson: gravado });
  let envio: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(`CREATE TYPE email_template_type AS ENUM ('primeiro_acesso');
      CREATE TABLE users (id serial PRIMARY KEY); INSERT INTO users DEFAULT VALUES;
      CREATE TABLE incorporation_studies (id serial PRIMARY KEY); INSERT INTO incorporation_studies DEFAULT VALUES;`);
    const sql = readFileSync(new URL("../drizzle/0120_proposta_terreno_email.sql", import.meta.url), "utf8").replaceAll("--> statement-breakpoint", "");
    await pg.exec(sql);
    await pg.exec(sql); // idempotente
  });
  afterAll(() => pg.close());
  beforeEach(() => {
    gravado = JSON.stringify({ proprietarioNome: "Proprietário Fictício", proprietarioContato: "(00) 0000-0000", proprietarioEmail: "dono@exemplo.test",
      propostas: [PROPOSTA, { ...PROPOSTA, id: "prop-2", autor: "proprietario", status: "contraproposta" }] });
    vi.spyOn(db, "getDb").mockReturnValue(drizzle(pg) as never);
    vi.spyOn(db, "getIncorporationStudyById").mockImplementation(async (id: number) => (id === 1 ? estudo() : undefined) as never);
    vi.spyOn(db, "updateIncorporationStudy").mockImplementation(async (_id: number, dados: { landNegotiationJson?: string | null }) => {
      if (dados.landNegotiationJson) gravado = dados.landNegotiationJson;
    });
    envio = vi.spyOn(email, "sendEmail").mockResolvedValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it("a migração 0120 cria o tipo de e-mail e a tabela de envios", async () => {
    const r = await pg.query<{ v: string }>("SELECT unnest(enum_range(NULL::email_template_type))::text AS v");
    expect(r.rows.map((x) => x.v)).toContain("proposta_terreno");
  });

  it("o PDF baixado é byte a byte o anexo do e-mail; enviar não aceita a proposta", async () => {
    const baixado = await admin().incorporacao.propostaTerreno.pdf({ studyId: 1, propostaId: "prop-1" });
    expect(baixado.dataEmissao).toBe(hoje);
    const r = await admin().incorporacao.propostaTerreno.enviar({ studyId: 1, propostaId: "prop-1", destinatario: " Dono@Exemplo.test ", dataEmissao: baixado.dataEmissao, pdfSha256: baixado.sha256 });
    expect(r.ok).toBe(true);
    const mensagem = envio.mock.calls[0][0] as Parameters<typeof email.sendEmail>[0];
    expect(mensagem.to).toBe("dono@exemplo.test");
    expect(mensagem.templateType).toBe("proposta_terreno");
    expect(mensagem.attachments![0].content.equals(Buffer.from(baixado.base64, "base64"))).toBe(true);
    expect(mensagem.attachments![0].filename).toBe(baixado.nomeArquivo);
    expect(r.envio).toMatchObject({ status: "enviado", destinatario: "dono@exemplo.test", pdfSha256: baixado.sha256, dataEmissao: hoje });
    expect(parseNegociacao(gravado)!.propostas.find((p) => p.id === "prop-1")!.status).toBe("enviada");
  });

  it("revisão do PR #263 (paridade): negociação mudou depois da prévia → recusa com mensagem clara, nada é enviado nem registrado", async () => {
    const c = admin().incorporacao.propostaTerreno;
    expect(ERRO_PROPOSTA_MUDOU).toBe("A proposta mudou desde a prévia; gere a prévia de novo.");
    // a tela reconhece a mesma mensagem e troca o botão por "Gerar a prévia de novo"
    const compat = readFileSync(new URL("../client/src/components/incorporacao/estudo/compat/proposta-terreno.ts", import.meta.url), "utf8");
    expect(compat).toContain(`AVISO_PROPOSTA_MUDOU = "${ERRO_PROPOSTA_MUDOU}"`);
    const tela = readFileSync(new URL("../client/src/components/incorporacao/estudo/proposta-terreno-envio.tsx", import.meta.url), "utf8");
    expect(tela).toContain("previa.pdf.dataEmissao, previa.pdf.sha256)");
    const previa = await c.pdf({ studyId: 1, propostaId: "prop-1" });
    expect(previa.sha256).toMatch(/^[0-9a-f]{64}$/);
    const antes = (await c.envios({ studyId: 1 })).length;
    // outra pessoa (ou outra aba) muda o valor da proposta depois da prévia
    gravado = JSON.stringify({ ...JSON.parse(gravado), propostas: [{ ...PROPOSTA, valorTotal: 1_900_000 }] });
    const pedido = { studyId: 1, propostaId: "prop-1", destinatario: "dono@exemplo.test", dataEmissao: previa.dataEmissao };
    await expect(c.enviar({ ...pedido, pdfSha256: previa.sha256 })).rejects.toThrow(ERRO_PROPOSTA_MUDOU);
    // hash ausente ou malformado também recusa
    await expect(c.enviar(pedido)).rejects.toThrow(ERRO_PROPOSTA_MUDOU);
    await expect(c.enviar({ ...pedido, pdfSha256: "abc" })).rejects.toThrow(ERRO_PROPOSTA_MUDOU);
    expect(envio).not.toHaveBeenCalled();
    expect((await c.envios({ studyId: 1 })).length).toBe(antes);
    // nova prévia → envio liberado, com o PDF novo
    const nova = await c.pdf({ studyId: 1, propostaId: "prop-1" });
    expect(nova.sha256).not.toBe(previa.sha256);
    const r = await c.enviar({ ...pedido, dataEmissao: nova.dataEmissao, pdfSha256: nova.sha256 });
    expect(r.ok).toBe(true);
    expect(r.envio.pdfSha256).toBe(nova.sha256);
  });

  it("os envios sobrevivem ao salvamento automático da aba (JSON antigo)", async () => {
    const antes = await admin().incorporacao.propostaTerreno.envios({ studyId: 1 });
    expect(antes.length).toBeGreaterThan(0);
    const daTela = { proprietarioNome: "Proprietário Fictício", proprietarioContato: "", propostas: [PROPOSTA] };
    await admin().incorporacao.saveNegociacaoTerreno({ id: 1, dataJson: JSON.stringify(daTela) });
    expect(await admin().incorporacao.propostaTerreno.envios({ studyId: 1 })).toEqual(antes);
  });

  it("falha fica registrada com o motivo e o reenvio funciona", async () => {
    envio.mockResolvedValueOnce(false);
    const { sha256 } = await admin().incorporacao.propostaTerreno.pdf({ studyId: 1, propostaId: "prop-1" });
    const falhou = await admin().incorporacao.propostaTerreno.enviar({ studyId: 1, propostaId: "prop-1", destinatario: "dono@exemplo.test", dataEmissao: hoje, pdfSha256: sha256 });
    expect(falhou.ok).toBe(false);
    expect(falhou.envio.status).toBe("falhou");
    expect(falhou.motivo).toBeTruthy();
    const reenvio = await admin().incorporacao.propostaTerreno.enviar({ studyId: 1, propostaId: "prop-1", destinatario: "dono@exemplo.test", dataEmissao: hoje, pdfSha256: sha256 });
    expect(reenvio.ok).toBe(true);
    const lista = await admin().incorporacao.propostaTerreno.envios({ studyId: 1 });
    expect(lista.slice(0, 2).map((e) => e.status)).toEqual(["enviado", "falhou"]);
    expect(parseNegociacao(gravado)!.propostas.find((p) => p.id === "prop-1")!.status).toBe("enviada");
  });

  it("valida destinatário, data de emissão, autor da proposta e proposta inexistente", async () => {
    const c = admin().incorporacao.propostaTerreno;
    await expect(c.enviar({ studyId: 1, propostaId: "prop-1", destinatario: "nao-e-email", dataEmissao: hoje })).rejects.toThrow(/inválido/);
    await expect(c.pdf({ studyId: 1, propostaId: "prop-1", dataEmissao: "2099-01-01" })).rejects.toThrow(/Data de emissão/);
    await expect(c.pdf({ studyId: 1, propostaId: "prop-2" })).rejects.toThrow(/do proprietário/);
    await expect(c.pdf({ studyId: 1, propostaId: "nao-existe" })).rejects.toThrow(/não encontrada/);
    await expect(c.pdf({ studyId: 9, propostaId: "prop-1" })).rejects.toThrow(/Estudo não encontrado/);
  });

  it("usuário sem o módulo Incorporação é recusado", async () => {
    const c = appRouter.createCaller({ user: { id: 2, role: "colaborador", active: true, permissions: JSON.stringify(["obras"]) }, req: {}, res: {} } as never);
    await expect(c.incorporacao.propostaTerreno.pdf({ studyId: 1, propostaId: "prop-1" })).rejects.toThrow(/permissão/i);
    await expect(c.incorporacao.propostaTerreno.enviar({ studyId: 1, propostaId: "prop-1", destinatario: "dono@exemplo.test" })).rejects.toThrow(/permissão/i);
    await expect(c.incorporacao.propostaTerreno.envios({ studyId: 1 })).rejects.toThrow(/permissão/i);
    expect(envio).not.toHaveBeenCalled();
  });

  it("usa o logotipo do empreendimento (S-02) no cabeçalho quando existe", async () => {
    await pg.exec(readFileSync(new URL("../drizzle/0119_logotipo_empreendimento.sql", import.meta.url), "utf8").replaceAll("--> statement-breakpoint", ""));
    const sem = await admin().incorporacao.propostaTerreno.pdf({ studyId: 1, propostaId: "prop-1" });
    expect(Buffer.from(sem.base64, "base64").toString("latin1")).not.toContain("/Subtype /Image");
    const png = "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da636460f85f0f0002870180eb47ba920000000049454e44ae426082";
    await pg.exec(`INSERT INTO incorporation_study_logos (study_id, mime, nome, sha256, tamanho, original, exibicao_png, exibicao_sha256, largura, altura)
      VALUES (1, 'image/png', 'l.png', 'x', 1, '\\x${png}', '\\x${png}', 'y', 1, 1)`);
    const com = await admin().incorporacao.propostaTerreno.pdf({ studyId: 1, propostaId: "prop-1" });
    expect(Buffer.from(com.base64, "base64").toString("latin1")).toContain("/Subtype /Image");
  });
});
