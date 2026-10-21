# Handoff — nomenclatura dos valores do CRM — 20/10/2026

## Escopo autorizado
Renomear os dois valores no formulário de edição e na leitura do lead, com paridade Prospecta e Grupo Santa Fé. Merge e deploy autorizados pelo usuário.

## Concluído nesta etapa
- Primeiro campo: VGV simulado (R$); leitura: VGV simulado.
- Segundo campo: Valor financiado aprovado (R$); leitura: Valor financiado aprovado.
- Prospecta: AdminLeadDetail.tsx; Santa Fé: editar-lead-form.tsx e page.tsx do detalhe do lead.
- Santa Fé usa orcamento como campo equivalente ao valor simulado (antigo rótulo Budget).
- Alteração somente de rótulos; preservados campos persistidos, valores, cálculos e integrações.
- Logyca segue em planejamento, fora deste lote.

## Testes
(a) Automáticos: diff restrito às substituições previstas, git diff --check e sintaxe TSX dos três arquivos aprovados. Build de preview e produção na Vercel aprovados (READY). Pipeline da Prospecta: 887 testes aprovados e TypeScript sem erros.
(b) Manuais: revisão do diff; tela autenticada ainda não verificada em navegador.
(c) Produção: deploy READY confirmado e domínios de produção atribuídos. Validação visual na tela autenticada ainda pendente.

## Próximo passo exato
Implementação concluída e publicada. PR #142 mesclado: https://github.com/Viniciusoluap/Prospecta/pull/142. Commit de implementação: 1f14a828b6acc02da160e1865f36ee0b7dbf1f3b. Merge em main: 1a9d112852b52b841772d37f26313f060c1efd4e. Deploy de produção: dpl_t3R4XMbLYijArc7TibGg9aVaCreC (READY). Apenas conferir os rótulos no formulário e na leitura de um lead autenticado. Este checkpoint final fica na branch de trabalho; o handoff inicial também integra main.
