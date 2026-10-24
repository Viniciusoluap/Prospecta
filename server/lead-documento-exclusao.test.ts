// Pedido de 24/10: "Documentos anteriores" com botão de excluir de vez.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "./db.js";
import { enviarParaLixeira } from "./drive-documents.js";
import { router } from "./_core/trpc.js";
import { leadDocumentsRouter } from "./lead-documents-router.js";

vi.mock("./db.js", () => ({ getDb: vi.fn() }));
vi.mock("./drive-documents.js", () => ({
  documentHash: vi.fn(), driveConfigured: vi.fn(), readPrivateDocument: vi.fn(), tryDriveUpload: vi.fn(), uploadPrivateDocument: vi.fn(),
  enviarParaLixeira: vi.fn(),
}));
const app = router({ docs: leadDocumentsRouter });
const admin = () => ({ user: { id: 1, role: "admin", active: true }, req: {}, res: {} }) as never;
const cliente = () => ({ user: { id: 9, role: "user", active: true, leadId: 3 }, req: {}, res: {} }) as never;

/** Cada select consome a próxima resposta; deletes e inserts ficam registrados. */
function fakeDb(selects: unknown[][]) {
  let i = 0;
  const deletes: unknown[] = [];
  const inserts: unknown[] = [];
  const cadeia = () => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where"]) c[m] = () => c;
    c.limit = () => Promise.resolve(selects[i++] ?? []);
    return c;
  };
  vi.mocked(getDb).mockReturnValue({
    select: cadeia,
    delete: () => ({ where: (w: unknown) => { deletes.push(w); return Promise.resolve(); } }),
    insert: () => ({ values: (v: unknown) => { inserts.push(v); return Promise.resolve(); } }),
  } as never);
  return { deletes, inserts };
}

describe("excluir documento anterior definitivamente", () => {
  beforeEach(() => vi.resetAllMocks());

  it("apaga o registro, manda o arquivo do Drive para a lixeira e registra na timeline", async () => {
    const db = fakeDb([[{ id: 7, leadId: 3, type: "cnh", fileName: "cnh.pdf", driveFileId: "abc" }], []]);
    const r = await app.createCaller(admin()).docs.excluirDefinitivo({ id: 7 });
    expect(r).toEqual({ success: true, aviso: null });
    expect(enviarParaLixeira).toHaveBeenCalledWith("abc");
    expect(db.deletes).toHaveLength(1);
    expect(db.inserts[0]).toMatchObject({ leadId: 3, description: "Documento CNH (cnh.pdf) excluído definitivamente" });
  });

  it("arquivo do Drive usado por outro lead (duplicado) fica; só o registro sai", async () => {
    const db = fakeDb([[{ id: 7, leadId: 3, type: "other", fileName: "exigencia.pdf", driveFileId: "abc" }], [{ id: 8 }]]);
    await app.createCaller(admin()).docs.excluirDefinitivo({ id: 7 });
    expect(enviarParaLixeira).not.toHaveBeenCalled();
    expect(db.deletes).toHaveLength(1);
  });

  it("falha no Drive não impede a exclusão e devolve aviso", async () => {
    fakeDb([[{ id: 7, leadId: 3, type: "cnh", fileName: null, driveFileId: "abc" }], []]);
    vi.mocked(enviarParaLixeira).mockRejectedValue(new Error("sem acesso"));
    const r = await app.createCaller(admin()).docs.excluirDefinitivo({ id: 7 });
    expect(r.aviso).toMatch(/lixeira do Google Drive/);
  });

  it("cliente não exclui", async () => {
    fakeDb([]);
    await expect(app.createCaller(cliente()).docs.excluirDefinitivo({ id: 7 })).rejects.toThrow();
  });
});
