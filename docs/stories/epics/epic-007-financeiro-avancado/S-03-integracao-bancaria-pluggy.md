# Story S-03 — Integração Bancária (Pluggy)
**Epic:** EPIC-007
**Status:** Done
**executor:** @dev
**quality_gate:** @dev
**quality_gate_tools:** [tsc, build, test, manual-review]

## Contexto

Última story do EPIC-007 e do roadmap inteiro. Porta a integração bancária via Open Finance (Pluggy) do Grupo Santa Fé (`ContaBancaria`/`TransacaoBancaria`, `lib/actions/banco.ts`, `app/api/banco/sincronizar/route.ts`) para o Prospecta, com fallback gracioso enquanto não há credencial real (confirmado com o dono do produto — decisão #16 do ROADMAP).

## Acceptance Criteria

- [x] AC-01: Tabelas `bank_accounts`/`bank_transactions` (novas), migration aplicada em produção
- [x] AC-02: Tabela `pluggy_settings` — credenciais armazenadas **criptografadas no banco** (mesmo padrão do Asaas/`payment_settings`), **não** em variável de ambiente, conforme decisão explícita do dono do produto
- [x] AC-03: Cliente Pluggy (`server/_core/pluggy.ts`) — `authenticatePluggy`/`fetchPluggyTransactions`/`fetchPluggyAccountBalance`, com fallback gracioso (retorna `null`/`[]` em qualquer falha de rede ou API, nunca lança exceção não tratada)
- [x] AC-04: Router `bancario` — `contas.list/create/delete/atualizarSaldo`, `transacoes.listByConta/atualizarStatus`, `sincronizar` (busca token via credenciais salvas, sincroniza transações e saldo, ou retorna `{ok:false, configurado:false, mensagem}` quando não configurado)
- [x] AC-05: Router `pluggySettings` — `status` (configurado ou não) e `save` (valida a credencial contra a API real da Pluggy antes de criptografar e salvar)
- [x] AC-06: Aba "Bancos" em `AdminBpo.tsx` — formulário de credenciais Pluggy, cadastro de conta bancária, lista de contas com saldo e botão "Sincronizar" (só aparece quando a conta tem `pluggyAccountId`)
- [x] AC-07: `tsc --noEmit`, `npm run build` e `npm test` passam limpos; segunda geração do Drizzle confirma "No schema changes"

## Decisões de implementação (adaptações deliberadas, não invenção)

- **Credenciais Pluggy em tela própria criptografada no banco (`pluggy_settings`), não em env var** — decisão explícita do dono do produto (diferente da origem, que usa `process.env.PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET`). Mesmo padrão de criptografia (`encryptSecret`/`decryptSecret`, AES-256-GCM) já usado para o Asaas.
- **Sem credencial real disponível ainda** — `pluggySettingsRouter.save` valida a credencial contra a API real da Pluggy (`POST /auth`) antes de salvar, então a tela funciona de ponta a ponta assim que o dono do produto tiver uma conta Pluggy real; sem isso, o formulário fica funcionalmente pronto mas não pode ser exercitado nesta sessão (sandbox sem acesso à internet externa).
- **Fallback gracioso em 3 camadas**, replicando a lógica de `sincronizar/route.ts` da origem: (1) sem `pluggyAccountId` na conta → mensagem clara, sem tentar chamar a API; (2) sem credencial configurada/ativa → mensagem clara; (3) credencial configurada mas API indisponível/inválida → mensagem clara. Nenhum desses casos lança erro 500 — todos retornam `{ok:false, ...}` tratável pela UI.
- **`upsertBankTransactions` usa `onConflictDoNothing` no `externalId`** em vez do `upsert` do Prisma (`where/create/update`) — equivalente funcional na API do Drizzle: evita duplicar transações já sincronizadas.
- **Sem webhook Pluggy** (a origem tem `webhookUrl` como campo armazenado mas não implementa um endpoint receptor) — mantido apenas o campo na tabela para paridade de schema; endpoint de webhook fica fora de escopo desta story (não há evidência de que a origem o implementa de fato, apenas guarda a URL).

## Validação — honestidade de status (regra do dono do produto)

**Testado automaticamente:** `tsc --noEmit` limpo, `npm run build` limpo, `npm test` — **262/262 passando** (9 testes novos: `server/tests/bancario.test.ts` para schema/router, `server/pluggy.test.ts` para o cliente HTTP com mocks de `fetch` cobrindo sucesso, erro HTTP e falha de rede). Migration `0012_eminent_wraith` aplicada em produção (tabelas novas, sem dado existente), segunda geração do Drizzle confirma "No schema changes".

**Não testado de ponta a ponta:** (a) navegação da tela em navegador real (sandbox sem acesso à internet externa, mesma limitação de todas as stories anteriores); (b) sincronização real com uma conta Pluggy de produção — não há credencial real disponível ainda, por decisão explícita do dono do produto de adiantar apenas schema/UI/lógica.

## Tasks

- [x] `drizzle/schema.ts` — enums `bankAccountTipoEnum`/`bankTransactionTipoEnum`/`bankTransactionStatusEnum`, tabelas `pluggySettings`/`bankAccounts`/`bankTransactions`
- [x] `drizzle/0012_eminent_wraith.sql` aplicada em produção
- [x] `server/_core/pluggy.ts` — cliente HTTP (auth/transactions/accounts)
- [x] `server/db.ts` — helpers de contas/transações/credenciais Pluggy
- [x] `server/routers.ts` — routers `pluggySettings` e `bancario`
- [x] `client/src/pages/admin/AdminBpo.tsx` — aba "Bancos"
- [x] Testes: `server/tests/bancario.test.ts`, `server/pluggy.test.ts`
- [x] `tsc --noEmit`, `npm run build`, `npm test`

## File List

- `drizzle/schema.ts`
- `drizzle/0012_eminent_wraith.sql`
- `server/_core/pluggy.ts`
- `server/db.ts`
- `server/routers.ts`
- `client/src/pages/admin/AdminBpo.tsx`
- `server/tests/bancario.test.ts`
- `server/pluggy.test.ts`
- `docs/stories/epics/epic-007-financeiro-avancado/EPIC.md`
- `docs/stories/epics/ROADMAP.md`

## Validation Notes (@po)

Fecha o EPIC-007 e o roadmap inteiro (10/10 épicos). Fallback gracioso bem coberto por teste (rede indisponível, API indisponível, credencial ausente). Credenciais seguem o padrão já estabelecido (Asaas) em vez de reinventar. **Score: 9/10** (only pending: validação end-to-end com credencial real, fora do controle desta sessão).

**Verdict: GO**

## QA Results (@qa)

Code review: schema fiel à origem (`ContaBancaria`/`TransacaoBancaria`). Cliente Pluggy nunca lança exceção não tratada — toda falha de rede/API vira `null`/`[]` ou mensagem de erro tratável. Credenciais nunca em texto plano no banco (AES-256-GCM). `tsc`/`build`/`test` limpos (262/262), migration validada em produção. **Verdict: PASS**.

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-08 | 0.1.0 | Story criada e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-08 | 1.0.0 | Implementado e validado — Status: Ready → Done | @dev / @qa |
