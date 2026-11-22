import { describe, expect, it } from "vitest";
import { prepararEdicaoComPci } from "../shared/medicao-pci-edicao";
import { dadosPlsPadrao, dadosRepactuacaoPadrao, type DadosMedicaoCaixa } from "../shared/medicao-caixa";
import { SERVICOS_PROGRESSO } from "../shared/financeiro/progresso";

const itens = SERVICOS_PROGRESSO.map((s, k) => ({ chave: s.chave, incidencia: s.incidenciaPadrao, execucao: String(k) }));
const dados: DadosMedicaoCaixa = { pls: { ...dadosPlsPadrao({ numeroContrato: "CONTRATO ANTIGO", valorImovel: 188000 }), dataLevantamento: "2026-11-21", observacoes: "VISTORIA MANTIDA" }, repactuacao: dadosRepactuacaoPadrao(), alteracao: null };
const pci = { incidencias: itens.map(i => Number(i.incidencia)).reverse(), plsPadrao: { numeroContrato: "NOVO CONTRATO", valorImovel: 230000, dataContratacao: "2026-04-24", alvaraEmissao: null, alvaraVigencia: "2027-01-01", seloCasaAzul: true } };

describe("edição com a PCI atual", () => {
  it("troca incidências por chave sem perder execuções nem mudar as entradas", () => {
    const invertidos = [...itens].reverse();
    const r = prepararEdicaoComPci(invertidos, dados, pci, true);
    expect(r.itens.map(i => i.execucao)).toEqual(invertidos.map(i => i.execucao));
    for (const i of r.itens) expect(Number(i.incidencia)).toBe(pci.incidencias[SERVICOS_PROGRESSO.findIndex(s => s.chave === i.chave)]);
    expect(itens[0].incidencia).toBe(SERVICOS_PROGRESSO[0].incidenciaPadrao);
  });
  it("atualiza os dados da nova PCI e preserva a vistoria e a repactuação", () => {
    const r = prepararEdicaoComPci(itens, dados, pci, true);
    expect(r.dadosCaixa?.pls).toMatchObject({ ...pci.plsPadrao, dataLevantamento: "2026-11-21", observacoes: "VISTORIA MANTIDA" });
    expect(r.dadosCaixa?.repactuacao).toEqual(dados.repactuacao);
    expect(dados.pls.numeroContrato).toBe("CONTRATO ANTIGO");
  });
  it("preserva ajustes manuais feitos depois de carregar a versão atual", () => {
    expect(prepararEdicaoComPci(itens, dados, pci, false).dadosCaixa).toBe(dados);
  });
  it("sem uma PCI vinculada mantém a base da medição", () => {
    expect(prepararEdicaoComPci(itens, dados, null, true)).toEqual({ itens, dadosCaixa: dados });
  });
});
