# Handoff — VGV simulado no cadastro do lead — 21/10/2026

## Escopo autorizado
Incluir VGV simulado (R$) no cadastro inicial, ao lado do estágio e antes dos serviços. Preservar edição/leitura do mesmo valor. Valor financiado aprovado preenchido somente na edição. Paridade Prospecta e Grupo Santa Fé, merge e deploy autorizados.

## Implementação
- Prospecta: AdminCRM inclui CurrencyInput, estado inicial e envio de simulationValue; leads.create valida valor não negativo dentro de decimal(15,2) e persiste string com duas casas no mesmo campo do detalhe/edição.
- Santa Fé: NovoLeadForm renomeia Budget e posiciona CurrencyInput orcamento ao lado do estágio. Action existente já persiste esse campo; financiamento aprovado continua fora do cadastro.
- Testes verificam persistência do VGV, centavos e recusa/ausência do financiamento aprovado na criação; Prospecta verifica ausência de simulação e valores inválidos.
- Sem migration e sem alterações nos valores dos clientes existentes.

## Validação
(a) Automática: sintaxe dos arquivos alterados aprovada; diff --check aprovado. Santa Fé: 7 testes do fluxo de criação/edição aprovados localmente. Prospecta: 894 testes aprovados no pipeline Vercel, incluindo 7 regressões do novo fluxo; TypeScript e build aprovados.
(b) Manual: revisão do fluxo de envio, campo persistido e compatibilidade com edição/leitura.
(c) Produção: build e deploy READY confirmados para os dois sistemas, com domínios de produção atribuídos. Tela autenticada com criação real não exercitada.

## Próximo passo exato
Implementação concluída, sem pendência de código. PR #143: https://github.com/Viniciusoluap/Prospecta/pull/143 (merged). Commit de implementação: 8388d27f78a428dfe586e10ad06b09f7bf15a87a. Merge: a41f388327daf45eb43f6ed7aff8517579835029. Deploy: dpl_6oqbamMQnadyAdRUyKuzHVAt9TCR (produção READY). Conferência visual opcional: cadastrar um lead com VGV simulado e verificar o mesmo valor nos detalhes/edição; aprovado permanece apenas na edição. O handoff inicial está em main; este checkpoint final fica na branch de trabalho codex/vgv-cadastro-lead-20261021.
