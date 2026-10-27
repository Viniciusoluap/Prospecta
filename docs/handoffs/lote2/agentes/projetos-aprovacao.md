# Checkpoint — GRUPO projetos-aprovacao (correção 07, AD-07)

## Status
- [x] Leitura: aba Projeto Aprovado (ambos), Projetos (operacional-router/AdminProjetos; SF lib/actions/projetos.ts + telas), perfil engenheiro (listarEngenheiros pronto nos dois).
- [x] Prospecta: shared/incorporacao/projeto-sincronizacao.ts (regras puras + MAPEAMENTO documentado no topo), shared/incorporacao/aprovacao-projeto.ts (campos engenheiro), shared/operacional.ts (projectInput: approval* opcionais), drizzle/0091_projeto_incorporacao.sql + schema.ts (operational_projects: incorporation_study_id, approval_process_id, approval_authority/protocol/status/notes, índice único), server/projeto-incorporacao-sync.ts (sync + router projetoIncorporacao.engenheiros/vinculos), server/routers.ts (saveAprovacaoProjeto → sync; registro do router), server/operacional-router.ts (update → refletirProjetoNoEstudo; delete → removerProcessoDoEstudo), aprovacao-projeto-tab.tsx (coluna Engenheiro + link p/ Projetos + confirmação ao excluir), AdminProjetos.tsx (selo/link Incorporação, bloco "Aprovação externa" no editor, detalhes). pnpm check OK (só erros em server/caixa/pci-gerador.ts, outro agente); vitest server/projeto-incorporacao-sync.test.ts 10/10 + 11 suítes vizinhas OK.
- [x] SF: web/src/lib/incorporacao/projeto-sincronizacao.ts (espelho das regras puras), web/src/lib/incorporacao/aprovacao-projeto.ts (campos engenheiro), web/src/lib/projeto-incorporacao-sync.ts (sync em $transaction), prisma/schema.prisma (Projeto: estudoIncorporacaoId+relação, processoAprovacaoId, aprovacaoOrgao/Protocolo/Status/Observacoes, @@unique; EstudoIncorporacao.projetosAprovacao), migração 20261027140000_projeto_incorporacao (aditiva/idempotente), lib/actions/incorporacao.ts (salvarAprovacaoProjeto → sync com capturarErroAcao; nova dadosProjetosDaAprovacao), lib/actions/projetos.ts (editar → aprovação externa + refletir; excluir → remove processo; cliente preservado p/ projeto da Incorporação), UI: aprovacao-projeto-tab.tsx, projetos-client.tsx (selo), projetos/[id]/page.tsx (card Aprovação externa + link estudo), projetos/[id]/editar (bloco Aprovação externa).
- [x] Testes / typecheck: SF `npx tsc --noEmit` OK (só erros de lotes-avulsos-editor/massa-tab, outro agente); vitest projeto-incorporacao-sync.test.ts 4/4 + projeto-incorporacao-sync.db.test.ts 6/6 + 7 suítes vizinhas (40/40). Prospecta pnpm check OK; vitest 10/10 + vizinhas.
- Obs. ambiente de teste SF: após `prisma db push`, o default do id de estudos_incorporacao_versoes some (trigger de versão falha ao criar estudo). Corrigido só no banco local: `ALTER TABLE estudos_incorporacao_versoes ALTER COLUMN id SET DEFAULT gen_random_uuid()` (provável causa do drive-estrutura.db pré-quebrado).

## Pendências / produção
- Aplicar migrações (orquestrador): Prospecta drizzle/0091_projeto_incorporacao.sql; SF 20261027140000_projeto_incorporacao.
- Validação manual em produção: salvar processo → aparece em Projetos; editar em Projetos → volta ao estudo; excluir processo → projeto cancelado; excluir projeto → processo some.
- Correção 14 (layout responsivo da aba) deve preservar a coluna Engenheiro e o link/confirmar exclusão adicionados aqui (tabela min-w 940px).

## Próximo passo
- Nenhum para a correção 07 além da validação em produção.

## Decisões
- Andamento técnico interno = status do Projeto (só editado em Projetos). Situação externa = status do processo (approval_status), sincronizada nos dois sentidos. Efeito automático só quando a situação externa muda pela Incorporação: exigência→revisao, aprovado→aprovado; nunca sobre entregue/cancelado.
- Projeto criado pela Incorporação: status "solicitado", nome "<órgão> — <estudo>", cliente = nome do estudo, sem lead, tipos sugeridos pelo órgão (Prefeitura→arquitetônico, Água/Esgoto→hidrossanitário, Energia→elétrico; demais vazio).
- Processo excluído na Incorporação → projeto perde approval_process_id (mantém estudo), vira "cancelado" com nota; documentos/checklist/revisões preservados.
- Projeto excluído em Projetos → processo sai da lista do estudo (não renasce no próximo salvamento).
- Estudo excluído → FK set null (projetos ficam, sem link).
- SF: `Projeto.leadId` já é opcional — nenhuma migração de lead necessária.
