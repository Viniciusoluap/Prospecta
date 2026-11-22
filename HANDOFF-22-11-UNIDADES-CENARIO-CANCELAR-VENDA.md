# Unidades à Venda — cenário principal e cancelamento de venda

- A atualização usa a mesma leitura do Estudo de Massa principal salvo e mantém o cenário legado e os lotes avulsos como fontes alternativas. O total do cenário é exibido separado do total do inventário.
- Cancelar venda exige confirmação e a revisão atual da unidade. A unidade volta a ficar disponível, com os dados da venda preservados no histórico. A exclusão lógica fica disponível após o cancelamento e continua respeitando reservas, vendas ativas e exclusões já gravadas.
- Testes automáticos focados com banco em memória: cenário principal com 43 lotes e legado com um lote, repetição da sincronização e cancelamento seguido de exclusão com auditoria. O cenário comercial do print não foi alterado em produção.
- Não exige migração. Os 41 testes focados e o TypeScript passaram. Revisão concluída sem apontamentos.

- Produção: PR #311 mesclado em ca12fbd9978f7812edbf6771022836ad4c5b4570. Deploy dpl_3egvaCk5i2apjgqFXikajBTMDMRs READY. A API respondeu 200 com banco conectado. Entrega concluída.
