# Story S-08 — Registro da Incorporação e Orçamento Preliminar
**Epic:** EPIC-008
**Status:** Done
**executor:** @dev
**quality_gate:** @dev
**quality_gate_tools:** [tsc, build, test, manual-review]

## Contexto

Oitavo e nono módulos `*_json` do épico. "Registro da Incorporação" é um checklist pré-preenchido automaticamente com os 13 documentos exigidos pelo art. 32 da Lei 4.591/64 para registrar a incorporação em cartório (título de propriedade, certidões negativas, projeto aprovado, quadro NBR 12721, etc.) — consistente com a regra do dono do produto de "nunca pedir manualmente o que o sistema já pode entregar pronto". "Orçamento Preliminar" detalha o custo de obra por categoria (fundação, estrutura, instalações, etc.) e reconcilia automaticamente o total com o custo já calculado no Orçamento Parametrizado (S-05), alertando quando a divergência passa de 15%.

## Achado durante a implementação (registrado com transparência, não ação unilateral)

Ao investigar o código de origem para esta story, foi encontrado que o Grupo Santa Fé tem um módulo inteiro — "Estudo de Viabilidade Econômica" (EVE completo: `lib/finance/eve.ts`, ~366 linhas, e `viabilidade-tab.tsx`, ~776 linhas) — que **não está em nenhuma story do `EPIC.md` desta trilha**. Esse motor calcula VGV, fluxo de caixa mensal, VPL, TIR, payback, exposição máxima de caixa e análise de sensibilidade, e é a fonte real do "VGV bruto"/"investimento total" que as stories S-05 (negociação do terreno) e S-06 (business plan) precisaram tornar campo manual por falta desse módulo. O nome "EVE" no título original da S-08 (`"Registro da incorporação e orçamento preliminar (EVE)"`) se referia apenas à reconciliação do orçamento preliminar com o parametrizado — não ao motor de viabilidade completo, que é uma etapa própria e maior do Santa Fé (a "2.5 Estudo de Viabilidade Econômica"), nunca planejada nesta trilha.

Dado o tamanho (motor financeiro com fluxo de caixa mês a mês, TIR por bisseção, análise de sensibilidade, mais uma UI de ~776 linhas com gráfico), esta lacuna foi registrada como uma **nova story de backlog** (ver `ROADMAP.md` e a tabela de Stories abaixo) em vez de ser encaixada às pressas nesta story ou inventada de forma simplificada — consistente com o princípio "No Invention": é melhor documentar o que falta do que entregar uma versão capenga do motor mais importante do épico.

## Acceptance Criteria

- [x] AC-01: Registro da Incorporação — checklist com os 13 documentos padrão pré-preenchidos, status (pendente/em providência/obtido), data de obtenção e observações por documento
- [x] AC-02: Orçamento Preliminar — itens por categoria (13 categorias fixas) com valor orçado e observações, total agregado, referência automática ao custo total do Orçamento Parametrizado (S-05) e variação percentual, com alerta quando a divergência excede 15%
- [x] AC-03: Os dois blocos gravam de forma independente (`incorporationRegistrationJson`, `preliminaryBudgetJson`)
- [x] AC-04: Achado sobre o módulo de Viabilidade Econômica ausente registrado em `ROADMAP.md`/`EPIC.md` como nova story de backlog
- [x] AC-05: `tsc --noEmit`, `npm run build` e `npm test` (com testes novos) passam limpos

## Decisões de implementação (adaptações deliberadas, não invenção)

- **Cálculos 100% portados**: `resumoRegistro` e `resumoOrcamentoPreliminar` são cópias fiéis do Santa Fé.
- **Checklist padrão embutido**: `DOCUMENTOS_PADRAO_REGISTRO` é a mesma lista de 13 documentos do art. 32 — nenhum item adicionado, removido ou reescrito.
- **Reconciliação real com S-05**: a referência do Orçamento Preliminar usa `calcularOrcamentoParametrizado` (já implementado na S-05) sobre o `parameterizedBudgetJson` salvo — não um valor inventado ou hardcoded.
- **Um único componente com dois cards**: `RegistroOrcamentoPreliminar.tsx`, seguindo o padrão de consolidação já usado nas stories anteriores.
- **Somente admin**: as duas novas mutations (`saveRegistroIncorporacao`/`saveOrcamentoPreliminar`) seguem `requireRole(ctx, ["admin"])`.

## Validação — honestidade de status (regra do dono do produto)

**Testado automaticamente:** `tsc --noEmit` limpo, `npm run build` limpo, `npm test` (170/170 passando, 12 testes novos: `server/incorporacao-registro.test.ts` cobrindo contagens/percentual e o parser de conclusão total; `server/incorporacao-orcamento-preliminar.test.ts` cobrindo soma de itens, variação percentual positiva/negativa e ausência de referência). Toda a lógica é a mesma do Santa Fé.

**Não testado de ponta a ponta:** preenchimento real dos formulários em um navegador — mesma limitação de sandbox documentada em todas as stories anteriores.

## Tasks

- [x] `shared/incorporacao/registro-incorporacao.ts` — `resumoRegistro`/`registroCompletoDoJson`/`DOCUMENTOS_PADRAO_REGISTRO`
- [x] `shared/incorporacao/orcamento-preliminar.ts` — `resumoOrcamentoPreliminar`/`orcamentoPreliminarPreenchidoDoJson`
- [x] `server/routers.ts` — mutations `incorporacao.saveRegistroIncorporacao`/`saveOrcamentoPreliminar`
- [x] `client/src/components/incorporacao/RegistroOrcamentoPreliminar.tsx`
- [x] Integração em `client/src/pages/admin/AdminIncorporacaoDetail.tsx` (remove o item de `FUTURE_MODULES`)
- [x] Registro do achado sobre o motor de Viabilidade Econômica ausente em `ROADMAP.md` e nova story de backlog em `EPIC.md`
- [x] Testes: `server/incorporacao-registro.test.ts`, `server/incorporacao-orcamento-preliminar.test.ts`
- [x] `tsc --noEmit`, `npm run build`, `npm test`

## File List

- `shared/incorporacao/registro-incorporacao.ts`
- `shared/incorporacao/orcamento-preliminar.ts`
- `server/routers.ts`
- `client/src/components/incorporacao/RegistroOrcamentoPreliminar.tsx`
- `client/src/pages/admin/AdminIncorporacaoDetail.tsx`
- `server/incorporacao-registro.test.ts`
- `server/incorporacao-orcamento-preliminar.test.ts`
- `docs/stories/epics/epic-008-incorporacao/EPIC.md`
- `docs/stories/epics/ROADMAP.md`

## Validation Notes (@po)

Story simples e correta, mas o achado sobre o motor de Viabilidade Econômica ausente é o item mais importante desta entrega — evita que o épico seja fechado com uma lacuna silenciosa entre "orçamento preliminar" e "VGV automático" prometido implicitamente pelas stories S-05/S-06. Registrar como nova story de backlog em vez de inventar uma versão reduzida do motor financeiro é a decisão certa dado o tamanho da peça (~1.100 linhas de referência). **Score: 9/10**.

**Verdict: GO**

## QA Results (@qa)

Code review: `resumoRegistro`/`resumoOrcamentoPreliminar` conferem com a origem. Reconciliação com o Orçamento Parametrizado usa o cálculo real (S-05), não um número fixo. Achado do EVE bem documentado e roteado corretamente como trabalho futuro, não escondido nem improvisado. Mutations restritas a admin. `tsc`/`build`/`test` limpos (170/170). **Verdict: PASS**.

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-06 | 0.1.0 | Story criada e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-06 | 1.0.0 | Implementado e validado; achado do motor de Viabilidade Econômica ausente registrado como nova story de backlog — Status: Ready → Done | @dev / @qa |
