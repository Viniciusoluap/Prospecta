# C3 — Categorias dos grupos, iguais e explicadas em todo lugar

Status: InReview (ramo `epic027-d`; implementada, aguarda o portão de QA de segurança).
Epic: EPIC-027 — Correções de 20/11/2026 (noite) (`EPIC.md`).
Paridade: a Dolores é exceção (exclusiva do Prospecta); nada a portar para o Grupo Santa Fé.
Migração: `drizzle/0144_dolores_grupos_so_admin_classifica.sql` (só a função do gatilho; NÃO aplicada) sobre a `drizzle/0139_dolores_grupos_classificar_pela_tela.sql` (aplicada) (troca a função do gatilho e acrescenta 2 colunas anuláveis; NÃO aplicada — aplicar no Neon
na publicação).

## Pedido do dono (prints de 20/11, noite) e decisões do EPIC
- Mesma lista de 6 categorias (cliente, pós-atendimento, jurídico, administrativo (sócios), parceiros comerciais, engenharia)
  na tela, na pergunta da Dolores e no comando, com uma linha do que cada uma permite. Hoje a orientação mostra só 5, com nomes
  diferentes (`grupo <código> cliente <nº> | jurídico | administrativo | parceiros | engenharia`).
- Pergunta da Dolores ao dono com opções NUMERADAS (pode responder só com o número; o comando antigo continua).
- Botão "Corrigir tipo ou vínculo" em TODO grupo aceito, inclusive "não identificado · aguardando o dono" (hoje só "Ignorar").
- Classificar: **SÓ o administrador** pela tela e o dono pelo WhatsApp (regra CORRIGIDA pelo dono em 21/11, abaixo). **Aceitar grupo recusado / sem prova continua só do dono pelo
  WhatsApp** (regra de 19/11).

## Regra corrigida pelo dono (21/11/2026) — vale acima do que está riscado como histórico abaixo
Palavras dele: "eu disse que o colaborador pode ter acesso às mensagens do grupo assim como as mensagens dos clientes, mas em
nenhum momento eu falei que ele iria classificar". Portanto:
- [x] `dolores.grupos.definirTipo` é só do admin por PAPEL (admin ativo); colaborador, com ou sem o módulo WhatsApp, recebe o
      FORBIDDEN genérico do módulo ANTES de qualquer consulta (sem nome, código nem "existe/não existe"). Saíram a entrada do mapa
      em `server/_core/trpc.ts`, `colaboradorPodeClassificar`, `TIPOS_DO_COLABORADOR`, as frases e toda a tela do colaborador.
- [x] Gatilho (migração 0144, a 0139 já está em produção): fora de 'whatsapp:%', mudar tipo ou vínculo ou tirar o grupo de
      'aguardando_dono' exige 'tela:<id de administrador ativo>'; qualquer outro valor → "só o administrador classifica o grupo
      pela tela". A fila (ligar o grupo ao card aprovado) passa a gravar quem aprovou: 'whatsapp:fila:<id>' ou 'tela:<id>'.
- [x] Portão da C2: a rota filtra pela instância da empresa e classificar pela tela não reativa grupo desativado.
- Os achados 1, R2-* e R3-2 do colaborador (abaixo) ficam como histórico: a trava do colaborador foi substituída por "nunca".
  Continuam valendo: aviso ao dono a cada classificação pela tela (com o vínculo), resposta numerada com 30 min e confirmação,
  obra excluída → calado, `ligadoPorPadrao`, quadro de marcações.

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
- [x] AC5 (SUBSTITUÍDO pela regra de 21/11: só o admin): servidor — `dolores.grupos.definirTipo` aceitava admin e colaborador com o módulo WhatsApp (mapa de procedimentos +
      PAPEL); corretor, cliente e colaborador sem o módulo: FORBIDDEN. Colaborador não desativa ("ignorar") nem "aceitar". O
      resto de `dolores.*` continua só do admin.
- [x] AC6: a tela nunca aceita grupo recusado/sem prova: `decidirGrupo` recusa "aceitar" e qualquer tipo para eles pela tela; o
      gatilho (0139) só deixa a TELA (`decidido_por` 'tela:%') tirar de "aguardando o dono" o grupo que o dono adicionou ou aceitou,
      sem mexer em quem adicionou nem na prova; recusado e sem prova continuam só com 'whatsapp:%'; 'fila:' segue barrada.

## Portão de QA de segurança (21/11) — CONCERNS, corrigido
- [x] Achado 1 (IMPORTANTE, escalada de escopo): (a) colaborador só põe/tira cliente, pós-atendimento e engenharia, e só mexe em
      grupo desses tipos ou "não identificado"; administrativo (sócios), jurídico e parceiros comerciais só o admin define ou tira
      — na rota `definirTipo` (`colaboradorPodeClassificar`) e no gatilho da 0139 (`tela:<id>` que não é admin ativo é barrado);
      na tela o colaborador vê só as opções dele, com a frase `FRASE_TIPOS_DO_ADMIN`. (b) toda classificação pela tela (tipo ou
      vínculo mudou) gera aviso ao dono no WhatsApp (texto fixo: grupo, tipo antes → depois, quem, quando), com contador diário
      próprio no teto de avisos de grupo; sem vaga, a classificação vale e o grupo fica com `aviso_classificacao_pendente_em`,
      que entra no relatório diário ("grupo(s) com o tipo mudado pela tela sem o aviso a você").
- [x] Achado 2 (MÉDIO): a resposta só com o número vale só até 30 min depois da última pergunta sobre o grupo
      (`pergunta_tipo_em`, gravada quando o aviso de entrada pergunta o tipo e quando o "aceitar" pergunta); fora disso, segue o
      caminho normal. Jurídico e administrativo exigem "3 sim"/"4 sim" (ou "grupo CÓDIGO 4"); sem o "sim", ela pede a confirmação
      dizendo o que o tipo libera. "1"/"2" sem o nº do cliente não engolem a mensagem (seguem o caminho normal).
- [x] Achado 3 (BAIXO, C4): `ligadoPorPadrao` só para grupo que entrou sozinho (`origem = automatico`).
- [x] Achado 4 (BAIXO, C4): a consulta do @lid usa um prazo só para as duas chamadas à Evolution (a segunda usa o que sobrou).
- [x] Rodada 2 — R2-1 (IMPORTANTE): engenharia SEM obra usa o escopo interno, então conta como tipo de admin; o colaborador só usa
      engenharia com o nº da obra e não mexe em engenharia geral (rota, gatilho e tela com o campo da obra obrigatório).
- [x] Rodada 2 — R2-2 (MÉDIO): o colaborador só classifica grupo ainda "não identificado" ou sem vínculo, e só como cliente/pós
      (com o nº) ou engenharia de uma obra; trocar ou tirar vínculo existente é do admin (rota e gatilho). Matriz completa testada.
- [x] Rodada 2 — R2-3 (BAIXO): no gatilho, fora de 'whatsapp:%', tipo de admin (antes ou depois) exige 'tela:<id de admin ativo>';
      'tela:x', 'fila:1', vazio ou id fora do formato são barrados.
- [x] Rodada 3 — R3-1 (IMPORTANTE): excluir a obra no CRM (ON DELETE SET NULL) não vira mais "engenharia geral": o gatilho da
      0139 grava o grupo como "não identificado", aguardando o dono, com `obra_excluida_em` (a exclusão da obra continua passando);
      a tela e o relatório diário mostram "obra excluída: reclassifique". Defesa em profundidade: `escopoDoGrupo` só trata
      engenharia sem obra como geral quando o dono (WhatsApp), um admin (tela) ou a entrada pelo nome a definiu; senão, silêncio.
- [x] Rodada 3 — R3-2 (MÉDIO): o aviso ao dono diz o vínculo ("ligado ao cliente «Nome» (nº N)" / "ligado a obra «Título» (nº N)");
      o colaborador é barrado quando o nome do grupo bate com UM cliente do CRM diferente do que ele está ligando (só o admin).
- Achado 5: registrado aqui, sem mudança de código nesta rodada (conforme o portão).
- Provas: `server/dolores/epic027-d-qa.test.ts` (os 3 testes "ACHADO" invertidos para "CORRIGIDO", mais o do teto de aviso).

## Decisões
- [AUTO-DECISION] "Ignorar" fica fora das opções numeradas (continua "grupo <código> ignorar") (reason: um dígito errado não
  deve desativar um grupo).
- (Revisto pelo portão de QA: a resposta só com o número agora tem janela de 30 min e confirmação para jurídico/administrativo.)
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
