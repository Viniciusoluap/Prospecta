-- Google Drive com a conta Google do próprio dono (OAuth, escopo drive.file).
-- Uma única linha: o JSON do cliente OAuth é enviado em Configurações e o token
-- de atualização é gravado na conexão. Segredos sempre criptografados (AES-GCM).
CREATE TABLE IF NOT EXISTS "google_drive_oauth" (
  "id" integer PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "client_id" text NOT NULL,
  "client_secret_encrypted" text NOT NULL,
  "refresh_token_encrypted" text,
  "account_email" varchar(320),
  "root_folder_id" text,
  "connected_at" timestamp,
  "updated_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
