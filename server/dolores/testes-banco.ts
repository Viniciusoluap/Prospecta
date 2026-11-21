// EPIC-025 (Dolores, etapa 1) — banco em memória (PGlite) para os testes da ponte e das leituras: tabelas geradas do
// schema Drizzle + migração 0123 aplicada duas vezes (idempotência) e o cenário de aceite com dados sintéticos.
// Usado só pelos arquivos *.test.ts desta pasta; nada aqui toca banco real.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../drizzle/schema.js";

const TABELAS = [
  "users", "leads", "leadServices", "regularizacoes", "regularizacaoDocuments", "regularizacaoEtapas", "regularizacaoItensFinanceiros",
  "regularizacaoRecebimentos", "leadActivities", "leadDocuments", "leadFollowUps", "tasks", "whatsappMessages", "constructionProjects",
  "constructionStages", "constructionProgressHistory", "constructionPciVersions", "obraMeasurements", "obraMovimentos", "financiamentos",
  "financiamentoChecklistItems", "bpoClients", "bpoLancamentos", "bankTransactions", "bankAccounts", "imoveis", "operationalProjects", "incorporationStudies", "avaliacoes", "incorporationUnits",
  "whatsappConnections", "whatsappConversationLinks", "userNotifications",
];

let ddl: string | null = null;
/** `semEtapa7`: para o teste da migração 0133 sobre um banco que já tem grupos (ela é aplicada pelo próprio teste). */
export async function criarBanco(opcoes: { semEtapa7?: boolean } = {}) {
  if (!ddl) {
    const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)("drizzle-kit/api");
    const escolhidas: Record<string, unknown> = {};
    for (const [nome, valor] of Object.entries(schema)) if (TABELAS.includes(nome) || nome.endsWith("Enum")) escolhidas[nome] = valor;
    ddl = (await generateMigration(generateDrizzleJson({}), generateDrizzleJson(escolhidas)) as string[]).join(";\n");
  }
  const pg = new PGlite();
  await pg.exec(ddl);
  const migracao = readFileSync(new URL("../../drizzle/0123_dolores_acoes.sql", import.meta.url), "utf8");
  await pg.exec(migracao);
  await pg.exec(migracao); // idempotente
  // Etapa 2 (WhatsApp): migração 0124, também duas vezes.
  const whatsapp = readFileSync(new URL("../../drizzle/0124_dolores_whatsapp.sql", import.meta.url), "utf8");
  await pg.exec(whatsapp);
  await pg.exec(whatsapp);
  // Etapa 3 (Ações): migração 0125, também duas vezes.
  const fila = readFileSync(new URL("../../drizzle/0125_dolores_fila.sql", import.meta.url), "utf8");
  await pg.exec(fila);
  await pg.exec(fila);
  // Etapa 4 (Grupos): migração 0126, também duas vezes.
  const grupos = readFileSync(new URL("../../drizzle/0126_dolores_grupos.sql", import.meta.url), "utf8");
  await pg.exec(grupos);
  await pg.exec(grupos);
  // QA E4 r2 (N2): a guarda da fila aceita o ON DELETE SET NULL de quem decidiu (0130), também duas vezes.
  const guardaFila = readFileSync(new URL("../../drizzle/0130_dolores_fila_guarda.sql", import.meta.url), "utf8");
  await pg.exec(guardaFila);
  await pg.exec(guardaFila);
  // Etapa 5 (Notas de obra): migração 0128, também duas vezes.
  const notas = readFileSync(new URL("../../drizzle/0128_dolores_notas.sql", import.meta.url), "utf8");
  await pg.exec(notas);
  await pg.exec(notas);
  // Etapa 4b (resposta quando marcada): migração 0129, também duas vezes.
  const marcacoes = readFileSync(new URL("../../drizzle/0129_dolores_marcacoes.sql", import.meta.url), "utf8");
  await pg.exec(marcacoes);
  await pg.exec(marcacoes);
  // Etapa 8 (preços por modelo e cotação): migração 0134, também duas vezes (só depende de "users").
  const precos = readFileSync(new URL("../../drizzle/0134_dolores_precos.sql", import.meta.url), "utf8");
  await pg.exec(precos);
  await pg.exec(precos);
  // Etapa 6 (Operação contínua): migração 0131, também duas vezes.
  const operacao = readFileSync(new URL("../../drizzle/0131_dolores_operacao.sql", import.meta.url), "utf8");
  await pg.exec(operacao);
  await pg.exec(operacao);
  // Etapa 7 (grupos automáticos, por tipo): migração 0133, também duas vezes.
  if (!opcoes.semEtapa7) {
    const tipo = MIGRACAO_0133();
    await pg.exec(tipo);
    await pg.exec(tipo);
  }
  // Etapa 9 (conexão única, atendimento e campanhas): migração 0135, também duas vezes.
  const e9 = MIGRACAO_0135();
  await pg.exec(e9);
  await pg.exec(e9);
  // EPIC-026 C2 (registro do recebimento e números dos "@lid"): migração 0136, também duas vezes.
  const c2 = MIGRACAO_0136();
  await pg.exec(c2);
  await pg.exec(c2);
  // EPIC-026 C3 (mídia da saudação de campanha): migração 0137, também duas vezes.
  const c3 = MIGRACAO_0137();
  await pg.exec(c3);
  await pg.exec(c3);
  // EPIC-026 C6 ("Assumir (humano)" / "Devolver para a Dolores"): migração 0138, também duas vezes.
  const c6 = MIGRACAO_0138();
  await pg.exec(c6);
  await pg.exec(c6);
  // EPIC-027 C3 (classificar grupo aceito pela tela; aceitar recusado continua só do dono): migração 0139, também duas vezes.
  if (!opcoes.semEtapa7) {
    const c3 = MIGRACAO_0139();
    await pg.exec(c3);
    await pg.exec(c3);
    // EPIC-027 C3 (regra do dono de 21/11: só o administrador classifica pela tela): migração 0144, também duas vezes.
    const soAdmin = MIGRACAO_0144();
    await pg.exec(soAdmin);
    await pg.exec(soAdmin);
  }
  // EPIC-027 C2 (grupos do WhatsApp na Central): migração 0142, também duas vezes.
  const c2Central = MIGRACAO_0142();
  await pg.exec(c2Central);
  await pg.exec(c2Central);
  // EPIC-027 C5 (E1, memória curta da conversa do dono): migração 0143, também duas vezes.
  const conversa = MIGRACAO_0143();
  await pg.exec(conversa);
  await pg.exec(conversa);
  // EPIC-027 C5 (E2, proposta que espera o "pode"/"confirmo" do dono): migração 0145, também duas vezes.
  const pendencia = MIGRACAO_0145();
  await pg.exec(pendencia);
  await pg.exec(pendencia);
  // EPIC-027 C5 (memória de longo prazo da Dolores): migração 0149, também duas vezes.
  const memoriaLonga = MIGRACAO_0149();
  await pg.exec(memoriaLonga);
  await pg.exec(memoriaLonga);
  return { pg, db: drizzle(pg) };
}
export const MIGRACAO_0149 = () => readFileSync(new URL("../../drizzle/0149_dolores_memoria_longa.sql", import.meta.url), "utf8");

export const MIGRACAO_0145 = () => readFileSync(new URL("../../drizzle/0145_dolores_pendencia.sql", import.meta.url), "utf8");

export const MIGRACAO_0142 = () => readFileSync(new URL("../../drizzle/0142_grupos_na_central.sql", import.meta.url), "utf8");
export const MIGRACAO_0143 = () => readFileSync(new URL("../../drizzle/0143_dolores_conversa.sql", import.meta.url), "utf8");
export const MIGRACAO_0144 = () => readFileSync(new URL("../../drizzle/0144_dolores_grupos_so_admin_classifica.sql", import.meta.url), "utf8");
export const MIGRACAO_0139 = () => readFileSync(new URL("../../drizzle/0139_dolores_grupos_classificar_pela_tela.sql", import.meta.url), "utf8");

export const MIGRACAO_0138 = () => readFileSync(new URL("../../drizzle/0138_atendimento_modo_conversa.sql", import.meta.url), "utf8");
export const MIGRACAO_0137 = () => readFileSync(new URL("../../drizzle/0137_saudacao_midia.sql", import.meta.url), "utf8");
export const MIGRACAO_0136 = () => readFileSync(new URL("../../drizzle/0136_whatsapp_recebimento.sql", import.meta.url), "utf8");

export const MIGRACAO_0135 = () => readFileSync(new URL("../../drizzle/0135_whatsapp_conexao_unica.sql", import.meta.url), "utf8");
export const MIGRACAO_0133 = () => readFileSync(new URL("../../drizzle/0133_dolores_grupos_tipo.sql", import.meta.url), "utf8");

/** "Agora" dos testes: 16/11/2026 09:00 em Imperatriz. */
export const AGORA = new Date("2026-11-16T12:00:00Z");

/** Cenário de aceite: regularizações atrasada, parada (migrada do Trello), em dia e concluída; obra, financiamento, BPO. */
export const CENARIO = `
  INSERT INTO users ("openId", name, role, active, "passwordHash") VALUES
    ('admin', 'Vinícius Admin', 'admin', true, 'hash'), ('bia', 'Bianca Souza', 'colaborador', true, 'hash');
  INSERT INTO leads (name, phone, cpf, city, stage, responsible_user_id, card_due_date, created_at, updated_at) VALUES
    ('Maria Trello', '(99) 99123-4567', '123.456.789-01', 'Imperatriz', 'attending', 2, '2026-11-10', '2026-03-01 12:00', '2026-10-01 12:00'),
    ('João Atrasado', '99988887777', '98765432100', 'Imperatriz', 'contracts_registry', NULL, NULL, '2026-05-01 12:00', '2026-11-15 12:00'),
    ('Ana Em Dia', '99977776666', NULL, 'Davinópolis', 'measurements', 1, NULL, '2026-06-01 12:00', '2026-11-15 12:00'),
    ('Pedro Concluído', '99966665555', NULL, 'Imperatriz', 'finalized', 1, '2026-01-01', '2025-06-01', '2026-01-10');
  INSERT INTO lead_services (lead_id, service_type, title, status, source_card_url, due_at) VALUES
    (1, 'regularizacao', 'Regularização casa Maria', 'active', 'https://trello.com/c/abc123', NULL),
    (2, 'regularizacao', NULL, 'active', NULL, '2026-11-01'),
    (3, 'regularizacao', NULL, 'active', NULL, NULL),
    (4, 'regularizacao', NULL, 'completed', NULL, NULL),
    (3, 'obra_cliente', 'Casa Ana', 'active', NULL, NULL),
    (2, 'financiamento_habitacional', NULL, 'active', NULL, NULL);
  INSERT INTO regularizacoes (client_name, client_phone, type, status, address, responsible, lead_id, lead_service_id, expected_end_at, notes, created_at, updated_at) VALUES
    ('Maria Trello', '99991234567', '', 'em_andamento', 'Rua A, 1', '', 1, 1, NULL, NULL, '2026-03-01 12:00', '2026-10-01 12:00'),
    ('João Atrasado', '99988887777', 'Averbação de construção', 'em_analise', 'Rua B, 2', 'Bianca Souza', 2, 2, '2026-11-10', 'Cartório pediu nova certidão', '2026-05-01 12:00', '2026-11-15 12:00'),
    ('Ana Em Dia', '99977776666', 'Usucapião', 'em_andamento', 'Rua C, 3', 'Vinícius', 3, 3, '2026-12-20', NULL, '2026-06-01 12:00', '2026-11-15 12:00'),
    ('Pedro Concluído', '99966665555', 'Desmembramento', 'concluido', 'Rua D, 4', 'Vinícius', 4, 4, '2026-01-01', NULL, '2025-06-01', '2026-01-10');
  INSERT INTO regularizacao_etapas (regularizacao_id, nome, ordem, progresso, observacoes, updated_at) VALUES
    (1, 'Levantamento', 1, 100, NULL, '2026-09-01'), (1, 'Protocolo na prefeitura', 2, 40, 'Aguardando certidão do cartório', '2026-10-01 12:00'),
    (2, 'Análise documental', 1, 0, NULL, '2026-11-15 12:00');
  INSERT INTO regularizacao_documents (regularizacao_id, name, status, updated_at) VALUES (2, 'Certidão de matrícula', 'pending', '2026-11-01');
  INSERT INTO lead_documents (lead_id, service_id, type, status, file_name, drive_file_id, created_at, uploaded_at) VALUES
    (1, 1, 'rg', 'pending', NULL, NULL, '2026-03-01', NULL),
    (1, NULL, 'address_proof', 'approved', 'comprovante-maria.pdf', 'drive-segredo-1', '2026-03-01', '2026-03-02'),
    (2, NULL, 'income_proof_formal', 'rejected', 'renda.pdf', 'drive-segredo-2', '2026-05-01', '2026-05-02');
  INSERT INTO tasks (lead_service_id, title, assigned_to, related_type, related_id, priority, status, due_at, created_at, updated_at) VALUES
    (2, 'Cobrar certidão do cartório', 'Bianca Souza', 'lead', 2, 'high', 'pending', '2026-11-12 12:00', '2026-11-01', '2026-11-01'),
    (3, 'Protocolar requerimento de usucapião', 'Vinícius Admin', 'lead', 3, 'medium', 'pending', '2026-11-20 12:00', '2026-11-10', '2026-11-10'),
    (NULL, 'Ligar para Maria', 'Sem responsável', 'lead', 1, 'low', 'done', '2026-09-01 12:00', '2026-08-01', '2026-09-01'),
    (NULL, 'Conferir planilha', 'Bianca Souza', 'general', NULL, 'medium', 'in_progress', '2026-11-14 12:00', '2026-11-01', '2026-11-01');
  INSERT INTO lead_follow_ups (lead_id, attempt, sub_attempt, scheduled_at, status) VALUES (1, 1, 1, '2026-11-18 12:00', 'pending');
  INSERT INTO lead_activities (lead_id, type, description, performed_by, created_at) VALUES
    (2, 'call', 'Cliente avisou que o cartório pediu nova certidão', 'Bianca Souza', '2026-11-15 13:00'),
    (2, 'note', 'Documentação enviada ao cartório', 'Bianca Souza', '2026-11-05 13:00'),
    (1, 'note', 'Cartão migrado do Trello', 'sistema', '2026-03-01 13:00');
  INSERT INTO whatsapp_messages (connection_id, lead_id, destinatario, nome_destinatario, mensagem, direcao, lida, created_at) VALUES
    (1, 1, '5599991234567', 'Maria', 'Bom dia, como está meu processo?', 'entrada', false, '2026-11-14 12:00'),
    (1, 1, '5599991234567', 'Maria', 'Estamos aguardando a certidão do cartório.', 'saida', true, '2026-11-14 13:00');
  INSERT INTO construction_projects (title, lead_id, lead_service_id, status, progress, start_date, estimated_end_date, contract_value, vgv, updated_at) VALUES
    ('Casa Ana', 3, 5, 'in_progress', 60, '2026-05-01', '2026-11-01', '180000.00', '250000.00', '2026-11-10'),
    ('Obra encerrada', NULL, NULL, 'completed', 100, '2025-01-01', '2025-06-01', NULL, NULL, '2025-07-01');
  INSERT INTO construction_stages (project_id, name, order_index, status) VALUES (1, 'Fundação', 1, 'completed'), (1, 'Alvenaria', 2, 'in_progress');
  INSERT INTO construction_progress_history (project_id, progress_pct, incidence_total_pct, items, created_at, requested_at, received_at) VALUES
    (1, '45.5', '100', '[]', '2026-10-20', '2026-10-21', NULL), (1, '30', '100', '[]', '2026-08-20', '2026-08-21', '2026-09-01');
  INSERT INTO financiamentos (cliente_nome, cliente_cpf, cliente_tel, tipo, banco, status, valor_imovel, valor_financiado, lead_id, lead_service_id, updated_at) VALUES
    ('João Atrasado', '987.654.321-00', '99988887777', 'mcmv', 'caixa', 'documentacao', '200000.00', '160000.00', 2, 6, '2026-10-01');
  INSERT INTO financiamento_checklist_items (financiamento_id, grupo, item, concluido, solicitar_documento) VALUES
    (1, 'Documentos', 'Certidão de nascimento', false, true), (1, 'Banco', 'Avaliação do imóvel', true, false);
  INSERT INTO bpo_clients (razao_social, responsavel, telefone, honorarios, data_inicio) VALUES ('Construtora Exemplo', 'Fulano', '9999', '1000', '2026-01-01');
  INSERT INTO bpo_lancamentos (cliente_id, tipo, descricao, valor, valor_recebido, vencimento, pago, competencia, a_classificar) VALUES
    (1, 'honorario', 'Honorários outubro', '1500.00', '500.00', '2026-11-01', false, '2026-10', false),
    (1, 'honorario', 'Honorários novembro', '1500.00', '0', '2026-12-01', false, '2026-11', false),
    (1, 'honorario', 'Honorários setembro', '1500.00', '1500.00', '2026-10-01', true, '2026-09', false),
    (1, 'despesa', 'Aluguel', '900.00', '0', '2026-11-01', false, '2026-10', false),
    (NULL, 'receita', 'Entrada a classificar', '50.00', '0', '2026-11-01', false, '2026-10', true);
  INSERT INTO regularizacao_itens_financeiros (regularizacao_id, nome, grupo, ordem, previsto) VALUES (2, 'Honorários', 'durante_obra', 1, '2000.00');
  INSERT INTO regularizacao_recebimentos (regularizacao_id, item_id, valor, data, origem, status, created_at) VALUES (2, 1, '500.00', '2026-10-01', 'manual', 'confirmado', '2026-10-01 12:00');
`;
