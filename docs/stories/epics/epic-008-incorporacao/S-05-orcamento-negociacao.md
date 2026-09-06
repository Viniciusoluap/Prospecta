# Story S-05 — Orçamento Parametrizado e Negociação do Terreno
**Epic:** EPIC-008
**Status:** Done
**executor:** @dev
**quality_gate:** @dev
**quality_gate_tools:** [tsc, build, test, manual-review]

## Contexto

Quarto módulo `*_json` do épico. No Grupo Santa Fé, "Orçamento Parametrizado" estima o custo de obra por m² equivalente antes do detalhamento formal (uma story futura, "orçamento preliminar"), discriminado por pavimento com um coeficiente de equivalência de custo (ex.: garagem custa metade do m² de uma torre padrão). "Negociação do Terreno" registra o histórico de propostas trocadas com o proprietário/terreneiro (compra à vista/parcelada, permuta física/financeira/mista) até o fechamento, estimando automaticamente o valor da permuta financeira como percentual do VGV (Valor Geral de Vendas) bruto do empreendimento.

## Decisão de adaptação (dependência de um módulo inexistente, não invenção)

No Santa Fé, o VGV bruto usado para estimar a permuta financeira vem automaticamente da aba "Estudo de Viabilidade Econômica" (`viabilidade-tab.tsx`, etapa 2.5 — cálculo de loteamento/mix de produtos), que **não existe no Prospecta** (não está no plano de stories atual do `EPIC.md`; seria um módulo próprio e substancial, fora do escopo desta story). Replicar a integração automática exigiria inventar/simular um resultado de Viabilidade que ainda não existe — o que violaria o princípio "No Invention". Em vez disso, o VGV bruto usado no cálculo de permuta financeira é um **campo manual** (`vgvGrossManual`) preenchido pelo usuário nesta story, com a limitação documentada explicitamente na própria UI. A fórmula de estimativa em si (`valorEstimadoProposta`) é idêntica à do Santa Fé — só a origem do número de VGV muda (automática lá, manual aqui, por enquanto).

## Acceptance Criteria

- [x] AC-01: Orçamento Parametrizado — tabela de pavimentos (área + coeficiente de equivalência) e custos adicionais (passivo ambiental, decoração, projetos, infraestrutura, outros), com cálculo automático de área equivalente total, custo de obra base, custo total e custo/m² real
- [x] AC-02: Negociação do Terreno — cadastro de propostas (data, autor, tipo, status) com campos condicionais por tipo (valor/entrada/prazo para compra; percentual de VGV para permuta financeira; unidades para permuta física), resumo (total de propostas, proposta atual, valor estimado, indicador de negociação fechada)
- [x] AC-03: VGV bruto para a estimativa de permuta financeira é um campo manual explícito, com a limitação (ausência de módulo de Viabilidade) documentada na UI
- [x] AC-04: Os dois blocos gravam de forma independente (`parameterizedBudgetJson`, `landNegotiationJson`)
- [x] AC-05: `tsc --noEmit`, `npm run build` e `npm test` (com testes novos para os dois cálculos puros) passam limpos

## Decisões de implementação (adaptações deliberadas, não invenção)

- **Cálculos 100% portados**: `calcularOrcamentoParametrizado` e `resumoNegociacao`/`valorEstimadoProposta` são cópias fiéis da lógica do Santa Fé — mesmas fórmulas, mesmo critério de "proposta atual" (mais recente por data), mesmo critério de "negociação fechada" (existe proposta com status aceita).
- **Campo `autor` simplificado**: o Santa Fé usa `"grupo_santa_fe" | "proprietario"` (nome da empresa hardcoded no valor do enum); o Prospecta usa `"grupo" | "proprietario"`, já que o nome da empresa muda entre os dois produtos — mudança de rótulo, não de lógica.
- **VGV bruto manual (ver seção de decisão acima)**: a diferença mais significativa desta story em relação ao Santa Fé. Documentada com transparência tanto na UI quanto aqui.
- **Um único componente com dois cards**: `OrcamentoNegociacao.tsx` agrupa as duas ferramentas (consistente com a consolidação já usada em `EstudoMercado.tsx` na S-03).
- **Somente admin**: as duas novas mutations (`saveOrcamentoParametrizado`/`saveNegociacaoTerreno`) seguem `requireRole(ctx, ["admin"])`.

## Validação — honestidade de status (regra do dono do produto)

**Testado automaticamente:** `tsc --noEmit` limpo, `npm run build` limpo, `npm test` (137/137 passando, 14 testes novos: `server/incorporacao-orcamento-parametrizado.test.ts` cobrindo área equivalente por coeficiente, custo de obra base, soma de custos adicionais, custo/m² real e o caso de área zero; `server/incorporacao-negociacao.test.ts` cobrindo estimativa de valor por tipo de proposta, seleção da proposta mais recente, detecção de negociação fechada, e parsing seguro do JSON salvo). Toda a lógica de cálculo é a mesma do Santa Fé, verificada linha a linha contra o código de origem.

**Não testado de ponta a ponta:** preenchimento real dos formulários em um navegador — mesma limitação de sandbox documentada em todas as stories anteriores. **Recomendação:** validar com dados reais de um estudo em andamento após o deploy.

## Tasks

- [x] `shared/incorporacao/orcamento-parametrizado.ts` — `calcularOrcamentoParametrizado`
- [x] `shared/incorporacao/negociacao.ts` — `resumoNegociacao`/`valorEstimadoProposta`/`negociacaoFechadaDoJson`
- [x] `server/routers.ts` — mutations `incorporacao.saveOrcamentoParametrizado`/`saveNegociacaoTerreno`
- [x] `client/src/components/incorporacao/OrcamentoNegociacao.tsx` — os dois cards
- [x] Integração em `client/src/pages/admin/AdminIncorporacaoDetail.tsx` (remove o item de `FUTURE_MODULES`)
- [x] Testes: `server/incorporacao-orcamento-parametrizado.test.ts`, `server/incorporacao-negociacao.test.ts`
- [x] `tsc --noEmit`, `npm run build`, `npm test`

## File List

- `shared/incorporacao/orcamento-parametrizado.ts`
- `shared/incorporacao/negociacao.ts`
- `server/routers.ts`
- `client/src/components/incorporacao/OrcamentoNegociacao.tsx`
- `client/src/pages/admin/AdminIncorporacaoDetail.tsx`
- `server/incorporacao-orcamento-parametrizado.test.ts`
- `server/incorporacao-negociacao.test.ts`

## Validation Notes (@po)

Story trata com transparência a única lacuna real (VGV automático depende de um módulo de Viabilidade que não existe no Prospecta) em vez de simular um número — exatamente o padrão "No Invention" já aplicado no re-escopo da S-03. Os dois cálculos entregues são fiéis ao Santa Fé. **Score: 8/10**.

**Verdict: GO**

## QA Results (@qa)

Code review: `calcularOrcamentoParametrizado` confere com a origem (área equivalente, custo base, custo total, custo/m² real). `resumoNegociacao`/`valorEstimadoProposta` corretos para todos os 5 tipos de proposta, incluindo o caso de permuta financeira sem VGV informado (retorna 0, não erro). Limitação do VGV manual bem documentada na UI e na story. Mutations restritas a admin. `tsc`/`build`/`test` limpos (137/137). **Verdict: PASS**.

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-06 | 0.1.0 | Story criada, com a adaptação do VGV manual já identificada e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-06 | 1.0.0 | Implementado e validado — Status: Ready → Done | @dev / @qa |
