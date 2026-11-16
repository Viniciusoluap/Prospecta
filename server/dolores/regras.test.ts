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
    // QA r6 (A): e a estrutura sozinha também não — sem rótulo ("ver …") a chave válida sai inteira (estrago aceito).
    const blocos = (d: string) => d.match(/\d{4}/g)!.join(" ");
    const VALIDA = "35261112345678000195550010000012341000012346", INVALIDA = "35261112345678000195550010000012341000012345";
    for (const t of [
      `chave de acesso ${blocos(VALIDA)}`, `DANFE ${blocos(VALIDA)}`, `NF-e ${INVALIDA}`,
    ]) expect(sanitizarTexto(t), t).toBe(t);
    expect(sanitizarTexto(`ver ${blocos(VALIDA)}`)).toBe(`ver ${OMITIDO_T}`);
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
    expect(sanitizarTexto("mail joão.silva+obra@x.com.br e (fulano@y.com)")).toBe(`mail ${OMITIDO_T} e (${OMITIDO_T})`); // QA r5 F6: nome acentuado sai inteiro
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
      "boleto 74891.12347 99123.456784 99000.000002 6 84340000010000", // Sicredi (748)
      // QA r6 (A): o DV geral passou a ser exigido em todas as formas (os dois exemplos acima tinham o DV geral inventado)
      "boleto 2379338128 60000000004 00000000406 1 84340000010000", "boleto 34191.79001 01043.510047 91020.150008 7 96610000012345",
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
    // QA r5 F5: CPF/celular depois de "pix" saem pela fase 1 (antes de PIX e banco), com o marcador de dado pessoal
    expect(sanitizarTexto("chave pix 99991234567")).toBe(`chave pix ${OMITIDO_T}`);
    expect(sanitizarTexto("pix: 529.982.247-25")).toBe(`pix: ${OMITIDO_T}`);
    expect(sanitizarTexto("pix (99) 99123-4567, obrigado")).toBe(`pix ${OMITIDO_T}, obrigado`);
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
    // sonda dirigida do QA: telefones que fecham os 3 DVs, a moeda e até o DV geral — campos 2/3 com forma de celular, sai
    for (const t of ["1139673097 11973631135 21970260937 1 57894337179272", "1139301871 11940957555 21948385790 1 90128806324772"]) {
      const r = sanitizarTexto(t);
      for (const n of ["1139673097", "11973631135", "21970260937", "1139301871", "11940957555", "21948385790"]) expect(r, `${t} → ${r}`).not.toContain(n);
    }
    expect(sanitizarTexto("boleto 2379338128 60000000004 00000000406 1 84340000010000")).toBe("boleto 2379338128 60000000004 00000000406 1 84340000010000");
    // QA r6 (A): sem rótulo de boleto ("pagar") não há isenção — o campo 1, com forma de celular, sai
    expect(sanitizarTexto("pagar 2379338128 60000000004 00000000406 1 84340000010000")).toContain(OMITIDO_T);
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
      // QA r6 (A): rótulo de guia + forma (hífen antes do DV, 12×4 ou 48, numa linha) + estrutura — as três
      const formas = [
        `IPTU ${blocos.map(x => `${x}-${dvDe(x)}`).join(" ")}`, `conta de água ${blocos.map(x => `${x} - ${dvDe(x)}`).join("  ")}`,
        `conta de luz ${blocos.map(x => x + dvDe(x)).join(" ")}`, `fatura ${blocos.map(x => x + dvDe(x)).join("")}`,
        `DARF\n${blocos.map(x => `${x}-${dvDe(x)}`).join(" ")}`,
      ];
      for (const t of formas) expect(sanitizarTexto(t), t).toBe(t);
    }
    // a guia do relatório (3º dígito 2: não é guia) e uma guia com DV errado continuam valendo a fase 1 quando há algo dentro
    const errada = "IPTU 81257550349-3 79907473112-3 00000000000-0 00000000000-0";
    expect(sanitizarTexto(errada)).not.toBe(errada);
    // palavra de telefone antes: nunca isenta
    const b = "81690000000";
    const comFone = `fone ${[b, "99991234567", "00000000000", "00000000000"].map(x => `${x}-${mod10(x)}`).join(" ")}`;
    expect(sanitizarTexto(`IPTU ${comFone.slice(5)}`)).toBe(`IPTU ${comFone.slice(5)}`);
    // QA r6 (A): sem rótulo de guia, com espaço/ponto no lugar do hífen do DV ou com quebra de linha entre os blocos, não isenta
    const semIsencao = [`taxa ${comFone.slice(5)}`, `IPTU ${comFone.slice(5).replace(/-/g, " ")}`, `IPTU ${comFone.slice(5).replace(/-/g, ".")}`,
      `IPTU ${comFone.slice(5).replace(/ /g, "\n")}`];
    for (const t of semIsencao) expect(sanitizarTexto(t), t).not.toContain("99991234567");
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

  it("QA r5 F5: CPF/CNPJ válido em qualquer separação depois de conta/cc/ag sai inteiro (a fase 1 vem antes do banco)", () => {
    for (const c of ["conta 529 982 247 25", "cc 529 982 247 25", "ag 529982247 25", "c/c 529.982 247-25", "conta corrente 11 222 333 0001 81"]) {
      const r = sanitizarTexto(c);
      expect(r, c).toContain(OMITIDO_T);
      expect(r.replace(/\D/g, "").length, `${c} → ${r}`).toBe(0);
    }
    // conta de verdade continua com o marcador bancário; número de conta antes do CPF também sai (fuzz do QA)
    expect(sanitizarTexto("conta 12345-6")).toBe("conta [dado bancário omitido]");
    for (const c of ["cc 2026.12/889 767 151 95 - 2026", "ag 81008/93 709 988 4295 73", "conta 15/11/2026.177 269 190 94",
      "pix 100    3    15/11/2026 - 74.178.759/7868-08 fone", "conta 3.55 306 071 6942 83 - 2026"]) {
      const r = sanitizarTexto(c);
      for (const n of ["767 151", "709 988", "269 190", "759/7868", "306 071", "4295", "6942"]) expect(r, `${c} → ${r}`).not.toContain(n);
    }
  });

  it("QA r5 F6/F7: e-mail com nome acentuado sai inteiro; '(dot)com_' e CPF com zeros à esquerda saem", () => {
    for (const c of ["maria.conceição@uol.com.br", "silva.joão@gmail.com", "joão@gmail.com", "josé.da.silva@empresa.com", "joão @ gmail . com",
      "conceição(at)gmail(dot)com", "fulano(at)gmail(dot)com_", "joão@gmail"]) {
      const r = sanitizarTexto(`mail ${c}`);
      expect(r, `${c} → ${r}`).toMatch(new RegExp(`^mail \\[dado pessoal omitido\\]_?$`));
    }
    for (const c of ["cpf 052998224725", "cpf 00052998224725"]) expect(sanitizarTexto(c), c).toBe(`cpf ${OMITIDO_T}`);
    for (const t of ["ação@", "café com leite", "a arroba de café, ponto", "protocolo 012345678901"]) expect(sanitizarTexto(t), t).toBe(t);
  });

  it("QA r6 N1: fixo antes da janela de dentro continua sendo achado (listas de telefones de 8 dígitos)", () => {
    for (const c of ["fone 3523 4567 9123 4567", "fones 3523-4567 3344-5566 9123-4567", "lote 12 3523 4567 9123 4567",
      "fones 2814 1021 2752 2541 9164 6526", "fone 3523 4567 3344 5566 9123 4567", "dia 15/11/2026 3523 4567 9123 4567",
      "vizinhos: 4324 2019  9911 1390  6559 3556  4467 1344", "fones 5360 4302 - 4648 9235 - 4402 4688"]) {
      const r = sanitizarTexto(c);
      for (const n of ["3523 4567", "3523-4567", "3344-5566", "3344 5566", "2814 1021", "2752 2541", "4324 2019", "5360 4302", "4648 9235", "4402 4688"])
        expect(r, `${c} → ${r}`).not.toContain(n);
    }
    // a data e o ano antes continuam à vista
    expect(sanitizarTexto("dia 15/11/2026 3523 4567 9123 4567")).toBe(`dia 15/11/2026 ${OMITIDO_T} ${OMITIDO_T}`);
    expect(sanitizarTexto("2026 3523 4567 9123 4567")).toBe(`2026 ${OMITIDO_T} ${OMITIDO_T}`);
  });

  it("QA r6 N2–N5: documento só fica com rótulo + forma + estrutura; listas de celulares/CPFs/telefones nunca", () => {
    const n2 = ["Compradores:\n81999960283 9\n11693973103 0\n83982671550 4\n07725071202 2", "81999960283 9 11693973103 0 83982671550 4 07725071202 2",
      "IPTU 81999960283 9 11693973103 0 83982671550 4 07725071202 2", "IPTU 81999960283.9 11693973103.0 83982671550.4 07725071202.2"];
    for (const c of n2) {
      const r = sanitizarTexto(c);
      for (const n of ["81999960283", "11693973103", "83982671550", "07725071202"]) expect(r, `${c} → ${r}`).not.toContain(n);
    }
    // N3: boleto "10 11 11 1 14" com 0+DDD+fixo nos campos 2/3 e CNPJ no campo 5 — com ou sem rótulo
    for (const c of ["6229171407 09345860911 08251955996 1 35589990059108", "boleto 6229171407 09345860911 08251955996 1 35589990059108",
      "Contatos 6229171407 09345860911 08251955996 1 35589990059108"]) {
      const r = sanitizarTexto(c);
      for (const n of ["09345860911", "08251955996", "35589990059108"]) expect(r, `${c} → ${r}`).not.toContain(n);
    }
    // N4: sem rótulo de NF-e, "Vizinhos: …" segue a fase 1/2b — o celular 9164 6526 e os fixos saem
    const viz = sanitizarTexto("Vizinhos: 2814 1021 2752 2541 9164 6526 2484 2059 2135 4620 6045 7581");
    expect(viz).not.toMatch(/9164|6526|2814 1021/);
    // N5: linha digitável pontuada quebrada em 2 linhas e chave 11×4 com 2 espaços, com rótulo, ficam
    for (const t of ["boleto 23793.38128 60000.000004\n00000.000406 1 84340000010000", "linha digitável:\n23793.38128 60000.000004 00000.000406\n1 84340000010000",
      "chave de acesso 3526  1112  3456  7800  0195  5500  1000  0012  3410  0001  2346", "NF-e 3526   1112   3456   7800   0195   5500   1000   0012   3410   0001   2346"])
      expect(sanitizarTexto(t), t).toBe(t);
    // ...mas não duas quebras de linha, nem a forma sem pontos em 2 linhas, nem chave com separadores misturados
    for (const t of ["boleto 23793.38128\n60000.000004\n00000.000406 1 84340000010000", "boleto 2379338128 60000000004\n00000000406 1 84340000010000",
      "chave 3526 1112  3456 7800 0195 5500 1000 0012 3410 0001 2346"]) expect(sanitizarTexto(t), t).not.toBe(t);
    // ano fora do plausível ou UF fora da lista do IBGE: a chave (DV certo) não isenta
    const dv = (d43: string) => { let t = 0, p = 2; for (let k = 42; k >= 0; k--) { t += Number(d43[k]) * p; p = p === 9 ? 2 : p + 1; } const r = t % 11; return d43 + (r < 2 ? 0 : 11 - r); };
    for (const chave of [dv("3599111234567800019555001000001234100001234"), dv("1926111234567800019555001000001234100001234")])
      expect(sanitizarTexto(`chave ${chave.match(/\d{4}/g)!.join(" ")}`)).toBe(`chave ${OMITIDO_T}`);
  });

  it("QA r6 F: fuzz determinístico — nenhum celular/CPF/CNPJ inteiro; fixo com palavra de telefone sai; nunca pior que a main", () => {
    // Detecção da main (origin/main, shared/dolores/sanitizar.ts) copiada AQUI, só para comparar — não é código de produção.
    const cnpjOk = (d: string) => {
      if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
      const dvc = (base: string, pesos: number[]) => { const t = pesos.reduce((a, p, i) => a + Number(base[i]) * p, 0) % 11; return t < 2 ? 0 : 11 - t; };
      const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      return dvc(d, p1) === Number(d[12]) && dvc(d, [6, ...p1]) === Number(d[13]);
    };
    const cpfOk = (d: string) => {
      if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
      const dvc = (n: number) => { let t = 0; for (let i = 0; i < n; i++) t += Number(d[i]) * (n + 1 - i); const r = (t * 10) % 11; return r === 10 ? 0 : r; };
      return dvc(9) === Number(d[9]) && dvc(10) === Number(d[10]);
    };
    const daMain = (texto: string): string => {
      if (!texto || !/[\d@]|senha|password|passwd|c[oó]digo|token|\bpin\b/i.test(texto)) return texto;
      return texto
        .replace(/\b(senhas?|password|passwd|c[oó]digos?|token|pin)\b.*?(?=[;\n]|[.,!?](?:\s|$)|$)/gi, (_m, w: string) => `${w} [senha omitida]`)
        .replace(/\b(ag[eê]ncia|ag\.?|conta(?:\s+corrente|\s+poupan[cç]a)?|c\/c|cc|chave\s+pix|pix)\b(\s*(?:n[ºo°.]?|:|#|-)?\s*)((?=[^\s]*[\d@])[\w.@+\-/]+)/gi,
          (_m, r: string, sp: string) => `${r}${sp}[dado bancário omitido]`)
        .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, OMITIDO_T)
        .replace(/(?<!\d)\d{2}\.\d{3}\.\d{3}\/\d{4}-?\d{2}(?!\d)/g, OMITIDO_T)
        .replace(/(?<!\d)\d{3}[.,]\d{3}[.,]\d{3}[-.]?\d{2}(?!\d)/g, OMITIDO_T)
        .replace(/(?<![\d/])\(?\d{2}\)?[\s-]9\d{8}(?![\d/])/g, OMITIDO_T)
        .replace(/(?<![\d/])(?:\+?55[\s-]?)?(?:\(?\d{2}\)?[\s-]?)?9?\d{4}[\s-]\d{4}(?![\d/])/g, OMITIDO_T)
        .replace(/(?<![\d.,/-])\d{10,14}(?![\d.,/-])/g, d => {
          if (d.length === 11) return OMITIDO_T;
          if (d.length === 14) return cnpjOk(d) ? OMITIDO_T : d;
          if (d.length === 10 || ((d.length === 12 || d.length === 13) && d.startsWith("55"))) return OMITIDO_T;
          return cpfOk(d) ? OMITIDO_T : d;
        });
    };
    // semente fixa (determinístico); FUZZ_SEMENTE/FUZZ_CASOS só para rodadas extras à mão
    let semente = Number(process.env.FUZZ_SEMENTE ?? 20261116);
    const TOTAL = Number(process.env.FUZZ_CASOS ?? 50_000);
    const rnd = () => { semente = (semente + 0x6D2B79F5) >>> 0; let t = semente; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const ri = (n: number) => Math.floor(rnd() * n);
    const um = <T,>(xs: readonly T[]) => xs[ri(xs.length)];
    const digs = (n: number) => Array.from({ length: n }, () => ri(10)).join("");
    const ddd = () => String(1 + ri(9)) + String(1 + ri(9));
    const cpf = () => { for (;;) { const b = digs(9); const dvc = (x: string) => { let t = 0; for (let i = 0; i < x.length; i++) t += Number(x[i]) * (x.length + 1 - i); const r = (t * 10) % 11; return r === 10 ? 0 : r; }; const d1 = dvc(b); const c = b + d1 + dvc(b + d1); if (cpfOk(c)) return c; } };
    const cnpj = () => { for (;;) { const b = digs(12); const dvc = (x: string, p: number[]) => { const t = p.reduce((a, q, i) => a + Number(x[i]) * q, 0) % 11; return t < 2 ? 0 : 11 - t; }; const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const d1 = dvc(b, p1); const c = b + d1 + dvc(b + d1, [6, ...p1]); if (cnpjOk(c)) return c; } };
    type Tipo = "cel11" | "cel10" | "cel9" | "cel8" | "fixo8" | "fixo10" | "cpf" | "cnpj";
    const TIPOS: Tipo[] = ["cel11", "cel10", "cel9", "cel8", "fixo8", "fixo10", "cpf", "cnpj"];
    const ROTULOS_TEL = ["fone ", "fones: ", "contatos: ", "tel ", "whats "];
    const ROTULOS = ["", "compradores:\n", "Compradores: ", "vizinhos: ", "lote 12 ", "lote ", "nota ", "chave ", "chave de acesso ", "boleto ", "guia ",
      "IPTU ", "Ref. ", "DANFE ", "linha digitável ", ...ROTULOS_TEL];
    const LIVRA_FIXO = new Set(["lote ", "boleto ", "guia ", "IPTU "]); // fase 2b (r3/r4): rótulo de documento livra o fixo sem palavra de telefone
    // 8 dígitos colados só são telefone com palavra de telefone na mesma linha (o gerador não os põe em outra linha)
    const item = (tipo: Tipo, comTel: boolean): { d: string; txt: string } => {
      const dd = ddd();
      switch (tipo) {
        case "cel11": { const d = dd + "9" + digs(8); return { d, txt: um([d, `(${dd}) 9${d.slice(3, 7)}-${d.slice(7)}`, `${dd} 9${d.slice(3, 7)}-${d.slice(7)}`, `${dd} 9${d.slice(3, 7)} ${d.slice(7)}`, `+55 ${dd} 9${d.slice(3, 7)}-${d.slice(7)}`, `${dd} 9 ${d.slice(3, 7)}-${d.slice(7)}`]) }; }
        case "cel10": { const d = dd + String(6 + ri(4)) + digs(7); return { d, txt: um([d, `(${dd}) ${d.slice(2, 6)}-${d.slice(6)}`, `${dd} ${d.slice(2, 6)}-${d.slice(6)}`]) }; }
        case "cel9": { const d = "9" + digs(8); return { d, txt: um([d, `${d.slice(0, 5)}-${d.slice(5)}`, `${d.slice(0, 5)} ${d.slice(5)}`]) }; }
        case "cel8": case "fixo8": {
          const d = String(tipo === "cel8" ? 6 + ri(4) : 2 + ri(4)) + digs(7);
          return { d, txt: um(comTel ? [d, `${d.slice(0, 4)}-${d.slice(4)}`, `${d.slice(0, 4)} ${d.slice(4)}`] : [`${d.slice(0, 4)}-${d.slice(4)}`, `${d.slice(0, 4)} ${d.slice(4)}`]) };
        }
        case "fixo10": { const d = dd + String(2 + ri(4)) + digs(7); return { d, txt: um([d, `(${dd}) ${d.slice(2, 6)}-${d.slice(6)}`, `${dd} ${d.slice(2, 6)}-${d.slice(6)}`]) }; }
        case "cpf": { const d = cpf(); return { d, txt: um([d, `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`, `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`, `${d.slice(0, 9)}-${d.slice(9)}`]) }; }
        case "cnpj": { const d = cnpj(); return { d, txt: um([d, `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`, `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8, 12)} ${d.slice(12)}`, `${d.slice(0, 8)}/${d.slice(8, 12)}-${d.slice(12)}`]) }; }
      }
    };
    const visivel = (saida: string, d: string) => saida.split(/\[(?:dado pessoal omitido|dado bancário omitido|senha omitida)\]/).some(x => x.replace(/\D/g, "").includes(d));
    const falhas: string[] = [];
    let casos = 0, itens = 0, mainEsconde = 0;
    const inicio = performance.now();
    for (let k = 0; k < TOTAL; k++) {
      const rotulo = um(ROTULOS);
      const comTel = ROTULOS_TEL.includes(rotulo);
      const sepTipo = ri(6);
      const n = 1 + ri(8);
      const its = Array.from({ length: n }, () => item(um(TIPOS), comTel && sepTipo !== 2));
      let txt = rotulo;
      its.forEach((it, x) => {
        if (x > 0) txt += [" ", ", ", "\n", " | ", " - ", ` ${ri(10)} `][sepTipo];
        txt += it.txt;
      });
      const saida = sanitizarTexto(txt), daMainSaida = daMain(txt);
      casos++;
      let pos = rotulo.length;
      for (const it of its) {
        itens++;
        const linha = txt.slice(txt.lastIndexOf("\n", pos) + 1, pos);
        const telNaLinha = /\b(?:tel(?:efone)?s?|fones?|contatos?|whats\w*)\b/i.test(linha);
        const ehFixo = (it.d.length === 8 && /^[2-5]/.test(it.d)) || (it.d.length === 10 && /^[1-9][1-9][2-5]/.test(it.d) && !cnpjOk(it.d));
        const vis = visivel(saida, it.d);
        if (vis && !ehFixo) falhas.push(`celular/CPF/CNPJ inteiro: ${JSON.stringify(txt)} → ${JSON.stringify(saida)} (${it.d})`);
        if (vis && ehFixo && telNaLinha) falhas.push(`fixo com palavra de telefone: ${JSON.stringify(txt)} → ${JSON.stringify(saida)} (${it.d})`);
        const mainOculta = !visivel(daMainSaida, it.d);
        if (mainOculta) mainEsconde++;
        const livre = ehFixo && !comTel && LIVRA_FIXO.has(rotulo);
        if (mainOculta && vis && !livre) falhas.push(`a main mascara e a nova não: ${JSON.stringify(txt)} → ${JSON.stringify(saida)} | main ${JSON.stringify(daMainSaida)} (${it.d})`);
        pos = txt.indexOf(it.txt, pos) + it.txt.length;
      }
      if (falhas.length > 20) break;
    }
    const ms = performance.now() - inicio;
    expect(falhas.slice(0, 20), `${falhas.length} falhas em ${casos} casos`).toEqual([]);
    expect(casos).toBe(TOTAL);
    expect(itens).toBeGreaterThan(TOTAL * 4);
    expect(mainEsconde).toBeGreaterThan(TOTAL); // o corpus exercita o que a main pegava
    expect(ms, `${ms.toFixed(0)} ms`).toBeLessThan(60_000);
  });

  it("opção B (16/11): com mascararDadosPessoais false, CPF/CNPJ/telefone/e-mail e documentos saem intactos; segredos e banco não", () => {
    const LIB = { mascararDadosPessoais: false } as const;
    for (const t of [
      "CPF 529.982.247-25 e 52998224725", "CNPJ 11.222.333/0001-81 e 11222333000181", "cel (99) 99123-4567, 99991234567 e +55 99 99123-4567",
      "fixo 3523-4567 e (99) 3523-4567", "mail maria.conceição@uol.com.br e fulano @ gmail . com", "fones 3523 4567 9123 4567",
      "boleto 23793.38128 60000.000004 00000.000406 1 84340000010000", "IPTU 83620000001-5 23450048001-1 23456789012-3 45678901234-5",
      "chave de acesso 3526 1112 3456 7800 0195 5500 1000 0012 3410 0001 2346", "lotes 3201 3202 3203", "R$ 1.250.000,00 em 16/11/2026",
      "Vizinhos: 2814 1021 2752 2541 9164 6526", "pagar 2379338128 60000000004 00000000406 1 84340000010000",
    ]) expect(sanitizarTexto(t, LIB), t).toBe(t);
    const S = "[senha omitida]", B = "[dado bancário omitido]", K = "[chave de acesso omitida]";
    expect(sanitizarTexto("Senha do gov.br 1234; CPF 111.222.333-44; conta 12345-6 ag 0001", LIB))
      .toBe(`Senha ${S}; CPF 111.222.333-44; conta ${B} ag ${B}`);
    expect(sanitizarTexto("o token: abc123", LIB)).toBe(`o token ${S}`);
    expect(sanitizarTexto("código de acesso 4321", LIB)).toBe(`código ${S}`);
    expect(sanitizarTexto("código OTP 445566", LIB)).toBe(`código ${S}`);
    expect(sanitizarTexto("pin 1234", LIB)).toBe(`pin ${S}`);
    expect(sanitizarTexto("a chave é sk-ant-api03-AbCdEf_123-xyz e pronto", LIB)).toBe(`a chave é ${K} e pronto`);
    expect(sanitizarTexto("Authorization: Bearer abcdef0123456789", LIB)).toBe(`Authorization: ${K}`);
    expect(sanitizarTexto("pix 123e4567-e89b-12d3-a456-426614174000", LIB)).toBe(`pix ${B}`);
    expect(sanitizarTexto("chave pix: maria@x.com", LIB)).toBe(`chave pix: ${B}`);
    expect(sanitizarTexto("conta corrente nº 98765-X, agência 0001.", LIB)).toBe(`conta corrente nº ${B}, agência ${B}.`);
    // decisão de 16/11: chave PIX e conta/agência são dado bancário e saem INTEIRAS, mesmo quando são CPF/telefone/e-mail
    for (const [t, r] of [
      ["pix 529 982 247 25", `pix ${B}`], ["pix: 529.982.247-25", `pix: ${B}`], ["chave pix (99) 99123-4567, obrigado", `chave pix ${B}, obrigado`],
      ["pix +55 99 99123-4567", `pix ${B}`], ["pix maria@x.com", `pix ${B}`], ["conta 529 982 247 25", `conta ${B}`],
      ["conta 12345 6 ag 0001 2", `conta ${B} ag ${B}`], ["c/c 11 222 333 0001 81.", `c/c ${B}.`], ["agência 1234 5, conta 98765 4", `agência ${B}, conta ${B}`],
    ] as const) expect(sanitizarTexto(t, LIB), t).toBe(r);
    for (const t of ["pix 1.500,00", "conta 2026", "cc 2 cópias", "conta de luz 152,30"]) expect(sanitizarTexto(t, LIB), t).toBe(t);
    // texto sem segredo volta idêntico (o mesmo objeto de string), e a resposta inteira também
    const t = "Reunião às 10:30, lote 12, CPF 52998224725.";
    expect(sanitizarTexto(t, LIB)).toBe(t);
    expect(sanitizarResposta({ a: ["cpf 529.982.247-25", "senha 1"] }, LIB)).toEqual({ a: ["cpf 529.982.247-25", `senha ${S}`] });
    // o padrão da função pura (sem opções) e { mascararDadosPessoais: true } continuam mascarando (falha fechada)
    expect(sanitizarTexto("CPF 52998224725")).toBe(`CPF ${OMITIDO_T}`);
    expect(sanitizarTexto("CPF 52998224725", { mascararDadosPessoais: true })).toBe(`CPF ${OMITIDO_T}`);
    expect(sanitizarTexto("a chave é sk-ant-api03-AbCdEf_123-xyz", { mascararDadosPessoais: true })).toBe(`a chave é ${K}`);
    // 200 kB sem segredo: rápido e idêntico
    const grande = "CPF 529.982.247-25, tel (99) 99123-4567, lote 12; ".repeat(4000);
    const t0 = performance.now();
    expect(sanitizarTexto(grande, LIB)).toBe(grande);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it("QA r7 A1: credencial sem a palavra 'senha' sai nos DOIS modos; o CPF ao lado segue o interruptor; sem falso positivo óbvio", () => {
    const S = "[senha omitida]";
    const LIB = { mascararDadosPessoais: false } as const;
    const casos: Array<[string, string]> = [
      ["gov.br 529.982.247-25 Maria@2025", "Maria@2025"], ["login: 52998224725 / Maria@2025", "Maria@2025"],
      ["acesso INSS: Maria@123", "Maria@123"], ["senhas\nMaria@2025", "Maria@2025"], ["senha, Maria@2025", "Maria@2025"],
      ["acesso gov: 52998224725 Maria@2025", "Maria@2025"], ["usuário: maria.silva, Qwe!2345x", "Qwe!2345x"],
      ["login maria / s3nh4F0rte", "s3nh4F0rte"], ["credenciais:\nPrevid2025", "Previd2025"], ["meu inss — Abc12345", "Abc12345"],
      ["e-cac: Joao#Silva9", "Joao#Silva9"], ["pwd Xy7#abcd", "Xy7#abcd"], ["senha: Maria.2025, ok", "Maria.2025"],
      ["a senha é Maria.2025. Entrei", "Maria.2025"], ["portal da caixa: Caixa2025", "Caixa2025"],
    ];
    for (const [t, senha] of casos) for (const op of [LIB, {}]) {
      const r = sanitizarTexto(t, op);
      expect(r, `${t} → ${r}`).not.toContain(senha);
      expect(r, t).toContain(S);
    }
    // o CPF ao lado segue o interruptor: inteiro no modo liberado, mascarado no padrão
    expect(sanitizarTexto("acesso gov: 52998224725 Maria@2025", LIB)).toBe(`acesso gov: 52998224725 ${S}`);
    expect(sanitizarTexto("acesso gov: 52998224725 Maria@2025")).toBe(`acesso gov: ${OMITIDO_T} ${S}`);
    // a pontuação depois da senha fica; o resto da frase também
    expect(sanitizarTexto("senha: Maria.2025, ok", LIB)).toBe(`senha ${S}, ok`);
    expect(sanitizarTexto("a senha é Maria.2025. Entrei", LIB)).toBe(`a senha ${S}. Entrei`);
    // o outro lado: valores, e-mails de verdade, lote, datas, protocolo e usuário sem cara de senha ficam
    for (const t of [
      "R$ 1.500,00 acesso ao lote 12 em 16/11/2026", "login maria@gmail.com", "acesso liberado em 16/11/2026 às 10h", "usuário: maria.silva",
      "portal da prefeitura, protocolo 2026/123, lote 12", "acesso pela rua 7, casa 12", "login feito às 10:30", "o portal está fora do ar",
      "acesso: R$ 2.500,00 pago", "e-mail maria.silva@uol.com.br",
    ]) expect(sanitizarTexto(t, LIB), t).toBe(t);
    // "x@y" sem domínio fora de gatilho: senha no modo liberado; no padrão, a fase de e-mail tira (marcador de dado pessoal)
    expect(sanitizarTexto("anotou Maria@2025 no papel", LIB)).toBe(`anotou ${S} no papel`);
    expect(sanitizarTexto("anotou Maria@2025 no papel")).toBe(`anotou ${OMITIDO_T} no papel`);
    // 200 kB com gatilhos e palavras com cara de senha: tempo linear
    for (const p of ["login ", "acesso Maria@2025 ", "senha, ", "a@a", "gov.br\n", "x".repeat(50) + "@" + "1".repeat(50) + " "]) {
      const t = p.repeat(Math.ceil(200 * 1024 / p.length));
      for (const op of [LIB, {}]) {
        const t0 = performance.now();
        sanitizarTexto(t, op);
        expect(performance.now() - t0, JSON.stringify(p)).toBeLessThan(1000);
      }
    }
  });

  it("QA r7 A6: segredos disfarçados (pwd/pass/tkn, código de verificação/2FA/segurança, bearer, chaves de API, PEM) saem nos dois modos", () => {
    const S = "[senha omitida]", K = "[chave de acesso omitida]";
    const LIB = { mascararDadosPessoais: false } as const;
    const pem = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\nabc123\n-----END PRIVATE KEY-----";
    const casos: Array<[string, string, string]> = [
      ["pwd: qwerty123", `pwd ${S}`, "qwerty123"], ["pass: qwerty123", `pass ${S}`, "qwerty123"], ["tkn abcdef123456", `tkn ${S}`, "abcdef123456"],
      ["código de verificação 554433", `código ${S}`, "554433"], ["código 2FA 554433", `código ${S}`, "554433"],
      ["codigo de seguranca 1234", `codigo ${S}`, "1234"], ["cód. de acesso 9988", `cód. ${S}`, "9988"],
      ["bearer abcdefghij", K, "abcdefghij"], ["Bearer: abcdefghij12", K, "abcdefghij12"],
      ["github_pat_11ABCDEFG0123456789_abcdefghijklmnop", K, "github_pat_"], ["AIzaSyA-1234567890abcdefghijklmnopqrstu", K, "AIzaSy"],
      ["sk_live_51Habcdefghijkl", K, "sk_live"], ["sk_test_51Habcdefghijkl", K, "sk_test"], ["pk_live_abcdefghij12", K, "pk_live"],
      ["apikey=0123456789abcdef0123456789abcdef", `apikey=${K}`, "0123456789abcdef"], ["api_key: 0123456789abcdef", `api_key: ${K}`, "0123456789abcdef"],
      ["apikey 0a1b2c3d4e5f60718293a4b5c6d7e8f9", `apikey ${K}`, "0a1b2c3d"], ["client_secret=Zx9_abcdef", `client_secret=${K}`, "Zx9_"],
      [`chave:\n${pem}\nfim`, `chave:\n${K}\nfim`, "MIIEv"], ["xoxb-123456789012-abcdefghij", K, "xoxb"], ["xoxp-123456789012-abcdefghij", K, "xoxp"],
    ];
    for (const [t, esperado, segredo] of casos) for (const op of [LIB, {}]) {
      const r = sanitizarTexto(t, op);
      expect(r, t).toBe(esperado);
      expect(r, t).not.toContain(segredo);
    }
    // PEM sem o fim (cortado) também sai até o fim do texto
    expect(sanitizarTexto("-----BEGIN RSA PRIVATE KEY-----\nMIIEvQIBADAN", LIB)).toBe(K);
    for (const t of ["código do imóvel 12345", "código de barras 123", "o segredo do sucesso", "passe livre 2026", "secret santa 2026",
      "apikey curta", "o bearer da notícia"]) expect(sanitizarTexto(t, LIB), t).toBe(t);
    for (const p of ["bearer ", "apikey ", "-----BEGIN PRIVATE KEY-----", "código de verificação ", "pwd: x "]) {
      const t = p.repeat(Math.ceil(200 * 1024 / p.length));
      const t0 = performance.now();
      sanitizarTexto(t, LIB);
      sanitizarTexto(t);
      expect(performance.now() - t0, p).toBeLessThan(2000);
    }
  });

  it("percorre a resposta inteira (listas e objetos), sem tocar números e chaves", () => {
    expect(sanitizarResposta({ a: [{ texto: "cpf 111.222.333-44", n: 11122233344 }], "111.222.333-44": null }))
      .toEqual({ a: [{ texto: "cpf [dado pessoal omitido]", n: 11122233344 }], "111.222.333-44": null });
  });
});
