# CV-04 — Distribuição automática e SLA

Status: InReview

## Critérios de aceite
- [x] Rodízio entre usuários ativos marcados como operadores da Central, respeitando horário de atendimento configurável.
- [x] SLA de primeira resposta humana (padrão 15 min em horário comercial) estourado → reatribuição automática com evento de auditoria.

## File List
- `server/central-vendas/distribuicao.ts`
- `shared/central-vendas/regras.ts (proximoOperador`
- ` minutosUteisEntre)`
- `server/central-vendas-distribuicao.test.ts`

## Change Log
- 12/11/2026 — story criada (Draft) a partir da seção 7 do prompt.
- 12/11/2026 — implementada (InReview). SLA conta só minutos em horário de atendimento; a resposta humana é qualquer mensagem de saída que não veio da fila automática. Sem cron de minutos na Vercel: a verificação roda a cada aviso do WhatsApp (no máximo 1x/min), ao abrir o painel e no cron diário — [AUTO-DECISION].
