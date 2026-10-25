# HANDOFF 25/10 — AIOX correções 02–14

## Checkpoint 0 — início autorizado
- Repositório: `Viniciusoluap/Prospecta`; branch `codex/aiox-correcoes-02-14-20261025`.
- Base: `origin/main` `61c7f2779d1761e8bdfab09bee736b9af5685102`, conferida em 25/10/2026. Clone estava limpo.
- O usuário aprovou implementação, merge e deploy deste lote. Correção 01 excluída. Nenhuma alteração de banco ou produção neste checkpoint.
- Auditoria: `main` tem handoffs existentes; PR #7 de unificação está fechado sem merge e não será reutilizado. Há branches Claude; fazer `git fetch` e comparar antes de cada integração.
- Escopo: 02–14, paridade com Grupo Santa Fé respeitando arquitetura e dados separados. Este repositório é Vite/Express/tRPC/Drizzle; Santa Fé é Next/Prisma.
- Etapa: lote 1 em execução. Código ainda sem mudanças. Testes (a) não executados; (b) não executados; (c) pendentes de homologação.
- Riscos principais: motor financeiro da 03, vínculos PCI/catálogo das 09–10 e upload das 13. Atualização em massa de coordenadas somente após inventário, prévia e aprovação específica.
- Próximo passo exato: implementar lote 1 mínimo, testar, registrar resultados aqui, commitar e publicar; depois lotes 2–6 com checkpoints. Não refazer trabalho do Claude sem comparar remoto.

## Checkpoint 1 — interface escrita; finanças em execução
- Base remota da branch: `b69659e02d6623351d7da946ba0cb4efefa14b56` (checkpoint 0 publicado via conector GitHub; push HTTPS direto indisponível por falta de credencial).
- Lote 1 escrito: correções 02, 04, 05, 08, 11, 12 e 14 em `client/src/pages/admin/AdminCRM.tsx`, `client/src/components/obra/ListaObras.tsx`, `client/src/components/obra/ProgressoObraAba.tsx`, `client/src/pages/admin/AdminComissoes.tsx`, `client/src/pages/admin/AdminImoveisHub.tsx`, `client/src/pages/admin/AdminProjetos.tsx`, `client/src/pages/Imoveis.tsx` e `client/src/App.tsx`. O código de captação e Mercado permanece no repositório por dependências/histórico, com acessos obsoletos redirecionados.
- Lote 2 parcialmente escrito: `shared/financeiro/obra.ts`, `drizzle/schema.ts`, `drizzle/0071_empreiteiro_pro_soluto.sql`, `server/obra-financeiro-router.ts`, `client/src/components/obra/FinanceiroObra.tsx`, `client/src/pages/AdminEditarObra.tsx`, `server/financeiro-obra.test.ts`. Migracão aditiva **ainda não aplicada**. A opção começa desmarcada; Lucro Estimado e expressão do lucro da Prospecta não foram alterados.
- Testes (a): `git diff --check` OK. `pnpm check` tentou executar, mas faltava `node_modules`; instalação pelo lockfile em curso. (b): interfaces ainda não verificadas manualmente. (c): produção ainda não testada.
- Próximo passo exato: concluir instalação; executar typecheck, teste financeiro e build; corrigir falhas; revisar responsividade visual; depois fechar lote 1/2 e publicar novo checkpoint. Nunca aplicar 0071 em produção antes de coordenar deploy e conferir migrações.
