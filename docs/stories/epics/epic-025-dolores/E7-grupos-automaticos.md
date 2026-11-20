# E7 — Grupos automáticos, por tipo

Status: InReview
Epic: EPIC-025 (Etapa 7) — substitui o cadastro manual de grupo da E4 (o painel passa a servir para ver e corrigir).
Paridade: Dolores é exceção de paridade (ROADMAP, decisão do dono de 17/11/2026); registrada só como histórico no ROADMAP.
Ramo: `epic025-dolores-etapa7` (WIP em `claude/wip-epic025-dolores-etapa7`). Migração: `drizzle/0133_dolores_grupos_tipo.sql`.

## Decisão do dono (19/11/2026) — é a lei desta story
Palavras dele: "eu não quero ter que cadastrar grupo por grupo; todos os grupos que a Dolores participar é porque ela deve
participar […] esse número é exclusivo pra Dolores, então não vai existir entrada de grupos aleatórios". Especificação completa:
`CLAUDE.md`, seção "Dolores — grupos entram sozinhos, por tipo (19/11/2026)".

**Mudança do dono no mesmo dia (19/11/2026), que substitui "qualquer grupo vale automaticamente":** "somente o número principal,
que no caso foi cadastrado meu lá na integração, pode adicionar o número da Dolores em grupo, e assim nós não corremos risco de
qualquer pessoa adicionar ela em outros grupos". Ver AC14–AC18.

## Critérios de aceite
- [x] AC1 — Entrada automática: a primeira mensagem (válida e recente) de um grupo desconhecido daquela instância cria o grupo em
      `dolores_grupos` (origem `automatico`), e a mensagem passa a ser registrada. O botão "Atualizar grupos" faz o mesmo para os
      grupos que a Evolution lista. Idempotente (índice único instância + id do grupo; aviso paralelo usa o grupo já criado).
- [x] AC2 — O NOME vem da Evolution (`findGroupInfos` no webhook, só com tempo de sobra; a lista de grupos no botão), nunca do texto
      de mensagem. Sem nome: tipo `indefinido`.
- [x] AC3 — Teto de segurança: no máximo N grupos novos por dia (padrão 20, 0–200 na tela). Passou: não cria e avisa o dono UMA vez
      no dia (auditado). Interruptor "entrada automática de grupos" nasce LIGADO; desligado, grupo novo é ignorado como antes.
- [x] AC4 — Tipo por CÓDIGO (`shared/dolores/grupos-tipo.ts`, sem IA): Jurídico/Administrativo/Parceiros/Engenharia (palavra
      inteira, sem acento/caixa) → interno; nome igual ao de UM cliente do CRM (ou contendo o nome completo dele) → cliente, ou
      pós-atendimento com "pós"/"pós-atendimento"/"pós venda"; homônimos, mais de um cliente, nome curto (< 2 palavras ou < 6
      letras), dois tipos internos no nome ou nada casando → `indefinido`.
- [x] AC5 — Aviso ao dono pelo `enviarAvisoAoDono` (mesmos filtros de saída; só o número do dono): "entrei no grupo «X». Entendi:
      cliente «Fulano» (nº 123). Se estiver errado, responda: grupo <código> …". Nomes de terceiros por `limparNomeDeTerceiro`,
      entre «». Indefinido: pergunta e o grupo fica `aguardando_dono` (só observa; mudo mesmo marcado). Um aviso por grupo; teto
      diário de avisos (padrão 25).
- [x] AC6 — Comando do dono `grupo <código> <tipo> [nº]` reconhecido por CÓDIGO (mensagem inteira, regex estrita), só na conversa
      direta do número do dono (não encaminhada, sem mídia), sem IA. Grava direto, auditado (`dolores_acoes`, função
      `grupo_decisao`). "ignorar" desativa (nada é apagado). A mesma frase escrita num grupo (mesmo pelo dono) ou por outro número
      não faz nada. Código curto (4 caracteres) gerado pelo servidor por grupo. Também pela tela (só admin, rota `definirTipo`).
- [x] AC7 — Escopo por tipo TRAVADO NO SERVIDOR (`escopoDoGrupo` em `server/dolores/marcacao.ts`): cliente/pós → as 3 leituras do
      cliente do grupo (como na 4b); administrativo → leituras gerais de `leitura/`, canal `grupo` (dados pessoais SEMPRE
      mascarados), nenhuma escrita; jurídico → processos, regularizações e documentos; engenharia → obras, medições e notas;
      parceiros → só o andamento (situação neutra) dos leads cujo `broker_id` é o corretor ATIVO identificado pelo telefone do
      remetente (do servidor do WhatsApp); não identificado → frase fixa; indefinido/aguardando/inativo → silêncio.
- [x] AC8 — Em todos: só quando marcada (menção real), nunca age, filtros da E4b (links, números/datas sem fonte, texto ditado,
      "aprovado/reprovado"), tetos por grupo/dia e por pessoa/hora, orçamento, `countTokens`, falha fechada, pausa geral.
- [x] AC9 — Interruptores: o geral da resposta continua desligado por padrão (nenhuma migração liga nada). O do grupo nasce LIGADO
      para grupo avisado/confirmado (o dono desliga na tela ou com "ignorar").
- [x] AC10 — Classificação (E4) e notas (E5) continuam exigindo vínculo: documento só vai à IA em grupo de cliente/pós com cliente
      ligado (ou grupo de obra, para a nota). Internos e aguardando: o documento fica registrado, sem IA.
- [x] AC11 — Tela: a lista dos grupos (tipo, vínculo, situação, código, origem), "Corrigir tipo ou vínculo", "Ignorar este grupo",
      "Atualizar grupos", interruptor e tetos da entrada automática; o cadastro manual fica recolhido ("raro").
- [x] AC12 — Ronda/relatório (E6): "grupos novos aguardando sua resposta" na seção dos grupos.
- [x] AC13 — Migração 0133 aditiva e idempotente; gatilho `dolores_grupos_guarda` mantém tudo o que protegia e passa a exigir
      `decidido_em` para mudar tipo/vínculo; nome visto na entrada e código não mudam; exclusões de cliente/obra/usuário continuam.

- [x] AC14 — Autoria provada por CÓDIGO, nesta ordem: aviso `group-participants.update` da Evolution (action "add", a Dolores —
      número conectado ou `@lid` conferido — entre os `participants`) com `author`/`authorPn` = número do dono (`ehNumeroDoDono`);
      autor em `@lid` só vale resolvido para telefone pelos participantes do grupo na Evolution (`findGroupInfos`); aviso
      `groups.upsert` com `owner` = dono e a Dolores dentro; sem aviso: dados do grupo na Evolution — dono participante E (criador
      OU admin). Os avisos chegam pelo webhook autenticado (HMAC próprio da Dolores); texto e campos do item de mensagem nunca contam.
- [x] AC15 — Sem prova → `recusado` (novo valor de `situacao_confirmacao`; `adicionado_por = outra_pessoa`): não lê, não registra
      mensagens nem marcações, não responde, documento não vai à IA. UM aviso ao dono com "grupo <código> aceitar". Conta no teto
      diário de grupos novos e de avisos.
- [x] AC16 — `grupo <código> aceitar` (só o dono, conversa direta, por código) aceita; o dono adicionando a Dolores depois (aviso
      provado) também aceita; na tela, "Aceitar este grupo" (só admin). O gatilho só deixa sair de `recusado` com `decidido_em`.
- [x] AC17 — Trocar o número do dono depois não desfaz grupos já aceitos (a prova vale na entrada); os novos seguem o número novo.
- [x] AC18 — A instância da Dolores assina também `GROUP_PARTICIPANTS_UPDATE` e `GROUPS_UPSERT` (`EVENTOS_WEBHOOK_DOLORES`); a
      Central de Vendas continua com os 3 avisos de antes. Instância já conectada: reaplicar pelo botão "Reativar recebimento"
      (Integrações › Dolores; documentado em como-ligar.md). A tela mostra "Adicionada por: dono / outra pessoa — recusado".

## [AUTO-DECISION]
- Número da migração → `0133` (reason: a `0132` já é `0132_consentimentos_retirada.sql`, em produção; não editar migração aplicada).
- Grupos já cadastrados à mão, SEM vínculo, depois da 0133 → continuam "grupo de cliente sem card ainda" (tipo vazio = como na E4:
  classificação e fila "criar card" seguem; marcada, a frase fixa de "sem cliente ligado") (reason: o admin os cadastrou como grupo
  de cliente; tratá-los como `indefinido` mudaria em silêncio o comportamento da E4 já em produção). Só grupo que entra sozinho
  pode ficar `indefinido`.
- Grupo de engenharia LIGADO A UMA OBRA (os grupos de obra da E5, que têm o empreiteiro) → continua com as 3 leituras fechadas
  daquela obra (reason: não alargar o que o empreiteiro, terceiro, pode ler). Só "engenharia" sem obra lê as leituras gerais de
  obras, medições e notas.
- Valores em R$ na resposta → só no grupo administrativo, e só os que vieram das consultas (reason: "tudo, menos senhas…" vale
  para os sócios; jurídico e engenharia podem ter terceiros e o dono não liberou valores lá). Parceiros: a saída completa do
  grupo de cliente (sem valores, comissão, prazo, aprovação).
- Parceiro = usuário ATIVO de papel `corretor` com o mesmo telefone do remetente — número COMPLETO com 55, a mesma conferência
  estrita do dono (só a variação do 9º dígito); corrigido no QA-SEG (achado 5), antes era DDD + 8 finais; nenhum ou mais de um →
  frase fixa (reason: o sistema não tem papel "correspondente"; na dúvida, não identifica). A resposta mostra só o nome curto
  do cliente ("Maria S.") porque o grupo é lido pelos outros parceiros.
- "Nome igual ao de um cliente" → compara com os clientes não excluídos do CRM (todas as etapas), até 20 mil (reason: grupo de
  pós-atendimento é de cliente finalizado).
- Comando com código fora do alfabeto (ex.: "grupo ZZZZ jurídico") → ainda é o comando ("não achei o grupo"), nunca vai à IA.
- Aviso de entrada que não sai (Dolores pausada/desconectada) → não é repetido; o grupo aparece na tela e, se aguardando, no
  relatório (reason: aviso no máximo uma vez, contra enxurrada).
- Contadores (grupos novos/dia, avisos/dia, aviso por grupo) → a tabela de contadores da 4b (`dolores_marcacoes_contagem`, chaves
  próprias) (IDS: REUSE; nenhuma tabela nova).
- "Renomear o grupo não muda o tipo" → garantido por código (o tipo só é calculado na entrada) e pelo gatilho (`nome_whatsapp` e
  `codigo` não mudam depois de preenchidos; tipo/vínculo só com `decidido_em`).
- A aprovação "criar card do cliente" pela fila (E4) grava a decisão junto (`decidido_por = fila:<id>`) e nunca transforma grupo
  interno em grupo de cliente.

- Sem os dados do grupo na Evolution (fora do ar, sem tempo no prazo do aviso) e sem aviso de autoria → recusado (reason: "se não
  der para provar que é o dono → NÃO é o dono"); o dono aceita com um comando.
- Aviso de participantes cujo autor é outro número → recusado mesmo que o dono seja admin do grupo (reason: o aviso prova quem
  adicionou; foi outra pessoa).
- Os dados do grupo também são conferidos no botão "Atualizar grupos" (a lista da Evolution não traz participantes).

## Correções do portão de QA de segurança (19/11/2026, QA-SEG E7 = FAIL → corrigido)
O portão reprovou a etapa: o caminho de reserva (dono participante e criador/admin) aceitava grupo em que OUTRA pessoa colocou a
Dolores. A regra continua a do dono — só vale grupo em que ela foi adicionada PELO NÚMERO DELE — e agora só existe aceitação
automática com PROVA POSITIVA. Isto refina AC14–AC16 (texto dos AC mantido; o que vale é o abaixo):
1. (ALTO) Autoria: (a) aviso de "add" com autor não provado (@lid sem resolver, sem `author`) → `recusado`
   (`adicionado_por = desconhecido`, `prova_adicao = sem_prova`), nunca a reserva; (b) a reserva pelos dados do grupo (primeira
   mensagem, "Atualizar grupos", inclusive os grupos em que ela JÁ está hoje) grava no máximo `aguardando_dono` com
   `adicionado_por = desconhecido` — só observa, interruptor do grupo desligado, nada de IA — e pergunta ao dono "Estou no grupo
   «X» e não sei quem me colocou. Se foi você, responda: grupo <código> aceitar" (aceito, segue o fluxo normal do tipo); sem os
   dados ou sem o dono participante e criador/admin → `recusado`; (c) aviso de "add" de outra pessoa (ou sem autor provado) para
   grupo automático ainda não decidido (`decidido_em` nulo) rebaixa para `recusado` e desliga o interruptor do grupo. O dono
   adicionando a Dolores (aviso de "add" com autor = número dele) aceita recusado/aguardando e manda o aviso do tipo.
2. (ALTO) `groups.upsert` só prova para grupo NOVO criado AGORA (campo `creation` de no máximo 5 min, segundos ou ms) pelo dono,
   com a Dolores na lista inicial. Nunca muda grupo que já existe (nem tira de `recusado`/`aguardando_dono`).
3. (MÉDIO) Jurídico e engenharia geral ("sem valores"): os campos de dinheiro (`financeiro`, `moeda`, `valor*`, `orcamento*`,
   `vgv`, `saldo*`, `preco*`, `parcela*`, `custo*`, `comissao*`, `recebimentos`, `pagamentos*`, `textoSugeridoParaODonoEnviar`)
   saem NO SERVIDOR do que as leituras gerais devolvem ao modelo (`semCamposDeValor`); o filtro de saída ganha as palavras de
   valor (valor, parcela, orçamento, saldo, preço, custo, pagamento, a receber…) quando `permiteValores` é falso.
4. (MÉDIO) Custo/abuso: grupos sem prova (recusados/aguardando) têm contador diário próprio (o mesmo número configurado, chave
   separada; aviso único do teto deles) — grupo que o dono provadamente adicionou não depende dele; avisos de grupos sem prova:
   os 5 primeiros do dia (no máximo o teto de avisos) e depois UM resumo no dia; avisos do dono não são gastos por eles. Rajada de
   mensagens do mesmo grupo novo: uma entrada por vez por grupo na instância (uma consulta `findGroupInfos`, uma vaga) e, se bateu
   no teto, 60 s sem perguntar de novo à Evolution.
5. (BAIXO) Parceiro casado pelo número completo com 55 (ver decisão acima).
6. (BAIXO) (c) grupo `recusado` ou aguardando sem prova só sai desse estado pelo comando do DONO no WhatsApp: a tela mostra e
   explica ("aguardando você: não sei quem me colocou"; o botão "Aceitar" saiu), permite desativar/ignorar e o rótulo, mas recusa
   trocar vínculo, definir tipo, aceitar e ligar o interruptor; a fila (`ligarGrupoAoCliente`) também não liga esses grupos. O
   gatilho exige `decidido_por` começando por `whatsapp:` para tirar a linha desse estado (ir PARA `recusado` é livre).
   (d) alguém adicionado a um grupo ADMINISTRATIVO já aceito → um aviso ao dono por grupo por dia (nome do grupo limpo, sem número
   nem nome de quem entrou), pelo `group-participants.update`. (a) e (b) do achado ficam como estão (documentados no QA).
- Janela de migração: com a 0133 aplicada e o código ANTIGO no ar, o gatilho só exige `decidido_em` para tipo/vínculo nas linhas
  da etapa 7 (`origem = 'automatico'` ou `tipo` preenchido, antes ou depois); linhas manuais antigas seguem a regra antiga, então
  o `ligarGrupoAoCliente` e a tela `grupos.atualizar` antigos continuam funcionando. `origem` 'automatico' não volta a 'manual'.
  A 0133 ainda não foi aplicada: editada no próprio arquivo, continua aditiva e idempotente (`adicionado_por` aceita 'desconhecido').
- [AUTO-DECISION] "aguardando o dono" sem prova × "aguardando o dono" por tipo indefinido → o mesmo valor `aguardando_dono`,
  distinguido por `adicionado_por <> 'dono'` e `prova_adicao <> 'aceito_pelo_dono'` em grupo automático (`autoriaPendente`)
  (reason: sem valor novo de situação; todas as travas que já silenciam `aguardando_dono` valem sem mudança).
- [AUTO-DECISION] 6c vale para a ACEITAÇÃO: grupo `aguardando_dono` por tipo indefinido que o dono provadamente adicionou continua
  podendo ter o tipo definido pela tela (reason: o dono já o aceitou; a tela só corrige o tipo, como antes).
- [AUTO-DECISION] Teto dos grupos sem prova = o mesmo número de "grupos novos por dia", em contador separado (reason: não criar
  coluna/campo de tela novo; o dono ajusta os dois juntos).

## Reforços da 2ª rodada do portão de QA de segurança (20/11/2026, QA-SEG E7 r2 = CONCERNS, sem bloqueio)
1. (média, R2-1) `groups.upsert` NUNCA aceita sozinho: a lista que ele traz é a de agora e não prova que a Dolores estava entre os
   participantes INICIAIS (num grupo do dono criado há 2 min, outro membro pode tê-la colocado). Grupo novo, criado agora pelo
   dono, com a Dolores na lista → `aguardando_dono` (`adicionado_por = desconhecido`, `prova_adicao = criador`) e a pergunta
   "não sei quem me colocou; grupo <código> aceitar". Aceitação automática só pelo aviso de "add" com o autor = número do dono.
   Isto substitui o item 2 das correções acima.
2. (média, R2-5) Jurídico/engenharia: `alertas` e `conciliacao*` também saem no servidor, e em TODO texto que sobrar das leituras
   (`observacoes`, `descricao`, `textoLivre`…) os valores em dinheiro — "R$ …", números com ",dd", "12 mil" e números ≥ 100
   colados a palavra de dinheiro ("saldo de 12500", "1.500 reais") — viram "[valor omitido]" (`semValoresNoTexto`). O
   administrativo não muda.
3. (relato, R2-6) Filtro de saída dos grupos internos sem valores: palavras de SITUAÇÃO (paga, pago, pagamento, "aguardando
   pagamento") passam quando a frase não tem número de dinheiro; as de QUANTIA (valor, parcela, orçamento, saldo, preço, custo,
   comissão, a receber…) continuam barradas sempre. Grupos de cliente e parceiros: filtro inalterado.
4. (baixa, R2-3) Todo grupo automático `aguardando_dono` — inclusive o que o dono adicionou mas ficou de tipo indefinido — só
   sai desse estado pelo comando do dono no WhatsApp. A tela recusa definir o tipo (mostra o comando "grupo <código> <tipo>"),
   o interruptor do grupo não liga e a fila não liga o grupo ao cliente; o gatilho da 0133 (editado no próprio arquivo, ainda
   não aplicada; continua aditiva e idempotente) exige `decidido_por LIKE 'whatsapp:%'` para essa saída. Substitui a
   [AUTO-DECISION] "6c vale para a ACEITAÇÃO" acima.
5. (baixa, R2-2) O add provado do dono grava a decisão (`decidido_em`, `decidido_por = 'whatsapp:add-do-dono'`). Grupo com
   decisão do dono não é rebaixado por add de terceiro: o dono recebe "«Fulano» me recolocou no grupo «X»" (nome limpo; sem
   nome, só o final do número; um aviso por grupo por dia e teto diário próprio, `avisos-recolocada:<dia>`).
6. (baixa) O aviso de "alguém entrou no grupo administrativo" tem contador próprio (`avisos-adm-entrada:<dia>`), separado dos
   avisos de grupo novo.
- Extra: teste de `ON DELETE SET NULL` da OBRA em linha `recusado` da etapa 7 (R2-7).
- **Cuidado de reversão (apontado pelo QA):** antes de voltar ao código anterior à etapa 7 com a 0133 aplicada, DESATIVAR os
  grupos `recusado` e `aguardando_dono` (`UPDATE dolores_grupos SET ativo = false … WHERE situacao_confirmacao IN ('recusado',
  'aguardando_dono')`, com autorização do dono). O código antigo não conhece essas situações e trataria esses grupos como
  cadastrados e ativos (leria e registraria as mensagens deles).

## Pendências (não inventadas — dependem de decisão ou de etapa futura)
- Opção futura (NÃO implementada): a Dolores sair sozinha do grupo recusado.
- Grupo "engenharia" geral (sem obra única) NÃO lê nota sozinho: falta identificar a obra pela própria nota (story futura).
- Papel "correspondente" não existe no sistema: hoje só corretor é identificado no grupo de parceiros.
- Aviso de entrada que falhar não é reenviado (ver decisão acima); se o dono quiser, um "reenviar avisos pendentes" na tela.
- CLAUDE.md, item 1 da regra "grupos entram sozinhos", ainda diz "sem esse aviso, o dono precisa ser participante e
  criador/admin" (aceito): o comportamento agora é "no máximo aguardando o dono". O @dev não edita CLAUDE.md por mensagem de
  agente — atualizar o texto com o dono/a sessão principal.
- 6d depende de a Evolution mandar `group-participants.update` também quando OUTRA pessoa entra (a instância já assina o
  evento); sem o evento, não há aviso (sem consulta periódica).
- Aplicar a `0133` no Neon antes de publicar o código (sem ela, as leituras de grupo falham fechado: grupos ignorados).

## Testes
- `server/dolores/grupos-qa-seg-e7.test.ts` (provas do QA, invertidas depois da correção + regressão por achado): A1/A1b (autor
  não provado → recusado), A2 (corrida: rebaixa; decidido pelo dono não rebaixa), A3/A3b (upsert não muda existente; só criação
  recente), A4 (reserva → aguardando com a pergunta exata; tela não aceita; o dono aceita no WhatsApp), A5 (o dono adicionando
  aceita), A6 (gatilho), B1/B1b (palavras de valor; campos de dinheiro removidos no servidor, administrativo continua com valores),
  B2 (+995 não casa), C1–C3 (teto próprio, avisos agrupados, rajada com uma consulta e uma vaga), J1 (janela de migração: operações
  do código antigo sobre grupo manual depois da 0133), D1 (6c: tela e fila não aceitam), D2 (6d: aviso de quem entra no administrativo).
- `server/dolores/grupos-automaticos.test.ts` ajustado: grupos entram pelo aviso de "add" do dono; sem aviso → aguardando/recusado
  `desconhecido`; upsert com `creation`; recusado não gasta o teto do dono; migração: linha manual aceita o UPDATE antigo.
- `server/dolores/grupos-automaticos.test.ts` (novo): autoria (adicionada pelo dono → aceito; por outro número → recusado, nada
  lido, um aviso só; sem aviso → dados do grupo; autor forjado no corpo da mensagem não conta; @lid resolvido e não resolvido;
  groups.upsert com o dono criador; `aceitar` de outro número ou no grupo não faz nada; o dono adicionando depois aceita; gatilho;
  recusado no teto; troca do número do dono), função pura do tipo (acentos, homônimos, nome curto, dois clientes, "pós",
  internos), comando (formatos válidos e inválidos), aviso (nomes limpos), migração 0133 duas vezes sobre banco com grupos (nada
  muda; gatilho; CHECK; exclusões de lead/obra/usuário), entrada automática (tipo pelo nome da Evolution, aviso único só ao dono,
  teto diário com aviso único, entrada desligada, histórico/própria não criam, desativado ignorado, documento interno sem IA),
  comando do dono (grava/audita; inexistente não muda; a mesma frase no grupo ou de outro número não faz nada), renomear não
  muda tipo, escopo (parceiro A × B, não identificado, jurídico sem financeiro, administrativo mascarado, engenharia, obra),
  filtros internos, laço jurídico ponta a ponta, rotas só do admin pelo `appRouter`.
- Atualizados para a regra nova ("grupo não cadastrado é ignorado" agora vale com a entrada automática DESLIGADA):
  `grupos.test.ts` (leitura: não cadastrado e inativo), `marcacao.test.ts` (menção em grupo não cadastrado — e, com a entrada
  ligada, o grupo entra mas fica mudo), `whatsapp.test.ts` (grupo ignorado sem registro); `grupos-qa.test.ts` (o preparo do teste
  de obra excluída liga a obra com `decidido_em`, exigido pela 0133); `grupos-qa-r2.test.ts` (lista de arquivos que usam a
  Evolution inclui `grupos-entrada.ts`, que também liga o `semRedirecionamento`).

## File List
- `drizzle/0133_dolores_grupos_tipo.sql` (novo)
- `drizzle/schema-dolores-grupos.ts`
- `shared/dolores/grupos-tipo.ts` (novo)
- `shared/dolores/marcacao.ts` (filtro por tipo, saída interna, frases e prompts)
- `shared/dolores/operacao.ts` (relatório: grupos aguardando)
- `server/dolores/grupos-entrada.ts` (novo)
- `server/dolores/grupos-decisao.ts` (novo)
- `server/dolores/grupos.ts`, `server/dolores/grupos-router.ts`, `server/dolores/marcacao.ts`, `server/dolores/whatsapp.ts`
- `server/dolores/classificacao.ts`, `server/dolores/rondas.ts`, `server/dolores/documentos-cliente.ts`, `server/dolores/funcoes.ts`
- `server/dolores/leitura/grupo-marcado.ts` (leitura do parceiro), `server/dolores/leitura/{atrasos,clientes,financeiro,notas,regularizacoes}.ts` (tipo do canal)
- `server/_core/evolution.ts` (`metadadoDoGrupoEvolution`, só leitura; `EVENTOS_WEBHOOK_DOLORES`), `server/dolores/router.ts` (assinatura dos avisos de grupo)
- `CLAUDE.md` (item 1 da regra "grupos entram sozinhos": só o número do dono adiciona)
- `server/dolores/router.test.ts` (a assinatura do aviso da Dolores inclui os avisos de grupo)
- `server/dolores/testes-banco.ts`, `server/dolores/grupos-automaticos.test.ts` (novo) e os testes atualizados acima
- `client/src/components/admin/DoloresGruposCard.tsx`
- `docs/dolores/como-ligar.md`, `docs/stories/epics/epic-025-dolores/EPIC.md`, `docs/stories/epics/ROADMAP.md`
- `server/dolores/grupos-qa-seg-e7.test.ts` (provas do QA, invertidas; regressões das correções)
- `server/dolores/grupos-qa-seg-e7-r2.test.ts` (provas da 2ª rodada do QA, invertidas/ajustadas; item 6; ON DELETE SET NULL da obra)

## Change Log
- 19/11/2026 — @dev (Dex): InProgress → InReview. `npx tsc --noEmit` limpo; `npx vitest run server/dolores
  server/integracoes-anthropic.test.ts server/integracoes-modelo-por-funcao.test.ts server/auth-session.test.ts
  server/imports-esm.test.ts server/api-rotas-producao.test.ts --maxWorkers=2 --minWorkers=1` → 36 arquivos, 655 testes, 0 falhas;
  `npx vite build` ok. Migração 0133 NÃO aplicada em banco real (fica para a publicação). Portão de QA de segurança pendente.
- 20/11/2026 — @dev (Dex): correções do portão de QA de segurança (FAIL de 19/11) — achados 1–6 e janela de migração da 0133
  (ver "Correções do portão de QA de segurança"). `origin/main` (PRs #256 e #257) já contida no ramo; nenhuma migração nova na
  main colide com a 0133 (a última lá é a 0132). `npx tsc --noEmit` limpo; `npx vitest run server/dolores
  server/integracoes-anthropic.test.ts server/integracoes-modelo-por-funcao.test.ts server/auth-session.test.ts
  server/imports-esm.test.ts server/api-rotas-producao.test.ts --maxWorkers=2 --minWorkers=1` → 37 arquivos, 672 testes, 0 falhas;
  `npx vite build` ok. 0133 NÃO aplicada em banco real. Volta ao portão de QA de segurança.
