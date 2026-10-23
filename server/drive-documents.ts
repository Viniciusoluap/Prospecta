import { createHash, createSign } from "node:crypto";
import { descreverErroDrive, ErroDrive, lerCorpoErroGoogle, type EtapaDrive } from "../shared/drive-erro.js";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import {
  financiamentoChecklistItems, financiamentos, imoveis, imovelFotos, incorporationRegistrationDocuments, leadDocuments, portalContractDocuments, portalContracts,
} from "../drizzle/schema.js";
import { caminhoImovel, caminhoMedicoesObra, CHAVE_RAIZ, nomeArquivo, nomeFotoImovel, pastaLegada, PASTAS_IMOVEL, PROPRIEDADE_PASTA, ROTULO_DOCUMENTO, type PastaAlvo } from "../shared/drive-estrutura.js";
import { getDb } from "./db.js";
import { caminhoDocumentoCliente, destinoDocumentoEstudo } from "./drive-pastas.js";
import { conexaoOAuth, tokenOAuth } from "./google-drive-oauth.js";

const scope = "https://www.googleapis.com/auth/drive";
let cachedToken: { value: string; expiresAt: number } | undefined;

/**
 * De onde vêm os arquivos: a conta Google do dono conectada em Configurações
 * (OAuth — preferida) ou a conta de serviço das variáveis de ambiente (legado).
 */
export type FonteDrive = { modo: "oauth"; rootFolder: string; email: string | null } | { modo: "conta_servico"; rootFolder: string };

function contaServicoConfigurada(): boolean {
  return Boolean(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_DRIVE_PRIVATE_KEY && process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID);
}

async function fontes(): Promise<FonteDrive[]> {
  const lista: FonteDrive[] = [];
  const oauth = await conexaoOAuth();
  if (oauth) lista.push({ modo: "oauth", ...oauth });
  if (contaServicoConfigurada()) lista.push({ modo: "conta_servico", rootFolder: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID! });
  return lista;
}

export async function fonteDrive(): Promise<FonteDrive | null> {
  return (await fontes())[0] ?? null;
}

export async function driveConfigured(): Promise<boolean> {
  return Boolean(await fonteDrive());
}

async function fonteObrigatoria(): Promise<FonteDrive> {
  const f = await fonteDrive();
  if (!f) throw new Error("Google Drive da Prospecta não configurado");
  return f;
}

function contaServico() {
  return {
    email: process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL!,
    privateKey: process.env.GOOGLE_DRIVE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
  };
}

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

async function accessToken(fonte: FonteDrive): Promise<string> {
  if (fonte.modo === "oauth") return tokenOAuth();
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const { email, privateKey } = contaServico();
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

async function driveFetch(fonte: FonteDrive, url: string, init: RequestInit = {}, etapa: EtapaDrive = "pasta"): Promise<Response> {
  const token = await accessToken(fonte);
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

const PASTA_MIME = "application/vnd.google-apps.folder";

interface ArquivoDrive { id: string; name?: string; parents?: string[]; mimeType?: string; appProperties?: Record<string, string> }

/**
 * Pasta do sistema achada pela etiqueta interna (appProperties), não pelo nome:
 * se o nome exibido mudou (cliente renomeado), renomeia; se está em outro
 * lugar, move para `parent`. Só cria quando não existe nenhuma.
 */
async function pastaGerenciada(fonte: FonteDrive, parent: string, alvo: PastaAlvo): Promise<string> {
  const query = new URLSearchParams({
    q: `appProperties has { key='${PROPRIEDADE_PASTA}' and value='${escapeSearch(alvo.chave)}' } and mimeType = '${PASTA_MIME}' and trashed = false`,
    fields: "files(id,name,parents)",
    orderBy: "createdTime",
    pageSize: "10",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const found = await driveFetch(fonte, `https://www.googleapis.com/drive/v3/files?${query}`);
  const existente = ((await found.json()) as { files?: ArquivoDrive[] }).files?.[0];
  if (existente) {
    const params = new URLSearchParams({ supportsAllDrives: "true", fields: "id" });
    const pais = existente.parents ?? [];
    if (!pais.includes(parent)) {
      params.set("addParents", parent);
      if (pais.length) params.set("removeParents", pais.join(","));
    }
    if (existente.name !== alvo.nome || !pais.includes(parent)) {
      await driveFetch(fonte, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(existente.id)}?${params}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: alvo.nome }),
      });
    }
    return existente.id;
  }
  const created = await driveFetch(fonte, "https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: alvo.nome, mimeType: PASTA_MIME, parents: [parent], appProperties: { [PROPRIEDADE_PASTA]: alvo.chave } }),
  });
  return ((await created.json()) as { id: string }).id;
}

async function pastaDoCaminho(fonte: FonteDrive, raiz: string, caminho: PastaAlvo[]): Promise<string> {
  let atual = raiz;
  for (const alvo of caminho) atual = await pastaGerenciada(fonte, atual, alvo);
  return atual;
}

async function assertNotPublic(fonte: FonteDrive, fileId: string, etapa: EtapaDrive = "permissoes"): Promise<void> {
  const response = await driveFetch(fonte, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?fields=permissions(type)&supportsAllDrives=true`, {}, etapa);
  const result = await response.json() as { permissions?: { type: string }[] };
  if (result.permissions?.some(permission => permission.type === "anyone")) {
    throw new Error("Pasta do Google Drive com acesso público; upload recusado");
  }
}

export function documentHash(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export interface DocumentoClienteDrive {
  leadId: number;
  serviceId: number | null;
  /** Tipo do documento (rg, cnh…) ou categoria fixa (juridico, financiamento_checklist). */
  categoria: string;
  /** Texto do nome do arquivo: "RG", "Contrato CT-12 assinado"… */
  rotulo: string;
  nomeOriginal: string | null;
  mimeType: string;
  data: Buffer;
}

/** Clientes/<Nome (nº id)>/<Área>/<Rótulo — dd-mm-aaaa.ext> */
export async function uploadPrivateDocument(doc: DocumentoClienteDrive): Promise<string> {
  const fonte = await fonteObrigatoria();
  const root = await prepararRaiz(fonte);
  const pasta = await pastaDoCaminho(fonte, root, await caminhoDocumentoCliente(doc.leadId, doc.serviceId, doc.categoria));
  await assertNotPublic(fonte, pasta);
  return uploadToFolder(fonte, pasta, nomeArquivo(doc.rotulo, new Date(), doc.nomeOriginal, doc.mimeType), doc.mimeType, doc.data);
}

/** Incorporação/<Estudo (nº id)>/<Etapa>/<Documento — dd-mm-aaaa.ext> */
export async function uploadPrivateIncorporationDocument(studyId: number, itemId: string, name: string, mimeType: string, data: Buffer): Promise<string> {
  const fonte = await fonteObrigatoria();
  const root = await prepararRaiz(fonte);
  const destino = await destinoDocumentoEstudo(studyId, itemId);
  const pasta = await pastaDoCaminho(fonte, root, destino.caminho);
  await assertNotPublic(fonte, pasta);
  return uploadToFolder(fonte, pasta, nomeArquivo(destino.rotulo, new Date(), name, mimeType), mimeType, data);
}

/** Obras/<Obra (nº id)>/Medições CAIXA/<Rótulo — dd-mm-aaaa.ext> (PCI original e medições preenchidas). */
export async function uploadArquivoMedicaoObra(obra: { id: number; titulo: string }, doc: { rotulo: string; nomeOriginal: string; mime: string; data: Buffer }): Promise<string> {
  const fonte = await fonteObrigatoria();
  const root = await prepararRaiz(fonte);
  const pasta = await pastaDoCaminho(fonte, root, caminhoMedicoesObra({ id: obra.id, numero: obra.id, nome: obra.titulo }));
  await assertNotPublic(fonte, pasta);
  return uploadToFolder(fonte, pasta, nomeArquivo(doc.rotulo, new Date(), doc.nomeOriginal, doc.mime), doc.mime, doc.data);
}

/**
 * Pedido de 15/10: Imóveis/<Título (nº id)>/ com o checklist fixo de pastas
 * (01 - Fotos, 02 - Documentos, 03 - Plantas, 04 - Propostas). Devolve a pasta
 * de fotos já criada/renomeada.
 */
async function pastaFotosImovel(fonte: FonteDrive, imovel: { id: number; titulo: string }): Promise<string> {
  const root = await prepararRaiz(fonte);
  const base = { id: imovel.id, numero: imovel.id, nome: imovel.titulo };
  let fotos = "";
  for (const p of PASTAS_IMOVEL) {
    const id = await pastaDoCaminho(fonte, root, caminhoImovel(base, p.chave));
    if (p.chave === "fotos") fotos = id;
  }
  await assertNotPublic(fonte, fotos);
  return fotos;
}

/** Grava as fotos do imóvel em "01 - Fotos" como "Foto NN — dd-mm-aaaa.ext"; devolve os IDs na mesma ordem. */
export async function uploadFotosImovel(imovel: { id: number; titulo: string }, fotos: { ordem: number; mime: string; data: Buffer }[]): Promise<string[]> {
  const fonte = await fonteObrigatoria();
  const pasta = await pastaFotosImovel(fonte, imovel);
  const ids: string[] = [];
  for (const f of fotos) ids.push(await uploadToFolder(fonte, pasta, nomeFotoImovel(f.ordem, new Date(), f.mime), f.mime, f.data));
  return ids;
}

/** Mantém a numeração das fotos igual à ordem do anúncio (e a pasta com o título atual). */
export async function organizarFotosImovel(imovel: { id: number; titulo: string }, fotos: { driveFileId: string; mime: string; criadaEm: Date }[]): Promise<void> {
  if (!fotos.length) return;
  const fonte = await fonteObrigatoria();
  const pasta = await pastaFotosImovel(fonte, imovel);
  for (let i = 0; i < fotos.length; i++) await moverArquivo(fonte, fotos[i].driveFileId, pasta, nomeFotoImovel(i + 1, fotos[i].criadaEm, fotos[i].mime));
}

/** Foto retirada do anúncio vai para a lixeira do Drive (recuperável por 30 dias). */
export async function enviarParaLixeira(fileId: string): Promise<void> {
  const fonte = await fonteObrigatoria();
  await driveFetch(fonte, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }),
  });
}

async function uploadToFolder(fonte: FonteDrive, categoryFolder: string, name: string, mimeType: string, data: Buffer): Promise<string> {
  const metadata = JSON.stringify({ name, parents: [categoryFolder] });
  const session = await driveFetch(fonte, "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id&supportsAllDrives=true", {
    method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mimeType, "X-Upload-Content-Length": String(data.length) }, body: metadata,
  }, "upload");
  const location = session.headers.get("location");
  if (!location || new URL(location).hostname !== "www.googleapis.com") throw new Error("Sessão de upload do Google Drive inválida");
  const response = await driveFetch(fonte, location, {
    method: "PUT", headers: { "Content-Type": mimeType, "Content-Length": String(data.length) }, body: Uint8Array.from(data),
  }, "upload");
  const result = await response.json() as { id?: string };
  if (!result.id) throw new Error("Google Drive não retornou referência do arquivo");
  return result.id;
}

/** Lê pela fonte atual; arquivo gravado antes por outra fonte (ex.: conta de serviço) é lido por ela. */
export async function readPrivateDocument(fileId: string): Promise<Buffer> {
  const lista = await fontes();
  if (!lista.length) throw new Error("Google Drive da Prospecta não configurado");
  let ultimoErro: unknown;
  for (const fonte of lista) {
    try {
      const response = await driveFetch(fonte, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {}, "leitura");
      return Buffer.from(await response.arrayBuffer());
    } catch (erro) { ultimoErro = erro; }
  }
  throw ultimoErro;
}

export interface DiagnosticoDrive {
  configurado: boolean;
  ok: boolean;
  /** "oauth" = conta Google do dono conectada em Configurações; "conta_servico" = legado. */
  modo: FonteDrive["modo"] | null;
  /** Conta Google conectada (só no modo OAuth). */
  email: string | null;
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
  const fonte = await fonteDrive();
  if (!fonte) return { configurado: false, ok: false, modo: null, email: null, driveCompartilhado: null, etapas, explicacao: descreverErroDrive(new Error("não configurado")) };
  const email = fonte.modo === "oauth" ? fonte.email : null;
  let driveCompartilhado: boolean | null = null;
  try {
    if (fonte.modo === "oauth") { await tokenOAuth(true); etapas.push({ etapa: `Autorização da conta Google${email ? ` (${email})` : ""}`, ok: true }); }
    else { cachedToken = undefined; await accessToken(fonte); etapas.push({ etapa: "Autenticação da conta de serviço", ok: true }); }
    const root = fonte.rootFolder;
    const meta = await driveFetch(fonte, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(root)}?fields=id,driveId,mimeType,trashed,capabilities(canAddChildren)&supportsAllDrives=true`, {}, "pasta_raiz");
    const info = await meta.json() as { driveId?: string; mimeType?: string; trashed?: boolean; capabilities?: { canAddChildren?: boolean } };
    if (fonte.modo === "conta_servico") driveCompartilhado = Boolean(info.driveId);
    if (info.mimeType !== "application/vnd.google-apps.folder") throw new Error("O ID configurado não é uma pasta");
    if (info.trashed) throw new ErroDrive("pasta_raiz", 404, "notFound", "pasta na lixeira");
    if (info.capabilities?.canAddChildren === false) throw new ErroDrive("pasta_raiz", 403, "insufficientFilePermissions", undefined);
    etapas.push({ etapa: "Acesso à pasta raiz", ok: true });
    await assertNotPublic(fonte, root, "pasta_raiz");
    etapas.push({ etapa: "Pasta privada (sem link público)", ok: true });
    const teste = await uploadToFolder(fonte, root, `teste-conexao-${Date.now()}.txt`, "text/plain", Buffer.alloc(1024, 46));
    await driveFetch(fonte, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(teste)}?supportsAllDrives=true`, { method: "DELETE" }, "upload").catch(() => undefined);
    etapas.push({ etapa: "Gravação de arquivo de teste", ok: true });
    await prepararRaiz(fonte);
    let pendentes = 0;
    if (ultimaOrganizacao) {
      const o = ultimaOrganizacao;
      pendentes = o.falhas;
      ultimaOrganizacao = null;
      etapas.push({
        etapa: `Organização das pastas: ${o.arquivosMovidos} arquivo(s) movido(s), ${o.pastasRemovidas} pasta(s) antiga(s) enviada(s) para a lixeira${o.ignorados ? `, ${o.ignorados} não encontrado(s) no Drive` : ""}${o.falhas ? `, ${o.falhas} pendente(s) — será tentado de novo` : ""}`,
        ok: o.falhas === 0,
      });
    }
    if (pendentes) {
      return { configurado: true, ok: false, modo: fonte.modo, email, driveCompartilhado, etapas,
        explicacao: `O Google Drive está funcionando e os novos arquivos são gravados normalmente, mas ${pendentes} arquivo(s) antigo(s) ainda não foram reorganizados. O sistema tenta de novo no próximo envio ou no próximo teste.` };
    }
    return { configurado: true, ok: true, modo: fonte.modo, email, driveCompartilhado, etapas, explicacao: null };
  } catch (error) {
    return { configurado: true, ok: false, modo: fonte.modo, email, driveCompartilhado, etapas, explicacao: descreverErroDrive(error) };
  }
}

/**
 * Tenta gravar no Google Drive. Se o Drive não estiver configurado ou recusar
 * (sem espaço, sem permissão, API desligada…), devolve `driveFileId: null` e o
 * motivo legível; quem chama guarda o arquivo no banco. O upload nunca se perde.
 */
export async function tryDriveUpload(upload: () => Promise<string>): Promise<{ driveFileId: string | null; note: string | null }> {
  if (!(await driveConfigured())) return { driveFileId: null, note: null };
  try {
    return { driveFileId: await upload(), note: null };
  } catch (error) {
    const note = descreverErroDrive(error);
    // Só etapa/código/motivo do Google: sem token, chave ou conteúdo do arquivo.
    console.error("[drive] gravação recusada; arquivo guardado no banco:", error instanceof Error ? error.message : "erro desconhecido");
    return { driveFileId: null, note };
  }
}

// ─── Organização das pastas ──────────────────────────────────────────────────

export interface ResultadoOrganizacao { arquivosMovidos: number; falhas: number; pastasRemovidas: number; /** Arquivo que não existe mais no Drive (apagado pelo dono ou de outra conta). */ ignorados: number }

const preparacoes = new Map<string, Promise<string>>();

/**
 * Na primeira vez que o sistema usa uma pasta raiz (ou depois da troca para
 * esta estrutura), reorganiza o que já estava gravado e marca a raiz com a
 * etiqueta interna. Se algum arquivo não puder ser movido, não marca: a
 * próxima gravação tenta de novo.
 */
async function prepararRaiz(fonte: FonteDrive): Promise<string> {
  const root = fonte.rootFolder;
  let pronta = preparacoes.get(root);
  if (!pronta) {
    pronta = (async () => {
      await assertNotPublic(fonte, root, "pasta_raiz");
      const info = await driveFetch(fonte, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(root)}?fields=appProperties&supportsAllDrives=true`, {}, "pasta_raiz");
      const { appProperties } = await info.json() as ArquivoDrive;
      if (appProperties?.[PROPRIEDADE_PASTA] === CHAVE_RAIZ) return root;
      const resultado = await reorganizar(fonte, root).catch((erro) => {
        console.error("[drive] organização das pastas falhou:", erro instanceof Error ? erro.message : "erro desconhecido");
        return { arquivosMovidos: 0, falhas: 1, pastasRemovidas: 0, ignorados: 0 };
      });
      if (!resultado.falhas) {
        await driveFetch(fonte, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(root)}?supportsAllDrives=true&fields=id`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appProperties: { [PROPRIEDADE_PASTA]: CHAVE_RAIZ } }),
        }, "pasta_raiz");
      }
      ultimaOrganizacao = resultado;
      // Com pendências a raiz fica sem etiqueta e a próxima gravação tenta de novo.
      if (resultado.falhas) preparacoes.delete(root);
      return root;
    })();
    preparacoes.set(root, pronta);
    pronta.catch(() => preparacoes.delete(root));
  }
  return pronta;
}

let ultimaOrganizacao: ResultadoOrganizacao | null = null;

/** Move e renomeia um arquivo; devolve false quando já estava no lugar certo. */
async function moverArquivo(fonte: FonteDrive, fileId: string, destino: string, nome: string): Promise<boolean> {
  const r = await driveFetch(fonte, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=name,parents&supportsAllDrives=true`, {}, "leitura");
  const info = await r.json() as ArquivoDrive;
  const pais = info.parents ?? [];
  if (pais.length === 1 && pais[0] === destino && info.name === nome) return false;
  const params = new URLSearchParams({ supportsAllDrives: "true", fields: "id" });
  if (!pais.includes(destino)) params.set("addParents", destino);
  const remover = pais.filter((p) => p !== destino);
  if (remover.length) params.set("removeParents", remover.join(","));
  await driveFetch(fonte, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: nome }),
  });
  return true;
}

async function filhos(fonte: FonteDrive, pasta: string): Promise<ArquivoDrive[]> {
  const query = new URLSearchParams({
    q: `'${escapeSearch(pasta)}' in parents and trashed = false`,
    fields: "files(id,name,mimeType,appProperties)", pageSize: "1000", supportsAllDrives: "true", includeItemsFromAllDrives: "true",
  });
  const r = await driveFetch(fonte, `https://www.googleapis.com/drive/v3/files?${query}`);
  return ((await r.json()) as { files?: ArquivoDrive[] }).files ?? [];
}

/** Manda para a lixeira do Drive pastas antigas sem nenhum arquivo dentro (nunca apaga arquivo). */
async function removerPastaVazia(fonte: FonteDrive, pasta: string): Promise<{ vazia: boolean; removidas: number }> {
  let vazia = true;
  let removidas = 0;
  for (const item of await filhos(fonte, pasta)) {
    if (item.mimeType !== PASTA_MIME) { vazia = false; continue; }
    const sub = await removerPastaVazia(fonte, item.id);
    removidas += sub.removidas;
    if (!sub.vazia) vazia = false;
  }
  if (vazia) {
    await driveFetch(fonte, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(pasta)}?supportsAllDrives=true&fields=id`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }),
    });
    removidas += 1;
  }
  return { vazia, removidas };
}

async function reorganizar(fonte: FonteDrive, root: string): Promise<ResultadoOrganizacao> {
  const db = getDb();
  const resultado: ResultadoOrganizacao = { arquivosMovidos: 0, falhas: 0, pastasRemovidas: 0, ignorados: 0 };
  const mover = async (fileId: string, caminho: Promise<PastaAlvo[]>, nome: string) => {
    try {
      if (await moverArquivo(fonte, fileId, await pastaDoCaminho(fonte, root, await caminho), nome)) resultado.arquivosMovidos += 1;
    } catch (erro) {
      // Sem acesso ao arquivo (apagado no Drive ou gravado por outra conta): não há o que mover.
      if (erro instanceof ErroDrive && erro.status === 404 && erro.etapa === "leitura") { resultado.ignorados += 1; return; }
      resultado.falhas += 1;
      console.error("[drive] arquivo não reorganizado:", erro instanceof Error ? erro.message : "erro desconhecido");
    }
  };

  // Cópias do "Duplicar lead" (etapa 6) usam o arquivo do documento original: ficam onde o original está.
  const docs = await db.select().from(leadDocuments).where(and(isNotNull(leadDocuments.driveFileId), isNull(leadDocuments.deletedAt), isNull(leadDocuments.copiedFromDocumentId)));
  for (const d of docs) {
    await mover(d.driveFileId!, caminhoDocumentoCliente(d.leadId, d.serviceId, d.type),
      nomeArquivo(ROTULO_DOCUMENTO[d.type] ?? "Documento", d.uploadedAt ?? d.createdAt, d.fileName, d.mimeType ?? ""));
  }
  const contratos = await db.select({ doc: portalContractDocuments, leadId: portalContracts.leadId, numero: portalContracts.number })
    .from(portalContractDocuments).innerJoin(portalContracts, eq(portalContracts.id, portalContractDocuments.contractId))
    .where(isNotNull(portalContractDocuments.driveFileId));
  for (const c of contratos) {
    if (!c.leadId) continue;
    await mover(c.doc.driveFileId!, caminhoDocumentoCliente(c.leadId, null, "juridico"),
      nomeArquivo(`Contrato ${c.numero}${c.doc.type === "assinado" ? " assinado" : ""}`, c.doc.createdAt, c.doc.name, "application/pdf"));
  }
  const checklist = await db.select({ item: financiamentoChecklistItems, leadId: financiamentos.leadId })
    .from(financiamentoChecklistItems).innerJoin(financiamentos, eq(financiamentos.id, financiamentoChecklistItems.financiamentoId))
    .where(isNotNull(financiamentoChecklistItems.documentoDriveFileId));
  for (const c of checklist) {
    if (!c.leadId) continue;
    await mover(c.item.documentoDriveFileId!, caminhoDocumentoCliente(c.leadId, null, "financiamento_checklist"),
      nomeArquivo(c.item.item, c.item.enviadoEm ?? c.item.createdAt, c.item.documentoNome, c.item.documentoMime ?? ""));
  }
  const estudos = await db.select().from(incorporationRegistrationDocuments).where(isNotNull(incorporationRegistrationDocuments.driveFileId));
  for (const e of estudos) {
    const destino = destinoDocumentoEstudo(e.studyId, e.itemId);
    await mover(e.driveFileId!, destino.then((d) => d.caminho), nomeArquivo((await destino).rotulo, e.createdAt, e.fileName, e.mimeType ?? ""));
  }

  // Pedido de 15/10: fotos de imóveis em Imóveis/<Título (nº)>/01 - Fotos, numeradas na ordem de envio.
  const fotos = await db.select({ foto: imovelFotos, titulo: imoveis.titulo }).from(imovelFotos)
    .innerJoin(imoveis, eq(imoveis.id, imovelFotos.imovelId)).where(isNotNull(imovelFotos.driveFileId)).orderBy(imovelFotos.imovelId, imovelFotos.id);
  const posicao = new Map<number, number>();
  for (const f of fotos) {
    const n = (posicao.get(f.foto.imovelId) ?? 0) + 1;
    posicao.set(f.foto.imovelId, n);
    await mover(f.foto.driveFileId!, Promise.resolve(caminhoImovel({ id: f.foto.imovelId, numero: f.foto.imovelId, nome: f.titulo }, "fotos")),
      nomeFotoImovel(n, f.foto.createdAt, f.foto.mime));
  }

  for (const item of await filhos(fonte, root)) {
    if (item.mimeType !== PASTA_MIME || !pastaLegada(item)) continue;
    try {
      resultado.pastasRemovidas += (await removerPastaVazia(fonte, item.id)).removidas;
    } catch {
      resultado.falhas += 1;
    }
  }
  return resultado;
}

/** Portfólio por cliente/projeto/item. Sessão retomável; cada requisição leva até 1 MiB. */
export async function iniciarUploadProjetoDrive(doc: { projectId: string; clientId: string; clientName: string; projectName: string; itemId: string; itemName: string; kind: "editable" | "pdf"; name: string; mime: string; size: number }): Promise<string> {
  const fonte = await fonteObrigatoria();
  const root = await prepararRaiz(fonte);
  const caminho: PastaAlvo[] = [
    { chave: "clientes", nome: "Clientes" },
    { chave: `cliente:${doc.clientId}`, nome: `${doc.clientName.replace(/[\\/\x00-\x1f]/g, " ").slice(0, 100)} (nº ${doc.clientId})` },
    { chave: `cliente:${doc.clientId}:projetos`, nome: "Projetos" },
    { chave: `cliente-${doc.clientId}-portfolio`, nome: "Portfólio de projetos" },
    { chave: `projeto-${doc.projectId}`, nome: `${doc.projectName.replace(/[\\/\x00-\x1f]/g, " ").slice(0, 100)} (nº ${doc.projectId})` },
    { chave: `projeto-${doc.projectId}-item-${doc.itemId}`, nome: doc.itemName.replace(/[\\/\x00-\x1f]/g, " ").slice(0, 100) },
  ];
  const pasta = await pastaDoCaminho(fonte, root, caminho);
  await assertNotPublic(fonte, pasta);
  const session = await driveFetch(fonte, "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id&supportsAllDrives=true", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Upload-Content-Type": doc.mime, "X-Upload-Content-Length": String(doc.size) },
    body: JSON.stringify({ name: nomeArquivo(`${doc.itemName} — ${doc.kind === "pdf" ? "PDF" : "Editável"}`, new Date(), doc.name, doc.mime), parents: [pasta] }),
  }, "upload");
  const location = session.headers.get("location");
  if (!location || new URL(location).origin !== "https://www.googleapis.com" || !new URL(location).pathname.startsWith("/upload/drive/")) throw new Error("Sessão de upload inválida.");
  return location;
}

export async function enviarParteProjetoDrive(location: string, start: number, total: number, mime: string, bytes: Buffer): Promise<{ offset: number; driveFileId?: string }> {
  const url = new URL(location);
  if (url.origin !== "https://www.googleapis.com" || !url.pathname.startsWith("/upload/drive/")) throw new Error("Sessão de upload inválida.");
  const fonte = await fonteObrigatoria();
  const response = await fetch(location, {
    method: "PUT", headers: { Authorization: `Bearer ${await accessToken(fonte)}`, "Content-Type": mime, "Content-Length": String(bytes.length),
      "Content-Range": bytes.length ? `bytes ${start}-${start + bytes.length - 1}/${total}` : `bytes */${total}` },
    body: Uint8Array.from(bytes),
  });
  if (response.status === 308) {
    const range = /bytes=0-(\d+)/.exec(response.headers.get("range") || "");
    return { offset: range ? Number(range[1]) + 1 : 0 };
  }
  if (!response.ok) throw new Error(response.status === 404 ? "Envio expirado. Selecione o arquivo novamente." : "Falha no Google Drive. Tente continuar o envio.");
  const result = await response.json() as { id?: string };
  if (!result.id) throw new Error("Drive não confirmou o arquivo.");
  await assertNotPublic(fonte, result.id);
  return { offset: total, driveFileId: result.id };
}
