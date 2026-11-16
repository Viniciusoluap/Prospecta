# E2 — WhatsApp (conexão própria, comando e resposta pelo número do dono)

Status: InProgress
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
(preenchida ao final)

## Dev Notes
(preenchidas ao final)

## Change Log
- 16/11/2026 — @dev (Dex): story criada (Draft → InProgress), critérios tirados do prompt mestre e da ordem da etapa 2.
