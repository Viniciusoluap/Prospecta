# HANDOFF — Maquete 3D (EPIC-022) — 14/11/2026

Branch: `claude/motor-maquetes-3d-hwqvkz`. Exclusivo do Prospecta (exceção de paridade autorizada pelo dono em
14/11/2026 e registrada em `docs/stories/epics/ROADMAP.md`). **Nada foi aplicado em banco real nem publicado.**
Merge, deploy e migração em produção: só com autorização do dono.

## Leia primeiro
- `docs/stories/epics/epic-022-maquete-3d/EPIC.md` — decisões do dono, arquitetura e as 4 etapas.
- `docs/stories/epics/epic-022-maquete-3d/PROMPT-MESTRE-14-11.md` — o que o prompt pede e em que etapa entra.

## Concluído (etapa 1, parte servidor)
- Modelo em três camadas (implantação / edificação / tipologia), validação e resumo: `shared/maquete-3d/modelo.ts`.
- Regras: faixas e preços padrão (197 / 297 / 497), situações do pedido, estado da leitura: `shared/maquete-3d/regras.ts`.
- Migração aditiva `drizzle/0111_maquete_3d.sql` + `drizzle/schema-maquete-3d.ts` (tabelas `maquetes_3d`, `maquete_3d_config`).
- Módulo `maquete3d` nas permissões (`shared/admin-permissions.ts`, `server/_core/trpc.ts`).
- Motor de leitura em passos (`server/maquete-3d/leitura.ts`, `base.ts`): inventário → por pavimento paredes/aberturas
  e cômodos/escadas → implantação → montagem. Usa Claude (`ANTHROPIC_API_KEY`), modelo `claude-opus-5-5`, saída
  estruturada (JSON Schema), 52 s por passo. Modelo e esforço da IA são configuráveis em `maquete_3d_config`.
- Router `maquete3d` (`server/maquete-3d/router.ts`): config, opções, documentos disponíveis, listar, detalhe, criar,
  definirDocumentos, liberar (admin), recusar (admin), excluir (admin), iniciarLeitura, avancarLeitura, salvarModelo, validar.

## Pendências
- S-04: tela `/admin/maquete-3d` (lista, novo pedido, preços, leitura com progresso, revisão da planta). **Em andamento.**
- Etapas 2, 3 e 4 do EPIC (visualizador, venda ao cliente pelo portal/Asaas, Incorporação).
- A liberação de pedido de projeto hoje é manual pelo admin (nota obrigatória); a cobrança Asaas é da etapa 3.
- `vercel.json` mantém `maxDuration: 60`. Se algum passo de leitura estourar o tempo com PDFs reais, as saídas são:
  reduzir o esforço da IA na configuração ou aumentar o limite da função (depende do plano da Vercel — não alterado).

## Testes
- (a) Automáticos: `pnpm exec vitest run server/maquete-3d.test.ts` → 16 passaram (modelo, preços, permissões, fluxo
  projeto e incorporação, leitura passo a passo com IA simulada, erro e repetição de passo, versão na revisão).
  `pnpm check` (tsc) sem erros.
- (b) Manuais: nenhum ainda (a tela não existe).
- (c) Pendentes de validação em produção: aplicar a 0111; leitura de PDFs reais (precisão e tempo por passo);
  leitura de PDF guardado no Drive e no banco (Incorporação).

## Próximo passo exato
Implementar a S-04: `client/src/pages/admin/AdminMaquete3D.tsx` + `client/src/components/maquete-3d/`, rota em
`client/src/App.tsx` (`<AdminRoute module="maquete3d">`), bloco em `MODULOS_DO_PAINEL` (`client/src/pages/Admin.tsx`)
e a rota em `client/src/components/GlobalBackButton.tsx`. Depois: testes, atualizar este HANDOFF, commit e push.
