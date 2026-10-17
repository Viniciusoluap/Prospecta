import { describe, expect, it } from "vitest";
import { rotulo, rotuloAssinatura } from "../shared/rotulos";
import { recusaAindaVisivel, isPropertyPhotoOrSaved } from "../shared/broker-portal";
import { etapasDoProgresso } from "../shared/financeiro/detalhe-obra";
import { calcularProgresso, itensProgressoIniciais } from "../shared/financeiro/progresso";
import { estadoPorTamanhos, textoEnvio } from "../client/src/lib/envio-progresso";

describe("item 16 — nomes em português", () => {
  it("traduz etapas, obras, financiamento e situações", () => {
    expect(rotulo("lead_new")).toBe("Lead Novo");
    expect(rotulo("planning")).toBe("Planejamento");
    expect(rotulo("pre_analise")).toBe("Pré-análise");
    expect(rotulo("followup")).toBe("Projetos e Vistorias");
    expect(rotulo("solicitado")).toBe("Solicitado");
    expect(rotuloAssinatura("solicitado")).toBe("Assinatura solicitada");
    expect(rotulo("pending")).toBe("Pendente");
  });
  it("código desconhecido nunca aparece com sublinhado", () => {
    expect(rotulo("algum_codigo_novo")).toBe("Algum codigo novo");
    expect(rotulo(null)).toBe("—");
  });
});

describe("item 8 — recusado aparece 3 dias para o corretor", () => {
  const agora = new Date("2026-10-18T12:00:00Z");
  it("visível até 3 dias depois da recusa", () => {
    expect(recusaAindaVisivel(new Date("2026-10-16T12:00:00Z"), agora)).toBe(true);
    expect(recusaAindaVisivel(new Date("2026-10-15T12:00:01Z"), agora)).toBe(true);
  });
  it("some depois de 3 dias", () => {
    expect(recusaAindaVisivel(new Date("2026-10-15T12:00:00Z"), agora)).toBe(false);
    expect(recusaAindaVisivel(new Date("2026-10-01T00:00:00Z"), agora)).toBe(false);
  });
});

describe("item 3 — edição do imóvel pelo corretor", () => {
  it("aceita foto nova ou já gravada; recusa endereço externo", () => {
    expect(isPropertyPhotoOrSaved("/api/imovel-foto/12")).toBe(true);
    expect(isPropertyPhotoOrSaved("data:image/jpeg;base64,/9j/AAAA")).toBe(true);
    expect(isPropertyPhotoOrSaved("https://exemplo.com/foto.jpg")).toBe(false);
    expect(isPropertyPhotoOrSaved("/api/imovel-foto/12/../../x")).toBe(false);
  });
});

describe("item 4 — progresso do envio", () => {
  it("converte o progresso total em 'foto N de M'", () => {
    expect(estadoPorTamanhos("foto", [100, 100, 100, 100], 0.4)).toMatchObject({ atual: 2, total: 4 });
    expect(estadoPorTamanhos("foto", [100, 300], 0.5)).toMatchObject({ atual: 2, total: 2 });
    expect(textoEnvio({ item: "foto", atual: 2, total: 4, fracao: 0.65 })).toBe("Enviando foto 2 de 4 — 65%");
    expect(textoEnvio({ item: "documento", atual: 1, total: 1, fracao: 0.3 })).toBe("Enviando documento — 30%");
  });
});

describe("item 14 — etapas da obra no portal do cliente", () => {
  it("só etapas com incidência, com a situação de cada uma", () => {
    const itens = itensProgressoIniciais().map(i =>
      i.chave === "preliminares" ? { ...i, execucao: "100" } : i.chave === "infraestrutura" ? { ...i, execucao: "50" } : i
    );
    const etapas = etapasDoProgresso(calcularProgresso(itens));
    expect(etapas.find(e => e.chave === "preliminares")?.situacao).toBe("concluida");
    expect(etapas.find(e => e.chave === "infraestrutura")?.situacao).toBe("em_andamento");
    expect(etapas.find(e => e.chave === "vidros")).toBeUndefined(); // incidência 0
  });
});

describe("itens 10 e 11 — painel do lead para quem só tem CRM (revisão do Codex no PR #133)", () => {
  it("agenda a visita pelo CRM; contrato continua exigindo o Jurídico", async () => {
    const { canAccessAdminProcedure } = await import("./_core/trpc");
    const soCrm = { role: "colaborador", permissions: JSON.stringify(["crm"]) };
    expect(canAccessAdminProcedure(soCrm, "portal.admin.visitOptions")).toBe(true);
    expect(canAccessAdminProcedure(soCrm, "portal.admin.scheduleVisit")).toBe(true);
    expect(canAccessAdminProcedure(soCrm, "juridico.createFromLead")).toBe(false);
  });
  it("valor do contrato com ponto decimal não é multiplicado por 100", async () => {
    const { parseNumeroBR } = await import("../shared/numero-br");
    expect(parseNumeroBR("1234.56")).toBe(1234.56);
    expect(parseNumeroBR("1.234,56")).toBe(1234.56);
  });
});

describe("revisão do Codex (18/10) — limite de envio da Vercel", () => {
  it("barra envio acima de 4,2 MB antes de enviar", async () => {
    const { mutarComProgresso } = await import("../client/src/lib/envio-progresso");
    await expect(mutarComProgresso("x.y", { fotos: ["a".repeat(4_300_000)] })).rejects.toThrow(/limite de 4 MB/);
  });
});
