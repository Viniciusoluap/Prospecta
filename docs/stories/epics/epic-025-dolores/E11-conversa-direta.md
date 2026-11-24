# E11 — Conversa direta: ordem do dono é para agir (23/11/2026)

**Status:** InReview (implementado; falta o portão de QA e a validação na conversa real)
**Origem:** reclamação do dono em 23/11/2026 — "parece um robô com defeito… quero uma assistente pessoal inteligente e rápida,
que entenda o contexto, aja e confirme operações com convicção, com autonomia; não criar comandos". Estrutura E11 autorizada por ele.
**Escopo:** só o Prospecta (a Dolores é exceção de paridade registrada no ROADMAP).

## O que aconteceu (conversa real, resumida) e a causa confirmada no código

| # | Sintoma | Causa real (código) |
|---|---------|---------------------|
| 1 | "Grupo AA7W aceitar" → aceito, mas pergunta o tipo e pede «1 <nº do cliente no CRM>» | `descobrirTipoDoGrupo` (shared/dolores/grupos-tipo.ts) só liga quando o nome **inteiro** do cliente está no nome do grupo. "MARIA DAYANE OBRA PROSPECTA IMP" não contém "Maria Dayane Silva Sousa" → `indefinido`. O `aceitar` (grupos-decisao.ts) não tentava ligar de novo e `textoDasOpcoes` pedia o nº do CRM. |
| 2 | "Grupo AA7W 1" → a IA: "não encontrei nenhum grupo com o código AA7W… números de 1 a 9" | `lerDecisaoDeGrupo` exigia o nº do cliente para a opção 1 → `null` → a mensagem foi para a IA. A IA não tinha como achar o código: `listar_grupos` não devolvia o código (só `grupoId` 1…9) e a memória da conversa troca todo código real por "(código)" (`semCodigosReais`). |
| 3 | "Maria dayane" → a IA acha a cliente e pergunta "1 ou 6?"; "1" → "Vou ligar… responda pode" e nada acontece | "Maria dayane" não tem verbo de ação (`intencaoDeAcao`) → o laço não oferece ação: a IA só podia falar. "1" sozinho também não valia (`lerRespostaNumerada` exigia o nº) e, sem verbo, de novo sem ação: o "vou ligar" do modelo era só texto. |
| 4 | "Vamos vincular o grupo da Emily" → "1" → "Pode" → a IA: "entendi o pode… confirme de novo" + "Posso fazer isto? • Pedido surgido durante a leitura de dados…" | (a) No laço do WhatsApp **toda** ação vai para a fila (`exigirConfirmacao: true`, cerebro.ts) e espera o "pode"; (b) o "Pode" não achou proposta aberta (a do passo anterior nem existia, pelo item 3) → foi para a IA, que só então chamou `classificar_grupo` → **nova** proposta → a pergunta do sistema; (c) o turno nasce "contaminado" sempre que há histórico (`contaminado = true` com qualquer item do histórico), e o resumo ganha "Pedido surgido durante a leitura de dados" (`prefixoDaFila`). Resultado: duas perguntas para a mesma ação. |
| 5 | "O grupo da maria Dayane pode", "Grupo da emily pode" → nada ligado | `lerConfirmacao` só aceita a mensagem INTEIRA de uma lista fechada ("pode", "sim"…). Com o nome junto, foi para a IA, que abriu outra proposta — e a proposta nova **substitui** a anterior (índice único de uma aberta). |
| 6 | Lista de pendências repetida a cada resposta; "o sistema vai mostrar o resumo logo abaixo" | O texto do sistema (prompt.ts) mandava a IA "dizer o que vai fazer; logo abaixo o sistema mostra…", e o aviso da porta (ponte.ts) repetia isso; nada proibia repetir as pendências. |

## Desenho (o que mudou)

1. **Ordem direta = confirmação (reversível de grupo).** Nova opção `ordemDireta` na porta (`server/dolores/ponte.ts`): o laço passa as
   palavras que o dono digitou (cerebro.ts → `palavrasDoDonoParaOrdem`). Se a função e os argumentos estão na lista fechada
   (`podeExecutarPorOrdemDireta`: classificar grupo com tipo simples — cliente, pós, engenharia, inclusive troca —, ignorar grupo,
   aceitar grupo **só com o código digitado**, **desligar** a resposta) e o servidor prova os alvos (`provarAlvosDoDono`), o item é
   montado na fila como sempre (resumo exato + hash) e **decidido na hora** por `decidir` (pausa, usuária, revalidação, conferência,
   auditoria). A resposta ao dono é uma linha do SISTEMA: "Feito: … Se algo estiver errado, me diga que eu corrijo."
2. **"confirmo" só no sério, uma vez.** `confirmacao.ts` não mudou: nota fiscal (`exigeConfirmoNoCodigo`), cobrança, conciliação,
   mesa, link da maquete, tipos que liberam mais, aceitar grupo sem o código, **ligar** a resposta → continuam com a pergunta do
   sistema. A IA não pede mais "pode" ela mesma (prompt + aviso da porta): uma pergunta só, a do sistema.
3. **Uma memória só.** `listar_grupos` devolve o `codigo` (o mesmo que o sistema manda nos avisos) e o nome do WhatsApp. "grupo
   AA7W 1"/"grupo AA7W cliente"/"1" sem nº valem por código. "o grupo da Emily pode", "pode o da Maria", "pode todos" são resolvidos
   por CÓDIGO (`lerConfirmacaoNomeada` + `tratarConfirmacaoNomeada`) contra os itens que esperam e cuja pergunta ele já recebeu
   (proposta aberta OU substituída). "Pode" solto depois de ele pedir algo e a IA só perguntar: as palavras dele dos últimos 15 min
   valem para provar os alvos (só mensagens que ELE digitou, origem "mensagem").
4. **Grupos sozinhos.** `descobrirTipoDoGrupo` ganhou o 2º nível: nome + primeiro sobrenome de UM cliente com 3+ palavras, juntos
   e na ordem (`clientesPeloNomeESobrenome`). Vale na entrada, logo depois de "grupo CÓDIGO aceitar" e em "grupo CÓDIGO 1"/"1".
   Mais de um cliente → UMA pergunta com os NOMES (`perguntaDoCliente`); a resposta só com o nome liga (`decidirPeloNome`). Nunca
   pede o nº do CRM.
5. **Respostas curtas.** Prompt: "ordem dele é para agir", "não repita a lista de pendências se ele não pediu", nunca "o sistema
   vai mostrar". O aviso da porta ao modelo diz o mesmo.
6. **Iniciativa.** Prompt: "Resolva o que puder sem perguntar e conte depois." (os caminhos por código acima fazem sem perguntar).

## Como a segurança é garantida por CÓDIGO (não pelo modelo)

- **Quem comanda:** só chega à porta mensagem do número do dono, conversa direta, não encaminhada (whatsapp.ts — intacto). A
  ordem direta só existe com `canal = "whatsapp"`, intenção de ação por código, **sem colagem, sem anexo** e fora da retomada em
  segundo plano (cerebro.ts).
- **Intenção:** a mensagem dele precisa ter o verbo DA FUNÇÃO (`intencaoDaFuncao`: vincular/ligar/classificar para classificar;
  ignorar/deixar de lado para ignorar; desligar para a resposta; aceitar). "cria uma tarefa sobre o grupo da Emily" nunca vira
  "ignorar o grupo da Emily".
- **Alvos:** grupo = código citado OU as palavras dele apontam UM só grupo da instância pelo nome (desde o portão 2:
  `unicoComPonto` — nenhum outro grupo com ponto; palavras genéricas como "grupo", "obra", "prospecta" não contam). Cliente = "cliente N"/"nº N"
  escrito, OU as palavras dele apontam UM cliente ativo, OU (só se as palavras dele não apontaram outro) o ÚNICO cliente que o nome
  do grupo aponta pela regra do dono de 19/11. Tipo = o que ele disse (engenharia só com "engenharia"; pós só com "pós").
- **Texto de terceiro** (nome de grupo, nome de cliente): na 1ª versão o texto dizia que ele "só cria empate" — ERRADO (o portão 2
  mostrou que um cadastro com mais palavras da frase vencia o melhor-placar). Desde o portão 2, qualquer outro candidato com ponto
  torna a prova falsa: um grupo copiado ou um cliente "EMILY MANDOU" faz a ação voltar para a confirmação/pergunta.
- **Execução:** a mesma da fila (`decidir`): item gravado com resumo + hash, revalidação dos argumentos, `executarAprovado`
  (`decidirGrupo` com o gatilho 0133), auditoria em `dolores_acoes` com `nivel: ordem_direta`.
- **Intactos:** interruptores (IA, resposta em grupo geral e por grupo, só quando marcada), tetos de gasto e de ações por comando,
  filtros de saída e mascaramentos, aceitar grupo de terceiro só pelo dono, `exigeConfirmoNoCodigo` para nota fiscal.


## Portão de QA E11 (commit 8ae99b9 → FAIL) — correções aplicadas

| Achado | Correção |
|---|---|
| I1 — par grupo↔cliente sem conferência | O cliente só é provado por: (a) "cliente N"/"nº N" escrito; (b) o ÚNICO cliente que o nome do grupo aponta (grupo de terceiro: só o nome inteiro); (c) as palavras que escolheram o grupo estão no nome do cliente, apontam UM cliente só, e nenhum outro cliente pontua com as palavras dele que estão fora do nome do grupo. Caiu a regra "as palavras dele apontam um cliente" sozinha. |
| I1b — janela de 15 min | Removida: verbo e alvos saem da MESMA mensagem. "pode"/"sim" soltos nunca são ordem direta: confirmam só o que o sistema perguntou. |
| I2 — troca por ordem direta | `preparadoPodeIrDireto`: classificar só com `troca === false` (montado pelo servidor). Troca de cliente/tipo vai para UMA confirmação com "hoje: …". **O dono listou "inclusive troca"; a segurança prevaleceu (decisão do portão de QA, 23/11).** |
| M1 — negação | `negaAcao`: "não/nem/nunca/jamais/sem" até 3 palavras antes do verbo → sem ordem direta (cerebro.ts e `intencaoDaFuncao`). |
| M2 — resposta no grupo ligada calada | Mantido o comportamento que já existia para grupo confirmado pelo dono (interruptor do grupo nasce ligado; o geral continua valendo por cima; ela só fala quando marcada — regras de 17/11 e 19/11). A linha agora diz: "Lá eu só respondo quando me marcarem." |
| M3 — grupo de terceiro ligado pelo nome | Grupo em que outra pessoa (ou não se sabe quem) pôs a Dolores: depois do "aceitar" (e em "grupo X 1"), o nome só SUGERE — UMA pergunta do sistema ("Pelo nome, ele parece ser de «…». Posso fazer isto?"), confirmada com "sim"/"pode". Na entrada, o nível nome + sobrenome vale só para grupo do dono. Na ordem direta, a regra (b) usa só o nome inteiro para grupo de terceiro. |
| M4 — "confirmo todos" | "todos" só para itens de REGISTRO da proposta ABERTA; item sério só pelo "confirmo" da proposta aberta (ou nomeado nela); sério de proposta substituída nunca (inclui nota fiscal). |
| B2 — corte em 300 | `clientesPelasPalavras` devolve `cortado`; passou do teto → ambíguo. |
| B1/B3 | Registrados (sem mudança de código nesta rodada; ver relatório do QA). |
| Qualidade — dois grupos numa mensagem | O grupo é provado pelas palavras dele que estão no nome DAQUELE grupo (cada par em separado). |
| Qualidade — "desfaz" | Por código: diz em UMA linha como desfazer a última ação feita pelo WhatsApp nos últimos 15 min (não reverte sozinha: voltar um vínculo pede o cliente certo, e "ignorar" desliga tudo). |


## Portão de segurança E11 — 2ª rodada (sobre 94febb2 → FAIL) — correções

Princípio combinado: na dúvida, a ordem direta NÃO executa e cai na confirmação de sempre.

| Achado | Correção |
|---|---|
| I-A — `textoSaiuDoDono` ignorava palavras curtas, números e moldura | Agora TODA palavra do texto gravado (normalizada; curtas, números exatos e moldura incluídos) está na mensagem do dono, na MESMA ORDEM (subsequência); negação no texto que ele não escreveu → não saiu dele. Vale para título, descrição, anotação, lembrança e correção. |
| I-B — verbo/código/alvos olhavam a mensagem inteira | (Revisto no ajuste antes da 3ª revisão — ver abaixo.) Com qualquer marca de citação (aspas, ":" seguido de texto, ">", quebra de linha — `trechoDoDono`), a mensagem INTEIRA deixa de ser ordem direta. Decisão: o texto ditado depois de ":" não serve nem como conteúdo (o mais seguro); vai para a confirmação. |
| M-A — pergunta e negação viravam ação | `bloqueiaOrdemDireta`: "?" em qualquer ponto, ou não/nem/nunca/jamais em qualquer posição, ou "sem" antes do verbo → sem ordem direta. Efeito colateral aceito: "não esquece que…" (memória) vai para a confirmação. |
| M-B — direção do aviso ("para eu…") | Verbos explícitos ("para/pare/parar de [me] avisar", "silencia", "deixa de me avisar"; "volta a me avisar", "religa"); as duas direções na mesma mensagem → confirmação. |
| M-C — cadastro de terceiro com mais palavras da frase vencia | A PROVA usa `unicoComPonto`: o alvo só é provado se NENHUM outro candidato pontua com as palavras dele (outro com ponto → pergunta com os nomes). Vale para cliente, responsável, obra, lembrança, tipo de aviso, grupo, o par grupo↔cliente e a confirmação nomeada. `escolherPorNome` fica só para sugerir. (Corrigido o texto antigo de que um terceiro "só cria empate": com o melhor-placar ele podia vencer.) Efeito: com duas "Marias" no CRM, "ligar para a Maria Trello" pergunta qual. |
| M-D — vincular nasce com `responderLigado: true` | Mantido (comportamento já em produção para grupo posto pelo dono; o interruptor GERAL continua por cima e nasce desligado). Teste novo confere: interruptor do grupo ligado + geral desligado → o envio exige os dois. **Decisão pendente do dono:** se o grupo vinculado pela conversa deve nascer com a resposta desligada. |
| B-a — prazo e prioridade inventados | Prazo só se ele disse quando (hoje, amanhã, dia da semana, data, hora); prioridade diferente de "média" só com "urgente/importante/prioridade alta/sem pressa". Senão → confirmação. |
| B-b — chamada repetida no mesmo turno | A mesma chamada (mesmo alvo e mesmos argumentos) já executada neste pedido não vira outra entrada nem outro "Feito"; frases "executado" (sem conteúdo) saem da linha; frases repetidas não se repetem. |
| B-c — nomes na memória da conversa no turno seguinte | Só registrado: a linha "Feito" (com nomes do cadastro) entra na memória da conversa como texto do sistema; o turno seguinte nasce contaminado como antes (histórico contamina). |
| B-d — story | Contagens e o texto do empate corrigidos. |

Testes: `e11-conversa-direta.test.ts` com 55 testes, incluindo as regressões A1, A2, A3, A4, A5, A6, A9, A10, B3, B-a, M-D e a
propriedade restaurada ("texto proposto depois de leitura com palavra curta/número/moldura/negação vinda do modelo nunca grava sem o
pode"). Roteiros legítimos continuam em uma mensagem: tarefa da Bianca (para o João — com duas Marias no CRM ela pergunta qual),
anotação da Emily, lembrança do Henrique, parar e voltar aviso, grupos.


## Ajuste antes da 3ª revisão — texto ditado depois de ":" volta a valer como CONTEÚDO

Pedido do coordenador (o jeito natural de o dono falar: "anota na Maria Trello: ela mandou o RG", "cria tarefa pro João: ligar pro
cartório amanhã"). Substitui a decisão do portão 2 (I-B) de desligar tudo com ":".

1. Verbo, função, código de grupo e alvos saem SÓ do trecho antes do ":" (`partesDaOrdem` → `ordemDireta.texto`).
2. O que vem depois do ":" só serve de TEXTO gravado de `criar_tarefa`, `registrar_acompanhamento`, `guardar_memoria`,
   `corrigir_memoria` (`FUNCOES_COM_CONTEUDO_DITADO`). Função de grupo, `esquecer_memoria` e `silenciar_aviso` com ":" → confirmação.
3. O texto gravado continua sob a regra estrita do I-A, comparado com a mensagem INTEIRA; prazo, prioridade e "houve ligação" podem
   sair de qualquer parte da mensagem.
4. Desligam a ordem direta da mensagem inteira: aspas de qualquer tipo (inclusive apóstrofo e crase), ">", quebra de linha, mais de um
   ":" (o de hora "14:30" e o de "://" não contam), ditado vazio ou com mais de 200 caracteres, colagem/encaminhada/anexo.
5. "?" em qualquer ponto e negação ANTES do ":" bloqueiam; negação DEPOIS do ":" é conteúdo ditado, aceito só se o texto gravado a
   reproduzir igual ("ela não quer financiar").
- Com duas clientes "Maria" no CRM, "anota na Maria Trello: …" continua perguntando qual (regra M-C do portão 2); os testes desse
  roteiro tiram a Maria Dayane do CRM para o nome ficar único.
- Testes novos no e11 (8): regras puras, os dois roteiros em uma mensagem, A3 com aspas, a variante sem aspas (só a anotação é
  gravada), cliente citado só depois do ":", negação ditada × inventada, grupo/aviso com ":" → confirmação. e11: 63 testes.


## Portão de segurança E11 — 3ª rodada (sobre 6074e4e → FAIL) — regra ESTRUTURAL, que falha fechada

A conferência do texto por palavras (subsequência) virou "gato e rato" e foi trocada por uma regra estrutural.

| Achado (reproduzido pelo webhook) | Correção |
|---|---|
| Subsequência: "não pagar…" → "pagar o boleto"; 1.300 → 300; 15/12 → 12; memória invertida; mistura antes/depois do ":" | (4) TEXTO GRAVADO = TEXTO DO DONO: com ditado, o texto do modelo (normalizado só em caixa, espaços e pontuação nas pontas) tem de ser IGUAL ao ditado inteiro e grava-se o DITADO; sem ":", tem de ser trecho CONTÍNUO da mensagem (caractere a caractere, em fronteira de palavra) e grava-se o TRECHO do dono. `textoGravadoDoDono`; a prova devolve os argumentos com o texto do dono no lugar do do modelo (ponte.ts). |
| Caracteres que a normalização apagava (emoji, cirílico, chinês, "-300%") | (1) PORTA DE CARACTERES por LISTA PERMITIDA (`passaNaPortaDeCaracteres`): depois de NFKC, só letras latinas do português, dígitos, espaço comum e `. , ; : ! - / ( ) % $ @ + #`; espaços "parecidos" (NBSP, tipográficos, ideográfico, invisíveis) barrados antes do NFKC. Qualquer outro caractere → "pode". |
| ":" parecidos (： ꞉ ∶ ﹕, "1:1", "://") | (2) Depois da porta só existe o ":" ASCII (os de largura total viram ":" no NFKC; os outros são barrados pela porta) e TODOS contam: mais de um → "pode". Um único ":" entre dígitos (hora) vale como texto só se nada depois dele for verbo de ação. |
| Aspas fora da lista antiga, travessão de fala | Barrados pela porta (lista permitida). |
| "？", "¿", "n cria", "ñ cria", "n​ão cria" | "？" vira "?" e é barrado; "¿", "ñ" e o invisível são barrados pela porta; (3) negação por TOKEN (`temNegacao`: não, n, naum, num, nem, nunca, jamais, nada) no trecho antes do ":" (ou na mensagem inteira). |
| Prazo/prioridade conferiam só o assunto | (5) Calculados pelo CÓDIGO: prazo direto só quando a data inequívoca tirada da mensagem ("hoje", "amanhã", "dd/mm", "dd/mm/aaaa", "dia dd") é igual à do modelo (hora só se ele escreveu); prioridade direta só "média" ou "alta" com "urgente" e nenhuma negação em parte alguma. Senão → "pode". |
| `bloqueiaOrdemDireta` exportada mas sem uso na produção | Removida; uma função só (`partesDaOrdem`, que chama a porta, os ":" e `temNegacao`) é a usada por cerebro.ts. |

Mantidos: verbo/função/código/alvos só do trecho antes do ":"; `unicoComPonto`; lista fechada; troca de grupo nunca direta; B-b;
contagem como único retorno ao modelo.

**Roteiros que passaram a pedir "pode" por causa da regra nova (não afrouxado):**
- tarefa em que o modelo reescreve o título ("Cobrar certidão no cartório" a partir de "cobrar a certidão do João no cartório");
- (resolvido no ajuste antes da 4ª revisão) com ditado, o modelo que resume o ditado agora vai direto, gravando o ditado;
- mensagem com hora e outro ":", aspas, apóstrofo ("d'água"), travessão, "?", "não/nada" em qualquer ponto antes do ":";
- prazo/prioridade que o código não consegue tirar da mensagem.
- O título gravado agora tem a caixa do dono ("ligar para o João", minúsculo como ele escreveu).

Testes: e11 com 71 (8 da 3ª rodada, com as frases exatas, e a propriedade "o que foi gravado é substring exata do que o dono escreveu"
verificada no banco).


## Ajuste de usabilidade antes da 4ª revisão — com ditado, grava-se SEMPRE o ditado

- Com ":" válido e função de registro de texto (`criar_tarefa`, `registrar_acompanhamento`, `guardar_memoria`, `corrigir_memoria`),
  o texto principal gravado (título / anotação / lembrança / texto novo) é SEMPRE o ditado do dono, aparado (`textoGravadoDoDono`); o
  texto do modelo é descartado nesse campo — resumo, reescrita ou conteúdo injetado nunca chegam ao banco. Evita o "pode" quando o
  modelo resume ("Ligar pro cartório" para o ditado "ligar pro cartório amanhã").
- Descrição da tarefa, com ditado: descartada (fica vazia) no caminho direto; não leva à confirmação.
- B-b: duas chamadas da mesma função para o mesmo alvo no mesmo pedido passam a ter os mesmos argumentos (o ditado) → uma só.
- Sem ":" nada muda (trecho contínuo). Porta de caracteres, negação, prazo/prioridade pelo código e o teto de 200 caracteres do ditado
  continuam.
- prompt.ts: "Texto a gravar (tarefa, anotação, lembrança): as palavras exatas dele, sem resumir nem reescrever" (o texto do sistema
  continua abaixo de 6.500 caracteres; a linha das contas foi encurtada).
- Testes: os do portão 3 que esperavam "pode" com ditado alterado agora conferem o invariante "o gravado é exatamente o ditado";
  novos: ditado + título resumido → feito na hora; título com texto em chinês → grava-se o ditado; descrição do modelo descartada.
  e11: 72 testes.


## Portão de segurança E11 — 4ª rodada (sobre 7303ab2 → FAIL) — FUNÇÃO e TEXTO decididos pelo CÓDIGO

Princípio: no caminho direto, a função, o texto e os alvos saem da mensagem do dono, pelo código; a chamada do modelo é só o gatilho e
tem de coincidir.

| Achado | Correção |
|---|---|
| I-1 — verbo de outra função em qualquer posição | `funcaoDoPedido`: a função é a do PRIMEIRO verbo do pedido (depois de no máximo um vocativo/cortesia curto: "dolores", "por favor", "oi", "bom dia", "vamos"), em famílias separadas (tarefa exige "tarefa" logo depois de cria/abre). A chamada do modelo tem de ser dessa função; outra → confirmação. Verbos de outras famílias depois do primeiro são conteúdo. |
| I-2 — memória intercambiável | Famílias separadas: guardar (lembra/guarda/memoriza/grava), esquecer (esquece; apaga/remove/tira + lembrança), corrigir (corrige; atualiza + lembrança). |
| I-3 — trecho escolhido pelo modelo | `textoPelaMoldura`: sem ":", o texto gravado é o que sobra ATÉ O FIM depois da moldura (lista fechada: verbo, artigos, "tarefa", "que", pra/para/pro/ao, de/da/do, na/no, aí, me, disso, "urgente", e os nomes PROVADOS do responsável/cliente logo depois do verbo/preposição; depois de "que" só saem artigos). Vazio/menos de 2 palavras, começo dêitico ("aquela", "outra", "isso"…) ou "tarefa que…" (oração relativa: aponta para fora da mensagem) → confirmação. O texto do modelo é descartado. |
| (3) negação | Antes do verbo: o pedido não abre com verbo → sem ordem direta. Na moldura: `temNegacao` → confirmação. No texto gravado: é conteúdo do dono e fica. Funções sem texto (grupo, esquecer, aviso): negação em qualquer ponto → confirmação. |
| M-1 — "dia 15 de janeiro" → 15/12 | `dataDitaPeloDono` devolve null com nome de mês, dia da semana, "que vem", "próximo/a", "semana", "mês" ou mais de uma data. Prazo do modelo sem data do código → confirmação; sem prazo do modelo → cria sem prazo (a linha "Feito" já diz "sem prazo"). |
| M-2 — NFKC mudava o texto | `partesDaOrdem` recusa quando NFC ≠ NFKC; grava-se sempre o NFC (o que ele digitou). |
| M-3 — nome do responsável provava cliente | As palavras que provaram o responsável não contam para o cliente; palavra do cliente que também é nome de alguém da equipe → pergunta. Sem cliente provado: em `criar_tarefa` o vínculo do modelo é descartado (tarefa sem vínculo); em `registrar_acompanhamento` → confirmação/pergunta. |
| M-4 — correção sem sujeito | `corrigir_memoria` direto só com ditado e se o ditado trouxer ao menos uma das palavras que apontaram a lembrança; sem ":" → confirmação. |
| B-1 — "pouco urgente" | "pouco/menos/nada/nem/tão [x] urgente" não vale como urgente. |
| (9) categoria/tipo | Memória direta grava com a categoria padrão do código (`fato_negocio`); anotação direta é "anotação", salvo "ligação" conferida. |

**Roteiros legítimos:** continuam em uma mensagem — "cria uma tarefa para a Bianca ligar para o João" (grava "ligar para o João"),
"cria tarefa pro João: ligar pro cartório amanhã", "anota na Emily que ela mandou o RG" (grava "ela mandou o RG"), "anota na Maria
Trello: ela mandou o RG", "lembra que o Henrique prefere contato à tarde", "esquece a lembrança do Henrique", parar/voltar aviso, grupos.
**Passam a pedir "pode":** corrigir lembrança sem ":"; "cria a tarefa que o cliente pediu…" (oração relativa); texto que começa por
dêitico ("cria aquela tarefa…", "a outra…"); "corrige…: <texto sem o sujeito>"; mensagem que não abre com o verbo ("procura o João e
cria uma tarefa…", "você pode lembrar…"); data com nome de mês/dia da semana quando o modelo manda prazo.
**Efeito no texto gravado:** sem ":", vai até o fim da mensagem ("ligar para o João amanhã"; "ligar para a Maria amanhã e me mostra o
histórico dela").

Testes: e11 com 81 (9 da 4ª rodada com as frases exatas e a propriedade "o gravado é o sufixo exato da mensagem depois da moldura").

## Critérios de aceite

- [x] AC1 — "Grupo AA7W aceitar" com nome que bate com UM cliente → aceito e ligado, uma linha, sem pergunta e sem a IA.
- [x] AC2 — "Grupo AA7W 1" e "1" (sem nº) ligam pelo nome do grupo; ambíguo → pergunta com os nomes; a resposta com o nome liga.
- [x] AC3 — "Vamos vincular o grupo da Emily" → ligado com 1 mensagem do dono (2 se a IA perguntar e ele disser "pode").
- [x] AC4 — "o grupo da X pode" / "pode todos" confirmam por código os itens que ele já viu; sem nome que aponte um item, segue a IA.
- [x] AC5 — Sério: "confirmo" uma vez executa uma vez; a IA não pede "pode" ela mesma.
- [x] AC6 — Adversariais: nome de grupo com instrução, homônimo, grupo copiado, encaminhada, anexo, verbo de outra função, aceitar
  sem código, ligar a resposta → nada executa sem a confirmação de sempre.
- [x] AC7 — (E11b) Ordem direta também para criar tarefa, registrar acompanhamento, guardar/corrigir/esquecer memória e silenciar aviso.

## E11b — registros por ordem direta (autorização do dono de 23/11)

- Lista fechada ampliada: `criar_tarefa`, `registrar_acompanhamento`, `guardar_memoria`, `corrigir_memoria`, `esquecer_memoria`,
  `silenciar_aviso`. Prova no servidor (`provarRegistro`, server/dolores/ordem-direta.ts):
  - **texto gravado** (título, descrição, anotação, lembrança): `textoSaiuDoDono` = `veioDasPalavrasDoDono` E **todas** as palavras de
    conteúdo na mensagem dele (nenhuma palavra lida de documento/consulta). Senão → UMA confirmação.
  - **cliente** (vínculo da tarefa, anotação, lembrança): "cliente N" escrito ou UM cliente pelas palavras dele; empate → pergunta
    curta com os NOMES (nada vai para a fila); corte de 300 → ambíguo.
  - **responsável**: o nome pedido está nas palavras dele e aponta UMA pessoa da equipe (a mesma que as palavras dele apontam);
    empate → pergunta com os nomes.
  - **lembrança** a corrigir/esquecer: a ATIVA que as palavras dele apontam (uma só).
  - **aviso**: o tipo (nome ou rótulo) e a direção ("para/silencia" × "volta/religa") nas palavras dele.
  - intenção pela palavra da função ("tarefa", "anota/registra", memória pelo reconhecimento que já existia, "avisa/silencia");
    negação, colagem, anexo, encaminhada e "pode" solto → nunca ordem direta.
- A linha "Feito: …" diz como desfazer onde existe (tarefa: "cancele em Tarefas"; memória: "me peça para esquecer/corrigir/lembrar
  de novo"; aviso: "é só pedir"); anotação no histórico não tem desfazer pela conversa — a linha não promete.
- Ao modelo volta só a CONTAGEM do que foi feito (a frase com nomes do cadastro vai ao dono pela linha do sistema — QA R2 N2).
- O teto de ações por comando (10) e os tetos de gasto continuam valendo (testado: 11 tarefas pedidas → 10 feitas).

### Testes alterados (o veículo do "pode" mudou; nenhuma propriedade deixou de ser testada)

Ver a tabela no relatório da E11b e o Change Log. Regra geral: onde a tarefa/memória/aviso era só o VEÍCULO do "pode", o pedido passou
a ser um em que o texto proposto NÃO saiu das palavras do dono ("cria aquela tarefa para a Bianca") — o caminho da confirmação
continua igual e todas as propriedades (A1, substituição, concorrência, vencimento, terceiros, encaminhada, colagem, auditoria,
máscara, filtro da pergunta) continuam testadas. Onde o teste afirmava "o pedido direto do dono espera o pode", ele passou a afirmar a
regra nova (feito na hora) e, quando a propriedade era de contaminação, o texto proposto passou a trazer uma palavra da leitura.

## Não feito
- A lista dos itens da fila aguardando **não** vai como bloco no contexto do modelo (a resolução por nome é por código; a IA vê o
  que o sistema perguntou pela memória da conversa).
- O código dos grupos continua saindo da memória da conversa (`semCodigosReais`); a IA o vê pela consulta de grupos.

## Testes

- Novo: `server/dolores/e11-conversa-direta.test.ts` (25 testes na E11; 34 depois da E11b; 43 com o portão 1; 55 com o portão 2; 63 com o ajuste do ":"; 71 com o portão 3; 72 com o ajuste antes da 4ª revisão; 81 com o portão 4).
- Ajustados (mudança de regra autorizada): `grupos-automaticos.test.ts` e `c3-categorias-grupos.test.ts` — "grupo K7HM cliente"
  e "1" sem o nº passaram a valer; `c5-e1-voz.test.ts` — a trava do texto do sistema agora exige as frases da E11 (e continua < 6.500
  caracteres).
- Rodados (23/11, `--maxWorkers=2`): e11 (25/25); grupos*, c5-e2*, c3-categorias, acoes* (13 arquivos, 240/240); c5-e1*,
  correcoes-e3*, operacao*, e9*, marcacao*, whatsapp*, ponte, s6-reserva, s3-fiscal (26 arquivos, 476/476 depois do ajuste do
  c5-e1-voz); prefixo/reserva e vizinhos (10 arquivos, 221/221). `npx tsc --noEmit` limpo; `npx vite build` ok.
- Pendente: validação na conversa real do dono (produção) e o portão de QA.

## File List

- `shared/dolores/ordem-direta.ts` (novo) — regras puras da ordem direta, confirmação nomeada, nome do cliente, linha "Feito".
- `server/dolores/ordem-direta.ts` (novo) — prova dos alvos no servidor; cliente pelo nome do grupo.
- `shared/dolores/grupos-tipo.ts` — 2º nível (nome + sobrenome), candidatos, "1"/"cliente" sem nº, opções sem nº do CRM.
- `server/dolores/grupos-decisao.ts` — cliente sem nº pelo nome do grupo, ligar sozinha depois do "aceitar", `decidirPeloNome`, `perguntaDoCliente`.
- `server/dolores/ponte.ts` — opção `ordemDireta`/`aoExecutar`; decide na hora pelo `decidir`; aviso ao modelo sem "o sistema vai mostrar".
- `server/dolores/cerebro.ts` — `palavrasDoDonoParaOrdem`, `feitosNaHora`, `agora`.
- `server/dolores/pendencia.ts` — `tratarConfirmacaoNomeada`.
- `server/dolores/whatsapp.ts` — linha "Feito", confirmação nomeada, resposta só com o nome.
- `server/dolores/leitura/grupos.ts` — `codigo` e nome do WhatsApp em `listar_grupos`.
- `server/dolores/prompt.ts` — agir na ordem, uma pergunta só, sem lista de pendências, sem nº do CRM, iniciativa.
- `server/dolores/e11-conversa-direta.test.ts` (novo), `server/dolores/grupos-automaticos.test.ts`, `server/dolores/c3-categorias-grupos.test.ts`,
  `server/dolores/c5-e1-voz.test.ts`.

## Change Log

- 24/11/2026 — @dev (Dex): portão de segurança E11, 4ª rodada — função e texto pelo código (moldura), M-1–M-4, B-1, categoria/tipo padrão.
- 23/11/2026 — @dev (Dex): ajuste antes da 4ª revisão — com ditado, grava-se sempre o ditado; descrição descartada; linha no prompt.
- 23/11/2026 — @dev (Dex): portão de segurança E11, 3ª rodada — regra estrutural (porta de caracteres, ':' ASCII, negação por token, texto do dono, prazo pelo código).
- 23/11/2026 — @dev (Dex): ajuste antes da 3ª revisão — ditado depois de ":" como conteúdo de registro.
- 23/11/2026 — @dev (Dex): portão de segurança E11, 2ª rodada (I-A, I-B, M-A–M-D, B-a, B-b, B-d) corrigido; regressões no e11.
- 23/11/2026 — @dev (Dex): E11b — ordem direta para tarefa, anotação, memória e aviso; testes do "pode" migrados de veículo.
- 23/11/2026 — @dev (Dex): achados do portão de QA E11 (I1, I1b, I2, M1–M4, B2, qualidade) corrigidos; regressões no e11.
- 23/11/2026 — @dev (Dex): story escrita com as causas confirmadas no código; Ready → InProgress → InReview (implementação + testes).
