# Story S-10 — Lançamento Imobiliário e Mix de Produtos
**Epic:** EPIC-008
**Status:** Done
**executor:** @dev
**quality_gate:** @dev
**quality_gate_tools:** [tsc, build, test, manual-review]

## Contexto

Décimo-terceiro e décimo-quarto módulos `*_json` do épico. "Mix de Produtos" define os produtos do empreendimento (lotes, casas, apartamentos, comercial) com quantidade, área por unidade e preço/m², agregando total de unidades, área vendida e VGV (Valor Geral de Vendas) projetado. "Lançamento Imobiliário" registra as vendas realizadas no evento de lançamento e as compara automaticamente ao total projetado no Mix de Produtos (percentual de unidades e de VGV já vendidos).

## Decisão de escopo (extração pontual de um trecho pequeno e autônomo de um arquivo maior, não invenção)

O cálculo do mix de produtos (`calcularMix`) vive, no Santa Fé, dentro de `lib/finance/loteamento.ts` — o mesmo arquivo que contém o motor completo de Viabilidade Econômica/loteamento urbanístico (que a S-08 já registrou como ausente do plano original, ver S-13 no backlog). Só o `calcularMix` foi extraído para esta story porque é uma função pura, pequena (~10 linhas) e genuinamente independente do resto do arquivo — soma quantidade × área × preço por item, nada mais. As demais partes de `loteamento.ts` (premissas urbanísticas, curva de vendas indexada, EVE) continuam de fora, reservadas para a S-13 completa. Isso não é uma reimplementação do motor de Viabilidade — é usar hoje o pedaço que já é útil e autônomo, deixando o resto para quando a story maior for feita.

## Acceptance Criteria

- [x] AC-01: Mix de Produtos — cadastro de produtos (nome, quantidade, área/unidade, preço/m²) com cálculo automático de área total e VGV por item, e agregados (total de unidades, área vendida, VGV total, preço médio por unidade)
- [x] AC-02: Lançamento Imobiliário — cadastro de vendas realizadas (unidade, comprador, valor, data) comparado automaticamente ao total de unidades/VGV do Mix de Produtos (percentual vendido de cada um)
- [x] AC-03: Os dois blocos gravam de forma independente (`productMixJson`, `realEstateLaunchJson`)
- [x] AC-04: `tsc --noEmit`, `npm run build` e `npm test` (com testes novos) passam limpos

## Decisões de implementação (adaptações deliberadas, não invenção)

- **`calcularMix` 100% portado**: mesma fórmula (área total = quantidade × área/unidade; VGV = área total × preço/m²), mesmos agregados.
- **`resumoLancamentoImobiliario` 100% portado**: mesmos percentuais (unidades vendidas / total projetado; VGV vendido / VGV projetado), mesmo tratamento de projeção ausente (retorna `null`, não zero, para distinguir "sem dado" de "zero vendido").
- **Estado do mix compartilhado entre os dois cards no client**: como o Lançamento Imobiliário depende do resultado do Mix de Produtos, o componente `LancamentoImobiliario.tsx` mantém o mix atual em estado local no componente pai e o passa para ambos os cards — evita duplicar o parsing de `productMixJson` e mantém a projeção sempre sincronizada com o que está na tela (mesmo antes de salvar).
- **Somente admin**: as duas novas mutations (`saveMixProdutos`/`saveLancamentoImobiliario`) seguem `requireRole(ctx, ["admin"])`.

## Validação — honestidade de status (regra do dono do produto)

**Testado automaticamente:** `tsc --noEmit` limpo, `npm run build` limpo, `npm test` (194/194 passando, 11 testes novos: `server/incorporacao-mix-produtos.test.ts` cobrindo área/VGV por item, agregados, preço médio e o parser de preenchimento; `server/incorporacao-lancamento-imobiliario.test.ts` cobrindo contagem/soma de vendas e percentuais com e sem projeção). Toda a lógica é a mesma do Santa Fé.

**Não testado de ponta a ponta:** preenchimento real dos formulários em um navegador — mesma limitação de sandbox documentada em todas as stories anteriores.

## Tasks

- [x] `shared/incorporacao/mix-produtos.ts` — `calcularMix`/`mixProdutosPreenchidoDoJson` (extraído de `lib/finance/loteamento.ts`)
- [x] `shared/incorporacao/lancamento-imobiliario.ts` — `resumoLancamentoImobiliario`/`lancamentoImobiliarioComVendasDoJson`
- [x] `server/routers.ts` — mutations `incorporacao.saveMixProdutos`/`saveLancamentoImobiliario`
- [x] `client/src/components/incorporacao/LancamentoImobiliario.tsx` — os dois cards com estado de mix compartilhado
- [x] Integração em `client/src/pages/admin/AdminIncorporacaoDetail.tsx` (remove o item de `FUTURE_MODULES`)
- [x] Testes: `server/incorporacao-mix-produtos.test.ts`, `server/incorporacao-lancamento-imobiliario.test.ts`
- [x] `tsc --noEmit`, `npm run build`, `npm test`

## File List

- `shared/incorporacao/mix-produtos.ts`
- `shared/incorporacao/lancamento-imobiliario.ts`
- `server/routers.ts`
- `client/src/components/incorporacao/LancamentoImobiliario.tsx`
- `client/src/pages/admin/AdminIncorporacaoDetail.tsx`
- `server/incorporacao-mix-produtos.test.ts`
- `server/incorporacao-lancamento-imobiliario.test.ts`

## Validation Notes (@po)

Story usa bem o critério de "extrair só o que é autônomo" em vez de portar o arquivo `loteamento.ts` inteiro ou reinventar uma versão simplificada da Viabilidade Econômica — mesma disciplina já aplicada nas adaptações de S-05/S-06/S-08. **Score: 8/10**.

**Verdict: GO**

## QA Results (@qa)

Code review: `calcularMix` e `resumoLancamentoImobiliario` conferem fórmula a fórmula com a origem. Estado do mix compartilhado no client evita inconsistência entre os dois cards. Mutations restritas a admin. `tsc`/`build`/`test` limpos (194/194). **Verdict: PASS**.

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-06 | 0.1.0 | Story criada e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-06 | 1.0.0 | Implementado e validado — Status: Ready → Done | @dev / @qa |
