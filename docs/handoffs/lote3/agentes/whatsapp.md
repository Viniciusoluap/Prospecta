# Checkpoint — grupo WhatsApp (correções 01, 02, 03, 04 e 09a)

Branch: `claude/lote3-18-correcoes-20261029` (sem commit — o orquestrador commita).

## Estado
- [x] Prospecta — implementada e testada (typecheck limpo; testes WhatsApp + RBAC verdes)
- [x] Santa Fé — implementada e testada (tsc limpo nos meus arquivos; eslint sem erros; testes verdes)

## Prospecta — arquivos
- `shared/whatsapp/conversas.ts` (novo): chaveTelefone, resolverLeadConversa (manual > telefone > gravado), candidatosVinculo, seleção (alternarItem / alternarTodosVisiveis / podarSelecao), período e taxa do dashboard, texto da confirmação.
- `server/_core/evolution.ts`: mesmoTelefone usa chaveTelefone.
- `drizzle/0094_whatsapp_vinculo.sql` + `drizzle/schema.ts` (`whatsappConversationLinks`): tabela `whatsapp_conversation_links` (connection_id, phone_key, lead_id, linked_by, linked_at; único por conexão+telefone; RLS) e índice (direcao, created_at).
- `server/whatsapp-router.ts`: previaExclusaoConversas, excluirConversas (transação + log estruturado sem dados pessoais), buscarLeadsParaVincular, vincularLead, desvincularLead, resumoEnvios (count por período); criarLeadDaConversa com aviso de duplicado (CONFLICT, `forcar`) e vínculo automático; conversas/mensagensConversa/excluirConversa/responder/acesso à mídia usam o vínculo manual primeiro; leadsParaEnvio, previaEnvio e documentosParaEnvio só com leads não excluídos.
- `server/whatsapp-evolution-webhook.ts`: mensagem recebida usa o vínculo manual primeiro.
- `client/src/components/whatsapp/ConversasWhatsApp.tsx`: checkboxes, "Selecionar todas", contador, "Excluir selecionadas", confirmação com contagem; Vincular/Trocar/Desvincular lead, link "Abrir lead no CRM", aviso de duplicado antes de "Criar lead".
- `client/src/pages/admin/AdminWhatsApp.tsx`: KPIs de `resumoEnvios` com seletor 7/30/90/tudo e rótulo; destinatários com refetchOnMount "always", refetch ao voltar à aba e ao focar; "Selecionar todos" = visíveis; poda de IDs removidos.
- `AdminCRM.tsx` / `AdminLeadDetail.tsx`: invalidam `whatsapp.leadsParaEnvio` ao excluir/recuperar lead.
- `AdminIntegracoes.tsx`: removido `<ConexaoWhatsApp role="admin"/>` (continua na Central, aba "Minha conexão"). `SubPciAtual` intocado.

## Testes Prospecta
- (a) automáticos: `server/whatsapp-lote3.test.ts` (12, PGlite com a 0094 aplicada 2x) + whatsapp-noite/conversas/evolution/business + rbac → 65/65 verdes. `pnpm check` limpo. Suíte completa não rodou até o fim (timeout de 10 min do ambiente).
- (c) produção: aplicar 0094; conferir André Renan fora dos destinatários; conferir KPI > 100.

## Decisões
- Vínculo manual em tabela própria; também grava `lead_id` nas mensagens da conversa (como "Criar lead"). Desvincular apaga o vínculo e limpa o `lead_id` que apontava para ele; a conversa volta a ser identificada pelo telefone.
- Exclusão em lote: só mensagens/mídias locais da conexão; não toca leads, documentos nem vínculos. Corretor: se qualquer conversa escolhida for de lead de outro corretor, nada é apagado (FORBIDDEN).
- Auditoria: não há tabela de log genérica → `console.info` JSON `{evento, usuarioId, papel, conexaoId, conversas, mensagens, em}` sem telefone/nome.
- "Lead ativo" na Prospecta = `deleted_at IS NULL` (não há campo inativo).

## Santa Fé — arquivos (web/)
- `src/lib/whatsapp/conversas.ts` (novo, gêmeo do shared da Prospecta + `LEAD_ATIVO_WHATSAPP = { excluidoEm: null, arquivadoEm: null }`).
- `src/lib/evolution.ts`: mesmoTelefone usa chaveTelefone.
- `prisma/schema.prisma` (+21 linhas: model `WhatsappVinculoConversa`, back-relations em Lead/ConexaoWhatsApp, índice [direcao, enviadaEm]) + `prisma/migrations/20261029110000_whatsapp_vinculo/migration.sql` (tabela `whatsapp_vinculos_conversa`, FKs, RLS + REVOKE; idempotente — rodada 2x num banco limpo).
- `src/lib/actions/whatsapp.ts`: previaExclusaoConversasWhatsapp, excluirConversasWhatsapp ($transaction + log JSON sem dados pessoais), buscarLeadsParaVincularWhatsapp, vincularLeadWhatsapp, desvincularLeadWhatsapp, resumoEnviosWhatsapp (count por período); criarLeadDaConversaWhatsapp(numero, nome, forcar) com aviso de duplicado e vínculo automático; conversas com resolução manual > telefone > gravado (+ campo `vinculo`); mensagens/excluir/responder respeitam o vínculo; prévia e documentos só leads ativos. Removida a action órfã `conexoesWhatsappIntegracoes`.
- `src/lib/whatsapp/webhook-evolution.ts` (`leadDoVinculo`) e `src/lib/whatsapp/midia.ts`: vínculo manual primeiro.
- `src/app/admin/whatsapp/page.tsx` e `src/app/api/whatsapp/enviar/route.ts`: filtro de lead ativo.
- `src/lib/actions/leads.ts`: `revalidatePath("/admin/whatsapp")` em excluirLead e arquivarLead.
- `src/app/admin/whatsapp/_components/conversas-whatsapp.tsx`: checkboxes, selecionar todas, contador, Excluir selecionadas + confirmação com contagem; Vincular/Trocar/Desvincular, link para `/admin/leads/<id>`, aviso de duplicado.
- `src/app/admin/whatsapp/_components/whatsapp-client.tsx`: KPIs via resumoEnviosWhatsapp com seletor 7/30/90/tudo e rótulo; `router.refresh()` ao abrir a aba Enviar e ao focar a janela; "Selecionar todos" = visíveis; poda de IDs removidos.
- 09a: `src/app/admin/integracoes/_components/conexao-whatsapp-integracoes.tsx` era órfão → removido. Central mantém "Minha Conexão"/"Conexão da empresa" e "Conexões dos Corretores". `sub-pci-atual` intocado.

## Testes Santa Fé
- (a) automáticos: `src/lib/__tests__/whatsapp-lote3.test.ts` (5, puros) + `whatsapp-lote3.db.test.ts` (7, banco local santafe_lote2: lote, vínculo, CPF, duplicado, André Renan/arquivado fora da prévia/documentos/envio com Evolution simulada, contagem 150/170 com falhas e entradas fora) + whatsapp-conversas(.db)/evolution/validacao/templates + crm-actions/leads-falha-servicos/lead-exclusao-definitiva → todos verdes.
- `npx tsc --noEmit`: único erro é de outro grupo (`src/lib/medicao-caixa.ts` → `@/lib/pci-listas`).

## Pendências / produção
- Aplicar migrações (P 0094, SF 20261029110000) — não aplicadas em produção.
- Validar em produção: André Renan fora dos destinatários; KPI > 100 com período; vincular/desvincular em conversa real.

## Próximo passo
Orquestrador: revisar e commitar. Nada pendente do grupo WhatsApp.
