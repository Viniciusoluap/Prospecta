-- 21/11/2026 — EPIC-027 C5, etapa E2 ("a Dolores resolve"). Pedido do dono: "eu espero que eu posso falar com ela e resolver
-- problemas dentro do meu negócio, e não simplesmente ter programações". A Dolores propõe em uma frase e faz quando ele
-- responde "pode" (registro) ou "confirmo" (ação séria). Story: docs/stories/epics/epic-027-correcoes-20-11-noite/C5-E2-resolve.md.
--
-- "dolores_conversa_pendencia": a proposta que espera a resposta do dono na conversa DIRETA dele com a Dolores. Uma linha por
--   proposta; guarda só ids dos itens de "dolores_aprovacoes" (o que executa é o item gravado e conferido por hash, nunca uma
--   reinterpretação da IA), o nível ('registro' → "pode"; 'serio' → "confirmo"), a validade curta (15 / 10 min), se a pergunta
--   ainda é a ÚLTIMA coisa que ele recebeu ("adjacente": qualquer outra mensagem enviada a ele depois desliga) e a decisão.
--   QA C5-E2 (A1): a proposta nasce NÃO confirmável ("adjacente" = false); só depois que a pergunta foi enviada ela passa a
--   aceitar resposta, com a hora do envio em "pergunta_enviada_em" — e só vale resposta que o dono escreveu depois dessa hora.
--   Nenhum texto, nome ou dado pessoal nesta tabela. NO MÁXIMO UMA aberta (índice único parcial): proposta nova substitui a
--   anterior, e a troca fica registrada ('substituida').
--
-- Somente ADITIVA e IDEMPOTENTE (CREATE ... IF NOT EXISTS). Nenhum dado existente é alterado ou apagado; nenhuma tabela anterior
-- muda. Reversão: DROP TABLE "dolores_conversa_pendencia" (sem ela, a confirmação volta a ser só "aprovar CÓDIGO" e a tela).

CREATE TABLE IF NOT EXISTS "dolores_conversa_pendencia" (
  "id" serial PRIMARY KEY,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "vence_em" timestamp with time zone NOT NULL,
  "mensagem_id" integer REFERENCES "dolores_mensagens"("id") ON DELETE SET NULL,
  "aprovacao_ids" integer[] NOT NULL CHECK (cardinality("aprovacao_ids") BETWEEN 1 AND 10),
  "nivel" varchar(10) NOT NULL CHECK ("nivel" IN ('registro', 'serio')),
  "situacao" varchar(12) NOT NULL DEFAULT 'aberta' CHECK ("situacao" IN ('aberta', 'confirmada', 'recusada', 'vencida', 'substituida')),
  "adjacente" boolean NOT NULL DEFAULT false,
  "pergunta_enviada_em" timestamp with time zone,
  "decidida_em" timestamp with time zone,
  "decidida_mensagem_id" integer REFERENCES "dolores_mensagens"("id") ON DELETE SET NULL
);

-- no máximo UMA proposta aberta, garantido pelo banco (duas abertas ao mesmo tempo: a segunda falha e é tratada no código)
CREATE UNIQUE INDEX IF NOT EXISTS "dolores_conversa_pendencia_uma_aberta" ON "dolores_conversa_pendencia" ((true)) WHERE "situacao" = 'aberta';
CREATE INDEX IF NOT EXISTS "dolores_conversa_pendencia_criado_em_idx" ON "dolores_conversa_pendencia" ("criado_em");
