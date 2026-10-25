// Pedido de 25/10: templates preenchidos, endereço da Evolution e conversas. Nada externo é chamado.
import { describe, expect, it, vi } from "vitest";
import { listaPorExtenso, preencherTemplate, primeiroNome, variaveisDoTexto } from "../shared/whatsapp/variaveis";
import { mesmoTelefone, normalizarUrlEvolution, registrarWebhookEvolution, textoDaMensagem } from "./_core/evolution";

describe("variáveis do template", () => {
  it("preenche por destinatário e aponta o que falta", () => {
    const t = "Olá {{nome}}, sobre {{servico}} com {{ corretor }}. {{horario}}";
    expect(variaveisDoTexto(t)).toEqual(["nome", "servico", "corretor", "horario"]);
    const r = preencherTemplate(t, { nome: "Ana", servico: "Construção e Financiamento", corretor: "Paulo" });
    expect(r.texto).toBe("Olá Ana, sobre Construção e Financiamento com Paulo. {{horario}}");
    expect(r.faltando).toEqual(["horario"]);
    expect(preencherTemplate(t, { nome: "Ana", servico: "x", corretor: "y", horario: "10h" }).faltando).toEqual([]);
  });
  it("primeiro nome e lista por extenso", () => {
    expect(primeiroNome("  Maria  das Dores ")).toBe("Maria");
    expect(listaPorExtenso(["Construção", "Financiamento", "Construção", "Projeto"])).toBe("Construção, Financiamento e Projeto");
    expect(listaPorExtenso([])).toBe("");
  });
});

describe("Evolution", () => {
  it("endereço sempre https e sem /manager (http fazia o POST virar GET → 404)", () => {
    expect(normalizarUrlEvolution("http://evo.up.railway.app/manager")).toBe("https://evo.up.railway.app");
    expect(normalizarUrlEvolution("evo.up.railway.app/")).toBe("https://evo.up.railway.app");
    expect(normalizarUrlEvolution("https://evo.up.railway.app")).toBe("https://evo.up.railway.app");
  });
  it("registra o webhook com cabeçalho secreto e eventos de mensagem", async () => {
    const f = vi.fn((url: string, init?: RequestInit) => {
      expect(url).toBe("https://evo.app/webhook/set/inst1");
      expect(JSON.parse(String(init?.body)).webhook).toMatchObject({
        enabled: true, url: "https://site/api/whatsapp/evolution-webhook", headers: { "x-webhook-token": "seg" },
        events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"],
      });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
    });
    await registrarWebhookEvolution({ url: "http://evo.app/manager", apiKey: "k" }, "inst1", "https://site/api/whatsapp/evolution-webhook", "seg", f as never);
  });
  it("texto de mensagens recebidas e comparação de telefone (com/sem 9º dígito)", () => {
    expect(textoDaMensagem({ conversation: "Oi" })).toBe("Oi");
    expect(textoDaMensagem({ extendedTextMessage: { text: "Tudo bem?" } })).toBe("Tudo bem?");
    expect(textoDaMensagem({ imageMessage: { caption: "planta" } })).toBe("[imagem] planta");
    expect(textoDaMensagem({ audioMessage: {} })).toBe("[áudio]");
    expect(mesmoTelefone("(94) 99304-4689", "559493044689")).toBe(true);
    expect(mesmoTelefone("94 99304-4689", "5594993044689")).toBe(true);
    expect(mesmoTelefone("94 99304-4689", "5594993044680")).toBe(false);
  });
});
