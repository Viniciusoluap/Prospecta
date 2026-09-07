# Story S-01 — Acesso, schema e isolamento por cliente

**Epic:** EPIC-002  
**Status:** Ready  
**executor:** Codex  
**quality_gate:** TypeScript, Vitest, Drizzle e revisão de segurança

## Contexto e rastreabilidade

No Santa Fé, usuários com papel `cliente` são associados a um `Lead` pelo e-mail durante a autenticação; o `leadId` resultante limita todas as consultas do portal. A Prospecta já possui os papéis alinhados pelo EPIC-009, autenticação própria e tabelas de usuários/leads, mas ainda não possui o vínculo explícito nem as entidades do portal.

Fontes: `web/src/auth.ts`, `web/src/lib/actions/leads.ts` e `web/prisma/schema.prisma` (`Lead`, `Usuario`, `Visita`, `Contrato`, `ContratoDocumento`, `ChatMensagem`).

## Acceptance Criteria

- [ ] AC-01: usuário `cliente` possui vínculo opcional e único com um lead, persistido por chave estrangeira
- [ ] AC-02: a equipe pode provisionar/atualizar acesso do cliente com senha armazenada somente como hash e sem substituir silenciosamente outra conta
- [ ] AC-03: login de cliente redireciona ao portal e usuários sem papel `cliente` não acessam as rotas do portal
- [ ] AC-04: todos os procedures do cliente derivam o escopo do vínculo existente no usuário autenticado, nunca de um `leadId` arbitrário enviado pelo navegador
- [ ] AC-05: schema contém as entidades de visitas, contratos/documentos e chat necessárias às stories seguintes

## Tasks

- [ ] Adicionar vínculo `users.leadId` e as tabelas/estados rastreados ao Santa Fé
- [ ] Criar procedure administrativo para provisionar acesso, reutilizando o hash de senha existente
- [ ] Criar middleware/guarda de papel `cliente` e redirect pós-login
- [ ] Cobrir isolamento, RBAC e colisão de e-mail com testes

## File List previsto

- `drizzle/schema.ts`
- `server/portal-router.ts`
- `server/_core/index.ts`
- `server/_core/trpc.ts`
- `client/src/components/PortalRoute.tsx`
- `client/src/pages/Login.tsx`
- `drizzle/0008_*.sql`

## Decisões

- A Prospecta vinculará a conta diretamente ao lead por FK, em vez de recalcular por e-mail a cada sessão. Isso preserva o mesmo limite de negócio e evita associação ambígua quando um e-mail de lead muda.
- O cadastro administrativo existente não será substituído pelo acesso de portal; colisões de e-mail serão recusadas.

## Change Log

| Date | Version | Change |
|------|---------|--------|
| 2026-09-07 | 0.1.0 | Story detalhada a partir da fonte Santa Fé |
