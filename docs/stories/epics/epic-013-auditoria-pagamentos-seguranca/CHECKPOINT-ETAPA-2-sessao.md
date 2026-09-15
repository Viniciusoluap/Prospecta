# Checkpoint — Etapa 2 (Prospecta): redefinição de senha não revoga sessões existentes

**Data:** 15/09/2026
**Branch:** `codex/auditoria-correcao-20260914`
**Status:** Código corrigido, testado, gates aprovados, migração validada e aplicada em
produção.

## Contexto — por que isso apareceu no Prospecta

Este item não estava no escopo original planejado para esta sessão no Prospecta —
surgiu ao investigar, no Grupo Santa Fé, o item "password reset session revocation" do
handoff. Antes de portar a correção para lá, a regra de paridade obrigatória
(`Prospecta/CLAUDE.md`) exige verificar se o mesmo problema existe aqui. Verificado
diretamente no código (não assumido por analogia):

- `server/_core/auth-utils.ts`: sessão via JWT stateless (`jsonwebtoken`, `expiresIn:
  "30d"`) — mesma classe de mecanismo do Santa Fé (lá é NextAuth JWT; aqui é
  `jwt.sign`/`jwt.verify` manual), sem qualquer versão/estado de revogação.
- `server/configuracoes-router.ts`, `resetPassword` (adminProcedure): atualizava
  `passwordHash` sem invalidar nenhuma sessão já emitida para o usuário.
- `server/portal-router.ts`, `admin.provisionAccess`: mesmo padrão — reprovisiona
  e-mail/senha de um cliente do portal (branch `existing`) sem invalidar a sessão
  anterior.
- Achado adicional: **dois pontos de login emitem token** (`server/_core/index.ts`,
  usado em produção com servidor Node persistente; `api/index.ts`, o espelho para o
  ambiente serverless da Vercel) — os dois precisavam do mesmo fix.

Diferente do que se poderia supor, `server/_core/context.ts` (`createContext`) **já**
recarregava o usuário do banco por ID em toda requisição tRPC e já rejeitava usuários
com `active = false` — ou seja, a revogação por desativação de conta já funcionava. O
gap real era estritamente sobre redefinição/reprovisionamento de senha.

## Correção implementada

- **`drizzle/schema.ts`**: `users.sessionVersion integer default(0) notNull` — contador
  incrementado a cada evento que deve invalidar sessões existentes. Nenhuma coluna
  existente alterada.
- **`shared/session.ts`** (novo, função pura testável sem banco):
  `sessaoAindaValida(usuarioAtual, sessionVersionDoToken)` — `false` se o usuário não
  existe, está inativo, ou a versão diverge.
- **`server/_core/auth-utils.ts`**: `createSessionToken` agora recebe e embute
  `sessionVersion` no payload do JWT; `verifySessionToken` devolve `sessionVersion`
  (`?? 0` para tokens antigos emitidos antes desta mudança, evitando deslogar todo
  mundo no dia do deploy).
- **`server/_core/context.ts`**: `createContext` agora chama `sessaoAindaValida` com o
  usuário recarregado do banco e a versão do token; se inválida, trata como não
  autenticado (mesmo efeito de logout).
- **`server/_core/index.ts`** e **`api/index.ts`** (os dois pontos reais de login):
  `createSessionToken(user.id, user.name, user.sessionVersion)`.
- **`server/configuracoes-router.ts`**, `resetPassword`: incrementa `sessionVersion`
  (`sql`${users.sessionVersion} + 1``) na mesma escrita que troca o hash da senha.
- **`server/portal-router.ts`**, `admin.provisionAccess` (branch `existing`): mesmo
  incremento ao reprovisionar credenciais de um cliente já existente.

## Migração — validada e aplicada

- Aplicada via `mcp__Neon__run_sql` diretamente contra a branch de produção
  (`br-steep-leaf-anxdjv1p`, projeto `plain-cake-26372935`) — `ALTER TABLE "users" ADD
  COLUMN "sessionVersion" integer DEFAULT 0 NOT NULL;`. Puramente aditiva.
- Confirmado via `information_schema.columns` que a coluna existe (`integer`, default
  `0`, `NOT NULL`) em produção.
- `drizzle/0017_etapa2_session_version.sql` gerado pela ferramenta oficial
  (`drizzle-kit generate`, com `DATABASE_URL` fictício só para satisfazer a checagem do
  `drizzle.config.ts` — `generate` não conecta ao banco, apenas faz diff do schema
  contra os snapshots existentes) — confirmado que contém **apenas** o `ALTER TABLE`
  aditivo, nenhuma tabela existente recriada ou alterada.
- Bookkeeping do Drizzle (`drizzle.__drizzle_migrations`) não foi tocado nesta entrega
  — mesma limitação já documentada no checkpoint da Etapa 1 (sem `DATABASE_URL` real
  neste sandbox para rodar `drizzle-kit migrate`).

## Gates (evidência)

- `npx tsc --noEmit`: **zero erros** (revelou os dois call sites de
  `createSessionToken` que precisavam do terceiro argumento — `server/_core/index.ts`
  e `api/index.ts` — ambos corrigidos).
- `npx vitest run`: **53 arquivos, 380 testes aprovados** (7 novos: 5 em
  `server/session.test.ts` cobrindo `sessaoAindaValida`, 2 em
  `server/auth-session.test.ts` cobrindo o round-trip create/verify do token e a
  normalização de um token legado sem o claim `sessionVersion`).
- `npm run build` (Vite + esbuild do servidor): **aprovado**. Alerta de bundle >500KB é
  pré-existente (não relacionado a esta entrega).
- `git diff --check`: aprovado.
- Sem script de lint configurado neste projeto (`package.json` não tem `"lint"`) — não
  é uma lacuna desta entrega, é o estado já documentado do repositório.

**Não testado nesta sessão:** fluxo de login/reset-de-senha de ponta a ponta em um
navegador real (exigiria o servidor rodando com banco real, indisponível neste
sandbox). A lógica de decisão está coberta por teste unitário e a integração foi
revisada linha a linha contra os dois pontos de emissão de token reais.

## Grupo Santa Fé × Prospecta

Esta correção é a contraparte Prospecta do item "password reset session revocation"
implementado em paralelo no Grupo Santa Fé
(`Grupo-Santa-Fe/web/docs/stories/epics/epic-006-auditoria-rbac-seguranca/S-03-revogacao-sessao.md`).
Descoberta ao aplicar a regra de paridade obrigatória antes de portar a correção — não
estava listada nos "BLOQUEADORES CONFIRMADOS NA PROSPECTA" do handoff original, mas é a
mesma classe de vulnerabilidade, confirmada por leitura direta do código dos dois
repositórios (JWT stateless sem versão de sessão em ambos).
