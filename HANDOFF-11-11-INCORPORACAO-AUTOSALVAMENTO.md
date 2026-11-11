# Handoff — Salvamento automático da Incorporação

## Concluído

- Dados Gerais e os formulários das etapas da Incorporação gravam após 700 ms sem alterações. Lotes avulsos gravam automaticamente depois de Adicionar, Atualizar ou Remover.
- A fila por formulário espera a resposta do servidor antes de gravar a edição seguinte. O aviso desaparece após a confirmação. Uma falha conserva a edição e oferece nova tentativa.
- A navegação entre etapas mantém os formulários pendentes montados. O botão Voltar espera as gravações e a saída com alterações pendentes recebe aviso.
- Pesquisas e simulações continuam como operações explícitas. O salvamento/versionamento de estudos de massa e a confirmação comercial de unidades usam seus controles existentes.
- Due Diligence preserva a checagem de concorrência, inclusive antes de anexar. Exclusão de proposta mantém a rota com auditoria.

## Testes

- (a) TypeScript, build Vite e 81 testes direcionados passaram. A fila tem regressões para edição concorrente, falha, reenvio e conteúdo intacto.
- (b) DOM com API simulada: digitou em Dados Gerais, trocou de aba durante o envio, confirmou a última edição, simulou falha e validou nova tentativa e remoção do aviso.
- (c) Após o deploy, conferir no iPad com um estudo de teste e verificar a gravação após recarregar.

## Próximo passo

- Acompanhar o deploy de produção da Prospecta e confirmar a resposta da API. Portar o mesmo comportamento ao Grupo Santa Fé quando a frente correspondente for atualizada.
