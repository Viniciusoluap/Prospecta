# Checkpoint — GRUPO projetos-aprovacao (correção 07, AD-07)

## Status
- [x] Leitura: aba Projeto Aprovado (ambos), Projetos (operacional-router/AdminProjetos; SF lib/actions/projetos.ts + telas), perfil engenheiro (listarEngenheiros pronto nos dois).
- [ ] Prospecta: shared/incorporacao/projeto-sincronizacao.ts (regras puras), drizzle/0086_projeto_incorporacao.sql + schema, server/projeto-incorporacao-sync.ts, saveAprovacaoProjeto → sync, Projetos update/delete → sync reverso, UI.
- [ ] SF: espelho (lib/incorporacao/projeto-sincronizacao.ts, lib/projeto-incorporacao-sync.ts, migração 20261027140000_projeto_incorporacao, actions, UI).
- [ ] Testes / typecheck.

## Decisões
- SF: `Projeto.leadId` já é opcional — nenhuma migração de lead necessária.
