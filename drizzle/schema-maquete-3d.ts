// 14/11/2026 — Maquete 3D (migração 0111_maquete_3d.sql, EPIC-022). Arquivo separado de schema.ts para não
// colidir com outras frentes; as chaves estrangeiras e os CHECKs existem no SQL da migração.
import { customType, decimal, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const maquete3dConfig = pgTable("maquete_3d_config", {
  id: integer("id").primaryKey().default(1),
  dados: text("dados").default("{}").notNull(),
  updatedBy: integer("updated_by"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const maquetes3d = pgTable("maquetes_3d", {
  id: serial("id").primaryKey(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  titulo: varchar("titulo", { length: 255 }).notNull(),
  origem: varchar("origem", { length: 20 }).notNull(),
  projectId: integer("project_id"),
  studyId: integer("study_id"),
  /** Cliente do CRM, quando o pedido não está ligado a um projeto (0115). */
  leadId: integer("lead_id"),
  tipo: varchar("tipo", { length: 20 }).notNull(),
  status: varchar("status", { length: 30 }).notNull(),
  faixaPreco: varchar("faixa_preco", { length: 30 }),
  preco: decimal("preco", { precision: 15, scale: 2 }),
  paymentOrderId: integer("payment_order_id"),
  pagoEm: timestamp("pago_em"),
  liberadoPor: integer("liberado_por"),
  liberadoEm: timestamp("liberado_em"),
  liberacaoNota: varchar("liberacao_nota", { length: 400 }),
  documentos: text("documentos").default("[]").notNull(),
  leitura: text("leitura").default("{}").notNull(),
  modelo: text("modelo"),
  modeloVersao: integer("modelo_versao").default(0).notNull(),
  comercial: text("comercial").default("{}").notNull(),
  revisadoPor: integer("revisado_por"),
  revisadoEm: timestamp("revisado_em"),
  publicadoEm: timestamp("publicado_em"),
  recusaMotivo: varchar("recusa_motivo", { length: 400 }),
  solicitadoPor: integer("solicitado_por"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

export type Maquete3d = typeof maquetes3d.$inferSelect;

/** PDFs enviados direto no pedido (0115_maquete_3d_lead_arquivos.sql). */
export const maquete3dArquivos = pgTable("maquete_3d_arquivos", {
  id: serial("id").primaryKey(),
  maqueteId: integer("maquete_id").notNull(),
  nome: varchar("nome", { length: 255 }).notNull(),
  tamanho: integer("tamanho").notNull(),
  dados: bytea("dados").notNull(),
  enviadoPor: integer("enviado_por"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
