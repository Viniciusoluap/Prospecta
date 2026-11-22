// EPIC-027 C2 — correções da revisão da aba "Grupos" da Central WhatsApp:
// 1) toda resposta que a Dolores ENVIOU ao grupo aparece (recusa fora do escopo e aviso de teto, não só "respondida");
// 2) página antiga pedida para o grupo A e chegada depois de trocar para o B é descartada;
// 3) mensagem nova não abre buraco depois de carregar as antigas (união por chave).
// PGlite; nada sai para a rede.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", async orig => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn() }));

import {
  aplicarPaginaAntiga, aplicarPaginaRecente, unirMensagensDoGrupo, vistaDoGrupo, type HistoricoDoGrupo, type PaginaDoGrupo,
} from "../shared/whatsapp/grupos-central.js";
import { getDb } from "./db.js";
import { CENARIO, criarBanco } from "./dolores/testes-banco.js";
import { appRouter } from "./routers.js";

const J = (n: number) => `12036310000000000${n}@g.us`;
let banco: Awaited<ReturnType<typeof criarBanco>>;
const caller = (role: "admin" | "colaborador") => appRouter.createCaller({
  user: { id: role === "admin" ? 1 : 2, role, active: true, permissions: JSON.stringify(role === "admin" ? [] : ["whatsapp"]) }, req: {}, res: {},
} as never);

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado' WHERE id = 1;
    INSERT INTO dolores_grupos (instancia, grupo_jid, nome, nome_whatsapp, ativo, tipo, lead_id, origem, situacao_confirmacao, codigo, adicionado_por, prova_adicao) VALUES
      ('prospecta-dolores', '${J(1)}', 'Família Maria', 'Família Maria', true, 'cliente', 1, 'automatico', 'confirmado', 'KAAA', 'dono', 'evento_add');`);
});
afterEach(() => { vi.clearAllMocks(); });

describe("C2 (revisão) — o humano vê tudo o que a Dolores enviou ao grupo", () => {
  it("recusa fora do escopo e aviso de teto aparecem; sem envio (erro, silêncio sem texto, processando) não; CPF mascarado", async () => {
    await banco.pg.exec(`INSERT INTO dolores_marcacoes (grupo_id, instancia, external_id, situacao, resposta, respondida_em) VALUES
      (1, 'prospecta-dolores', 'R1', 'respondida', 'Seu processo está no protocolo.', '2026-11-16 10:00+00'),
      (1, 'prospecta-dolores', 'R2', 'fora_de_escopo', 'Não posso falar disso aqui. CPF 123.456.789-01', '2026-11-16 10:05+00'),
      (1, 'prospecta-dolores', 'R3', 'silencio', 'Atingi o limite de respostas de hoje neste grupo.', '2026-11-16 10:10+00'),
      (1, 'prospecta-dolores', 'R4', 'erro', NULL, '2026-11-16 10:15+00'),
      (1, 'prospecta-dolores', 'R5', 'silencio', NULL, '2026-11-16 10:20+00'),
      (1, 'prospecta-dolores', 'R6', 'processando', NULL, NULL);`);
    for (const role of ["admin", "colaborador"] as const) {
      const r = await caller(role).whatsappGrupos.mensagens({ grupoId: 1 });
      expect(r.mensagens.map(m => [m.origem, m.texto])).toEqual([
        ["dolores", "Seu processo está no protocolo."],
        ["dolores", expect.stringMatching(/^Não posso falar disso aqui\. CPF (?!123\.456\.789-01)/)],
        ["dolores", "Atingi o limite de respostas de hoje neste grupo."],
      ]);
      expect(JSON.stringify(r)).not.toContain("123.456.789-01");
      // a prévia da lista também: a última enviada é o aviso de teto
      const lista = await caller(role).whatsappGrupos.listar();
      expect(lista.grupos.find(g => g.id === 1)!.ultima!.texto).toBe("Dolores: Atingi o limite de respostas de hoje neste grupo.");
    }
    // paginação para trás também conta as recusas
    const antes = await caller("admin").whatsappGrupos.mensagens({ grupoId: 1, antes: new Date("2026-11-16T10:08:00Z") });
    expect(antes.mensagens.map(m => m.texto)).toEqual(["Seu processo está no protocolo.", expect.stringMatching(/^Não posso falar disso aqui/)]);
  });
});

type M = { chave: string; texto: string };
const msgs = (de: number, ate: number, txt = "m"): M[] => Array.from({ length: ate - de + 1 }, (_, i) => ({ chave: `m${de + i}`, texto: `${txt}${de + i}` }));
const pag = (mensagens: M[], temMais = true, maisAntiga: string | null = "c"): PaginaDoGrupo<M> => ({ mensagens, temMais, maisAntiga });

describe("C2 (revisão) — histórico do grupo na tela (puro)", () => {
  it("união por chave: sem duplicar, em ordem, a versão mais nova prevalece", () => {
    expect(unirMensagensDoGrupo(msgs(1, 3), [{ chave: "m3", texto: "nova" }, ...msgs(4, 5)]).map(m => m.texto)).toEqual(["m1", "m2", "nova", "m4", "m5"]);
    expect(unirMensagensDoGrupo([...msgs(1, 2), ...msgs(1, 1)], []).map(m => m.chave)).toEqual(["m1", "m2"]);
    expect(unirMensagensDoGrupo([], [])).toEqual([]);
  });

  it("sem buraco: antigas 1–60, última página 61–120; o poll traz 62–121 e a 61 continua", () => {
    let h: HistoricoDoGrupo<M> | null = aplicarPaginaRecente(null, 1, pag(msgs(61, 120)));
    h = aplicarPaginaAntiga(h, 1, pag(msgs(1, 60), false, null));
    h = aplicarPaginaRecente(h, 1, pag(msgs(62, 121)));
    const v = vistaDoGrupo(h, 1, pag(msgs(62, 121)));
    expect(v.mensagens.map(m => m.chave)).toEqual(msgs(1, 121).map(m => m.chave));
    // o cursor e o "tem mais" vêm da página antiga mais velha
    expect(v).toMatchObject({ temMais: false, cursor: null });
    // mesmo antes de o histórico se atualizar (a página nova chegou no mesmo render)
    expect(vistaDoGrupo(aplicarPaginaAntiga(aplicarPaginaRecente(null, 1, pag(msgs(61, 120))), 1, pag(msgs(1, 60), false, null)), 1, pag(msgs(62, 121)))
      .mensagens.map(m => m.chave)).toEqual(msgs(1, 121).map(m => m.chave));
  });

  it("troca de grupo: página antiga do A que chega com o B aberto é descartada; histórico de outro grupo nunca aparece", () => {
    const deA = aplicarPaginaRecente(null, 1, pag(msgs(61, 120, "A")));
    // a pessoa trocou para o B: chegou a primeira página do B, o histórico passa a ser do B
    const deB = aplicarPaginaRecente(deA, 2, pag(msgs(1, 5, "B"), false, null));
    expect(deB).toEqual({ grupoId: 2, mensagens: msgs(1, 5, "B"), antigas: null });
    // a resposta pendente do A chega agora: nada muda
    expect(aplicarPaginaAntiga(deB, 1, pag(msgs(1, 60, "A"), false, "cursor-do-A"))).toBe(deB);
    const v = vistaDoGrupo(deB, 2, pag(msgs(1, 5, "B"), false, null));
    expect(v.mensagens.every(m => m.texto.startsWith("B"))).toBe(true);
    expect(v.cursor).toBeNull();
    // e se o histórico ainda é do A (a página do B não chegou), a vista do B não mostra o A nem usa o cursor dele
    const comA = aplicarPaginaAntiga(deA, 1, pag(msgs(1, 60, "A"), true, "cursor-do-A"));
    expect(vistaDoGrupo(comA, 2, undefined)).toEqual({ mensagens: [], temMais: false, cursor: null });
    expect(vistaDoGrupo(comA, 1, undefined)).toMatchObject({ temMais: true, cursor: "cursor-do-A" });
  });
});
