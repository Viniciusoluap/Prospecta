-- 22/11/2026 — EPIC-027 C5 (integração 2, achado do revisor do PR #298): a reserva do limite mensal do aviso proativo da Dolores.
-- Story: docs/stories/epics/epic-027-correcoes-20-11-noite/C5-INTEGRACAO-2.md.
--
-- Número 0160 (e não 0154): a faixa 0154–0159 pode estar em uso pela frente fiscal, em outra branch.
--
-- Antes, a conferência do aviso (server/dolores/consumo.ts#reservarAvisos) não gravava nada: a conversa do dono, a classificação,
-- a resposta em grupo e o atendimento a cliente, conferindo ao mesmo tempo, não enxergavam a chamada do aviso até o consumo real.
-- Agora a reserva fica na própria vaga do aviso (dolores_avisos_envios, a linha "enviando" criada antes do texto), no MESMO
-- formato das outras reservas de terceiros (dolores_grupo_mensagens, dolores_marcacoes, dolores_atendimentos): entra nos totais
-- compartilhados enquanto "reserva_ate" estiver no futuro, é solta depois de registrar o consumo real (ou na falha) e vence
-- sozinha se a função morrer no meio.
--
-- Somente ADITIVA e IDEMPOTENTE (ADD COLUMN IF NOT EXISTS, com padrão). Nenhum dado existente é alterado. Sem a migração, o código
-- confere a coluna e segue como antes (sem reserva gravada).
-- Reversão: ALTER TABLE "dolores_avisos_envios" DROP COLUMN "reserva_entrada", DROP COLUMN "reserva_saida", DROP COLUMN "reserva_ate".

ALTER TABLE "dolores_avisos_envios" ADD COLUMN IF NOT EXISTS "reserva_entrada" integer NOT NULL DEFAULT 0;
ALTER TABLE "dolores_avisos_envios" ADD COLUMN IF NOT EXISTS "reserva_saida" integer NOT NULL DEFAULT 0;
ALTER TABLE "dolores_avisos_envios" ADD COLUMN IF NOT EXISTS "reserva_ate" timestamp with time zone;
