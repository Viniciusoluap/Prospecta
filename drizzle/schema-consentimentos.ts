// 17/11/2026 — EPIC-024 S-12: aceites do termo de consentimento (migração 0127_consentimentos.sql).
// Tabela nova, em arquivo próprio, só de inclusão (gatilho no banco). Nenhuma tabela existente foi alterada.
// "userId" sem chave estrangeira de propósito: excluir a conta continua possível e a prova do aceite permanece.
import { boolean, index, integer, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import type { CanalDoConsentimento } from "../shared/termo-consentimento.js";

export type AparelhoDoConsentimento = "celular" | "tablet" | "computador" | "desconhecido";

export const consentimentos = pgTable("consentimentos", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  versaoTermo: varchar("versao_termo", { length: 40 }).notNull(),
  aceitoEm: timestamp("aceito_em", { withTimezone: true }).defaultNow().notNull(),
  canal: varchar("canal", { length: 20 }).$type<CanalDoConsentimento>().notNull(),
  aparelho: varchar("aparelho", { length: 12 }).$type<AparelhoDoConsentimento>().default("desconhecido").notNull(),
  comSenha: boolean("com_senha").default(false).notNull(),
}, t => [
  index("consentimentos_usuario_idx").on(t.userId, t.aceitoEm),
  index("consentimentos_versao_idx").on(t.versaoTermo),
]);
