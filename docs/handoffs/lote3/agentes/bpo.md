# Checkpoint — agente BPO (correções 12, 17, 13, 16, 15)

- Branch: `claude/lote3-18-correcoes-20261029` (worktrees Prospecta-lote3 e Grupo-Santa-Fe-lote3). Sem commits (orquestrador commita).
- Migrações reservadas: P `drizzle/0095_bpo_lote3.sql`; SF `web/prisma/migrations/20261029111000_bpo_lote3/`.

## Estado
- [x] 12 Categorias (P / SF) — código feito; testes pendentes
- [x] 17 Vínculo Cadastro livre → CRM (P / SF) — código feito; testes pendentes; botão "Sugerir vínculos" entra na barra do item 16
- [ ] 13A Pluggy sem pageSize (P / SF)
- [ ] 13B Exclusão de conta com EXCLUIR (P / SF)
- [ ] 16 Seleção/exclusão em lote + combinar pagamentos (P / SF)
- [ ] 15 DRE filtro mês/ano (P / SF)

## Arquivos (até agora)
- P: shared/financeiro/bpo-operacional.ts (categorias sem vínculo + categoriaContabilDaOperacional), server/bpo-router.ts (categoria derivada, categoriaNaEdicao, catálogo com leadId, procedures sugestoesCliente/vincularCliente/previaVinculos/aplicarVinculos), server/bpo-auditoria.ts (centro_custos preservado), client/src/components/bpo/CamposCategoriaLancamento.tsx, client/src/components/bpo/VinculoClienteLancamento.tsx, client/src/pages/admin/AdminBpo.tsx, shared/financeiro/bpo-vinculo-cliente.ts, server/bpo-vinculo-cliente.ts, server/db.ts + server/bpo-extrato.ts (ocultar combinadas), drizzle/0095_bpo_lote3.sql, drizzle/schema.ts.
- SF: src/lib/bpo-operacional.ts, src/lib/actions/bpo.ts, src/app/admin/bpo/_components/campos-operacionais.tsx, bpo-client.tsx (modais), src/lib/bpo-vinculo-cliente.ts, src/lib/actions/bpo-vinculo.ts, _components/vinculo-cliente.tsx, prisma/schema.prisma, prisma/migrations/20261029111000_bpo_lote3.

## Decisões
- "projetos" (cobrança, vínculo com projeto cadastrado) mantido; "projetos_taxas" = "Projetos e taxas" sem vínculo (taxas/ART/alvará).
- Mapeamento: empreiteiro → "Mão de obra" (mesma família do extrato). Cobrança: financiamentos → Financiamento/CAIXA, demais → Recebimento de cliente.
- Edição mantém a `categoria` gravada e só recalcula se a operacional/tipo de despesa muda.
- Integração (cliente atribuído à movimentação bancária/regra por titular) conta como sinal forte (ID da integração).

## Em execução
- 13A/13B.
