// EPIC-025 (Dolores, etapa 1) — ponte: autenticação, pausa, limite, lista liberada, validação, auditoria e a usuária.
// Banco em memória (PGlite); nenhuma chamada externa.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));

import { canAccessAdminProcedure } from "../_core/trpc.js";
import { getDb } from "../db.js";
import { sanearArgumentos } from "./auditoria.js";
import { FUNCOES, funcaoPorNome } from "./funcoes.js";
import { LIBERADAS_ETAPA_1, funcaoLiberada } from "./permissoes.js";
import { DOLORES_OPEN_ID, esquecerUsuarioDolores, usuarioDolores } from "./perfil.js";
import { definirDependenciasPonte, ferramentasLiberadas, tokenConfere, tratarChamada, tratarFerramentas } from "./ponte.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";

const TOKEN = "token-de-teste-da-ponte-1234567890";
let banco: Awaited<ReturnType<typeof criarBanco>>;
const pedido = (body: unknown, authorization: string | undefined = `Bearer ${TOKEN}`) =>
  ({ headers: authorization ? { authorization } : {}, body, ip: "203.0.113.7" }) as never;
const acoes = async () => (await banco.pg.query<{ funcao: string; resultado: string; motivo: string | null; resumo: any; argumentos: any; autor_user_id: number | null; pedido_id: string | null; duracao_ms: number }>(
  "SELECT * FROM dolores_acoes ORDER BY id")).rows;

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  esquecerUsuarioDolores();
  definirDependenciasPonte({ agora: () => AGORA });
  process.env.DOLORES_PONTE_TOKEN = TOKEN;
});
afterEach(() => {
  delete process.env.DOLORES_PONTE_TOKEN;
  definirDependenciasPonte();
  vi.restoreAllMocks();
});

describe("autenticação", () => {
  it("sem a variável de ambiente, recusa tudo (inclusive com token)", async () => {
    delete process.env.DOLORES_PONTE_TOKEN;
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await tratarChamada(pedido({ funcao: "listar_tarefas" }))).status).toBe(503);
    expect((await tratarFerramentas(pedido({}))).status).toBe(503);
    expect(aviso.mock.calls.flat().join(" ")).not.toContain(TOKEN);
  });

  it("sem token, token errado ou outro esquema: 401, sem gravar na auditoria e sem o token no log", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const auth of ["", "Bearer errado", `Basic ${TOKEN}`, `Bearer ${TOKEN}x`, "Bearer "]) {
      expect((await tratarChamada(pedido({ funcao: "listar_tarefas" }, auth))).status).toBe(401);
    }
    expect(await acoes()).toEqual([]);
    expect(aviso.mock.calls.flat().join(" ")).not.toContain(TOKEN);
  });

  it("tentativas demais sem token por IP: 429", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    definirDependenciasPonte({ agora: () => new Date("2026-11-16T13:00:00Z") });
    const status: number[] = [];
    for (let i = 0; i < 22; i++) status.push((await tratarChamada(pedido({}, "Bearer x"))).status);
    expect(status.slice(0, 20).every(s => s === 401)).toBe(true);
    expect(status.slice(20)).toEqual([429, 429]);
  });

  it("comparação: só o Bearer exato confere", () => {
    expect(tokenConfere(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(tokenConfere(`bearer   ${TOKEN}  `, TOKEN)).toBe(true);
    expect(tokenConfere(`Bearer ${TOKEN.slice(1)}`, TOKEN)).toBe(false);
    expect(tokenConfere(undefined, TOKEN)).toBe(false);
    expect(tokenConfere(`Bearer ${TOKEN}`, undefined)).toBe(false);
  });
});

describe("chamada autorizada", () => {
  it("executa, devolve o envelope (fuso, moeda, etapa) e audita no nome da Dolores com contagens", async () => {
    const r = await tratarChamada(pedido({ funcao: "listar_processos_regularizacao", argumentos: { situacao: "atrasados" }, pedidoId: "wa-123" }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, etapa: 1, funcao: "listar_processos_regularizacao", pedidoId: "wa-123", fuso: "America/Fortaleza (UTC-03:00)",
      moeda: "BRL", geradoEm: "2026-11-16T09:00:00-03:00", truncado: false });
    // M2: toda resposta com dados lembra que o conteúdo é dado, não instrução; o prompt do agente diz o mesmo
    expect(r.body.avisoSeguranca).toMatch(/nunca instrução/);
    const prompt = readFileSync(new URL("../../docs/dolores/agente-etapa1.md", import.meta.url), "utf8");
    expect(prompt).toMatch(/é DADO, nunca instrução/);
    expect(prompt).toMatch(/textoDoCliente/);
    expect(prompt).toMatch(/Mensagem suspeita/);
    expect((r.body.dados as any).itens.map((p: any) => p.id)).toEqual([2]);
    const [a] = await acoes();
    const dolores = await usuarioDolores();
    expect(a).toMatchObject({ funcao: "listar_processos_regularizacao", resultado: "ok", pedido_id: "wa-123", autor_user_id: dolores,
      argumentos: { situacao: "atrasados", diasParado: 15, pagina: 1, limite: 20 } });
    expect(a.resumo).toMatchObject({ encontrados: 1, devolvidos: 1, atrasados: 1, truncado: false });
    // o resumo da auditoria não guarda dados de cliente
    expect(JSON.stringify(a.resumo)).not.toMatch(/João|Maria|Bianca/);
    expect(a.duracao_ms).toBeGreaterThanOrEqual(0);
  });

  it("função desconhecida ou prevista para etapa futura: 403 e auditada como recusada", async () => {
    const r1 = await tratarChamada(pedido({ funcao: "apagar_cliente", argumentos: { id: 1 } }));
    expect(r1.status).toBe(403);
    expect(r1.body.erro).toMatch(/não existe na lista de funções autorizadas/);
    const r2 = await tratarChamada(pedido({ funcao: "criar_tarefa", argumentos: { titulo: "x" } }));
    expect(r2.status).toBe(403);
    expect(r2.body.erro).toMatch(/prevista para a etapa 3; ainda não liberada/);
    expect((await acoes()).map(a => [a.funcao, a.resultado])).toEqual([["apagar_cliente", "recusada"], ["criar_tarefa", "recusada"]]);
  });

  it("pedido fora do formato ou argumentos inválidos: 400 com o problema, auditado", async () => {
    expect((await tratarChamada(pedido({ funcao: "listar_tarefas", extra: 1 }))).status).toBe(400);
    const r = await tratarChamada(pedido({ funcao: "listar_tarefas", argumentos: { limite: 500 } }));
    expect(r.status).toBe(400);
    expect(r.body.problemas).toEqual([expect.objectContaining({ campo: "limite" })]);
    expect((await tratarChamada(pedido({ funcao: "listar_tarefas", argumentos: { sql: "DELETE FROM leads" } }))).status).toBe(400);
    expect((await acoes()).map(a => a.resultado)).toEqual(["recusada", "recusada", "recusada"]);
  });

  it("falha dentro da função: 500 genérico, auditada como erro, nada vaza", async () => {
    const fn = FUNCOES.find(f => f.nome === "listar_tarefas")!;
    const original = fn.executar;
    fn.executar = async () => { throw new Error("conexão caiu: Bearer abc.def"); };
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await tratarChamada(pedido({ funcao: "listar_tarefas" }));
      expect(r.status).toBe(500);
      expect(JSON.stringify(r.body)).not.toContain("conexão caiu");
    } finally { fn.executar = original; }
    const [a] = await acoes();
    expect(a).toMatchObject({ resultado: "erro", funcao: "listar_tarefas" });
    expect(a.motivo).toContain("Bearer [omitido]");
    expect(a.motivo).not.toContain("abc.def");
  });

  it("consulta lenta: corta no prazo e responde erro", async () => {
    definirDependenciasPonte({ agora: () => AGORA, prazoMs: 20 });
    const fn = FUNCOES.find(f => f.nome === "listar_obras")!;
    const original = fn.executar;
    fn.executar = () => new Promise(r => setTimeout(() => r({ dados: [], resumo: {} }), 500));
    vi.spyOn(console, "error").mockImplementation(() => {});
    try { expect((await tratarChamada(pedido({ funcao: "listar_obras" }))).status).toBe(500); } finally { fn.executar = original; }
    expect((await acoes())[0].motivo).toMatch(/passou de/);
  });

  it("resposta grande demais é cortada e avisada", async () => {
    const fn = FUNCOES.find(f => f.nome === "listar_medicoes")!;
    const original = fn.executar;
    fn.executar = async () => ({ dados: { itens: Array.from({ length: 5000 }, (_, i) => ({ i, texto: "x".repeat(100) })) }, resumo: { encontradas: 5000 } });
    try {
      const r = await tratarChamada(pedido({ funcao: "listar_medicoes" }));
      expect(r.status).toBe(200);
      expect(r.body.truncado).toBe(true);
      expect(JSON.stringify(r.body).length).toBeLessThan(62_000);
    } finally { fn.executar = original; }
    expect((await acoes())[0].resumo).toMatchObject({ truncado: true });
  });
});

describe("pausa e limite", () => {
  it("pausada (dolores_config): recusa tudo, inclusive a lista de ferramentas; despausada volta", async () => {
    await banco.pg.exec("UPDATE dolores_config SET pausada = true, motivo_pausa = 'conferência do dono'");
    const r = await tratarChamada(pedido({ funcao: "listar_tarefas" }));
    expect(r.status).toBe(423);
    expect(r.body.erro).toBe("Dolores pausada: conferência do dono");
    expect((await tratarFerramentas(pedido({}))).status).toBe(423);
    await banco.pg.exec("UPDATE dolores_config SET pausada = false");
    expect((await tratarChamada(pedido({ funcao: "listar_tarefas" }))).status).toBe(200);
    expect((await acoes()).map(a => a.resultado)).toEqual(["recusada", "recusada", "ok"]);
  });

  it("sem a linha de configuração, não executa (falha fechada)", async () => {
    await banco.pg.exec("DELETE FROM dolores_config");
    expect((await tratarChamada(pedido({ funcao: "listar_tarefas" }))).status).toBe(503);
  });

  it("limite por minuto contado no banco (vale entre instâncias)", async () => {
    await banco.pg.exec("UPDATE dolores_config SET limite_por_minuto = 2");
    definirDependenciasPonte({ agora: () => new Date() });
    const status = [];
    for (let i = 0; i < 3; i++) status.push((await tratarChamada(pedido({ funcao: "listar_tarefas" }))).status);
    expect(status).toEqual([200, 200, 429]);
  });

  it("chamadas em paralelo não furam o limite e as recusadas não gastam vaga (L1)", async () => {
    await banco.pg.exec("UPDATE dolores_config SET limite_por_minuto = 3");
    definirDependenciasPonte({ agora: () => new Date("2026-11-16T12:05:10Z") });
    // função inexistente e argumento inválido são recusados antes da vaga
    await tratarChamada(pedido({ funcao: "apagar_cliente" }));
    await tratarChamada(pedido({ funcao: "listar_tarefas", argumentos: { limite: 999 } }));
    const rs = await Promise.all(Array.from({ length: 10 }, () => tratarChamada(pedido({ funcao: "listar_tarefas" }))));
    expect(rs.filter(r => r.status === 200)).toHaveLength(3);
    expect(rs.filter(r => r.status === 429)).toHaveLength(7);
    // o minuto seguinte abre vagas de novo (mesma linha do contador reaproveitada no dia seguinte)
    definirDependenciasPonte({ agora: () => new Date("2026-11-17T12:05:10Z") });
    expect((await tratarChamada(pedido({ funcao: "listar_tarefas" }))).status).toBe(200);
    expect((await banco.pg.query<{ n: number }>("SELECT count(*)::int AS n FROM dolores_limite")).rows[0].n).toBe(1);
  });

  it("pausada: nem a linha da usuária é criada (L7)", async () => {
    await banco.pg.exec("UPDATE dolores_config SET pausada = true");
    expect((await tratarChamada(pedido({ funcao: "listar_tarefas" }))).status).toBe(423);
    expect((await tratarFerramentas(pedido({}))).status).toBe(423);
    expect((await banco.pg.query(`SELECT 1 FROM users WHERE "openId" = '${DOLORES_OPEN_ID}'`)).rows).toHaveLength(0);
  });
});

describe("auditoria", () => {
  it("falha ao gravar não derruba a leitura, mas vai para o log", async () => {
    await banco.pg.exec("DROP TABLE dolores_acoes CASCADE");
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await tratarChamada(pedido({ funcao: "listar_tarefas", argumentos: { situacao: "atrasadas" } }));
    expect(r.status).toBe(200);
    expect((r.body.dados as any).totais.atrasadas).toBe(2);
    expect(erro.mock.calls.map(c => String(c[0]))).toContain("[dolores/auditoria] falha ao gravar a ação");
  });

  it("registro é só inserção: UPDATE e DELETE recusados pelo banco", async () => {
    await tratarChamada(pedido({ funcao: "listar_tarefas" }));
    await expect(banco.pg.exec("UPDATE dolores_acoes SET resultado = 'erro'")).rejects.toThrow(/SOMENTE_INSERCAO/);
    await expect(banco.pg.exec("DELETE FROM dolores_acoes")).rejects.toThrow(/SOMENTE_INSERCAO/);
  });

  it("argumentos saneados: chaves sensíveis omitidas, dígitos longos mascarados, textos cortados", () => {
    expect(sanearArgumentos({ busca: "123.456.789-01", token: "x", senha: "y", texto: "a".repeat(500), lista: Array(50).fill(1) })).toEqual({
      busca: { hash: expect.stringMatching(/^[0-9a-f]{12}$/), tamanho: 14 }, token: "[omitido]", senha: "[omitido]", texto: `${"a".repeat(119)}…`, lista: Array(20).fill(1),
    });
    expect(sanearArgumentos({ responsavel: "fone 99 98888-7777", obs: "111,222,333-44 e 91111222" }))
      .toEqual({ responsavel: "fone [dado pessoal omitido]", obs: "[dado pessoal omitido] e ***22" });
  });

  it("termo de busca nunca fica em claro na auditoria (L2): nome, CPF com vírgula, telefone", async () => {
    for (const busca of ["Excluido Fulano", "111,222,333-44", "11122233344", "91111222", "1111-2222"])
      await tratarChamada(pedido({ funcao: "consultar_cliente", argumentos: { busca } }));
    const guardado = JSON.stringify((await acoes()).map(a => a.argumentos));
    for (const termo of ["Excluido", "Fulano", "111", "222", "333", "91111222", "1111-2222"]) expect(guardado).not.toContain(termo);
    // mesmo termo (sem acento/maiúscula) → mesmo resumo: dá para ver que repetiu a busca sem guardar o termo
    await tratarChamada(pedido({ funcao: "consultar_cliente", argumentos: { busca: "Maria" } }));
    await tratarChamada(pedido({ funcao: "consultar_cliente", argumentos: { busca: "MARÍA" } }));
    const [a, b] = (await acoes()).slice(-2).map(x => x.argumentos.busca.hash);
    expect(a).toBe(b);
  });
});

describe("usuária Dolores", () => {
  it("criada uma vez (idempotente), sem senha, sem e-mail, sem módulos e sem acesso a nenhum procedimento do painel", async () => {
    const a = await usuarioDolores();
    esquecerUsuarioDolores();
    expect(await usuarioDolores()).toBe(a);
    const { rows } = await banco.pg.query<any>(`SELECT * FROM users WHERE "openId" = $1`, [DOLORES_OPEN_ID]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: "user", passwordHash: null, email: null, permissions: "[]", active: true });
    for (const caminho of ["regularizacao.list", "configuracoes.listUsers", "bpo.list", "leads.list"])
      expect(canAccessAdminProcedure({ role: rows[0].role, permissions: rows[0].permissions, active: true }, caminho)).toBe(false);
  });

  it("conta desativada pelo administrador para a ponte (M4), na chamada e na lista de ferramentas", async () => {
    expect((await tratarChamada(pedido({ funcao: "listar_tarefas" }))).status).toBe(200);
    await banco.pg.exec(`UPDATE users SET active = false WHERE "openId" = '${DOLORES_OPEN_ID}'`);
    const r = await tratarChamada(pedido({ funcao: "listar_tarefas" }));
    expect(r.status).toBe(503);
    expect(r.body.erro).toMatch(/desativada no sistema/);
    expect((await tratarFerramentas(pedido({}))).status).toBe(503);
    expect((await acoes())[1]).toMatchObject({ resultado: "recusada", motivo: "usuária Dolores desativada" });
    await banco.pg.exec(`UPDATE users SET active = true WHERE "openId" = '${DOLORES_OPEN_ID}'`);
    expect((await tratarChamada(pedido({ funcao: "listar_tarefas" }))).status).toBe(200);
  });

  it("conta alterada por fora (senha ou perfil) para a ponte", async () => {
    await usuarioDolores();
    await banco.pg.exec(`UPDATE users SET role = 'admin' WHERE "openId" = '${DOLORES_OPEN_ID}'`);
    const r = await tratarChamada(pedido({ funcao: "listar_tarefas" }));
    expect(r.status).toBe(503);
    expect((await acoes())[0]).toMatchObject({ resultado: "erro", autor_user_id: null });
  });
});

describe("ferramentas (fonte única)", () => {
  it("GET lista só as liberadas, com JSON Schema da entrada; o arquivo do dono é igual ao registro", async () => {
    const r = await tratarFerramentas(pedido({}));
    expect(r.status).toBe(200);
    const ferramentas = r.body.ferramentas as any[];
    expect(ferramentas.map(f => f.name)).toEqual([...LIBERADAS_ETAPA_1]);
    expect(ferramentas.every(f => f.input_schema.type === "object" && f.input_schema.additionalProperties === false && f.description.length > 20)).toBe(true);
    const arquivo = JSON.parse(readFileSync(new URL("../../docs/dolores/ferramentas-etapa1.json", import.meta.url), "utf8"));
    expect(arquivo.ferramentas).toEqual(ferramentasLiberadas());
    expect((await acoes())[0]).toMatchObject({ funcao: "listar_ferramentas", resultado: "ok" });
  });

  it("toda função liberada existe no registro e é de leitura (etapa 1)", () => {
    for (const nome of LIBERADAS_ETAPA_1) {
      expect(funcaoLiberada(nome)).toBe(true);
      expect(funcaoPorNome(nome)?.tipo).toBe("leitura");
    }
    expect(FUNCOES.every(f => funcaoLiberada(f.nome))).toBe(true);
  });

  it("rotas montadas no servidor local e na função da Vercel", () => {
    for (const arquivo of ["../../api/index.ts", "../_core/index.ts"]) {
      const fonte = readFileSync(new URL(arquivo, import.meta.url), "utf8");
      expect(fonte).toMatch(/import doloresPonteRotas from "\.\.\/(server\/)?dolores\/ponte\.js"/);
      expect(fonte).toMatch(/use\((?:"\/api", )?doloresPonteRotas\)/);
    }
  });
});

describe("filtro na saída da ponte (M1)", () => {
  it("anotação, mensagem, observação e descrição de cobrança com dados pessoais saem filtradas", async () => {
    await banco.pg.exec(`
      INSERT INTO lead_activities (lead_id, type, description, performed_by, created_at) VALUES (2, 'note', 'Senha do gov.br 1234; CPF 111.222.333-44; conta 12345-6 ag 0001', 'Bia', '2026-11-16 11:00');
      INSERT INTO whatsapp_messages (connection_id, lead_id, destinatario, mensagem, direcao, lida, created_at) VALUES (1, 1, '5599991234567', 'meu e-mail é maria@x.com e o tel (99) 99123-4567', 'entrada', false, '2026-11-16 11:00');
      UPDATE bpo_lancamentos SET descricao = 'Honorários — PIX 52998224725' WHERE id = 1;
      UPDATE regularizacoes SET notes = 'cliente passou a senha 9988 do portal' WHERE id = 2;`);
    const respostas = [];
    for (const [funcao, argumentos] of [["historico_atendimento", { leadId: 2 }], ["conversas_whatsapp", { leadId: 1 }], ["listar_recebiveis_pendentes", {}],
      ["detalhar_processo_regularizacao", { id: 2 }]] as const) respostas.push(await tratarChamada(pedido({ funcao, argumentos })));
    const tudo = JSON.stringify(respostas.map(r => r.body));
    expect(respostas.map(r => r.status)).toEqual([200, 200, 200, 200]);
    for (const vazado of ["111.222.333-44", "12345-6", "ag 0001", "gov.br 1234", "maria@x.com", "99123-4567", "52998224725", "9988"]) expect(tudo).not.toContain(vazado);
    for (const marcador of ["[senha omitida]", "[dado bancário omitido]", "[dado pessoal omitido]"]) expect(tudo).toContain(marcador);
  });
});
