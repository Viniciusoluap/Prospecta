import { CHAVE_RAIZ, PROPRIEDADE_PASTA } from "../shared/drive-estrutura.js";
import { eq } from "drizzle-orm";
import { googleDriveOauth } from "../drizzle/schema.js";
import { ENV } from "./_core/env.js";
import { decryptSecret, encryptSecret } from "./_core/secret-vault.js";
import { getDb } from "./db.js";
import { ErroDrive, lerCorpoErroGoogle } from "../shared/drive-erro.js";
import { CAMINHO_CALLBACK, lerCredencialOAuth, uriRetornoCadastrada } from "../shared/google-drive-oauth.js";

// Google Drive com a conta Google do dono (OAuth). O dono envia o JSON do cliente
// em Configurações e clica em "Conectar": o token de atualização fica criptografado
// no banco e os arquivos vão para uma pasta criada pelo sistema no Drive dele.

export const PASTA_RAIZ_OAUTH = "Prospecta — Documentos do sistema";

type Linha = typeof googleDriveOauth.$inferSelect;
let cache: { linha: Linha | null; ate: number } | undefined;
let tokenCache: { valor: string; expira: number } | undefined;

async function linha(): Promise<Linha | null> {
  if (cache && cache.ate > Date.now()) return cache.linha;
  const [l] = await getDb().select().from(googleDriveOauth).where(eq(googleDriveOauth.id, 1)).limit(1);
  cache = { linha: l ?? null, ate: Date.now() + 30_000 };
  return cache.linha;
}
function limparCache() { cache = undefined; tokenCache = undefined; }

export async function estadoOAuth(origem: string) {
  const l = await linha();
  return {
    credencial: Boolean(l),
    conectado: Boolean(l?.refreshTokenEncrypted && l.rootFolderId),
    email: l?.accountEmail ?? null,
    conectadoEm: l?.connectedAt ?? null,
    /** URI que precisa estar cadastrada no cliente "Aplicativo da Web" do Google. */
    callback: `${origem}${CAMINHO_CALLBACK}`,
  };
}

/** Grava (ou troca) o cliente OAuth. Trocar o cliente desfaz a conexão anterior. */
export async function salvarCredencialOAuth(texto: string, usuarioId: number, origem: string) {
  const c = lerCredencialOAuth(texto);
  const dados = {
    clientId: c.clientId, clientSecretEncrypted: encryptSecret(c.clientSecret), refreshTokenEncrypted: null,
    accountEmail: null, rootFolderId: null, connectedAt: null, updatedByUserId: usuarioId, updatedAt: new Date(),
  };
  await getDb().insert(googleDriveOauth).values({ id: 1, ...dados }).onConflictDoUpdate({ target: googleDriveOauth.id, set: dados });
  limparCache();
  return { uriCadastrada: uriRetornoCadastrada(c, origem), callback: `${origem}${CAMINHO_CALLBACK}` };
}

export async function clienteOAuth() {
  const l = await linha();
  if (!l) throw new Error("Envie primeiro o JSON do cliente OAuth em Integrações → Google Drive.");
  return { clientId: l.clientId, clientSecret: decryptSecret(l.clientSecretEncrypted) };
}

async function tokenEndpoint(corpo: Record<string, string>) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(corpo),
  });
  const json = await r.json().catch(() => null) as Record<string, unknown> | null;
  if (!r.ok) { const { motivo, detalhe } = lerCorpoErroGoogle(json); throw new ErroDrive("autenticacao", r.status, motivo ? `oauth_${motivo}` : "oauth", detalhe); }
  return json ?? {};
}

/**
 * Pasta raiz do sistema no Drive do dono. Reconectar reaproveita a que já
 * existe (etiqueta interna; ou, de versões antigas, pelo nome na raiz do Drive)
 * em vez de criar outra.
 */
async function pastaRaiz(auth: { Authorization: string }): Promise<string> {
  const buscar = async (q: string) => {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q, fields: "files(id)", orderBy: "createdTime", pageSize: "1" })}`, { headers: auth });
    if (!r.ok) { const { motivo, detalhe } = lerCorpoErroGoogle(await r.json().catch(() => null)); throw new ErroDrive("pasta_raiz", r.status, motivo, detalhe); }
    return ((await r.json()) as { files?: { id: string }[] }).files?.[0]?.id ?? null;
  };
  const pasta = "mimeType = 'application/vnd.google-apps.folder' and trashed = false";
  const existente = await buscar(`appProperties has { key='${PROPRIEDADE_PASTA}' and value='${CHAVE_RAIZ}' } and ${pasta}`)
    ?? await buscar(`name = '${PASTA_RAIZ_OAUTH.replace(/'/g, "\\'")}' and 'root' in parents and ${pasta}`);
  if (existente) return existente;
  const criada = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ name: PASTA_RAIZ_OAUTH, mimeType: "application/vnd.google-apps.folder" }),
  });
  if (!criada.ok) { const { motivo, detalhe } = lerCorpoErroGoogle(await criada.json().catch(() => null)); throw new ErroDrive("pasta_raiz", criada.status, motivo, detalhe); }
  return ((await criada.json()) as { id: string }).id;
}

/** Troca o código do Google pelo token, descobre o e-mail e prepara a pasta raiz no Drive do dono. */
export async function concluirConexao(codigo: string, origem: string, usuarioId: number) {
  const { clientId, clientSecret } = await clienteOAuth();
  const t = await tokenEndpoint({ code: codigo, client_id: clientId, client_secret: clientSecret, redirect_uri: `${origem}${CAMINHO_CALLBACK}`, grant_type: "authorization_code" });
  const acesso = typeof t.access_token === "string" ? t.access_token : "";
  const refresh = typeof t.refresh_token === "string" ? t.refresh_token : "";
  if (!acesso || !refresh) throw new Error("O Google não devolveu a autorização permanente. Tente conectar de novo.");
  const escopos = typeof t.scope === "string" ? t.scope : "";
  if (!escopos.includes("drive.file")) throw new Error("A permissão do Google Drive não foi concedida. Conecte de novo e marque a opção do Drive.");
  const auth = { Authorization: `Bearer ${acesso}` };
  const info = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: auth }).then((r) => r.json()).catch(() => ({})) as { email?: string };
  const id = await pastaRaiz(auth);
  await getDb().update(googleDriveOauth).set({
    refreshTokenEncrypted: encryptSecret(refresh), accountEmail: info.email?.slice(0, 320) ?? null, rootFolderId: id,
    connectedAt: new Date(), updatedByUserId: usuarioId, updatedAt: new Date(),
  }).where(eq(googleDriveOauth.id, 1));
  limparCache();
  return { email: info.email ?? null };
}

export async function desconectarOAuth(usuarioId: number) {
  const l = await linha();
  if (l?.refreshTokenEncrypted) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decryptSecret(l.refreshTokenEncrypted))}`, { method: "POST" }).catch(() => undefined);
  }
  await getDb().update(googleDriveOauth).set({ refreshTokenEncrypted: null, accountEmail: null, rootFolderId: null, connectedAt: null, updatedByUserId: usuarioId, updatedAt: new Date() })
    .where(eq(googleDriveOauth.id, 1));
  limparCache();
}

/** Conexão OAuth ativa (para o módulo de documentos), ou null se não houver. Nunca lança. */
export async function conexaoOAuth(): Promise<{ rootFolder: string; email: string | null } | null> {
  try {
    const l = await linha();
    return l?.refreshTokenEncrypted && l.rootFolderId ? { rootFolder: l.rootFolderId, email: l.accountEmail } : null;
  } catch { return null; }
}

export async function tokenOAuth(forcar = false): Promise<string> {
  if (!forcar && tokenCache && tokenCache.expira > Date.now() + 60_000) return tokenCache.valor;
  const l = await linha();
  if (!l?.refreshTokenEncrypted) throw new Error("Google Drive não conectado");
  const { clientId, clientSecret } = await clienteOAuth();
  const t = await tokenEndpoint({ refresh_token: decryptSecret(l.refreshTokenEncrypted), client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" });
  if (typeof t.access_token !== "string") throw new Error("Google OAuth não retornou token");
  tokenCache = { valor: t.access_token, expira: Date.now() + (typeof t.expires_in === "number" ? t.expires_in : 3600) * 1000 };
  return tokenCache.valor;
}

export const segredoEstado = () => {
  if (!ENV.cookieSecret) throw new Error("JWT_SECRET ausente");
  return `google-drive:${ENV.cookieSecret}`;
};
