# C5-E4 — Dolores: avisos automáticos ao dono (proatividade por regras)

Status: InReview (ramo `epic027-c5pro`, criado do pacote integrado `epic027-c5int`; implementada, aguarda o portão de QA de segurança).
Epic: EPIC-027 — Correções de 20/11/2026 (noite) (`EPIC.md`). Plano técnico: `C5-PLANO-dolores-jarvis.md` (seção E4).
Paridade: Dolores é exceção registrada no ROADMAP (sem porte ao Grupo Santa Fé).
Migração: `drizzle/0150_dolores_avisos.sql` (aditiva e idempotente; NÃO aplicada em banco nenhum por esta etapa).

## Pedido (decisões do dono, 20–21/11 — não perguntar de novo)
"Tudo o que achar relevante" — decidido por REGRAS do sistema (a IA só escreve o aviso); só ao número do dono; de segunda a sábado,
das 07h às 20h; no máximo 6 por dia; avisos parecidos agrupados; ele silencia um tipo; função com limite próprio (parte "avisos", 5%).

## Critérios de aceite
- [x] AC1 — Regras por código (`server/dolores/avisos.ts#REGRAS`, cada tipo numa transação SOMENTE LEITURA com tempo-limite), com as
      leituras/regras que já existem. Tipos entregues (N configurável, padrão entre parênteses):
      `obra_atrasada` (previsão vencida há ≥ 3 dias; `carregarObras`), `tarefa_vencida` (aberta, vencida há ≥ 2 dias, sem responsável
      ou sem mudança há ≥ 2 dias; regra `tarefaAtrasada` da tela), `documento_pendente` (pendente/recusado no card do CRM há ≥ 7 dias,
      por cliente; `docClientePendente`), `nota_obra` (sem confirmação do empreiteiro há ≥ 3 dias, ou divergente na conciliação;
      `notasDoBanco` + `apontarNotas`), `regularizacao_parada` (sem movimentação há ≥ 15 dias; `carregarProcessos`),
      `grupo_aguardando` (aguardando o dono/recusado há ≥ 24 h; `dolores_grupos`), `integracao` (conta bancária Asaas/Pluggy com erro
      na última sincronização; `bank_accounts.ultimo_erro`, só o nome do banco) e `gasto` (o alerta de 80%/100% da E5, reaproveitado).
- [x] AC2 — Só ao número do dono, pela porta de sempre (`enviarAvisoAoDono`: pausa geral, conexão, filtros de links/segredos/dados
      bancários e dados pessoais conforme a opção B). Nunca cliente, grupo ou terceiro.
- [x] AC3 — Janela: segunda a sábado, 07:00–19:59 de Brasília (UTC−3 fixo, o mesmo do sistema). Domingo e noite: o estado é gravado e
      acumula; na próxima janela sai UM aviso com tudo (o teto não estoura ao abrir a janela).
- [x] AC4 — No máximo 6 por dia (`max_por_dia`, 1 a 6; CHECK no banco) e intervalo mínimo de 60 min; cada aviso leva TODOS os achados
      pendentes, agrupados por tipo (até 5 nomes por tipo + "e mais N").
- [x] AC5 — Não repete: estado por achado (`dolores_avisos_achados`, chave tipo+entidade). Reaviso só quando sobe de FAIXA (ex.: atraso
      3 → 7 → 15 → 30 dias) ou depois de `reaviso_dias` (padrão 7; 0 = nunca). Achado que some (leitura completa) fica resolvido; se volta,
      é novo.
- [x] AC6 — Silenciar/religar um tipo: pela tela (admin) e pela conversa ("para de me avisar de…") com o "pode" do dono (ação
      `silenciar_aviso`, de fila, nível registro). Silenciado não é lido, não sai e não conta. "gasto" silenciado segura só o alerta de
      80% (o de 100% sai sempre: a função parou).
- [x] AC7 — Interruptor próprio DESLIGADO por padrão (e a "IA no texto" também); respeita a pausa geral e a conta da Dolores desativada.
- [x] AC8 — Texto: fixo, montado por código (`montarAvisoFixo`). Com a IA no texto ligada, a IA só redige: chamada SEM ferramentas e sem
      histórico, instrução fixa, dados estruturados já limpos (`dadosParaIA`), teto de 400 tokens, saída conferida (`textoDaIAValido`:
      link, código, "responda pode", bloco de código ou tamanho fora → texto fixo) e pela `vozDaDolores`. Porta da chave:
      `credencialDosAvisos` → `bloqueioAtual` (nenhum ponto novo de leitura da chave). Conta na função "avisos" (`dolores_consumo.funcao`);
      a parte esgotada (`reservarAvisos` → `orcamento_avisos`) só troca para o texto fixo — a conversa e as outras funções seguem.
- [x] AC9 — Memória: o aviso entra em `dolores_conversa` como origem "aviso" (função `aviso_proativo`) com as referências por código
      (obra, cliente, processo, tarefa, nota, grupo), para o dono responder "e esse atraso aí?".
- [x] AC10 — Concorrência e falha: a vaga de cada aviso é única (dia + ordem, índice único): dois crons juntos → um envio. Envio que
      falhou gasta a vaga, fica "falhou" e não tenta de novo na mesma chamada (sem laço); a próxima chamada, depois do intervalo, tenta.
- [x] AC11 — Tela (só admin, `DoloresOperacaoCard` › "Avisos automáticos ao dono"): ligar/desligar, IA no texto, teto do dia, reaviso,
      limites N, silenciar/religar cada tipo (com a regra em linguagem de gente e quantos estão em aberto) e os últimos avisos (texto do
      registro, com dados pessoais mascarados). Rotas `dolores.operacao.avisos.{situacao,salvar,silenciar}` (papel admin no servidor).
- [x] AC12 — Testes em `server/dolores/c5-e4-proatividade.test.ts` (28).

## Decisões autônomas
- [AUTO-DECISION] Proposta aberta esperando o "pode" (aberta, ADJACENTE e no prazo) → o aviso ESPERA a próxima chamada do cron. Motivo:
  qualquer mensagem ao dono tira a proposta da ordem (regra da E2); um aviso no meio faria o "pode" que ele está para escrever virar
  "Pode o quê?" — surpresa ruim. A proposta vence em 10–15 min, o atraso do aviso é de no máximo uma hora; quando ela já está fora de
  ordem ou vencida, o aviso sai normalmente (e, como sempre, não abre proposta nem confirma nada).
- [AUTO-DECISION] Um aviso por chamada com tudo o que está pendente (agrupado por tipo), em vez de um por tipo. Motivo: 8 tipos com
  teto de 6 por dia; "um resumo curto, não uma mensagem por item".
- [AUTO-DECISION] IA no texto com interruptor próprio, DESLIGADO por padrão (além dos avisos). Motivo: "não ligar nenhuma função nova por
  padrão"; o texto fixo já cumpre o pedido. Linha nova em Integrações › Anthropic: "Dolores — texto dos avisos automáticos"
  (`dolores_avisos`); escolher modelo não liga nada.
- [AUTO-DECISION] `reservarAvisos` não grava reserva (só confere uso real + esta chamada contra o total e a parte, sob a mesma trava):
  a vaga do envio já garante um aviso por vez e a chamada é curta (≤ 3 mil de entrada, 400 de saída). Pior caso: o total passa do
  limite em uma chamada de aviso — o mesmo que a conversa já admite.
- [AUTO-DECISION] Silenciado: o tipo nem é lido. Ao religar, os achados atuais desse tipo saem no próximo aviso (ela "conta o que tem").
- [AUTO-DECISION] O alerta de gasto da E5 continua saindo pelo caminho dele (uma vez por mês por limite, fora do teto de 6 e da janela),
  sem duplicar: o tipo "gasto" no catálogo serve para o dono silenciar o de 80%.
- [AUTO-DECISION] "Tarefa sem movimento" = `tasks.updated_at` sem mudança há N dias (a tarefa tem a coluna; a leitura `listar_tarefas`
  não a devolve, por isso a regra lê a tabela com a mesma regra `tarefaAtrasada`).
- [AUTO-DECISION] Sem "descarga oportunista" no webhook da Evolution (sugestão do plano): o cron de hora em hora já cobre a janela toda
  e evita mexer no caminho quente do webhook (arquivo de outras frentes).

## Deixados de fora (e por quê)
- **WhatsApp desconectado** como aviso: o próprio aviso sai pelo WhatsApp da Dolores — com ele caído, não há como avisar por ele (a
  tela já mostra a conexão; `enviarAvisoAoDono` recusa e o envio fica "falhou"). Entrou no lugar a integração que o sistema já detecta
  e que tem como avisar: conta bancária com erro de sincronização.
- **Etapa da obra atrasada** (prazo por etapa): o cadastro de etapas (`construction_stages`) não tem prazo; o aviso é pela previsão de
  término da obra (a mesma regra de `listar_obras`).
- **Documento pendente do cadastro antigo da regularização e do checklist do financiamento**: o pedido é "em card de cliente"; o item do
  checklist pendente não tem data de pedido (não dá para medir "há N dias").

## Cron (vercel.json)
- 07h–14h de Brasília: as 8 chamadas que já existiam (`/api/cron/dolores`, `/08`…`/14`) rodam os avisos DEPOIS da ronda/relatório, com o
  tempo que sobra (mínimo 10 s; senão "sem-tempo" e a próxima hora cobre). A resposta ganha o campo `avisos`; o resto não muda.
- 15h–19h de Brasília: 5 entradas DIÁRIAS novas, só dos avisos — `/api/cron/dolores-avisos/15` … `/19` (`0 18 * * *` … `0 22 * * *`),
  geradas de `CRON_AVISOS_AGENDAS` (teste confere). Mesmo segredo do cron; o servidor ignora query, corpo e o fim do caminho.
- Total de crons do projeto: 10 → 15 (todos diários, como o plano Hobby exige). **Pendente de conferência na publicação**: confirmar no
  painel da Vercel que os 15 aparecem (o limite de quantidade do plano não pôde ser consultado daqui). Se a Vercel recusar, tirar as 5
  entradas da tarde: os avisos continuam das 07h às 14h pela grade antiga.
- Sábado é coberto (os crons são diários); domingo é recusado pela regra da janela.

## Exemplos de aviso (texto fixo)
```
Dolores — avisos de 16/11, 09:00

*1 obra com atraso*
- «Casa Ana» — 15 dias de atraso

*1 tarefa vencida parada*
- «Cobrar certidão do cartório» — há 4 dias — sem nenhuma mudança

*2 clientes com documento pendente*
- «Maria Trello» — 1 documento, o mais antigo há 260 dias
- «João Atrasado» — 1 documento, o mais antigo há 199 dias

*1 regularização parada*
- «Maria Trello» — há 46 dias

Se não quiser mais um desses avisos, me diga (ex.: "pare de me avisar de tarefas vencidas").
```
```
Dolores — avisos de 16/11, 12:30

*1 obra com atraso*
- «Casa Ana» — 32 dias de atraso (no último aviso, 15 dias ou mais)

Se não quiser mais um desses avisos, me diga (ex.: "pare de me avisar de tarefas vencidas").
```

## File List
- `drizzle/0150_dolores_avisos.sql` (novo), `drizzle/schema-dolores-avisos.ts` (novo), `drizzle.config.ts`
- `shared/dolores/avisos.ts` (novo — catálogo, faixas, janela, agrupamento, texto fixo, dados/instrução e conferência da IA)
- `server/dolores/avisos.ts` (novo — regras, estado, envio, IA opcional, situação da tela)
- `server/dolores/avisos-router.ts` (novo), `server/dolores/operacao-router.ts` (monta `avisos`)
- `server/dolores/acoes/avisos.ts` (novo — `silenciar_aviso`), `server/dolores/acoes/registro.ts`, `server/dolores/permissoes.ts`,
  `shared/dolores/confirmacao.ts` (nível), `shared/dolores/voz.ts` (rótulo), `shared/dolores/fila.ts` (verbos "avisar/silenciar/religar")
- `server/dolores/rondas.ts` (avisos depois da ronda; `tratarCronAvisos`), `shared/dolores/operacao.ts` (`CRON_AVISOS_AGENDAS`),
  `api/index.ts` (rota da tarde), `vercel.json` (5 entradas)
- `server/dolores/whatsapp.ts` (`credencialDosAvisos`, parte "avisos" em `bloqueioAtual`, `referencias` em `enviarAvisoAoDono`),
  `server/dolores/consumo.ts` (`reservarAvisos`), `server/dolores/operacao-gasto.ts` (silêncio do 80%), `shared/funcoes-anthropic.ts`
- `server/dolores/prompt.ts` (2 linhas sobre os avisos)
- `client/src/components/admin/DoloresAvisosSecao.tsx` (novo), `client/src/components/admin/DoloresOperacaoCard.tsx`
- `server/dolores/testes-banco.ts` (aplica a 0150 duas vezes)
- Testes: `server/dolores/c5-e4-proatividade.test.ts` (novo); listas fixas ajustadas: `acoes.test.ts`, `correcoes-e3.test.ts`,
  `c5-e2-resolve.test.ts`

## IDS
- REUSE: `enviarAvisoAoDono` (destino, pausa, filtros, memória), `bloqueioAtual` (chave), `conferirTerceiro`/`registrarConsumo`
  (parte "avisos" da E5), leituras `carregarObras`/`carregarProcessos`/`notasDoBanco`/`apontarNotas`, regras `tarefaAtrasada`,
  `docClientePendente`, `limparNomeDeTerceiro`, `vozDaDolores`, `emTransacaoSomenteLeitura`, padrão `naFila` + pendência da E2,
  padrão de cron diário por hora da C4, PGlite de `testes-banco.ts`.
- ADAPT: `tratarCronDolores` (avisos depois da ronda), `conferirAlertasDoGasto` (silêncio do 80%).
- CREATE: catálogo/estado/envio dos avisos (não existia aviso avulso, agrupamento, faixa nem silêncio por tipo).

## Testes executados (22/11/2026)
- (a) Automáticos: `npx tsc --noEmit` limpo; `npx vite build` ok. `server/dolores/c5-e4-proatividade.test.ts` 28/28. Verdes também:
  `operacao-regras`, `c5-e5-gasto-por-funcao`, `c5-e2-resolve`, `whatsapp`, `acoes`, `correcoes-e3`, `c5-e1-voz`, `c4-horario-relatorio`,
  `qa-c4-c5-prova`, `c5-e1-memoria`, `c5-e1-qa-r4`, `operacao`, `operacao-migracao`, `operacao-qa-seguranca`, `c5-memoria-longa`,
  `c5-e3-grupo-registro`, `ponte`, `whatsapp-qa`, `c5-e2-qa`, `revisao-automatica-c5`, `integracoes-anthropic`,
  `integracoes-modelo-por-funcao` (lista de funções ajustada: linha nova `dolores_avisos`). Observação: numa rodada com 12 arquivos em
  paralelo, `acoes.test.ts` › "as quatro ações da etapa 3…" falhou uma vez ("expected true to be false") e passou nas duas rodadas
  seguintes (sozinho e com outro arquivo) — instável, sem relação clara com esta etapa; fica para o portão de QA olhar.
- (b) Manuais: nenhum.
- (c) Pendentes em produção: aplicar a 0150 no Neon; conferir os 15 crons no painel da Vercel; ligar os avisos na tela e acompanhar o
  primeiro dia (segunda a sábado).

## Change Log
- 22/11/2026 — @dev (Dex): Ready → InProgress → InReview. Implementação completa; aguarda o portão de QA de segurança.
