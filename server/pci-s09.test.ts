// EPIC-024 S-09: CPF do engenheiro, "Dados automáticos" com fonte e conflitos, modelos de preenchimento (regras puras).
import { describe, expect, it } from "vitest";
import {
  CAMPOS_COPIAVEIS_MODELO_PCI,
  CAMPOS_PCI,
  CAMPO_POR_ID,
  aceitarSugestoesPci,
  aplicarEngenheiroPci,
  camposTrocadosPorEngenheiroPci,
  compararPreenchimentoPci,
  extrairModeloPreenchimentoPci,
  faltasPerfilEngenheiroPci,
  formularioPciVazio,
  normalizarFormularioPci,
  preencherPciAutomatico,
  sugestoesAutomaticasPci,
  sugestoesDoModeloPci,
  type FontesPreenchimentoPci,
} from "../shared/pci-gerador.js";

const RAFAEL = { nome: "Rafael Claudino", email: "rafael@x.y", telefone: "(99) 99111-2222", crea: "1122334455", creaUf: "MA", cpf: "529.982.247-25" };
const ANA = { nome: "Eng. Ana", email: "ana@x.y", telefone: "(86) 3222-1111", crea: "998877", creaUf: "PI", cpf: "111.444.777-35" };
const obra = { titulo: "Obra Y", endereco: "Rua A, 1", cidade: "Imperatriz", uf: "MA", area: 70, valorImovel: 200000, valorTerreno: 50000, valorFinanciado: 150000, inicio: "2026-01-10", termino: "2026-07-05" };
const fontes = (extra: Partial<FontesPreenchimentoPci> = {}): FontesPreenchimentoPci => ({
  obra, cliente: { nome: "Cliente Um", cpf: "123.456.789-09", email: "um@x.y", telefone: "(99) 98888-7777", endereco: null, bairro: "Centro" },
  coordenadas: { lat: -5.5, lng: -47.5 }, pci: null, ...extra,
});

describe("A — CPF do engenheiro no RTP e no RTE", () => {
  it("preenche nome, CPF, e-mail, telefone, CREA e UF; o mesmo profissional pode ser RTP e RTE", () => {
    let f = aplicarEngenheiroPci(formularioPciVazio(), "rtp", "7", RAFAEL);
    f = aplicarEngenheiroPci(f, "rte", "7", RAFAEL);
    for (const p of ["rtp", "rte"]) {
      expect(f.campos).toMatchObject({ [`${p}Nome`]: "Rafael Claudino", [`${p}Cpf`]: "529.982.247-25", [`${p}Email`]: "rafael@x.y", [`${p}Registro`]: "1122334455", [`${p}Uf`]: "MA", [`${p}Ddd`]: 99, [`${p}Telefone`]: "991112222" });
    }
    expect([f.rtpEngenheiroId, f.rteEngenheiroId]).toEqual(["7", "7"]);
  });
  it("profissionais diferentes; trocar de engenheiro nunca herda o CPF do anterior", () => {
    let f = aplicarEngenheiroPci(formularioPciVazio(), "rtp", "7", RAFAEL);
    f = aplicarEngenheiroPci(f, "rte", "8", ANA);
    expect([f.campos.rtpCpf, f.campos.rteCpf]).toEqual(["529.982.247-25", "111.444.777-35"]);
    f = aplicarEngenheiroPci(f, "rtp", "9", { ...ANA, nome: "Sem CPF", cpf: null, crea: null, creaUf: null });
    expect(f.campos).toMatchObject({ rtpNome: "Sem CPF", rtpCpf: null, rtpRegistro: null, rtpUf: null });
    // CPF não consultado (undefined) mantém o que estava digitado.
    f = aplicarEngenheiroPci({ ...f, campos: { ...f.campos, rteCpf: "999.999.999-99" } }, "rte", "8", { ...ANA, cpf: undefined });
    expect(f.campos.rteCpf).toBe("999.999.999-99");
  });
  it("lista o que a escolha trocaria (para confirmar) e o que falta no perfil", () => {
    const f = normalizarFormularioPci({ campos: { rtpNome: "Fulano", rtpCpf: "529.982.247-25" } });
    expect(camposTrocadosPorEngenheiroPci(f, "rtp", RAFAEL)).toEqual(["Nome do RTP"]);
    expect(camposTrocadosPorEngenheiroPci(formularioPciVazio(), "rtp", RAFAEL)).toEqual([]);
    expect(faltasPerfilEngenheiroPci({ ...RAFAEL, cpf: null, telefone: null })).toEqual(["CPF", "telefone"]);
  });
});

describe("B — Dados automáticos: fonte, conflito e o que faltou", () => {
  it("só completa o vazio; o diferente vira conflito (nada é trocado) e o igual é informado", () => {
    const { sugestoes, ausencias } = sugestoesAutomaticasPci(fontes());
    const atual = normalizarFormularioPci({ campos: { municipio: "Imperatriz", endereco: "Rua Digitada, 9" } });
    const r = compararPreenchimentoPci(atual, sugestoes, ausencias);
    expect(r.formulario.campos.endereco).toBe("Rua Digitada, 9");
    expect(r.conflitos).toEqual([expect.objectContaining({ chave: "endereco", atual: "Rua Digitada, 9", sugerido: "Rua A, 1", fonte: "Cadastro da obra" })]);
    expect(r.iguais.map((i) => i.chave)).toContain("municipio");
    expect(r.preenchidos).toContainEqual(expect.objectContaining({ chave: "proponenteCpf", valor: "123.456.789-09", fonte: "Cliente do CRM" }));
    expect(r.formulario.campos.proponenteNome).toBe("Cliente Um");
    // RTP/RTE sem engenheiro: motivo explícito.
    expect(r.naoEncontrados).toContainEqual(expect.objectContaining({ chave: "rtpCpf", motivo: expect.stringMatching(/Nenhum engenheiro escolhido para o RTP/) }));
    // Confirmação por campo.
    const aceito = aceitarSugestoesPci(r.formulario, r.conflitos);
    expect(aceito.campos.endereco).toBe("Rua A, 1");
  });
  it("clicar de novo não muda nada e diz que está tudo igual", () => {
    const { sugestoes } = sugestoesAutomaticasPci(fontes());
    const r = compararPreenchimentoPci(preencherPciAutomatico(fontes()), sugestoes);
    expect(r.preenchidos).toEqual([]);
    expect(r.conflitos).toEqual([]);
    expect(r.iguais.length).toBeGreaterThan(5);
  });
  it("engenheiro da obra preenche RTP/RTE com CPF; o escolhido vence a PCI vinculada", () => {
    const pci = normalizarFormularioPci({ campos: { rtpNome: "RT da PCI", rtpCpf: "000.000.001-91", rtpRegistro: "1" } });
    const f = preencherPciAutomatico(fontes({ pci, rtp: { id: "7", dados: { ...RAFAEL, cpf: null }, fonte: "Engenheiro escolhido nesta obra", escolhido: true }, rte: { id: "8", dados: ANA, fonte: "Engenheiro da última PCI gerada desta obra", escolhido: true } }));
    expect(f.campos).toMatchObject({ rtpNome: "Rafael Claudino", rtpRegistro: "1122334455", rteNome: "Eng. Ana", rteCpf: "111.444.777-35" });
    // Perfil sem CPF: o CPF do RT da PCI NÃO entra ao lado do nome do Rafael.
    expect(f.campos.rtpCpf).toBeNull();
    expect(f.rtpEngenheiroId).toBe("7");
    const r = compararPreenchimentoPci(formularioPciVazio(), sugestoesAutomaticasPci(fontes({ pci, rtp: { id: "7", dados: { ...RAFAEL, cpf: null }, fonte: "Escolhido", escolhido: true } })).sugestoes);
    expect(r.naoEncontrados).toContainEqual(expect.objectContaining({ chave: "rtpCpf", motivo: expect.stringMatching(/não misturar/) }));
  });
  it("engenheiro inferido (projeto do mesmo serviço) não passa por cima do RT da PCI vinculada", () => {
    const pci = normalizarFormularioPci({ campos: { rtpNome: "RT da PCI", rtpRegistro: "1" } });
    const f = preencherPciAutomatico(fontes({ pci, rtp: { id: "7", dados: RAFAEL, fonte: "Projeto", escolhido: false } }));
    expect(f.campos).toMatchObject({ rtpNome: "RT da PCI", rtpRegistro: "1", rtpCpf: null });
    expect(f.rtpEngenheiroId).toBeNull();
  });
  it("dados de pessoa não se misturam: nome diferente leva o CPF vazio para confirmação", () => {
    const atual = normalizarFormularioPci({ campos: { proponenteNome: "Outra Pessoa" } });
    const r = compararPreenchimentoPci(atual, sugestoesAutomaticasPci(fontes()).sugestoes);
    expect(r.formulario.campos.proponenteCpf).toBeNull();
    expect(r.conflitos.map((c) => c.chave)).toEqual(expect.arrayContaining(["proponenteNome", "proponenteCpf", "proponenteEmail"]));
  });
  it("sem cliente, sem localização e sem PCI legível: diz o motivo", () => {
    const { ausencias } = sugestoesAutomaticasPci(fontes({ cliente: null, coordenadas: null, motivos: { cliente: "A obra não tem cliente do CRM vinculado.", pci: "A PCI vinculada não pôde ser lida (arquivo inválido)." } }));
    expect(ausencias).toContainEqual(expect.objectContaining({ chave: "proponenteCpf", motivo: "A obra não tem cliente do CRM vinculado." }));
    expect(ausencias).toContainEqual(expect.objectContaining({ chave: "latitude", motivo: "A obra não tem localização no mapa." }));
    expect(ausencias.find((a) => a.chave === "custos")?.motivo).toMatch(/não pôde ser lida/);
  });
});

describe("C — modelos de preenchimento (lista de permissão)", () => {
  it("a lista de permissão só tem campos técnicos existentes", () => {
    for (const id of CAMPOS_COPIAVEIS_MODELO_PCI) expect(CAMPO_POR_ID.get(id)?.copiavel, id).toBe(true);
    const pessoais = ["proponente", "rtp", "rte", "imovel", "matricula", "documentacao", "localizacao"];
    expect(CAMPOS_PCI.filter((c) => c.copiavel && pessoais.includes(c.secao))).toEqual([]);
    for (const id of ["valorTerreno", "valorImovel", "valorFinanciado", "areaTerreno", "areaPermeavel", "esgoto", "abastecimentoAgua", "drenagem", "preExecutado", "observacoes", "localData", "obrasPreExistentes"])
      expect(CAMPO_POR_ID.get(id)?.copiavel, id).toBeFalsy();
  });
  it("extrair tira dados pessoais — também de JSON adulterado", () => {
    const origem = normalizarFormularioPci({
      campos: { proponenteNome: "Cliente Um", proponenteCpf: "123.456.789-09", rtpCpf: "529.982.247-25", endereco: "Rua A, 1", bairro: "Centro", matricula: "4321", latitude: `05° 30' 00" S`, valorTerreno: 50000, areaCoberta: 70, divisaoInterna: "2 quartos, sala, cozinha", bdi: 18 },
      custos: [1000, 2000], cronograma: [10, 100], rtpEngenheiroId: "7", imagem: { tipo: "png", base64: "AAAA" },
    });
    const m = extrairModeloPreenchimentoPci(origem);
    const json = JSON.stringify(m);
    for (const proibido of ["Cliente Um", "123.456.789-09", "529.982.247-25", "Rua A", "Centro", "4321", "05°", "50000", "AAAA", "EngenheiroId", "imagem"]) expect(json).not.toContain(proibido);
    expect(m.campos).toEqual({ areaCoberta: 70, divisaoInterna: "2 quartos, sala, cozinha", bdi: 18 });
    expect(m.custos.slice(0, 2)).toEqual([1000, 2000]);
    expect(extrairModeloPreenchimentoPci({ campos: { proponenteCpf: "123", areaCoberta: 70 }, segredo: "x" }).campos).toEqual({ areaCoberta: 70 });
  });
  it("aplicar em outra obra: técnico entra, pessoal da obra fica, diferente pede confirmação", () => {
    const outra = normalizarFormularioPci({ campos: { proponenteNome: "Cliente Dois", proponenteCpf: "987.654.321-00", endereco: "Rua Dois", bdi: 10 } });
    const modelo = extrairModeloPreenchimentoPci({ campos: { proponenteNome: "Cliente Um", areaCoberta: 70, bdi: 18, quartos: "2" }, custos: [1000] });
    const r = compararPreenchimentoPci(outra, sugestoesDoModeloPci(modelo, 'Modelo "Casa 70" v1'));
    expect(r.formulario.campos).toMatchObject({ proponenteNome: "Cliente Dois", proponenteCpf: "987.654.321-00", endereco: "Rua Dois", areaCoberta: 70, bdi: 10 });
    expect(r.formulario.custos[0]).toBe(1000);
    expect(r.conflitos).toEqual([expect.objectContaining({ chave: "bdi", atual: "10", sugerido: "18" })]);
  });
});
