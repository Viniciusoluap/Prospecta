// EPIC-027 C5 — correções apontadas pela revisão automática nas etapas 1 e 2 (já em produção), feitas na integração (epic027-c5int).
// A) rótulo de referência com segredo nunca vai ao modelo (gravação E leitura; também nome de grupo e memória de longo prazo);
// B) a leitura de grupos diz o mesmo que a marcação sobre o interruptor de grupo sem linha própria (ligadoPorPadrao);
// D) grupos esperando o tipo: a elegibilidade vem antes do limite (resposta ambígua continua pedindo o código).
// Banco em memória (PGlite); sem rede.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));

import { getDb } from "../db.js";
import { gruposEsperandoTipo } from "./grupos-decisao.js";
import { listarGrupos } from "./leitura/grupos.js";
import { cabecalhoDoPedido, gravarNaConversa, janelaDe, lerJanela, referenciaDoGrupo, rotuloSeguro } from "./memoria.js";
import { blocoParaConversaDoDono } from "./memoria-longa.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";

let banco: Awaited<ReturnType<typeof criarBanco>>;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
const SEGREDOS = /girassol|sk-ant-api03|abcdefghijklmnopqrstuvwxyz0123|56789/;
const ROTULOS_RUINS = ["Equipe senha girassol", "Grupo sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123", "Obra ag 1234 conta 56789-0"];

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
});
afterEach(() => { vi.clearAllMocks(); });

describe("A — segredo em rótulo de referência nunca vai ao modelo", () => {
  it("regra pura: rotuloSeguro tira senha, token e dado bancário; nome comum fica", () => {
    for (const r of ROTULOS_RUINS) expect(rotuloSeguro(r), r).not.toMatch(SEGREDOS);
    expect(rotuloSeguro("Maria Trello")).toBe("Maria Trello");
  });

  it("gravação: o rótulo é filtrado ANTES de persistir; o cabeçalho do próximo pedido não leva o segredo", async () => {
    const referencias = ROTULOS_RUINS.map((rotulo, i) => ({ tipo: "grupo" as const, id: i + 1, rotulo }));
    expect(await gravarNaConversa({ papel: "sistema", origem: "aviso", texto: "Aviso de grupo novo.", agora: AGORA, referencias })).toBe(true);
    expect(JSON.stringify(await q("SELECT referencias FROM dolores_conversa"))).not.toMatch(SEGREDOS);
    const cab = cabecalhoDoPedido(await lerJanela(new Date(AGORA.getTime() + 60_000)));
    expect(cab).toBeTruthy();
    expect(cab).not.toMatch(SEGREDOS);
  });

  it("leitura: linha antiga gravada SEM o filtro (como em produção) também sai limpa — rótulo e texto", async () => {
    await banco.pg.query("INSERT INTO dolores_conversa (criado_em, papel, origem, texto, referencias) VALUES ($1, 'sistema', 'aviso', $2, $3)",
      [AGORA, "Aviso antigo: senha girassol", JSON.stringify(ROTULOS_RUINS.map((rotulo, i) => ({ tipo: "grupo", id: i + 1, rotulo })))]);
    const h = await lerJanela(new Date(AGORA.getTime() + 60_000));
    expect(h.referencias.length).toBeGreaterThan(0);
    expect(JSON.stringify(h)).not.toMatch(SEGREDOS);
    expect(cabecalhoDoPedido(h)).not.toMatch(SEGREDOS);
    // regra pura da janela: o mesmo filtro
    expect(JSON.stringify(janelaDe([{ papel: "sistema", origem: "aviso", criadoEm: AGORA, texto: "token sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123",
      referencias: [{ tipo: "cliente", id: 9, rotulo: "Cliente senha girassol" }] }] as never, AGORA))).not.toMatch(SEGREDOS);
  });

  it("nome do grupo lido do banco para o aviso (referenciaDoGrupo) passa pelo filtro", async () => {
    await banco.pg.exec(`INSERT INTO dolores_grupos (instancia, grupo_jid, nome, ativo, tipo, origem, situacao_confirmacao) VALUES
      ('prospecta-dolores', '120363000000000777@g.us', 'Equipe senha girassol', true, 'administrativo', 'manual', 'confirmado')`);
    const [g] = await q<{ id: number }>("SELECT id FROM dolores_grupos WHERE grupo_jid = '120363000000000777@g.us'");
    const refs = await referenciaDoGrupo(g.id);
    expect(refs).toHaveLength(1);
    expect(JSON.stringify(refs)).not.toMatch(SEGREDOS);
  });

  it("memória de longo prazo: lembrança gravada por fora da regra (linha crua) não leva o segredo ao bloco da conversa", async () => {
    await banco.pg.exec("INSERT INTO dolores_memoria_longa (texto, categoria, origem) VALUES ('Acesso do portal: senha girassol', 'fato_negocio', 'tela')");
    const b = await blocoParaConversaDoDono();
    expect(b?.bloco).toBeTruthy();
    expect(b!.bloco).not.toMatch(/girassol/);
  });
});

describe("B — leitura de grupos: interruptor sem linha própria segue o padrão da marcação", () => {
  it("automático, aceito e de tipo conhecido → responde; manual sem linha → não; linha própria desligada → não", async () => {
    await banco.pg.exec(`INSERT INTO dolores_grupos (instancia, grupo_jid, nome, ativo, lead_id, tipo, origem, situacao_confirmacao, adicionado_por, prova_adicao) VALUES
      ('prospecta-dolores', '120363000000000801@g.us', 'A Automatico aceito', true, 1, 'cliente', 'automatico', 'confirmado', 'dono', 'evento_add'),
      ('prospecta-dolores', '120363000000000802@g.us', 'B Manual sem linha', true, 1, 'cliente', 'manual', 'confirmado', NULL, NULL),
      ('prospecta-dolores', '120363000000000803@g.us', 'C Automatico desligado', true, 2, 'cliente', 'automatico', 'confirmado', 'dono', 'evento_add'),
      ('prospecta-dolores', '120363000000000804@g.us', 'D Automatico aguardando', true, NULL, 'indefinido', 'automatico', 'aguardando_dono', 'desconhecido', NULL)`);
    const [c] = await q<{ id: number }>("SELECT id FROM dolores_grupos WHERE grupo_jid = '120363000000000803@g.us'");
    await banco.pg.query("INSERT INTO dolores_marcacoes_grupo (grupo_id, responder_ligado) VALUES ($1, false)", [c.id]);
    const r = await listarGrupos({ situacao: "todos", pagina: 1, limite: 50 });
    const por = Object.fromEntries(((r.dados as any).itens as Array<{ nome: string; respondeQuandoMarcada: boolean }>).map(i => [i.nome, i.respondeQuandoMarcada]));
    expect(por).toMatchObject({ "A Automatico aceito": true, "B Manual sem linha": false, "C Automatico desligado": false, "D Automatico aguardando": false });
  });
});

describe("D — grupos esperando o tipo: elegibilidade antes do limite", () => {
  const inserir = async (n: number, p: { pergunta: Date | null; provado: boolean; prefixo: string }) => {
    const valores = Array.from({ length: n }, (_, i) => `('prospecta-dolores', '1203630${p.prefixo}${String(i).padStart(8, "0")}@g.us', 'G ${p.prefixo} ${i}', true, 'indefinido', 'automatico',
      'aguardando_dono', '${p.provado ? "dono" : "desconhecido"}', ${p.provado ? "'evento_add'" : "NULL"}, ${p.pergunta ? `'${p.pergunta.toISOString()}'` : "NULL"})`);
    await banco.pg.exec(`INSERT INTO dolores_grupos (instancia, grupo_jid, nome, ativo, tipo, origem, situacao_confirmacao, adicionado_por, prova_adicao, pergunta_tipo_em) VALUES ${valores.join(",\n")}`);
  };

  it("60 grupos com pergunta vencida + 2 recentes: os 2 elegíveis aparecem (ambíguo → pede o código)", async () => {
    await inserir(60, { pergunta: new Date(AGORA.getTime() - 3 * 3_600_000), provado: true, prefixo: "11" });
    await inserir(2, { pergunta: new Date(AGORA.getTime() - 5 * 60_000), provado: true, prefixo: "22" });
    const r = await gruposEsperandoTipo(AGORA);
    expect(r.map(g => g.nome).sort()).toEqual(["G 22 0", "G 22 1"]);
  });

  it("60 inelegíveis (sem prova de entrada, ou sem pergunta) + 1 elegível: o elegível aparece sozinho", async () => {
    await inserir(30, { pergunta: new Date(AGORA.getTime() - 5 * 60_000), provado: false, prefixo: "33" });
    await inserir(30, { pergunta: null, provado: true, prefixo: "44" });
    await inserir(1, { pergunta: new Date(AGORA.getTime() - 5 * 60_000), provado: true, prefixo: "55" });
    expect((await gruposEsperandoTipo(AGORA)).map(g => g.nome)).toEqual(["G 55 0"]);
  });
});
