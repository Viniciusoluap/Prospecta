# CV-09 — Painel e configurações

Status: InReview

## Critérios de aceite
- [x] Página 'Central de Vendas' no menu administrativo com os indicadores do prompt, filtros (período, operador, empreendimento, origem) e CSV.
- [x] Somente dados reais; 'sem dados' quando não houver.
- [x] Tela de configuração (só admin): interruptor geral e por automação, modo de teste, horários, SLA, limites, checklists, produtos, templates.
- [x] Operadores veem só os próprios atendimentos.

## File List
- `shared/central-vendas/indicadores.ts`
- `server/central-vendas/router.ts`
- `server/routers.ts (registro)`
- `server/_core/trpc.ts (centralVendas → módulo crm)`
- `server/whatsapp-router.ts (templates cv-* não escondem os padrão)`
- `client/src/pages/admin/AdminCentralVendas.tsx`
- `client/src/App.tsx (rota)`
- `client/src/pages/Admin.tsx (cartão)`
- `client/src/components/GlobalBackButton.tsx`
- `server/central-vendas-painel.test.ts`

## Change Log
- 12/11/2026 — story criada (Draft) a partir da seção 7 do prompt.
- 12/11/2026 — implementada (InReview). Página /admin/central-vendas no módulo CRM (sem módulo novo de permissão, para não mexer na lista espelhada com o Santa Fé) — [AUTO-DECISION]. UI não testada em navegador nesta sessão (só tsc + vite build).
