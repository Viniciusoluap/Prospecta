// 17/11/2026 — EPIC-025 (etapa 5): notas de obra lidas nos grupos de obra, respostas do empreiteiro reconhecidas e a
// configuração da leitura (migração 0128_dolores_notas.sql). Tabelas novas, em arquivo próprio: nenhuma tabela anterior
// foi alterada. As garantias (nada apagado, o que foi lido não muda, vínculos que só podem virar NULL) estão nos gatilhos.
import { sql } from "drizzle-orm";
import { bigint, boolean, date, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import type { CategoriaNota, ItemNota, SituacaoNota, TipoNota } from "../shared/dolores/notas.js";
import { bpoLancamentos, constructionProjects, users } from "./schema.js";
import { doloresAprovacoes } from "./schema-dolores-fila.js";
import { doloresGrupoMensagens, doloresGrupos } from "./schema-dolores-grupos.js";

export const obraNotas = pgTable("obra_notas", {
  id: serial("id").primaryKey(),
  // EPIC-029 S-5 (0163): sem NOT NULL na coluna, mas a origem 'grupo' continua OBRIGADA a ter grupo e mensagem (CHECK
  // "obra_notas_grupo_exige_mensagem_ck"); a origem 'adn' (NFS-e recebida pelo ADN) não tem nenhum dos dois.
  grupoId: integer("grupo_id").references(() => doloresGrupos.id, { onDelete: "restrict" }),
  mensagemId: integer("mensagem_id").references(() => doloresGrupoMensagens.id, { onDelete: "restrict" }),
  obraId: integer("obra_id").references(() => constructionProjects.id, { onDelete: "set null" }),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  arquivoSha256: varchar("arquivo_sha256", { length: 64 }),
  arquivoMime: varchar("arquivo_mime", { length: 60 }),
  arquivoBytes: integer("arquivo_bytes"),
  situacao: varchar("situacao", { length: 12 }).$type<SituacaoNota>().notNull(),
  tipo: varchar("tipo", { length: 8 }).$type<TipoNota>(),
  emitenteNome: varchar("emitente_nome", { length: 160 }),
  emitenteDocumento: varchar("emitente_documento", { length: 14 }),
  numero: varchar("numero", { length: 30 }),
  dataEmissao: date("data_emissao", { mode: "string" }),
  valorCentavos: bigint("valor_centavos", { mode: "number" }),
  descricao: varchar("descricao", { length: 400 }),
  itens: jsonb("itens").$type<ItemNota[]>().default([]).notNull(),
  chaveAcesso: varchar("chave_acesso", { length: 44 }),
  categoria: varchar("categoria", { length: 20 }).$type<CategoriaNota>(),
  etapa: varchar("etapa", { length: 40 }),
  empreiteiroUserId: integer("empreiteiro_user_id").references(() => users.id, { onDelete: "set null" }),
  confianca: jsonb("confianca").$type<Record<string, number>>().default({}).notNull(),
  duvidas: jsonb("duvidas").$type<string[]>().default([]).notNull(),
  alertas: jsonb("alertas").$type<string[]>().default([]).notNull(),
  duplicadaDe: integer("duplicada_de"),
  modelo: varchar("modelo", { length: 120 }),
  lidaEm: timestamp("lida_em", { withTimezone: true }),
  confirmacao: varchar("confirmacao", { length: 10 }).$type<"pendente" | "confirmada" | "correcao">().default("pendente").notNull(),
  confirmacaoEm: timestamp("confirmacao_em", { withTimezone: true }),
  bpoLancamentoId: integer("bpo_lancamento_id").references(() => bpoLancamentos.id, { onDelete: "set null" }),
  conciliadaEm: timestamp("conciliada_em", { withTimezone: true }),
  conciliadaAprovacaoId: integer("conciliada_aprovacao_id").references(() => doloresAprovacoes.id, { onDelete: "restrict" }),
  driveFileId: varchar("drive_file_id", { length: 200 }),
  salvaEm: timestamp("salva_em", { withTimezone: true }),
  salvaAprovacaoId: integer("salva_aprovacao_id").references(() => doloresAprovacoes.id, { onDelete: "restrict" }),
  // EPIC-029 S-5 (0163): origem da nota, chave de 50 dígitos da NFS-e, NSU do ADN e CNPJ alfanumérico do emitente.
  origem: varchar("origem", { length: 10 }).$type<OrigemObraNota>().default("grupo").notNull(),
  chaveNfse: varchar("chave_nfse", { length: 50 }),
  nsu: bigint("nsu", { mode: "number" }),
  emitenteCnpjAlfa: varchar("emitente_cnpj_alfa", { length: 14 }),
  // EPIC-029 S-5b (0166): NFS-e cancelada (evento do ADN; vazio → preenchido uma vez) e "mesma nota por outra origem"
  // (ADN × grupo: não é duplicada, mas só a primeira é conciliada).
  canceladaEm: timestamp("cancelada_em", { withTimezone: true }),
  cancelamentoTipo: varchar("cancelamento_tipo", { length: 6 }),
  outraOrigemDe: integer("outra_origem_de"),
}, t => [
  uniqueIndex("obra_notas_mensagem_uidx").on(t.mensagemId),
  index("obra_notas_obra_idx").on(t.obraId, t.criadoEm),
  index("obra_notas_grupo_idx").on(t.grupoId, t.criadoEm),
  uniqueIndex("obra_notas_bpo_uidx").on(t.bpoLancamentoId).where(sql`${t.bpoLancamentoId} IS NOT NULL`),
  uniqueIndex("obra_notas_chave_nfse_uidx").on(t.chaveNfse).where(sql`${t.chaveNfse} IS NOT NULL`),
]);
export type ObraNota = typeof obraNotas.$inferSelect;
export type OrigemObraNota = "grupo" | "adn";

/** EPIC-029 S-5 (0163): XML original da NFS-e recebida pelo ADN (uma linha por nota 'adn'; só inserção). */
export const obraNotasAdn = pgTable("obra_notas_adn", {
  notaId: integer("nota_id").primaryKey().references(() => obraNotas.id, { onDelete: "restrict" }),
  tomadorCnpj: varchar("tomador_cnpj", { length: 14 }).notNull(),
  xml: text("xml").notNull(),
  xmlSha256: varchar("xml_sha256", { length: 64 }).notNull(),
  capturadaEm: timestamp("capturada_em", { withTimezone: true }).defaultNow().notNull(),
});

/** EPIC-029 S-5b (0166): eventos de cancelamento lidos na distribuição do ADN (casados com a nota quando ela existir). */
export const obraNotasEventosAdn = pgTable("obra_notas_eventos_adn", {
  id: serial("id").primaryKey(),
  chaveNfse: varchar("chave_nfse", { length: 50 }).notNull(),
  tipoEvento: varchar("tipo_evento", { length: 6 }).notNull(),
  nsu: bigint("nsu", { mode: "number" }).notNull(),
  tomadorCnpj: varchar("tomador_cnpj", { length: 14 }).notNull(),
  xml: text("xml").notNull(),
  xmlSha256: varchar("xml_sha256", { length: 64 }).notNull(),
  recebidoEm: timestamp("recebido_em", { withTimezone: true }).defaultNow().notNull(),
  notaId: integer("nota_id").references(() => obraNotas.id, { onDelete: "restrict" }),
  casadoEm: timestamp("casado_em", { withTimezone: true }),
  // 0170: "recebida" (casa com obra_notas) ou "emitida" (cancelamento de nota que a própria empresa emitiu; para a S-7)
  papel: varchar("papel", { length: 8 }).$type<"recebida" | "emitida">().default("recebida").notNull(),
}, t => [uniqueIndex("obra_notas_eventos_adn_uidx").on(t.chaveNfse, t.tipoEvento)]);

export const obraNotasRespostas = pgTable("obra_notas_respostas", {
  id: serial("id").primaryKey(),
  notaId: integer("nota_id").notNull().references(() => obraNotas.id, { onDelete: "restrict" }),
  grupoMensagemId: integer("grupo_mensagem_id").notNull().references(() => doloresGrupoMensagens.id, { onDelete: "restrict" }),
  tipo: varchar("tipo", { length: 12 }).$type<"confirmacao" | "correcao">().notNull(),
  ligacao: varchar("ligacao", { length: 12 }).$type<"citacao" | "referencia">().notNull(),
  remetente: varchar("remetente", { length: 30 }),
  empreiteiroUserId: integer("empreiteiro_user_id").references(() => users.id, { onDelete: "set null" }),
  texto: varchar("texto", { length: 500 }),
  recebidaEm: timestamp("recebida_em", { withTimezone: true }),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  uniqueIndex("obra_notas_respostas_msg_uidx").on(t.grupoMensagemId),
  index("obra_notas_respostas_nota_idx").on(t.notaId, t.criadoEm),
]);

export const obraNotasConfig = pgTable("obra_notas_config", {
  id: integer("id").primaryKey().default(1),
  leituraLigada: boolean("leitura_ligada").default(false).notNull(),
  prazoConfirmacaoDias: integer("prazo_confirmacao_dias").default(7).notNull(),
  janelaConciliacaoDias: integer("janela_conciliacao_dias").default(30).notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
  atualizadoPor: integer("atualizado_por").references(() => users.id, { onDelete: "set null" }),
});
export type ObraNotasConfig = typeof obraNotasConfig.$inferSelect;
