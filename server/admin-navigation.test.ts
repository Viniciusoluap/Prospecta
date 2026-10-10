import { describe, expect, it } from "vitest";
import { hasPageBackButton } from "../client/src/components/GlobalBackButton";

describe("retorno único das rotas administrativas", () => {
  it("não sobrepõe o menu do painel nem retornos próprios dos módulos", () => {
    for (const route of [
      "/admin", "/admin/corretores", "/admin/comissoes", "/admin/projetos",
      "/admin/mapa", "/admin/regularizacoes", "/admin/obras/42",
    ]) {
      expect(hasPageBackButton(route), route).toBe(true);
    }
  });

  it("mantém o retorno global em rotas sem cabeçalho contextual", () => {
    expect(hasPageBackButton("/admin/rota-sem-retorno")).toBe(false);
  });
});
