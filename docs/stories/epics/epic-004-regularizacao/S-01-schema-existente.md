# S-01 — Mapear schema existente

## Contexto

As tabelas já estão vazias em produção e precisam ser conhecidas pelo Drizzle sem uma operação de criação ou alteração.

## Critérios de aceitação

- [x] `regularizacoes` declarada com nomes físicos em snake_case.
- [x] `regularizacao_documents` declarada com vínculo obrigatório ao processo.
- [x] Tipos de seleção e inserção exportados.
- [ ] Estrutura confrontada com `information_schema` do Neon — **não validado, pendente de acesso somente-leitura ao Neon de produção**.
- [x] Snapshot registra as tabelas com migração exclusivamente de metadados.
- [x] Nova geração confirma `No schema changes` e não emite SQL adicional.

## Arquivos

- `drizzle/schema.ts`

## Observação operacional

A validação remota depende de `DATABASE_URL`/integração Neon, indisponível no ambiente local atual. Estado: **não validado, pendente de acesso**. Não executar `db:push` para resolver essa ausência.
