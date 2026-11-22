-- 22/11/2026 — EPIC-027 C5, "tarefa demorada sem travar a conversa" (plano aprovado pelo dono em 21–22/11/2026).
-- Story: docs/stories/epics/epic-027-correcoes-20-11-noite/C5-TAREFA-DEMORADA.md.
--
-- "dolores_tarefas_demoradas": o pedido SÓ DE LEITURA do dono, na conversa DIRETA dele, que não coube no tempo de uma resposta
--   (reconhecido por código: voltas de consulta e prazo restante). A Dolores responde na hora "Vou levantar isso e te mando em
--   seguida", grava a linha aqui e um passo posterior (o próximo aviso da Evolution com tempo de sobra ou o cron da Dolores) retoma,
--   conclui e manda o resultado SÓ ao número do dono. Grupo, cliente e ponte HTTP nunca criam linha aqui.
--   - "comando": o texto do pedido do dono, sem senhas/tokens/chaves/dados bancários (o mesmo que vai à IA). É APAGADO (NULL) assim
--     que a tarefa termina, falha ou vence; nunca vai para log, auditoria ou tela. O resultado NÃO é guardado (vai direto ao dono).
--   - "situacao": aguardando → executando → enviando → concluida; ou expirada (passou da validade), falhou (2 tentativas ou envio
--     com erro), bloqueada (limite de gasto / IA desligada) e incerta (a função parou no meio do envio: não reenvia).
--   - idempotência: uma linha por mensagem (índice único) e todas as trocas de situação são UPDATE condicionais (só quem trocou
--     segue) — a retomada dupla não manda duas respostas.
--
-- Somente ADITIVA e IDEMPOTENTE (CREATE ... IF NOT EXISTS). Nenhuma tabela anterior muda; nenhum dado existente é alterado.
-- Reversão: DROP TABLE "dolores_tarefas_demoradas" (sem ela, o pedido longo volta a responder com o que deu para levantar).

CREATE TABLE IF NOT EXISTS "dolores_tarefas_demoradas" (
  "id" serial PRIMARY KEY,
  "mensagem_id" integer REFERENCES "dolores_mensagens"("id") ON DELETE SET NULL,
  "comando" text CHECK ("comando" IS NULL OR char_length("comando") BETWEEN 1 AND 2000),
  "situacao" varchar(12) NOT NULL DEFAULT 'aguardando'
    CHECK ("situacao" IN ('aguardando', 'executando', 'enviando', 'concluida', 'expirada', 'falhou', 'bloqueada', 'incerta')),
  "tentativas" smallint NOT NULL DEFAULT 0 CHECK ("tentativas" BETWEEN 0 AND 2),
  -- dia de Imperatriz (AAAA-MM-DD) da criação: teto de tarefas por dia
  "dia" varchar(10) NOT NULL,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "expira_em" timestamp with time zone NOT NULL,
  "iniciada_em" timestamp with time zone,
  "concluida_em" timestamp with time zone,
  "motivo" varchar(200),
  "voltas" smallint NOT NULL DEFAULT 0,
  "tokens_entrada" integer NOT NULL DEFAULT 0,
  "tokens_saida" integer NOT NULL DEFAULT 0,
  -- a tarefa aberta guarda o pedido; a terminada, não
  CONSTRAINT "dolores_tarefas_demoradas_comando_so_aberta" CHECK ("situacao" IN ('aguardando', 'executando') OR "comando" IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS "dolores_tarefas_demoradas_mensagem_uidx" ON "dolores_tarefas_demoradas" ("mensagem_id");
CREATE INDEX IF NOT EXISTS "dolores_tarefas_demoradas_situacao_idx" ON "dolores_tarefas_demoradas" ("situacao", "id");
CREATE INDEX IF NOT EXISTS "dolores_tarefas_demoradas_dia_idx" ON "dolores_tarefas_demoradas" ("dia");
