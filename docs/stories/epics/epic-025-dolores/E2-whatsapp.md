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
- QA r4 (16/11): alterados `shared/dolores/sanitizar.ts` e `server/dolores/regras.test.ts`.
- QA r5 (16/11): alterados `shared/dolores/sanitizar.ts` e `server/dolores/regras.test.ts`.
- QA r6 (16/11): alterados `shared/dolores/sanitizar.ts` e `server/dolores/regras.test.ts` (fuzz "nunca pior que a main").
- Opção B (16/11): `server/dolores/dados-pessoais.ts` (novo, o interruptor); alterados `shared/dolores/sanitizar.ts`,
  `server/dolores/{ponte,whatsapp,auditoria,erro-seguro}.ts`, testes `regras`, `ponte`, `whatsapp`, `whatsapp-qa`;
  `docs/dolores/como-ligar.md`.
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

## Correções da 4ª rodada do QA (16/11/2026, @dev Dex — QA r4 FAIL de Quinn, HEAD revisado `2dd8ae9`)

Antes de editar, a DECISÃO do filtro (`shared/dolores/sanitizar.ts`) foi reorganizada em duas fases, nesta ordem, e
escrita no cabeçalho do arquivo:
1. **Mascarar sem exceção**: CPF com DV válido, CNPJ válido, celular (11 com DDD e 9; 10 com DDD e 6–9; 9 começando por
   9; 8 começando por 6–9 com forma de telefone) e e-mail — em qualquer separação, com qualquer rótulo antes, sozinho ou
   dentro de cadeia maior (janela deslizante). Única ressalva, de estrutura e não de rótulo: valor com centavos
   ("R$ 99991234567,50", "999.123.456,00"), que já era garantido pelo teste R2.
2. **Preservar por estrutura completa**: (2a) chave de NF-e e linha digitável validadas por inteiro — o trecho fica e a
   fase 1 não se aplica a ele; (2b) o resto (fixo de 2–5, 11 dígitos sem forma) só onde a fase 1 nada achou, com os
   rótulos de documento/quantidade decidindo.

| Achado | Correção | Commit | Teste de regressão |
|---|---|---|---|
| S1 (bloqueava) chave de NF-e pelo rótulo/DV deixava 4 CPFs/celulares intactos | chave só fica com DV + UF 11–53 + mês 01–12 + CNPJ do emitente válido + modelo 55/65, nunca em 4 blocos de 11; rótulo sozinho não isenta; a cadeia de 44 que não validou sai inteira, mas a lista 4×11 sai item por item | `4ee4a9f` | "QA r4 S1" (11 textos: nota/acesso/DANFE/chave com ponto/NF-e misturado/"nota: ligar"/sem rótulo com DV fechando) |
| S2 linha digitável mascarada em parte | reconhecida pela forma 5.5 5.6 5.6 1 14 (ou 10 11 11 1 14) com o DV módulo 10 dos três campos; sem validar, vale a fase 1 | `8237b5d` | "QA r4 S2" (Bradesco 237, Sicoob 756, Sicredi 748, sem pontos, Itaú; DV errado continua mascarando; celular colado depois sai) |
| S3 regra bancária quadrática | o número da conta começa logo depois do rótulo e tem tamanho limitado (sem lookahead que varria a palavra); pré-filtro `formaPossivel` descarta janelas que não podem ser CPF/CNPJ/telefone; célula de tabela não atravessa "\|" | `4c2ac31` | "QA r4 S3" (17 textos de 200 kB, limite 3 s cada) |
| S4 pares/faixas de 4 dígitos | ver a tabela abaixo | `e1ac6f1` | "QA r4 S4" (15 que ficam, 16 que saem) |
| S5 pix/conta/código | PIX só com forma de chave (e-mail, uuid, 8–14 dígitos sem centavos depois); conta/agência só com número de conta (3+ dígitos, não ano, não valor com centavos); "código" só com senha/acesso/token/OTP a até 40 caracteres depois ou 30 antes, e sem engolir a oração quando não é senha | `c3cd9b8` | "QA r4 S5" (13 que ficam, 12 que saem) |
| S6 formatos forçados | ligação aceita "·", "•", ":" e vários espaços; hífen tipográfico com até 3 espaços; "529982247,25" (CPF válido, sem R$); dígitos Adlam; sobrescritos e circulados em sequência de 4+; e-mail "a @ b . com", "a arroba b ponto com", "(at)/(dot)", "[at]/[dot]" com domínio de topo conhecido | `a12ac80`, `6c631c7` | "QA r4 S6" |

**Regra final do par 4-4 e do fixo (S4)** — decide de cima para baixo, a primeira linha que casar vale:

| Situação | Resultado | Exemplos |
|---|---|---|
| Palavra de telefone (tel, fone, celular, whats, zap, contato, ligar, recado) nos ~50 caracteres antes | sai sempre | "tel casa 3523-4567", "Recado: ligar na casa 3523-4567", "whats lotes 3201 3202" |
| Começa por 6–9 (celular antigo) | sai sempre, com qualquer rótulo | "lotes 7001 7002", "R$ 9123 4567", "casa 9123-4567", "itens 6000 7000" |
| 2–5 com rótulo de documento logo antes (processo, protocolo, matrícula, inscrição [imobiliária/municipal], IPTU, nota fiscal, lote, quadra, R$, boleto, CEP…) ou unidade de medida depois | fica | "protocolo 3523-4567", "quadra 3523 4567", "IPTU 3523 4567 0001" |
| 2–5 em 4-4 com rótulo de quantidade/valor/faixa (valor, total, preço, custo, orçamento, renda, faixa, quantidade, estoque, itens, parcelas, saldo, lotes, quadras) | fica | "valor 3523 4567", "estoque: 3500 4200", "parcelas de 2500 3000" |
| 2–5 em 4-4, faixa crescente com hífen e os dois terminando em 00 | fica | "orçamento 2500-3000", "entre 2500-3000 por mês" |
| Item do meio/fim de uma lista de grupos de 4 cujo rótulo (antes do 1º item) é de quantidade ou documento | fica | "lotes 3201 3202 3203", "valores 3500 4200 5100" |
| 2–5 sem nada disso (casa, apartamento, unidade, ano, pedido, id…) | sai | "unidade 3523 4567", "apartamento 3523-4567", "ref 3000-2500" |

Por que "faixa crescente" exige os dois terminando em 00: sem isso, "casa 3523-4567" e "apartamento 3523-4567" (4567 >
3523) seriam faixa e o R1 voltaria a vazar.

Testes existentes alterados (justificativa):
- "QA r3 R1": "valor: 3523 4567" e "total 3523 4567" saíram da lista do que sai e foram para a do que fica (decisão da
  S4: rótulo de valor livra o par 4-4 de 2–5 sem palavra de telefone); no lugar, "valor: 9123 4567", "total 9123 4567"
  (6–9, celular) e "valor: fone 3523 4567" continuam saindo.
- "QA r3 (informativos)": a chave de acesso do teste tinha CNPJ do emitente inválido (12345678000199) — foi trocada por
  uma chave com CNPJ válido e DV certo; "chave de acesso"/"DANFE" + chave inválida agora saem inteiras (S1: o rótulo
  sozinho não isenta). "NF-e" + 44 dígitos colados continua intacto (um grupo só: a fase 1 não acha nada dentro).

- [AUTO-DECISION] "código" vira senha também com "otp" e "token" antes; "pin"/"otp" contam como palavra de senha.
- [AUTO-DECISION] Código de barras de 44 dígitos COM separadores não é reconhecido (não é barato validar sem abrir
  vazamento: só o DV geral de módulo 11 fecha 1 em 11 listas). Colado (o normal) já fica.
- [AUTO-DECISION] "IPTU" e "inscrição municipal" entraram nos rótulos de documento (fase 2b, só livram fixo de 2–5).

Tempos (sonda de desempenho do QA r4, 200 kB cada, depois das correções): "ag-…ag- at" 8 ms (era 20 s); "conta-…conta-
arroba" 5 ms (era 9,8 s); "1‑" 140 ms (era 946); "٩ " 75–153 ms (era 926); "1 " 38–146 ms (era ~900); o pior caso de todos
é "1|" com ~200 ms. Sonda de vazamento r4: nenhum caso vaza; só "protocolo 3523-4567 fone" fica (ver "Em aberto") e o caso "Compradores" sai vazio
(a busca da própria sonda não achou uma lista naquela faixa).

Em aberto (não bloqueia):
- "protocolo 3523-4567 fone": palavra de telefone DEPOIS do número não conta (a regra olha só ~50 caracteres antes).
- Estragos que restam por regra: 6–9 com qualquer rótulo ("lotes 7001 7002", "R$ 9123 4567", "matrícula 9123-4567",
  "protocolo 912345678"); 11 dígitos sem forma ("NIS 12345678901", "ticket 99991234567"); fixo de 10 dígitos com rótulo
  de valor ("valor 1234567890"); fixo sem rótulo logo antes ("cadastro 3523-4567", "chamado 3523-4567", "lote 25 quadra 7
  - 3523-4567", "processo administrativo 2026/3523-4567"); a linha digitável do exemplo do relatório
  ("23793.38128 60000.000003 00000.000400 …") tem os DVs dos campos 2 e 3 errados (o certo seria …000004 …000406),
  então a fase 1 vale e o 1º campo sai.
- Boleto de concessionária (48 dígitos, começa com 8) não é reconhecido.

## Correções da 5ª rodada do QA (16/11/2026, @dev Dex — QA r5 FAIL de Quinn, HEAD revisado `a90997d`)
Princípio mantido: a fase 1 mascara sem exceção; uma isenção da fase 2a só vale quando a FORMA ESCRITA também é a do
documento — nunca basta os dígitos fecharem.

| Achado | Correção | Commit | Teste |
|---|---|---|---|
| F1 (bloqueava) listas de telefones/CPFs passavam como NF-e/boleto quando os DVs fechavam por acaso | NF-e só em 44 colados ou 11×4 com o mesmo separador (" " ou "."); boleto com moeda 9, só em 47 colados, "5.5 5.6 5.6 1 14" com os pontos, ou "10 11 11 1 14" com o DV geral do código de barras remontado E os campos 2/3 sem forma de celular nem CPF válido (a sonda dirigida achava listas que fechavam até o DV geral); travas: palavra de telefone/contato/CPF nos ~50 caracteres antes, "(" ou "+" antes, parênteses/hífen entre os grupos, forma explícita de CPF ou telefone dentro do trecho | `7953fe1`, `61ca1cc` | "QA r5 F1" (os 3 repros, a lista sem rótulo, as 2 listas da sonda B, NF-e 11×4 uniforme fica, misturada/"contato"/"cpf" sai, DV geral errado sai) |
| F2 guias de arrecadação de 48 dígitos mascaradas em parte | reconhecidas na fase 2a: começam por 8, 3º dígito 6–9, "48", "12 12 12 12" ou "11-1 ×4" com separadores uniformes, DV de CADA bloco (módulo 10 se 6/7, módulo 11 se 8/9), com as travas da F1 | `f9af1c7` | "QA r5 F2" (1.600 guias válidas em 4 formas; DV errado; palavra de telefone antes) |
| F3 rótulo antes livrava o fixo com palavra de telefone depois | palavra de telefone nos ~25 caracteres depois (na mesma linha) cancela a isenção | `2265793` | "QA r5 F3" (8 que saem, 4 que ficam) |
| F4 janela que começa antes deixava a cauda | testa as janelas que começam dentro do achado e passam do fim; se a de dentro é fase 1 e a de antes não (ou a de antes começa num ano), fica só a de dentro; senão, sai a união | `db87b73` | "QA r5 F4" ("dia 15/11/2026 9123-4567" → data fica, telefone sai inteiro; CNPJ "12 74677693/2903-31") |
| F5 "conta 529 982 247 25" deixava 8 dígitos | PIX e banco passaram a rodar DEPOIS da fase 1 (as cadeias); a chave PIX em e-mail/uuid continua antes do filtro de e-mail. O fuzz achou a variante "cc 2026.12/889 767 151 95" (número de conta antes do CPF), também fechada | `8cc36b1`, `5fcfe60` | "QA r5 F5" (5 + 5 textos) e "QA r4 S5" (PIX com CPF/celular agora sai como dado pessoal) |
| F6 e-mail com nome acentuado | `[\p{L}\p{N}_.+-]` com a flag u (via `new RegExp`, o tsc recusa a flag em literal), mesma âncora (linear) | `83b55a4`, `0016800` | "QA r5 F6/F7" e o teste da âncora (agora "joão.silva+obra@…" sai inteiro) |
| F7 (barato) | CPF com zeros à esquerda num grupo só (12–14 dígitos, zeros + CPF válido); "(dot)com_" (fim do domínio por `(?![\p{L}\p{N}])`) | `83b55a4` | "QA r5 F6/F7" |

Medições (sondas do QA rodadas contra este código, cópias em `scratchpad/dex-r5`):
- FUZZ semente 12345 (300 mil): 257 vazamentos, TODOS "R$ …,cc" (exceção prevista); 0 parciais. Semente 777 (400 mil):
  335, todos "R$ …,cc"; 0 parciais. Zero vazamento de número inteiro fora da exceção.
- sonda-r5: A (busca dirigida NF-e, 50 mi) 0; A2 0 de 5 mi (celulares e CPFs); A3 0; B (lista de telefones com forma de
  boleto, 10 mi tentativas) 0 achadas; C NF-e reais ficam em 44, 11×4 com espaço/ponto; H todos saem.
- sonda-conc: guias geradas com DV válido pelo módulo certo: 0 de 20.000 mascaradas em cada uma das 4 formas. A sonda do
  QA (DV sempre módulo 10 e 3º dígito qualquer) ainda mascara ~27% — essas guias não são válidas (3º dígito 0–5, ou
  8/9 com DV módulo 10).
- Desempenho (126 casos de 200 kB das sondas r3/r4/r5): pior 405 ms; todos abaixo de 1 s.

Em aberto (não bloqueia):
- "R$ …,cc" com número de celular (exceção por desenho).
- Estrago novo por desenho: a NF-e em 4×11 ("chave 35261116425 70622…") e a linha digitável "10 11 11 1 14" cujo DV
  geral não fecha (ou com campo 2/3 com forma de celular) agora podem ter partes mascaradas — os boletos da sonda D sem
  pontos têm DV geral aleatório (5 de 10 com o 1º campo mascarado); com pontos ficam todos.
- Guias: o DV geral (4ª posição) não é conferido, só os 4 DVs de bloco.
- F8 (estragos com rótulo de documento antes de forma de celular) sem mudança.
- Marcador: CPF/celular depois de "pix" agora sai como "[dado pessoal omitido]" (antes "[dado bancário omitido]").

## Correções da 6ª rodada do QA (16/11/2026, @dev Dex — QA r6 FAIL de Quinn, HEAD revisado `4297b5a`)
Mudança de ESTRUTURA, não só de casos: a isenção de documento (fase 2a) exige TRÊS coisas ao mesmo tempo — rótulo do
documento nos ~60 caracteres antes (mesma linha ou a anterior), forma escrita canônica numa linha com separador uniforme,
e estrutura validada. Faltando uma, valem a fase 1 e a 2b. A rodada foi interrompida pela decisão do dono (opção B,
abaixo) com o código coerente e os testes passando.

| Achado | Correção | Commit | Teste |
|---|---|---|---|
| N1 (bloqueava) fixo antes da janela de dentro ficava à vista | ao passar para a janela forte, o trecho antes é varrido de novo; o pulo por ano só descarta o ano (os grupos pulados são varridos de novo antes de emitir) | `f62a17c`, `90ee516` | "QA r6 N1" (8 listas) e o fuzz |
| N2 (bloqueava) guia "11 1" aceitava listas de celulares/CPFs | rótulo de guia obrigatório; DV só com hífen ("-" ou " - "); blocos numa linha só; "comprador" é trava | `f62a17c` | "QA r6 N2–N5" e "QA r5 F2" (sem rótulo, espaço, ponto ou quebra de linha: não isenta) |
| N3 boleto "10 11 11 1 14" com 0+DDD e CNPJ | DV geral exigido em todas as formas; campos 2/3 não podem ser celular, CPF ou 0+DDD+número; campo 5 não pode ser CNPJ nem 000+CPF; "0"+DDD+número em 11 dígitos sai como dúvida (como na main) | `f62a17c`, `90ee516` | "QA r6 N2–N5" |
| N4 "Vizinhos: …" passava como NF-e | rótulo de NF-e obrigatório; UF da lista do IBGE; ano 06 até o ano que vem | `f62a17c` | "QA r6 N2–N5" |
| N5 (estrago) | linha digitável pontuada aceita uma quebra de linha no lugar de um espaço; NF-e 11×4 com 1–3 espaços uniformes | `f62a17c` | "QA r6 N2–N5" |
| F (rede de segurança) | teste de propriedade em `regras.test.ts`: 50 mil listas (semente fixa) de celulares, fixos, CPFs e CNPJs, com e sem rótulos; nenhum celular/CPF/CNPJ inteiro, fixo com palavra de telefone na linha sai, e nada que a main (copiada no teste) mascarava fica à vista. Achados do fuzz, fechados: 8 dígitos colados longe do rótulo (palavra de telefone vale na linha inteira), fixo "20xx" tomado por ano, par de anos e faixa "3800-6600" só quando isolados (faixa só com "entre/de/até" antes) | `90ee516` | "QA r6 F" (50 mil; mais 7 sementes × 200 mil à mão, 0 falhas) |

Estrago aceito (deixou de ser isento): documento SEM rótulo ("ver 3526 …", "pagar 2379…"); boleto com DV geral errado;
guia com espaço/ponto no lugar do hífen do DV ou com um bloco por linha; NF-e/boleto com separadores misturados.
Única exceção do fuzz contra a main, por desenho da fase 2b (r3/r4): fixo sem palavra de telefone logo depois de rótulo de
documento (lote, boleto, guia, IPTU).

## Decisão do dono em 16/11: dados pessoais liberados para a Dolores (opção B)
**O que muda.** CPF, CNPJ, telefone e e-mail no texto livre saem INTACTOS no que vai ao modelo (ponte HTTP da etapa 1 e
ferramentas do WhatsApp, que passam pela mesma `executarFuncao`) e na resposta ao dono. Com o filtro desligado, nenhuma das
fases 1/2a/2b roda: boleto, guia, nota, lote e valores também saem intactos; texto sem segredo volta idêntico.
**Interruptor.** `DOLORES_MASCARAR_DADOS_PESSOAIS`, lido num único ponto (`server/dolores/dados-pessoais.ts`, a cada
chamada): ausente, vazio ou "0" = liberado; "1" = volta a mascarar com o código completo (`sanitizarTexto(t,
{ mascararDadosPessoais: true })`, que é também o padrão da função pura — falha fechada).
**O que não muda.** Sempre mascarados, nos dois modos: senha, token, PIN, OTP, código de acesso, chave de API (`sk-ant-…`,
`sk-…`, `Bearer …`, JWT, AWS/GitHub/Slack), agência, conta e chave PIX. Sempre filtrados com o mascaramento LIGADO,
qualquer que seja a variável (`FILTRO_DO_REGISTRO`): `dolores_acoes` (argumentos e motivo), `dolores_mensagens.texto`,
`erroParaLog` (logs e motivo de erro); `remetente` e `dolores_remetentes_estranhos` seguem com o número mascarado; a tela
lê só essas colunas. A resposta continua indo só ao número do dono (conferência estrita).
**Como voltar atrás.** Vercel › Settings › Environment Variables → `DOLORES_MASCARAR_DADOS_PESSOAIS=1` → Redeploy. Para
liberar de novo: apagar a variável (ou "0") → Redeploy. Guia: `docs/dolores/como-ligar.md`.
**Em aberto (para o dono/coordenação decidirem).** (1) O prompt do sistema (`server/dolores/prompt.ts`, linha "Dados
pessoais: não repita CPF, telefone, e-mail…") ainda manda o modelo NÃO repetir esses dados. (2) Os campos estruturados
das leituras (`leitura/clientes.ts`, `financeiro.ts`, `regularizacoes.ts`: `mascararCpf`, `mascararTelefone`) continuam
mascarados. Enquanto os dois não mudarem, a opção B só vale para o texto livre. (3) Paridade: registrar no ROADMAP o porte
para o Grupo Santa Fé (que não tem a Dolores hoje).

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
- (a5) Automáticos depois da 4ª rodada do QA (16/11): `npx tsc --noEmit` sem erros; `npx vitest run server/dolores
  server/integracoes-anthropic.test.ts server/auth-session.test.ts server/imports-esm.test.ts server/api-rotas-producao.test.ts`
  — 12 arquivos, 202 testes passando; `regras.test.ts` 24 testes (+6 de regressão da r4). Sondas do QA r4: vazamento — 0 casos vazam;
  estrago — 79 de 103 ficam (eram 62); desempenho — todos os 200 kB abaixo de 250 ms.
- (a6) Automáticos depois da 5ª rodada do QA (16/11): `npx tsc --noEmit` sem erros; `npx vitest run server/dolores
  server/integracoes-anthropic.test.ts server/auth-session.test.ts server/imports-esm.test.ts server/api-rotas-producao.test.ts`
  — 12 arquivos, 208 testes passando; `regras.test.ts` 30 testes (+6 de regressão da r5). Fuzz e sondas: ver "Correções da 5ª rodada".
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
- 16/11/2026 — @qa (Quinn): r4 FAIL (S1 bloqueia: chave de NF-e pelo rótulo; S2–S6 menores).
- 16/11/2026 — @dev (Dex): decisão do filtro reorganizada em duas fases; S1–S5 e S6 corrigidos, um commit por achado,
  com teste de regressão. Volta ao portão de QA (InReview).
- 16/11/2026 — @qa (Quinn): r5 FAIL (F1 bloqueia: lista que fecha os DVs de NF-e/boleto; F2–F8 menores).
- 16/11/2026 — @dev (Dex): F1–F6 e F7 (parte barata) corrigidos, um commit por achado, com teste de regressão. Volta ao
  portão de QA (InReview).
- 16/11/2026 — @qa (Quinn): r6 FAIL (N1 e N2 bloqueiam; N3–N5 menores).
- 16/11/2026 — @dev (Dex): N1–N5 corrigidos com mudança de estrutura (rótulo + forma + estrutura) e fuzz de propriedade
  "nunca pior que a main"; rodada interrompida pela decisão do dono (opção B), código coerente e testes passando.
- 16/11/2026 — @dev (Dex): opção B do dono — interruptor `DOLORES_MASCARAR_DADOS_PESSOAIS` (padrão liberado); registro e
  log sempre filtrados. Em aberto: prompt do sistema e campos estruturados ainda mascaram (ver a seção da decisão).
