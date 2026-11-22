// Cadeia e revogação com uma ICP SINTÉTICA real (OpenSSL + PKIjs 3.4.0), sem rede: AIA/LCR servidos por transporte simulado.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { criarPki, rede, URLS, type Pki } from "./__fixtures__/juridico-pki-ca";
import { conferirRevogacao, documentoDoCertificado, ekuPermiteAssinatura, limparCacheLcr, montarCadeia, politicaAssinaturaIcp, raizesIcp, validarCertificado } from "./juridico-pki";
import { ErroRedePki, EnderecoRecusadoPki, SessaoPki, _estadoConcorrencia, transportePadrao, urlCertificadora } from "./juridico-pki-download";

let pki: Pki;
beforeAll(() => { pki = criarPki(); }, 60_000);
afterAll(() => pki?.limpar());
beforeEach(() => limparCacheLcr());
const sessao = (r: ReturnType<typeof rede>, prazoMs?: number) => new SessaoPki({ resolver: r.resolver, transporte: r.transporte, prazoMs });

describe("cadeia ICP sintética no PKIjs 3.4.0", () => {
  it("válida: baixa a intermediária pelo AIA, ordena folha → raiz e confere as duas LCRs", async () => {
    const r = rede(pki);
    const cadeia = await montarCadeia(pki.cert("empresa"), [], [pki.raiz], sessao(r));
    expect(cadeia.estado).toBe("valida");
    expect(cadeia.caminho.map(c => c.subject.typesAndValues.find(t => t.type === "2.5.4.3")?.value.valueBlock.value)).toEqual(["EMPRESA TESTE:12345678000190", "AC INTERMEDIARIA DE TESTE", "RAIZ SINTETICA DE TESTE"]);
    const resultado = await validarCertificado(pki.cert("empresa"), [], [pki.raiz], sessao(r));
    expect(resultado).toMatchObject({ cadeia: "valida", revogacao: "regular", estado: "valida", transitoria: false });
    expect(resultado.certificados).toEqual([pki.der.inter.toString("base64")]);
    expect(r.chamadas).toEqual(expect.arrayContaining([URLS.interCert, URLS.interCrl, URLS.raizCrl]));
  });
  it("usa a cadeia fornecida (do PDF/A1) sem baixar o AIA", async () => {
    const r = rede(pki);
    const cadeia = await montarCadeia(pki.cert("empresa"), [pki.intermediaria], [pki.raiz], sessao(r));
    expect(cadeia.estado).toBe("valida");
    expect(r.chamadas).not.toContain(URLS.interCert);
  });
  it("revogada: o serial na LCR da intermediária torna a assinatura inválida", async () => {
    const r = await validarCertificado(pki.cert("revogado"), [], [pki.raiz], sessao(rede(pki)));
    expect(r).toMatchObject({ cadeia: "valida", revogacao: "revogado", estado: "invalida", transitoria: false });
  });
  it("vencida: certificado fora da validade é inválido e não depende de rede", async () => {
    const r = await validarCertificado(pki.cert("vencido"), [pki.intermediaria], [pki.raiz], sessao(rede(pki)));
    expect(r).toMatchObject({ estado: "invalida", cadeia: "invalida" });
    expect(r.motivo).toMatch(/vencido/);
  });
  it("indisponível: AIA ou LCR fora do ar ficam pendentes e transitórias, nunca válidas", async () => {
    const semAia = await validarCertificado(pki.cert("empresa"), [], [pki.raiz], sessao(rede(pki, { fora: [URLS.interCert] })));
    expect(semAia).toMatchObject({ estado: "pendente", cadeia: "pendente", transitoria: true });
    const semLcr = await validarCertificado(pki.cert("empresa"), [], [pki.raiz], sessao(rede(pki, { fora: [URLS.interCrl] })));
    expect(semLcr).toMatchObject({ estado: "pendente", cadeia: "valida", revogacao: "pendente", transitoria: true });
  });
  it("prazo esgotado (DNS que não responde) vira pendência, nunca verde", async () => {
    const lento = new SessaoPki({ resolver: () => new Promise(() => {}), transporte: rede(pki).transporte, prazoMs: 60 });
    const r = await validarCertificado(pki.cert("empresa"), [], [pki.raiz], lento);
    expect(r).toMatchObject({ estado: "pendente", transitoria: true });
  });
  it("LCR adulterada, de outro emissor ou vencida não confirmam nada", async () => {
    const adulterada = Buffer.from(pki.crl.intermediaria); adulterada[adulterada.length - 5] ^= 0xff;
    for (const trocar of [{ [URLS.interCrl]: adulterada }, { [URLS.interCrl]: pki.crl.outra }]) {
      limparCacheLcr();
      const r = await validarCertificado(pki.cert("revogado"), [], [pki.raiz], sessao(rede(pki, { trocar })));
      expect(r).toMatchObject({ estado: "pendente", revogacao: "pendente" });
    }
    const daqui8Dias = new Date(Date.now() + 8 * 86_400_000);
    const vencida = await validarCertificado(pki.cert("empresa"), [], [pki.raiz], sessao(rede(pki)), daqui8Dias);
    expect(vencida).toMatchObject({ estado: "pendente", revogacao: "pendente" });
    expect(vencida.motivo).toMatch(/LCR vencida/);
  });
  it("outro emissor: cadeia que não chega a raiz confiável é inválida", async () => {
    const r = await validarCertificado(pki.cert("estranho"), [], [pki.raiz], sessao(rede(pki)));
    expect(r).toMatchObject({ estado: "invalida", cadeia: "invalida" });
    // Raízes oficiais ICP-Brasil também não aceitam a ICP sintética.
    const oficial = await validarCertificado(pki.cert("empresa"), [pki.intermediaria], raizesIcp, sessao(rede(pki)));
    expect(oficial.estado).toBe("invalida");
  });
  it("sem LCR no certificado: pendente para conferência manual (não transitória)", async () => {
    const r = await validarCertificado(pki.cert("semlcr"), [], [pki.raiz], sessao(rede(pki)));
    expect(r).toMatchObject({ estado: "pendente", revogacao: "pendente", transitoria: false });
  });
  it("extensão crítica desconhecida e chave sem uso de assinatura não passam", async () => {
    expect(await validarCertificado(pki.cert("critica"), [], [pki.raiz], sessao(rede(pki)))).toMatchObject({ estado: "pendente", transitoria: false });
    expect(await validarCertificado(pki.cert("cifra"), [], [pki.raiz], sessao(rede(pki)))).toMatchObject({ estado: "invalida" });
  });
  it("cache de LCR: segunda conferência não baixa de novo enquanto a LCR estiver vigente", async () => {
    const r = rede(pki);
    await validarCertificado(pki.cert("empresa"), [pki.intermediaria], [pki.raiz], sessao(r));
    const antes = r.chamadas.length;
    expect(await validarCertificado(pki.cert("cliente"), [pki.intermediaria], [pki.raiz], sessao(r))).toMatchObject({ estado: "valida" });
    expect(r.chamadas.length).toBe(antes);
  });
  it("conferirRevogacao exige o emissor certo: LCR verdadeira com emissor trocado não vale", async () => {
    const r = await conferirRevogacao(pki.cert("empresa"), pki.outraRaiz, sessao(rede(pki)));
    expect(r.estado).toBe("pendente");
  });
});

describe("regras extras (portão de QA de 22/11)", () => {
  it("intermediária revogada na LCR da raiz invalida a assinatura", async () => {
    const r = await validarCertificado(pki.cert("sob_inter2"), [], [pki.raiz], sessao(rede(pki)));
    expect(r).toMatchObject({ estado: "invalida", revogacao: "revogado" });
    expect(r.motivo).toMatch(/autoridade revogado/);
  });
  it("LCR delta e escopos de IDP: só o escopo compatível confirma", async () => {
    const com = async (crl: Buffer) => { limparCacheLcr(); return validarCertificado(pki.cert("empresa"), [pki.intermediaria], [pki.raiz], sessao(rede(pki, { trocar: { [URLS.interCrl]: crl } }))); };
    expect(await com(pki.crl.delta)).toMatchObject({ estado: "pendente", revogacao: "pendente" });
    expect(await com(pki.crl.idpOk)).toMatchObject({ estado: "valida", revogacao: "regular" });
    expect(await com(pki.crl.idpSoCa)).toMatchObject({ estado: "pendente" });
    expect(await com(pki.crl.idpOutro)).toMatchObject({ estado: "pendente" });
  });
  it("CA sem cRLSign não serve para assinar a LCR", async () => {
    const r = await validarCertificado(pki.cert("sob_inter3"), [], [pki.raiz], sessao(rede(pki)));
    expect(r).toMatchObject({ estado: "pendente", revogacao: "pendente" });
    expect(r.motivo).toMatch(/permissão para assinar LCR/);
  });
  it("pathLen: sub-AC abaixo de AC com pathlen:0 é inválida", async () => {
    const r = await validarCertificado(pki.cert("sob_sub"), [pki.intermediaria, pki.cert("sub")], [pki.raiz], sessao(rede(pki)));
    expect(r).toMatchObject({ estado: "invalida" });
    expect(r.motivo).toMatch(/limite de níveis/);
  });
  it("EKU: só servidor/carimbo de tempo é recusado; e-mail (padrão ICP-Brasil) é aceito", async () => {
    expect(ekuPermiteAssinatura(pki.cert("servidor"))).toBe(false);
    expect(ekuPermiteAssinatura(pki.cert("email"))).toBe(true);
    expect(ekuPermiteAssinatura(pki.cert("empresa"))).toBe(true);
    expect(await validarCertificado(pki.cert("servidor"), [pki.intermediaria], [pki.raiz], sessao(rede(pki)))).toMatchObject({ estado: "invalida" });
    expect(await validarCertificado(pki.cert("email"), [pki.intermediaria], [pki.raiz], sessao(rede(pki)))).toMatchObject({ estado: "valida" });
  });
  it("CPF/CNPJ do SAN otherName ICP-Brasil, com o nome comum como alternativa; política ICP exigida só nas raízes oficiais", () => {
    expect(documentoDoCertificado(pki.cert("san"))).toBe("12345678000190");
    expect(documentoDoCertificado(pki.cert("empresa"))).toBe("12345678000190");
    expect(politicaAssinaturaIcp(pki.cert("empresa"))).toBe(false);
  });
  it("algoritmo não suportado pelo WebCrypto (ECDSA secp256k1) fica pendente para conferência manual, não inválido", async () => {
    const r = await validarCertificado(pki.cert("sob_interec"), [pki.cert("interec")], [pki.raiz], sessao(rede(pki)));
    expect(r).toMatchObject({ estado: "pendente", transitoria: false });
    expect(r.motivo).toMatch(/não suportado/);
  });
  it("AIA de certificado fora da hierarquia das raízes confiáveis não é seguido (sem rede)", async () => {
    const r = rede(pki);
    expect((await validarCertificado(pki.cert("empresa"), [], raizesIcp, sessao(r))).estado).toBe("invalida");
    expect(r.chamadas).toEqual([]);
  });
});

describe("download PKI: SSRF, prazo e limites", () => {
  it("recusa endereços fora da política", () => {
    for (const url of ["file:///etc/passwd", "ftp://ac.example/a.crl", "http://127.0.0.1/a.crl", "http://2130706433/a.crl", "http://[::1]/a.crl",
      "http://user:senha@ac.example/a.crl", "http://ac.example:8080/a.crl", "http://localhost/a.crl", "http://intranet/a.crl", "http://x.local/a.crl", "gopher://ac.example/"]) {
      expect(() => urlCertificadora(url), url).toThrow(EnderecoRecusadoPki);
    }
    expect(urlCertificadora("http://ac.example/a.crl").href).toBe("http://ac.example/a.crl");
    expect(urlCertificadora("https://ac.example:443/a.crl").host).toBe("ac.example");
  });
  it("DNS com qualquer IP privado/reservado é recusado sem abrir conexão; o IP público é fixado na conexão", async () => {
    for (const ips of [["10.0.0.5"], ["93.184.216.34", "169.254.169.254"], ["100.64.1.1"], ["0.0.0.0"], ["224.0.0.1"], ["255.255.255.255"], ["::1"], ["fd00::1"]]) {
      let abriu = false;
      const s = new SessaoPki({ resolver: async () => ips, transporte: async () => { abriu = true; return { status: 200, corpo: Buffer.from("x") }; } });
      await expect(s.baixar("http://ac.example/a.crl")).rejects.toBeInstanceOf(EnderecoRecusadoPki);
      expect(abriu).toBe(false);
    }
    let ip = "";
    const ok = new SessaoPki({ resolver: async () => ["93.184.216.34"], transporte: async p => { ip = p.ip; return { status: 200, corpo: Buffer.from("ok") }; } });
    expect((await ok.baixar("http://ac.example/a.crl")).toString()).toBe("ok");
    expect(ip).toBe("93.184.216.34");
  });
  it("redirecionamento passa pela mesma conferência, conta como requisição e tem limite", async () => {
    const resolver = async (host: string) => host === "interno.example" ? ["192.168.0.10"] : ["93.184.216.34"];
    const paraInterno = new SessaoPki({ resolver, transporte: async () => ({ status: 302, location: "http://interno.example/x" }) });
    await expect(paraInterno.baixar("http://ac.example/a.crl")).rejects.toBeInstanceOf(EnderecoRecusadoPki);
    const paraIp = new SessaoPki({ resolver, transporte: async () => ({ status: 301, location: "http://169.254.169.254/latest" }) });
    await expect(paraIp.baixar("http://ac.example/a.crl")).rejects.toBeInstanceOf(EnderecoRecusadoPki);
    const rebaixa = new SessaoPki({ resolver, transporte: async () => ({ status: 302, location: "http://ac.example/a.crl" }) });
    await expect(rebaixa.baixar("https://ac.example/a.crl")).rejects.toThrow(/HTTPS para HTTP/);
    const laco = new SessaoPki({ resolver, transporte: async () => ({ status: 302, location: "/de-novo" }) });
    await expect(laco.baixar("http://ac.example/a.crl")).rejects.toBeInstanceOf(ErroRedePki);
    expect(laco.requisicoes).toBe(3);
  });
  it("limite de requisições por sessão e de bytes por resposta", async () => {
    const s = new SessaoPki({ resolver: async () => ["93.184.216.34"], transporte: async () => ({ status: 200, corpo: Buffer.from("x") }), requisicoes: 2 });
    await s.baixar("http://ac.example/1"); await s.baixar("http://ac.example/2");
    await expect(s.baixar("http://ac.example/3")).rejects.toThrow(/Limite de consultas/);
    const grande = new SessaoPki({ resolver: async () => ["93.184.216.34"], transporte: async ({ limiteBytes }) => ({ status: 200, corpo: Buffer.alloc(limiteBytes + 1) }) });
    await expect(grande.baixar("http://ac.example/g")).rejects.toThrow(/acima do limite/);
  });
  it("prazo total inclui transporte lento e libera a vaga de concorrência", async () => {
    const s = new SessaoPki({ resolver: async () => ["93.184.216.34"], transporte: () => new Promise(() => {}), prazoMs: 50 });
    const inicio = Date.now();
    await expect(s.baixar("http://ac.example/lento")).rejects.toBeInstanceOf(ErroRedePki);
    expect(Date.now() - inicio).toBeLessThan(2_000);
    expect(_estadoConcorrencia()).toEqual({ emUso: 0, naFila: 0 });
  });
  it("no máximo 4 downloads simultâneos no processo", async () => {
    let ativos = 0, maximo = 0;
    const transporte = async () => { ativos++; maximo = Math.max(maximo, ativos); await new Promise(r => setTimeout(r, 20)); ativos--; return { status: 200, corpo: Buffer.from("x") }; };
    await Promise.all(Array.from({ length: 10 }, (_, i) => new SessaoPki({ resolver: async () => ["93.184.216.34"], transporte }).baixar(`http://ac.example/${i}`)));
    expect(maximo).toBe(4);
    expect(_estadoConcorrencia()).toEqual({ emUso: 0, naFila: 0 });
  });
  it("transporte padrão conecta no IP fixado, sem nova resolução do nome (servidor local, sem rede externa)", async () => {
    const servidor = createServer((req, res) => { res.end(`host=${req.headers.host}`); });
    await new Promise<void>(r => servidor.listen(0, "127.0.0.1", () => r()));
    const porta = (servidor.address() as { port: number }).port;
    try {
      // O nome .example não existe: se o Node resolvesse de novo, falharia com ENOTFOUND. (A porta não padrão só existe
      // neste teste do transporte; urlCertificadora recusa porta não padrão antes de chegar aqui.)
      const url = new URL(`http://pki-fixado.teste.example:${porta}/a.crl`);
      const resposta = await transportePadrao({ url, ip: "127.0.0.1", signal: AbortSignal.timeout(3_000), limiteBytes: 1024 });
      expect(resposta.status).toBe(200);
      expect(String(resposta.corpo)).toBe(`host=pki-fixado.teste.example:${porta}`);
      await expect(transportePadrao({ url, ip: "127.0.0.1", signal: AbortSignal.timeout(3_000), limiteBytes: 4 })).rejects.toThrow(/acima do limite/);
    } finally { servidor.close(); }
  });
});
