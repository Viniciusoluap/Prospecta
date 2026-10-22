# Handoff — 21/10/2026 — erro ao salvar lead

Branch: `codex/corrigir-neon-http-lead-20261021`, criada a partir do merge `69a344b` (#144).

## Concluído

- Causa do erro mostrado pelo usuário: `leads.update` invocava uma transação interativa (`getDb().transaction`) em uma conexão `drizzle-orm/neon-http`. O mesmo padrão ocorria em `financiamentos.update` e `financiamentos.atualizarValores`.
- `server/routers.ts` e `server/financiamento-router.ts`: operações de atualização do CRM e financiamentos passaram a usar `database.batch` do driver Neon HTTP para executar as gravações relacionadas em lote transacional. O caminho sem sincronização continua com uma atualização simples.
- Nenhuma migração de banco necessária. A paridade funcional no Grupo Santa Fé já usa Prisma e não apresenta esta incompatibilidade específica de driver.

## Verificação

- (a) Automáticos: `pnpm check` passou; `pnpm exec vitest run server/financiamento-crm-link.test.ts server/operacional.test.ts --maxWorkers=1 --minWorkers=1` passou (54 testes); `git diff --check` passou. Execução do conjunto integral chegou a 893 testes aprovados, mas um worker excedeu o limite de memória e encerrou a execução.
- (b) Manuais: sem alteração de dados reais ou tentativa de salvar o lead da imagem.
- (c) Produção: validar com o lead afetado que o formulário salva todos os dados e que VGV simulado e valor financiado aprovado se refletem no financiamento e no CRM em ambas as direções.

## Próximo passo

Fazer push, merge e deploy da correção e repetir o salvamento real no formulário. Se aparecer um erro diferente, coletar a mensagem e o horário sem expor os dados do cliente.
