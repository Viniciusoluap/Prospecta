# S-6 — Contas bancárias por empresa, regime por empresa e limite de receita do ano (com aviso da Dolores)

**Status:** InReview (implementado na branch `epic029-s6`; falta portão de QA, migração 0164 no Neon e publicação).
**Epic:** EPIC-029 (Módulo Fiscal). **Executor:** @dev (Dex), 22/11/2026.

## Pedido do dono (22/11/2026, palavras dele)

> "Quero que a Dolores me avise quando eu estiver perto de bater a movimentação anual máxima permitida naquela conta, e quero que nas
> opções de cadastramento de conta lá no BPO financeiro eu possa vincular a conta que estamos usando à empresa que irá emitir nota —
> exemplo, eu posso ter três contas da mesma empresa que irá emitir aquela nota, como posso ter também outras duas contas de outra
> empresa que irá emitir outra nota com outra movimentação, tudo dentro do mesmo sistema — sendo possível também renomear o nome das
> contas para que eu possa ter uma identificação mais fácil."

Ampliação no mesmo dia: "As outras empresas que estão em outros regimes tributários terão os próprios regimes delas com vínculos de suas
contas e movimentações; o nosso sistema tem que abranger tudo isso." E: várias empresas com nomes parecidos (Efficaz 04.578.232/0001-82
matriz + filial 04.578.232/0002-63 em Canaã; Efficaz LTDA 21.704.736/0001-10; Eficaz 39.740.145/0001-64; Prospecta 41.865.900; VFX Capital
58.121.993) — modelar empresa (raiz do CNPJ) e estabelecimento (CNPJ completo).

## Interpretação implementada

1. **Empresa = raiz do CNPJ** (8 primeiros caracteres): o regime e os limites são dela; o teto do Simples soma matriz + filiais.
   **Estabelecimento = CNPJ completo** (matriz ou filial): é quem emite a nota (inscrição municipal e município próprios, em
   `fiscal_emissores`) e é a quem a conta bancária se liga. A filial herda o regime da empresa (perfil tributário da mesma raiz).
   Nenhum cadastro novo de empresa: a empresa vem de `tax_profiles`; a filial entra pelo complemento fiscal (`fiscal_emissores`).
2. **Conta ↔ estabelecimento** (`bank_accounts.empresa_cnpj`, opcional; N contas por estabelecimento/empresa). Sem vínculo = "sem
   empresa definida" (pendência na tela de Bancos e na aba Contabilidade).
3. **Apelido** (`bank_accounts.apelido`): renomear muda só o nome mostrado; banco, agência, número e descrição continuam. Em branco volta
   ao nome do banco. Aparece na lista de Bancos, na importação de extrato, no painel de limites, no aviso de integração da Dolores e na
   leitura dela.
4. **Regime por empresa**: Simples, Presumido, Real, RET, Outro e o novo **"A confirmar com o contador"** (sem estimativa de tributo e
   sem limite). O formulário não vem mais com "Lucro Presumido" marcado (achado D2 do `REGIME-TRIBUTARIO.md`). Troca de regime = nova
   versão do perfil (histórico em `tax_profiles_historico`); painel e aviso usam a versão **vigente na data**.
5. **Limites por regime** (valores em `shared/fiscal/regimes.ts`, com a fonte):
   - Simples: ME R$ 360 mil (LC 123/2006 art. 3º I — só informativo), sublimite R$ 3,6 mi (art. 13-A), teto R$ 4,8 mi (art. 3º II; acima
     de 20% = R$ 5,76 mi, efeito no mês seguinte — §§ 9º e 9º-A);
   - Lucro Presumido: R$ 78 mi no ano (Lei 9.718/1998 art. 13; acima disso, Lucro Real obrigatório no ano seguinte);
   - Lucro Real: sem limite (sem aviso); RET/Outro/A confirmar: sem limite calculado.
6. **Receita somada** (ano-calendário em Brasília, por empresa): lançamentos pagos do BPO que não são despesa (mesma base da "Receita
   realizada"; reembolso entra e aparece à parte), ligados a uma movimentação de conta da empresa. Ficam **fora**: categoria
   "Transferência interna" (já não gera lançamento), entrada casada com saída de mesmo valor, em até 2 dias, de **outra conta da mesma
   empresa** (transferência não marcada), estorno/devolução (pela descrição — o BPO não tem marca própria), combinada em outra cobrança,
   arquivada, "a classificar". Conta sem empresa e lançamento sem conta ficam à parte (pendências), nunca somados por chute. Projeção do
   ano pelo ritmo (receita ÷ dias corridos × dias do ano; "pouco confiável" antes de 30 dias). A tela e a Dolores dizem: **receita
   registrada no sistema; a apuração oficial é do contador**.
7. **Gerador de rascunhos (S-2)**: a empresa da conta em que o dinheiro entrou escolhe o emissor (estabelecimento com complemento fiscal
   ativo): conta → tipo de serviço → emissor único → a escolher. **Emissão (S-4)**: `EmissorLido.optanteSimples` (`true` só no Simples;
   `null` com regime a confirmar — a S-4 deve recusar emitir).
8. **Aviso da Dolores**: tipo novo `limite_receita` nos avisos proativos (mesmos tetos, janela, só ao número do dono). **Nasce
   silenciado** (o dono liga na tela ou pela conversa). Faixas 70/85/95/100% de cada limite, **uma vez por faixa, por empresa, por limite,
   por ano** (sem reaviso; se a receita cair e voltar, a faixa já avisada não volta; ano anterior fica resolvido). Texto natural, sem
   comando, sem CNPJ e sem número de conta.
9. **Conversa**: leitura `consultar_limites_receita`, só na conversa direta do dono (`LEITURAS_DO_DONO`; ponte HTTP, grupos e cliente
   recebem 403). Ex.: "quanto falta para estourar o Simples na Prospecta?".
10. **Painel**: seção "Limites de receita por empresa" na aba Contabilidade — regime, estabelecimentos, contas, receita do ano, projeção,
    barra de cada limite (ou "sem limite" / "regime a confirmar") e pendências.

## Critérios de aceite

- [x] AC1 — No cadastro/edição da conta (BPO › Bancos) escolho o estabelecimento (empresa) e dou um apelido; 3 contas numa empresa e 2
  noutra convivem; só estabelecimento conhecido é aceito (perfil tributário ou complemento fiscal da filial).
- [x] AC2 — Renomear não muda banco/agência/número; o apelido aparece nas listas.
- [x] AC3 — Conta sem vínculo aparece como "sem empresa definida" (Bancos e Contabilidade) e sua receita não entra em empresa nenhuma.
- [x] AC4 — Receita do ano por empresa soma matriz + filiais e exclui transferência entre contas da mesma empresa e estorno.
- [x] AC5 — Limite conforme o regime vigente na data: Simples (ME/sublimite/teto), Presumido (78 mi), Real sem limite, "a confirmar" sem
  limite e sem estimativa de tributo; troca de regime no meio do ano usa a versão nova a partir da data dela.
- [x] AC6 — Gerador usa a empresa da conta para escolher o emissor com vários emissores.
- [x] AC7 — Aviso `limite_receita`: nasce silenciado; 70/85/95/100% uma vez por faixa/empresa/limite/ano; só ao dono; sem CNPJ/conta/comando.
- [x] AC8 — Leitura da Dolores só na conversa direta do dono; recusada (403) na ponte, grupo e cliente.
- [x] AC9 — Ver limites: admin e colaborador com BPO; mexer em contas: só admin.

## Como testar (passo a passo)

1. BPO › Contabilidade › "Configurar tributação": cadastre a Prospecta (CNPJ 41.865.900/0001-89, Simples). Veja a seção "Limites de
   receita por empresa" aparecer com as três barras.
2. BPO › Bancos › "Editar conta" numa conta: dê um apelido (ex.: "Cora obras") e escolha "Prospecta — matriz". Confira que o nome mostrado
   mudou e que, abaixo, ainda aparecem banco e número.
3. Volte à Contabilidade: a receita do ano das entradas daquela conta aparece na Prospecta; contas ainda sem empresa aparecem na
   pendência amarela.
4. Integrações/Dolores › Avisos: religue "receita do ano chegando no limite do regime da empresa" (nasce silenciado).
5. No WhatsApp, pergunte à Dolores: "quanto falta para estourar o Simples na Prospecta?".

## Testes

- Automáticos (vitest, `--maxWorkers=2`): `server/fiscal/s6-regimes.test.ts` (14), `server/fiscal/s6-contas-limites.test.ts` (8),
  `server/dolores/s6-limite-receita.test.ts` (6) — 28 novos, todos passando. Vizinhos ajustados e passando: `c5-e4-proatividade`
  (lista de tipos), `c5-integracao2` (lista das leituras só do dono), `leitura-somente` (importação de `fiscal/teto.js`, que recebe a
  conexão somente leitura), `c5-integracao2-qa` (reserva do aviso 3.000 → 4.000, mesmo valor da S-3). Também passaram: fiscal
  (rascunhos, rascunhos-qa), bancos/BPO (auditoria-final, chave-central, sync, extrato, lote3, restauração, a-classificar, 0075,
  conta-azul, tests/bancario, erros-reais), Dolores (acoes, c5-e1-voz, c5-e1-qa-r4, c5-e2-resolve, c5-mesas, notas-obra, qa-e5-provas),
  integracoes-anthropic, consulta-cadastral-qa. `tsc --noEmit` e `vite build` ok.
- 4º portão + junção S-8 (23/11): `server/fiscal/*` 18 arquivos, 405/405 (s6/s8/simples 200; certificado, emissão, notas recebidas,
  rascunhos, s5b 205); Dolores `s6*`, `s3*`, `c5-e4-proatividade`, `c5-integracao2*`, `leitura-somente` 147/147; `bancos*`/`bpo*`
  142/142. `tsc --noEmit` limpo; `vite build` ok.
- Manuais: pendentes (passos acima, em produção depois da 0164).

## Migração

`drizzle/0164_contas_empresa_limite_receita.sql` — aditiva e idempotente: `bank_accounts.apelido` e `bank_accounts.empresa_cnpj`
(ADD COLUMN IF NOT EXISTS, CHECKs novos só se não existirem, índice), e troca **só** da restrição `dolores_avisos_tipos_tipo_check` para a
UNIÃO (lista antiga + `nota_fiscal` da S-3 + `limite_receita`). **Aplicar ANTES de publicar o código** (o Drizzle passa a ler as colunas
novas de `bank_accounts`). Se a 0161 (S-3) for aplicada depois desta, rodar a 0164 de novo.

## Fontes

Valores conferidos pelo texto das leis citadas (LC 123/2006 com a redação da LC 155/2016; Lei 9.718/1998 com a redação da Lei
12.814/2013). Conferência on-line em 22/11: planalto.gov.br e www8.receita.fazenda.gov.br bloqueados na rede da sessão; as páginas de
www.gov.br testadas não traziam os valores — **[o contador deve confirmar]**.

## Fora do escopo / pendências

- Limite proporcional no ano de início de atividade (R$ 400 mil × meses no Simples; R$ 6,5 mi × meses no Presumido).
- Devolução a cliente registrada como despesa não é descontada da receita (só o crédito de estorno sai); o contador apura.
- A S-4 deve usar `optanteSimples` na DPS e recusar emissão com regime "a confirmar".
- Paridade com o Grupo Santa Fé: pendência no ROADMAP (o dono decide depois, como no resto do EPIC-029); o aviso da Dolores é exceção.

## Correções do portão de QA (FAIL de 22/11/2026 → corrigido)

Teste do QA: `server/fiscal/s6-qa.test.ts` (os 10 `it.fails` viraram `it` e passam; testes novos das correções no mesmo arquivo).

| Achado | Gravidade | Correção |
|---|---|---|
| A9 — leitura e avisos da Dolores levavam o número inteiro da conta | importante | `nomeSeguroDaConta` (regimes.ts): apelido, ou banco + os 4 últimos dígitos mascarados (`Cora •••3456`); nunca descrição livre nem número inteiro. Usado na apuração (tela, leitura `consultar_limites_receita`, aviso de integração). Teste confere o texto que a leitura devolve. |
| A1 — entrada saía da soma por coincidência com qualquer saída de mesmo valor | importante | `DebitoParaSoma.classificacao`: saída com lançamento de **despesa** no BPO nunca casa; casa só a marcada como Transferência interna ou sem lançamento (mesmo valor, mesma empresa, outra conta, ≤ 2 dias). teto.ts lê a classificação de cada saída. |
| A2 — "devolvido" na mensagem do pagador tirava receita | médio | `ehEstorno` só no texto do **lançamento** e só quando ele COMEÇA pela palavra (como o banco/sistema escreve); a descrição da movimentação (mensagem do pagador) não decide mais. Na dúvida, conta. |
| A3 — perfil desativado à mão continuava vigente | médio | `versoesQueValem`: vale a ativa e a inativa SUBSTITUÍDA por versão posterior (troca de regime normal); inativa sem substituta (desativada à mão) não vale. |
| A4 — passar de R$ 5,76 mi (teto + 20%) sem aviso próprio | médio | Limite próprio `excesso_simples` (LC 123, art. 3º, § 9º-A), acompanhado no Simples com a faixa só de 100% (`limitesAcompanhados`; `faixaDoLimite` aceita as faixas do limite). A barra do teto e `limitesDoRegime` não mudam. |
| A5 — colaborador com BPO trocava o regime | médio | `tax.profiles.create` exige papel admin (como o desativar). |
| A6 — crédito "a classificar"/sem lançamento sumia | médio | Vira pendência com valor por empresa (`aClassificar`), total geral com os 20 maiores (`Apuracao.aClassificar`), receita "possível" e `faixaPossivel`; o aviso da Dolores usa a maior faixa (lado seguro) e diz "contando R$ X ainda a classificar". Marcado como Transferência interna fica fora. |
| A7 — conta da Prospecta sem emissor caía no emissor de outra raiz | médio | Com a empresa da conta conhecida, tipo de serviço/emissor único só valem se forem da MESMA raiz; senão fica sem emissor e a tela mostra `motivoSemEmissor`. |
| A8 — regime do emissor era o do perfil mais recente | médio | `emissoresComPerfil(db, data)` e `detalhar` usam o perfil vigente na data (1º dia da competência da nota), a mesma regra do painel. Sem versão vigente → regime null (não emitir). |
| Receita do Financeiro (`financial_transactions`) fora da conta | — | Pendência com valor (`Apuracao.financeiro`; tela e leitura da Dolores): entra na "Receita realizada" mas não tem conta, então não é somada em empresa por chute. |
| A10 — apelido só com TAB/quebra de linha passava no banco | baixo | CHECK da 0164: `"apelido" ~ '[^[:space:]]'` (0164 ainda não aplicada; continua aditiva e idempotente). Comentário: se a 0165 (S-3) for reaplicada depois, reaplicar a 0164. |
| Fuso no corte do ano | baixo | `inicioDoAnoEmBrasilia`: o ano começa à 00h de Brasília (03:00 UTC) em todas as consultas de teto.ts. |

Teste auxiliar: `server/dolores/testes-banco.ts` passa a criar `financial_transactions` (a apuração lê a tabela).

### Junção com a main (S-3 #314 e S-4 #313), 22/11/2026

- `TIPOS_AVISO` = os 8 + `nota_fiscal` (S-3) + `limite_receita` (S-6), nessa ordem; `SILENCIADOS_POR_PADRAO` = os dois; `TIPOS_SEM_REAVISO`
  = só `limite_receita`. A 0164 traz a lista completa dos 10 (a 0165 da S-3 traz 9): se a 0165 for reaplicada depois, reaplicar a 0164.
- Reservas remedidas com 10 tipos (`server/dolores/s6-reserva.test.ts`): aviso, pior caso 3.080 ≤ `RESERVA_ENTRADA_AVISO` 4.000 (mantido);
  prefixo da conversa, pior caso 20.126 (folga 874 < 1.000) → `RESERVA_MINIMA_ENTRADA` 21.000 → 22.000.
- Padrão do formulário de perfil tributário: vale o da main ("Simples Nacional", decisão do dono em #305), no lugar do "a confirmar" da S-6.
- `detalhar` lê a empresa da conta com `to_jsonb(ba) ->> 'empresa_cnpj'` (sem a 0164 dá nulo, sem abortar a transação somente leitura da
  Dolores, que usa a mesma função na S-3). Testes da S-3 passam a aplicar a 0164 depois da 0165 (ordem de produção) e o `tax_profiles`
  deles ganha `effective_to` (coluna do schema real, lida pelo regime vigente). Testes da S-6 aplicam a 0162 (coluna da S-4).

## Correções do 2º portão de QA (FAIL de 22/11/2026 → corrigido)

Teste do QA: `server/fiscal/s6-qa2.test.ts` (os 7 `it.fails` viraram `it`; casos a mais das correções no fim do arquivo).

| Achado | Gravidade | Correção |
|---|---|---|
| N1 — saída sem classificação/"a classificar" ainda casava e escondia receita | importante | Só a saída MARCADA como Transferência interna (na movimentação ou no lançamento) tira a entrada da soma. Sem classificação, a entrada CONTA e aparece como "possível transferência" (`possiveisTransferencias`, tela e leitura da Dolores) para o dono conferir. |
| N1b — saída que deu baixa em despesas pela divisão de pagamentos | importante | Classificada como despesa (bpo_recebimentos → lançamento de despesa): nunca casa nem é apontada. |
| N2 — crédito dividido em várias cobranças (bpo_recebimentos) | médio | Cada baixa ligada ao banco entra pela conta do crédito, na data dela; o resto da cobrança paga (baixa manual) fica sem conta; o crédito só fica "a classificar" na parte não alocada. Nada conta duas vezes. |
| N3 — regime "a confirmar" passava na DPS | médio | `faltasDps` (server/fiscal/dps.ts) recusa regime vazio, "a confirmar" ou não reconhecido. |
| N4 — desativar à mão a versão nova deixava a empresa sem regime | baixo | `versoesQueValem` usa o histórico (`tax_profiles_historico`): "desativado" (à mão) nunca vale; inativa com versão posterior vale até a posterior começar, mesmo se a posterior foi desativada à mão depois. Sem histórico, inativa sem posterior = à mão. |
| N5 — apelido com número de conta ia inteiro à Dolores | baixo | `nomeSeguroDaConta` troca sequências de 5+ dígitos (com pontuação) por •••4 últimos. |
| Precedência matriz × filial | obs. | `perfilDaEmpresaNaData` (regimes.ts) é a única regra: matriz primeiro, senão qualquer versão da mesma raiz — usada no painel e no emissor das notas (notas.ts). |

Tabelas opcionais (`tax_profiles_historico`, `bpo_recebimentos`) são conferidas com `to_regclass` antes de ler (sem erro na transação somente
leitura da Dolores). Testes antigos ajustados à regra N1: as saídas de transferência dos cenários passam a ser MARCADAS.

## Correções do 3º portão de QA (FAIL de 22/11/2026 → corrigido)

Teste do QA: `server/fiscal/s6-qa3.test.ts` (`it.fails` → `it`; casos a mais das correções no mesmo arquivo).

| Achado | Gravidade | Correção |
|---|---|---|
| Q1 — entrada marcada como Transferência interna sumia da soma sem par | importante | A entrada marcada (à mão, por lote, pela regra do titular ou sozinha pela importação — `sugerirCategoria`) entra na apuração como receita MARCADA: só sai da soma se casar com uma saída também marcada de OUTRA conta da MESMA empresa (mesmo valor, até 2 dias). Sem par, CONTA e aparece em "possível transferência" para o dono conferir. Lançamento com categoria Transferência interna segue a mesma regra. |
| Q2 — transferência real B→C escondia recebimento de mesmo valor na conta A | importante | Duas passadas em `apurarReceitas`: primeiro marcada × marcada (a transferência real se anula); depois, a entrada NÃO marcada (receita de cliente) nunca é anulada — uma saída que sobrou (sem classificação ou marcada sem par) só a aponta como "possível transferência". |
| Q3 — marcar como transferência sem rastro | médio | Por decisão do coordenador, a permissão do colaborador com BPO continua (com o Q1 a marcação sem par não tira receita). Auditoria nova `bpo_transferencia_marcacoes` (na 0164, aditiva): cada movimentação marcada pelo "ignorar", pela tela de Bancos, pelo lote, pela regra do titular — quem, quando, por onde, valor e o lote (quantas e valor somado). O painel de limites mostra quantas entradas saíram como transferência e por quem foram marcadas (`transferenciasPorQuem`; sem registro = marcação automática ou anterior à auditoria). O teste do QA que pedia tirar a permissão foi trocado pelo que fixa a permissão + a auditoria. |
| Q4 — apelido com "_" ou "," passava o número | baixo | `nomeSeguroDaConta` normaliza NFKC e junta blocos de dígitos com QUALQUER separador que não seja letra (5+ dígitos → •••4 últimos). |

Testes antigos ajustados à regra Q1/Q2: as transferências dos cenários passam a ter os DOIS lados marcados; o lançamento marcado sem par
do cenário de reembolso passa a contar.

## Correções do 4º portão de QA (CONCERNS de 23/11/2026 → corrigido)

Teste do QA: `server/fiscal/s6-qa4.test.ts` (`it.fails` → `it`; casos a mais das correções no mesmo arquivo).

| Achado | Gravidade | Correção |
|---|---|---|
| R1 — editar para baixo o lançamento ligado ao extrato tirava receita do limite | médio | `teto.ts`: do crédito do banco sai só o que os lançamentos ligados a ele levam para a soma (pagos; combinados; despesa ligada). O resto vira pendência com valor (`motivo: "diferenca"`), entra na receita POSSÍVEL (faixa do aviso) e aparece no painel ("o banco recebeu R$ X a mais do que o lançamento") e na leitura da Dolores (`diferencasDoExtratoParaConferir`). Lado seguro: conta pelo maior, sem contar duas vezes. |
| R2 — lançamento casado que voltou a "não pago" sumia por inteiro | médio | Mesma regra: lançamento não pago não leva nada → o crédito inteiro do banco vira pendência visível. |
| R3 — descrição editável "Devolução …" tirava o valor inteiro | médio | `estornoConfirmado`: só sai como estorno quando o texto do LANÇAMENTO **e** o do BANCO começam pela palavra. Só o lançamento dizendo → CONTA e aparece em "estornos para conferir" (painel e Dolores). Lançamento sem movimentação nunca é estorno confirmado. |
| R4 — o painel escondia quem marcou a SAÍDA | baixo | A apuração lê a auditoria dos dois lados do par: `transferenciasPorQuem.quem` = um nome (mesma pessoa) ou "entrada: X; saída: Y", com `ultimaMarcacaoEm` (data e hora de Brasília). |
| Apelido com agência ("ag 1234 cc 12345-6") | baixo | `nomeSeguroDaConta`: 4+ dígitos depois de "ag", "agência", "cc", "c/c", "conta" ou "op" saem inteiros ("ag ••• cc •••"); o resto continua com a regra dos 5+ dígitos. |
| Auditoria fora da transação | baixo | `registrarMarcacaoTransferencia` recebe a transação: a marcação (tirar o lançamento, gravar a movimentação) e a auditoria são uma transação só (`atualizarMovimentacao`, `aplicarClassificacaoEmLote`); falhou a auditoria → nada vale. Só sem a tabela (banco anterior à 0164) a marcação segue sem auditoria. |
| Comentários da 0164 fora de ordem | baixo | Itens 1–4 em ordem (SQL inalterado). |

Testes antigos ajustados às regras novas: `s6-qa.test.ts` (o pendente ganha `motivo`), `s6-qa2.test.ts` ("Ag 0001 CC …" → "Ag ••• CC •••"),
`s6-qa3.test.ts` (`transferenciasPorQuem` ganha `ultimaMarcacaoEm`), `bpo-extrato.test.ts` (o banco falso ganha `transaction`/`execute`).

## Junção com a S-8 (main de 23/11: S-5b, S-3b, Jurídico e S-8)

- Merge por união (`server/fiscal/router.ts`: importações e a lista de emissores com os dados do Simples e as filiais da S-6).
- **Fonte do RBT12 trocada**: `server/fiscal/simples.ts#fonteReceitaDaApuracao` (substitui a `fonteReceitaMinima`) usa
  `teto.ts#apurarPeriodo` — a apuração da S-6 numa janela qualquer (12 meses, mês, ano-calendário) — + as notas EMITIDAS da raiz.
  Do BPO entram só honorário e receita (M1 da S-8), sem transferência entre contas da empresa e sem estorno confirmado; devolve
  `lancamentosBpo` para a deduplicação do 1º mês.
- **M5 da S-8 resolvido**: lançamento ligado a nota emitida sai do BPO (se o BPO tiver mais que a nota, a diferença fica); nota SEM
  lançamento do BPO casa com UMA entrada (ou crédito pendente) de mesmo valor da mesma empresa em até 45 dias
  (`JANELA_NOTA_X_RECEBIMENTO_DIAS`) — contada uma vez, com aviso.
- [AUTO-DECISION] Créditos a classificar/com diferença do extrato entram no RBT12? → sim, com aviso e valor (regra do lead: na dúvida,
  contar a mais; é o mesmo "possível" que o aviso do limite usa). O teste da S-8 "não pago não entra" passou a esperar o crédito do banco
  como pendente (R2).
- [AUTO-DECISION] Receita sem conta ou em conta sem empresa → fica fora do RBT12 (não dá para dizer de que empresa é), com aviso e valor.
- Testes da S-8 ajustados: o DDL do schema já traz as colunas da 0164 — os testes tiram as duas colunas (como os da S-6) para continuar
  ligando a conta por empresa com `ALTER TABLE`. `s3-fiscal-revisao.test.ts` (S-3b): a tabela feita à mão ganha `effective_to` (coluna
  real da 0022, lida por `lerPerfis`).

## File List

- `drizzle/0164_contas_empresa_limite_receita.sql` (novo), `drizzle/schema.ts`
- `shared/fiscal/regimes.ts` (novo), `shared/dolores/avisos.ts`, `shared/dolores/voz.ts`
- `server/fiscal/teto.ts` (novo), `server/fiscal/gerador.ts`, `server/fiscal/notas.ts`, `server/fiscal/router.ts`, `server/tax-router.ts`,
  `server/bancos-router.ts`
- `server/dolores/avisos.ts`, `server/dolores/acoes/avisos.ts`, `server/dolores/funcoes.ts`, `server/dolores/permissoes.ts`,
  `server/dolores/leitura/limites-receita.ts` (novo)
- `client/src/components/fiscal/LimitesReceita.tsx` (novo), `client/src/pages/admin/BancosPanel.tsx`,
  `client/src/pages/admin/TaxAccountingPanel.tsx`
- Correções do QA: `client/src/components/fiscal/NotasADecidir.tsx`, `server/dolores/testes-banco.ts`, `server/fiscal/s6-qa.test.ts` (do QA)
- 4º portão: `server/bpo-extrato.ts`, `server/fiscal/teto.ts`, `shared/fiscal/regimes.ts`, `client/src/components/fiscal/LimitesReceita.tsx`,
  `server/dolores/leitura/limites-receita.ts`, `drizzle/0164_contas_empresa_limite_receita.sql` (comentários); testes `server/fiscal/s6-qa4.test.ts`
  (do QA + correções), `s6-qa.test.ts`, `s6-qa2.test.ts`, `s6-qa3.test.ts`, `server/bpo-extrato.test.ts`
- Junção S-8: `server/fiscal/simples.ts`, `server/fiscal/router.ts`, `server/fiscal/simples-servidor.test.ts`, `server/fiscal/s8-qa.test.ts`,
  `server/dolores/s3-fiscal-revisao.test.ts`
- Testes: `server/fiscal/s6-regimes.test.ts`, `server/fiscal/s6-contas-limites.test.ts`, `server/dolores/s6-limite-receita.test.ts` (novos);
  `server/dolores/c5-e4-proatividade.test.ts`, `server/dolores/c5-integracao2.test.ts`, `server/dolores/leitura-somente.test.ts`

## IDS (decisões)

- REUSE `tax_profiles` (empresa/regime) e `fiscal_emissores` (estabelecimento/filial); REUSE mecanismo de avisos (achados, faixas,
  silêncio — mesmo `SILENCIADOS_POR_PADRAO`/`silenciadoPelaLinha` da S-3, para a junção ser a união); REUSE `LEITURAS_DO_DONO`.
- ADAPT `bank_accounts` (+2 colunas) — `descricao` não foi reaproveitada como apelido porque o Pluggy grava ali o nome do provedor.
- CREATE `shared/fiscal/regimes.ts` (regras puras únicas para tela, aviso e leitura) e `server/fiscal/teto.ts` (leitura).
- [AUTO-DECISION] Reembolso entra na soma? → sim, mostrado à parte (mesma base da "Receita realizada"; lado seguro para o aviso).
- [AUTO-DECISION] Transferência vinda de OUTRA empresa → conta como receita (pode ser serviço entre empresas; o contador ajusta).

## Change Log

| Data | Agente | Mudança |
|------|--------|---------|
| 22/11/2026 | @dev (Dex) | Story criada a partir do pedido do dono (e das duas ampliações do mesmo dia); Ready → InProgress. |
| 22/11/2026 | @dev (Dex) | Implementação concluída, 28 testes novos passando; InProgress → InReview (aguarda @qa). |
| 22/11/2026 | @qa (Quinn) | Portão de QA: FAIL (A1 e A9 importantes; A2–A8 médios; A10 e fuso baixos). |
| 22/11/2026 | @dev (Dex) | Correções do portão de QA (todas as 10 + Financeiro + fuso); `it.fails` → `it`; volta a InReview (aguarda novo portão). |
| 22/11/2026 | @qa (Quinn) | 2º portão de QA: FAIL (N1/N1b importantes; N2, N3 médios; N4, N5 baixos; precedência matriz × filial). |
| 22/11/2026 | @dev (Dex) | Correções do 2º portão; `it.fails` → `it`; volta a InReview. |
| 22/11/2026 | @qa (Quinn) | 3º portão de QA: FAIL (Q1, Q2 importantes; Q3 médio; Q4 baixo). |
| 23/11/2026 | @dev (Dex) | Correções do 3º portão (Q1–Q4); auditoria das marcações; `it.fails` → `it`; volta a InReview. |
| 23/11/2026 | @qa (Quinn) | 4º portão de QA: CONCERNS (R1–R3 médios; R4 e três baixos). |
| 23/11/2026 | @dev (Dex) | Correções do 4º portão (R1–R4 + baixos); merge da main (S-5b, S-3b, Jurídico, S-8); RBT12 da S-8 pela apuração da S-6 e M5 resolvido; volta a InReview. |
