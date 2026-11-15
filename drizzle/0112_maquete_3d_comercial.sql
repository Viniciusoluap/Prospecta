-- 15/11/2026 — Maquete 3D (EPIC-022, etapa 2): dados da apresentação comercial e estilo inicial da maquete publicada.
-- Somente aditiva e idempotente. Reversão: ALTER TABLE "maquetes_3d" DROP COLUMN "comercial".

-- JSON: { nome, localizacao, preco, whatsapp, estilo } — só o que o admin informar; nada é preenchido sozinho.
ALTER TABLE "maquetes_3d" ADD COLUMN IF NOT EXISTS "comercial" text NOT NULL DEFAULT '{}';
