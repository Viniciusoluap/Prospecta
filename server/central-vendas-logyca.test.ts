// Central de Vendas — etapa 10: adaptador Logyca (desligado por padrão). Só o que a documentação confirma:
// envio POST com Bearer e { number, message }; entrada pelo bloco "HTTP Request" com token próprio. fetch simulado.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", async orig => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste", anthropicApiKey: "" } }));

import { getDb } from "./db.js";
import { montarCenario, NUMERO_TESTE, type Cenario } from "./__fixtures__/central-vendas/cenario.js";
import { cifrar, definirDependencias } from "./central-vendas/base.js";
import { enfileirarTemplate, processarFila } from "./central-vendas/envio.js";
import { enviarLogyca } from "./central-vendas/logyca.js";
import { tratarEntrada } from "./central-vendas/rotas.js";
import { configSchema } from "../shared/central-vendas/config.js";

describe("envio pela Logyca", () => {
  it("POST no endpoint de 'Mensagens API' com Bearer e { number, message }", async () => {
    const f = vi.fn(async (_u: string, _i: RequestInit) => new Response("{}", { status: 200 }));
    const r = await enviarLogyca({ endpoint: "https://api.logyca.exemplo/mensagens", token: "tk" }, "99 98888-7777", "Olá", f as never);
    expect(r).toEqual({ ok: true, status: 200 });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.logyca.exemplo/mensagens");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer tk", "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({ number: "5599988887777", message: "Olá" });
  });
  it("recusa endpoint sem https e trata erro HTTP e rede sem lançar", async () => {
    expect(await enviarLogyca({ endpoint: "http://x.exemplo", token: "t" }, "1", "m")).toMatchObject({ ok: false, erro: expect.stringContaining("https") });
    expect(await enviarLogyca({ endpoint: "https://x.exemplo", token: "t" }, "1", "m", (async () => new Response("", { status: 401 })) as never)).toMatchObject({ ok: false, status: 401 });
    expect(await enviarLogyca({ endpoint: "https://x.exemplo", token: "t" }, "1", "m", (async () => { throw new Error("rede"); }) as never)).toMatchObject({ ok: false, status: 0 });
  });
  it("a flag começa desligada", () => {
    expect(configSchema.parse({}).logyca).toEqual({ ativo: false, usarParaEnvio: false, endpointEnvio: "" });
  });
});

describe("Logyca integrada à Central", () => {
  let c: Cenario;
  beforeEach(async () => {
    c = await montarCenario(db => vi.mocked(getDb).mockReturnValue(db as never));
    definirDependencias({ enviar: null }); // usa o envio padrão (Logyca), com fetch simulado
    await c.pg.exec("INSERT INTO leads (name, phone) VALUES ('Ana', '99988887777'); INSERT INTO central_vendas_leads (lead_id, operador_id) VALUES (1, 2)");
  });
  afterEach(async () => { vi.unstubAllGlobals(); definirDependencias(); await c.pg.close(); });

  it("ligada para envio: a fila manda pela Logyca; falha vai para reprocessamento", async () => {
    await c.salvarConfig({ logyca: { ativo: true, usarParaEnvio: true, endpointEnvio: "https://api.logyca.exemplo/mensagens" }, segredos: { tokenLogycaEnvio: cifrar("tk-envio") } });
    const f = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", f);
    await enfileirarTemplate({ leadId: 1, slug: "cv-sem-resposta", chave: "x1", proativa: false });
    await processarFila();
    expect(await c.linhas("SELECT status, tentativas FROM central_vendas_fila")).toEqual([{ status: "pendente", tentativas: 1 }]);
    f.mockImplementation(async () => new Response("{}", { status: 200 }));
    c.avancar(2);
    await processarFila();
    expect(await c.linhas("SELECT status FROM central_vendas_fila")).toEqual([{ status: "concluido" }]);
    expect(f).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body)).number).toBe("5599988887777");
  });

  it("entrada da Logyca exige o token próprio e não aciona a IA", async () => {
    const req = (t: string) => ({ headers: { authorization: `Bearer ${t}` }, body: { telefone: "5599977776666", nome: "Caio", mensagem: "Quero saber do Colina", idExterno: "lg-9" }, ip: "2.2.2.2" });
    await c.salvarConfig({ numerosTeste: [NUMERO_TESTE, "5599977776666"], logyca: { ativo: true, usarParaEnvio: false, endpointEnvio: "" }, segredos: { tokenLogycaEntrada: cifrar("tk-in") } });
    expect((await tratarEntrada("logyca", req("errado"))).status).toBe(401);
    expect(await tratarEntrada("logyca", req("tk-in"))).toMatchObject({ status: 200, body: { novo: true } });
    expect(await tratarEntrada("logyca", req("tk-in"))).toMatchObject({ status: 200, body: { novo: false } });
    expect(c.chamadasIA).toHaveLength(0);
    expect(await c.linhas("SELECT origem, id_externo FROM central_vendas_leads WHERE lead_id = 2")).toEqual([{ origem: "logyca", id_externo: "lg-9" }]);
  });
});
