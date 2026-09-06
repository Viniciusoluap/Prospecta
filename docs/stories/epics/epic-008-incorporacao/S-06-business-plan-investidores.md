# Story S-06 — Business Plan e Investidores
**Epic:** EPIC-008
**Status:** Done
**executor:** @dev
**quality_gate:** @dev
**quality_gate_tools:** [tsc, build, test, manual-review]

## Contexto

Quinto módulo `*_json` do épico. No Grupo Santa Fé, "Business Plan e Investidores" simula a captação de recursos com fundos/investidores: cada fonte de captação (fundo, investidor-anjo, sócio capitalista) tem um capital aportado, uma remuneração (mensal ou anual, convertida para taxa mensal composta equivalente) e um prazo de resgate; o valor de resgate é calculado por juros compostos. O resultado é comparado ao investimento total do empreendimento para saber que percentual já está captado e quanto capital próprio ainda é necessário.

## Decisão de adaptação (mesma limitação da S-05, não invenção)

Assim como na negociação do terreno (S-05), o investimento total de comparação vem, no Santa Fé, automaticamente da aba de Viabilidade Econômica — módulo ainda inexistente no Prospecta. A função `calcularBusinessPlan` já recebia esse valor como **parâmetro opcional** no código original (não como cálculo interno obrigatório), então a adaptação aqui foi direta: o Prospecta pede o investimento total como campo manual, com a limitação documentada na UI, exatamente como na S-05.

## Acceptance Criteria

- [x] AC-01: Cadastro de fontes de captação (nome, capital aportado, remuneração %, período mensal/anual, prazo de resgate em meses)
- [x] AC-02: Cálculo por fonte do valor de resgate via juros compostos (convertendo remuneração anual para sua equivalente mensal composta quando aplicável) e do custo total da captação
- [x] AC-03: Agregados: capital total captado, custo total da captação, custo médio ponderado mensal, percentual do investimento total já captado e capital próprio necessário (quando o investimento total é informado)
- [x] AC-04: Investimento total é um campo manual explícito, com a limitação (ausência de módulo de Viabilidade) documentada na UI
- [x] AC-05: `tsc --noEmit`, `npm run build` e `npm test` (com testes novos) passam limpos

## Decisões de implementação (adaptações deliberadas, não invenção)

- **Cálculo 100% portado**: `taxaMensalEquivalente`, `calcularFonteCaptacao` e `calcularBusinessPlan` são cópias fiéis do Santa Fé — mesma fórmula de juros compostos, mesma conversão de taxa anual→mensal, mesmos agregados.
- **Investimento total manual (ver decisão acima)**: única diferença de comportamento em relação ao Santa Fé, documentada com transparência.
- **Somente admin**: a nova mutation (`saveBusinessPlan`) segue `requireRole(ctx, ["admin"])`.

## Validação — honestidade de status (regra do dono do produto)

**Testado automaticamente:** `tsc --noEmit` limpo, `npm run build` limpo, `npm test` (146/146 passando, 9 testes novos em `server/incorporacao-captacao.test.ts` cobrindo conversão de taxa anual→mensal composta, cálculo de valor de resgate (incluindo prazo zero), agregados do business plan com e sem investimento total informado, e o parser seguro do JSON salvo). Toda a lógica de cálculo é a mesma do Santa Fé, verificada linha a linha.

**Não testado de ponta a ponta:** preenchimento real do formulário em um navegador — mesma limitação de sandbox documentada em todas as stories anteriores.

## Tasks

- [x] `shared/incorporacao/captacao.ts` — `taxaMensalEquivalente`/`calcularFonteCaptacao`/`calcularBusinessPlan`/`businessPlanPreenchidoDoJson`
- [x] `server/routers.ts` — mutation `incorporacao.saveBusinessPlan`
- [x] `client/src/components/incorporacao/BusinessPlan.tsx`
- [x] Integração em `client/src/pages/admin/AdminIncorporacaoDetail.tsx` (remove o item de `FUTURE_MODULES`)
- [x] Testes: `server/incorporacao-captacao.test.ts`
- [x] `tsc --noEmit`, `npm run build`, `npm test`

## File List

- `shared/incorporacao/captacao.ts`
- `server/routers.ts`
- `client/src/components/incorporacao/BusinessPlan.tsx`
- `client/src/pages/admin/AdminIncorporacaoDetail.tsx`
- `server/incorporacao-captacao.test.ts`

## Validation Notes (@po)

Story curta e direta, reaplicando o mesmo padrão de adaptação honesta já estabelecido na S-05 para a mesma limitação (ausência de Viabilidade Econômica). Cálculo financeiro fiel ao original. **Score: 8/10**.

**Verdict: GO**

## QA Results (@qa)

Code review: fórmula de juros compostos e conversão de taxa conferem com a origem, incluindo o caso-limite de prazo zero (sem crescimento). Agregados corretos com e sem investimento total. Mutation restrita a admin. `tsc`/`build`/`test` limpos (146/146). **Verdict: PASS**.

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-06 | 0.1.0 | Story criada e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-06 | 1.0.0 | Implementado e validado — Status: Ready → Done | @dev / @qa |
