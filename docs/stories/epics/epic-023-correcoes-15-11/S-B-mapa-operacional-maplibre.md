# S-B — Mapa operacional (obras) com o mapa novo (MapLibre)

Status: Draft
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
- [ ] AC1: `AdminMapa.tsx` usa o mapa novo (MapLibre) a partir de `criarMapaBase`/`aplicarBase`.
- [ ] AC2: continuam funcionando, como hoje: agrupamento dos pontos, busca, filtro de situação, legenda,
      alternância Satélite/Ruas e a tabela.
- [ ] AC3: quem tem acesso ao Mapa operacional e não tem o módulo `incorporacao` consegue carregar o mapa (a rota do
      token aceita também o módulo do mapa operacional). Quem não tem nenhum dos dois continua recebendo recusa.
- [ ] AC4: sem token configurado, o mapa mostra a mesma mensagem/fallback já usado na Incorporação, sem tela quebrada.
- [ ] AC5: `client/src/lib/mapa-leaflet.ts` só é removido se nenhum outro consumidor restar.

## Tarefas
- [ ] T1: levantar todos os recursos atuais de `AdminMapa.tsx` (lista de conferência para AC2).
- [ ] T2: trocar a base para MapLibre, reaproveitando `mapa-base-ml.ts`.
- [ ] T3: refazer agrupamento, legenda e Satélite/Ruas sobre o MapLibre.
- [ ] T4: ajustar a permissão de `GET /api/incorporacao/mapa-base`.
- [ ] T5: conferir consumidores de `mapa-leaflet.ts`; remover só se não houver.
- [ ] T6: suíte, `pnpm check`, `vite build`; HANDOFF; pendência de porte no ROADMAP.

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
_(vazio — preencher na implementação)_

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 15/11/2026 | @pm (Bob) | Story criada em Draft |
