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
(b) Manuais: em produção Prospecta, navegação autenticada conferiu ordem e fórmula dos indicadores, quatro processos por página, avanço/retorno, preservação do detalhe selecionado, contagem conforme filtro e retorno à primeira página ao filtrar. Botão de preenchimento padrão visível no topo dos detalhes. Nenhum dado financeiro foi alterado nessa verificação manual. Gravação manual do padrão, exclusões e aceite em todos os dispositivos permanecem pendentes; os testes transacionais automatizados estão aprovados.
(c) Publicação: PR #177 mergeado; commit 9a4c15b3544df729929c4512c860779638bd8e83. Build de produção READY, domínio oficial associado: https://www.prospectaconstrucoes.com. Endpoint público de saúde respondeu HTTP 200 com banco conectado. Consulta inicial de logs error/fatal do deployment publicado não retornou registros; isso não substitui aceite autenticado.

## Próximo passo
Concluir a verificação de navegação autenticada e responsividade, mantendo separados os resultados automáticos, manuais e as pendências. Não repetir merge ou deploy: publicação funcional concluída. Branch de trabalho preservada, sem reset ou force push; este checkpoint de documentação está salvo na branch de continuidade.

## Complemento de diagnóstico administrativo
O diagnóstico de integração apresenta contagem e destinos sanitizados quando não há correspondência. Tokens, credenciais, query e fragmentos não são devolvidos. Reconhecimento de destino legado exige nome exato e host permitido e rejeita ambiguidades; a recuperação continua limitada ao endpoint canônico.
(a) Automáticas: 33 testes focados (diagnóstico e permissões) e TypeScript aprovados. Revisão aprovada; diff check limpo.
(b) Manuais: verificação do complemento na versão publicada ainda pendente.
(c) Publicação do complemento: preparar PR, acompanhar checks e confirmar produção antes de concluir o aceite. A publicação anterior de Regularizações permanece concluída.
