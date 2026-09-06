# Story S-04 — Parâmetros Urbanísticos, Potencial Construtivo, Massa Generativa e Quadro de Áreas (NBR 12721)
**Epic:** EPIC-008
**Status:** Done
**executor:** @dev
**quality_gate:** @dev
**quality_gate_tools:** [tsc, build, test, manual-review]

## Contexto

Terceiro módulo `*_json` do épico (herdando os campos `urban_parameters_json`/`potential_json`/`urbanistic_opinion` que haviam sido descritos por engano na S-03 original — ver `S-03-estudo-mercado.md`). No Grupo Santa Fé, esta é a etapa "2.3 Estudo de Massa e Quadro de Áreas": (1) o usuário informa os parâmetros do Plano Diretor (taxa de ocupação, coeficiente de aproveitamento, recuos, lote mínimo, gabarito, percentuais de doação), o que calcula o potencial construtivo do terreno (área edificável, projeção máxima, área loteável líquida, lotes/unidades máximas, vagas exigidas); (2) um motor **generativo** (algoritmo genético) testa dezenas de combinações de malha viária, testada e profundidade de lote para encontrar os cenários de parcelamento que maximizam o VGV (Valor Geral de Vendas), desenhando os lotes resultantes num mapa; (3) um Quadro de Áreas no padrão NBR 12721 agrega área construída/privativa/computável por pavimento e valida contra o coeficiente de aproveitamento.

## Acceptance Criteria

- [x] AC-01: Formulário de parâmetros urbanísticos (12 campos do Plano Diretor) com cálculo automático do potencial construtivo (área edificável, projeção máxima, área loteável líquida, área de doação, lotes máximos, unidades máximas verticais opcionais, vagas exigidas) — função pura, sem I/O
- [x] AC-02: Motor generativo de massa: algoritmo genético (PRNG determinístico, reproduzível por seed) que otimiza ângulo de malha, testada, profundidade e largura de via para maximizar o VGV, com clip geométrico exato do lote à gleba (`@turf/turf`); pelo menos 2-3 cenários distintos exibidos com KPIs (lotes vendáveis, área vendável, aproveitamento, VGV)
- [x] AC-03: Mapa (Leaflet) desenhando os lotes do cenário selecionado sobre a gleba, cores distintas para lote vendável vs. área pública (doação)
- [x] AC-04: Quadro de Áreas (NBR 12721): tabela editável de pavimentos (área construída coberta/descoberta, urbanizada, a descontar, computável, privativa) com totais agregados, índice de eficiência (APV/ACC) e alerta quando a área computável excede o coeficiente de aproveitamento
- [x] AC-05: Os três blocos gravam de forma independente (`urbanParametersJson`+`potentialJson`+`urbanisticOpinion`, `massScenariosJson`+`selectedScenarioId`, `areasBoardJson`)
- [x] AC-06: `tsc --noEmit`, `npm run build` e `npm test` (com testes novos, incluindo um teste de determinismo do algoritmo genético) passam limpos

## Decisões de implementação (adaptações deliberadas, não invenção)

- **Motor generativo portado sem simplificação**: o algoritmo genético completo (projeção local equiretangular, rotação de malha, geração de lotes por frame, avaliação aproximada por amostragem de pontos durante a evolução, clip geométrico exato via `@turf/turf` `intersect` só nos vencedores, seleção por diversidade de ângulo) foi portado linha a linha do Santa Fé (`web/src/lib/geo/massa.ts`) — nenhuma etapa do pipeline foi removida ou simplificada, diferente das adaptações de escopo usadas em S-01/S-02 (que trocaram partes inteiras por alternativas mais simples). Esta é uma lógica de negócio central (otimização de VGV) que não tem substituto mais simples equivalente.
- **PRNG determinístico preservado**: o gerador `mulberry32` (mesmo do Santa Fé) garante que, dado o mesmo terreno/parâmetros/seed, os cenários gerados são idênticos — importante tanto para reprodutibilidade quanto para testabilidade (testado explicitamente).
- **Reuso do fix de import do `@turf/turf`**: assim como em `server/_core/geo/kml.ts` (S-02), os submódulos `@turf/boolean-point-in-polygon`, `@turf/intersect`, `@turf/area`, `@turf/helpers` não estão instalados individualmente — importado tudo do pacote-meta `@turf/turf`, já validado nesta trilha.
- **Consolidação de 3 componentes em 1**: no Santa Fé, urbanístico/potencial não tem aba própria (é lido dentro de `massa-tab.tsx`/`quadro-areas-tab.tsx`); no Prospecta, os três blocos (urbanismo+potencial, massa generativa, quadro de áreas) foram organizados como três seções dentro de um único `EstudoMassa.tsx`, para dar ao usuário uma visão completa do fluxo "terreno → potencial → parcelamento → quadro de áreas" em sequência, sem mudar nenhuma fórmula.
- **Mapa de massa como componente dedicado**: `MapaMassa.tsx` segue o mesmo padrão de import dinâmico do Leaflet já usado em `MapaTerreno.tsx` (S-02), evitando SSR/bundle desnecessário, com cores adaptadas ao tema do Prospecta (dourado para lote vendável, verde para doação — mesmo esquema de cores do Santa Fé, só a cor do "vendável" trocou de amarelo puro para o dourado da marca).
- **Sem o botão "Usar cenário na Viabilidade"**: o Santa Fé tem um atalho que copia o cenário de massa escolhido como mix de produtos inicial da aba de Viabilidade Econômica — essa aba ainda não existe no Prospecta (é uma story futura, S-05 em diante), então o atalho foi omitido por ora em vez de apontar para algo inexistente; o cenário salvo (`massScenariosJson`/`selectedScenarioId`) já fica disponível para quando a Viabilidade for implementada.
- **Somente admin**: as três novas mutations (`saveUrbanismo`/`saveMassa`/`saveAreasBoard`) seguem `requireRole(ctx, ["admin"])`, consistente com toda a S-01/S-02/S-03.

## Validação — honestidade de status (regra do dono do produto)

**Testado automaticamente:** `tsc --noEmit` limpo, `npm run build` limpo, `npm test` (123/123 passando, 18 testes novos: `server/incorporacao-urbanismo.test.ts` cobrindo potencial construtivo em cenários com/sem área média de unidade e o teto de 100% na fração de doação; `server/incorporacao-quadro-areas.test.ts` cobrindo soma de totais, índice de eficiência, área computável máxima e o alerta de excesso de coeficiente; `server/incorporacao-massa.test.ts` cobrindo determinismo do PRNG, área planar (shoelace), inversibilidade da projeção local, e — mais importante — que `gerarCenariosMassa` produz cenários com KPIs internamente consistentes (soma de área vendável bate com o KPI, VGV bate com área×preço) e é **determinístico** para a mesma seed, rodando o algoritmo genético completo (não mockado) sobre um terreno de teste). Toda a lógica de cálculo (potencial construtivo, quadro de áreas NBR 12721, algoritmo genético de massa) é a mesma do Santa Fé, verificada linha a linha contra o código de origem.

**Não testado de ponta a ponta:** geração de cenários sobre um terreno real (KML real carregado) em um navegador, e renderização do mapa de lotes — mesma limitação de rede/browser do sandbox documentada em todas as stories anteriores. **Recomendação:** após o deploy, gerar cenários para um terreno real conhecido e conferir visualmente no mapa se a malha de lotes faz sentido (sem sobreposições, respeitando a forma da gleba).

## Tasks

- [x] `shared/incorporacao/urbanismo.ts` — `calcularPotencial`/`PARAMETROS_DEFAULT`
- [x] `shared/incorporacao/quadro-areas.ts` — `calcularQuadroAreas`
- [x] `shared/incorporacao/massa.ts` — motor generativo completo (`gerarCenariosMassa`/`criarRng`/`criarProjecao`/`areaPlanar`)
- [x] `server/routers.ts` — mutations `incorporacao.saveUrbanismo`/`saveMassa`/`saveAreasBoard`
- [x] `client/src/components/incorporacao/MapaMassa.tsx` — mapa Leaflet dos lotes gerados
- [x] `client/src/components/incorporacao/EstudoMassa.tsx` — urbanismo+potencial, massa generativa, quadro de áreas
- [x] Integração em `client/src/pages/admin/AdminIncorporacaoDetail.tsx` (remove os dois itens correspondentes de `FUTURE_MODULES`)
- [x] Testes: `server/incorporacao-urbanismo.test.ts`, `server/incorporacao-quadro-areas.test.ts`, `server/incorporacao-massa.test.ts`
- [x] `tsc --noEmit`, `npm run build`, `npm test`

## File List

- `shared/incorporacao/urbanismo.ts`
- `shared/incorporacao/quadro-areas.ts`
- `shared/incorporacao/massa.ts`
- `server/routers.ts`
- `client/src/components/incorporacao/MapaMassa.tsx`
- `client/src/components/incorporacao/EstudoMassa.tsx`
- `client/src/pages/admin/AdminIncorporacaoDetail.tsx`
- `server/incorporacao-urbanismo.test.ts`
- `server/incorporacao-quadro-areas.test.ts`
- `server/incorporacao-massa.test.ts`

## Validation Notes (@po)

Story fecha corretamente o débito de escopo deixado pela S-03 (parâmetros urbanísticos/potencial construtivo), com a peça mais complexa do épico até agora — o motor generativo de massa — portada sem nenhuma redução de algoritmo, apenas de UI (sem o atalho para uma aba de Viabilidade que ainda não existe). O teste de determinismo do algoritmo genético é a validação mais importante desta story: garante que a otimização é reproduzível, não apenas "roda sem erro". **Score: 8/10**.

**Verdict: GO (com validação visual do mapa de lotes pendente pós-deploy)**

## QA Results (@qa)

Code review: `calcularPotencial` e `calcularQuadroAreas` conferem fórmula a fórmula com a origem, incluindo os casos-limite (doação >100%, ACC=0). O motor de massa foi revisado função a função contra `massa.ts` do Santa Fé — pipeline idêntico (projeção, rotação, geração de lotes por frame, GA, clip exato nos vencedores). Teste de determinismo roda o algoritmo genético completo (sem mocks) e confirma reprodutibilidade. Mutations restritas a admin. `tsc`/`build`/`test` limpos (123/123). **Verdict: PASS** (com a ressalva de validação visual pendente, registrada e não escondida).

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-06 | 0.1.0 | Story criada (herdando o escopo urbanístico corrigido da S-03) e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-06 | 1.0.0 | Implementado e validado (exceto teste visual do mapa de lotes com terreno real, pendente por limitação de rede/browser do ambiente) — Status: Ready → Done | @dev / @qa |
