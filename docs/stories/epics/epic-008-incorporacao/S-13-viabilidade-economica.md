# Story S-13 — Estudo de Viabilidade Econômica (EVE)
**Epic:** EPIC-008
**Status:** Done
**executor:** @dev
**quality_gate:** @dev
**quality_gate_tools:** [tsc, build, test, manual-review]

## Contexto

Décimo-nono módulo `*_json` do épico, e o único que não constava no `EPIC.md` original — descoberto durante a S-08 (ver nota em `S-08-registro-orcamento-preliminar.md`) como uma lacuna real da trilha. O Grupo Santa Fé tem um motor completo de viabilidade econômica que, a partir de premissas de terreno/urbanístico/mix de produtos/vendas/custos/cronograma, calcula VGV, fluxo de caixa mensal indexado (com correção INCC da obra), VPL, TIR (via bisseção), ROI, margem líquida, payback, exposição máxima de caixa, break-even e distribuição de recebíveis entre incorporador e terreneiro (permuta) — em três cenários (conservador/ideal/agressivo), que fazem o papel da análise de sensibilidade.

**Correção de referência:** a nota de descoberta da S-08 citava `lib/finance/eve.ts` como o motor de origem. Ao abrir a aba "Viabilidade" do Santa Fé para portar de fato, ficou claro que `eve.ts` (366 linhas) só contém as funções genéricas `vpl`/`tir`/`payback` — hoje código morto, sem nenhum import fora do seu próprio teste. O motor real que a UI usa é `lib/finance/loteamento.ts` (422 linhas), que importa `vpl`/`tir`/`payback` de `eve.ts` e implementa o cálculo urbanístico + mix + fluxo de caixa completo. A S-13 porta os dois arquivos juntos (a única parte de `loteamento.ts` já portada antes era `calcularMix`/`ItemMixProduto`/`ResultadoMix`, na S-10).

## Acceptance Criteria

- [x] AC-01: Motor `calcularLoteamento`/`calcularCenarios` portado 1:1 do Santa Fé (urbanístico + mix + fluxo de caixa mensal + VPL/TIR/ROI/margem/payback/exposição máxima/break-even/recebíveis)
- [x] AC-02: Três cenários (conservador -10%/vendas 40% mais lentas, ideal, agressivo +10%/vendas 30% mais rápidas) fazendo o papel da análise de sensibilidade
- [x] AC-03: UI com formulário de premissas (terreno/urbanístico, vendas/financeiro, cronograma/terreno, custos), mix de produtos próprio (pré-preenchido a partir do Mix de Produtos do Lançamento Imobiliário quando existir), KPIs do cenário ativo, comparação entre os três cenários, gráfico de fluxo de caixa acumulado (recharts) e detalhamento de VGV/custos/recebíveis
- [x] AC-04: Card "Nota sobre a Viabilidade Econômica" (placeholder desde a S-12) substituído pelo componente funcional — fecha a última lacuna documentada do epic
- [x] AC-05: `tsc --noEmit`, `npm run build` e `npm test` (com testes novos) passam limpos

## Decisões de implementação (adaptações deliberadas, não invenção)

- **Reaproveitamento de coluna já existente**: a tabela `incorporation_studies` já tinha uma coluna `lotting_json` (nunca usada em nenhuma das 12 stories anteriores) cujo nome corresponde exatamente ao campo `estudo.loteamentoJson` do Santa Fé — usada para persistir as premissas + mix, sem gerar migration nova. A coluna `feasibility_json` (também órfã) permanece sem uso — não corresponde a nenhum campo do Santa Fé identificado até agora.
- **`calcularMix`/`ItemMixProduto`/`ResultadoMix` reaproveitados da S-10** (`shared/incorporacao/mix-produtos.ts`) em vez de duplicados — o novo módulo `viabilidade-economica.ts` importa deles.
- **Mix de produtos independente do Mix de Produtos do Lançamento (S-10)**: exatamente como no Santa Fé, a aba de Viabilidade tem seu próprio estado de mix (pode ser ajustado ali sem afetar o Lançamento) — pré-preenchido a partir de `productMixJson` quando existir, igual ao Santa Fé preenche a partir do cenário de Massa selecionado.
- **`analiseSensibilidade` de `eve.ts` não portada**: é código genérico não usado por `viabilidade-tab.tsx` na origem (a sensibilidade real do produto são os três cenários de `calcularCenarios`) — portar uma função morta da origem seria inventar uso, não replicar comportamento.
- **Reuso de `recharts`**: já é dependência do projeto (usado no build antes desta story) — nenhuma dependência nova adicionada.
- **Campos manuais anteriores (VGV bruto na S-05, investimento total na S-06, duração da obra na S-11) não foram rewireados** para consumir o resultado deste motor — permanecem como estimativas manuais independentes, e podem futuramente ser preenchidos com base no resultado da Viabilidade se o dono do produto pedir; essa é uma melhoria de UX opcional, fora do escopo desta story (que só precisava fechar a lacuna do motor em si).
- **Somente admin**: a nova mutation (`saveViabilidade`) segue `requireRole(ctx, ["admin"])`, mesmo padrão de todas as demais.

## Validação — honestidade de status (regra do dono do produto)

**Testado automaticamente:** `tsc --noEmit` limpo, `npm run build` limpo, `npm test` — **229/229 passando** (12 testes novos em `server/incorporacao-viabilidade-economica.test.ts`: vpl/tir/payback, pesos de curva de vendas somando 1, urbanístico, determinismo do motor completo, exposição máxima, e cenários agressivo > ideal > conservador em VGV).

**Não testado de ponta a ponta:** preenchimento do formulário completo e leitura visual do gráfico de fluxo de caixa em um navegador real (sandbox headless não permite). A lógica em si é 100% coberta por teste unitário determinístico (mesma fórmula, mesma saída). **Recomendação:** após o deploy, abrir um estudo com terreno e mix preenchidos, ajustar as premissas de venda/custo e conferir visualmente se os indicadores (VPL/TIR/payback) mudam de forma coerente entre os três cenários.

## Tasks

- [x] `shared/incorporacao/viabilidade-economica.ts` — `vpl`/`tir`/`payback` (de `eve.ts`) + `pesosCurvaVendas`/`calcularUrbanistico`/`calcularLoteamento`/`calcularCenarios` (de `loteamento.ts`), reaproveitando `calcularMix` da S-10
- [x] `server/routers.ts` — mutation `incorporacao.saveViabilidade` (grava em `lottingJson`)
- [x] `client/src/components/incorporacao/ViabilidadeEconomica.tsx` — formulário de premissas + mix + cenários + KPIs + gráfico de fluxo de caixa
- [x] Integração em `client/src/pages/admin/AdminIncorporacaoDetail.tsx` (substitui o card "Nota sobre a Viabilidade Econômica")
- [x] Testes: `server/incorporacao-viabilidade-economica.test.ts`
- [x] `tsc --noEmit`, `npm run build`, `npm test`
- [x] Marca EPIC-008 100% Done (S-01 a S-13) em `EPIC.md`/`ROADMAP.md`

## File List

- `shared/incorporacao/viabilidade-economica.ts`
- `server/routers.ts`
- `client/src/components/incorporacao/ViabilidadeEconomica.tsx`
- `client/src/pages/admin/AdminIncorporacaoDetail.tsx`
- `server/incorporacao-viabilidade-economica.test.ts`
- `docs/stories/epics/epic-008-incorporacao/EPIC.md`
- `docs/stories/epics/ROADMAP.md`

## Validation Notes (@po)

Fecha a última lacuna documentada do epic com o mesmo rigor das demais 12 stories: motor portado sem alteração de lógica, decisão de reaproveitar coluna já existente em vez de migration nova, e correção transparente da referência de origem (o motor real é `loteamento.ts`, não `eve.ts` isoladamente) registrada em vez de silenciada. **Score: 9/10**.

**Verdict: GO**

## QA Results (@qa)

Code review: fórmulas de `calcularUrbanistico`/`calcularLoteamento`/`calcularCenarios` conferem termo a termo com a origem, incluindo a curva INCC da obra e a distribuição de recebíveis por permuta. Testes cobrem determinismo, consistência do fluxo de caixa acumulado e ordenação correta dos três cenários. Nenhuma dependência nova, nenhuma migration nova, mutation restrita a admin. `tsc`/`build`/`test` limpos (229/229). **Verdict: PASS**.

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-06 | 0.1.0 | Story criada e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-06 | 1.0.0 | Implementado e validado; EPIC-008 100% Done (S-01 a S-13) — Status: Ready → Done | @dev / @qa |
