// 16/11/2026 — EPIC-024 (S-06): envios da proposta formal de aquisição do terreno (migração 0120_proposta_terreno_email.sql).
// Arquivo separado de schema.ts para não colidir com outras frentes; a chave estrangeira e o CHECK estão no SQL.
import { date, integer, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";

export const incorporationProposalSends = pgTable("incorporation_proposal_sends", {
  id: serial("id").primaryKey(),
  studyId: integer("study_id").notNull(),
  propostaId: varchar("proposta_id", { length: 80 }).notNull(),
  destinatario: varchar("destinatario", { length: 254 }).notNull(),
  status: varchar("status", { length: 10 }).notNull(),
  motivo: varchar("motivo", { length: 400 }),
  dataEmissao: date("data_emissao", { mode: "string" }).notNull(),
  pdfSha256: varchar("pdf_sha256", { length: 64 }).notNull(),
  enviadoPor: integer("enviado_por"),
  enviadoPorNome: varchar("enviado_por_nome", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type IncorporationProposalSend = typeof incorporationProposalSends.$inferSelect;
