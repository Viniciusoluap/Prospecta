import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableConfig } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import { incorporationStudies } from "../drizzle/schema";
import * as banco from "./db";
import { incorporationUnitsRouter } from "./incorporacao-unidades-router";
import { sincronizarUnidadesCenario } from "./incorporacao-unidades-cenario";
const pg = new PGlite();
const caller = incorporationUnitsRouter.createCaller({ user: { id: 1, name: "Admin", role: "admin", active: true }, req: {}, res: {} } as never);
const cenario = { id: "A", lotes: [1,2,3].map((n) => ({ tipo: "vendavel", quadra: "1", numero: String(n), areaM2: 200 })), kpis: { lotesVendaveis: 3, areaVendavelM2: 600, aproveitamento: 0.6, vgv: 60000 } };
beforeAll(async () => {
 const cols = getTableConfig(incorporationStudies).columns.map((c) => `"${c.name}" ${c.name === "id" ? "serial PRIMARY KEY" : /^(varchar|text|integer|numeric|boolean|timestamp|double|date)/.test(c.getSQLType()) ? c.getSQLType() : "text"}`);
 await pg.exec(`CREATE TABLE incorporation_studies (${cols.join(",")}); CREATE TABLE users(id integer primary key); INSERT INTO users VALUES(1); CREATE TABLE leads(id integer primary key, name text, phone text, deleted_at timestamp); INSERT INTO leads VALUES(7,'Cliente CRM','99',null);`);
 await pg.exec(readFileSync(new URL("../drizzle/0045_incorporation_units.sql", import.meta.url), "utf8"));
 await pg.exec(readFileSync(new URL("../drizzle/0092_lead_valor_negociado.sql", import.meta.url), "utf8"));
 await pg.exec(readFileSync(new URL("../drizzle/0092_lead_valor_negociado.sql", import.meta.url), "utf8"));
 const m = readFileSync(new URL("../drizzle/0090_unidades_cenario.sql", import.meta.url), "utf8"); await pg.exec(m); await pg.exec(m);
 await pg.query("INSERT INTO incorporation_studies(id,incorporation_type,mass_scenarios_json,selected_scenario_id,area_m2,sem_kml) VALUES(1,'loteamento',$1,'A',1000,false)", [JSON.stringify({ params: { precoM2Lote: 100 }, cenarios: [cenario] })]);
 vi.spyOn(banco,"getDb").mockReturnValue(drizzle(pg) as never);
});
afterAll(() => pg.close());
it("gera unidades e eventos uma vez, sem duplicar ao repetir", async () => {
 expect(await sincronizarUnidadesCenario(1,1)).toEqual({ geradas: 3 }); expect(await sincronizarUnidadesCenario(1,1)).toEqual({ geradas: 0 });
 const r=await caller.list({studyId:1}); expect(r.units).toHaveLength(3); expect(r.units[0]).toMatchObject({code:"Q1 / L1", salePrice:"20000.00", revision:0});
});
it("usa cliente CRM e versão comercial, recusando gravação de versão antiga", async () => {
 const u=(await caller.list({studyId:1})).units[0];
 const input={studyId:1,unitId:u.id,status:"vendida" as const,buyer:"Nome adulterado",buyerLeadId:7,salePrice:"23123.45",expectedRevision:u.revision};
 await caller.edit(input); await expect(caller.edit(input)).rejects.toThrow(/Atualize/);
 expect((await caller.list({studyId:1})).units[0]).toMatchObject({buyer:"Cliente CRM",buyerLeadId:7,salePrice:"23123.45",status:"vendida",revision:1});
 await expect(caller.edit({...input,buyerLeadId:999})).rejects.toThrow(/CRM/);
});
it("preserva venda e reserva e não recria excluída ao trocar cenário", async () => {
 const [sold,reserved,removed]=(await caller.list({studyId:1})).units;
 await caller.transition({studyId:1,unitId:reserved.id,action:"reservar"}); await caller.delete({studyId:1,unitId:removed.id});
 await expect(caller.delete({studyId:1,unitId:sold.id})).rejects.toThrow(/Exclusão bloqueada/); await expect(caller.delete({studyId:1,unitId:reserved.id})).rejects.toThrow(/Exclusão bloqueada/);
 await pg.query("UPDATE incorporation_studies SET mass_scenarios_json=$1,selected_scenario_id='B' WHERE id=1",[JSON.stringify({params:{precoM2Lote:300},cenarios:[{...cenario,id:"B"}]})]);
 await sincronizarUnidadesCenario(1,1); const r=await caller.list({studyId:1}); expect(r.units).toHaveLength(2);
 expect(r.units.find(u=>u.id===sold.id)).toMatchObject({status:"vendida",buyer:"Cliente CRM",salePrice:"23123.45",scenarioId:"A"}); expect(r.units.find(u=>u.id===reserved.id)?.status).toBe("reservada");
});
it("recusa outro estudo e perfil sem módulo",async()=>{
 const u=(await caller.list({studyId:1})).units[0]; await expect(caller.delete({studyId:2,unitId:u.id})).rejects.toThrow();
 const c=incorporationUnitsRouter.createCaller({user:{id:2,role:"colaborador",active:true,permissions:JSON.stringify(["obras"])},req:{},res:{}} as never); await expect(c.synchronize({studyId:1})).rejects.toThrow();
});

it("CRM retorna somente o preço comercial cadastrado, mantendo ausência e centavos", async () => {
 expect((await caller.clients())[0]).toMatchObject({id:7,valorNegociado:null});
 await pg.exec("UPDATE leads SET negotiated_value=23123.45 WHERE id=7");
 expect((await caller.clients())[0]).toMatchObject({nome:"Cliente CRM",valorNegociado:"23123.45"});
 await expect(pg.exec("UPDATE leads SET negotiated_value=-1 WHERE id=7")).rejects.toThrow();
});
