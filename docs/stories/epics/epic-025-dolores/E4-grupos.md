# E4 — Grupos de clientes (leitura dos grupos cadastrados, card, classificação e Drive)

Status: InProgress
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
- [ ] AC1 — Cadastro de grupos: o administrador (PAPEL admin) liga um grupo de WhatsApp da instância da Dolores (id `…@g.us`,
      escolhido da lista que a Evolution devolve ou digitado) a um cliente do CRM, a uma obra ou a nenhum ainda (o card é criado
      depois, ao comando do dono). Ativar/desativar; nunca excluir. A Dolores só entra em grupo por ação do dono, fora do sistema.
- [ ] AC2 — Leitura: mensagem de grupo CADASTRADO e ATIVO é registrada (`dolores_grupo_mensagens`, idempotente por instância + id
      da mensagem); grupo não cadastrado ou inativo continua ignorado como hoje (nada gravado). A Dolores não responde, não reage
      e não marca como lida de propósito.
- [ ] AC3 — Segurança: conteúdo de grupo é dado de TERCEIRO, nunca comando. Mensagem do dono DENTRO do grupo não é comando;
      "aprovar CÓDIGO" escrito num grupo não aprova nada. Mensagem de grupo nunca dispara resposta, envio, ação, aprovação nem
      chamada ao modelo de conversa.
- [ ] AC4 — Card: `criar_card_cliente` (FILA): confere antes se o cliente já existe (telefone ou nome); existe → o item propõe
      LIGAR o grupo ao card existente; não existe → propõe CRIAR o card (etapa inicial) e ligar o grupo. Só depois da aprovação do
      dono, com o texto exato que ele leu (regra N3 da E3). O resumo do que foi pedido/entregue/pendente vem das leituras
      (`ler_grupo_cliente` + `listar_documentos`); registrar um resumo no histórico usa `registrar_acompanhamento`, que depois de
      ler o grupo vai para a fila (regra de contaminação da E3).
- [ ] AC5 — Classificação: cada documento/imagem recebido é classificado num ENUM fechado (RG, CNH, comprovante de endereço,
      comprovante de renda, FGTS, certidão, PIS, documento do cônjuge, matrícula, contrato, planta, foto de obra, nota fiscal,
      outro) + confiança + motivo curto, validados por zod. Confiança baixa → "confira". A IA abre o documento (suposição 3).
- [ ] AC6 — Custo: registrar mensagem não chama a IA. A classificação roda só para documento/imagem, com teto por dia (total e por
      grupo) configurável, dentro do limite mensal com a reserva da Etapa 2 (e deixando folga para os comandos do dono), e não roda
      com o interruptor da IA desligado, com a classificação desligada (padrão) ou com a Dolores pausada: o documento fica
      "a classificar". Função nova no modelo por função: "Dolores — classificação de documentos", com recomendação. A chave
      continua lida só em `bloqueioAtual` (guarda `server/integracoes-anthropic.test.ts` intacta).
- [ ] AC7 — Injeção por documento: conteúdo do documento, nome do arquivo e legenda vão ao modelo como DADO; a saída é só o enum +
      confiança + motivo (zod); nada do texto do documento vira ação, nome de pasta, destino ou link. Nome de arquivo e legenda
      sanitizados (sem caminho, sem caracteres de controle/invisíveis), e o nome no Drive é montado pelo sistema (rótulo + data).
- [ ] AC8 — Drive: `salvar_documentos_grupo` (FILA) propõe, por documento classificado, salvar no card do cliente e na pasta dele
      no Drive pelo organizador existente (`uploadPrivateDocument`: Clientes › Nome (nº id) › área). Aprovado: baixa o arquivo sob
      demanda, confere tamanho e formato reais, não duplica (mesmo SHA-256 no card = não envia de novo), nunca sobrescreve nem
      apaga; devolve o que salvou, o que não conseguiu e o que ainda falta pelo checklist.
- [ ] AC9 — Dados pessoais: texto do grupo gravado sempre pelo filtro do registro (dados pessoais mascarados; senhas, segredos e
      dados bancários sempre); remetente só mascarado; nenhum arquivo guardado no banco (só referência + metadados); retenção do
      pendente definida e documentada, SEM rotina que apague registros.
- [ ] AC10 — Webhook e 60 s: idempotência por id da mensagem; mídia acima do limite não é baixada; baixar só sob demanda e com
      prazo; teto diário de mensagens registradas por grupo (spam só soma contagem) e no máximo uma classificação por aviso.
- [ ] AC11 — Limites fixos intactos: nunca excluir registro, pagar, editar lançamento confirmado, mexer em usuários/credenciais/
      dados bancários, assinar documento, enviar mensagem a cliente/terceiro/grupo.
- [ ] AC12 — Migração `drizzle/0126_dolores_grupos.sql` só aditiva e idempotente (não aplicada aqui); schema em `drizzle.config.ts`.
- [ ] AC13 — Rotas e tela (cadastro de grupos, pendências de classificação): só admin por PAPEL, testadas pelo `appRouter` com o
      caminho completo; tela funciona em computador e iPad.

## Tarefas
- [ ] T1: levantamento (webhook da Dolores, Evolution — mídia e grupos —, documentos do cliente, Drive, fila da E3).
- [ ] T2: migração 0126 + `drizzle/schema-dolores-grupos.ts` + drizzle.config.
- [ ] T3: regras puras `shared/dolores/grupos.ts` (leitura do aviso de grupo, enum, sanitização, formato por bytes, saída da IA).
- [ ] T4: `server/dolores/grupos.ts` (registro no webhook, cadastro, contagens) e ligação no `whatsapp.ts`.
- [ ] T5: `server/dolores/classificacao.ts` (IA com teto, reserva e interruptores) + função no modelo por função.
- [ ] T6: leituras `listar_grupos`/`ler_grupo_cliente`; ações `criar_card_cliente`/`salvar_documentos_grupo`
      (`server/dolores/documentos-cliente.ts`); permissões etapa 4; prompt.
- [ ] T7: rotas `dolores.grupos.*` e tela `DoloresGruposCard`.
- [ ] T8: testes (cada regra dura: tentativa → recusa auditada; veneno em mensagem, legenda e nome de arquivo).
- [ ] T9: docs (`como-ligar.md` Etapa 4, `agente-etapa4.md`), HANDOFF; tsc, testes, build.

## File List
(preenchida ao longo da implementação)

## Dev Notes
(decisões [AUTO-DECISION] registradas ao longo da implementação)

## Change Log
- 16/11/2026 — @dev (Dex): story criada (Draft → InProgress), critérios tirados do prompt mestre (seções 4.4, 5, 6, 7 e 9).
