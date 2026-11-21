-- 21/11/2026 — EPIC-027 (C2): grupos do WhatsApp na Central, com permissão por colaborador e escrita.
-- Pedido do dono: "Aqui nas mensagens do WhatsApp também deve aparecer as mensagens do grupo para que o humano possa intervir";
-- quem vê: o admin e o colaborador com o módulo "WhatsApp" marcado no cadastro (decisão do dono em 21/11: sem permissão
-- separada; corretor nunca); quais: "Todos"; intervir: "Pode escrever".
-- Story: docs/stories/epics/epic-027-correcoes-20-11-noite/C2-grupos-na-central.md.
--
-- 1) "dolores_grupo_mensagens.nome_remetente" (coluna NOVA, anulável): o nome que o participante usa no WhatsApp, filtrado, para a
--    Central mostrar quem escreveu cada mensagem. Só vale das mensagens que chegarem depois desta migração (o histórico não é
--    puxado). Entra na guarda de imutabilidade da tabela (a função da 0126 é recriada igual + a coluna): é preenchida uma vez, logo
--    depois do registro da mensagem (de vazio para o valor), e nunca mais muda.
-- 2) "whatsapp_grupo_envios": o que a EQUIPE escreveu no grupo pela Central (quem, quando, id da mensagem na Evolution).
-- 3) "whatsapp_grupo_atendimento": "Assumir (humano)" / "Devolver para a Dolores" por grupo ("humano" = ela não responde nem quando
--    é marcada, até devolverem). Nunca liga interruptor nenhum.
--
-- Somente ADITIVA e IDEMPOTENTE (ADD COLUMN / CREATE ... IF NOT EXISTS, CREATE OR REPLACE das funções de guarda, DROP TRIGGER IF
-- EXISTS + CREATE TRIGGER só dos gatilhos novos desta migração). Nenhum dado existente
-- é alterado ou apagado.
-- Ordem na publicação: tanto faz (portão de QA, achado 2). O código novo tolera o banco sem esta migração: a mensagem de grupo é
-- registrada sem o nome, a Central mostra o número mascarado, e sem "whatsapp_grupo_atendimento" ninguém assumiu grupo nenhum.
-- Reversão: DROP TABLE "whatsapp_grupo_atendimento", "whatsapp_grupo_envios"; DROP FUNCTION whatsapp_grupo_envios_guarda(); ALTER TABLE "dolores_grupo_mensagens" DROP COLUMN
-- "nome_remetente" (com o código anterior de volta) e recriar a função de guarda da 0126.

ALTER TABLE "dolores_grupo_mensagens" ADD COLUMN IF NOT EXISTS "nome_remetente" varchar(80);

CREATE OR REPLACE FUNCTION dolores_grupo_mensagens_guarda() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'DOLORES_GRUPO_MENSAGENS_SEM_EXCLUSAO: mensagens de grupo registradas não são apagadas';
  END IF;
  -- o que chegou não muda (EPIC-027 C2: inclusive o nome do remetente)
  IF NEW."grupo_id" IS DISTINCT FROM OLD."grupo_id" OR NEW."instancia" IS DISTINCT FROM OLD."instancia"
     OR NEW."external_id" IS DISTINCT FROM OLD."external_id" OR NEW."criado_em" IS DISTINCT FROM OLD."criado_em"
     OR NEW."enviada_em" IS DISTINCT FROM OLD."enviada_em" OR NEW."remetente" IS DISTINCT FROM OLD."remetente"
     OR NEW."do_dono" IS DISTINCT FROM OLD."do_dono" OR NEW."encaminhada" IS DISTINCT FROM OLD."encaminhada"
     OR NEW."tipo" IS DISTINCT FROM OLD."tipo" OR NEW."texto" IS DISTINCT FROM OLD."texto"
     OR NEW."midia_mime" IS DISTINCT FROM OLD."midia_mime" OR NEW."midia_nome" IS DISTINCT FROM OLD."midia_nome"
     OR NEW."midia_tamanho" IS DISTINCT FROM OLD."midia_tamanho"
     -- EPIC-027 C2: o nome do remetente é preenchido UMA vez (de vazio para o valor, logo depois do registro) e nunca trocado
     OR (OLD."nome_remetente" IS NOT NULL AND NEW."nome_remetente" IS DISTINCT FROM OLD."nome_remetente") THEN
    RAISE EXCEPTION 'DOLORES_GRUPO_MENSAGENS_IMUTAVEL: o conteúdo registrado da mensagem não muda';
  END IF;
  -- salvo no card é final: a situação e a classificação não mudam e o vínculo com o documento não é trocado.
  -- Exceção única: o vínculo pode VIRAR NULL — é o ON DELETE SET NULL do Postgres (um UPDATE) quando o CRM exclui o
  -- documento ou o lead arquivado (exclusões legítimas que já existiam). A linha continua "salvo" (histórico).
  IF OLD."situacao" = 'salvo' AND (NEW."situacao" <> 'salvo'
     OR (NEW."lead_document_id" IS DISTINCT FROM OLD."lead_document_id" AND NEW."lead_document_id" IS NOT NULL)
     OR NEW."classificacao" IS DISTINCT FROM OLD."classificacao") THEN
    RAISE EXCEPTION 'DOLORES_GRUPO_MENSAGENS_SALVO: documento já salvo no card não muda';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS "whatsapp_grupo_envios" (
  "id" serial PRIMARY KEY NOT NULL,
  "grupo_id" integer NOT NULL REFERENCES "dolores_grupos"("id") ON DELETE RESTRICT,
  "instancia" varchar(80) NOT NULL,
  -- id da mensagem na Evolution (o eco do envio tem o mesmo id; a leitura não duplica)
  "external_id" varchar(160),
  -- o que a equipe escreveu (texto dela, como na conversa direta da Central)
  "texto" varchar(4096) NOT NULL,
  "situacao" varchar(8) NOT NULL CHECK ("situacao" IN ('enviada', 'falhou')),
  "enviado_por" integer REFERENCES "users"("id") ON DELETE SET NULL,
  -- nome de quem enviou naquele momento ("equipe — Fulano" mesmo se o usuário for removido)
  "enviado_por_nome" varchar(120),
  "criado_em" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "whatsapp_grupo_envios_grupo_idx" ON "whatsapp_grupo_envios" ("grupo_id", "criado_em");
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_grupo_envios_externa_uidx" ON "whatsapp_grupo_envios" ("instancia", "external_id")
  WHERE "external_id" IS NOT NULL;

-- Portão de QA da C2 (achado 5): o que a equipe enviou não muda nem some — sem DELETE/TRUNCATE e sem UPDATE de autor, texto, grupo,
-- id da mensagem, situação ou hora. Exceção única: "enviado_por" pode VIRAR NULL (o ON DELETE SET NULL quando o usuário é excluído;
-- o nome daquele momento fica em "enviado_por_nome").
CREATE OR REPLACE FUNCTION whatsapp_grupo_envios_guarda() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'WHATSAPP_GRUPO_ENVIOS_SEM_EXCLUSAO: o que a equipe enviou ao grupo não é apagado';
  END IF;
  IF NEW."grupo_id" IS DISTINCT FROM OLD."grupo_id" OR NEW."instancia" IS DISTINCT FROM OLD."instancia"
     OR NEW."external_id" IS DISTINCT FROM OLD."external_id" OR NEW."texto" IS DISTINCT FROM OLD."texto"
     OR NEW."situacao" IS DISTINCT FROM OLD."situacao" OR NEW."enviado_por_nome" IS DISTINCT FROM OLD."enviado_por_nome"
     OR NEW."criado_em" IS DISTINCT FROM OLD."criado_em"
     OR (NEW."enviado_por" IS DISTINCT FROM OLD."enviado_por" AND NEW."enviado_por" IS NOT NULL) THEN
    RAISE EXCEPTION 'WHATSAPP_GRUPO_ENVIOS_IMUTAVEL: o envio registrado não muda';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS whatsapp_grupo_envios_guarda ON "whatsapp_grupo_envios";
CREATE TRIGGER whatsapp_grupo_envios_guarda BEFORE UPDATE OR DELETE ON "whatsapp_grupo_envios"
  FOR EACH ROW EXECUTE FUNCTION whatsapp_grupo_envios_guarda();
DROP TRIGGER IF EXISTS whatsapp_grupo_envios_sem_truncate ON "whatsapp_grupo_envios";
CREATE TRIGGER whatsapp_grupo_envios_sem_truncate BEFORE TRUNCATE ON "whatsapp_grupo_envios"
  FOR EACH STATEMENT EXECUTE FUNCTION whatsapp_grupo_envios_guarda();

CREATE TABLE IF NOT EXISTS "whatsapp_grupo_atendimento" (
  "grupo_id" integer PRIMARY KEY NOT NULL REFERENCES "dolores_grupos"("id") ON DELETE RESTRICT,
  "modo" varchar(8) NOT NULL CHECK ("modo" IN ('humano', 'dolores')),
  "alterado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "alterado_por" integer REFERENCES "users"("id") ON DELETE SET NULL
);
