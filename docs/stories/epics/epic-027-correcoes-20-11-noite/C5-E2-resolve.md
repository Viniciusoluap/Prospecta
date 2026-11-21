# C5-E2 — Dolores: "a Dolores resolve" (propõe e faz com o "pode")

Status: InReview (ramo `epic027-c5e2`, criado de `epic027-c5` / C5-E1 em `7ee29db`; implementada, aguarda o portão de QA de segurança).
Epic: EPIC-027 — Correções de 20/11/2026 (noite) (`EPIC.md`). Plano técnico: `C5-PLANO-dolores-jarvis.md` (seção E2).
Depende de: C5-E1 (`C5-E1-voz-e-memoria.md`, migração 0143 — memória da conversa), ainda não publicada.
Paridade: Dolores é exceção registrada no ROADMAP (sem porte ao Grupo Santa Fé).
Migração: `drizzle/0145_dolores_pendencia.sql` (aditiva e idempotente; NÃO aplicada em banco nenhum por esta etapa).

## Pedido
Queixa do dono (20/11, noite): "tá muito robotizado… eu espero que eu posso falar com ela e resolver problemas dentro do meu
negócio, e não simplesmente ter programações". Decisões dele (CLAUDE.md, 21/11, itens 1 e 5): consultar → direto; registrar
(tarefa, anotação, vínculo) → ela pede um "pode"; ação séria → só com "confirmo". Só o número do dono comanda, na conversa direta.

## Escopo
- DENTRO: confirmação em linguagem natural com proposta pendente segura (por código); tarefa e acompanhamento deixam de executar
  na hora no WhatsApp (pedem "pode"); nível de cada ação (registro/sério) por código; quatro ações novas de grupo pela conversa
  (classificar/vincular, aceitar, deixar de lado, ligar/desligar a resposta); pergunta do sistema sem código; resposta natural
  ("Pronto: …"); prompt e descrições.
- FORA: pedido do dono dentro de um grupo (E3), proatividade (E4), gasto por função (E5) — ver "Fora desta etapa".

## Critérios de aceite
- [x] AC1 — No laço do WhatsApp NENHUMA ação executa na hora (`exigirConfirmacao` em `cerebro.ts` → `ponte.ts`): tarefa e
      acompanhamento viram item na fila, como as de fila. A porta da ponte continua sabendo executar "direto" fora desse laço
      (testes de unidade da porta; o canal HTTP segue sem ação nenhuma).
- [x] AC2 — Pedido do dono com intenção de ação (verbo de ação por código — lista ampliada com vincular, ligar, desligar, aceitar,
      classificar, definir, ignorar, salvar, conciliar — ou um "sim"/"pode" dele) e SEM texto colado → os itens do pedido viram UMA
      proposta (`dolores_conversa_pendencia`) e o SISTEMA acrescenta a pergunta: «*Posso fazer isto?* - <resumo exato> Responda
      "pode"…» (registro, vale 15 min) ou «*Isto precisa da sua confirmação por escrito* (<motivo>) … responda: confirmo» (séria,
      10 min). Sem código, sem "aprovar", sem a palavra "código". O item da fila vence junto (15 min), não em 48 h.
- [x] AC3 — Resposta reconhecida por CÓDIGO (`shared/dolores/confirmacao.ts#lerConfirmacao`): a mensagem INTEIRA, até 40
      caracteres, sem quebra de linha, de uma lista fechada (pode, sim, ok, pode fazer, isso, manda ver…; confirmo; não, cancela,
      deixa pra lá…). "pode sim, e cria outra para o Pedro" não é confirmação. Só em `tratarComando` (número do dono, conversa
      direta, não encaminhada, sem mídia). Não chama a IA nem gasta.
- [x] AC4 — Proposta segura (`server/dolores/pendencia.ts`): no máximo UMA aberta (índice único parcial); proposta nova substitui a
      anterior e avisa ("A proposta anterior ficou de lado."); uso ÚNICO (UPDATE condicional aberta → confirmada; o perdedor de uma
      corrida recebe "Isso eu já fiz"); vencida → "venceu, nada foi feito"; o que executa é o item gravado e conferido por hash
      (`decidir`), nunca uma reinterpretação da IA; nível recalculado na hora pela função + argumentos guardados.
- [x] AC5 — Ordem: qualquer mensagem enviada ao dono depois da pergunta (resposta de outro pedido, aviso de grupo, relatório,
      recuperação) tira a proposta da ordem; um "pode" solto então só mostra de novo o que espera, e o "pode" seguinte faz.
- [x] AC6 — Séria (`nivelDoItem`): cobrança preparada, conciliar nota com pagamento, aceitar grupo, classificar/ligar a resposta em
      grupo administrativo (sócios), jurídico ou parceiros, e função desconhecida. "pode"/"sim" nela não executa: repete a frase
      exata ("Se é isso mesmo, responda: confirmo"). Nunca dinheiro além do que já existia (conciliar só grava o vínculo; nada paga)
      e nunca mensagem a terceiro (a cobrança continua só preparada).
- [x] AC7 — Texto contaminado não troca a proposta: pedido com texto colado (ou sem intenção do dono) não abre nem substitui
      proposta — o que ele gerar fica na fila com o quadro antigo (código/tela); texto de consulta, de grupo, de cliente ou de
      terceiro nunca é lido como resposta; proposta surgida depois de uma leitura leva no resumo o aviso "Pedido surgido durante a
      leitura de dados; confira antes de aprovar:".
- [x] AC8 — Grupos pela conversa (`server/dolores/acoes/grupos-config.ts`, etapa 7 em `permissoes.ts`): `classificar_grupo`
      (inclui "vincular ela ao grupo dela"), `aceitar_grupo` (sempre séria), `ignorar_grupo`, `ligar_resposta_grupo` (só o
      interruptor DO GRUPO; avisa quando o geral está desligado; nunca o liga). Execução reaproveita `decidirGrupo` (gatilho 0133,
      `decidido_por = whatsapp:dono`, auditoria `grupo_decisao`) e `definirRespostaDoGrupo`. Só executam com a decisão do dono no
      WhatsApp — pela fila da tela, recusam (aceitar grupo é só do dono, regra de 19/11). Grupo recusado/sem prova: classificar é
      recusado e pede aceitar antes. Só grupos da conexão da empresa.
- [x] AC9 — Resposta depois de feito, sem IA e sem código: "Pronto: <o que foi feito>." (+ texto da cobrança preparada, "NÃO enviado
      ao cliente"); o que não deu, com o motivo; o que não coube no tempo volta como proposta (mesma validade).
- [x] AC10 — Registro: `dolores_acoes` ganha `dolores_pendencia` (proposta aberta, confirmada, recusada, vencida, sem "confirmo", fora
      de ordem — só ids, contagens e nível, sem texto), além do que já existia (a ação, a decisão do item `fila:<código>`, a autoria
      ligada ao item aprovado, `grupo_decisao`). A tabela da proposta não tem coluna de texto.
- [x] AC11 — Segredos: senha, token, chave, código de acesso e dado bancário continuam recusados no texto a gravar (`textoDoDono`) e
      fora da resposta, da memória e da auditoria; nenhum dado pessoal em log/erro (só `erroParaLog`).
- [x] AC12 — Comandos antigos continuam: "aprovar CÓDIGO", "grupo K7QM …", "3 sim" e a tela da fila (não anunciados na conversa).
- [x] AC13 — Prompt: ela propõe, diz em uma frase o que vai fazer e para; o sistema pergunta; ela nunca pergunta ela mesma nem manda
      "ir à tela" para isso. Teto de gasto e reservas da E1 intactos (`consumo.ts` não mudou); a chave continua lida só em
      `bloqueioAtual` (`server/integracoes-anthropic.test.ts` intacto).

## Decisões
- [AUTO-DECISÃO] Nível sem coluna nova em `dolores_aprovacoes` (o plano previa `nivel`): calculado por código de função + argumentos
  guardados (protegidos pelo gatilho da 0125/0130). Motivo: uma coluna nova não estaria coberta pelo gatilho que impede alterar o
  item (rebaixar sério → registro); recalcular não depende de dado mutável. A proposta guarda o nível, e vale o mais forte dos dois.
- [AUTO-DECISÃO] Contaminação: em vez de mandar tudo o que foi lido para "aprovar CÓDIGO" (com a memória da E1 quase todo pedido nasce
  contaminado, o que tornaria o "pode" inútil), vale a intenção DO DONO, por código: pedido dele com verbo de ação e sem colagem é
  confirmável com "pode" (o resumo mostra o aviso de leitura quando houve); colagem / sem intenção → fila com código, como hoje, e
  nunca substitui a proposta aberta. Nada executa sem a palavra dele.
- [AUTO-DECISÃO] "pode" fora de ordem mostra de novo a proposta (em vez da forma longa "pode criar a tarefa" do plano): mais simples
  para ele e igualmente seguro (a repetição vira a última mensagem; o "pode" seguinte é adjacente). Validade não é prorrogada.
- [AUTO-DECISÃO] "não" só recusa se a pergunta for a última mensagem; senão segue como conversa comum (recusar não é urgente; a
  proposta vence sozinha).
- [AUTO-DECISÃO] "confirmo" vale sozinho (sem "confirmo cobrança"), como pediu o lead/dono ("exige a palavra confirmo").
- [AUTO-DECISÃO] Ações de grupo só executam com a decisão via WhatsApp (`ctx.via`), inclusive pelo "aprovar CÓDIGO" do dono; pela
  fila da tela, recusa (a tela de Grupos continua sendo o caminho do admin).
- Migração renumerada: o plano dizia 0144 (já usada pela C3); ficou 0145 e o plano foi corrigido.

## Fora desta etapa (com o motivo)
- Pedido do dono dentro de um grupo → E3 (ordem do lead).
- Atalhos `vincular_cliente_grupo` e `salvar_nota_cliente` (aliases do plano): `classificar_grupo` cobre o vínculo (a descrição cita
  "vincular ela ao grupo dela") e `registrar_acompanhamento` cobre a anotação; aliases só somariam tokens às ferramentas.
- Consultas novas ("buscar por nome aproximado", "resumir a situação", "listar o que está parado"): o plano da E2 não as lista; as
  leituras de hoje (consultar_cliente, listar_atrasos, listar_obras…) já servem e a E4 traz o "o que está parado" por regras.
- Confirmação parcial ("pode 1 e 3", "só o 2"): fica para depois; hoje "não" e um novo pedido resolvem.
- Reescrita dos textos fixos de grupos (`grupos-tipo.ts`, 2.2.5): são fixados por muitos testes de outra frente; com a memória e
  `classificar_grupo`, a resposta livre ("é da Lúcia") já resolve pela conversa; as opções numeradas continuam.
- Tela da fila (`DoloresFilaCard.tsx`) mostrando o nível e a proposta aberta: sem mudança de tela nesta etapa.
- `grupos-router.ts#ligarMarcacaoGrupo` não passou a usar `definirRespostaDoGrupo`/`motivoParaNaoLigar` (evitar mexer na tela do
  admin nesta etapa; as regras são as mesmas, a da conversa é um pouco mais estrita: exige tipo conhecido e obra não excluída).

## Riscos
- O dono responder "pode" por reflexo a uma proposta induzida por dado lido: mitigado pelo resumo exato (do sistema, com o aviso de
  leitura), ordem, validade curta, "confirmo" no que é sério e nenhum dinheiro/mensagem a terceiro.
- Migração 0145 não aplicada: a proposta não é gravada → cai no quadro antigo com código (falha segura); o "pode" segue para a IA.

## Testes
- (a) Automáticos: `server/dolores/c5-e2-resolve.test.ts` (novo, 25 testes): lista de respostas; níveis; pergunta sem código;
  verbos novos; migração idempotente e índice único; proposta → "pode" executa uma vez; "pode" de novo → já fiz; "não"; reentrega
  do mesmo "pode"; "pode" sem proposta (nada executa); vencida (e a tela também não aprova); fora de ordem; séria com "pode" não
  executa e com "confirmo" executa; estranho, cliente, grupo (inclusive com o número do dono como participante) e encaminhada não
  confirmam; texto colado não substitui a proposta; dado envenenado com "pode/confirmo" não confirma; três confirmações ao mesmo
  tempo → uma execução; auditoria; segredos fora de resposta/memória/auditoria; grupos (vincular cliente com "pode", administrativo
  sério, recusado → aceitar sério, tela não executa ação de grupo, ligar resposta só do grupo, ponte HTTP recusa).
  Ajustados (comportamento novo decidido pelo dono): `acoes.test.ts`, `acoes-whatsapp.test.ts`, `correcoes-e3.test.ts`,
  `c5-e1-voz.test.ts`, `ponte.test.ts` e os demais listados no Change Log. Resultados no Change Log.
- (b) Manuais: nenhum (sem banco real nesta etapa).
- (c) Pendentes em produção: aplicar 0143 (E1) e 0145; conversa real "Lucia brena" → "vincular ela ao grupo dela" → "pode";
  "cria uma tarefa pra Bianca ligar pro João amanhã" → "pode" → "pode" (já fiz); cobrança → "sim" (pede confirmo) → "confirmo".

## File List
- `drizzle/0145_dolores_pendencia.sql` (novo), `drizzle/schema-dolores-pendencia.ts` (novo), `drizzle.config.ts`
- `shared/dolores/confirmacao.ts` (novo), `shared/dolores/fila.ts` (verbos, `prefixoDaFila`), `shared/dolores/voz.ts` (rótulos)
- `server/dolores/pendencia.ts` (novo), `server/dolores/grupos-config.ts` (novo), `server/dolores/acoes/grupos-config.ts` (novo)
- `server/dolores/acoes/registro.ts`, `server/dolores/acoes/comum.ts`, `server/dolores/acoes/grupos.ts` (`mostrar` exportada),
  `server/dolores/acoes/tarefas.ts`, `server/dolores/acoes/acompanhamentos.ts`
- `server/dolores/aprovacoes.ts`, `server/dolores/ponte.ts`, `server/dolores/cerebro.ts`, `server/dolores/whatsapp.ts`,
  `server/dolores/prompt.ts`, `server/dolores/permissoes.ts`, `server/dolores/testes-banco.ts`
- `docs/stories/epics/epic-027-correcoes-20-11-noite/C5-PLANO-dolores-jarvis.md` (número da migração corrigido)
- Testes: `server/dolores/c5-e2-resolve.test.ts` (novo) e os ajustados acima

## Change Log
- 21/11/2026 — @dev (Dex): Draft → InProgress → InReview (YOLO).
- 21/11/2026 — @dev (Dex): piso da reserva `RESERVA_MINIMA_ENTRADA` 12.000 → 14.000 (as 4 ferramentas novas aumentaram o prefixo fixo
  para ~12,7 mil tokens pela estimativa por cima; o teste da E1 que trava o piso pegou). Mais rígido, não mais frouxo.
- 21/11/2026 — @dev (Dex): na conversa com confirmação natural o modelo não recebe mais o resumo do item (nomes do cadastro editáveis
  pela equipe); só o sistema o mostra ao dono.
- 21/11/2026 — testes (vitest, `--maxWorkers=2`; o `server/dolores` inteiro não coube no tempo — rodado por arquivos afetados):
  `c5-e2-resolve` (25), `acoes`, `acoes-whatsapp`, `correcoes-e3`, `correcoes-e3-r2`, `correcoes-e3-whatsapp`, `correcoes-e3-r2-whatsapp`,
  `c5-e1-voz`, `c5-e1-memoria`, `c5-e1-qa`, `c5-e1-qa-r4`, `c5-padroes-e-limite`, `ponte`, `whatsapp`, `whatsapp-qa`, `whatsapp-regras`,
  `e8-respostas-e-custo`, `e8-qa-seguranca`, `grupos`, `grupos-automaticos`, `marcacao`, `notas-obra`, `epic027-d-qa`,
  `epic027-c2-qa-seguranca`, `operacao-regras` e `server/integracoes-anthropic.test.ts` — todos verdes na última rodada de cada um
  (falhas intermediárias eram frases/fluxo antigos — execução direta da tarefa e quadro com código — ajustados ao comportamento
  novo). `npx tsc --noEmit` limpo. Sem mudança de tela (sem `vite build`). Não há script `lint`.
