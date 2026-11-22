-- 22/11/2026 — EPIC-029 S-3 (Dolores no fluxo fiscal): o tipo novo "nota_fiscal" dos avisos proativos da Dolores (rascunho de nota fiscal
-- a decidir e o resumo do dia, a partir das 18h). Story: docs/stories/epics/epic-029-modulo-fiscal/S-3-dolores-fiscal.md.
--
-- Número 0161 (e não 0155, como dizia o plano): 0155–0159 ficam livres para o fiscal das etapas 4 e 5; 0160 é da Dolores (reserva dos avisos).
--
-- O que muda: SÓ a restrição CHECK da coluna "tipo" de "dolores_avisos_tipos" (criada inline pela 0150, nome padrão do Postgres
-- "dolores_avisos_tipos_tipo_check"), que passa a aceitar também 'nota_fiscal'. A lista antiga continua inteira; nenhum dado muda (a nova
-- restrição aceita todas as linhas que a antiga aceitava). As outras tabelas dos avisos não têm CHECK de tipo ("achados.tipo" é varchar).
-- Sem esta migração, o aviso de notas fiscais continua SILENCIADO (padrão do código: sem linha = silenciado) e só não dá para religá-lo.
--
-- Aditiva e IDEMPOTENTE: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT na MESMA transação (pode rodar duas vezes).
-- Reversão: a mesma troca com a lista da 0150 (sem 'nota_fiscal'), depois de apagar a linha 'nota_fiscal', se houver (pedir ao dono).

BEGIN;
ALTER TABLE "dolores_avisos_tipos" DROP CONSTRAINT IF EXISTS "dolores_avisos_tipos_tipo_check";
ALTER TABLE "dolores_avisos_tipos" ADD CONSTRAINT "dolores_avisos_tipos_tipo_check"
  CHECK ("tipo" IN ('obra_atrasada', 'tarefa_vencida', 'documento_pendente', 'nota_obra', 'regularizacao_parada', 'grupo_aguardando', 'integracao', 'gasto', 'nota_fiscal'));
COMMIT;
