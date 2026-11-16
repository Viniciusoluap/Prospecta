# E2 — WhatsApp (conexão própria, comando e resposta pelo número do dono)

Status: InReview
Epic: EPIC-025 (Etapa 2) — "Operação Dolores — Prompt Mestre" (16/11/2026), seção 7, linha 2
Paridade: suspensa por ordem do dono em 16/11 (Grupo Santa Fé em espera); registrar no ROADMAP ao fechar o epic.
Tamanho estimado: G
Dependência: E1 (ponte, usuária Dolores, leituras, `dolores_acoes`) — já na `main` (`3142f6b`).

## Problema

Na etapa 1 a Dolores só responde por chamada HTTP à ponte. O dono quer comandá-la em linguagem natural pelo WhatsApp
(seção 1 e 3 do prompt mestre): a Dolores tem número próprio, conectado por QR code pela Central WhatsApp do sistema
(Evolution já em uso); no número dela, comandos só valem quando vêm do número do dono (seção 5, regras fixas). Quem
executa as ferramentas é o próprio sistema (`docs/dolores/como-ligar.md`, passo 5): recebe a mensagem, chama o modelo
da Anthropic com as ferramentas de leitura da etapa 1, executa cada chamada pela mesma porta da ponte e devolve a
resposta no WhatsApp. Teste de aceite (seção 7): a mesma pergunta da etapa 1, feita e respondida pelo WhatsApp —
"Dolores, analise todos os processos de regularização e informe os atrasados, pendências, responsáveis e próximas
providências."

## Critérios de aceite
- [x] AC1: conexão própria da Dolores pela Evolution da Central (instância `prospecta-dolores`, separada da conexão de
      vendas; não entra em `whatsapp_connections`, então a Central de Vendas nunca envia por ela), com QR code na tela
      (Integrações › Dolores, só admin) e webhook de entrada próprio `POST /api/dolores/whatsapp`, registrado nos dois
      servidores (Express local e `api/index.ts`). O número conectado não pode ser o mesmo de uma conexão da empresa.
- [x] AC2: webhook autenticado por segredo próprio (cabeçalho `x-webhook-token`, HMAC do segredo do servidor com rótulo
      próprio, comparação em tempo constante); sem segredo válido: 401, sem auditoria e sem o segredo no log.
- [x] AC3: idempotência — a mesma mensagem (instância + id externo) entregue duas vezes gera uma resposta e um gasto só;
      ignora grupos, status/listas, mensagens enviadas pela própria Dolores (`fromMe`) e mensagens antigas (reentrega).
- [x] AC4: só o número do dono comanda. O número fica em configuração (`dolores_whatsapp_config.numero_dono`, cadastrado
      pelo admin), nunca no código; comparação normalizada (DDI 55 e nono dígito: DDD + 8 últimos). Mensagem de outro
      número não é comando: é ignorada, sem resposta e sem chamar a IA, e fica registrada em `dolores_acoes`.
- [x] AC5: laço de ferramentas — o comando do dono vai ao modelo da Anthropic com a lista fechada das ferramentas
      liberadas (as de leitura da etapa 1); cada chamada passa pela MESMA porta da ponte (pausa, usuária ativa, lista de
      funções, validação, limite por minuto, transação somente leitura, filtro de dados pessoais, auditoria), nunca
      acesso direto ao banco; a resposta final volta ao WhatsApp do dono. Nenhuma função de escrita.
- [x] AC6: a IA não liga sozinha — chave só de `configuracaoAnthropicPainel()` (Integrações › Anthropic) e interruptor
      próprio da Dolores (`ia_ligada`), desligado por padrão; sem chave, sem modelo, sem interruptor, com
      `dolores_config.pausada`, usuária desativada ou limite mensal batido, nenhuma chamada à Anthropic acontece e o dono
      recebe uma frase fixa (sem WhatsApp configurado, nada). Nunca resposta fingida de IA.
- [x] AC7: injeção de instruções — resultado de ferramenta só em `tool_result`; a mensagem do dono é a única fonte de
      comando; lista fechada de ferramentas; o destino da resposta é sempre o número do dono (conferido de novo no envio),
      nunca tirado de texto; prompt do sistema diz que dado não é ordem. Testes com dados envenenados.
- [x] AC8: 60 s — teto de voltas, teto de tokens por comando e prazo total com folga (laço + envio < 60 s); estourando,
      responde o que tem e diz que parou.
- [x] AC9: custo — consumo de tokens (entrada, saída, cache) por chamada em `dolores_consumo`; limite mensal
      configurável (entrada e saída, separados); ao bater, bloqueia e avisa o dono uma vez no mês.
- [x] AC10: auditoria em `dolores_acoes` (canal `whatsapp`) de cada mensagem recebida, cada chamada de ferramenta e cada
      resposta (ok/erro); a tabela segue só de inclusão.
- [x] AC11: migração `0124_dolores_whatsapp.sql` aditiva e idempotente (só tabelas novas); schema novo em
      `drizzle.config.ts`; nenhum `select()` de tabela existente mudou.
- [x] AC12: rotas tRPC de configuração (`dolores.*`) só de admin (papel), testadas pelo `appRouter` com o caminho completo.
- [x] AC13: segredos — nenhuma chave, token, QR guardado ou número completo em log, resposta de API (fora o QR na hora de
      conectar), frontend ou mensagem de erro; passo a passo do dono em `docs/dolores/como-ligar.md` (Etapa 2).

## Tarefas
- [x] T1: levantamento (Evolution, webhook da Central, fila e prazos da Central de Vendas, cliente Anthropic, painel).
- [x] T2: regras puras `shared/dolores/whatsapp.ts` (número do dono, leitura do aviso da Evolution, mensagem antiga,
      frases fixas, limites, corte da resposta).
- [x] T3: migração `drizzle/0124_dolores_whatsapp.sql` + `drizzle/schema-dolores-whatsapp.ts` (ligado no drizzle.config).
- [x] T4: ponte — núcleo `executarFuncao` reaproveitado pelo HTTP e pelo laço (mesma porta); auditoria com canal.
- [x] T5: `server/dolores/consumo.ts`, `server/dolores/cerebro.ts` (laço), `server/dolores/whatsapp.ts` (webhook e
      resposta), `server/dolores/router.ts` (tRPC admin).
- [x] T6: tela `client/src/components/admin/DoloresCard.tsx` em Integrações.
- [x] T7: testes (PGlite e cliente de IA falso; nenhuma chamada externa).
- [x] T8: documentos (`docs/dolores/como-ligar.md`, `agente-etapa2.md`), HANDOFF; tsc, testes, guarda da Vercel, build.

## Testes previstos
- Automáticos: `server/dolores/*.test.ts` (novos: `whatsapp-regras`, `whatsapp`, `cerebro`, `router`).
- Manuais: QR code e uma mensagem do dono depois da publicação (o dono cadastra número, chave e limite).
- Pendente em produção: migração 0124 no Neon; conectar o número da Dolores; teste de aceite pelo WhatsApp.

## Depende do dono
Número e QR code da Dolores; número do dono na tela; chave e modelo preferencial em Integrações › Anthropic (créditos no
Claude Console); limites mensais de tokens; ligar o interruptor.

## File List
- `drizzle/0124_dolores_whatsapp.sql` (novo) — `dolores_whatsapp_config`, `dolores_mensagens`, `dolores_consumo` (só tabelas novas).
- `drizzle/schema-dolores-whatsapp.ts` (novo); `drizzle.config.ts` (schema ligado, os anteriores mantidos).
- `shared/dolores/whatsapp.ts` (novo, puro) — número do dono, leitura do aviso da Evolution, frases fixas, limite, corte.
- `server/dolores/ponte.ts` — núcleo `executarFuncao` (mesma porta para a ponte HTTP e o WhatsApp); `auditoria.ts` — canal e
  etapa; `permissoes.ts` — `ETAPA_ATUAL = 2` (nenhuma função nova; `enviar_mensagem_whatsapp` prevista para a etapa 3);
  `perfil.ts` — `idDaDoloresSemCriar`.
- `server/dolores/consumo.ts`, `prompt.ts`, `cerebro.ts`, `whatsapp.ts`, `router.ts` (novos).
- `server/routers.ts` (`dolores`), `api/index.ts` e `server/_core/index.ts` (rota `/api/dolores/whatsapp`).
- `client/src/components/admin/DoloresCard.tsx` (novo), `client/src/pages/admin/AdminIntegracoes.tsx`,
  `client/src/components/admin/AnthropicCard.tsx` (texto: a chave só é usada pela Dolores com o interruptor ligado),
  `server/_core/anthropic-painel.ts` (comentário).
- Testes: `server/dolores/whatsapp-regras.test.ts`, `whatsapp.test.ts`, `router.test.ts` (novos); `testes-banco.ts` (0124 e
  `whatsapp_connections`); `ponte.test.ts` (etapa 2); `server/integracoes-anthropic.test.ts` (a Dolores passa a ser a única
  função autorizada a ler a chave do painel, depois da pausa e do interruptor).
- `docs/dolores/ferramentas-etapa1.json` (regerado: etapa 2, mesmas 12 ferramentas), `docs/dolores/como-ligar.md`
  (seção Etapa 2), `docs/dolores/agente-etapa2.md` (novo), `docs/stories/epics/ROADMAP.md` (paridade em espera),
  `HANDOFF-16-11-CORRECOES-E-DOLORES.md`.

## Dev Notes (implementação, 16/11/2026)
- IDS: reaproveitados o cliente da Evolution (`server/_core/evolution.ts`: QR, estado, número, webhook, envio), o servidor
  Evolution da Central (`configEvolution`), o padrão de segredo HMAC do webhook da Central (rótulo próprio), o padrão de
  processamento dentro do aviso com prazo da Central de Vendas, o padrão de orçamento de tokens com aviso uma vez por mês
  da `central-vendas/ia.ts`, `chaveTelefone`, o filtro `sanitizarTexto`, a ponte da etapa 1 inteira (`executarFuncao`) e o
  SDK `@anthropic-ai/sdk` já usado. Nenhum segundo cliente de WhatsApp.
- [AUTO-DECISION] Onde guardar a conexão da Dolores → tabela própria `dolores_whatsapp_config`, NÃO `whatsapp_connections`
  (razão: a Central de Vendas envia pela primeira conexão Evolution conectada e o webhook geral criaria leads com as
  mensagens do dono; fora de lá, nenhum desses caminhos enxerga o número dela). Configuração nova também não mexe no
  `select()` de `dolores_config` (a ponte da etapa 1 segue funcionando sem a 0124).
- [AUTO-DECISION] Número do dono → configuração em banco cadastrada pelo admin na tela (mínimo trabalho manual do dono);
  guardado em dígitos com 55, mostrado mascarado.
- [AUTO-DECISION] Destino da resposta → o número do remetente que acabou de ser conferido como o do dono (é o endereço
  canônico do WhatsApp, resolve o nono dígito), conferido de novo dentro de `responderAoDono`.
- [AUTO-DECISION] Limite mensal em TOKENS (entrada e saída separados), 0 = bloqueada → o sistema não sabe o preço do
  modelo e não pode inventá-lo (prompt mestre, seção 8); a conversão do teto em reais está no passo a passo do dono.
- [AUTO-DECISION] "Avisar o dono uma vez" → o aviso com o uso do mês sai uma vez por mês (marca atômica
  `aviso_limite_mes`); depois, cada comando dele recebe só a frase curta fixa (sem IA, sem custo).
- [AUTO-DECISION] Modelo → o preferencial de Integrações › Anthropic; opcionalmente um modelo próprio da Dolores
  (validado contra a lista da chave). Sem nenhum dos dois, não chama. Nenhum id de modelo no código.
- [AUTO-DECISION] Mensagem antiga = mais de 5 min (ou sem data, ou >2 min no futuro). As antigas não entram em
  `dolores_mensagens` (reconexão pode trazer histórico) e viram uma linha de auditoria com a contagem por aviso.
- [AUTO-DECISION] Grupos, status e as mensagens dela mesma: ignorados sem auditoria (volume alto; grupos são a etapa 4).
- [AUTO-DECISION] Mídia do dono: frase fixa ("só entendo texto"); legenda não é comando.
- [AUTO-DECISION] Endereço `@lid` do WhatsApp: o número vem de `key.senderPn`/`key.remoteJidAlt`; sem eles a mensagem não
  comanda. **A confirmar na Evolution real** (nomes dos campos variam por versão).
- [AUTO-DECISION] Cada comando é independente (sem histórico de conversa entre comandos) — menos custo e nenhum texto
  antigo vira contexto.
- [AUTO-DECISION] `ETAPA_ATUAL = 2` sem função nova; `enviar_mensagem_whatsapp` passa a "prevista para a etapa 3"
  (mensagem a terceiros chega com as cobranças). A resposta ao dono é do sistema, não ferramenta do modelo.
- [AUTO-DECISION] Tetos: 6 voltas, 6 consultas/volta, 2.000 tokens de saída por chamada, 150.000 de entrada por pedido,
  prazo total 45 s; chamada ao modelo só com ≥ 8 s; fechamento sem ferramentas quando o teto de voltas/tokens acaba.
  Cache de prompt (ephemeral) no texto do sistema para baratear as voltas.
- [AUTO-DECISION] QR code: devolvido só à tela do admin na hora de conectar (é como a conexão funciona), nunca guardado.
- Limitação conhecida: se a função cair no meio de um comando, a linha fica "processando" e a reentrega não responde (é
  tratada como repetida) — o dono manda de novo. Dois comandos simultâneos podem passar um pouco do limite mensal (a
  conferência é antes de cada chamada).
- Não há script `lint` no `package.json`; qualidade por `tsc --noEmit`, testes e `vite build`.

## Testes executados
- (a) Automáticos (16/11): `npx tsc --noEmit` sem erros; `npx vitest run server/dolores server/central-vendas*.test.ts
  server/auth-session.test.ts server/imports-esm.test.ts server/api-rotas-producao.test.ts server/integracoes-anthropic.test.ts
  server/whatsapp-conversas.test.ts` — 22 arquivos, 218 testes passando (novos: regras 12, webhook/laço 31, rotas 13);
  `npx vite build` ok; suíte completa `npx vitest run` — 231 arquivos, 2253 testes passando.
- (b) Manuais: nenhum (sem Evolution nem Anthropic reais neste ambiente).
- (c) Pendentes em produção: migração 0124 no Neon; dono cadastra chave/modelo, limites, o número dele e conecta o número
  da Dolores; teste de aceite pelo WhatsApp; conferir os nomes `senderPn`/`remoteJidAlt` do endereço @lid na Evolution real.

## Change Log
- 16/11/2026 — @dev (Dex): story criada (Draft → InProgress), critérios tirados do prompt mestre e da ordem da etapa 2.
- 16/11/2026 — @dev (Dex): InProgress → InReview (implementação e testes concluídos; aguarda portão de QA).
