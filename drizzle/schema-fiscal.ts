// 22/11/2026 — EPIC-029 S-2 (rascunhos de nota, sem emitir nada). Tabelas novas da migração 0154_fiscal_notas.sql.
// Regra do dono (decisão k): nada já cadastrado é copiado — emissor lê o perfil tributário pelo CNPJ; a nota guarda só
// referências (cliente do BPO, card do CRM, obra) e os ajustes que o dono fizer.
import { bigint, bigserial, boolean, date, integer, jsonb, numeric, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import type { MotivoSemNota } from "../shared/fiscal/motivos.js";
import type { OrigemNota } from "../shared/fiscal/origens.js";
import type { StatusNota } from "../shared/fiscal/status.js";

export type ViaFiscal = "tela" | "whatsapp" | "sistema";
export type AmbienteFiscal = "desligado" | "producao_restrita" | "producao";
export type RegraTipoServico = "sempre_perguntar" | "nunca_gerar";

export const fiscalConfig = pgTable("fiscal_config", {
  id: boolean("id").primaryKey().default(true),
  ligado: boolean("ligado").default(false).notNull(),
  inicioEm: date("inicio_em", { mode: "string" }).notNull(),
  ultimaVarreduraEm: timestamp("ultima_varredura_em", { withTimezone: true }),
  atualizadoPor: integer("atualizado_por"),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
});

export const fiscalEmissores = pgTable("fiscal_emissores", {
  id: serial("id").primaryKey(),
  cnpj: varchar("cnpj", { length: 14 }).notNull(),
  municipioNome: varchar("municipio_nome", { length: 100 }),
  municipioUf: varchar("municipio_uf", { length: 2 }),
  municipioIbge: varchar("municipio_ibge", { length: 7 }),
  inscricaoMunicipal: varchar("inscricao_municipal", { length: 30 }),
  serieDps: varchar("serie_dps", { length: 5 }),
  proximoNumeroDps: bigint("proximo_numero_dps", { mode: "number" }).default(1).notNull(),
  ambiente: varchar("ambiente", { length: 20 }).$type<AmbienteFiscal>().default("desligado").notNull(),
  ativo: boolean("ativo").default(true).notNull(),
  criadoPor: integer("criado_por"),
  atualizadoPor: integer("atualizado_por"),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
});

export const fiscalTiposServico = pgTable("fiscal_tipos_servico", {
  id: serial("id").primaryKey(),
  nome: varchar("nome", { length: 120 }).notNull(),
  emissorId: integer("emissor_id"),
  codigoTributacaoNacional: varchar("codigo_tributacao_nacional", { length: 6 }),
  codigoNbs: varchar("codigo_nbs", { length: 9 }),
  itemLc116: varchar("item_lc116", { length: 5 }),
  /** EPIC-029 S-4 (0162): cAtvSN — código da atividade do Simples (Anexo VIII). */
  codigoAtividadeSimples: varchar("codigo_atividade_simples", { length: 2 }),
  descricaoPadrao: text("descricao_padrao"),
  aliquotaIss: numeric("aliquota_iss", { precision: 7, scale: 4 }),
  retencoes: jsonb("retencoes"),
  regra: varchar("regra", { length: 20 }).$type<RegraTipoServico>().default("sempre_perguntar").notNull(),
  origens: jsonb("origens").$type<string[]>().default([]).notNull(),
  ativo: boolean("ativo").default(true).notNull(),
  atualizadoPor: integer("atualizado_por"),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
});

export const fiscalNotas = pgTable("fiscal_notas", {
  id: serial("id").primaryKey(),
  emissorId: integer("emissor_id"),
  tipoServicoId: integer("tipo_servico_id"),
  origemTipo: varchar("origem_tipo", { length: 30 }).$type<OrigemNota>().notNull(),
  origemId: integer("origem_id").notNull(),
  origemSubtipo: varchar("origem_subtipo", { length: 40 }),
  dataEvento: date("data_evento", { mode: "string" }).notNull(),
  bpoClientId: integer("bpo_client_id"),
  leadId: integer("lead_id"),
  obraId: integer("obra_id"),
  leadServiceId: integer("lead_service_id"),
  valorAjustadoCentavos: bigint("valor_ajustado_centavos", { mode: "number" }),
  descricaoAjustada: text("descricao_ajustada"),
  municipioIncidenciaNome: varchar("municipio_incidencia_nome", { length: 100 }),
  municipioIncidenciaUf: varchar("municipio_incidencia_uf", { length: 2 }),
  municipioIncidenciaIbge: varchar("municipio_incidencia_ibge", { length: 7 }),
  status: varchar("status", { length: 12 }).$type<StatusNota>().default("A_DECIDIR").notNull(),
  motivoSemNota: varchar("motivo_sem_nota", { length: 30 }).$type<MotivoSemNota>(),
  motivoTexto: text("motivo_texto"),
  motivoSugerido: varchar("motivo_sugerido", { length: 30 }).$type<MotivoSemNota>(),
  adiadaAte: date("adiada_ate", { mode: "string" }),
  alerta: text("alerta"),
  versao: integer("versao").default(1).notNull(),
  decididaPor: integer("decidida_por"),
  decididaEm: timestamp("decidida_em", { withTimezone: true }),
  atualizadoPor: integer("atualizado_por"),
  alteradoVia: varchar("alterado_via", { length: 10 }).$type<ViaFiscal>().default("sistema").notNull(),
  dpsId: varchar("dps_id", { length: 60 }),
  numeroDps: bigint("numero_dps", { mode: "number" }),
  chaveAcesso: varchar("chave_acesso", { length: 50 }),
  xmlDps: text("xml_dps"),
  xmlNfse: text("xml_nfse"),
  protocolo: varchar("protocolo", { length: 60 }),
  ibscbs: jsonb("ibscbs"),
  congelado: jsonb("congelado"),
  emitidaEm: timestamp("emitida_em", { withTimezone: true }),
  emitidaPor: integer("emitida_por"),
  canceladaEm: timestamp("cancelada_em", { withTimezone: true }),
  canceladaPor: integer("cancelada_por"),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
});

export const fiscalNotasHistorico = pgTable("fiscal_notas_historico", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  notaId: integer("nota_id").notNull(),
  acao: varchar("acao", { length: 20 }).notNull(),
  antes: jsonb("antes"),
  depois: jsonb("depois").notNull(),
  usuarioId: integer("usuario_id"),
  via: varchar("via", { length: 10 }).$type<ViaFiscal>().notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
});

export type FiscalNota = typeof fiscalNotas.$inferSelect;
export type FiscalEmissor = typeof fiscalEmissores.$inferSelect;
export type FiscalTipoServico = typeof fiscalTiposServico.$inferSelect;

/** EPIC-029 S-5 (0163): estado da captura das NFS-e recebidas pelo ADN, por CNPJ tomador (desligada por padrão). */
export const fiscalDistribuicaoEstado = pgTable("fiscal_distribuicao_estado", {
  cnpj: varchar("cnpj", { length: 14 }).primaryKey(),
  ligada: boolean("ligada").default(false).notNull(),
  ultimoNsu: bigint("ultimo_nsu", { mode: "number" }).default(0).notNull(),
  ultimaConsultaEm: timestamp("ultima_consulta_em", { withTimezone: true }),
  ultimaConsultaVaziaEm: timestamp("ultima_consulta_vazia_em", { withTimezone: true }),
  ultimoResultado: varchar("ultimo_resultado", { length: 12 }).$type<"ok" | "parcial" | "erro">(),
  documentosGravados: integer("documentos_gravados").default(0).notNull(),
  nsusIlegiveis: jsonb("nsus_ilegiveis").$type<number[]>().default([]).notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
});

// EPIC-029 S-4 (22/11/2026) — cofre do certificado A1 (migração 0162_fiscal_certificados.sql). Ler/decifrar SÓ em
// server/fiscal/certificado.ts (teste-vigia em server/fiscal/certificado.test.ts).
export type OrigemCertificadoFiscal = "juridico" | "arquivo";
export const fiscalEmissoresCertificado = pgTable("fiscal_emissores_certificado", {
  id: serial("id").primaryKey(),
  emissorId: integer("emissor_id").notNull(),
  pfxCifrado: text("pfx_cifrado").notNull(),
  senhaCifrada: text("senha_cifrada").notNull(),
  titular: varchar("titular", { length: 200 }).notNull(),
  cnpj: varchar("cnpj", { length: 14 }).notNull(),
  autoridade: varchar("autoridade", { length: 200 }),
  validoDe: timestamp("valido_de", { withTimezone: true }).notNull(),
  validoAte: timestamp("valido_ate", { withTimezone: true }).notNull(),
  impressaoDigital: varchar("impressao_digital", { length: 64 }).notNull(),
  cadeiaIcp: boolean("cadeia_icp").default(false).notNull(),
  origem: varchar("origem", { length: 12 }).$type<OrigemCertificadoFiscal>().notNull(),
  ativo: boolean("ativo").default(true).notNull(),
  enviadoPor: integer("enviado_por"),
  enviadoEm: timestamp("enviado_em", { withTimezone: true }).defaultNow().notNull(),
  desativadoPor: integer("desativado_por"),
  desativadoEm: timestamp("desativado_em", { withTimezone: true }),
});

export type AcaoCertificadoFiscal = "enviado" | "desativado" | "recusado" | "teste_conexao";
export const fiscalCertificadosHistorico = pgTable("fiscal_certificados_historico", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  emissorId: integer("emissor_id"),
  certificadoId: integer("certificado_id"),
  acao: varchar("acao", { length: 20 }).$type<AcaoCertificadoFiscal>().notNull(),
  detalhe: varchar("detalhe", { length: 300 }),
  usuarioId: integer("usuario_id"),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
});
