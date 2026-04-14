/**
 * Seed script for Prospecta Empreendimentos obra projects.
 * Run with: npx tsx server/seed-prospecta.ts
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";

async function seed() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL environment variable not set");
    process.exit(1);
  }

  const db = drizzle(process.env.DATABASE_URL);

  console.log("Seeding OBRAS 2025...");

  const obras2025 = [
    {
      title: "Casa MCMV 2025 - Tarcilo Figueiredo",
      clientName: "Tarcilo Figueiredo",
      city: "Parauapebas",
      state: "PA",
      vgv: 153000,
      financedAmount: 137700,
      fgtsAmount: 21850,
      subsidyAmount: 55000,
      lotCost: 14500,
      constructionCost: 85000,
      constructionDays: 90,
      year: 2025,
    },
    {
      title: "Casa MCMV 2025 - Ronaldo Carneiro",
      clientName: "Ronaldo Carneiro",
      city: "Parauapebas",
      state: "PA",
      vgv: 153000,
      financedAmount: 137700,
      fgtsAmount: 21850,
      subsidyAmount: 55000,
      lotCost: 12000,
      constructionCost: 85000,
      constructionDays: 90,
      year: 2025,
    },
    {
      title: "Casa MCMV 2025 - Raimundo Ferreira",
      clientName: "Raimundo Ferreira",
      city: "Parauapebas",
      state: "PA",
      vgv: 153000,
      financedAmount: 137700,
      fgtsAmount: 0,
      subsidyAmount: 55000,
      lotCost: 12000,
      constructionCost: 85000,
      constructionDays: 90,
      year: 2025,
    },
    {
      title: "Casa MCMV 2025 - Lucas Monteiro",
      clientName: "Lucas Monteiro",
      city: "Parauapebas",
      state: "PA",
      vgv: 153000,
      financedAmount: 137700,
      fgtsAmount: 0,
      subsidyAmount: 55000,
      lotCost: 14500,
      constructionCost: 85000,
      constructionDays: 90,
      year: 2025,
    },
    {
      title: "Casa MCMV 2025 - Marcos Rodrigues",
      clientName: "Marcos Rodrigues",
      city: "Parauapebas",
      state: "PA",
      vgv: 153000,
      financedAmount: 137700,
      fgtsAmount: 0,
      subsidyAmount: 55000,
      lotCost: 12000,
      constructionCost: 85000,
      constructionDays: 90,
      year: 2025,
    },
    {
      title: "Casa MCMV 2025 - Andreson Marques",
      clientName: "Andreson Marques",
      city: "Parauapebas",
      state: "PA",
      vgv: 153000,
      financedAmount: 137700,
      fgtsAmount: 0,
      subsidyAmount: 55000,
      lotCost: 14500,
      constructionCost: 85000,
      constructionDays: 90,
      year: 2025,
    },
    {
      title: "Casa MCMV 2025 - Leandro Gomes",
      clientName: "Leandro Gomes",
      city: "Parauapebas",
      state: "PA",
      vgv: 153000,
      financedAmount: 137700,
      fgtsAmount: 0,
      subsidyAmount: 55000,
      lotCost: 14500,
      constructionCost: 85000,
      constructionDays: 90,
      year: 2025,
    },
    {
      title: "Casa MCMV 2025 - Francisco Saraiva",
      clientName: "Francisco Saraiva",
      city: "Parauapebas",
      state: "PA",
      vgv: 153000,
      financedAmount: 137700,
      fgtsAmount: 0,
      subsidyAmount: 55000,
      lotCost: 12000,
      constructionCost: 85000,
      constructionDays: 90,
      year: 2025,
    },
    {
      title: "Casa MCMV 2025 - Mayara Paz",
      clientName: "Mayara Paz",
      city: "Parauapebas",
      state: "PA",
      vgv: 153000,
      financedAmount: 137700,
      fgtsAmount: 0,
      subsidyAmount: 55000,
      lotCost: 14500,
      constructionCost: 85000,
      constructionDays: 90,
      year: 2025,
    },
    {
      title: "Casa MCMV 2025 - Gilberto Ferreira",
      clientName: "Gilberto Ferreira",
      city: "Parauapebas",
      state: "PA",
      vgv: 153000,
      financedAmount: 137700,
      fgtsAmount: 0,
      subsidyAmount: 55000,
      lotCost: 12000,
      constructionCost: 85000,
      constructionDays: 90,
      year: 2025,
    },
    {
      title: "Casa MCMV 2025 - Silvio Picanço",
      clientName: "Silvio Picanço",
      city: "Parauapebas",
      state: "PA",
      vgv: 153000,
      financedAmount: 137700,
      fgtsAmount: 0,
      subsidyAmount: 55000,
      lotCost: 14500,
      constructionCost: 85000,
      constructionDays: 90,
      year: 2025,
    },
    {
      title: "Casa MCMV 2025 - Raimundo Coelho",
      clientName: "Raimundo Coelho",
      city: "Parauapebas",
      state: "PA",
      vgv: 153000,
      financedAmount: 137700,
      fgtsAmount: 0,
      subsidyAmount: 55000,
      lotCost: 12000,
      constructionCost: 85000,
      constructionDays: 90,
      year: 2025,
    },
    {
      title: "Casa MCMV 2025 - Irene Correia",
      clientName: "Irene Correia",
      city: "Parauapebas",
      state: "PA",
      vgv: 153000,
      financedAmount: 137700,
      fgtsAmount: 0,
      subsidyAmount: 55000,
      lotCost: 14500,
      constructionCost: 85000,
      constructionDays: 90,
      year: 2025,
    },
  ];

  const obras2026 = [
    { clientName: "José Almeida",      city: "Parauapebas", lotCost: 15000 },
    { clientName: "Maria Santos",      city: "Parauapebas", lotCost: 13000 },
    { clientName: "Paulo Oliveira",    city: "Parauapebas", lotCost: 15000 },
    { clientName: "Ana Lima",          city: "Canaã dos Carajás", lotCost: 12000 },
    { clientName: "Carlos Souza",      city: "Parauapebas", lotCost: 14000 },
    { clientName: "Juliana Costa",     city: "Parauapebas", lotCost: 15000 },
    { clientName: "Fernando Rocha",    city: "Canaã dos Carajás", lotCost: 13000 },
    { clientName: "Beatriz Nunes",     city: "Parauapebas", lotCost: 14000 },
    { clientName: "Ricardo Pinto",     city: "Parauapebas", lotCost: 15000 },
    { clientName: "Simone Carvalho",   city: "Canaã dos Carajás", lotCost: 12500 },
  ].map((o) => ({
    title: `Morada do Bosque 2026 - ${o.clientName}`,
    clientName: o.clientName,
    city: o.city,
    state: "PA",
    vgv: 170000,
    financedAmount: 153000,
    fgtsAmount: 21850,
    subsidyAmount: 55000,
    lotCost: o.lotCost,
    constructionCost: 90000,
    constructionDays: 90,
    year: 2026,
  }));

  const allObras = [...obras2025, ...obras2026];

  let inserted = 0;
  let skipped = 0;

  for (const obra of allObras) {
    try {
      const mcmvMeta = JSON.stringify({
        clientName: obra.clientName,
        vgv: obra.vgv.toString(),
        financedAmount: obra.financedAmount.toString(),
        fgtsAmount: (obra.fgtsAmount || 0).toString(),
        subsidyAmount: obra.subsidyAmount.toString(),
        constructionCost: obra.constructionCost.toString(),
        constructionDays: obra.constructionDays.toString(),
      });

      const notes = `Projeto MCMV ${obra.year} - ${obra.city}/PA\n__MCMV_META__:${mcmvMeta}`;

      // Insert using raw SQL to avoid schema import issues
      await (db as any).execute(
        `INSERT INTO construction_projects
          (title, address, project_type, status, lot_cost, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE updated_at = NOW()`,
        [
          obra.title,
          `${obra.city}, ${obra.state}`,
          "Casa MCMV 47m²",
          obra.year === 2025 ? "in_progress" : "planning",
          Math.round(obra.lotCost * 100),
          notes,
        ]
      );

      inserted++;
      console.log(`  Inserted: ${obra.title}`);
    } catch (error: any) {
      console.error(`  Error inserting ${obra.title}:`, error.message);
      skipped++;
    }
  }

  console.log(`\nSeed complete: ${inserted} inserted, ${skipped} failed`);
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
