# Relatório — Fase 3: Ecossistema Prospecta

Data: 31 de agosto de 2026  
Status: concluída e pronta para publicação na branch de unificação.

## Objetivo

Blindar as operações financeiras do ecossistema Prospecta — sorteios, bilhetes, compras de UTEF, conversões e estornos — preservando os fluxos e a interface existentes.

## Implementado

- Os efeitos de cada operação financeira agora são concentrados em comandos atômicos no PostgreSQL:
  - confirmação de bilhete e atualização dos indicadores do sorteio;
  - crédito da compra de UTEF e lançamento no razão;
  - conversão de UTEF, débito, lançamento e notificação;
  - realização do sorteio, prêmio, lançamento e notificação;
  - cancelamento de conversão e devolução do saldo;
  - ajuste administrativo de saldo e respectivo lançamento;
  - estorno de bilhete ou de compra UTEF, cada um de forma independente e idempotente.
- O webhook do Asaas passou a validar formato de payload, valor monetário e referências internas antes de movimentar saldo.
- A confirmação de bilhete exige que o identificador do pagamento e o valor recebido coincidam com a cobrança registrada.
- A idempotência já existente por `event_key` continua sendo a trava de reentrega do webhook; com os comandos atômicos, uma falha não deixa um lançamento parcial para a repetição do evento.
- Foram adicionados 10 testes específicos para normalização de eventos, referências, valores, bônus e garantia estrutural de que os grupos de lançamentos usam um único comando atômico.

## Decisão de segurança sobre banco

Não foi criada nem aplicada migração nesta fase. Uma restrição única nova sobre lançamentos históricos poderia falhar caso a base já tivesse referências repetidas e exigiria inspeção/decisão explícita sobre dados financeiros. A proteção de reentrega é feita pela chave primária de eventos do Asaas, que já existe no schema e normaliza `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED` para o mesmo evento lógico.

## Validação

- `npm run check` — aprovado.
- `npm run lint -- --max-warnings=25` — aprovado: 0 erros e 25 avisos conhecidos de `<img>`, reservados para a Fase 5 a fim de preservar a landing page.
- `npm test` — aprovado: 31 arquivos, 285 testes.
- `npm run build` — aprovado com Next.js 16.2.7.

## Limites do checkpoint

- Nenhuma migration foi executada.
- Nenhuma configuração do Asaas, token, chave ou ambiente foi alterada.
- Nenhum deploy foi realizado.
