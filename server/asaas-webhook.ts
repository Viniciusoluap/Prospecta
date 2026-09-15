import { Request, Response } from 'express';
import { settlePaymentOrder, refundPaymentOrder } from './payment-settlement.js';
import * as db from './db.js';
import { decryptSecret } from './_core/secret-vault.js';

/**
 * Webhook do Asaas para receber notificações de pagamento
 *
 * Documentação: https://docs.asaas.com/docs/about-webhooks
 *
 * Eventos suportados:
 * - PAYMENT_CREATED: Cobrança criada
 * - PAYMENT_UPDATED: Cobrança atualizada
 * - PAYMENT_CONFIRMED: Pagamento confirmado (PIX pessoa física em análise)
 * - PAYMENT_RECEIVED: Pagamento recebido e confirmado
 * - PAYMENT_OVERDUE: Cobrança vencida
 * - PAYMENT_REFUNDED: Pagamento estornado
 *
 * Idempotencia: a liquidacao real (credito de UTEF, confirmacao de bilhete) e
 * delegada a payment-settlement.ts, que so aplica efeito uma vez por payment.id,
 * mesmo que o Asaas reentregue o mesmo evento (comportamento padrao de retry de
 * webhook). Este handler NUNCA credita/confirma nada diretamente.
 */

interface AsaasWebhookPayload {
  event: string;
  payment: {
    id: string;
    customer: string;
    billingType: string;
    value: number;
    netValue: number;
    status: string;
    dueDate: string;
    paymentDate?: string;
    externalReference?: string;
  };
}

// Token do webhook: variavel de ambiente tem precedencia (fonte de deploy, nunca
// logada); configuracao criptografada no banco (painel admin) e o fallback
// autorizado. Se nenhuma das duas fontes existir, falha fechado - rejeita o
// webhook em vez de aceitar sem validar assinatura.
async function resolveWebhookToken(): Promise<string | null> {
  const envToken = process.env.ASAAS_WEBHOOK_TOKEN;
  if (envToken) return envToken;

  const setting = await db.getPaymentSetting();
  if (setting?.asaasWebhookTokenEncrypted) {
    try {
      return decryptSecret(setting.asaasWebhookTokenEncrypted);
    } catch {
      return null;
    }
  }
  return null;
}

export async function handleAsaasWebhook(req: Request, res: Response) {
  try {
    const webhookToken = await resolveWebhookToken();
    if (!webhookToken) {
      // Falha fechado: sem token configurado (nem env, nem banco), nao ha como
      // validar a origem do evento.
      console.error('[Asaas Webhook] No webhook token configured (env or vault) - rejecting');
      return res.status(401).json({ error: 'Unauthorized: webhook token not configured' });
    }

    const receivedToken = req.headers['asaas-access-token'];
    if (!receivedToken || receivedToken !== webhookToken) {
      return res.status(401).json({ error: 'Unauthorized: invalid webhook token' });
    }

    const payload: AsaasWebhookPayload = req.body;

    if (!payload.event || !payload.payment?.id) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const { event, payment } = payload;

    if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
      const result = await settlePaymentOrder(payment.id);
      console.log('[Asaas Webhook] Settlement result for', payment.id, ':', result.outcome);
      if (result.outcome === 'order_not_found') {
        // Pagamento sem payment_order correspondente: nao foi criado por este
        // sistema (ou e de um fluxo legado). Nao ha o que liquidar.
        console.warn('[Asaas Webhook] No payment_order found for payment:', payment.id);
      }
    } else if (event === 'PAYMENT_REFUNDED') {
      const result = await refundPaymentOrder(payment.id);
      console.log('[Asaas Webhook] Refund result for', payment.id, ':', result.outcome);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('[Asaas Webhook] Error processing webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
