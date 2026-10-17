// Links do cliente tRPC (React e o cliente das abas da incorporação).
// Item 4 (18/10): mutações que levam arquivos vão por XMLHttpRequest para a
// barra fixa mostrar o progresso real do envio em qualquer tela.

import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import superjson from "superjson";
import { publicarEnvio } from "./envio-progresso";

/** Rotas que recebem arquivos (fotos, PDFs, documentos) no corpo da requisição. */
const ROTAS_DE_ENVIO = /upload|imoveis\.(create|update)|brokerPortal\.(createProperty|updateProperty)|avaliacoes\.(update|updateChecklist)|obraProgresso\./i;
/** Abaixo disso o envio é instantâneo: não vale mostrar barra. */
const CORPO_GRANDE = 64 * 1024;

function itemDaRota(url: string): string {
  if (/avatar|foto|image|imoveis|Property|obraProgresso/i.test(url)) return "foto";
  if (/contract|contrato|juridico/i.test(url)) return "contrato";
  return "arquivo";
}

const comCookies: typeof fetch = (input, init) => globalThis.fetch(input, { ...(init ?? {}), credentials: "include" });

export function fetchComProgresso(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const corpo = init?.body;
  if (typeof corpo !== "string" || corpo.length < CORPO_GRANDE || typeof XMLHttpRequest === "undefined") return comCookies(input, init);
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const item = itemDaRota(url);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(init?.method ?? "POST", url);
    xhr.withCredentials = true;
    new Headers(init?.headers).forEach((valor, nome) => xhr.setRequestHeader(nome, valor));
    xhr.upload.onprogress = evento => {
      if (evento.lengthComputable) publicarEnvio({ item, atual: 1, total: 1, fracao: evento.loaded / evento.total });
    };
    const terminar = () => publicarEnvio(null);
    xhr.onload = () => {
      terminar();
      const headers = new Headers();
      xhr.getAllResponseHeaders().trim().split(/[\r\n]+/).forEach(linha => {
        const i = linha.indexOf(":");
        if (i > 0) headers.append(linha.slice(0, i).trim(), linha.slice(i + 1).trim());
      });
      resolve(new Response(xhr.responseText, { status: xhr.status, statusText: xhr.statusText, headers }));
    };
    xhr.onerror = () => {
      terminar();
      reject(new TypeError("Falha de conexão durante o envio."));
    };
    xhr.onabort = () => {
      terminar();
      reject(new DOMException("Envio cancelado", "AbortError"));
    };
    init?.signal?.addEventListener("abort", () => xhr.abort());
    publicarEnvio({ item, atual: 1, total: 1, fracao: 0 });
    xhr.send(corpo);
  });
}

export function linksDoCliente() {
  return [
    splitLink({
      condition: op => op.type === "mutation" && ROTAS_DE_ENVIO.test(op.path),
      true: httpLink({ url: "/api/trpc", transformer: superjson, fetch: fetchComProgresso }),
      false: httpBatchLink({ url: "/api/trpc", transformer: superjson, fetch: comCookies }),
    }),
  ];
}
