// EPIC-029 S-4 (22/11/2026) — fundação da emissão, sem nenhuma chamada ao governo:
// (1) DPS montada por fixture nas duas variantes de leiaute; (2) assinatura XML-DSig verificada por conta própria com
// node:crypto (sem a biblioteca que assinou); (3) cliente mTLS: recusa ambiente desligado/produção/endereço não
// confirmado/host fora da lista, nunca desliga a verificação TLS (servidor local autoassinado é recusado), mTLS de verdade
// contra servidor falso local, tempo-limite. Certificados de TESTE gerados no próprio teste.
import { createHash, verify as verificarRsa } from "node:crypto";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { DOMParser } from "@xmldom/xmldom";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PARAMETROS_VAZIOS, PADRAO_ID_DPS, type EntradaDps, type ParametrosContador } from "../../shared/fiscal/dps-campos.js";
import { ALGORITMOS, assinarXml, ErroAssinatura, verificarAssinaturaXml } from "./assinatura.js";
import { abrirPfx, type CredencialA1 } from "./certificado.js";
import { gerarCertificado, pastaDeTeste, SENHA_TESTE } from "./certificados-teste.helper.js";
import { entradaDaNota, ErroDps, escaparXml, faltasDps, idDps, montarDps, serializarDps } from "./dps.js";
import {
  CA_CONFIAVEIS, CAMINHOS, caminhoDe, compactarXml, criarClienteSefin, descompactarXml, destinoDo, ENDERECOS, ErroSefin, montarUrl,
  MENSAGEM_DESLIGADO, MENSAGEM_PRODUCAO_BLOQUEADA, opcoesTls, testarConexaoSefin, type MapaEnderecos,
} from "./sefin.js";
import type { NotaDetalhada } from "./notas.js";
import type { FiscalEmissor } from "../../drizzle/schema-fiscal.js";

const pasta = pastaDeTeste();
let cred: CredencialA1, outroCred: CredencialA1;
let servidorCert: ReturnType<typeof gerarCertificado>;
beforeAll(async () => {
  const c = gerarCertificado(pasta.dir, "emissor");
  cred = await abrirPfx(c.pfx, SENHA_TESTE);
  outroCred = await abrirPfx(gerarCertificado(pasta.dir, "outro").pfx, SENHA_TESTE);
  servidorCert = gerarCertificado(pasta.dir, "servidor-local", { cn: "localhost", cnpj: "", uso: "serverAuth" });
}, 60_000);
afterAll(() => pasta.limpar());

const PARAMETROS: ParametrosContador = {
  opSimpNac: "3", regApTribSN: "1", regEspTrib: "0", tribIssqn: "1", tpRetIssqn: "1", indTotTrib: "0",
  ibscbs: { indFinal: "0", cIndOp: "100301", indDest: "0", cst: "000", cClassTrib: "000001" },
};
const ENTRADA: EntradaDps = {
  ambiente: "producao_restrita",
  emitidoEm: new Date("2026-11-22T13:00:00.000Z"),
  competencia: "2026-11-20",
  serie: "1",
  numero: 42,
  prestador: { cnpj: "11.222.333/0001-81", inscricaoMunicipal: "12345", municipioIbge: "2105302" },
  tomador: { documento: "123.456.789-09", nome: "Cliente & Filhos <Teste>" },
  servico: { municipioIncidenciaIbge: "2105302", codigoTributacaoNacional: "070201", codigoNbs: "114011000", itemLc116: "7.02", codigoAtividadeSimples: "13",
    descricao: "Administração de obra", cno: "900012345678" },
  valorCentavos: 1_234_56,
  regimeTributario: "simples_nacional", // decisão do dono (22/11): todas as empresas no Simples Nacional
  aliquotaIss: "5.0000",
  parametros: PARAMETROS,
};
const ID = "DPS210530221122233300018100001000000000000042";

/** Fixture: a DPS esperada (produção restrita, leiaute com a NT 009). */
const FIXTURE_PR = `<?xml version="1.0" encoding="UTF-8"?><DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infDPS Id="${ID}">`
  + `<tpAmb>2</tpAmb><dhEmi>2026-11-22T10:00:00-03:00</dhEmi><verAplic>Prospecta-1.0</verAplic><serie>1</serie><nDPS>42</nDPS>`
  + `<dCompet>2026-11-20</dCompet><tpEmit>1</tpEmit><finNFSe>0</finNFSe><cLocEmi>2105302</cLocEmi>`
  + `<prest><CNPJ>11222333000181</CNPJ><IM>12345</IM><regTrib><opSimpNac>3</opSimpNac><regApTribSN>1</regApTribSN><cAtvSN>13</cAtvSN><regEspTrib>0</regEspTrib></regTrib></prest>`
  + `<toma><CPF>12345678909</CPF><xNome>Cliente &amp; Filhos &lt;Teste&gt;</xNome></toma>`
  + `<serv><locPrest><cLocPrestacao>2105302</cLocPrestacao></locPrest><cServ><cTribNac>070201</cTribNac><xDescServ>Administração de obra</xDescServ><cNBS>114011000</cNBS></cServ><obra><cObra>900012345678</cObra></obra></serv>`
  + `<valores><vServPrest><vServ>1234.56</vServ></vServPrest><trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN><pAliq>5.0000</pAliq></tribMun>`
  + `<totTrib><indTotTrib>0</indTotTrib></totTrib></trib></valores>`
  + `<IBSCBS><indFinal>0</indFinal><cIndOp>100301</cIndOp><indDest>0</indDest><valores><trib><CST>000</CST><cClassTrib>000001</cClassTrib></trib></valores></IBSCBS>`
  + `</infDPS></DPS>`;

describe("DPS — montagem pura por fixture", () => {
  it("produção restrita: bate com a fixture, Id de 45 no padrão oficial, sem espaço entre tags e bem formada", () => {
    const { id, xml, variante } = montarDps(ENTRADA);
    expect(variante).toBe("producao_restrita_20261020");
    expect(id).toBe(ID);
    expect(id).toHaveLength(45);
    expect(id).toMatch(PADRAO_ID_DPS);
    expect(xml).toBe(FIXTURE_PR);
    expect(xml).not.toMatch(/>\s+</);
    expect(xml).not.toMatch(/<\w+:/); // sem prefixo de namespace (E1228)
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    expect(doc.getElementsByTagName("xNome")[0]!.textContent).toBe("Cliente & Filhos <Teste>");
  });
  it("variante de produção (09/02/2026): finNFSe dentro de IBSCBS e classificação em gIBSCBS; tpAmb 1", () => {
    const xml = serializarDps({ ...ENTRADA, ambiente: "producao" }, ID, "producao_20260209");
    expect(xml).toContain("<tpAmb>1</tpAmb>");
    expect(xml).not.toContain("<tpEmit>1</tpEmit><finNFSe>");
    expect(xml).toContain("<IBSCBS><finNFSe>0</finNFSe>");
    expect(xml).toContain("<valores><trib><gIBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib></gIBSCBS></trib></valores></IBSCBS>");
  });
  it("IBS/CBS: só a classificação — nenhuma alíquota ou valor de IBS/CBS sai na DPS", () => {
    expect(FIXTURE_PR).not.toMatch(/pIBS|pCBS|vIBS|vCBS/);
  });
  it("CNO da obra entra no grupo obra quando informado; CNPJ do tomador vai em CNPJ", () => {
    const { xml } = montarDps({ ...ENTRADA, tomador: { documento: "55.444.333/0001-22", nome: "Empresa Tomadora" }, servico: { ...ENTRADA.servico, cno: "900012345678" } });
    expect(xml).toContain("<toma><CNPJ>55444333000122</CNPJ>");
    expect(xml).toContain("<obra><cObra>900012345678</cObra></obra>");
  });
  it("campo do contador nulo → recusa com a LISTA do que falta (nada é inventado)", () => {
    const e = (() => { try { montarDps({ ...ENTRADA, regimeTributario: "lucro_presumido", parametros: PARAMETROS_VAZIOS, aliquotaIss: null }); } catch (x) { return x as ErroDps; } })()!;
    expect(e).toBeInstanceOf(ErroDps);
    expect(e.faltas).toEqual(expect.arrayContaining([
      expect.stringMatching(/opSimpNac/), expect.stringMatching(/regEspTrib/), expect.stringMatching(/tribISSQN/), expect.stringMatching(/tpRetISSQN/),
      expect.stringMatching(/indTotTrib/), expect.stringMatching(/indicador do destinatário/), expect.stringMatching(/CST/), expect.stringMatching(/cClassTrib/),
    ]));
    // cIndOp e indFinal são opcionais no leiaute da produção restrita: sem eles a DPS sai sem as tags
    const { xml } = montarDps({ ...ENTRADA, parametros: { ...PARAMETROS, ibscbs: { ...PARAMETROS.ibscbs, cIndOp: null, indFinal: null } } });
    expect(xml).toContain("<IBSCBS><indDest>0</indDest><valores>");
  });
  it("Simples Nacional: opção do Simples coerente com o regime; IBSCBS fica fora até 2027 quando não classificado", () => {
    expect(faltasDps({ ...ENTRADA, parametros: { ...PARAMETROS, opSimpNac: "1" } })).toEqual([expect.stringMatching(/coerente com o regime Simples/)]);
    expect(faltasDps({ ...ENTRADA, parametros: { ...PARAMETROS, regApTribSN: null } })).toEqual([expect.stringMatching(/regApTribSN/)]);
    expect(faltasDps({ ...ENTRADA, regimeTributario: "lucro_presumido" })).toEqual([expect.stringMatching(/não optante/)]);
    expect(faltasDps({ ...ENTRADA, regimeTributario: null })).toEqual([expect.stringMatching(/regime tributário/)]);
    const semClass = { ...PARAMETROS, ibscbs: { indFinal: null, cIndOp: null, indDest: null, cst: null, cClassTrib: null } };
    const { xml } = montarDps({ ...ENTRADA, parametros: semClass });
    expect(xml).not.toContain("<IBSCBS>");
    expect(faltasDps({ ...ENTRADA, competencia: "2027-01-02", parametros: semClass })).toEqual(expect.arrayContaining([expect.stringMatching(/CST/)]));
    expect(faltasDps({ ...ENTRADA, parametros: { ...semClass, ibscbs: { ...semClass.ibscbs, cst: "000" } } })).toEqual(expect.arrayContaining([expect.stringMatching(/cClassTrib/)]));
  });
  it("recusa ambiente desligado e produção, série fora de 1–49999, sem tomador, valor zero", () => {
    expect(faltasDps({ ...ENTRADA, ambiente: "desligado" })[0]).toMatch(/produção restrita/);
    expect(faltasDps({ ...ENTRADA, ambiente: "producao" })[0]).toMatch(/bloqueada/);
    expect(faltasDps({ ...ENTRADA, serie: "50000" })).toEqual([expect.stringMatching(/série/)]);
    expect(faltasDps({ ...ENTRADA, serie: "0" })).toEqual([expect.stringMatching(/série/)]);
    expect(faltasDps({ ...ENTRADA, tomador: null })).toEqual(expect.arrayContaining([expect.stringMatching(/CPF ou CNPJ do tomador/)]));
    expect(faltasDps({ ...ENTRADA, valorCentavos: 0 })).toEqual([expect.stringMatching(/valor/)]);
    expect(() => idDps("2105302", "11222333000181", "1", 0)).toThrow(ErroDps);
  });
  it("QA S-4 (B4): xDescServ cortado em 2000 caracteres sem partir emoji; U+FFFE/U+FFFF e surrogates soltos saem", () => {
    const { xml } = montarDps({ ...ENTRADA, servico: { ...ENTRADA.servico, descricao: `${"a".repeat(1999)}😀😀` } });
    const desc = /<xDescServ>([^<]*)<\/xDescServ>/.exec(xml)![1]!;
    expect(Array.from(desc)).toHaveLength(2000);
    expect(desc.endsWith("😀")).toBe(true);
    expect(escaparXml("a\uFFFEb\uFFFFc\uD800d\uDC00e😀")).toBe("abcde😀");
  });
    it("Simples exige cAtvSN do tipo de serviço; 7.02/7.05 exigem o grupo obra (CNO); IM só quando o emissor tem; reembolso recusado", () => {
    expect(faltasDps({ ...ENTRADA, servico: { ...ENTRADA.servico, codigoAtividadeSimples: null } })).toEqual([expect.stringMatching(/cAtvSN/)]);
    expect(faltasDps({ ...ENTRADA, servico: { ...ENTRADA.servico, codigoAtividadeSimples: "IMP" } })).toEqual([expect.stringMatching(/cAtvSN/)]);
    expect(faltasDps({ ...ENTRADA, servico: { ...ENTRADA.servico, cno: null } })).toEqual([expect.stringMatching(/grupo "obra"/)]);
    expect(faltasDps({ ...ENTRADA, servico: { ...ENTRADA.servico, itemLc116: "7.05", codigoTributacaoNacional: "070501", cno: null } })).toEqual([expect.stringMatching(/grupo "obra"/)]);
    expect(faltasDps({ ...ENTRADA, servico: { ...ENTRADA.servico, itemLc116: "28.01", codigoTributacaoNacional: "280101", cno: null } })).toEqual([]);
    // não optante: sem cAtvSN na DPS
    const presumido = { ...ENTRADA, regimeTributario: "lucro_presumido", parametros: { ...PARAMETROS, opSimpNac: "1", regApTribSN: null } };
    expect(montarDps(presumido).xml).not.toContain("cAtvSN");
    expect(montarDps({ ...ENTRADA, prestador: { ...ENTRADA.prestador, inscricaoMunicipal: null } }).xml).toContain("<prest><CNPJ>11222333000181</CNPJ><regTrib>");
    expect(faltasDps({ ...ENTRADA, reembolsoCentavos: 5_000 })).toEqual([expect.stringMatching(/reembolso\/repasse.*vCalcAjusteBCIBSCBS/)]);
  });
  it("Id aceita CNPJ alfanumérico (NT 009) e nDPS sai sem zero à esquerda", () => {
    expect(idDps("2105302", "12ABC34501DE35", "49999", 7)).toBe("DPS2105302212ABC34501DE3549999000000000000007");
    expect(montarDps({ ...ENTRADA, numero: 7 }).xml).toContain("<nDPS>7</nDPS>");
  });
  it("adaptador: rascunho + emissor + tipo de serviço → entrada (nada digitado de novo)", () => {
    const nota = {
      dataEvento: "2026-11-20", valorCentavos: 50_000, descricao: "Regularização", municipioIncidenciaIbge: null,
      municipio: { nome: "Imperatriz", uf: "MA", fonte: "emissor" }, emissor: { regime: "simples_nacional" }, tomador: { tipo: "bpo", nome: "Fulano", documento: "12345678909", cidade: null, uf: null },
      tipoServico: { codigoTributacaoNacional: "280101", codigoNbs: null, itemLc116: "28.01", codigoAtividadeSimples: "9", aliquotaIss: "2.0000" },
    } as unknown as NotaDetalhada;
    const emissor = { cnpj: "11222333000181", ambiente: "producao_restrita", serieDps: "1", inscricaoMunicipal: null, municipioIbge: "2105302" } as unknown as FiscalEmissor;
    const e = entradaDaNota(nota, emissor, { numero: 1, emitidoEm: ENTRADA.emitidoEm, parametros: PARAMETROS });
    expect(e).toMatchObject({ regimeTributario: "simples_nacional", competencia: "2026-11-20", valorCentavos: 50_000, serie: "1", tomador: { nome: "Fulano" }, aliquotaIss: "2.0000",
      servico: { municipioIncidenciaIbge: "2105302", codigoTributacaoNacional: "280101", itemLc116: "28.01", codigoAtividadeSimples: "9", descricao: "Regularização" } });
    expect(faltasDps(e)).toEqual([]);
  });
});

/** Verificação INDEPENDENTE (node:crypto, sem o xml-crypto): digest do infDPS canonizado e RSA sobre o SignedInfo. */
function verificarPorFora(assinado: string, certPem: string, hash: "sha1" | "sha256") {
  const infDps = /<infDPS [^>]*>[\s\S]*<\/infDPS>/.exec(assinado)![0];
  // C14N inclusiva do subconjunto: o namespace padrão herdado entra no elemento raiz do subconjunto (antes dos atributos).
  const infC14n = infDps.replace("<infDPS ", '<infDPS xmlns="http://www.sped.fazenda.gov.br/nfse" ');
  const digest = /<DigestValue>([^<]+)<\/DigestValue>/.exec(assinado)![1];
  expect(createHash(hash).update(infC14n, "utf8").digest("base64")).toBe(digest);
  const signedInfo = /<SignedInfo>[\s\S]*<\/SignedInfo>/.exec(assinado)![0]
    .replace("<SignedInfo>", '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">')
    // C14N escreve elemento vazio com abertura e fechamento
    .replace(/<(\w+)([^<>]*?)\/>/g, "<$1$2></$1>");
  const valor = Buffer.from(/<SignatureValue>([^<]+)<\/SignatureValue>/.exec(assinado)![1]!.replace(/\s/g, ""), "base64");
  return verificarRsa(hash === "sha1" ? "RSA-SHA1" : "RSA-SHA256", Buffer.from(signedInfo, "utf8"), certPem, valor);
}

describe("assinatura XML-DSig envelopada (certificado de TESTE)", () => {
  // Fixture sem aspas no texto (para a canonização manual da verificação independente ser exata)
  const dps = () => montarDps({ ...ENTRADA, tomador: { documento: "12345678909", nome: "Cliente Teste" } }).xml;
  it("padrão do manual: RSA-SHA1 + SHA-1, C14N inclusiva, enveloped, URI=#Id, só o certificado final", () => {
    const assinado = assinarXml(dps(), cred);
    expect(assinado).toContain(`<Reference URI="#${ID}">`);
    expect(assinado).toContain(`Algorithm="${ALGORITMOS.sha1.assinatura}"`);
    expect(assinado).toContain(`Algorithm="${ALGORITMOS.sha1.digest}"`);
    expect(assinado).toContain('Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"');
    expect(assinado.match(/Algorithm="http:\/\/www\.w3\.org\/TR\/2001\/REC-xml-c14n-20010315"/g)).toHaveLength(2);
    expect(assinado.match(/<X509Certificate>/g)).toHaveLength(1);
    expect(verificarAssinaturaXml(assinado, cred.certPem)).toBe(true);
    expect(verificarPorFora(assinado, cred.certPem, "sha1")).toBe(true);
  });
  it("Signature é filha de DPS e IRMÃ de infDPS, logo depois dela (MANINT §6.1.4) — não dentro de infDPS", () => {
    const doc = new DOMParser().parseFromString(assinarXml(dps(), cred), "text/xml");
    const raiz = doc.documentElement!;
    const filhos = Array.from(raiz.childNodes).filter(n => n.nodeType === 1).map(n => (n as Element).localName);
    expect(filhos).toEqual(["infDPS", "Signature"]);
    expect(doc.getElementsByTagName("infDPS")[0]!.getElementsByTagName("Signature")).toHaveLength(0);
  });
  it("SHA-256 (a testar na homologação) também assina e verifica", () => {
    const assinado = assinarXml(dps(), cred, "infDPS", "sha256");
    expect(verificarAssinaturaXml(assinado, cred.certPem)).toBe(true);
    expect(verificarPorFora(assinado, cred.certPem, "sha256")).toBe(true);
  });
  it("XML alterado depois de assinar, ou outro certificado → não verifica", () => {
    const assinado = assinarXml(dps(), cred);
    expect(verificarAssinaturaXml(assinado.replace("<vServ>1234.56</vServ>", "<vServ>9234.56</vServ>"), cred.certPem)).toBe(false);
    expect(verificarAssinaturaXml(assinado, outroCred.certPem)).toBe(false);
  });
  it("recusa XML já assinado, sem Id, com o elemento repetido, ou com cadeia no lugar do certificado final", () => {
    const assinado = assinarXml(dps(), cred);
    expect(() => assinarXml(assinado, cred)).toThrow(/já está assinado/);
    expect(() => assinarXml("<DPS><infDPS>x</infDPS></DPS>", cred)).toThrow(/atributo Id/);
    expect(() => assinarXml('<DPS><infDPS Id="a1"/><infDPS Id="a2"/></DPS>', cred)).toThrow(ErroAssinatura);
    expect(() => assinarXml(dps(), { ...cred, certPem: cred.certPem + outroCred.certPem })).toThrow(/certificado final/);
  });
  it("XML com DOCTYPE é recusado ao assinar e não verifica", () => {
    const comDoctype = dps().replace("?>", "?><!DOCTYPE DPS>");
    expect(() => assinarXml(comDoctype, cred)).toThrow(/DOCTYPE/);
    const assinado = assinarXml(dps(), cred);
    expect(verificarAssinaturaXml(assinado.replace("?>", "?><!DOCTYPE DPS>"), cred.certPem)).toBe(false);
  });
    it("assina também o pedido de evento (infPedReg dentro de pedRegEvento)", () => {
    const evento = `<?xml version="1.0" encoding="UTF-8"?><pedRegEvento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infPedReg Id="PRE1">x</infPedReg></pedRegEvento>`;
    const assinado = assinarXml(evento, cred, "infPedReg");
    expect(assinado).toMatch(/<\/infPedReg><Signature/);
    expect(verificarAssinaturaXml(assinado, cred.certPem, "infPedReg")).toBe(true);
  });
});

describe("cliente mTLS (Sefin/ADN) — sem chamada real", () => {
  it("ambiente desligado, produção e desconhecido são recusados; Sefin da produção restrita confirmada, ADN não", () => {
    expect(() => destinoDo("desligado", "sefin")).toThrow(MENSAGEM_DESLIGADO);
    expect(() => destinoDo("producao", "sefin")).toThrow(MENSAGEM_PRODUCAO_BLOQUEADA);
    expect(() => destinoDo("teste", "sefin")).toThrow(/desconhecido/);
    expect(destinoDo("producao_restrita", "sefin")).toMatchObject({ host: "sefin.producaorestrita.nfse.gov.br", base: "/API/SefinNacional", baseAlternativa: "/SefinNacional" });
    expect(() => destinoDo("producao_restrita", "adn")).toThrow(/não foi confirmado/);
    expect(ENDERECOS.producao_restrita.sefin.host).toBe("sefin.producaorestrita.nfse.gov.br");
    expect(ENDERECOS.producao.sefin).toMatchObject({ host: "sefin.nfse.gov.br", base: "/SefinNacional" });
    expect(() => criarClienteSefin({ ambiente: "desligado", servico: "sefin", credencial: cred })).toThrow(MENSAGEM_DESLIGADO);
  });
  it("URL com host fixo: caminho com outro host, '..', '//', '@' ou esquema é recusado", () => {
    const d = { host: "sefin.producaorestrita.nfse.gov.br", base: "/API/SefinNacional", hostConfirmado: true, baseConfirmada: true, fonte: "t" };
    expect(montarUrl(d, "/nfse").href).toBe("https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional/nfse");
    expect(montarUrl({ ...d, baseAlternativa: "/SefinNacional" }, "/nfse", true).href).toBe("https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse");
    expect(() => montarUrl(d, "/nfse", true)).toThrow(/alternativa/);
    expect(() => montarUrl(d, "/%2e%2e/x")).toThrow(ErroSefin);
    for (const ruim of ["//evil.example/x", "/../x", "https://evil.example/x", "/x@evil.example", "nfse", "/a\\b"]) expect(() => montarUrl(d, ruim), ruim).toThrow(ErroSefin);
  });
  it("caminhos oficiais com valores só alfanuméricos; DANFSe não existe mais como caminho (API suspensa)", () => {
    expect(caminhoDe("consultarDps", { id: ID })).toBe(`/dps/${ID}`);
    expect(caminhoDe("convenioMunicipal", { ibge: "2105302" })).toBe("/parametros_municipais/2105302/convenio");
    expect(() => caminhoDe("consultarNfse", { chave: "../../x" })).toThrow(/inválido/);
    expect("danfse" in CAMINHOS).toBe(false);
  });
  it("opções TLS: verificação sempre ligada, raízes ICP-Brasil + Node, certificado do cliente, tempo-limite de 25 s", () => {
    const chamadas: Record<string, unknown>[] = [];
    const cliente = criarClienteSefin({ ambiente: "producao_restrita", servico: "sefin", credencial: cred,
      requestImpl: (o => { chamadas.push(o as never); throw new Error("sem rede no teste"); }) as never });
    return cliente.requisitar("GET", "/nfse/x").catch(() => {
      expect(chamadas).toHaveLength(1);
      expect(chamadas[0]).toMatchObject({ hostname: "sefin.producaorestrita.nfse.gov.br", rejectUnauthorized: true, minVersion: "TLSv1.2", timeout: 25_000, key: cred.chavePem });
      expect((chamadas[0]!.ca as string[]).length).toBe(CA_CONFIAVEIS.length);
      expect(CA_CONFIAVEIS.filter(c => c.includes("BEGIN CERTIFICATE")).length).toBeGreaterThan(10);
      expect(opcoesTls(new URL("https://h/x"), cred, "GET", {}, 1, []).rejectUnauthorized).toBe(true);
    });
  });

  describe("servidor falso LOCAL (https, nunca o governo)", () => {
    let servidor: Server; let porta = 0; let clienteVisto: string | null = null; let pendurar = false;
    beforeAll(async () => {
      servidor = createServer({ key: servidorCert.chavePem, cert: servidorCert.certPem, requestCert: true, rejectUnauthorized: true, ca: [cred.certPem] }, (req, res) => {
        clienteVisto = (req.socket as unknown as { getPeerCertificate(): { subject?: { CN?: string } } }).getPeerCertificate().subject?.CN ?? null;
        if (pendurar) return; // não responde: força o tempo-limite
        res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"ok":true}');
      });
      await new Promise<void>(r => servidor.listen(0, "127.0.0.1", () => r()));
      porta = (servidor.address() as AddressInfo).port;
    });
    afterAll(() => new Promise<void>(r => { servidor.closeAllConnections(); servidor.close(() => r()); }));
    const local = (): MapaEnderecos => ({
      producao_restrita: {
        sefin: { host: "localhost", porta, base: "/API/SefinNacional", hostConfirmado: true, baseConfirmada: true, fonte: "teste" },
        adn: { host: "localhost", porta, base: "/contribuintes", hostConfirmado: true, baseConfirmada: true, fonte: "teste" },
      },
      producao: ENDERECOS.producao,
    });

    it("servidor com certificado que não está nas raízes confiáveis é RECUSADO (verificação TLS ligada)", async () => {
      const c = criarClienteSefin({ ambiente: "producao_restrita", servico: "sefin", credencial: cred, enderecos: local() });
      await expect(c.requisitar("GET", "/nfse/x")).rejects.toThrow(/Falha na conexão segura .*(SELF_SIGNED|UNABLE|DEPTH_ZERO|CERT)/);
    });
    it("mTLS de verdade: com a raiz do servidor de teste, conecta e o servidor recebe o certificado do cliente", async () => {
      const c = criarClienteSefin({ ambiente: "producao_restrita", servico: "sefin", credencial: cred, enderecos: local(), ca: [servidorCert.certPem] });
      const r = await c.requisitar("POST", "/nfse", { dpsXmlGZipB64: compactarXml("<DPS/>") });
      expect(r).toEqual({ status: 200, corpo: '{"ok":true}' });
      expect(clienteVisto).toBe("EMPRESA TESTE SEM VALOR:11222333000181");
    });
    it("tempo esgotado vira erro de resultado incerto (consultar antes de reenviar)", async () => {
      pendurar = true;
      try {
        const c = criarClienteSefin({ ambiente: "producao_restrita", servico: "sefin", credencial: cred, enderecos: local(), ca: [servidorCert.certPem], tempoLimiteMs: 300 });
        await expect(c.requisitar("GET", "/nfse/x")).rejects.toThrow(/não respondeu .*consultar antes de reenviar/);
      } finally { pendurar = false; }
    });
    it("testar conexão: desligado/produção/sem IBGE nem leem o certificado; produção restrita consulta só o convênio (servidor local)", async () => {
      const credencial = vi.fn(async () => cred);
      expect(await testarConexaoSefin(null as never, { id: 1, ambiente: "desligado", municipioIbge: "2105302" }, { credencial }))
        .toEqual({ ok: false, ambiente: "desligado", mensagem: MENSAGEM_DESLIGADO });
      expect((await testarConexaoSefin(null as never, { id: 1, ambiente: "producao", municipioIbge: "2105302" }, { credencial })).mensagem).toBe(MENSAGEM_PRODUCAO_BLOQUEADA);
      expect((await testarConexaoSefin(null as never, { id: 1, ambiente: "producao_restrita", municipioIbge: null }, { credencial })).mensagem).toMatch(/código IBGE/);
      expect((await testarConexaoSefin(null as never, { id: 1, ambiente: "producao_restrita", municipioIbge: "2105302" }, { credencial, teste: { servico: "adn", nome: "distribuicao" } })).mensagem).toMatch(/não foi confirmado/);
      expect(credencial).not.toHaveBeenCalled();
      const r = await testarConexaoSefin(null as never, { id: 1, ambiente: "producao_restrita", municipioIbge: "2105302" }, { credencial, enderecos: local(), ca: [servidorCert.certPem] });
      expect(r).toMatchObject({ ok: true, mensagem: expect.stringMatching(/HTTP 200/) });
    });
  });

  it("GZIP + Base64 ida e volta", () => {
    expect(descompactarXml(compactarXml(FIXTURE_PR))).toBe(FIXTURE_PR);
  });
});
