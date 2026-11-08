// Motor 2 da Inteligência de Mercado (correção 06): anúncios imobiliários + análise.
//
// Arquitetura: (1) um PROVEDOR traz anúncios brutos com link, preço e área; (2) o
// tratamento é a função pura `analisarAnuncios` (deduplicação, rejeição de anúncios
// incompletos, atípicos, mediana, faixa, confiabilidade). O provedor é isolado por
// interface para ser trocado no futuro sem tocar no tratamento.
//
// Provedor disponível hoje: busca web da API Anthropic (requer ANTHROPIC_API_KEY). Não há
// API pública GRATUITA e permitida de anúncios dos portais (ZAP/VivaReal/OLX restringem
// coleta automatizada nos termos de uso) — por isso não há raspagem direta de portais.
// Sem provedor configurado, o motor informa a indisponibilidade e NÃO bloqueia o motor 1.
// Cache de 12 h por consulta para não repetir custo.

import Anthropic from "@anthropic-ai/sdk";
import { ENV } from "../env.js";
import { analisarAnuncios, type AnaliseAnuncios, type AnuncioBruto, type TipologiaImovel } from "../../../shared/incorporacao/analise-anuncios.js";

export interface ConsultaAnuncios {
  municipio: string;
  uf: string;
  bairro?: string | null;
  tipologia: TipologiaImovel;
  areaMinM2?: number;
  areaMaxM2?: number;
}

export interface ProvedorAnuncios {
  nome: string;
  /** null = disponível; string = motivo da indisponibilidade. */
  indisponibilidade(): string | null;
  buscar(c: ConsultaAnuncios): Promise<AnuncioBruto[]>;
}

export const provedorBuscaWebAnthropic: ProvedorAnuncios = {
  nome: "Busca web (API Anthropic)",
  indisponibilidade() {
    if (ENV.incorporacaoIaDesligada) return "Pesquisa de anúncios com IA desligada pelo administrador (INCORPORACAO_IA_ATIVA=0).";
    if (!ENV.anthropicApiKey) return "Nenhum provedor de anúncios configurado: falta a chave ANTHROPIC_API_KEY no servidor. Os dados oficiais (IBGE) e os comparáveis manuais continuam funcionando.";
    return null;
  },
  async buscar(c) {
    const client = new Anthropic({ apiKey: ENV.anthropicApiKey });
    const local = `${c.bairro ? `${c.bairro}, ` : ""}${c.municipio}/${c.uf}`;
    const faixa = c.areaMinM2 || c.areaMaxM2 ? ` com área entre ${c.areaMinM2 ?? 0} e ${c.areaMaxM2 ?? "∞"} m²` : "";
    const prompt = `Pesquise na web anúncios ATUAIS de venda de imóveis do tipo "${c.tipologia}" em ${local}${faixa}, em portais imobiliários e sites de imobiliárias.

Regras obrigatórias:
- Liste SOMENTE anúncios que você efetivamente encontrou nas páginas pesquisadas, com o link (URL) da página do anúncio.
- NUNCA invente, estime ou complete anúncios, preços, áreas ou links. Se um dado não constar no anúncio, omita o anúncio.
- Preço é o preço ANUNCIADO de venda (não aluguel). Área em m².
- No máximo 25 anúncios.

Responda SOMENTE com JSON, sem texto extra:
{"anuncios":[{"titulo":"","url":"","fonte":"","bairro":"","tipologia":"","areaM2":0,"preco":0,"caracteristicas":"","dataAnuncio":""}]}`;
    const resp = await client.messages.create({
      model: ENV.incorporacaoIaModelo,
      max_tokens: 6000,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
      messages: [{ role: "user", content: prompt }],
    });
    let texto = "";
    for (const b of resp.content) if (b.type === "text") texto += b.text;
    const i = texto.indexOf("{"), j = texto.lastIndexOf("}");
    if (i < 0 || j < 0) return [];
    try {
      const json = JSON.parse(texto.slice(i, j + 1)) as { anuncios?: AnuncioBruto[] };
      return Array.isArray(json.anuncios) ? json.anuncios : [];
    } catch {
      return [];
    }
  },
};

const CACHE_MS = 12 * 60 * 60 * 1000;
const cache = new Map<string, { em: number; r: AnaliseAnuncios }>();

export type ResultadoMercadoImobiliario =
  | { status: "ok"; analise: AnaliseAnuncios; doCache: boolean }
  | { status: "indisponivel"; motivo: string; provedor: string };

export async function pesquisarMercadoImobiliario(
  c: ConsultaAnuncios, provedor: ProvedorAnuncios = provedorBuscaWebAnthropic, agora: () => Date = () => new Date()
): Promise<ResultadoMercadoImobiliario> {
  const motivo = provedor.indisponibilidade();
  if (motivo) return { status: "indisponivel", motivo, provedor: provedor.nome };
  const chave = JSON.stringify([provedor.nome, c.municipio.toLowerCase(), c.uf.toUpperCase(), (c.bairro ?? "").toLowerCase(), c.tipologia, c.areaMinM2 ?? null, c.areaMaxM2 ?? null]);
  const emCache = cache.get(chave);
  if (emCache && agora().getTime() - emCache.em < CACHE_MS) return { status: "ok", analise: emCache.r, doCache: true };
  const brutos = await provedor.buscar(c);
  const analise = analisarAnuncios(brutos, { ...c, provedor: provedor.nome }, agora().toISOString());
  cache.set(chave, { em: agora().getTime(), r: analise });
  return { status: "ok", analise, doCache: false };
}

/** Só para testes. */
export function _limparCacheAnuncios() { cache.clear(); }
