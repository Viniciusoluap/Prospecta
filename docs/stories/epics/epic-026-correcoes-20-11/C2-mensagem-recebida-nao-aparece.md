# C2 — Mensagem recebida de outro número não aparece na Central

Status: InReview (implementado pelo @dev; aguarda o portão de QA de SEGURANÇA — mexe no webhook do WhatsApp da empresa)
Epic: EPIC-026 (correção C2). Defeito de produção relatado pelo dono em 20/11/2026.
Regra nova do dono (registrada no epic): **nenhuma mensagem é descartada sem registro visível.** Sem puxar histórico antigo.
Ramo: `epic026-c2` (da `main`, `e978b14`); push em `claude/wip-epic026-c2`.
Migração: **`0136_whatsapp_recebimento.sql`** (0117–0135 em produção). Aditiva e idempotente.
Paridade: Grupo Santa Fé em espera por ordem do dono — a parte da Central (conversa de número não identificado) entra como
pendência no ROADMAP quando o dono retomar a paridade; o registro do recebimento do webhook da Dolores é exceção (Dolores).

## Sintoma
WhatsApp da empresa conectado (instância `prospecta-dolores`, "Reativar recebimento" já clicado depois da etapa 9). Mensagem de
OUTRO número para o número da empresa não apareceu em Central WhatsApp › Conversas. Mensagem enviada pela Central a um cliente
apareceu (ela é gravada direto pelo `responder`, sem passar pelo webhook). Comandos do dono à Dolores funcionam.

Fatos do banco de produção (consulta só-leitura do coordenador, janela de 6 h com o teste): `whatsapp_roteamento_vistos` = 0;
`whatsapp_messages` = 1 saída, 0 entrada; `whatsapp_saudacoes` = 0; `dolores_atendimentos` = 0; em `dolores_acoes` só os
comandos do dono, nenhum "remetente estranho" nem roteamento. Logs da Vercel sem nada com "dolores".

## Investigação — todos os caminhos pelos quais uma mensagem direta de terceiro sumia (webhook → Central)
Código antes da correção (`e978b14`). "Sem registro" = não grava `vistos`, nem auditoria, nem log.

| # | Onde | Caso | Antes |
|---|------|------|-------|
| 1 | `tratarWebhookDolores` | segredo `x-webhook-token` errado | 401 + `console.warn` (log) |
| 2 | idem | instância do aviso ≠ `prospecta-dolores` | **sem registro** (`instancia-desconhecida`) |
| 3 | idem | evento ≠ `messages.upsert` depois de `lower()+_→.` (ex.: `messages-upsert`, `send.message`, `messages.set`) | **sem registro** (`ignorado`) |
| 4 | idem | `data` no formato do Baileys `{ messages: [...], type }` | lido como 1 item sem `key` → `status` → **sem registro** |
| 5 | `lerMensagemEvolution` | `remoteJid` vazio, `@broadcast`, `@newsletter` | **sem registro** (`status`) |
| 6 | idem | `key.id` vazio | **sem registro** (`sem_id`) |
| 7 | idem | endereço em forma desconhecida — inclusive `5599…:12@s.whatsapp.net` (sufixo de aparelho) e `@c.us` | **sem registro** (`outro_destino`) |
| 8 | idem | reação / edição / `protocolMessage` / fixar, enquete, botão | auditoria agregada (sem detalhe por item) |
| 9 | `desembrulhar` | `ephemeralMessage`, `viewOnceMessage*` → ok; `deviceSentMessage` não era aberto | texto vazio (só para `fromMe`) |
| 10 | `tratarTerceiro` | `@lid` SEM número (`senderPn`/`remoteJidAlt` ausentes) | auditoria "sem número conferível" e **descarte** (não vai à Central) |
| 11 | idem | número = o próprio número da empresa | **sem registro** (`propria-numero`) |
| 12 | idem | `reivindicarRoteamento` falha | só `console.error` |
| 13 | `gravarItemNaCentral` | `@lid` COM número em `remoteJidAlt`/`senderPn` | `vistos` gravado, mas a gravação só aceitava `@s.whatsapp.net` → **some da Central sem erro** |
| 14 | `tratarPropria` (fromMe) | eco `@lid` com número | mesmo defeito do 13 |
| 15 | `tratarTerceiro` | `participantPn`/`participantAlt` (algumas versões) | não lidos → caía no 10 |
| 16 | webhook inteiro | exceção não tratada em `tratarTerceiro` | 200 `{ok:false}` + log; os demais itens do aviso perdidos |
| 17 | Evolution | o aviso NÃO SAI da Evolution (falha ao decifrar a 1ª mensagem de contato novo em `@lid` — "Bad MAC"/"No session", mensagem "Aguardando mensagem" no celular — ou evento não assinado) | nada chega ao sistema |

Formato real do webhook da Evolution v2: não há documentação nem código da Evolution no repositório nem em `node_modules`. O código
ficou tolerante às formas conhecidas (objeto, lista, `{messages}`; `remoteJidAlt` v2.3, `senderPn` v2.1/2.2,
`participantPn`/`participantAlt`; sufixo `:N`; `addressingMode`), conferidas pelos testes com envelope realista (`pushName`,
`status`, `messageType`, `instanceId`, `source`, `destination`, `date_time`, `sender`).

## Causa mais provável e o que NÃO dá para afirmar
- `vistos` = 0 exclui os caminhos 10–16 (todos passam por `reivindicarRoteamento` ou pela auditoria "sem número"): a mensagem do
  teste do dono não chegou a `tratarTerceiro`.
- Sobram 2–7 (descarte silencioso no código) e 17 (a Evolution não enviou). Os comandos do dono chegam pelo mesmo webhook, então o
  aviso e o segredo funcionam; o que difere é o REMETENTE: um número que nunca falou com a empresa costuma chegar no endereço novo
  `@lid` — e é aí que a Evolution/Baileys mais falha ao decifrar a primeira mensagem (17) ou manda formas que o código não lia (7).
- **Sem o aviso real não dá para ter certeza** entre "a Evolution não mandou" (17) e "chegou numa forma descartada em silêncio"
  (2–7). Por isso a correção fecha TODOS os caminhos do código e põe o registro de diagnóstico na frente de tudo: no próximo teste
  do dono, a tela "Recebimento nas últimas 24 h" mostra se o aviso chegou e o que foi feito dele.
- O que a tela vai mostrar no próximo teste:
  - "Chegaram: 0" (ou só as do dono) → a Evolution não enviou: conferir na Railway os logs da Evolution na hora do teste
    (decrypt/"Bad MAC"/"No session") e a versão (v2.3.x lê `@lid` melhor); "Reativar recebimento" de novo.
  - "Ignoradas: N × endereço em forma desconhecida / evento não tratado / aviso de outra instância" → é a forma do aviso; o motivo e a
    forma do endereço dizem qual (sem conteúdo).
  - "Foram para a Central: 1" ou "+1 de número não identificado" → corrigido.

## Critérios de aceite
- [x] AC1 — Conversa direta de terceiro sem número identificável (`@lid` sem o número) APARECE na Central como "Número não
      identificado" (chave = o `@lid`, nunca um telefone inventado). Nunca é o dono, nunca é comando, nunca recebe resposta da Dolores.
- [x] AC2 — Antes de gravar sem número: procura o número já conhecido do `@lid` (aprendido de aviso anterior que trouxe os dois) e,
      com tempo no prazo do aviso (≥ 12 s), consulta a Evolution (`POST /chat/findContacts`, só leitura, 3 s, leitura ESTRITA:
      só contato que cite o mesmo `@lid`; dois números → nada). Número do dono/da empresa → não vai à Central.
- [x] AC3 — Quando o número de um `@lid` aparece depois (num aviso com `remoteJidAlt`/`senderPn`, ou pela consulta), a conversa de
      número não identificado passa a ser a do número (as linhas com o `@lid` ganham o número; se for o dono, somem pelo filtro).
- [x] AC4 — `@lid` com número no aviso entra na Central com o número (corrige o caminho 13) e o eco `fromMe` também (14).
- [x] AC5 — Leitura tolerante: evento com `_`/`-`/maiúsculas; `data` objeto, lista ou `{messages}`; sufixo `:N`;
      `participantPn`/`participantAlt`; `deviceSentMessage`. `participant` puro NÃO identifica remetente de conversa direta.
- [x] AC6 — Todo item que chega deixa registro SEM conteúdo em `whatsapp_recebimento_contagem` (hora UTC, evento, destino, motivo,
      forma do endereço; nunca texto, número, nome ou endereço): "chegou" logo depois de ler a configuração e o destino no fim
      (`finally`, inclusive com erro). Contador por combinação (spam não cresce a tabela); 7 dias de retenção (limpeza pelo
      próprio código, no máximo uma vez por hora por servidor). Outra instância e evento não tratado também ficam registrados.
- [x] AC7 — Tela só-admin "Recebimento nas últimas 24 h" no cartão "WhatsApp da empresa" (Integrações): chegaram (por forma do
      endereço), Central (e sem número), Dolores, grupos, enviadas pela empresa, repetidas, erros, sem desfecho e ignoradas por motivo.
      Procedimento `dolores.recebimento` em `soAdmin` (papel admin; `adminProcedure` sozinho só confere módulo).
- [x] AC8 — Na Central, a conversa sem número: abre e pode ser excluída; NÃO responde (servidor recusa com "Não dá para responder
      por aqui: número não identificado"; a tela troca a caixa de resposta pelo aviso), não cria lead, não vincula. `@lid` nunca casa
      com telefone (`chaveTelefone("…@lid") = ""`, `mesmoTelefone` exato entre `@lid`) e nunca é "número reservado" pelos dígitos.
      `enviarAoContato` recusa destino com `@`.
- [x] AC9 — Reentrega do mesmo aviso não duplica conversa nem registro de destino (vai como "repetida").
- [x] AC10 — Sem histórico antigo (nada é buscado na Evolution além do número do `@lid`).

## Decisões
- [AUTO-DECISION] Saudação de campanha para `@lid` sem número → NÃO (o controle "uma vez por número" exige número). Também não
  quando o número veio só pela consulta à Evolution ou pelo par aprendido: saudação e resposta da Dolores só com o número NO
  ENDEREÇO da própria mensagem (regra de antes, sem afrouxar).
- [AUTO-DECISION] Responder pela conversa sem número → NÃO: `enviarTextoEvolution` manda `55` + dígitos (os dígitos do `@lid`
  iriam a um telefone aleatório). A tela mostra "não dá para responder por aqui: número não identificado".
- [AUTO-DECISION] Mensagem que o número da empresa ENVIA a um `@lid` sem número → não entra na Central (pode ser a conversa com o
  dono); fica só no registro de diagnóstico ("propria / sem-numero").
- [AUTO-DECISION] Registro de diagnóstico como contador agregado por hora em tabela própria (não em `dolores_acoes`, que só aceita
  inserção e cresceria uma linha por mensagem): mais barato e com tamanho limitado.
- [AUTO-DECISION] Par `@lid` → número em tabela própria (`whatsapp_lid_numeros`), com o número em claro como já fica em
  `whatsapp_messages.destinatario`; nunca usado para comando.

## Segurança (regras em vigor — nada afrouxado)
- Comando continua só do texto direto com o número do dono NO ENDEREÇO (`ehNumeroDoDono` estrita). Número descoberto por
  consulta/par aprendido nunca vira comando; se for o do dono, a mensagem fica fora da Central (registro "lid-do-dono").
- Conversa do dono e grupos nunca aparecem na Central; a Central nunca escreve ao dono nem ao próprio número.
- HMAC/segredo e checagem de instância do webhook inalterados; `server/integracoes-anthropic.test.ts` intacto.

## Testes
- `server/dolores/c2-recebimento.test.ts` (18): hipótese (a) @lid sem número na Central, sem comando/saudação/resposta; reentrega;
  consulta à Evolution (estranho → Central com número; dono → fora); @lid do dono aprendido; resolução posterior; (b) `remoteJidAlt`,
  `senderPn`, `participantPn`; `participant` puro; `messages-upsert`/`MESSAGES_UPSERT`/lista/`{messages}`/sufixo `:12`; embrulhos;
  (c) terceiro nunca no caminho do dono; (d)/(e) falha ao gravar fica registrada como erro; registro sem conteúdo para cada motivo
  de descarte, outra instância e evento não tratado; limpeza de 7 dias; tela só admin (colaborador/corretor FORBIDDEN) e sem
  conteúdo; Central recusa responder/criar lead/vincular; `@lid` × telefone; leitura estrita da consulta à Evolution.
- Prova do "antes": os mesmos envelopes rodados contra `e978b14` (worktree temporária, teste reduzido): 6 de 7 FALHAVAM — (a) `@lid`
  sem número, `@lid`+`remoteJidAlt`, `@lid`+`participantPn`, evento `messages-upsert`, `data` `{messages}`, sufixo `:12` — e o
  controle (número normal) passava. Dos 6, os três últimos não deixavam registro NENHUM (nem `vistos`, nem auditoria): são os que
  batem com o que se viu em produção, junto com "a Evolution não enviou" (17).
- Ajustados: `e9-conexao-unica.test.ts` (`@lid` sem número → `central_sem_numero`; `fromMe` sem número continua "nada") e
  `whatsapp-regras.test.ts` (campo `lid` na leitura).

## File List
- `drizzle/0136_whatsapp_recebimento.sql` (novo), `drizzle/schema-whatsapp-atendimento.ts`
- `server/whatsapp-recebimento.ts` (novo)
- `shared/dolores/whatsapp.ts`, `shared/dolores/roteamento.ts`, `shared/whatsapp/conversas.ts`
- `server/dolores/whatsapp.ts`, `server/dolores/roteamento.ts`, `server/dolores/router.ts`
- `server/whatsapp-evolution-webhook.ts`, `server/whatsapp-router.ts`, `server/whatsapp-conexao-empresa.ts`, `server/_core/evolution.ts`
- `client/src/components/admin/WhatsappEmpresaCard.tsx`, `client/src/components/whatsapp/ConversasWhatsApp.tsx`
- `server/dolores/testes-banco.ts`, `server/dolores/c2-recebimento.test.ts` (novo), `server/dolores/whatsapp-regras.test.ts`,
  `server/dolores/e9-conexao-unica.test.ts`

## Verificação
- `npx tsc --noEmit`: ok. `npx vite build`: ok.
- `npx vitest run server/dolores server/whatsapp server/integracoes-anthropic.test.ts server/auth-session.test.ts server/imports-esm.test.ts server/api-rotas-producao.test.ts --maxWorkers=2 --minWorkers=1`:
  50 arquivos, 839 testes, 0 falhas (com o ajuste do e9 conferido em seguida: 38/38).

## Change Log
- 20/11/2026 — @dev (Dex): InProgress → InReview. Investigação, correção, migração 0136, tela de recebimento, testes.
