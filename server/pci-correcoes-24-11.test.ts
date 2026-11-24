// Correções pedidas pelo dono em 24/11/2026 no Gerador de PCI: cidade/UF e construtora sozinhas, esquadrias internas como lista,
// local e data automático, e a foto de localização que sumia quando o último desenho do modelo tinha caixa de texto.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PastaBiff8, R, type Registro } from "./caixa/biff8.js";
import { imagensDaAba, proporcaoDoQuadro, substituirFotos } from "./caixa/biff8-imagens.js";
import {
  ABA_PROPOSTA_PCI, CAMPOS_PCI, PROPORCAO_QUADRO_LOCALIZACAO_PCI, fotoNoFormatoDoQuadroPci, recorteParaQuadroPci, baseDosCustosPci, calcularTotaisPci, custoDaIncidenciaPci, custosDigitadosComoPercentualPci, incidenciaDoCustoPci, QUADRO_LOCALIZACAO_PCI, cidadeUfDoEnderecoPci, empresaUnicaPci, errosPci, formatarCnpjPci, formularioPciVazio, localDataPci,
  preencherPciAutomatico, sugestoesAutomaticasPci, type FontesPreenchimentoPci,
} from "../shared/pci-gerador.js";

const MODELO = new Uint8Array(readFileSync(new URL("./caixa/__fixtures__/pci-modelo-anonimo.xls", import.meta.url)));
const fontes = (obra: Partial<FontesPreenchimentoPci["obra"]>, extra: Partial<FontesPreenchimentoPci> = {}): FontesPreenchimentoPci => ({
  obra: { titulo: "Obra", endereco: null, cidade: null, uf: null, area: null, valorImovel: null, valorTerreno: null, valorFinanciado: null, inicio: null, termino: null, ...obra },
  cliente: null, coordenadas: null, pci: null, ...extra,
});

describe("cidade e UF sozinhas", () => {
  it("lê cidade-UF do FIM do endereço; sem UF válida depois de '-' ou '/', não adivinha", () => {
    expect(cidadeUfDoEnderecoPci("Rua dos Jasmins, s/n, lote 18, Quadra 10, Residencial Aurora, Vila Esmeralda, Imperatriz-MA.")).toEqual({ cidade: "Imperatriz", uf: "MA" });
    expect(cidadeUfDoEnderecoPci("Rua A, 10, Centro, São Luís / ma")).toEqual({ cidade: "São Luís", uf: "MA" });
    expect(cidadeUfDoEnderecoPci("Av. B, 200 - Bairro C, Canaã dos Carajás - PA, CEP 68537-000")).toEqual({ cidade: "Canaã dos Carajás", uf: "PA" });
    expect(cidadeUfDoEnderecoPci("Rua A, 10, Parauapebas–PA, 68515-000.")).toEqual({ cidade: "Parauapebas", uf: "PA" });
    for (const semCidade of ["Rua dos Jasmins, s/n, Residencial Aurora, Vila Esmeralda", "Rua A, 10 - XX", "Rua A, Imperatriz MA", "Quadra 10 - 18", "Rua 5-MA", "", null])
      expect(cidadeUfDoEnderecoPci(semCidade), String(semCidade)).toBeNull();
  });

  it("o cadastro da obra manda; sem ele, vale o fim do endereço da obra e, por último, o do cliente", () => {
    const daObra = preencherPciAutomatico(fontes({ cidade: "Açailândia", uf: "MA", endereco: "Rua A, 1, Imperatriz-MA" }));
    expect(daObra.campos).toMatchObject({ municipio: "Açailândia", uf: "MA" });
    const doEndereco = sugestoesAutomaticasPci(fontes({ endereco: "Rua dos Jasmins, s/n, Vila Esmeralda, Imperatriz-MA." }));
    expect(doEndereco.sugestoes.filter((s) => s.chave === "municipio" || s.chave === "uf")).toEqual([
      { chave: "municipio", valor: "Imperatriz", fonte: "Endereço da obra (cidade-UF no fim)" }, { chave: "uf", valor: "MA", fonte: "Endereço da obra (cidade-UF no fim)" }]);
    expect(doEndereco.ausencias.some((a) => a.chave === "municipio" || a.chave === "uf")).toBe(false);
    const doCliente = preencherPciAutomatico(fontes({}, { cliente: { nome: null, cpf: null, email: null, telefone: null, endereco: "Rua B, 2, Centro, Parauapebas - PA", bairro: null } }));
    expect(doCliente.campos).toMatchObject({ municipio: "Parauapebas", uf: "PA" });
    const semNada = sugestoesAutomaticasPci(fontes({ endereco: "Rua sem cidade, 5" }));
    expect(semNada.ausencias.filter((a) => a.chave === "municipio" || a.chave === "uf")).toHaveLength(2);
  });
});

describe("construtora pelo módulo fiscal", () => {
  const um = { nome: "Construtora Exemplo Um LTDA", cnpj: "11222333000181", certificado: false };
  const dois = { nome: "Construtora Exemplo Dois LTDA", cnpj: "44555666000181", certificado: true };
  it("só entra sozinha quando UMA serve: a única com certificado, ou a única cadastrada", () => {
    expect(empresaUnicaPci([um, dois])).toEqual(dois);
    expect(empresaUnicaPci([um])).toEqual(um);
    expect(empresaUnicaPci([um, { ...dois, certificado: false }])).toBeNull();
    expect(empresaUnicaPci([{ ...um, certificado: true }, dois])).toBeNull();
    expect(empresaUnicaPci([])).toBeNull();
    expect(empresaUnicaPci([{ nome: " ", cnpj: "11222333000181", certificado: true }, { nome: "X", cnpj: "123", certificado: true }])).toBeNull();
    expect(formatarCnpjPci("44555666000181")).toBe("44.555.666/0001-81");
  });
  it("preenche nome e CNPJ com a fonte; com duas candidatas, deixa em branco para a pessoa escolher na lista", () => {
    const f = preencherPciAutomatico(fontes({}, { empresas: [um, dois] }));
    expect(f.campos).toMatchObject({ construtora: "Construtora Exemplo Dois LTDA", cnpjConstrutora: "44.555.666/0001-81" });
    expect(sugestoesAutomaticasPci(fontes({}, { empresas: [um, dois] })).sugestoes.find((s) => s.chave === "construtora")?.fonte).toBe("Módulo fiscal (empresa com certificado digital)");
    const duas = preencherPciAutomatico(fontes({}, { empresas: [{ ...um, certificado: true }, dois] }));
    expect(duas.campos.construtora ?? null).toBeNull();
    expect(duas.campos.cnpjConstrutora ?? null).toBeNull();
  });
});

describe("esquadrias internas, local e data", () => {
  it("esquadrias internas é lista com as mesmas opções do modelo (a validação do modelo cobre G106:U106)", () => {
    const interna = CAMPOS_PCI.find((c) => c.id === "esquadriasInternas")!;
    const externa = CAMPOS_PCI.find((c) => c.id === "esquadriasExternas")!;
    expect(interna.tipo).toBe("lista");
    expect(interna.celula).toBe("O106");
    expect(interna.opcoes).toEqual(externa.opcoes);
    expect(interna.opcoes).toContain("Madeira");
    // a validação de dados do próprio modelo cobre a célula O106
    const dv = PastaBiff8.abrir(MODELO).validacoesDeDados(ABA_PROPOSTA_PCI).find((v) => v.intervalo === "G106:U106");
    expect(dv?.tipo).toBe(3); // lista (as opções do modelo de teste são anonimizadas; as oficiais estão em shared/pci-listas.ts)
    expect(dv?.opcoes).toHaveLength(interna.opcoes!.length);
    const f = formularioPciVazio();
    f.campos.esquadriasInternas = "Madeira";
    expect(errosPci(f, { paraGerar: false })).toEqual([]);
    f.campos.esquadriasInternas = "madeira de lei";
    expect(errosPci(f, { paraGerar: false }).join(" ")).toMatch(/Esquadrias internas: "madeira de lei" não é uma opção/);
  });
  it("local e data: cidade do imóvel + dia da geração, no horário de Imperatriz", () => {
    expect(localDataPci("Imperatriz", "MA", new Date("2026-11-24T12:00:00Z"))).toBe("Imperatriz - MA, 24 de novembro de 2026");
    // 01h de 25/11 em UTC ainda é dia 24 em Imperatriz (UTC−3)
    expect(localDataPci("Imperatriz", "MA", new Date("2026-11-25T01:30:00Z"))).toBe("Imperatriz - MA, 24 de novembro de 2026");
    expect(localDataPci("Canaã dos Carajás", null, new Date("2026-03-01T15:00:00Z"))).toBe("Canaã dos Carajás, 1 de março de 2026");
    expect(localDataPci(null, "MA", new Date("2026-03-01T15:00:00Z"))).toBe("1 de março de 2026");
  });
});

describe("foto de localização", () => {
  const PNG_1X1 = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  const u16 = (d: Uint8Array, o: number) => d[o] | (d[o + 1] << 8);
  const caixaDeTexto = (r: Registro | undefined) => !!r && r.tipo === R.MSODRAWING && r.dados.length >= 8 && u16(r.dados, 2) === 0xf00d;
  /** Os registros de desenho da aba da proposta, na ordem. */
  const desenhos = (p: PastaBiff8) => {
    const [ini, fim] = p.intervaloDaAba(p.aba(ABA_PROPOSTA_PCI));
    return p.registros.slice(ini, fim).filter((r) => [R.MSODRAWING, R.OBJ, R.TXO].includes(r.tipo as never));
  };
  /** Modelo em que o ÚLTIMO desenho da aba tem caixa de texto (como no modelo oficial em uso): OBJ + MSODRAWING(0xF00D) + TXO. */
  const modeloComTextoNoFim = () => {
    const p = PastaBiff8.abrir(MODELO);
    const [ini, fim] = p.intervaloDaAba(p.aba(ABA_PROPOSTA_PCI));
    let ultimoObj = -1;
    for (let k = ini; k < fim; k++) if (p.registros[k].tipo === R.OBJ) ultimoObj = k;
    const f00d = new Uint8Array([0x00, 0x00, 0x0d, 0xf0, 0, 0, 0, 0]);
    p.registros.splice(ultimoObj + 1, 0, { tipo: R.MSODRAWING, dados: f00d }, { tipo: R.TXO, dados: new Uint8Array(18) });
    return p;
  };

  it("a foto entra DEPOIS da caixa de texto do último desenho (antes ficava no meio e a foto sumia no LibreOffice e no Google Planilhas)", () => {
    const p = modeloComTextoNoFim();
    substituirFotos(p, ABA_PROPOSTA_PCI, [QUADRO_LOCALIZACAO_PCI], [{ dados: PNG_1X1, tipo: "png" }]);
    const d = desenhos(p);
    const iTexto = d.findLastIndex(caixaDeTexto);
    expect(iTexto).toBeGreaterThan(0);
    // a caixa de texto continua colada no OBJ da forma dela, seguida do TXO; a foto nova (forma + OBJ) fecha a lista
    expect(d[iTexto - 1].tipo).toBe(R.OBJ);
    expect(d[iTexto + 1].tipo).toBe(R.TXO);
    expect(d.slice(iTexto + 2).map((r) => r.tipo)).toEqual([R.MSODRAWING, R.OBJ]);
    expect(caixaDeTexto(d[iTexto + 2])).toBe(false);
    // trocar a foto de novo (a antiga sai) mantém a ordem
    const de = PastaBiff8.abrir(p.salvar());
    substituirFotos(de, ABA_PROPOSTA_PCI, [QUADRO_LOCALIZACAO_PCI], [{ dados: PNG_1X1, tipo: "png" }]);
    const d2 = desenhos(de);
    const iTexto2 = d2.findLastIndex(caixaDeTexto);
    expect(d2[iTexto2 - 1].tipo).toBe(R.OBJ);
    expect(d2.slice(iTexto2 + 1).map((r) => r.tipo)).toEqual([R.TXO, R.MSODRAWING, R.OBJ]);
    expect(d2.length).toBe(d.length);
    // e a foto está dentro do quadro
    const fotos = imagensDaAba(de, ABA_PROPOSTA_PCI).filter((i) => i.linha1 >= QUADRO_LOCALIZACAO_PCI.linha1 && i.linha2 <= QUADRO_LOCALIZACAO_PCI.linha2 && i.linha2 - i.linha1 >= 5);
    expect(fotos).toHaveLength(1);
  });
});

describe("custos pelos dois campos: percentual (incidência) e valor em R$", () => {
  const PCT = [3.1, 7, 12.5, 8, 4.5, 0, 5, 9, 6.9, 1, 4, 3.7, 8.5, 1.11, 3.8, 3.7, 3.7, 4.2, 0.3];
  const form = () => {
    const f = formularioPciVazio();
    Object.assign(f.campos, { valorImovel: 230000, valorTerreno: 60000, bdi: 18, areaCoberta: 45, areaAcessoria: 12.14 });
    return f;
  };
  it("a base fecha a conta da planilha: serviços com BDI = valor do imóvel − terreno", () => {
    const f = form();
    expect(baseDosCustosPci(f)).toBe(144067.8); // 170.000 ÷ 1,18
    expect(custoDaIncidenciaPci(144067.8, 3.1)).toBe(4466.1);
    expect(custoDaIncidenciaPci(144067.8, null)).toBeNull();
    // sem valor do imóvel, ou imóvel que não passa do terreno: sem base (o percentual é só resultado, como na planilha)
    f.campos.valorImovel = null;
    expect(baseDosCustosPci(f)).toBeNull();
    f.campos.valorImovel = 60000;
    expect(baseDosCustosPci(f)).toBeNull();
  });
  it("digitar o percentual grava o valor em R$, e o percentual mostrado é o que foi digitado; com 100%, a produção fecha no valor do imóvel", () => {
    const f = form();
    const base = baseDosCustosPci(f)!;
    f.custos = f.custos.map((_, i) => custoDaIncidenciaPci(base, PCT[i]));
    f.adicionais[0] = { descricao: "Movimentação de terra", valor: custoDaIncidenciaPci(base, 2) };
    f.adicionais[1] = { descricao: "Muro de divisa", valor: custoDaIncidenciaPci(base, 7.99) };
    PCT.forEach((p, i) => expect(incidenciaDoCustoPci(f, f.custos[i]), `serviço ${i + 1}`).toBe(p));
    const t = calcularTotaisPci(f);
    expect(Math.abs(t.totalServicos - base)).toBeLessThan(0.2); // só centavos de arredondamento
    expect(Math.abs(t.custoProducao - 230000)).toBeLessThan(0.3);
    expect(t.areaConstruida).toBe(57.14);
    // digitar o valor em R$ recalcula o percentual
    f.custos[0] = 14406.78;
    expect(incidenciaDoCustoPci(f, f.custos[0])).toBe(10);
  });
  it("percentuais digitados no campo de R$ (somam 100) são reconhecidos e convertidos; valores em R$ de verdade, não", () => {
    const f = form();
    f.custos = f.custos.map((_, i) => PCT[i]);
    f.adicionais[0] = { descricao: "Movimentação de terra", valor: 2 };
    f.adicionais[1] = { descricao: "Muro de divisa", valor: 7.99 };
    expect(calcularTotaisPci(f).totalServicos).toBeCloseTo(100, 6);
    const c = custosDigitadosComoPercentualPci(f)!;
    expect(c.custos[0]).toBe(4466.1);
    expect(c.adicionais[1]).toEqual({ descricao: "Muro de divisa", valor: 11511.02 });
    const g = { ...f, custos: c.custos, adicionais: c.adicionais };
    expect(custosDigitadosComoPercentualPci(g)).toBeNull();
    expect(Math.abs(calcularTotaisPci(g).custoProducao - 230000)).toBeLessThan(0.3);
    f.campos.valorImovel = null; // sem base não há o que converter
    expect(custosDigitadosComoPercentualPci(f)).toBeNull();
  });
});

describe("foto recortada na proporção do quadro (preenche o quadro, sem faixas e sem esticar)", () => {
  it("a proporção usada na tela é a do quadro do modelo", () => {
    const real = proporcaoDoQuadro(PastaBiff8.abrir(MODELO), ABA_PROPOSTA_PCI, QUADRO_LOCALIZACAO_PCI);
    expect(Math.abs(real / PROPORCAO_QUADRO_LOCALIZACAO_PCI - 1)).toBeLessThan(0.02);
  });
  it("foto mais alta que o quadro perde altura (de cima, do meio ou de baixo); mais larga, perde as laterais por igual; nunca estica", () => {
    // a foto do pedido: 1554 × 1281
    expect(recorteParaQuadroPci(1554, 1281, "meio")).toEqual({ x: 0, y: 384, largura: 1554, altura: 513 });
    expect(recorteParaQuadroPci(1554, 1281, "cima")).toEqual({ x: 0, y: 0, largura: 1554, altura: 513 });
    expect(recorteParaQuadroPci(1554, 1281, "baixo")).toEqual({ x: 0, y: 768, largura: 1554, altura: 513 });
    expect(recorteParaQuadroPci(4000, 800, "baixo")).toEqual({ x: 788, y: 0, largura: 2424, altura: 800 });
    for (const [w, h] of [[1554, 1281], [4000, 800], [300, 300], [3030, 1000]] as const) for (const parte of ["cima", "meio", "baixo"] as const) {
      const r = recorteParaQuadroPci(w, h, parte);
      expect(fotoNoFormatoDoQuadroPci(r.largura, r.altura), `${w}x${h} ${parte}`).toBe(true);
      expect(r.x >= 0 && r.y >= 0 && r.x + r.largura <= w && r.y + r.altura <= h).toBe(true);
    }
    expect(fotoNoFormatoDoQuadroPci(1554, 1281)).toBe(false);
    expect(recorteParaQuadroPci(0, 0)).toEqual({ x: 0, y: 0, largura: 0, altura: 0 });
  });
});
