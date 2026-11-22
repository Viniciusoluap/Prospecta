# C7 — Integração com a YCloud (API oficial do WhatsApp, em coexistência)

Status: InReview (ramo `epic027-y`; aguarda portão de QA de segurança — regra do dono: nada da integração vai para a `main` reprovado).
Epic: EPIC-027 — Correções de 20/11/2026 (noite) (o `EPIC.md` vive em outro ramo).
Paridade: a Central WhatsApp existe nos dois sistemas → pendência de porte registrada no `ROADMAP.md` (EPIC-027 C7).
Migração: `drizzle/0141_ycloud.sql` (aditiva e idempotente; NÃO aplicada — aplicar no Neon na publicação).

## C7.1 — quem pode disparar (decisão do dono em 21/11/2026)

Pergunta: "só você (admin) dispara campanha?". Resposta do dono: **"eu ou colaborador se estiver marcado WhatsApp pra ele"**.
Isto substitui o "só admin por papel" do AC3/AC6 para a OPERAÇÃO; a CONFIGURAÇÃO continua só do admin. Dois níveis, conferidos no
servidor por papel + módulo (`shared/whatsapp/ycloud.ts`: `podeOperarCampanhaOficial`, `podeAdministrarIntegracaoOficial`):

- **Operar campanha** — admin ativo OU colaborador ativo com o módulo WhatsApp. Rotas: `prontidao` (nova), `modelos`, `previa`,
  `criarCampanha`, `enviarLote`, `mudarCampanha` (pausar/continuar/cancelar), `campanhas`, `detalheCampanha`, `registrarOptout`.
- **Administrar a integração** — só admin ativo por papel. Rotas: `status`, `testar`, `salvarChave`, `removerChave`, `ativarAvisos`,
  `salvarSegredoAvisos`, `salvarConfig` (interruptor geral, tetos, janela, preço, moeda), `auditoria` (nova).
- Corretor (que passa em `whatsapp.*`), cliente, empreiteiro, colaborador sem o módulo, contas inativas e anônimo: nada.
  `whatsappOficial` continua FORA do mapa de módulos de `adminProcedure` (`server/_core/trpc.ts` não mudou).

Critérios:
- [x] C7.1-AC1: as rotas de operação passam para admin e colaborador com WhatsApp; as de administração seguem só do admin
      (matriz admin / colaborador com WhatsApp / com WhatsApp + configurações / sem WhatsApp / corretor / cliente / empreiteiro /
      colaborador inativo / admin inativo / anônimo em TODAS as rotas, pelo `appRouter`; teste que falha se surgir rota fora dos dois níveis).
- [x] C7.1-AC2: o colaborador nunca recebe a chave, o segredo nem "terminando em…" (o `status` completo é só do admin); ele vê
      `prontidao`: pronta ou não, o motivo em linguagem simples (não configurada / desligados pelo administrador / número não
      confere / limite do dia usado), o que ainda cabe hoje e o teto por campanha — sem número, tier nem segredo.
- [x] C7.1-AC3: interruptor desligado ou número divergente: a mesma recusa do admin ("Os disparos pela API oficial estão
      DESLIGADOS pelo administrador…" / "NÃO é o número da empresa"). Todos os limites continuam no servidor e valem para ele:
      limite da conta e teto do dia, teto por campanha, um lote por vez, idempotência pela chave de confirmação, janela de
      repetição, opt-out, forma canônica do telefone, filtro do nome; ele não muda nenhum teto.
- [x] C7.1-AC4: auditoria registra QUEM fez (id em `usuario_id`; papel no começo de `detalhe`, "papel=colaborador" — sem coluna
      nova, sem migração); o painel mostra "disparada por Fulano (colaborador)"; o admin vê a auditoria completa no cartão de
      Integrações ("Ver auditoria"). Pausa feita pelo colaborador fica "Pausada pela equipe (colaborador).". Nenhum aviso ao dono
      foi criado (não há canal definido para isso).
- [x] C7.1-AC5: tela: a opção "Campanha pela API oficial" aparece na Central (Enviar mensagem) para quem pode operar, com a
      linha de prontidão; o cartão de Integrações continua só do admin.

### Correções do portão de QA da C7.1 (21/11/2026)
- [x] F1: a quem não é admin, nenhuma rota devolve `limiteDiario` (tier), `tetoDia`, `usados24h`, `janelaRepeticaoDias`,
      `precoUnitario` nem a base do preço. Prévia: `vagas = {restante, tetoCampanha}`, `custo = {estimado, moeda}`; `prontidao` sem a
      janela; motivos de pausa/falha com "Limite de N destinatários" e "nos últimos N dia(s)" saem sem os valores
      (`motivoParaEquipe`). Admin vê tudo. A tela (`CampanhaApiOficial.tsx`) mostra "ainda cabem hoje" ao colaborador.
- [x] F2: número divergente (ou não cadastrado / conta sem número): recusa, resultado do lote, `motivoPausa` do painel e motivos de
      falha ao não-admin = "A integração precisa de ajuste do administrador." — sem números, nem mascarados. Admin vê o detalhe.
      (Substitui a parte "a mesma recusa do admin… NÃO é o número da empresa" do C7.1-AC3 para o colaborador.)
- [x] F3: quem pausou é derivado do `motivoPausa` (gravado só pelo servidor) — SEM coluna nova, SEM migração
      (`podeContinuarPausa`). Colaborador continua só "Pausada pela equipe (colaborador)." e a pausa do limite do dia (o limite é
      conferido de novo em cada lote; continuar não o contorna). Pausa do admin e qualquer trava do sistema (disparos desligados,
      número, qualidade, conta, cinco falhas, conferência que falhou) → só admin. Admin pausando uma campanha já pausada pelo
      colaborador passa a ser pausa do admin; a do colaborador nunca troca a do admin. O "continuar" confere o mesmo motivo lido.
      [AUTO-DECISION] pausa do limite do dia → colaborador pode continuar (razão: não é contorno — o lote re-confere o limite e volta
      a pausar; senão a campanha travaria todo dia até o admin).
- [x] Texto fixo das variáveis digitado por não-admin: recusa link (`http`, `https`, `www.`, domínio com terminação comum) e
      telefone (8+ dígitos seguidos) — `problemaDoTextoFixoDaEquipe` em `shared/whatsapp/ycloud.ts`. Admin pode.
- [x] Webhook: o status do modelo vindo da YCloud é gravado em `detalhe` como `status_ycloud=<só letras/dígitos/_>`; e
      `detalheComPapel` escapa ("texto: …") qualquer detalhe sem papel do contexto que comece com "papel=". `separarPapel` nunca o
      lê como papel.
- [x] Eco: `ehEcoDeCampanhaOficial` ligado em `tratarPropria` (`server/dolores/roteamento.ts`) → rota `propria-campanha-oficial`:
      não cala a Dolores nem grava atendimento humano (a campanha já registrou a mensagem como automática). Na dúvida (texto diferente,
      fora de 10 min, outro número, tabela ausente) segue "propria-equipe".
- [x] Achado no caminho (teste do F3): o lote reservava MAIS envios que o limite do dia — `UPDATE … WHERE id IN (SELECT … LIMIT n FOR
      UPDATE SKIP LOCKED)` reavaliava o subselect. Agora os ids são escolhidos numa consulta separada e o UPDATE confere "na_fila"
      (um lote por vez continua garantido por `travarLote`). Teste: com teto 1, o lote envia 1.

## C7.2 — modelos criados pelo próprio sistema (pedido do dono em 21/11/2026)

Pedido: o dono cadastrou a chave e parou na tela "Add template" da YCloud — "se nós já temos isso tudo no sistema… eu quero que
você faça". Correção do dono no meio (viu a aba Templates): "Não precisa criar botão novo […] coloque a função dentro de um deles".
Documentação conferida em 21/11/2026: https://docs.ycloud.com/api-reference/whatsapp-templates/create-a-template.md
(`POST /v2/whatsapp/templates`; obrigatórios `wabaId`, `name`, `language`, `category`, `components`; BODY até 1024 caracteres com
`example.body_text` = [[um valor por variável]]; FOOTER até 60). A página de regras da Meta (developers.facebook.com) não abriu
daqui: as regras de variável (sequência, não começar/terminar com variável, não colar duas) seguem o guia de modelos da Meta; "no
máximo uma linha em branco seguida" e "cada variável uma vez" são precaução nossa.

- [x] C7.2-AC1: modelo padrão `novidades_prospecta` (MARKETING, pt_BR, corpo do pedido, exemplo "Maria") enviado pelo SERVIDOR uma
      única vez quando há chave, número conferido e WABA conhecida e a conta não tem modelo de marketing em pt_BR (qualquer situação
      menos apagado, ou um modelo com esse nome). `server/ycloud/modelos.ts` (`garantirModeloPadrao`). Dispara em: cron
      `/api/cron/dolores/*` (de hora em hora, 07h–14h de Brasília, só com o CRON_SECRET), cron `/api/cron/lead-card-due` (08h) e a
      listagem `whatsappOficial.modelos` (botão "Carregar/Atualizar modelos" e a campanha ao abrir). Estado em `dashboard_settings`
      (`ycloud.modelo_padrao`, JSON curto) reservado por compare-and-set (duas chamadas → um POST); no máximo 1 tentativa por dia
      (dia de Brasília) e 3 no total; recusa grava o motivo (código da YCloud + explicação da Meta limpa, sem chave nem números
      longos); tempo esgotado → no dia seguinte confere a lista antes. Auditoria `modelo_padrao_*` com autor "sistema" (`usuario_id`
      nulo, "papel=sistema"). O cartão de Integrações mostra o que foi feito. Sem migração.
- [x] C7.2-AC2: sem botão novo — no formulário que já abre em "+ Novo template" e "Editar" (Central › Templates), SÓ para admin, a
      opção "Usar também em campanha pela API oficial (enviar para aprovação da Meta)" com a categoria (Marketing/Utilidade). Ao
      salvar: o servidor confere antes (nada é salvo se o texto não puder virar modelo, com a mensagem do que ajustar), salva,
      converte {{nome}}, {{corretor}}… em {{1}}, {{2}}… na ordem, gera os exemplos (nome→Maria, corretor→João, dia→25/11,
      horario→14h, servicos/servico→financiamento, outros→exemplo) e envia. Nome na YCloud a partir do nome do template
      ("Follow-up 48h" → `follow_up_48h`). Vínculo (nome, categoria, posição→variável, resumo do texto, versão) em
      `dashboard_settings` (`ycloud.template.<id>`, sem migração). Mesmo texto → não reenvia; texto mudou → nova versão `_v2`.
      Clique duplo → um POST (compare-and-set). Colaborador e corretor: FORBIDDEN (o `salvarTemplate` já era só do admin).
- [x] C7.2-AC3: o cartão do template mostra a situação (em análise / aprovado / recusado + motivo) e avisa quando o texto mudou
      depois do envio; o editor avisa que mudar o texto de um já enviado exige reenviar (`whatsappOficial.situacaoDosTemplates`,
      só admin). O webhook `whatsapp.template.reviewed` já era assinado (fica na auditoria); a situação é lida da YCloud ao abrir a
      aba e no "Atualizar modelos".
- [x] C7.2-AC4: na campanha, modelo que veio de template da Central já preenche as variáveis: {{nome}} → primeiro nome do contato;
      o resto fica como "Texto fixo" para preencher.
- [x] C7.2-AC5: textos atualizados — cartão "Modelos da API oficial (YCloud)" ("enviados para aprovação da Meta daqui mesmo…") e
      o aviso da Central (pelo WhatsApp Web, um contato por vez; disparo em massa pela "Campanha pela API oficial").
- [x] C7.2-AC6: a chave continua lida só por `chaveYcloud()` e vai só no cabeçalho; nunca em estado, auditoria, erro, log ou tela
      (testes procuram a chave no banco, na auditoria, nas respostas e no `console.error`).

## C7.3 — achados BAIXOS do portão de QA da C7.1, rodada 2 (21/11/2026)

Sem migração (tudo derivado do que já existe: `erro_codigo` e o JSON `parametros` de `ycloud_envios`).

- [x] C7.3-1 — filtro do texto fixo do colaborador (`problemaDoTextoFixoDaEquipe`, `textoFixoNormalizado` em `shared/whatsapp/ycloud.ts`):
      normaliza (NFKC/NFKD, sem acento nem marcas, sem caracteres invisíveis, minúsculas, dígitos de outros alfabetos e dígitos largos
      viram ASCII, pontos "parecidos" — U+2024, U+00B7, U+FF0E… — colados entre letras viram ".", traços Unicode viram "-", espaço
      antes do ponto some: "exemplo . com" → "exemplo.com"). Recusa: `http`, `www.`, link por extenso ("ponto com", "ponto br",
      "arroba", "dot com"), qualquer `palavra.palavra` com 2+ letras depois do ponto (.dev, .ai, .app, .io…), `@algo`, e 8+ dígitos
      somando os separados por espaço, traço, barra, ponto, parênteses, "+" ou "_". Data com dia/mês válidos e CEP, sozinhos (sem
      outro grupo de dígitos colado), não contam. Frases normais passam (testadas: "às 14h30", "R$ 1.500,00", "R$ 1.500.000,00",
      "Rua 7, nº 120", "25/11/2026", "CEP 12345-678", "Chegue cedo. Traga documentos", "Piscina • Academia", "Venha... conheça!").
      Resíduo conhecido: número por extenso ("onze nove…"). O admin continua sem esse filtro. Limite aceito: "p.ex" é recusado.
- [x] C7.3-2 — eco de campanha (`ehEcoDeCampanhaOficial` → `textoEhDaCampanha`, `server/ycloud/campanhas.ts`): acabou o "contém".
      É eco só se o texto for a mensagem daquele envio (corpo já preenchido para o contato, `ycloud_envios.texto`), com o cabeçalho
      (`parametros.textoCompleto`) e o rodapé do modelo (`parametros.rodape`, guardado a partir da C7.3; `analisarModelo` passa a
      devolver `rodape`) iguais, se aparecerem. Parte que o envio não guardou (envios anteriores à C7.3: o rodapé) tem tolerância de
      até 60 caracteres (o tamanho de um cabeçalho/rodapé da Meta). Corpo + acréscimo da equipe → mensagem da EQUIPE (cala a Dolores e
      entra na Central). Botões do modelo no eco, se a Evolution os mandar, também caem em "equipe" (o comportamento seguro antigo).
      Em `server/dolores/roteamento.ts` só mudou o comentário do trecho do eco.
- [x] C7.3-3 — pausa do admin (`mudarCampanha`): o colaborador NÃO cancela campanha pausada pelo admin ou por trava do sistema (o
      mesmo critério de `podeContinuarPausa`); só o admin. O UPDATE do cancelamento confere a mesma situação e o mesmo motivo lidos
      (corrida com a pausa do admin → "A campanha mudou…"). Quando o admin cancela uma campanha nessa pausa, os envios da fila ficam com
      `erro_codigo = CANCELADA_PAUSA_ADMIN` e, para quem não é admin, contam como "já recebeu" na janela de repetição do mesmo modelo
      (na prévia/criação e de novo no lote: campanha criada por não-admin ou lote rodado por não-admin). O admin pode recriar.
- [x] C7.3-4 — `server/ycloud/ycloud-qa-c71-r2.test.ts` trazido do worktree do QA; as asserções que fixavam os contornos residuais
      (texto fixo; "erro 5599…" → aviso da integração) passaram a fixar o corrigido.
- [x] C7.3-5 — texto para o colaborador (`motivoParaEquipe`): problema do número da integração continua "A integração precisa de
      ajuste do administrador."; qualquer outro motivo com 6+ dígitos ou "••••" vira "Não foi possível concluir. Avise o
      administrador." (`AVISO_NAO_CONCLUIDO`). Admin vê o texto original.

## Pedido do dono (20/11/2026)
O WhatsApp da empresa é ligado pela Evolution (WhatsApp Web): por ela entra TUDO (conversas, grupos, Dolores) e saem as mensagens
comuns. O dono criou conta gratuita na YCloud (provedor oficial da Meta) e vinculou o MESMO número em coexistência (WhatsApp Business
App + API oficial): conta "VFX Capital", Conectado, limite inicial de 250 clientes/dia, empresa não verificada. Ele quer fazer
**disparos de campanha pela API oficial** sem arriscar o número.

## O que foi confirmado na documentação oficial (20/11/2026)
| Item | Confirmado | Fonte |
|---|---|---|
| Base `https://api.ycloud.com/v2`, cabeçalho `X-API-Key` (sem "Bearer") | sim | https://docs.ycloud.com/en/api-reference/guides/api-fundamentals/authentication.md |
| Onde está a chave: Console › **Developers › API key**, ícone do olho, exige 2FA | sim | https://docs.ycloud.com/en/documentation/developer/manage-api-keys.md |
| Envelope de erro e catálogo de `error.code` (UNAUTHORIZED, BALANCE_INSUFFICIENT, RECIPIENT_UNSUBSCRIBED, WHATSAPP_TEMPLATE_UNAVAILABLE…) | sim | https://docs.ycloud.com/en/api-reference/guides/api-fundamentals/handle-errors.md |
| `GET /whatsapp/phoneNumbers` (page 1-based, limit 1–100), campos `phoneNumber` (E.164 com "+"), `verifiedName`, `status`, `qualityRating`, `messagingLimit`, `whatsappBusinessManagerMessagingLimit` | sim | https://docs.ycloud.com/api-reference/whatsapp-phone-numbers/list-phone-numbers.md |
| Limite é por PORTFÓLIO, destinatários únicos em 24 h MÓVEIS; tiers 250 → 2.000 → 10.000 → 100.000 → ilimitado | sim | https://docs.ycloud.com/en/documentation/whatsapp-business-platform/pricing-limits-and-quality/messaging-limits-and-throughput |
| Coexistência: vazão fixa de **5 mensagens/s** | sim | https://docs.ycloud.com/en/documentation/channels/whatsapp-accounts-management/coexistence/onboard-whatsapp-business-app |
| Grupos do app não passam pela API; mensagem do app não abre/estende a janela de 24 h da API | sim | https://docs.ycloud.com/en/documentation/whatsapp-business-platform/accounts-and-business-identity/whatsapp-business-app-coexistence.md |
| `GET /whatsapp/templates` com `filter.wabaId`/`filter.status`; só `APPROVED` envia | sim | https://docs.ycloud.com/api-reference/whatsapp-templates/list-templates.md , https://docs.ycloud.com/api-reference/whatsapp-messages/enqueue-a-message.md |
| `POST /whatsapp/messages` (fila), `externalId`, `filterUnsubscribed`/`filterBlocked` (padrão false); 400/404/422 não se repete; 429 respeita `Retry-After`; tempo esgotado = resultado ambíguo; **`externalId` NÃO é chave de idempotência da YCloud** | sim | https://docs.ycloud.com/en/api-reference/guides/whatsapp-platform/whatsapp-messages-api-best-practices.md , https://docs.ycloud.com/en/api-reference/guides/api-fundamentals/rate-limits.md |
| Fila: 200 req/s por remetente; gestão (números, modelos, webhooks): 200 req/s e **10.000/hora** por conta | sim | rate-limits (acima) |
| Webhook: `YCloud-Signature: t=<unix s>,s=<hex>`; assinado = `t` + "." + corpo BRUTO (nada depois do corpo); HMAC-SHA256 com o `secret` do endpoint; comparação em tempo constante; janela de 5 min é política da aplicação; responder 2xx em < 6 s; dedupe por `id`; reenvios em 10 s, 30 s, 5 min, 30 min, 1 h, 2 h, 2 h | sim | https://docs.ycloud.com/en/api-reference/guides/api-fundamentals/implement-a-webhook-receiver.md , https://docs.ycloud.com/en/documentation/developer/webhooks |
| `POST /webhookEndpoints` (`url`, `enabledEvents`, `status`) devolve o `secret` | sim | https://docs.ycloud.com/en/api-reference/guides/api-fundamentals/configure-webhooks.md , https://docs.ycloud.com/api-reference/webhook-endpoints/create-a-webhook-endpoint.md |
| `whatsapp.message.updated`: `id`, `externalId`, `status` (accepted/sent/delivered/read/failed), `errorCode`, `errorMessage`, `sendTime`/`deliverTime`/`readTime`, `totalPrice` (estimado em accepted/sent, final em delivered/read; failed não cobra), `currency` | sim | https://docs.ycloud.com/en/api-reference/webhook-reference/whatsapp-message-updated.md , https://docs.ycloud.com/en/api-reference/guides/whatsapp-platform/whatsapp-message-pricing-integration-guide.md |
| Situação convergente: eventos repetidos, atrasados e fora de ordem; "read" prova entrega | sim | best-practices (acima) |
| Opt-out: `POST /unsubscribers` (`type: PHONE_NUMBER`, `customer`, `channel: whatsapp`); evento `whatsapp.user.preferences` (`value: stop`) | sim | https://docs.ycloud.com/en/api-reference/guides/customer-data-and-operations/manage-unsubscribers.md , https://docs.ycloud.com/en/api-reference/webhook-reference/whatsapp-user-preferences.md |
| IPs de origem dos avisos: 8.219.65.77 e 47.236.160.49 (opcional; a assinatura é o que vale) | sim | developer/webhooks (acima) |

### Ficou SEM confirmar (pendências)
- **Preço por mensagem de marketing no Brasil**: não há endpoint de cotação na API lida. A prévia usa o preço digitado em Integrações
  e, depois dos primeiros envios, a média REAL (`totalPrice` final) registrada. Conferir na tabela da Meta/painel da YCloud.
- **Formato da chave**: a documentação não diz prefixo/tamanho → só validamos "sem espaços, 16–256 caracteres" e testamos na YCloud antes de salvar.
- **Eco em coexistência pela Evolution**: a doc confirma que a mensagem da API aparece no app; se/como ela chega pela Evolution
  (Baileys) e com que texto não está documentado. Ver "Eco em coexistência" abaixo.
- **Nono dígito**: a API pede E.164; não confirmamos se a Meta entrega a número brasileiro cadastrado sem o 9. O sistema NUNCA inventa o 9.
- **Parâmetros nomeados** (`{{nome}}`) e cabeçalho de mídia: não implementados nesta versão (o modelo aparece como "não dá para disparar por aqui").
- **Criar modelo pela tela**: não feito (o pedido dizia opcional). Os modelos são criados no painel da YCloud (passo a passo abaixo).

## Critérios de aceite
- [x] AC1: cartão "API oficial do WhatsApp (YCloud)" em Configurações › Integrações: chave digitada pelo dono, cifrada no mesmo cofre
      das outras chaves (`dashboard_settings`, AES-256-GCM), nunca exibida de volta ("terminando em …"); **Testar** chama
      `GET /whatsapp/phoneNumbers` e mostra número, nome verificado, situação, qualidade e limite; texto simples explicando que
      disparos saem pela API e conversas/grupos/Dolores continuam pelo WhatsApp Web. Número da API ≠ número da empresa → aviso em
      destaque e disparos bloqueados (ligar recusado; lote em andamento pausa).
- [x] AC2: modelos da conta com situação (aprovado, em análise, recusado + motivo…), categoria e idioma; atualização sob demanda.
      Criação pela tela: pendência (passo a passo do painel da YCloud abaixo).
- [x] AC3: Central › Enviar mensagem › "Campanha pela API oficial" (só admin): modelo APROVADO, variáveis (primeiro nome, nome
      completo ou texto fixo), destinatários da lista do CRM, prévia com contagens e CUSTO ESTIMADO, confirmação explícita com a
      contagem (o servidor recusa se a contagem mudou). Envio pela fila (`POST /whatsapp/messages`) em lotes que cabem em 60 s,
      retomável, `externalId` próprio (`prospecta-c<campanha>-<n>`), UM envio por (campanha, telefone), limite diário lido da conta
      (o menor entre o tier do portfólio e o teto do painel, em 24 h móveis), teto por campanha, 5 mensagens/s, UM lote por vez no
      número inteiro, opt-out permanente. A trava de disparo em massa pela Evolution no número principal CONTINUA (`whatsapp-canais.ts` intocado).
- [x] AC4: `POST /api/ycloud/webhook`: corpo bruto (rota antes do `express.json()` na Vercel e no servidor local), assinatura
      conferida (HMAC-SHA256, tempo constante, janela de 5 min), 401 sem processar e sem detalhe, dedupe por `id`, 2xx rápido,
      situação convergente de cada envio (aceita, enviada, entregue, lida, falhou com motivo). Assinados só
      `whatsapp.message.updated` e `whatsapp.template.reviewed` (nada de mensagem recebida). Botão "Ativar avisos de entrega"
      cria o endpoint pela API e guarda o segredo cifrado; campo para colar o segredo se o endpoint for criado no painel.
- [x] AC5: painel da campanha: totais (na fila, aceitas, enviadas, entregues, lidas, falhas, incertas), custo estimado × registrado
      (e o provisório), falhas agrupadas por motivo e lista com telefone mascarado; "Não enviar mais" registra opt-out. A mensagem
      enviada entra na conversa da Central como AUTOMÁTICA (`whatsapp_messages.automatica`), sem chamar o silêncio da Dolores.
- [x] AC6: segurança: chave e segredo nunca em log, erro, auditoria ou resposta (mensagens de erro montadas pelo código, nunca o
      texto da YCloud); URL base fixa (nenhuma URL da tela é chamada); destinatários só do CRM (telefone lido do banco); dono e
      empresa nunca recebem; entrada estrita (zod `.strict()`); limites no servidor; auditoria (`ycloud_auditoria`) de quem, quando,
      modelo e quantidade, sem telefones; interruptor geral DESLIGADO por padrão (e só liga com chave, avisos ativos e número conferido);
      só ADMIN POR PAPEL (testado pelo `appRouter`: colaborador com módulo WhatsApp, corretor e cliente recebem FORBIDDEN).
- [x] AC7: migração `0141_ycloud.sql` aditiva e idempotente (testada aplicando duas vezes) + `drizzle/schema-ycloud.ts`.
- [x] AC8: testes vitest com a API simulada (24): permissão por papel; assinatura válida/inválida/expirada/sem cabeçalho/corpo
      alterado/reenviada; idempotência e retomada (orçamento de tempo, reserva órfã → incerto, incerto nunca reenviado, aviso com
      `externalId` resolve); limite diário (teto e tier, janela móvel) e confirmação da contagem; opt-out na prévia e na hora do envio;
      número diferente bloqueia; chave nunca aparece em retorno/log/auditoria; atualização convergente e preço final; 429 e saldo
      insuficiente; um lote por vez.

## Como funciona o envio (resumo técnico)
1. **Prévia** (`whatsappOficial.previa`): confere AGORA na YCloud (número = empresa, Conectado, qualidade não vermelha), lê os modelos,
   resolve os leads do CRM, tira inválidos/duplicados/dono/empresa/opt-out, calcula vagas (24 h móveis) e custo.
2. **Criar** (`criarCampanha` com `confirmarQuantidade`): refaz tudo; contagem diferente → recusa. Grava a campanha e um envio por destinatário (`na_fila`).
3. **Lote** (`enviarLote`): trava global (70 s), expira reservas órfãs (> 3 min → `incerto`), reconfere a conta, reserva até 120
   envios (`FOR UPDATE SKIP LOCKED`), confere opt-out de novo e envia a ≤ 5/s com orçamento de 40 s. 429 → volta à fila e pede
   espera; erro de conta (chave, saldo, modelo, número) → pausa a campanha; 5xx → volta à fila (3 tentativas); sem resposta → `incerto`.
4. A tela repete o lote enquanto houver fila. Fechou a tela ou a função caiu → "Continuar envio" retoma; ninguém recebe duas vezes.

## Eco em coexistência (comportamento atual e instrução para a frente da Dolores)
Em coexistência, a mensagem da API aparece no app e PODE chegar pela Evolution como "enviada pela empresa" (fromMe). Hoje o roteamento
(`server/dolores/roteamento.ts`, `tratarPropria`) só reconhece como automática a linha `automatica` sem `external_id`, do mesmo número e
MESMO texto, de até 5 min; fora disso trata como resposta da EQUIPE (grava outra linha e cala a Dolores naquela conversa — erro para o
lado humano; nada é enviado a mais). Atualização 21/11 (portão da C7.1): LIGADO — ver "Correções do portão de QA da C7.1".

Regra segura pronta e testada: `ehEcoDeCampanhaOficial(numero, texto)` em `server/ycloud/campanhas.ts` — só é eco se houve envio da
campanha ao MESMO número (forma canônica, regra estrita do número do dono) aceito há ≤ 10 min E o texto do eco CONTÉM o corpo preenchido
(`ycloud_envios.texto`). Na dúvida devolve false (= mensagem da equipe).

**Instrução de UMA linha para a frente da Dolores** — em `tratarPropria`, logo depois do bloco `if (p.texto) { … }` e antes de
`await gravarItemNaCentral(conn, item, …)`:
```ts
if (await (await import("../ycloud/campanhas.js")).ehEcoDeCampanhaOficial(p.numero, p.texto)) return "propria-automatica";
```
Conferir com uma campanha real de 1 destinatário antes de dar como resolvido.

## Correções do portão de QA (20–21/11)
1. Idempotência: a prévia devolve `chaveConfirmacao`; a confirmação a exige; índice único em `ycloud_campanhas.chave_confirmacao` →
   duas confirmações = UMA campanha. Quem recebeu (ou está para receber) o MESMO modelo em outra campanha nos últimos N dias
   (`ycloud_config.janela_repeticao_dias`, padrão 7, 0 = desliga) é pulado na prévia (contagem "já receberam") e de novo no lote (`REPETIDO`).
2. Opt-out da Central de Vendas (`central_vendas_leads.opt_out`, única outra marca de descadastro encontrada no sistema) conta como
   opt-out na prévia e no lote; falha ao conferir → nada sai.
3. Forma canônica do telefone (`chaveCanonicaTelefone`, mesma regra estrita do número do dono) em `ycloud_envios.chave_telefone` e
   `ycloud_optout.chave_telefone` (únicos): deduplicação e opt-out ignoram a falta do nono dígito no celular.
4. Nome do cadastro só entra na variável limpo (`nomeSeguroParaVariavel`: letras, espaço, hífen, apóstrofo, até 50); com link, "@",
   dígitos ou símbolos → pulado com motivo ("nome que não pode ir na mensagem").
5. Eco: regra segura acima.
6. 5xx e erro sem resposta HTTP → "incerto" (nunca reenviado sozinho).
7. Resposta do POST que chega depois do aviso não rebaixa a situação nem troca preço final.
8. A trava do lote só é solta pela marca do próprio lote.
9. Avisos assinam também `whatsapp.user.preferences` ("stop" → opt-out local).
10. Reenvio atrasado: a doc diz que a janela de 5 min é política da aplicação e lista reenvios até ~6 h, sem dizer se o `t` é renovado.
    Assinatura válida com `t` de até 8 h atrás é aceita; `t` no futuro continua limitado a 5 min; id já visto nunca é reprocessado.
11. Índice em `ycloud_envios.mensagem_central_id`.

## Correções da rodada 2 do portão (21/11)
- R2-1: "não repetir o modelo" tem mínimo de 1 dia (banco: CHECK 1–90; servidor: recusa 0 com a frase da tela). A conferência roda
  dentro da trava de um lote por vez e de novo para cada envio logo antes do POST (cobre trava vencida); testado com dois lotes de
  campanhas diferentes em paralelo.
- R2-2: falha ao conferir "já recebeu este modelo" no lote → os envios reservados voltam para a fila e a campanha pausa (nunca "incerto").

## Pendência: retenção
Rotina de retenção de 12 meses para `ycloud_envios` (telefone, nome, texto), `ycloud_eventos` e `ycloud_auditoria` — NÃO implementada
(apagar dados exige ordem do dono). `ycloud_optout` não entra na retenção (o pedido de não receber vale para sempre).

## Passo a passo do dono em produção
(ver o relatório da entrega; reproduzido no HANDOFF da frente)

## Testes
- (a) automáticos: `npx vitest run server/ycloud/ycloud.test.ts --maxWorkers=2 --minWorkers=1` → 24/24; WhatsApp afetados
  (`api-rotas-producao`, `imports-esm`, `whatsapp-business`, `whatsapp-conversas`, `whatsapp-noite`, `whatsapp-lote3`,
  `admin-permissions`) → 54/54; `npx tsc --noEmit` → 0 erros; `vite build` ok.
- (a') portão da C7.1 (21/11): `npx vitest run server/ycloud server/admin-permissions.test.ts server/dolores/roteamento-eco-campanha.test.ts
  server/dolores/e9-conexao-unica.test.ts server/dolores/c3-qa-seguranca.test.ts --maxWorkers=2 --minWorkers=1` → 7 arquivos, 171/171;
  `npx tsc --noEmit` → 0 erros.
- (a'') C7.2 (21/11): `npx vitest run server/ycloud server/admin-permissions.test.ts --maxWorkers=2 --minWorkers=1` → 5 arquivos,
  111/111 (17 novos em `ycloud-c72.test.ts`); `e9-conexao-unica`, `e9-qa-seg`, `roteamento-eco-campanha`, `imports-esm`,
  `api-rotas-producao` → 50/50; `npx tsc --noEmit` → 0 erros; `npx vite build` ok.
- (a''') C7.3 (21/11): tsc 0 erros; pacote do portão (ycloud + eco + e9 + admin-permissions) → 10 arquivos, 192/192.
- (b) manuais: nenhum (sem acesso à conta).
- (c) pendentes em produção: aplicar 0141; salvar a chave; Testar; Ativar avisos; campanha de 1 destinatário (o próprio celular de
  teste) para conferir entrega, preço registrado, aviso assinado e o eco na Central.

## File List
- `drizzle/0141_ycloud.sql` (novo), `drizzle/schema-ycloud.ts` (novo), `drizzle.config.ts`
- `shared/whatsapp/ycloud.ts` (novo)
- `server/_core/ycloud.ts` (novo), `server/ycloud/config.ts`, `server/ycloud/conta.ts`, `server/ycloud/campanhas.ts`,
  `server/ycloud/webhook.ts`, `server/ycloud/router.ts`, `server/ycloud/ycloud.test.ts` (novos)
- `server/routers.ts`, `api/index.ts`, `server/_core/index.ts` (rota e router)
- `client/src/components/admin/YcloudCard.tsx`, `client/src/components/whatsapp/CampanhaApiOficial.tsx` (novos)
- `client/src/pages/admin/AdminIntegracoes.tsx`, `client/src/pages/admin/AdminWhatsApp.tsx`
- `docs/stories/epics/ROADMAP.md` (pendência de porte), esta story
- C7.1: `shared/whatsapp/ycloud.ts`, `server/ycloud/{router,config,campanhas}.ts`, `server/ycloud/ycloud.test.ts`,
  `server/ycloud/ycloud-qa.test.ts`, `client/src/components/whatsapp/CampanhaApiOficial.tsx`, `client/src/components/admin/YcloudCard.tsx`,
  `client/src/pages/admin/AdminWhatsApp.tsx`
- C7.2: `server/ycloud/modelos.ts` (novo), `server/ycloud/ycloud-c72.test.ts` (novo), `server/_core/ycloud.ts`,
  `server/ycloud/{conta,router}.ts`, `server/ycloud/ycloud.test.ts`, `server/whatsapp-router.ts`, `server/whatsapp-canais.ts`,
  `shared/whatsapp/ycloud.ts`, `api/index.ts`, `client/src/pages/admin/AdminWhatsApp.tsx`,
  `client/src/components/whatsapp/CampanhaApiOficial.tsx`, `client/src/components/admin/YcloudCard.tsx`, `docs/stories/epics/ROADMAP.md`
- Portão da C7.1: `server/ycloud/{campanhas,router,config,webhook}.ts`, `shared/whatsapp/ycloud.ts`, `server/dolores/roteamento.ts`,
  `client/src/components/whatsapp/CampanhaApiOficial.tsx`, `server/ycloud/ycloud-qa-c71.test.ts`, `server/ycloud/ycloud.test.ts`,
  `server/dolores/roteamento-eco-campanha.test.ts` (novo)
- C7.3: `shared/whatsapp/ycloud.ts`, `server/ycloud/campanhas.ts`, `server/dolores/roteamento.ts` (só o comentário do eco),
  `server/ycloud/ycloud-c73.test.ts` (novo), `server/ycloud/ycloud-qa-c71-r2.test.ts` (trazido do QA), `server/ycloud/ycloud-qa-c71.test.ts`,
  `server/dolores/roteamento-eco-campanha.test.ts`

## Change Log
- 21/11/2026 — @dev (Dex): C7.3 — achados BAIXOS da rodada 2 do portão da C7.1 (filtro do texto fixo, eco exato, cancelar pausa do
  admin, texto neutro) e o teste do QA trazido; sem migração. Testes: `npx tsc --noEmit` → 0 erros; `npx vitest run server/ycloud server/dolores/roteamento-eco-campanha.test.ts
  server/dolores/e9-conexao-unica.test.ts server/admin-permissions.test.ts --maxWorkers=2 --minWorkers=1` → 10 arquivos, 192/192
  (15 novos em `ycloud-c73.test.ts`, 1 novo em `roteamento-eco-campanha.test.ts`, `ycloud-qa-c71-r2.test.ts` 7/7). Sem tela alterada.
- 21/11/2026 — @dev (Dex): correções do portão de QA da C7.2 (CONCERNS): QA-1 tentativa somada já na reserva e JSON gravado
  cortado pelo tamanho serializado (surrogates soltos trocados; vale também para o vínculo); QA-2 modelo padrão DEPOIS da rotina
  principal nos dois crons, com prazo total de até 10 s abortando as chamadas e sem mexer na resposta; QA-3 vínculo guarda as
  versões anteriores (nome → variáveis), a v1 aprovada continua preenchendo; QA-4 texto do cartão com as condições reais.
  `ycloud-qa-c72.test.ts` (it.fails → it; teste do _v2 invertido para o corrigido) e 8 testes novos em `ycloud-c72.test.ts`;
  130/130 no pacote do portão.
- 21/11/2026 — @dev (Dex): C7.2 — modelo padrão pelo servidor e template da Central enviado para aprovação (sem botão novo, pela
  correção do dono); sem migração. Testes em `server/ycloud/ycloud-c72.test.ts`.
- 21/11/2026 — @dev (Dex): correções do portão de QA da C7.1 (F1, F2, F3, texto fixo, webhook, eco no roteamento, limite do dia no
  lote); sem migração. Testes em `server/ycloud/ycloud-qa-c71.test.ts` (F1/F2/F3 invertidos para o corrigido) e
  `server/dolores/roteamento-eco-campanha.test.ts` (novo).
- 21/11/2026 — @dev (Dex): C7.1 — dois níveis (operar × administrar) pela decisão do dono; colaborador com WhatsApp opera campanhas.
- 21/11/2026 — @dev (Dex): correções R2-1 e R2-2 da rodada 2 do portão.
- 21/11/2026 — @dev (Dex): correções 1–11 do portão de QA (CONCERNS/NEEDS_WORK); segue InReview para nova revisão.
- 20/11/2026 — @dev (Dex): story criada a partir do pedido do coordenador; InProgress → InReview (implementação, testes e tsc ok; aguarda @qa).
