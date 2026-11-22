// EPIC-029 S-4 — PORTÃO DE QA DE SEGURANÇA (@qa Quinn, 22/11/2026). Tenta quebrar o cofre do A1, o cliente mTLS, a DPS e
// a assinatura. Achados confirmados ficam como `it.fails` (passam enquanto o defeito existir; quando corrigido, o teste
// "falha" e deve virar `it`). Certificados de TESTE gerados aqui; nada sai da máquina (servidor HTTPS local).
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { DOMParser } from "@xmldom/xmldom";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste-do-cofre-qa" } }));

import { getDb } from "../db.js";
import { router } from "../_core/trpc.js";
import { decryptSecret } from "../_core/secret-vault.js";
import { PADRAO_ID_DPS, type EntradaDps } from "../../shared/fiscal/dps-campos.js";
import { assinarXml, verificarAssinaturaXml } from "./assinatura.js";
import { abrirPfx, type CredencialA1 } from "./certificado.js";
import { certificadoFiscalRouter } from "./certificado-router.js";
import { gerarCertificado, pastaDeTeste, SENHA_TESTE, type CertTeste } from "./certificados-teste.helper.js";
import { escaparXml, montarDps } from "./dps.js";
import { criarClienteSefin, ENDERECOS, montarUrl, type MapaEnderecos } from "./sefin.js";

const M0154 = readFileSync(new URL("../../drizzle/0154_fiscal_notas.sql", import.meta.url), "utf8");
const M0162 = readFileSync(new URL("../../drizzle/0162_fiscal_certificados.sql", import.meta.url), "utf8");

const pasta = pastaDeTeste();
let ok: CertTeste, servidorCert: CertTeste, cred: CredencialA1;
beforeAll(async () => {
  ok = gerarCertificado(pasta.dir, "qa-ok");
  servidorCert = gerarCertificado(pasta.dir, "qa-servidor", { cn: "localhost", cnpj: "", uso: "serverAuth" });
  cred = await abrirPfx(ok.pfx, SENHA_TESTE);
}, 60_000);
afterAll(() => pasta.limpar());

let pg: PGlite;
let consoleVigia: ReturnType<typeof vi.spyOn>[];
beforeEach(async () => {
  pg = new PGlite();
  for (const m of [M0154, M0162]) await pg.exec(m);
  vi.mocked(getDb).mockReturnValue(drizzle(pg) as never);
  await pg.exec(`INSERT INTO fiscal_emissores (id, cnpj, municipio_ibge, serie_dps) VALUES (1, '11222333000181', '2105302', '1');`);
  consoleVigia = (["log", "info", "warn", "error", "debug"] as const).map(n => vi.spyOn(console, n).mockImplementation(() => undefined));
});
afterEach(async () => {
  const tudo = JSON.stringify(consoleVigia.flatMap(s => s.mock.calls));
  expect(tudo).not.toContain(SENHA_TESTE);
  expect(tudo).not.toContain(ok.pfx.toString("base64").slice(0, 40));
  expect(tudo).not.toMatch(/PRIVATE KEY/);
  consoleVigia.forEach(s => s.mockRestore());
  await pg.close();
});

const app = router({ integracoes: router({ certificadoFiscal: certificadoFiscalRouter }) });
const callerDe = (user: Record<string, unknown> | null) =>
  app.createCaller({ user, req: { headers: {} }, res: {} } as never).integracoes.certificadoFiscal;
const admin = () => callerDe({ id: 1, role: "admin", active: true, permissions: "[]" });
const envio = () => ({ pfxBase64: ok.pfx.toString("base64"), senha: SENHA_TESTE, origem: "juridico" as const });
const q = async <T = Record<string, unknown>>(sql: string) => (await pg.query<T>(sql)).rows;

describe("QA — cofre: papel, entrada e resposta", () => {
  it("sem login, corretor, cliente, empreiteiro e ADMIN INATIVO são barrados em todas as rotas", async () => {
    const intrusos = [null,
      { id: 3, role: "corretor", active: true, permissions: "[]" },
      { id: 4, role: "cliente", active: true, permissions: "[]" },
      { id: 5, role: "empreiteiro", active: true, permissions: "[]" },
      { id: 6, role: "admin", active: false, permissions: "[]" }];
    for (const u of intrusos) {
      const c = callerDe(u);
      await expect(c.enviar(envio())).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|UNAUTHORIZED/) });
      await expect(c.status()).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|UNAUTHORIZED/) });
      await expect(c.testarConexao({ emissorId: 1 })).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|UNAUTHORIZED/) });
    }
    expect(await q(`SELECT 1 FROM fiscal_emissores_certificado`)).toHaveLength(0);
  });

  it("entrada: campo extra, base64 inválido, senha > 200 e arquivo > 1 MiB → BAD_REQUEST, sem ecoar a senha", async () => {
    const tentativas = [
      { ...envio(), chavePrivada: "x" },
      { ...envio(), pfxBase64: "<script>alert(1)</script>AAAA" },
      { ...envio(), senha: "s".repeat(201) },
      { ...envio(), pfxBase64: Buffer.alloc(1024 * 1024 + 10, 1).toString("base64") },
    ];
    for (const t of tentativas) {
      const erro = await admin().enviar(t as never).catch(e => e);
      expect(erro).toMatchObject({ code: "BAD_REQUEST" });
      expect(String(erro.message)).not.toContain(SENHA_TESTE);
    }
    expect(await q(`SELECT 1 FROM fiscal_emissores_certificado`)).toHaveLength(0);
  });

  it("resposta do enviar e do status sem segredo; cifra AEAD com IV aleatório (mesma senha → textos diferentes; adulterado não abre)", async () => {
    const r = await admin().enviar(envio());
    const s = await admin().status();
    const tudo = JSON.stringify([r, s]);
    expect(tudo).not.toContain(SENHA_TESTE);
    expect(tudo).not.toMatch(/PRIVATE|BEGIN CERT|pfx|senha/i);
    await admin().enviar(envio());
    const linhas = await q<{ pfx_cifrado: string; senha_cifrada: string }>(`SELECT pfx_cifrado, senha_cifrada FROM fiscal_emissores_certificado ORDER BY id`);
    expect(linhas[0]!.senha_cifrada).not.toBe(linhas[1]!.senha_cifrada);
    expect(linhas[0]!.senha_cifrada.split(".")[0]).not.toBe(linhas[1]!.senha_cifrada.split(".")[0]); // IV
    expect(linhas[0]!.senha_cifrada).not.toContain(SENHA_TESTE);
    expect(linhas[0]!.pfx_cifrado).not.toContain(ok.pfx.toString("base64").slice(0, 24));
    const [iv, tag, corpo] = linhas[0]!.senha_cifrada.split(".");
    const adulterado = Buffer.from(corpo!, "base64url"); adulterado[0] ^= 1;
    expect(() => decryptSecret([iv, tag, adulterado.toString("base64url")].join("."))).toThrow();
    expect(decryptSecret(linhas[0]!.senha_cifrada)).toBe(SENHA_TESTE);
  });

  it("falha inesperada do banco com segredo na mensagem (ex.: 'Failed query ... params') → frase genérica, nada vaza", async () => {
    const real = drizzle(pg);
    const comFalha = new Proxy(real, {
      get(alvo, p, r) {
        if (p === "transaction") return async () => { throw new Error(`Failed query: insert ... params: ${SENHA_TESTE}`); };
        return Reflect.get(alvo, p, r);
      },
    });
    vi.mocked(getDb).mockReturnValue(comFalha as never);
    const erro = await admin().enviar(envio()).catch(e => e);
    expect(erro).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(String(erro.message)).not.toContain(SENHA_TESTE);
    expect(JSON.stringify(erro.shape ?? {})).not.toContain(SENHA_TESTE);
  });

  // ACHADO (baixo): a guarda da 0162 não trava "autoridade" nem "cadeia_icp" (dados exibidos na tela, lidos do arquivo).
  it.fails("o banco recusa trocar a autoridade/cadeia ICP do certificado guardado (dados lidos do arquivo)", async () => {
    await admin().enviar(envio());
    await expect(pg.exec(`UPDATE fiscal_emissores_certificado SET autoridade = 'AC FALSA', cadeia_icp = true`)).rejects.toThrow(/IMUTAVEL/);
  });
});

describe("QA — cliente mTLS", () => {
  // ACHADO (baixo): "%2e%2e" passa no filtro de montarUrl e o WHATWG URL resolve como "..", saindo da base (o host continua
  // fixo; hoje só caminhoDe — valores alfanuméricos — alimenta montarUrl, então não é explorável por rota).
  it.fails("caminho com '..' codificado (%2e%2e) não sai da base da API", () => {
    const destino = ENDERECOS.producao_restrita.sefin;
    const url = montarUrl(destino, "/%2e%2e/%2E%2E/qualquer");
    expect(url.pathname.startsWith(destino.base)).toBe(true);
  });

  describe("servidor falso LOCAL", () => {
    let servidor: Server; let porta = 0; let modo: "redirect" | "gotejar" = "redirect"; let pedidos = 0;
    const timers: NodeJS.Timeout[] = [];
    beforeAll(async () => {
      servidor = createServer({ key: servidorCert.chavePem, cert: servidorCert.certPem, requestCert: true, rejectUnauthorized: true, ca: [cred.certPem] }, (_req, res) => {
        pedidos++;
        if (modo === "redirect") { res.writeHead(302, { Location: "https://exemplo-malicioso.invalid/roubar" }); res.end(); return; }
        res.writeHead(200, { "Content-Type": "application/json" });
        const t = setInterval(() => res.write(" "), 100); timers.push(t); // goteja 1 byte a cada 100 ms, nunca termina
      });
      await new Promise<void>(r => servidor.listen(0, "127.0.0.1", () => r()));
      porta = (servidor.address() as AddressInfo).port;
    });
    afterAll(() => new Promise<void>(r => { timers.forEach(clearInterval); servidor.closeAllConnections(); servidor.close(() => r()); }));
    const local = (): MapaEnderecos => ({
      producao_restrita: {
        sefin: { host: "localhost", porta, base: "/API/SefinNacional", hostConfirmado: true, baseConfirmada: true, fonte: "teste" },
        adn: { host: "localhost", porta, base: "/contribuintes", hostConfirmado: true, baseConfirmada: true, fonte: "teste" },
      },
      producao: ENDERECOS.producao,
    });

    it("redirecionamento para outro host NÃO é seguido (uma requisição só, devolve o 302)", async () => {
      modo = "redirect"; pedidos = 0;
      const c = criarClienteSefin({ ambiente: "producao_restrita", servico: "sefin", credencial: cred, enderecos: local(), ca: [servidorCert.certPem] });
      const r = await c.requisitar("GET", "/parametros_municipais/2105302/convenio");
      expect(r.status).toBe(302);
      expect(pedidos).toBe(1);
    });

    // ACHADO (médio): o tempo-limite é de OCIOSIDADE do socket (opção `timeout` do https.request), não um prazo total.
    // Um servidor que goteja bytes nunca estoura os 25 s e prende a requisição (e a credencial em memória) indefinidamente.
    it.fails("servidor que goteja bytes sem terminar é cortado pelo prazo total", async () => {
      modo = "gotejar";
      const c = criarClienteSefin({ ambiente: "producao_restrita", servico: "sefin", credencial: cred, enderecos: local(), ca: [servidorCert.certPem], tempoLimiteMs: 300 });
      const resultado = await Promise.race([
        c.requisitar("GET", "/nfse/x").then(() => "respondeu", () => "cortou"),
        new Promise(r => setTimeout(() => r("nunca terminou"), 1500)),
      ]);
      servidor.closeAllConnections();
      expect(resultado).toBe("cortou");
    }, 5000);
  });
});

describe("QA — DPS e assinatura", () => {
  const base: EntradaDps = {
    ambiente: "producao_restrita", emitidoEm: new Date("2026-11-22T13:00:00.000Z"), competencia: "2026-11-20", serie: "1", numero: 7,
    prestador: { cnpj: "11222333000181", inscricaoMunicipal: "12345", municipioIbge: "2105302" },
    tomador: { documento: "12345678909", nome: "Cliente Teste" },
    servico: { municipioIncidenciaIbge: "2105302", codigoTributacaoNacional: "070201", codigoNbs: "114011000", descricao: "Obra", cno: null },
    valorCentavos: 100_00, regimeTributario: "simples_nacional", aliquotaIss: "5.0000",
    parametros: { opSimpNac: "3", regApTribSN: "1", regEspTrib: "0", tribIssqn: "1", tpRetIssqn: "1", indTotTrib: "0",
      ibscbs: { indFinal: "0", cIndOp: "100301", indDest: "0", cst: "000", cClassTrib: "000001" } },
  };

  it("textos hostis (tags, &, ]]>, aspas, controle) ficam escapados e não criam elementos", () => {
    const hostil = `</xNome><CPF>00000000000</CPF><![CDATA[x]]>&amp;"'\u0001<!ENTITY e SYSTEM "file:///etc/passwd">`;
    const { xml } = montarDps({ ...base, tomador: { documento: "12345678909", nome: hostil }, servico: { ...base.servico, descricao: hostil } });
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    expect(doc.getElementsByTagName("CPF")).toHaveLength(1);
    expect(doc.getElementsByTagName("xNome")[0]!.textContent).toBe(hostil.replace("\u0001", ""));
    expect(xml).not.toContain("]]>");
    expect(xml).not.toContain("<!ENTITY");
    expect(escaparXml("]]>")).toBe("]]&gt;");
  });

  // ACHADO (baixo): escaparXml remove só C0; U+FFFE/U+FFFF e surrogates soltos (inválidos no XML 1.0) passam, e o
  // slice(0, 2000) do xDescServ pode cortar um par surrogate (emoji) ao meio → DPS mal formada (recusa da Sefin, não injeção).
  it.fails("caracteres proibidos no XML 1.0 (U+FFFE, surrogate solto) são removidos", () => {
    expect(escaparXml("a￾b\uD800c")).toBe("abc");
  });

  it("XXE: DOCTYPE com entidade externa não é resolvida ao assinar nem ao verificar", () => {
    const { xml } = montarDps(base);
    const comDoctype = xml.replace(`<?xml version="1.0" encoding="UTF-8"?>`, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE DPS [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>`)
      .replace("<xNome>Cliente Teste</xNome>", "<xNome>&xxe;</xNome>");
    let saida = "";
    try { saida = assinarXml(comDoctype, cred); } catch { saida = ""; }
    expect(saida).not.toMatch(/root:|\/bin\/(ba)?sh/);
    expect(verificarAssinaturaXml(comDoctype, cred.certPem)).toBe(false);
  });

  it("assinatura: wrapping (infDPS falso com o mesmo Id antes ou depois do original) não verifica", () => {
    const { xml, id } = montarDps(base);
    expect(PADRAO_ID_DPS.test(id)).toBe(true);
    const assinado = assinarXml(xml, cred);
    expect(verificarAssinaturaXml(assinado, cred.certPem)).toBe(true);
    const original = assinado.match(/<infDPS[\s\S]*?<\/infDPS>/)![0];
    const assinatura = assinado.match(/<Signature[\s\S]*<\/Signature>/)![0];
    const falso = original.replace("<vServ>100.00</vServ>", "<vServ>1.00</vServ>");
    const raiz = assinado.match(/<DPS[^>]*>/)![0];
    const antes = `<?xml version="1.0" encoding="UTF-8"?>${raiz}${falso}${assinatura}<x>${original}</x></DPS>`;
    const depois = `<?xml version="1.0" encoding="UTF-8"?>${raiz}<x>${original}</x>${assinatura}${falso}</DPS>`;
    expect(verificarAssinaturaXml(antes, cred.certPem)).toBe(false);
    expect(verificarAssinaturaXml(depois, cred.certPem)).toBe(false);
  });

  it("assinatura com KeyInfo de OUTRO certificado é recusada pelo certificado esperado (não confia no KeyInfo)", async () => {
    const intruso = await abrirPfx(gerarCertificado(pasta.dir, "qa-intruso").pfx, SENHA_TESTE);
    const assinado = assinarXml(montarDps(base).xml, intruso);
    expect(verificarAssinaturaXml(assinado, cred.certPem)).toBe(false);
  });
});
