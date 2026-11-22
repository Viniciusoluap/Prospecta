// EPIC-029 S-1 — portão de QA (@qa Quinn, 22/11/2026): tentativas de quebrar a consulta de CNPJ/CEP.
// Nenhum teste usa a rede externa: o fetch real só fala com um servidor local (127.0.0.1) para conferir tempo-limite e
// tamanho; o resto usa fetch simulado. Os achados (antes `it.fails`) foram corrigidos pelo @dev e viraram `it` comuns.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { limparTexto, separarPreenchimento } from "../shared/consulta-cadastral";
import {
  buscarCep, buscarCnpjNaBrasilApi, FalhaConsultaCadastral, HOST_BRASIL_API, HOST_VIACEP, mapearCnpj, type Buscar,
} from "./_core/brasilapi";
import {
  consultarCep, consultarCnpj, criarLimitador, definirDependenciasDoRouterParaTeste, type CacheCadastral,
} from "./consulta-cadastral";
import { appRouter } from "./routers";

const CNPJ = "19131243000197";
const CEP = "65900000";
const AGORA = new Date("2026-11-22T12:00:00Z");

const respostaCnpj = (extra: Record<string, unknown> = {}) => ({
  uf: "SP", cep: "01311902", cnpj: CNPJ, bairro: "BELA VISTA", numero: "37", municipio: "SAO PAULO", logradouro: "PAULISTA 37",
  cnae_fiscal: 9430800, complemento: "ANDAR 4", razao_social: "OPEN KNOWLEDGE BRASIL", nome_fantasia: "REDE",
  situacao_cadastral: 2, descricao_situacao_cadastral: "ATIVA", cnae_fiscal_descricao: "Associações",
  codigo_municipio_ibge: 3550308, descricao_tipo_de_logradouro: "AVENIDA",
  qsa: [{ nome_socio: "FULANA DE TAL", cnpj_cpf_do_socio: "***112108**", qualificacao_socio: "Presidente" }],
  ddd_telefone_1: "1123851939", email: "contato@exemplo.org", capital_social: 1000,
  ...extra,
});
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

function simulado(rotas: Record<string, () => Response | Promise<Response>>) {
  const chamadas: string[] = [];
  const buscar: Buscar = async url => {
    chamadas.push(url);
    const host = Object.keys(rotas).find(h => url.startsWith(h));
    if (!host) throw new Error("host não simulado");
    return rotas[host]();
  };
  return { buscar, chamadas };
}

function cacheEmMemoria() {
  const linhas = new Map<string, { resposta: unknown; fonte: "brasilapi" | "viacep"; consultadoEm: Date }>();
  const cache: CacheCadastral = {
    ler: async (tipo, chave) => linhas.get(`${tipo}:${chave}`) ?? null,
    gravar: async (tipo, chave, resposta, fonte, quando) => { linhas.set(`${tipo}:${chave}`, { resposta: structuredClone(resposta), fonte, consultadoEm: quando }); },
  };
  return { cache, linhas };
}

describe("QA 1 — SSRF / repasse aberto", () => {
  afterEach(() => vi.restoreAllMocks());

  it("o fetch padrão vai só ao host fixo, com redirect: 'error' e sinal de tempo-limite", async () => {
    const espiao = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(respostaCnpj()));
    await buscarCnpjNaBrasilApi("19.131.243/0001-97");
    expect(espiao).toHaveBeenCalledTimes(1);
    const [url, init] = espiao.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${HOST_BRASIL_API}/api/cnpj/v1/${CNPJ}`);
    expect(new URL(url).host).toBe("brasilapi.com.br");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("CEP: Brasil API e ViaCEP, sempre com redirect: 'error'", async () => {
    const espiao = vi.spyOn(globalThis, "fetch").mockImplementation(async (u) =>
      String(u).startsWith(HOST_BRASIL_API) ? json({}, 500) : json({ localidade: "Imperatriz", uf: "MA" }));
    await buscarCep("65900-000");
    const hosts = espiao.mock.calls.map(c => new URL(String(c[0])).host);
    expect(hosts).toEqual(["brasilapi.com.br", "viacep.com.br"]);
    for (const c of espiao.mock.calls) expect((c[1] as RequestInit).redirect).toBe("error");
  });

  it("nenhuma entrada estranha muda o caminho da URL (path traversal, %2F, letras com dígito errado, unicode)", async () => {
    const { buscar, chamadas } = simulado({ [HOST_BRASIL_API]: () => json(respostaCnpj()) });
    for (const v of ["../19131243000197", "19131243%2F000197", "１９１３１２４３０００１９７", "19131243000197#", "AB.CDE.FGH/IJKL-00", " "]) {
      await buscarCnpjNaBrasilApi(v, buscar).catch(() => null);
    }
    for (const u of chamadas) expect(u).toMatch(/^https:\/\/brasilapi\.com\.br\/api\/cnpj\/v1\/[0-9A-Z]{12}[0-9]{2}$/);
  });

  describe("fetch real contra servidor local (tempo-limite cobre o corpo; tamanho máximo)", () => {
    let servidor: Server;
    let base = "";
    beforeAll(async () => {
      servidor = createServer((req, res) => {
        if (req.url === "/lento") {
          res.writeHead(200, { "content-type": "application/json" });
          res.write('{"razao_social":"'); // nunca termina
          return;
        }
        if (req.url === "/grande") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(respostaCnpj({ lixo: "x".repeat(300_000) })));
          return;
        }
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
        res.end();
      });
      await new Promise<void>(r => servidor.listen(0, "127.0.0.1", r));
      base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    });
    afterAll(() => { servidor.closeAllConnections?.(); servidor.close(); });

    const via = (caminho: string): Buscar => (_url, init) => fetch(`${base}${caminho}`, { ...init, redirect: "error" });

    it("corpo que nunca termina é cortado pelo tempo-limite (indisponível, sem pendurar)", async () => {
      const inicio = Date.now();
      await expect(buscarCnpjNaBrasilApi(CNPJ, via("/lento"), 300)).rejects.toMatchObject({ motivo: "indisponivel" });
      expect(Date.now() - inicio).toBeLessThan(3000);
    });

    it("resposta acima de 200 KB é recusada e não vira dado", async () => {
      await expect(buscarCnpjNaBrasilApi(CNPJ, via("/grande"), 3000)).rejects.toMatchObject({ motivo: "resposta_invalida" });
    });

    it("redirecionamento (ex.: para metadados da nuvem) não é seguido", async () => {
      await expect(buscarCnpjNaBrasilApi(CNPJ, via("/redireciona"), 3000)).rejects.toMatchObject({ motivo: "indisponivel" });
    });
  });
});

describe("QA 2 — permissão e limite pelos procedimentos tRPC", () => {
  const caller = (id: number, role: string, permissoes: string[] = [], active: boolean | null = true) =>
    appRouter.createCaller({ user: { id, role, active, permissions: JSON.stringify(permissoes) }, req: { headers: {} }, res: {} } as never);
  let rede: ReturnType<typeof simulado>;
  beforeEach(() => {
    rede = simulado({ [HOST_BRASIL_API]: () => json(respostaCnpj()), [HOST_VIACEP]: () => json({ localidade: "Imperatriz", uf: "MA" }) });
    definirDependenciasDoRouterParaTeste({ buscar: rede.buscar, cache: cacheEmMemoria().cache, agora: () => AGORA }, criarLimitador(30));
  });
  afterEach(() => definirDependenciasDoRouterParaTeste({}, criarLimitador()));

  it("colaborador INATIVO com BPO/Obras não consulta CNPJ nem CEP", async () => {
    await expect(caller(40, "colaborador", ["bpo", "obras"], false).consultaCadastral.cnpj({ cnpj: CNPJ })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(40, "colaborador", ["bpo"], false).consultaCadastral.cep({ cep: CEP })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(rede.chamadas).toEqual([]);
  });

  it("colaborador sem nenhum módulo, com módulos de outras telas, ou com permissão malformada não consulta CNPJ", async () => {
    for (const p of [[], ["crm", "agenda", "juridico", "incorporacao", "whatsapp"]]) {
      await expect(caller(41, "colaborador", p).consultaCadastral.cnpj({ cnpj: CNPJ })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const malformado = appRouter.createCaller({ user: { id: 42, role: "colaborador", active: true, permissions: "{bpo" }, req: { headers: {} }, res: {} } as never);
    await expect(malformado.consultaCadastral.cnpj({ cnpj: CNPJ })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(rede.chamadas).toEqual([]);
  });

  it("empreiteiro e corretor com módulos 'bpo' gravados nas permissões continuam sem CNPJ", async () => {
    for (const role of ["empreiteiro", "corretor", "cliente"]) {
      await expect(caller(43, role, ["bpo", "obras"]).consultaCadastral.cnpj({ cnpj: CNPJ })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(rede.chamadas).toEqual([]);
  });

  it("consultas bloqueadas pelo limite não chegam à rede nem ao cache", async () => {
    definirDependenciasDoRouterParaTeste({ buscar: rede.buscar, cache: cacheEmMemoria().cache, agora: () => AGORA }, criarLimitador(2));
    const c = caller(44, "admin");
    await c.consultaCadastral.cnpj({ cnpj: CNPJ });
    await c.consultaCadastral.cep({ cep: CEP });
    const antes = rede.chamadas.length;
    await expect(c.consultaCadastral.cnpj({ cnpj: "11222333000181" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(rede.chamadas.length).toBe(antes);
  });

  it("variações do mesmo CNPJ (máscara, espaços, minúsculas) não furam o cache: uma ida à rede só", async () => {
    const c = caller(45, "admin");
    for (const v of [CNPJ, "19.131.243/0001-97", " 19131243000197 ", "19 131 243 0001 97"]) await c.consultaCadastral.cnpj({ cnpj: v });
    expect(rede.chamadas.length).toBe(1);
  });
});

describe("QA 3 — dados: o que vai para o cache e para a tela", () => {
  it("QSA, telefone, e-mail e capital social NÃO vão para a tela nem para o cache", async () => {
    const { cache, linhas } = cacheEmMemoria();
    const r = await consultarCnpj(CNPJ, { buscar: simulado({ [HOST_BRASIL_API]: () => json(respostaCnpj()) }).buscar, cache, agora: () => AGORA });
    const tela = JSON.stringify(r);
    const guardado = JSON.stringify([...linhas.values()]);
    for (const s of [tela, guardado]) {
      for (const proibido of ["FULANA", "***112108**", "qsa", "socio", "1123851939", "contato@exemplo.org", "capital", "lixo"]) {
        expect(s).not.toContain(proibido);
      }
    }
    expect(guardado).not.toContain("alerta");
  });

  it("nenhum console.* recebe o CNPJ ou o CEP em falha de rede, banco fora ou erro inesperado", async () => {
    const espioes = (["log", "warn", "error", "info", "debug"] as const).map(m => vi.spyOn(console, m).mockImplementation(() => {}));
    const cacheQuebrado: CacheCadastral = { ler: async () => { throw new Error(`falhou ${CNPJ}`); }, gravar: async () => { throw new Error(CNPJ); } };
    await consultarCnpj(CNPJ, { buscar: async () => { throw new Error(`rede caiu ${CNPJ}`); }, cache: cacheQuebrado }).catch(() => null);
    await consultarCep(CEP, { buscar: async () => { throw new Error(`rede caiu ${CEP}`); }, cache: cacheQuebrado }).catch(() => null);
    definirDependenciasDoRouterParaTeste({ buscar: async () => { throw new TypeError(`fetch failed ${CNPJ}`); }, cache: { ler: async () => null, gravar: async () => {} } }, criarLimitador(30));
    const admin = appRouter.createCaller({ user: { id: 50, role: "admin", active: true, permissions: "[]" }, req: { headers: {} }, res: {} } as never);
    const r = await admin.consultaCadastral.cnpj({ cnpj: CNPJ });
    definirDependenciasDoRouterParaTeste({}, criarLimitador());
    expect(JSON.stringify(r)).not.toContain(CNPJ);
    for (const e of espioes) for (const chamada of e.mock.calls) expect(JSON.stringify(chamada.map(String))).not.toMatch(new RegExp(`${CNPJ}|${CEP}`));
    vi.restoreAllMocks();
  });

  it("HTML/script vindo da Receita sai limpo (sem < >) em todos os campos", async () => {
    const xss = '<img src=x onerror=alert(1)>EMPRESA<script>alert(2)</script>';
    const d = mapearCnpj(respostaCnpj({ razao_social: xss, nome_fantasia: "<svg/onload=alert(3)", logradouro: "RUA <b>A</b>", cnae_fiscal_descricao: "a<iframe" }), CNPJ);
    expect(JSON.stringify(d)).not.toMatch(/[<>]/);
  });

  it("resposta 5xx, 429, malformada ou sem razão social não entra no cache", async () => {
    const { cache, linhas } = cacheEmMemoria();
    for (const resposta of [() => json({}, 502), () => json({}, 429), () => new Response("<html>oops</html>", { status: 200 }), () => json({ razao_social: "" }), () => json([respostaCnpj()]), () => json("texto")]) {
      await consultarCnpj(CNPJ, { buscar: simulado({ [HOST_BRASIL_API]: resposta }).buscar, cache, agora: () => AGORA }).catch(() => null);
    }
    expect(linhas.size).toBe(0);
  });

  it("cache envenenado diretamente no banco (campo extra, HTML) não devolve campo extra para a tela", async () => {
    const { cache, linhas } = cacheEmMemoria();
    linhas.set(`cnpj:${CNPJ}`, {
      resposta: { cnpj: CNPJ, razaoSocial: "X", nomeFantasia: null, situacao: "ATIVA", cnaePrincipal: null, qsa: [{ cpf: "123" }],
        endereco: { cep: null, logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null, codigoIbge: null } },
      fonte: "brasilapi", consultadoEm: AGORA,
    });
    const r = await consultarCnpj(CNPJ, { buscar: async () => { throw new Error("não devia ir à rede"); }, cache, agora: () => AGORA });
    expect(r.doCache).toBe(true);
    expect(JSON.stringify(r)).not.toContain("qsa");
  });

  // ACHADO (baixo): caracteres invisíveis de direção (bidi, U+202E) e de largura zero passam pela limpeza — dá para
  // inverter visualmente o nome na tela ("Trojan Source"). Origem: shared/consulta-cadastral.ts:91 só remove C0/C1, U+2028/2029.
  it("ACHADO baixo (corrigido) — limparTexto remove controles bidi e de largura zero", () => {
    const t = limparTexto("EMPRESA‮ATNOC‬ LTDA​", 150);
    expect(t).not.toMatch(/[​-‏‪-‮⁦-⁩﻿]/);
  });

  // ACHADO (baixo): a resposta da Brasil API para um CNPJ é aceita mesmo quando o "cnpj" do corpo é OUTRO — o resultado
  // é gravado no cache sob o CNPJ pedido. Defesa em profundidade contra resposta trocada. server/_core/brasilapi.ts:115-130.
  it("ACHADO baixo (corrigido) — resposta com CNPJ diferente do pedido é recusada", () => {
    expect(() => mapearCnpj(respostaCnpj({ cnpj: "11222333000181" }), CNPJ)).toThrow(FalhaConsultaCadastral);
  });

  // ACHADO (médio, LGPD): o MEI tem o CPF do dono dentro da razão social ("NOME DA PESSOA 12345678909"). A consulta guarda
  // esse CPF no cache por 30 dias e o preenche no campo de nome do cadastro. A story diz que CPF parcial do QSA não sai do
  // serviço, mas o CPF COMPLETO do MEI sai pela razão social. server/_core/brasilapi.ts:119 e server/consulta-cadastral.ts:111.
  it("ACHADO médio (corrigido) — CPF completo de MEI na razão social não vai para o cache nem para a tela", async () => {
    const { cache, linhas } = cacheEmMemoria();
    const r = await consultarCnpj(CNPJ, {
      buscar: simulado({ [HOST_BRASIL_API]: () => json(respostaCnpj({ razao_social: "FULANO DE TAL 52998224725" })) }).buscar, cache, agora: () => AGORA,
    });
    // O próprio CNPJ (14 números) faz parte da resposta; o que não pode aparecer é o CPF de 11 números.
    expect(JSON.stringify(r).replaceAll(CNPJ, "")).not.toMatch(/\d{11}/);
    expect(JSON.stringify([...linhas.values()]).replaceAll(CNPJ, "")).not.toMatch(/\d{11}/);
  });
});

describe("QA 4 — tela: nunca sobrescreve em silêncio", () => {
  it("campo com só espaços conta como vazio; com valor diferente vira conflito; igual (caixa diferente) não muda nada", () => {
    const r = separarPreenchimento({ a: "   ", b: "Minha Empresa", c: "open knowledge brasil", d: undefined }, { a: "X", b: "OUTRA", c: "OPEN KNOWLEDGE BRASIL", d: null });
    expect(r).toEqual({ vazios: { a: "X" }, conflitos: { b: "OUTRA" } });
  });

  it("o hook não dispara envio/salvamento: só chama aplicar() com os campos vazios (sem submit nem mutate de cadastro)", () => {
    const hook = readFileSync("client/src/hooks/useAutoPreenchimentoCadastral.ts", "utf8");
    expect(hook).not.toMatch(/submit|requestSubmit|\.mutate\(/);
    const telas = ["client/src/pages/admin/AdminBpo.tsx", "client/src/pages/admin/TaxAccountingPanel.tsx", "client/src/components/obra/FinanceiroObra.tsx",
      "client/src/components/admin/PerfilEngenheiroPanel.tsx", "client/src/pages/Perfil.tsx", "client/src/components/AvisoConsultaCadastral.tsx"];
    expect(readFileSync("client/src/components/AvisoConsultaCadastral.tsx", "utf8")).not.toContain("dangerouslySetInnerHTML");
    for (const t of telas) {
      const fonte = readFileSync(t, "utf8");
      // Cada `aplicar` das telas só mescla o patch no estado do formulário.
      for (const m of fonte.matchAll(/aplicar: patch => ([^\n]+)/g)) expect(m[1]).toMatch(/^set\w+\(\w+ => \(\{ \.\.\.\w+, \.\.\.patch \}\)\),$/);
    }
  });
});

describe("QA 5 — migração 0152 só aditiva", () => {
  it("sem DROP/ALTER/DELETE/UPDATE/TRUNCATE; só CREATE ... IF NOT EXISTS", () => {
    const sql = readFileSync("drizzle/0152_consultas_cadastrais_cache.sql", "utf8").replace(/--[^\n]*/g, "");
    expect(sql).not.toMatch(/\b(DROP|ALTER|DELETE|UPDATE|TRUNCATE|INSERT|GRANT|REVOKE)\b/i);
    const comandos = sql.split(";").map(s => s.trim()).filter(Boolean);
    expect(comandos.length).toBe(3);
    for (const c of comandos) expect(c).toMatch(/^CREATE (UNIQUE )?(TABLE|INDEX) IF NOT EXISTS/);
  });
});
