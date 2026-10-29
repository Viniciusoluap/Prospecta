# Checkpoint — grupo WhatsApp (correções 01, 02, 03, 04 e 09a)

Branch: `claude/lote3-18-correcoes-20261029` (sem commit — o orquestrador commita).

## Estado
- [x] Prospecta — implementada e testada (typecheck limpo; testes WhatsApp + RBAC verdes)
- [ ] Santa Fé — em implementação

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

## Próximo passo
Santa Fé: mesma regra (migração `20261029110000_whatsapp_vinculo`).
