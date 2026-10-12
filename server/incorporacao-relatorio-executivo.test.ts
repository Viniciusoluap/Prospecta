import { describe, it, expect } from "vitest";
import {
  montarRelatorioExecutivo,
  type EstudoParaRelatorioExecutivo,
} from "../shared/incorporacao/relatorio-executivo";

function estudoVazio(): EstudoParaRelatorioExecutivo {
  return {
    name: "Loteamento Teste",
    city: "São Luís",
    state: "MA",
    areaM2: "0",
    perimeterM: "0",
    latitude: null,
    longitude: null,
    appAreaM2: null,
    appWidthM: null,
    appOrigin: null,

    urbanParametersJson: null,
    potentialJson: null,
    urbanisticOpinion: null,

    cityResearchJson: null,
    marketStudyJson: null,
    comparablePricingJson: null,
    primaryResearchJson: null,

    massScenariosJson: null,
    selectedScenarioId: null,

    areasBoardJson: null,

    productMixJson: null,

    parameterizedBudgetJson: null,
    preliminaryBudgetJson: null,
    workBudgetJson: null,

    lottingJson: null,

    landNegotiationJson: null,

    incorporationRegistrationJson: null,
    projectApprovalJson: null,

    physicalFinancialScheduleJson: null,
    launchPlanJson: null,
  };
}

function estudoCompleto(): EstudoParaRelatorioExecutivo {
  return {
    ...estudoVazio(),
    areaM2: "100000",
    perimeterM: "1400",
    latitude: "-2.53",
    longitude: "-44.30",
    appAreaM2: "5000",
    appWidthM: "30",
    appOrigin: "automatica",

    urbanParametersJson: JSON.stringify({
      zona: "ZR-2",
      taxaOcupacao: 0.6,
      coefAproveitamento: 1.2,
      recuoFrontalM: 3,
      recuoLateralM: 1.5,
      recuoFundosM: 3,
      loteMinimoM2: 250,
      testadaMinimaM: 10,
      gabaritoPavimentos: 2,
      percentInstitucional: 0.05,
      percentAreaVerde: 0.1,
      percentViario: 0.2,
      vagasPorUnidade: 1,
    }),
    potentialJson: JSON.stringify({ areaMediaUnidadeM2: 80 }),
    urbanisticOpinion: "Zona residencial compatível com o empreendimento.",

    cityResearchJson: JSON.stringify({
      populacao: 50000,
      crescimentoAnualPct: 2,
      pibPerCapita: 20000,
      principaisAtividades: ["Comércio"],
      rendaMediaMensal: 3000,
      deficitHabitacional: "alto",
      resumo: "Cidade em crescimento.",
    }),
    marketStudyJson: JSON.stringify({
      precoM2Lote: 500,
      precoM2Casa: 2500,
      precoM2Apartamento: 4000,
      velocidadeVendas: "media",
      demandaPorProduto: [],
      concorrentes: [],
      comparaveis: [],
      oportunidades: "",
      riscos: "",
      fontes: ["IBGE", "ZAP Imóveis"],
      confiabilidade: "alta",
    }),
    comparablePricingJson: JSON.stringify({
      atributos: [{ nome: "Localização", peso: 3 }],
      notasNovo: [3],
      comparaveis: [{ nome: "Concorrente A", precoM2: 480, notas: [3] }],
    }),
    primaryResearchJson: JSON.stringify({
      entrevistados: [
        {
          id: "1",
          nome: "João",
          faixaEtaria: "26-35",
          faixaRenda: "4_8sm",
          temImovelProprio: false,
          interesseComprar12Meses: true,
          tiposInteresse: ["lote"],
          notaApartamento: 0,
          notaCasaCondominio: 0,
          notaCasaRuaAberta: 0,
          tamanhoIdealM2: 200,
          quartosNecessarios: 3,
          itensImportancia: {},
        },
      ],
    }),

    massScenariosJson: JSON.stringify({
      params: {},
      cenarios: [
        {
          id: "cenario-1",
          anguloVia: 10,
          testadaLoteM: 12,
          profundidadeLoteM: 30,
          larguraViaM: 10,
          lotes: [],
          kpis: {
            lotesVendaveis: 100,
            lotesPublicos: 10,
            areaVendavelM2: 60000,
            areaPublicaM2: 10000,
            aproveitamento: 0.6,
            vgv: 30000000,
          },
        },
      ],
    }),
    selectedScenarioId: "cenario-1",

    areasBoardJson: JSON.stringify({
      coeficienteAproveitamento: 1.2,
      itens: [
        {
          pavimento: "Térreo",
          areaConstCobertaM2: 1000,
          areaConstDescobertaM2: 0,
          areaUrbanizadaM2: 0,
          areaDescontarM2: 0,
          areaComputavelM2: 1000,
          areaPrivativaM2: 800,
        },
      ],
    }),

    productMixJson: JSON.stringify([{ nome: "Lotes", quantidade: 100, areaUnidadeM2: 300, precoM2: 500 }]),

    parameterizedBudgetJson: JSON.stringify({
      itens: [{ pavimento: "Torre A", areaM2: 5000, coeficienteEquivalencia: 1 }],
      custoM2Equivalente: 2000,
      passivoAmbiental: 0,
      decoracaoEquipamentos: 100000,
      projetos: 200000,
      previsaoInfra: 50000,
      outros: 0,
    }),
    preliminaryBudgetJson: JSON.stringify({ itens: [{ id: "1", categoria: "Estrutura", valorOrcado: 3000000 }] }),
    workBudgetJson: JSON.stringify({
      itens: [{ id: "1", categoria: "Estrutura", valorOrcado: 3000000, valorRealizado: 1500000 }],
    }),

    lottingJson: JSON.stringify({
      areaBrutaM2: 100000,
      pctAreaPublica: 10,
      pctAreaVerde: 5,
      pctSistemaViario: 25,
      pctFaixaServidao: 0,
      duracaoVendasMeses: 12,
      perfilVendas: "constante",
      entradaPct: 10,
      prazoParcelamentoMeses: 24,
      jurosClienteMensal: 0.5,
      indexacaoMensal: 0.4,
      vendasAVistaPct: 10,
      descontoAVistaPct: 10,
      inadimplenciaPct: 5,
      comissaoPctVgv: 5,
      despesasGeraisPctVgv: 3,
      impostosPctVgv: 6.58,
      taxaIncorporacaoPctVgv: 1,
      inicioObraMes: 0,
      duracaoObraMeses: 12,
      inicioVendasMes: 6,
      custoInfraM2Lote: 200,
      projetosLicencas: 100000,
      marketing: 100000,
      registroPorUnidade: 400,
      contingenciaPctInfra: 10,
      bdiPct: 10,
      taxaAdministracaoObraPct: 10,
      manutencaoPctObra: 1.5,
      inccObraMensal: 0.3,
      permutaPctVgv: 20,
      taxaDescontoAnual: 12,
      itensMix: [{ nome: "Lotes", quantidade: 100, areaUnidadeM2: 300, precoM2: 500 }],
    }),

    landNegotiationJson: JSON.stringify({
      proprietarioNome: "Zé da Silva",
      proprietarioContato: "(98) 99999-9999",
      vgvGrossManual: 0,
      propostas: [
        { id: "1", data: "2026-01-10", autor: "grupo", tipo: "compra_avista", valorTotal: 1000000, status: "aceita" },
      ],
    }),

    incorporationRegistrationJson: JSON.stringify({
      documentos: [
        { id: "1", nome: "Título de propriedade do terreno", status: "obtido" },
        { id: "2", nome: "Certidão negativa de ônus reais", status: "pendente" },
      ],
    }),
    projectApprovalJson: JSON.stringify({
      processos: [
        { id: "1", orgao: "Prefeitura (projeto arquitetônico)", status: "aprovado" },
        { id: "2", orgao: "Corpo de Bombeiros", status: "exigencia" },
      ],
    }),

    physicalFinancialScheduleJson: JSON.stringify({
      medicoes: [{ id: "1", mes: 0, avancoFisicoAcumuladoPct: 10 }],
      duracaoObraMeses: 12,
    }),
    launchPlanJson: JSON.stringify({ marcos: [{ id: "1", nome: "Definição da data do evento", status: "concluido" }] }),
  };
}

describe("montarRelatorioExecutivo — estudo totalmente vazio", () => {
  const modelo = montarRelatorioExecutivo(estudoVazio());

  it("terreno fica pendente quando não há área delimitada", () => {
    expect(modelo.terreno.status).toBe("pendente");
  });
  it("dados cadastrais/urbanísticos ficam pendentes sem parâmetros urbanísticos", () => {
    expect(modelo.dadosCadastraisUrbanisticos.status).toBe("pendente");
  });
  it("mercado/referências ficam pendentes sem nenhuma pesquisa", () => {
    expect(modelo.mercadoReferencias.status).toBe("pendente");
  });
  it("estudo de massa fica pendente sem cenários gerados", () => {
    expect(modelo.estudoMassa.status).toBe("pendente");
  });
  it("quadro de áreas fica pendente sem itens", () => {
    expect(modelo.quadroAreas.status).toBe("pendente");
  });
  it("mix de produtos fica pendente sem itens com quantidade", () => {
    expect(modelo.mixProdutos.status).toBe("pendente");
  });
  it("custos/receitas/VGV ficam pendentes sem nenhum orçamento nem VGV", () => {
    expect(modelo.custosReceitasVgv.status).toBe("pendente");
  });
  it("viabilidade econômica (VPL/TIR/ROI/payback/fluxo) fica pendente sem EVE calculada", () => {
    expect(modelo.viabilidadeEconomica.status).toBe("pendente");
  });
  it("impostos/comissões/permutas ficam pendentes sem EVE calculada", () => {
    expect(modelo.impostosComissoesPermutas.status).toBe("pendente");
  });
  it("negociações ficam pendentes sem nenhuma proposta registrada", () => {
    expect(modelo.negociacoes.status).toBe("pendente");
  });
  it("documentos/licenças ficam pendentes sem registro nem aprovação", () => {
    expect(modelo.documentosLicencas.status).toBe("pendente");
  });
  it("cronograma fica pendente sem medições nem marcos", () => {
    expect(modelo.cronograma.status).toBe("pendente");
  });
  it("premissas/fontes/data/versão nunca fica pendente (sempre há ao menos o timestamp) mas lista pendências pontuais", () => {
    expect(modelo.premissasFontesDataVersao.status).toBe("ok");
    if (modelo.premissasFontesDataVersao.status === "ok") {
      expect(modelo.premissasFontesDataVersao.dado.premissasViabilidade).toBeNull();
      expect(modelo.premissasFontesDataVersao.dado.parametrosUrbanisticosRelevantes).toBeNull();
      expect(modelo.premissasFontesDataVersao.dado.fontesPesquisaMercado).toBeNull();
      // versão do estudo é sempre pendência explícita (sem sistema de versionamento)
      expect(modelo.premissasFontesDataVersao.pendencias.some((p) => p.includes("versionamento"))).toBe(true);
    }
  });

  it("nenhuma seção é omitida: todas as 13 chaves do modelo estão presentes", () => {
    const chaves = Object.keys(modelo);
    expect(chaves).toHaveLength(13);
    for (const chave of chaves) {
      const secao = (modelo as Record<string, { status: string }>)[chave];
      expect(["ok", "pendente"]).toContain(secao.status);
    }
  });
});

describe("montarRelatorioExecutivo — estudo completo", () => {
  const modelo = montarRelatorioExecutivo(estudoCompleto());

  it("terreno: área, perímetro, centro e APP presentes, sem pendências pontuais de APP", () => {
    expect(modelo.terreno.status).toBe("ok");
    if (modelo.terreno.status === "ok") {
      expect(modelo.terreno.dado.areaM2).toBe(100000);
      expect(modelo.terreno.dado.centro).toEqual({ lat: -2.53, lng: -44.3 });
      expect(modelo.terreno.dado.app?.areaM2).toBe(5000);
      expect(modelo.terreno.pendencias).toHaveLength(0);
    }
  });

  it("dados cadastrais/urbanísticos: potencial calculado, mas matrícula/CAR/zoneamento sempre pendência estrutural", () => {
    expect(modelo.dadosCadastraisUrbanisticos.status).toBe("ok");
    if (modelo.dadosCadastraisUrbanisticos.status === "ok") {
      expect(modelo.dadosCadastraisUrbanisticos.dado.potencial.areaEdificavelMaxM2).toBeGreaterThan(0);
      expect(
        modelo.dadosCadastraisUrbanisticos.pendencias.some((p) => p.includes("matrícula"))
      ).toBe(true);
    }
  });

  it("mercado/referências: cidade, mercado (com fontes), precificação e pesquisa primária todos presentes", () => {
    expect(modelo.mercadoReferencias.status).toBe("ok");
    if (modelo.mercadoReferencias.status === "ok") {
      expect(modelo.mercadoReferencias.dado.cidade?.populacao).toBe(50000);
      expect(modelo.mercadoReferencias.dado.fontes).toEqual(["IBGE", "ZAP Imóveis"]);
      expect(modelo.mercadoReferencias.dado.precificacao?.comparaveisValidos).toBe(1);
      expect(modelo.mercadoReferencias.dado.pesquisaPrimaria?.totalEntrevistados).toBe(1);
      expect(modelo.mercadoReferencias.pendencias).toHaveLength(0);
    }
  });

  it("estudo de massa: cenário selecionado reconhecido, sem observação de seleção implícita", () => {
    expect(modelo.estudoMassa.status).toBe("ok");
    if (modelo.estudoMassa.status === "ok") {
      expect(modelo.estudoMassa.dado.cenario.id).toBe("cenario-1");
      expect(modelo.estudoMassa.dado.eraSelecaoExplicita).toBe(true);
    }
  });

  it("quadro de áreas calculado a partir dos itens salvos", () => {
    expect(modelo.quadroAreas.status).toBe("ok");
    if (modelo.quadroAreas.status === "ok") {
      expect(modelo.quadroAreas.dado.resultado.areaConstCobertaTotalM2).toBe(1000);
    }
  });

  it("mix de produtos calculado (VGV = qtd × área × preço/m²)", () => {
    expect(modelo.mixProdutos.status).toBe("ok");
    if (modelo.mixProdutos.status === "ok") {
      expect(modelo.mixProdutos.dado.resultado.vgv).toBe(100 * 300 * 500);
    }
  });

  it("custos/receitas/VGV: parametrizado, preliminar, obra e VGV (via viabilidade) todos presentes", () => {
    expect(modelo.custosReceitasVgv.status).toBe("ok");
    if (modelo.custosReceitasVgv.status === "ok") {
      expect(modelo.custosReceitasVgv.dado.parametrizado).not.toBeNull();
      expect(modelo.custosReceitasVgv.dado.preliminar).not.toBeNull();
      expect(modelo.custosReceitasVgv.dado.obra).not.toBeNull();
      expect(modelo.custosReceitasVgv.dado.origemVgv).toBe("viabilidade_economica");
      expect(modelo.custosReceitasVgv.dado.vgvLiquido).not.toBeNull();
      expect(modelo.custosReceitasVgv.pendencias).toHaveLength(0);
    }
  });

  it("viabilidade econômica: VPL/TIR/ROI/payback e fluxo de caixa mês a mês presentes", () => {
    expect(modelo.viabilidadeEconomica.status).toBe("ok");
    if (modelo.viabilidadeEconomica.status === "ok") {
      const r = modelo.viabilidadeEconomica.dado.resultado;
      expect(r.vgvGross).toBeCloseTo(100 * 300 * 500, 2);
      expect(r.fluxo.length).toBeGreaterThan(0);
      expect(typeof r.vpl).toBe("number");
    }
  });

  it("impostos/comissões/permutas: percentuais e valores derivados do motor, com rótulo de estimativa", () => {
    expect(modelo.impostosComissoesPermutas.status).toBe("ok");
    if (modelo.impostosComissoesPermutas.status === "ok") {
      const d = modelo.impostosComissoesPermutas.dado;
      expect(d.rotulo).toBe("estimativa baseada nas premissas de viabilidade");
      expect(d.percentuais.impostosPctVgv).toBeCloseTo(0.0658, 4);
      expect(d.valores.impostos).toBeCloseTo(d.vgvGross * 0.0658, 2);
      expect(d.valores.permuta).toBeGreaterThan(0);
    }
  });

  it("negociações: proposta aceita reconhecida (fechada = true)", () => {
    expect(modelo.negociacoes.status).toBe("ok");
    if (modelo.negociacoes.status === "ok") {
      expect(modelo.negociacoes.dado.resumo.fechada).toBe(true);
      expect(modelo.negociacoes.pendencias).toHaveLength(0);
    }
  });

  it("documentos/licenças: registro e aprovação com pendentes/exigências expostos", () => {
    expect(modelo.documentosLicencas.status).toBe("ok");
    if (modelo.documentosLicencas.status === "ok") {
      expect(modelo.documentosLicencas.dado.registro?.pendentes.length).toBe(1);
      expect(modelo.documentosLicencas.dado.aprovacao?.comExigencia.length).toBe(1);
    }
  });

  it("cronograma: avanço físico x financeiro e marcos presentes, mas responsável/riscos sempre pendência estrutural", () => {
    expect(modelo.cronograma.status).toBe("ok");
    if (modelo.cronograma.status === "ok") {
      expect(modelo.cronograma.dado.obra?.avancoFisicoAtualPct).toBe(10);
      expect(modelo.cronograma.dado.lancamento?.concluidos).toBe(1);
      expect(modelo.cronograma.pendencias.some((p) => p.includes("responsável individual por tarefa"))).toBe(true);
    }
  });

  it("premissas/fontes/data/versão: premissas e fontes presentes, versão ainda pendência", () => {
    expect(modelo.premissasFontesDataVersao.status).toBe("ok");
    if (modelo.premissasFontesDataVersao.status === "ok") {
      expect(modelo.premissasFontesDataVersao.dado.premissasViabilidade?.impostosPctVgv).toBeCloseTo(6.58, 2);
      expect(modelo.premissasFontesDataVersao.dado.fontesPesquisaMercado).toEqual(["IBGE", "ZAP Imóveis"]);
      expect(new Date(modelo.premissasFontesDataVersao.dado.geradoEm).getTime()).not.toBeNaN();
      expect(modelo.premissasFontesDataVersao.pendencias.some((p) => p.includes("versionamento"))).toBe(true);
    }
  });
});

describe("montarRelatorioExecutivo — timestamp de geração é injetável e determinístico", () => {
  it("usa a data passada explicitamente em vez do relógio real", () => {
    const data = new Date("2026-03-15T12:00:00.000Z");
    const modelo = montarRelatorioExecutivo(estudoVazio(), data);
    if (modelo.premissasFontesDataVersao.status === "ok") {
      expect(modelo.premissasFontesDataVersao.dado.geradoEm).toBe(data.toISOString());
    } else {
      throw new Error("premissasFontesDataVersao deveria sempre estar ok");
    }
  });
});

describe("montarRelatorioExecutivo — robustez contra JSON corrompido", () => {
  it("nunca lança exceção e trata campos corrompidos como pendência", () => {
    const estudo: EstudoParaRelatorioExecutivo = {
      ...estudoCompleto(),
      urbanParametersJson: "{isto não é json",
      landNegotiationJson: "[não, é, json}",
      productMixJson: "não é array",
    };
    expect(() => montarRelatorioExecutivo(estudo)).not.toThrow();
    const modelo = montarRelatorioExecutivo(estudo);
    expect(modelo.dadosCadastraisUrbanisticos.status).toBe("pendente");
    expect(modelo.negociacoes.status).toBe("pendente");
    expect(modelo.mixProdutos.status).toBe("pendente");
  });
});

describe("montarRelatorioExecutivo — terreno com dados parciais", () => {
  it("terreno presente mas sem APP calculada gera pendência pontual (não omite a seção)", () => {
    const estudo: EstudoParaRelatorioExecutivo = { ...estudoCompleto(), appAreaM2: null, appWidthM: null, appOrigin: null };
    const modelo = montarRelatorioExecutivo(estudo);
    expect(modelo.terreno.status).toBe("ok");
    if (modelo.terreno.status === "ok") {
      expect(modelo.terreno.dado.app).toBeNull();
      expect(modelo.terreno.pendencias.some((p) => p.includes("APP"))).toBe(true);
    }
  });
});

describe("montarRelatorioExecutivo — mercado presente sem fontes (dado salvo antes da correção do bug)", () => {
  it("gera pendência explícita de fontes em vez de omitir a seção", () => {
    const estudo: EstudoParaRelatorioExecutivo = {
      ...estudoCompleto(),
      marketStudyJson: JSON.stringify({
        precoM2Lote: 500,
        precoM2Casa: 2500,
        precoM2Apartamento: 4000,
        velocidadeVendas: "media",
        demandaPorProduto: [],
        concorrentes: [],
        comparaveis: [],
        oportunidades: "",
        riscos: "",
        // sem fontes/confiabilidade — simula estudo salvo antes da correção do bug
      }),
    };
    const modelo = montarRelatorioExecutivo(estudo);
    expect(modelo.mercadoReferencias.status).toBe("ok");
    if (modelo.mercadoReferencias.status === "ok") {
      expect(modelo.mercadoReferencias.dado.fontes).toBeNull();
      expect(modelo.mercadoReferencias.pendencias.some((p) => p.includes("Fontes") || p.includes("fontes"))).toBe(true);
    }
  });
});

describe("montarRelatorioExecutivo — custos/VGV sem viabilidade, apenas mix de produtos", () => {
  it("usa VGV bruto do mix e marca VGV líquido como pendência (depende da EVE)", () => {
    const estudo: EstudoParaRelatorioExecutivo = { ...estudoCompleto(), lottingJson: null };
    const modelo = montarRelatorioExecutivo(estudo);
    expect(modelo.custosReceitasVgv.status).toBe("ok");
    if (modelo.custosReceitasVgv.status === "ok") {
      expect(modelo.custosReceitasVgv.dado.origemVgv).toBe("mix_de_produtos");
      expect(modelo.custosReceitasVgv.dado.vgvBruto).toBe(100 * 300 * 500);
      expect(modelo.custosReceitasVgv.dado.vgvLiquido).toBeNull();
      expect(modelo.custosReceitasVgv.pendencias.some((p) => p.includes("VGV líquido"))).toBe(true);
    }
    expect(modelo.viabilidadeEconomica.status).toBe("pendente");
    expect(modelo.impostosComissoesPermutas.status).toBe("pendente");
  });
});

describe("montarRelatorioExecutivo — negociação sem proposta aceita", () => {
  it("mostra a proposta mais recente e marca como pendência a falta de aceite", () => {
    const estudo: EstudoParaRelatorioExecutivo = {
      ...estudoCompleto(),
      landNegotiationJson: JSON.stringify({
        proprietarioNome: "Zé",
        proprietarioContato: "x",
        vgvGrossManual: 0,
        propostas: [
          { id: "1", data: "2026-01-05", autor: "grupo", tipo: "compra_avista", valorTotal: 900000, status: "em_analise" },
        ],
      }),
    };
    const modelo = montarRelatorioExecutivo(estudo);
    expect(modelo.negociacoes.status).toBe("ok");
    if (modelo.negociacoes.status === "ok") {
      expect(modelo.negociacoes.dado.resumo.fechada).toBe(false);
      expect(modelo.negociacoes.pendencias.some((p) => p.includes("nenhuma proposta foi aceita"))).toBe(true);
    }
  });
});
