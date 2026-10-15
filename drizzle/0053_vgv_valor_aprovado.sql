-- Pedido de 15/10: VGV da obra = Valor Aprovado do cliente no CRM (fonte única).
-- Decisão do dono: onde os dois já existiam e eram diferentes, vale o VGV da
-- obra (copiado para o Valor Aprovado); assim nenhum cálculo de obra muda.
-- Lead com mais de uma obra de VGVs diferentes não é tocado (ambíguo).
UPDATE "leads" l
SET "approved_value" = p."vgv", "updated_at" = now()
FROM "construction_projects" p
WHERE p."lead_id" = l."id"
  AND p."vgv" IS NOT NULL
  AND l."approved_value" IS DISTINCT FROM p."vgv"
  AND NOT EXISTS (
    SELECT 1 FROM "construction_projects" p2
    WHERE p2."lead_id" = l."id" AND p2."id" <> p."id" AND p2."vgv" IS DISTINCT FROM p."vgv"
  );
--> statement-breakpoint
-- Obra com lead e sem VGV recebe o Valor Aprovado já cadastrado no CRM.
UPDATE "construction_projects" p
SET "vgv" = l."approved_value", "updated_at" = now()
FROM "leads" l
WHERE l."id" = p."lead_id" AND p."vgv" IS NULL AND l."approved_value" IS NOT NULL;
