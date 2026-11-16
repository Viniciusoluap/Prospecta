// EPIC-025 (Dolores) — interruptores dos dados pessoais (QA r7 A3/A4): valores estranhos falham fechado.
import { afterEach, describe, expect, it, vi } from "vitest";
import { campoPessoal, esquecerAvisosDoInterruptor, filtroDaSaida, mascararDadosPessoais } from "./dados-pessoais.js";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); esquecerAvisosDoInterruptor(); });

describe("QA r7 A4: DOLORES_MASCARAR_DADOS_PESSOAIS falha fechado", () => {
  it("libera só com ausente, vazio, 0, false, nao, não, off, no (caixa, espaços e aspas não importam)", () => {
    vi.unstubAllEnvs();
    delete process.env.DOLORES_MASCARAR_DADOS_PESSOAIS;
    expect(mascararDadosPessoais("whatsapp")).toBe(false);
    for (const v of ["", " ", "0", " 0 ", "false", "FALSE", "nao", "NÃO", "não", "off", "Off", "no", "\"0\"", "'false'", "0\n"]) {
      vi.stubEnv("DOLORES_MASCARAR_DADOS_PESSOAIS", v);
      expect(mascararDadosPessoais("whatsapp"), JSON.stringify(v)).toBe(false);
      expect(filtroDaSaida("whatsapp").mascararDadosPessoais, JSON.stringify(v)).toBe(false);
    }
  });

  it("qualquer outro valor mascara; valor não reconhecido avisa no log uma vez, sem o valor", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const v of ["1", " 1 ", "1\n", "true", "TRUE", "sim", "on", "yes", "S", "01", "2", "\"1\"", "1 # comentário", "segredo-xyz"]) {
      vi.stubEnv("DOLORES_MASCARAR_DADOS_PESSOAIS", v);
      expect(mascararDadosPessoais("whatsapp"), JSON.stringify(v)).toBe(true);
      expect(campoPessoal("52998224725", "cpf", "whatsapp"), JSON.stringify(v)).not.toContain("5299822");
    }
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(String(aviso.mock.calls[0][0])).not.toMatch(/true|segredo|comentário/);
  });
});

describe("QA r7 A3: DOLORES_PONTE_DADOS_PESSOAIS (canal ponte) — mascarado por padrão", () => {
  it("libera só com 1, true, sim, on, yes; ausente, 0 e qualquer outro valor mascaram (independente do WhatsApp)", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    delete process.env.DOLORES_PONTE_DADOS_PESSOAIS;
    vi.stubEnv("DOLORES_MASCARAR_DADOS_PESSOAIS", "0"); // WhatsApp liberado
    expect(mascararDadosPessoais("whatsapp")).toBe(false);
    expect(mascararDadosPessoais("ponte")).toBe(true);
    expect(campoPessoal("52998224725", "cpf", "ponte")).not.toContain("5299822");
    expect(campoPessoal("maria@x.com", "email", "ponte")).toBeUndefined();
    for (const v of ["", "0", "false", "não", "off", "talvez", "2", "\"sim\" # x"]) {
      vi.stubEnv("DOLORES_PONTE_DADOS_PESSOAIS", v);
      expect(mascararDadosPessoais("ponte"), JSON.stringify(v)).toBe(true);
    }
    for (const v of ["1", "true", "TRUE", " sim ", "on", "yes", "\"1\""]) {
      vi.stubEnv("DOLORES_PONTE_DADOS_PESSOAIS", v);
      expect(mascararDadosPessoais("ponte"), JSON.stringify(v)).toBe(false);
      expect(filtroDaSaida("ponte").mascararDadosPessoais).toBe(false);
      expect(campoPessoal("52998224725", "cpf", "ponte")).toBe("52998224725");
    }
    // a ponte liberada não libera o WhatsApp mascarado
    vi.stubEnv("DOLORES_MASCARAR_DADOS_PESSOAIS", "1");
    expect(mascararDadosPessoais("whatsapp")).toBe(true);
    expect(aviso).toHaveBeenCalledTimes(1); // "talvez" (o "2" e o "sim # x" não repetem o aviso)
  });
});
