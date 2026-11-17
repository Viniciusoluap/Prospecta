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
- `server/dolores/grupos-qa.test.ts` (19 testes: regressões do portão de QA de 17/11, versões invertidas dos ataques)
- `server/dolores/grupos-qa-r2.test.ts` (regressões da 2ª rodada do QA: N0–N6)
- `drizzle/0130_dolores_fila_guarda.sql` (guarda da fila da E3 aceita o SET NULL de quem decidiu)
- `docs/dolores/agente-etapa4.md`
Alterados:
- `drizzle.config.ts`, `shared/funcoes-anthropic.ts` (função `dolores_documentos`), `shared/dolores/whatsapp.ts` (exports)
- `server/dolores/{whatsapp,consumo,permissoes,funcoes,aprovacoes,router,prompt,testes-banco}.ts`, `server/dolores/acoes/registro.ts`
- `server/_core/evolution.ts` (`listarGruposEvolution`, só leitura; `semRedirecionamento` opcional, ligado só na Dolores)
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
- Verificação (17/11): `npx tsc --noEmit` ok; suíte-alvo 44 arquivos / 584 testes ok; `npx vite build` ok; suíte completa
  248 arquivos / 2568 testes ok (2 processos). Migração 0126 NÃO aplicada.

## Correções do portão de QA (17/11, Quinn → Dex)
| # | Achado | Correção | Commit |
|---|---|---|---|
| 1 | Gatilho da 0126 barrava o `ON DELETE SET NULL` de `lead_document_id` (excluir documento / lead arquivado) | o vínculo pode virar NULL; `salvo` continua final; revisão das FKs achou mais um: a tela gravava o admin em `dolores_acoes.autor_user_id` (RESTRICT) e impedia excluir o usuário — o admin vai no resumo (`porUserId`) | 3901fef |
| 2 | PDF com /ObjStm furava o teto de 5 páginas | `paginasPdfEstimadas` devolve null ("não sei") com /ObjStm, /XRef em fluxo, escape `#xx` em nome da estrutura, /Kids sem fechar ou nenhuma página → não envia o arquivo; conta pelo maior entre /Type /Page, /Contents, /Kids e /Count; reserva do pior caso 3 mil + 5 × 5 mil = 28 mil; uso real acima da reserva → `excesso_entrada` no total do dia e classificações pausadas até amanhã | 108ffcc |
| 3 | Download inteiro antes de conferir o tamanho | `fetchComTeto`: Content-Length e leitura em fluxo cortadas em `maxBytes × 4/3 + 64 KB`, com abort | 7c74e8e |
| 4 | Motivo do modelo com link e "aprovar CÓDIGO" | `motivoDaIaSeguro` (uma linha, ≤ 160, sem link/host, @, barra, 4+ dígitos, verbos de decisão/comando, código da fila ou palavra com letras e dígitos); senão grava `MOTIVO_OMITIDO` | 491972a |
| 5 | Chamada sem resposta fora da contabilidade | tempo limite/rede/5xx/408 registram a reserva como custo (`parada = estimado_sem_resposta`); 4xx não | 6a48252 |
| 6 | `criar_card_cliente` só via homônimo exato | `clientesCandidatos` (nome parcial normalizado e telefone mascarado de quem mandou no grupo); o item lista os parecidos; "como o dono indicou" só se o número está na mensagem do dono | 88b13dc |
| 7 | Id de grupo antigo mostrava o telefone | `jidDeGrupoParaExibir` na lista da Evolution | 2e52133 |
| 8 | Pendências vencidas na tela | `pendenciasDeClassificacao` filtra pela retenção | e3e99af |

- Verificação depois das correções (17/11): tsc ok; suíte-alvo 45 arquivos / 603 testes ok; `vite build` ok; suíte completa
  249 arquivos / 2587 testes ok (2 processos). `server/integracoes-anthropic.test.ts` sem mudança. Migração 0126 NÃO aplicada.
- [AUTO-DECISION] Contagem prévia de tokens da API → não usada (o projeto não tem esse caminho; regra conservadora).
- [AUTO-DECISION] Coluna `excesso_entrada` entra no CREATE TABLE da 0126 (ainda não aplicada; o teste estático da etapa proíbe ALTER).

## Correções da 2ª rodada do portão de QA (17/11, Quinn → Dex)
| # | Achado | Correção | Commit |
|---|---|---|---|
| N0 | Rajada de PDFs densos estourava o limite mensal e bloqueava o dono | (1) contagem prévia `client.messages.countTokens` (existe no SDK 0.106.0 instalado) com o MESMO modelo, instrução, ferramenta, conteúdo e chave da chamada, prazo de 5 s: acima da reserva (28,3 mil), com erro, fora do prazo ou número inválido → o arquivo não vai (só nome ≤ 160 e legenda ≤ 300 caracteres, sempre "confira"); (2) uma classificação por vez, global, conferida no `FOR UPDATE` de `reservarClassificacao` (`outra_classificacao`); (3) orçamento próprio da classificação (`dolores_grupos_config.orcamento_classificacao_pct`, padrão 20%, 1–50, na tela) sobre o uso REAL da classificação no mês (`dolores_grupos_consumo_mes`, tabela nova na 0126) + a reserva; continua o teto de 80% somando tudo | 6570e83, b7826a3 |
| N1 | Estimativa de páginas furada (NUL, `\f`, comentário nos /Kids, `/Count +60`, página sem /Type) | NUL e `\f` como espaço, comentário entre os termos das referências, `/Count` com `+`/decimal, conta `/Parent`; comentário dentro de /Kids ou `/Count` indireto → "não sei" | f8c93a6 |
| N2 | Admin que decidiu item da fila pela tela não podia ser excluído (E3, já em produção) | `drizzle/0130_dolores_fila_guarda.sql`: `CREATE OR REPLACE FUNCTION dolores_aprovacoes_guarda()` com o corpo da 0125 + exceção para a ÚNICA mudança `decidido_por_user_id` → NULL (linha inteira comparada em jsonb). `autor_user_id` segue RESTRICT (de propósito). FKs de 0123–0126 revisadas | 5d4f993 |
| N3 | Um PDF denso pausava a classificação de todos os grupos | o excesso fica na linha do GRUPO; só ele pausa no dia; a tela segue para os outros grupos | 6570e83 |
| N4 | Evolution seguia redirecionamento levando o `apikey` | `EvolutionConfig.semRedirecionamento` (opcional, `redirect: "error"`), ligado nos 4 pontos da Dolores e no download (`fetchComTeto`); a Central de Vendas fica igual | 09ce2d6 |
| N5 | Motivo da IA com homóglifo/largura total | `normalize("NFKC")` antes das conferências e só letras latinas com os acentos do português | ef299a4, 3730490 |
| N6 | "como o dono indicou" com qualquer número no texto | `clienteIndicadoNoTexto`: só "cliente N", "card N", "lead N" (nº/número/# opcionais) ou "#N" | 2efc6c2 |

- Testes de regressão: `server/dolores/grupos-qa-r2.test.ts` (versões invertidas de `ataques-r2*.test.ts` e `extra.test.ts`);
  `grupos-qa.test.ts` ajustado (excesso por grupo).
- [AUTO-DECISION] Orçamento próprio padrão → 20% do limite mensal, configurável de 1% a 50% (reason: "padrão conservador"; com 1 milhão
  de entrada, 200 mil dão ~100 classificações típicas de 1,5–2 mil tokens).
- [AUTO-DECISION] Consumo da classificação em tabela própria (`dolores_grupos_consumo_mes`, na 0126) e não marcado em `dolores_consumo`
  (reason: a 0124 já está em produção; `mensagem_id` nulo não identifica a classificação, porque vira nulo também por SET NULL).
- [AUTO-DECISION] Sem pausa global por excesso, nem quando dois grupos passam (reason: pedido do lead; o orçamento próprio e a
  uma-por-vez já limitam o dano a uma chamada).
- [AUTO-DECISION] Redirecionamento recusado só na Dolores (reason: `evolution.ts` é compartilhado com a Central de Vendas e é gêmeo do
  Grupo Santa Fé; sem prova de que nenhuma instalação dependa do redirecionamento, o padrão não muda lá).
- Verificação (17/11, depois de 14b22ad): `npx tsc --noEmit` ok; suíte-alvo 46 arquivos / 630 testes (1 falha do guarda de log
  `whatsapp-qa.test.ts` corrigida em 14b22ad e reexecutada: ok); `npx vite build` ok; suíte completa 250 arquivos / 2614 testes ok
  (2 processos). `server/integracoes-anthropic.test.ts` sem mudança e verde.
- 0126 editada de novo (só dentro do CREATE TABLE e uma tabela nova; continua aditiva; NÃO aplicada): conferir antes
  `SELECT to_regclass('dolores_grupos_contagem')` = NULL. 0130 nova, NÃO aplicada.

## Change Log
- 16/11/2026 — @dev (Dex): story criada (Draft → InProgress), critérios tirados do prompt mestre (seções 4.4, 5, 6, 7 e 9).
- 17/11/2026 — @dev (Dex): implementação concluída (InProgress → InReview); tsc, build, suíte-alvo (584) e completa (2568) verdes.
- 17/11/2026 — @dev (Dex): 8 achados do portão de QA corrigidos, com 19 testes de regressão (`grupos-qa.test.ts`).
- 17/11/2026 — @dev (Dex): 2ª rodada do QA (N0–N6) corrigida, com testes de regressão em `grupos-qa-r2.test.ts`; migração 0130 nova.
