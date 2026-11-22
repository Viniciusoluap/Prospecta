// Item 6: a cadeia montada pelo servidor entra em signer.certificateChain ANTES de assinar; só o certificado público sai
// do navegador. ICP sintética, rede simulada, nenhum contrato real.
import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import { ContentInfo, SignedData, Certificate } from "pkijs";
import { criarPki, rede, URLS, type Pki } from "./__fixtures__/juridico-pki-ca";
import { assinarPdf, importarCertificado, incluirIntermediarios } from "../client/src/lib/certificados-digitais";
import { avisoDaConferencia } from "../client/src/lib/juridico-conferencia";
import { conferirAssinaturas } from "./juridico-verificar-assinaturas";
import { limparCacheLcr } from "./juridico-pki";
import { SessaoPki } from "./juridico-pki-download";

let pki: Pki;
beforeAll(() => { pki = criarPki(); }, 60_000);
afterAll(() => pki?.limpar());

function certificadosDoCms(pdf: Uint8Array): Buffer[] {
  const texto = Buffer.from(pdf).toString("latin1");
  const m = /\/Contents\s*<([0-9a-fA-F]+)>/.exec(texto)!;
  const cms = ContentInfo.fromBER(Uint8Array.from(Buffer.from(m[1], "hex")).buffer);
  return (new SignedData({ schema: cms.content }).certificates || []).filter((c): c is Certificate => c instanceof Certificate).map(c => Buffer.from(c.toSchema().toBER(false)));
}

describe("cadeia incluída antes de assinar", () => {
  it("envia só o certificado público e embute os intermediários no CMS", async () => {
    const salvo = await importarCertificado(77, new File([pki.pfx("empresa")], "empresa.pfx"), "teste-somente");
    const pedidos: { certificado: Uint8Array; cadeia: Uint8Array[] }[] = [];
    const doc = new jsPDF(); doc.text("CONTRATO SINTETICO", 20, 20);
    const { bytes } = await assinarPdf(new Uint8Array(doc.output("arraybuffer")), salvo, "teste-somente", undefined, async (certificado, cadeia) => {
      pedidos.push({ certificado, cadeia }); return [Uint8Array.from(pki.der.inter)];
    });
    expect(pedidos).toHaveLength(1);
    expect(Buffer.from(pedidos[0].certificado).equals(pki.der.empresa)).toBe(true);
    expect(pedidos[0].cadeia).toEqual([]);
    expect(certificadosDoCms(bytes).some(c => c.equals(pki.der.inter))).toBe(true);
    // Com a intermediária no PDF, a conferência não precisa do AIA (fora do ar aqui) e fica válida.
    limparCacheLcr();
    const r = rede(pki, { fora: [URLS.interCert] });
    const conf = await conferirAssinaturas(Buffer.from(bytes), { partyADocument: "12345678000190", partyBDocument: "12345678901", signers: [] }, [pki.raiz], { sessao: new SessaoPki({ resolver: r.resolver, transporte: r.transporte }) });
    expect(conf.assinaturas[0]).toMatchObject({ estado: "valida", cadeia: "valida", revogacao: "regular" });
    expect(r.chamadas).not.toContain(URLS.interCert);
  }, 60_000);
  it("não duplica certificados nem acrescenta a própria folha", () => {
    const signer = { certificate: Uint8Array.from(pki.der.empresa), certificateChain: [Uint8Array.from(pki.der.inter)] };
    expect(incluirIntermediarios(signer, [Uint8Array.from(pki.der.inter), Uint8Array.from(pki.der.empresa), Uint8Array.from(pki.der.raiz)])).toBe(2);
  });
  it("os avisos refletem o resultado real e nunca dizem 'validado' para pendente/inválido", () => {
    expect(avisoDaConferencia({ estado: "valida", motivo: "", transitoria: false }).tipo).toBe("success");
    const pend = avisoDaConferencia({ estado: "pendente", motivo: "LCR indisponível.", transitoria: true });
    expect(pend).toMatchObject({ tipo: "warning" }); expect(pend.texto).toMatch(/pendente e será repetida/);
    const inv = avisoDaConferencia({ estado: "invalida", motivo: "Certificado revogado.", transitoria: false });
    expect(inv.tipo).toBe("error"); expect(inv.texto).toMatch(/NÃO passou/);
    expect(avisoDaConferencia(null).tipo).toBe("warning");
  });
});
