import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

describe("metadados públicos", () => {
  it("publica as rotas comerciais no sitemap sem áreas privadas", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain("https://prospectaconstrucoes.com");
    expect(urls).toContain("https://prospectaconstrucoes.com/simulador");
    expect(urls).toContain("https://prospectaconstrucoes.com/sorteios");
    expect(urls).toContain("https://prospectaconstrucoes.com/utef");
    expect(urls.some((url) => url.includes("/admin"))).toBe(false);
    expect(urls.some((url) => url.includes("/perfil"))).toBe(false);
  });

  it("impede indexação de APIs e áreas autenticadas", () => {
    const config = robots();
    const rules = Array.isArray(config.rules) ? config.rules[0] : config.rules;
    expect(rules.disallow).toContain("/admin/");
    expect(rules.disallow).toContain("/api/");
    expect(rules.disallow).toContain("/portal/");
    expect(config.sitemap).toBe("https://prospectaconstrucoes.com/sitemap.xml");
  });
});
