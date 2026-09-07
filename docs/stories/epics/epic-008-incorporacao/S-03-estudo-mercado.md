# Story S-03 — Estudo de Mercado (Pesquisa IA, Precificação por Comparáveis, Pesquisa Primária)
**Epic:** EPIC-008
**Status:** Done
**executor:** @dev
**quality_gate:** @dev
**quality_gate_tools:** [tsc, build, test, manual-review]

## Contexto

Segundo módulo `*_json` do épico. No Grupo Santa Fé, a aba "Inteligência de Mercado" (2.2) combina três ferramentas complementares: (1) uma pesquisa da cidade + estudo de mercado imobiliário gerada por IA com busca web (perfil socioeconômico, oferta/demanda, preço médio do m² por produto, concorrentes); (2) uma precificação por comparáveis ponderados, onde o usuário atribui pesos a atributos (localização, lazer, padrão construtivo) e notas ao próprio empreendimento e a concorrentes, e a ferramenta sugere um preço/m² proporcional; (3) uma pesquisa primária de campo, um questionário de perfil aplicado a potenciais compradores, com resumo agregado (interesse de compra, tipologia preferida, itens de condomínio mais valorizados). As três alimentam as colunas `city_research_json`/`market_study_json` (IA), `comparable_pricing_json` (precificação) e `primary_research_json` (pesquisa primária), já reservadas na tabela desde a S-01.

## Decisão de re-escopo (correção de um erro de planejamento anterior, não invenção)

O `EPIC.md` descrevia originalmente a S-03 como "Estudo urbanístico e de mercado (parâmetros urbanísticos, potencial construtivo, pesquisa de mercado/primária, precificação por comparáveis)" — agrupando "urbanístico" e "mercado" numa só story por suposição, sem checar a estrutura real do Santa Fé antes de escrever o épico. Ao investigar o código de origem para implementar esta story, ficou claro que os campos `urban_parameters_json`/`potential_json`/`urbanistic_opinion` (parâmetros urbanísticos e potencial construtivo) **não têm aba própria** no Santa Fé — eles são consumidos dentro da aba "Estudo de Massa e Quadro de Áreas" (`massa-tab.tsx`/`quadro-areas-tab.tsx`), porque o potencial construtivo é insumo direto do cálculo de massa. Já "mercado" (pesquisa de cidade por IA + precificação por comparáveis + pesquisa primária) é de fato uma única aba coesa ("Inteligência de Mercado"), sem nenhuma dependência de parâmetros urbanísticos.

Para não inventar uma funcionalidade de "parâmetros urbanísticos" isolada sem propósito (ela só faz sentido junto do cálculo de massa que ainda não existe), esta story foi **re-escopada para cobrir apenas o Estudo de Mercado** (as 3 ferramentas acima). Os campos `urban_parameters_json`/`potential_json`/`urbanistic_opinion` ficam para a S-04 (Massa e Quadro de Áreas), onde pertencem de fato. `EPIC.md` e `ROADMAP.md` foram atualizados para refletir essa correção com transparência.

## Acceptance Criteria

- [x] AC-01: Pesquisa de cidade + mercado via IA (Anthropic + ferramenta nativa `web_search`, mesmo padrão já usado em EPIC-003 S-03 para laudos), com o mesmo controle de custo do Santa Fé: desativada por padrão, só executa com `INCORPORACAO_IA_ATIVA=1` no ambiente
- [x] AC-02: Precificação por comparáveis ponderados — atributos com peso editável, notas do empreendimento e de concorrentes, cálculo do preço/m² sugerido (função pura, sem I/O)
- [x] AC-03: Pesquisa primária com compradores — cadastro de entrevistados (perfil, interesse, tipologia, notas, itens de condomínio) com resumo agregado (percentuais, médias, moda, ranking de itens)
- [x] AC-04: Os três blocos gravam de forma independente (`cityResearchJson`+`marketStudyJson`, `comparablePricingJson`, `primaryResearchJson`) — nenhum sobrescreve o outro
- [x] AC-05: `tsc --noEmit`, `npm run build` e `npm test` (com testes novos para os dois cálculos puros) passam limpos

## Decisões de implementação (adaptações deliberadas, não invenção)

- **Reuso do padrão Anthropic + web_search já estabelecido**: em vez de introduzir uma nova forma de integração com IA, a pesquisa de mercado usa exatamente o mesmo cliente/modelo/formato de prompt-JSON já validado em `server/_core/avaliacao-ia.ts` (EPIC-003 S-03) — só o conteúdo do prompt muda (perfil de cidade/mercado em vez de sugestão de valor de imóvel).
- **Gate de custo replicado fielmente**: o Santa Fé desativa essa chamada de IA específica por padrão (`INCORPORACAO_IA_ATIVA !== "1"` → erro 503), diferente da sugestão de valor de avaliações (que não tem esse gate). Isso não foi inventado nem omitido — é uma decisão de negócio explícita do dono do produto original para essa função em particular (mais cara, com pesquisa web mais ampla), replicada em `server/_core/env.ts` (`incorporacaoIaAtiva`) e em `server/_core/incorporacao/mercado-ia.ts`.
- **Cálculos 100% portados**: `calcularPrecificacaoPorComparaveis` e `resumoPesquisaPrimaria` são cópias fiéis da lógica do Santa Fé (mesmas fórmulas de nota ponderada, mesmo critério de "comparável válido", mesmos percentuais/médias/moda) — nenhuma regra de negócio alterada.
- **Um único componente client em vez de três arquivos separados**: no Santa Fé são três componentes (`mercado-tab.tsx`, `precificacao-comparaveis.tsx`, `pesquisa-primaria.tsx`); no Prospecta, dado o volume menor de módulos até agora, foram consolidados em `EstudoMercado.tsx` (mesma separação lógica interna, sem mudança de comportamento).
- **Tema visual adaptado, lógica preservada**: inputs/selects usam os componentes shadcn (`Input`) e a paleta escura/dourada (`#C9A961`/`#2C3E50`) do Prospecta em vez do estilo claro do Santa Fé.
- **Somente admin**: as três novas mutations seguem `requireRole(ctx, ["admin"])`, consistente com toda a S-01/S-02.

## Validação — honestidade de status (regra do dono do produto)

**Testado automaticamente:** `tsc --noEmit` limpo, `npm run build` limpo, `npm test` (105/105 passando, 15 testes novos: `server/incorporacao-precificacao.test.ts` cobrindo validação de comparável, cálculo de preço sugerido em cenários de nota igual/maior, e listagem de comparáveis incompletos; `server/incorporacao-pesquisa-primaria.test.ts` cobrindo resumo vazio, percentuais/médias, moda de quartos, ranking de itens por importância, e detecção de pesquisa preenchida a partir do JSON salvo). Toda a lógica de cálculo (precificação ponderada, agregação da pesquisa primária) é a mesma do Santa Fé, verificada linha a linha contra o código de origem.

**Não testado de ponta a ponta:** chamada real à API Anthropic com busca web (depende de `ANTHROPIC_API_KEY` + `INCORPORACAO_IA_ATIVA=1`, nenhum dos dois configurado neste ambiente) e preenchimento real do formulário de pesquisa primária em um navegador — mesma limitação de rede do sandbox documentada em todas as stories anteriores. **Recomendação:** após o deploy, com a flag habilitada intencionalmente, rodar uma pesquisa de mercado real para uma cidade conhecida e conferir se os dados retornados fazem sentido; testar a precificação e a pesquisa primária com dados reais de um estudo em andamento.

## Tasks

- [x] `shared/incorporacao/precificacao.ts` — `calcularPrecificacaoPorComparaveis`/`comparavelValido`
- [x] `shared/incorporacao/pesquisa-primaria.ts` — `resumoPesquisaPrimaria`/`pesquisaPrimariaPreenchidaDoJson`/`ITENS_CONDOMINIO`
- [x] `server/_core/incorporacao/mercado-ia.ts` — `pesquisarMercado` (Anthropic + web_search, gate `INCORPORACAO_IA_ATIVA`)
- [x] `server/_core/env.ts` — `incorporacaoIaAtiva`
- [x] `server/routers.ts` — mutations `incorporacao.pesquisarMercado`/`savePrecificacao`/`savePesquisaPrimaria`
- [x] `client/src/components/incorporacao/EstudoMercado.tsx` — pesquisa IA + precificação por comparáveis + pesquisa primária
- [x] Integração em `client/src/pages/admin/AdminIncorporacaoDetail.tsx` (renomeia o item pendente de `FUTURE_MODULES` de "Estudo urbanístico e de mercado" para "Parâmetros urbanísticos e potencial construtivo", já que a parte de mercado está concluída)
- [x] Correção do `EPIC.md`/`ROADMAP.md` — re-escopo da S-03 (ver seção acima) e S-04 atualizada para herdar os campos urbanísticos
- [x] Testes: `server/incorporacao-precificacao.test.ts`, `server/incorporacao-pesquisa-primaria.test.ts`
- [x] `tsc --noEmit`, `npm run build`, `npm test`

## File List

- `shared/incorporacao/precificacao.ts`
- `shared/incorporacao/pesquisa-primaria.ts`
- `server/_core/incorporacao/mercado-ia.ts`
- `server/_core/env.ts`
- `server/routers.ts`
- `client/src/components/incorporacao/EstudoMercado.tsx`
- `client/src/pages/admin/AdminIncorporacaoDetail.tsx`
- `server/incorporacao-precificacao.test.ts`
- `server/incorporacao-pesquisa-primaria.test.ts`
- `docs/stories/epics/epic-008-incorporacao/EPIC.md`
- `docs/stories/epics/ROADMAP.md`

## Validation Notes (@po)

Story corrige com transparência um erro de planejamento do próprio `EPIC.md` (agrupamento indevido de "urbanístico" com "mercado"), em vez de forçar uma implementação artificial só para bater com o texto original do épico — exatamente o tipo de ajuste que a regra "No Invention" pede: melhor re-escopar e documentar do que inventar uma funcionalidade solta. As três ferramentas de mercado entregues são fiéis ao Santa Fé, com o mesmo controle de custo da chamada de IA preservado (não afrouxado nem esquecido). **Score: 8/10**.

**Verdict: GO (com validação end-to-end da IA pendente — requer habilitar a flag intencionalmente em produção)**

## QA Results (@qa)

Code review: `calcularPrecificacaoPorComparaveis` e `resumoPesquisaPrimaria` conferem fórmula a fórmula com a origem. Gate `INCORPORACAO_IA_ATIVA` replicado corretamente (erro claro quando desativado, distinto do erro de chave ausente). Mutations restritas a admin. Re-escopo da story bem justificado e documentado nos três lugares certos (`EPIC.md`, `ROADMAP.md`, e a própria story). `tsc`/`build`/`test` limpos (105/105). **Verdict: PASS** (com a ressalva de validação end-to-end da IA pendente, registrada e não escondida).

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-06 | 0.1.0 | Story criada, re-escopada para "Estudo de Mercado" após checar a estrutura real do Santa Fé, e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-06 | 1.0.0 | Implementado e validado (exceto teste end-to-end da IA, pendente por não haver `ANTHROPIC_API_KEY`/`INCORPORACAO_IA_ATIVA` configurados neste ambiente) — Status: Ready → Done | @dev / @qa |
