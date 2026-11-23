# Estudo de Massa e Viabilidade Econômica

## Implementação

- Estudo de Massa exibe geometria, quantidades e áreas. O preço e o VGV foram retirados da tela, assim como os dois botões de salvamento redundantes. O botão de salvar cria o estudo ou atualiza o aberto. O cenário principal fornece as áreas e os lotes à Viabilidade, preservando as premissas comerciais já preenchidas.
- Viabilidade usa a área líquida do cenário principal quando sincronizada, incluindo a dedução correta das restrições sobrepostas. O preço informado tem prioridade e o sistema recupera referências de preço quando disponíveis. A interface indica quando é preciso preencher um valor.
- Casas e apartamentos usam a premissa de 80% do banco no mês de cada venda. Os 20% do cliente entram à vista quando o prazo é zero ou em parcelas fixas a partir do mês seguinte, com juros mensais configuráveis. Os lotes em um mix continuam usando suas próprias condições.
- As novas premissas são gravadas no JSON existente. Sem migração de banco.

## Testes e publicação

- (a) QA automatizado cobriu geração de cenários sem preço, recuperação do VGV, geometria com APP e fluxo de caixa para as três modalidades e mix. 235 testes e a compilação passaram. A revisão do PR #317 identificou que um apartamento podia herdar a referência do lote. A correção exige preço unitário ou referência residencial com área privativa e tem teste de regressão.
- (b) Conferência do código e da interface por revisão de implementação. Validação interativa com um empreendimento real pendente.
- (c) Após a revisão GitHub do commit final e preview pronto, mesclar, confirmar publicação do SHA em produção e testar o endpoint de saúde.
