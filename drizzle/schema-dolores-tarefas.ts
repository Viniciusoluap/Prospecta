// 22/11/2026 — EPIC-027 C5 (tarefa demorada sem travar a conversa): o pedido só de leitura do dono que não coube numa resposta
// (migração 0153_dolores_tarefas_demoradas.sql). Tabela nova, em arquivo próprio: nenhuma tabela anterior foi alterada. Quem grava
// e lê é server/dolores/tarefa-demorada.ts.
import { index, integer, pgTable, serial, smallint, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { doloresMensagens } from "./schema-dolores-whatsapp.js";

export const SITUACOES_TAREFA = ["aguardando", "executando", "enviando", "concluida", "expirada", "falhou", "bloqueada", "incerta"] as const;
export type SituacaoTarefa = (typeof SITUACOES_TAREFA)[number];

export const doloresTarefasDemoradas = pgTable("dolores_tarefas_demoradas", {
  id: serial("id").primaryKey(),
  mensagemId: integer("mensagem_id").references(() => doloresMensagens.id, { onDelete: "set null" }),
  /** O pedido do dono (sem segredos). Apagado quando a tarefa termina; nunca vai para log, auditoria ou tela. */
  comando: text("comando"),
  situacao: varchar("situacao", { length: 12 }).$type<SituacaoTarefa>().default("aguardando").notNull(),
  tentativas: smallint("tentativas").default(0).notNull(),
  /** Dia de Imperatriz (AAAA-MM-DD) da criação. */
  dia: varchar("dia", { length: 10 }).notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
  iniciadaEm: timestamp("iniciada_em", { withTimezone: true }),
  concluidaEm: timestamp("concluida_em", { withTimezone: true }),
  motivo: varchar("motivo", { length: 200 }),
  voltas: smallint("voltas").default(0).notNull(),
  tokensEntrada: integer("tokens_entrada").default(0).notNull(),
  tokensSaida: integer("tokens_saida").default(0).notNull(),
}, t => [
  uniqueIndex("dolores_tarefas_demoradas_mensagem_uidx").on(t.mensagemId),
  index("dolores_tarefas_demoradas_situacao_idx").on(t.situacao, t.id),
  index("dolores_tarefas_demoradas_dia_idx").on(t.dia),
]);

export type DoloresTarefaDemorada = typeof doloresTarefasDemoradas.$inferSelect;
