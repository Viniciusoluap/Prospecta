-- 15/11/2026 — Maquete 3D (EPIC-022, etapa 3): cobrança da maquete pelo Asaas, liquidada pelo mesmo webhook e
-- pela mesma tabela payment_orders dos outros pagamentos. Somente aditiva: acrescenta um valor ao tipo
-- payment_order_purpose (nenhuma linha existente muda). Um valor de enum não pode ser removido depois; para
-- reverter basta não usá-lo.
ALTER TYPE "payment_order_purpose" ADD VALUE IF NOT EXISTS 'maquete_3d';
