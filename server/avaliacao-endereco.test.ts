// Regra do endereço da Avaliação (dono, 17/11/2026): vem do lead ao criar/vincular, é editável na avaliação e a edição
// manual nunca é sobrescrita; mudar o lead atualiza só o que ainda segue o lead. Gêmeo no Santa Fé:
// web/src/lib/__tests__/avaliacao-endereco.test.ts.
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as schema from "../drizzle/schema.js";
import { ENDERECO_A_DEFINIR, enderecoAoVincular, enderecoDaAvaliacaoAposLead } from "../shared/lead-snapshot.js";
import { propagarEnderecoDoLeadParaAvaliacoes } from "./avaliacao-endereco.js";
import * as db from "./db.js";
import { appRouter } from "./routers.js";

vi.mock("./lead-services-router.js", async importOriginal => ({
  ...(await importOriginal<typeof import("./lead-services-router.js")>()),
  linkRecordToLead: vi.fn().mockResolvedValue("linked"),
}));
const propagar = vi.hoisted(() => ({ espiar: false, chamadas: [] as unknown[][] }));
vi.mock("./avaliacao-endereco.js", async importOriginal => {
  const real = await importOriginal<typeof import("./avaliacao-endereco.js")>();
  return {
    ...real,
    propagarEnderecoDoLeadParaAvaliacoes: (...args: Parameters<typeof real.propagarEnderecoDoLeadParaAvaliacoes>) => {
      if (propagar.espiar) { propagar.chamadas.push(args); return Promise.resolve(0); }
      return real.propagarEnderecoDoLeadParaAvaliacoes(...args);
    },
  };
});

const caller = () => appRouter.createCaller({ user: { id: 99, role: "admin", active: true }, req: {}, res: {} } as never);
const lead = {
  id: 12, name: "Maria", phone: "99", email: null, cpf: null,
  address: "Rua das Flores, 100", neighborhood: "Centro", city: "Imperatriz", state: "MA", deletedAt: null,
};
const L = (address: string | null, neighborhood: string | null, city: string | null, state: string | null) => ({ address, neighborhood, city, state });

afterEach(() => { vi.restoreAllMocks(); propagar.espiar = false; propagar.chamadas = []; });

describe("regra pura: mudança no endereço do lead", () => {
  const antes = L("Rua A, 1", "Centro", "Imperatriz", "MA");
  const depois = L("Rua B, 2", "Jardim", "Açailândia", "MA");
  it("avaliação igual ao endereço antigo do lead acompanha a mudança", () => {
    expect(enderecoDaAvaliacaoAposLead({ endereco: "Rua A, 1", bairro: "Centro", cidade: "Imperatriz", estado: "MA" }, antes, depois))
      .toEqual({ endereco: "Rua B, 2", bairro: "Jardim", cidade: "Açailândia" });
  });
  it("vazio ou 'A definir' é preenchido; cidade/UF seguem quando o endereço está pendente", () => {
    expect(enderecoDaAvaliacaoAposLead({ endereco: "", bairro: ENDERECO_A_DEFINIR, cidade: "Imperatriz", estado: "MA" }, L(null, null, null, null), depois))
      .toEqual({ endereco: "Rua B, 2", bairro: "Jardim", cidade: "Açailândia" });
  });
  it("edição manual na avaliação é preservada (campo a campo)", () => {
    expect(enderecoDaAvaliacaoAposLead({ endereco: "Imóvel avaliado, 5", bairro: "Setor X", cidade: "Imperatriz", estado: "MA" }, antes, depois))
      .toEqual({ cidade: "Açailândia" });
    expect(enderecoDaAvaliacaoAposLead({ endereco: "Imóvel avaliado, 5", bairro: "Setor X", cidade: "Davinópolis", estado: "MA" }, antes, depois))
      .toEqual({});
  });
  it("comparação ignora espaços e maiúsculas; lead que apaga um campo não apaga o da avaliação", () => {
    expect(enderecoDaAvaliacaoAposLead({ endereco: " rua a,  1 ", bairro: "CENTRO", cidade: "Imperatriz", estado: "ma" }, antes, depois))
      .toEqual({ endereco: "Rua B, 2", bairro: "Jardim", cidade: "Açailândia" });
    expect(enderecoDaAvaliacaoAposLead({ endereco: "Rua A, 1", bairro: "Centro", cidade: "Imperatriz", estado: "MA" }, antes, L(null, "", "Imperatriz", "MA")))
      .toEqual({});
  });
  it("ao vincular: só os campos que o lead tem preenchidos", () => {
    expect(enderecoAoVincular(L("Rua A, 1", "", "Imperatriz", "ma"))).toEqual({ endereco: "Rua A, 1", cidade: "Imperatriz", estado: "MA" });
  });
});

describe("avaliacoes.update", () => {
  it("avaliação vinculada: o endereço editado na avaliação é salvo e o do lead NÃO o sobrescreve", async () => {
    vi.spyOn(db, "getAvaliacaoById").mockResolvedValue({ id: 31, leadId: 12, leadServiceId: 50 } as never);
    vi.spyOn(db, "getLeadById").mockResolvedValue(lead as never);
    const update = vi.spyOn(db, "updateAvaliacao").mockResolvedValue(undefined as never);
    await caller().avaliacoes.update({ id: 31, leadId: 12, endereco: "Imóvel avaliado, 5", bairro: "Setor X", cidade: "Imperatriz", estado: "MA" });
    expect(update).toHaveBeenCalledWith(31, expect.objectContaining({ clienteNome: "Maria", endereco: "Imóvel avaliado, 5", bairro: "Setor X" }));
  });
  it("salvar sem mandar endereço (ex.: só o status) não mexe no endereço", async () => {
    vi.spyOn(db, "getAvaliacaoById").mockResolvedValue({ id: 31, leadId: 12, leadServiceId: 50 } as never);
    vi.spyOn(db, "getLeadById").mockResolvedValue(lead as never);
    const update = vi.spyOn(db, "updateAvaliacao").mockResolvedValue(undefined as never);
    await caller().avaliacoes.update({ id: 31, status: "vistoria" });
    const dados = update.mock.calls[0][1] as Record<string, unknown>;
    for (const campo of ["endereco", "bairro", "cidade", "estado"]) expect(dados[campo]).toBeUndefined();
  });
  it("vincular agora uma avaliação antiga: o endereço vem do lead", async () => {
    vi.spyOn(db, "getAvaliacaoById").mockResolvedValue({ id: 31, leadId: null, leadServiceId: null } as never);
    vi.spyOn(db, "getLeadById").mockResolvedValue(lead as never);
    const update = vi.spyOn(db, "updateAvaliacao").mockResolvedValue(undefined as never);
    await caller().avaliacoes.update({ id: 31, leadId: 12, endereco: "Antigo", bairro: "Velho", cidade: "X", estado: "PI" });
    expect(update).toHaveBeenCalledWith(31, expect.objectContaining({ endereco: "Rua das Flores, 100", bairro: "Centro", cidade: "Imperatriz", estado: "MA" }));
  });
});

describe("leads.update chama a propagação do endereço", () => {
  it("com endereço no pedido: passa o endereço antigo e o novo; sem endereço: não chama", async () => {
    propagar.espiar = true;
    vi.spyOn(db, "getLeadById").mockResolvedValue({ ...lead, stage: "lead_new", stageClassificationPending: false } as never);
    vi.spyOn(db, "updateLead").mockResolvedValue(undefined as never);
    vi.spyOn(db, "validateLeadAssignment").mockResolvedValue({ responsibleOk: true, brokerOk: true } as never);
    await caller().leads.update({ id: 12, address: "Rua Nova, 7" });
    expect(propagar.chamadas).toEqual([[12, L("Rua das Flores, 100", "Centro", "Imperatriz", "MA"), L("Rua Nova, 7", "Centro", "Imperatriz", "MA")]]);
    await caller().leads.update({ id: 12, notes: "só nota" });
    expect(propagar.chamadas).toHaveLength(1);
  });
});

describe("propagarEnderecoDoLeadParaAvaliacoes (PostgreSQL em memória)", () => {
  it("grava só nas avaliações do lead que ainda seguem o lead", async () => {
    const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)("drizzle-kit/api");
    const escolhidas: Record<string, unknown> = {};
    for (const [nome, valor] of Object.entries(schema)) if (["users", "leads", "avaliacoes", "leadServices"].includes(nome) || nome.endsWith("Enum")) escolhidas[nome] = valor;
    const ddl = (await generateMigration(generateDrizzleJson({}), generateDrizzleJson(escolhidas)) as string[]).join(";\n");
    const pg = new PGlite();
    try {
      await pg.exec(ddl);
      const banco = drizzle(pg);
      await pg.query(`INSERT INTO leads (id, name, phone) VALUES (12, 'Maria', '99'), (13, 'Outro', '98')`);
      const nova = async (leadId: number, endereco: string, bairro: string) => (await pg.query<{ id: number }>(
        `INSERT INTO avaliacoes (numero, tipo, finalidade, cliente_nome, cliente_tel, endereco, bairro, cidade, estado, metodologia, avaliador, lead_id)
         VALUES ($1, 'mercado', 'compra_venda', 'Maria', '99', $2, $3, 'Imperatriz', 'MA', 'comparativo', 'Eng', $4) RETURNING id`,
        [`AVL-${Math.random().toString(36).slice(2, 10)}`, endereco, bairro, leadId])).rows[0].id;
      const segue = await nova(12, "Rua A, 1", "Centro");
      const manual = await nova(12, "Imóvel avaliado, 5", "Setor X");
      const outroLead = await nova(13, "Rua A, 1", "Centro");
      const a = schema.avaliacoes;
      const n = await propagarEnderecoDoLeadParaAvaliacoes(12, L("Rua A, 1", "Centro", "Imperatriz", "MA"), L("Rua B, 2", "Centro", "Imperatriz", "MA"), {
        listar: leadId => banco.select({ id: a.id, endereco: a.endereco, bairro: a.bairro, cidade: a.cidade, estado: a.estado }).from(a).where(eq(a.leadId, leadId)),
        gravar: async (id, dados) => { await banco.update(a).set(dados).where(eq(a.id, id)); },
      });
      expect(n).toBe(1);
      const linhas = (await pg.query<{ id: number; endereco: string; bairro: string }>(`SELECT id, endereco, bairro FROM avaliacoes ORDER BY id`)).rows;
      expect(linhas).toEqual([
        { id: segue, endereco: "Rua B, 2", bairro: "Centro" },
        { id: manual, endereco: "Imóvel avaliado, 5", bairro: "Setor X" },
        { id: outroLead, endereco: "Rua A, 1", bairro: "Centro" },
      ]);
    } finally { await pg.close(); }
  }, 60000);
});
