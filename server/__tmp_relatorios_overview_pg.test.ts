// TEMPORÁRIO (não versionar): valida o SQL do overview contra Postgres local com as migrações do repositório.
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("./db.js", async (orig) => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn() }));
import { getDb } from "./db.js";
import { relatoriosRouter } from "./relatorios-router.js";

const pool = new Pool({ connectionString: "postgresql://postgres:local_build_only@localhost:5432/prospecta_rel_lote3" });
const q = (s: string) => pool.query(s);
beforeAll(async () => {
  vi.mocked(getDb).mockReturnValue(drizzle(pool) as never);
  await q(`INSERT INTO users (id, "openId", name, role) VALUES (901, 'rel-1', 'Ana Corretora', 'corretor'), (902, 'rel-2', 'Bruno Corretor', 'corretor')`);
  await q(`INSERT INTO leads (id, name, phone, stage, broker_id, simulation_value, created_at) VALUES
    (9001,'L1','0','measurements',901,300000,'2026-05-01'),
    (9002,'L2','0','followup',902,NULL,'2026-05-02'),
    (9003,'L3','0','waiting_docs',NULL,NULL,'2026-05-03'),
    (9004,'L4 excluido','0','lead_new',NULL,NULL,'2026-05-03')`);
  await q(`UPDATE leads SET deleted_at = now() WHERE id = 9004`);
  await q(`INSERT INTO imoveis (id, slug, titulo, tipo, preco, cidade, status, review_status) VALUES
    (9101,'a','A','casa',1,'X','disponivel','approved'),(9102,'b','B','casa',1,'X','reservado','approved'),
    (9103,'c','C','casa',1,'X','alugado','approved'),(9104,'d','D','casa',1,'X','disponivel','pending'),
    (9105,'e','Obra — E','casa',1,'X','reservado','approved')`);
  await q(`INSERT INTO construction_projects (id, title, lead_id, status, start_date, vgv, financed_amount, fgts_amount, subsidy_amount, imovel_id) VALUES
    (9201,'O1',9001,'in_progress','2026-03-01',1,200000,10000,40000,9105),
    (9202,'O2',NULL,'planning',NULL,150000,100000,NULL,0,NULL),
    (9203,'O3',NULL,'cancelled','2026-03-01',999999,0,0,0,NULL),
    (9204,'O4',9002,'distrato','2026-03-01',500000,0,0,0,NULL)`);
  await q(`INSERT INTO obra_movimentos (project_id, natureza, categoria, descricao, valor, data, origem, status) VALUES
    (9201,'pagamento','comissao','c',15000,'2026-04-10','manual','confirmado'),
    (9201,'pagamento','comissao','c',999,'2026-04-11','manual','cancelado'),
    (9204,'pagamento','comissao','c',1000,'2026-04-12','manual','confirmado')`);
  await q(`INSERT INTO operational_commissions (beneficiary, business_type, broker_id, construction_project_id, property, amount, percent, status, due_date, paid_at) VALUES
    ('corretor','obra',901,9201,'O1',15000,5,'paga','2026-04-10','2026-04-10'),
    ('corretor','venda_imovel',902,NULL,'A',2000,5,'paga','2026-06-01','2026-06-01'),
    ('empresa','venda_imovel',NULL,NULL,'A',7000,5,'paga','2026-06-01','2026-06-01')`);
  await q(`INSERT INTO incorporation_studies (id, name, city) VALUES (9301,'E','X')`);
  await q(`INSERT INTO incorporation_units (study_id, code, code_key, kind, status, buyer, sale_price, deleted_at) VALUES
    (9301,'1','1','casa','disponivel',NULL,NULL,NULL),(9301,'2','2','casa','reservada',NULL,NULL,NULL),(9301,'3','3','casa','vendida','Fulano',100000,NULL),(9301,'4','4','casa','disponivel',NULL,NULL,now())`);
});
afterAll(async () => { await pool.end(); });

it("overview roda no Postgres e calcula 14/18", async () => {
  const caller = relatoriosRouter.createCaller({ user: { id: 99, role: "admin", active: true }, req: {}, res: {} } as never);
  const r = await caller.overview({ from: "2026-01-01T00:00:00.000Z", to: "2026-12-31T00:00:00.000Z" });
  console.log(JSON.stringify({ vgv: r.vgvObras, funil: r.funilLeads, ranking: r.corretorRanking, unidades: r.unidadesDisponiveis }, null, 1));
  expect(r.vgvObras.obrasElegiveis).toBe(1); // O2 sem início → criada agora (2026-10-29 local) também entra? ver abaixo
});
