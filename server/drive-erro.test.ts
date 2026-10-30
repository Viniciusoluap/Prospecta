import { afterEach, describe, expect, it, vi } from "vitest";
import { descreverErroDrive, ErroDrive, lerCorpoErroGoogle } from "../shared/drive-erro";
import { tryDriveUpload } from "./drive-documents";

// Sem isto o teste consultaria a conexão OAuth do banco configurado no ambiente
// (na Vercel, o de produção — onde o Drive está conectado) e o resultado mudaria.
vi.mock("./google-drive-oauth.js", () => ({ conexaoOAuth: async () => null, tokenOAuth: async () => "token-de-teste" }));

describe("motivo real do Google Drive (item 09)", () => {
  it("lê o reason do corpo de erro da Drive API", () => {
    expect(lerCorpoErroGoogle({ error: { code: 403, message: "Service Accounts do not have storage quota.", errors: [{ reason: "storageQuotaExceeded", domain: "usageLimits" }] } }))
      .toEqual({ motivo: "storageQuotaExceeded", detalhe: "Service Accounts do not have storage quota." });
  });
  it("lê o erro do OAuth", () => {
    expect(lerCorpoErroGoogle({ error: "invalid_grant", error_description: "Invalid JWT Signature." }).motivo).toBe("invalid_grant");
  });
  it("lê o reason de details (API desativada)", () => {
    expect(lerCorpoErroGoogle({ error: { code: 403, status: "PERMISSION_DENIED", message: "Google Drive API has not been used", details: [{ reason: "SERVICE_DISABLED" }] } }).motivo).toBe("SERVICE_DISABLED");
  });
  it("corpo vazio ou inválido não quebra", () => {
    expect(lerCorpoErroGoogle(null)).toEqual({});
    expect(lerCorpoErroGoogle("x")).toEqual({});
  });
  it.each([
    ["storageQuotaExceeded", "upload", 403, /Drive compartilhado/],
    ["accessNotConfigured", "pasta_raiz", 403, /Drive API não está ativada/],
    ["SERVICE_DISABLED", "pasta_raiz", 403, /Drive API não está ativada/],
    ["insufficientFilePermissions", "pasta", 403, /Editor/],
    ["notFound", "pasta_raiz", 404, /pasta raiz não foi encontrada/],
    ["invalid_grant", "autenticacao", 400, /revogada/],
    ["rateLimitExceeded", "upload", 403, /limitou temporariamente/],
  ] as const)("%s → explicação com o que fazer", (motivo, etapa, status, esperado) => {
    const texto = descreverErroDrive(new ErroDrive(etapa, status, motivo, undefined));
    expect(texto).toMatch(esperado);
    expect(texto).toContain(`código ${status}`);
    expect(texto).toContain(motivo);
  });
  it("erros locais também ganham explicação", () => {
    expect(descreverErroDrive(new Error("error:1E08010C:DECODER routines::unsupported"))).toMatch(/chave privada/);
    expect(descreverErroDrive(new Error("Pasta do Google Drive com acesso público; upload recusado"))).toMatch(/público/);
  });
});

describe("tryDriveUpload: o envio nunca se perde", () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; vi.restoreAllMocks(); });

  it("sem Drive configurado: vai para o banco sem aviso", async () => {
    delete process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL;
    const upload = vi.fn();
    expect(await tryDriveUpload(upload)).toEqual({ driveFileId: null, note: null });
    expect(upload).not.toHaveBeenCalled();
  });
  it("Drive recusa: vai para o banco com o motivo, sem vazar segredo no log", async () => {
    process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL = "sa@x.iam.gserviceaccount.com";
    process.env.GOOGLE_DRIVE_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----SEGREDO";
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = "raiz";
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await tryDriveUpload(() => Promise.reject(new ErroDrive("upload", 403, "storageQuotaExceeded", "Service Accounts do not have storage quota.")));
    expect(r.driveFileId).toBeNull();
    expect(r.note).toMatch(/storageQuotaExceeded/);
    expect(JSON.stringify(log.mock.calls)).not.toContain("SEGREDO");
  });
  it("Drive aceita: devolve o ID do arquivo", async () => {
    process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL = "sa@x";
    process.env.GOOGLE_DRIVE_PRIVATE_KEY = "k";
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = "raiz";
    expect(await tryDriveUpload(async () => "abc")).toEqual({ driveFileId: "abc", note: null });
  });
});

describe("mensagens do modo OAuth (conta Google do dono)", () => {
  it("Drive da conta conectada sem espaço", () => {
    expect(descreverErroDrive(new ErroDrive("upload", 403, "storageQuotaExceeded", "The user's Drive storage quota has been exceeded."))).toMatch(/sem espaço livre/);
  });
  it("autorização revogada pede para reconectar", () => {
    expect(descreverErroDrive(new ErroDrive("autenticacao", 400, "oauth_invalid_grant", undefined))).toMatch(/Conectar Google Drive/);
  });
  it("não conectado orienta Configurações", () => {
    expect(descreverErroDrive(new Error("Google Drive não conectado"))).toMatch(/Integrações → Google Drive/);
  });
});
