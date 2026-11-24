import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formularioPciVazio, normalizarFormularioPci, type FormularioPci } from "../../shared/pci-gerador.js";
import { AvaliadorBiff8 } from "./biff8-formulas.js";
import { chaveCelula, ErroXls, PlanilhaBiff8, posicaoDoEndereco, type AbaXls, type CelulaXls } from "./biff8-planilha.js";
import { formatarValorXls } from "./formato-numero-xls.js";
import { gerarPlanilhaPci } from "./pci-gerador.js";
import { ABA_PCI, gerarPdfFielPci } from "./pci-pdf-fiel.js";

const MODELO = new Uint8Array(readFileSync(new URL("./__fixtures__/pci-modelo-anonimo.xls", import.meta.url)));

/** Formulário sintético (sem dados reais). */
function formulario(): FormularioPci {
  const f = formularioPciVazio();
  Object.assign(f.campos, {
    proponenteNome: "MARIA DIGITADA", proponenteEmail: "maria@teste.local", proponenteCpf: "123.456.789-09", proponenteDdd: 98, proponenteTelefone: "991234567",
    rtpNome: "ENG PROJETO", rtpEmail: "proj@teste.local", rtpRegistro: "1112223334", rtpUf: "MA", rtpCpf: "111.222.333-44", rtpDdd: 99, rtpTelefone: "981112222",
    rteNome: "ENG EXECUCAO", rteEmail: "exec@teste.local", rteRegistro: "12345/D", rteUf: "PI", rteCpf: "555.666.777-88", rteDdd: 86, rteTelefone: "999887766",
    endereco: "RUA NOVA, 10", complemento: "LOTE 5, QUADRA B", bairro: "CENTRO", cep: "65901-230", municipio: "IMPERATRIZ", uf: "MA",
    matricula: "4321", cartorio: "2º OFICIO", latitude: `05° 29' 18" S`, longitude: `47° 28' 30.5" W`, construtora: "CONSTRUTORA TESTE", cnpjConstrutora: "11.222.333/0001-81", finalidade: " Constr.Terr.Próprio FGTS",
    alvaraSituacao: "Apresentado", alvaraValidade: "2027-03-15", terrenoProprio: "Sim", artProjetoSituacao: "Apresentado", artProjetoNumero: "MA123", artExecucaoSituacao: "Apresentado", artExecucaoNumero: "MA456", projetoLegalSituacao: "Apresentado projeto aprovado",
    areaCoberta: 60.5, areaPermeavel: 100, areaAcessoria: 4.5, areaTerreno: 300, valorTerreno: 80000, destinacao: "Residencial", valorImovel: 250000,
    padraoAcabamento: "Normal", implantacao: "Isolada", cobertura: "Telha de Cerâmica/Concreto", teto: "Forro", pavimentos: "1", quartos: "3", suites: "1", salas: "1", vagas: "4+", tipoVagas: "Coberta(s)",
    divisaoInterna: "3 QUARTOS, SALA, COZINHA", sistemaConstrutivo: "Conv:Alvenaria estrutural", especificacaoSistema: "CONCRETO ARMADO", usoEps: "Não", seloCasaAzul: "Não",
    drenagem: "Interna ao terreno", esgoto: "Rede de Esgoto", esgotoDescricao: "LIGAÇÃO NA REDE", executor: "Construtora", bdi: 20, prazoMeses: 4, preExecutado: 10,
    certidaoMatricula: "Apresentado", projetoArquitetonico: "Apresentado", docSistemaInovador: "Não se aplica", justificativaIncidencias: "BDI ACIMA DO LIMITE",
    obrasPreExistentes: "FUNDAÇÃO EXECUTADA", observacoes: "SEM OBSERVAÇÕES", localData: "IMPERATRIZ, 27 DE OUTUBRO DE 2026",
  });
  f.custos = [5000, 10000, 15000, 12000, 6000, 0, 8000, 7000, 9000, 1500, 5000, 4500, 10000, 1500, 5000, 5000, 5000, 5000, 500];
  f.adicionais[0] = { descricao: "MURO", valor: 5000 };
  f.adicionais[1] = { descricao: "PORTÃO", valor: 2000 };
  f.cronograma = [25, 50, 75, 100];
  return normalizarFormularioPci(f);
}

const PCI = gerarPlanilhaPci(MODELO, "xls", formulario()).bytes;
const inicio = Date.now();
const PDF = gerarPdfFielPci(PCI, { comprimir: false, hoje: new Date("2026-11-24T12:00:00Z") });
const TEMPO_MS = Date.now() - inicio;

// ─── avaliador com pasta mínima (tokens BIFF8 escritos à mão) ────────────────

const ref = (linha: number, coluna: number) => [0x44, linha & 0xff, linha >> 8, coluna & 0xff, 0xc0 | (coluna >> 8)];
const area = (r1: number, r2: number, c1: number, c2: number) => [0x25, r1, 0, r2, 0, c1, 0xc0, c2, 0xc0];
const num = (v: number) => {
  const b = new Uint8Array(9);
  b[0] = 0x1f;
  new DataView(b.buffer).setFloat64(1, v, true);
  return [...b];
};
const str = (s: string) => [0x17, s.length, 0, ...[...s].map((c) => c.charCodeAt(0))];
const funcVar = (n: number, id: number) => [0x42, n, id & 0xff, id >> 8];
const op = (codigo: number) => [codigo];

function pastaMinima(celulas: Record<string, number | string | null | number[]>) {
  const aba: AbaXls = {
    nome: "T", indice: 0, celulas: new Map(), larguras: new Map(), colunasOcultas: new Set(), larguraPadrao: 8, alturas: new Map(), linhasOcultas: new Set(),
    alturaPadrao: 12.75, ocultaPorPadrao: false, mesclas: [], quebrasLinha: [], cabecalho: "", rodape: "",
    margens: { esquerda: 0.7, direita: 0.7, cima: 0.7, baixo: 0.7, cabecalho: 0.3, rodape: 0.3 }, retrato: true, ajustarLargura: 1, ajustarAltura: 0,
    ajustarPagina: false, escala: 100, centralizarH: false, centralizarV: false, imprimeGrade: false, desenhos: [], condicionais: [],
  };
  for (const [end, v] of Object.entries(celulas)) {
    const { linha, coluna } = posicaoDoEndereco(end);
    const cel: CelulaXls = Array.isArray(v) ? { linha, coluna, xf: 0, valor: 999, formula: Uint8Array.from(v) } : { linha, coluna, xf: 0, valor: v };
    aba.celulas.set(chaveCelula(linha, coluna), cel);
  }
  const pasta = { abas: [aba], nomes: [], externSheets: [], supbooks: [] } as unknown as PlanilhaBiff8;
  const av = new AvaliadorBiff8(pasta);
  const valor = (end: string) => {
    const { linha, coluna } = posicaoDoEndereco(end);
    return av.resultado(aba, linha, coluna);
  };
  return { valor };
}

describe("Avaliador de fórmulas BIFF8", () => {
  it("aritmética, comparação, texto e % seguem o Excel", () => {
    const { valor } = pastaMinima({
      A1: 2, A2: 3, A3: null,
      B1: [...ref(0, 0), ...ref(1, 0), ...op(0x03)], // =A1+A2
      B2: [...ref(0, 0), ...ref(2, 0), ...op(0x05)], // =A1*A3 (vazio vale 0)
      B3: [...ref(0, 0), ...num(0), ...op(0x06)], // =A1/0
      B4: [...ref(0, 0), ...ref(1, 0), ...op(0x09)], // =A1<A2
      B5: [...str("R$ "), ...ref(1, 0), ...op(0x08)], // ="R$ "&A2
      B6: [...num(50), 0x14], // =50%
      B7: [...ref(2, 0)], // =A3 (vazio aparece como 0)
    });
    expect(valor("B1").valor).toBe(5);
    expect(valor("B2").valor).toBe(0);
    expect((valor("B3").valor as ErroXls).codigo).toBe("#DIV/0!");
    expect(valor("B4").valor).toBe(true);
    expect(valor("B5").valor).toBe("R$ 3");
    expect(valor("B6").valor).toBe(0.5);
    expect(valor("B7").valor).toBe(0);
  });

  it("SE só avalia o ramo escolhido; SOMA e PROCV sobre intervalos", () => {
    const { valor } = pastaMinima({
      A1: 1, A2: 2, A3: 3, B1: "um", B2: "dois", B3: "tres",
      C1: [...ref(0, 0), ...num(1), ...op(0x0b), ...str("sim"), ...ref(9, 9), ...num(0), ...op(0x06), ...funcVar(3, 1)], // =IF(A1=1,"sim",J10/0)
      C2: [...area(0, 2, 0, 0), ...funcVar(1, 4)], // =SUM(A1:A3)
      C3: [...num(2), ...area(0, 2, 0, 1), ...num(2), ...num(0), ...funcVar(4, 102)], // =VLOOKUP(2,A1:B3,2,0)
      C4: [...num(9), ...area(0, 2, 0, 1), ...num(2), ...num(0), ...funcVar(4, 102)], // =VLOOKUP(9,...,0) → #N/D
      C5: [...num(2.5), ...area(0, 2, 0, 1), ...num(2), ...funcVar(3, 102)], // aproximado → "dois"
    });
    expect(valor("C1").valor).toBe("sim");
    expect(valor("C2").valor).toBe(6);
    expect(valor("C3").valor).toBe("dois");
    expect((valor("C4").valor as ErroXls).codigo).toBe("#N/A");
    expect(valor("C5").valor).toBe("dois");
  });

  it("função desconhecida não lança: devolve o cache e o motivo; ciclo não trava", () => {
    const { valor } = pastaMinima({
      A1: [0x41, 0x63, 0x01], // ptgFunc id 355 (não suportada)
      B1: [...ref(0, 2)], // =C1
      C1: [...ref(0, 1)], // =B1 (ciclo)
    });
    const r = valor("A1");
    expect(r.cache).toBe(true);
    expect(r.valor).toBe(999);
    expect(r.motivo).toMatch(/não suportad/);
    expect(() => valor("B1")).not.toThrow();
  });
});

describe("Formatos numéricos (padrão brasileiro)", () => {
  it.each([
    [230000, "#,##0.00", "230.000,00"],
    [-1234.5, "#,##0.00", "-1.234,50"],
    [12345678909, '000"."000"."000"-"00', "123.456.789-09"],
    [991234567, "#####\\-####", "99123-4567"],
    [52918, `00"°"\\ 00\\'\\ 00\\'\\'`, "05° 29' 18''"],
    [46461, "dd/mm/yyyy", "15/03/2027"],
    [0.5, "0%", "50%"],
    [1.5, "General", "1,5"],
    ["abc", "@", "abc"],
  ])("%s com %s → %s", (v, fmt, esperado) => {
    expect(formatarValorXls(v as number | string, fmt).texto).toBe(esperado);
  });

  it("formato contábil prende o número à direita", () => {
    const r = formatarValorXls(1234.5, '_-* #,##0.00_-;\\-* #,##0.00_-;_-* "-"??_-;_-@_-');
    expect(r.preenchimento?.direita.trim()).toBe("1.234,50");
  });
});

describe("PDF fiel da PCI (modelo anonimizado + formulário sintético)", () => {
  const planilha = PlanilhaBiff8.abrir(PCI);
  const aba = planilha.aba(ABA_PCI);
  const cel = (end: string) => {
    const { linha, coluna } = posicaoDoEndereco(end);
    return aba.celulas.get(chaveCelula(linha, coluna));
  };
  const bruto = (end: string) => cel(end)?.valor as number;
  const f = PDF.formulas;

  it("recalcula as células-chave a partir das entradas", () => {
    expect(f.get("AC73")).toBeCloseTo(bruto("G73") + bruto("U73"), 6);
    expect(f.get("AC73")).toBeCloseTo(65, 6);
    expect(f.get("AP149")).toBeCloseTo(bruto("AR73"), 6);
    expect(f.get("AP149")).toBe(80000);
    expect(f.get("AP150")).toBeCloseTo(f.get("AB140") as number, 6);
    const totalCustos = formulario().custos.reduce((s, v) => s + (v ?? 0), 0) + 5000 + 2000;
    expect(f.get("AB140")).toBeCloseTo(totalCustos, 6);
    expect(f.get("AP151")).toBeCloseTo(f.get("AB142") as number, 6);
    expect(f.get("AP151")).toBeCloseTo(totalCustos * 1.2, 6);
    expect(f.get("AP152")).toBeCloseTo((f.get("AP149") as number) + (f.get("AP151") as number), 6);
    expect(f.get("AT150")).toBeCloseTo((f.get("AP150") as number) / (f.get("AC73") as number), 6);
    let soma = 0;
    for (let r = 120; r <= 139; r++) soma += (f.get(`X${r}`) as number) ?? 0;
    expect(soma).toBeCloseTo(100, 6);
  });

  it("não usa o resultado velho guardado no arquivo (cache do exemplo do modelo)", () => {
    // o .xls gerado ainda traz o cache do exemplo em AP149; o PDF mostra o valor novo
    expect(bruto("AP149")).not.toBe(80000);
    expect(f.get("AP149")).toBe(80000);
    const textos = PDF.textos.filter((t) => t.celula === "AP149").map((t) => t.texto);
    expect(textos).toContain("80.000,00");
    expect(PDF.avisos.filter((a) => /fórmula não recalculada/.test(a))).toEqual([]);
  });

  it("gera um PDF A4 de 3 páginas com os textos principais, em menos de 3 s", () => {
    expect(new TextDecoder().decode(PDF.bytes.slice(0, 5))).toBe("%PDF-");
    expect(PDF.paginas).toBe(3);
    const todos = PDF.textos.map((t) => t.texto).join(" | ");
    for (const t of ["Proposta de Construção Individual", "IDENTIFICAÇÃO", "MARIA DIGITADA", "123.456.789-09", "ENG EXECUCAO", "80.000,00", "250.000,00", "Vigência: 20/06/2025", "1/3", "3/3"]) {
      expect(todos).toContain(t);
    }
    // o logotipo da CAIXA vai em todas as páginas (linhas de título repetidas)
    const conteudo = new TextDecoder("latin1").decode(PDF.bytes);
    expect((conteudo.match(/\/Subtype \/Image/g) ?? []).length).toBeGreaterThan(0);
    expect(PDF.textos.filter((t) => t.texto === "Proposta de Construção Individual").map((t) => t.pagina)).toEqual([1, 2, 3]);
    expect(TEMPO_MS).toBeLessThan(3000);
  });

  it("texto com quebra que não cabe na célula fica preso a ela: não invade a seção de baixo (revisão do Codex no PR #338)", () => {
    const f = formulario();
    f.campos.observacoes = Array.from({ length: 200 }, (_, i) => `OBSERVACAO ${i + 1}`).join(" "); // ~2.900 caracteres em G245:AW248
    const pdf = gerarPdfFielPci(gerarPlanilhaPci(MODELO, "xls", normalizarFormularioPci(f)).bytes, { comprimir: false, hoje: new Date("2026-11-24T12:00:00Z") });
    const obs = pdf.textos.filter((t) => t.celula === "G245");
    const titulo = pdf.textos.find((t) => t.celula === "G250")!;
    expect(obs.length).toBeGreaterThan(1);
    expect(titulo).toBeTruthy();
    expect(obs.every((t) => t.pagina === titulo.pagina)).toBe(true);
    // todas as linhas desenhadas da observação ficam ACIMA do título da seção seguinte, e o fim do texto não é desenhado
    expect(Math.max(...obs.map((t) => t.y))).toBeLessThan(titulo.y);
    const desenhado = obs.map((t) => t.texto).join(" ").replace(/\s+/g, " ");
    expect(desenhado).toContain("OBSERVACAO 1 OBSERVACAO 2 ");
    expect(desenhado).not.toContain("OBSERVACAO 200");
    expect(pdf.paginas).toBe(3);
  });

  it("linhas ocultas não geram desenho", () => {
    const ocultasComConteudo = Array.from(aba.linhasOcultas).filter((r) => r >= 33 && r <= 265 && Array.from(aba.celulas.values()).some((c) => c.linha === r && c.valor !== null && c.valor !== ""));
    expect(ocultasComConteudo.length).toBeGreaterThan(0);
    const linhasDesenhadas = new Set(PDF.textos.filter((t) => /^[A-Z]+\d+$/.test(t.celula)).map((t) => posicaoDoEndereco(t.celula).linha));
    for (const r of ocultasComConteudo) expect(linhasDesenhadas.has(r)).toBe(false);
  });

  it("arquivo ilegível lança erro claro; imagem ilegível vira aviso", () => {
    expect(() => gerarPdfFielPci(new Uint8Array([1, 2, 3]))).toThrow();
    // o modelo anonimizado tem a foto de exemplo zerada: o PDF sai assim mesmo, com aviso
    expect(PDF.avisos.some((a) => /Imagem/.test(a))).toBe(true);
  });
});
