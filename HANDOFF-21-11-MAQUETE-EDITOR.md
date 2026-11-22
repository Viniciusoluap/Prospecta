# HANDOFF 21/11 — EPIC-028 Maquete com editor de itens

Branch `feat/maquete-3d-editor` (worktree `.claude/worktrees/epic028`). Commits locais; **push e PR não feitos** (fica com
a sessão principal / @devops).

## Concluído
- Etapas 1 e 2 (JSON-fonte, validações, gerador 3D e planta 2D): ver `ETAPA-1-RELATORIO.md` e `ETAPA-2-RELATORIO.md`.
- Etapa 3 (modo edição, versões, tabelas): `docs/stories/epics/epic-028-maquete-editor/ETAPA-3-RELATORIO.md`.
  Commits `aba97c7` (servidor, migração 0146, regras) e `61b3caa` (editor na tela, capturas) + docs.

## Testes
- (a) Automáticos: `server/maquete-3d*.test.ts` 15 arquivos / 354 testes OK; `tsc` OK; `vite build` OK; Playwright do
  editor 20/20 conferências OK (harness em memória).
- (b) Manuais: capturas de `screenshots/etapa-3/` conferidas uma a uma.
- (c) Pendentes em produção: nada publicado. A 0146 NÃO foi aplicada em banco nenhum.

## Pendências
- Aplicar a 0146 numa branch do Neon e testar logado como admin; ela tem de ir ao banco ANTES do deploy deste código.
- Portão de QA da Etapa 3.

## Próximo passo exato
Portão de QA da Etapa 3 (`E3-modo-edicao.md`); depois, com autorização, Etapa 4 (`ETAPA-0-PLANO.md` §3).
