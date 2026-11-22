# Unidades à Venda — importação explícita e exclusão em lote

- Atualizar do cenário cadastra lotes novos e reativa registros excluídos que correspondem aos lotes vendáveis do cenário principal. Abrir a aba apenas consulta a lista. As sincronizações automáticas existentes preservam as exclusões.
- Excluir todas faz exclusão lógica das unidades elegíveis no estudo inteiro, com confirmação e registro de auditoria. Vendas, reservas e histórico comercial protegido continuam sujeitos às mesmas proteções da exclusão individual.
- Validação local usa dados sintéticos para reimportar 43 lotes após uma exclusão em massa, manter a unidade avulsa excluída, impedir duplicação e verificar que vendas e reservas permanecem intactas. Nenhuma unidade real foi excluída.
- Sem migração. 43 testes focados e TypeScript aprovados. Revisão concluída sem apontamentos.

- Produção: PR #312 mesclado em 337e10b2930b122825da4dcca9dfecd4bfd6d77b. Deploy dpl_CpB4PxiqZgadDW44JTNGvtNqb36n READY. API respondeu 200 com banco conectado. Entrega concluída.
