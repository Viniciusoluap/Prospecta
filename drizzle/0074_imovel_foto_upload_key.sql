-- Evita duplicar fotografias quando um envio individual é repetido.
ALTER TABLE "imovel_fotos" ADD COLUMN IF NOT EXISTS "upload_key" varchar(100);
CREATE UNIQUE INDEX IF NOT EXISTS "imovel_fotos_upload_key_unique"
  ON "imovel_fotos" ("imovel_id", "upload_key") WHERE "upload_key" IS NOT NULL;
