// Dolores, Etapa 3 — conferência final de QA (16/11): o texto que o dono manda gravar nunca pode ficar diferente do que
// ele lê. Funções puras; sem banco e sem rede.
import { afterEach, describe, expect, it } from "vitest";
import { temCaractereInvisivel } from "../../shared/dolores/fila.js";
import { LINK_REMOVIDO, tratarLinksDaResposta } from "../../shared/dolores/links.js";
import { FRASE_TEXTO_COM_INVISIVEL, FRASE_TEXTO_MUTILADO, textoDoDono } from "./acoes/comum.js";

const antes = process.env.DOLORES_MASCARAR_DADOS_PESSOAIS;
afterEach(() => {
  if (antes === undefined) delete process.env.DOLORES_MASCARAR_DADOS_PESSOAIS;
  else process.env.DOLORES_MASCARAR_DADOS_PESSOAIS = antes;
});

describe("QA final E3 — texto do dono", () => {
  it("achado 1: caractere invisível que remontaria link, senha ou CPF depois da conferência é recusado", () => {
    const casos = ["ver evil.c­om agora", "se⠀nha: Maria@2025", "CPF 529.982.⠀247-25", "ligar​ para o João", "a⁦b", "xㅤy", "tag\u{E0041}escondida"];
    for (const c of casos) {
      expect(temCaractereInvisivel(c), c).toBe(true);
      expect(() => textoDoDono(c), c).toThrow(FRASE_TEXTO_COM_INVISIVEL);
    }
    for (const modo of ["0", "1"]) {
      process.env.DOLORES_MASCARAR_DADOS_PESSOAIS = modo;
      expect(() => textoDoDono("ver evil.c­om agora")).toThrow(FRASE_TEXTO_COM_INVISIVEL);
    }
  });

  it("achado 1: texto comum, com acento, quebra de linha e pontuação, continua aceito e volta idêntico", () => {
    delete process.env.DOLORES_MASCARAR_DADOS_PESSOAIS;
    for (const c of ["Ligar para a Bianca amanhã às 10:30", "Conferir a matrícula do lote 12B\nna segunda-feira", "Enviar contrato.pdf ao João — urgente!"]) {
      expect(temCaractereInvisivel(c), c).toBe(false);
      expect(textoDoDono(c)).toBe(c);
    }
  });

  it("achado 2: pedido que já chegou mutilado pelo filtro (marcador no texto) é recusado com orientação", () => {
    for (const c of ["pedir a senha [senha omitida]", "depositar na [dado bancário omitido]", "ligar para [dado pessoal omitido]", "abrir [link removido] hoje"]) {
      expect(() => textoDoDono(c), c).toThrow(FRASE_TEXTO_MUTILADO);
    }
  });
});

describe("QA final E3 — links com ponto disfarçado (achado 3)", () => {
  it("ponto de largura total, ideográfico ou de meia largura entre letras conta como ponto", () => {
    for (const p of ["．", "。", "｡"]) {
      const r = tratarLinksDaResposta(`veja evil${p}com/52998224725 agora`, "https://sistema.example");
      expect(r, p).toContain(LINK_REMOVIDO);
      expect(r, p).not.toContain("52998224725");
    }
  });
  it("texto sem link nem ponto disfarçado volta idêntico", () => {
    const t = "Processo em dia. Próximo passo: protocolar na prefeitura.";
    expect(tratarLinksDaResposta(t, "https://sistema.example")).toBe(t);
  });
});
