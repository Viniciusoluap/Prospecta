# Story S-01 — Flags de Publicação + Feeds XML
**Epic:** EPIC-005
**Status:** Done
**executor:** @dev
**quality_gate:** @dev
**quality_gate_tools:** [tsc, build, vitest, manual-review]

## Contexto

O Grupo Santa Fé publica feeds XML de imóveis para os principais portais imobiliários — ZAP/VivaReal (formato `ListingDataFeed`), OLX (formato `adverts`) e Chaves na Mão (formato próprio `<imoveis>`) — filtrados pelas flags de publicação por portal do imóvel (fonte: `web/src/app/api/feed/{zap,olx,vivareal,chavesnamao}/route.ts`). As flags de publicação (`publicadoZap`, `publicadoOlx`, `publicadoViva`, `publicadoChavesNaMao`) já existem na tabela `imoveis` do Prospecta desde a EPIC-001 S-01 — esta story só precisava gerar os feeds.

## Acceptance Criteria

- [x] AC-01: Geração de XML para os 4 portais em `server/_core/imovel-feeds.ts`, com formato/campos espelhando fielmente o Santa Fé (mapas de tipo por portal, categoria OLX, CDATA nos campos de texto livre)
- [x] AC-02: Rotas Express `GET /api/feed/zap`, `/api/feed/olx`, `/api/feed/vivareal`, `/api/feed/chavesnamao`, cada uma filtrando por `publicadoSite=true` + a flag do respectivo portal
- [x] AC-03: `tsc --noEmit`, `npm run build` e `npm test` (51/51) passam limpos
- [x] AC-04: Smoke test manual da geração XML (dados fake) confirma XML bem formado e CDATA correto em campos de texto livre

## Desvios deliberados do código-fonte (documentados, não são invenção)

- Santa Fé tem campos que o Prospecta não tem (`condominio`, `iptu`, `suites`, `cep`) — os trechos condicionais desses campos foram omitidos, nunca inventados ou preenchidos com dado incorreto.
- O feed OLX do Santa Fé tem um bug próprio: hardcoded `<region name="Goiás">GO</region>` mesmo a empresa sendo de Canaã dos Carajás/PA. Não foi replicado — o Prospecta usa o campo real `estado` do imóvel (PA ou MA, as duas cidades reais de operação).
- O feed Chaves na Mão do Santa Fé tem outro bug próprio (`<cep>${p.address.street}</cep>` — usa a rua no lugar do CEP). Como o Prospecta não tem campo de CEP, a tag foi omitida em vez de replicar o bug.
- URL do site é derivada da própria requisição (`req.protocol` + `req.get("host")`) em vez de uma env var fixa — não depende de configuração manual (regra de automação do dono do produto), funciona em qualquer domínio/preview automaticamente.

## Tasks

- [x] `server/_core/imovel-feeds.ts`: `gerarFeedZap`, `gerarFeedVivaReal`, `gerarFeedOlx`, `gerarFeedChavesNaMao`
- [x] `server/routes/imovel-feeds.ts`: router Express com as 4 rotas GET, cada uma buscando via `getAllImoveis({ publicadoOnly: true })` e filtrando pela flag do portal
- [x] Registrar o router em `server/_core/index.ts` (`app.use("/api", imovelFeedsRouter)`)
- [x] `tsc --noEmit`, `npm run build`, `npm test`
- [x] Smoke test com dados fake (script `tsx -e`) confirmando XML bem formado

## File List

- `server/_core/imovel-feeds.ts`
- `server/routes/imovel-feeds.ts`
- `server/_core/index.ts`

## Validation Notes (@po)

Escopo bem definido (só geração de feed, nada de UI). FR-02 (flags de publicação) já satisfeito desde EPIC-001 S-01 — só faltava FR-01. Sem invenção: campos/formatos rastreáveis ao código real do Santa Fé, com os dois bugs identificados no código-fonte deliberadamente corrigidos em vez de replicados (documentado acima, não é desvio silencioso). Risco baixo — rotas novas, não tocam em nada existente. Dependência (EPIC-001) já satisfeita. **Score: 9/10.**

**Verdict: GO**

## QA Results (@qa)

Code review: mapas de tipo por portal conferidos contra os 4 arquivos originais do Santa Fé. Segurança: rotas públicas somente-leitura, sem dados sensíveis (mesmo padrão do Santa Fé — feeds de portal são públicos por natureza). `tsc`/`build`/`test` limpos. Smoke test confirma CDATA escapando corretamente conteúdo com caracteres especiais (`&`, `<`, `>`). **Verdict: PASS**

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-06 | 0.1.0 | Story criada e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-06 | 1.0.0 | Implementado e validado — Status: Ready → Done | @dev / @qa |
