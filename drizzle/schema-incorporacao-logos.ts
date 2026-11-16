// 16/11/2026 — EPIC-024 (S-02): logotipo de cada empreendimento (migração 0119_logotipo_empreendimento.sql).
// Arquivo separado de schema.ts para não colidir com outras frentes; a chave estrangeira e os CHECKs estão no SQL.
import { customType, integer, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const incorporationStudyLogos = pgTable("incorporation_study_logos", {
  id: serial("id").primaryKey(),
  studyId: integer("study_id").notNull(),
  mime: varchar("mime", { length: 40 }).notNull(),
  nome: varchar("nome", { length: 255 }).notNull(),
  origem: varchar("origem", { length: 10 }).default("envio").notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  tamanho: integer("tamanho").notNull(),
  original: bytea("original").notNull(),
  exibicaoPng: bytea("exibicao_png").notNull(),
  exibicaoSha256: varchar("exibicao_sha256", { length: 64 }).notNull(),
  largura: integer("largura"),
  altura: integer("altura"),
  enviadoPor: integer("enviado_por"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

export type IncorporationStudyLogo = typeof incorporationStudyLogos.$inferSelect;
