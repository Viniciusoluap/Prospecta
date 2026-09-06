# Story S-02 — Páginas Públicas de Listagem/Detalhe
**Epic:** EPIC-001
**Status:** Done
**executor:** @dev
**quality_gate:** @dev
**quality_gate_tools:** [tsc, build, test, manual-review]

## Contexto

Segunda story do EPIC-001 — consome o schema+router `imoveis` construído em S-01 para entregar as páginas públicas de catálogo, espelhando `/imoveis` (listagem com filtros) e `/imoveis/[id]` (detalhe com galeria) do Grupo Santa Fé, adaptadas à stack do Prospecta (Vite/React + wouter + tRPC) e ao padrão visual público já estabelecido em `Home.tsx`/`Produtos.tsx` (tema escuro navy `#1A2332`/dourado `#C9A961`, `Navbar`, `SEO`, sem tema claro — diferente do padrão escuro/admin usado em `AdminAvaliacoes.tsx`, que é outra paleta).

## Acceptance Criteria

- [x] AC-01: `/imoveis` — listagem de imóveis publicados (`publicadoSite`, já filtrado pelo router `imoveis.list` quando não-admin), com filtros client-side por tipo, busca textual (título/bairro/cidade), quartos mínimos e preço máximo
- [x] AC-02: `/imoveis/:slug` — detalhe com galeria (carousel shadcn/embla já disponível no projeto), specs (área/quartos/banheiros/vagas), descrição, mapa embutido (iframe Google Maps sem necessidade de API key) quando latitude/longitude existirem, e CTA de contato (WhatsApp com mensagem pré-preenchida + ligação)
- [x] AC-03: Rotas registradas em `App.tsx` (`/imoveis`, `/imoveis/:slug`) e link de navegação "Imóveis" no menu (`Navbar.tsx`)
- [x] AC-04: `tsc --noEmit`, `npm run build` e `npm test` passam limpos
- [x] AC-05: Nenhum campo inventado — UI usa exclusivamente os campos reais de `imoveis` (schema Drizzle + router `imoveis.list`/`getBySlug`), omitindo deliberadamente campos que existem no Santa Fé mas não no Prospecta (`precoNegociavel`, `condominio`, `iptu`, `suites`, `features`, `cep`)

## Decisões de implementação (adaptações deliberadas, não invenção)

- **Filtros de preço/quartos/busca**: o router `imoveis.list` do Prospecta (S-01) só aceita `status`/`tipo`/`cidade` como filtros server-side — não existe filtro por faixa de preço, quartos ou texto livre no backend. Em vez de inventar novos parâmetros no router (fora do escopo desta story), os filtros adicionais foram implementados client-side sobre a lista já publicada, adequado ao volume esperado de imóveis de um catálogo regional.
- **Rota por slug em vez de id**: o Santa Fé usa `/imoveis/[id]`; o Prospecta já expõe `imoveis.getBySlug` (S-01) e a tabela tem `slug` único — optou-se por `/imoveis/:slug` (URL mais amigável para SEO), consistente com o próprio router já existente, sem necessidade de rota adicional por id.
- **Galeria**: reaproveitado o componente `Carousel` (shadcn/embla-carousel-react) já presente em `client/src/components/ui/carousel.tsx` — não foi necessário instalar nova dependência.
- **Mapa**: em vez de replicar o `property-map-viewer.tsx` do Santa Fé (que usa uma lib de mapa dedicada não presente no Prospecta), foi usado um iframe do Google Maps em modo embed (`https://www.google.com/maps?q=lat,lng&output=embed`), que não exige chave de API nem configuração externa — consistente com a regra de automação do dono do produto (preferir soluções self-contained a exigir configuração manual em painel externo).
- **Campos omitidos**: `precoNegociavel`, `condominio`, `iptu`, `suites`, `features` e `cep` existem no modelo `Imovel` do Santa Fé mas não na tabela `imoveis` do Prospecta (confirmado em `drizzle/schema.ts`). Não foram inventados nem simulados na UI — a página de detalhe mostra apenas os campos que realmente existem (área, quartos, banheiros, vagas, endereço/bairro/cidade/estado, descrição, fotos, preço, status).

## Validação — honestidade de status (regra do dono do produto)

**Testado automaticamente:** `tsc --noEmit` limpo, `npm run build` limpo, `npm test` (69/69 passando, sem regressão), todos os campos usados na UI conferidos manualmente contra `drizzle/schema.ts` (tabela `imoveis`) e contra os schemas zod reais de `imoveis.list`/`imoveis.getBySlug` em `server/routers.ts`.

**Não testado de ponta a ponta (limitação do ambiente, já documentada em stories anteriores do EPIC-003):** o sandbox deste ambiente bloqueia tanto a conexão direta ao Neon de produção (`403 Host not in allowlist`) quanto o acesso a URLs de preview do Vercel (`net::ERR_TUNNEL_CONNECTION_FAILED`, política de rede organizacional) — confirmado em tentativas anteriores nesta mesma sessão. Não foi possível, portanto, renderizar visualmente as novas páginas neste ambiente. **Recomendação:** validar visualmente após o deploy no Vercel (onde a rede não tem essa restrição), conferindo especialmente o carousel de fotos e o embed do mapa com dados reais.

## Tasks

- [x] `client/src/pages/Imoveis.tsx` — listagem pública com filtros
- [x] `client/src/pages/ImovelDetalhes.tsx` — detalhe público com galeria/mapa/CTA
- [x] Rotas em `client/src/App.tsx` (`/imoveis`, `/imoveis/:slug`)
- [x] Link de navegação "Imóveis" em `client/src/components/Navbar.tsx`
- [x] `tsc --noEmit`, `npm run build`, `npm test`
- [x] Conferência manual de todos os campos exibidos contra o schema Drizzle e os schemas zod do router `imoveis`

## File List

- `client/src/pages/Imoveis.tsx`
- `client/src/pages/ImovelDetalhes.tsx`
- `client/src/App.tsx`
- `client/src/components/Navbar.tsx`

## Validation Notes (@po)

Escopo fiel ao FR-02 do epic (páginas públicas de listagem/detalhe). Adaptações (filtros client-side, rota por slug, mapa via iframe embed) documentadas e justificadas — nenhuma depende de configuração manual externa, consistente com a regra de automação do dono do produto. Campos inexistentes no schema do Prospecta foram corretamente omitidos, não inventados (Artigo IV — No Invention). Risco: validação visual pendente por limitação de rede do ambiente, declarado explicitamente. **Score: 8/10**.

**Verdict: GO (com validação visual pendente pós-deploy)**

## QA Results (@qa)

Code review: `trpc.imoveis.list`/`getBySlug` usados na UI batem exatamente com os procedures reais definidos em `server/routers.ts` (linha 1418+). Campos exibidos (`slug`, `titulo`, `descricao`, `tipo`, `status`, `preco`, `quartos`, `banheiros`, `vagas`, `areaM2`, `endereco`, `bairro`, `cidade`, `estado`, `latitude`, `longitude`, `fotos`) todos presentes na tabela `imoveis` (`drizzle/schema.ts`). Nenhum campo do Santa Fé sem equivalente no Prospecta foi replicado na UI. `tsc`/`build`/`test` limpos, sem regressão nas 69 suítes existentes. **Verdict: PASS** (com a ressalva de validação visual pendente, registrada e não escondida).

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-06 | 0.1.0 | Story criada e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-06 | 1.0.0 | Implementado e validado (exceto renderização visual, pendente por limitação de rede do ambiente) — Status: Ready → Done | @dev / @qa |
