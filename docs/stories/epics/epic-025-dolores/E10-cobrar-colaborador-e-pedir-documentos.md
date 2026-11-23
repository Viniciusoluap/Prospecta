# E10 — A Dolores cobra o colaborador e pede documentos ao cliente

Status: InReview (portão de QA de segurança de 23/11 deu CONCERNS; achados M1, M2, M3, B1 e B2 corrigidos pelo @dev em 23/11 — aguarda a reconferência do @qa)
Epic: EPIC-025 (Etapa 10). Regra do dono: CLAUDE.md, seção "Dolores cobra colaborador e pede documento a cliente — decisão do
dono em 23/11/2026". Continuam valendo as regras de 16/11 (segurança é prioridade; dados pessoais), 17/11 (termo/LGPD), 19/11
(grupos) e 20/11 (conexão única; atendimento de cliente cadastrado; mensagem de terceiro nunca é comando).
Paridade: a Dolores é exceção registrada no ROADMAP (fica fora do Grupo Santa Fé por decisão do dono de 17/11).
Ramo: `dolores-e10` (sobre `origin/claude/dolores-cobrancas`). Migração: **`0169_dolores_cobrancas.sql`** (0164–0168 reservadas
por outras frentes). NÃO aplicada no banco por esta etapa.

## Levantamento (código antes da mudança)
1. `server/dolores/acoes/cobrancas.ts` — `preparar_cobranca` (fila, aprovação do dono) monta o texto padrão
   (`textoDaCobranca`, shared/dolores/fila.ts) a partir dos documentos pendentes reais (`listarDocumentos`) e NÃO envia.
2. Fontes de atraso já usadas nas rondas e nos avisos: `listarTarefas`/`tarefaAtrasada` (tarefas), `carregarProcessos`
   (regularização), `carregarObras` (obra), `carregarFinanciamentos` (financiamento), `leads.card_due_date` e
   `lead_services.due_at` (CRM, inclusive jurídico), `avaliacoes.prazo_entrega` (avaliação).
3. Responsável: `tasks.assigned_to` e `regularizacoes.responsible` guardam o NOME do usuário; `leads.responsible_user_id` é o
   responsável do card; `avaliacoes.avaliador` é nome. Telefone do colaborador: `users.phone`.
4. Envio a contato pela conexão única: `enviarAoContatoComResultado` (server/dolores/roteamento.ts) — confere destino (nunca o
   dono nem o próprio número, nunca grupo), conexão, pausa geral, filtros de saída (canal "cliente"), grava em
   `whatsapp_messages` como automática (aparece na Central).
5. Crons: `/api/cron/dolores` (07h–14h de Brasília, de hora em hora) e `/api/cron/dolores-avisos/*` (15h–19h). Fortaleza e
   Brasília têm o mesmo horário (UTC−3, sem horário de verão).
6. Usuário ativo que escreve ao número da empresa é "usuario" no roteamento (`identificarRemetente`): vai à Central e nada
   automático sai.

## Critérios de aceite
- [x] AC1 — Cobrança do colaborador, sozinha: no cron (os dois horários), em horário comercial (segunda a sexta, 08h às 18h de
      Fortaleza), a Dolores junta TODOS os itens atrasados de cada colaborador (papel `colaborador`, ativo) — tarefas vencidas,
      regularização, obra, financiamento (parado), prazo do card e do serviço no CRM (inclusive jurídico) e avaliação — e manda
      UMA mensagem só, no WhatsApp dele (telefone do cadastro), pelo número da empresa: o que está atrasado, de qual cliente,
      desde quando. Responsável = o nome gravado no registro quando é um colaborador; senão, o responsável do card do cliente
      no CRM. Admin/dono e corretor não são cobrados.
- [x] AC2 — No máximo UMA por colaborador por dia (índice único dia + usuário em `dolores_cobrancas_colaborador`), teto
      global por dia, até N itens listados (padrão 10) com "e mais N item(ns)"; a mensagem cabe em uma mensagem curta.
- [x] AC3 — Texto montado por código (sem IA): sem valores em dinheiro (removidos do título também), só clientes dos itens
      dele, dados pessoais mascarados pelo filtro de saída. Sem telefone válido → não envia; vai para o resumo do dono.
- [x] AC4 — Resposta do colaborador (até 3 dias depois de uma cobrança): registrada (`dolores_cobrancas_respostas`) e
      encaminhada ao dono, com teto por colaborador por dia. Nunca é comando: nada é executado, nada entra na fila, o texto
      não entra na memória da conversa do dono (vai só uma linha fixa). Sem cobrança recente → Central, como antes.
- [x] AC5 — Pedido de documentos ao cliente (categoria liberada, modo b): no cron, em horário comercial, envia o texto fixo do
      sistema (`textoDaCobranca`, o mesmo do `preparar_cobranca`) só a cliente com `lgpd_consent = true`, card ativo (não
      finalizado nem excluído), telefone ligado a UM único cadastro (a mesma identificação por código da E9) e com documentos
      realmente pendentes (`situacaoDoCliente`). No máximo 1 a cada 3 dias por cliente (vaga atômica + registro com índice
      único dia + cliente); teto global por dia.
- [x] AC6 — O pedido grava no histórico do cliente (`lead_activities`, tipo "message") e em `whatsapp_messages` (Central); a
      equipe respondeu ou assumiu a conversa → a Dolores não envia (regra de silêncio da E9).
- [x] AC7 — Resumo diário ao dono (uma vez por dia, a partir das 17h): quantas cobranças e para quem (nome e número de
      itens), quem ficou sem telefone, quantos pedidos de documentos e para quem (nome e número de documentos) — sem CPF, sem
      telefone, sem valores.
- [x] AC8 — Interruptores próprios (`dolores_cobrancas_config`), os dois DESLIGADOS por padrão; tetos diários; pausa geral e
      conexão conferidas em cada envio; sem IA (sem gasto), mas cada envio é contado. Auditoria (`dolores_acoes`) só com ids,
      contagens e números mascarados.
- [x] AC9 — Tela de admin (Integrações › Dolores › Operação contínua): ligar/desligar cada função, tetos e os últimos envios
      (texto do registro, com dados pessoais mascarados). Só o administrador (papel conferido no servidor).
- [x] AC10 — Migração `0169` aditiva e idempotente (CREATE ... IF NOT EXISTS, INSERT ... ON CONFLICT DO NOTHING).

## Decisões automáticas (Dex)
- [AUTO-DECISION] "Colaborador" = usuário ativo com papel `colaborador` (o corretor é parceiro externo, fora da cobrança) →
  só `colaborador` (razão: o dono falou em colaborador; corretor e admin ficam fora).
- [AUTO-DECISION] Item "parado" (sem movimentação há 15 dias) entra junto com o atrasado → sim, marcado "parado há N dias"
  (razão: financiamento não tem prazo, só "parado"; o dono citou financiamento entre as pendências).
- [AUTO-DECISION] Horário comercial = segunda a sexta, 08h às 18h de Fortaleza (sugestão do pedido); resumo do dono das 17h às
  20h (janela dos avisos ao dono).
- [AUTO-DECISION] Sem cron novo: a rotina roda no fim das chamadas que já existem (os testes de agenda continuam iguais).
- [AUTO-DECISION] O intervalo de 3 dias é o mínimo (a tela aceita de 3 a 30).

## Tarefas
- [x] Story (este arquivo)
- [x] Migração `drizzle/0169_dolores_cobrancas.sql` + `drizzle/schema-dolores-cobrancas.ts`
- [x] Regras puras `shared/dolores/cobrancas.ts` (horário, texto do colaborador, sem valores, resumo)
- [x] Servidor `server/dolores/cobrancas-automaticas.ts` (coleta, envio, resposta, resumo, situação da tela)
- [x] Rotas `server/dolores/cobrancas-router.ts` (`dolores.operacao.cobrancas.*`, só admin)
- [x] Ligação nos crons (`server/dolores/rondas.ts`) e no webhook (`server/dolores/whatsapp.ts`)
- [x] Tela `client/src/components/admin/DoloresCobrancasSecao.tsx` no cartão de operação
- [x] Testes `server/dolores/e10-cobrancas.test.ts`
- [x] Portão de QA de segurança (@qa) — CONCERNS, testes em `server/dolores/e10-qa.test.ts`
- [x] Correção dos achados do portão (M1, M2, M3, B1, B2) — ver "Correções do portão"
- [ ] Reconferência do @qa
- [ ] Aplicar a 0169 no Neon, publicar e ligar conforme a decisão do dono

## Testes
(a) automáticos: ver `server/dolores/e10-cobrancas.test.ts` e a seção "Dev Agent Record".
(b) manuais: nenhum nesta etapa.
(c) pendentes em produção: aplicar a 0169; com os interruptores ligados, conferir a primeira cobrança e o primeiro resumo.

## File List
- `docs/stories/epics/epic-025-dolores/E10-cobrar-colaborador-e-pedir-documentos.md` (novo)
- `drizzle/0169_dolores_cobrancas.sql` (novo)
- `drizzle/schema-dolores-cobrancas.ts` (novo)
- `shared/dolores/cobrancas.ts` (novo)
- `server/dolores/cobrancas-automaticas.ts` (novo)
- `server/dolores/cobrancas-router.ts` (novo)
- `server/dolores/e10-cobrancas.test.ts` (novo)
- `client/src/components/admin/DoloresCobrancasSecao.tsx` (novo)
- `server/dolores/acoes/cobrancas.ts` (exporta `situacaoDoCliente`)
- `server/dolores/roteamento.ts` (tipos de envio automático novos)
- `server/dolores/whatsapp.ts` (resposta do colaborador; aviso ao dono sem o texto de terceiro na memória)
- `server/dolores/rondas.ts` (rotina no fim dos dois crons)
- `server/dolores/operacao-router.ts` (monta as rotas)
- `server/dolores/testes-banco.ts` (aplica a 0169 duas vezes)
- `client/src/components/admin/DoloresOperacaoCard.tsx` (mostra a seção)
- `docs/stories/epics/epic-025-dolores/EPIC.md` (etapa 10)
- `server/dolores/e10-qa.test.ts` (portão de QA; achados viraram testes normais)
- `server/whatsapp-conexao-empresa.ts` (M3: telefones dos usuários reservados na Central para quem não é admin)

## Dev Agent Record
- Testes automáticos (23/11): `server/dolores/e10-cobrancas.test.ts` 25/25 (regras puras, interruptor desligado, horário,
  pausa, consolidação de todos os itens numa mensagem, sem valores, teto 1/colaborador/dia inclusive com chamadas concorrentes,
  teto global, admin e corretor fora, sem telefone → resumo, conexão desligada, resposta encaminhada e nunca comando (nada na
  fila, texto fora da memória, reentrega não duplica, teto), pedido sem consentimento/telefone duplicado/conversa silenciada/sem
  pendência → não envia, 3 dias, histórico + Central, resumo sem CPF/telefone, cron da tarde, tela só admin, 0169 idempotente
  e CHECK). Regressão: c5-e4-proatividade, e9-conexao-unica, e9-qa-seg, e9-qa-seg-r2, e9-qa-seg-correcoes, ponte,
  leitura-somente, operacao, operacao-qa-seguranca, operacao-regras, operacao-migracao — 11 arquivos, 191/191.
- `npx tsc --noEmit` ok; `npx vite build` ok. O projeto não tem script `lint`.
- Achado no teste: o telefone da cliente "Maria Trello" do cenário é o do dono — o pedido agora recusa por código número do
  dono/da empresa antes do envio (`numero_reservado`), além da recusa que já existia na porta de envio.
- Segurança: a resposta do colaborador chega ao dono por `enviarAvisoAoDono` com `textoNaMemoria` (opção nova): o texto do
  terceiro não entra na memória que a IA da conversa do dono lê (evita injeção por colaborador).
- Observação para o QA (substituída pela correção M3 abaixo): a mensagem de cobrança ao colaborador ficava na Central visível
  a admin e colaborador.

## Correções do portão (23/11, @dev)
- M1 — `coletarCobrancas` (`server/dolores/cobrancas-automaticas.ts`): o nome gravado (tarefa, regularização, avaliação) é
  conferido contra TODOS os usuários (qualquer papel, ativos e inativos). Um só usuário colaborador ativo → dele; um só usuário de
  outro papel ou inativo → dessa pessoa, ninguém é cobrado; mais de um → ambíguo: ninguém é cobrado e o item entra no resumo do
  dono como "responsável ambíguo" (só a fonte e o nome gravado, sem cliente). Nome vazio ou de ninguém → responsável do card no CRM.
  [AUTO-DECISION] Nome de UM só usuário que não é colaborador ativo → não é "ambíguo" no resumo (o item é claramente daquela
  pessoa e já aparece no relatório do dono). `coletarItensPorColaborador` continua existindo (só os itens por colaborador).
- M2 — `semValores` (`shared/dolores/cobrancas.ts`): moeda antes ou depois do número (R$, US$, U$, BRL), "reais"/"contos",
  escala sem moeda ("5 mil", "2 milhões", "30k"), número com vírgula e 2 casas ("1.500,00", "1500,00") e porcentagem ligada a
  dinheiro (comissão, desconto, juros, entrada, sinal, taxa, multa, correção; "do valor", "de entrada", "ao mês"...).
  [AUTO-DECISION] Ficam de propósito (documentado no código): porcentagem de andamento ("obra 80% concluída"), medidas
  ("12,50 m²", "2 mil m²"), número sem vírgula nem moeda ("1.500" pode ser lote, protocolo ou matrícula) e datas.
- M3 — `numerosReservadosDoPapel` (`server/whatsapp-conexao-empresa.ts`): para o colaborador (conexão da empresa, não admin), os
  telefones de TODOS os usuários do sistema entram nos números reservados — a conversa da empresa com um usuário (cobrança e
  resposta) some da lista, do histórico, da mídia, da exclusão e do envio pela Central; só o admin vê. O corretor usa a própria
  conexão e nunca vê as conversas da empresa. Falha ao ler os usuários → fecha (nada listado), como o resto dos reservados.
- B1 — `ehFeriadoNacional`/`domingoDePascoa`: feriados nacionais fixos (01/01, 21/04, 01/05, 07/09, 12/10, 02/11, 15/11,
  20/11 — nacional desde a Lei 14.759/2023 —, 25/12) e móveis pela Páscoa (Carnaval segunda e terça, Sexta-feira Santa, Corpus
  Christi) não são dia útil (nem cobrança nem resumo). Feriado estadual/municipal não é conhecido. O teste de fuso que usava a
  sexta 20/11 passou para a sexta 27/11.
- B2 — pedido de documentos: ao bater no registro único do dia (tentativa anterior que falhou soltou a vaga), a vaga do cliente
  é solta de novo — no dia seguinte ele volta a ser elegível (antes ficava 3 dias preso).
- Verificação depois das correções e do merge da `origin/main` (23/11): `pnpm install --frozen-lockfile` ok; `npx tsc --noEmit`
  ok; `npx vite build` ok. Testes em lotes (`--maxWorkers=2 --minWorkers=1`): e10-cobrancas + e10-qa 2 arquivos 59/59;
  c5-e4-proatividade + e9 (4) 5 arquivos 97/97; ponte + leitura-somente + operacao (4) 6 arquivos 94/94; c2 (3) +
  whatsapp-lote3 + whatsapp-filtro-etapa (regressão da M3 na Central) 5 arquivos 70/70 — total 18 arquivos, 320/320.
  Conflito do merge só em `server/dolores/testes-banco.ts` (resolvido por união: 0169 + 0166/0170).
