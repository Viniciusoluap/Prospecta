# CV-10 — Adaptador Logyca (desligado por padrão)

Status: InReview

## Critérios de aceite
- [x] Flag `centralVendas.logyca.ativo = false` por padrão.
- [x] Envio: POST com Bearer e corpo { number, message } no endpoint copiado de 'Mensagens API'.
- [x] Entrada: endpoint para o bloco 'HTTP Request', token próprio.
- [x] Conflito com dado do Prospecta: prevalece o Prospecta e o conflito é registrado.
- [x] Nada além da documentação oficial; resto vira 'a validar com a Logyca'.

## File List
- `server/central-vendas/logyca.ts`
- `server/central-vendas/rotas.ts (entrada /api/central-vendas/entrada/logyca)`
- `server/central-vendas/envio.ts (envio padrão pela Logyca quando ligada)`
- `server/central-vendas-logyca.test.ts`

## Change Log
- 12/11/2026 — story criada (Draft) a partir da seção 7 do prompt.
- 12/11/2026 — implementada (InReview). Só o confirmado pela documentação; formato do corpo do bloco HTTP Request é definido por nós (payloadEntrada) e precisa ser configurado no fluxo da Logyca; resposta do envio não traz ID (a validar com a Logyca).
