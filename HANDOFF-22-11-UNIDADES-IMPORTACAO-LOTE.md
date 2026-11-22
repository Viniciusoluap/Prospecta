# Unidades à Venda — importação explícita e exclusão em lote

- Atualizar do cenário cadastra lotes novos e reativa registros excluídos que correspondem aos lotes vendáveis do cenário principal. Abrir a aba apenas consulta a lista. As sincronizações automáticas existentes preservam as exclusões.
- Excluir todas faz exclusão lógica das unidades elegíveis no estudo inteiro, com confirmação e registro de auditoria. Vendas, reservas e histórico comercial protegido continuam sujeitos às mesmas proteções da exclusão individual.
- Validação local usa dados sintéticos para reimportar 43 lotes após uma exclusão em massa, manter a unidade avulsa excluída, impedir duplicação e verificar que vendas e reservas permanecem intactas. Nenhuma unidade real foi excluída.
- Sem migração. Próximo passo: concluir revisão e verificar deploy.
