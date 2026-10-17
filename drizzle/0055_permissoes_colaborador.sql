-- Pedido de 17/10/2026 (Opção A): 16 módulos do colaborador. As chaves antigas
-- (contabilidade/relatorios → BPO, agregador → Imóveis) são convertidas na leitura
-- (shared/admin-permissions.ts). Incorporação virou módulo próprio: quem tinha
-- Projetos (que antes abria a Incorporação) continua com acesso a ela.
UPDATE "users"
SET "permissions" = ("permissions"::jsonb || '["incorporacao"]'::jsonb)::text
WHERE "role" = 'colaborador'
  AND "permissions"::jsonb ? 'projetos'
  AND NOT ("permissions"::jsonb ? 'incorporacao');
