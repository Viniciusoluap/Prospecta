# WhatsApp individual e checklist de Projetos

- A confirmação da Evolution é tratada separadamente do registro local. Quando o servidor aceita o envio individual, a Central abre a conversa correspondente para leitura e resposta. O registro reaproveita o eco quando ele já chegou com o mesmo ID.
- Projetos permite marcar e desmarcar Realizado e salvar a decisão junto com o projeto. O PDF e o editável continuam com indicadores próprios. Sem decisão manual, os dois anexos concluem o item automaticamente.
- Testes (a): regressões de aceite da Evolution e persistência da conclusão durante a atualização de anexos.
- Testes (b): conferência do código com os prints. Nenhuma mensagem de teste foi enviada a clientes.
- Testes (c): após revisão do PR, confirmar produção e API. A validação autenticada do histórico de uma conversa e de um projeto real fica pendente.
