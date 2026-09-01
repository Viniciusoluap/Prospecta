# Runbook de segurança e operação

## Sinais mínimos

Os eventos financeiros críticos são emitidos em JSON, com `timestamp`, `level`, `event`, `errorName` e `correlationId`, sem mensagem interna do erro ou segredo. Monitorar:

| Evento/indicador | Alerta inicial | Ação imediata |
| --- | --- | --- |
| `asaas.webhook.processing_failed` | 3 ocorrências em 5 minutos | pausar ações manuais no sorteio/UTEF e conferir idempotência |
| `payment.ticket.creation_failed` | 3 ocorrências em 5 minutos | conferir disponibilidade e ambiente do Asaas |
| `payment.utef.creation_failed` | 3 ocorrências em 5 minutos | suspender divulgação da compra até validar o provedor |
| `utef.conversion_failed` | qualquer repetição para o mesmo usuário/produto | conferir saldo e ledger antes de ajuste manual |
| HTTP 5xx | acima de 2% por 5 minutos | identificar rota e correlacionar com deploy/banco |
| HTTP 401/403 | aumento de 5 vezes sobre a linha de base | investigar tentativa de acesso ou sessão inválida |
| latência p95 | acima de 2 s por 10 minutos | verificar banco e integrações externas |

Os limiares devem ser calibrados após uma semana de tráfego real. Alertas são configurados no provedor durante a Fase 7; este repositório não cria integrações externas automaticamente.

## Triagem de incidente

1. Registrar horário UTC, ambiente, rota, versão do commit e `correlationId`; nunca copiar tokens ou dados pessoais.
2. Classificar: P1 para fraude/exposição ou alteração indevida de saldo; P2 para pagamentos/webhooks indisponíveis; P3 para degradação sem perda de integridade.
3. Conter: desabilitar a credencial afetada, pausar somente o fluxo comprometido e preservar logs. Não apagar ledger nem eventos de webhook.
4. Conferir no Asaas o pagamento pelo identificador do provedor e comparar tickets, transações e saldo UTEF.
5. Corrigir primeiro em preview, executar suíte e smoke tests, solicitar autorização para produção e registrar o commit promovido.
6. Encerrar com causa, impacto, janela, registros corrigidos e ação preventiva.

## Rotação de segredos

### `AUTH_SECRET`

1. Gerar segredo forte no cofre do ambiente.
2. Atualizar preview e confirmar que sessões anteriores são invalidadas.
3. Programar a rotação de produção, atualizar a variável e verificar login/RBAC.

### `JWT_SECRET`

1. Antes da mudança, confirmar acesso administrativo e ter em mãos novas credenciais Asaas.
2. Atualizar o segredo no preview e salvar novamente a configuração Asaas pelo painel para recriptografá-la.
3. Repetir em produção somente em janela autorizada. Não remover o valor antigo antes de concluir a recodificação planejada.

### Asaas e webhooks

1. Criar nova chave/token no Asaas no ambiente correto.
2. Atualizar preview e realizar cobrança sandbox + webhook confirmado.
3. Em produção, atualizar a configuração criptografada, trocar o token no endpoint Asaas e monitorar 401/5xx.
4. Revogar a credencial anterior somente após o primeiro evento válido com a nova.

### Demais integrações

Rotacionar no provedor, atualizar primeiro o preview, executar o fluxo específico, promover em produção e revogar o valor anterior. Para suspeita de exposição, a revogação é imediata e o fluxo pode permanecer indisponível até validação.

## Rollback

- Aplicação: retornar ao último checkpoint publicado e verificar health/build antes de receber tráfego.
- Banco: não executar correção destrutiva. Usar transação compensatória registrada no ledger e procedimento de backup/restauração quando houver dados reais.
- Pagamentos: eventos são idempotentes; nunca reenviar manualmente sem conferir `eventKey` e identificador de pagamento.
