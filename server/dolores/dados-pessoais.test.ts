// EPIC-025 (Dolores) — interruptores dos dados pessoais (QA r7 A3/A4): valores estranhos falham fechado.
import { afterEach, describe, expect, it, vi } from "vitest";
import { campoPessoal, esquecerAvisosDoInterruptor, filtroDaSaida, mascararDadosPessoais } from "./dados-pessoais.js";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); esquecerAvisosDoInterruptor(); });

describe("QA r7 A4: DOLORES_MASCARAR_DADOS_PESSOAIS falha fechado", () => {
  it("libera só com ausente, vazio, 0, false, nao, não, off, no (caixa, espaços e aspas não importam)", () => {
    vi.unstubAllEnvs();
    delete process.env.DOLORES_MASCARAR_DADOS_PESSOAIS;
    expect(mascararDadosPessoais()).toBe(false);
    for (const v of ["", " ", "0", " 0 ", "false", "FALSE", "nao", "NÃO", "não", "off", "Off", "no", "\"0\"", "'false'", "0\n"]) {
      vi.stubEnv("DOLORES_MASCARAR_DADOS_PESSOAIS", v);
      expect(mascararDadosPessoais(), JSON.stringify(v)).toBe(false);
      expect(filtroDaSaida().mascararDadosPessoais, JSON.stringify(v)).toBe(false);
    }
  });

  it("qualquer outro valor mascara; valor não reconhecido avisa no log uma vez, sem o valor", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const v of ["1", " 1 ", "1\n", "true", "TRUE", "sim", "on", "yes", "S", "01", "2", "\"1\"", "1 # comentário", "segredo-xyz"]) {
      vi.stubEnv("DOLORES_MASCARAR_DADOS_PESSOAIS", v);
      expect(mascararDadosPessoais(), JSON.stringify(v)).toBe(true);
      expect(campoPessoal("52998224725", "cpf"), JSON.stringify(v)).not.toContain("5299822");
    }
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(String(aviso.mock.calls[0][0])).not.toMatch(/true|segredo|comentário/);
  });
});
