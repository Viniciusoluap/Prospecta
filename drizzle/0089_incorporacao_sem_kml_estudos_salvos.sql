-- Lote 2, correções 06, 08 e 11 (AD-03, AD-04). Aditiva e idempotente.
--
-- 06: estudo sem KML (flag + lotes avulsos em JSON).
-- 08: responsável do estudo salvo por ID de usuário (o texto legado "responsible"
--     continua preenchido com o nome para exibição e estudos antigos).
-- 11: estudos de massa salvos em tabela própria; as colunas legadas
--     mass_scenarios_json/selected_scenario_id/product_mix_json seguem como
--     espelho do estudo principal.

ALTER TABLE "incorporation_studies" ADD COLUMN IF NOT EXISTS "sem_kml" boolean NOT NULL DEFAULT false;
ALTER TABLE "incorporation_studies" ADD COLUMN IF NOT EXISTS "loose_lots_json" text;
ALTER TABLE "incorporation_studies" ADD COLUMN IF NOT EXISTS "responsible_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS "incorporation_mass_studies" (
  "id" serial PRIMARY KEY,
  "study_id" integer NOT NULL REFERENCES "incorporation_studies"("id") ON DELETE CASCADE,
  "name" varchar(120) NOT NULL,
  "version" integer NOT NULL DEFAULT 1 CHECK ("version" >= 1),
  -- versão de origem (salvar nova versão)
  "previous_id" integer REFERENCES "incorporation_mass_studies"("id") ON DELETE SET NULL,
  "params_json" text,
  "scenarios_json" text NOT NULL,
  -- poligonal (GeoJSON) usada como referência quando o estudo foi salvo
  "reference_polygon" text,
  "selected_scenario_id" varchar(120),
  "indicators_json" text,
  "areas_json" text,
  "is_principal" boolean NOT NULL DEFAULT false,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  -- exclusão lógica: a linha (e a geometria) é preservada
  "deleted_at" timestamp,
  "deleted_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "incorporation_mass_studies_study_idx" ON "incorporation_mass_studies" ("study_id", "id");
-- O principal é trocado num único UPDATE (is_principal = (id = alvo)) — sem índice
-- único parcial, que poderia falhar no meio da troca dentro do mesmo comando.
-- nome + versão únicos entre os ativos
CREATE UNIQUE INDEX IF NOT EXISTS "incorporation_mass_studies_name_version_idx"
  ON "incorporation_mass_studies" ("study_id", lower("name"), "version") WHERE "deleted_at" IS NULL;

ALTER TABLE "incorporation_mass_studies" ENABLE ROW LEVEL SECURITY;
