# Story S-09 — Planejamento de Lançamento, Fornecedores e Material Publicitário
**Epic:** EPIC-008
**Status:** Done
**executor:** @dev
**quality_gate:** @dev
**quality_gate_tools:** [tsc, build, test, manual-review]

## Contexto

Décimo, décimo-primeiro e décimo-segundo módulos `*_json` do épico (agrupados numa única story por serem três checklists pequenos e sequenciais na fase de Lançamento, Marketing e Vendas). "Planejamento do Lançamento" é um cronograma de marcos padrão (data do evento, tabela de vendas, contratação da equipe de vendas, material publicitário, estande, divulgação, evento, follow-up). "Contratação de Fornecedores" gerencia fornecedores de marketing/estande/eventos por categoria, com valor contratado. "Material Publicitário" é um repositório e fluxo de aprovação das peças (site, folder, vídeo, redes sociais, etc.).

## Acceptance Criteria

- [x] AC-01: Planejamento do Lançamento — cronograma de 8 marcos padrão pré-preenchidos, com data prevista/realizada e status (pendente/em andamento/concluído), resumo com percentual concluído e alerta de atraso
- [x] AC-02: Contratação de Fornecedores — cadastro por categoria (Agência de Publicidade, Estande/Decorado, Fotografia/Vídeo, Buffet/Eventos, Brindes, Mídia/Ads, Outro) com nome, contato, valor contratado e status; resumo com percentual contratado e valor total contratado
- [x] AC-03: Material Publicitário — cadastro por tipo de peça (Site, Folder/Encarte, Vídeo Institucional, Redes Sociais, Placa/Outdoor, Anúncio Impresso, Outro) com nome, URL e status de aprovação; resumo com percentual aprovado
- [x] AC-04: Os três blocos gravam de forma independente (`launchPlanJson`, `launchSuppliersJson`, `marketingMaterialJson`)
- [x] AC-05: `tsc --noEmit`, `npm run build` e `npm test` (com testes novos) passam limpos

## Decisões de implementação (adaptações deliberadas, não invenção)

- **Cálculos 100% portados**: `resumoPlanejamentoLancamento`, `resumoFornecedoresLancamento` e `resumoMaterialPublicitario` são cópias fiéis do Santa Fé, incluindo as listas fixas de marcos/categorias/tipos.
- **Um único componente com três cards**: `LancamentoMarketing.tsx`, seguindo o padrão de consolidação já usado nas stories anteriores.
- **Somente admin**: as três novas mutations (`savePlanejamentoLancamento`/`saveFornecedoresLancamento`/`saveMaterialPublicitario`) seguem `requireRole(ctx, ["admin"])`.

## Validação — honestidade de status (regra do dono do produto)

**Testado automaticamente:** `tsc --noEmit` limpo, `npm run build` limpo, `npm test` (183/183 passando, 13 testes novos entre os três módulos, cobrindo percentuais, detecção de atraso com data de referência fixa, soma de valores contratados e os parsers de conclusão total). Toda a lógica é a mesma do Santa Fé.

**Não testado de ponta a ponta:** preenchimento real dos formulários em um navegador — mesma limitação de sandbox documentada em todas as stories anteriores.

## Tasks

- [x] `shared/incorporacao/planejamento-lancamento.ts` — `resumoPlanejamentoLancamento`/`planejamentoLancamentoCompletoDoJson`/`MARCOS_PADRAO_LANCAMENTO`
- [x] `shared/incorporacao/fornecedores-lancamento.ts` — `resumoFornecedoresLancamento`/`fornecedoresTodosContratadosDoJson`
- [x] `shared/incorporacao/material-publicitario.ts` — `resumoMaterialPublicitario`/`materialPublicitarioAprovadoDoJson`
- [x] `server/routers.ts` — mutations `incorporacao.savePlanejamentoLancamento`/`saveFornecedoresLancamento`/`saveMaterialPublicitario`
- [x] `client/src/components/incorporacao/LancamentoMarketing.tsx` — os três cards
- [x] Integração em `client/src/pages/admin/AdminIncorporacaoDetail.tsx` (remove o item de `FUTURE_MODULES`)
- [x] Testes: `server/incorporacao-planejamento-lancamento.test.ts`, `server/incorporacao-fornecedores.test.ts`, `server/incorporacao-material-publicitario.test.ts`
- [x] `tsc --noEmit`, `npm run build`, `npm test`

## File List

- `shared/incorporacao/planejamento-lancamento.ts`
- `shared/incorporacao/fornecedores-lancamento.ts`
- `shared/incorporacao/material-publicitario.ts`
- `server/routers.ts`
- `client/src/components/incorporacao/LancamentoMarketing.tsx`
- `client/src/pages/admin/AdminIncorporacaoDetail.tsx`
- `server/incorporacao-planejamento-lancamento.test.ts`
- `server/incorporacao-fornecedores.test.ts`
- `server/incorporacao-material-publicitario.test.ts`

## Validation Notes (@po)

Story simples e fiel ao original, sem dependências de módulos inexistentes. **Score: 9/10**.

**Verdict: GO**

## QA Results (@qa)

Code review: percentuais e critérios de atraso corretos em todos os três módulos. Soma de valor contratado exclui corretamente fornecedores ainda em orçamento. Mutations restritas a admin. `tsc`/`build`/`test` limpos (183/183). **Verdict: PASS**.

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-06 | 0.1.0 | Story criada e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-06 | 1.0.0 | Implementado e validado — Status: Ready → Done | @dev / @qa |
