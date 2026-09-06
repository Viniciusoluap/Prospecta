# Story S-03 — CRUD Admin de Imóveis
**Epic:** EPIC-001
**Status:** Done
**executor:** @dev
**quality_gate:** @dev
**quality_gate_tools:** [tsc, build, test, manual-review]

## Contexto

Terceira e última story do EPIC-001 — fecha o épico com a interface administrativa de cadastro/edição de imóveis, espelhando `/admin/imoveis`, `/admin/imoveis/novo` e `/admin/imoveis/[id]/editar` do Grupo Santa Fé (upload de fotos, seletor de localização, campos de valor/características, flags de publicação), adaptada à stack do Prospecta e ao padrão visual admin escuro/dourado já usado em `AdminCorretores.tsx`/`AdminAvaliacoes.tsx`.

## Acceptance Criteria

- [x] AC-01: `/admin/imoveis` — tabela de imóveis (todos, incluindo não publicados, via `adminView: true`) com busca por título/bairro/tipo, filtro por situação, e ações (ver no site, editar, marcar como vendido/despublicar)
- [x] AC-02: `/admin/imoveis/novo` e `/admin/imoveis/:id/editar` — formulário completo (dados básicos, valores, características, fotos, localização, flags de publicação/feeds, descrição), usando o mesmo componente `AdminImovelForm`
- [x] AC-03: Rotas registradas em `App.tsx` e link de navegação "Imóveis" em `Admin.tsx`
- [x] AC-04: `tsc --noEmit`, `npm run build` e `npm test` passam limpos
- [x] AC-05: Nenhum campo inventado — formulário usa exclusivamente os campos reais de `imoveis.create`/`imoveis.update` (schemas zod em `server/routers.ts`)

## Decisões de implementação (adaptações deliberadas, não invenção)

- **Sem exclusão real**: o router `imoveis` (S-01) não expõe um procedure de `delete` — só `create`/`update`. Em vez de inventar um endpoint de exclusão fora do escopo desta story, a ação "excluir" foi substituída por "marcar como vendido e despublicar" (`status: "vendido"`, `publicadoSite: false`), reaproveitando `imoveis.update` já existente. Reversível pelo próprio formulário de edição.
- **Fotos**: mesma abordagem de compressão client-side (canvas, JPEG 82%, máx. 1200px) e armazenamento como base64 inline em `fotos` (JSON), replicando o padrão do `foto-upload.tsx` do Santa Fé — sem exigir Blob Store externo, consistente com a regra de automação do dono do produto.
- **Localização**: o Santa Fé usa um mapa interativo (Leaflet + OpenStreetMap) para marcar a posição por clique. Para esta story, optou-se por manter apenas o campo de "colar link/coordenadas do Google Maps" (mesma lógica de parsing por regex do original), sem embutir um mapa clicável — evita adicionar uma nova dependência (Leaflet não está presente no Prospecta) para um CRUD que já tem escopo amplo; a extração automática de coordenadas a partir de um link colado já elimina o passo manual mais custoso (não é preciso digitar lat/lng manualmente). O mapa de visualização (somente leitura) já existe na página pública de detalhe (S-02).
- **Tipo do imóvel**: a coluna `tipo` é texto livre no schema do Prospecta (não é enum), mas o formulário usa um `Select` com a mesma lista de tipos do Santa Fé (casa/apartamento/lote/terreno/comercial/chácara) para manter consistência de dados sem impor uma constraint de banco nova.
- **Sem `corretorId`**: a tabela `imoveis` do Prospecta não tem relação com corretor (diferente do Santa Fé) — campo "Corretor Responsável" do formulário original foi omitido, não inventado.
- **Slug**: gerado automaticamente a partir do título (com normalização de acentos) e editável antes de salvar; erros de unicidade (`slug` é `unique` no schema) são reportados via toast a partir do erro real do tRPC, sem validação client-side antecipada de duplicidade.

## Validação — honestidade de status (regra do dono do produto)

**Testado automaticamente:** `tsc --noEmit` limpo, `npm run build` limpo, `npm test` (69/69 passando, sem regressão), todos os campos do formulário conferidos manualmente contra os schemas zod reais de `imoveis.create`/`imoveis.update`/`imoveis.list`/`imoveis.getById` em `server/routers.ts`.

**Não testado de ponta a ponta (limitação de ambiente já documentada nas stories anteriores):** sandbox bloqueia conexão direta ao Neon de produção e acesso a URLs de preview do Vercel. Não foi possível renderizar visualmente o formulário nem testar upload de fotos reais neste ambiente. **Recomendação:** validar visualmente após o deploy, especialmente o fluxo de criação (geração de slug, compressão de fotos, parsing de coordenadas coladas) e o de edição (hidratação correta dos valores existentes).

## Tasks

- [x] `client/src/pages/admin/AdminImoveis.tsx` — listagem admin com busca/filtro/ações
- [x] `client/src/pages/admin/AdminImovelForm.tsx` — formulário compartilhado (criar/editar)
- [x] Rotas em `client/src/App.tsx` (`/admin/imoveis`, `/admin/imoveis/novo`, `/admin/imoveis/:id/editar`)
- [x] Link de navegação "Imóveis" em `client/src/pages/Admin.tsx`
- [x] `tsc --noEmit`, `npm run build`, `npm test`
- [x] Conferência manual de todos os campos do formulário contra os schemas zod do router `imoveis`

## File List

- `client/src/pages/admin/AdminImoveis.tsx`
- `client/src/pages/admin/AdminImovelForm.tsx`
- `client/src/App.tsx`
- `client/src/pages/Admin.tsx`

## Validation Notes (@po)

Fecha o EPIC-001 com a última story planejada (FR-03 do epic). Escopo fiel ao original, com adaptações justificadas (sem exclusão real — reaproveita update; sem mapa clicável — mantém parsing de coordenadas; tipo como texto livre com Select guiado). Nenhum campo inventado — todos conferidos contra o router real. Risco: validação visual pendente por limitação de rede do ambiente, declarado explicitamente, consistente com todas as stories anteriores deste épico. **Score: 8/10**.

**Verdict: GO (com validação visual pendente pós-deploy)**

## QA Results (@qa)

Code review: `trpc.imoveis.create`/`update`/`list`/`getById` usados na UI batem exatamente com os procedures reais definidos em `server/routers.ts` (linha 1418+). Payload de criação/edição usa somente campos presentes no schema Drizzle `imoveis`. Ação de "excluir" corretamente implementada como atualização de status (nenhum endpoint de delete foi inventado). `tsc`/`build`/`test` limpos, sem regressão nas 69 suítes existentes. **Verdict: PASS** (com a ressalva de validação visual pendente, registrada e não escondida).

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-06 | 0.1.0 | Story criada e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-06 | 1.0.0 | Implementado e validado (exceto renderização visual, pendente por limitação de rede do ambiente) — Status: Ready → Done | @dev / @qa |
