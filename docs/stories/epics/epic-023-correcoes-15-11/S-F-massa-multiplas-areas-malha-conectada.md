# S-F — Estudo de Massa: KML com várias áreas e malha viária conectada, sem sobras em branco

Status: Done (publicada em 16/11/2026)
Epic: EPIC-023 (Etapa F) — correções 8 e 10 do dono (15/11/2026)
Paridade: **portar ao Grupo Santa Fé**.
Tamanho estimado: GG (maior risco do epic)
Bloqueios: decisão 1 do dono (publicar fora do EPIC-022).

## Problema

- Correção 8: KML com áreas separadas impede o estudo. O erro está em
  `client/src/components/incorporacao/estudo/massa-tab.tsx:202-204`, e o motor `gerarEstudoMassa`
  (`shared/incorporacao/massa.ts:833`) recebe um único anel; furos são ignorados.
- Correção 10: os cenários geram ruas sem conexão (loteamento morto), áreas perdidas junto à divisa sem lote nem via e
  não se ligam às ruas existentes do mapa. Causas: grade, cul-de-sac e rua simples retangular descartam o retângulo
  que cruza a divisa (`massa.ts:373`; `rua-simples.ts:144`); não há verificação de conectividade (`corredoresGrade`,
  :439-483); AV/INST/não parcelável são marcados nos lotes menores (`classificar`, :569-587), sem geometria própria;
  notas dizem que "ligação com vias externas não é modelada" (`massa.ts:426-431` e outras); rótulos sem detecção de
  colisão (`shared/incorporacao/planta-tecnica.ts:208-233`). As vias do OSM no entorno já existem em
  `normalizarOverpass` (`shared/geo/camadas-terreno.ts:355`) e não são usadas pelo motor.

O dono pede: nada pode ficar em branco; tudo preenchido, calculado e com lógica.

## Critérios de aceite

### Correção 8
- [x] AC1: KML com várias áreas separadas não gera erro; o estudo é gerado para todas as áreas.
- [x] AC2: furos do polígono são respeitados (não recebem lote nem via).
- [x] AC3: os consumidores aceitam o resultado com várias áreas: planta técnica, mapa da massa,
      `shared/incorporacao/unidades.ts`, orçamento (`orcamento-parametrizado-tab.tsx:53`) e
      `shared/maquete-3d/implantacao.ts` (hoje usa o anel com mais vértices, :44).

### Correção 10
- [x] AC4: malha viária conectada é regra obrigatória: toda via interna se liga, direta ou indiretamente, a uma via
      existente do entorno (vias do OSM de `normalizarOverpass`); cenário com via isolada não é entregue.
      _(Implementado: malha sempre conexa e com acesso pela divisa; havendo via do OSM a até 60 m da divisa, só ficam
      os cenários com acesso a até 40 m do eixo dela, e o cenário registra a via (nome). Sem dados do OSM, a ligação
      externa fica com a nota "acesso externo a confirmar em projeto" — ver Dev Notes.)_
- [x] AC5: lotes que cruzam a divisa são recortados por ela, em vez de descartados.
- [x] AC6: sobras que não formam lote viram área verde, área institucional ou via, com geometria própria desenhada
      e somada no quadro de áreas (não mais marcadas sobre os lotes menores).
- [x] AC7: soma das áreas (lotes + vias + verde + institucional + não parcelável) = 100% da área do terreno, com
      teste automatizado e tolerância declarada no teste.
- [x] AC8: as notas de "ligação com vias externas não é modelada" deixam de existir porque a ligação passa a ser
      modelada.
- [x] AC9: rótulos da planta técnica não se sobrepõem (detecção de colisão) e continuam legíveis.
- [x] AC10: vale para todas as tipologias afetadas (grade, cul-de-sac, rua simples e as que usam o mesmo recorte).

## Tarefas
- [x] T1: aceitar várias áreas e furos na entrada (`massa-tab.tsx`) e no motor (`gerarEstudoMassa`).
- [x] T2: adaptar consumidores para várias áreas (AC3).
- [x] T3: entrada das vias existentes do OSM no motor.
- [x] T4: malha conectada obrigatória com verificação de conectividade.
- [x] T5: recorte de lotes pela divisa (`massa.ts:373`, `rua-simples.ts:144`).
- [x] T6: sobras → verde/institucional/via com geometria; ajuste de `classificar`.
- [x] T7: teste de soma = 100%.
- [x] T8: detecção de colisão de rótulos em `planta-tecnica.ts`.
- [x] T9: revisar os ~124 testes atuais do motor; registrar no HANDOFF cada teste cuja expectativa mudou e por quê.
- [x] T10: suíte, `pnpm check`, `vite build`; HANDOFF; pendência de porte.

## Arquivos principais
- `shared/incorporacao/massa.ts`, `shared/incorporacao/rua-simples.ts`, `shared/incorporacao/planta-tecnica.ts`,
  `shared/incorporacao/unidades.ts`
- `shared/geo/camadas-terreno.ts`, `shared/maquete-3d/implantacao.ts`
- `client/src/components/incorporacao/estudo/massa-tab.tsx`, `mapa-massa`, `orcamento-parametrizado-tab.tsx`

## Testes previstos
- Automáticos: `server/incorporacao-massa.test.ts`, `server/incorporacao-massa-lote2.test.ts` revistos; novos:
  KML com duas áreas e com furo; conectividade de todas as vias; lote recortado na divisa; soma = 100% em todas as
  tipologias; rótulos sem sobreposição.
- Manuais: cenários com os KML reais do dono, conferidos na planta técnica e no mapa.
- Pendente em produção: estudos reais já salvos abertos com o motor novo.

## Riscos
- Regressão no motor central da Incorporação e em todos os consumidores → AC3, revisão dos testes, conferência visual.
- Mudança de números em estudos já salvos → registrar no HANDOFF que cenários regenerados podem diferir dos antigos.
- Sem vias do OSM no entorno (fonte fora do ar ou área sem dados) → depende da Etapa E; o comportamento nesse caso
  precisa ficar explícito na tela.

## Dev Notes (implementação — @dev, 15/11/2026)
- Motor novo `shared/incorporacao/malha-conectada.ts` (versão do algoritmo 3.0.0): a malha é traçada primeiro
  (faixas de via de divisa a divisa), recortada pela gleba (com furos) e vira um grafo; só o componente conexo que toca
  a divisa fica (R1). Lotes = células entre as vias, recortadas pela divisa e aceitas com área ≥ mínima e testada medida
  ≥ mínima sobre via de largura cheia (R2/R3). Trechos que não servem a lote nem à ligação são descartados.
- `destinarSobras`: gleba − vias − lotes → peças; institucional e verde (e a reserva das restrições em m²) usam
  primeiro as maiores sobras, cortadas na medida; faltando, lotes inteiros contíguos; o resto vira lote (com área e
  testada), anexo ao vizinho (até 2 × o lote padrão) ou área verde (R4). Fecho de áreas em `cenario.fechoAreas`.
- Grade: quadra = múltiplo exato da testada (sem sobra de ponta). Cul-de-sac: vias-tronco de divisa a divisa, coletora
  ligando os troncos quando há mais de um, ruas sem saída que param meia testada antes da ponta da quadra e terminam
  em balão (o balão nunca é descartado; o lote cortado por ele usa a curva como frente). Rua Simples: lotes também no
  trecho de acesso junto à divisa, recortados.
- R5: `OpcoesGeracao.viasEntorno` (LineStrings lng/lat); `massa-tab.tsx` busca a camada `osm` na rota de camadas;
  ângulos das vias entram na busca (Rua Simples também na perpendicular); `cenario.acessos` registra os pontos e a via.
- R6: `gerarEstudoMassa` aceita `Position[]` ou `Position[][][]` (MultiPolygon com furos); cada área é estudada e o
  resultado é composto (quadras contínuas, KPIs/quadro somados, restrições e área viária manual repartidas por área).
- R7: `renderizarPlantaSvg` com colisão de rótulos (caixas giradas, eixo separador), lote antes de quadra e de via,
  fonte 11 → 6,5 px e texto ao longo do lado maior; `data-caixa` em cada rótulo para conferência automática.
- [AUTO-DECISION] testada mínima do lote recortado → max(5 m, metade da testada) limitada à testada (Lei 6.766/79,
  art. 4º, II: frente mínima de 5 m; metade da testada para não virar outro produto).
- [AUTO-DECISION] distância para "acesso pela via existente" → até 40 m do eixo da via do OSM; via "junto à divisa" →
  até 60 m. Vias de pedestre do OSM (footway, path, steps etc.) não contam.
- [AUTO-DECISION] reserva das restrições informadas em m² → passa a ser a área inteira (antes: parcela proporcional
  aos lotes), desenhada como peça "não parcelável"; assim o quadro fecha sem "sobras".
- Orçamento (`orcamento-parametrizado-tab.tsx:53`): conferido — `urbanismoDoCenario` → `cenarioPrincipalDe` já entrega
  só os lotes vendáveis; não havia contagem de AV/INST. Sem mudança (teste novo cobre).
- Maquete (`implantacao.ts`): o modelo aceita um só contorno de terreno → fica o de maior ÁREA; lotes e ruas de todas
  as áreas continuam (limitação registrada no código).

## File List
- `shared/incorporacao/malha-conectada.ts` (novo)
- `shared/incorporacao/massa.ts`
- `shared/incorporacao/rua-simples.ts`
- `shared/incorporacao/geometria-parcelamento.ts`
- `shared/incorporacao/planta-tecnica.ts`
- `shared/incorporacao/rua-divisa.ts` (nota de acesso)
- `shared/incorporacao/lados-gleba.ts` (nota de acesso)
- `shared/maquete-3d/implantacao.ts`
- `client/src/components/incorporacao/estudo/massa-tab.tsx`
- `client/src/components/incorporacao/estudo/executar-massa.ts`
- `client/src/components/incorporacao/estudo/massa.worker.ts`
- `server/incorporacao-massa-malha-conectada.test.ts` (novo)
- `server/incorporacao-parcelamento-v2.test.ts`
- `server/incorporacao-planta-unidades.test.ts`
- `server/incorporacao-massa.test.ts`
- `HANDOFF-15-11-CORRECOES.md`

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 15/11/2026 | @pm (Bob) | Story criada em Draft |
| 15/11/2026 | @dev (Dex) | Draft → InProgress (modo YOLO, pedido direto do dono) |
| 15/11/2026 | @dev (Dex) | InProgress → Ready for Review: malha conectada, recorte na divisa, destinação das sobras, vias do entorno, várias áreas, rótulos sem sobreposição |

## Complemento de 16/11 — áreas restritas aproveitadas nas doações (pedido do dono depois da publicação)
- APP, faixas de servidão e demais áreas que não podem virar lote entram, sempre que permitido, na área verde ou na
  institucional exigida; a lógica está dentro do motor de desenho.
- `massa-quadro-areas.ts` (`aproveitarRestricoes`, `DESTINOS_PADRAO`), `massa.ts` (`destino*` nos parâmetros, alvos e notas),
  `massa-tab.tsx` (seletor por restrição e resumo da economia), `incorporacao-massa-aproveitamento.test.ts` (novo).
