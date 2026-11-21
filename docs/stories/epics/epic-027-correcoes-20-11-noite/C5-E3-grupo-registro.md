# C5-E3 — Dolores: registrar a partir do grupo (só o dono, só registro)

Status: InReview (ramo `epic027-c5e3`, criado da C5-E2 em `d0b9913`; implementada, aguarda o portão de QA de segurança).
Epic: EPIC-027 — Correções de 20/11/2026 (noite) (`EPIC.md`). Plano técnico: `C5-PLANO-dolores-jarvis.md` (seção E3).
Depende de: C5-E2 (`C5-E2-resolve.md`, migração 0145 — proposta que espera o "pode"), ainda não publicada.
Paridade: Dolores é exceção registrada no ROADMAP (sem porte ao Grupo Santa Fé).
Migração: **nenhuma** (o plano previa colunas novas em `dolores_marcacoes_config`; ver Decisões). O número 0147 não foi usado.

## Pedido
Decisão do dono (CLAUDE.md, "EPIC-027 — respostas e autorização do dono em 21/11/2026", itens 4 e 5): "A partir de grupo: só
quando o número do dono pede, e só para REGISTRAR; o grupo vê uma frase curta ('Anotado.')". Nunca dinheiro, nunca mensagem a
terceiro, nunca ação séria (essas ele faz na conversa direta). Para todos os demais, mensagem de grupo continua nunca sendo comando.

## Critérios de aceite
- [x] AC1 — Só o DONO, provado por código: `key.participant` = número do dono (comparação estrita, nunca o número da própria
      Dolores) ou um @lid que a lista de participantes do SERVIDOR (Evolution `/group/participants`, depois `findGroupInfos`) liga
      a UM número, o do dono. Nunca `participantPn`/`participantAlt`, nome exibido, `whatsapp_lid_numeros` ou texto. Sem prova →
      a mensagem segue a marcação comum, como a de qualquer participante (nada é registrado, nada vai ao privado).
      (`shared/dolores/grupo-pedido-dono.ts#remetenteDoGrupo`, `server/dolores/grupo-pedido-dono.ts#remetenteEhODono`)
- [x] AC2 — Precisa MARCAR a Dolores (menção real, a mesma `doloresFoiMarcada`): o desvio fica em `tratarMarcacao`, logo depois
      de achar o grupo cadastrado e ativo, antes do escopo e dos interruptores do grupo. Encaminhada, editada, visualização única,
      reação: não chegam aqui (as exclusões da marcação).
- [x] AC3 — Lista FECHADA de registros (`ACOES_DO_GRUPO`), todos de nível "registro": anotação no cliente do grupo
      (`registrar_acompanhamento`), documento/orçamento do grupo (`salvar_documentos_grupo`) e nota da obra (`salvar_nota_obra`).
      O cliente/obra vêm do GRUPO (servidor), nunca do texto. O arquivo é o da mensagem citada (`stanzaId`, só se for DESTE grupo),
      a própria mensagem (mídia com legenda) ou a última mídia do grupo nas últimas 2 h.
- [x] AC4 — Pedido reconhecido por código (`lerPedidoDoDono`, verbo no começo): "anota: …", "anota isso" (respondendo a uma
      mensagem), "salva essa nota", "guarda esse orçamento"… Texto de outras pessoas do grupo é DADO: pode virar o conteúdo da
      anotação ("Mensagem do grupo de dd/mm hh:mm: "…""), nunca instrução, destino ou outra ação.
- [x] AC5 — Pedido sério no grupo (cobrar, pagar, PIX, conciliar, mandar/avisar/responder a alguém, aceitar/classificar/vincular/
      ligar/desligar grupo, apagar/cancelar, alterar cadastro, criar tarefa/agenda; também "anota e cobra…"): nada é feito; o grupo
      ouve "Isso eu vejo com você no privado." e o dono recebe no privado o motivo e a orientação de pedir na conversa direta.
- [x] AC6 — Nada executa a partir do grupo: o pedido vira a MESMA proposta da E2 (`dolores_aprovacoes` + `dolores_conversa_pendencia`,
      validade de 15 min), com o resumo começando por `Pedido seu no grupo "<nome>":`, e a pergunta vai ao dono no PRIVADO
      (`enviarAvisoAoDono` com o id da proposta: só depois do envio ela aceita o "pode", e só resposta escrita depois). Só o "pode"
      dele na conversa direta executa; "pode"/"confirmo" escrito no grupo (até por ele, marcando) nunca confirma nada.
- [x] AC7 — O grupo vê só "Anotado." (frase fixa, sem dado, pelo envio único `responderNoGrupo`, que confere de novo destino,
      tipo, interruptores e pausa). O detalhe (o que, onde) vai só ao dono.
- [x] AC8 — Com a resposta da Dolores desligada naquele grupo, o pedido continua valendo (proposta no privado); o grupo não ouve nada
      e a pergunta diz isso a ele.
- [x] AC9 — Grupo recusado, aguardando o dono, sem tipo ou sem cliente/obra ligado: nada registrado, o grupo fica calado e o dono é
      avisado no privado com o motivo. Grupo recusado continua sem linha em `dolores_marcacoes` e sem consulta à Evolution.
- [x] AC10 — Limites: pausa geral / conta desativada → nada (nem frase, nem aviso); 20 pedidos do dono por dia (todos os grupos);
      o teto diário de marcações do grupo (o mesmo contador); 6 consultas à Evolution por grupo por hora para provar um @lid;
      reentrega do mesmo aviso (ou dois avisos juntos) → uma vez só (chave pelo id da mensagem). Nenhuma chamada à IA nesta etapa.
- [x] AC11 — Auditoria `grupo_pedido_do_dono` (grupo, tipo do pedido, desfecho, motivo) sem texto nem número; a proposta e a execução
      ficam nas auditorias da E2 (`dolores_pendencia`, a ação, `fila:<código>`). Segredos: o texto a gravar passa por `textoDoDono`
      (senha, token, chave, código de acesso e dado bancário são recusados) e os avisos ao dono pelos filtros de saída.

## Decisões
- [AUTO-DECISÃO] Precisa marcar? → Sim: marcação + ser o dono (o plano põe o ponto de entrada em `tratarMarcacao`; é o mais seguro).
- [AUTO-DECISÃO] Confirmação → a do plano (item 5 da E3): proposta da E2 com "pode" no privado, que também é a regra do dono para
  registro ("Criar tarefa/anotação: a Dolores pede 'pode'"). Executar direto não foi feito: o "pode" no privado é a prova forte de que
  o pedido foi dele (se alguém conseguir se passar por ele, ele recebe uma pergunta que não fez e nada acontece).
- [AUTO-DECISÃO] Frase no grupo → "Anotado." (palavra do dono, 21/11), no lugar de "Certo, te confirmo no privado." do plano.
- [AUTO-DECISÃO] Com a resposta desligada no grupo → o grupo não ouve nada (o dono/admin desligou a fala dela ali); o pedido vale.
  Registro que não deu (sem arquivo, sem vínculo, recusa da ação) → o grupo também não ouve "Anotado." (não seria verdade).
- [AUTO-DECISÃO] Sem migração: o @lid do dono é provado a cada pedido pela lista de participantes da Evolution (com teto por
  grupo/hora), em vez de guardar `lid_dono` em `dolores_marcacoes_config`; o teto diário (20) e a frase são constantes, não colunas.
  Menos superfície (nada a invalidar quando o número do dono muda) e nenhuma migração a aplicar.
- [AUTO-DECISÃO] Sem IA (plano item 4: "começar pelo regex"): o pedido que o código não reconhece segue a marcação comum. Por isso
  a porta da chave (`bloqueioAtual`) não é chamada — nada gasta; vale a parte dela que não é de IA: pausa geral e usuária ativa
  (`podeFalarNoGrupo`, `usuarioDolores`), como o "pode" da E2, que também não usa a IA.
- [AUTO-DECISÃO] Orçamento = documento do grupo (`salvar_documentos_grupo`), sem o tipo novo `orcamento` do plano (mudaria a
  classificação e um CHECK; fora do "ações de registro que já existem").
- Tarefa a partir de grupo não entra (o lead limitou a anotação/acompanhamento, orçamento e documento); é recusada com orientação.

## Fora desta etapa
- Interpretação pela IA de pedidos que o código não reconhece (plano item 4, alternativa); proatividade (E4); gasto por função (E5).
- Tela mostrando os pedidos do dono por grupo (a linha fica em `dolores_marcacoes`, já listada na tela de marcações).

## Riscos
- O dono escrever um pedido que o código não reconhece: segue como pergunta comum (nada é registrado); o exemplo de frase vai a ele
  quando o verbo é de registro mas o objeto não ("não entendi o que registrar").
- Evolution sem o par @lid ↔ número: o pedido por @lid não é provado e segue como de terceiro (lado seguro).
- 0145 (E2) não aplicada: a proposta não abre e o dono é avisado ("não consegui montar a proposta"); nada é registrado.

## Testes
- (a) Automáticos — `server/dolores/c5-e3-grupo-registro.test.ts` (novo, 14 testes, webhook de verdade com PGlite): regras puras;
  dono pede "anota:" → "Anotado." no grupo, pergunta no privado, "pode" registra uma vez e o segundo "pode" → "já fiz"; dono por @lid
  conferido pela Evolution vale e deixa de valer quando a Evolution liga o @lid a outro número; salvar documento citado (arquivo DESTE
  grupo) e citação de arquivo de outro grupo recusada; resposta desligada no grupo ainda registra; pedido sério → frase curta + orientação
  no privado, nada feito; grupo recusado/aguardando/sem cliente → nada, grupo calado, dono avisado; teto de 20/dia; reentrega não duplica;
  "pode"/"confirmo" no grupo não confirma; outro participante (cliente/empreiteiro) → nada; participante se passando pelo dono (nome
  "Dono", `participantPn` dele, @lid desconhecido) → nada; injeção pelo texto citado vira só conteúdo da anotação. Resultados no Change Log.
- (b) Manuais: nenhum (sem banco real nesta etapa).
- (c) Pendentes em produção (depois da 0143 e da 0145): no grupo de um cliente, o dono marca a Dolores com "anota: …" → "Anotado." no
  grupo e a pergunta no privado → "pode" → a anotação aparece no histórico do cliente; o mesmo texto vindo de outro participante → nada.

## File List
- `shared/dolores/grupo-pedido-dono.ts` (novo — regras puras: pedido, remetente, citação, frases e tetos)
- `server/dolores/grupo-pedido-dono.ts` (novo — prova do dono, alvo no grupo, proposta, frase e avisos)
- `server/dolores/marcacao.ts` (desvio em `tratarMarcacao` + `pedidoDoDonoNoGrupo`)
- `server/dolores/pendencia.ts` (`abrirPendenciaDosCodigos`; proposta sem mensagem da conversa direta)
- `server/dolores/whatsapp.ts` (`enviarAvisoAoDono` aceita o id da proposta: tira as outras da ordem e marca a pergunta como enviada)
- `server/dolores/c5-e3-grupo-registro.test.ts` (novo)

## Change Log
- 21/11/2026 — @dev (Dex): Draft → InProgress → InReview (YOLO). Sem migração.
