-- EPIC-020 (HANDOFF §7, P-03) — decisão do proprietário em 12/10/2026:
-- nas obras 17, 18 e 27 (corretor Chaleilson) o valor aprovado no lead é o VGV.
-- Copia somente onde o VGV ainda está vazio (idempotente). Script manual de
-- dados — fora do journal. Aplicado em produção (Neon) em 12/10/2026.
UPDATE construction_projects cp
SET vgv = l.approved_value, updated_at = now()
FROM leads l
WHERE l.id = cp.lead_id
  AND cp.id IN (17, 18, 27)
  AND cp.vgv IS NULL
  AND l.approved_value IS NOT NULL;
