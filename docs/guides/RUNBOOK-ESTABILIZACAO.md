# Runbook de estabilização e conciliação

Este documento prepara a Fase 9. A janela começa somente depois de uma publicação de produção autorizada e registrada.

## Health check

Endpoint:

```text
GET /api/health
```

Resposta saudável: HTTP 200, `status=ok`, aplicação e banco `ok`. Resposta degradada: HTTP 503 e banco `error`. O endpoint não retorna URL, credencial nem mensagem interna do banco.

## Cadência das primeiras 48 horas

| Período | Frequência | Verificações |
| --- | --- | --- |
| 0–2 horas | a cada 15 minutos | health, 5xx, autenticação, webhook, pagamento e filas |
| 2–8 horas | a cada hora | health, erros, latência e conciliação financeira |
| 8–24 horas | a cada 4 horas | health, bilhetes, UTEF, pagamentos e notificações |
| 24–48 horas | a cada 8 horas | estabilidade geral e divergências acumuladas |

## Conciliação obrigatória

Para cada transação Asaas processada no período, conferir:

1. identificador externo único;
2. status recebido no webhook;
3. registro interno da transação;
4. quantidade e propriedade dos bilhetes;
5. lançamento no ledger UTEF, quando aplicável;
6. ausência de processamento duplicado;
7. soma financeira entre provedor e sistema.

Registrar total de pagamentos, valor bruto, aprovados, pendentes, estornados, webhooks duplicados e divergências. Uma divergência financeira bloqueia o encerramento.

## Indicadores mínimos

- disponibilidade de `/api/health`;
- taxa de respostas 5xx;
- erros de autenticação e autorização;
- latência das rotas de compra e webhook;
- webhooks recebidos, rejeitados e duplicados;
- pagamentos sem bilhete;
- bilhetes sem pagamento confirmado;
- saldo UTEF sem lançamento correspondente;
- falhas de upload e WhatsApp.

## Tratamento de incidentes

Cada correção deve usar branch/checkpoint próprio, conter evidência do erro, teste de regressão e procedimento de reversão. Incidentes financeiros exigem suspensão do fluxo afetado até a conciliação.

## Critério de encerramento

A Fase 9 só pode ser encerrada quando:

- 24–48 horas de observação forem cumpridas;
- nenhuma divergência financeira permanecer aberta;
- nenhum erro crítico permanecer aberto;
- health e smoke tests estiverem aprovados;
- relatório final registrar SHA, deployment, migrations, rollback e incidentes;
- o proprietário autorizar explicitamente o merge na `main`.
