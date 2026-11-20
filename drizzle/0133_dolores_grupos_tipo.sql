-- 19/11/2026 — EPIC-025 (etapa 7, Grupos automáticos, por tipo). Regra do dono de 19/11/2026: "eu não quero ter que cadastrar
-- grupo por grupo; todos os grupos que a Dolores participar é porque ela deve participar". O grupo entra SOZINHO em
-- "dolores_grupos" na primeira mensagem (ou pelo botão "Atualizar grupos"), com o TIPO descoberto por código pelo nome do grupo.
-- (Numerada 0133 porque a 0132 já é a "consentimentos_retirada", em produção.)
-- Colunas novas em "dolores_grupos":
--   - "tipo": cliente, pos_atendimento, juridico, administrativo, parceiros, engenharia, indefinido. Fica VAZIO nos grupos já
--     cadastrados (sem UPDATE em massa): a leitura vale "cliente" com cliente ligado, "engenharia" com obra e "indefinido" sem
--     vínculo (shared/dolores/grupos-tipo.ts, tipoEfetivo).
--   - "origem": manual (padrão: todos os existentes) ou automatico.
--   - "situacao_confirmacao": confirmado (padrão: os existentes foram cadastrados pelo admin), avisado (o dono recebeu o aviso
--     do que ela entendeu) ou aguardando_dono (nome não bateu com nada: só observa, não fala nem quando marcada).
--   - "nome_whatsapp": o nome do grupo visto no WhatsApp NA ENTRADA (metadado da Evolution; texto de terceiro, já filtrado).
--   - "codigo": código curto do grupo, gerado pelo servidor, usado no comando do dono "grupo <código> <tipo> [nº]".
--   - "adicionado_por" / "prova_adicao" (regra do dono de 19/11/2026, mais tarde no mesmo dia: "somente o número principal […]
--     pode adicionar o número da Dolores em grupo"): quem colocou a Dolores no grupo — 'dono' ou 'outra_pessoa' (vazio nos grupos
--     cadastrados à mão; 'desconhecido' = não ficou provado, QA-SEG E7) — e como isso foi provado por código: 'evento_add' (aviso group-participants.update da Evolution, autor =
--     número do dono), 'criador' (groups.upsert com o dono como criador), 'metadado' (o dono é participante e criador/admin do
--     grupo, conferido na Evolution), 'sem_prova' ou 'aceito_pelo_dono' (comando "grupo <código> aceitar").
--   - "situacao_confirmacao" ganha 'recusado': grupo em que outra pessoa colocou a Dolores — não é lido nem respondido.
--   - "decidido_em" / "decidido_por": quando e por onde o dono decidiu o tipo/vínculo ("whatsapp:dono", "tela:<id do admin>",
--     "fila:<id do item>"). Sem chave estrangeira (texto): excluir usuário não dispara nada aqui.
-- "dolores_grupos_config" ganha o interruptor "entrada_automatica_ligada" (nasce LIGADO — é o pedido do dono; nada FALA enquanto o
--   interruptor geral da resposta, da 0129, estiver desligado) e os tetos diários de grupos novos e de avisos ao dono.
-- Gatilho "dolores_grupos_guarda" (CREATE OR REPLACE, mantém TUDO o que já protegia — sem DELETE/TRUNCATE; id do grupo,
--   instância e criado_em imutáveis) e acrescenta:
--   - tipo e vínculo (cliente/obra) só mudam quando "decidido_em" muda na MESMA operação (decisão do dono) — SÓ nas linhas da
--     etapa 7 (origem 'automatico' ou tipo preenchido, antes ou depois). As linhas manuais antigas (origem 'manual', tipo vazio)
--     seguem a regra antiga: o código ANTERIOR à etapa 7 (que não conhece "decidido_em") continua funcionando com a 0133 já
--     aplicada (QA-SEG E7, janela de migração). Exceção única nas da etapa 7: o vínculo VIRAR NULL — é o ON DELETE SET NULL do
--     Postgres quando o CRM exclui o cliente ou a obra (exclusões legítimas);
--   - "origem" 'automatico' não volta a 'manual' (seria a fuga da regra acima);
--   - "nome_whatsapp" e "codigo", depois de preenchidos, não mudam (renomear o grupo no WhatsApp nunca muda tipo nem vínculo);
--   - grupo 'recusado', ou automático 'aguardando_dono' (sem prova de quem colocou a Dolores ou, QA-SEG E7 r2, adicionado pelo
--     dono mas de tipo indefinido), só sai desse estado — situação, quem adicionou ou a prova — por
--     decisão do DONO pelo WhatsApp ("decidido_em" na mesma operação e "decidido_por" começando por 'whatsapp:'). Ir PARA
--     'recusado' é sempre permitido (é o rebaixamento quando o aviso mostra que outra pessoa a colocou).
-- Somente aditiva e idempotente: ADD COLUMN IF NOT EXISTS (com padrão: não dispara o gatilho de UPDATE), CHECKs e índice criados
-- só se faltarem, função trocada por CREATE OR REPLACE. Nenhuma linha existente é alterada; nada é ligado.
-- Reversão: as colunas novas não atrapalham a versão anterior do código; para voltar a guarda antiga, reexecutar a função da 0126.

ALTER TABLE "dolores_grupos" ADD COLUMN IF NOT EXISTS "tipo" varchar(20);
ALTER TABLE "dolores_grupos" ADD COLUMN IF NOT EXISTS "origem" varchar(12) NOT NULL DEFAULT 'manual';
ALTER TABLE "dolores_grupos" ADD COLUMN IF NOT EXISTS "situacao_confirmacao" varchar(16) NOT NULL DEFAULT 'confirmado';
ALTER TABLE "dolores_grupos" ADD COLUMN IF NOT EXISTS "nome_whatsapp" varchar(120);
ALTER TABLE "dolores_grupos" ADD COLUMN IF NOT EXISTS "codigo" varchar(8);
ALTER TABLE "dolores_grupos" ADD COLUMN IF NOT EXISTS "decidido_em" timestamp with time zone;
ALTER TABLE "dolores_grupos" ADD COLUMN IF NOT EXISTS "decidido_por" varchar(40);
ALTER TABLE "dolores_grupos" ADD COLUMN IF NOT EXISTS "adicionado_por" varchar(14);
ALTER TABLE "dolores_grupos" ADD COLUMN IF NOT EXISTS "prova_adicao" varchar(20);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'dolores_grupos'::regclass AND conname = 'dolores_grupos_tipo_check') THEN
    ALTER TABLE "dolores_grupos" ADD CONSTRAINT "dolores_grupos_tipo_check" CHECK ("tipo" IS NULL OR "tipo" IN
      ('cliente', 'pos_atendimento', 'juridico', 'administrativo', 'parceiros', 'engenharia', 'indefinido'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'dolores_grupos'::regclass AND conname = 'dolores_grupos_origem_check') THEN
    ALTER TABLE "dolores_grupos" ADD CONSTRAINT "dolores_grupos_origem_check" CHECK ("origem" IN ('manual', 'automatico'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'dolores_grupos'::regclass AND conname = 'dolores_grupos_situacao_confirmacao_check') THEN
    ALTER TABLE "dolores_grupos" ADD CONSTRAINT "dolores_grupos_situacao_confirmacao_check" CHECK ("situacao_confirmacao" IN ('confirmado', 'avisado', 'aguardando_dono', 'recusado'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'dolores_grupos'::regclass AND conname = 'dolores_grupos_codigo_check') THEN
    ALTER TABLE "dolores_grupos" ADD CONSTRAINT "dolores_grupos_codigo_check" CHECK ("codigo" IS NULL OR "codigo" ~ '^[A-Z0-9]{4,8}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'dolores_grupos'::regclass AND conname = 'dolores_grupos_adicionado_por_check') THEN
    ALTER TABLE "dolores_grupos" ADD CONSTRAINT "dolores_grupos_adicionado_por_check" CHECK ("adicionado_por" IS NULL OR "adicionado_por" IN ('dono', 'outra_pessoa', 'desconhecido'));
  END IF;
  -- cliente e pós-atendimento só com cliente ligado; tipos internos nunca com cliente (o vínculo do grupo de cliente é o escopo dele)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'dolores_grupos'::regclass AND conname = 'dolores_grupos_tipo_vinculo_check') THEN
    ALTER TABLE "dolores_grupos" ADD CONSTRAINT "dolores_grupos_tipo_vinculo_check" CHECK ("tipo" IS NULL
      OR ("tipo" IN ('cliente', 'pos_atendimento') AND "obra_id" IS NULL)
      OR ("tipo" = 'engenharia' AND "lead_id" IS NULL)
      OR ("tipo" IN ('juridico', 'administrativo', 'parceiros', 'indefinido') AND "lead_id" IS NULL AND "obra_id" IS NULL));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "dolores_grupos_codigo_unico" ON "dolores_grupos" ("codigo") WHERE "codigo" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "dolores_grupos_aguardando_idx" ON "dolores_grupos" ("situacao_confirmacao") WHERE "situacao_confirmacao" = 'aguardando_dono';

CREATE OR REPLACE FUNCTION dolores_grupos_guarda() RETURNS trigger AS $$
DECLARE
  decidiu boolean;
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'DOLORES_GRUPOS_SEM_EXCLUSAO: grupo cadastrado não é apagado (desative)';
  END IF;
  IF NEW."grupo_jid" IS DISTINCT FROM OLD."grupo_jid" OR NEW."instancia" IS DISTINCT FROM OLD."instancia"
     OR NEW."criado_em" IS DISTINCT FROM OLD."criado_em" THEN
    RAISE EXCEPTION 'DOLORES_GRUPOS_IMUTAVEL: o id do grupo e a instância não mudam depois do cadastro';
  END IF;
  -- Etapa 7: o nome visto na entrada e o código, uma vez preenchidos, não mudam; automático não vira manual
  IF (OLD."nome_whatsapp" IS NOT NULL AND NEW."nome_whatsapp" IS DISTINCT FROM OLD."nome_whatsapp")
     OR (OLD."codigo" IS NOT NULL AND NEW."codigo" IS DISTINCT FROM OLD."codigo")
     OR (OLD."origem" = 'automatico' AND NEW."origem" IS DISTINCT FROM OLD."origem") THEN
    RAISE EXCEPTION 'DOLORES_GRUPOS_IMUTAVEL: o nome visto na entrada, o código e a origem do grupo não mudam';
  END IF;
  decidiu := NEW."decidido_em" IS NOT NULL AND NEW."decidido_em" IS DISTINCT FROM OLD."decidido_em";
  -- Etapa 7: tipo e vínculo só mudam por decisão do dono (decidido_em gravado na mesma operação), nas linhas da etapa 7. O
  -- vínculo pode VIRAR NULL sem decisão: é o ON DELETE SET NULL do Postgres quando o CRM exclui o cliente ou a obra. Linha
  -- manual antiga (origem 'manual' e tipo vazio antes e depois): regra antiga (o código anterior à etapa 7 continua valendo).
  IF (OLD."origem" = 'automatico' OR OLD."tipo" IS NOT NULL OR NEW."tipo" IS NOT NULL)
     AND (NEW."tipo" IS DISTINCT FROM OLD."tipo"
      OR (NEW."lead_id" IS DISTINCT FROM OLD."lead_id" AND NEW."lead_id" IS NOT NULL)
      OR (NEW."obra_id" IS DISTINCT FROM OLD."obra_id" AND NEW."obra_id" IS NOT NULL))
     AND NOT decidiu THEN
    RAISE EXCEPTION 'DOLORES_GRUPOS_DECISAO: tipo e vínculo do grupo só mudam por decisão do dono';
  END IF;
  -- Etapa 7 (QA-SEG E7): grupo RECUSADO, ou esperando o dono dizer quem colocou a Dolores, só sai desse estado pelo DONO no
  -- WhatsApp. Ir para 'recusado' (rebaixar) é sempre permitido.
  -- QA-SEG E7 r2 (R2-3): vale para TODO automático 'aguardando_dono' (também o que o dono adicionou, de tipo indefinido).
  IF (OLD."situacao_confirmacao" = 'recusado'
      OR (OLD."origem" = 'automatico' AND OLD."situacao_confirmacao" = 'aguardando_dono'))
     AND NEW."situacao_confirmacao" IS DISTINCT FROM 'recusado'
     AND (NEW."situacao_confirmacao" IS DISTINCT FROM OLD."situacao_confirmacao"
      OR NEW."adicionado_por" IS DISTINCT FROM OLD."adicionado_por"
      OR NEW."prova_adicao" IS DISTINCT FROM OLD."prova_adicao")
     AND NOT (decidiu AND coalesce(NEW."decidido_por", '') LIKE 'whatsapp:%') THEN
    RAISE EXCEPTION 'DOLORES_GRUPOS_DECISAO: grupo recusado ou aguardando o dono só é aceito (ou tem o tipo definido) pelo dono, no WhatsApp';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "dolores_grupos_config" ADD COLUMN IF NOT EXISTS "entrada_automatica_ligada" boolean NOT NULL DEFAULT true;
ALTER TABLE "dolores_grupos_config" ADD COLUMN IF NOT EXISTS "teto_grupos_novos_dia" integer NOT NULL DEFAULT 20;
ALTER TABLE "dolores_grupos_config" ADD COLUMN IF NOT EXISTS "teto_avisos_grupos_dia" integer NOT NULL DEFAULT 25;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'dolores_grupos_config'::regclass AND conname = 'dolores_grupos_config_teto_novos_check') THEN
    ALTER TABLE "dolores_grupos_config" ADD CONSTRAINT "dolores_grupos_config_teto_novos_check" CHECK ("teto_grupos_novos_dia" BETWEEN 0 AND 200);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'dolores_grupos_config'::regclass AND conname = 'dolores_grupos_config_teto_avisos_check') THEN
    ALTER TABLE "dolores_grupos_config" ADD CONSTRAINT "dolores_grupos_config_teto_avisos_check" CHECK ("teto_avisos_grupos_dia" BETWEEN 0 AND 200);
  END IF;
END $$;
