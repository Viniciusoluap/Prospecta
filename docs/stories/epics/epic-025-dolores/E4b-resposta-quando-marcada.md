# E4b — A Dolores responde no grupo quando é marcada

Status: InReview
Epic: EPIC-025 (Etapa 4b) — complemento da E4 (grupos de clientes), por decisão do dono em 17/11/2026.
Paridade: suspensa por ordem do dono em 16/11 (Grupo Santa Fé em espera); registrar no ROADMAP ao fechar o epic.
Tamanho estimado: G
Dependência: E4 (`epic025-dolores-etapa4`, `a386300`, em 2ª rodada de QA, ainda fora da `main`). Esta story é aditiva sobre ela.

## Decisão do dono (17/11/2026) — é a lei desta story
Palavras dele: "Nos grupos ela só pode responder quando ela for marcada, quando o número for marcado; em nenhum outro momento
ela deve responder as mensagens do grupo e deve apenas observar até ser marcada."

Perguntado, ele respondeu:
1. Quem pode fazê-la responder: **qualquer pessoa do grupo** que a marcar (inclusive cliente e empreiteiro).
2. O que ela pode dizer no grupo: **só sobre o cliente/obra daquele grupo** — andamento, pendências, documentos que faltam;
   nunca dados de outros clientes, nunca CPF, valores internos ou anotações da equipe; nunca executa ação a partir do grupo.

Isso muda a regra anterior ("a Dolores nunca responde em grupo"). O dono também disse: "Garanta minha segurança, isso é uma
prioridade". Quem marca é TERCEIRO: nada do que ele escreve é comando.

## Critérios de aceite
- [x] AC1 — Marcação por CÓDIGO: só conta quando o JID/número da Dolores (o `numero_dolores` conferido da conexão, ou o `@lid`
      dela conferido pela Evolution para esse mesmo número) está na lista de menções da mensagem (`contextInfo.mentionedJid` do
      conteúdo, ou o `contextInfo` do aviso da Evolution). Escrever "@Dolores" ou o número no texto não conta. Resposta citada a uma
      mensagem dela sem menção não conta. Menção dentro da mensagem citada não conta. Editada, reação, encaminhada, visualização
      única e interação: não conta. Temporária (desembrulhada): conta. Na dúvida, não foi marcada.
- [x] AC2 — Sem marcação: comportamento da E4 intacto (só registra, grupo cadastrado e ativo). Grupo não cadastrado ou
      desativado: nunca responde, mesmo marcada.
- [x] AC3 — Com marcação, em grupo cadastrado e ativo e com os interruptores ligados: responde NO GRUPO, citando a mensagem, por
      um laço próprio (separado do laço do dono), com um conjunto NOVO e mínimo de leituras do grupo que recebem o cliente/obra
      pelo CONTEXTO do servidor (nunca por argumento do modelo). Função fora do conjunto ⇒ recusa auditada.
- [x] AC4 — As leituras do grupo NUNCA devolvem CPF/CNPJ, telefone, e-mail, endereço, valores, dados bancários, anotações
      internas, histórico interno, nomes de outros clientes, corretor/comissão, responsável da equipe nem prazos previstos. Só
      situação, etapas, datas de movimento e nomes de documentos pendentes (corte no servidor; na dúvida, não devolve).
- [x] AC5 — Filtro de saída do grupo: canal `grupo` em `dados-pessoais.ts` — dados pessoais SEMPRE mascarados (a opção B não vale),
      segredos e bancários sempre, links removidos (só o host do sistema), sem prévia, sem "@número", até 800 caracteres.
- [x] AC6 — Nada do grupo é comando: pergunta sobre valores, contrato, prazo, reclamação, outro cliente, dado pessoal, pedido de
      ação ("aprovar", "grave", "envie para…"), "ignore as regras" ou "sou o dono" ⇒ frase fixa "Isso eu preciso confirmar com a
      equipe; já avisei.", sem chamar a IA, auditada e registrada como fora de escopo. "aprovar CÓDIGO" no grupo não aprova nada.
      O dono dentro do grupo é participante comum.
- [x] AC7 — Compromissos: a resposta nunca promete prazo, valor, aprovação ou resultado; saída com cara de promessa, valor, link
      ou dado pessoal é trocada pela frase fixa.
- [x] AC8 — Registro consultável de cada marcação (grupo, remetente mascarado, pergunta filtrada, resposta, fora de escopo), na
      tela e na leitura `ler_grupo_cliente`. Nenhuma mensagem ao dono a cada marcação.
- [x] AC9 — Custo e abuso: porta `bloqueioAtual` (função nova "dolores_grupo" no modelo por função); interruptor próprio geral e
      por grupo, DESLIGADO por padrão; teto por grupo/dia e por remetente/hora; no máximo 1 resposta em andamento por grupo;
      idempotência por id da mensagem; janela de frescor. Passou do teto: silêncio (no máximo uma frase fixa por grupo/dia). IA
      desligada/sem limite/pausada: silêncio, registrado. `server/integracoes-anthropic.test.ts` intacto.
- [x] AC10 — Envio: um único ponto novo de envio a grupo, com conferência dupla do destino (o JID do grupo cadastrado e ativo
      daquela mensagem), `linkPreview:false`, sem mencionar ninguém, sem "marcar todos". Nenhum outro caminho envia a grupo.
- [x] AC11 — Tela (admin por PAPEL): interruptor geral e por grupo, tetos e lista de marcações com a resposta; aviso "o que ela
      escreve no grupo é lido por todos os participantes". Rotas testadas pelo `appRouter` com o caminho completo.
- [x] AC12 — Migração `drizzle/0129_dolores_marcacoes.sql` só aditiva e idempotente, só tabelas NOVAS (não aplicada aqui).
- [x] AC13 — Docs: `como-ligar.md` (seção "Responder no grupo quando marcada") e `agente-etapa4.md`; o que dizia "nunca responde
      em grupo" passa a dizer "só responde quando marcada, com o interruptor ligado".

## Tarefas
- [x] T1: story e levantamento.
- [x] T2: regras puras `shared/dolores/marcacao.ts` (detecção da menção, pergunta, fora de escopo, saída segura, frases fixas).
- [x] T3: migração 0129 + `drizzle/schema-dolores-marcacoes.ts` + drizzle.config + testes-banco.
- [x] T4: leituras do grupo (`server/dolores/leitura/grupo-marcado.ts`) — conjunto fechado, contexto do servidor, lista de campos.
- [x] T5: laço do grupo `server/dolores/marcacao.ts` (tetos, idempotência, porta da chave, envio único) e ligação no webhook.
- [x] T6: canal `grupo` no filtro; função `dolores_grupo` no modelo por função; envio ao grupo em `evolution.ts`.
- [x] T7: rotas `dolores.grupos.*` (marcações) e tela `DoloresGruposCard`.
- [x] T8: testes (tentativa → resultado auditado); testes antigos ajustados.
- [x] T9: docs; tsc, testes, build, suíte completa.

## File List
Novos:
- `shared/dolores/marcacao.ts` (regras puras: marcação por código, pergunta, fora de escopo, rótulo seguro, saída segura, prompt fixo)
- `drizzle/0129_dolores_marcacoes.sql`, `drizzle/schema-dolores-marcacoes.ts`
- `server/dolores/marcacao.ts` (laço do grupo, tetos, idempotência, porta das 3 leituras, envio único a grupo, lista da tela)
- `server/dolores/leitura/grupo-marcado.ts` (`andamento_do_grupo`, `documentos_pendentes_do_grupo`, `proximos_passos_do_grupo`)
- `server/dolores/marcacao.test.ts` (30 testes)
Alterados:
- `server/dolores/dados-pessoais.ts` (canal `grupo`: sempre mascarado), `server/dolores/consumo.ts` (`reservarMarcacao`, reservas das
  marcações somadas às do dono e da classificação), `server/dolores/whatsapp.ts` (`credencialDaMarcacao`, `bloqueioAtual` aceita
  "dolores_grupo", chamada no ramo de grupo), `server/_core/evolution.ts` (`enviarTextoAoGrupoEvolution`, `participantesDoGrupoEvolution`)
- `shared/funcoes-anthropic.ts` (função `dolores_grupo`), `server/dolores/grupos-router.ts` (`marcacoes`, `salvarMarcacoes`,
  `ligarMarcacaoGrupo`, `conferirLidDolores`), `client/src/components/admin/DoloresGruposCard.tsx` (seção "Responder no grupo quando marcada")
- `server/dolores/leitura/grupos.ts` (`marcacoesRecentes` em `ler_grupo_cliente`), `server/dolores/{funcoes,permissoes,prompt,testes-banco}.ts`
- `drizzle.config.ts`, `docs/dolores/{como-ligar.md,agente-etapa4.md,ferramentas-etapa1.json}`, `docs/stories/epics/epic-025-dolores/E4-grupos.md` (nota)
- testes: `server/dolores/grupos.test.ts` (sem marcação real + interruptor ligado → nada vai ao grupo), `server/integracoes-modelo-por-funcao.test.ts`

## Dev Notes
- [AUTO-DECISION] @lid da Dolores → conferido pela Evolution (lista de participantes de um grupo cadastrado, só leitura) e guardado
  junto com o número para o qual vale; número mudou = @lid não vale (reason: grupos novos mencionam por @lid; o número sozinho não
  basta e um @lid digitado pelo admin não seria "conferido").
- [AUTO-DECISION] Citação (reply) a mensagem dela sem menção → NÃO conta; menção dentro da mensagem citada → não conta; editada
  (inclusive a que acrescenta a menção), reação, encaminhada, visualização única, enquete/botão → não contam; temporária desembrulhada
  → conta (reason: "na dúvida, não responde"; a temporária é só o modo do grupo).
- [AUTO-DECISION] `data.contextInfo` do aviso da Evolution também vale como fonte de menção (reason: a Evolution v2 copia o
  contextInfo do conteúdo para o aviso; o conteúdo citado nunca é lido).
- [AUTO-DECISION] Fora de escopo decidido por CÓDIGO antes da IA, com lista larga (ação, valores, contrato, prazo, reclamação, dado
  pessoal, outro cliente, injeção, link, código da fila, ≥ 8 dígitos, pergunta longa) → frase fixa sem gasto (reason: segurança acima
  da utilidade, ordem do dono). Perguntas de andamento/documentos passam ("falta o comprovante de endereço?" passa).
- [AUTO-DECISION] Prazo previsto, previsão de término e datas de compromisso NÃO saem nas leituras do grupo (só a data da última
  movimentação) (reason: "nunca promete prazo"; uma previsão lida no grupo vira promessa).
- [AUTO-DECISION] Saída do modelo com cara de valor, promessa, prazo, dado pessoal, link ou "aprovar CÓDIGO" → frase fixa (não se
  tenta "consertar" o texto).
- [AUTO-DECISION] IA desligada / pausada / sem chave / sem modelo / sem limite / limite atingido → SILÊNCIO registrado, sem frase
  (reason: o mais discreto; nada vai ao grupo quando a Dolores está desligada). Também vale para as frases fixas (a porta da chave é
  conferida antes de qualquer envio, sem gastar nada).
- [AUTO-DECISION] Tetos padrão: 20 respostas por grupo/dia, 5 marcações por pessoa/hora, janela de frescor 120 s (configuráveis:
  1–200, 1–30, 30–600). Teto do grupo: uma frase fixa por grupo/dia, depois silêncio. Teto da pessoa: silêncio.
- [AUTO-DECISION] Orçamento: a resposta em grupo usa no máximo 80% do limite mensal (a mesma folga do dono da classificação);
  3 voltas, 400 tokens de saída, reserva de 6 mil de entrada por chamada; chamada sem resposta conta a reserva como custo.
- [AUTO-DECISION] Marcada sem pergunta → frase fixa de apresentação; grupo sem cliente ligado → frase fixa, sem IA.
- [AUTO-DECISION] Sem prefixo "Dolores:" no grupo (quem envia já é o número dela).
- [AUTO-DECISION] O trecho citado no envio (o WhatsApp mostra a citação) vai filtrado (dados pessoais mascarados, sem link, 100 caracteres).
- [AUTO-DECISION] Registro: toda marcação em grupo CADASTRADO e ativo gera linha (inclusive silêncio por interruptor/teto/IA);
  grupo não cadastrado/desativado e marcação antiga não geram linha (como o registro da etapa 4).
- [AUTO-DECISION] Auditoria em `dolores_acoes` com canal "whatsapp" (o CHECK antigo não tem "grupo"; não se altera tabela antiga) e
  funções `grupo_marcacao`, `grupo_leitura`, `grupo_resposta`.
- [AUTO-DECISION] Idempotência: reentrega com o mesmo id antes da reivindicação pode somar 1 nos contadores (não responde duas vezes).

## Progresso
- fcf648a story; 7609e15 regras puras + canal grupo + migração 0129; 639aa30 laço, leituras, envio único, porta da chave;
  14d61b2 rotas e tela; 4241a91 27 testes; aac8e90 docs; 07e0400 testes antigos da etapa 4 + guarda do envio único;
  b9866d1 @lid pela Evolution.
- Verificação (17/11): `npx tsc --noEmit` ok; `npx vite build` ok; suíte-alvo 41 arquivos / 563 testes (2 falhas esperadas do modelo
  por função, corrigidas: a lista ganhou "dolores_grupo"); marcacao.test.ts 30/30. Migração 0129 NÃO aplicada.

## Change Log
- 17/11/2026 — @dev (Dex): story criada (InProgress) a partir da decisão do dono de 17/11.
- 17/11/2026 — @dev (Dex): implementação concluída (InProgress → InReview).
