# CV-08 — Follow-up, reativação e proteções de envio

Status: InReview

## Critérios de aceite
- [x] Sequências configuráveis em tela: follow-up após aprovação, sem resposta e reativação (30/60/90 dias).
- [x] Envio só entre 8h e 20h (America/Fortaleza); opt-out por SAIR/PARAR; limite diário por número; intervalo aleatório entre envios; modo de teste.
- [x] Textos automáticos em `whatsapp_templates`.
- [x] Falha de envio vai para a fila e é reprocessada com backoff, sem duplicar.

## File List
- `server/central-vendas/envio.ts`
- `server/central-vendas/sequencias.ts`
- `server/central-vendas/rotina.ts`
- `shared/central-vendas/regras.ts (bloqueioEnvio`
- ` ehOptOut`
- ` janela)`
- `server/central-vendas-envio.test.ts`

## Change Log
- 12/11/2026 — story criada (Draft) a partir da seção 7 do prompt.
- 12/11/2026 — implementada (InReview). Janela 8h–20h vale para mensagens por iniciativa da empresa (lembretes, sequências, decisão, saudação do site); respostas imediatas a uma mensagem do cliente saem na hora — [AUTO-DECISION]. Opt-out vale até um humano reativar. Item 'processando' há 10 min vira 'incerto' e nunca é reenviado sozinho. Telas das sequências na etapa 9.
