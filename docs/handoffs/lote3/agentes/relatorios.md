# Agente "relatorios" — correções 14 e 18 (Lote 03) — CONCLUÍDO (sem commit; orquestrador commita)

## Arquivos
Prospecta:
- NOVO `shared/financeiro/relatorios-indicadores.ts` (funções puras; gêmeo idêntico do SF salvo o import)
- NOVO `server/relatorios-indicadores.test.ts` (16 testes)
- `server/relatorios-router.ts` (overview: novas consultas; removidos avaliações/imóveis por tipo; `buildCorretorRanking` mantido p/ testes antigos)
- `client/src/pages/admin/AdminRelatorios.tsx` (cards VGV de Obras/Ticket Médio, Números de Obra, Funil, Ranking, Unidades Disponíveis)
Santa Fé (web/):
- NOVO `src/lib/financeiro/relatorios-bpo.ts` (gêmeo), NOVO `src/lib/financeiro/relatorios-bpo-dados.ts` (consultas Prisma)
- NOVOS `src/lib/__tests__/relatorios-bpo.test.ts` (16) e `relatorios-bpo.db.test.ts` (1, banco local)
- `src/app/admin/bpo/page.tsx` (removidas consultas leadsPorStatus/imoveisPorTipo/corretores; chama carregarIndicadoresRelatorios)
- `src/app/admin/bpo/_components/bpo-client.tsx` (só BpoRelatorios, RelatoriosData, imports e constante de cores)
Migrações: nenhuma.

## Regras (iguais nos dois) — ver cabeçalho do módulo
- 14: VGV de Obras = Σ VGV simulado (lead → simulation_value [P] / Lead.orcamento [SF]; sem lead → vgv da obra), obras não canceladas/distrato, VGV>0, período pela data de início (ou criação). Ticket = VGV/nº obras únicas; 0 obras → "—".
- 18.1: Números de Obra = VGV, Financiado, Subsídio, Entrada (VGV−fin−FGTS−subsídio, só com os 4 preenchidos; nota das obras sem dados). Nota "as fatias não somam um total".
- 18.2: etapas do CRM (P LEAD_PIPELINE_STAGES; SF LEAD_STAGES/LEAD_STAGE_CONFIG + etapaDoLead), leads ativos (P deleted_at; SF leadNoPipelineAtivo), criados no período; sem etapa → "Aguardando classificação".
- 18.3: pagamentos confirmados de comissão das obras (corretor do lead) + comissões cadastradas "paga" por data de pagamento; comissão cadastrada de obra com pagamento é ignorada (sem duplicar); ordena antes do limite (5); vazio → "Nenhuma comissão paga no período".
- 18.4: retrato atual; incorporação disponivel/reservada/vendida sem tombstone; catálogo só aprovados e sem ponto de localização de obra; SF venda/lancamento/locacao→disponível, vendido/locado→vendido; P alugado→vendido. Não há vínculo imóvel↔unidade nos dois sistemas (dedup documentada; parâmetro `vinculadoAUnidade` pronto).

## Testes
(a) automáticos: P `pnpm vitest run server/relatorios-indicadores.test.ts server/relatorios.test.ts server/relatorios-comissoes.test.ts` 35/35; `pnpm check` ok. SF unit 16/16 + DB 1/1 (banco local); `npx tsc --noEmit` ok; eslint ok nos arquivos.
(b) manuais: nenhum (tela não aberta no navegador).
(c) produção: conferir valores reais (P: comissões vêm de obra_movimentos; SF: Comissao + movimentos).

## Decisões automáticas
- [AUTO-DECISION] SF VGV simulado = Lead.orcamento (código `vgvSimuladoDoLead`, correção 22/10), não valorAprovado.
- [AUTO-DECISION] Ranking soma valor pago (inclui comissão parcialmente paga), pois o período é pela data do pagamento.
- [AUTO-DECISION] "distrato" (só P) tratado como cancelada.
- [AUTO-DECISION] SF não tem filtro De/Até nos Relatórios: usa o período fixo da tela (12 meses). Paridade do filtro = pendência.
- Ticket Médio da P deixou de ser receita/transações e passou a VGV/obras (pedido 14).

## Pendências
- SF: filtro De/Até nos Relatórios (P tem). - P: overview não testado contra banco (só typecheck + funções puras).
