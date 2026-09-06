# Story S-01 — Procedures Públicos (Contato + Mercado)
**Epic:** EPIC-010
**Status:** Done
**executor:** @dev
**quality_gate:** @dev
**quality_gate_tools:** [tsc, build, test]

## Contexto

Primeira story do EPIC-010 — antes de construir as páginas institucionais, é preciso garantir que `/contato` e `/mercado` tenham um backend real para consumir (formulário que efetivamente cria um lead; listagem de imóveis verificados do agregador construído no EPIC-005), em vez de páginas decorativas sem função. Ambos os routers necessários (`leads`, `agregador`) já existem mas são `protectedProcedure` (exigem login admin/corretor/colaborador) — inadequados para uma página pública anônima.

## Acceptance Criteria

- [x] AC-01: `leads.createPublic` (publicProcedure) — cria um lead a partir do formulário de contato público, sem exigir autenticação, reaproveitando `db.createLead`/`db.addLeadActivity` e a mesma lógica de roteamento automático por cidade já usada em `leads.create`
- [x] AC-02: `agregador.listPublic` (publicProcedure) — retorna apenas imóveis do agregador com `status: "verificado"`, expondo somente campos seguros para exibição pública (sem `notas`, `documentoObs`, `contatoNome` internos)
- [x] AC-03: `tsc --noEmit`, `npm run build` e `npm test` passam limpos

## Decisões de implementação (adaptações deliberadas, não invenção)

- **Sem novo schema**: nenhuma tabela nova foi criada — `leads` e `agregadorImoveis` já existem (EPIC-002/Codex e EPIC-005/Claude respectivamente). Esta story apenas expõe dois novos procedures tRPC públicos, reaproveitando funções de `db.ts` já existentes.
- **`createPublic` não expõe campos administrativos**: `stage`, `responsible`, `temperature` e `type` continuam calculados/fixados no servidor (não vêm do input do cliente), igual ao `create` original — evita que o formulário público manipule campos de pipeline do CRM.
- **`listPublic` filtra no servidor**: o filtro `status: "verificado"` é fixo no procedure, não um parâmetro do cliente — a página pública nunca pode listar itens `pendente`/`arquivado`/`importado`.

## Validação — honestidade de status (regra do dono do produto)

**Testado automaticamente:** `tsc --noEmit` limpo, `npm run build` limpo, `npm test` (69/69 passando, sem regressão). Os dois novos procedures foram conferidos manualmente contra as funções reais de `server/db.ts` (`createLead`, `addLeadActivity`, `getAllAgregadorImoveis`) — nenhuma função nova foi inventada no banco.

**Não testado de ponta a ponta:** submissão real do formulário (dependente das páginas da S-02, ainda não construídas neste ponto) e verificação de que um lead público realmente aparece no CRM admin — recomendado validar após o deploy, junto com a S-02.

## Tasks

- [x] `leads.createPublic` em `server/routers.ts`
- [x] `agregador.listPublic` em `server/routers.ts`
- [x] `tsc --noEmit`, `npm run build`, `npm test`

## File List

- `server/routers.ts`

## Validation Notes (@po)

Escopo mínimo e bem definido — apenas os dois procedures necessários para destravar as páginas de contato e mercado da S-02, sem tocar em schema. Filtros de segurança (status fixo, campos internos omitidos) corretamente aplicados no servidor, não no cliente. **Score: 8/10**.

**Verdict: GO**

## QA Results (@qa)

Code review: `createPublic` não aceita `stage`/`responsible`/`temperature`/`type` do cliente — todos calculados ou fixados no servidor, consistente com `create`. `listPublic` usa `getAllAgregadorImoveis({ status: "verificado" })` (função já existente, sem alteração) e mapeia manualmente apenas campos públicos-seguros. `tsc`/`build`/`test` limpos. **Verdict: PASS**.

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-06 | 0.1.0 | Story criada e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-06 | 1.0.0 | Implementado e validado — Status: Ready → Done | @dev / @qa |
