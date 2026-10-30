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
- Commit Prospecta: `d3e5d52`.

## Etapa 2 — Santa Fé (modal compartilhado + telas de foco) — CONCLUÍDA
- NOVO `web/src/components/ui/modal.tsx` (`Modal`, `classesPainelModal`, `CLASSES_FUNDO_MODAL`): largura `w-full` + `sm:max-w-*` por tamanho, altura `max-h-[calc(100dvh-1.5rem)]` com rolagem interna, topo no celular/centro do `sm` em diante, `[&>*]:min-w-0`, Esc fecha, trava a rolagem do fundo, foco no painel, role/aria. Equivalente ao `DialogContent` da Prospecta.
- Overlays migrados (8 de 16): BPO `bpo-client.tsx` (Registrar baixa, Editar lançamento, Novo lançamento), `bancos-panel.tsx` (4 modais via wrapper), `barra-lote.tsx` (lote/combinar/excluir tudo), `vinculo-cliente.tsx` (Sugerir vínculos); Obras `financeiro-obra.tsx` (3 modais), `obra-diario-client.tsx`; `comissao-form.tsx`; `processo-regularizacao.tsx`.
- Grades: Editar/Novo lançamento, Nova conta, Recebimento da obra → `grid-cols-1 sm:grid-cols-2`; investidores `md:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)_auto]`; gerador PCI serviços adicionais responsivo; cards de KPI (BPO contabilidade, BPO cliente, Obras) com `[&>*]:min-w-0 [&_p]:break-words`; selects dos filtros de Cobranças/Despesas `min-w-[140px] max-w-full flex-1 sm:flex-none`; tabelas de movimentações/prévia de extrato com `overflow-auto` + `min-w`.
- `globals.css`: mesma regra global de datas/selects da Prospecta (em `@layer base`).
- Numérico: `formatArea`/`formatPercent` sempre 2 casas ("1.000.000,00 m²", "6,00%"; NaN → "0,00%", igual à Prospecta); `bpo/[id]/page.tsx` Valor do lançamento `type=number` → `CurrencyInput`; regularização Progresso `type=number` → `NumeroInput` (casas 0, %).
- `type="number"` restantes no SF (21): todos contagens/inteiros — quartos/banheiros/vagas/suítes (imóveis, avaliações, corretor), dia de vencimento (1–28), ano do extrato, meses/prazos/unidades/quantidades e notas 0–5/0–3 da incorporação, eixo de gráfico (recharts). Mantidos de propósito (regra: não aplicar a contagens/ano/IDs). Mesma situação na Prospecta.
- Commits SF: `e02ea0a`, `dcc4ef4` (wip automático com Obras/Comissões), `ff1a100`.

## Etapa 3 — Validação visual automática (Playwright/Chromium) — CONCLUÍDA
- Prospecta: `node scripts/layout-check/check.mjs [pasta]` (build Vite de um harness com os componentes reais: Dialog, Input, Select Radix, CurrencyInput, PercentInput). Casos: Editar lançamento (+ abre o Select e confere que o menu fica na tela), modal tributário, filtros + tabela. 9/9 OK (390x844, 820x1180, 1440x900). Commit `1b545fd`.
- SF: `node scripts/layout-check/check.mjs [pasta]` (em `web/`; HTML via `renderToStaticMarkup` com `Modal`/CurrencyInput/PercentInput reais + CSS compilado pelo `@tailwindcss/postcss` do projeto). Casos: Editar lançamento, Nova despesa longa (rolagem interna), filtros + tabela. 9/9 OK. Commit `ff1a100`.
- Verificações: sem rolagem horizontal da página; painel dentro da largura e altura da tela; rolagem interna; todos os campos/botões dentro do contêiner; tabela rola sozinha; valores exibidos "1.234.567,89", "98.765,43", "6,00".
- Limitação: só Chromium está instalado (`/opt/pw-browsers`); WebKit/Safari real não foi exercitado — a regra iOS de datas (`@supports (-webkit-touch-callout: none)`) depende de validação em iPhone/iPad reais. As telas completas não sobem localmente sem banco/autenticação; o harness cobre a base compartilhada com a marcação das telas de foco.

## Testes
- (a) Automáticos: Prospecta `pnpm check` OK; `pnpm vitest run` completo 167 arquivos / 1304 testes OK. SF `npx tsc --noEmit` OK; `npx eslint` nos arquivos tocados sem erros (1 aviso pré-existente `pagos` em `bpo/[id]/page.tsx`, 1 `<img>` pré-existente em medicao-caixa); `npx vitest run` sem os `.db.test` 140 arquivos / 1020 testes OK (inclui novos `modal-compartilhado.test.ts`, `utils.test.ts` e `numero-mascara.test.ts` atualizados). Playwright 9/9 + 9/9.
- (b) Manuais: inspeção das capturas 390x844 e 820x1180 (modal centralizado/rolando, select dentro da tela, prefixo R$ e sufixo %).
- (c) Pendente em produção: Safari iPhone/iPad reais (datas `date`/`month` com a regra iOS), telas completas com dados reais.

## Pendências (com motivo)
- SF: 8 overlays fora das telas de foco ainda com `fixed inset-0` próprio — `agenda-client`, `usuarios-client`, `corretores-client` (2), `contrato-documentos`, `contrato-editar-excluir`, `projeto-revisoes`, `avaliacoes sugestao-btn`/`zap-btn`, `whatsapp/conversas-whatsapp` (5, visualizadores de mídia em tela cheia), `admin-shell` (modal da sessão). Migrar para `@/components/ui/modal` no mesmo padrão (trocar o par de `div` externos por `<Modal rotulo=… onFechar=… tamanho=…>`).
- Exibição de áreas da incorporação (relatório/quadro de áreas/terreno) usa m² arredondado ao inteiro nos dois sistemas (relatórios gêmeos); não alterado neste lote para não divergir do relatório PDF validado — avaliar com o dono se deve passar a 2 casas.
- SF não tem exportação CSV de comissões em Relatórios (a Prospecta tem e agora exporta 1.234,56); paridade é do grupo Relatórios.

## Próximo passo exato
- Orquestrador: atualizar `MASTER_STATUS.md` (linha 11 e Padronização numérica → "Testada (Chromium); pendente Safari real"); depois migrar os overlays pendentes do SF listados acima e rodar `node scripts/layout-check/check.mjs` nos dois repositórios.
