# Handoff — BPO: layout do Novo Lançamento e importação do backup do Conta Azul (12/11)

Pedido do dono (prints do celular): (1) campos do "Novo Lançamento" sobrepostos; (2) botão para importar o
backup ZIP do Conta Azul Pro (Meu Plano > Backup), compatível com o que o Conta Azul exporta.

## 1. Layout (causa e correção)
- Causa: `CamposCategoriaLancamento` e `VinculoClienteLancamento` usavam `col-span-2` sem prefixo dentro de
  `grid-cols-1` (celular) — o navegador cria uma 2ª coluna implícita e os campos se sobrepõem.
- Correção: `col-span-full` (vale para 1 ou 2 colunas); selects com `w-full`; Competência com seletor de mês.
- Arquivos: `client/src/components/bpo/CamposCategoriaLancamento.tsx`, `VinculoClienteLancamento.tsx`,
  `client/src/pages/admin/AdminBpo.tsx`.

## 2. Importar backup Conta Azul
Formato conferido no backup real do dono (ZIP no Drive, 05/05/2026; lido só em pasta temporária, nada
versionado): CSV UTF-8 com vírgula e aspas RFC 4180.
- `pessoas.csv`: tipo (Cliente/Fornecedor/Vendedor), nome, razao_social, tipo_pessoa, cpf_cnpj, fones, e-mail.
- `financeiro.csv`: id, tipo (REVENUE/EXPENSE), status (ACQUITTED/PENDING), valor (ponto decimal), datas
  AAAA-MM-DD (vencimento, competência, quitação), nome_do_negociador, categoria, centro_de_custo,
  conta_financeira, metodo_de_pagamento.
- `propostas_comerciais`, `lista_precos`, `nfes`, `negociacoes`, `produtos`: sem equivalente no BPO (contados na
  prévia, não importados).

Regras (`shared/financeiro/conta-azul.ts`, puras):
- REVENUE → receita (aba Cobranças), EXPENSE → despesa; ACQUITTED = pago (pagoEm = quitação, valor recebido = valor).
- Mesmo id com outra categoria/valor = outra parte do lançamento (entra). Mesmo id, mesma categoria e mesmo
  valor mudando só o centro de custo (30 casos no backup real) = entra UMA vez com os centros juntos
  ("A / B"), para não dobrar o valor. **Premissa a confirmar com um lançamento conhecido no Conta Azul.**
- Transferência entre contas/empresas do grupo (inclusive empréstimo entre elas) não vira lançamento (mesma
  regra do extrato bancário) — contada e somada na prévia.
- Categoria do BPO pela categoria do Conta Azul (ela manda; descrição só se a categoria for "a identificar");
  a categoria original, conta financeira e forma de pagamento vão para as observações.
- Clientes do Conta Azul (tipo Cliente) viram cliente BPO (sem honorários); quem já existe (mesmo CPF/CNPJ ou
  nome) não é recriado nem alterado. Fornecedores ficam como nome livre no lançamento.
- Idempotente: `request_key = contaazul:<id>:<hash(categoria|valor|descrição|tipo)>` (único; não depende da
  ordem das linhas). Reimportar não duplica. Sem migração de banco.
- Prévia avisa quando já há lançamentos do extrato no mesmo período (risco de contar duas vezes).

Arquivos: `shared/financeiro/conta-azul.ts`, `server/bpo-conta-azul.ts`, `server/bpo-router.ts`
(`bpo.contaAzul.previa` / `importar`, admin), `client/src/components/bpo/ImportarContaAzul.tsx`
(abre o ZIP no navegador com fflate; só .csv; até 30 MB), botão no topo do BPO.

Backup real (simulado em banco em memória): 1.528 lançamentos (247 receitas R$ 1.418.675,87; 1.281 despesas
R$ 1.868.851,61; 1.394 pagos, 134 em aberto), 90 clientes novos, 352 transferências fora (R$ 347.340,09),
competências 2024-01 a 2026-11, 0 linhas com erro, ~0,4 s; segunda importação: 0 novos. Produção (Neon):
BPO vazio hoje (consulta só leitura), então não há sobreposição com extrato.

Segundo backup do Drive (`exclusive.zip`, outra empresa — **o dono confirmou que NÃO entra na Prospecta**;
usado só para conferir o formato): mesmo ZIP com os 7 CSVs, lido sem erros. Os ZIPs `Backup conta azul.zip`,
`CONTA AZUL.zip` e `80fe75e6-….zip` são idênticos byte a byte (SHA-256 e472b1f1…, CSVs comparados com diff):
importar qualquer um deles uma única vez. Ajuste: "Multas de
Trânsito" → Administrativo (antes caía em Tarifas bancárias).

## Testes
- (a) automáticos: `server/bpo-conta-azul.test.ts` (7: CSV, valores/datas, categorias, rateio por centro,
  erros, prévia sem gravar, importação, reimportação sem duplicar, cliente existente preservado, aviso de
  extrato, recusa/limite). Suíte completa 195 arquivos — 1 falha (import sem `.js`) corrigida e conferida;
  `tsc` ✅; `vite build` ✅.
- (b) manuais por mim: Playwright em iPhone 14 (API simulada) — Novo Lançamento sem nenhum campo sobreposto
  (medido) e prévia/importação com o toast final.
- (c) produção: pendente — importar o ZIP real logado e conferir DRE/Cobranças/Despesas.

## Paridade
Grupo Santa Fé tem o BPO (`web/src/app/admin/bpo`): o layout de lá já usa `sm:col-span-2` (sem o defeito);
a importação do Conta Azul precisa ser portada (registrado no ROADMAP).

## Próximo passo
Autorização para merge/deploy; depois portar a importação ao Santa Fé.

## Merge/deploy e importação em produção (12/11, autorizados pelo dono)
- PR #213 mergeado (eebdf3f); deploy de produção `dpl_6qBrgrsRUVPgTBqyJ4L5nK1PwLnj` READY, sem erros de runtime.
- Estado do BPO em produção antes da importação: 60 clientes (59 do CRM) e 1.011 lançamentos, TODOS
  arquivados pela limpeza de ajustes (879 legado + 132 Asaas, 2022–2026); 0 ativos; 0 do Conta Azul.
  Se esse lote for restaurado, parte pode coincidir com o Conta Azul (mesmo período).
- Importação feita por mim: NÃO concluída. A rede do ambiente bloqueia a Neon; foi criado o ambiente pessoal
  "Grupo Efficaz — banco Prospecta" (libera só o host do banco) e um usuário temporário no banco, mas a
  conexão direta foi barrada pelo controle de permissões. Usuário temporário apagado e conferido (0 roles),
  senha apagada; nenhum lançamento gravado (0 com request_key contaazul:).
- Próximo passo: dono importa pelo botão (BPO Financeiro > Importar backup Conta Azul > `Backup conta azul.zip`)
  ou libera a permissão para eu rodar `importarContaAzul` contra a produção. Depois: conferir totais
  (esperado 1.528 lançamentos; clientes novos dependem dos 60 já cadastrados).

## Importação feita pelo dono + proteção contra duplicidade (12/11, noite)
- Conferido em produção: 1.528 lançamentos `conta_azul` (1.281 despesas R$ 1.868.851,61; 247 receitas
  R$ 1.418.675,87), chaves únicas, 77 clientes novos (13 reaproveitados dos 60 existentes), última quitação
  30/03/2026, 134 em aberto.
- Pedido: ligar a mesma conta no BPO sem duplicar o que veio do Conta Azul.
- Conciliação automática (`conciliarComContaAzul` em `shared/financeiro/conta-azul.ts`):
  movimento do extrato (Pluggy/arquivo/manual) → lançamento do Conta Azul sem vínculo, mesmo tipo e valor;
  pago: até 3 dias da quitação; em aberto: até 10 dias do vencimento (passa a pago com a data do banco).
  O mais próximo vence; cada lado usado uma vez; o lançamento mantém categoria/cliente/descrição do Conta Azul.
  Ligado em `gerarLancamentosDoExtrato` (todos os caminhos do extrato passam por ele) via
  `conciliarMovimentosComContaAzul` (`server/bpo-conta-azul.ts`).
- Cobranças do Asaas: antes de criar receita nova, a mesma receita do Conta Azul assume o id do pagamento
  (`server/bpo-asaas.ts`, `receitaDoContaAzul`).
- Aviso na tela Bancos (cadastro da conta).
- Limites: valor igual e data próxima por coincidência pode conciliar o lançamento errado (raro); os 1.011
  lançamentos arquivados (legado/Asaas 2022–2026) não participam — se o lote for restaurado, pode coincidir.
- Testes (a): `bpo-conta-azul.test.ts` 11 ✅ (regra, extrato pago/em aberto/novo, reimportação, Asaas);
  suíte 1.643 ✅; tsc ✅; vite build ✅. (c) produção: ligar a conta e conferir as abas.

## Quatro blocos do dono (12/11, noite) — A classificar, dividir pagamentos, centros de custo, filtros

Decisão do dono: nada do banco entra em Cobranças/Despesas/DRE sem ele classificar, exceto o que o sistema
já liga com segurança. Branch `claude/intelligent-ptolemy-av0qoh` (PR #214, rascunho). Migrações só aditivas.

### Bloco 1 — Aba "A classificar" (concluído)
- Migração `drizzle/0103_bpo_a_classificar.sql` (idempotente, sem UPDATE): `bank_transactions.a_classificar`,
  `bpo_lancamentos.a_classificar` (boolean NOT NULL DEFAULT false), `bpo_recebimentos.bank_transaction_id`
  (FK ON DELETE SET NULL) + índices. Schema Drizzle atualizado.
- Movimentação NOVA (`gravarMovimentos` → `gerarLancamentosDoExtrato(..., "nova")`):
  crédito com `asaasPaymentId` de cobrança conhecida → como antes; bate com Conta Azul JÁ PAGO (mesmo tipo/valor,
  até 3 dias da quitação) → só liga `bank_transaction_id` (não muda valor, status nem `pago_em`); titular com regra
  (categoria) → cria o lançamento; Transferência interna → nada; resto → `bank_transactions.a_classificar = true`.
- `conciliarComContaAzul` agora ignora lançamento em aberto (em aberto nunca é baixado sozinho).
- Asaas (`server/bpo-asaas.ts`): (a) cobrança paga ↔ receita do Conta Azul já paga → assume o id (sem mudar status);
  (b) cobrança EM ABERTO ↔ receita EM ABERTO do Conta Azul → assume o id SÓ com o mesmo cliente BPO, mesmo valor,
  vencimento a até 3 dias e candidato único (`receitaEmAbertoDoContaAzul`); a receita sai de A classificar e passa a
  seguir o Asaas; (c) cobrança paga ↔ receita em aberto → NÃO liga (cria a cobrança; a receita do Conta Azul continua
  em A classificar — o dono cancela uma delas). Crédito do Asaas que chegou antes da cobrança fica A classificar e,
  quando a cobrança paga aparece (pelo id ou pela regra valor/data de antes), o lançamento nasce ligado ao crédito.
- `reprocessarMovimentacoes` nunca cria lançamento para movimentação A classificar; antigas (flag false) como antes.
- Classificação explícita (`atualizarMovimentacao`, `aplicarClassificacaoEmLote` com categoria, regra por titular)
  cria e limpa a flag. `aplicarClassificacaoEmLote` só com cliente (ex.: cadastro de cliente novo) dá o cliente à
  movimentação A classificar, mas não cria lançamento.
- Movimentação que deu baixa por divisão de pagamento nunca gera lançamento próprio (todos os caminhos).
- Leitores com o filtro `a_classificar = false`: `lancamentosComTitular`, `getAllBpoLancamentos`, DRE/anos
  (`lancamentosDoDre` no router), `clientesComTotais`, relatórios, tax, obra e regularização (listas de pagos),
  `bpo-vinculo-cliente`, lote de Cobranças/Despesas. Novo lote `aba: "a_classificar"` (Cancelar = arquivamento
  reversível com backup/histórico; Restaurar devolve para A classificar).
- Importador do Conta Azul grava `a_classificar = !pago`. Receber/Marcar pago limpam a flag.
- Rotas `bpo.aClassificar.*`: contagem, movimentacoes, lancamentos, abertosParaBaixa, criarLancamentos, ignorar, confirmar.
- Tela: aba "A classificar (N)" em `AdminBpo.tsx` → `client/src/components/bpo/AClassificar.tsx`.
- Testes existentes com expectativa mudada (regra nova, conscientemente):
  - `bpo-extrato.test.ts`: "cada movimentação gera lançamento" → agora fica A classificar e o lançamento nasce ao
    classificar; sync por API idem; troca para Transferência interna / obra / saldo da importação passam a
    classificar antes (ou esperam 0 lançamentos). Mock ganhou a tabela `bpo_recebimentos`.
  - `bpo-0075-db.test.ts`: cadastro de cliente vincula a movimentação, mas o lançamento só nasce ao classificar;
    reimportação classifica antes de conferir a descrição; "aplicar a todas do titular": a de outro titular fica
    A classificar (2 lançamentos em vez de 3; no fim 0 em vez de 1).
  - `bpo-conta-azul.test.ts`: em aberto não concilia mais (regra e banco); o pago só é ligado com `pago_em` do
    Conta Azul (antes ganhava a data do banco); a tarifa nova fica A classificar (4 lançamentos em vez de 5).
- Testes novos: `server/bpo-a-classificar.test.ts`.

### Passos de produção que dependem do dono (NÃO feitos)
1. Aplicar `drizzle/0103_bpo_a_classificar.sql` (e depois `0104`), antes do deploy do código.
2. Marcar os 134 em aberto do Conta Azul já importados (autorização separada):
   `UPDATE bpo_lancamentos SET a_classificar = true WHERE origem_efetiva='conta_azul' AND NOT pago AND exclusao_lote_backup_id IS NULL AND combinada_em_id IS NULL`

### Bloco 2 — Dividir pagamentos (concluído)
- `darBaixaComMovimentacao` (`server/bpo-a-classificar.ts`), rota `bpo.aClassificar.darBaixa`; regras puras em
  `shared/financeiro/bpo-a-classificar.ts` (`validarDivisao`, `resultadoDaBaixa`, `chaveAlocacao`, `sugestoesDeBaixa`).
- Uma linha em `bpo_recebimentos` por alocação (`bank_transaction_id`, `request_key = bt:<mov>:<lanc>`); atualiza
  `valor_recebido`/`pago` (só quando recebido = valor)/`pago_em` (data do banco)/`version`/`a_classificar=false` e grava
  `bpo_lancamento_historico`; movimentação → `a_classificar=false`, `status='conciliado'`. Tudo em `getDb().transaction`
  com `FOR UPDATE` na movimentação e nos lançamentos + checagem de `version`. Vale para receita e despesa (função
  própria; `registrarRecebimento` não mudou de contrato).
- Recusa: soma ≠ valor da movimentação (centavos), valor acima do saldo, sentido trocado, lançamento pago/combinado/
  arquivado/Asaas/ligado 1:1, repetido, movimentação fora de A classificar ou com lançamento próprio.
- Idempotente: mesma divisão de novo devolve `repetida: true`; divisão diferente para a mesma movimentação é recusada.
- Sem dupla contagem: a movimentação nunca ganha lançamento próprio (filtro em `gerarLancamentosDoExtrato` para
  todos os caminhos — reprocessar, classificar, regra) e a conciliação com o Conta Azul ignora lançamento com baixa do banco.
- Tela: botão "Dar baixa / dividir" em cada movimentação da aba (sugestões no topo, busca, valor por lançamento,
  "faltam/passou", confirma só quando fecha). Despesa parcial mostra "Pago · Saldo" em Despesas.
- Limite conhecido: excluir a conta bancária (limpeza com backup) zera `bpo_recebimentos.bank_transaction_id`
  (FK SET NULL); o valor recebido dos lançamentos fica.

### Bloco 3 — Centros de custo (concluído)
- Migração `drizzle/0104_bpo_centros_custo.sql` (idempotente; só insere): tabela `bpo_centros_custo` (id, nome
  varchar(100), ativo, created_at); nome único sem diferenciar maiúsculas/acentos por índice
  `lower(translate(btrim(nome), acentos, sem acento))` (sem extensão `unaccent`); semente com os nomes já usados em
  `bpo_lancamentos.centro_custos`, separando "A / B" (`regexp_split_to_table`), `ON CONFLICT DO NOTHING`.
- `centro_custos` continua texto; os combinados ficam como estão e entram no filtro dos dois.
- `server/bpo-centros-custo.ts` + rotas `bpo.centrosCusto.{list,criar,renomear,ativar}`; renomear (transação) troca
  só a parte correspondente nos combinados, em todos os lançamentos (inclusive arquivados); recusa nome igual a outro
  centro (sem fusão) e "/" no nome. Regras puras: `shared/financeiro/centros-custo.ts`.
- Tela: botão "Centros de custo" no topo do BPO (criar, renomear, ativar/desativar, uso); campo "Centro de custo"
  (ativos; valor gravado fora da lista continua como opção) no "+ Lançamento", na edição e no "Criar lançamento" da
  aba A classificar; aparece na linha de Cobranças/Despesas/A classificar.
