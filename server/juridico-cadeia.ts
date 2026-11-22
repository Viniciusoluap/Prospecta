// Jurídico — montagem da cadeia do certificado antes da assinatura (22/11/2026).
//
// O navegador envia SÓ o certificado público (DER) do titular e a cadeia que já veio no arquivo A1; o servidor devolve os
// intermediários até uma raiz oficial ICP-Brasil, para entrarem em `signer.certificateChain` antes de assinar. Senha, PFX
// e chave privada nunca saem do navegador. Cada entrada precisa ser exatamente um certificado X.509 (DER estrito, sem
// bytes a mais): qualquer outra coisa é recusada. Os downloads seguem as travas de server/juridico-pki-download.ts e
// só usam endereços AIA dos próprios certificados. Limite de chamadas por usuário.
import { TRPCError } from "@trpc/server";
import { Certificate } from "pkijs";
import { derCertificado, montarCadeia, raizesIcp, type EstadoPki } from "./juridico-pki.js";
import { SessaoPki } from "./juridico-pki-download.js";

const JANELA_MS = 10 * 60_000, MAX_CHAMADAS = 12;
const chamadas = new Map<number, number[]>();
export function _limparLimiteCadeia() { chamadas.clear(); }

function certificadoEstrito(base64: string): Certificate {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new TRPCError({ code: "BAD_REQUEST", message: "Envie apenas o certificado público." });
  const bytes = Buffer.from(base64, "base64");
  try {
    const cert = Certificate.fromBER(Uint8Array.from(bytes).buffer);
    if (!derCertificado(cert).equals(bytes)) throw new Error("bytes extras");
    return cert;
  } catch { throw new TRPCError({ code: "BAD_REQUEST", message: "Envie apenas o certificado público." }); }
}

export type CadeiaMontada = { estado: EstadoPki; transitoria: boolean; motivo: string; intermediarios: string[] };

export async function montarCadeiaPublica(usuario: number, certificado: string, cadeia: string[], opcoes: { sessao?: SessaoPki; roots?: Certificate[]; agora?: Date } = {}): Promise<CadeiaMontada> {
  const agora = Date.now();
  const recentes = (chamadas.get(usuario) || []).filter(t => agora - t < JANELA_MS);
  if (recentes.length >= MAX_CHAMADAS) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Muitas conferências seguidas. Aguarde alguns minutos." });
  recentes.push(agora); chamadas.set(usuario, recentes);
  const folha = certificadoEstrito(certificado);
  const fornecidos = cadeia.slice(0, 5).map(certificadoEstrito);
  const r = await montarCadeia(folha, fornecidos, opcoes.roots ?? raizesIcp, opcoes.sessao ?? new SessaoPki({ prazoMs: 15_000 }), opcoes.agora);
  return {
    estado: r.estado, transitoria: r.transitoria,
    motivo: r.estado === "valida" ? "Cadeia ICP-Brasil montada e conferida. A revogação é conferida depois de assinar." : r.motivo,
    intermediarios: r.intermediarios.map(c => derCertificado(c).toString("base64")),
  };
}
