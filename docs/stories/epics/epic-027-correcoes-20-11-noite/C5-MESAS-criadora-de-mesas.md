# C5-MESAS — Dolores: "criadora de mesas" (propostas de função nova, guardadas para aprovação)

Status: InReview (ramo `epic027-c5mesas`, criado do pacote integrado da Dolores `epic027-c5int`; implementada, aguarda o portão de QA de segurança).
Epic: EPIC-027 — Correções de 20/11/2026 (noite) (`EPIC.md`). Plano: `C5-PLANO-dolores-jarvis.md`. Integração: `C5-INTEGRACAO.md`.
Depende de: C5-E2 (proposta com "pode"/"confirmo", 0145) e C5-MLP (padrão de ação "registro" com "pode", 0149).
Paridade: Dolores é exceção registrada no ROADMAP (sem porte ao Grupo Santa Fé).
Migração: `drizzle/0151_dolores_mesas.sql` (aditiva e idempotente; NÃO aplicada em banco nenhum por esta etapa).

## Pedido
Aprovado pelo dono em 21/11/2026: quando o DONO pede uma função nova à Dolores ("quero que você passe a fazer X", "cria uma mesa para
acompanhar Y"), ela NÃO programa nem passa a fazer nada sozinha: escreve uma PROPOSTA DE MESA (o rascunho da função) e guarda para
aprovação. Só entra em operação depois que ele aprovar E a função for construída pelo processo normal de desenvolvimento (fora da Dolores).

## Escopo
- DENTRO: capturar, estruturar, guardar e acompanhar pedidos de função nova; versões imutáveis; aprovação do dono ("confirmo") que só muda a
  situação; consulta pela conversa; seção "Mesas" no cartão de operação da Dolores (só admin) com o texto pronto para o desenvolvimento.
- FORA: execução de código gerado, ferramenta dinâmica, mudança do texto do sistema em produção, escrita em disco/repositório, qualquer
  coisa que ligue uma função por aprovação.

## Critérios de aceite
- [x] AC1 — Tabelas (0151): `dolores_mesas_propostas` (título, pedido original filtrado, situação rascunho → aguardando o dono → aprovada →
      em construção → em operação / recusada / arquivada, versão atual, origem `conversa`/`semente`, chave da semente única, datas, autor,
      aprovação com a versão) e `dolores_mesas_versoes` (uma linha por versão, `proposta` jsonb). Gatilhos: versões IMUTÁVEIS (sem UPDATE/
      DELETE/TRUNCATE); cabeçalho sem exclusão, com pedido original/origem/criação fixos e versão que só sobe. Aplicada 2× nos testes.
- [x] AC2 — `propor_mesa` (fila, "registro" → "pode"): só na conversa direta do dono, quando a mensagem DELE pede mesa por código
      (`shared/dolores/mesas.ts#intencaoDeMesa`, no trecho antes de qualquer marca de colagem; sem colagem, sem anexo, não encaminhada →
      `ctx.pedidoDeMesa`, montado em `cerebro.ts`). A IA preenche a estrutura (objetivo, quando age, lê, grava, funções novas, quem aprova,
      exemplos bons/ruins, riscos, faixa de custo); o servidor confere TUDO contra o registro real (`conferirCapacidades` com o catálogo de
      `mesas-capacidades.ts`): nome inexistente, proibido ou da própria criadora vira "precisa de função nova"; quem aprova nunca fica abaixo do
      mínimo (grava → "pode"; ação séria → "confirmo"). O resumo mostrado é montado pelo servidor e diz o que o sistema ajustou.
- [x] AC3 — `revisar_mesa` (versão nova; só o que muda no resumo; revisar uma aprovada desfaz a aprovação), `recusar_mesa` ("pode") e
      `propor_aprovacao_mesa` (SÉRIA: "confirmo"; "aprovar CÓDIGO" pede "confirmo CÓDIGO"). Aprovar NÃO liga nada: só muda a situação para "aprovada"
      e avisa que agora depende da construção. Execução só com a decisão do dono no WhatsApp (`ctx.via`); aprovar pela fila da tela não vale.
- [x] AC4 — Nunca por grupo, cliente, ponte HTTP, texto colado ou encaminhado: grupo e cliente têm laços próprios (não recebem as
      ferramentas); a ponte recusa ação e também `listar_mesas` (403); colagem/encaminhada não geram `pedidoDeMesa`.
- [x] AC5 — `listar_mesas` (leitura SÓ do dono, `funcoes.ts#LEITURAS_DO_DONO`, fora de `FUNCOES`: não vai à ponte nem ao grupo
      administrativo): "quais mesas eu pedi?", "como está a mesa X?" (com `mesaId`, a proposta inteira e as versões). Contamina o comando.
- [x] AC6 — Tela: seção "Mesas" DENTRO do cartão de operação da Dolores (`DoloresOperacaoCard` → `DoloresMesasSecao`), rotas
      `dolores.mesas.{listar,versoes,mudarSituacao}` só admin por PAPEL (conferido antes de qualquer consulta). Mostra a proposta completa e,
      nas aprovadas/em construção/em operação, "Copiar para o desenvolvimento" (Markdown no formato de story: problema, critérios,
      leituras/ações, funções novas, quem aprova, riscos, custo — `markdownDaMesa`). Nada é escrito em disco. A tela só muda para em
      construção (de aprovada), em operação (de em construção) e arquivada.
- [x] AC7 — Mesas que já existem (semeadura idempotente, `semearMesasIniciais`, chave única): documentos do cliente, notas de obra,
      regularizações (consulta), atendimento e grupos — como "em operação", DERIVADAS do registro real (só ficam as leituras/ações que existem e
      estão liberadas; quem aprova sai do nível das ações). Roda na tela e antes da primeira proposta; `listar_mesas` (somente leitura) mostra
      as derivadas enquanto não foram gravadas.
- [x] AC8 — Segurança: cada campo passa por `textoDaMesa` (segredo, dado bancário, link e invisível → recusa; CPF/telefone/e-mail →
      mascarados; uma linha, sem colchetes); o pedido original passa pelo filtro do registro. Conteúdo das propostas é DADO quando volta à IA
      (só em `tool_result`); nunca vira texto do sistema. Tetos: 20 mesas abertas, 20 versões, tamanho por campo e resumo de até 1.500
      caracteres. Auditoria `dolores_acoes` "mesa" (números e operação; nunca o texto). Custo na parte "conversa" do gasto.
- [x] AC9 — Testes `server/dolores/c5-mesas.test.ts` + listas fixas atualizadas (`acoes`, `correcoes-e3`, `c5-e2-resolve`).

## Decisões de implementação
- [AUTO-DECISION] Nome da ação de aprovação: o pedido dizia `aprovar_mesa`, mas três guardas de segurança existentes (`acoes.test.ts`,
  `acoes-whatsapp.test.ts`, `grupos-automaticos.test.ts`) proíbem qualquer ferramenta "aprovar…" (o modelo nunca aprova nada). Ficou
  `propor_aprovacao_mesa`, que é o que ela faz: PROPÕE ao dono, e só o "confirmo" dele (reconhecido por código) aprova. As guardas não mudaram.
- [AUTO-DECISION] A pergunta ao dono nunca usa os verbos "aprovar"/"recusar" (regra da voz, E2): "dar a sua aprovação à mesa N",
  "deixar de lado (recusada) a mesa N".
- [AUTO-DECISION] "rascunho" × "aguardando o dono": decidido por código (`faltaNaProposta`): sem o que lê/grava, sem exemplo bom ou sem
  riscos, fica rascunho e não pode ser aprovada.

## Como fica a conversa (exemplos)
1. Dono: "cria uma mesa para acompanhar as obras paradas toda segunda" → Dolores: "Vou registrar a proposta dessa mesa." e o sistema:
   «*Posso fazer isto?* - registrar a proposta de mesa "Obras paradas toda segunda" — objetivo: "…"; quando age: "…"; lê: obras, atrasos;
   grava: tarefa; precisa de função nova: "ronda semanal…", "leitura que ainda não existe: ler_planilha_de_custos"; quem aprova: o dono,
   respondendo pode; … (o sistema ajustou: …). A proposta fica aguardando a sua aprovação. Nada passa a funcionar agora…» → "pode" →
   "Pronto: registrei a proposta de mesa 5, "Obras paradas toda segunda": está aguardando a sua aprovação (é só dizer "aprova a mesa 5").
   Nada passou a funcionar."
2. Dono: "aprova a mesa 5" → sistema: «*Isto precisa da sua confirmação por escrito* (é a aprovação de uma função nova (mesa) para ser
   construída): - aprovar a mesa 5, "…" (versão 1) — aprovar NÃO liga nada…» → "confirmo" → "Pronto: aprovei a mesa 5, "…". Nada foi
   ligado: agora ela depende de ser construída pelo time de desenvolvimento (…em Integrações, no cartão de operação da Dolores, em Mesas)."

## Prefixo fixo × piso da reserva
`listar_mesas` + 4 ações levaram o prefixo estimado (texto do sistema + ferramentas com ações) a 15.227 tokens (+500 da API = 15.727), acima
do piso de 15.000: `RESERVA_MINIMA_ENTRADA` 15.000 → 17.000 (`cerebro.ts`). Conferido por `c5-e1-memoria.test.ts` e `c5-mesas.test.ts`.

## File List
- `drizzle/0151_dolores_mesas.sql` (novo), `drizzle/schema-dolores-mesas.ts` (novo), `drizzle.config.ts`
- `shared/dolores/mesas.ts` (novo), `shared/dolores/confirmacao.ts`, `shared/dolores/voz.ts`
- `server/dolores/mesas.ts`, `server/dolores/mesas-capacidades.ts`, `server/dolores/mesas-router.ts`, `server/dolores/acoes/mesas.ts`,
  `server/dolores/leitura/mesas.ts` (novos)
- `server/dolores/acoes/registro.ts`, `server/dolores/acoes/comum.ts`, `server/dolores/funcoes.ts`, `server/dolores/permissoes.ts`,
  `server/dolores/ponte.ts`, `server/dolores/cerebro.ts`, `server/dolores/prompt.ts`, `server/dolores/router.ts`, `server/dolores/testes-banco.ts`
- `client/src/components/admin/DoloresMesasSecao.tsx` (novo), `client/src/components/admin/DoloresOperacaoCard.tsx`
- Testes: `server/dolores/c5-mesas.test.ts` (novo), `server/dolores/acoes.test.ts`, `server/dolores/correcoes-e3.test.ts`, `server/dolores/c5-e2-resolve.test.ts`

## Pendências
- Aplicar a 0151 no Neon (aditiva) junto com a publicação.
- Portão de QA de segurança (@qa) antes da `main` (regra da Dolores de 16/11).
