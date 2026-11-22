import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

export default defineConfig({
  schema: ["./drizzle/schema.ts", "./drizzle/schema-central-vendas.ts", "./drizzle/schema-maquete-3d.ts", "./drizzle/schema-camadas-terreno.ts", "./drizzle/schema-incorporacao-logos.ts", "./drizzle/schema-incorporacao-propostas.ts", "./drizzle/schema-dolores.ts", "./drizzle/schema-dolores-whatsapp.ts", "./drizzle/schema-dolores-fila.ts", "./drizzle/schema-dolores-grupos.ts", "./drizzle/schema-dolores-marcacoes.ts", "./drizzle/schema-dolores-notas.ts", "./drizzle/schema-dolores-operacao.ts", "./drizzle/schema-consentimentos.ts", "./drizzle/schema-dolores-conversa.ts", "./drizzle/schema-dolores-pendencia.ts", "./drizzle/schema-dolores-memoria-longa.ts", "./drizzle/schema-whatsapp-atendimento.ts", "./drizzle/schema-ycloud.ts", "./drizzle/schema-whatsapp-grupos.ts", "./drizzle/schema-consultas-cadastrais.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
