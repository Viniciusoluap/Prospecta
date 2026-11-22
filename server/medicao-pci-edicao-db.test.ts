import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import { read, write } from "xlsx";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as banco from "./db";
import { obraProgressoRouter } from "./obra-progresso-router";
import { constructionProgressHistory } from "../drizzle/schema";
import { lerPci } from "./caixa/pci";
import { PastaBiff8 } from "./caixa/biff8";
import { gerarArquivoMedicao } from "./routes/obra-medicao-caixa";
import { SERVICOS_PROGRESSO, calcularProgresso } from "../shared/financeiro/progresso";
import { dadosPlsPadrao } from "../shared/medicao-caixa";

afterEach(() => vi.restoreAllMocks());
const caller = () => obraProgressoRouter.createCaller({ user: { id: 1, role: "admin", active: true }, req: {}, res: {} } as never);

async function preparar() {
  const pg = new PGlite();
  await pg.exec(`CREATE TABLE construction_projects(id integer primary key, progress_measured_pct numeric, progress integer, updated_at timestamp, start_date timestamp, estimated_end_date timestamp);
    INSERT INTO construction_projects(id) VALUES(10);
    CREATE TABLE construction_progress_items(project_id integer, service_key text, incidence_pct numeric(20,15), execution_pct numeric, updated_by integer, updated_at timestamp);
    CREATE TABLE construction_progress_history(id serial primary key, project_id integer REFERENCES construction_projects(id), progress_pct numeric, incidence_total_pct numeric, items jsonb, created_by integer, created_at timestamp, requested_at timestamp, requested_by integer, received_at timestamp, received_by integer, updated_at timestamp, updated_by integer);
    CREATE TABLE construction_photos(id integer primary key, caption text);
    CREATE TABLE construction_photo_files(photo_id integer, mime text, data bytea);`);
  for (const f of ["0058_medicao_caixa_pci.sql", "0059_medicao_pci_versoes.sql", "0060_medicao_email.sql"]) await pg.exec(readFileSync(new URL(`../drizzle/${f}`, import.meta.url), "utf8"));
  await pg.exec("ALTER TABLE construction_pci ADD COLUMN drive_file_id text");
  const p = PastaBiff8.abrir(new Uint8Array(readFileSync(new URL("./caixa/__fixtures__/pci-modelo-anonimo.xls", import.meta.url))));
  p.escrever("Proposta_Constr_Individual", "G44", "PCI ANTERIOR TESTE");
  const antiga = p.salvar(), a = lerPci(antiga);
  const wb = read(antiga, { type: "array" });
  wb.Sheets.Proposta_Constr_Individual.G44 = { t: "s", v: "PCI NOVA TESTE" };
  for (const [k, valor] of [[0, a.incidencias[1]], [1, a.incidencias[0]]] as const) wb.Sheets.Proposta_Constr_Individual[`X${120 + k}`] = { t: "n", v: valor };
  const nova = new Uint8Array(write(wb, { type: "array", bookType: "xlsx" })), n = lerPci(nova);
  const itens = SERVICOS_PROGRESSO.map((s, k) => ({ chave: s.chave, incidencia: String(a.incidencias[k]), execucao: k === 0 ? "100" : "50" }));
  const dados = { pls: { ...dadosPlsPadrao({ numeroContrato: "1.1111.1111111-1", valorImovel: 188000 }), dataLevantamento: "2026-11-21", observacoes: "MANTER VISTORIA" }, repactuacao: null, alteracao: null };
  await pg.query("INSERT INTO construction_pci_versions(id,project_id,checksum,file_name,data,parsed) VALUES(1,10,md5($1::bytea),'anterior.xls',$1,$2),(2,10,md5($3::bytea),'nova.xlsx',$3,$4)", [Buffer.from(antiga), a, Buffer.from(nova), n]);
  await pg.exec("SELECT setval('construction_pci_versions_id_seq',3,false)");
  await pg.query("INSERT INTO construction_pci(project_id,file_name,size_bytes,data,parsed,linked_at) VALUES(10,'nova.xlsx',$1,$2,$3,now())", [nova.length, Buffer.from(nova), n]);
  // O trigger pode adotar uma versão por checksum; estes ids ficam estáveis para o teste.
  await pg.exec("UPDATE construction_pci SET version_id=2");
  await pg.query("INSERT INTO construction_progress_history(id,project_id,progress_pct,incidence_total_pct,items,created_at,pci_version_id,caixa_data) VALUES(1,10,50,100,$1,'2026-11-19',1,$2),(2,10,50,100,$1,'2026-11-21',1,$2)", [itens, dados]);
  await pg.exec("INSERT INTO construction_photos(id,caption,progress_history_id) VALUES(101,'FOTO MANTIDA',2)");
  const real = drizzle(pg);
  let antesDoBatch: (() => Promise<void>) | null = null;
  const fake = { select: real.select.bind(real), update: real.update.bind(real), execute: real.execute.bind(real),
    batch: async (ops: { execute(): Promise<unknown> }[]) => {
      if (antesDoBatch) await antesDoBatch();
      await pg.exec("BEGIN");
      try { const resultados = []; for (const op of ops) resultados.push(await op.execute()); await pg.exec("COMMIT"); return resultados; }
      catch (e) { await pg.exec("ROLLBACK"); throw e; }
    },
  };
  vi.spyOn(banco, "getDb").mockReturnValue(fake as never);
  return { pg, real, itens, n, dados, antesDoBatch: (fn: () => Promise<void>) => { antesDoBatch = fn; } };
}

describe("salvar a edição adota a PCI atualmente vinculada", () => {
  it("atualiza a mesma medição e gera PLS com a nova identificação; mantém fotos e outras medições", async () => {
    const t = await preparar();
    try {
      await caller().editarMedicao({ medicaoId: 2, itens: t.itens, dadosCaixa: t.dados });
      const medicoes = await t.real.select().from(constructionProgressHistory);
      expect(medicoes).toHaveLength(2);
      const atual = medicoes.find(m => m.id === 2)!;
      expect(atual.pciVersionId).toBe(2);
      expect(atual.items.map(i => i.execucao)).toEqual(t.itens.map(i => i.execucao));
      expect(atual.items.map(i => Number(i.incidencia))).toEqual(t.n.incidencias);
      expect(Number(atual.progressPct)).toBeCloseTo(calcularProgresso(atual.items).progresso, 6);
      expect((atual.caixaData as typeof t.dados).pls).toMatchObject({ dataLevantamento: "2026-11-21", observacoes: "MANTER VISTORIA" });
      expect(medicoes.find(m => m.id === 1)?.pciVersionId).toBe(1);
      expect((await t.pg.query("SELECT id,caption,progress_history_id FROM construction_photos")).rows).toEqual([{ id: 101, caption: "FOTO MANTIDA", progress_history_id: 2 }]);
      const pdf = await gerarArquivoMedicao(atual, "Obra de Teste");
      expect(pdf.ok).toBe(true);
      if (pdf.ok) { const texto = Buffer.from(pdf.bytes).toString("latin1"); expect(texto).toContain("PCI NOVA TESTE"); expect(texto).not.toContain("PCI ANTERIOR TESTE"); }
    } finally { await t.pg.close(); }
  }, 30_000);
  it("recusa formulário aberto com outra versão, sem alterar a medição", async () => {
    const t = await preparar();
    try {
      await expect(caller().editarMedicao({ medicaoId: 2, pciVersionId: 1, itens: t.itens })).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await t.pg.query("SELECT pci_version_id FROM construction_progress_history WHERE id=2")).rows[0]).toEqual({ pci_version_id: 1 });
    } finally { await t.pg.close(); }
  }, 30_000);
  it("uma troca de PCI antes de adquirir a trava desfaz o salvamento inteiro", async () => {
    const t = await preparar();
    try {
      t.antesDoBatch(async () => { await t.pg.exec("UPDATE construction_pci SET linked_at=NULL"); });
      await expect(caller().editarMedicao({ medicaoId: 2, itens: t.itens })).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await t.pg.query("SELECT pci_version_id,updated_at FROM construction_progress_history WHERE id=2")).rows[0]).toEqual({ pci_version_id: 1, updated_at: null });
    } finally { await t.pg.close(); }
  }, 30_000);
  it("sem nova PCI vinculada mantém a versão histórica", async () => {
    const t = await preparar();
    try {
      await t.pg.exec("UPDATE construction_pci SET linked_at=NULL");
      await caller().editarMedicao({ medicaoId: 2, pciVersionId: 1, itens: t.itens });
      expect((await t.pg.query("SELECT pci_version_id FROM construction_progress_history WHERE id=2")).rows[0]).toEqual({ pci_version_id: 1 });
    } finally { await t.pg.close(); }
  }, 30_000);
  it("editar uma medição antiga não muda o progresso atual nem a medição mais recente", async () => {
    const t = await preparar();
    try {
      await t.pg.exec("UPDATE construction_projects SET progress_measured_pct=87, progress=87");
      await caller().editarMedicao({ medicaoId: 1, itens: t.itens });
      expect((await t.pg.query("SELECT pci_version_id FROM construction_progress_history WHERE id=1")).rows[0]).toEqual({ pci_version_id: 2 });
      expect((await t.pg.query("SELECT pci_version_id,updated_at FROM construction_progress_history WHERE id=2")).rows[0]).toEqual({ pci_version_id: 1, updated_at: null });
      expect((await t.pg.query("SELECT progress FROM construction_projects WHERE id=10")).rows[0]).toEqual({ progress: 87 });
    } finally { await t.pg.close(); }
  }, 30_000);
  it("preserva ajustes manuais feitos no formulário já carregado com a PCI atual", async () => {
    const t = await preparar();
    try {
      await caller().editarMedicao({ medicaoId: 2, pciVersionId: 2, itens: t.itens.map((i,k) => ({ ...i, incidencia: String(t.n.incidencias[k]) })), dadosCaixa: { ...t.dados, pls: { ...t.dados.pls, numeroContrato: "MANUAL-NOVO", valorImovel: 240000 } } });
      const m = (await t.real.select().from(constructionProgressHistory)).find(m => m.id === 2)!;
      expect((m.caixaData as typeof t.dados).pls).toMatchObject({ numeroContrato: "MANUAL-NOVO", valorImovel: 240000 });
    } finally { await t.pg.close(); }
  }, 30_000);
  it("recusa incidências alteradas num formulário que já exibiu a PCI atual", async () => {
    const t = await preparar();
    try {
      await expect(caller().editarMedicao({ medicaoId: 2, pciVersionId: 2, itens: t.itens })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect((await t.pg.query("SELECT pci_version_id,updated_at FROM construction_progress_history WHERE id=2")).rows[0]).toEqual({ pci_version_id: 1, updated_at: null });
    } finally { await t.pg.close(); }
  }, 30_000);
});
