import { pathToFileURL } from "node:url";

const PUBLIC_ROUTES = ["/", "/login", "/como-funciona", "/contato", "/sorteios", "/utef"];

function parseArguments(argv) {
  const baseUrlIndex = argv.indexOf("--base-url");
  const timeoutIndex = argv.indexOf("--timeout-ms");
  const baseUrl = baseUrlIndex >= 0 ? argv[baseUrlIndex + 1] : process.env.SMOKE_BASE_URL;
  const timeoutMs = Number(timeoutIndex >= 0 ? argv[timeoutIndex + 1] : 15_000);

  if (!baseUrl) throw new Error("Informe --base-url ou SMOKE_BASE_URL.");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) throw new Error("Timeout inválido.");

  return { baseUrl: new URL(baseUrl), timeoutMs };
}

export async function checkRoute(baseUrl, route, timeoutMs, fetchImpl = fetch) {
  const requested = new URL(route, baseUrl);
  const response = await fetchImpl(requested, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": "prospecta-release-smoke/1.0" },
  });
  const finalUrl = new URL(response.url || requested);
  const sameOrigin = finalUrl.origin === baseUrl.origin;
  const body = await response.text();

  return {
    route,
    ok: response.ok && sameOrigin && body.trim().length > 0,
    status: response.status,
    sameOrigin,
    finalPath: sameOrigin ? `${finalUrl.pathname}${finalUrl.search}` : "EXTERNAL_REDIRECT",
    hasContent: body.trim().length > 0,
  };
}

export async function runSmoke({ baseUrl, timeoutMs, fetchImpl = fetch }) {
  const routes = [];
  for (const route of PUBLIC_ROUTES) {
    routes.push(await checkRoute(baseUrl, route, timeoutMs, fetchImpl));
  }

  const session = await checkRoute(baseUrl, "/api/auth/session", timeoutMs, fetchImpl);
  routes.push({ ...session, ok: session.ok && session.status === 200 });

  const admin = await checkRoute(baseUrl, "/admin", timeoutMs, fetchImpl);
  routes.push({
    ...admin,
    ok: admin.sameOrigin && admin.status === 200 && admin.finalPath.startsWith("/login"),
  });

  return { ok: routes.every((route) => route.ok), baseUrl: baseUrl.origin, routes };
}

async function main() {
  const result = await runSmoke(parseArguments(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
