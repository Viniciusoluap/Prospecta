# E9 — Conexão única do WhatsApp, atendimento e campanhas

Status: InReview (portão de QA de segurança de 20/11: FAIL → InProgress; achados 1–7 corrigidos pelo @dev → InReview; aguarda a nova revisão do @qa)
Epic: EPIC-025 (Etapa 9). Regra do dono: CLAUDE.md, seção "WhatsApp — uma conexão só, atendimento e campanhas (20/11/2026)",
itens 1 a 8 ("Autorizo os itens 1 a 7, pode executar").
Paridade: suspensa por ordem do dono em 16/11 (Grupo Santa Fé em espera); registrar no ROADMAP o que portar.
Ramo: `epic025-dolores-etapa9b` (sobre a Etapa 7, `fd43b31`); push em `claude/wip-epic025-dolores-etapa9b`.
Migração: **`0135_whatsapp_conexao_unica.sql`** (0117–0134 já em produção).

## Levantamento (código antes da mudança)
1. Duas conexões: (a) Dolores — instância `prospecta-dolores`, linha `dolores_whatsapp_config` (instância, status, número),
   cartão `DoloresCard.tsx` com QR/Conferir/Reativar/Desconectar, webhook `POST /api/dolores/whatsapp` (HMAC próprio +
   checagem da instância) em `server/dolores/whatsapp.ts`; (b) Central — `whatsapp_connections` (UMA por usuário; o
   colaborador usa a do primeiro admin, `donoDaConexao`), webhook `server/whatsapp-evolution-webhook.ts` (acha a conexão pela
   instância), telas `AdminWhatsApp.tsx` + `ConexaoWhatsApp`/`ConexaoQrCode`.
2. No webhook da Dolores, mensagem direta de quem não é o dono só era contada (`dolores_remetentes_estranhos`) e `fromMe` era
   ignorada; grupos seguem E4/E4b/E7. Nada chegava à Central pela instância da Dolores.
3. Cadastros com telefone: `leads.phone` (CRM; obra, incorporação e jurídico se ligam ao lead), `financiamentos.cliente_tel`,
   `regularizacoes.client_phone`, `avaliacoes.cliente_tel`, `operational_projects.client_phone`; usuários em `users.phone`.
   As leituras fechadas da E4b (`leitura/grupo-marcado.ts`) são por `leadId`.
4. Segredos do painel ficam em `dashboard_settings` com `secret-vault` (Anthropic: `segredo.anthropic_painel_api_key`).
5. `whatsapp_messages` não tem índice único por `external_id`; o webhook da Central evita duplicar por consulta prévia.

## Critérios de aceite (itens do dono)
- [x] AC1 — Conexão única em Integrações: cartão "WhatsApp da empresa (Dolores e Central)" (`WhatsappEmpresaCard.tsx`) com estado,
      número mascarado, QR, Conferir, Reativar recebimento e Desconectar — os MESMOS procedimentos `dolores.*` da instância
      `prospecta-dolores` (já conectada: nenhum QR novo). O cartão da Dolores ficou com número do dono, limites e IA. A Central do
      admin e do colaborador opera pela conexão da empresa (`server/whatsapp-conexao-empresa.ts`: a linha do 1º admin em
      `whatsapp_connections` continua sendo o `connectionId`, NÃO é gravada; provider/instância/status/número vêm, ao ler, de
      `dolores_whatsapp_config`). Conectar/desconectar/salvar API oficial/"ativar avisos" pela Central: recusados para admin e
      colaborador (o "ativar avisos" da Central substituiria o aviso da Dolores na instância). "Minha conexão": admin vê só
      "Conexões dos Corretores (n)"; colaborador vê a situação da conexão da empresa (sem QR) e as dos corretores; corretor igual.
      Avisos "conecte o WhatsApp" do admin apontam para Integrações. Bloco da Evolution em Integrações com o texto novo.
- [x] AC2 — Roteamento num ponto só (puro: `shared/dolores/roteamento.ts`; servidor: `server/dolores/roteamento.ts`; ligado em
      `server/dolores/whatsapp.ts`), pelo endereço do WhatsApp e pelos cadastros — nunca pelo texto nem pela IA. A instância tem UM
      aviso (o da Dolores, HMAC + instância, inalterados); o da Central ignora a instância da empresa (`instancia-da-empresa`) e
      continua servindo os corretores. Reentrega: `whatsapp_roteamento_vistos` (instância + id) — não duplica conversa, saudação nem
      resposta. `r` do aviso continua só "comando ou não"; o que o roteamento fez vai em `rota`.
- [x] AC3 — Saudação de campanha em Central › Templates (`CampanhasEAvisos.tsx`, rotas `dolores.atendimento.*` só admin por
      papel): nome, empreendimento opcional, texto fixo (sem `{{…}}`, pelos filtros de link e de dados), nasce inativa, UMA ativa
      (índice único parcial no banco); uma vez por número por campanha (`whatsapp_saudacoes`, número só como resumo HMAC), só a
      número desconhecido (nem cliente, nem usuário ativo, nem dono), só conversa direta e mensagem nova; teto diário (50).
- [x] AC4 — Dolores atende cliente cadastrado (`server/dolores/atendimento.ts` + leituras `leitura/cliente-atendido.ts`):
      identificação pelo número (estrita: `ehNumeroDoDono` contra `normalizarNumeroDono` de cada cadastro — leads, financiamentos,
      regularizações, avaliações, projetos; obra, incorporação e jurídico pelo lead); 2+ cadastros distintos → equipe; cadastro
      sem lead do CRM → equipe. 3 leituras fechadas sem argumento, presas ao lead; `semCamposDeValor` no servidor + filtro de saída
      da E4b (com as fontes); canal "cliente" sempre mascarado; UMA mensagem curta (≤ 500); fora do escopo/sem resposta → "A
      equipe responde por aqui."; nenhuma escrita, nada na fila. Interruptor próprio desligado; silêncio de 6 h quando a equipe
      responde (fromMe da equipe pelo celular ou resposta pela Central); tetos 10/cliente/dia e 100/dia; orçamento próprio 10%
      (`reservarAtendimento`, `parada` "cliente"); contagem prévia de tokens; UMA chamada de IA de terceiros por vez; falha fechada
      quando o consumo não grava; pausa geral (`podeFalarNoGrupo`) antes e no envio; função "dolores_cliente" no painel de
      modelos; chave só por `bloqueioAtual`.
- [x] AC5 — Ligação: evento `CALL` assinado (`EVENTOS_WEBHOOK_DOLORES`; exige "Reativar recebimento"), só a oferta conta, grupo e
      dono → nada; aviso por texto 1x/3 h por número. "Reativar recebimento" também liga `rejectCall` lendo e regravando as
      configurações da instância (só troca `rejectCall`/`msgCall`; formato desconhecido → não grava). Áudio de cliente ou
      desconhecido → transcrição; desligada/falha/longa/tetos → aviso de áudio (1x/3 h). Textos editáveis em Templates. Grupo:
      silêncio. Áudio do dono: NÃO transcrito nem comando — ele recebe "só entendo texto" (decisão registrada abaixo).
- [x] AC6 — Transcrição (`server/dolores/transcricao.ts`): Cloudflare Workers AI `@cf/openai/whisper-large-v3-turbo`; Account ID
      + API Token cadastrados em Integrações (token cifrado em `dashboard_settings`, tela vê só os 4 finais; nunca em log/erro/
      auditoria — `semSegredos`); download pela Evolution sem redirecionamento, teto de 4 MB; duração máxima 120 s pelo declarado
      (nem baixa acima); tetos 10/número/dia e 100/dia; prazo dentro dos 60 s; interruptor desligado; só liga com a credencial; o
      texto é de terceiro (vai à Central e ao atendimento do cliente; nunca comando).
- [x] AC7 — `server/whatsapp-canais.ts` (`canalDeDisparo`): ponto único do canal; hoje só Evolution; "API oficial" desligada
      (`API_OFICIAL_PARA_CAMPANHAS = false`); pelo número principal, 1 destinatário por envio, com o aviso na tela (Enviar
      mensagem e Templates). Coexistência não implementada.
- [x] AC8 — Migração `0135_whatsapp_conexao_unica.sql`: só CREATE … IF NOT EXISTS, um ADD COLUMN IF NOT EXISTS
      (`whatsapp_messages.automatica`, padrão false) e INSERT … ON CONFLICT DO NOTHING; aplicada 2x em todo banco de teste e uma 3ª
      no teste dela; sem gatilho; nada existente alterado.

## Decisões
- [AUTO-DECISION] Central do admin ligada à empresa → por CÓDIGO ao ler (a linha do 1º admin continua o `connectionId`, sem
  gravar). Todos os admins e o colaborador veem a mesma Central da empresa (antes cada admin tinha a própria linha).
- [AUTO-DECISION] Colaborador "igual a hoje": continua usando a conexão da empresa (como já usava a do admin), mas não a conecta
  nem desconecta mais (só o admin, em Integrações).
- [AUTO-DECISION] Áudio do dono não vira comando nesta etapa (segurança): resposta fixa pedindo texto, sem transcrever.
- [AUTO-DECISION] Disparo em massa pelo número principal = mais de 1 destinatário por envio (bloqueado até a coexistência).
- [AUTO-DECISION] A Central de Vendas automática NÃO é acionada pelo número da empresa (evita duas respostas automáticas); a mídia
  recebida pelo número da empresa não é baixada na hora (botão "baixar de novo" da Central).
- [AUTO-DECISION] Cadastro com telefone mas sem lead do CRM → equipe (as leituras fechadas são do lead). Usuário ATIVO do sistema
  com o telefone → só Central.
- ~~[AUTO-DECISION] A checagem "número já usado por outra conexão" do `confirmarConexao` passa a olhar só conexões de CORRETOR~~
  Substituída pelo QA-SEG achado 2 (c): conta também a linha de admin/colaborador ENQUANTO ela tiver instância (a antiga); nesse
  caso recusa ("Remova a conexão antiga…") SEM remover a instância da empresa. A linha do admin sem instância não conta.
- [AUTO-DECISION] Saudação, avisos e respostas a cliente também param com a pausa geral da Dolores.
- Ligação do dono: nada (não recebe aviso). Mensagem de terceiro continua auditada uma vez por remetente por hora
  (`dolores_remetentes_estranhos`), com o motivo atualizado.

## Correções do portão de QA de segurança (20/11/2026, FAIL)
1. **BLOQUEIA — Central escrevia ao dono pelo número da empresa.** `server/whatsapp-conexao-empresa.ts` (`numerosReservados`,
   `ehNumeroReservado`: estrita, sobre o número como sai pela Evolution) + `server/whatsapp-router.ts`: para admin/colaborador
   (conexão da empresa), `responder`, `enviar` (Enviar mensagem e Templates; telefone do lead = do dono), `excluirConversa(s)`, prévia
   da exclusão, `vincularLead`, `desvincularLead` e `criarLeadDaConversa` recusam o número do dono e o da própria empresa; `conversas`,
   `mensagensConversa`, `historico` e o acesso à mensagem/mídia (`acessoMensagemWhatsapp`) não mostram essas conversas (inclusive o
   histórico já gravado). Falha ao ler a configuração → fecha (não envia, não lista). Corretor (conexão própria): sem mudança. Os
   envios automáticos já recusavam (`enviarAoContato`).
2. **BLOQUEIA — instância antiga da Central do 1º admin.** (a) `processarEventoEvolution` ignora (`instancia-antiga-da-empresa`) o aviso
   de qualquer instância gravada em linha de admin/colaborador — nem mensagem, nem notificação, nem situação. (b) Integrações › cartão
   "WhatsApp da empresa": aviso "Ainda existe a conexão antiga da Central" + botão só-admin (papel) **"Remover a conexão antiga da
   Central"** (`dolores.conexaoAntiga`, `dolores.removerConexaoAntiga`): desliga e apaga a instância antiga na Evolution (sem seguir
   redirecionamento) e limpa na linha SÓ `instancia` (null) e `status` ("desconectado"); a linha fica (é o `connectionId` do
   histórico); a instância da empresa nunca entra; registrado em `dolores_acoes` ("remover_conexao_antiga_central").
   **Alteração de dado existente feita só quando o ADMIN clica (ação do dono, não migração).** Em produção a linha do admin (id 1)
   tem `instancia` preenchida e `status='desconectado'`: o botão aparece até ele clicar. (c) `numeroDeOutraConexao` conta a linha
   antiga enquanto tiver instância (ver Decisões).
3. Avisos de ligação/áudio: interruptor próprio `avisos_ligados` (LIGADO por padrão, pedido do dono; sem a linha/migração: desligado)
   e teto global diário `aviso_teto_global_dia` (50; ligação e áudio somam), conferidos em `enviarAviso` antes do envio; recusa
   auditada. Tela: Integrações › "Atendimento pelo WhatsApp da empresa". Colunas novas DENTRO do CREATE TABLE da 0135 (ainda não aplicada).
4. `identificarRemetente`: cada cadastro filtrado no SQL pelos 8 finais (`right(regexp_replace(coalesce(col,''),'\D','','g'),8)`), sem
   limite; conferência estrita em memória; os leads candidatos são reaproveitados em `gravarItemNaCentral` (que, sem eles, também
   filtra no banco — vale para o aviso dos corretores). Índices de expressão nas seis tabelas, na 0135 (`CREATE INDEX IF NOT EXISTS`).
5. Envios manuais pela conexão da empresa (`responder` e `enviar`): teto de 10 por minuto e 200 por dia, somando todos os usuários,
   no servidor (`reservarEnvioManualDaEmpresa`, `server/whatsapp-canais.ts`); falha ao contar → recusa; mensagem clara na tela.
6. `enviar` (Enviar mensagem e Templates) pela empresa também chama `silenciarConversa` (só quando o envio foi aceito).
7. ROADMAP: a parte da Dolores fica "(não portar — exceção)"; a parte da Central WhatsApp virou pendência "[ ] portar ao Santa Fé
   quando o dono retomar a paridade".
- Testes: `server/dolores/e9-qa-seg.test.ts` (provas do QA, invertidas), `server/dolores/e9-qa-seg-correcoes.test.ts` (novo — um bloco
  por achado), `e9-conexao-unica.test.ts` (achado 3); ajustados sem afrouxar: `router.test.ts` (a linha antiga do admin COM instância
  agora bloqueia, sem derrubar a da empresa), `whatsapp-noite.test.ts` (o aviso de mídia é de um corretor), `whatsapp-lote3.test.ts`
  (o banco de teste ganha a configuração da Dolores, que a Central agora confere).
- Residual: com a empresa DESCONECTADA em Integrações (`numero_dolores` vazio) só o número do dono continua filtrado.

## Pendências
- Conferir na documentação oficial da Cloudflare o corpo/resposta do Whisper (host bloqueado neste ambiente; testes simulados).
- O áudio enviado à Cloudflare entra no termo de consentimento (jurídico).
- Limpeza periódica de `whatsapp_roteamento_vistos` (cresce uma linha por mensagem roteada) — não implementada.
- Coexistência com a API oficial (fase separada).

## Testes
- `server/dolores/e9-conexao-unica.test.ts` (37): roteamento puro e no webhook (cada caso, fromMe, reentrega, grupo, webhook da
  Central), saudação (uma vez por campanha, filtros, não a cadastrado/usuário/dono, uma ativa no banco e pela tela, só admin, teto),
  cliente (desligado, escopo e sem valores, frase fixa, homônimo, tetos, pausa, IA desligada, nunca comando, mascarado), ligação e
  áudio (1x/3h, transcrição desligada/ligada/longa/falha, token fora do log, dono, grupo), Cloudflare (só admin, só final, cifrado,
  fora da auditoria, só liga com credencial), Central do admin (conectada sem QR, recusas, conversa do dono nunca, corretor intacto,
  disparo em massa), privacidade (appRouter) e migração 3x.
- Ajustados à regra nova (sem afrouxar segurança): `router.test.ts` (evento CALL; a linha do admin não conta, a de corretor sim),
  `grupos-qa-r2.test.ts` (lista de arquivos que usam a Evolution com `semRedirecionamento`), `integracoes-modelo-por-funcao.test.ts`
  (função nova), `whatsapp-noite.test.ts` (admin pela conexão da empresa).

## Verificação (20/11/2026)
- `npx tsc --noEmit`: sem erros. `npx vite build`: ok.
- `npx vitest run server/dolores server/whatsapp server/integracoes-anthropic.test.ts server/integracoes-modelo-por-funcao.test.ts server/auth-session.test.ts server/imports-esm.test.ts server/api-rotas-producao.test.ts server/central-vendas --maxWorkers=2 --minWorkers=1`:
  **57 arquivos, 887 testes, 0 falhas** (depois do merge da `main`).

## File List
- `drizzle/0135_whatsapp_conexao_unica.sql`, `drizzle/schema-whatsapp-atendimento.ts` (novos); `drizzle/schema.ts`, `drizzle.config.ts`
- `shared/dolores/roteamento.ts` (novo); `shared/dolores/custo.ts`, `shared/funcoes-anthropic.ts`, `shared/whatsapp/central.ts`
- `server/whatsapp-conexao-empresa.ts`, `server/whatsapp-canais.ts` (novos); `server/whatsapp-router.ts`, `server/whatsapp-evolution-webhook.ts`
- `server/dolores/roteamento.ts`, `server/dolores/atendimento.ts`, `server/dolores/atendimento-router.ts`, `server/dolores/transcricao.ts`,
  `server/dolores/leitura/cliente-atendido.ts` (novos); `server/dolores/whatsapp.ts`, `server/dolores/marcacao.ts` (laço com `uso`
  parametrizável), `server/dolores/consumo.ts`, `server/dolores/custo.ts`, `server/dolores/dados-pessoais.ts`, `server/dolores/router.ts`,
  `server/_core/evolution.ts`
- `client/src/components/admin/WhatsappEmpresaCard.tsx`, `client/src/components/admin/AtendimentoEmpresaCard.tsx`,
  `client/src/components/whatsapp/CampanhasEAvisos.tsx` (novos); `DoloresCard.tsx`, `ConexaoWhatsApp.tsx`, `ConversasWhatsApp.tsx`,
  `AdminIntegracoes.tsx`, `AdminWhatsApp.tsx`
- Testes: `server/dolores/e9-conexao-unica.test.ts` (novo), `server/dolores/testes-banco.ts`, `router.test.ts`, `grupos-qa-r2.test.ts`,
  `server/integracoes-modelo-por-funcao.test.ts`, `server/whatsapp-noite.test.ts`
- Docs: `docs/dolores/como-ligar.md` (Etapa 9), `docs/stories/epics/ROADMAP.md`, `docs/stories/epics/epic-025-dolores/EPIC.md`
- Correções do QA-SEG: `server/whatsapp-conexao-empresa.ts`, `server/whatsapp-router.ts`, `server/whatsapp-evolution-webhook.ts`,
  `server/whatsapp-canais.ts`, `server/dolores/router.ts`, `server/dolores/roteamento.ts`, `server/dolores/whatsapp.ts`,
  `server/dolores/atendimento-router.ts`, `drizzle/0135_whatsapp_conexao_unica.sql`, `drizzle/schema-whatsapp-atendimento.ts`,
  `client/src/components/admin/WhatsappEmpresaCard.tsx`, `client/src/components/admin/AtendimentoEmpresaCard.tsx`;
  testes `server/dolores/e9-qa-seg-correcoes.test.ts` (novo), `e9-qa-seg.test.ts`, `e9-conexao-unica.test.ts`, `router.test.ts`,
  `server/whatsapp-noite.test.ts`, `server/whatsapp-lote3.test.ts`

## Change Log
- 20/11/2026 — @dev (Dex): Ready → InProgress; levantamento e migração 0135.
- 20/11/2026 — @dev (Dex): InProgress → InReview; AC1–AC8 implementados e testados; merge da `main` (#259, #260) sem mudança de conteúdo.
- 20/11/2026 — @qa (Quinn): portão de segurança FAIL (achados 1–7) → InProgress.
- 20/11/2026 — @dev (Dex): InProgress → InReview; achados 1–7 corrigidos, um teste de regressão por achado; provas do QA invertidas.
