# Story S-02 — BPO: Clientes e Lançamentos
**Epic:** EPIC-007
**Status:** Done
**executor:** @dev
**quality_gate:** @dev
**quality_gate_tools:** [tsc, build, test, manual-review]

## Contexto

Porta o módulo BPO (terceirização contábil) do Grupo Santa Fé (`BpoCliente`/`BpoLancamento`, `web/src/lib/actions/bpo.ts`, `web/src/app/admin/bpo/_components/bpo-client.tsx`) para o Prospecta. Confirmado com o dono do produto (decisão #16 do ROADMAP) que o BPO faz sentido para a Prospecta e deve ser portado.

## Acceptance Criteria

- [x] AC-01: Tabelas `bpo_clients`/`bpo_lancamentos` (novas), migration aplicada em produção
- [x] AC-02: Router `bpo` — `clientes.list/create/updateStatus`, `lancamentos.list/create/marcarPago`, `dre` (agregado por competência)
- [x] AC-03: `AdminBpo.tsx` — abas Clientes/Cobranças/Despesas/DRE, cadastro de cliente BPO, lançamento de cobrança/despesa/reembolso, ação "Marcar pago"
- [x] AC-04: Rota `/admin/bpo` registrada + tile no dashboard admin
- [x] AC-05: `tsc --noEmit`, `npm run build` e `npm test` passam limpos; segunda geração do Drizzle confirma "No schema changes"

## Decisões de implementação (adaptações deliberadas, não invenção)

- **`servicos` como texto JSON** (igual à origem, `String @default("[]")` no Prisma) em vez de um array nativo do Postgres — mantém paridade exata com o formato usado no Santa Fé, evitando inventar uma modelagem diferente.
- **DRE simplificado, calculado em memória no router** (agregação por `competencia`: cobranças − despesas) em vez de view/materialização no banco — replica a mesma lógica de `dreMap` do `bpo-client.tsx` original, sem tabela adicional.
- **Sem relatórios/gráficos amplos (funil de leads, ranking de corretores) do `bpo/page.tsx` original** — esses dados já existem no dashboard geral do Prospecta (CRM/corretores) e misturá-los aqui duplicaria informação; a S-02 replica o que é especificamente "BPO" (clientes, cobranças, despesas, DRE), não o dashboard consolidado da página.
- **Sem aba "Bancos"** — fica para a S-03 (integração Pluggy), que ainda não foi implementada.
- **RBAC**: leitura de clientes/lançamentos liberada a todo `STAFF_ROLES` (admin/corretor/colaborador, mesmo padrão do restante do financeiro); cadastro de cliente BPO restrito a `admin` (dado sensível de contrato/honorário); lançamentos podem ser criados por qualquer staff (equivalente ao `criarCobranca`/`criarLancamentoBpo` da origem, que só exigem sessão autenticada).

## Validação — honestidade de status (regra do dono do produto)

**Testado automaticamente:** `tsc --noEmit` limpo, `npm run build` limpo, `npm test` — **252/252 passando** (4 testes novos em `server/tests/bpo.test.ts`: campos das tabelas, enums, procedures expostas no router). Migration `0011_typical_annihilus` aplicada em produção (tabelas novas, sem dado existente — sem risco), segunda geração do Drizzle confirma "No schema changes".

**Não testado de ponta a ponta:** navegação da tela em navegador real (sandbox sem acesso à internet externa, mesma limitação já documentada em todas as stories anteriores).

## Tasks

- [x] `drizzle/schema.ts` — `bpoClientStatusEnum`, `bpoLancamentoTipoEnum`, tabelas `bpoClients`/`bpoLancamentos`
- [x] `drizzle/0011_typical_annihilus.sql` aplicada em produção
- [x] `server/db.ts` — `getAllBpoClients`, `createBpoClient`, `updateBpoClientStatus`, `getAllBpoLancamentos`, `createBpoLancamento`, `marcarBpoLancamentoPago`
- [x] `server/routers.ts` — router `bpo` (clientes/lancamentos/dre)
- [x] `client/src/pages/admin/AdminBpo.tsx` — UI completa
- [x] `client/src/App.tsx` — rota `/admin/bpo`
- [x] `client/src/pages/Admin.tsx` — tile de acesso
- [x] Testes: `server/tests/bpo.test.ts`
- [x] `tsc --noEmit`, `npm run build`, `npm test`

## File List

- `drizzle/schema.ts`
- `drizzle/0011_typical_annihilus.sql`
- `server/db.ts`
- `server/routers.ts`
- `client/src/pages/admin/AdminBpo.tsx`
- `client/src/App.tsx`
- `client/src/pages/Admin.tsx`
- `server/tests/bpo.test.ts`
- `docs/stories/epics/epic-007-financeiro-avancado/EPIC.md`
- `docs/stories/epics/ROADMAP.md`

## Validation Notes (@po)

Segunda story do épico, mantém o padrão de extensão/porte fiel usado na S-01. Escopo bem delimitado (sem aba Bancos, adiada para S-03). **Score: 9/10**.

**Verdict: GO**

## QA Results (@qa)

Code review: schema fiel ao Prisma de origem (mesmos campos/nomes conceituais). DRE replica a lógica exata do `bpo-client.tsx`. RBAC condizente com sensibilidade dos dados. `tsc`/`build`/`test` limpos (252/252), migration validada em produção. **Verdict: PASS**.

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-07 | 0.1.0 | Story criada e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-07 | 1.0.0 | Implementado e validado — Status: Ready → Done | @dev / @qa |
