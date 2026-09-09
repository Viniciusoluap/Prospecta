# EPIC-011 S-01 — Corrigir persistência da sessão em produção

**Status:** InProgress
**Owner:** AIOX SDC (`@sm` → `@po` → `@dev` → `@qa`)
**Prioridade:** P0

## História

Como administrador da Prospecta, quero que o login por email e senha mantenha a sessão e abra o painel administrativo, para conseguir operar o sistema em produção.

## Evidência do incidente

- Em 09/09/2026, o login de `vinicius@vfxcapital.com.br` retornou HTTP 200 na Vercel.
- A consulta subsequente `auth.me` também retornou HTTP 200, mas a interface voltou para `/login`.
- O usuário existe no banco de produção, possui papel `admin` e senha cadastrada.
- O backend usa cookie `session`, enquanto partes legadas usam `app_session_id`.
- O cookie foi configurado como `SameSite=None`, política desnecessária para chamadas same-origin e mais frágil em Safari/proxies.
- A tela usa navegação SPA seguida imediatamente de `window.location.reload()`.

## Critérios de aceitação

- [ ] AC-01: login e leitura de sessão usam o mesmo nome canônico de cookie.
- [ ] AC-02: cookie de autenticação usa política same-origin compatível com Safari e continua seguro em produção.
- [ ] AC-03: login bem-sucedido faz navegação única para `/admin`, `/portal` ou `/`, conforme o papel.
- [ ] AC-04: rotas protegidas sem sessão redirecionam para `/login`, sem dependência do OAuth legado Manus.
- [ ] AC-05: logout remove o mesmo cookie criado pelo login.
- [ ] AC-06: testes automatizados cobrem nome, flags de produção/proxy e ambiente local.
- [ ] AC-07: typecheck, testes e build passam.
- [ ] AC-08: após deploy, login real e `auth.me` autenticado são validados no domínio de produção.

## Fora de escopo

- Alteração de senha do usuário.
- Mudança de provedor de autenticação.
- Alteração do banco de produção.
- PR #7, encerrada e removida do plano.

## Riscos e rollback

- A troca do nome canônico invalida cookies antigos; o efeito esperado é exigir um novo login.
- Rollback: reverter o commit desta story. Nenhuma migration é necessária.

## File List

- `server/_core/auth-utils.ts`
- `server/_core/cookies.ts`
- `client/src/pages/Login.tsx`
- `client/src/components/ProtectedRoute.tsx`
- `server/auth-session.test.ts`
- `docs/stories/epics/epic-011-prontidao-operacional/S-01-login-sessao-producao.md`

## Change Log

- 2026-09-09 — `@sm`: story criada em Draft a partir do incidente real.
- 2026-09-09 — `@po`: validada GO (10/10) e movida para Ready.
- 2026-09-09 — `@dev`: implementação iniciada; Ready → InProgress.
