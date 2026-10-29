// Pedido de 29/10: excluir no sistema → lixeira do Drive (pasta da entidade ou arquivo),
// sempre depois da exclusão no banco. E o documento do engenheiro vai para
// Equipe/<Nome (nº id)>/<categoria>. Sem chamar o Google.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "./db.js";
import { lixeiraDaEntidade, lixeiraDoArquivo } from "./drive-organizacao.js";
import { excluirDefinitivo } from "./exclusao-definitiva.js";
import { excluirImovelDefinitivo } from "./imovel-exclusao.js";
import { fontePorTipo } from "./drive-arquivos.js";
import { appRouter } from "./routers.js";

vi.mock("./drive-organizacao.js", () => ({
  lixeiraDaEntidade: vi.fn(async () => undefined),
  lixeiraDoArquivo: vi.fn(async () => undefined),
  copiarParaDrive: vi.fn(async () => false),
  atualizarPlanilhaOrcamentoNoDrive: vi.fn(async () => undefined),
}));

const admin = { role: "admin", active: true, permissions: null };

/** Banco falso: cada select devolve a próxima resposta; batch registra a ordem. */
function fakeDb(selects: unknown[][], ordem: string[] = []) {
  let i = 0;
  const cadeia = () => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "innerJoin", "leftJoin"]) c[m] = () => c;
    c.limit = () => Promise.resolve(selects[i++] ?? []);
    c.then = (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => Promise.resolve(selects[i++] ?? []).then(ok, erro);
    return c;
  };
  const fake = {
    select: cadeia,
    delete: () => ({ where: () => ({}) }),
    insert: () => ({ values: () => ({}) }),
    batch: vi.fn(async () => { ordem.push("banco"); return []; }),
    execute: vi.fn(async () => ({ rows: [] })),
  };
  vi.spyOn(db, "getDb").mockReturnValue(fake as never);
  return fake;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(lixeiraDaEntidade).mockReset();
  vi.mocked(lixeiraDoArquivo).mockReset();
});

describe("exclusão definitiva → lixeira do Drive", () => {
  it("obra: depois do banco, a pasta obra:<id> vai para a lixeira", async () => {
    const ordem: string[] = [];
    fakeDb([[{ leadServiceId: null }]], ordem);
    vi.mocked(lixeiraDaEntidade).mockImplementation(async () => { ordem.push("drive"); });
    await expect(excluirDefinitivo("obra", 7, admin)).resolves.toEqual({ excluido: true });
    expect(lixeiraDaEntidade).toHaveBeenCalledWith("obra", 7);
    expect(ordem).toEqual(["banco", "drive"]);
  });

  it("estudo de incorporação: pasta incorporacao:<id>", async () => {
    fakeDb([[{ id: 3 }]]);
    await excluirDefinitivo("estudo", 3, admin);
    expect(lixeiraDaEntidade).toHaveBeenCalledWith("incorporacao", 3);
  });

  it("financiamento: os documentos do checklist no Drive vão para a lixeira (arquivo a arquivo)", async () => {
    fakeDb([[{ leadServiceId: null }], [{ f: "doc-1" }, { f: null }]]);
    await excluirDefinitivo("financiamento", 4, admin);
    expect(lixeiraDoArquivo).toHaveBeenCalledWith("doc-1");
    expect(lixeiraDaEntidade).not.toHaveBeenCalled();
  });

  it("registro já excluído: nada no Drive", async () => {
    fakeDb([[]]);
    await expect(excluirDefinitivo("obra", 9, admin)).resolves.toEqual({ excluido: false });
    expect(lixeiraDaEntidade).not.toHaveBeenCalled();
  });

  it("imóvel: pasta imovel:<id> e as fotos", async () => {
    fakeDb([[{ titulo: "Casa", createdByUserId: null, reviewStatus: "approved", reviewedAt: null, updatedAt: new Date() }], [{ driveFileId: "f1" }]]);
    await excluirImovelDefinitivo(11);
    expect(lixeiraDaEntidade).toHaveBeenCalledWith("imovel", 11);
    expect(lixeiraDoArquivo).toHaveBeenCalledWith("f1");
  });

  it("lead excluído definitivamente: pasta cliente:<id> (só depois de apagar no banco)", async () => {
    vi.spyOn(db, "getLeadById").mockResolvedValue({ id: 5, name: "LEAD", deletedAt: new Date("2026-10-20") } as never);
    vi.spyOn(db, "getLeadVinculosExclusao").mockResolvedValue({ obras: 0, financiamentos: 0, regularizacoes: 0, projetos: 0, avaliacoes: 0, contratos: 0, documentos: 0, contas: 0 });
    const apagar = vi.spyOn(db, "excluirLeadArquivadoDefinitivamente").mockResolvedValue(true);
    const caller = appRouter.createCaller({ user: { id: 1, role: "admin", active: true }, req: {}, res: {} } as never);
    await caller.leads.permanentDelete({ id: 5 });
    expect(apagar).toHaveBeenCalledWith(5);
    expect(lixeiraDaEntidade).toHaveBeenCalledWith("cliente", 5);
    apagar.mockResolvedValue(false);
    vi.mocked(lixeiraDaEntidade).mockClear();
    await expect(caller.leads.permanentDelete({ id: 5 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(lixeiraDaEntidade).not.toHaveBeenCalled();
  });

  it("usuário excluído: pasta equipe:<id>", async () => {
    const fake = fakeDb([[{ id: 8, role: "colaborador", active: true }]]);
    fake.delete = () => ({ where: () => Promise.resolve() }) as never;
    const caller = appRouter.createCaller({ user: { id: 1, role: "admin", active: true }, req: {}, res: {} } as never);
    await caller.configuracoes.deleteUser({ id: 8 });
    expect(lixeiraDaEntidade).toHaveBeenCalledWith("equipe", 8);
  });
});

describe("documento do engenheiro no Drive", () => {
  it("vai para Equipe/<Nome (nº id)>/<categoria> com nome 'Categoria — dd-mm-aaaa.ext'", async () => {
    const fake = fakeDb([]);
    fake.execute.mockResolvedValueOnce({ rows: [{ id: 21, user_id: 4, category: "anuidade_crea", original_name: "boleto.pdf", mime: "application/pdf", uploaded_at: new Date("2026-10-29T15:00:00Z"), nome: "João Engenheiro" }] });
    const [item] = await fontePorTipo("usuario_documento")!.pendentes!({ aposId: 0, limite: 1, id: 21 });
    expect(await item.destino()).toEqual({
      caminho: [
        { chave: "equipe", nome: "Equipe" },
        { chave: "equipe:4", nome: "João Engenheiro (nº 4)" },
        { chave: "equipe:4:anuidade_crea", nome: "Anuidade CREA" },
      ],
      nome: "Anuidade CREA — 29-10-2026.pdf",
    });
  });
});
