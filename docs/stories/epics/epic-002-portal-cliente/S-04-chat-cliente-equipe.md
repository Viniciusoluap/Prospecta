# Story S-04 — Chat entre cliente e equipe

**Epic:** EPIC-002  
**Status:** Ready  
**executor:** Codex  
**quality_gate:** TypeScript, Vitest, build e revisão de autorização

## Contexto e rastreabilidade

O Santa Fé mantém mensagens por lead, identifica remetente como `cliente`, `corretor` ou `sistema`, limita o texto a 2.000 caracteres e atualiza a interface por consulta periódica. Clientes só acessam a conversa vinculada à própria sessão; a equipe seleciona o lead no painel administrativo.

Fontes: `web/src/app/portal/chat/page.tsx`, `web/src/app/api/chat/[leadId]/route.ts`, `web/src/app/admin/juridico/_components/chat-admin.tsx` e modelo `ChatMensagem`.

## Acceptance Criteria

- [ ] AC-01: cliente consulta e envia mensagens apenas na conversa do próprio lead
- [ ] AC-02: equipe consulta e responde conversas por lead com RBAC de staff
- [ ] AC-03: mensagens vazias são recusadas e textos são normalizados/limitados a 2.000 caracteres
- [ ] AC-04: interface atualiza periodicamente sem duplicar mensagens otimistas
- [ ] AC-05: tentativas de acesso cruzado são cobertas por testes

## Tasks

- [ ] Implementar procedures de listagem incremental e envio
- [ ] Implementar página de chat do portal
- [ ] Integrar painel de conversa no detalhe administrativo do lead
- [ ] Testar validação de entrada e isolamento

## Change Log

| Date | Version | Change |
|------|---------|--------|
| 2026-09-07 | 0.1.0 | Story detalhada a partir da fonte Santa Fé |
