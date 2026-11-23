// Cadeia ICP-Brasil REAL (23/11/2026): só certificados PÚBLICOS de AC (server/certificados/icp-intermediarias.json e
// icp-raizes.json) e a ICP sintética das fixtures. Nenhuma rede real, nenhuma chave privada real.
//
// Bug de produção (22/11): A1 da Prospecta emitido pela AC SAFEWEB RFB v5 → "não pertence a uma cadeia ICP-Brasil
// reconhecida". Causa: a AC SAFEWEB RFB v5 (e a AC Secretaria da RFB v4) não têm AIA; o código só seguia AIA e, do .p7b
// baixado pela folha, guardava apenas o emissor direto. No 2º salto não havia onde procurar → inválido (não transitório).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Certificate } from "pkijs";
import intermediarias from "./certificados/icp-intermediarias.json" with { type: "json" };
import raizes from "./certificados/icp-raizes.json" with { type: "json" };
import { criarPki, rede, URLS, type Pki } from "./__fixtures__/juridico-pki-ca";
import { certificadosPublicos, completarCadeiaIcp, derCertificado, encontrarCaminho, intermediariasIcp, limparCacheLcr, montarCadeia, raizesIcp, validarCertificado, type Baixador } from "./juridico-pki";
import { ErroRedePki, SessaoPki } from "./juridico-pki-download";

const nome = (c: Certificate) => String(c.subject.typesAndValues.find(t => t.type === "2.5.4.3")?.value.valueBlock.value ?? "");
const porNome = (n: string) => {
  const item = intermediarias.find(i => i.nome === n);
  if (!item) throw new Error(`intermediária ausente: ${n}`);
  return Certificate.fromBER(Uint8Array.from(Buffer.from(item.der, "base64")).buffer);
};
/** Rede desligada que registra o que seria baixado. */
function semRede() {
  const chamadas: string[] = [];
  const b: Baixador = { baixar: async url => { chamadas.push(url); throw new ErroRedePki("sem rede no teste"); } };
  return { b, chamadas };
}
const DATA = new Date("2026-11-23T12:00:00Z");

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "icp-real-")); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("intermediárias oficiais embarcadas", () => {
  it("cada item tem o SHA-256 registrado, é AC e confere por assinatura até uma raiz de icp-raizes.json", () => {
    expect(intermediarias.length).toBeGreaterThanOrEqual(100);
    expect(intermediariasIcp).toHaveLength(intermediarias.length); // nenhuma descartada no carregamento
    const confiaveis = new Map<string, X509Certificate>(raizes.map(r => { const x = new X509Certificate(r.pem); return [x.fingerprint256, x]; }));
    const todas = intermediarias.map(i => ({ i, x: new X509Certificate(Buffer.from(i.der, "base64")) }));
    for (const { i } of todas) expect(createHash("sha256").update(Buffer.from(i.der, "base64")).digest("hex")).toBe(i.sha256);
    // Fecho por assinatura: só entra quem tem emissor já confiável (raiz ou intermediária já conferida).
    const pendentes = new Set(todas);
    for (let mudou = true; mudou;) {
      mudou = false;
      for (const item of Array.from(pendentes)) {
        const emissor = Array.from(confiaveis.values()).find(p => item.x.checkIssued(p) && item.x.verify(p.publicKey));
        if (emissor) { confiaveis.set(item.x.fingerprint256, item.x); pendentes.delete(item); mudou = true; }
      }
    }
    expect(Array.from(pendentes).map(p => p.i.nome)).toEqual([]);
    for (const { i, x } of todas) {
      expect(x.ca, i.nome).toBe(true);
      expect(new Date(x.validTo) > DATA, i.nome).toBe(true);
    }
  });
  it("inclui as AC RFB e Múltiplas mais usadas e a AC Secretaria da Receita Federal do Brasil v4", () => {
    const nomes = new Set(intermediarias.map(i => i.nome));
    for (const n of ["AC Secretaria da Receita Federal do Brasil v4", "AC SAFEWEB RFB v5", "AC SERASA RFB v5", "AC Certisign RFB G5", "AC VALID RFB v5",
      "AC SOLUTI RFB V5", "AC SOLUTI Multipla v5", "AC DIGITALSIGN RFB G3", "AC Certisign Multipla G7", "Autoridade Certificadora SERPRORFBv5"]) expect(nomes.has(n), n).toBe(true);
    // Mesmo SHA-256 publicado de forma independente para a cadeia da Safeweb.
    expect(intermediarias.find(i => i.nome === "AC SAFEWEB RFB v5")?.sha256).toBe("7b3a4be434dccfb19009d4835104a052a8ab64850145a48c625784e821e053ea");
    expect(intermediarias.find(i => i.nome === "AC Secretaria da Receita Federal do Brasil v4")?.sha256).toBe("2c7a8ad75458f7e2fe8d7f7884a585127e4f242bd5c3ebea499dacb630315e21");
  });
});

describe("cadeia real AC SAFEWEB RFB v5 → AC Secretaria da RFB v4 → AC Raiz Brasileira v5", () => {
  it("reproduz o bug: sem as embarcadas e sem AIA na AC, a cadeia não fecha e vira 'não pertence' (não transitório)", async () => {
    const safeweb = porNome("AC SAFEWEB RFB v5");
    const rede = semRede();
    const r = await montarCadeia(safeweb, [], raizesIcp, rede.b, DATA, []);
    expect(r).toMatchObject({ estado: "invalida", transitoria: false, motivo: "O certificado não pertence a uma cadeia ICP-Brasil reconhecida." });
    expect(rede.chamadas).toEqual([]); // a AC não tem AIA: nem há o que baixar
  });
  it("com as embarcadas, fecha a cadeia sem rede e passa no PKIjs (só falha a regra de folha, porque é uma AC)", async () => {
    const rede = semRede();
    const busca = await encontrarCaminho(porNome("AC SAFEWEB RFB v5"), [], raizesIcp, rede.b);
    expect(busca.chegou).toBe(true);
    expect(busca.caminho.map(nome)).toEqual(["AC SAFEWEB RFB v5", "AC Secretaria da Receita Federal do Brasil v4", "Autoridade Certificadora Raiz Brasileira v5"]);
    const r = await montarCadeia(porNome("AC SAFEWEB RFB v5"), [], raizesIcp, rede.b, DATA);
    expect(r.motivo).toBe("O certificado não tem permissão de assinatura digital.");
    expect(rede.chamadas).toEqual([]);
  });
  it.each([
    ["AC SERASA RFB v5", ["AC Secretaria da Receita Federal do Brasil v4"]],
    ["AC Certisign RFB G5", ["AC Secretaria da Receita Federal do Brasil v4"]],
    ["AC VALID RFB v5", ["AC Secretaria da Receita Federal do Brasil v4"]],
    ["AC DIGITALSIGN RFB G3", ["AC Secretaria da Receita Federal do Brasil v4"]],
    ["Autoridade Certificadora SERPRORFBv5", ["AC Secretaria da Receita Federal do Brasil v4"]],
    ["AC SOLUTI Multipla v5", ["AC SOLUTI v5"]],
    ["AC Certisign Multipla G7", ["AC Certisign G7"]],
  ])("%s fecha até a Raiz v5 só com as embarcadas", async (inicio, meio) => {
    const busca = await encontrarCaminho(porNome(inicio), [], raizesIcp, semRede().b);
    expect(busca.caminho.map(nome)).toEqual([inicio, ...meio, "Autoridade Certificadora Raiz Brasileira v5"]);
  });
  it("completarCadeiaIcp aceita bytes DER/PEM e devolve os intermediários em DER, sem rede", async () => {
    const safewebDer = Buffer.from(intermediarias.find(i => i.nome === "AC SAFEWEB RFB v5")!.der, "base64");
    const pem = `-----BEGIN CERTIFICATE-----\n${safewebDer.toString("base64").replace(/.{64}/g, "$&\n")}\n-----END CERTIFICATE-----\n`;
    for (const entrada of [safewebDer, Buffer.from(pem)]) {
      const r = await completarCadeiaIcp(entrada, [], { semRede: true, agora: DATA });
      expect(r.intermediarios.map(d => nome(Certificate.fromBER(Uint8Array.from(d).buffer)))).toEqual(["AC Secretaria da Receita Federal do Brasil v4"]);
      expect(r.estado).toBe("invalida"); // é uma AC, não um certificado de assinatura
    }
    expect(await completarCadeiaIcp(Buffer.from("lixo"))).toMatchObject({ estado: "invalida", motivo: "Certificado ilegível." });
  });
});

describe("AIA em DER, PEM e PKCS#7 (.p7b/.p7c)", () => {
  const pemDe = (c: Certificate) => `-----BEGIN CERTIFICATE-----\n${derCertificado(c).toString("base64")}\n-----END CERTIFICATE-----\n`;
  const cadeiaReal = () => [porNome("AC SAFEWEB RFB v5"), porNome("AC Secretaria da Receita Federal do Brasil v4"), raizesIcp.find(r => nome(r) === "Autoridade Certificadora Raiz Brasileira v5")!];
  function p7b(certs: Certificate[], formato: "DER" | "PEM") {
    const entrada = join(dir, `cadeia-${formato}.pem`), saida = join(dir, `cadeia.${formato}.p7b`);
    writeFileSync(entrada, certs.map(pemDe).join(""));
    execFileSync("openssl", ["crl2pkcs7", "-nocrl", "-certfile", entrada, "-outform", formato, "-out", saida], { stdio: ["ignore", "ignore", "pipe"] });
    return readFileSync(saida);
  }
  it("lê o .p7b da cadeia real em DER e em PEM, PEM com vários certificados e DER simples", () => {
    const esperado = cadeiaReal().map(nome);
    expect(certificadosPublicos(p7b(cadeiaReal(), "DER")).map(nome).sort()).toEqual([...esperado].sort());
    const pemP7 = p7b(cadeiaReal(), "PEM");
    expect(pemP7.toString("latin1")).toMatch(/-----BEGIN PKCS7-----/);
    expect(certificadosPublicos(pemP7).map(nome).sort()).toEqual([...esperado].sort());
    expect(certificadosPublicos(Buffer.from(cadeiaReal().map(pemDe).join("\n"))).map(nome)).toEqual(esperado);
    expect(certificadosPublicos(derCertificado(cadeiaReal()[0])).map(nome)).toEqual(["AC SAFEWEB RFB v5"]);
    expect(certificadosPublicos(Buffer.from("<html>erro</html>"))).toEqual([]);
    expect(certificadosPublicos(Buffer.from("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n"))).toEqual([]);
  });
  it("PEM hostil de 10 MB (BEGIN sem END, rótulos enormes) é recusado em tempo linear", () => {
    for (const hostil of [
      Buffer.from("-----BEGIN CERTIFICATE-----\n" + "-----BEGIN A-----".repeat(600_000)),
      Buffer.from("-----BEGIN " + "X".repeat(10 * 1024 * 1024)),
      Buffer.from("-----BEGIN CERTIFICATE-----\n" + "A".repeat(10 * 1024 * 1024)),
    ]) {
      const t = Date.now();
      expect(certificadosPublicos(hostil)).toEqual([]);
      expect(Date.now() - t).toBeLessThan(1_000);
    }
  });
});

describe("ICP sintética: o .p7b do AIA alimenta os saltos seguintes e as embarcadas completam a verificação", () => {
  let pki: Pki;
  beforeAll(() => { pki = criarPki(); limparCacheLcr(); }, 60_000);
  afterAll(() => pki?.limpar());
  const sessao = (r: ReturnType<typeof rede>) => new SessaoPki({ resolver: r.resolver, transporte: r.transporte });
  it("AIA da folha devolve .p7b com [emissor, AC acima]: o 2º salto usa o pacote, sem baixar o AIA do emissor", async () => {
    const entrada = join(dir, "sub.pem"), saida = join(dir, "sub.p7b");
    writeFileSync(entrada, [pki.der.sub, pki.der.inter].map(d => `-----BEGIN CERTIFICATE-----\n${d.toString("base64")}\n-----END CERTIFICATE-----\n`).join(""));
    execFileSync("openssl", ["crl2pkcs7", "-nocrl", "-certfile", entrada, "-outform", "DER", "-out", saida], { stdio: ["ignore", "ignore", "pipe"] });
    const r = rede(pki, { trocar: { [URLS.subCert]: readFileSync(saida) }, fora: [URLS.interCert] });
    const busca = await encontrarCaminho(pki.cert("sob_sub"), [], [pki.raiz], sessao(r), []);
    expect(busca.chegou).toBe(true);
    expect(busca.caminho.map(nome)).toEqual(["SOB SUBAC:99900011122", "SUBAC ALEM DO LIMITE", "AC INTERMEDIARIA DE TESTE", "RAIZ SINTETICA DE TESTE"]);
    expect(r.chamadas).toEqual([URLS.subCert]);
  });
  it("PDF assinado sem cadeia e AIA fora do ar: completa com as embarcadas antes de declarar qualquer coisa", async () => {
    const r = rede(pki, { fora: [URLS.interCert] });
    expect(await validarCertificado(pki.cert("empresa"), [], [pki.raiz], sessao(r), new Date(), [])).toMatchObject({ estado: "pendente", transitoria: true });
    const comEmbarcadas = await validarCertificado(pki.cert("empresa"), [], [pki.raiz], sessao(rede(pki, { fora: [URLS.interCert] })), new Date(), [pki.intermediaria]);
    expect(comEmbarcadas).toMatchObject({ estado: "valida", cadeia: "valida", revogacao: "regular" });
    expect(comEmbarcadas.certificados).toEqual([pki.der.inter.toString("base64")]);
  });
  it("completarCadeiaIcp: cadeia completa com raiz; sem rede e sem fornecidos fica pendente transitória (nunca inválida por rede)", async () => {
    const ok = await completarCadeiaIcp(pki.der.empresa, [], { roots: [pki.raiz], sessao: sessao(rede(pki)) });
    expect(ok).toMatchObject({ estado: "valida" });
    expect(ok.intermediarios.map(b => b.toString("base64"))).toEqual([pki.der.inter.toString("base64")]);
    expect(ok.raiz?.equals(derCertificado(pki.raiz))).toBe(true);
    expect(await completarCadeiaIcp(pki.der.empresa, [], { roots: [pki.raiz], semRede: true })).toMatchObject({ estado: "pendente", transitoria: true, raiz: null });
    expect(await completarCadeiaIcp(pki.der.empresa, [pki.der.inter], { roots: [pki.raiz], semRede: true })).toMatchObject({ estado: "valida" });
  });
});
