// Pedido de 18/10 (item 4): todo envio de arquivo mostra o progresso real
// ("Enviando foto 2 de 4 — 65%"). As mutações de upload do tRPC vão por
// XMLHttpRequest, que informa os bytes enviados (o fetch do tRPC não informa),
// e o progresso aparece na barra fixa <BarraEnvioGlobal /> em qualquer tela.

import superjson from "superjson";
import { enviarJsonComProgresso } from "./comprimir-imagem";

export type EstadoEnvio = {
  /** "foto", "documento", "contrato"… */
  item: string;
  atual: number;
  total: number;
  /** 0 a 1 do arquivo atual. */
  fracao: number;
} | null;

type Ouvinte = (estado: EstadoEnvio) => void;
const ouvintes = new Set<Ouvinte>();

export function assinarEnvio(ouvinte: Ouvinte): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/** Publica o progresso de um envio feito fora do tRPC (ex.: fotos da obra). */
export function publicarEnvio(estado: EstadoEnvio) {
  ouvintes.forEach(ouvinte => ouvinte(estado));
}

export function textoEnvio(estado: NonNullable<EstadoEnvio>): string {
  const pct = Math.round(Math.min(1, Math.max(0, estado.fracao)) * 100);
  const qual = estado.total > 1 ? `${estado.item} ${estado.atual} de ${estado.total}` : estado.item;
  return pct >= 100 ? `Processando ${qual}…` : `Enviando ${qual} — ${pct}%`;
}

/**
 * Vários arquivos num único envio (ex.: fotos do imóvel): converte o progresso
 * total em "foto N de M" pelos tamanhos de cada arquivo no corpo da requisição.
 */
export function estadoPorTamanhos(item: string, tamanhos: number[], fracaoTotal: number): NonNullable<EstadoEnvio> {
  const total = tamanhos.reduce((a, b) => a + b, 0);
  if (!tamanhos.length || total <= 0) return { item, atual: 1, total: 1, fracao: fracaoTotal };
  const enviados = fracaoTotal * total;
  let acumulado = 0;
  for (let i = 0; i < tamanhos.length; i++) {
    if (enviados < acumulado + tamanhos[i] || i === tamanhos.length - 1) {
      return { item, atual: i + 1, total: tamanhos.length, fracao: Math.min(1, (enviados - acumulado) / tamanhos[i]) };
    }
    acumulado += tamanhos[i];
  }
  return { item, atual: tamanhos.length, total: tamanhos.length, fracao: 1 };
}

export type OpcoesEnvio = {
  item?: string;
  atual?: number;
  total?: number;
  /** Tamanho de cada arquivo quando vários vão na mesma requisição. */
  tamanhos?: number[];
};

/** Chama uma mutação do tRPC (ex.: "portal.uploadSignedContract") mostrando o progresso de envio. */
/**
 * A Vercel recusa corpos acima de 4,5 MB antes de chegar ao servidor (revisão do
 * Codex, 18/10): o envio é barrado antes, com uma orientação clara.
 */
export const LIMITE_ENVIO_BYTES = 4_200_000;
export const MENSAGEM_LIMITE_ENVIO = "O envio passa do limite de 4 MB por vez. Envie menos fotos ou arquivos agora e acrescente os outros depois, pela edição.";

export async function mutarComProgresso<T = unknown>(procedimento: string, entrada: unknown, opcoes: OpcoesEnvio = {}): Promise<T> {
  const serializado = superjson.serialize(entrada);
  if (JSON.stringify(serializado).length > LIMITE_ENVIO_BYTES) throw new Error(MENSAGEM_LIMITE_ENVIO);
  const item = opcoes.item ?? "arquivo";
  const estado = (fracao: number): NonNullable<EstadoEnvio> =>
    opcoes.tamanhos?.length
      ? estadoPorTamanhos(item, opcoes.tamanhos, fracao)
      : { item, atual: opcoes.atual ?? 1, total: opcoes.total ?? 1, fracao };
  publicarEnvio(estado(0));
  try {
    const { status, dados } = await enviarJsonComProgresso(`/api/trpc/${procedimento}`, serializado, fracao =>
      publicarEnvio(estado(fracao))
    );
    const corpo = dados as { result?: { data?: unknown }; error?: { json?: { message?: string } } } | null;
    if (status >= 200 && status < 300 && corpo?.result) {
      return superjson.deserialize(corpo.result.data as Parameters<typeof superjson.deserialize>[0]) as T;
    }
    const mensagem = corpo?.error?.json?.message;
    if (mensagem) throw new Error(mensagem);
    if (status === 401 || status === 403) throw new Error("Sessão expirada ou sem permissão. Entre novamente.");
    if (status === 413) throw new Error("Arquivo grande demais para o servidor.");
    throw new Error(`Erro ao enviar (código ${status}).`);
  } finally {
    publicarEnvio(null);
  }
}
