import { incidenciaPciParaTexto } from "./pci-upload.js";
import { SERVICOS_PROGRESSO } from "./financeiro/progresso.js";
import type { DadosFixosPls, DadosMedicaoCaixa } from "./medicao-caixa.js";

export interface PciNaEdicao {
  incidencias: readonly number[];
  plsPadrao: DadosFixosPls & { seloCasaAzul?: boolean };
}

/** Atualiza a base da PCI, preservando os campos da vistoria e as execuções por serviço. */
export function prepararEdicaoComPci<T extends { chave: string; incidencia: string; execucao: string }>(
  itens: T[], dadosCaixa: DadosMedicaoCaixa | null, pci: PciNaEdicao | null, atualizarDados: boolean,
) {
  if (!pci) return { itens, dadosCaixa };
  const porChave = new Map(SERVICOS_PROGRESSO.map((s, k) => [s.chave as string, pci.incidencias[k]]));
  return {
    itens: itens.map(i => ({ ...i, incidencia: incidenciaPciParaTexto(porChave.get(i.chave) ?? NaN) })),
    dadosCaixa: atualizarDados && dadosCaixa ? { ...dadosCaixa, pls: {
      ...dadosCaixa.pls,
      numeroContrato: pci.plsPadrao.numeroContrato,
      valorImovel: pci.plsPadrao.valorImovel,
      dataContratacao: pci.plsPadrao.dataContratacao,
      alvaraEmissao: pci.plsPadrao.alvaraEmissao,
      alvaraVigencia: pci.plsPadrao.alvaraVigencia,
      seloCasaAzul: pci.plsPadrao.seloCasaAzul ?? false,
    } } : dadosCaixa,
  };
}
