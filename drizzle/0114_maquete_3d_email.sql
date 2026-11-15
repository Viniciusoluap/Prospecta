-- 15/11/2026 — Maquete 3D (EPIC-022): e-mails automáticos do módulo (pedido aprovado e maquete pronta com o link)
-- registrados em email_logs com tipo próprio. Somente aditiva: acrescenta um valor ao tipo email_template_type.
ALTER TYPE "email_template_type" ADD VALUE IF NOT EXISTS 'maquete_3d';
