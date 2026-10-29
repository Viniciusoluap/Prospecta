# Checkpoint — agente LAYOUT (correção 11 + padronização numérica global)

- Branch: `claude/lote3-18-correcoes-20261029` (worktrees `/home/user/Prospecta-lote3` e `/home/user/Grupo-Santa-Fe-lote3`). Sem migrações.

## Etapa 1 — Prospecta (base compartilhada + telas de foco) — CONCLUÍDA
- `client/src/index.css`: regra global (camada base) para `input[type=date|month|time|week|datetime-local]` e `select` (`min-width:0; max-width:100%`; no iOS/iPadOS sem aparência nativa + altura mínima) — corrige datas cortadas/empurrando grade no Safari.
- `components/ui/dialog.tsx`, `alert-dialog.tsx`: `[&>*]:min-w-0` (já tinham max-h + overflow-y-auto); `sheet.tsx`: `max-h-dvh overflow-y-auto`.
- `select.tsx`, `dropdown-menu.tsx`, `popover.tsx`: `collisionPadding=8` padrão + `max-w-[calc(100vw-1rem)]` (menu nunca sai da tela); popover com `max-h` disponível + rolagem.
- Grades fixas → responsivas (`grid-cols-1 sm:grid-cols-2`, `col-span-2` → `sm:col-span-2`): `AdminBpo.tsx` (cliente, novo lançamento, editar lançamento), `AdminFinanceiro.tsx`, `BancosPanel.tsx`, `FinanceiroObra.tsx`; `GeradorPciAba.tsx` serviços adicionais (`grid-cols-1 sm:grid-cols-[minmax(0,1fr)_160px]`).
- `TaxAccountingPanel.tsx`: 3 modais tributários `sm:max-w-2xl`; cards `sm:grid-cols-2 xl:grid-cols-4`.
- `BancosPanel.tsx`: tabelas de movimentações e prévia de extrato com `overflow-auto` + `min-w-[...]` (rolagem horizontal em vez de esmagar colunas).
- Numérico: `lib/format.ts` `formatPercent` sempre 2 casas ("6,00%"); `AdminRelatorios.tsx` CSV de comissões exporta "1.234,56" (antes "1234.56"); `AdminComissoes.tsx` percentual com 2 casas; `ProcessoRegularizacao.tsx` progresso `type=number` → `NumeroInput` (casas 0, sufixo %, 0–100).
- `type="number"` restantes na Prospecta são contagens/inteiros (quartos, banheiros, vagas, meses, unidades, notas 0–5/0–3, dia de vencimento, ano do extrato) ou sorteios/UTEF (exceção do ROADMAP) — mantidos de propósito.

### Testes (a) automáticos
- `pnpm check` OK. `pnpm vitest run server/format.test.ts server/numero-mascara.test.ts` 46/46 OK (format.test atualizado para o padrão de 2 casas; novo caso de ida-e-volta exportação 1.000.000,00 sem erro de ponto flutuante).
