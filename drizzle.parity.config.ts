import { defineConfig } from "drizzle-kit";

/**
 * Migration isolada para a paridade Santa Fé -> Prospecta.
 * O schema completo do Prospecta permanece em drizzle.config.ts.
 */
export default defineConfig({
  schema: "./drizzle/parity-schema.ts",
  out: "./drizzle-parity",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://placeholder/placeholder",
  },
  verbose: true,
  strict: true,
});
