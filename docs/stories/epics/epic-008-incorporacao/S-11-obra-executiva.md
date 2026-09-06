# Story S-11 — Projetos Executivos, Orçamento e Cronograma Físico-Financeiro da Obra
**Epic:** EPIC-008
**Status:** Done
**executor:** @dev
**quality_gate:** @dev
**quality_gate_tools:** [tsc, build, test, manual-review]

## Contexto

Décimo-quinto, décimo-sexto e décimo-sétimo módulos `*_json` do épico (a fase "Projetos Executivos e Obras" do Santa Fé). "Projetos Executivos" é um repositório dos projetos de engenharia detalhados por disciplina até a liberação para obra. "Orçamento da Obra" compara orçado x realizado por categoria, reconciliado com o Orçamento Preliminar (S-08). "Cronograma Físico-Financeiro" é a curva S clássica de obras: avanço físico medido em campo comparado ao avanço financeiro projetado (desembolso linear ao longo da duração da obra), com cálculo de desvio.

## Acceptance Criteria

- [x] AC-01: Projetos Executivos — cadastro por disciplina (8 disciplinas fixas) com URL, data de liberação e status (não iniciado → em elaboração → em revisão → liberado para obra); resumo com percentual liberado
- [x] AC-02: Orçamento da Obra — itens por categoria (mesmas 13 categorias do Orçamento Preliminar) com valor orçado e realizado; resumo com total orçado/realizado, percentual executado e variação vs. Orçamento Preliminar (S-08), com alerta acima de 15% de divergência
- [x] AC-03: Cronograma Físico-Financeiro — medições mensais de avanço físico acumulado, comparadas a uma projeção financeira linear (baseada na duração de obra informada), com desvio calculado e indicador de obra concluída
- [x] AC-04: A duração de obra usada na projeção financeira é um campo manual explícito (mesma classe de adaptação das S-05/S-06/S-10), com a limitação documentada na UI
- [x] AC-05: Os três blocos gravam de forma independente (`executiveProjectsJson`, `workBudgetJson`, `physicalFinancialScheduleJson`)
- [x] AC-06: `tsc --noEmit`, `npm run build` e `npm test` (com testes novos) passam limpos

## Decisões de implementação (adaptações deliberadas, não invenção)

- **Cálculos 100% portados**: `resumoProjetosExecutivos`, `resumoOrcamentoObra` e `resumoCronogramaObra`/`avancoFinanceiroProjetado` são cópias fiéis do Santa Fé, incluindo a fórmula de projeção linear (`(mês + 1) / duração × 100`, limitada a [0, 100]).
- **Reuso de `CATEGORIAS_ORCAMENTO_PRELIMINAR`**: assim como no Santa Fé, `CATEGORIAS_ORCAMENTO_OBRA` é um alias do mesmo array de categorias do Orçamento Preliminar (S-08) — mesma disciplina de reaproveitamento em vez de duplicar a lista.
- **Reconciliação real com S-08**: a referência do Orçamento da Obra usa `resumoOrcamentoPreliminar` (já implementado na S-08) sobre o `preliminaryBudgetJson` salvo — não um valor inventado.
- **Duração de obra manual**: no Santa Fé, essa duração vem da Viabilidade Econômica (S-13 no backlog); a função já recebia esse valor como parâmetro opcional no código original, então a adaptação foi direta — campo manual com a limitação documentada, mesmo padrão das stories anteriores que dependiam desse módulo ausente.
- **Um único componente com três cards**: `ObraExecutiva.tsx`, seguindo o padrão de consolidação já usado nas stories anteriores.
- **Somente admin**: as três novas mutations (`saveProjetosExecutivos`/`saveOrcamentoObra`/`saveCronogramaObra`) seguem `requireRole(ctx, ["admin"])`.

## Validação — honestidade de status (regra do dono do produto)

**Testado automaticamente:** `tsc --noEmit` limpo, `npm run build` limpo, `npm test` (213/213 passando, 19 testes novos entre os três módulos, cobrindo percentuais, reconciliação com referência, projeção financeira linear com limite em 100%, cálculo de desvio, e indicador de obra concluída). Toda a lógica é a mesma do Santa Fé.

**Não testado de ponta a ponta:** preenchimento real dos formulários em um navegador — mesma limitação de sandbox documentada em todas as stories anteriores.

## Tasks

- [x] `shared/incorporacao/projetos-executivos.ts` — `resumoProjetosExecutivos`/`projetosExecutivosTodosLiberadosDoJson`
- [x] `shared/incorporacao/orcamento-obra.ts` — `resumoOrcamentoObra`/`orcamentoObraPreenchidoDoJson`
- [x] `shared/incorporacao/cronograma-obra.ts` — `resumoCronogramaObra`/`avancoFinanceiroProjetado`/`obraConcluidaDoJson`
- [x] `server/routers.ts` — mutations `incorporacao.saveProjetosExecutivos`/`saveOrcamentoObra`/`saveCronogramaObra`
- [x] `client/src/components/incorporacao/ObraExecutiva.tsx` — os três cards
- [x] Integração em `client/src/pages/admin/AdminIncorporacaoDetail.tsx` (remove o item de `FUTURE_MODULES`)
- [x] Testes: `server/incorporacao-projetos-executivos.test.ts`, `server/incorporacao-orcamento-obra.test.ts`, `server/incorporacao-cronograma-obra.test.ts`
- [x] `tsc --noEmit`, `npm run build`, `npm test`

## File List

- `shared/incorporacao/projetos-executivos.ts`
- `shared/incorporacao/orcamento-obra.ts`
- `shared/incorporacao/cronograma-obra.ts`
- `server/routers.ts`
- `client/src/components/incorporacao/ObraExecutiva.tsx`
- `client/src/pages/admin/AdminIncorporacaoDetail.tsx`
- `server/incorporacao-projetos-executivos.test.ts`
- `server/incorporacao-orcamento-obra.test.ts`
- `server/incorporacao-cronograma-obra.test.ts`

## Validation Notes (@po)

Story fecha a fase de obras com fidelidade total às fórmulas do Santa Fé, reaproveitando corretamente a S-08 (categorias e referência de orçamento) em vez de duplicar. A limitação da duração de obra manual é a mesma classe de adaptação já aceita em stories anteriores. **Score: 8/10**.

**Verdict: GO**

## QA Results (@qa)

Code review: fórmula de projeção financeira linear confere com a origem, incluindo o teto de 100%. Reconciliação com o Orçamento Preliminar usa o cálculo real (S-08). Critério de "obra concluída" correto (última medição por mês, não a mais recente por data de inserção). Mutations restritas a admin. `tsc`/`build`/`test` limpos (213/213). **Verdict: PASS**.

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-06 | 0.1.0 | Story criada e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-06 | 1.0.0 | Implementado e validado — Status: Ready → Done | @dev / @qa |
