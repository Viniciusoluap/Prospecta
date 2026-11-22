# C5 — integração 2: avisos proativos (C5-E4) · criadora de mesas (C5-MESAS) · mesa comercial (C5-COM)

Ramo `epic027-c5int2`, a partir de `e8aec79` (pacote da Dolores: E3 + gasto por função + memória de longo prazo + correções do
portão, ver `C5-INTEGRACAO.md`). As três frentes nasceram de `527336e` (antes das correções do portão). Merges, nesta ordem:
`epic027-c5com` (já com a main/EPIC-028) → `epic027-c5mesas` → `epic027-c5pro` → `epic027-c5int` (correção do pedido do dono no grupo
acima de `MAX_PERGUNTA`) → `origin/main`. Nenhuma migração aplicada em banco (0150 e 0151 continuam pendentes no Neon, junto com 0148/0149).

## Conflitos reais → decisão
- `c5com`: merge limpo.
- `c5mesas` (10 arquivos): `funcoes.ts`, `ponte.ts`, `cerebro.ts` — dois mecanismos de "leitura só da conversa do dono" → UM só (abaixo).
  `acoes/registro.ts`, `permissoes.ts` (`LIBERADAS_ETAPA_7_MAQUETE` + `LIBERADAS_ETAPA_7_MESAS`), `confirmacao.ts` (`exigeConfirmoNoCodigo`
  vale para `gerar_link_maquete_lote` e `propor_aprovacao_mesa`; `motivoDoSerio` com os dois motivos), `voz.ts` (rótulos das duas):
  uniões. `RESERVA_MINIMA_ENTRADA`: as duas tinham subido para 17.000 → recalculado depois do último merge (abaixo). Listas fixas
  dos testes (`acoes`, `c5-e2-resolve`, `correcoes-e3`) unidas.
- `c5pro` (14 arquivos): `operacao-gasto.ts`, `rondas.ts`, `whatsapp.ts`, `consumo.ts` (sem conflito de texto, mas incompatível) —
  unificação do envio (abaixo). `drizzle.config.ts` (schemas `…-avisos` e `…-mesas`, nessa ordem), `testes-banco.ts` (0150 e 0151, cada
  uma 2×, nessa ordem, depois da 0149), `fila.ts` (verbos "troca/regenera" + "silenciar/avisar/religar": sem colisão — "troc" é só da
  maquete e "avis/silenci/relig" só dos avisos), `confirmacao.ts` (`silenciar_aviso` = registro), `permissoes.ts`
  (`LIBERADAS_ETAPA_7_AVISOS`), `prompt.ts` (as duas linhas), `DoloresOperacaoCard.tsx` (as duas seções), listas fixas dos testes: uniões.
  `rondas.ts`: o teste da C5-E4 procura `rondaERelatorioDoCron` → o nome da função da ronda ficou esse.
- `server/_core/trpc.ts` continua SEM `"dolores.grupos.definirTipo"`. `vercel.json`: 10 crons existentes + 5 da tarde = **15**.
- `shared/funcoes-anthropic.ts`: linha própria `dolores_avisos`; a chave continua lida só em `resolverCredencialIA` e `bloqueioAtual`
  (`credencialDosAvisos` passa por `bloqueioAtual`), vigiado por `integracoes-anthropic.test.ts`.

## Mecanismo único de leitura só do dono
- `funcoes.ts#LEITURAS_DO_DONO` é o ÚNICO lugar: `listar_mesas`, `consultar_maquete_lote`, `listar_maquetes_lotes`, `rascunhar_mensagem_lote`,
  todas com `soConversaDoDono: true` e FORA de `FUNCOES` (o mais restritivo dos dois: nada que liste `FUNCOES` — ponte HTTP, grupo
  administrativo de `marcacao.ts`, catálogos — as vê). `leituraPorNome` (FUNCOES + só do dono) para a porta e a contaminação.
- `ponte.ts#executarFuncao`: a recusa (403, "só na conversa direta do dono") vem ANTES de olhar a etapa, para qualquer canal que não seja
  o WhatsApp do dono com a mensagem dele. `ferramentasLiberadas` (ponte) sem elas; `ferramentasDaConversa` = ponte + só do dono
  (`leiturasDoWhatsapp` da frente das mesas foi removida). A segunda trava da maquete (a própria leitura recusa canal grupo/cliente/ponte) ficou.
- Grupos (internos, cliente, parceiros), atendimento ao cliente e o pedido do dono no grupo (E3) usam listas próprias, sem elas (teste).

## Unificação do envio de avisos ao dono
- **Proposta aberta**: a C5-E4 tinha a sua consulta (`propostaEsperando`: aberta + adjacente + no prazo). Agora é `pendencia.ts#podeEnviarAvisoAgora`
  (o ponto único do portão, que também segura a pergunta ainda saindo), conferida antes da vaga E de novo logo antes do envio (a IA pode
  levar segundos); se a proposta nasceu no meio, a vaga é devolvida (não conta no teto de 6) e nada sai.
- **Alerta de gasto**: um caminho só, `operacao-gasto.ts#enviarAlertasPendentes` (pendente → envio no fim do webhook e nos crons, com prazo).
  A versão da C5-E4 do `conferirAlertasDoGasto` (registrar e enviar no meio do laço) foi descartada; o silêncio do tipo "gasto" foi
  reaplicado nos DOIS passos: `registrarAlertasDevidos` não registra o 80% com o tipo silenciado; `enviarAlertasPendentes` segura o 80%
  registrado antes do silêncio; o 100% sai sempre (e leva o 80% junto). O cron da tarde (`tratarCronAvisos`) também envia os alertas
  pendentes, ANTES dos avisos (os dois crons: alertas → avisos). O aviso proativo não tem tipo "gasto" na coleta (não duplica).
- **Gasto dos avisos**: `reservarAvisos` agora passa pela mesma `conferirTerceiro` do portão (M1): total comprometido (uso real + reservas
  das mensagens do dono + reservas de classificação/marcação/atendimento + esta) ≤ limite; depois folga do dono e a parte "avisos" (5%).
  ~~Limite conhecido: o aviso não grava reserva~~ — corrigido em 22/11/2026 (ver "Correções do revisor do PR #298", abaixo).
- A IA dos avisos continua sem ferramentas e sem histórico: a memória de longo prazo não entra (teste).

## Piso × prefixo medido e custo extra
Medido com a estimativa por cima do código (`memoria.ts#tokensEstimadosDoTexto`; o tokenizador real costuma dar menos):

| | antes (e8aec79) | agora, pior caso (com ações de mesa) | agora, mensagem com ação comum | agora, só leitura |
|---|---|---|---|---|
| texto do sistema | 2.121 | 2.474 | 2.474 | 2.474 |
| ferramentas | 11.177 (32) | 14.527 (42) | 12.965 (38) | 6.776 (21; antes 5.676, 17) |
| prefixo | 13.298 | **17.001** | 15.439 | 9.250 (antes 7.797) |

- Piso `RESERVA_MINIMA_ENTRADA` 17.000 → **19.000** (pior caso 17.001 + 500 da API = 17.501; folga ~1,5 mil). Conferido pelos testes de piso
  de `c5-e1-memoria`, `c5-mesas` e `c5-mesa-comercial` (que medem o pior caso).
- Redução sem perder trava: as 4 AÇÕES de mesa (≈ 1,56 mil tokens) só são oferecidas ao modelo quando a mensagem do dono pede mesa por
  código (`intencaoDeMesa`, sem colagem e sem anexo) — o mesmo `pedidoDeMesa` sem o qual a porta já as recusava. `listar_mesas` e as leituras
  da maquete ficaram sempre (leitura com busca livre, ex.: só o nome do empreendimento; cortar perderia resposta). `silenciar_aviso` ficou
  sempre (o pedido "não quero mais saber de…" não tem palavra fixa). Nenhuma descrição que seja trava foi encurtada.
- O texto do sistema ficou abaixo do teto de 6.500 caracteres do teste da voz encurtando as linhas novas das mesas e dos avisos (2.526 → 2.474).
- Custo extra de entrada fixa por CHAMADA ao modelo (cada mensagem do dono faz de 1 a 7): +2.141 tokens (mensagem com ação comum), +3.703
  (pedido de mesa), +1.453 (só leitura). Ao preço de referência de um modelo médio (US$ 3/MTok de entrada; leitura de cache US$ 0,30;
  escrita de cache US$ 3,75), na mensagem com ação comum: sem cache ≈ US$ 0,0064 a mais por chamada; lida do cache (2ª volta em diante e
  mensagens seguidas em até 5 min) ≈ US$ 0,0006; a chamada que escreve o cache ≈ US$ 0,0080. Ex.: 50 mensagens/dia × 2 chamadas, metade
  pelo cache → ≈ US$ 0,35/dia ≈ US$ 10/mês a mais. Trocar de lista (só leitura ↔ com ações ↔ com mesa) refaz o cache do prefixo daquela chamada.

## Testes cruzados (`server/dolores/c5-integracao2.test.ts`, 13)
- Aviso proativo espera com proposta de MESA aberta e com proposta de LINK DA MAQUETE aberta (webhook de verdade); decidida, sai; o "pode"
  continua valendo. Proposta aberta enquanto a IA redigia → nada sai e a vaga é devolvida.
- Leituras só do dono: as 4 em `LEITURAS_DO_DONO`, com a marca, fora de `FUNCOES` e da ponte; 403 na ponte e no WhatsApp sem mensagem;
  fora de grupos internos/cliente/parceiros, do atendimento e do fluxo E3 (`grupo-pedido-dono.ts` nem usa a porta); ações de mesa só com o
  pedido de mesa.
- Memória de longo prazo fora do pedido à IA dos avisos e do texto enviado.
- Custo: avisos em "avisos"; mesas e maquete (conversa do dono) em "conversa".
- Alerta de gasto: um só, por um caminho, com cron da tarde, da manhã e envio direto; espera com proposta aberta junto com o aviso; "gasto"
  silenciado segura o 80% (antes ou depois do silêncio) e o 100% sai uma vez.

## Teste intermitente (`acoes.test.ts` › "as quatro ações da etapa 3…")
Não reproduzido em 3 tentativas: 2 rodadas com 12 arquivos em paralelo (`--maxWorkers=4`, máquina com carga ~20: 276/276 cada) + a
1ª metade da suíte (inclui `acoes.test.ts`). Análise da causa: as três asserções que podem dar "expected true to be false" nesse teste
(`funcaoLiberada` de uma proibida, `ACOES.some` de uma proibida, regex de nome de ferramenta perigosa) só leem listas fixas de módulo
(`permissoes.ts`, `acoes/registro.ts`, `ponte.ts`), sem banco, relógio, ambiente nem estado mutável; o vitest isola os módulos por arquivo
(`isolate` padrão; `vitest.config.ts` não muda) e nenhum teste grava arquivo do código. Não há estado compartilhado entre arquivos que
explique a falha; a hipótese mais provável é o arquivo ter sido lido no meio de uma edição da própria frente (`registro.ts`/listas
fixas mudando enquanto o vitest rodava — aconteceu igual nesta integração, com `correcoes-e3`, quando um merge correu durante uma rodada).
Nada corrigido (sem causa no código); fica registrado.

## Números
- `npx tsc --noEmit` limpo (antes e depois do merge da `origin/main`); `npx vite build` ok.
- Suíte em duas metades (vitest `--maxWorkers=2 --minWorkers=1`), no código integrado (antes do merge da main — que não mudou a árvore:
  a main tinha a mesma árvore de `epic027-c5int`, já mesclada):
  - `server/dolores/[a-e]*`: **45 arquivos, 774 testes, todos verdes** (2.264 s);
  - `server/dolores/[f-z]*` + `integracoes-anthropic`, `integracoes-modelo-por-funcao`, `admin-permissions`, `operacional`,
    `maquete-3d-lote-publico`, `api-rotas-producao`: **34 arquivos, 669 testes, todos verdes** (1.294 s).
- Ajustes de teste pela integração: `c5-mesa-comercial` e `c5-e1-voz` (leituras só do dono agora fora de `FUNCOES`); `c5-e4-proatividade`
  (o alerta de 100% da parte "avisos" sai no fim do aviso do WhatsApp, pelo caminho único, uma vez); listas fixas unidas.
- `vercel.json`: 15 crons. Migrações 0145–0151 todas no repositório; 0150/0151 aplicadas 2× no banco de teste, depois da 0149.

## Depois do portão de QA (PASS em `14262c0` + `05bebf2`): REURB da main e tarefa demorada
### Merge da `origin/main` (análise de REURB, #296) — `ada9e61`
- Conflitos em `cerebro.ts`, `funcoes.ts`, `permissoes.ts`, `ponte.ts`: a REURB trazia um segundo mecanismo (`FUNCOES_DO_DONO`,
  `ferramentasDaConversaDoDono`, `funcaoPorNome` olhando as duas listas). Decisão: UM mecanismo só (o desta integração) —
  `analisar_regularizacao_reurb` entrou em `LEITURAS_DO_DONO` (`soConversaDoDono`, fora de `FUNCOES`); `funcaoPorNome` volta a ver só
  `FUNCOES`, `leituraPorNome` vê as duas; uma recusa 403 na porta, antes da etapa (a 2ª checagem da REURB, igual, saiu); a segunda trava
  da própria leitura (`leitura/reurb.ts`, canal ≠ whatsapp) ficou; `analisouReurb` + `comAvisoReurb` no retorno de `cerebro.ts`;
  `LIBERADAS_ETAPA_7_REURB` na etapa 7; rótulo e aviso em `shared/dolores/voz.ts`/`whatsapp.ts` sem mudança; a REURB continua oferecida
  com e sem intenção de ação. `c5-reurb.test.ts`: só os nomes (`leituraPorNome`, `ferramentasDaConversa`); `c5-integracao2`: a lista
  das só do dono ganhou a REURB.
- Prefixo, pior caso: 2.474 + 14.809 = **17.283** (+500 = 17.783) → piso **19.000 mantido** (folga ~1,2 mil).
- Suíte nesse ponto: `server/dolores/[a-e]*` **48 arquivos / 826 testes** e `[f-z]*` + `integracoes-anthropic` **29 / 574**, todos verdes.

### Merge de `epic027-c5longa` (tarefa demorada sem travar a conversa) — `eece74d`
- `drizzle.config.ts` (schema das tarefas depois das mesas) e `testes-banco.ts` (0153, 2×, depois da 0151): uniões.
- `cerebro.ts`: `comAcoes` = `!somenteLeitura && !ehPedidoDeRelatorio && (… || pedido de mesa …)`; `abreMesa` também exige
  `!somenteLeitura` → a retomada não oferece NENHUMA ação (nem `propor_aprovacao_mesa`, `gerar_link_maquete_lote`, `silenciar_aviso`) e a
  porta recusa (`semAcoes`); as leituras só do dono (REURB, mesas, maquete) entram, executadas com canal "whatsapp" e o `mensagemId` da
  mensagem do dono guardada na tarefa. Retorno com `respondeu`, `anexos` e o aviso da REURB.
- `tarefa-demorada.ts`: o link/rascunho da maquete (`anexos`) vai intacto no quadro, antes do `FECHO_DA_TAREFA`.
- `whatsapp.ts`: `credencialDosAvisos` e `retomarTarefasDemoradas` juntas; no fim do webhook, os alertas pendentes (dentro de
  `tratarAvisoDaInstancia`) e só depois a retomada. Resultado da tarefa e aviso proativo conferem `podeEnviarAvisoAgora`.
- `rondas.ts`: cron da manhã = ronda/relatório → alertas pendentes → retomada da tarefa → avisos proativos. `vercel.json`: 15 crons.
- Prefixo: a tarefa não acrescenta ferramenta nem texto do sistema → 17.283, piso 19.000.
- Testes novos em `c5-integracao2.test.ts` (+3, total 16): retomada só leitura com pedido cheio de verbos de ação — nenhuma ação oferecida,
  as três ações recusadas pela porta, nada na fila/proposta/link/silêncio, a leitura da maquete executada (canal whatsapp) e o link no
  quadro + fecho; parecer de REURB por tarefa com o aviso da REURB e o fecho; proposta aberta segura a tarefa e o aviso; no cron, a ordem
  alerta → tarefa → aviso, cada um uma vez.
- Suíte em `eece74d` (vitest `--maxWorkers=2 --minWorkers=1`): `server/dolores/[a-e]*` **50 arquivos / 877 testes** e `server/dolores/[f-z]*` + `integracoes-anthropic` **29 / 574**, todos verdes. `npx tsc --noEmit` limpo; `npx vite build` ok. Prefixo re-medido: 17.283 (+500), piso 19.000 (folga ~1,2 mil).

## Pendências
- Portão de QA de segurança (@qa) do pacote integrado antes da `main` (regra da Dolores de 16/11).
- Na publicação: aplicar 0148, 0149, 0150, 0151, 0153 e **0160** no Neon (aditivas); conferir os 15 crons no painel da Vercel e `PUBLIC_SITE_URL`.

## Correções do revisor do PR #298 (22/11/2026, @dev Dex)

### 1. Tarefa demorada sem aviso da Evolution — nunca vence sem ter sido tentada (`server/dolores/tarefa-demorada.ts`)
Problema: validade fixa de 30 min, o cron da manhã de hora em hora e a manutenção de vencimento antes de pegar trabalho — tarefa das
07:05 já estava vencida no cron das 08:00; depois das 14h os crons da tarde não retomavam.
- (a) **Todo cron autenticado da Dolores retoma**: a rotina 07h–14h (já fazia) e agora também `tratarCronAvisos` (15h–19h), na mesma
  ordem: alertas de gasto → retomada → avisos proativos. Nenhum cron novo (`vercel.json` continua com 15).
- (b) **Validade conta a partir da tentativa, com teto para a nunca tentada**: ao criar, `expira_em` = a 2ª chamada de cron depois da
  criação + 1 h (`validadeSemTentativa`; as horas vêm de `CRON_DOLORES_AGENDAS` + `CRON_AVISOS_AGENDAS`, `HORAS_DA_RETOMADA` = 07h–19h;
  a folga de 1 h cobre o cron da Vercel saindo em qualquer minuto da hora). Na 1ª reivindicação, `expira_em` = o maior entre o de antes e
  agora + 30 min (nunca encurta). Exemplos: 07:05 → até 10:00; 15:10 → até 18:00; 18:30 → até 08:00 do dia seguinte; 20:30 → até 09:00.
- (c) **Noite**: [AUTO-DECISION] a tarefa É criada (o dono costuma continuar a conversa, e cada aviso da Evolution retoma) e a resposta
  imediata diz quando chega: com o próximo cron a mais de 2 h, "Vou levantar isso e te mando assim que eu conseguir: se você me escrever
  de novo, termino em seguida; senão, sai a partir das 7h." (`fraseVouLevantar`, por código, pelo relógio). Durante o dia, "te mando em
  seguida", como antes. (Alternativa descartada: não criar e cair em FRASE_SEM_TAREFA — o dono perderia o levantamento à noite.)
- A reivindicação agora exige a MESMA contagem de tentativas lida (`eq(tentativas)`), além de "aguardando": continua idempotente.

### 2. Reserva do aviso proativo gravada (`server/dolores/consumo.ts`, `server/dolores/avisos.ts`, migração 0160)
Problema: `reservarAvisos` só conferia; a chamada em voo não era vista por outra conferência concorrente até o consumo real.
- `drizzle/0160_dolores_avisos_reserva.sql` (nova, **só aditiva e idempotente**: 3 × `ADD COLUMN IF NOT EXISTS` em `dolores_avisos_envios`
  — `reserva_entrada`, `reserva_saida`, `reserva_ate`). Número 0160 porque a faixa 0154–0159 pode estar em uso pela frente fiscal. Por que
  migração: nenhuma tabela de reservas existente serve ao aviso sem misturar conceitos (as de mensagens do dono, grupos, marcações e
  atendimentos são da própria chamada de cada um); a vaga do aviso já existe antes da chamada da IA, então a reserva fica nela, no mesmo
  formato das outras.
- `reservarAvisos({ …, envioId, validadeMs })`: cabendo, grava a reserva na vaga (sob a mesma trava). `conferirTerceiro` soma as reservas
  de avisos em voo no total comprometido de TODO terceiro (e na parte "avisos"); `reservarChamada` (conversa do dono) também as soma.
  A regra "uma chamada de terceiros por vez" dos grupos/clientes não muda (o aviso só entra nos totais).
- `avisos.ts#textoPelaIA`: `try/finally` — registra o consumo real e só então solta (`liberarReservaAvisos`); na falha da IA, solta
  também. Vence sozinha em `VALIDADE_RESERVA_AVISO_MS` (30 s) se a função morrer. Sem a 0160, confere a coluna e segue como antes.
- Banco de teste: 0160 aplicada 2× depois da 0153 (`testes-banco.ts`).

### Testes
(a) Automáticos — `npx tsc --noEmit` limpo. Novos: `c5-tarefa-demorada.test.ts` (+7: horas dos crons e 15 crons; 07:05 sem aviso →
resolvida no cron das 08:00; cron das 08:00 sem tentar (pausa) → o das 09:00 resolve; 15:10 → retomada pelo cron da tarde das 16:00;
20:30 → frase "a partir das 7h", validade até 09:00 e o cron das 07:00 resolve; 18:30 → "em seguida" e validade até a manhã; a 1ª
tentativa estende a validade e a 2ª ainda cabe) e o teste de validade ajustado; `c5-integracao2-qa.test.ts` (+5: 0160 só aditiva;
aviso em voo com a reserva gravada e a conversa concorrente barrada por ela, soltura depois do consumo real; soltura na falha da IA;
outro aviso concorrente vê a reserva, liberada cabe, vencida não conta; total comprometido de terceiros; sem a 0160 nada quebra).
Rodados (vitest `--maxWorkers=2 --minWorkers=1`): `c5-tarefa-demorada` 31/31 e `c5-integracao2-qa` 25/25; vizinhos `c5-tarefa-demorada-qa`,
`c5-e4-proatividade`, `c5-integracao2`, `c5-integracao-qa`, `c5-e5-gasto-por-funcao`, `whatsapp`, `operacao-qa-seguranca`,
`c4-horario-relatorio`: 8 arquivos, 173/173. Suíte inteira não rodada.
(b) Manuais: nenhum. (c) Produção: aplicar a 0160 no Neon antes/junto da publicação; conferir um pedido longo à noite (frase das 7h).
