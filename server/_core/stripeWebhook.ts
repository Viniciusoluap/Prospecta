import express from 'express';
import { stripe } from './stripe.js';
import { ENV } from './env.js';

// Stripe foi desabilitado como metodo de pagamento na interface (nao ha nenhuma tela
// que ofereca "cartao/Stripe" como opcao de compra de bilhete/UTEF - o unico provedor
// ativo e o Asaas, via server/payment-settlement.ts). Este webhook tinha um caminho
// financeiro completo e divergente do Asaas (credito de UTEF/confirmacao de bilhete
// direto, sem passar por payment_orders, sem idempotencia contra reentrega). Manter
// os dois caminhos ativos e um risco real de regra financeira inconsistente.
//
// Decisao (auditoria Etapa 1): desabilitar o processamento explicitamente, em vez de
// migrar Stripe para o mesmo contrato idempotente do Asaas - o provedor esta inativo
// na UI, entao nao ha justificativa para manter um segundo pipeline financeiro
// completo por algo que nenhum cliente pode escolher. Assinatura ainda e verificada
// (para nao aceitar eventos nao autenticados silenciosamente e para acusar/logar
// tentativas reais do Stripe, caso o webhook ainda esteja configurado no painel deles),
// mas nenhum evento altera saldo/bilhete.
export function registerStripeWebhook(app: express.Application) {
  // Webhook deve estar registrado ANTES do express.json() para receber raw body
  app.post(
    '/api/stripe/webhook',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      const sig = req.headers['stripe-signature'];

      if (!sig) {
        console.error('[Stripe Webhook] Missing stripe-signature header');
        return res.status(400).send('Missing signature');
      }

      let event;
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, ENV.stripeWebhookSecret);
      } catch (err: any) {
        console.error('[Stripe Webhook] Signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      console.warn(
        '[Stripe Webhook] Integração desabilitada (Asaas é o único provedor ativo) - evento recebido e ignorado, nenhum dado foi alterado:',
        event.type,
        event.id,
      );

      // 410 Gone: sinaliza claramente ao Stripe (e a qualquer log/observabilidade)
      // que este endpoint nao processa mais eventos, sem mascarar como sucesso (200)
      // nem como erro transitorio (5xx) que levaria a novas tentativas de retry.
      return res.status(410).json({
        received: false,
        disabled: true,
        message: 'Integração Stripe desabilitada - Asaas é o único provedor de pagamento ativo.',
      });
    }
  );
}
