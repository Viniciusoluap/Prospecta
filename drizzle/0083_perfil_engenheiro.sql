-- Lote 2, correção 04 (AD-02): perfil Engenheiro = colaborador + dados profissionais
-- e documentos do usuário guardados no próprio banco. Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS "engineer_profiles" (
  "user_id" integer PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  -- false = deixou de ser engenheiro (dados preservados para reativar sem redigitar)
  "active" boolean NOT NULL DEFAULT true,
  "phone" varchar(20),
  "cep" varchar(9),
  "street" varchar(255),
  "number" varchar(20),
  "complement" varchar(120),
  "district" varchar(120),
  "city" varchar(120),
  "state" varchar(2),
  "crea_number" varchar(30),
  "crea_state" varchar(2),
  -- [{ "numero": "...", "uf": "SP" }] — CREAs de outros estados
  "additional_creas" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL
);

-- Bytes do arquivo original na própria linha; lidos/gravados só por SQL explícito
-- em server/usuario-documentos.ts (a listagem nunca seleciona "content").
CREATE TABLE IF NOT EXISTS "user_documents" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "category" varchar(30) NOT NULL CHECK ("category" IN ('documento_pessoal', 'anuidade_crea', 'carteirinha_crea', 'outros')),
  "original_name" varchar(255) NOT NULL,
  "mime" varchar(150) NOT NULL,
  "size_bytes" integer NOT NULL CHECK ("size_bytes" BETWEEN 1 AND 15728640),
  "content" bytea NOT NULL CHECK (octet_length("content") BETWEEN 1 AND 15728640),
  "uploaded_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "uploaded_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "user_documents_user_idx" ON "user_documents" ("user_id", "category");

-- Conteúdo privado servido somente pela rota autenticada do aplicativo.
ALTER TABLE "engineer_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_documents" ENABLE ROW LEVEL SECURITY;
