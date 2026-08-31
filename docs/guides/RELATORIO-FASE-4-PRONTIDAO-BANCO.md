# Relatório da Fase 4 — prontidão para ensaio de banco

- HEAD inicial: `8044571c9847f5ea9b2dea63f4620f514a9c4ad4`
- Status: bloqueada antes de qualquer conexão ou alteração de banco.

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

## Pré-requisito faltante

Esta fase requer acesso autorizado a **backup sanitizado ou staging isolado**. Não há `DATABASE_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL`, `NEON_DATABASE_URL`, `DATABASE_URL_UNPOOLED` ou `POSTGRES_URL_NON_POOLING` configurada neste ambiente; também não há `.env` nem `.env.local` no workspace.

Por segurança, uma URL de produção não deve ser fornecida para este ensaio. É necessário um banco de staging restaurado de backup e uma credencial com permissão limitada a esse banco.

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
- Não há validação de migration possível sem staging autorizado.

## Riscos ou pendências

- A baseline Prisma usa o mesmo schema `public`, mas os nomes `ops_*` foram verificados estaticamente; a ausência de colisões na base real ainda precisa ser comprovada.
- A ordem e o conjunto de migrations legadas realmente pendentes dependem do histórico presente no backup/staging.

## Commit do checkpoint

- A registrar neste checkpoint de prontidão.

## Como reverter

- Este checkpoint só adiciona documentação; basta reverter o commit correspondente. Nenhum dado foi alterado.

## Próxima fase autorizada

- Não. É necessário disponibilizar staging ou backup sanitizado autorizado para concluir a Fase 4.
