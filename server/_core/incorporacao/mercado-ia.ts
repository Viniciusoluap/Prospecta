import Anthropic from "@anthropic-ai/sdk";
import { ENV } from "../env";

// Pesquisa da cidade + estudo de mercado imobiliário via IA com busca web:
// perfil socioeconômico do município, oferta/demanda, preço médio do m² por
// produto (lote, casa, apartamento), velocidade de absorção e concorrentes.
// Porta direta da lógica do Grupo Santa Fé (web/src/app/api/incorporacao/mercado/route.ts),
// incluindo o mesmo controle de custo: desativada por padrão, só roda com
// INCORPORACAO_IA_ATIVA=1 (evita consumo de créditos e travamentos).

export interface CidadeResearch {
  populacao: number;
  crescimentoAnualPct: number;
  pibPerCapita: number;
  principaisAtividades: string[];
  rendaMediaMensal: number;
  deficitHabitacional: string;
  resumo: string;
}

export interface MercadoStudy {
  precoM2Lote: number;
  precoM2Casa: number;
  precoM2Apartamento: number;
  velocidadeVendas: string;
  demandaPorProduto: { produto: string; demanda: string; publico: string }[];
  concorrentes: { nome: string; produto: string; faixaPreco: string }[];
  comparaveis: { descricao: string; preco: number; area: number; precoPorM2: number }[];
  oportunidades: string;
  riscos: string;
}

export interface PesquisaMercadoResult {
  cidade: CidadeResearch;
  mercado: MercadoStudy;
  fontes: string[];
  confiabilidade: "alta" | "media" | "baixa";
}

export async function pesquisarMercado(municipio: string, estado: string): Promise<PesquisaMercadoResult> {
  if (!ENV.incorporacaoIaAtiva) {
    throw new Error("IA desativada. Informe os comparáveis de mercado manualmente (defina INCORPORACAO_IA_ATIVA=1 para habilitar).");
  }
  if (!ENV.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY não configurada nas variáveis de ambiente.");
  }

  const client = new Anthropic({ apiKey: ENV.anthropicApiKey });

  const prompt = `Você é um analista de mercado imobiliário especializado no Maranhão e na metodologia de estudo de mercado para incorporação.

Pesquise na web dados atuais sobre ${municipio}/${estado} e produza a pesquisa da cidade + estudo de mercado imobiliário. Use fontes como IBGE, prefeitura, portais imobiliários (ZAP, VivaReal, OLX) e notícias econômicas locais.

Retorne SOMENTE o JSON abaixo, sem texto extra, sem markdown:
{
"cidade":{"populacao":0,"crescimentoAnualPct":0,"pibPerCapita":0,"principaisAtividades":[""],"rendaMediaMensal":0,"deficitHabitacional":"","resumo":""},
"mercado":{
 "precoM2Lote":0,"precoM2Casa":0,"precoM2Apartamento":0,
 "velocidadeVendas":"","demandaPorProduto":[{"produto":"","demanda":"alta|media|baixa","publico":""}],
 "concorrentes":[{"nome":"","produto":"","faixaPreco":""}],
 "comparaveis":[{"descricao":"","preco":0,"area":0,"precoPorM2":0}],
 "oportunidades":"","riscos":""
},
"fontes":[""],"confiabilidade":"alta|media|baixa"
}

Valores em R$ inteiros. Máx. 4 concorrentes e 4 comparáveis. Em "resumo", 2-3 frases sobre o momento econômico da cidade. Seja factual: se um dado não for encontrado, use 0 ou "" e reduza a confiabilidade.`;

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4096,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [{ role: "user", content: prompt }],
  });

  let jsonText = "";
  for (const block of response.content) {
    if (block.type === "text") jsonText += block.text;
  }
  jsonText = jsonText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Nenhum JSON encontrado na resposta da IA.");
  }
  return JSON.parse(jsonText.slice(start, end + 1)) as PesquisaMercadoResult;
}
