# Relatório da Fase 4 — prontidão para ensaio de banco

- HEAD inicial: `8044571c9847f5ea9b2dea63f4620f514a9c4ad4`
- Status: concluída por dispensa autorizada pelo proprietário em 1º de setembro de 2026.

## Escopo executado

Foi feita a pré-checagem estática do repositório e do ambiente de trabalho. Não houve acesso a banco, backup, staging, migration, seed ou deploy.

## Inventário estático

| Item | Resultado |
| --- | --- |
| Migrations legadas Drizzle | 26 arquivos, `0000` a `0025` |
| Baseline operacional Prisma | 1 migration: `20260830000000_prospecta_ops_baseline` |
| Tabelas operacionais criadas pela baseline | 31 tabelas com prefixo `ops_` |
| Foreign keys na baseline operacional | 29 |
| Instruções destrutivas nos SQLs versionados | nenhuma (`DROP`, `TRUNCATE`, `DELETE` ou remoção de coluna) |
| Credencial de banco no ambiente atual | ausente; nenhum valor foi exposto |

## Decisão do proprietário

O proprietário confirmou que não há base ou dados a recuperar. Portanto, o ensaio de backup/restauração desta fase não é necessário neste momento e a execução pode prosseguir para a validação de interface.

Não há `DATABASE_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL`, `NEON_DATABASE_URL`, `DATABASE_URL_UNPOOLED` ou `POSTGRES_URL_NON_POOLING` configurada neste ambiente; também não há `.env` nem `.env.local` no workspace. Nenhuma migration foi aplicada.

## Ordem proposta para o ensaio (a confirmar no staging)

1. Gerar e verificar um backup recuperável do banco de origem; registrar checksum, horário e tamanho sem versionar o arquivo.
2. Restaurar o backup em um banco de staging exclusivo e confirmar que a URL aponta para esse banco.
3. Capturar inventário prévio de tabelas, índices, constraints e contagens de cada tabela legada e `ops_*`.
4. Conferir o histórico de migrations já aplicado; não reaplicar migrations legadas que já estejam presentes no backup.
5. Aplicar, em transação/ambiente isolado quando suportado, somente as migrations ainda pendentes: legado Drizzle em ordem numérica e baseline Prisma `ops_*` depois da confirmação de que não há colisão de nomes.
6. Reexecutar o inventário, comparar contagens e invariantes de sorteios, tickets, saldos, transações UTEF e usuários.
7. Restaurar o backup em uma segunda instância para confirmar o procedimento de rollback.

## Comandos de inspeção a executar somente no staging autorizado

```bash
pg_dump --format=custom --file=prospecta-staging-before.dump "$DATABASE_URL"
pg_restore --list prospecta-staging-before.dump
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "\\dt"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT tablename, n_live_tup FROM pg_stat_user_tables ORDER BY tablename"
npx prisma migrate status
```

Os comandos de aplicação e restauração serão registrados com as URLs mascaradas, duração e saída de cada etapa somente após o staging ser disponibilizado.

## Arquivos alterados

- `docs/guides/RELATORIO-FASE-4-PRONTIDAO-BANCO.md`

## Migrations criadas/aplicadas

- Nenhuma.

## Testes e resultados

- Inspeção estática dos manifests de migration: concluída.
- O ensaio de migration/restauração foi dispensado por não haver dados a recuperar.

## Riscos ou pendências

- Quando um banco passar a ser criado para staging ou produção, a baseline Prisma e as migrations legadas deverão ser aplicadas somente depois de definir a estratégia de provisionamento inicial.

## Commit do checkpoint

- `checkpoint/fase-4: waive database rehearsal without legacy data`

## Como reverter

- Este checkpoint só adiciona documentação; basta reverter o commit correspondente. Nenhum dado foi alterado.

## Próxima fase autorizada

- Sim. Fase 5 — interface, responsividade e acessibilidade.
