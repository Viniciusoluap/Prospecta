# Handoff — Melhorias de Regularização — 29/10/2026

## Requisitos de produto
- Ordenar indicadores: valor contratado, valor já recebido e a receber.
- Calcular a receber pela diferença entre contratado e recebido, reutilizando as regras de cálculo existentes.
- Mostrar a quantidade total dos processos correspondentes ao filtro atual.
- Paginar a lista filtrada em grupos de quatro, com navegação anterior/próximo e indicação da página.
- Ajustar paginação ao mudar filtros ou excluir registros, preservando a visualização dos detalhes.
- Adicionar preenchimento de valores previstos por tabela padrão independente, com edição posterior, sem duplicar itens ou alterar recebimentos.
- Confirmar a substituição de valores previstos existentes.
- Preservar permissões, precisão monetária e responsividade.

## Plano de implementação
Reutilizar componentes e regras existentes; implementar os requisitos, revisar o diff e executar as verificações adequadas. Manter equivalência de comportamento entre os sistemas e preservar suas identidades visuais.

## Implementação
Indicadores, contagem filtrada, paginação e preenchimento padrão implementados. Valores previstos continuam editáveis; operação preserva recebimentos e evita duplicações. Integração Asaas inclui manutenção administrativa autenticada e validação dos eventos recebidos.

## AIOX
Definições versionadas consultadas e trabalho separado entre desenvolvimento, QA e DevOps. Recursos centrais referenciados pelas definições (core-config, gotchas e technical-preferences) não estavam disponíveis no checkout; sua execução não é afirmada. CodeRabbit CLI indisponível; revisão independente realizada pelos agentes.

## Validações
(a) Automáticas: git diff --check aprovado; revisão independente QA aprovada. Prospecta: 24 testes focados do desenvolvimento aprovados, além de 54 testes na revisão integrada; TypeScript e build Vite aprovados.
(b) Manuais: aceite visual autenticado e de navegação ainda pendente.
(c) Publicação: PR #177 mergeado; commit 9a4c15b3544df729929c4512c860779638bd8e83. Build de produção READY, domínio oficial associado: https://www.prospectaconstrucoes.com. Endpoint público de saúde respondeu HTTP 200 com banco conectado. Consulta inicial de logs error/fatal do deployment publicado não retornou registros; isso não substitui aceite autenticado.

## Próximo passo
Concluir a verificação de navegação autenticada e responsividade, mantendo separados os resultados automáticos, manuais e as pendências. Não repetir merge ou deploy: publicação funcional concluída. Branch de trabalho preservada, sem reset ou force push; este checkpoint de documentação está salvo na branch de continuidade.
