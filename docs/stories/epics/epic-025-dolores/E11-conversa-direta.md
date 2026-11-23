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
- **Alvos:** grupo = código citado OU as palavras dele apontam UM só grupo da instância pelo nome (`escolherPorNome`: o melhor
  único; empate → não provado; palavras genéricas como "grupo", "obra", "prospecta" não contam). Cliente = "cliente N"/"nº N"
  escrito, OU as palavras dele apontam UM cliente ativo, OU (só se as palavras dele não apontaram outro) o ÚNICO cliente que o nome
  do grupo aponta pela regra do dono de 19/11. Tipo = o que ele disse (engenharia só com "engenharia"; pós só com "pós").
- **Texto de terceiro** (nome de grupo, nome de cliente) só pode criar EMPATE — nunca tirar o alvo do dono: um grupo copiado com o
  mesmo nome faz a ação voltar para a confirmação.
- **Execução:** a mesma da fila (`decidir`): item gravado com resumo + hash, revalidação dos argumentos, `executarAprovado`
  (`decidirGrupo` com o gatilho 0133), auditoria em `dolores_acoes` com `nivel: ordem_direta`.
- **Intactos:** interruptores (IA, resposta em grupo geral e por grupo, só quando marcada), tetos de gasto e de ações por comando,
  filtros de saída e mascaramentos, aceitar grupo de terceiro só pelo dono, `exigeConfirmoNoCodigo` para nota fiscal.

## Critérios de aceite

- [x] AC1 — "Grupo AA7W aceitar" com nome que bate com UM cliente → aceito e ligado, uma linha, sem pergunta e sem a IA.
- [x] AC2 — "Grupo AA7W 1" e "1" (sem nº) ligam pelo nome do grupo; ambíguo → pergunta com os nomes; a resposta com o nome liga.
- [x] AC3 — "Vamos vincular o grupo da Emily" → ligado com 1 mensagem do dono (2 se a IA perguntar e ele disser "pode").
- [x] AC4 — "o grupo da X pode" / "pode todos" confirmam por código os itens que ele já viu; sem nome que aponte um item, segue a IA.
- [x] AC5 — Sério: "confirmo" uma vez executa uma vez; a IA não pede "pode" ela mesma.
- [x] AC6 — Adversariais: nome de grupo com instrução, homônimo, grupo copiado, encaminhada, anexo, verbo de outra função, aceitar
  sem código, ligar a resposta → nada executa sem a confirmação de sempre.
- [ ] AC7 — Ordem direta também para criar tarefa, registrar acompanhamento, memória e silenciar aviso (ver "Não feito").

## Não feito nesta entrega (próximo passo: E11b)

- **Tarefa, acompanhamento, memória e silenciar aviso** continuam com o "pode". O mecanismo está pronto (basta pôr na lista
  `podeExecutarPorOrdemDireta` e, em `provarAlvosDoDono`, conferir o texto com `veioDasPalavrasDoDono` e o vínculo como o cliente
  acima), mas ~150 testes existentes (E2, E3, memória, mesas, avisos) usam a tarefa como o veículo do "pode"; mudá-la exige
  reescrever esses testes com outro veículo. Fica para a E11b, com o portão de QA.
- A lista dos itens da fila aguardando **não** vai como bloco no contexto do modelo (a resolução por nome é por código; a IA vê o
  que o sistema perguntou pela memória da conversa).
- O código dos grupos continua saindo da memória da conversa (`semCodigosReais`); a IA o vê pela consulta de grupos.

## Testes

- Novo: `server/dolores/e11-conversa-direta.test.ts` (25 testes: regras puras, os roteiros 1–6 da conversa real e os adversariais).
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

- 23/11/2026 — @dev (Dex): story escrita com as causas confirmadas no código; Ready → InProgress → InReview (implementação + testes).
