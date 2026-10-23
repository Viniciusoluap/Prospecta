import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNotification, getDb } from "./db.js";
import { sendEmail } from "./_core/email-smtp.js";
import { router } from "./_core/trpc.js";
import { projetosRouter } from "./operacional-router.js";
import { emailPedidoRevisao, lerEntregas, mensagemPedidoSalvo, validarPedidoRevisao, LIMITE_PEDIDO_REVISAO } from "../shared/projeto-revisao.js";

vi.mock("./db.js", () => ({ getDb: vi.fn(), createNotification: vi.fn() }));
vi.mock("./_core/email-smtp.js", () => ({ sendEmail: vi.fn() }));

const app = router({ projetos: projetosRouter });
const admin = () => ({ user: { id: 99, name: "Ana Admin", role: "admin", active: true }, req: {}, res: {} }) as never;

/** Construtor fluente mínimo: cada select/insert/update consome a próxima resposta. */
function fakeDb(respostas: unknown[]) {
  let i = 0;
  const chamadas: { metodo: string; dados?: unknown }[] = [];
  const cadeia = (metodo: string) => {
    const valor = () => respostas[i++];
    let resultado: unknown;
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit", "orderBy", "returning"]) c[m] = () => c;
    c.values = (dados: unknown) => { chamadas.push({ metodo, dados }); return c; };
    c.set = (dados: unknown) => { chamadas.push({ metodo, dados }); return c; };
    c.then = (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => { resultado ??= valor(); return Promise.resolve(resultado).then(ok, erro); };
    return c;
  };
  vi.mocked(getDb).mockReturnValue({ select: () => cadeia("select"), insert: () => cadeia("insert"), update: () => cadeia("update") } as never);
  return chamadas;
}

const projeto = { id: 5, name: "Casa Silva", clientName: "João Silva", engineerUserId: 12 };

describe("Projetos — solicitar revisão (etapa 2C)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("salva o pedido com autor e avisa o colaborador por notificação e e-mail", async () => {
    const chamadas = fakeDb([[projeto], [{ id: 12, name: "Eng. Carla", email: "carla@example.com", active: true }], [{ id: 31 }], []]);
    vi.mocked(createNotification).mockResolvedValue({} as never);
    vi.mocked(sendEmail).mockResolvedValue(true);
    const r = await app.createCaller(admin()).projetos.solicitarRevisao({ projectId: 5, texto: "  Ajustar a planta baixa  " });
    expect(r).toMatchObject({ id: 31, notificacao: "enviado", email: "enviado", mensagem: { tipo: "ok" } });
    expect(chamadas[0]).toMatchObject({ metodo: "insert", dados: expect.objectContaining({ projectId: 5, requestedByUserId: 99, requestedByName: "Ana Admin", requestText: "Ajustar a planta baixa", status: "pendente", engineerUserId: 12 }) });
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 12, type: "system", relatedId: 5, actionUrl: "/admin/projetos?projeto=5" }));
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "carla@example.com", metadata: expect.objectContaining({ revisionId: 31, kind: "project_revision" }) }));
    expect(chamadas[1]).toMatchObject({ metodo: "update", dados: expect.objectContaining({ notificationStatus: "enviado", emailStatus: "enviado" }) });
  });

  it("sem colaborador vinculado: salva, não notifica ninguém e avisa com clareza", async () => {
    const chamadas = fakeDb([[{ ...projeto, engineerUserId: null }], [{ id: 32 }], []]);
    const r = await app.createCaller(admin()).projetos.solicitarRevisao({ projectId: 5, texto: "Trocar fachada" });
    expect(r).toMatchObject({ notificacao: "sem_destinatario", email: "sem_destinatario", mensagem: { tipo: "aviso" } });
    expect(r.mensagem.texto).toMatch(/ninguém foi notificado/);
    expect(createNotification).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(chamadas.at(-1)?.dados).toMatchObject({ notificationStatus: "sem_destinatario", emailStatus: "sem_destinatario" });
  });

  it("colaborador sem e-mail ou falha SMTP nunca vira 'enviado'", async () => {
    fakeDb([[projeto], [{ id: 12, name: "Eng", email: null, active: true }], [{ id: 33 }], []]);
    vi.mocked(createNotification).mockResolvedValue({} as never);
    expect(await app.createCaller(admin()).projetos.solicitarRevisao({ projectId: 5, texto: "x" })).toMatchObject({ notificacao: "enviado", email: "sem_destinatario" });
    vi.resetAllMocks();
    fakeDb([[projeto], [{ id: 12, name: "Eng", email: "e@example.com", active: true }], [{ id: 34 }], []]);
    vi.mocked(createNotification).mockRejectedValue(new Error("db"));
    vi.mocked(sendEmail).mockResolvedValue(false);
    const r = await app.createCaller(admin()).projetos.solicitarRevisao({ projectId: 5, texto: "x" });
    expect(r).toMatchObject({ notificacao: "falhou", email: "falhou", mensagem: { tipo: "aviso" } });
  });

  it("rejeita pedido vazio ou longo demais antes de gravar", async () => {
    fakeDb([]);
    await expect(app.createCaller(admin()).projetos.solicitarRevisao({ projectId: 5, texto: "   " })).rejects.toThrow("Descreva a modificação");
    expect(() => validarPedidoRevisao("a".repeat(LIMITE_PEDIDO_REVISAO + 1))).toThrow(/no máximo/);
  });

  it("e-mail escapa HTML e entregas legadas/ inválidas não quebram", () => {
    const m = emailPedidoRevisao({ projeto: "<b>P</b>", cliente: "C", autor: "A", texto: "<script>", link: "https://x/admin/projetos?projeto=1" });
    expect(m.html).not.toContain("<script>");
    expect(m.subject).toContain("Revisão solicitada");
    expect(lerEntregas("lixo")).toEqual([]);
    expect(lerEntregas('[{"nome":"a"}]')).toHaveLength(1);
    expect(mensagemPedidoSalvo("enviado", "falhou").texto).toMatch(/falhou/);
  });
});
