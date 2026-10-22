import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveFinancingDocument, validFinancingDocument } from "./financing-document-upload.js";
import { uploadPrivateDocument } from "./drive-documents.js";
import { getDb } from "./db.js";
vi.mock("./drive-documents.js", () => ({ uploadPrivateDocument: vi.fn() }));
vi.mock("./db.js", () => ({ getDb: vi.fn() }));
const input = { itemId: 12, financingId: 5, leadId: 9, label: "PCI em PDF", fileName: "pci.pdf", mimeType: "application/pdf", data: Buffer.from("%PDF-test") };
describe("Documento de financiamento no Drive", () => {
  beforeEach(() => vi.resetAllMocks());
  it("aceita XLS OLE e rejeita arquivo renomeado e maior que 20 MiB", () => {
    expect(validFinancingDocument(Buffer.from([208,207,17,224,161,177,26,225,0]), "application/vnd.ms-excel")).toBe(true);
    expect(validFinancingDocument(Buffer.from("texto.xls"), "application/vnd.ms-excel")).toBe(false);
    expect(validFinancingDocument(Buffer.alloc(20 * 1024 * 1024 + 1), "application/pdf")).toBe(false);
  });
  it("Drive indisponível não marca documento como enviado", async () => {
    vi.mocked(uploadPrivateDocument).mockRejectedValue(new Error("offline"));
    await expect(saveFinancingDocument(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(getDb).not.toHaveBeenCalled();
  });
  it("grava vínculo do item e conclui solicitação somente após o Drive aceitar", async () => {
    const set = vi.fn(() => ({ where: vi.fn(() => "update") }));
    const batch = vi.fn();
    vi.mocked(getDb).mockReturnValue({ update: () => ({ set }), execute: vi.fn(), batch } as never);
    vi.mocked(uploadPrivateDocument).mockResolvedValue("drive-1");
    await expect(saveFinancingDocument(input)).resolves.toEqual({ storage: "drive" });
    expect(uploadPrivateDocument).toHaveBeenCalledWith(expect.objectContaining({ leadId: 9, categoria: "financiamento_checklist:5:12", rotulo: "PCI em PDF" }));
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ documentoDriveFileId: "drive-1", solicitarDocumento: false, concluido: true }));
    expect(batch).toHaveBeenCalledOnce();
  });
});
