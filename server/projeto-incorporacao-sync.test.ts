// Lote 2, correção 07 (AD-07): Projeto Aprovado ↔ Projetos — banco real em memória (PGlite).
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", async orig => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste" } }));
vi.mock("./usuario-documentos.js", () => ({ listarEngenheiros: vi.fn(async () => []) }));

import { getDb } from "./db.js";
import {
  refletirProjetoNoEstudo,
  removerProcessoDoEstudo,
  salvarAprovacaoProjetoSincronizado,
  vinculoDoProjeto,
} from "./projeto-incorporacao-sync.js";
import { projetosRouter } from "./operacional-router.js";
import {
  lerProcessosAprovacao,
  normalizarProcessos,
  planejarSincronizacao,
  processoComDadosDoProjeto,
  statusInternoAposSituacaoExterna,
} from "../shared/incorporacao/projeto-sincronizacao.js";

const MIGRACAO = readFileSync(new URL("../drizzle/0086_projeto_incorporacao.sql", import.meta.url), "utf8");
const BASE = `
  CREATE TABLE users (id serial PRIMARY KEY, name text, email varchar(320), role varchar(20) NOT NULL, active boolean DEFAULT true NOT NULL);
  CREATE TABLE incorporation_studies (id serial PRIMARY KEY, name varchar(255) NOT NULL, project_approval_json text,
    updated_at timestamp DEFAULT now() NOT NULL);
  CREATE TABLE operational_projects (
    id serial PRIMARY KEY, name varchar(255) NOT NULL, types text DEFAULT '[]' NOT NULL, status varchar(40) DEFAULT 'orcamento' NOT NULL,
    client_name varchar(255) NOT NULL, client_phone varchar(40) NOT NULL, engineer varchar(255) NOT NULL,
    engineer_user_id integer REFERENCES users(id) ON DELETE SET NULL, engineer_registration varchar(60),
    value numeric(15,2) NOT NULL, paid_value numeric(15,2) DEFAULT 0 NOT NULL, deadline timestamp,
    lead_id integer, lead_service_id integer, description text DEFAULT '' NOT NULL, checklist text DEFAULT '[]' NOT NULL,
    files text DEFAULT '[]' NOT NULL, created_at timestamp DEFAULT now() NOT NULL, updated_at timestamp DEFAULT now() NOT NULL);
`;

let pg: PGlite;
const linhas = async <T = Record<string, unknown>>(q: string) => (await pg.query<T>(q)).rows;
const json = (processos: unknown[]) => JSON.stringify({ processos });
const projetosDoEstudo = () => linhas<Record<string, unknown>>(
  "SELECT id, name, status, types, client_name, lead_id, engineer, engineer_user_id, engineer_registration, approval_process_id, approval_authority, approval_protocol, approval_status, approval_notes, to_char(deadline, 'YYYY-MM-DD') AS prazo, checklist, files FROM operational_projects ORDER BY id");
const processosDoEstudo = async () => lerProcessosAprovacao((await linhas<{ j: string }>("SELECT project_approval_json AS j FROM incorporation_studies WHERE id = 1"))[0].j);
const admin = () => projetosRouter.createCaller({ user: { id: 1, role: "admin", active: true }, req: {}, res: {} } as never);

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(BASE);
  await pg.exec(MIGRACAO);
  vi.mocked(getDb).mockReturnValue(drizzle(pg) as never);
  await pg.exec(`INSERT INTO users (name, role) VALUES ('Admin', 'admin'), ('Eng. Carla', 'colaborador'), ('Corretor', 'corretor');
    INSERT INTO incorporation_studies (name) VALUES ('Residencial Teste');`);
});
afterEach(async () => { await pg.close(); });

describe("correção 07 — regras puras", () => {
  it("mapeamento externo → interno: só exigência e aprovado, e nunca sobre entregue/cancelado", () => {
    expect(statusInternoAposSituacaoExterna("em_elaboracao", "em_analise", "exigencia")).toBe("revisao");
    expect(statusInternoAposSituacaoExterna("revisao", "exigencia", "aprovado")).toBe("aprovado");
    expect(statusInternoAposSituacaoExterna("em_elaboracao", "nao_protocolado", "protocolado")).toBe("em_elaboracao");
    expect(statusInternoAposSituacaoExterna("em_elaboracao", "exigencia", "exigencia")).toBe("em_elaboracao"); // sem mudança externa
    expect(statusInternoAposSituacaoExterna("entregue", "em_analise", "exigencia")).toBe("entregue");
    expect(statusInternoAposSituacaoExterna("cancelado", "em_analise", "aprovado")).toBe("cancelado");
  });

  it("normaliza processos (ids repetidos, órgão/status inválidos, datas) e planeja sem duplicar", () => {
    const lista = normalizarProcessos([
      { id: "a", orgao: "Corpo de Bombeiros", status: "xx", prazoPrevisto: "31/12/2026" },
      { id: "a", orgao: "Outro", status: "aprovado" },
      { id: "", orgao: "Outro" },
      { id: "b", orgao: "?", status: "aprovado", engenheiroId: "abc" },
    ]);
    expect(lista).toHaveLength(2);
    expect(lista[0]).toMatchObject({ id: "a", orgao: "Corpo de Bombeiros", status: "nao_protocolado", prazoPrevisto: undefined });
    expect(lista[1]).toMatchObject({ id: "b", orgao: "Outro", status: "aprovado", engenheiroId: undefined });
    const plano = planejarSincronizacao(lista, [{ id: 10, approvalProcessId: "a" }, { id: 11, approvalProcessId: "z" }]);
    expect(plano.criar.map(p => p.id)).toEqual(["b"]);
    expect(plano.atualizar.map(u => u.projeto.id)).toEqual([10]);
    expect(plano.desvincular.map(p => p.id)).toEqual([11]);
    expect(lerProcessosAprovacao("{corrompido")).toEqual([]);
  });

  it("dados do projeto voltam ao processo sem perder id nem data de protocolo", () => {
    const p = processoComDadosDoProjeto(
      { id: "a", orgao: "Outro", status: "protocolado", dataProtocolo: "2026-01-02" },
      { approvalAuthority: "Corpo de Bombeiros", approvalProtocol: " 123 ", approvalStatus: "exigencia", approvalNotes: "", deadlineDia: "2026-12-01", engineerUserId: 2, engineer: "Eng", engineerRegistration: "CREA-MA 1" },
    );
    expect(p).toEqual({ id: "a", orgao: "Corpo de Bombeiros", status: "exigencia", dataProtocolo: "2026-01-02", numeroProtocolo: "123", prazoPrevisto: "2026-12-01", observacoes: undefined, engenheiroId: 2, engenheiro: "Eng", engenheiroRegistro: "CREA-MA 1" });
  });
});

describe("correção 07 — sincronização com o banco", () => {
  it("migração 0086 é idempotente e impede dois projetos para o mesmo processo", async () => {
    await pg.exec(MIGRACAO);
    const ins = "INSERT INTO operational_projects (name, client_name, client_phone, engineer, value, incorporation_study_id, approval_process_id) VALUES ('x','x','','',0,1,'p1')";
    await pg.exec(ins);
    await expect(pg.exec(ins)).rejects.toThrow();
  });

  it("salvar cria um projeto por processo (sem lead), e salvar/reabrir de novo não duplica", async () => {
    const processos = [
      { id: "p1", orgao: "Prefeitura (projeto arquitetônico)", status: "protocolado", numeroProtocolo: "PM-1", prazoPrevisto: "2026-12-10", observacoes: "Obs", engenheiroId: 2, engenheiroRegistro: "CREA-MA 123" },
      { id: "p2", orgao: "Corpo de Bombeiros", status: "nao_protocolado" },
    ];
    const r = await salvarAprovacaoProjetoSincronizado(1, json(processos));
    expect(r.vinculos).toHaveLength(2);
    await salvarAprovacaoProjetoSincronizado(1, json(processos));
    await salvarAprovacaoProjetoSincronizado(1, json(processos)); // reabrir e salvar
    const rows = await projetosDoEstudo();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: "Prefeitura (projeto arquitetônico) — Residencial Teste", status: "solicitado", client_name: "Residencial Teste", lead_id: null,
      engineer: "Eng. Carla", engineer_user_id: 2, engineer_registration: "CREA-MA 123", approval_process_id: "p1",
      approval_authority: "Prefeitura (projeto arquitetônico)", approval_protocol: "PM-1", approval_status: "protocolado", approval_notes: "Obs", prazo: "2026-12-10",
      types: JSON.stringify(["projeto_arquitetonico"]),
    });
    expect(JSON.parse(rows[0].checklist as string)).toEqual([{ id: "projeto_arquitetonico", type: "projeto_arquitetonico", text: "Projeto Arquitetônico", done: false }]);
    expect(rows[1]).toMatchObject({ types: "[]", engineer: "", engineer_user_id: null });
    // O nome do engenheiro gravado no estudo vem do cadastro.
    expect((await processosDoEstudo())[0].engenheiro).toBe("Eng. Carla");
  });

  it("recusa engenheiro que não é colaborador/admin ativo", async () => {
    await expect(salvarAprovacaoProjetoSincronizado(1, json([{ id: "p1", orgao: "Outro", status: "protocolado", engenheiroId: 3 }]))).rejects.toThrow(/colaborador ativo/);
    expect(await projetosDoEstudo()).toHaveLength(0);
  });

  it("edição na Incorporação atualiza o projeto e aplica o mapeamento externo → interno", async () => {
    await salvarAprovacaoProjetoSincronizado(1, json([{ id: "p1", orgao: "Outro", status: "em_analise" }]));
    await pg.exec("UPDATE operational_projects SET status = 'em_elaboracao'");
    await salvarAprovacaoProjetoSincronizado(1, json([{ id: "p1", orgao: "Corpo de Bombeiros", status: "exigencia", numeroProtocolo: "CB-9" }]));
    let [p] = await projetosDoEstudo();
    expect(p).toMatchObject({ status: "revisao", approval_status: "exigencia", approval_protocol: "CB-9", approval_authority: "Corpo de Bombeiros", name: "Corpo de Bombeiros — Residencial Teste" });
    // Nome editado em Projetos não é sobrescrito.
    await pg.exec("UPDATE operational_projects SET name = 'Nome manual', status = 'entregue'");
    await salvarAprovacaoProjetoSincronizado(1, json([{ id: "p1", orgao: "Corpo de Bombeiros", status: "aprovado" }]));
    [p] = await projetosDoEstudo();
    expect(p).toMatchObject({ name: "Nome manual", status: "entregue", approval_status: "aprovado", approval_protocol: null });
  });

  it("edição em Projetos volta ao processo (órgão, protocolo, prazo, situação, observações, engenheiro)", async () => {
    await salvarAprovacaoProjetoSincronizado(1, JSON.stringify({ extra: 1, processos: [{ id: "p1", orgao: "Outro", status: "protocolado", dataProtocolo: "2026-01-05" }, { id: "p2", orgao: "Outro", status: "aprovado" }] }));
    const [p] = await projetosDoEstudo();
    await admin().update({ id: p.id as number, data: {
      name: "Projeto legal", types: ["projeto_arquitetonico"], status: "em_elaboracao", clientName: "Residencial Teste", clientPhone: "",
      engineerUserId: 2, engineer: "", engineerRegistration: "CREA-MA 9", value: 0, paidValue: 0, deadline: new Date("2027-02-03T12:00:00Z"),
      leadId: null, description: "", checklist: [], files: [],
      approvalAuthority: "Órgão Ambiental", approvalProtocol: "AMB-7", approvalStatus: "em_analise", approvalNotes: "Aguardando vistoria",
    } });
    const processos = await processosDoEstudo();
    expect(processos[0]).toEqual({ id: "p1", orgao: "Órgão Ambiental", status: "em_analise", dataProtocolo: "2026-01-05", numeroProtocolo: "AMB-7", prazoPrevisto: "2027-02-03", observacoes: "Aguardando vistoria", engenheiroId: 2, engenheiro: "Eng. Carla", engenheiroRegistro: "CREA-MA 9" });
    expect(processos[1]).toMatchObject({ id: "p2", status: "aprovado" });
    const bruto = JSON.parse((await linhas<{ j: string }>("SELECT project_approval_json AS j FROM incorporation_studies"))[0].j);
    expect(bruto.extra).toBe(1);
    // O andamento interno não mexe na situação externa.
    expect((await projetosDoEstudo())[0]).toMatchObject({ status: "em_elaboracao", approval_status: "em_analise" });
    // Ida e volta não duplica.
    await salvarAprovacaoProjetoSincronizado(1, json(processos));
    expect(await projetosDoEstudo()).toHaveLength(2);
  });

  it("processo excluído na Incorporação → projeto desvinculado e cancelado, com documentos preservados", async () => {
    await salvarAprovacaoProjetoSincronizado(1, json([{ id: "p1", orgao: "Outro", status: "protocolado", observacoes: "Obs" }, { id: "p2", orgao: "Outro", status: "aprovado" }]));
    await pg.exec(`UPDATE operational_projects SET files = '[{"name":"planta.pdf","url":"https://x/y"}]' WHERE approval_process_id = 'p1'`);
    const r = await salvarAprovacaoProjetoSincronizado(1, json([{ id: "p2", orgao: "Outro", status: "aprovado" }]));
    expect(r.vinculos.map(v => v.processoId)).toEqual(["p2"]);
    const [p1] = await projetosDoEstudo();
    expect(p1).toMatchObject({ status: "cancelado", approval_process_id: null, files: '[{"name":"planta.pdf","url":"https://x/y"}]' });
    expect(p1.approval_notes).toMatch(/^Obs\nProcesso de aprovação excluído na Incorporação em/);
    expect(await projetosDoEstudo()).toHaveLength(2);
  });

  it("projeto excluído em Projetos → processo sai do Projeto Aprovado e não renasce", async () => {
    await salvarAprovacaoProjetoSincronizado(1, json([{ id: "p1", orgao: "Outro", status: "protocolado" }, { id: "p2", orgao: "Outro", status: "aprovado" }]));
    const [p] = await projetosDoEstudo();
    const vinculo = await vinculoDoProjeto(p.id as number);
    expect(vinculo).toEqual({ incorporationStudyId: 1, approvalProcessId: "p1" });
    await pg.exec(`DELETE FROM operational_projects WHERE id = ${p.id}`);
    await removerProcessoDoEstudo(vinculo!);
    const processos = await processosDoEstudo();
    expect(processos.map(x => x.id)).toEqual(["p2"]);
    await salvarAprovacaoProjetoSincronizado(1, json(processos));
    expect(await projetosDoEstudo()).toHaveLength(1);
    // Projeto sem vínculo: refletir/remover não fazem nada.
    await refletirProjetoNoEstudo(9999);
    await removerProcessoDoEstudo({ incorporationStudyId: null, approvalProcessId: null });
  });
});
