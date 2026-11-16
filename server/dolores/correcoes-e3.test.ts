// EPIC-025 (Dolores, etapa 3) — regressões das correções do portão de QA (Quinn, 16/11): cada teste é a versão
// INVERTIDA de um ataque do QA (A1–A9) — passa só com o defeito corrigido. Porta da ponte e motor da fila (PGlite).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../pci-gerador.js", () => ({
  modeloAtualPci: vi.fn(async () => ({ id: 1, versao: 3 })),
  gerarPciDaObra: vi.fn(async () => ({ id: 77, avisos: [], pendencias: [] })),
}));
vi.mock("../../shared/pci-gerador.js", async orig => ({ ...(await orig<typeof import("../../shared/pci-gerador.js")>()), errosPci: vi.fn(() => []) }));

import { errosPci } from "../../shared/pci-gerador.js";
import { getDb } from "../db.js";
import { intencaoDeAcao } from "../../shared/dolores/fila.js";
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
      criar_tarefa: false, registrar_acompanhamento: false, preparar_cobranca: true, gerar_documento: true });
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
