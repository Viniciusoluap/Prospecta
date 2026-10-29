import { describe, expect, it } from "vitest";
import {
  areaDoServico, caminhoCliente, caminhoEquipe, caminhoFotosObra, caminhoGeradorPci, caminhoMedicoesObra, caminhoModelosPci, caminhoEstudo,
  caminhoOrcamentoEstudo, caminhoWhatsappCliente, caminhoWhatsappSemCliente, chaveEntidade, dataArquivo, extensaoArquivo, idDaChaveEntidade,
  entidadeDaChave, limparNome, nomeArquivo, nomeComNumero, nomeDocumentoEquipe, nomeFotoObra, nomeMidiaWhatsapp, nomeModeloPci, nomePciGerada,
  nomePlanilhaOrcamento, pastaLegada,
} from "../shared/drive-estrutura";

// Pedido 15/10: pastas do Google Drive com nomes legíveis, iguais nos dois sistemas.
describe("estrutura de pastas do Drive", () => {
  it("cliente: Clientes/<Nome (nº id)>/<Área>", () => {
    expect(caminhoCliente({ id: 19, numero: 19, nome: "Maria da Silva" }, "atendimento")).toEqual([
      { chave: "clientes", nome: "Clientes" },
      { chave: "cliente:19", nome: "Maria da Silva (nº 19)" },
      { chave: "cliente:19:atendimento", nome: "Atendimento" },
    ]);
  });

  it("área pelo tipo de serviço do CRM; sem serviço fica em Atendimento", () => {
    expect(areaDoServico(null)).toBe("atendimento");
    expect(areaDoServico("financiamento_habitacional")).toBe("financiamento");
    expect(areaDoServico("consorcio")).toBe("financiamento");
    expect(areaDoServico("despachante")).toBe("regularizacao");
    expect(areaDoServico("juridico")).toBe("juridico");
    expect(areaDoServico("obra_cliente")).toBe("obras");
    expect(areaDoServico("bpo_financeiro")).toBe("outros");
  });

  it("estudo: Incorporação/<Estudo (nº id)>/<Etapa>", () => {
    expect(caminhoEstudo({ id: 3, numero: 3, nome: "Loteamento Jardim X" }, { chave: "registro", nome: "Registro do loteamento" }).map((p) => p.nome))
      .toEqual(["Incorporação", "Loteamento Jardim X (nº 3)", "Registro do loteamento"]);
  });

  it("nome do arquivo: rótulo — data de Brasília + extensão", () => {
    // 02:30 UTC de 16/10 ainda é 15/10 em Brasília.
    expect(dataArquivo(new Date("2026-10-16T02:30:00Z"))).toBe("15-10-2026");
    expect(nomeArquivo("RG", new Date("2026-10-15T15:00:00Z"), "IMG_0431.JPEG", "image/jpeg")).toBe("RG — 15-10-2026.jpeg");
    expect(nomeArquivo("Contrato CT-1", new Date("2026-10-15T15:00:00Z"), null, "application/pdf")).toBe("Contrato CT-1 — 15-10-2026.pdf");
    expect(extensaoArquivo("sem-extensao", "image/png")).toBe(".png");
  });

  it("nomes sem barras nem caracteres de controle; vazio vira 'Sem nome'", () => {
    expect(limparNome("  Ana / José\\Lima\n ")).toBe("Ana José Lima");
    expect(nomeComNumero("   ", 7)).toBe("Sem nome (nº 7)");
  });

  it("pasta antiga: sem etiqueta e com nome do formato antigo; pasta do dono nunca", () => {
    expect(pastaLegada({ name: "cliente-19" })).toBe(true);
    expect(pastaLegada({ name: "incorporacao-3" })).toBe(true);
    expect(pastaLegada({ name: "incorporacao-ckx9a1b2c3" })).toBe(true);
    expect(pastaLegada({ name: "Minha pasta" })).toBe(false);
    expect(pastaLegada({ name: "cliente-19", appProperties: { pastaSistema: "cliente:19" } })).toBe(false);
  });

  it("medições CAIXA (18/10): Obras/<Obra (nº id)>/Medições CAIXA, nome do arquivo .xls", () => {
    expect(caminhoMedicoesObra({ id: 7, numero: 7, nome: "Casa Silmara" })).toEqual([
      { chave: "obras", nome: "Obras" },
      { chave: "obra:7", nome: "Casa Silmara (nº 7)" },
      { chave: "obra:7:medicoes-caixa", nome: "Medições CAIXA" },
    ]);
    expect(nomeArquivo("PLS (levantamento 25-08-2026)", new Date("2026-10-19T15:00:00Z"), "PLS_Casa.xls", "application/vnd.ms-excel"))
      .toBe("PLS (levantamento 25-08-2026) — 19-10-2026.xls");
    expect(extensaoArquivo(null, "application/vnd.ms-excel")).toBe(".xls");
  });
});

// Pedido de 29/10: tudo o que o sistema guarda também vai para o Drive, organizado.
describe("organização completa do Drive (29/10)", () => {
  const dia = new Date("2026-10-29T15:00:00Z");

  it("equipe: Equipe/<Nome (nº id)>/<categoria> com etiquetas equipe, equipe:<id>, equipe:<id>:<categoria>", () => {
    expect(caminhoEquipe({ id: 4, numero: 4, nome: "João Engenheiro" }, "anuidade_crea")).toEqual([
      { chave: "equipe", nome: "Equipe" },
      { chave: "equipe:4", nome: "João Engenheiro (nº 4)" },
      { chave: "equipe:4:anuidade_crea", nome: "Anuidade CREA" },
    ]);
    expect(caminhoEquipe({ id: 4, numero: 4, nome: "J" }, "documento_pessoal")[2].nome).toBe("Documento pessoal");
    expect(caminhoEquipe({ id: 4, numero: 4, nome: "J" }, "carteirinha_crea")[2].nome).toBe("Carteirinha CREA");
    expect(caminhoEquipe({ id: 4, numero: 4, nome: "J" }, "desconhecida")[2]).toEqual({ chave: "equipe:4:outros", nome: "Outros" });
    expect(nomeDocumentoEquipe("anuidade_crea", dia, "boleto.PDF", "application/pdf")).toBe("Anuidade CREA — 29-10-2026.pdf");
  });

  it("modelos: Modelos/PCI CAIXA/PCI modelo v01 — dd-mm-aaaa.ext", () => {
    expect(caminhoModelosPci()).toEqual([{ chave: "modelos", nome: "Modelos" }, { chave: "modelos:pci", nome: "PCI CAIXA" }]);
    expect(nomeModeloPci(1, dia, "PCI_v3.xlsm", "")).toBe("PCI modelo v01 — 29-10-2026.xlsm");
    expect(nomeModeloPci(12, dia, null, "application/vnd.ms-excel")).toBe("PCI modelo v12 — 29-10-2026.xls");
  });

  it("fotos da obra: Obras/<Obra>/Fotos/<Medição 01 — data | Sem medição>/Foto 01 — data.jpg", () => {
    const obra = { id: 7, numero: 7, nome: "Casa Silmara" };
    expect(caminhoFotosObra(obra, { id: 31, ordem: 1, data: new Date("2026-10-20T15:00:00Z") })).toEqual([
      { chave: "obras", nome: "Obras" },
      { chave: "obra:7", nome: "Casa Silmara (nº 7)" },
      { chave: "obra:7:fotos", nome: "Fotos" },
      { chave: "obra:7:fotos:medicao:31", nome: "Medição 01 — 20-10-2026" },
    ]);
    expect(caminhoFotosObra(obra, null)[3]).toEqual({ chave: "obra:7:fotos:medicao:sem", nome: "Sem medição" });
    expect(nomeFotoObra(3, dia, "image/jpeg")).toBe("Foto 03 — 29-10-2026.jpg");
  });

  it("gerador de PCI: Obras/<Obra>/Gerador de PCI/PCI gerada — data.xls|.xlsm|.pdf", () => {
    expect(caminhoGeradorPci({ id: 7, numero: 7, nome: "Casa" }).slice(2)).toEqual([{ chave: "obra:7:gerador-pci", nome: "Gerador de PCI" }]);
    expect(nomePciGerada(dia, "PCI_Joao.xlsm", "")).toBe("PCI gerada — 29-10-2026.xlsm");
    expect(nomePciGerada(dia, "PCI_Joao.pdf", "application/pdf")).toBe("PCI gerada — 29-10-2026.pdf");
  });

  it("WhatsApp: no cliente (Atendimento/WhatsApp) ou em WhatsApp sem cliente/<+55 número>", () => {
    expect(caminhoWhatsappCliente({ id: 19, numero: 19, nome: "Maria" }).slice(2)).toEqual([
      { chave: "cliente:19:atendimento", nome: "Atendimento" },
      { chave: "cliente:19:atendimento:whatsapp", nome: "WhatsApp" },
    ]);
    expect(caminhoWhatsappSemCliente("55 (11) 99999-0000")).toEqual([
      { chave: "whatsapp-sem-cliente", nome: "WhatsApp sem cliente" },
      { chave: "whatsapp-sem-cliente:5511999990000", nome: "+5511999990000" },
    ]);
    expect(caminhoWhatsappSemCliente("5511999990000@s.whatsapp.net")[1].chave).toBe("whatsapp-sem-cliente:5511999990000");
    expect(nomeMidiaWhatsapp(dia, null, "audio/ogg; codecs=opus")).toBe("Mídia — 29-10-2026.ogg");
  });

  it("orçamento do estudo: Incorporação/<Estudo>/Orçamento/Planilha importada — data.xlsx", () => {
    expect(caminhoOrcamentoEstudo({ id: 3, numero: 3, nome: "Jardim X" })[2]).toEqual({ chave: "incorporacao:3:orcamento", nome: "Orçamento" });
    expect(nomePlanilhaOrcamento(dia, "orcamento.xlsx", "")).toBe("Planilha importada — 29-10-2026.xlsx");
  });

  it("etiqueta da pasta da entidade: só '<entidade>:<id>' exato identifica o registro", () => {
    expect(chaveEntidade("cliente", 19)).toBe("cliente:19");
    expect(idDaChaveEntidade("cliente", "cliente:19")).toBe(19);
    expect(idDaChaveEntidade("cliente", "cliente:19:atendimento")).toBeNull();
    expect(idDaChaveEntidade("cliente", "cliente-19-portfolio")).toBeNull();
    expect(idDaChaveEntidade("obra", "obra:abc")).toBeNull();
    expect(idDaChaveEntidade("equipe", "equipe:4")).toBe(4);
    expect(idDaChaveEntidade("incorporacao", undefined)).toBeNull();
    expect(entidadeDaChave("cliente:19")).toEqual({ entidade: "cliente", id: 19 });
    expect(entidadeDaChave("cliente:projeto-5")).toEqual({ entidade: "projeto", id: 5 });
    expect(entidadeDaChave("imovel:3")).toEqual({ entidade: "imovel", id: 3 });
    expect(entidadeDaChave("obra:7:fotos")).toBeNull();
    expect(entidadeDaChave("projeto-5")).toBeNull();
    expect(entidadeDaChave(null)).toBeNull();
  });
});
