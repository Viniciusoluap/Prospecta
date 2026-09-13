# Checkpoint — Etapa 6 (parte de código): migração de RBAC legado

**Data:** 13/09/2026
**Status:** Concluída após validação local (TypeScript, testes, build)
**Escopo:** S-09 — migrar routers ainda gated apenas por `STAFF_ROLES` para o modelo de
permissão granular por módulo introduzido na Etapa 3

## Entregas

| Frente | Resultado |
|---|---|
| RBAC | `bpo`, `bancario`, `avaliacoes`, `agregador` (`server/routers.ts`) e `whatsapp` (`server/whatsapp-router.ts`) migrados de `protectedProcedure` + `requireRole(ctx, STAFF_ROLES)` para `adminProcedure`, respeitando a permissão de módulo já cadastrada por usuário |
| Limpeza | Removida checagem redundante `requireRole(ctx, STAFF_ROLES)` dentro de `portal.admin.*`, que já usava `adminProcedure` desde etapa anterior |
| Testes | Novo `server/rbac-legacy-migration.test.ts` (12 testes): colaborador/corretor sem a permissão do módulo são barrados, com a permissão são liberados; admin sempre acessa; cliente nunca acessa |
| Dados | Nenhuma migration — mudança restrita à camada de autorização tRPC |

## Por que isso importa

Antes desta correção, um colaborador cadastrado **sem** a permissão "bpo" (por exemplo)
ainda conseguia listar clientes e lançamentos do BPO Financeiro, porque a checagem antiga
(`STAFF_ROLES`) só validava o papel (admin/corretor/colaborador), não o módulo concedido.
Isso esvaziava, na prática, o propósito do catálogo de permissões granulares anunciado
desde a Etapa 3 para os módulos afetados (`bpo`, `banco`, `avaliacoes`, `agregador`,
`whatsapp`). A migração fecha essa lacuna sem alterar nenhuma regra de negócio: apenas
passa a exigir a permissão de módulo já existente no cadastro do usuário.

## O que deliberadamente não mudou

Procedures que já eram restritas a `admin` (ou a `admin`+`corretor` por regra de negócio
específica, como a conexão própria de WhatsApp) permanecem exatamente como estavam —
detalhado em `S-09-rbac-legado-granular.md`, seção "Decisões de implementação".

## Situação após esta entrega

- P0 (Etapa 3), P2 (Etapa 5) e o hardening de RBAC legado (S-09) estão concluídos;
- P1 (Agenda, Corretores/Comissões, Projetos, Mapa) segue com o Codex na Etapa 4 (PR #45,
  aberto, ainda não mesclado no momento deste checkpoint);
- UAT completo por papel/dispositivo em produção continua pendente (S-08, Etapa 6);
- credenciais e integrações reais (Asaas, Pluggy, WhatsApp, Anthropic) continuam na Etapa 7.

## Evidências de encerramento

- TypeScript aprovado (`npx tsc --noEmit`, zero erros);
- Vitest: 48 arquivos e 297 testes aprovados (12 novos desta entrega);
- build Vite e bundle do servidor (`esbuild`) aprovados;
- `git diff --check` aprovado, sem erros de espaço em branco;
- sem migration a validar ou aplicar.

A inspeção visual em navegador real e o UAT autenticado por papel não foram possíveis
nesta sessão (sandbox sem acesso à internet externa), mesma limitação já registrada nas
etapas anteriores — permanecem escopo de S-08.
