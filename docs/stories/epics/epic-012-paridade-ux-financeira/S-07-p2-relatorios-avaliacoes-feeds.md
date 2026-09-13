# S-07 — P2: Relatórios, Avaliações em lote e acesso administrativo a Feeds

**Status:** Done
**Etapa:** 5

## Relatórios e exportações

- módulo novo `/admin/relatorios`, permissão dedicada (`relatorios`) no catálogo RBAC;
- indicadores: imóveis (total e por tipo), leads (total e funil por etapa própria da esteira de crédito da Prospecta), financiamentos (total), avaliações (total, média do valor estimado e por status);
- DRE mensal (receitas × despesas) a partir de `financial_transactions` (`status = paid`, agrupado por `competency`), com filtro de período (`from`/`to`, padrão 12 meses corridos);
- gráficos: tendência de receita (área), DRE mensal (barras), imóveis por tipo (pizza), avaliações por status (pizza), funil de leads (barras horizontais), ranking de corretores por comissão paga;
- exportação CSV das comissões de corretores, gerada no navegador (sem rota Express dedicada — mesmo dado de `broker_commissions`, sem duplicar lógica de agregação do servidor).

## Avaliações — edição dedicada e laudos em lote

- tela dedicada `/admin/avaliacoes/:id/editar` para os dados gerais (tipo, finalidade, metodologia, avaliador, cliente, imóvel, vínculo de lead, prazos, valor do serviço, observações) — a mutação `avaliacoes.update` já cobria todos os campos, faltava a tela;
- laudo individual `/admin/avaliacoes/:id/laudo` e laudo em lote `/admin/avaliacoes/laudos?ids=...` (até 20 registros), ambos como página HTML estilizada para impressão (`window.print()`), replicando o padrão do Grupo Santa Fé — não gera PDF via biblioteca;
- corpo do laudo compartilhado entre emissão individual e em lote (`LaudoAvaliacao`), evitando a duplicação encontrada na origem;
- seleção múltipla com checkboxes na listagem e botão "Baixar Laudos (N)".

## Agregador / Feeds — gestão administrativa

- tela nova `/admin/agregador`, consumindo o backend já existente (scraper com proteção SSRF, CRUD, fluxo pendente → verificado → importado → arquivado) sem alterações de schema ou regra de negócio;
- cadastro manual com preenchimento automático a partir de uma URL (`agregador.scrape`);
- filtros por fonte e status, indicadores e ações por linha conforme o status atual.

## Decisões de implementação (adaptações deliberadas, não invenção)

- O funil de leads usa as 11 etapas já existentes da esteira de crédito da Prospecta (`lead_new` → `done`), não o funil simplificado do Santa Fé (`novo/contato/visita/proposta/fechado/perdido`) — os dois sistemas têm modelos de CRM genuinamente diferentes (Santa Fé é corretagem, Prospecta é financiamento), então a métrica replicada é "funil de conversão", não os rótulos literais.
- "Ranking de corretores por comissão paga" usa `broker_commissions` (o modelo de comissão por projeto/parcela já existente na Prospecta), não um novo modelo `Comissao` — a reestruturação de Corretores/Comissões é escopo da Etapa 4 (Codex, em andamento); evitou-se colidir com esse trabalho paralelo.
- Sem endpoint HTTP dedicado para exportação CSV (a origem usa uma rota Next.js) — o mesmo resultado é obtido no navegador a partir dos dados já retornados por tRPC, evitando duplicar a autenticação/agregação em uma segunda rota Express.
- Laudo em HTML+CSS de impressão, não jsPDF — replica fielmente o mecanismo real da origem (`window.print()`), que não usa nenhuma biblioteca de PDF para este módulo específico.

## Gates

- TypeScript sem erros;
- 285 testes automatizados aprovados (8 novos: `relatorios.test.ts`, `agregador-admin.test.ts`), cobrindo RBAC granular das novas rotas;
- build Vite e bundle do servidor aprovados;
- `git diff --check` aprovado;
- sem migration — nenhuma tabela nova ou alterada nesta história.

**Não testado nesta sessão:** navegação em navegador real (sandbox sem acesso à internet externa, mesma limitação já documentada nas etapas anteriores); UAT autenticado por papel pertence à Etapa 6.
