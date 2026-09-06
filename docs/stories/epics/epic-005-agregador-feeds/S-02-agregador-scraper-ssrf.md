# Story S-02 — Agregador/Scraper com Proteção SSRF
**Epic:** EPIC-005
**Status:** Done
**executor:** @dev
**quality_gate:** @dev
**quality_gate_tools:** [tsc, drizzle-kit, build, vitest, manual-review]

## Contexto

O Grupo Santa Fé tem um agregador que raspa metadados (título/descrição/imagens/preço via tags OpenGraph) de anúncios de imóveis em portais externos (OLX, ZAP, VivaReal) ou redes sociais (Facebook/Instagram), permitindo que o corretor cole a URL de um anúncio para pré-preencher um cadastro de "imóvel captado" em staging (`AgregadorImovel`) — que passa por verificação manual antes de, opcionalmente, ser importado como rascunho não publicado para o catálogo real (`Imovel`). O scraper busca a URL fornecida pelo usuário, o que é uma superfície clássica de SSRF (Server-Side Request Forgery) — por isso o Santa Fé tem uma checagem dedicada (`isSsrfUrl`) que bloqueia URLs apontando para endereços internos/privados antes de qualquer fetch.

Fontes: `web/src/lib/ssrf.ts`, `web/src/app/api/scraper/fetch/route.ts`, `web/prisma/schema.prisma` (`model AgregadorImovel`), `web/src/lib/types/agregador.ts`, `web/src/lib/actions/agregador.ts`.

## Acceptance Criteria

- [x] AC-01: `shared/ssrf.ts` — `isSsrfUrl`, idêntica ao Santa Fé (bloqueia localhost/127.x/10.x/192.168.x/172.16-31.x/169.254.x/IPv6 loopback/protocolos não-http(s)/URL inválida)
- [x] AC-02: Tabela `agregador_imoveis` no Drizzle, com os mesmos campos do `AgregadorImovel` do Santa Fé (título/descrição/preço/área/tipo/endereço/fonte/imagens/status/documentação/contato/notas)
- [x] AC-03: `server/_core/imovel-scraper.ts` — `scrapeUrl` extrai metadados OpenGraph/Twitter Card (título, descrição, imagens, preço) da URL, com timeout de 10s e checagem SSRF **antes** do fetch
- [x] AC-04: Router `agregador` com `scrape` (roda o scraper), `list`/`getById` (staging), `create` (cadastro manual ou a partir do scrape), `updateStatus` (pendente/verificado/arquivado), `importarParaCatalogo` (cria um `Imovel` rascunho não publicado a partir do item do agregador, marca status `importado`)
- [x] AC-05: `tsc --noEmit`, `npm run build` e `npm test` (69/69, incluindo 18 novos testes de `isSsrfUrl`) passam limpos
- [x] AC-06: Migration aplicada em produção — `agregador_imoveis` vazia, confirmado

## Desvios deliberados do código-fonte

- Status real usado no Santa Fé é `pendente | verificado | arquivado | importado` (o arquivo de tipos documenta só 3, mas o código de `importarParaCatalogo` usa um 4º — `importado` — não documentado). O enum do Prospecta inclui os 4 valores realmente usados, sem inventar nenhum a mais.
- `importarParaCatalogo` só pode ser chamado por `admin` (mais restritivo que `scrape`/`list`/`create`/`updateStatus`, que aceitam também `corretor`/`colaborador`) — criar um registro real no catálogo público é uma ação mais sensível que gerenciar o staging.

## Tasks

- [x] `shared/ssrf.ts` + `server/ssrf.test.ts` (18 testes, portados do Santa Fé)
- [x] `agregadorFonteEnum`, `agregadorStatusEnum`, `agregadorDocumentoTipoEnum`, tabela `agregadorImoveis` em `drizzle/schema.ts`
- [x] `pnpm add cheerio@^1.2.0`
- [x] `server/_core/imovel-scraper.ts`: `scrapeUrl`, `detectSource`
- [x] Funções em `server/db.ts`: `getAllAgregadorImoveis`, `getAgregadorImovelById`, `createAgregadorImovel`, `updateAgregadorImovel`, `importarAgregadorParaCatalogo`
- [x] Router `agregador` em `server/routers.ts`: `scrape`, `list`, `getById`, `create`, `updateStatus`, `importarParaCatalogo`
- [x] `drizzle-kit generate` (`0005_create_agregador_imoveis.sql`)
- [x] `tsc --noEmit`, `npm run build`, `npm test`
- [x] Aplicar migration em produção + registrar em `drizzle.__drizzle_migrations`

## File List

- `shared/ssrf.ts`
- `server/ssrf.test.ts`
- `drizzle/schema.ts`
- `drizzle/0005_create_agregador_imoveis.sql`
- `server/_core/imovel-scraper.ts`
- `server/db.ts`
- `server/routers.ts`
- `package.json` / `pnpm-lock.yaml` (nova dependência `cheerio`)

## Validation Notes (@po)

Escopo bem definido: staging + scraper + importação, sem UI (fica pra próxima story, se o épico ganhar uma — não há S-03 planejada, mas segue o padrão do resto da trilha de deferir UI). Segurança é o ponto central da story — a proteção SSRF foi portada e testada com 18 casos (incluindo os limites exatos dos ranges CIDR: 172.16 bloqueado, 172.32 liberado). Sem invenção: schema, enum de status (com o valor `importado` corrigido/completado a partir do código real, não do arquivo de tipos incompleto) e lógica de scraping todos rastreáveis ao Santa Fé. Risco médio pelo fato de ser uma feature que faz requisições HTTP server-side para URLs de terceiros — mitigado pela checagem SSRF antes de qualquer fetch e timeout de 10s. **Score: 8/10.**

**Verdict: GO**

## QA Results (@qa)

Code review: `isSsrfUrl` idêntica byte a byte à do Santa Fé. `scrapeUrl` chama `isSsrfUrl` antes do `fetch` (ordem crítica verificada) e nunca deixa a URL alcançar a rede se for privada/inválida. Timeout de 10s (`AbortSignal.timeout`) evita requisições penduradas. Roles: staging (scrape/list/create/updateStatus) abertos a admin/corretor/colaborador; importação pro catálogo restrita a admin. `tsc`/`build`/`test` limpos (69/69, incluindo os 18 testes SSRF cobrindo bloqueio e liberação corretos nos limites de cada range). Migration aplicada e conferida em produção. **Verdict: PASS**

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-06 | 0.1.0 | Story criada e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-06 | 1.0.0 | Implementado, validado e aplicado em produção — Status: Ready → Done | @dev / @qa |
