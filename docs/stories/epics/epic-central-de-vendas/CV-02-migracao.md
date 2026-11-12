# CV-02 — Migração aditiva

Status: InReview

## Critérios de aceite
- [x] Migração `drizzle/0110_central_vendas.sql` só com CREATE ... IF NOT EXISTS (idempotente, sem alterar nem apagar dado existente).
- [x] Três status separados (atendimento, documental, análise) numa tabela 1:1 com `leads`, com CHECK dos valores.
- [x] Tabelas de configuração, produtos/empreendimentos, checklists, campanhas, eventos (auditoria), fila de reprocessamento e sequências.
- [x] Banco garante que aprovado/reprovado/pendente exige o usuário humano que decidiu.
- [x] Teste PGlite aplica a migração duas vezes.

## File List
- `drizzle/0110_central_vendas.sql` (12 tabelas `central_vendas_*`, só CREATE IF NOT EXISTS)
- `drizzle/schema-central-vendas.ts` (definições Drizzle; arquivo separado para não colidir com outras frentes)
- `drizzle.config.ts` (inclui o arquivo novo no `schema`)
- `server/__fixtures__/central-vendas/banco.ts` (PGlite com as tabelas reais geradas do `schema.ts` + 0110)
- `server/central-vendas-0110.test.ts`

## Change Log
- 12/11/2026 — story criada (Draft) a partir da seção 7 do prompt.
- 12/11/2026 — implementada (InReview). Decisão: status em tabela 1:1 (`central_vendas_leads`), sem coluna nova em `leads`.
