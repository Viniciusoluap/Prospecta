import Anthropic from "@anthropic-ai/sdk";
import { ENV } from "./env.js";
import { normalizarComparaveis } from "../../shared/avaliacao-comparaveis.js";

/** Pesquisa equivalente à central Santa Fé, com os dados oficiais da avaliação. */
export async function buscarComparaveis(input: { bairro: string; cidade: string; estado: string; tipo: string }) {
  if (!ENV.anthropicApiKey) throw new Error("A busca de comparáveis precisa da integração de IA configurada.");
  const negocio = input.tipo === "locacao" ? "aluguel" : "venda";
  const slug = (value: string) => encodeURIComponent(value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, "-"));
  const url = `https://www.zapimoveis.com.br/${negocio}/imoveis/${slug(input.estado)}+${slug(input.cidade)}+${slug(input.bairro)}/`;
  const client = new Anthropic({ apiKey: ENV.anthropicApiKey });
  const response = await client.messages.create({
    model: "claude-sonnet-4-6", max_tokens: 2048,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [{ role: "user", content: `Busque anúncios reais de imóveis para ${negocio} em ${input.bairro}, ${input.cidade}/${input.estado}, nos portais ZAP Imóveis e VivaReal. Inclua até 6 anúncios com preço e área verificáveis. Não invente anúncios: sem resultados reais, retorne a lista vazia. Retorne somente JSON: {"comparaveis":[{"descricao":"","preco":0,"area":0}]}.` }],
  });
  const text = response.content.filter(block => block.type === "text").map(block => block.type === "text" ? block.text : "").join("\n");
  const start = text.indexOf("{"); const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("A busca não retornou anúncios válidos. Tente novamente.");
  return normalizarComparaveis(JSON.parse(text.slice(start, end + 1)), input.bairro, url);
}
