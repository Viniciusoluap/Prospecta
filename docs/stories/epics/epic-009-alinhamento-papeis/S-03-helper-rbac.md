# Story S-03 — Helper de RBAC Reutilizável
**Epic:** EPIC-009
**Status:** Done
**executor:** @dev
**quality_gate:** @dev
**quality_gate_tools:** [tsc, build, test]

## Contexto

Fecha a pendência real do EPIC-009: a FR-02 original ("Helper de RBAC equivalente ao do Santa Fé — `hasRole`, guarda de rota/procedure por papel — reutilizável nos routers tRPC") nunca foi implementada. A S-02 registrada anteriormente resolveu um problema diferente (fixes de migration encontrados por review externo), não essa. Até esta story, cada procedure repetia inline `ctx.user.role !== "admin" && ctx.user.role !== "corretor" && ...` — funcionava corretamente, mas violava DRY e divergia do padrão do Santa Fé (`src/lib/auth/rbac.ts`).

## Acceptance Criteria

- [x] AC-01: `server/_core/rbac.ts` — `hasRole(role, allowed)`, `requireRole(ctx, allowed, message?)` (lança `TRPCError({ code: "FORBIDDEN" })` quando o papel não está na lista) e `STAFF_ROLES` (`admin|corretor|colaborador`, o grupo mais repetido)
- [x] AC-02: Todas as checagens inline puras de papel em `server/routers.ts` substituídas por `requireRole(ctx, [...])`, preservando exatamente o mesmo comportamento (mesmos papéis permitidos, mesma mensagem de erro onde já existia)
- [x] AC-03: Testes unitários para `hasRole`/`requireRole` (`server/rbac.test.ts`)
- [x] AC-04: `tsc --noEmit`, `npm run build` e `npm test` passam limpos, sem regressão

## Decisões de implementação (adaptações deliberadas, não invenção)

- **Checagens de propriedade não foram tocadas**: padrões como `project.userId !== ctx.user.id && ctx.user.role !== "admin"` (dono do recurso OU admin) são uma regra de negócio diferente de uma guarda de papel pura — não é RBAC simples, é "dono ou admin". Substituir isso por `requireRole` mudaria a semântica (perderia a exceção de dono). Ficaram como estavam, fora do escopo desta story.
- **Sem guarda equivalente no client**: o Santa Fé tem `requirePageRole` no lado do servidor (Next.js Server Components) porque as páginas são renderizadas no servidor. No Prospecta (Vite/SPA), a barreira real de segurança já é o router tRPC (`requireRole`, agora centralizado) — os componentes `AdminRoute`/`ProtectedRoute` do client são apenas UX (evitar mostrar uma tela que o backend vai rejeitar). Não existe hoje nenhuma tela que precise diferenciar corretor de colaborador no client (FR-03 exige não quebrar nada existente) — criar esse guard agora seria antecipar um requisito que ainda não existe. Se/quando uma tela precisar, o helper do servidor já dá o modelo a seguir.
- **Substituição mecânica e verificada**: a troca dos ~50 pontos de checagem inline por `requireRole(...)` foi feita por busca-e-substituição em três padrões sintáticos idênticos e repetidos (bloco `admin`-only com mensagem, checagem `admin`-only de uma linha, bloco `admin|corretor|colaborador`) — não é uma reescrita manual arriscada; `tsc`/`build`/`test` confirmam que o comportamento não mudou.

## Validação — honestidade de status (regra do dono do produto)

**Testado automaticamente:** `tsc --noEmit` limpo, `npm run build` limpo, `npm test` (75/75 passando — 69 pré-existentes + 6 novos para o helper, sem regressão). Todos os ~50 pontos de substituição conferidos via grep antes e depois para garantir que nenhuma checagem de propriedade foi alterada por engano.

**Não testado de ponta a ponta:** não foi possível testar em ambiente rodando (mesma limitação de rede do sandbox documentada em todas as stories anteriores) que um usuário `corretor` real ainda consegue acessar `avaliacoes`/`agregador` e que um `cliente` continua bloqueado — o comportamento é logicamente idêntico ao anterior (mesma lista de papéis, mesmo código de erro), mas recomenda-se um teste de fumaça pós-deploy com um usuário de cada papel.

## Tasks

- [x] `server/_core/rbac.ts` — `hasRole`/`requireRole`/`STAFF_ROLES`
- [x] Substituir checagens inline em `server/routers.ts` (import + ~50 call sites)
- [x] `server/rbac.test.ts` — testes unitários
- [x] `tsc --noEmit`, `npm run build`, `npm test`

## File List

- `server/_core/rbac.ts`
- `server/rbac.test.ts`
- `server/routers.ts`

## Validation Notes (@po)

Fecha a pendência real da FR-02, sem inventar escopo além do pedido (guarda de client explicitamente justificada como desnecessária hoje, não esquecida). Refatoração mecânica e de baixo risco, com verificação antes/depois via grep e suíte de testes crescendo (69→75) sem quebrar nada. **Score: 9/10**.

**Verdict: GO**

## QA Results (@qa)

Code review: os três padrões de substituição batem exatamente com o inventário de checagens inline levantado antes da mudança (grep confirma zero checagens de papel puro remanescentes, e os 8 pontos de "dono ou admin" continuam intactos). `requireRole` preserva a mensagem "Acesso negado" nos casos que já a tinham. Testes novos cobrem os casos de permitir, negar, papel indefinido e mensagem customizada. `tsc`/`build`/`test` limpos. **Verdict: PASS**.

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-06 | 0.1.0 | Story criada e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-06 | 1.0.0 | Implementado e validado — Status: Ready → Done | @dev / @qa |
