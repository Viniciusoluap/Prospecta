-- 21/11/2026 — EPIC-027 C5, etapa E1 ("voz e memória" da Dolores). Pedido do dono em 20/11 (noite): "eu quero algo igual ao
-- Jarvis" — a Dolores lembra do contexto da conversa ("ela", "esse grupo", "o de antes").
-- Story: docs/stories/epics/epic-027-correcoes-20-11-noite/C5-E1-voz-e-memoria.md.
--
-- "dolores_conversa": a memória CURTA da conversa DIRETA do número do dono com a Dolores — e só dela (nada de grupo, cliente
--   ou terceiro: quem grava é o código que já conferiu o número do dono). Uma linha por mensagem:
--   - "papel": 'dono' (o que ele escreveu), 'dolores' (a resposta dela) ou 'sistema' (aviso automático enviado a ele: grupo
--     novo, relatório…);
--   - "origem": 'mensagem' (texto do dono), 'encaminhada' (o dono encaminhou: conteúdo de TERCEIRO, é dado, nunca pedido),
--     'com_midia' (texto que veio junto de um anexo), 'resposta' (dela) ou 'aviso' (do sistema);
--   - "texto": já passou pelo filtro do REGISTRO (senhas, tokens, chaves, códigos de acesso, dados bancários E dados pessoais
--     sempre mascarados), sem os códigos de aprovação e de grupo e sem os quadros do sistema;
--   - "referencias": ids e nome curto de cliente, grupo, obra… que as CONSULTAS do sistema devolveram naquele pedido
--     (extraídos por código, nunca do texto do modelo).
--   Retenção curta: o próprio código apaga as linhas com mais de 24 horas a cada gravação, e "esquece"/"limpa a conversa"
--   (mensagem inteira do dono) apaga todas. Nunca aparece em log, erro, auditoria nem tela.
--
-- Somente ADITIVA e IDEMPOTENTE (CREATE ... IF NOT EXISTS). Nenhum dado existente é alterado ou apagado.
-- Reversão: DROP TABLE "dolores_conversa" (nada depende dela; sem ela, a Dolores volta a responder sem memória).

CREATE TABLE IF NOT EXISTS "dolores_conversa" (
  "id" serial PRIMARY KEY,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "papel" varchar(10) NOT NULL CHECK ("papel" IN ('dono', 'dolores', 'sistema')),
  "origem" varchar(12) NOT NULL CHECK ("origem" IN ('mensagem', 'encaminhada', 'com_midia', 'resposta', 'aviso')),
  "mensagem_id" integer REFERENCES "dolores_mensagens"("id") ON DELETE SET NULL,
  "funcao" varchar(40),
  "texto" varchar(4000) NOT NULL,
  "referencias" jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS "dolores_conversa_criado_em_idx" ON "dolores_conversa" ("criado_em");
