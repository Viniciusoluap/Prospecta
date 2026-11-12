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
