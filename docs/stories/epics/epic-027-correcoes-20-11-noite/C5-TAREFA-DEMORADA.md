# C5 — Dolores: tarefa demorada sem travar a conversa

Status: InReview (ramo `epic027-c5longa`, criado de `epic027-c5int`; implementada, aguarda o portão de QA de segurança).
Epic: EPIC-027 — Correções de 20/11/2026 (noite) (`EPIC.md`). Plano aprovado pelo dono em 21–22/11/2026 ("tarefa demorada sem
travar", CLAUDE.md › "Decisões do dono em 21–22/11/2026", item 1).
Paridade: Dolores é exceção registrada no ROADMAP (sem porte ao Grupo Santa Fé).
Migração: `drizzle/0153_dolores_tarefas_demoradas.sql` (aditiva e idempotente; NÃO aplicada em banco nenhum por esta etapa).

## Pedido
Quando o dono pede à Dolores, no WhatsApp, algo que não cabe no tempo de uma resposta (várias consultas, relatório grande), a
conversa travava ou estourava o prazo (a função da Vercel tem 60 s; o aviso usa 45 s). Agora:
1. a Dolores reconhece **por código** que não vai dar tempo e responde na hora: "Vou levantar isso e te mando em seguida. Pode
   continuar falando comigo enquanto isso.";
2. grava o pedido numa fila (`dolores_tarefas_demoradas`);
3. um passo posterior retoma, conclui e manda o resultado **só ao número do dono**;
4. enquanto isso o dono conversa normalmente.

## Critérios de aceite
- [x] Reconhecimento por código, nunca pela opinião do modelo: pedido **só de leitura** que, depois de uma volta com consultas,
      ainda pede consulta e já passou de `VOLTAS_PARA_TAREFA` (3) voltas **ou** tem menos que `PRAZO_PARA_SEGUIR_MS` (18 s) de
      prazo para com `virou_tarefa` (`cerebro.ts`), sem a chamada de fechamento.
- [x] Só a conversa direta do dono cria tarefa (`podeVirarTarefa` é passado só em `whatsapp.ts#tratarComando`, depois de conferido
      o número do dono). Grupo, cliente, marcação, atendimento e ponte HTTP nunca criam (teste por código + teste pelo webhook).
- [x] Pedido com intenção de ação (verbo de ação, "pode"/"sim", pedido de memória) **nunca** vira tarefa: segue o caminho da
      proposta de sempre. Exceção do portão de QA: "gera/prepara/monta/faz um relatório/levantamento/resumo/lista…"
      (`shared/dolores/fila.ts#ehPedidoDeRelatorio`: o verbo seguido direto do objeto e NENHUM outro verbo de ação no resto) é
      leitura — sem ferramenta de ação desde a 1ª chamada — e pode virar tarefa. "gera o PCI", "prepara a cobrança", "gera um
      relatório e cria uma tarefa" continuam ação.
- [x] Tarefa que não pode ser gravada (2 abertas, 10/dia, sem a 0153): o laço para como no teto de voltas e faz a chamada de
      fechamento — o dono recebe o que deu para levantar e o porquê (QA M1). A tarefa é gravada no momento em que o laço vê que não
      cabe (`virarTarefa`, passado só por `tratarComando`).
- [x] Falha da IA (ou fim do tempo) na retomada sem texto nenhum devolve a tarefa à fila, respeitando as 2 tentativas; o dono nunca
      recebe "aqui está o levantamento… não consegui concluir" (QA M2).
- [x] Todo resultado em segundo plano termina com o fecho fixo "Nada foi alterado no sistema." (`FECHO_DA_TAREFA`), enviado como
      quadro do sistema: fora do texto do modelo e nunca cortado (QA L1). Com a resposta em várias mensagens, o quadro vai na 1ª.
- [x] A tarefa só LÊ: a retomada chama `executarComando({ somenteLeitura: true })` — sem ferramenta de ação no pedido ao modelo,
      `semAcoes` na porta (`ponte.ts` recusa ação), nada vira proposta (`podeConfirmar` falso), nada de memória longa é gravado.
      Ação continua só pelo "pode"/"confirmo" (`shared/dolores/confirmacao.ts`, `server/dolores/pendencia.ts`).
- [x] Pausa geral, interruptor da IA, chave, modelo, limite do mês e a parte da conversa valem igual (mesma porta
      `bloqueioAtual("dolores_whatsapp")` e a mesma reserva de `consumo.ts`; o consumo entra na parte "conversa").
- [x] Limites: 2 tarefas abertas ao mesmo tempo, 10 por dia (Imperatriz), 2 tentativas, validade de 30 min (vence e avisa o dono).
- [x] Idempotência: uma tarefa por mensagem (índice único) e cada troca de situação é UPDATE condicional; a retomada dupla
      (dois avisos ao mesmo tempo, aviso + cron) manda **uma** resposta. Função que morre no meio do envio → "incerta", sem reenvio.
- [x] Nada de dado pessoal em log/auditoria (só ids, contagens e situação); o pedido guardado perde segredos (mesmo filtro do que
      vai à IA) e é apagado quando a tarefa termina, falha ou vence (CHECK no banco); o resultado não é guardado.
- [x] Sem cron novo: a retomada roda no fim de **todo aviso autenticado** da instância (inclusive os de situação de envio, que
      chegam segundos depois do "vou levantar") e, como rede de segurança, no cron da Dolores que já existe (`rondas.ts`).

## Desenho

```
dono → aviso (whatsapp.ts#tratarComando, podeVirarTarefa) → cerebro.ts: 3 voltas de consulta ou < 18 s → "virou_tarefa"
     → tarefa-demorada.ts#criarTarefaDemorada (tetos sob a trava da linha de config) → "Vou levantar isso…"
próximo aviso autenticado (ou cron) → whatsapp.ts#retomarTarefasDemoradas → tarefa-demorada.ts#retomarTarefaDemorada:
   manutenção (vencidas, paradas no meio) → há tarefa? → ≥ 35 s de prazo? → pausa? → proposta aberta e confirmável? (espera)
   → porta da chave → reivindica (aguardando→executando) → laço SÓ LEITURA (até 10 voltas, teto de saída do relatório)
   → reivindica o envio (executando→enviando, apaga o pedido) → resposta SÓ ao dono (responderAoDono) → concluida
```

Situações: `aguardando → executando → enviando → concluida`; fora disso `expirada`, `falhou`, `bloqueada`, `incerta`.

| Caso | O que acontece |
|---|---|
| Pausa geral | Não retoma, não gasta; a tarefa espera (se vencer durante a pausa, o aviso de vencimento é recusado pela pausa). |
| Proposta aberta esperando "pode" | O resultado espera (não tira a proposta de ordem); a proposta vence em 15 min, a tarefa em 30. |
| Limite do mês / parte da conversa / IA desligada / sem chave | A tarefa fica `bloqueada` e o dono recebe um aviso curto. |
| Outro pedido ocupando a reserva | Volta para a fila sem contar tentativa. |
| Falha do modelo ou do laço | Volta para a fila; na 2ª tentativa, `falhou` + aviso. |
| Função morreu no meio da execução (> 3 min) | Volta para a fila; na 2ª tentativa, `falhou` + aviso. |
| Função morreu no meio do envio | `incerta`: não reenvia (pode ter chegado). |
| Envio com erro | `falhou` sem reenvio (pode ter chegado em parte). |
| Não coube nem a tarefa (tetos, sem a 0153) | O dono recebe o que deu para levantar, com o porquê. |

## Decisões autônomas
- [AUTO-DECISION] Gatilho da retomada → fim de todo aviso autenticado da instância + cron existente (reason: os crons da Dolores
  rodam de hora em hora só das 07h às 14h — "em seguida" ficaria até 1 h; os avisos de situação de envio chegam segundos depois do
  "vou levantar"; nenhum cron novo, como pedido). A retomada exige 35 s de prazo livre, então quase nunca roda no mesmo aviso que
  criou a tarefa (que já gastou o tempo).
- [AUTO-DECISION] Só pedido de leitura vira tarefa (reason: a tarefa não pode executar nada; um pedido com ação perderia a ação).
- [AUTO-DECISION] A retomada refaz o pedido do zero com a conversa recente (não guarda os resultados das consultas da 1ª tentativa)
  (reason: guardar `tool_result` seria guardar dado de cliente no banco; o custo é de algumas chamadas a mais).
- [AUTO-DECISION] O resultado espera enquanto houver proposta aberta e confirmável (reason: a mesma regra dos alertas de gasto,
  `pendencia.ts#podeEnviarAvisoAgora` — um resultado no meio tiraria o "pode" de ordem).
- [AUTO-DECISION] Quem lê a memória continua sendo só `whatsapp.ts` (fronteiras de `c5-e1-qa-r4` e `c5-integracao-qa`): o contexto
  é lido por `contextoDaConversaDoDono` e entregue à retomada por dependência.

## File List
- `drizzle/0153_dolores_tarefas_demoradas.sql` (novo) — tabela, CHECKs, índice único por mensagem.
- `drizzle/schema-dolores-tarefas.ts` (novo) — schema Drizzle; `drizzle.config.ts` (lista de schemas).
- `server/dolores/tarefa-demorada.ts` (novo) — criação, manutenção e retomada.
- `server/dolores/cerebro.ts` — `virou_tarefa`, `podeVirarTarefa`, `somenteLeitura`, `maxVoltas`, constantes.
- `server/dolores/whatsapp.ts` — criação em `tratarComando`, `retomarTarefasDemoradas`, `contextoDaConversaDoDono`, chamada no fim do aviso.
- `server/dolores/rondas.ts` — retomada no fim do cron da Dolores.
- `server/dolores/testes-banco.ts` — 0153 no banco de teste (duas vezes).
- `server/dolores/c5-tarefa-demorada.test.ts` (novo) — 24 testes.
- `server/dolores/c5-tarefa-demorada-qa.test.ts` (portão de QA, commit 1144cfe) — os 3 `it.fails` (M1, M2, L1) viraram `it`.
- `shared/dolores/fila.ts` — `ehPedidoDeRelatorio` (a lista de verbos de ação não mudou).
- `server/dolores/whatsapp.test.ts` — o teste do teto de voltas passa a chamar o laço direto (pela conversa do dono, 3 voltas de
  leitura agora viram tarefa; o teto continua valendo para o laço).

## Testes executados (22/11/2026)
(a) Automáticos:
- `npx tsc --noEmit`: sem erros.
- `npx vitest run server/dolores` (em lotes, `--maxWorkers=2`; a suíte inteira passa de 10 min): 70 arquivos, 1.249 testes, todos
  passando; `server/integracoes-anthropic.test.ts` (31) passando. `shared/dolores` não tem arquivos de teste.
- Novos (20): migração; criação por voltas e por prazo; ação não vira tarefa; estranho/cliente/grupo não criam; único chamador por
  código; tetos de abertas e por dia; retomada conclui e envia; retomada dupla (paralela, repetida e cron) manda uma vez; cron
  retoma; tarefa não executa ação (sem ferramenta de ação, ação pedida é recusada, nada gravado); limite de voltas da retomada;
  conversa livre durante a tarefa; proposta aberta faz o resultado esperar; validade; tentativas e envio interrompido; pausa;
  teto de gasto; IA desligada; segredos e dados pessoais fora da auditoria e do log.
(b) Manuais: nenhum.
(c) Pendentes em produção: aplicar a 0153 no Neon; pedir à Dolores um relatório grande e conferir o "vou levantar" e o resultado.

## Pendências e riscos
- A 0153 precisa ser aplicada antes (ou junto) da publicação; sem ela o código cai no comportamento antigo (resposta com o que deu)
  e a retomada fica em silêncio.
- A retomada depende de chegar um aviso da Evolution (ou do cron, só 07h–14h de Brasília). Na prática o aviso de situação de envio
  do próprio "vou levantar" chega em segundos; se a Evolution não mandar `messages.update`, o resultado espera a próxima mensagem
  qualquer da instância (grupo, cliente, dono) ou o cron.
- O aviso da Evolution que faz a retomada responde depois dela (até ~45 s), como já acontecia com um comando longo.
- A retomada refaz as consultas: um pedido que virou tarefa gasta mais do que se coubesse (as voltas da 1ª tentativa + as da retomada).
- Aviso de vencimento durante a pausa geral é recusado pela pausa (fica só na auditoria).
- Portão de QA de segurança (@qa) antes da `main` (regra da Dolores de 16/11).

### Correções do portão de QA (22/11/2026)
- `npx tsc --noEmit`: sem erros.
- `npx vitest run server/dolores/c5-tarefa-demorada.test.ts server/dolores/c5-tarefa-demorada-qa.test.ts server/dolores/whatsapp.test.ts`:
  3 arquivos, 83 testes passando (24 + 24 + 35).
- Regressão de vizinhos (`c5-e2-resolve`, `acoes-whatsapp`, `e8-respostas-e-custo`, `c5-e2-qa`, `c5-integracao-qa`, `c5-e1-qa-r4`):
  6 arquivos, 121 testes passando.

## Change Log
- 22/11/2026 — @dev (Dex): implementação, migração 0153 e testes.
- 22/11/2026 — @dev (Dex): correções do portão de QA (M1 fechamento sem tarefa, M2 falha da IA volta à fila, L1 fecho fixo,
  "gera/prepara/monta um relatório" como leitura).
