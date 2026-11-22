// EPIC-029 S-6 — regras puras: regime por empresa (raiz do CNPJ), limites por regime, faixas, projeção, soma por empresa (matriz +
// filiais) sem transferência entre contas da mesma empresa nem estorno, troca de regime no meio do ano.
import { describe, expect, it } from "vitest";
import {
  LIMITE_ME_CENTAVOS, LIMITE_PRESUMIDO_CENTAVOS, SUBLIMITE_SIMPLES_CENTAVOS, TETO_SIMPLES_CENTAVOS, TETO_SIMPLES_MAIS_20_CENTAVOS, apurarReceitas, diasDoAno,
  ehEstorno, ehMatriz, faixaDoLimite, formatarCnpj, limitesDoRegime, nomeDaConta, optanteDoSimples, percentualDe, perfilVigenteNaData, projecaoAnual,
  raizDoCnpj, reaisCurtos, type ContaParaSoma, type PerfilParaRegime, type ReceitaParaSoma,
} from "../../shared/fiscal/regimes.js";

const AGORA = new Date("2026-11-22T15:00:00Z"); // 22/11/2026 em Brasília
const PROSPECTA = "41865900000189";
const EFFICAZ_MATRIZ = "04578232000182";
const EFFICAZ_FILIAL = "04578232000263";
const VFX = "58121993000100";
const perfil = (id: number, cnpj: string, regime: string, desde = "2021-05-07", ativo = true, nome = `Empresa ${id}`): PerfilParaRegime =>
  ({ id, companyName: nome, cnpj, regime, effectiveFrom: new Date(`${desde}T12:00:00Z`), effectiveTo: null, isActive: ativo });
const conta = (id: number, empresaCnpj: string | null, apelido: string | null = null): ContaParaSoma =>
  ({ id, banco: `Banco ${id}`, apelido, descricao: null, conta: `000${id}12345`, empresaCnpj, ativo: true });
let seq = 0;
const receita = (contaId: number | null, reais: number, dia = "2026-03-10", extra: Partial<ReceitaParaSoma> = {}): ReceitaParaSoma =>
  ({ lancamentoId: ++seq, contaId, tipo: "receita", valorCentavos: Math.round(reais * 100), descricao: "Recebimento de cliente", categoria: "Recebimento de cliente",
    pagoEm: new Date(`${dia}T12:00:00Z`), ...extra });

describe("S-6 — limites por regime (constantes e fonte)", () => {
  it("valores legais em centavos", () => {
    expect(LIMITE_ME_CENTAVOS).toBe(36_000_000);
    expect(SUBLIMITE_SIMPLES_CENTAVOS).toBe(360_000_000);
    expect(TETO_SIMPLES_CENTAVOS).toBe(480_000_000);
    expect(TETO_SIMPLES_MAIS_20_CENTAVOS).toBe(TETO_SIMPLES_CENTAVOS * 1.2);
    expect(LIMITE_PRESUMIDO_CENTAVOS).toBe(7_800_000_000);
  });
  it("Simples tem ME (informativo), sublimite e teto; Presumido 78 mi; Real sem limite; a confirmar/RET/outro sem conta", () => {
    expect(limitesDoRegime("simples_nacional").limites.map(l => [l.chave, l.informativo])).toEqual([["me", true], ["sublimite", false], ["teto_simples", false]]);
    expect(limitesDoRegime("lucro_presumido").limites.map(l => l.valorCentavos)).toEqual([LIMITE_PRESUMIDO_CENTAVOS]);
    expect(limitesDoRegime("lucro_real")).toMatchObject({ situacao: "sem_limite", limites: [] });
    for (const r of ["a_confirmar", "ret", "outro", null]) expect(limitesDoRegime(r)).toMatchObject({ situacao: "a_confirmar", limites: [] });
    for (const r of ["simples_nacional", "lucro_presumido"]) for (const l of limitesDoRegime(r).limites) expect(l.fonte).toMatch(/LC 123\/2006|Lei 9\.718\/1998/);
  });
  it("opção do Simples na DPS: só Simples; a confirmar = null (não emitir)", () => {
    expect(optanteDoSimples("simples_nacional")).toBe(true);
    expect(optanteDoSimples("lucro_presumido")).toBe(false);
    expect(optanteDoSimples("lucro_real")).toBe(false);
    expect(optanteDoSimples("a_confirmar")).toBeNull();
    expect(optanteDoSimples(null)).toBeNull();
  });
});

describe("S-6 — faixas, percentual e projeção", () => {
  it("faixas 70/85/95/100 com conta exata (69,99% ainda é 0)", () => {
    const L = TETO_SIMPLES_CENTAVOS;
    expect(faixaDoLimite(Math.floor(L * 0.7) - 1, L)).toBe(0);
    expect(faixaDoLimite(L * 0.7, L)).toBe(70);
    expect(faixaDoLimite(L * 0.849, L)).toBe(70);
    expect(faixaDoLimite(L * 0.85, L)).toBe(85);
    expect(faixaDoLimite(L * 0.95, L)).toBe(95);
    expect(faixaDoLimite(L, L)).toBe(100);
    expect(faixaDoLimite(L * 2, L)).toBe(100);
    expect(faixaDoLimite(0, L)).toBe(0);
    expect(percentualDe(L * 0.8765, L)).toBe(87.6);
  });
  it("projeção pelo ritmo do ano (Brasília) e confiança só depois de 30 dias", () => {
    expect(diasDoAno(new Date("2026-01-01T03:00:00Z"))).toEqual({ decorridos: 1, total: 365 });
    expect(diasDoAno(new Date("2026-01-01T02:59:00Z")).decorridos).toBe(365); // ainda 31/12/2025 em Brasília
    expect(diasDoAno(new Date("2028-12-31T15:00:00Z"))).toEqual({ decorridos: 366, total: 366 });
    const p = projecaoAnual(100_000_00, new Date("2026-07-02T15:00:00Z")); // dia 183
    expect(p.centavos).toBe(Math.round((100_000_00 * 365) / 183));
    expect(p.confiavel).toBe(true);
    expect(projecaoAnual(1_000_00, new Date("2026-01-10T15:00:00Z")).confiavel).toBe(false);
  });
  it("valor curto para o aviso", () => {
    expect(reaisCurtos(62_000_000)).toBe("R$ 620 mil");
    expect(reaisCurtos(123_456_700)).toBe("R$ 1,23 milhão");
    expect(reaisCurtos(95_000)).toBe("R$ 950,00");
  });
});

describe("S-6 — empresa = raiz do CNPJ; estabelecimento = CNPJ completo", () => {
  it("raiz, matriz e formatação", () => {
    expect(raizDoCnpj("04.578.232/0002-63")).toBe("04578232");
    expect(ehMatriz(EFFICAZ_MATRIZ)).toBe(true);
    expect(ehMatriz(EFFICAZ_FILIAL)).toBe(false);
    expect(formatarCnpj(PROSPECTA)).toBe("41.865.900/0001-89");
  });
  it("nome da conta: apelido; sem apelido, banco — descrição • número (renomear não muda o resto)", () => {
    const c = { banco: "Cora", descricao: "Conta PJ", conta: "12345-6", apelido: null };
    expect(nomeDaConta(c)).toBe("Cora — Conta PJ • 12345-6");
    expect(nomeDaConta({ ...c, apelido: "  Obras Imperatriz " })).toBe("Obras Imperatriz");
    expect(nomeDaConta({ ...c, apelido: "   " })).toBe("Cora — Conta PJ • 12345-6");
  });
});

describe("S-6 — regime vigente na data (versões do perfil)", () => {
  it("troca de regime no meio do ano: antes vale o antigo, depois o novo", () => {
    const v1 = perfil(1, PROSPECTA, "simples_nacional", "2021-05-07", false);
    const v2 = perfil(2, PROSPECTA, "lucro_presumido", "2026-07-01", true);
    expect(perfilVigenteNaData([v1, v2], new Date("2026-05-10T12:00:00Z"))?.regime).toBe("simples_nacional");
    expect(perfilVigenteNaData([v1, v2], AGORA)?.regime).toBe("lucro_presumido");
    expect(perfilVigenteNaData([v2], new Date("2026-01-10T12:00:00Z"))).toBeNull();
  });
});

describe("S-6 — soma por empresa (apurarReceitas)", () => {
  it("N contas por empresa somam juntas; conta sem empresa vira pendência; sem conta fica à parte", () => {
    const ap = apurarReceitas({ agora: AGORA,
      perfis: [perfil(1, PROSPECTA, "simples_nacional", undefined, true, "Prospecta"), perfil(2, VFX, "lucro_real", undefined, true, "VFX Capital")],
      contas: [conta(1, PROSPECTA, "Cora obras"), conta(2, PROSPECTA), conta(3, PROSPECTA), conta(4, VFX), conta(5, VFX), conta(6, null, "Conta nova")],
      receitas: [receita(1, 1000), receita(2, 2000), receita(3, 3000), receita(4, 50_000), receita(5, 50_000), receita(6, 777), receita(null, 123)],
      debitos: [] });
    const pro = ap.empresas.find(e => e.raiz === "41865900")!;
    expect(pro.receitaCentavos).toBe(600_000);
    expect(pro.contas.map(c => c.id)).toEqual([1, 2, 3]);
    expect(pro.contas[0]!.nome).toBe("Cora obras");
    // QA S-6 (A4): o teto + 20% (R$ 5,76 mi) é acompanhado como limite próprio (só a faixa de 100%)
    expect(pro.limites.map(l => l.chave)).toEqual(["me", "sublimite", "teto_simples", "excesso_simples"]);
    const vfx = ap.empresas.find(e => e.raiz === "58121993")!;
    expect(vfx.receitaCentavos).toBe(10_000_000);
    expect(vfx).toMatchObject({ situacao: "sem_limite", limites: [] });
    expect(ap.semEmpresa).toMatchObject({ receitaCentavos: 77_700, contas: [{ id: 6, nome: "Conta nova" }] });
    expect(ap.semConta).toEqual({ receitaCentavos: 12_300, lancamentos: 1 });
    expect(ap.ano).toBe(2026);
    expect(ap.aviso).toMatch(/apuração oficial .* contador/);
  });

  it("receita da FILIAL soma no teto da MATRIZ; a filial herda o regime da empresa", () => {
    const ap = apurarReceitas({ agora: AGORA,
      perfis: [perfil(1, EFFICAZ_MATRIZ, "simples_nacional", undefined, true, "Efficaz"), perfil(9, "21704736000110", "lucro_presumido", undefined, true, "Efficaz LTDA")],
      contas: [conta(1, EFFICAZ_MATRIZ), conta(2, EFFICAZ_FILIAL, "Canaã"), conta(3, "21704736000110")],
      receitas: [receita(1, 2_000_000), receita(2, 1_500_000), receita(3, 10)], debitos: [] });
    const efficaz = ap.empresas.find(e => e.raiz === "04578232")!;
    expect(efficaz.receitaCentavos).toBe(350_000_000);
    expect(efficaz.regime).toBe("simples_nacional");
    expect(efficaz.cnpj).toBe(EFFICAZ_MATRIZ);
    expect(efficaz.estabelecimentos).toEqual([{ cnpj: EFFICAZ_MATRIZ, matriz: true }, { cnpj: EFFICAZ_FILIAL, matriz: false }]);
    expect(efficaz.contas.find(c => c.id === 2)?.estabelecimento).toBe(EFFICAZ_FILIAL);
    expect(efficaz.limites.find(l => l.chave === "sublimite")?.faixa).toBe(95); // 3,5 mi de 3,6 mi
    // outra raiz parecida (Efficaz LTDA) é OUTRA empresa, com o regime dela
    expect(ap.empresas.find(e => e.raiz === "21704736")).toMatchObject({ regime: "lucro_presumido", receitaCentavos: 1_000 });
    expect(ap.semEmpresa.contas).toEqual([]);
  });

  it("exclui transferência entre contas da MESMA empresa e estorno; transferência de OUTRA empresa conta", () => {
    const ap = apurarReceitas({ agora: AGORA,
      perfis: [perfil(1, PROSPECTA, "simples_nacional"), perfil(2, VFX, "lucro_presumido")],
      contas: [conta(1, PROSPECTA), conta(2, PROSPECTA), conta(3, VFX)],
      receitas: [
        receita(1, 5000, "2026-04-01"),                    // entrou na conta 1 vindo da conta 2 (mesma empresa) → fora
        receita(1, 5000, "2026-04-20"),                    // mesmo valor, mas sem saída casada → conta
        receita(1, 800, "2026-04-02", { descricao: "ESTORNO PIX ENVIADO", txDescricao: "ESTORNO PIX ENVIADO" }), // estorno (lançamento) → fora
        receita(1, 700, "2026-04-02", { descricao: "PIX recebido", txDescricao: "ESTORNO PIX ENVIADO" }), // QA S-6 (A2): só a movimentação diz → CONTA
        receita(1, 3000, "2026-04-03"),                    // veio da conta da VFX (outra empresa) → conta
        receita(1, 200, "2026-04-04", { tipo: "reembolso" }),
      ],
      // QA2 S-6 (N1): só a saída marcada como Transferência interna casa
      debitos: [{ txId: 10, contaId: 2, valorCentavos: 500_000, data: new Date("2026-04-01T12:00:00Z"), classificacao: "transferencia" },
        { txId: 11, contaId: 3, valorCentavos: 300_000, data: new Date("2026-04-03T12:00:00Z"), classificacao: "transferencia" },
        { txId: 12, contaId: 1, valorCentavos: 500_000, data: new Date("2026-04-20T12:00:00Z"), classificacao: "transferencia" }], // saída da PRÓPRIA conta não casa
    });
    const pro = ap.empresas.find(e => e.raiz === "41865900")!;
    expect(pro.receitaCentavos).toBe(500_000 + 300_000 + 20_000 + 70_000);
    expect(pro.reembolsosCentavos).toBe(20_000);
    expect(pro.foraDaSoma).toEqual({ transferenciasCentavos: 500_000, transferencias: 1, estornosCentavos: 80_000, estornos: 1 });
  });

  it("estorno pela descrição", () => {
    expect(ehEstorno("Estorno de PIX")).toBe(true);
    expect(ehEstorno(null, "DEVOLUÇÃO TED")).toBe(true);
    expect(ehEstorno("Recebimento parcela obra")).toBe(false);
  });

  it("Presumido: 78 mi com faixas; Real sem aviso; a confirmar sem limite; troca de regime no meio do ano usa o regime de hoje", () => {
    const ap = apurarReceitas({ agora: AGORA,
      perfis: [perfil(1, PROSPECTA, "lucro_presumido"), perfil(2, VFX, "lucro_real"), perfil(3, EFFICAZ_MATRIZ, "a_confirmar"),
        perfil(4, "39740145000164", "simples_nacional", "2021-01-01", false), perfil(5, "39740145000164", "lucro_presumido", "2026-07-01", true)],
      contas: [conta(1, PROSPECTA), conta(2, VFX), conta(3, EFFICAZ_MATRIZ), conta(4, "39740145000164")],
      receitas: [receita(1, 74_200_000), receita(2, 90_000_000), receita(3, 5_000_000), receita(4, 4_900_000)], debitos: [] });
    const pro = ap.empresas.find(e => e.raiz === "41865900")!;
    expect(pro.limites).toHaveLength(1);
    expect(pro.limites[0]).toMatchObject({ chave: "presumido", faixa: 95, faltaCentavos: (78_000_000 - 74_200_000) * 100 });
    expect(ap.empresas.find(e => e.raiz === "58121993")).toMatchObject({ situacao: "sem_limite", limites: [] });
    expect(ap.empresas.find(e => e.raiz === "04578232")).toMatchObject({ situacao: "a_confirmar", limites: [], regimeRotulo: "A confirmar com o contador" });
    // Eficaz: Simples até junho, Presumido desde julho → hoje vale o Presumido (4,9 mi passaria o teto do Simples, mas não é o regime de hoje)
    const eficaz = ap.empresas.find(e => e.raiz === "39740145")!;
    expect(eficaz.regime).toBe("lucro_presumido");
    expect(eficaz.limites.map(l => l.chave)).toEqual(["presumido"]);
    expect(eficaz.limites[0]!.faixa).toBe(0);
  });
});
