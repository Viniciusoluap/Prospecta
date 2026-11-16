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
      pelo admin, validado como brasileiro), nunca no código; comparação ESTRITA (remetente `55` + DDD + número, mesmo DDD
      e mesmos 8 últimos dígitos; só o nono dígito varia — correção do QA, achado 1). Mensagem de outro número não é
      comando: é ignorada, sem resposta e sem chamar a IA, e fica registrada em `dolores_acoes` (uma linha por remetente
      por hora; contagem em `dolores_remetentes_estranhos`).
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
- [x] AC11: migração `0124_dolores_whatsapp.sql` aditiva e idempotente (só tabelas e colunas novas); schema novo em
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
- `drizzle/0124_dolores_whatsapp.sql` (novo) — `dolores_whatsapp_config`, `dolores_mensagens` (com `reserva_*`),
  `dolores_consumo`, `dolores_remetentes_estranhos` (só tabelas/colunas novas).
- QA (16/11): `server/dolores/erro-seguro.ts` (novo), `server/dolores/whatsapp-qa.test.ts` (novo); alterados
  `shared/dolores/whatsapp.ts`, `shared/dolores/sanitizar.ts`, `server/dolores/{whatsapp,cerebro,consumo,router,ponte,auditoria}.ts`,
  `server/_core/anthropic-painel.ts` (`existeChaveAnthropicPainel`), `client/src/components/admin/DoloresCard.tsx`
  (`confirmarConexao`), testes `regras`, `whatsapp-regras`, `router`, `integracoes-anthropic`.
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
- QA r2 (16/11): alterados `shared/dolores/{sanitizar,whatsapp}.ts`, `server/dolores/{whatsapp,cerebro,consumo,router}.ts`,
  `drizzle/0124_dolores_whatsapp.sql` e `drizzle/schema-dolores-whatsapp.ts` (índices parciais); testes `regras`,
  `whatsapp-regras`, `whatsapp-qa`, `whatsapp`, `router`, `server/integracoes-anthropic.test.ts`.
- QA r3 (16/11): alterados `shared/dolores/{sanitizar,whatsapp}.ts`, `docs/dolores/como-ligar.md`; testes `regras`,
  `whatsapp-regras`.
- `docs/dolores/ferramentas-etapa1.json` (regerado: etapa 2, mesmas 12 ferramentas), `docs/dolores/como-ligar.md`
  (seção Etapa 2), `docs/dolores/agente-etapa2.md` (novo), `docs/stories/epics/ROADMAP.md` (paridade em espera),
  `HANDOFF-16-11-CORRECOES-E-DOLORES.md`.

## Diferença em relação ao prompt mestre — para o dono confirmar

- **O que mudou:** o prompt mestre (seção 2) põe o "cérebro" da Dolores num agente do Claude Console. Nesta etapa o
  cérebro roda no servidor do Prospecta: ao chegar a mensagem do dono, o sistema chama o modelo da Anthropic com a chave
  de Integrações › Anthropic, executa cada consulta pedida pelo modelo pela mesma porta da ponte da etapa 1 e responde no
  WhatsApp. Não há agente no Console (achado 10 do QA, informativo — a arquitetura não muda nesta correção).
- **Por quê:** na API da Anthropic quem executa as ferramentas é o programa que chama o modelo; um agente no Console não
  recebe o WhatsApp nem chama a ponte sozinho. No sistema, a conferência do número, o limite mensal, os tetos, o prazo de
  60 s e a auditoria ficam num lugar só, e o token da ponte não sai do servidor. O texto de instrução é o mesmo.
- **A IA só liga com o interruptor do dono:** desligada por padrão; só chama a Anthropic depois de "Ligar a IA" em
  Integrações › Dolores, com número do dono, chave, modelo e limites. Se o dono preferir o Console, basta não ligar.
  Mesmo texto em `docs/dolores/como-ligar.md` (Etapa 2).

## Correções do portão de QA (16/11/2026, @dev Dex — QA FAIL de Quinn)

| Achado | Correção | Teste de regressão |
|---|---|---|
| 1 (bloqueia) número do dono ignorava o DDI | `ehNumeroDoDono` estrita (`^55[1-9]{2}9?\d{8}$` dos dois lados, mesmo DDD e 8 finais; só o nono dígito varia), também na segunda conferência do envio; `normalizarNumeroDono` recusa estrangeiro/DDD inválido; `chaveTelefone` intocada (as checagens de conflito da tela usam `pareceMesmoTelefone`, só para recusar) | `whatsapp-regras.test.ts` (+992/+994/+995/+996/+998, curto, zeros à esquerda, 13/12/11/10 dígitos); `whatsapp-qa.test.ts` achado 1 (ponta a ponta) |
| 2 filtro de dados pessoais | dígitos seguidos de `.`/`,`/`-`/fim de frase, CPF com espaços (só se válido), nono dígito separado; números de processo/protocolo/matrícula logo após o rótulo ficam (salvo CPF válido/celular) | `regras.test.ts` achado 2 (dois lados); `whatsapp-qa.test.ts` achado 2 |
| 3 limite em corrida | `reservarChamada`: transação com `FOR UPDATE` na configuração, soma consumo + reservas válidas das outras mensagens e grava a reserva antes de chamar; liberada depois, vence sozinha | `whatsapp-qa.test.ts` achado 3 |
| 4 função morre no meio | linha "processando" com mais de 3 min vira "erro" (UPDATE condicional) na próxima entrada/reentrega e o dono recebe uma vez "não consegui terminar o pedido de HH:MM…"; sem refazer (sem gasto em dobro) | `whatsapp-qa.test.ts` achado 4 |
| 5 60 s com vários comandos | um prazo único (45 s) para o aviso inteiro, envios incluídos (`min(8 s, restante)`); sem tempo para comando → frase fixa "não deu tempo…"; sem tempo nem para isso → não reivindica | `whatsapp-qa.test.ts` achado 5 (relógio falso, 20 comandos) |
| 6 tipos de mensagem | `ephemeralMessage`/`viewOnce*` desembrulhados; reação e edição ignoradas e auditadas numa linha com a contagem; encaminhada → frase pedindo que o dono escreva | `whatsapp-qa.test.ts` achado 6 |
| 7 log | `erroParaLog` (`server/dolores/erro-seguro.ts`) usado na ponte, WhatsApp, auditoria e consumo: corta "Failed query … params", valores citados, chave e dados pessoais | `whatsapp-qa.test.ts` achado 7 (unidade, 2 ponta a ponta, estático) |
| 8 `statusConexao` | consulta pura (só lê a Evolution, devolve `precisaConfirmar`); efeitos na mutação `confirmarConexao` (só admin); número vazio falha fechado | `router.test.ts` achado 8 (pelo `appRouter`, tipos query/mutation) |
| 9 guarda da chave | `existeChaveAnthropicPainel` (só diz se existe) no router; a chave é lida só em `bloqueioAtual` (whatsapp.ts), depois da pausa e do interruptor; a guarda confere imports por arquivo e a chamada única | `integracoes-anthropic.test.ts` (3 testes) |
| extra | remetente estranho: uma linha em `dolores_acoes` por remetente por hora; contagem atômica em `dolores_remetentes_estranhos` (mascarado, chave HMAC) | `whatsapp-qa.test.ts` extra |
| 10 (info) | documentado acima e em `como-ligar.md`; nada muda no código | — |

## Correções da 2ª rodada do QA (16/11/2026, @dev Dex — QA r2 CONCERNS de Quinn)

| Achado | Correção | Teste de regressão |
|---|---|---|
| N1 (importante) filtro de dados pessoais | `sanitizar.ts` reescrito: normaliza disfarces (largura total, invisíveis zero-width/U+FEFF/hífen suave, hífens U+2010–2015/U+2212 entre dígitos) e junta grupos de dígitos separados por espaço/ponto/hífen/sublinhado/barra/parênteses numa cadeia; CPF e CNPJ com DV válido saem em qualquer separação comum; telefone com DDD colado, pontuado, entre parênteses, 3-3-3, sem DDD (9 dígitos com 9; fixo 4-4 começando por 2–9); e-mail com espaço, `[at]`, `(arroba)` e sem domínio de topo | `regras.test.ts` "QA r2 N1" |
| N7 falsos positivos | intervalos de anos (19xx/20xx) ficam; grupos curtos fora do lugar do DDD/9 descartam a forma de telefone (lotes, quadras, unidades); fixo e sequência de 11 sem forma conhecida ficam com rótulo antes (nota fiscal, área, valor, lote, protocolo…) ou unidade depois; valor com decimais fica. Celular, CPF e CNPJ válidos saem mesmo com rótulo | `regras.test.ts` "QA r2 N7" + todos os casos da etapa 1 (achado 2) |
| N2 fixo × celular | a falta do nono dígito só casa quando os 8 finais começam por 6–9; dono fixo → igualdade exata | `whatsapp-regras.test.ts` "QA r2 N2" |
| N3 aviso falso de limite | `reservarChamada` separa uso real (→ `limite_mensal`) de reserva de outro pedido (→ `outro_pedido`); frase própria `FRASE_OUTRO_PEDIDO`, sem `marcarAvisoDoMes` | `whatsapp-qa.test.ts` achado 3 (dois testes ajustados: motivo próprio, `aviso_limite_mes` intacto; limite real continua avisando) |
| N4 comando perdido | sem tempo nem para a frase fixa, a mensagem é reivindicada (`processando` + `MOTIVO_SEM_TEMPO_NO_AVISO`) e auditada; a recuperação do próximo aviso a pega na hora (sem esperar 3 min) e avisa o dono uma vez | `whatsapp-qa.test.ts` "QA r2 N4" |
| N5 Reativar recebimento | `ativarAvisos` exige `status_conexao = conectado` e `numero_dolores`, Evolution "open", número lido igual ao confirmado, não ser da empresa nem do dono; senão PRECONDITION_FAILED sem registrar nada | `router.test.ts` "QA r2 N5" |
| N6 guarda da chave | conta todas as ocorrências do nome na Dolores (só `whatsapp.ts`, 2: import + `await configuracaoAnthropicPainel()`), módulo citado só no import, sem reexportação, chamada dentro do corpo de `bloqueioAtual` | `integracoes-anthropic.test.ts` (fonte real + 8 variantes que devem falhar: apelidos, reexportações, import dinâmico, arrow depois, 2ª chamada, chamada movida) |
| N8 crescimento | estranho não grava linha em `dolores_mensagens` (só a contagem por hora e uma auditoria por remetente/hora); reentrega descartada por memória curta (2.000 ids, por instância do servidor); índices parciais na 0124 | `whatsapp-qa.test.ts` "QA r2 N8" (500 mensagens → 0 linhas; índices; 0124 sem DELETE/TRUNCATE/DROP) |
| info fixar/enquete/botão | `lerMensagemEvolution` → `ignorar/interacao`; silêncio, auditado na linha de contagem (com reação/edição) | `whatsapp-qa.test.ts` "QA r2 (informativo)" |

- [AUTO-DECISION] "Guia 99991234567" (e "Protocolo nº 99991234567") continua mascarado → é um celular perfeito do DDD 99
  (a própria região) e a etapa 1 já exigia mascarar "protocolo 99991234567"; na dúvida entre vazar e mascarar, mascara.
- [AUTO-DECISION] "id 3523 4567" (8 dígitos 4-4 começando por 2–9, sem rótulo) é tratado como fixo sem DDD e sai.
- [AUTO-DECISION] Normalização só nos caracteres de disfarce; quando nada é mascarado, o texto volta idêntico ao original.
- **Decisão a confirmar pelo dono (N8 — retenção):** nenhuma rotina apaga nada. `dolores_remetentes_estranhos` cresce no
  máximo uma linha por remetente estranho por hora (sem texto); se um dia precisar de limpeza, seria só dessas linhas
  técnicas antigas, desligada por padrão e só com a ordem do dono. `dolores_acoes` e as mensagens do dono nunca são apagadas.
- Reentrega de estranho entre instâncias diferentes do servidor pode somar 1 a mais na contagem (sem resposta, sem IA).

## Correções da 3ª rodada do QA (16/11/2026, @dev Dex — QA r3 CONCERNS de Quinn, HEAD revisado `4487843`)

| Achado | Correção | Commit | Teste de regressão |
|---|---|---|---|
| R1 (importante) rótulos livravam telefone | `CONTEXTO_NAO_TELEFONE` (só rótulos de documento) para a forma de fixo; casa/apartamento/unidade/valor/total/ano/pedido não livram telefone; 8 dígitos começando com 6–9 = celular antigo, sai sempre; palavra de telefone (tel, fone, celular, whats, zap, contato, ligar, recado) nos ~50 caracteres antes anula rótulo, unidade e o filtro de anos | `6696919` | `regras.test.ts` "QA r3 R1" (18 casos que saem + 7 que ficam) |
| R2 celular + ",dígito" | decimal só com `,\d{1,2}(?!\d)`, e para forma de celular só quando tem cara de dinheiro (milhar com ponto ou "R$" antes); checagem depois do teste de telefone | `ad2dbfe` | `regras.test.ts` "QA r3 R2" |
| R3 corte de 16 grupos | cadeia sem corte; janela deslizante de até 16 grupos a partir de cada posição; só sub-cadeias de 8–14 dígitos são classificadas; contexto (regex) calculado só quando decide | `c5d732b` | `regras.test.ts` "QA r3 R3" (14–40 números soltos antes de CPF e celular) |
| R4 tempo quadrático | `EMAIL` ancorado no início da palavra (`(?<![\w.+-])`); montagem final linear | `c2bbb51` (+ `c5d732b`, `4c7fe97`) | `regras.test.ts` "QA r3 R4" (5 textos de 200 kB, limite 3 s cada) |
| R5 texto + interação | com `conversation`/`extendedTextMessage.text` não vazio, é texto (a lista de interações só vale sem texto) | `60bb93b` | `whatsapp-regras.test.ts` "QA r3 R5" |
| info | dígitos de outras escritas (árabe-índico, persa, devanágari…) normalizados; `/` e `|` no telefone só com palavra de telefone; chave de NF-e de 44 dígitos: reconhecida (DV válido ou rótulo chave/acesso/NF-e/DANFE/nota) fica inteira, senão sai inteira; com palavra de telefone, cadeia inteira de 8–13 dígitos sem cara de data sai ("fone 9912345678"); `como-ligar.md`: cadastrar o celular do dono com o 9, fixo exige igualdade exata | `4c7fe97` | `regras.test.ts` "QA r3 (informativos)" |

Tempos (sonda de desempenho do QA, depois das correções): 200 kB só de dígitos 3–12 ms (era 59 s); "12." repetido 185–308 ms
(era 67 s); "aaa…a1" 4–6 ms (era 66 s); "1 " repetido 558–755 ms; prosa realista 35–257 ms; base64 14–17 ms.

- [AUTO-DECISION] "valor 1234567890" (10 dígitos com forma de fixo do DDD 12) agora sai: valor deixou de livrar telefone
  (pedido do R1); "Valor 1234567890 centavos" continua intacto pela unidade depois.
- [AUTO-DECISION] Com palavra de telefone antes, "tel 2024-2025" sai (a palavra anula o filtro de anos): na dúvida, mascara.
- [AUTO-DECISION] Célula de tabela isolada entre "|" conta como "cadeia inteira" para a regra dos 11 dígitos sem forma.
- Em aberto (pré-existente, fora do pedido): "código do imóvel 12345" vira "código [senha omitida]" (regra da senha).

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
- (Resolvidas no QA: pedido interrompido e corrida do limite mensal — ver "Correções do portão de QA".)
- [AUTO-DECISION] dolores_acoes é só de inclusão (gatilho): a contagem de remetentes estranhos fica em tabela própria
  e a auditoria recebe só a primeira mensagem de cada remetente na hora.
- [AUTO-DECISION] Reserva do limite = maior entre 4.000 tokens e a entrada da última chamada do pedido (entrada) e 2.000
  (saída); vale 90 s. A conferência é "uso + reservas dos outros < limite" (estouro de no máximo uma chamada, como antes
  em série, e nunca mais por paralelismo).
- Não há script `lint` no `package.json`; qualidade por `tsc --noEmit`, testes e `vite build`.

## Testes executados
- (a) Automáticos (16/11): `npx tsc --noEmit` sem erros; `npx vitest run server/dolores server/central-vendas*.test.ts
  server/auth-session.test.ts server/imports-esm.test.ts server/api-rotas-producao.test.ts server/integracoes-anthropic.test.ts
  server/whatsapp-conversas.test.ts` — 22 arquivos, 218 testes passando (novos: regras 12, webhook/laço 31, rotas 13);
  `npx vite build` ok; suíte completa `npx vitest run` — 231 arquivos, 2253 testes passando.
- (a2) Automáticos depois das correções do QA (16/11): `npx tsc --noEmit` sem erros; `npx vitest run server/dolores
  server/integracoes-anthropic.test.ts server/central-vendas*.test.ts server/whatsapp*.test.ts server/auth-session.test.ts
  server/imports-esm.test.ts server/api-rotas-producao.test.ts` — 28 arquivos, 301 testes passando (whatsapp-qa 28,
  whatsapp 31, router 16, whatsapp-regras 14, regras 11, integracoes-anthropic 18); `npx vite build` ok. Os testes de
  ataque do QA que afirmavam os defeitos (DDI, filtro, encaminhada, temporária, corrida) agora falham, como esperado.
- (a3) Automáticos depois da 2ª rodada do QA (16/11): `npx tsc --noEmit` sem erros; o mesmo `npx vitest run …` de (a2) —
  28 arquivos, 318 testes passando (+17 de regressão da r2); `npx vite build` ok.
- (a4) Automáticos depois da 3ª rodada do QA (16/11): `npx tsc --noEmit` sem erros; `npx vitest run server/dolores
  server/integracoes-anthropic.test.ts server/whatsapp*.test.ts server/auth-session.test.ts server/imports-esm.test.ts
  server/api-rotas-producao.test.ts` — 18 arquivos, 248 testes passando; `npx vitest run server/central-vendas` — 10
  arquivos, 76 testes passando (28 arquivos / 324 no total, +6 de regressão da r3); `npx vite build` ok.
- (b) Manuais: nenhum (sem Evolution nem Anthropic reais neste ambiente).
- (c) Pendentes em produção: migração 0124 no Neon; dono cadastra chave/modelo, limites, o número dele e conecta o número
  da Dolores; teste de aceite pelo WhatsApp; conferir os nomes `senderPn`/`remoteJidAlt` do endereço @lid na Evolution real.

## Change Log
- 16/11/2026 — @dev (Dex): story criada (Draft → InProgress), critérios tirados do prompt mestre e da ordem da etapa 2.
- 16/11/2026 — @dev (Dex): InProgress → InReview (implementação e testes concluídos; aguarda portão de QA).
- 16/11/2026 — @qa (Quinn): FAIL (achado 1 bloqueia; 2–9 menores; 10 informativo).
- 16/11/2026 — @dev (Dex): achados 1–9 e o extra corrigidos, um commit por achado, com teste de regressão; seção
  "Diferença em relação ao prompt mestre" para o dono confirmar. Volta ao portão de QA (InReview).
- 16/11/2026 — @qa (Quinn): r2 CONCERNS (N1 importante; N2–N8 menores; informativo).
- 16/11/2026 — @dev (Dex): N1–N8 e o informativo corrigidos, um commit por achado (N1+N7 juntos: mesmo arquivo), com
  teste de regressão; índices parciais na 0124 (ainda não aplicada). Volta ao portão de QA (InReview).
- 16/11/2026 — @qa (Quinn): r3 CONCERNS (R1 importante; R2–R5 menores; informativos).
- 16/11/2026 — @dev (Dex): R1–R5 e os informativos corrigidos, um commit por achado, com teste de regressão; 0124 não
  alterada. Volta ao portão de QA (InReview).
