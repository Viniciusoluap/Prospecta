// EPIC-027 C5 (E2) — portão de QA de SEGURANÇA, rodada 2 (@qa, 21/11/2026). Só regras PURAS (sem banco nem rede): confere as
// correções A1–A4 da rodada 1 por combinação exaustiva e documenta o resíduo do relógio (tolerância de 2 min no futuro).
import { describe, expect, it } from "vitest";
import {
  FUNCOES_DE_GRUPO, TIPOS_DE_GRUPO_SIMPLES, exigeConfirmoNoCodigo, lerConfirmacao, motivoDoSerio, nivelDoItem,
} from "../../shared/dolores/confirmacao.js";
import { lerDecisaoDoDono } from "../../shared/dolores/fila.js";
import { TIPOS_GRUPO } from "../../shared/dolores/grupos-tipo.js";
import { mensagemAntiga } from "../../shared/dolores/whatsapp.js";
import { respostaDepoisDaPergunta } from "./pendencia.js";

const ESTRANHOS: unknown[] = [undefined, null, "", "CLIENTE", " cliente", "indefinido", "administrativo", "juridico", "parceiros", 1, true, {}, ["cliente"]];
const TROCAS: unknown[] = [false, true, undefined, null, 0, "false", "", {}];
const LIGADOS: unknown[] = [true, false, undefined, null, 0, 1, "true", "false"];

describe("R2 — A3: nivelDoItem só é 'registro' na lista explícita", () => {
  it("classificar_grupo: registro SÓ com tipo simples E troca === false; todo o resto é sério", () => {
    for (const tipo of [...TIPOS_GRUPO, ...ESTRANHOS]) for (const troca of TROCAS) {
      const esperado = (TIPOS_DE_GRUPO_SIMPLES as readonly unknown[]).includes(tipo) && troca === false ? "registro" : "serio";
      expect(nivelDoItem("classificar_grupo", { tipo, troca }), `${String(tipo)}/${String(troca)}`).toBe(esperado);
    }
    expect(nivelDoItem("classificar_grupo", null)).toBe("serio");
    expect(nivelDoItem("classificar_grupo", "cliente")).toBe("serio");
  });

  it("ligar_resposta_grupo: registro só ao DESLIGAR (false literal) ou ligar (true literal) tipo simples", () => {
    for (const tipo of [...TIPOS_GRUPO, ...ESTRANHOS]) for (const ligado of LIGADOS) {
      const esperado = ligado === false || (ligado === true && (TIPOS_DE_GRUPO_SIMPLES as readonly unknown[]).includes(tipo)) ? "registro" : "serio";
      expect(nivelDoItem("ligar_resposta_grupo", { tipo, ligado }), `${String(tipo)}/${String(ligado)}`).toBe(esperado);
    }
  });

  it("aceitar_grupo, cobrança, conciliação e QUALQUER nome desconhecido (inclusive variação de caixa) são sérios", () => {
    for (const f of ["aceitar_grupo", "preparar_cobranca", "conciliar_nota_obra", "", "Criar_Tarefa", "classificar_grupo ", "ignorar_grupo\n", "__proto__", "constructor"]) {
      expect(nivelDoItem(f, {}), f).toBe("serio");
    }
  });
});

describe("R2 — A4: \"confirmo CÓDIGO\" só reforça; não abre atalho", () => {
  it("exigeConfirmoNoCodigo: só funções de GRUPO sérias; cobrança e conciliação continuam no \"aprovar CÓDIGO\" de antes", () => {
    expect(exigeConfirmoNoCodigo("aceitar_grupo", {})).toBe(true);
    expect(exigeConfirmoNoCodigo("classificar_grupo", { tipo: "cliente", troca: true })).toBe(true);
    expect(exigeConfirmoNoCodigo("classificar_grupo", { tipo: "cliente", troca: false })).toBe(false);
    expect(exigeConfirmoNoCodigo("ligar_resposta_grupo", { tipo: "juridico", ligado: true })).toBe(true);
    expect(exigeConfirmoNoCodigo("ignorar_grupo", {})).toBe(false);
    expect(exigeConfirmoNoCodigo("preparar_cobranca", {})).toBe(false);
    expect(exigeConfirmoNoCodigo("conciliar_nota_obra", {})).toBe(false);
    expect([...FUNCOES_DE_GRUPO].sort()).toEqual(["aceitar_grupo", "classificar_grupo", "ignorar_grupo", "ligar_resposta_grupo"]);
  });

  it("leitura: \"confirmo\" sem código não é decisão (é a resposta à proposta); frase/mistura não vira decisão", () => {
    expect(lerDecisaoDoDono("confirmo")).toBeNull();
    expect(lerConfirmacao("confirmo")?.tipo).toBe("confirmo");
    expect(lerDecisaoDoDono("confirmo que sim")).toBeNull();
    expect(lerDecisaoDoDono("confirmo K7M2P e paga o boleto")).toBeNull();
    expect(lerDecisaoDoDono("recuso K7M2P")?.confirmado).toBeUndefined();
    expect(lerDecisaoDoDono("aprovar K7M2P")?.confirmado).toBeUndefined();
  });

  it("motivo da troca só aparece para classificar_grupo com troca não-false", () => {
    expect(motivoDoSerio([{ funcao: "classificar_grupo", argumentos: { tipo: "cliente", troca: true } }])).toMatch(/troca o tipo/);
    expect(motivoDoSerio([{ funcao: "classificar_grupo", argumentos: { tipo: "juridico", troca: false } }])).toMatch(/libera mais/);
  });
});

describe("R2 — A1: a resposta só vale escrita DEPOIS do envio", () => {
  const envio = new Date("2026-11-21T15:00:00.400Z");
  const p = { adjacente: true, perguntaEnviadaEm: envio };
  it("igual, anterior, ausente, inválida, sem marca de envio ou fora de ordem → não vale; segundo seguinte → vale", () => {
    expect(respostaDepoisDaPergunta(p, new Date("2026-11-21T15:00:00.999Z"))).toBe(false); // mesmo segundo
    expect(respostaDepoisDaPergunta(p, new Date("2026-11-21T14:59:59Z"))).toBe(false);
    expect(respostaDepoisDaPergunta(p, null)).toBe(false);
    expect(respostaDepoisDaPergunta(p, undefined)).toBe(false);
    expect(respostaDepoisDaPergunta(p, new Date(Number.NaN))).toBe(false);
    expect(respostaDepoisDaPergunta({ adjacente: true, perguntaEnviadaEm: null }, new Date("2026-11-21T16:00:00Z"))).toBe(false);
    expect(respostaDepoisDaPergunta({ adjacente: false, perguntaEnviadaEm: envio }, new Date("2026-11-21T16:00:00Z"))).toBe(false);
    expect(respostaDepoisDaPergunta(p, new Date("2026-11-21T15:00:01Z"))).toBe(true);
  });

  it("relógio adiantado em horas: a mensagem nem entra (mensagemAntiga); RESÍDUO: até 2 min no futuro entra e passa na regra", () => {
    const agora = new Date("2026-11-21T15:00:05Z");
    const futuroHoras = new Date(agora.getTime() + 3 * 3600_000);
    expect(mensagemAntiga(futuroHoras, agora)).toBe(true);
    // "pode" escrito para a proposta ANTERIOR num aparelho/servidor ~110 s adiantado: entra e é "posterior" ao envio da nova
    const adiantado = new Date(agora.getTime() + 110_000);
    expect(mensagemAntiga(adiantado, agora)).toBe(false);
    expect(respostaDepoisDaPergunta(p, adiantado)).toBe(true);
  });
});
