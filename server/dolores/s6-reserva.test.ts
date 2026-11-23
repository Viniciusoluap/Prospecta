// EPIC-029 S-6 (junção com a S-3) — com 10 tipos de aviso (+ nota_fiscal, + limite_receita), as reservas de entrada cobrem o pior caso.
// Puro: estimativa por cima (memoria.ts#tokensEstimadosDoTexto), sem banco nem rede.
import { describe, expect, it } from "vitest";
import { SISTEMA_AVISOS, TIPOS_AVISO, TIPOS_COLETADOS, agruparPorTipo, dadosParaIA, type AchadoPendente } from "../../shared/dolores/avisos.js";
import { LIMITES, type ChaveLimite } from "../../shared/fiscal/regimes.js";
import { RESERVA_ENTRADA_AVISO } from "./avisos.js";
import { RESERVA_MINIMA_ENTRADA, SOBRECARGA_DE_FERRAMENTAS, ferramentasParaOModelo } from "./cerebro.js";
import { tokensEstimadosDoTexto } from "./memoria.js";
import { ferramentasDoWhatsapp } from "./ponte.js";
import { promptSistemaWhatsapp } from "./prompt.js";

const AGORA = new Date("2026-11-16T12:00:00Z");

describe("S-6 — reservas de entrada com os 10 tipos de aviso", () => {
  it("TIPOS_AVISO tem os 8 de antes + nota_fiscal (S-3) + limite_receita (S-6)", () => {
    expect(TIPOS_AVISO).toHaveLength(10);
    expect(TIPOS_AVISO.slice(-2)).toEqual(["nota_fiscal", "limite_receita"]);
  });

  it(`RESERVA_ENTRADA_AVISO (${RESERVA_ENTRADA_AVISO}) cobre o pior caso: todos os tipos × 25 itens, nomes longos, limite com o rótulo mais longo e "a classificar"`, () => {
    const longo = "Nome Bem Comprido de Cliente Para Medir o Pior Caso ".repeat(4);
    const maisLongo = (Object.keys(LIMITES) as ChaveLimite[]).sort((a, b) => (LIMITES[b].rotulo + LIMITES[b].consequencia).length - (LIMITES[a].rotulo + LIMITES[a].consequencia).length)[0]!;
    const achados: AchadoPendente[] = [];
    let id = 0;
    for (const tipo of TIPOS_COLETADOS) for (let i = 0; i < 25; i++) achados.push({ id: ++id, tipo, entidade: `${tipo}:${i}`, faixa: 3, faixaAvisada: 1,
      dados: { nome: longo, dias: 999, quantidade: 99, marca: tipo === "nota_fiscal" ? "adiada_vencida" : "sem_dono", valorCentavos: 99_999_999_99, servico: longo, municipio: longo,
        ref: { tipo: "obra", id }, limite: maisLongo, percentual: 999.9, faltaCentavos: 99_999_999_99, ano: 2026, aClassificarCentavos: 99_999_999_99 } });
    achados.push({ id: ++id, tipo: "nota_fiscal", entidade: "resumo", faixa: 1, faixaAvisada: null, dados: { nome: "resumo do dia", resumo: true, quantidade: 25, valorCentavos: 99_999_999_99 } });
    const entrada = tokensEstimadosDoTexto(SISTEMA_AVISOS) + tokensEstimadosDoTexto(dadosParaIA(agruparPorTipo(achados), AGORA));
    console.log(`[medida] aviso pior caso = ${entrada} (reserva ${RESERVA_ENTRADA_AVISO})`);
    expect(entrada).toBeLessThanOrEqual(RESERVA_ENTRADA_AVISO);
  });

  it(`RESERVA_MINIMA_ENTRADA (${RESERVA_MINIMA_ENTRADA}) cobre o pior prefixo (todas as ferramentas, inclusive consultar_limites_receita e as fiscais) com folga ≥ 1.000`, () => {
    const ferramentas = ferramentasParaOModelo(ferramentasDoWhatsapp());
    expect(ferramentas.map(f => f.name)).toContain("consultar_limites_receita");
    const prefixo = tokensEstimadosDoTexto(promptSistemaWhatsapp(false)) + tokensEstimadosDoTexto(JSON.stringify(ferramentas)) + SOBRECARGA_DE_FERRAMENTAS;
    console.log(`[medida] prefixo pior caso = ${prefixo} (piso ${RESERVA_MINIMA_ENTRADA})`);
    expect(RESERVA_MINIMA_ENTRADA - prefixo).toBeGreaterThanOrEqual(1_000);
  });
});
