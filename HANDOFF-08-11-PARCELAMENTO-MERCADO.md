# HANDOFF 08/11 — Prompt mestre: parcelamento, desenho técnico, mercado, unidades e negociação

Branch: `claude/intelligent-ptolemy-av0qoh` (Prospecta). Checkpoint inicial recuperável:
tag local `checkpoint/pre-parcelamento-20261108` = `61362b1` (main na época, árvore limpa).
Escopo: só Prospecta (o prompt proíbe alterar outros repositórios). Paridade com o Santa Fé
fica **sinalizada** aqui e no relatório — não foi portada.

## Estado por correção

| # | Correção | Estado |
|---|----------|--------|
| 01 | Parâmetros exatos + área viária manual + quadro | ✅ motor + UI |
| 02 | Determinismo + 3 cenários por critério + mensagens | ✅ motor + UI (seed `Date.now()` removida) |
| 03 | Rua Simples | ✅ motor + UI |
| 04 | Desenho técnico universal | ✅ (etapa 2) |
| 05 | Quantidade dinâmica | ✅ motor + testes |
| 06 | Mercado: 2 motores independentes | ⏳ pendente |
| 07 | Unidades: ordenação numérica + paginação 6 | ✅ (etapa 3) |
| 08 | Negociação: excluir proposta + permuta % VGV | ✅ (etapa 3) |

## Etapa 1 — motor de parcelamento v2 (concluída)

Causas encontradas (auditoria):
- **Aleatoriedade**: `massa-tab.tsx` chamava o motor com `seed: Date.now() % 100000` → cada clique, um resultado.
- **Parâmetros alterados**: o algoritmo genético buscava `testada ∈ [t, 2,2t]`, `profundidade ∈ [0,7p, 1,4p]`
  e `via ∈ [v, 1,4v]` — por isso 20 × 250 virava 20,3 × 273,3 e via de 3 m virava 4 m+.
- **Lotes irregulares**: o desenho final recortava lotes pela gleba e aceitava até 60% da área nominal.
- **Contagem ≠ desenho**: a busca avaliava por amostragem de 5 pontos; o desenho usava recorte exato.
- **Viário fictício**: o quadro chamava de "sistema viário" todo o resto (vias + sobras).
- **Lote sem acesso**: lotes na borda podiam ficar de frente para via fora da gleba.

Arquivos:
- `shared/incorporacao/geometria-parcelamento.ts` (novo): índice espacial de arestas, teste exato
  "retângulo dentro da poligonal" (côncava inclusive), ponto-no-polígono indexado, validação de
  poligonal (auto-interseção, fechamento, área nula), envelope girado.
- `shared/incorporacao/rua-simples.ts` (novo): tipologia Rua Simples (via reta única de mão dupla,
  lotes dos dois lados, trecho de acesso a partir da divisa, sem balão) + varredura determinística.
- `shared/incorporacao/massa.ts` (reescrito, mesma API pública): `gerarEstudoMassa` (novo, retorna
  cenários + inviabilidade com causas) e `gerarCenariosMassa` (compatível). Grade e Cul-de-sac
  preservados (mesma lógica de quadras/balões), agora com lotes exatos, exigência de via em frente
  ao lote e corredores viários desenhados. Busca determinística (ângulos das arestas + a cada 10°,
  refino ±5° e fases da malha). Seleção: 1) maior área vendável, 2) melhor eficiência viária
  (≥75% da melhor área), 3) alternativa distinta; equivalentes descartados. `VERSAO_ALGORITMO_MASSA`
  e `assinaturaEntradas` (cache/auditoria). Modo manual da área viária (Rua Simples define o
  comprimento da via; Grade/Cul-de-sac aceitam só se a área desenhada bater ±5%, senão divergência).
- `shared/incorporacao/massa-quadro-areas.ts`: viário geométrico opcional + `sobrasM2` (legado intacto).

Testes (a) automáticos:
- `server/incorporacao-parcelamento-v2.test.ts` — 33 testes ✅ (dimensões exatas nas 3 tipologias,
  sem sobreposição/fora da gleba, via de 3 m, incompatibilidade de área mínima, quadro fechando e
  área das ruas recalculada de forma independente, **10 execuções idênticas** por tipologia
  (JSON idêntico — tolerância efetiva zero; documentada 1e-4 m / 0,01 m²), Morada sintética = 29,
  mesma geometria via KML (`parseKmlTerreno`) = 29, geometria menor = 20 (não força 29),
  quantidade dinâmica 8/14/30/60/100, área viária manual ok/divergente/negativa/acima da área).
- Regressão: `incorporacao-massa*.test.ts` 46 ✅ (1 asserção ajustada: identidade agora inclui sobras).
- Suíte completa antes da correção do índice: 1467/1468 (a falha era o bug do índice, corrigido).
- Benchmark 100 ha / 200 vértices: grade ~3,3 s, cul-de-sac ~5,4 s, rua simples ~7,6 s (Node).

Pendente de validação (c): **KML real do Morada do Bosque não está no repositório** — os 29 lotes
foram verificados só em geometria sintética com os mesmos parâmetros. Validar com o KML real.

## Etapa 2 — UI do Estudo de Massa + desenho técnico (concluída)

Arquivos:
- `shared/incorporacao/planta-tecnica.ts` (novo): renderizador SVG puro (perímetro, vias, quadras,
  todos os lotes, número/área/dimensões conforme zoom, largura das vias, área viária total, áreas
  públicas, legenda, escala gráfica, norte, seleção + destaque da quadra). Mesma projeção do motor.
- `client/.../planta-tecnica.tsx` (novo): zoom (roda, botões, pinça), pan, seleção, exportar SVG, imprimir.
- `client/.../massa.worker.ts` + `executar-massa.ts` (novos): motor em Web Worker, progresso real,
  um cálculo por vez; fallback para a thread principal.
- `client/.../massa-tab.tsx`: Rua Simples, "Área do sistema viário (m²)" automático/manual, cache por
  assinatura (sem recálculo para entradas idênticas), cartões só com cenários válidos e com o critério,
  motivo + causas da inviabilidade, alternância **Desenho técnico** (padrão) / **Satélite** (mapa antigo).
- `client/.../mapa-massa.tsx`: tooltip das vias genérico (agora inclui corredores).
- `shared/incorporacao/unidades.ts`: `formatarCodigoLote`, `codigoExibicao`, `compararCodigoUnidade`
  (numérico), `paginar` (6/página). O código persistido "Q1 / L1" NÃO muda (identidade comercial).
- Correção no cul-de-sac: a rua sem saída chega até o balão (antes o balão ficava solto).

Testes:
- (a) `server/incorporacao-planta-unidades.test.ts` 10 ✅ (SVG desenha exatamente os lotes e vias do
  cenário nas 3 tipologias; rótulos por zoom; seleção; zoom ancorado; ordenação; paginação; unidades
  da Rua Simples Q01/L01…Q02/L14). Conjunto massa + v2 + planta + unidades: 96 ✅. `tsc` limpo.
  `vite build` ✅ (worker 75,8 kB).
- (b) Manual por mim: SVG renderizado no Chromium (Playwright) e inspecionado nas 3 tipologias;
  bundle de produção do worker executado no Chromium (29 lotes, progresso recebido).
- (c) Pendente em produção: a tela completa logada (não há login/banco nesta sessão); teste em tablet real.

## Etapa 3 — Unidades à Venda e Negociação do Terreno (concluída)

Unidades (`client/.../unidades-tab.tsx`): ordenação numérica real (`compararCodigoUnidade`), exibição
`Q01 / L01` (código persistido e chave comercial inalterados → vendas, reservas, histórico e vínculos
preservados; nada foi renumerado no banco), 6 por página em 2 colunas × 3 linhas, setas
anterior/próxima com "Página X / Y", desabilitadas nas pontas, filtro por status preservado, página
reajustada após inclusão/exclusão.

Negociação:
- Causa do "R$ 0,00": o VGV vinha só das premissas salvas da Viabilidade; sem elas virava 0 e era
  exibido como cálculo concluído. A "proposta atual" era sempre a mais recente (uma enviada posterior
  escondia a aceita).
- `shared/incorporacao/negociacao.ts`: `resolverVgvBruto` (Viabilidade › cenário escolhido do Estudo de
  Massa › manual legado), `calcularPermutaFinanceira` (centavos em BigInt, %, até 4 casas),
  `estimarProposta` ("Cálculo pendente — VGV não disponível"), `resumoNegociacaoV2` (aceita, mais
  recente e selecionada separadas; referência = selecionada › aceita › mais recente),
  `excluirProposta` (só a proposta indicada; aceita exige confirmação reforçada; auditoria
  `historicoExclusoes` no próprio JSON — sem migração), `mesclarNegociacaoParaGravar`.
  Tipo **misto** agora estima dinheiro + permuta financeira (antes só o valor em dinheiro).
- `server/routers.ts`: `excluirPropostaNegociacao` (nova) e `saveNegociacaoTerreno` com mescla
  protetora (nunca apaga auditoria nem ressuscita proposta excluída).
- Tela: botão **Excluir proposta** por proposta (confirmação; aceita pede digitar EXCLUIR),
  "Usar como atual", KPI "Valor estimado — proposta atual" com pendência explícita, quadro de
  aceita/mais recente/referência, lista de exclusões auditadas.

Testes (a): `server/incorporacao-negociacao.test.ts` 21 ✅ (9 legados + 12 novos). `tsc` limpo.
(c) Pendente em produção: exclusão real contra o banco (rota nova) e a tela logada.

## Próximo passo exato
Etapa 4: Mercado com dois motores independentes — `server/_core/incorporacao/` (IBGE gratuito +
análise de anúncios com IA isolada por provedor), rotas tRPC separadas, dois botões em `mercado-tab.tsx`.
