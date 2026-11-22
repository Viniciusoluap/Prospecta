// EPIC-029 S-1 — cadastro automático por CNPJ e CEP: serviço com fetch simulado (nenhum teste usa a rede), cache,
// limite por usuário, permissão e a migração 0152 aplicada duas vezes num banco em memória.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  alertaDaSituacao, cepParaConsulta, cnpjParaConsulta, enderecoEmLinha, limparTexto, semCpf, separarPreenchimento,
} from "../shared/consulta-cadastral";
import { buscarCep, buscarCnpjNaBrasilApi, FalhaConsultaCadastral, HOST_BRASIL_API, HOST_VIACEP, type Buscar } from "./_core/brasilapi";
import { canAccessAdminProcedure } from "./_core/trpc";
import {
  cacheNoBanco, consultarCep, consultarCnpj, criarLimitador, definirDependenciasDoRouterParaTeste, LIMITE_POR_MINUTO,
  VALIDADE_DO_CACHE_MS, type CacheCadastral,
} from "./consulta-cadastral";
import { appRouter } from "./routers";
import type { DrizzleDb } from "./db";

const CNPJ = "19131243000197"; // exemplo da documentação oficial da Brasil API (dígitos válidos)
const CNPJ_FORMATADO = "19.131.243/0001-97";
const CEP = "65900000";
const AGORA = new Date("2026-11-22T12:00:00Z");

const respostaCnpj = (extra: Record<string, unknown> = {}) => ({
  uf: "SP", cep: "01311902", cnpj: CNPJ, bairro: "BELA VISTA", numero: "37", municipio: "SAO PAULO", logradouro: "PAULISTA 37",
  cnae_fiscal: 9430800, complemento: "ANDAR 4", razao_social: "OPEN KNOWLEDGE BRASIL", nome_fantasia: "REDE PELO CONHECIMENTO LIVRE",
  situacao_cadastral: 2, descricao_situacao_cadastral: "ATIVA", cnae_fiscal_descricao: "Atividades de associações de defesa de direitos sociais",
  codigo_municipio_ibge: 3550308, descricao_tipo_de_logradouro: "AVENIDA", qsa: [{ nome_socio: "FULANA", cnpj_cpf_do_socio: "***112108**" }],
  ...extra,
});
const respostaCepV2 = { cep: CEP, state: "MA", city: "Imperatriz", neighborhood: "Centro", street: "Rua Coronel Manoel Bandeira", service: "open-cep", location: { type: "Point", coordinates: {} }, ibge: { city: "2105302", state: "21" } };
const respostaViaCep = { cep: "65900-000", logradouro: "", complemento: "", bairro: "", localidade: "Imperatriz", uf: "MA", ibge: "2105302", gia: "", ddd: "99", siafi: "0921" };

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

/** fetch simulado: responde por host e guarda as URLs chamadas. */
function simulado(rotas: Record<string, () => Response | Promise<Response>>) {
  const chamadas: string[] = [];
  const buscar: Buscar = async (url, init) => {
    chamadas.push(url);
    const host = Object.keys(rotas).find(h => url.startsWith(h));
    if (!host) throw new Error("host não simulado");
    if (init.signal.aborted) throw new DOMException("abortado", "AbortError");
    return rotas[host]();
  };
  return { buscar, chamadas };
}

function cacheEmMemoria(): CacheCadastral & { linhas: Map<string, { resposta: unknown; fonte: "brasilapi" | "viacep"; consultadoEm: Date }> } {
  const linhas = new Map<string, { resposta: unknown; fonte: "brasilapi" | "viacep"; consultadoEm: Date }>();
  return {
    linhas,
    ler: async (tipo, chave) => linhas.get(`${tipo}:${chave}`) ?? null,
    gravar: async (tipo, chave, resposta, fonte, quando) => { linhas.set(`${tipo}:${chave}`, { resposta: structuredClone(resposta), fonte, consultadoEm: quando }); },
  };
}

describe("regras comuns (shared/consulta-cadastral)", () => {
  it("CNPJ só consulta com 14 caracteres e dígito certo; CPF (11 números) nunca vira consulta", () => {
    expect(cnpjParaConsulta(CNPJ_FORMATADO)).toBe(CNPJ);
    expect(cnpjParaConsulta("19.131.243/0001-98")).toBeNull();
    expect(cnpjParaConsulta("00000000000000")).toBeNull();
    expect(cnpjParaConsulta("529.982.247-25")).toBeNull();
    expect(cnpjParaConsulta("1913124300019")).toBeNull();
  });

  it("CEP só consulta com 8 números", () => {
    expect(cepParaConsulta("65900-000")).toBe(CEP);
    expect(cepParaConsulta("6590000")).toBeNull();
    expect(cepParaConsulta("00000-000")).toBeNull();
  });

  it("alerta para toda situação que não é ATIVA", () => {
    expect(alertaDaSituacao("ATIVA")).toBeNull();
    for (const s of ["INAPTA", "BAIXADA", "SUSPENSA", "NULA"]) expect(alertaDaSituacao(s)).toContain(s);
    expect(alertaDaSituacao(null)).toMatch(/não informou/);
  });

  it("limpa HTML, caracteres de controle e corta no tamanho máximo", () => {
    expect(limparTexto("<script>alert(1)</script>EMPRESA <b>X</b>\u0000 LTDA")).toBe("alert(1) EMPRESA X LTDA");
    expect(limparTexto("a".repeat(500), 10)).toHaveLength(10);
    expect(limparTexto("   ")).toBeNull();
    expect(limparTexto({ x: 1 })).toBeNull();
  });

  it("preenche só os campos vazios; o que o usuário digitou diferente vira conflito (nunca sobrescreve em silêncio)", () => {
    const r = separarPreenchimento(
      { razaoSocial: "Minha Empresa", cidade: "", bairro: "centro", uf: undefined },
      { razaoSocial: "OUTRA LTDA", cidade: "Imperatriz", bairro: "Centro", uf: "MA" },
    );
    expect(r.vazios).toEqual({ cidade: "Imperatriz", uf: "MA" });
    expect(r.conflitos).toEqual({ razaoSocial: "OUTRA LTDA" });
  });

  it("tira o CPF (com ou sem pontuação) da razão social de MEI e não mexe em outros números", () => {
    expect(semCpf("FULANO DE TAL 52998224725")).toBe("FULANO DE TAL");
    expect(semCpf("52998224725 FULANO")).toBe("FULANO");
    expect(semCpf("FULANO - 529.982.247-25 ME")).toBe("FULANO - ME");
    expect(semCpf("CONSTRUTORA 2000 LTDA")).toBe("CONSTRUTORA 2000 LTDA");
    expect(semCpf("12345678901234")).toBe("12345678901234");
    expect(semCpf("52998224725")).toBeNull();
  });

  it("remove invisíveis de largura zero e de direção (bidi)", () => {
    expect(limparTexto("EMPRESA\u202eATNOC\u202c LTDA\u200b\ufeff")).toBe("EMPRESA ATNOC LTDA");
  });

  it("endereço em uma linha", () => {
    expect(enderecoEmLinha({ logradouro: "Rua A", numero: "10", complemento: "sala 2", bairro: "Centro" }, true)).toBe("Rua A, 10 - sala 2 - Centro");
    expect(enderecoEmLinha({ logradouro: null, numero: null, complemento: null, bairro: null })).toBeNull();
  });
});

describe("CNPJ na Brasil API (fetch simulado)", () => {
  it("sucesso: razão social, fantasia, endereço completo, situação, CNAE e código IBGE; host fixo", async () => {
    const { buscar, chamadas } = simulado({ [HOST_BRASIL_API]: () => json(respostaCnpj()) });
    const d = await buscarCnpjNaBrasilApi(CNPJ_FORMATADO, buscar);
    expect(chamadas).toEqual([`${HOST_BRASIL_API}/api/cnpj/v1/${CNPJ}`]);
    expect(d).toMatchObject({
      cnpj: CNPJ, razaoSocial: "OPEN KNOWLEDGE BRASIL", nomeFantasia: "REDE PELO CONHECIMENTO LIVRE", situacao: "ATIVA", alerta: null,
      cnaePrincipal: { codigo: "9430800" },
      endereco: { cep: "01311902", logradouro: "AVENIDA PAULISTA 37", numero: "37", complemento: "ANDAR 4", bairro: "BELA VISTA", cidade: "SAO PAULO", uf: "SP", codigoIbge: "3550308" },
    });
    // Sócios (com CPF parcial) não saem do serviço.
    expect(JSON.stringify(d)).not.toContain("FULANA");
  });

  it("CNPJ inválido não chama a rede", async () => {
    const { buscar, chamadas } = simulado({ [HOST_BRASIL_API]: () => json(respostaCnpj()) });
    await expect(buscarCnpjNaBrasilApi("19.131.243/0001-98", buscar)).rejects.toMatchObject({ motivo: "invalido" });
    await expect(consultarCnpj("123", { buscar, cache: cacheEmMemoria() })).rejects.toMatchObject({ motivo: "invalido" });
    expect(chamadas).toEqual([]);
  });

  it.each([[4, "INAPTA"], [8, "BAIXADA"], [3, "SUSPENSA"], [1, "NULA"]])("situação %s devolve alerta (%s)", async (codigo, nome) => {
    const { buscar } = simulado({ [HOST_BRASIL_API]: () => json(respostaCnpj({ situacao_cadastral: codigo, descricao_situacao_cadastral: undefined })) });
    const d = await buscarCnpjNaBrasilApi(CNPJ, buscar);
    expect(d.situacao).toBe(nome);
    expect(d.alerta).toContain(nome);
  });

  it("404 = não encontrado; 503 = indisponível", async () => {
    await expect(buscarCnpjNaBrasilApi(CNPJ, simulado({ [HOST_BRASIL_API]: () => json({ message: "x" }, 404) }).buscar)).rejects.toMatchObject({ motivo: "nao_encontrado" });
    await expect(buscarCnpjNaBrasilApi(CNPJ, simulado({ [HOST_BRASIL_API]: () => json({ message: "x" }, 503) }).buscar)).rejects.toMatchObject({ motivo: "indisponivel" });
  });

  it("resposta malformada (não JSON, sem razão social, lista no lugar de objeto) é recusada", async () => {
    for (const r of [() => new Response("<html>erro</html>", { status: 200 }), () => json({ cnpj: CNPJ }), () => json([1, 2])]) {
      await expect(buscarCnpjNaBrasilApi(CNPJ, simulado({ [HOST_BRASIL_API]: r }).buscar)).rejects.toMatchObject({ motivo: "resposta_invalida" });
    }
  });

  it("campos com tipo errado são tolerados (viram vazio) e HTML é limpo", async () => {
    const { buscar } = simulado({ [HOST_BRASIL_API]: () => json(respostaCnpj({ nome_fantasia: { a: 1 }, bairro: 42, razao_social: "<img src=x onerror=1>EMPRESA" })) });
    const d = await buscarCnpjNaBrasilApi(CNPJ, buscar);
    expect(d.nomeFantasia).toBeNull();
    expect(d.endereco.bairro).toBe("42");
    expect(d.razaoSocial).toBe("EMPRESA");
  });

  it("tempo esgotado (~4 s, com AbortController) vira indisponível", async () => {
    const buscar: Buscar = (_url, init) => new Promise((_ok, falha) => init.signal.addEventListener("abort", () => falha(new DOMException("abortado", "AbortError"))));
    const inicio = Date.now();
    await expect(buscarCnpjNaBrasilApi(CNPJ, buscar, 30)).rejects.toMatchObject({ motivo: "indisponivel" });
    expect(Date.now() - inicio).toBeLessThan(2000);
  });

  it("MEI: CPF da razão social não vai à tela nem ao cache; cache antigo com CPF também é limpo na leitura", async () => {
    const cache = cacheEmMemoria();
    const { buscar } = simulado({ [HOST_BRASIL_API]: () => json(respostaCnpj({ razao_social: "FULANO DE TAL 52998224725", nome_fantasia: "529.982.247-25" })) });
    const r = await consultarCnpj(CNPJ, { buscar, cache, agora: () => AGORA });
    expect(r.dados.razaoSocial).toBe("FULANO DE TAL");
    expect(r.dados.nomeFantasia).toBeNull();
    expect(JSON.stringify([...cache.linhas.values()])).not.toMatch(/52998224725|529\.982/);
    const antigo = cacheEmMemoria();
    antigo.linhas.set(`cnpj:${CNPJ}`, { resposta: { ...r.dados, razaoSocial: "FULANO DE TAL 52998224725" }, fonte: "brasilapi", consultadoEm: AGORA });
    const doCache = await consultarCnpj(CNPJ, { buscar, cache: antigo, agora: () => AGORA });
    expect(doCache).toMatchObject({ doCache: true, dados: { razaoSocial: "FULANO DE TAL" } });
  });

  it("resposta sobre outro CNPJ é recusada e não vai para o cache", async () => {
    const cache = cacheEmMemoria();
    const { buscar } = simulado({ [HOST_BRASIL_API]: () => json(respostaCnpj({ cnpj: "11222333000181" })) });
    await expect(consultarCnpj(CNPJ, { buscar, cache, agora: () => AGORA })).rejects.toMatchObject({ motivo: "resposta_invalida" });
    expect(cache.linhas.size).toBe(0);
  });

  it("content-length acima de 200 KB é recusado antes de ler o corpo", async () => {
    let leu = false;
    const corpo = new ReadableStream({ pull() { leu = true; } }, { highWaterMark: 0 });
    const buscar: Buscar = async () => new Response(corpo, { status: 200, headers: { "content-length": "300000" } });
    await expect(buscarCnpjNaBrasilApi(CNPJ, buscar)).rejects.toMatchObject({ motivo: "resposta_invalida" });
    expect(leu).toBe(false);
  });

  it("a mensagem de erro não leva o CNPJ", async () => {
    try {
      await buscarCnpjNaBrasilApi(CNPJ, simulado({ [HOST_BRASIL_API]: () => { throw new Error(`falha em ${CNPJ}`); } }).buscar);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(FalhaConsultaCadastral);
      expect(String((e as Error).message)).not.toContain(CNPJ);
    }
  });
});

describe("CEP na Brasil API com reserva no ViaCEP", () => {
  it("sucesso na Brasil API: logradouro, bairro, cidade, UF e IBGE; ViaCEP não é chamado", async () => {
    const { buscar, chamadas } = simulado({ [HOST_BRASIL_API]: () => json(respostaCepV2), [HOST_VIACEP]: () => json(respostaViaCep) });
    const r = await buscarCep("65900-000", buscar);
    expect(r).toEqual({ fonte: "brasilapi", dados: { cep: CEP, logradouro: "Rua Coronel Manoel Bandeira", bairro: "Centro", cidade: "Imperatriz", uf: "MA", codigoIbge: "2105302" } });
    expect(chamadas).toEqual([`${HOST_BRASIL_API}/api/cep/v2/${CEP}`]);
  });

  it("Brasil API fora (500) → ViaCEP, com o código IBGE", async () => {
    const { buscar, chamadas } = simulado({ [HOST_BRASIL_API]: () => json({}, 500), [HOST_VIACEP]: () => json(respostaViaCep) });
    const r = await buscarCep(CEP, buscar);
    expect(r.fonte).toBe("viacep");
    expect(r.dados).toEqual({ cep: CEP, logradouro: null, bairro: null, cidade: "Imperatriz", uf: "MA", codigoIbge: "2105302" });
    expect(chamadas[1]).toBe(`${HOST_VIACEP}/ws/${CEP}/json/`);
  });

  it("Brasil API demorando além do tempo-limite → ViaCEP", async () => {
    const lenta: Buscar = (url, init) => url.startsWith(HOST_BRASIL_API)
      ? new Promise((_ok, falha) => init.signal.addEventListener("abort", () => falha(new DOMException("abortado", "AbortError"))))
      : Promise.resolve(json(respostaViaCep));
    expect((await buscarCep(CEP, lenta, 30)).fonte).toBe("viacep");
  });

  it("Brasil API malformada → ViaCEP", async () => {
    const { buscar } = simulado({ [HOST_BRASIL_API]: () => json({ cep: CEP }), [HOST_VIACEP]: () => json(respostaViaCep) });
    expect((await buscarCep(CEP, buscar)).fonte).toBe("viacep");
  });

  it("os dois falham → indisponível; não existe nos dois → não encontrado", async () => {
    await expect(buscarCep(CEP, simulado({ [HOST_BRASIL_API]: () => json({}, 500), [HOST_VIACEP]: () => json({}, 502) }).buscar)).rejects.toMatchObject({ motivo: "indisponivel" });
    await expect(buscarCep(CEP, simulado({ [HOST_BRASIL_API]: () => json({}, 404), [HOST_VIACEP]: () => json({ erro: true }) }).buscar)).rejects.toMatchObject({ motivo: "nao_encontrado" });
    await expect(buscarCep(CEP, simulado({ [HOST_BRASIL_API]: () => json({}, 500), [HOST_VIACEP]: () => json({ erro: "true" }) }).buscar)).rejects.toMatchObject({ motivo: "nao_encontrado" });
  });

  it("CEP fora do formato não chama a rede", async () => {
    const { buscar, chamadas } = simulado({ [HOST_BRASIL_API]: () => json(respostaCepV2) });
    await expect(buscarCep("659000", buscar)).rejects.toMatchObject({ motivo: "invalido" });
    expect(chamadas).toEqual([]);
  });
});

describe("cache de 30 dias", () => {
  it("cache válido: não vai à rede e recalcula o alerta", async () => {
    const cache = cacheEmMemoria();
    const { buscar, chamadas } = simulado({ [HOST_BRASIL_API]: () => json(respostaCnpj({ situacao_cadastral: 4, descricao_situacao_cadastral: "INAPTA" })) });
    const primeira = await consultarCnpj(CNPJ, { buscar, cache, agora: () => AGORA });
    expect(primeira).toMatchObject({ doCache: false, fonte: "brasilapi" });
    expect(primeira.dados.alerta).toContain("INAPTA");
    const segunda = await consultarCnpj(CNPJ_FORMATADO, { buscar, cache, agora: () => new Date(AGORA.getTime() + VALIDADE_DO_CACHE_MS - 1000) });
    expect(segunda.doCache).toBe(true);
    expect(segunda.dados.alerta).toContain("INAPTA");
    expect(segunda.dados.razaoSocial).toBe("OPEN KNOWLEDGE BRASIL");
    expect(chamadas).toHaveLength(1);
  });

  it("cache vencido (mais de 30 dias) consulta de novo e regrava", async () => {
    const cache = cacheEmMemoria();
    const { buscar, chamadas } = simulado({ [HOST_BRASIL_API]: () => json(respostaCepV2) });
    await consultarCep(CEP, { buscar, cache, agora: () => AGORA });
    const depois = new Date(AGORA.getTime() + VALIDADE_DO_CACHE_MS + 1000);
    const r = await consultarCep(CEP, { buscar, cache, agora: () => depois });
    expect(r.doCache).toBe(false);
    expect(chamadas).toHaveLength(2);
    expect(cache.linhas.get(`cep:${CEP}`)?.consultadoEm).toEqual(depois);
  });

  it("cache com conteúdo estragado é ignorado (vai à rede)", async () => {
    const cache = cacheEmMemoria();
    cache.linhas.set(`cep:${CEP}`, { resposta: { lixo: true }, fonte: "brasilapi", consultadoEm: AGORA });
    const { buscar, chamadas } = simulado({ [HOST_BRASIL_API]: () => json(respostaCepV2) });
    expect((await consultarCep(CEP, { buscar, cache, agora: () => AGORA })).doCache).toBe(false);
    expect(chamadas).toHaveLength(1);
  });

  it("guarda a fonte do ViaCEP e não guarda falha", async () => {
    const cache = cacheEmMemoria();
    await consultarCep(CEP, { buscar: simulado({ [HOST_BRASIL_API]: () => json({}, 500), [HOST_VIACEP]: () => json(respostaViaCep) }).buscar, cache, agora: () => AGORA });
    expect(cache.linhas.get(`cep:${CEP}`)?.fonte).toBe("viacep");
    await expect(consultarCnpj(CNPJ, { buscar: simulado({ [HOST_BRASIL_API]: () => json({}, 503) }).buscar, cache, agora: () => AGORA })).rejects.toBeInstanceOf(FalhaConsultaCadastral);
    expect(cache.linhas.has(`cnpj:${CNPJ}`)).toBe(false);
  });
});

describe("migração 0152 e cache no banco (PGlite)", () => {
  it("aplica duas vezes, aceita só chave no formato, grava, lê e substitui (uma linha por tipo+chave)", async () => {
    const pg = new PGlite();
    const sql = readFileSync(new URL("../drizzle/0152_consultas_cadastrais_cache.sql", import.meta.url), "utf8");
    await pg.exec(sql);
    await pg.exec(sql);
    await expect(pg.exec(`INSERT INTO consultas_cadastrais_cache (tipo, chave, resposta) VALUES ('cpf', '52998224725', '{}')`)).rejects.toThrow();
    await expect(pg.exec(`INSERT INTO consultas_cadastrais_cache (tipo, chave, resposta) VALUES ('cep', '6590', '{}')`)).rejects.toThrow();
    await expect(pg.exec(`INSERT INTO consultas_cadastrais_cache (tipo, chave, resposta, fonte) VALUES ('cep', '${CEP}', '{}', 'outra')`)).rejects.toThrow();
    const db = drizzle(pg) as unknown as DrizzleDb;
    const cache = cacheNoBanco(() => db);
    await cache.gravar("cep", CEP, { cidade: "A" }, "viacep", AGORA);
    await cache.gravar("cep", CEP, { cidade: "B" }, "brasilapi", new Date(AGORA.getTime() + 1000));
    const lido = await cache.ler("cep", CEP);
    expect(lido).toMatchObject({ resposta: { cidade: "B" }, fonte: "brasilapi" });
    expect(lido?.consultadoEm.getTime()).toBe(AGORA.getTime() + 1000);
    expect((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM consultas_cadastrais_cache")).rows[0].n).toBe(1);
    expect(await cache.ler("cnpj", CNPJ)).toBeNull();
    await pg.close();
  });

  it("banco fora do ar não derruba a consulta (só fica sem cache)", async () => {
    const quebrado = cacheNoBanco(() => { throw new Error("sem banco"); });
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await consultarCep(CEP, { buscar: simulado({ [HOST_BRASIL_API]: () => json(respostaCepV2) }).buscar, cache: quebrado, agora: () => AGORA });
    expect(r.doCache).toBe(false);
    expect(aviso.mock.calls.flat().join(" ")).not.toContain(CEP);
    aviso.mockRestore();
  });
});

describe("limite por usuário", () => {
  it(`${LIMITE_POR_MINUTO} por minuto; a janela anda e cada usuário tem o seu`, () => {
    const l = criarLimitador(3, 60_000);
    expect([l.permitir(1, 0), l.permitir(1, 10), l.permitir(1, 20), l.permitir(1, 30)]).toEqual([true, true, true, false]);
    expect(l.permitir(2, 30)).toBe(true);
    expect(l.permitir(1, 60_001)).toBe(true);
  });
});

describe("procedimentos tRPC: permissão e limite", () => {
  const caller = (id: number, role: string, permissoes: string[] = [], active = true) =>
    appRouter.createCaller({ user: { id, role, active, permissions: JSON.stringify(permissoes) }, req: { headers: {} }, res: {} } as never);
  let cache: ReturnType<typeof cacheEmMemoria>;
  let rede: ReturnType<typeof simulado>;

  beforeEach(() => {
    cache = cacheEmMemoria();
    rede = simulado({ [HOST_BRASIL_API]: () => json(respostaCnpj()), [HOST_VIACEP]: () => json(respostaViaCep) });
    definirDependenciasDoRouterParaTeste({ buscar: rede.buscar, cache, agora: () => AGORA }, criarLimitador(LIMITE_POR_MINUTO));
  });
  afterEach(() => definirDependenciasDoRouterParaTeste({}, criarLimitador()));

  it("admin consulta CNPJ; colaborador só com BPO ou Obras", async () => {
    expect(await caller(1, "admin").consultaCadastral.cnpj({ cnpj: CNPJ_FORMATADO })).toMatchObject({ ok: true, dados: { razaoSocial: "OPEN KNOWLEDGE BRASIL" } });
    expect(await caller(2, "colaborador", ["bpo"]).consultaCadastral.cnpj({ cnpj: CNPJ })).toMatchObject({ ok: true });
    expect(await caller(3, "colaborador", ["obras"]).consultaCadastral.cnpj({ cnpj: CNPJ })).toMatchObject({ ok: true });
    await expect(caller(4, "colaborador", ["crm"]).consultaCadastral.cnpj({ cnpj: CNPJ })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(canAccessAdminProcedure({ role: "colaborador", permissions: JSON.stringify(["agenda"]) }, "consultaCadastral.cnpj")).toBe(false);
  });

  it("corretor, cliente, empreiteiro, conta inativa e visitante não consultam CNPJ", async () => {
    for (const role of ["corretor", "cliente", "empreiteiro", "user"]) {
      await expect(caller(10, role).consultaCadastral.cnpj({ cnpj: CNPJ })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(caller(11, "admin", [], false).consultaCadastral.cnpj({ cnpj: CNPJ })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const visitante = appRouter.createCaller({ user: null, req: { headers: {} }, res: {} } as never);
    await expect(visitante.consultaCadastral.cnpj({ cnpj: CNPJ })).rejects.toBeTruthy();
    await expect(visitante.consultaCadastral.cep({ cep: CEP })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(rede.chamadas).toEqual([]);
  });

  it("CEP: qualquer conta ativa logada (usado em Meu perfil); conta inativa não", async () => {
    expect(await caller(20, "cliente").consultaCadastral.cep({ cep: "65900-000" })).toMatchObject({ ok: true, dados: { cidade: "Imperatriz" } });
    await expect(caller(21, "cliente", [], false).consultaCadastral.cep({ cep: CEP })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("entrada com caracteres estranhos ou longa demais nunca chega à rede", async () => {
    // Barra e ponto fazem parte da máscara do CNPJ: passam pela entrada, mas o documento não confere e nada vai à rede.
    expect(await caller(1, "admin").consultaCadastral.cnpj({ cnpj: "../../etc/passwd" })).toMatchObject({ ok: false, motivo: "invalido" });
    await expect(caller(1, "admin").consultaCadastral.cnpj({ cnpj: "19131243000197?x=1" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller(1, "admin").consultaCadastral.cep({ cep: "65900000?x=1" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller(1, "admin").consultaCadastral.cnpj({ cnpj: "1".repeat(30) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(rede.chamadas).toEqual([]);
  });

  it("falhas viram resposta amigável para a tela (sem derrubar o cadastro)", async () => {
    expect(await caller(1, "admin").consultaCadastral.cnpj({ cnpj: "19.131.243/0001-98" })).toMatchObject({ ok: false, motivo: "invalido" });
    definirDependenciasDoRouterParaTeste({ buscar: simulado({ [HOST_BRASIL_API]: () => json({}, 503) }).buscar, cache, agora: () => AGORA });
    const r = await caller(1, "admin").consultaCadastral.cnpj({ cnpj: CNPJ });
    expect(r).toMatchObject({ ok: false, motivo: "indisponivel" });
    expect(JSON.stringify(r)).not.toContain(CNPJ);
  });

  it(`limite de ${LIMITE_POR_MINUTO} consultas por minuto por usuário (CNPJ e CEP somados); outro usuário segue livre`, async () => {
    const c = caller(30, "admin");
    for (let i = 0; i < LIMITE_POR_MINUTO / 2; i++) {
      await c.consultaCadastral.cnpj({ cnpj: CNPJ });
      await c.consultaCadastral.cep({ cep: CEP });
    }
    await expect(c.consultaCadastral.cep({ cep: CEP })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(await caller(31, "admin").consultaCadastral.cep({ cep: CEP })).toMatchObject({ ok: true });
  });
});
