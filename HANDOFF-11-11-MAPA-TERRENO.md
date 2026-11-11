# HANDOFF 11/11 — Mapa do terreno (MapLibre + camadas no servidor)

Branch: `claude/sync-mirrored-repos-bsqnz3` (Prospecta e Grupo Santa Fé).

## Etapa 1 — Prospecta (concluída)
- Investigação: `docs/handoffs/mapa/INVESTIGACAO-MOTOR.md` (concorrente = Mapbox GL JS 3.16; fontes por camada).
- Núcleo puro: `shared/geo/camadas-terreno.ts` (fontes, normalização, APP/vegetação/servidão/UC/geologia/furos, zoom nativo Esri).
- Busca no servidor: `server/_core/geo/camadas-terreno-busca.ts` (cache 12 h, timeout por fonte, espelhos, resposta parcial).
- Rota Express: `server/routes/camadas-terreno.ts` (`POST /api/incorporacao/camadas-terreno`, `GET /api/incorporacao/mapa-base`) montada em `api/index.ts` e `server/_core/index.ts`.
- Mapbox opcional: `shared/geo/mapbox-token.ts`, `server/_core/geo/mapbox-config.ts` (dashboard_settings `segredo.mapbox_token`, criptografado), procedures `integracoes.statusMapbox/testarMapbox/salvarMapbox/removerMapbox`, card `client/src/components/admin/MapboxCard.tsx`.
- Mapa: `client/src/components/incorporacao/estudo/mapa-terreno.tsx` reescrito em MapLibre GL (dep. `maplibre-gl@^5.24.1`); `camadas-base.ts` (Leaflet, Estudo de Massa) passa a usar o zoom nativo real da Esri.

## Etapa 2 — Grupo Santa Fé: em andamento (ver HANDOFF do Santa Fé)
