# Dolores — fuso horário no teste de avisos

- Concluído. O teste insere registros com UTC explícito na sessão de teste configurada em America/Fortaleza. Antes, as datas sem fuso representavam 45 horas de espera. A expectativa de dois dias se refere a 48 horas completas. O cálculo do sistema foi preservado.
- Central de Vendas arquivada por orientação do dono.
- Testes automáticos. Os 28 testes de avisos passaram com rede externa bloqueada. O cenário confere o grupo, a nota de obra, a conta bancária e a exclusão dos itens recentes.
- Verificação manual. Horários comparados. Nenhuma mensagem real enviada. A alteração ficou em teste e documentação, sem migração.
- Produção. PR #310 revisado e mesclado em 8e7b94290dcdffb79d72c2e7449574797d93f330. Vercel dpl_54DdvnuPFWXW4eiwqchChsbg4RET READY. A API respondeu 200 com o banco conectado.
- Próximo passo. Esta correção está encerrada.
