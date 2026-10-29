# Checkpoint — grupo WhatsApp (correções 01, 02, 03, 04 e 09a)

Branch: `claude/lote3-18-correcoes-20261029` (sem commit — o orquestrador commita).

## Estado
- [ ] Prospecta — em implementação
- [ ] Santa Fé — pendente

## Decisões
- Vínculo manual conversa↔lead em tabela própria (`whatsapp_conversation_links`), com prioridade sobre a inferência por telefone.
- Exclusão em lote: só mensagens/mídias locais; não toca em leads/documentos/vínculos; log estruturado sem dados pessoais (não há tabela de auditoria genérica).

## Próximo passo
Implementar servidor da Prospecta (whatsapp-router.ts).
