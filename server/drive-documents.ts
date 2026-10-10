import { createHash, createSign } from "node:crypto";

const scope = "https://www.googleapis.com/auth/drive";
let cachedToken: { value: string; expiresAt: number } | undefined;

export function driveConfigured(): boolean {
  return Boolean(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_DRIVE_PRIVATE_KEY && process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID);
}

function config() {
  if (!driveConfigured()) throw new Error("Google Drive da Prospecta não configurado");
  return {
    email: process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL!,
    privateKey: process.env.GOOGLE_DRIVE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    rootFolder: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!,
  };
}

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const { email, privateKey } = config();
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify({ iss: email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const assertion = `${unsigned}.${signer.sign(privateKey).toString("base64url")}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw new Error(`Google OAuth recusou autenticação (${response.status})`);
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("Google OAuth não retornou token");
  cachedToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  const response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Google Drive falhou (${response.status})`);
  return response;
}

function escapeSearch(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function folder(parent: string, name: string): Promise<string> {
  const query = new URLSearchParams({
    q: `'${escapeSearch(parent)}' in parents and name = '${escapeSearch(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id,name,parents),nextPageToken",
    pageSize: "2",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const found = await driveFetch(`https://www.googleapis.com/drive/v3/files?${query}`);
  const items = await found.json() as { files?: { id: string }[] };
  if ((items.files?.length ?? 0) > 1) throw new Error("Pasta duplicada no Google Drive; exige revisão administrativa");
  if (items.files?.length) return items.files[0].id;
  const created = await driveFetch("https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parent] }),
  });
  return ((await created.json()) as { id: string }).id;
}

async function assertNotPublic(fileId: string): Promise<void> {
  const response = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?fields=permissions(type)&supportsAllDrives=true`);
  const result = await response.json() as { permissions?: { type: string }[] };
  if (result.permissions?.some(permission => permission.type === "anyone")) {
    throw new Error("Pasta do Google Drive com acesso público; upload recusado");
  }
}

export function documentHash(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function uploadPrivateDocument(leadId: number, serviceId: number | null, category: string, name: string, mimeType: string, data: Buffer): Promise<string> {
  const root = config().rootFolder;
  await assertNotPublic(root);
  // IDs, not customer names, keep personal information out of folder labels.
  const customer = await folder(root, `cliente-${leadId}`);
  const service = await folder(customer, serviceId ? `servico-${serviceId}` : "crm");
  const categoryFolder = await folder(service, category);
  await assertNotPublic(categoryFolder);
  const metadata = JSON.stringify({ name, parents: [categoryFolder], description: `Prospecta documento lead ${leadId}` });
  const session = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id&supportsAllDrives=true", {
    method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mimeType, "X-Upload-Content-Length": String(data.length) }, body: metadata,
  });
  const location = session.headers.get("location");
  if (!location || new URL(location).hostname !== "www.googleapis.com") throw new Error("Sessão de upload do Google Drive inválida");
  const response = await driveFetch(location, {
    method: "PUT", headers: { "Content-Type": mimeType, "Content-Length": String(data.length) }, body: Uint8Array.from(data),
  });
  const result = await response.json() as { id?: string };
  if (!result.id) throw new Error("Google Drive não retornou referência do arquivo");
  return result.id;
}

export async function readPrivateDocument(fileId: string): Promise<Buffer> {
  const response = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`);
  return Buffer.from(await response.arrayBuffer());
}
