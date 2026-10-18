import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("mantém a PCI histórica após troca e preserva a exclusão autorizada da obra sem órfãos", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE construction_projects(id integer primary key); INSERT INTO construction_projects VALUES(1);
      CREATE TABLE construction_progress_items(project_id integer, incidence_pct numeric(7,4));
      CREATE TABLE construction_progress_history(id integer primary key, project_id integer REFERENCES construction_projects(id) ON DELETE CASCADE, incidence_total_pct numeric(9,4));
      CREATE TABLE construction_photos(id integer primary key);`);
    for (const f of ["0058_medicao_caixa_pci.sql", "0059_medicao_pci_versoes.sql"]) await db.exec(readFileSync(new URL(`../drizzle/${f}`, import.meta.url), "utf8"));
    await db.exec(`INSERT INTO construction_pci(project_id,file_name,size_bytes,data,parsed) VALUES(1,'a.xls',1,decode('01','hex'),'{"incidencias":[1]}');
      INSERT INTO construction_progress_history(id,project_id,incidence_total_pct,pci_version_id) SELECT 1,1,100,version_id FROM construction_pci WHERE project_id=1;
      UPDATE construction_pci SET data=decode('02','hex'), parsed='{"incidencias":[2]}' WHERE project_id=1;`);
    const r = await db.query(`SELECT encode(v.data,'hex') AS original, (SELECT encode(data,'hex') FROM construction_pci WHERE project_id=1) AS atual
      FROM construction_progress_history h JOIN construction_pci_versions v ON v.id=h.pci_version_id WHERE h.id=1`);
    expect(r.rows).toEqual([{ original: "01", atual: "02" }]);
    await expect(db.exec(`DELETE FROM construction_pci_versions WHERE id=(SELECT pci_version_id FROM construction_progress_history WHERE id=1)`)).rejects.toThrow();
    expect((await db.query(`SELECT count(*)::int AS n FROM construction_progress_history`)).rows).toEqual([{ n: 1 }]);
    await db.exec("DELETE FROM construction_projects WHERE id=1");
    expect((await db.query("SELECT count(*)::int AS n FROM construction_pci_versions")).rows).toEqual([{ n: 0 }]);
  } finally { await db.close(); }
}, 30_000);
