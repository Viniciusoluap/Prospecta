-- Pedido de 13/10/2026: pagamentos da obra ganham as categorias "Mão de obra" e
-- "Material" (as antigas continuam) e a etapa da obra a que se referem (mesma
-- lista da Medição por serviço). Aditiva: nada existente muda.
ALTER TABLE "obra_movimentos" DROP CONSTRAINT IF EXISTS "obra_movimentos_categoria_check";--> statement-breakpoint
ALTER TABLE "obra_movimentos" ADD CONSTRAINT "obra_movimentos_categoria_check" CHECK ("categoria" IS NULL OR "categoria" IN ('terreno', 'comissao', 'empreiteiro', 'fornecedor', 'outros', 'nao_detalhado', 'mao_de_obra', 'material'));--> statement-breakpoint
ALTER TABLE "obra_movimentos" ADD COLUMN IF NOT EXISTS "etapa" varchar(40);--> statement-breakpoint
ALTER TABLE "obra_movimentos" DROP CONSTRAINT IF EXISTS "obra_movimentos_etapa_check";--> statement-breakpoint
ALTER TABLE "obra_movimentos" ADD CONSTRAINT "obra_movimentos_etapa_check" CHECK ("etapa" IS NULL OR ("natureza" = 'pagamento' AND "etapa" IN ('preliminares', 'infraestrutura', 'supraestrutura', 'paredes', 'esquadrias', 'vidros', 'coberturas', 'impermeabilizacoes', 'revestimentos_internos', 'forros', 'revestimentos_externos', 'pintura', 'pisos', 'acabamentos', 'eletricas', 'hidraulicas', 'esgoto', 'loucas_metais', 'complementos', 'outros')));
