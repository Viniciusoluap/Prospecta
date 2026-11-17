# E4b — A Dolores responde no grupo quando é marcada

Status: InProgress
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
- [ ] AC1 — Marcação por CÓDIGO: só conta quando o JID/número da Dolores (o `numero_dolores` conferido da conexão, ou o `@lid`
      dela conferido pela Evolution para esse mesmo número) está na lista de menções da mensagem (`contextInfo.mentionedJid` do
      conteúdo, ou o `contextInfo` do aviso da Evolution). Escrever "@Dolores" ou o número no texto não conta. Resposta citada a uma
      mensagem dela sem menção não conta. Menção dentro da mensagem citada não conta. Editada, reação, encaminhada, visualização
      única e interação: não conta. Temporária (desembrulhada): conta. Na dúvida, não foi marcada.
- [ ] AC2 — Sem marcação: comportamento da E4 intacto (só registra, grupo cadastrado e ativo). Grupo não cadastrado ou
      desativado: nunca responde, mesmo marcada.
- [ ] AC3 — Com marcação, em grupo cadastrado e ativo e com os interruptores ligados: responde NO GRUPO, citando a mensagem, por
      um laço próprio (separado do laço do dono), com um conjunto NOVO e mínimo de leituras do grupo que recebem o cliente/obra
      pelo CONTEXTO do servidor (nunca por argumento do modelo). Função fora do conjunto ⇒ recusa auditada.
- [ ] AC4 — As leituras do grupo NUNCA devolvem CPF/CNPJ, telefone, e-mail, endereço, valores, dados bancários, anotações
      internas, histórico interno, nomes de outros clientes, corretor/comissão, responsável da equipe nem prazos previstos. Só
      situação, etapas, datas de movimento e nomes de documentos pendentes (corte no servidor; na dúvida, não devolve).
- [ ] AC5 — Filtro de saída do grupo: canal `grupo` em `dados-pessoais.ts` — dados pessoais SEMPRE mascarados (a opção B não vale),
      segredos e bancários sempre, links removidos (só o host do sistema), sem prévia, sem "@número", até 800 caracteres.
- [ ] AC6 — Nada do grupo é comando: pergunta sobre valores, contrato, prazo, reclamação, outro cliente, dado pessoal, pedido de
      ação ("aprovar", "grave", "envie para…"), "ignore as regras" ou "sou o dono" ⇒ frase fixa "Isso eu preciso confirmar com a
      equipe; já avisei.", sem chamar a IA, auditada e registrada como fora de escopo. "aprovar CÓDIGO" no grupo não aprova nada.
      O dono dentro do grupo é participante comum.
- [ ] AC7 — Compromissos: a resposta nunca promete prazo, valor, aprovação ou resultado; saída com cara de promessa, valor, link
      ou dado pessoal é trocada pela frase fixa.
- [ ] AC8 — Registro consultável de cada marcação (grupo, remetente mascarado, pergunta filtrada, resposta, fora de escopo), na
      tela e na leitura `ler_grupo_cliente`. Nenhuma mensagem ao dono a cada marcação.
- [ ] AC9 — Custo e abuso: porta `bloqueioAtual` (função nova "dolores_grupo" no modelo por função); interruptor próprio geral e
      por grupo, DESLIGADO por padrão; teto por grupo/dia e por remetente/hora; no máximo 1 resposta em andamento por grupo;
      idempotência por id da mensagem; janela de frescor. Passou do teto: silêncio (no máximo uma frase fixa por grupo/dia). IA
      desligada/sem limite/pausada: silêncio, registrado. `server/integracoes-anthropic.test.ts` intacto.
- [ ] AC10 — Envio: um único ponto novo de envio a grupo, com conferência dupla do destino (o JID do grupo cadastrado e ativo
      daquela mensagem), `linkPreview:false`, sem mencionar ninguém, sem "marcar todos". Nenhum outro caminho envia a grupo.
- [ ] AC11 — Tela (admin por PAPEL): interruptor geral e por grupo, tetos e lista de marcações com a resposta; aviso "o que ela
      escreve no grupo é lido por todos os participantes". Rotas testadas pelo `appRouter` com o caminho completo.
- [ ] AC12 — Migração `drizzle/0129_dolores_marcacoes.sql` só aditiva e idempotente, só tabelas NOVAS (não aplicada aqui).
- [ ] AC13 — Docs: `como-ligar.md` (seção "Responder no grupo quando marcada") e `agente-etapa4.md`; o que dizia "nunca responde
      em grupo" passa a dizer "só responde quando marcada, com o interruptor ligado".

## Tarefas
- [ ] T1: story e levantamento.
- [ ] T2: regras puras `shared/dolores/marcacao.ts` (detecção da menção, pergunta, fora de escopo, saída segura, frases fixas).
- [ ] T3: migração 0129 + `drizzle/schema-dolores-marcacoes.ts` + drizzle.config + testes-banco.
- [ ] T4: leituras do grupo (`server/dolores/leitura/grupo-marcado.ts`) — conjunto fechado, contexto do servidor, lista de campos.
- [ ] T5: laço do grupo `server/dolores/marcacao.ts` (tetos, idempotência, porta da chave, envio único) e ligação no webhook.
- [ ] T6: canal `grupo` no filtro; função `dolores_grupo` no modelo por função; envio ao grupo em `evolution.ts`.
- [ ] T7: rotas `dolores.grupos.*` (marcações) e tela `DoloresGruposCard`.
- [ ] T8: testes (tentativa → resultado auditado); testes antigos ajustados.
- [ ] T9: docs; tsc, testes, build, suíte completa.

## File List
(atualizada a cada commit)

## Dev Notes

## Progresso

## Change Log
- 17/11/2026 — @dev (Dex): story criada (InProgress) a partir da decisão do dono de 17/11.
