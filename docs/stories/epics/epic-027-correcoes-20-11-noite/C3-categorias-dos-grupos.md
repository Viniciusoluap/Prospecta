# C3 — Categorias dos grupos, iguais e explicadas em todo lugar

Status: InReview (ramo `epic027-d`; implementada, aguarda o portão de QA de segurança).
Epic: EPIC-027 — Correções de 20/11/2026 (noite) (`EPIC.md`).
Paridade: a Dolores é exceção (exclusiva do Prospecta); nada a portar para o Grupo Santa Fé.
Migração: `drizzle/0139_dolores_grupos_classificar_pela_tela.sql` (só troca a função do gatilho; NÃO aplicada — aplicar no Neon
na publicação).

## Pedido do dono (prints de 20/11, noite) e decisões do EPIC
- Mesma lista de 6 categorias (cliente, pós-atendimento, jurídico, administrativo (sócios), parceiros comerciais, engenharia)
  na tela, na pergunta da Dolores e no comando, com uma linha do que cada uma permite. Hoje a orientação mostra só 5, com nomes
  diferentes (`grupo <código> cliente <nº> | jurídico | administrativo | parceiros | engenharia`).
- Pergunta da Dolores ao dono com opções NUMERADAS (pode responder só com o número; o comando antigo continua).
- Botão "Corrigir tipo ou vínculo" em TODO grupo aceito, inclusive "não identificado · aguardando o dono" (hoje só "Ignorar").
- Classificar: admin e colaborador com o módulo WhatsApp. **Aceitar grupo recusado / sem prova continua só do dono pelo
  WhatsApp** (regra de 19/11).

## Critérios de aceite
- [x] AC1: uma única fonte em `shared/dolores/grupos-tipo.ts` (`CATEGORIAS_GRUPO`: opção 1–6, tipo, rótulo, linha do que
      permite, vínculo). A tela, o aviso/pergunta ao dono (`textoDoAvisoDeEntrada`, `perguntaDoTipo`), as respostas do
      `decidirGrupo` e o comando usam essa lista.
- [x] AC2: a pergunta ao dono traz as 6 opções numeradas e explicadas. O dono pode responder: só o número ("3"; "1 456" para
      cliente com o nº do CRM; "6 12" para engenharia com a obra), "grupo <código> <número>" ou o comando antigo
      ("grupo <código> jurídico"). Só o número do dono, na conversa direta, sem mídia e não encaminhada (checagem estrita já
      existente); de grupo ou de outro número nada muda. Sem IA.
- [x] AC3: a resposta só com o número vale para o ÚNICO grupo que espera o tipo (aceito, tipo indefinido, ativo); com mais de um,
      ela lista os grupos e pede o código (nada muda); sem nenhum, a mensagem segue o caminho normal. Cliente/pós sem o nº: pede o
      nº (nada muda). Grupo recusado ou sem prova nunca é resolvido pela resposta numerada.
- [x] AC4: tela — todo grupo aceito tem "Definir tipo ou vínculo" (tipo indefinido) / "Corrigir tipo ou vínculo"; recusado e sem
      prova mostram só "o dono responde 'grupo CÓDIGO aceitar'" e "Ignorar este grupo". A lista de tipos mostra o número, o rótulo
      e a linha do que a categoria permite. Texto do topo do cartão simplificado, com a lista das 6 categorias.
- [x] AC5: servidor — `dolores.grupos.definirTipo` aceita admin e colaborador com o módulo WhatsApp (mapa de procedimentos +
      PAPEL); corretor, cliente e colaborador sem o módulo: FORBIDDEN. Colaborador não desativa ("ignorar") nem "aceitar". O
      resto de `dolores.*` continua só do admin.
- [x] AC6: a tela nunca aceita grupo recusado/sem prova: `decidirGrupo` recusa "aceitar" e qualquer tipo para eles pela tela; o
      gatilho (0139) só deixa a TELA (`decidido_por` 'tela:%') tirar de "aguardando o dono" o grupo que o dono adicionou ou aceitou,
      sem mexer em quem adicionou nem na prova; recusado e sem prova continuam só com 'whatsapp:%'; 'fila:' segue barrada.

## Decisões
- [AUTO-DECISION] "Ignorar" fica fora das opções numeradas (continua "grupo <código> ignorar") (reason: um dígito errado não
  deve desativar um grupo).
- [AUTO-DECISION] A resposta só com número não tem prazo desde a pergunta (reason: só vale com exatamente um grupo esperando o
  tipo e a resposta sempre confirma o que foi feito; corrigir é um comando). Risco registrado: com um grupo esperando, um "3" solto
  do dono numa conversa sobre outro assunto classifica o grupo (ele vê a confirmação e corrige).
- [AUTO-DECISION] Colaborador com WhatsApp: a rota está pronta e testada; a tela dele para classificar entra com a C2 (grupos na
  Central), que é onde o colaborador vê os grupos — o cartão da Dolores fica em Integrações (só admin).

## Testes
- `server/dolores/c3-categorias-grupos.test.ts` (9): lista única (6, numeradas, rótulos, tipos do sistema), pergunta numerada e
  tela sem lista própria, comando antigo + numerado + só o número (válidos e inválidos), resposta só com o número pelo dono (de
  outro número e de grupo não muda), vários esperando / falta nº, classificar pela tela (admin e colaborador com WhatsApp; aceito
  pelo dono e adicionado pelo dono; interruptor nasce ligado), quem pode (sem módulo, corretor, cliente; colaborador não ignora
  nem aceita), a tela nunca aceita recusado/sem prova (rota e gatilho), 0139 idempotente e sem DDL de tabela.
- Ajustados para a decisão nova do dono: `grupos-automaticos.test.ts` (texto do aviso; colaborador com WhatsApp classifica) e
  `grupos-qa-seg-e7-r2.test.ts` (R2-3: grupo que o dono adicionou, de tipo indefinido, agora é classificável pela tela; o 'fila:'
  continua barrado).

## Arquivos
- `shared/dolores/grupos-tipo.ts`, `server/dolores/grupos-decisao.ts`, `server/dolores/grupos-router.ts`, `server/dolores/whatsapp.ts`,
  `server/_core/trpc.ts`, `client/src/components/admin/DoloresGruposCard.tsx`, `drizzle/0139_dolores_grupos_classificar_pela_tela.sql`,
  `server/dolores/testes-banco.ts`, `server/dolores/c3-categorias-grupos.test.ts`

## Change Log
- 20/11/2026 — @dev (Dex): Draft → InProgress → InReview. Implementada no ramo `epic027-d`.
