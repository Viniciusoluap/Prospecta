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
      // QA r4 S4: "valor: 3523 4567" e "total 3523 4567" saíram desta lista (rótulo de valor livra o par 4-4 de 2–5, sem
      // palavra de telefone); com 6–9 continuam saindo
      "valor: 9123 4567", "apartamento 3523-4567", "total 9123 4567", "ano 3523-4567", "pedido 3523 4567", "valor: fone 3523 4567",
      "lote 9123-4567", "protocolo 8123 4567", "fone 35234567", "telefone do protocolo 3523-4567", "whats lote 3523-4567",
      "ligar 3523-4567 m²", "contato: (99) 3523-4567", "tel 2024-2025",
    ]) {
      const r = sanitizarTexto(c);
      expect(r, c).toContain(OMITIDO_T);
      expect(r.replace(/\D/g, "").length, `${c} → ${r}`).toBeLessThan(4);
    }
    // rótulo de documento sem palavra de telefone continua livrando o fixo (2–5); anos e lotes de 4 dígitos ficam
    for (const t of ["protocolo 3523-4567", "Nota fiscal 1234567890", "lotes 1201 1202", "Período 2024-2026", "quadra 3523 4567",
      "valor: 3523 4567", "total 3523 4567",
      "Pedido wa:1234 5678", "15/11/2026 às 10:30", "boleto 3523 4567"]) expect(sanitizarTexto(t), t).toBe(t);
  });

  it("QA r3 R2: celular seguido de vírgula e dígito sai; valor com centavos fica", () => {
    expect(sanitizarTexto("tels 99991234567,99987654321")).toBe(`tels ${OMITIDO_T},${OMITIDO_T}`);
    expect(sanitizarTexto("tel (99) 99123-4567,1")).toBe(`tel ${OMITIDO_T},1`);
    expect(sanitizarTexto("fone 99991234567,5")).toBe(`fone ${OMITIDO_T},5`);
    for (const t of ["R$ 999.123.456,00", "R$ 99991234567,50", "total 999.123.456,7", "R$ 3.523.456,78"]) expect(sanitizarTexto(t), t).toBe(t);
  });

  it("QA r3 R3: CPF e celular depois de muitos números soltos na mesma cadeia saem (janela deslizante, sem corte)", () => {
    for (const n of [14, 15, 16, 17, 31, 40]) {
      const prefixo = "1 ".repeat(n);
      expect(sanitizarTexto(`${prefixo}529 982 247 25`), `${n}`).toBe(`${prefixo}${OMITIDO_T}`);
      expect(sanitizarTexto(`${prefixo}99 99123 4567`), `${n}`).toBe(`${prefixo}${OMITIDO_T}`);
    }
    const lista = "1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20";
    expect(sanitizarTexto(lista)).toBe(lista);
  });

  it("QA r3 (informativos): dígitos de outras escritas, '|' e '/' no telefone com palavra de telefone, chave de NF-e tudo ou nada", () => {
    for (const c of ["cpf ٥٢٩٩٨٢٢٤٧٢٥", "tel ९९९९१२३४५६७", "cpf ۵۲۹۹۸۲۲۴۷۲۵", "tel 99|99123|4567", "tel 99/99123-4567", "tel 99 99123/4567",
      "fone: 99 | 3523 | 4567", "fone 9912345678", "tel 9 9 1 2 3 4 5 6 7"]) {
      const r = sanitizarTexto(c);
      expect(r, c).toContain(OMITIDO_T);
      expect(r.replace(/\D/g, "").length, `${c} → ${r}`).toBeLessThan(3);
    }
    // sem palavra de telefone, datas e tabelas com "/" e "|" ficam; célula isolada de 11 dígitos continua "na dúvida, sai"
    for (const t of ["em 15/11/2026", "protocolo 2026/123456", "ligar em 15/11/2026", "ligar dia 15-11-2026", "| 3500 | 4200 |", "| 2024 | 2025 |", "| lote 12 | 360 m² |"])
      expect(sanitizarTexto(t), t).toBe(t);
    expect(sanitizarTexto("| 12345678901 | 2 |")).toBe(`| ${OMITIDO_T} | 2 |`);
    // chave de acesso: QA r4 S1 — só a ESTRUTURA validada por inteiro (DV, UF, mês, CNPJ do emitente, modelo) a deixa
    // inteira; o rótulo sozinho não isenta. A chave antiga deste teste tinha CNPJ inválido (12345678000199): trocada.
    const blocos = (d: string) => d.match(/\d{4}/g)!.join(" ");
    const VALIDA = "35261112345678000195550010000012341000012346", INVALIDA = "35261112345678000195550010000012341000012345";
    for (const t of [
      `chave de acesso ${blocos(VALIDA)}`, `DANFE ${blocos(VALIDA)}`, `ver ${blocos(VALIDA)}`, `NF-e ${INVALIDA}`,
    ]) expect(sanitizarTexto(t), t).toBe(t);
    expect(sanitizarTexto(`ver ${blocos(INVALIDA)}`)).toBe(`ver ${OMITIDO_T}`);
    expect(sanitizarTexto(`chave de acesso ${blocos(INVALIDA)}`)).toBe(`chave de acesso ${OMITIDO_T}`);
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

  it("QA r4 S1: rótulo de nota/chave/acesso/DANFE/NF-e nunca livra CPF nem celular, mesmo somando 44 dígitos", () => {
    const cpfs = ["52998224725", "11144477735", "12345678909", "98765432100"];
    const cels = ["99991234567", "99987654321", "99912345678", "99911112222"];
    // "Contatos …": lista de 4 celulares cuja junção fecha o DV de módulo 11 por acaso (achada pela sonda do QA)
    const casos = [
      `Nota: CPFs dos compradores ${cpfs.join(" ")}`, `Nota do corretor:\n${cpfs.join("\n")}`, `Acesso liberado para ${cpfs.join(" ")}`,
      `DANFE ${cpfs.join(" ")}`, `chave ${cpfs.join(".")}`, `NF-e ${cels[0]} ${cpfs[0]} ${cels[1]} ${cpfs[1]}`,
      `nota: ligar ${cels.join(" ")}`, `Nota - whatsapp dos sócios: ${cels.join(" ")}`, "Contatos 99991234567 99987654321 99912345678 99980000000",
      `chave de acesso ${cpfs.join(" ")}`, "nota 52998224725 0000 0000 0000 0000 0000 0000 000",
    ];
    for (const c of casos) {
      const r = sanitizarTexto(c);
      for (const n of [...cpfs, ...cels, "99980000000"]) expect(r, `${c} → ${r}`).not.toContain(n);
      expect(r, c).toContain(OMITIDO_T);
    }
    // lista de 4 itens sai item por item (a linha continua legível)
    expect(sanitizarTexto(`Nota do corretor:\n${cpfs.join("\n")}`)).toBe(`Nota do corretor:\n${Array(4).fill(OMITIDO_T).join("\n")}`);
  });

  it("QA r4 S2: linha digitável com os 3 DVs de campo válidos fica inteira; sem validar, vale a fase 1", () => {
    for (const t of [
      "linha digitável 23793.38128 60000.000004 00000.000406 1 84340000010000", // Bradesco (237), 1º campo com cara de celular
      "boleto 75690.00016 99123.456784 99000.000002 7 84340000010000", // Sicoob (756), campos 2 e 3 começando com 99
      "boleto 74891.12347 99123.456784 99000.000002 7 84340000010000", // Sicredi (748)
      "pagar 2379338128 60000000004 00000000406 1 84340000010000", "boleto 34191.79001 01043.510047 91020.150008 1 96610000012345",
    ]) expect(sanitizarTexto(t), t).toBe(t);
    // DV de campo errado (o exemplo do relatório tem os campos 2 e 3 inválidos): a fase 1 continua valendo
    expect(sanitizarTexto("linha 23793.38128 60000.000003 00000.000400 1 84340000010000")).toContain(OMITIDO_T);
    // celular de verdade colado depois da linha digitável válida continua saindo
    expect(sanitizarTexto("boleto 75690.00016 99123.456784 99000.000002 7 84340000010000 99991234567"))
      .toBe(`boleto 75690.00016 99123.456784 99000.000002 7 84340000010000 ${OMITIDO_T}`);
  });

  it("QA r4 S3: dados bancários e janelas de dígitos em 200 kB patológicos ficam em tempo linear (limite 3 s cada)", () => {
    const N = 200 * 1024;
    const enche = (p: string) => p.repeat(Math.ceil(N / p.length)).slice(0, N);
    const casos: Array<[string, string]> = [
      ["ag-…ag- at", `${enche("ag-")} at`], ["conta-…conta- arroba", `${enche("conta-")} arroba`], ["1‑", enche("1\u2011")],
      ["٩ ", enche("\u0669 ")], ["1 ", enche("1 ")], ["9 ", enche("9 ")], ["99 ", enche("99 ")], ["9|", enche("9|")], ["1|", enche("1|")],
      ["| 1 ", enche("| 1 ")], ["código ", enche("código ")], ["pix 1 ", enche("pix 1 ")], ["a arroba ", enche("a arroba ")],
      ["a @ ", enche("a @ ")], ["a ponto ", `x arroba ${enche("a ponto ")}`], ["1234 ", enche("1234 ")], ["conta 1", enche("conta 1")],
    ];
    for (const [nome, t] of casos) {
      const inicio = performance.now();
      sanitizarTexto(t);
      const ms = performance.now() - inicio;
      expect(ms, `${nome}: ${ms.toFixed(0)} ms`).toBeLessThan(3000);
    }
  });

  it("QA r4 S4: par 4-4 de 2–5 com rótulo de quantidade/valor/faixa/lote ou faixa crescente fica; 6–9 e palavra de telefone saem", () => {
    for (const t of [
      "faixa de renda 4000-5000", "renda 4000 - 6000", "orçamento 2500-3000", "estoque: 3500 4200", "valores 3500 4200 5100",
      "lotes 3201 3202 3203", "quadras 2301 2302 2303", "valor 3523 4567", "total 3523 4567", "R$ 3523 4567", "parcelas de 2500 3000",
      "total 2500 3000", "IPTU 3523 4567 0001", "inscrição municipal 3523 4567", "entre 2500-3000 por mês",
    ]) expect(sanitizarTexto(t), t).toBe(t);
    for (const c of [
      // R1 continua: palavra de telefone antes, nada livra
      "tel casa 3523-4567", "fone casa 3523-4567", "casa 9123-4567", "Recado: ligar na casa 3523-4567", "valor do fone 3523 4567",
      "contato: total 3523 4567", "whats lotes 3201 3202",
      // 6–9 é celular antigo: sai sempre, com qualquer rótulo
      "lotes 7001 7002", "R$ 9123 4567", "quantidade 9123 4567", "itens 6000 7000",
      // 2–5 sem rótulo claro continua saindo (casa, apartamento, unidade não são quantidade); faixa decrescente também
      "unidade 3523 4567", "apartamento 3523-4567", "casa 3523-4567", "ref 3000-2500", "id 3523 4567",
    ]) {
      const r = sanitizarTexto(c);
      expect(r, c).toContain(OMITIDO_T);
    }
  });

  it("QA r4 S5: valor depois de pix, 'cc 2 cópias', 'conta 2026' e 'código' sem palavra de senha ficam; chave e conta de verdade saem", () => {
    for (const t of [
      "pagou via pix 1.500,00", "pix 350,00", "pix R$ 1.200,00", "pix 12.500.000,00", "pix de 12 parcelas", "cc 2 cópias", "conta 2026",
      "conta de luz 152,30", "conta 1.500,00", "código do imóvel 12345", "código de barras 34196966100000123451790001043510047910201500",
      "código do cliente 778", "ag. 15/11 às 10h",
    ]) expect(sanitizarTexto(t), t).toBe(t);
    const B = "[dado bancário omitido]", S = "[senha omitida]";
    expect(sanitizarTexto("chave pix 99991234567")).toBe(`chave pix ${B}`);
    expect(sanitizarTexto("pix: 529.982.247-25")).toBe(`pix: ${B}`);
    expect(sanitizarTexto("pix (99) 99123-4567, obrigado")).toBe(`pix ${B}, obrigado`);
    expect(sanitizarTexto("pix 123e4567-e89b-12d3-a456-426614174000")).toBe(`pix ${B}`);
    expect(sanitizarTexto("pix fulano@x.com")).toBe(`pix ${B}`);
    expect(sanitizarTexto("conta 12345-6, agência 0001.")).toBe(`conta ${B}, agência ${B}.`);
    expect(sanitizarTexto("conta corrente nº 98765-X")).toBe(`conta corrente nº ${B}`);
    expect(sanitizarTexto("código de acesso 4321")).toBe(`código ${S}`);
    expect(sanitizarTexto("token: código 998877")).toBe(`token ${S}`);
    expect(sanitizarTexto("acesso ao app: código 112233")).toBe(`acesso ao app: código ${S}`);
    expect(sanitizarTexto("código OTP 445566")).toBe(`código ${S}`);
    // "código" sem contexto não engole a oração: a senha mais adiante ainda sai
    const longe = "código do imóvel 12345 fica na pasta azul do escritório e a senha do portal é abc123";
    expect(sanitizarTexto(longe)).toBe("código do imóvel 12345 fica na pasta azul do escritório e a senha " + S);
  });

  it("QA r4 S6: separadores '·', '•', ':', muitos espaços, '529982247,25' e e-mail por extenso saem", () => {
    for (const c of ["cpf 529·982·247·25", "cpf 529•982•247•25", "cpf 529:982:247:25", "cpf 529982247    25", "cpf 529982247,25",
      "tel 99 99123  –  4567", "tel 99    99123    4567", "tel 𞥙𞥙𞥙𞥙𞥑𞥒𞥓𞥔𞥕𞥖𞥗", "tel ⁹⁹⁹⁹¹²³⁴⁵⁶⁷", "cpf ⑤②⑨⑨⑧②②④⑦②⑤"]) {
      const r = sanitizarTexto(c);
      expect(r, c).toContain(OMITIDO_T);
      expect(r.replace(/\D/g, "").length, `${c} → ${r}`).toBeLessThan(3);
    }
    for (const c of ["fulano @ gmail . com", "fulano arroba gmail ponto com", "fulano(at)gmail(dot)com", "fulano [at] gmail [dot] com",
      "fulano @ empresa . com . br", "fulano at gmail dot com"]) expect(sanitizarTexto(`mail ${c}`), c).toBe(`mail ${OMITIDO_T}`);
    // sem domínio de topo conhecido, "arroba"/"ponto" por extenso ficam; valor com vírgula e CPF inválido ficam; horário fica
    for (const t of ["15 arroba de boi, ponto final", "R$ 529982247,25", "total 123456789,00", "Hora 10:30-11:45", "das 08:00 às 12:00",
      "área 360 m² e 12 m³", "x² + y² = 3²"])
      expect(sanitizarTexto(t), t).toBe(t);
  });

  it("QA r5 F1: lista de telefones/CPFs que fecha os DVs de NF-e ou boleto por acaso sai; só a forma escrita do documento isenta", () => {
    const vazamentos = [
      "Contatos dos compradores:\n(15) 95115-9890\n(46) 95244-2055\n(41) 99507-5904\n(66) 95430-3390",
      "15 95115 9890 46 95244 2055 41 99507 5904 66 95430 3390",
      "fones 1133546679 11957754580 21966458941 1 41739079897597",
      "1133546679 11957754580 21966458941 1 41739079897597",
    ];
    for (const c of vazamentos) {
      const r = sanitizarTexto(c);
      for (const n of ["95115", "95244", "99507", "95430", "1133546679", "11957754580", "21966458941"])
        expect(r, `${c} → ${r}`).not.toContain(n);
      expect(r, c).toContain(OMITIDO_T);
    }
    // a mesma chave válida: 11×4 com " " ou "." uniforme fica; separadores misturados ou palavra de telefone antes, não
    const VALIDA = "35261112345678000195550010000012341000012346";
    const b4 = VALIDA.match(/\d{4}/g)!;
    for (const t of [`DANFE ${b4.join(" ")}`, `chave ${b4.join(".")}`, `chave ${VALIDA}`]) expect(sanitizarTexto(t), t).toBe(t);
    for (const t of [`chave ${b4.slice(0, 5).join(" ")}.${b4.slice(5).join(" ")}`, `contato ${b4.join(" ")}`, `cpf ${b4.join(" ")}`])
      expect(sanitizarTexto(t), t).not.toBe(t);
    // 10 11 11 1 14 sem o DV geral fecha (mesmos campos do teste S2 com o 5º dígito trocado) sai; com o DV geral, fica
    expect(sanitizarTexto("pagar 2379338128 60000000004 00000000406 2 84340000010000")).toContain(OMITIDO_T);
    expect(sanitizarTexto("pagar 2379338128 60000000004 00000000406 1 84340000010000")).toBe("pagar 2379338128 60000000004 00000000406 1 84340000010000");
  });

  it("QA r5 F2: guia de arrecadação de 48 dígitos (4 blocos de 11 + DV válido) fica inteira; DV errado ou palavra de telefone, não", () => {
    const mod10 = (b: string) => { let t = 0, p = 2; for (let k = b.length - 1; k >= 0; k--) { const v = Number(b[k]) * p; t += v > 9 ? v - 9 : v; p = p === 2 ? 1 : 2; } return (10 - (t % 10)) % 10; };
    const mod11 = (b: string) => { let t = 0, p = 2; for (let k = b.length - 1; k >= 0; k--) { t += Number(b[k]) * p; p = p === 9 ? 2 : p + 1; } const r = t % 11; return r < 2 ? 0 : 11 - r; };
    let semente = 7;
    const dig = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return Math.floor(semente / 2147483648 * 10); };
    for (let k = 0; k < 400; k++) {
      const terceiro = "6789"[k % 4];
      const base = "8" + String(1 + (k % 8)) + terceiro + Array.from({ length: 41 }, dig).join("");
      const blocos = base.match(/.{11}/g)!;
      const dvDe = terceiro === "6" || terceiro === "7" ? mod10 : mod11;
      const formas = [
        `IPTU ${blocos.map(x => `${x}-${dvDe(x)}`).join(" ")}`, `conta de água ${blocos.map(x => `${x} ${dvDe(x)}`).join(" ")}`,
        `luz ${blocos.map(x => x + dvDe(x)).join(" ")}`, `taxa ${blocos.map(x => x + dvDe(x)).join("")}`,
      ];
      for (const t of formas) expect(sanitizarTexto(t), t).toBe(t);
    }
    // a guia do relatório (3º dígito 2: não é guia) e uma guia com DV errado continuam valendo a fase 1 quando há algo dentro
    const errada = "IPTU 81257550349-3 79907473112-3 00000000000-0 00000000000-0";
    expect(sanitizarTexto(errada)).not.toBe(errada);
    // palavra de telefone antes: nunca isenta
    const b = "81690000000";
    const comFone = `fone ${[b, "99991234567", "00000000000", "00000000000"].map(x => `${x}-${mod10(x)}`).join(" ")}`;
    expect(sanitizarTexto(`taxa ${comFone.slice(5)}`)).toBe(`taxa ${comFone.slice(5)}`);
    expect(sanitizarTexto(comFone)).not.toContain("99991234567");
  });

  it("QA r5 F3: rótulo de documento/quantidade antes não livra o fixo com palavra de telefone DEPOIS", () => {
    for (const c of ["protocolo 3523-4567 fone", "matrícula 3523-4567 - ligar", "valor 3523 4567 (fone)", "total 3523-4567 telefone residencial",
      "quadra 3523-4567 tel", "area 3523-4567 fone", "protocolo 3523-4567 (telefone da vizinha)", "lote 12: 3523-4567 é o fone"]) {
      const r = sanitizarTexto(c);
      expect(r, `${c} → ${r}`).not.toMatch(/3523|4567/);
    }
    // sem palavra de telefone depois (ou só na linha seguinte), o rótulo continua livrando
    for (const t of ["protocolo 3523-4567", "valor 3523 4567", "lote 3523-4567 vendido", "quadra 3523-4567\nfone: ver cadastro"])
      expect(sanitizarTexto(t), t).toBe(t);
  });

  it("QA r5 F4: a janela que começa antes não deixa a cauda do número à vista; a data fica e o telefone sai inteiro", () => {
    expect(sanitizarTexto("dia 15/11/2026 9123-4567")).toBe(`dia 15/11/2026 ${OMITIDO_T}`);
    expect(sanitizarTexto("em 2026 9123-4567")).toBe(`em 2026 ${OMITIDO_T}`);
    expect(sanitizarTexto("em 2026 3523-4567")).toBe(`em 2026 ${OMITIDO_T}`);
    expect(sanitizarTexto("15/11/2026 99123-4567")).toBe(`15/11/2026 ${OMITIDO_T}`);
    for (const c of ["12 74677693/2903-31", "lote 12 9123-4567", "processo 2026 99123-4567", "n 12 99123 4567", "das 10:30 9123-4567"]) {
      const r = sanitizarTexto(c);
      expect(r, c).toContain(OMITIDO_T);
      expect(r, `${c} → ${r}`).not.toMatch(/4567|2903|74677693/);
    }
  });

  it("percorre a resposta inteira (listas e objetos), sem tocar números e chaves", () => {
    expect(sanitizarResposta({ a: [{ texto: "cpf 111.222.333-44", n: 11122233344 }], "111.222.333-44": null }))
      .toEqual({ a: [{ texto: "cpf [dado pessoal omitido]", n: 11122233344 }], "111.222.333-44": null });
  });
});
