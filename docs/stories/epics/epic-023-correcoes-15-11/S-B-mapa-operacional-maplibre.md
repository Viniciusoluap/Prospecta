# S-B — Mapa operacional (obras) com o mapa novo (MapLibre)

Status: Done (publicada em 15/11/2026)
Epic: EPIC-023 (Etapa B) — correção 4 do dono (15/11/2026)
Paridade: **portar ao Grupo Santa Fé**.
Tamanho estimado: M
Bloqueios: decisão 1 do dono (publicar fora do EPIC-022).

## Problema

O Mapa operacional (`client/src/pages/admin/AdminMapa.tsx`) ainda usa Leaflet (`client/src/lib/mapa-leaflet.ts`),
enquanto a Incorporação já usa o mapa novo em MapLibre (`client/src/components/incorporacao/estudo/mapa-base-ml.ts`,
`criarMapaBase`/`aplicarBase`). O token do mapa novo vem de `GET /api/incorporacao/mapa-base`
(`server/routes/camadas-terreno.ts:41-51`), que hoje exige o módulo `incorporacao`.

## Critérios de aceite
- [x] AC1: `AdminMapa.tsx` usa o mapa novo (MapLibre) a partir de `criarMapaBase`/`aplicarBase`.
- [x] AC2: continuam funcionando, como hoje: agrupamento dos pontos, busca, filtro de situação, legenda,
      alternância Satélite/Ruas e a tabela.
- [x] AC3: quem tem acesso ao Mapa operacional e não tem o módulo `incorporacao` consegue carregar o mapa (a rota do
      token aceita também o módulo do mapa operacional). Quem não tem nenhum dos dois continua recebendo recusa.
- [x] AC4: sem token configurado, o mapa mostra a mesma mensagem/fallback já usado na Incorporação, sem tela quebrada.
- [x] AC5: `client/src/lib/mapa-leaflet.ts` só é removido se nenhum outro consumidor restar.

## Tarefas
- [x] T1: levantar todos os recursos atuais de `AdminMapa.tsx` (lista de conferência para AC2).
- [x] T2: trocar a base para MapLibre, reaproveitando `mapa-base-ml.ts`.
- [x] T3: refazer agrupamento, legenda e Satélite/Ruas sobre o MapLibre.
- [x] T4: ajustar a permissão de `GET /api/incorporacao/mapa-base`.
- [x] T5: conferir consumidores de `mapa-leaflet.ts`; remover só se não houver.
- [x] T6: suíte, `pnpm check`, `vite build`; HANDOFF; pendência de porte no ROADMAP.

## Arquivos principais
- `client/src/pages/admin/AdminMapa.tsx`, `client/src/lib/mapa-leaflet.ts`
- `client/src/components/incorporacao/estudo/mapa-base-ml.ts`
- `server/routes/camadas-terreno.ts`

## Testes previstos
- Automáticos: `server/mapa-operacional.test.ts` mantido; teste novo da permissão da rota do token (com módulo do
  mapa operacional, com `incorporacao`, sem nenhum).
- Manuais: mapa no navegador e no iPad — agrupamento, busca, filtro, legenda, Satélite/Ruas, tabela.
- Pendente em produção: carregamento com o token real.

## Riscos
- Abrir o token para perfis indevidos → AC3 com teste de recusa.
- Perder algum recurso do Leaflet na troca → lista de conferência da T1.

## File List
- `client/src/pages/admin/AdminMapa.tsx` — mapa em MapLibre sobre `mapa-base-ml.ts`; alfinetes, agrupamento, lista para pontos no mesmo endereço, Satélite/Ruas.
- `shared/mapa-alfinetes.ts` — `limitesDosPontos` (enquadramento).
- `server/routes/camadas-terreno.ts` — token do mapa base liberado também para o módulo `mapa`.
- `client/src/main.tsx` — estilo do Leaflet removido. Removido: `client/src/lib/mapa-leaflet.ts`.
- Teste: `server/mapa-alfinetes.test.ts`.

## Notas da implementação
- `mapa-base-ml.ts` ficou onde estava (é importado pela tela do mapa); não houve necessidade de mover.
- O "leque" do Leaflet não existe no MapLibre: grupo de pontos no mesmo endereço abre uma lista com todos.
- Os pacotes `leaflet` e `leaflet.markercluster` continuam no `package.json`, sem uso; a remoção fica para uma limpeza futura.

_(vazio — preencher na implementação)_

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 15/11/2026 | @pm (Bob) | Story criada em Draft |
