// 17/11/2026 — EPIC-024 S-12: registros do termo de consentimento (migrações 0127_consentimentos.sql e
// 0132_consentimentos_retirada.sql). Tabela só de inclusão (gatilho no banco): aceite e retirada são linhas novas.
// "userId" sem chave estrangeira de propósito: excluir a conta continua possível e a prova do aceite permanece.
import { boolean, index, integer, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import type { CanalDoConsentimento, TipoDoConsentimento } from "../shared/termo-consentimento.js";

export type AparelhoDoConsentimento = "celular" | "tablet" | "computador" | "desconhecido";

export const consentimentos = pgTable("consentimentos", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  versaoTermo: varchar("versao_termo", { length: 40 }).notNull(),
  /** Instante do registro (do aceite ou da retirada). */
  aceitoEm: timestamp("aceito_em", { withTimezone: true }).defaultNow().notNull(),
  canal: varchar("canal", { length: 20 }).$type<CanalDoConsentimento>().notNull(),
  aparelho: varchar("aparelho", { length: 12 }).$type<AparelhoDoConsentimento>().default("desconhecido").notNull(),
  comSenha: boolean("com_senha").default(false).notNull(),
  /** 0132: "aceite" ou "revogacao" (retirada do consentimento). */
  tipo: varchar("tipo", { length: 12 }).$type<TipoDoConsentimento>().default("aceite").notNull(),
  /** 0132: quem registrou a retirada (admin ou o próprio titular). */
  registradoPor: integer("registrado_por"),
}, t => [
  index("consentimentos_usuario_idx").on(t.userId, t.aceitoEm),
  index("consentimentos_versao_idx").on(t.versaoTermo),
  index("consentimentos_tipo_idx").on(t.userId, t.tipo),
]);
