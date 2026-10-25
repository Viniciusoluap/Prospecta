// Pedido de 25/10 (noite), itens 9, 10 e 14: regras puras — titular no extrato (Cora CSV, OFX, PDF),
// descrição do lançamento, regra/sugestão por titular, DRE por categoria e cobranças do Asaas.
import { describe, expect, it } from "vitest";
import { chavesImportacao, extensaoExtratoValida, extrairTitular, lerCsv, lerOfx, lerTabela, lerTextoPdf } from "../shared/extrato-import";
import {
  descricaoDoLancamento,
  dreDasCategorias,
  dreDosLancamentos,
  lancamentoDaMovimentacao,
  normalizarTitular,
  resumoPorCliente,
  sugerirClientePorTitular,
} from "../shared/financeiro/bpo-extrato";
import { clienteDaCobranca, creditoDaCobranca, lancamentoDaCobranca, situacaoCobrancaAsaas, situacaoDoLancamento } from "../shared/financeiro/bpo-asaas";

describe("titular e descrição no extrato", () => {
  it("CSV da Cora (Data; Transação; Tipo Transação; Identificação; Valor): tipo continua a descrição, nome vira titular", () => {
    const csv = [
      "Data;Transação;Tipo Transação;Identificação;Valor",
      "02/01/2026;Transf Pix enviada;DÉBITO;Maria da Silva Materiais;350,00",
      "03/01/2026;Pgto QR Code Pix;DÉBITO;Posto Avenida LTDA;120,50",
      "05/01/2026;Transf Pix recebida;CRÉDITO;João Pereira;2.000,00",
    ].join("\n");
    const r = lerCsv(csv);
    expect(r.linhas.map(l => [l.descricao, l.titular, l.tipo, l.valor])).toEqual([
      ["Transf Pix enviada", "Maria da Silva Materiais", "debito", 350],
      ["Pgto QR Code Pix", "Posto Avenida LTDA", "debito", 120.5],
      ["Transf Pix recebida", "João Pereira", "credito", 2000],
    ]);
    expect(r.linhas[0].original).toBe("Transf Pix enviada | Maria da Silva Materiais");
  });

  it("CSV com Identificação e Descrição separadas guarda o detalhe", () => {
    const r = lerCsv("Data;Transação;Identificação;Descrição;Valor\n10/01/2026;Transf Pix enviada;Pedreiro Zé;Diária semana 2;-800,00");
    expect(r.linhas[0]).toMatchObject({ descricao: "Transf Pix enviada", titular: "Pedreiro Zé", detalhe: "Diária semana 2", tipo: "debito", valor: 800 });
  });

  it("a chave de importação não muda com o titular (reimportar não duplica)", () => {
    const h = (s: string) => s;
    const sem = [{ data: "2026-01-02", descricao: "Transf Pix enviada", valor: 350, tipo: "debito" as const }];
    const com = [{ ...sem[0], titular: "Maria", original: "Transf Pix enviada | Maria" }];
    expect(chavesImportacao(1, com, h)).toEqual(chavesImportacao(1, sem, h));
  });

  it("OFX: NAME é o titular e MEMO a descrição; NAME só com o tipo → nome tirado do MEMO", () => {
    const ofx = `<OFX><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260102<TRNAMT>-350.00<FITID>1<NAME>MARIA DA SILVA<MEMO>Transf Pix enviada</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260103<TRNAMT>900.00<FITID>2<NAME>PIX RECEBIDO<MEMO>Pix recebido - JOAO PEREIRA</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260104<TRNAMT>-9.90<FITID>3<MEMO>TARIFA PACOTE</STMTTRN>
</BANKTRANLIST></OFX>`;
    const r = lerOfx(ofx).linhas;
    expect(r.map(l => [l.descricao, l.titular ?? null])).toEqual([
      ["Transf Pix enviada", "MARIA DA SILVA"],
      ["Pix recebido - JOAO PEREIRA", "JOAO PEREIRA"],
      ["TARIFA PACOTE", null],
    ]);
    expect(r[0].original).toBe("MARIA DA SILVA | Transf Pix enviada");
  });

  it("PDF e Excel: nome depois do tipo da transação", () => {
    expect(lerTextoPdf(["02/01/2026 Transf Pix enviada Maria Souza -350,00 1.000,00"]).linhas[0].titular).toBe("Maria Souza");
    expect(lerTabela([["Data", "Descrição", "Valor"], ["02/01/2026", "Pix recebido de Ana Lima", "50,00"]]).linhas[0].titular).toBe("Ana Lima");
  });

  it("extrairTitular reconhece os tipos e recusa quando só há o tipo", () => {
    expect(extrairTitular("Pgto QR Code Pix - Padaria Bom Pão")).toBe("Padaria Bom Pão");
    expect(extrairTitular("PIX ENVIADO PARA FULANO DE TAL")).toBe("FULANO DE TAL");
    expect(extrairTitular("Transf Pix enviada")).toBeNull();
    expect(extrairTitular("Tarifa mensal")).toBeNull();
    expect(extrairTitular("")).toBeNull();
  });

  it("iPad: a extensão é conferida no código (o seletor aceita qualquer arquivo)", () => {
    expect(extensaoExtratoValida("Extrato.OFX")).toBe(true);
    expect(extensaoExtratoValida("extrato.csv")).toBe(true);
    expect(extensaoExtratoValida("foto.heic")).toBe(false);
  });
});

describe("descrição do lançamento e regra por titular", () => {
  it("monta 'Tipo — Titular — descrição' sem repetir partes vazias ou contidas", () => {
    expect(descricaoDoLancamento({ descricao: "Transf Pix enviada", titular: "Maria", detalhe: "Diária" })).toBe("Transf Pix enviada — Maria — Diária");
    expect(descricaoDoLancamento({ descricao: "Transf Pix enviada", titular: "Maria", detalhe: "" })).toBe("Transf Pix enviada — Maria");
    expect(descricaoDoLancamento({ descricao: "PIX RECEBIDO FULANO", titular: "FULANO" })).toBe("PIX RECEBIDO FULANO");
    expect(descricaoDoLancamento({ descricao: "", titular: null })).toBe("Movimentação bancária");
    const l = lancamentoDaMovimentacao({ id: 1, data: "2026-01-02", descricao: "Transf Pix enviada", valor: 10, tipo: "debito", categoria: null, titular: "Maria" });
    expect(l?.descricao).toBe("Transf Pix enviada — Maria");
  });

  it("normaliza titular (acento, caixa, CPF) e sugere cliente só quando o nome bate com um único", () => {
    expect(normalizarTitular("  JOÃO  Pereira 123.456.789-00 ")).toBe("joao pereira");
    const clientes = [{ id: 1, razaoSocial: "João Pereira" }, { id: 2, razaoSocial: "Obra X", nomeLead: "Ana Lima" }, { id: 3, razaoSocial: "Dup" }, { id: 4, razaoSocial: "DUP" }];
    expect(sugerirClientePorTitular("JOAO PEREIRA", clientes)).toBe(1);
    expect(sugerirClientePorTitular("ana lima", clientes)).toBe(2);
    expect(sugerirClientePorTitular("dup", clientes)).toBeNull();
    expect(sugerirClientePorTitular("Outro", clientes)).toBeNull();
  });

  it("DRE por categoria e por competência deixam a transferência interna de fora", () => {
    const lancs = [
      { competencia: "2026-01", tipo: "receita", valor: "1000.00", categoria: "Recebimento de cliente" },
      { competencia: "2026-01", tipo: "despesa", valor: "300.00", categoria: "Material" },
      { competencia: "2026-01", tipo: "despesa", valor: "50.00", categoria: "Material" },
      { competencia: "2026-01", tipo: "receita", valor: "999.00", categoria: "Transferência interna" },
      { competencia: "2026-02", tipo: "honorario", valor: "100.00", categoria: null },
    ];
    expect(dreDasCategorias(lancs)).toEqual([
      { categoria: "Recebimento de cliente", entradas: 1000, saidas: 0, resultado: 1000 },
      { categoria: "Material", entradas: 0, saidas: 350, resultado: -350 },
      { categoria: "Sem categoria", entradas: 100, saidas: 0, resultado: 100 },
    ]);
    expect(dreDosLancamentos(lancs).find(r => r.competencia === "2026-01")).toEqual({ competencia: "2026-01", cobrancas: 1000, despesas: 350, resultado: 650 });
  });

  it("resumo por cliente: recebido (cobranças pagas) e em aberto; despesa não conta", () => {
    const r = resumoPorCliente([
      { clienteId: 1, tipo: "receita", valor: "100.10", pago: true },
      { clienteId: 1, tipo: "receita", valor: "50.00", pago: false },
      { clienteId: 1, tipo: "despesa", valor: "30.00", pago: true },
      { clienteId: null, tipo: "receita", valor: "1.00", pago: true },
    ]);
    expect(r.get(1)).toEqual({ recebido: 100.1, emAberto: 50, lancamentos: 2 });
  });
});

describe("cobranças do Asaas (regras puras)", () => {
  const cob = (extra: Partial<Parameters<typeof lancamentoDaCobranca>[0]> = {}) => ({
    id: "pay_1", status: "RECEIVED", valor: 500, valorLiquido: 498.01, vencimento: "2026-10-10", pagoEm: "2026-10-09",
    descricao: "Parcela 1", clienteNome: "Ana Lima", clienteDocumento: "123.456.789-00", ...extra,
  });
  it("situação: pago, aberto, vencido; estornada/excluída fica fora", () => {
    expect(situacaoCobrancaAsaas("CONFIRMED")).toBe("pago");
    expect(situacaoCobrancaAsaas("PENDING")).toBe("aberto");
    expect(situacaoCobrancaAsaas("OVERDUE")).toBe("vencido");
    expect(situacaoCobrancaAsaas("REFUNDED")).toBeNull();
    expect(situacaoDoLancamento({ pago: false, vencimento: "2026-10-01" }, new Date("2026-10-25"))).toBe("vencido");
    expect(situacaoDoLancamento({ pago: false, vencimento: "2026-11-01" }, new Date("2026-10-25"))).toBe("aberto");
  });
  it("lançamento da cobrança e vínculo do cliente por CPF ou nome", () => {
    expect(lancamentoDaCobranca(cob({ status: "PENDING" }), null)).toMatchObject({
      asaasPaymentId: "pay_1", tipo: "receita", categoria: "Recebimento de cliente", pago: false, pagoEm: null,
      valor: "500.00", competencia: "2026-10", clienteNomeLivre: "Ana Lima", descricao: "Cobrança Asaas — Ana Lima — Parcela 1",
    });
    const clientes = [{ id: 7, razaoSocial: "Outro nome", documentos: ["12345678900"] }, { id: 8, razaoSocial: "Ana Lima" }];
    expect(clienteDaCobranca(cob(), clientes)).toBe(7);
    expect(clienteDaCobranca(cob({ clienteDocumento: null }), clientes)).toBe(8);
  });
  it("crédito sem id do pagamento: mesmo valor (bruto ou líquido) e até 3 dias", () => {
    const candidatos = [
      { bankTransactionId: 1, valor: "498.01", data: "2026-10-12" },
      { bankTransactionId: 2, valor: "498.01", data: "2026-10-09" },
      { bankTransactionId: 3, valor: "500.00", data: "2026-10-20" },
    ];
    expect(creditoDaCobranca(cob(), candidatos, new Set())).toBe(2);
    expect(creditoDaCobranca(cob(), candidatos, new Set([2]))).toBe(1);
    expect(creditoDaCobranca(cob({ status: "PENDING" }), candidatos, new Set())).toBeNull();
  });
});
