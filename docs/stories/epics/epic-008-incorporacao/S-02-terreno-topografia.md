# Story S-02 — Terreno e Geometria (KML, Área/Perímetro, APP, Topografia)
**Epic:** EPIC-008
**Status:** Done
**executor:** @dev
**quality_gate:** @dev
**quality_gate_tools:** [tsc, build, test, manual-review]

## Contexto

Primeiro módulo `*_json` do épico (coluna `geojson`/`area_m2`/`perimeter_m`/`elevation_json` da tabela `incorporation_studies`, já reservadas desde a S-01). No Grupo Santa Fé, o fluxo é: o usuário envia um KML do terreno (exportado do Google Earth), o sistema extrai o polígono, calcula área/perímetro/centro, desenha em um mapa interativo (Leaflet, sobre imagem de satélite Esri) com camadas de água/vias/rede elétrica (Overpass/OSM) para apoiar o cálculo de Área de Preservação Permanente (APP) conforme o Código Florestal (Lei 12.651/2012, Art. 4º), e opcionalmente busca um modelo de elevação (DEM) do terreno para visualizar declividade/topografia. Esta story porta esse fluxo para o Prospecta, mantendo a lógica de negócio e as fontes de dados idênticas ao Santa Fé (nenhuma regra de cálculo geométrico ou de largura de APP foi inventada), com duas adaptações deliberadas de escopo (detalhadas abaixo) para não introduzir dependências pesadas desnecessárias.

## Acceptance Criteria

- [x] AC-01: Upload de arquivo `.kml` no admin do estudo; o servidor extrai o primeiro polígono (`@tmcw/togeojson` + `@xmldom/xmldom`), calcula área (m²), perímetro (m) e centro (`@turf/turf`), e grava em `geojson`/`area_m2`/`perimeter_m`/`latitude`/`longitude`
- [x] AC-02: Mapa interativo (Leaflet) exibindo o polígono do terreno sobre imagem de satélite (Esri World Imagery) com opção de trocar para mapa Stamen; toggle de camadas de água, vias e rede elétrica (Overpass API, OpenStreetMap, sem chave)
- [x] AC-03: Cálculo de Área de Preservação Permanente (APP) sobre corpos d'água identificados, aplicando a largura mínima por Código Florestal (Art. 4º: <10m→30m, 10–50m→50m, 50–200m→100m, 200–600m→200m, >600m→500m), com resultado (m²) gravável no estudo
- [x] AC-04: Geração de topografia a partir do bounding box do terreno (DEM), com estatísticas de cota mínima/máxima/desnível e declividade média + distribuição por faixas (plano/leve/moderado/íngreme/inviável, mesmas faixas do Santa Fé)
- [x] AC-05: `tsc --noEmit`, `npm run build` e `npm test` (com testes novos para a lógica geométrica pura) passam limpos

## Decisões de implementação (adaptações deliberadas, não invenção)

- **Reaproveitamento de colunas existentes para o centro do terreno**: o modelo Prisma do Santa Fé (`EstudoIncorporacao`) tem campos dedicados `centroLat`/`centroLng`; a tabela `incorporation_studies` em produção não os tem (confirmado via `information_schema.columns` na S-01). Em vez de propor uma migration nova para dois campos que duplicariam informação, o centróide calculado do KML é gravado nas colunas `latitude`/`longitude` já existentes — sem invenção de schema, sem perda de funcionalidade.
- **Sem viewer 3D de topografia**: o Santa Fé renderiza a topografia como uma superfície 3D interativa (Three.js). Esta story entrega o mesmo dado (grade de elevação, estatísticas, distribuição de declividade) via um mapa de calor 2D em `<canvas>` (gradiente azul→verde→amarelo→marrom, igual à legenda de cores do Santa Fé) — mesma informação útil ao usuário (onde o terreno é mais alto/baixo/íngreme), sem adicionar uma biblioteca gráfica 3D nova ao projeto. Documentado explicitamente na própria UI ("Visualização simplificada em 2D — sem viewer 3D interativo, para não depender de uma biblioteca gráfica pesada nova."), seguindo o mesmo padrão de transparência já usado para o seletor de mapa da EPIC-001 S-03 e a galeria da EPIC-002.
- **Mesmas fontes de dados externas, mesma prioridade**: elevação usa OpenTopography COP30 (Copernicus, requer `OPENTOPOGRAPHY_API_KEY`, opcional) como fonte primária e Open Topo Data SRTM 30m (sem chave) como fallback — réplica exata da lógica do Santa Fé, incluindo o formato de resposta (AAIGrid ASCII) e o parsing. Água/vias/rede elétrica continuam via Overpass API (OpenStreetMap), sem chave, igual ao Santa Fé.
- **Cálculo de APP idêntico ao Código Florestal**: a função de largura mínima por faixa de largura do curso d'água (`larguraAppCodigoFlorestal`) foi portada linha a linha do Santa Fé — nenhuma faixa foi alterada, adicionada ou removida.
- **Tema visual adaptado, lógica preservada**: cores do mapa/seletor trocadas do amarelo do Santa Fé para o dourado (`#C9A961`) do tema do Prospecta; cantos arredondados e paleta escura (`#2C3E50`) consistentes com o restante do admin do Prospecta. Nenhuma mudança de comportamento.
- **Somente admin**: mutations `uploadKml`/`fetchElevation`/`saveApp` seguem o mesmo `requireRole(ctx, ["admin"])` já estabelecido na S-01 para todo o router `incorporacao`.

## Validação — honestidade de status (regra do dono do produto)

**Testado automaticamente:** `tsc --noEmit` limpo, `npm run build` limpo (Leaflet corretamente isolado em chunk separado via import dinâmico, 149.76 kB), `npm test` (90/90 passando, 15 testes novos: `server/geo-kml.test.ts`, `server/geo-relevo.test.ts`, `server/geo-elevacao.test.ts`, cobrindo parsing de KML válido/inválido, cálculo de declividade em terreno plano e em rampa, distribuição por faixas somando 100%, conversão de graus para metros por latitude, e parsing de grade AAIGrid incluindo substituição de NODATA). Toda a lógica geométrica pura (área/perímetro/centro do KML, largura de APP por Código Florestal, declividade por diferenças centrais) é a mesma do Santa Fé, verificada campo a campo contra o código de origem.

**Não testado de ponta a ponta:** upload real de um arquivo `.kml`, chamadas reais às APIs Overpass/OpenTopography/Open Topo Data, e renderização do mapa Leaflet em um navegador — mesma limitação de rede do sandbox documentada em todas as stories anteriores (sem egress para APIs externas nem acesso a uma URL de preview publicada a partir deste ambiente). **Recomendação:** após o deploy, testar com um KML real de um terreno conhecido, conferir se a área calculada bate com a esperada, gerar a topografia e confirmar que o heatmap e a distribuição de declividade fazem sentido visualmente.

## Tasks

- [x] `server/_core/geo/kml.ts` — `parseKmlTerreno` (KML → polígono/área/perímetro/centro)
- [x] `server/_core/geo/elevacao.ts` — `fetchElevationGrid`/`parseAAIGrid` (OpenTopography COP30 + fallback Open Topo Data)
- [x] `shared/geo/relevo.ts` — `declividadeGrade`/`declividadeMedia`/`distribuicaoDeclividade`/`celulaEmMetros`/`FAIXAS_DECLIVIDADE`
- [x] `server/_core/env.ts` — `openTopographyApiKey` (opcional)
- [x] `server/routers.ts` — mutations `incorporacao.uploadKml`/`fetchElevation`/`saveApp`
- [x] `client/src/components/incorporacao/MapaTerreno.tsx` — mapa Leaflet, camadas Overpass, cálculo/gravação de APP
- [x] `client/src/components/incorporacao/TerrenoTopografia.tsx` — upload de KML, métricas, heatmap 2D de elevação, distribuição de declividade
- [x] Integração em `client/src/pages/admin/AdminIncorporacaoDetail.tsx` (remove "Terreno e geometria" de `FUTURE_MODULES`)
- [x] Dependências: `@tmcw/togeojson`, `@xmldom/xmldom`, `@turf/turf`, `leaflet`, `@types/leaflet`, `@types/geojson`
- [x] Testes: `server/geo-kml.test.ts`, `server/geo-relevo.test.ts`, `server/geo-elevacao.test.ts`
- [x] `tsc --noEmit`, `npm run build`, `npm test`

## File List

- `server/_core/geo/kml.ts`
- `server/_core/geo/elevacao.ts`
- `shared/geo/relevo.ts`
- `server/_core/env.ts`
- `server/routers.ts`
- `client/src/components/incorporacao/MapaTerreno.tsx`
- `client/src/components/incorporacao/TerrenoTopografia.tsx`
- `client/src/pages/admin/AdminIncorporacaoDetail.tsx`
- `server/geo-kml.test.ts`
- `server/geo-relevo.test.ts`
- `server/geo-elevacao.test.ts`
- `package.json`, `pnpm-lock.yaml`

## Validation Notes (@po)

Primeiro módulo de negócio real do épico, com a lógica de cálculo geométrico e de APP replicada fielmente do Santa Fé (nenhuma fórmula do Código Florestal inventada ou alterada). As duas reduções de escopo (reaproveitar `latitude`/`longitude` em vez de novas colunas; heatmap 2D em vez de viewer 3D) preservam o valor de negócio e estão documentadas com transparência, sem fingir paridade total onde não há. Cobertura de teste nova para toda a lógica pura introduzida. **Score: 8/10**.

**Verdict: GO (com validação end-to-end pendente pós-deploy)**

## QA Results (@qa)

Code review: parsing de KML rejeita corretamente arquivos sem polígono (erro claro) e XML inválido; cálculo de declividade correto em caso trivial (terreno plano → zero) e em rampa (gradiente positivo); distribuição de declividade sempre soma 100% das células; parsing de AAIGrid trata `NODATA_value` corretamente e falha com mensagem clara em cabeçalho inválido. Router restrito a admin, consistente com S-01. `tsc`/`build`/`test` limpos (90/90). **Verdict: PASS** (com a ressalva de validação end-to-end pendente, registrada e não escondida).

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-06 | 0.1.0 | Story criada e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-06 | 1.0.0 | Implementado e validado (exceto teste end-to-end com KML real, pendente por limitação de rede do ambiente) — Status: Ready → Done | @dev / @qa |
