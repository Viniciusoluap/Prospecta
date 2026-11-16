// EPIC-025 (Dolores, etapa 1) — regras puras de shared/dolores (formato, máscaras, limites, responsável, prazos).
import { describe, expect, it } from "vitest";
import {
  diaDoPrazo, diaFortaleza, diasEntre, isoFortaleza, limitarResposta, mascararCpf, mascararTelefone, paginar, reais, truncar,
} from "../../shared/dolores/formato.js";
import { OMITIDO as OMITIDO_T, sanitizarResposta, sanitizarTexto } from "../../shared/dolores/sanitizar.js";
import { etapaAtual, proximaProvidencia, responsavelDaTarefa, responsavelDoProcesso, situacaoDoPrazo } from "../../shared/dolores/regras.js";

describe("formato", () => {
  it("datas no fuso de Imperatriz; prazo pelo dia gravado", () => {
    expect(isoFortaleza(new Date("2026-11-16T02:30:00Z"))).toBe("2026-11-15T23:30:00-03:00");
    expect(diaFortaleza(new Date("2026-11-16T02:30:00Z"))).toBe("2026-11-15");
    expect(diaDoPrazo(new Date("2026-11-10T00:00:00Z"))).toBe("2026-11-10");
    expect(diaDoPrazo("2026-11-10")).toBe("2026-11-10");
    expect(isoFortaleza(null)).toBeNull();
    expect(isoFortaleza("lixo")).toBeNull();
    expect(diasEntre("2026-11-10", "2026-11-16")).toBe(6);
  });

  it("CPF só com os 2 últimos dígitos; telefone com DDD e 4 últimos", () => {
    expect(mascararCpf("123.456.789-01")).toBe("***.***.***-01");
    expect(mascararCpf("1234")).toBe("***");
    expect(mascararCpf(null)).toBeNull();
    expect(mascararTelefone("5599991234567")).toBe("(99) *****-4567");
    expect(mascararTelefone("12")).toBe("***");
  });

  it("dinheiro, texto, página e corte da resposta", () => {
    expect(reais("1234.567")).toBe(1234.57);
    expect(reais("abc")).toBeNull();
    expect(truncar("  a   b  ")).toBe("a b");
    expect(truncar("x".repeat(10), 5)).toBe("xxxx…");
    expect(paginar([1, 2, 3, 4, 5], 2, 2)).toEqual({ itens: [3, 4], total: 5, pagina: 2, limite: 2, temMais: true });
    const grande = { itens: Array.from({ length: 1000 }, (_, i) => ({ i, t: "y".repeat(50) })), totais: { n: 1000 } };
    const r = limitarResposta(grande, 5000);
    expect(r.truncado).toBe(true);
    expect(JSON.stringify(r.valor).length).toBeLessThanOrEqual(5000);
    expect((r.valor as typeof grande).totais).toEqual({ n: 1000 });
    expect(limitarResposta({ a: 1 }).truncado).toBe(false);
  });
});

describe("regras", () => {
  it("responsável: vazio/marcador → a confirmar (com o motivo); nome real fica", () => {
    expect(responsavelDoProcesso("", true)).toEqual({ nome: "a confirmar", aConfirmar: true, motivo: "padrão da migração do Trello (responsável não informado)" });
    expect(responsavelDoProcesso("  Sem Responsável ", false)).toMatchObject({ nome: "a confirmar", motivo: "responsável não registrado no processo" });
    expect(responsavelDoProcesso("Bianca", true)).toEqual({ nome: "Bianca", aConfirmar: false, motivo: null });
    expect(responsavelDaTarefa("Sem responsável")).toBe("sem responsável");
  });

  it("etapa atual e situação do prazo", () => {
    expect(etapaAtual([{ nome: "B", ordem: 2, progresso: 0 }, { nome: "A", ordem: 1, progresso: 100 }])).toMatchObject({ nome: "B", todasConcluidas: false });
    expect(etapaAtual([{ nome: "A", ordem: 1, progresso: 100 }])).toMatchObject({ nome: "A", todasConcluidas: true });
    expect(etapaAtual([])).toBeNull();
    const agora = new Date("2026-11-16T12:00:00Z");
    expect(situacaoDoPrazo({ encerrado: false, prazo: "2026-11-15", ultimaMovimentacao: "2026-11-01T12:00:00Z", agora }))
      .toEqual({ atrasado: true, diasDeAtraso: 1, diasSemMovimentacao: 15, parado: true });
    expect(situacaoDoPrazo({ encerrado: false, prazo: "2026-11-16", ultimaMovimentacao: null, agora })).toMatchObject({ atrasado: false, parado: false });
    expect(situacaoDoPrazo({ encerrado: true, prazo: "2026-01-01", ultimaMovimentacao: "2025-01-01", agora })).toMatchObject({ atrasado: false, parado: false });
  });

  it("próxima providência: tarefa aberta mais cedo, depois follow-up; nada → null", () => {
    const tarefas = [
      { title: "sem prazo", status: "pending", dueAt: null, assignedTo: "A" },
      { title: "cedo", status: "in_progress", dueAt: "2026-11-17T12:00:00Z", assignedTo: "B" },
      { title: "feita", status: "done", dueAt: "2026-11-01T12:00:00Z", assignedTo: "C" },
    ];
    expect(proximaProvidencia({ tarefas })).toEqual({ fonte: "tarefa", descricao: "cedo", prazo: "2026-11-17", responsavel: "B" });
    expect(proximaProvidencia({ tarefas: [], followupDate: "2026-11-20T12:00:00Z" })).toMatchObject({ fonte: "follow_up_crm", prazo: "2026-11-20" });
    expect(proximaProvidencia({ tarefas: [] })).toBeNull();
  });
});

describe("filtro de dados pessoais em texto livre (M1)", () => {
  it("CPF/CNPJ, e-mail, telefone, banco/PIX e senha viram marcadores", () => {
    expect(sanitizarTexto("Senha do gov.br 1234; CPF 111.222.333-44; conta 12345-6 ag 0001"))
      .toBe("Senha [senha omitida]; CPF [dado pessoal omitido]; conta [dado bancário omitido] ag [dado bancário omitido]");
    expect(sanitizarTexto("ligar (99) 99123-4567, 99 991234567 ou 5599991234567")).not.toMatch(/\d{4}/);
    expect(sanitizarTexto("email maria@x.com.br")).toBe("email [dado pessoal omitido]");
    expect(sanitizarTexto("CNPJ 11.222.333/0001-81 e 11222333000181")).toBe("CNPJ [dado pessoal omitido] e [dado pessoal omitido]");
    expect(sanitizarTexto("CPF 52998224725")).toBe("CPF [dado pessoal omitido]");
    expect(sanitizarTexto("chave pix: maria@x.com")).toBe("chave pix: [dado bancário omitido]");
    expect(sanitizarTexto("o código de acesso é abc123. Depois liga")).toBe("o código [senha omitida]. Depois liga");
  });

  it("não mexe em valores, datas, CEP, matrícula, protocolo longo nem em campos já mascarados", () => {
    for (const t of ["R$ 1.500,00 em 16/11/2026", "CEP 65900-000", "matrícula 12.345", "protocolo 202611160001234567", "Conta Azul importada",
      "***.***.***-01", "(99) *****-4567", "2026-11-16T09:00:00-03:00", "Honorários outubro"]) expect(sanitizarTexto(t)).toBe(t);
  });

  it("QA achado 2: CPF/telefone só em dígitos seguidos de pontuação, com espaços ou com o nono dígito separado saem", () => {
    const casos = [
      "O CPF é 12345678909.", "CPF 12345678909, ok", "CPF 12345678909-x", "CPF 12345678909; depois", "CPF 12345678909!",
      "Ligue 99991234567.", "Número 5599991234567.", "ligue (5599991234567)", "fixo 9935241234.", "tel 559935241234,",
      "CPF 123 456 789 09", "CPF 123 456 789-09.", "tel 99 9 9123 4567", "+55 (99) 9 9123-4567", "telefone 9 9123-4567.",
      "CPF 52998224725\nfim", "processo do CPF 12345678909", "protocolo 99991234567", "protocolo 5599991234567",
    ];
    for (const c of casos) {
      const r = sanitizarTexto(c);
      expect(r, c).toContain("[dado pessoal omitido]");
      expect(r.replace(/\D/g, "").length, `${c} → ${r}`).toBeLessThan(5);
    }
  });

  it("QA achado 2 (outro lado): valores em reais, datas, processos, protocolos e áreas continuam intactos", () => {
    for (const t of [
      "R$ 1.250.000,00.", "R$ 12.345,67, pago", "R$ 1500000000", "valor 1.500,00-", "em 16/11/2026.", "em 2026-11-16.",
      "processo 0801234-56.2026.8.10.0040.", "Processo nº 08012345620268100040", "protocolo 2026001234.", "protocolo nº 20261116001.",
      "Protocolo: 20261116001, aguardando", "matrícula 1234567890.", "requerimento 2026111600.", "área de 1.250,50 m².",
      "lote com 360 m2", "terreno de 12.000 m²", "CEP 65900-000.", "lista 123 456 789 00", "cotas 100 200 300 40",
    ]) expect(sanitizarTexto(t), t).toBe(t);
  });

  it("QA r2 N1: CPF/CNPJ válidos em qualquer separação, telefones colados/pontuados, e-mail com espaço e disfarces Unicode saem", () => {
    const casos = [
      "CPF 123456789-09", "CPF 123.456.789 09", "CPF 123-456-789-09", "CPF 123_456_789_09", "CPF 123.456.789/09", "CPF 123.\n456.789-09",
      "CNPJ 12345678/0001-95", "CNPJ 12.345.678.0001-95", "CNPJ 12 345 678 0001 95",
      "Tel (99)991234567", "Tel 99 991 234 567", "Tel 99.99123.4567", "Tel 991234567", "Tel 9 91234567", "Tel 999.123.4567",
      "Tel +55 (99) 99123-4567", "fixo (99) 3523-4567", "id 3523 4567",
      // disfarces: largura total, invisíveis (zero-width, U+FEFF, hífen suave), hífen não separável U+2011
      "CPF １２３．４５６．７８９－０９", "CPF 1234567890９", "CPF 123\u200b456\u200b789\u200b09", "CPF 123\ufeff456789-09", "CPF 1234\u00ad56789-09",
      "CPF 123.456.789\u201109", "Tel ＋５５９９９９１２３４５６７", "Tel 99\u200d991234567",
    ];
    for (const c of casos) {
      const r = sanitizarTexto(c);
      expect(r, c).toContain(OMITIDO_T);
      expect(r.replace(/\D/g, "").length, `${c} → ${r}`).toBeLessThan(3);
    }
    for (const c of ["fulano @ gmail.com", "fulano[at]gmail.com", "fulano (arroba) gmail.com", "fulano＠gmail.com", "ful\u200bano@gmail.com", "fulano@gmail"])
      expect(sanitizarTexto(`mail ${c}`), c).toBe(`mail ${OMITIDO_T}`);
    // o espaço antes do parêntese do DDD fica
    expect(sanitizarTexto("Tel (99) 99123-4567")).toBe(`Tel ${OMITIDO_T}`);
  });

  it("QA r2 N7: anos, lotes, quadras, nota fiscal, área e valores não viram dado pessoal; celular plausível sai mesmo com rótulo", () => {
    for (const t of [
      "2024-2026", "Período 2024-2026", "Período 2024–2026", "anos 2024 2025", "lotes 1201 1202", "lotes 1201 1202 1203", "quadras 1500-2000",
      "Nota fiscal 1234567890", "Área 12345678901 cm²", "área de 12345678901 m²", "Valor 1234567890 centavos", "R$ 999.123.456,00",
      "Unidades 4.000 5.000", "Contrato 2026/000123", "Pedido wa:1234 5678", "Hora 10:30-11:45", "CEP 65900000", "Matrícula 123456789012",
      "Inscrição imobiliária 1234567890123", "Protocolo 20261116123", "família 👨\u200d👩\u200d👧 em 2026",
    ]) expect(sanitizarTexto(t), t).toBe(t);
    // [AUTO-DECISION] 99991234567 é um celular perfeito do DDD 99 (a própria região): com rótulo de documento continua
    // saindo (igual a "protocolo 99991234567" da etapa 1). Na dúvida entre vazar e mascarar, mascara.
    expect(sanitizarTexto("Guia 99991234567")).toBe(`Guia ${OMITIDO_T}`);
    // CPF válido sai mesmo depois de rótulo de documento; CPF inválido em 3-3-3-2 com espaços fica (lista de números)
    expect(sanitizarTexto("Protocolo 123.456.789 09")).toBe(`Protocolo ${OMITIDO_T}`);
    expect(sanitizarTexto("lista 123 456 789 00")).toBe("lista 123 456 789 00");
  });

  it("QA r3 R1: casa, apartamento, unidade, valor, total, ano e pedido não livram telefone; palavra de telefone antes, nada livra", () => {
    for (const c of [
      "fone casa 3523-4567", "tel casa 9935234567", "casa 9123-4567", "Recado: ligar na casa 3523-4567", "unidade 3523 4567",
      "valor: 3523 4567", "apartamento 3523-4567", "total 3523 4567", "ano 3523-4567", "pedido 3523 4567",
      "lote 9123-4567", "protocolo 8123 4567", "fone 35234567", "telefone do protocolo 3523-4567", "whats lote 3523-4567",
      "ligar 3523-4567 m²", "contato: (99) 3523-4567", "tel 2024-2025",
    ]) {
      const r = sanitizarTexto(c);
      expect(r, c).toContain(OMITIDO_T);
      expect(r.replace(/\D/g, "").length, `${c} → ${r}`).toBeLessThan(4);
    }
    // rótulo de documento sem palavra de telefone continua livrando o fixo (2–5); anos e lotes de 4 dígitos ficam
    for (const t of ["protocolo 3523-4567", "Nota fiscal 1234567890", "lotes 1201 1202", "Período 2024-2026", "quadra 3523 4567",
      "Pedido wa:1234 5678", "15/11/2026 às 10:30", "boleto 3523 4567"]) expect(sanitizarTexto(t), t).toBe(t);
  });

  it("QA r3 R2: celular seguido de vírgula e dígito sai; valor com centavos fica", () => {
    expect(sanitizarTexto("tels 99991234567,99987654321")).toBe(`tels ${OMITIDO_T},${OMITIDO_T}`);
    expect(sanitizarTexto("tel (99) 99123-4567,1")).toBe(`tel ${OMITIDO_T},1`);
    expect(sanitizarTexto("fone 99991234567,5")).toBe(`fone ${OMITIDO_T},5`);
    for (const t of ["R$ 999.123.456,00", "R$ 99991234567,50", "total 999.123.456,7", "R$ 3.523.456,78"]) expect(sanitizarTexto(t), t).toBe(t);
  });

  it("QA r3 R4: 200 kB patológicos (só dígitos, '12.' repetido, 'aaa…a1', '1 ' repetido) filtram em tempo linear", () => {
    const KB = 1024;
    for (const [nome, t] of [
      ["só dígitos", "1".repeat(200 * KB)], ["12.12.…", "12.".repeat(68 * KB)], ["aaa…a1", "a".repeat(200 * KB) + "1"],
      ["1 1 1…", "1 ".repeat(100 * KB)], ["a.a.a…1", "a.".repeat(100 * KB) + "1"],
    ] as const) {
      const inicio = performance.now();
      const r = sanitizarTexto(t);
      const ms = performance.now() - inicio;
      expect(r, nome).toBe(t);
      expect(ms, `${nome}: ${ms.toFixed(0)} ms`).toBeLessThan(3000);
    }
    // a âncora não muda o que é e-mail
    expect(sanitizarTexto("mail joão.silva+obra@x.com.br e (fulano@y.com)")).toBe(`mail joã${OMITIDO_T} e (${OMITIDO_T})`);
  });

  it("percorre a resposta inteira (listas e objetos), sem tocar números e chaves", () => {
    expect(sanitizarResposta({ a: [{ texto: "cpf 111.222.333-44", n: 11122233344 }], "111.222.333-44": null }))
      .toEqual({ a: [{ texto: "cpf [dado pessoal omitido]", n: 11122233344 }], "111.222.333-44": null });
  });
});
