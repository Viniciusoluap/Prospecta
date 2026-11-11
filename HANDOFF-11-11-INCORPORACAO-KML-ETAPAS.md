# Handoff — Incorporação: KML e etapas (11/11/2026)

## Concluído na branch `fix/incorporacao-kml-etapas`

- A importação KML em `server/_core/geo/kml.ts` preserva todos os polígonos. O mapa enquadra o conjunto, e as métricas usam a união dos polígonos. O perímetro mede os contornos externos e o centro, nos KMLs com vários desenhos, é ponderado pela área.
- Mapas, topografia e planta técnica aceitam polígonos simples e múltiplos. O motor de massa continua operando por área contínua e informa quando o KML tem áreas separadas.
- Os formulários de Incorporação e a API retiram Residencial como tipo selecionável. Cadastros legados conservam o tipo já gravado ao salvar outros campos.
- Em Desmembramento Simples, Projeto Aprovado sai dos cards e do cálculo de progresso. Em Vertical e Loteamento, o card de lançamento se chama Unidades à Venda.

## Testes

- (a) Checagem TypeScript, build Vite, 36 testes direcionados de KML, massa e planta e renderização React dos cards e progresso dos quatro tipos aprovados.
- (b) Chromium bloqueado pelo ambiente ao criar o socket local. A renderização dos cards foi conferida diretamente em React.
- (c) Produção: confirmar o deploy de `main` e reimportar um KML com dois polígonos no estudo de teste. O KML original de Fazenda BONITA / Impera City não foi anexado a esta tarefa.

## Pendências e próximo passo

- Os estudos que receberam apenas um polígono devem reenviar o KML original em Terreno → Trocar KML. O upload antigo persistiu apenas a geometria que conseguiu extrair.
- Paridade: o Grupo Santa Fé ainda precisa portar as quatro correções. As diferenças foram verificadas em `web/src/lib/geo/kml.ts`, `web/src/lib/incorporacao/tipo-estudo.ts` e no detalhe de Incorporação. Este lote de merge e deploy é da Prospecta.
- A alteração de massa deve integrar com o PR #199 de Vias públicas mantendo a implementação dessa tipologia.

## Compilação da API na Vercel

O deploy do PR #200 ficou READY, mas o compilador da função da API sinalizou dois diagnósticos em `flattenEach` do Turf. A leitura agora percorre `Polygon`, `MultiPolygon` e `GeometryCollection` diretamente, mantendo o comportamento validado. Conferir os logs da função no próximo deploy de produção.
