# Etapa 3 (adapter/webhooks/integrações) — uploads e feeds do Prospecta

**Status:** Done
**Contexto:** continuação da Etapa 3 da auditoria integral Prospecta ↔ Grupo Santa
Fé — depois de fechar os achados de rotas órfãs de WhatsApp no Santa Fé (S-05/S-06),
esta sessão investigou o restante do escopo original: feeds/agregador e uploads no
Prospecta.

## Problema confirmado

`server/routes/upload-photo.ts` (rota Express pura, fora do tRPC — montada com
`app.use("/api", uploadPhotoRouter)` em `server/_core/index.ts`) **não tinha nenhuma
checagem de autenticação nem de papel**. Recebia `image` (base64), `filename` e
`projectId` direto do corpo da requisição e fazia upload para S3 sob
`construction-photos/{projectId}/...`, sem verificar sessão nem papel do usuário.

Diferente das rotas órfãs encontradas nos incrementos anteriores (S-05/S-06 do Santa
Fé), **esta rota é chamada de verdade**: `client/src/pages/AdminEditarObra.tsx` (tela
de edição de obra) faz `fetch("/api/upload-photo", ...)` diretamente. A única
proteção existente era `isAuthenticated && user?.role === "admin"` controlando se o
React Query da tela roda — **proteção 100% client-side**, contornável com uma
requisição HTTP direta (curl/Postman) sem sessão nenhuma.

**Impacto real**: qualquer requisição anônima (sem estar logado) podia fazer upload
de arquivos arbitrários (qualquer imagem base64) para o armazenamento S3 da empresa,
sob qualquer `projectId` (numérico, sem validar que o projeto existe). Isso é
diferente das rotas órfãs anteriores — aqui não é preciso nem estar autenticado no
sistema, é um endpoint público de fato.

## Correção implementada

- `server/routes/upload-photo.ts`: adicionada checagem manual de sessão (rota Express
  pura não herda `adminProcedure`/`protectedProcedure` do tRPC), reaproveitando
  exatamente o mesmo mecanismo já usado por `createContext`
  (`server/_core/context.ts`): `getTokenFromRequest` + `verifySessionToken` +
  `getUserById` + `sessaoAindaValida` (função pura já testada em
  `server/session.test.ts`). Retorna 401 se não houver sessão válida ou se o usuário
  não for `admin`.

## Outros achados desta varredura (sem ação necessária)

- **`server/_core/imovel-scraper.ts`**: já tem proteção SSRF (`isSsrfUrl`),
  espelhando fielmente `web/src/app/api/scraper/fetch/route.ts` do Grupo Santa Fé
  (confirmado no próprio comentário do arquivo). Nenhuma ação necessária.
- **`server/routes/imovel-feeds.ts`**: rotas de feed XML (`/feed/zap`, `/feed/olx`,
  `/feed/vivareal`, `/feed/chavesnamao`) — públicas por natureza (portais externos
  precisam buscar sem autenticação), retornam apenas imóveis já marcados como
  publicados no respectivo portal (`publicadoZap`, `publicadoOlx`, etc). Mesmo padrão
  do Grupo Santa Fé (`/api/feed/*`). Nenhum dado sensível exposto além do que já é
  intencionalmente público.

## Grupo Santa Fé × Prospecta

Achado específico do Prospecta — o Grupo Santa Fé não tem um fluxo equivalente de
upload de fotos de obra via rota Express pura fora do NextAuth (os uploads do Santa
Fé usam Server Actions/Route Handlers do Next.js, que sempre têm acesso a
`auth()`). Nenhuma pendência a registrar no ROADMAP do Santa Fé a partir deste
achado.

## Gates

- `npx tsc --noEmit`: zero erros.
- `npx vitest run`: 53 arquivos, **380 testes aprovados** — nenhuma regressão.
- Lint: Prospecta não tem `eslint.config.js` configurado (diferente do Santa Fé) —
  não é um gate aplicável neste repositório.
- Sem migração de banco nesta entrega.

**Não testado nesta sessão**: o fluxo real de upload de foto de obra em produção
(exigiria sessão real de admin e acesso ao bucket S3 configurado).
