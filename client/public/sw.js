// Service Worker da Prospecta Construções (PWA).
//
// Estratégia deliberadamente conservadora: cacheia apenas os arquivos
// estáticos do build (JS/CSS/ícones, já versionados por hash de conteúdo)
// para permitir a instalação como app e acelerar recargas.
//
// NUNCA cacheia:
// - Qualquer rota de API/tRPC (/api/*): dados financeiros, documentos
//   privados, sessão e permissões sempre vêm da rede, nunca do cache.
// - Navegações de página (HTML): sempre buscadas na rede, para que o
//   usuário logado nunca veja uma versão antiga/protegida por engano.
const CACHE_NAME = "prospecta-static-v2";
const STATIC_PATH_PREFIXES = ["/assets/"];

self.addEventListener("install", event => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

function isCacheableStaticAsset(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  return STATIC_PATH_PREFIXES.some(prefix => url.pathname.startsWith(prefix));
}

function validStaticResponse(response, url) {
  if (!response.ok) return false;
  const type = (response.headers.get("content-type") || "").toLowerCase();
  if (/\.m?js$/.test(url.pathname)) return /javascript|ecmascript/.test(type);
  if (/\.css$/.test(url.pathname)) return type.includes("text/css");
  return !type.includes("text/html");
}

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!isCacheableStaticAsset(url)) return; // deixa a rede cuidar do resto (API, HTML, etc.)

  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(request);
      if (cached && validStaticResponse(cached, url)) return cached;
      if (cached) await cache.delete(request);
      const response = await fetch(request);
      if (validStaticResponse(response, url)) await cache.put(request, response.clone());
      return response;
    })
  );
});
