# HANDOFF 21–22/11 — EPIC-028 Maquete com editor de itens

Atualizado em 22/11/2026. Docs do epic: `docs/stories/epics/epic-028-maquete-editor/` (plano na `ETAPA-0-PLANO.md`,
relatórios das etapas 1–3).

## Concluído (publicado em produção, na `main`)
- **Etapas 1 e 2**: JSON-fonte da planta, validações, gerador 3D e planta 2D. PR #283.
- **Etapa 3, editor de itens**: modo edição, versões (rascunho, publicada, arquivada) e tabelas. PR #288.
- **Etapa 4, página pública por lote**: decisões do dono e correções do editor. PR #292 (commit `3fbb281`).
  Arquivos principais: `server/maquete-3d/itens.ts`, `server/maquete-3d/lotes.ts`, `server/maquete-3d/router.ts`,
  `shared/maquete-3d/lote-publico.ts`, `client/src/components/maquete-3d/editor/` (`EditorItens.tsx`, `PainelLotes.tsx`),
  `client/src/pages/MaqueteDemo.tsx`, `data/plantas/lote4-qd18.json`.
- **Migrações** `drizzle/0146_maquete_3d_itens_e_lotes.sql` e `drizzle/0147_maquete_3d_lote_link.sql`: **APLICADAS no
  Neon de produção em 22/11/2026**. As duas são aditivas e as 15 maquetes antigas ficaram intactas.
- **Correções do revisor automático do PR #292** (branch `epic028-e5`, commit `[EPIC-028 E4]`):
  1. Ao publicar no editor, o painel de lotes relê a lista na hora. Antes, a versão nova não aparecia no seletor e o
     lote mostrava "Nenhuma versão de itens publicada ainda". Ligação feita por `EditorItens.aoPublicar` → contador
     em `MaqueteDemo` → `PainelLotes.atualizacao`. Salvar só grava um rascunho, que o painel não mostra, então não
     precisa avisar o painel.
  2. `listarLotes()` sempre inclui a versão publicada da maquete e as versões fixadas nos lotes, mesmo fora das 50
     mais recentes do histórico. Assim a lista e o seletor concordam com `lotePublico()`.

## Decisões do dono (21–22/11)
- Telhado do protótipo com 20% de inclinação e platibanda de 1,15 m.
- Porta de correr: a folha que ABRE fica do lado oposto ao sofá (regra geral `folha_fixa`).
- Portão PT1 de correr.
- Balcão com 1,10 m.
- Link público com código não adivinhável.
- WhatsApp da empresa: (99) 98139-2210.
- Custo zero: sem IA e sem Higgsfield (os 10 créditos ficaram intocados); `glb_url` fica vazio.
- O PDF da planta não fica no repositório.
- A publicação em produção a cada etapa foi autorizada por ele ("tudo aprovado").

## Testes
- **(a) Automáticos**:
  - `server/maquete-3d*`: 20 arquivos / 397 testes OK no PR #292. Nesta correção entram mais dois testes: o lote
    fixado numa versão antiga com mais de 50 publicações, e a ligação editor → painel. Rodada desta correção
    (`npx vitest run server/maquete-3d`): 18 arquivos / 396 testes OK.
  - `tsc` OK e `vite build` OK.
  - Portões de QA: E3 deu CONCERNS, e os pontos foram corrigidos; E4 deu PASS.
- **(b) Manuais**: nenhum.
- **(c) Pendentes de validação em produção, pelo dono**:
  1. Abrir `/maquete-demo/lote4-qd18`.
  2. Clicar em Editar, depois Salvar e Publicar. A planta mudou, então o editor pede para salvar de novo antes de publicar.
  3. No painel de lotes, ligar o lote padrão e gerar o link.
  4. Abrir o link no celular e conferir o status e o botão de WhatsApp.

## Pendências
- Itens 1 e 2 do revisor (acima): estão nesta correção e falta publicar.
- Defeitos visuais menores apontados nas capturas.
- Rota pública sem limite de taxa: risco baixo, aceito.
- Mesa comercial da Dolores (gera link e rascunho): em construção no EPIC-027.
- Outras plantas entram criando um JSON em `data/plantas/`. Isso é feito em sessão, sem IA paga.

## Próximo passo exato
1. Publicar esta correção: PR da branch `epic028-e5` → `main`, depois conferir o deploy da Vercel.
2. Pedir ao dono o teste (c) acima.
3. Para cada planta nova: criar o JSON-fonte em `data/plantas/`, validar e semear a maquete.
