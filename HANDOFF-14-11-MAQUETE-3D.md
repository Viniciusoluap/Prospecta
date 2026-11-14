# HANDOFF — Maquete 3D (EPIC-022) — 14/11/2026

Branch: `claude/motor-maquetes-3d-hwqvkz`. Exclusivo do Prospecta (exceção de paridade autorizada pelo dono em
14/11/2026 e registrada em `docs/stories/epics/ROADMAP.md`). **Nada foi aplicado em banco real nem publicado.**
Merge, deploy e migração em produção: só com autorização do dono.

## Leia primeiro
- `docs/stories/epics/epic-022-maquete-3d/EPIC.md` — decisões do dono, arquitetura e as 4 etapas.
- `docs/stories/epics/epic-022-maquete-3d/PROMPT-MESTRE-14-11.md` — o que o prompt pede e em que etapa entra.

## Concluído — etapa 1 inteira (base, motor de leitura e revisão)
Commits: `feat(maquete-3d): modelo em três camadas, migração 0111, motor de leitura e router` e
`feat(maquete-3d): painel, revisão da planta e prancha original ao fundo`.
- Modelo em três camadas (implantação / edificação / tipologia), validação e resumo: `shared/maquete-3d/modelo.ts`.
- Regras: faixas e preços padrão (197 / 297 / 497), situações do pedido, estado da leitura: `shared/maquete-3d/regras.ts`.
- Migração aditiva `drizzle/0111_maquete_3d.sql` + `drizzle/schema-maquete-3d.ts` (tabelas `maquetes_3d`, `maquete_3d_config`).
- Módulo `maquete3d` nas permissões (`shared/admin-permissions.ts`, `server/_core/trpc.ts`).
- Motor de leitura em passos (`server/maquete-3d/leitura.ts`, `base.ts`): inventário → por pavimento paredes/aberturas
  e cômodos/escadas → implantação → montagem. Usa Claude (`ANTHROPIC_API_KEY`), modelo `claude-opus-5-5`, saída
  estruturada (JSON Schema), 52 s por passo. Modelo e esforço da IA são configuráveis na tela (admin).
- Router `maquete3d` (`server/maquete-3d/router.ts`): config, salvarConfig, opcoes, documentosDisponiveis, listar, detalhe,
  criar, definirDocumentos, liberar (admin), recusar (admin), excluir (admin), pdfParte, iniciarLeitura, avancarLeitura,
  salvarModelo, validar.
- Tela `/admin/maquete-3d` (`client/src/pages/admin/AdminMaquete3D.tsx`) e editor de revisão
  (`client/src/components/maquete-3d/EditorPlanta.tsx`, `fundo-pdf.ts`), bloco no Painel e rota de retorno.
- Nova dependência: `pdfjs-dist` (desenha a página do PDF ao fundo da revisão; carregada só quando usada).

## Pendências
- **Aplicar a migração 0111 no Neon de produção** (só com autorização do dono) — sem ela a tela dá erro.
- **Validar o motor com PDFs reais**: precisão da leitura e tempo por passo. Nunca foi chamado contra a API real.
- `vercel.json` mantém `maxDuration: 60`. Se algum passo estourar o tempo com PDFs reais: reduzir o esforço da IA
  na tela de configuração ou aumentar o limite da função (depende do plano da Vercel — não alterado).
- A liberação de pedido de projeto hoje é manual pelo admin (nota obrigatória); a cobrança Asaas é da etapa 3.
- Edição da implantação (lotes/vias) na revisão: hoje só visualização (etapa 4).
- Etapas 2, 3 e 4 do EPIC (visualizador com mobília paramétrica, venda pelo portal/Asaas, Incorporação).
- Falha **pré-existente**, sem relação com este trabalho (falha igual sem as mudanças):
  `server/central-vendas-envio.test.ts > sequências > sem resposta e reativação 30/60/90 dias`.

## Testes
- (a) Automáticos: `pnpm exec vitest run server/maquete-3d.test.ts` → 16 passaram (modelo, preços, permissões, fluxo
  projeto e incorporação, leitura passo a passo com IA simulada, erro e repetição de passo, versão na revisão,
  PDF em partes). `server/admin-permissions.test.ts` ajustado para o novo módulo. Suíte completa: 1760 passam e 1
  falha pré-existente (acima). `pnpm check` (tsc) e `vite build` sem erros.
- (b) Manuais (navegador automatizado, router real, banco em memória, IA simulada): bloco no Painel; novo pedido;
  confirmar pagamento; leitura com progresso; revisão de um sobrado (selecionar cômodo, trocar de pavimento, resolver
  pendência, salvar, validar); tela no celular (390 px); prancha de um PDF real ao fundo, alinhada às paredes.
- (c) Pendentes de validação em produção: migração 0111; leitura de PDFs reais pela IA; leitura de arquivo guardado
  no Drive e no banco (Incorporação); permissão do colaborador com o módulo "Maquete 3D".

## Próximo passo exato
1. Com autorização do dono: aplicar `drizzle/0111_maquete_3d.sql` no Neon e publicar a branch; rodar um projeto real
   pela leitura e ajustar os pedidos à IA (`server/maquete-3d/leitura.ts`, constantes `PEDIDO_*`) conforme o resultado.
2. Etapa 2 (visualizador): criar `client/src/components/maquete-3d/visualizador/` a partir do `ModeloMaquete` validado —
   paredes com vãos, lajes, cobertura, escadas, colisão, visão externa/interna, depois o motor de mobília paramétrica
   (três estilos), iluminação por horário, tour e a rota pública `/maquete/<token>`.
