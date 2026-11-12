# CV-05 — Agente de IA de atendimento e qualificação

Status: InReview

## Critérios de aceite
- [x] Saudação, consentimento LGPD (`lgpdConsent`/`lgpdConsentAt`) e qualificação gravada nos campos do lead.
- [x] Base de produtos editável em tela; a IA só fala o que está cadastrado.
- [x] Regras proibidas por código e testes: sem promessa de aprovação, sem taxa/parcela/condição não cadastrada, nunca decide nada financeiro, nunca marca aprovado.
- [x] Transferência para humano (pedido, reclamação, jurídico, negociação de valor, baixa confiança, 3 mensagens sem progresso) com resumo.
- [x] Limite mensal de tokens e consumo por lead; ao atingir, tudo vai para humano e o admin é alertado.

## File List
- `server/central-vendas/ia.ts`
- `shared/central-vendas/regras.ts (violacoesResposta`
- ` gatilhoNoTexto`
- ` motivoTransferencia)`
- `server/central-vendas-ia.test.ts`

## Change Log
- 12/11/2026 — story criada (Draft) a partir da seção 7 do prompt.
- 12/11/2026 — implementada (InReview). Regras proibidas aplicadas na saída da IA antes de qualquer envio (promessa de aprovação, número/condição fora do cadastro, decisão); saída em lista fechada de campos; dados só gravados após consentimento LGPD; a saudação não conta como mensagem sem progresso. Chave da IA: cofre (config) ou ANTHROPIC_API_KEY. Base de produtos editável em tela vem na etapa 9.
