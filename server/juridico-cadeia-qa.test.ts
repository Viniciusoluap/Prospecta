// Portão de QA (23/11/2026) — correção "cadeia ICP-Brasil do Jurídico" (intermediárias embarcadas, encontrarCaminho,
// certificadosPublicos DER/PEM/PKCS#7, revalidarDocumento manual). Só ICP SINTÉTICA (OpenSSL) e certificados PÚBLICOS
// de AC; nenhuma rede real, nenhuma chave privada real. Achados abertos ficam como `it.fails` (passam enquanto o
// defeito existir; quando corrigido, o teste "falha" e deve virar `it`).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Certificate } from "pkijs";
import intermediarias from "./certificados/icp-intermediarias.json" with { type: "json" };
import raizes from "./certificados/icp-raizes.json" with { type: "json" };
import { criarPki, rede, URLS, type Pki } from "./__fixtures__/juridico-pki-ca";
import { certificadosPublicos, encontrarCaminho, intermediariasIcp, limparCacheLcr, montarCadeia, raizesIcp, type Baixador } from "./juridico-pki";
import { ErroRedePki, SessaoPki } from "./juridico-pki-download";

let pki: Pki;
const run = (args: string[]) => execFileSync("openssl", args, { cwd: pki.dir, stdio: ["ignore", "ignore", "pipe"] });
const der = (nome: string) => Buffer.from(readFileSync(join(pki.dir, `${nome}.pem`), "latin1").replace(/-----[^-]+-----|\s/g, ""), "base64");
const cert = (nome: string) => Certificate.fromBER(Uint8Array.from(der(nome)).buffer);
let serial = 7000;
/** Emite `nome` (chave nova) assinado por `emissor` (arquivo `${emissor}.pem` + `${emissor}-chave.pem` em pki.dir). */
function emitir(nome: string, subj: string, emissor: string, ext: string) {
  writeFileSync(join(pki.dir, `${nome}.ext`), `[e]\n${ext}\n`);
  run(["req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", `${nome}-chave.pem`, "-out", `${nome}.csr`, "-subj", subj]);
  run(["x509", "-req", "-in", `${nome}.csr`, "-CA", `${emissor}.pem`, "-CAkey", `${emissor}-chave.pem`, "-set_serial", String(serial++), "-days", "20", "-sha256", "-extfile", `${nome}.ext`, "-extensions", "e", "-out", `${nome}.pem`]);
  return cert(nome);
}
function autoassinado(nome: string, subj: string) {
  run(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", `${nome}-chave.pem`, "-out", `${nome}.pem`, "-days", "20", "-subj", subj, "-addext", "basicConstraints=critical,CA:true", "-addext", "keyUsage=critical,keyCertSign,cRLSign"]);
  return cert(nome);
}
const S = (cn: string) => `/C=BR/O=TESTE SEM VALIDADE/CN=${cn}`;
const EXT_CA = "basicConstraints=critical,CA:true\nkeyUsage=critical,keyCertSign,cRLSign";
const EXT_FOLHA = "basicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature,nonRepudiation";
const semRede = (): Baixador & { chamadas: string[] } => {
  const chamadas: string[] = [];
  return { chamadas, baixar: async url => { chamadas.push(url); throw new ErroRedePki("sem rede no teste"); } };
};
const pem = (b: Buffer, tipo = "CERTIFICATE") => `-----BEGIN ${tipo}-----\n${b.toString("base64").replace(/(.{64})/g, "$1\n")}\n-----END ${tipo}-----\n`;

beforeAll(() => { pki = criarPki(); }, 120_000);
afterAll(() => pki?.limpar());

describe("QA (1) lista embarcada não introduz confiança", () => {
  const DATA = new Date("2026-11-23T12:00:00Z");
  const OFICIAIS = new Set(raizes.map(r => new X509Certificate(r.pem).fingerprint256));
  it("toda entrada é AC (CA:TRUE + keyCertSign), não autoassinada, não é raiz, vigente e sem duplicata", () => {
    const vistos = new Set<string>();
    for (const item of intermediarias) {
      const x = new X509Certificate(Buffer.from(item.der, "base64"));
      expect(x.ca, item.nome).toBe(true);
      const c = Certificate.fromBER(Uint8Array.from(Buffer.from(item.der, "base64")).buffer);
      const ku = c.extensions?.find(e => e.extnID === "2.5.29.15");
      expect(ku, `${item.nome} sem keyUsage`).toBeTruthy();
      const bits = new Uint8Array(ku!.parsedValue.valueBlock.valueHexView)[0];
      expect(bits & 0x04, `${item.nome} sem keyCertSign`).toBe(0x04);
      expect(x.subject === x.issuer, `${item.nome} autoassinado`).toBe(false);
      expect(OFICIAIS.has(x.fingerprint256), `${item.nome} é raiz`).toBe(false);
      expect(new Date(x.validFrom) <= DATA && new Date(x.validTo) > DATA, `${item.nome} fora da validade`).toBe(true);
      expect(vistos.has(item.sha256), `${item.nome} duplicada`).toBe(false);
      vistos.add(item.sha256);
    }
  });
  it("carregamento descarta item com DER adulterado (SHA-256 não bate)", async () => {
    vi.resetModules();
    const copia = intermediarias.map(i => ({ ...i }));
    const b = Buffer.from(copia[0].der, "base64"); b[b.length - 10] ^= 0xff; copia[0].der = b.toString("base64");
    vi.doMock("./certificados/icp-intermediarias.json", () => ({ default: copia }));
    try {
      const m = await import("./juridico-pki");
      expect(m.intermediariasIcp).toHaveLength(intermediarias.length - 1);
    } finally { vi.doUnmock("./certificados/icp-intermediarias.json"); vi.resetModules(); }
  });
  it("AC embarcada nunca vira âncora: sem a raiz certa, a cadeia não fecha (sintética e real)", async () => {
    const r = await montarCadeia(pki.cert("empresa"), [], [pki.outraRaiz], semRede(), new Date(), [pki.intermediaria]);
    expect(r.estado).toBe("invalida");
    const real = intermediariasIcp.find(c => String(c.subject.typesAndValues.find(t => t.type === "2.5.4.3")?.value.valueBlock.value) === "AC SAFEWEB RFB v5")!;
    expect(real).toBeTruthy();
    const b = await encontrarCaminho(real, [], [pki.raiz], semRede());
    expect(b.chegou).toBe(false);
  });
  it("item forjado com SHA-256 coerente (mesmo nome de AC, outra chave) carrega mas não valida ninguém", async () => {
    const forjada = autoassinado("forjada-inter", S("AC INTERMEDIARIA DE TESTE"));
    const r = await montarCadeia(pki.cert("empresa"), [], [pki.raiz], semRede(), new Date(), [forjada]);
    expect(r.estado).not.toBe("valida");
  });
});

describe("QA (2) encontrarCaminho", () => {
  it("mesmo nome com chave diferente (fornecida pelo PDF) é ignorado: vale a assinatura, não o nome", async () => {
    const homonima = emitir("homonima", S("AC INTERMEDIARIA DE TESTE"), "raiz", EXT_CA);
    const r = rede(pki);
    const sessao = new SessaoPki({ resolver: r.resolver, transporte: r.transporte });
    limparCacheLcr();
    const ok = await montarCadeia(pki.cert("empresa"), [homonima], [pki.raiz], sessao, new Date(), [pki.intermediaria]);
    expect(ok.estado).toBe("valida");
    expect(ok.caminho.some(c => Buffer.from(c.toSchema().toBER(false)).equals(der("homonima")))).toBe(false);
    const sem = await montarCadeia(pki.cert("empresa"), [homonima], [pki.raiz], semRede(), new Date(), []);
    expect(sem.estado).not.toBe("valida");
  });
  it("autoassinado que imita o nome da raiz não vira raiz", async () => {
    const falsaRaiz = autoassinado("falsa-raiz", S("RAIZ SINTETICA DE TESTE"));
    const r = await montarCadeia(pki.cert("empresa"), [pki.intermediaria, falsaRaiz], [pki.raiz], semRede(), new Date(), []);
    expect(r.caminho.every(c => !Buffer.from(c.toSchema().toBER(false)).equals(der("falsa-raiz")))).toBe(true);
  });
  it("emissor sem CA:TRUE ou sem keyCertSign (no PDF ou embarcado) → inválido", async () => {
    emitir("naoca", S("FALSA AC NAO CA"), "raiz", "basicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature,keyCertSign");
    const folhaNaoCa = emitir("sob-naoca", S("SOB NAO CA:12345678000190"), "naoca", EXT_FOLHA);
    emitir("semkcs", S("AC SEM KEYCERTSIGN"), "raiz", "basicConstraints=critical,CA:true\nkeyUsage=critical,cRLSign");
    const folhaSemKcs = emitir("sob-semkcs", S("SOB SEM KCS:12345678000190"), "semkcs", EXT_FOLHA);
    for (const [folha, emissor] of [[folhaNaoCa, cert("naoca")], [folhaSemKcs, cert("semkcs")]] as const) {
      expect((await montarCadeia(folha, [emissor], [pki.raiz], semRede(), new Date(), [])).estado).toBe("invalida");
      expect((await montarCadeia(folha, [], [pki.raiz], semRede(), new Date(), [emissor])).estado).toBe("invalida");
    }
  });
  it("laço A↔B termina, sem repetir certificado, e não valida", async () => {
    autoassinado("tmpA", S("AC LACO A")); autoassinado("tmpB", S("AC LACO B"));
    // A (chave de tmpA) emitida por B; B (chave de tmpB) emitida por A.
    writeFileSync(join(pki.dir, "laco.ext"), `[e]\n${EXT_CA}\n`);
    run(["req", "-new", "-key", "tmpA-chave.pem", "-out", "A.csr", "-subj", S("AC LACO A")]);
    run(["x509", "-req", "-in", "A.csr", "-CA", "tmpB.pem", "-CAkey", "tmpB-chave.pem", "-set_serial", "8001", "-days", "20", "-extfile", "laco.ext", "-extensions", "e", "-out", "A.pem"]);
    run(["req", "-new", "-key", "tmpB-chave.pem", "-out", "B.csr", "-subj", S("AC LACO B")]);
    run(["x509", "-req", "-in", "B.csr", "-CA", "tmpA.pem", "-CAkey", "tmpA-chave.pem", "-set_serial", "8002", "-days", "20", "-extfile", "laco.ext", "-extensions", "e", "-out", "B.pem"]);
    const folha = emitir("sob-laco", S("SOB LACO:12345678000190"), "tmpA", EXT_FOLHA);
    const b = await encontrarCaminho(folha, [cert("A"), cert("B"), cert("tmpA"), cert("tmpB")], [pki.raiz], semRede(), []);
    expect(b.chegou).toBe(false);
    const ids = b.caminho.map(c => createHash("sha256").update(Buffer.from(c.toSchema().toBER(false))).digest("hex"));
    expect(new Set(ids).size).toBe(ids.length);
    expect((await montarCadeia(folha, [cert("A"), cert("B")], [pki.raiz], semRede(), new Date(), [])).estado).toBe("invalida");
  });
  it("cadeia longa (8 AC) para no limite de níveis e não valida", async () => {
    let emissor = "raiz";
    const acs: Certificate[] = [];
    for (let i = 1; i <= 8; i++) { acs.push(emitir(`longa${i}`, S(`AC LONGA ${i}`), emissor, EXT_CA)); emissor = `longa${i}`; }
    const folha = emitir("sob-longa", S("SOB LONGA:12345678000190"), emissor, EXT_FOLHA);
    const b = await encontrarCaminho(folha, acs, [pki.raiz], semRede(), []);
    expect(b.chegou).toBe(false);
    expect(b.caminho.length).toBeLessThanOrEqual(7);
    expect((await montarCadeia(folha, acs, [pki.raiz], semRede(), new Date(), [])).estado).toBe("invalida");
  });
  it("pathLen da AC continua valendo quando a sub-AC vem das embarcadas", async () => {
    const r = rede(pki); limparCacheLcr();
    const c = await montarCadeia(pki.cert("sob_sub"), [], [pki.raiz], new SessaoPki({ resolver: r.resolver, transporte: r.transporte }), new Date(), [pki.cert("sub"), pki.intermediaria]);
    expect(c.estado).toBe("invalida");
    expect(c.motivo).toMatch(/limite de níveis/);
  });
  it("EKU de servidor na folha continua recusado com cadeia vinda das embarcadas", async () => {
    const c = await montarCadeia(pki.cert("servidor"), [], [pki.raiz], semRede(), new Date(), [pki.intermediaria]);
    expect(c.estado).toBe("invalida");
  });
  it("intermediária embarcada vencida na data da conferência → inválido (não cai para outra coisa)", async () => {
    const c = await montarCadeia(pki.cert("empresa"), [], [pki.raiz], semRede(), new Date(Date.now() + 50 * 86_400_000), [pki.intermediaria]);
    expect(c.estado).toBe("invalida");
  });
});

describe("QA (3) PKCS#7/PEM hostil", () => {
  it("PEM com chave privada: o bloco de chave é ignorado e só o certificado é lido", () => {
    const chave = readFileSync(join(pki.dir, "empresa-chave.pem"), "latin1");
    const lidos = certificadosPublicos(Buffer.from(chave + pem(pki.der.inter)));
    expect(lidos).toHaveLength(1);
    expect(certificadosPublicos(Buffer.from(chave))).toHaveLength(0);
    expect(certificadosPublicos(Buffer.from(pem(Buffer.from("x".repeat(300)), "ENCRYPTED PRIVATE KEY")))).toHaveLength(0);
  });
  it("muitos certificados: PEM com 40 blocos e PKCS#7 com 15 ficam em no máximo 10", () => {
    const nomes = ["raiz", "outra", "inter", "inter2", "inter3", "sub", "interec", "empresa", "cliente", "testemunha", "revogado", "vencido", "semlcr", "critica", "cifra"];
    const blocos = Array.from({ length: 40 }, (_, i) => pem(pki.der[nomes[i % nomes.length]])).join("");
    expect(certificadosPublicos(Buffer.from(blocos)).length).toBeLessThanOrEqual(10);
    run(["crl2pkcs7", "-nocrl", ...nomes.flatMap(n => ["-certfile", `${n}.pem`]), "-outform", "DER", "-out", "muitos.p7b"]);
    const p7b = readFileSync(join(pki.dir, "muitos.p7b"));
    expect(certificadosPublicos(p7b).length).toBe(10);
    expect(certificadosPublicos(Buffer.from(pem(p7b, "PKCS7"))).length).toBe(10);
  });
  it("lixo e DER truncado nunca lançam", () => {
    expect(certificadosPublicos(Buffer.alloc(0))).toEqual([]);
    expect(certificadosPublicos(pki.der.inter.subarray(0, 100))).toEqual([]);
    expect(certificadosPublicos(Buffer.from("-----BEGIN CERTIFICATE-----\n!!!!\n-----END CERTIFICATE-----"))).toEqual([]);
  });
  // ACHADO I-1 (corrigido: leitura linear com indexOf e limites de tamanho/blocos). Era: a regex PEM com retrovisor (\1) e `[\s\S]*?` é quadrática quando o
  // arquivo tem muitos "-----BEGIN X-----" sem o END. O AIA pode trazer até 10 MB (LIMITES_PKI.bytesPorResposta) de um
  // endereço escolhido por quem fabrica o certificado (basta O=ICP-Brasil no emissor) — o regex síncrono trava o
  // processo muito além do prazo da sessão PKI. ~340 KB já levam segundos; 10 MB levaria horas.
  it("PEM malicioso (muitos BEGIN sem END, ~340 KB) é lido em menos de 1 s", () => {
    const hostil = Buffer.from("-----BEGIN CERTIFICATE-----\n" + "-----BEGIN A-----".repeat(20_000));
    const t = Date.now();
    certificadosPublicos(hostil);
    expect(Date.now() - t).toBeLessThan(1_000);
  }, 60_000);
});

describe("QA (4) AIA continua com as travas de rede", () => {
  const folha = () => pki.cert("empresa"); // AIA → URLS.interCert
  it("nome que resolve para IP interno: recusa sem conectar, inválido (não transitório)", async () => {
    const chamadas: string[] = [];
    const sessao = new SessaoPki({ resolver: async () => ["10.0.0.7"], transporte: async ({ url }) => { chamadas.push(url.href); return { status: 200, corpo: pki.der.inter }; } });
    const b = await encontrarCaminho(folha(), [], [pki.raiz], sessao, []);
    expect(b).toMatchObject({ chegou: false, transitoria: false });
    expect(chamadas).toEqual([]);
  });
  it("redirecionamento para host interno: recusado, sem segunda conexão", async () => {
    const chamadas: string[] = [];
    const sessao = new SessaoPki({
      resolver: async h => h === "interno.teste.example" ? ["192.168.1.10"] : ["93.184.216.34"],
      transporte: async ({ url }) => { chamadas.push(url.href); return { status: 302, location: "http://interno.teste.example/x.der" }; },
    });
    const b = await encontrarCaminho(folha(), [], [pki.raiz], sessao, []);
    expect(b.chegou).toBe(false);
    expect(chamadas).toEqual([URLS.interCert]);
  });
  it("emissor fora da hierarquia das raízes não dispara AIA", async () => {
    const s = semRede();
    await encontrarCaminho(pki.cert("empresa"), [], raizesIcp, s, []);
    expect(s.chamadas).toEqual([]);
  });
  it("com a intermediária embarcada, a rede não é usada", async () => {
    const s = semRede();
    const b = await encontrarCaminho(folha(), [], [pki.raiz], s, [pki.intermediaria]);
    expect(b.chegou).toBe(true);
    expect(s.chamadas).toEqual([]);
  });
});

describe("QA (5) revalidarDocumento é rota de painel", () => {
  it("cliente, corretor e conta inativa não chamam a reconferência manual", async () => {
    const { juridicoRouter } = await import("./juridico-router");
    for (const user of [{ id: 9, role: "cliente" }, { id: 8, role: "corretor" }, { id: 7, role: "admin", active: false }, { id: 6, role: "colaborador", permissions: "[]" }]) {
      const caller = juridicoRouter.createCaller({ user, req: {}, res: {} } as never);
      await expect(caller.revalidarDocumento({ documentId: 1, manual: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});
