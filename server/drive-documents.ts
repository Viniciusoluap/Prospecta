import { createHash, createSign } from "node:crypto";
import { descreverErroDrive, ErroDrive, lerCorpoErroGoogle, type EtapaDrive } from "../shared/drive-erro.js";

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
  if (!response.ok) {
    const { motivo, detalhe } = lerCorpoErroGoogle(await response.json().catch(() => null));
    throw new ErroDrive("autenticacao", response.status, motivo, detalhe);
  }
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("Google OAuth não retornou token");
  cachedToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

async function driveFetch(url: string, init: RequestInit = {}, etapa: EtapaDrive = "pasta"): Promise<Response> {
  const token = await accessToken();
  const response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const { motivo, detalhe } = lerCorpoErroGoogle(await response.json().catch(() => null));
    throw new ErroDrive(etapa, response.status, motivo, detalhe);
  }
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

async function assertNotPublic(fileId: string, etapa: EtapaDrive = "permissoes"): Promise<void> {
  const response = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?fields=permissions(type)&supportsAllDrives=true`, {}, etapa);
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
  await assertNotPublic(root, "pasta_raiz");
  // IDs, not customer names, keep personal information out of folder labels.
  const customer = await folder(root, `cliente-${leadId}`);
  const service = await folder(customer, serviceId ? `servico-${serviceId}` : "crm");
  const categoryFolder = await folder(service, category);
  await assertNotPublic(categoryFolder);
  return uploadToFolder(categoryFolder, name, mimeType, data);
}

/** Estudos são independentes de leads: usam uma árvore própria para evitar colisões de IDs. */
export async function uploadPrivateIncorporationDocument(studyId: number, itemId: string, name: string, mimeType: string, data: Buffer): Promise<string> {
  const root = config().rootFolder;
  await assertNotPublic(root, "pasta_raiz");
  const study = await folder(root, `incorporacao-${studyId}`);
  const registration = await folder(study, "registro");
  const item = await folder(registration, itemId);
  await assertNotPublic(item);
  return uploadToFolder(item, name, mimeType, data);
}

async function uploadToFolder(categoryFolder: string, name: string, mimeType: string, data: Buffer): Promise<string> {
  const metadata = JSON.stringify({ name, parents: [categoryFolder] });
  const session = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id&supportsAllDrives=true", {
    method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mimeType, "X-Upload-Content-Length": String(data.length) }, body: metadata,
  }, "upload");
  const location = session.headers.get("location");
  if (!location || new URL(location).hostname !== "www.googleapis.com") throw new Error("Sessão de upload do Google Drive inválida");
  const response = await driveFetch(location, {
    method: "PUT", headers: { "Content-Type": mimeType, "Content-Length": String(data.length) }, body: Uint8Array.from(data),
  }, "upload");
  const result = await response.json() as { id?: string };
  if (!result.id) throw new Error("Google Drive não retornou referência do arquivo");
  return result.id;
}

export async function readPrivateDocument(fileId: string): Promise<Buffer> {
  const response = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {}, "leitura");
  return Buffer.from(await response.arrayBuffer());
}

export interface DiagnosticoDrive {
  configurado: boolean;
  ok: boolean;
  /** Pasta raiz dentro de um Drive compartilhado (Workspace); fora dele contas de serviço não têm espaço. */
  driveCompartilhado: boolean | null;
  etapas: { etapa: string; ok: boolean }[];
  explicacao: string | null;
}

/**
 * Teste real, em etapas: autenticação, pasta raiz, permissões e gravação de um
 * arquivo de 1 KB que é apagado logo depois. Devolve o motivo exato da falha.
 */
export async function diagnosticarDrive(): Promise<DiagnosticoDrive> {
  const etapas: DiagnosticoDrive["etapas"] = [];
  if (!driveConfigured()) return { configurado: false, ok: false, driveCompartilhado: null, etapas, explicacao: descreverErroDrive(new Error("não configurado")) };
  let driveCompartilhado: boolean | null = null;
  try {
    cachedToken = undefined;
    await accessToken();
    etapas.push({ etapa: "Autenticação da conta de serviço", ok: true });
    const root = config().rootFolder;
    const meta = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(root)}?fields=id,driveId,mimeType,capabilities(canAddChildren)&supportsAllDrives=true`, {}, "pasta_raiz");
    const info = await meta.json() as { driveId?: string; mimeType?: string; capabilities?: { canAddChildren?: boolean } };
    driveCompartilhado = Boolean(info.driveId);
    if (info.mimeType !== "application/vnd.google-apps.folder") throw new Error("O ID configurado não é uma pasta");
    if (info.capabilities?.canAddChildren === false) throw new ErroDrive("pasta_raiz", 403, "insufficientFilePermissions", undefined);
    etapas.push({ etapa: "Acesso à pasta raiz", ok: true });
    await assertNotPublic(root, "pasta_raiz");
    etapas.push({ etapa: "Pasta privada (sem link público)", ok: true });
    const teste = await uploadToFolder(root, `teste-conexao-${Date.now()}.txt`, "text/plain", Buffer.alloc(1024, 46));
    await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(teste)}?supportsAllDrives=true`, { method: "DELETE" }, "upload").catch(() => undefined);
    etapas.push({ etapa: "Gravação de arquivo de teste", ok: true });
    return { configurado: true, ok: true, driveCompartilhado, etapas, explicacao: null };
  } catch (error) {
    return { configurado: true, ok: false, driveCompartilhado, etapas, explicacao: descreverErroDrive(error) };
  }
}

/**
 * Tenta gravar no Google Drive. Se o Drive não estiver configurado ou recusar
 * (sem espaço, sem permissão, API desligada…), devolve `driveFileId: null` e o
 * motivo legível; quem chama guarda o arquivo no banco. O upload nunca se perde.
 */
export async function tryDriveUpload(upload: () => Promise<string>): Promise<{ driveFileId: string | null; note: string | null }> {
  if (!driveConfigured()) return { driveFileId: null, note: null };
  try {
    return { driveFileId: await upload(), note: null };
  } catch (error) {
    const note = descreverErroDrive(error);
    // Só etapa/código/motivo do Google: sem token, chave ou conteúdo do arquivo.
    console.error("[drive] gravação recusada; arquivo guardado no banco:", error instanceof Error ? error.message : "erro desconhecido");
    return { driveFileId: null, note };
  }
}
