// EPIC-025 (Dolores, etapa 3) — regressões das correções do portão de QA (Quinn, 16/11): cada teste é a versão
// INVERTIDA de um ataque do QA (A1–A9) — passa só com o defeito corrigido. Porta da ponte e motor da fila (PGlite).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => {
  const o = await orig<typeof import("../db.js")>();
  return { ...o, getDb: vi.fn(), getAssignableUsers: vi.fn(o.getAssignableUsers) };
});
vi.mock("../pci-gerador.js", () => ({
  modeloAtualPci: vi.fn(async () => ({ id: 1, versao: 3 })),
  gerarPciDaObra: vi.fn(async () => ({ id: 77, avisos: [], pendencias: [] })),
}));
vi.mock("../../shared/pci-gerador.js", async orig => ({ ...(await orig<typeof import("../../shared/pci-gerador.js")>()), errosPci: vi.fn(() => []) }));

import { errosPci } from "../../shared/pci-gerador.js";
import { getAssignableUsers, getDb } from "../db.js";
import { gerarPciDaObra } from "../pci-gerador.js";
import { intencaoDeAcao, quadroDePendencias, quadroDoQueFoiFeito, textoDaCobranca } from "../../shared/dolores/fila.js";
import { ACOES } from "./acoes/registro.js";
import { decidir, definirSorteioCodigo } from "./aprovacoes.js";
import { contaminaOComando } from "./cerebro.js";
import { FUNCOES } from "./funcoes.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte, executarFuncao } from "./ponte.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";

let banco: Awaited<ReturnType<typeof criarBanco>>;
const q = async <T = any>(s: string) => (await banco.pg.query<T>(s)).rows;
const fila = () => q<any>("SELECT * FROM dolores_aprovacoes ORDER BY id");
const doDono = (funcao: string, argumentos: Record<string, unknown>, mensagemId = 10) =>
  executarFuncao({ funcao, argumentos, pedidoId: `wa:${mensagemId}:1:0` }, { canal: "whatsapp", mensagemId });

let seq = 0;
beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`CREATE TABLE IF NOT EXISTS pci_generator_drafts (project_id integer PRIMARY KEY, form_data jsonb NOT NULL, updated_by integer, updated_at timestamp NOT NULL DEFAULT now());`);
  esquecerUsuarioDolores();
  definirDependenciasPonte({ agora: () => AGORA });
  seq = 0;
  definirSorteioCodigo(() => ((seq++ * 7) % 22) / 22 + 0.001);
  vi.mocked(errosPci).mockReturnValue([]);
});
afterEach(() => { definirDependenciasPonte(); definirSorteioCodigo(); vi.clearAllMocks(); });

describe("A1 (achado 5) — gatilho de dolores_aprovacoes protege o que o dono lê e a ordem da execução", () => {
  it("UPDATE direto não prorroga a validade, não troca resumo/pedido/autor, não pula para 'executada' e não reescreve o resultado", async () => {
    await doDono("preparar_cobranca", { leadIds: [1, 2] });
    const [i1, i2] = await fila();
    await expect(banco.pg.exec(`UPDATE dolores_aprovacoes SET vence_em = now() + interval '10 years' WHERE id = ${i1.id}`)).rejects.toThrow(/IMUTAVEL/);
    await expect(banco.pg.exec(`UPDATE dolores_aprovacoes SET resumo = 'Tarefa inofensiva' WHERE id = ${i1.id}`)).rejects.toThrow(/IMUTAVEL/);
    await expect(banco.pg.exec(`UPDATE dolores_aprovacoes SET pedido_id = 'outro' WHERE id = ${i1.id}`)).rejects.toThrow(/IMUTAVEL/);
    await expect(banco.pg.exec(`UPDATE dolores_aprovacoes SET autor_user_id = NULL WHERE id = ${i1.id}`)).rejects.toThrow(/IMUTAVEL/);
    await expect(banco.pg.exec(`UPDATE dolores_aprovacoes SET situacao = 'executada', resultado = '{"feitos":["inventado"]}' WHERE id = ${i2.id}`)).rejects.toThrow(/EXECUCAO_UNICA/);
    await expect(banco.pg.exec(`UPDATE dolores_aprovacoes SET resultado = '{"feitos":["inventado"]}' WHERE id = ${i2.id}`)).rejects.toThrow(/RESULTADO/);
    // em execução: o resultado não é reescrito sem encerrar; a decisão não muda
    await banco.pg.exec(`UPDATE dolores_aprovacoes SET situacao = 'executando', decidido_em = now(), decidido_via = 'tela' WHERE id = ${i2.id}`);
    await expect(banco.pg.exec(`UPDATE dolores_aprovacoes SET resultado = '{"feitos":["inventado"]}' WHERE id = ${i2.id}`)).rejects.toThrow(/RESULTADO/);
    await expect(banco.pg.exec(`UPDATE dolores_aprovacoes SET decidido_via = 'whatsapp' WHERE id = ${i2.id}`)).rejects.toThrow(/IMUTAVEL/);
    // a transição legítima continua valendo: executando → executada com o resultado
    await banco.pg.exec(`UPDATE dolores_aprovacoes SET situacao = 'executada', executado_em = now(), resultado = '{"feitos":["ok"]}' WHERE id = ${i2.id}`);
    const [a, b] = await fila();
    expect(a.resumo).toBe(i1.resumo);
    expect(new Date(a.vence_em).getTime()).toBe(new Date(i1.vence_em).getTime());
    expect(b).toMatchObject({ situacao: "executada", resultado: { feitos: ["ok"] } });
  });
});

describe("achado 1 — regra de contaminação na porta e intenção de ação (por código)", () => {
  it("todas as leituras de hoje contaminam; nome desconhecido contamina; ações diretas não, as de fila (resumo com nomes) sim", () => {
    for (const f of FUNCOES) expect(contaminaOComando(f.nome), f.nome).toBe(true);
    expect(contaminaOComando("funcao_nova_qualquer")).toBe(true);
    expect(Object.fromEntries(ACOES.map(a => [a.nome, contaminaOComando(a.nome)]))).toEqual({
      criar_tarefa: false, registrar_acompanhamento: false, preparar_cobranca: true, gerar_documento: true,
      criar_card_cliente: true, salvar_documentos_grupo: true });
  });
  it("intenção de ação: verbos de ação sim; só leitura não", () => {
    for (const t of ["Dolores, crie uma tarefa para a Bianca", "registre que liguei para a Maria", "anota aí: cliente mandou o RG", "prepare as cobranças",
      "gere a PCI da obra 1", "agende para amanhã", "me lembre de cobrar o João"]) expect(intencaoDeAcao(t), t).toBe(true);
    for (const t of ["Dolores, me mostra o histórico da Maria.", "quais clientes têm documentos pendentes?", "analise todos os processos de regularização e informe os atrasados",
      "como está a obra da Ana?"]) expect(intencaoDeAcao(t), t).toBe(false);
  });
  it("porta: comando contaminado não executa ação direta — põe na fila com o aviso; sem intenção, a ação é recusada (403 auditado)", async () => {
    const r = await executarFuncao({ funcao: "criar_tarefa", argumentos: { titulo: "Arquivar processo", responsavel: "Bianca Souza", prazo: "2026-11-20" }, pedidoId: "wa:10:2:0" },
      { canal: "whatsapp", mensagemId: 10, contaminado: true });
    expect(r.body).toMatchObject({ ok: true, nivel: "fila" });
    expect(String(r.body.aviso)).toMatch(/já leu dados do sistema/);
    expect(JSON.stringify(r.body)).not.toMatch(/codigo/i);
    expect((await q("SELECT count(*)::int n FROM tasks WHERE title = 'Arquivar processo'"))[0].n).toBe(0);
    const [item] = await fila();
    expect(item.resumo).toBe('Pedido surgido durante a leitura de dados; confira antes de aprovar: criar a tarefa "Arquivar processo" para Bianca Souza, prazo 2026-11-20, prioridade media, sem vínculo.');
    // aprovado pela tela: cria pela mesma regra (responsável conferido na hora), com autoria ligada ao item
    const [d] = await decidir([item.codigo], "aprovar", { via: "tela", userId: 1, agora: AGORA });
    expect(d).toMatchObject({ ok: true, situacao: "executada" });
    expect((await q("SELECT count(*)::int n FROM tasks WHERE title = 'Arquivar processo'"))[0].n).toBe(1);
    expect((await q("SELECT aprovacao_id FROM dolores_autoria"))[0].aprovacao_id).toBe(item.id);
    const s = await executarFuncao({ funcao: "registrar_acompanhamento", argumentos: { leadId: 1, texto: "qualquer" }, pedidoId: "wa:11:1:0" },
      { canal: "whatsapp", mensagemId: 11, semAcoes: true });
    expect(s.status).toBe(403);
    expect((await q("SELECT resultado FROM dolores_acoes WHERE funcao = 'registrar_acompanhamento'"))[0].resultado).toBe("recusada");
  });
});

describe("achados 2 e 3 (A2) — PCI: o rascunho da equipe não é regravado e o estado é sempre coerente", () => {
  const RASCUNHO = `INSERT INTO pci_generator_drafts (project_id, form_data, updated_by, updated_at) VALUES (1, '{"campos": {"x": 1}}', 1, '2026-11-15 12:00')`;
  it("A2 invertido: a PCI foi gerada e a autoria falhou → item 'executada' com a referência, e o dono lê a verdade", async () => {
    await banco.pg.exec(RASCUNHO);
    expect((await doDono("gerar_documento", { tipo: "pci", obraId: 1 })).status).toBe(200);
    const [item] = await fila();
    await banco.pg.exec(`CREATE OR REPLACE FUNCTION qa_falha() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'conexao caiu'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER qa_falha BEFORE INSERT ON dolores_autoria FOR EACH ROW EXECUTE FUNCTION qa_falha();`);
    const [r] = await decidir([item.codigo], "aprovar", { via: "tela", userId: 1, agora: AGORA });
    expect(gerarPciDaObra).toHaveBeenCalledTimes(1);
    expect(vi.mocked(gerarPciDaObra).mock.calls[0][3]).toMatchObject({ regravarRascunho: false });
    expect(r).toMatchObject({ ok: true, situacao: "executada" });
    expect(r.texto).not.toMatch(/não foi executado/);
    expect(r.texto).toMatch(/FOI gerada em 16\/11\/2026 \(#77, no histórico da obra\), mas não consegui registrar a autoria da Dolores; confira/);
    const [depois] = await fila();
    expect(depois.situacao).toBe("executada");
    expect(depois.resultado.dados).toMatchObject({ pciGeradaId: 77, autoriaRegistrada: false });
    expect(depois.resultado.resumo).toMatchObject({ gerada: true, pciGeradaId: 77, autoriaRegistrada: false });
    // o rascunho da equipe ficou como estava (autoria e data)
    expect(await q("SELECT updated_by FROM pci_generator_drafts WHERE project_id = 1")).toEqual([{ updated_by: 1 }]);
  });
  it("autoria falha só na 1ª tentativa: a 2ª grava e o texto é o normal", async () => {
    await banco.pg.exec(RASCUNHO);
    await doDono("gerar_documento", { tipo: "pci", obraId: 1 });
    const [item] = await fila();
    // sequência: não volta com o ROLLBACK da 1ª tentativa
    await banco.pg.exec(`CREATE SEQUENCE qa_cont;
      CREATE OR REPLACE FUNCTION qa_falha1() RETURNS trigger AS $$ BEGIN IF nextval('qa_cont') = 1 THEN RAISE EXCEPTION 'oscilou'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER qa_falha1 BEFORE INSERT ON dolores_autoria FOR EACH ROW EXECUTE FUNCTION qa_falha1();`);
    const [r] = await decidir([item.codigo], "aprovar", { via: "tela", userId: 1, agora: AGORA });
    expect(r).toMatchObject({ ok: true, situacao: "executada" });
    expect(r.texto).toMatch(/gerada \(#77\), sem assinatura/);
    expect(await q("SELECT tabela, registro_id, aprovacao_id FROM dolores_autoria")).toEqual([{ tabela: "pci_generated", registro_id: 77, aprovacao_id: item.id }]);
  });
});

describe("achado 4 (A3) — orçamento de tempo das execuções", () => {
  const RASCUNHOS = `INSERT INTO pci_generator_drafts (project_id, form_data, updated_by, updated_at) VALUES
    (1, '{"campos": {"x": 1}}', 1, '2026-11-15 12:00'), (2, '{"campos": {"x": 2}}', 1, '2026-11-15 12:00')`;
  it("A3 invertido: com 7 s restantes a PCI NÃO começa (mínimo 30 s) e continua aguardando; uma cobrança (leve) com 7 s executa", async () => {
    await banco.pg.exec(RASCUNHOS);
    await doDono("gerar_documento", { tipo: "pci", obraId: 1 });
    await doDono("preparar_cobranca", { leadIds: [1] }, 11);
    const [pci, cobranca] = await fila();
    const [r1, r2] = await decidir([pci.codigo, cobranca.codigo], "aprovar", { via: "whatsapp", userId: null, agora: AGORA, prazoFinal: 7_000, relogio: () => 0 });
    expect(gerarPciDaObra).not.toHaveBeenCalled();
    expect(r1).toMatchObject({ ok: false, situacao: "aguardando" });
    expect(r1.texto).toMatch(/não deu tempo de executar agora; nada foi feito e continua aguardando — mande "aprovar/);
    expect(r2).toMatchObject({ ok: true, situacao: "executada" });
    expect((await fila()).map(i => i.situacao)).toEqual(["aguardando", "executada"]);
  });
  it("com tempo: a PCI começa e as cópias ao Drive recebem prazo dentro do orçamento; no máximo 1 PCI por mensagem de decisão", async () => {
    await banco.pg.exec(RASCUNHOS);
    await doDono("gerar_documento", { tipo: "pci", obraId: 1 });
    await doDono("gerar_documento", { tipo: "pci", obraId: 2 }, 11);
    const [a, b] = await fila();
    const [ra, rb] = await decidir([a.codigo, b.codigo], "aprovar", { via: "whatsapp", userId: null, agora: AGORA, prazoFinal: 31_000, relogio: () => 0 });
    expect(ra).toMatchObject({ ok: true, situacao: "executada" });
    expect(rb).toMatchObject({ ok: false, situacao: "aguardando" });
    expect(rb.texto).toMatch(/no máximo uma PCI por mensagem/);
    expect(gerarPciDaObra).toHaveBeenCalledTimes(1);
    // (31 s − 6 s de folga) / 2 cópias = 12,5 s cada
    expect(vi.mocked(gerarPciDaObra).mock.calls[0][3]).toEqual({ regravarRascunho: false, prazoDriveMs: 12_500 });
    expect((await fila()).map(i => i.situacao)).toEqual(["executada", "aguardando"]);
  });
  it("ação direta passa pelo prazo da porta: passou do prazo → 504 auditado, desfecho único (desfeita, nada gravado) — QA R2 M6", async () => {
    definirDependenciasPonte({ agora: () => AGORA, prazoMs: 150 });
    vi.mocked(getAssignableUsers).mockImplementationOnce(async (...a) => { await new Promise(r => setTimeout(r, 400)); return (await vi.importActual<typeof import("../db.js")>("../db.js")).getAssignableUsers(...a); });
    const r = await doDono("criar_tarefa", { titulo: "Tarefa lenta", responsavel: "Bianca Souza" });
    expect(r.status).toBe(504);
    expect(String(r.body.erro)).toBe("A ação passou do prazo e foi desfeita: nada foi gravado. Pode pedir de novo.");
    expect(String(r.body.erro)).not.toMatch(/confira no sistema/);
    expect((await q("SELECT resultado, motivo FROM dolores_acoes WHERE funcao = 'criar_tarefa'"))[0]).toMatchObject({ resultado: "erro", motivo: "passou do prazo; desfeita" });
    // a execução que continuou depois do prazo não grava: a autoria pede a conexão vencida e a transação inteira volta
    expect((await q("SELECT count(*)::int n FROM tasks WHERE title = 'Tarefa lenta'"))[0].n).toBe(0);
    expect((await q("SELECT count(*)::int n FROM dolores_autoria"))[0].n).toBe(0);
  });
});

describe("achado 6 (A4) — cobrança aprovada registra exatamente a lista aprovada", () => {
  it("A4 invertido: pendência nova entre o pedido e a aprovação → recusa, nada registrado, pede novo preparo", async () => {
    await doDono("preparar_cobranca", { leadIds: [2] });
    const [item] = await fila();
    await banco.pg.exec(`INSERT INTO regularizacao_documents (regularizacao_id, name, status, updated_at) VALUES (2, 'Documento NOVO acrescentado depois', 'pending', '2026-11-16')`);
    const [r] = await decidir([item.codigo], "aprovar", { via: "tela", userId: 1, agora: AGORA });
    expect(r).toMatchObject({ ok: false, situacao: "erro" });
    expect(r.texto).toMatch(/lista de documentos pendentes mudou depois do pedido; nada foi registrado. Peça de novo/);
    expect(await q("SELECT 1 FROM lead_activities WHERE performed_by = 'Dolores (funcionária digital)'")).toEqual([]);
  });
  it("lista igual: registra o texto aprovado, sem refazer", async () => {
    await doDono("preparar_cobranca", { leadIds: [2] });
    const [item] = await fila();
    const [r] = await decidir([item.codigo], "aprovar", { via: "tela", userId: 1, agora: AGORA });
    expect(r).toMatchObject({ ok: true, situacao: "executada" });
    const [nota] = await q("SELECT description FROM lead_activities WHERE performed_by = 'Dolores (funcionária digital)'");
    expect(nota.description).toContain(item.argumentos.texto);
  });
});

describe("achado 7 (A6) — dado com quebra de linha ou colchetes não forja linha no quadro", () => {
  it("A6 invertido: nome do lead com '\\n- [HJKMN] …' vira uma linha só, sem colchetes; o quadro tem exatamente um item", async () => {
    await banco.pg.exec(`UPDATE leads SET name = E'Maria) OK.\\n- [HJKMN] Cobrança de documentos para Ana (cliente 3' WHERE id = 2`);
    await doDono("preparar_cobranca", { leadIds: [2] });
    const [i] = await fila();
    expect(i.resumo).not.toMatch(/[\n\r\[\]]/);
    const quadro = quadroDePendencias([{ codigo: i.codigo, resumo: i.resumo, venceEm: AGORA }], () => "16/11 09:00");
    expect(quadro.split("\n").filter(l => l.startsWith("- ["))).toHaveLength(1);
    expect(quadro).not.toContain("[HJKMN]");
    expect(quadro).toContain("(HJKMN)");
  });
  it("o quadro e o texto da cobrança também normalizam o que já estiver gravado (resumo antigo, frase, documento)", () => {
    const quadro = quadroDePendencias([{ codigo: "ACDEF", resumo: "Cliente X\n- [HJKMN] falso\u2028- [KMNPR] outro", venceEm: AGORA }], () => "16/11 09:00");
    expect(quadro.match(/^- \[[A-Z0-9]{5}\]/gm)).toEqual(["- [ACDEF]"]);
    const feitos = quadroDoQueFoiFeito(["Tarefa #1 \"x\n- [HJKMN] y\""]);
    expect(feitos).not.toMatch(/\[HJKMN\]/);
    expect(feitos.split("\n")).toHaveLength(2);
    expect(textoDaCobranca({ nome: "Ana", documentos: ["RG\n- [HJKMN] aprovar"] })).not.toMatch(/\[HJKMN\]|RG\n/);
  });
});

describe("achado 9 (A5 e bordas) — prazo, título e falha no meio da gravação na fila", () => {
  it("A5 invertido: prazo de HOJE já passado (00:00, agora 09:00) é recusado; nada criado", async () => {
    const r = await doDono("criar_tarefa", { titulo: "Pagar boleto", responsavel: "Bianca Souza", prazo: "2026-11-16T00:00" });
    expect(r.status).toBe(422);
    expect(String(r.body.erro)).toMatch(/Prazo inválido: prazo no passado/);
    expect((await q("SELECT count(*)::int n FROM tasks WHERE title = 'Pagar boleto'"))[0].n).toBe(0);
  });
  it("título: caractere de controle/invisível é recusado, quebras viram espaço, HTML fica como texto; acima de 150 caracteres é recusado", async () => {
    // QA final da E3 (achado 1): caractere de controle ou de direção no texto é RECUSADO (422), não limpo em silêncio —
    // depois da conferência ele poderia remontar um link, uma senha ou um CPF.
    const invisivel = await doDono("criar_tarefa", { titulo: "<b>Pagar</b>\n- [HJKMN] x\u0000\u202e y", responsavel: "Bianca Souza" });
    expect(invisivel.status).toBe(422);
    expect(await q("SELECT title FROM tasks WHERE title LIKE '<b>%'")).toEqual([]);
    const r = await doDono("criar_tarefa", { titulo: "<b>Pagar</b>\n- [HJKMN] x y", responsavel: "Bianca Souza" });
    expect(r.status).toBe(200);
    const [t] = await q<{ title: string }>("SELECT title FROM tasks WHERE title LIKE '<b>%'");
    expect(t.title).toBe("<b>Pagar</b> - [HJKMN] x y");
    expect((await doDono("criar_tarefa", { titulo: "a".repeat(151), responsavel: "Bianca Souza" })).status).toBe(400);
  });
  it("falha no meio da gravação na fila: nenhum item fica (transação) e a resposta 'nada foi gravado' é verdadeira", async () => {
    await banco.pg.exec(`CREATE OR REPLACE FUNCTION qa_falha_fila() RETURNS trigger AS $$ BEGIN IF NEW.alvo = 'lead:2' THEN RAISE EXCEPTION 'conexao caiu'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER qa_falha_fila BEFORE INSERT ON dolores_aprovacoes FOR EACH ROW EXECUTE FUNCTION qa_falha_fila();`);
    const r = await doDono("preparar_cobranca", { leadIds: [1, 2] });
    expect(r.status).toBe(500);
    expect(String(r.body.erro)).toMatch(/nada foi gravado/);
    expect(await fila()).toEqual([]);
  });
});
