# E4 — Grupos de clientes (leitura dos grupos cadastrados, card, classificação e Drive)

Status: InReview
Epic: EPIC-025 (Etapa 4) — "Operação Dolores — Prompt Mestre" (16/11/2026), seção 7, linha 4; seções 4.4, 5, 6 ("Mudança em
comportamento existente") e 9 (suposições).
Paridade: suspensa por ordem do dono em 16/11 (Grupo Santa Fé em espera); registrar no ROADMAP ao fechar o epic.
Tamanho estimado: G
Dependência: E3 (fila de aprovação, porta `executarFuncao`, regra de contaminação) — ramo `claude/epic025-dolores-etapa3` (`25ccea2`).

## Problema

Até a etapa 3 o sistema descarta toda mensagem de grupo. O prompt mestre (seção 4.4) quer que a Dolores participe do grupo em
que a documentação do cliente é enviada, crie o card do cliente no CRM ao comando do dono (conferindo antes se ele já existe),
identifique cada arquivo, salve-o no card e na pasta do cliente no Drive e devolva o que salvou, o que não conseguiu ler e o que
ainda falta pelo checklist. A seção 6 muda o comportamento: passam a ser registradas só as mensagens dos grupos cadastrados em
`dolores_grupos`; os demais continuam ignorados. Regra fixa (seção 5): "Nos grupos, ela só lê os grupos cadastrados e só fala
quando a função exige" — e nesta etapa nenhuma função exige: ela nunca fala no grupo (suposição 1: só operação interna).
Teste de aceite (seção 7): "Dolores, cria o card deste cliente e salva a documentação do grupo."

Suposições em vigor (seção 9, não reabrir): só operação interna; um grupo de WhatsApp por cliente; a IA pode abrir os
documentos; responsável dos processos migrados do Trello = "a confirmar".

## Critérios de aceite
- [x] AC1 — Cadastro de grupos: o administrador (PAPEL admin) liga um grupo de WhatsApp da instância da Dolores (id `…@g.us`,
      escolhido da lista que a Evolution devolve ou digitado) a um cliente do CRM, a uma obra ou a nenhum ainda (o card é criado
      depois, ao comando do dono). Ativar/desativar; nunca excluir. A Dolores só entra em grupo por ação do dono, fora do sistema.
- [x] AC2 — Leitura: mensagem de grupo CADASTRADO e ATIVO é registrada (`dolores_grupo_mensagens`, idempotente por instância + id
      da mensagem); grupo não cadastrado ou inativo continua ignorado como hoje (nada gravado). A Dolores não responde, não reage
      e não marca como lida de propósito.
- [x] AC3 — Segurança: conteúdo de grupo é dado de TERCEIRO, nunca comando. Mensagem do dono DENTRO do grupo não é comando;
      "aprovar CÓDIGO" escrito num grupo não aprova nada. Mensagem de grupo nunca dispara resposta, envio, ação, aprovação nem
      chamada ao modelo de conversa.
- [x] AC4 — Card: `criar_card_cliente` (FILA): confere antes se o cliente já existe (telefone ou nome); existe → o item propõe
      LIGAR o grupo ao card existente; não existe → propõe CRIAR o card (etapa inicial) e ligar o grupo. Só depois da aprovação do
      dono, com o texto exato que ele leu (regra N3 da E3). O resumo do que foi pedido/entregue/pendente vem das leituras
      (`ler_grupo_cliente` + `listar_documentos`); registrar um resumo no histórico usa `registrar_acompanhamento`, que depois de
      ler o grupo vai para a fila (regra de contaminação da E3).
- [x] AC5 — Classificação: cada documento/imagem recebido é classificado num ENUM fechado (RG, CNH, comprovante de endereço,
      comprovante de renda, FGTS, certidão, PIS, documento do cônjuge, matrícula, contrato, planta, foto de obra, nota fiscal,
      outro) + confiança + motivo curto, validados por zod. Confiança baixa → "confira". A IA abre o documento (suposição 3).
- [x] AC6 — Custo: registrar mensagem não chama a IA. A classificação roda só para documento/imagem, com teto por dia (total e por
      grupo) configurável, dentro do limite mensal com a reserva da Etapa 2 (e deixando folga para os comandos do dono), e não roda
      com o interruptor da IA desligado, com a classificação desligada (padrão) ou com a Dolores pausada: o documento fica
      "a classificar". Função nova no modelo por função: "Dolores — classificação de documentos", com recomendação. A chave
      continua lida só em `bloqueioAtual` (guarda `server/integracoes-anthropic.test.ts` intacta).
- [x] AC7 — Injeção por documento: conteúdo do documento, nome do arquivo e legenda vão ao modelo como DADO; a saída é só o enum +
      confiança + motivo (zod); nada do texto do documento vira ação, nome de pasta, destino ou link. Nome de arquivo e legenda
      sanitizados (sem caminho, sem caracteres de controle/invisíveis), e o nome no Drive é montado pelo sistema (rótulo + data).
- [x] AC8 — Drive: `salvar_documentos_grupo` (FILA) propõe, por documento classificado, salvar no card do cliente e na pasta dele
      no Drive pelo organizador existente (`uploadPrivateDocument`: Clientes › Nome (nº id) › área). Aprovado: baixa o arquivo sob
      demanda, confere tamanho e formato reais, não duplica (mesmo SHA-256 no card = não envia de novo), nunca sobrescreve nem
      apaga; devolve o que salvou, o que não conseguiu e o que ainda falta pelo checklist.
- [x] AC9 — Dados pessoais: texto do grupo gravado sempre pelo filtro do registro (dados pessoais mascarados; senhas, segredos e
      dados bancários sempre); remetente só mascarado; nenhum arquivo guardado no banco (só referência + metadados); retenção do
      pendente definida e documentada, SEM rotina que apague registros.
- [x] AC10 — Webhook e 60 s: idempotência por id da mensagem; mídia acima do limite não é baixada; baixar só sob demanda e com
      prazo; teto diário de mensagens registradas por grupo (spam só soma contagem) e no máximo uma classificação por aviso.
- [x] AC11 — Limites fixos intactos: nunca excluir registro, pagar, editar lançamento confirmado, mexer em usuários/credenciais/
      dados bancários, assinar documento, enviar mensagem a cliente/terceiro/grupo.
- [x] AC12 — Migração `drizzle/0126_dolores_grupos.sql` só aditiva e idempotente (não aplicada aqui); schema em `drizzle.config.ts`.
- [x] AC13 — Rotas e tela (cadastro de grupos, pendências de classificação): só admin por PAPEL, testadas pelo `appRouter` com o
      caminho completo; tela funciona em computador e iPad.

## Tarefas
- [x] T1: levantamento (webhook da Dolores, Evolution — mídia e grupos —, documentos do cliente, Drive, fila da E3).
- [x] T2: migração 0126 + `drizzle/schema-dolores-grupos.ts` + drizzle.config.
- [x] T3: regras puras `shared/dolores/grupos.ts` (leitura do aviso de grupo, enum, sanitização, formato por bytes, saída da IA).
- [x] T4: `server/dolores/grupos.ts` (registro no webhook, cadastro, contagens) e ligação no `whatsapp.ts`.
- [x] T5: `server/dolores/classificacao.ts` (IA com teto, reserva e interruptores) + função no modelo por função.
- [x] T6: leituras `listar_grupos`/`ler_grupo_cliente`; ações `criar_card_cliente`/`salvar_documentos_grupo`
      (`server/dolores/documentos-cliente.ts`); permissões etapa 4; prompt.
- [x] T7: rotas `dolores.grupos.*` e tela `DoloresGruposCard`.
- [x] T8: testes (cada regra dura: tentativa → recusa auditada; veneno em mensagem, legenda e nome de arquivo).
- [x] T9: docs (`como-ligar.md` Etapa 4, `agente-etapa4.md`), HANDOFF; tsc, testes, build.

## File List
Novos:
- `drizzle/0126_dolores_grupos.sql`, `drizzle/schema-dolores-grupos.ts`
- `shared/dolores/grupos.ts` (regras puras: aviso de grupo, enum, saída zod, sanitização, formato por bytes)
- `server/dolores/grupos.ts` (registro no webhook, vínculo, tela), `server/dolores/classificacao.ts` (IA com tetos e reserva),
  `server/dolores/documentos-cliente.ts` (execução aprovada: card e Drive), `server/dolores/acoes/grupos.ts` (preparo da fila),
  `server/dolores/leitura/grupos.ts` (`listar_grupos`, `ler_grupo_cliente`), `server/dolores/grupos-router.ts` (`dolores.grupos.*`)
- `client/src/components/admin/DoloresGruposCard.tsx`
- `server/dolores/grupos.test.ts` (24 testes)
- `docs/dolores/agente-etapa4.md`
Alterados:
- `drizzle.config.ts`, `shared/funcoes-anthropic.ts` (função `dolores_documentos`), `shared/dolores/whatsapp.ts` (exports)
- `server/dolores/{whatsapp,consumo,permissoes,funcoes,aprovacoes,router,prompt,testes-banco}.ts`, `server/dolores/acoes/registro.ts`
- `server/_core/evolution.ts` (`listarGruposEvolution`, só leitura)
- `client/src/pages/admin/AdminIntegracoes.tsx`
- `docs/dolores/como-ligar.md` (Etapa 4), `docs/dolores/ferramentas-etapa1.json` (regenerado: 14 leituras)
- testes existentes ajustados à etapa 4: `server/dolores/{acoes,correcoes-e3,leitura-somente,ponte,whatsapp}.test.ts`,
  `server/integracoes-modelo-por-funcao.test.ts`

## Dev Notes
- [AUTO-DECISION] Nível das ações → as duas (`criar_card_cliente`, `salvar_documentos_grupo`) são de FILA, nenhuma direta
  (reason: dado de grupo é de terceiro; seção 5 "Criar card e salvar documentos de cliente — Eu").
- [AUTO-DECISION] Mensagem do dono dentro do grupo → só registrada com `do_dono = true` (informativo) (reason: regra dura 1).
- [AUTO-DECISION] Retenção do pendente → 30 dias configurável (1–365); vencido deixa de ser oferecido, nada apagado; sem rotina
  de limpeza (reason: regra dura 4 e limite fixo "nunca excluir").
- [AUTO-DECISION] Tetos padrão → 30 classificações/dia no total, 10 por grupo/dia, 300 mensagens registradas por grupo/dia,
  10 MB por arquivo; classificação usa no máximo 80% do limite mensal (folga para os comandos do dono) (reason: AC6).
- [AUTO-DECISION] Classificação no webhook → no máximo 1 por aviso e só com ≥ 30 s de prazo; o resto fica "a classificar" e
  pode ser classificado pela tela (até 5 por clique) (reason: 60 s da Vercel).
- [AUTO-DECISION] Arquivo grande para a IA (PDF > 4 MB ou > 5 páginas, imagem > 3,75 MB) → classifica só por nome e legenda,
  confiança limitada a 0,6 = "confira" (reason: custo).
- [AUTO-DECISION] Texto de grupo gravado sempre mascarado (filtro do registro), também no canal do dono (reason: regra dura 4 —
  o que é gravado continua filtrado; a opção B vale para o que vem dos cadastros, não para o registro do grupo).
- [AUTO-DECISION] Leituras novas também aparecem na ponte HTTP (fonte única das ferramentas de leitura; a ponte não age)
  (reason: `ferramentasLiberadas` é a lista de todas as leituras liberadas; JSON regenerado).
- [AUTO-DECISION] Card ligado a cliente existente → o resumo não exige o nome digitado pelo dono (nada dele é gravado, só o
  vínculo) (reason: bug achado no teste — o item era recusado).
- [AUTO-DECISION] Classificação recusada por limite → devolve a vaga do teto diário e solta a marca de "em andamento".
- [AUTO-DECISION] Grupo de obra → `salvar_documentos_grupo` recusa ("pasta da obra chega na etapa 5") (reason: fora da etapa 4).
- [AUTO-DECISION] Lista de grupos da Evolution → GET `/group/fetchAllGroups/{instância}?getParticipants=false`, só leitura,
  nome do grupo sanitizado; o administrador também pode digitar o id.

## Progresso
- 877a0e8 story; 80f5fe7 wip (migração, regras, webhook, classificação, ações, leituras); 4a9bad3 merge da E3 (`f8232ca`);
  3787c1e rotas; tela; prompt; testes antigos ajustados; 3ef63db correções + 24 testes novos; docs.
- Verificação: ver Change Log.

## Change Log
- 16/11/2026 — @dev (Dex): story criada (Draft → InProgress), critérios tirados do prompt mestre (seções 4.4, 5, 6, 7 e 9).
