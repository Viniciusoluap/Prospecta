# EPIC-011 S-02 — Tornar o deploy verificável e compatível com Node 24

**Status:** InReview
**Owner:** AIOX SDC (`@sm` → `@po` → `@dev` → `@qa` → `@devops`)
**Prioridade:** P0

## História

Como responsável pela operação, quero que todo preview execute testes e typecheck antes do build e que as funções serverless sejam analisadas com seus tipos completos, para impedir que um deploy aparentemente verde esconda erros.

## Evidência

- A Vercel marcou o preview da PR #39 como `READY`, embora a etapa serverless tenha emitido erros TypeScript.
- Os tipos usados durante a análise das funções estavam somente em `devDependencies` e não chegaram completos à segunda instalação da Vercel.
- O `package.json` força Node 20; a Vercel informa que novos deploys nessa versão falharão a partir de 01/10/2026.
- Variáveis Vite ausentes chegam literalmente ao HTML (`%VITE_APP_TITLE%`), como mostra a aba do navegador no incidente de login.

## Critérios de aceitação

- [x] AC-01: o build do preview executa os testes de sessão e o typecheck antes do Vite.
- [x] AC-02: falha em teste ou typecheck interrompe o deploy.
- [x] AC-03: as funções serverless são analisadas sem os erros TypeScript observados no baseline.
- [x] AC-04: o runtime declarado é Node 24.
- [x] AC-05: título, favicon e ícone Apple possuem valores válidos mesmo sem variáveis Vite.
- [x] AC-06: o HTML não referencia um endpoint de analytics inexistente.

## File List

- `package.json`
- `pnpm-lock.yaml`
- `vercel.json`
- `tsconfig.json`
- `client/index.html`
- `server/_core/geo/kml.ts`
- `docs/stories/epics/epic-011-prontidao-operacional/S-02-gates-deploy-node24.md`

## Change Log

- 2026-09-09 — `@sm`: story criada em Draft a partir do log real do preview.
- 2026-09-09 — `@po`: validada como bloqueio P0 e movida para Ready.
- 2026-09-09 — `@dev`: implementação iniciada; Ready → InProgress.
- 2026-09-09 — `@qa`: 266 testes, typecheck, Vite e empacotamento serverless aprovados no Node 24; InProgress → InReview.
