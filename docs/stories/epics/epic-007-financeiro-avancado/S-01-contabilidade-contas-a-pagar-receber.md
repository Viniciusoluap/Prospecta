# Story S-01 — Contabilidade: Contas a Pagar/Receber
**Epic:** EPIC-007
**Status:** Done
**executor:** @dev
**quality_gate:** @dev
**quality_gate_tools:** [tsc, build, test, manual-review]

## Contexto

Estende `financial_transactions` (já existente no Prospecta) para cobrir o que o módulo "Contabilidade" do Grupo Santa Fé (`Lancamento`) tem e o Prospecta ainda não: status (pendente/pago/cancelado), vencimento, forma de pagamento, referência, competência e fornecedor. Não é uma tabela nova — é extensão do que já existia.

## Acceptance Criteria

- [x] AC-01: Colunas novas em `financial_transactions` (`status`, `due_date`, `payment_method`, `external_reference`, `competency`, `vendor`), migration aplicada em produção
- [x] AC-02: Mutation `financialTransactions.updateStatus` (pendente→pago marca `paidAt` automaticamente; pendente→cancelado limpa `paidAt`)
- [x] AC-03: `financialTransactions.create` aceita os novos campos, todos opcionais (retrocompatível com uso anterior)
- [x] AC-04: `AdminFinanceiro.tsx` — formulário com os campos novos, badge de status por lançamento, ações rápidas "Marcar pago"/"Cancelar" quando pendente
- [x] AC-05: `tsc --noEmit`, `npm run build` e `npm test` passam limpos; segunda geração do Drizzle confirma "No schema changes"

## Decisões de implementação (adaptações deliberadas, não invenção)

- **Estende a tabela existente em vez de criar uma nova**: `category` (já existente, livre) recebe os mesmos valores de categoria do Santa Fé (servicos/comissoes/imoveis/aluguel/folha/impostos/marketing/outros) sem precisar de enum novo — é texto livre nos dois lados.
- **`referenceId`/`referenceType` (já existentes) preservados para vínculo interno** (ex.: a um lead ou contrato) — `external_reference` é um campo novo e distinto, para uma referência externa em texto livre (nº de nota fiscal, contrato), equivalente ao `referencia` do Santa Fé.
- **`status` como enum Postgres** (`pending`/`paid`/`cancelled`) em vez de texto livre como na origem — mais seguro, consistente com o resto do schema do Prospecta que já usa enums para status.
- **Migration aditiva**: tabela estava vazia em produção (confirmado antes de aplicar), então a coluna `status NOT NULL DEFAULT 'pending'` não teve nenhum dado para retrocompatibilizar.

## Validação — honestidade de status (regra do dono do produto)

**Testado automaticamente:** `tsc --noEmit` limpo, `npm run build` limpo, `npm test` — **248/248 passando** (3 testes novos em `server/tests/financeiro.test.ts`: campos novos na tabela, enum de status, mutation exposta no router). Migration aplicada em produção (tabela confirmada vazia antes, sem risco de dado existente), segunda geração do Drizzle confirma "No schema changes".

**Não testado de ponta a ponta:** navegação da tela em navegador real (sandbox sem acesso à internet externa, mesma limitação já documentada em todas as stories anteriores).

## Tasks

- [x] `drizzle/schema.ts` — `financialTransactionStatusEnum` + 6 colunas novas em `financialTransactions`
- [x] `drizzle/0010_crazy_tony_stark.sql` aplicada em produção
- [x] `server/db.ts` — `updateFinancialTransactionStatus`
- [x] `server/routers.ts` — `financialTransactions.create` estendido + `financialTransactions.updateStatus`
- [x] `client/src/pages/admin/AdminFinanceiro.tsx` — formulário estendido, badges de status, ações rápidas
- [x] Testes: `server/tests/financeiro.test.ts`
- [x] `tsc --noEmit`, `npm run build`, `npm test`

## File List

- `drizzle/schema.ts`
- `drizzle/0010_crazy_tony_stark.sql`
- `server/db.ts`
- `server/routers.ts`
- `client/src/pages/admin/AdminFinanceiro.tsx`
- `server/tests/financeiro.test.ts`
- `docs/stories/epics/epic-007-financeiro-avancado/EPIC.md`
- `docs/stories/epics/ROADMAP.md`

## Validation Notes (@po)

Extensão limpa de uma tabela já existente, sem duplicar o que já havia. Retrocompatível (novos campos opcionais). **Score: 9/10**.

**Verdict: GO**

## QA Results (@qa)

Code review: colunas/enum conferem com o que falta em relação à origem. `updateStatus` com lógica correta de `paidAt`. Mutation restrita a admin. `tsc`/`build`/`test` limpos (248/248), migration validada em produção. **Verdict: PASS**.

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-07 | 0.1.0 | Story criada e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-07 | 1.0.0 | Implementado e validado — Status: Ready → Done | @dev / @qa |
