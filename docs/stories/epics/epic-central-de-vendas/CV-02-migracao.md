# CV-02 — Migração aditiva

Status: Draft

## Critérios de aceite
- [ ] Migração `drizzle/0110_central_vendas.sql` só com CREATE ... IF NOT EXISTS (idempotente, sem alterar nem apagar dado existente).
- [ ] Três status separados (atendimento, documental, análise) numa tabela 1:1 com `leads`, com CHECK dos valores.
- [ ] Tabelas de configuração, produtos/empreendimentos, checklists, campanhas, eventos (auditoria), fila de reprocessamento e sequências.
- [ ] Banco garante que aprovado/reprovado/pendente exige o usuário humano que decidiu.
- [ ] Teste PGlite aplica a migração duas vezes.

## File List
- (preenchido na implementação)

## Change Log
- 12/11/2026 — story criada (Draft) a partir da seção 7 do prompt.
