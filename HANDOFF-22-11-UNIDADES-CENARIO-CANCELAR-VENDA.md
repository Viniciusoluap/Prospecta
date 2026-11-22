# Unidades à Venda — cenário principal e cancelamento de venda

- A atualização usa a mesma leitura do Estudo de Massa principal salvo e mantém o cenário legado e os lotes avulsos como fontes alternativas. O total do cenário é exibido separado do total do inventário.
- Cancelar venda exige confirmação e a revisão atual da unidade. A unidade volta a ficar disponível, com os dados da venda preservados no histórico. A exclusão lógica fica disponível após o cancelamento e continua respeitando reservas, vendas ativas e exclusões já gravadas.
- Testes automáticos focados com banco em memória: cenário principal com 43 lotes e legado com um lote, repetição da sincronização e cancelamento seguido de exclusão com auditoria. O cenário comercial do print não foi alterado em produção.
- Não exige migração. Próximo passo: concluir a revisão do PR, publicar e conferir o deploy.
