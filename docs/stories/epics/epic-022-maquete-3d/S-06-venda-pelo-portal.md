# S-06 — Venda ao cliente pelo portal, com Asaas (etapa 3)

Status: Done em código (15/11/2026) — testado com cobrança simulada; **pendente um pagamento real em produção**.

## Critérios de aceite
- [x] Portal do cliente › Maquete 3D: lista os projetos do próprio cadastro (lead), com a situação de cada pedido.
- [x] O cliente informa o tamanho da casa (faixa), escolhe PIX, boleto ou cartão e recebe a cobrança (QR Code,
      código copia-e-cola e página de pagamento do Asaas). Pedir de novo devolve o mesmo pedido e a mesma cobrança.
- [x] Sem PDF ativo no projeto, não gera pedido nem cobrança (mensagem para falar com a equipe).
- [x] Pagamento confirmado pelo webhook do Asaas libera o pedido sozinho, uma única vez (mesma idempotência de
      `payment_orders`); o pedido já entra com os PDFs do projeto escolhidos para a leitura.
- [x] Pagamento de pedido recusado/excluído e chargeback vão para conferência manual (`review_required`).
- [x] O cliente só vê o botão "Abrir a minha maquete 3D" depois que o admin publica.
- [x] Admin: botão "Enviar ao cliente pelo WhatsApp" (abre a conversa com o link). O envio automático pela
      instância conectada não foi feito.
- [ ] A faixa de preço é declarada pelo cliente; a equipe confere na revisão (pode recusar). Não há cobrança de diferença.
- [ ] Estorno é feito pelo admin no Asaas (não há botão de estorno).

## Arquivos
- `drizzle/0113_maquete_3d_pagamento.sql`, `drizzle/schema.ts` (valor `maquete_3d` em `payment_order_purpose`)
- `server/maquete-3d/venda.ts` (`portalMaquete.resumo`, `portalMaquete.solicitar`, `liberarPorPagamento`), `server/maquete-3d/base.ts` (cobrador)
- `server/payment-settlement.ts`, `server/routers.ts`
- `client/src/components/maquete-3d/PortalMaquete.tsx`, `client/src/pages/Portal.tsx`
