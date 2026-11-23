// EPIC-029 S-7 (22/11/2026) — pedido de registro de evento de CANCELAMENTO (e101101), função PURA.
// Leiaute [OFICIAL, XSD v1.01 pedRegEvento/tiposEventos, as duas pastas de shared/fiscal/xsd/; PESQUISA §1.5]:
//   <pedRegEvento versao="1.01"><infPedReg Id="PRE{chave 50}{101101}"><tpAmb/><verAplic/><dhEvento/><CNPJAutor/><chNFSe/>
//   <e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>1|2|9</cMotivo><xMotivo>15..255</xMotivo></e101101></infPedReg>
//   <Signature/></pedRegEvento>
// O Id do pedido na v1.01 é "PRE" + chave + tipo do evento (59 posições; sem número de pedido). Evento único por nota.
// A assinatura (infPedReg, Signature irmã) é feita por server/fiscal/assinatura.ts; a validação no XSD por leiaute.ts.
import { NAMESPACE_NFSE, PADRAO_CHAVE_NFSE, TP_AMB, VERSAO_APLICATIVO, VERSAO_LEIAUTE_DPS } from "../../shared/fiscal/dps-campos.js";
import { dataHoraBrasilia, escaparXml } from "./dps.js";

export const CODIGO_CANCELAMENTO = "101101";
/** [OFICIAL] TSCodJustCanc: 1 = erro na emissão; 2 = serviço não prestado; 9 = outros. */
export const MOTIVOS_CANCELAMENTO = { 1: "Erro na emissão", 2: "Serviço não prestado", 9: "Outros" } as const;
export type MotivoCancelamento = keyof typeof MOTIVOS_CANCELAMENTO;
/** [OFICIAL] TSMotivo: 15 a 255 caracteres. */
export const JUSTIFICATIVA_MIN = 15;
export const JUSTIFICATIVA_MAX = 255;
/** Teto nacional do prazo de cancelamento quando o município não define outro (FAQ 9.2): 730 dias. */
export const PRAZO_MAXIMO_CANCELAMENTO_DIAS = 730;
export const PADRAO_ID_PEDIDO = /^PRE[0-9]{8}(1[0-9]{14}|2[0-9A-Z]{14})[0-9]{33}$/;

export class ErroEvento extends Error {
  constructor(message: string) { super(message); this.name = "ErroEvento"; }
}

/** Justificativa limpa (espaços colapsados, sem caracteres de controle) ou a frase do problema. */
export function problemaDaJustificativa(texto: string | null | undefined): string | null {
  const t = limparJustificativa(texto);
  if (Array.from(t).length < JUSTIFICATIVA_MIN) return `Escreva a justificativa do cancelamento com pelo menos ${JUSTIFICATIVA_MIN} caracteres.`;
  if (Array.from(t).length > JUSTIFICATIVA_MAX) return `A justificativa do cancelamento pode ter no máximo ${JUSTIFICATIVA_MAX} caracteres.`;
  return null;
}
export const limparJustificativa = (texto: string | null | undefined) =>
  (texto ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();

/** Prazo local: nota emitida há mais de 730 dias não é nem enviada (a prefeitura pode ter prazo menor: volta E0822). */
export function dentroDoPrazo(emitidaEm: Date, agora: Date): boolean {
  return agora.getTime() - emitidaEm.getTime() <= PRAZO_MAXIMO_CANCELAMENTO_DIAS * 86_400_000;
}

export function montarPedidoCancelamento(e: {
  chave: string; cnpjAutor: string; ambiente: "producao_restrita" | "producao"; motivo: number; justificativa: string; quando: Date;
}): { id: string; xml: string } {
  if (!PADRAO_CHAVE_NFSE.test(e.chave)) throw new ErroEvento("Chave de acesso da NFS-e inválida.");
  const cnpj = e.cnpjAutor.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj)) throw new ErroEvento("CNPJ da empresa emissora inválido.");
  if (!(e.motivo in MOTIVOS_CANCELAMENTO)) throw new ErroEvento("Escolha o motivo do cancelamento: erro na emissão, serviço não prestado ou outros.");
  const problema = problemaDaJustificativa(e.justificativa);
  if (problema) throw new ErroEvento(problema);
  const id = `PRE${e.chave}${CODIGO_CANCELAMENTO}`;
  if (!PADRAO_ID_PEDIDO.test(id)) throw new ErroEvento("Identificador do pedido fora do padrão oficial.");
  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<pedRegEvento xmlns="${NAMESPACE_NFSE}" versao="${VERSAO_LEIAUTE_DPS}">`,
    `<infPedReg Id="${id}">`,
    `<tpAmb>${e.ambiente === "producao" ? TP_AMB.producao : TP_AMB.producao_restrita}</tpAmb>`,
    `<verAplic>${VERSAO_APLICATIVO}</verAplic>`,
    `<dhEvento>${dataHoraBrasilia(e.quando)}</dhEvento>`,
    `<CNPJAutor>${cnpj}</CNPJAutor>`,
    `<chNFSe>${e.chave}</chNFSe>`,
    `<e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>${e.motivo}</cMotivo><xMotivo>${escaparXml(limparJustificativa(e.justificativa))}</xMotivo></e101101>`,
    `</infPedReg>`,
    `</pedRegEvento>`,
  ].join("");
  return { id, xml };
}
