# E5 — Notas de obra (leitura da nota, rascunho, confirmação do empreiteiro, conciliação com o BPO)

Status: InReview (implementação concluída; aguarda o portão de QA)
Epic: EPIC-025 (Etapa 5) — "Operação Dolores — Prompt Mestre" (16/11/2026), seção 7, linha 5; seções 2 ("Notas de obra"),
4.5, 4.6 ("Com empreiteiros"), 5 ("Quem aprova o quê", limites fixos), 6 (`notas-obra.ts`, `conciliacao.ts`, `obra_notas`) e 9.
Paridade: suspensa por ordem do dono em 16/11 (Grupo Santa Fé em espera); registrar no ROADMAP ao fechar o epic.
Tamanho estimado: G
Dependência: E4 (grupos cadastrados, mensagens de grupo, download com teto, reserva da classificação) — ramo
`epic025-dolores-etapa4` (`a386300`), mais a `main` (E3 e termo de consentimento) mesclada no começo.

## Problema

O prompt mestre (4.5) quer que a Dolores, no grupo de WhatsApp da obra, leia a nota fiscal/de serviço que o empreiteiro envia
(emitente, CPF/CNPJ, número, data, valor, descrição), preencha o pagamento da obra como RASCUNHO (empreiteiro, categoria,
etapa, valor, data), anexe a nota e salve o arquivo na pasta da obra, apresente o rascunho ao empreiteiro (que confirma ou
corrige), procure no BPO o pagamento bancário correspondente, proponha a conciliação e informe as divergências (nota sem
pagamento, pagamento sem nota, valor diferente). Teste de aceite (seção 7): "Uma nota real enviada no grupo vira rascunho, é
confirmada e fica conciliada com o pagamento do banco".

Suposições em vigor (seção 9, não reabrir): só operação interna; um grupo por cliente; a IA pode abrir os documentos; **o
empreiteiro confirma a nota respondendo no grupo**; responsável dos processos migrados do Trello = "a confirmar".

Regras do pedido desta etapa (mais restritivas que o texto do prompt, e por isso valem): a Dolores NUNCA escreve no grupo —
quem pede a confirmação ao empreiteiro é uma pessoa (o sistema mostra o texto sugerido); a "confirmação" é só um DADO
reconhecido por código; a conciliação só APONTA e qualquer vínculo vai para a fila de aprovação do dono.

## Critérios de aceite
- [x] AC1 — Grupo de obra habilitado: documento/imagem que chega num grupo cadastrado e ligado a uma OBRA vai para a leitura de
      nota (não para a classificação da E4); grupo de cliente continua exatamente como na E4.
- [x] AC2 — Leitura da nota: IA com o documento aberto (modelo da função nova "Dolores — leitura de notas de obra"), saída numa
      ferramenta única com estrutura fechada validada por zod: tipo (NF-e, NFS-e, NFC-e, recibo, cupom, outro), emitente,
      CPF/CNPJ, número, data, valor total, descrição, itens (até 30), chave de acesso, categoria e etapa sugeridas (enums do
      sistema), sinais (ilegível, adulteração, dados bancários presentes) e confiança POR CAMPO. Confiança baixa → "confira".
- [x] AC3 — Conferência determinística (código, não o modelo): dígito verificador do CNPJ/CPF; soma dos itens × total; data
      plausível (não futura, não absurda); valor > 0 e dentro do teto; chave de NF-e (estrutura, DV) cruzada com CNPJ,
      número e mês da nota. O que falha ou não foi lido fica VAZIO e marcado como dúvida — nunca inventado.
- [x] AC4 — Rascunho: a leitura vira um RASCUNHO interno da Dolores (`obra_notas`), nunca um lançamento: obra do grupo,
      empreiteiro da obra (só sugerido quando o CPF/CNPJ da nota confere com o cadastro dele), categoria, etapa, valor, data,
      dúvidas e alertas. Visível para o admin (tela) e para o dono (leitura `listar_notas_obra`).
- [x] AC5 — Injeção por documento: a nota vai ao modelo como DADO; nada do texto vira ação, destino, nome de pasta ou link;
      textos lidos passam pelo filtro do registro e sem links; dados bancários nunca são gravados (campo não existe na saída;
      texto filtrado; sinal "a nota traz dados bancários — não gravados").
- [x] AC6 — Nota duplicada (mesmo arquivo — SHA-256 — ou mesma chave de acesso, ou mesmo número + emitente), adulterada
      (chave que não bate) ou ilegível é SINALIZADA na nota e na tela, nunca "resolvida" em silêncio; nota duplicada não pode
      ser conciliada.
- [x] AC7 — Confirmação do empreiteiro (DADO, não autenticação): o sistema reconhece por código, no webhook, uma resposta
      inequívoca ("CONFIRMO NOTA 45", ou "confirmo" respondendo/citando a mensagem da nota) de um participante cujo telefone
      confere com o empreiteiro cadastrado DAQUELA obra, no MESMO grupo da nota, dentro do prazo — e registra remetente
      mascarado, hora e texto filtrado. "CORRIGIR NOTA 45 …" registra "correção pedida". Forjada (outro número, outro grupo,
      fora do prazo, ambígua, sem referência, negativa) → nada é confirmado e a tentativa é auditada. Confirmação não lança,
      não paga e não dispensa a aprovação do dono; a tela e a story dizem que é indício, não assinatura.
- [x] AC8 — Texto sugerido: a tela e a leitura mostram ao dono o texto para ELE MESMO enviar ao empreiteiro (com o número da
      nota no sistema e as palavras que o sistema reconhece). A Dolores não envia nada.
- [x] AC9 — Conciliação com o BPO: por nota, comparação com os lançamentos de despesa do BPO (valor, data, fornecedor — CPF/CNPJ
      do cadastro BPO ou nome do titular —, obra) e apontamento: já lançado (pagamento encontrado), provável duplicata (já
      conciliado com outra nota), divergente (valor, fornecedor ou obra), sem lançamento; e, por obra, pagamentos sem nota.
      Só aponta.
- [x] AC10 — Fila: `conciliar_nota_obra` (FILA) propõe ligar a nota ao lançamento do BPO VINDO DO BANCO (pago e com
      movimentação bancária); aprovado pelo dono, grava só o vínculo na nota (registro da Dolores) — o lançamento do BPO não é
      alterado. `salvar_nota_obra` (FILA) salva o arquivo na pasta da obra no Drive (Obras › Obra › Notas fiscais), nome
      montado pelo sistema, conferindo que o arquivo baixado é o mesmo que foi lido (SHA-256). O resumo mostra exatamente o
      que será gravado (regra N3).
- [x] AC11 — Custo: leitura só com a leitura de notas ligada (DESLIGADA por padrão) e pela porta `bloqueioAtual` (pausa →
      interruptor da IA → chave → modelo da função → limite → usuária), teto diário de leituras, reserva do pior caso dentro da
      fração do limite da E4 (folga do dono), pausa do dia se o uso real passar da reserva, travas de tamanho/páginas e
      download com teto da E4; no webhook, no máximo uma chamada de IA por aviso. Registrar mensagem e reconhecer confirmação
      não chamam a IA. Chave lida só no ponto único (guarda `server/integracoes-anthropic.test.ts` intacta).
- [x] AC12 — Limites fixos intactos: nunca pagar, baixar, estornar; nunca editar lançamento confirmado; nunca excluir; nunca
      assinar; nunca enviar mensagem a cliente, empreiteiro ou grupo; nunca mexer em usuários/credenciais/dados bancários.
- [x] AC13 — Migração `drizzle/0128_dolores_notas.sql` só aditiva e idempotente (não aplicada aqui); FKs revisadas contra os
      gatilhos (o `ON DELETE SET NULL` de obra, usuário, lançamento do BPO não é barrado); schema em `drizzle.config.ts`.
- [x] AC14 — Rotas e tela (`dolores.notas.*`, `DoloresNotasCard`): só admin por PAPEL, testadas pelo `appRouter` com o caminho
      completo; computador e iPad.

## Tarefas
- [x] T1: levantamento (E4: webhook de grupo, classificação, download, reserva; obras, empreiteiros, obra_movimentos, BPO, Drive).
- [x] T2: migração 0128 + `drizzle/schema-dolores-notas.ts` + drizzle.config.
- [x] T3: regras puras `shared/dolores/notas.ts` (saída zod, conferências, duplicidade, confirmação, conciliação, texto sugerido).
- [x] T4: `server/dolores/notas-obra.ts` (leitura pela IA, rascunho, reconhecimento da confirmação) e ligação no webhook.
- [x] T5: `server/dolores/conciliacao.ts` (apontamentos, preparo e execução das ações de fila).
- [x] T6: leitura `listar_notas_obra`; ações `conciliar_nota_obra` e `salvar_nota_obra`; permissões etapa 5; prompt.
- [x] T7: rotas `dolores.notas.*` e tela `DoloresNotasCard`.
- [x] T8: testes (cada regra dura: tentativa → recusa auditada; nota envenenada, duplicada, confirmação forjada).
- [x] T9: docs (`como-ligar.md` Etapa 5, `agente-etapa5.md`); tsc, testes, build.

## File List
Novos:
- `drizzle/0128_dolores_notas.sql`, `drizzle/schema-dolores-notas.ts` — `obra_notas`, `obra_notas_respostas`, `obra_notas_config`.
- `shared/dolores/notas.ts` — regras puras (saída zod, conferências, textos, duplicidade, resposta do empreiteiro, ligação, conciliação, texto sugerido).
- `server/dolores/notas-obra.ts` — leitura da nota, rascunho, despacho obra × cliente, reconhecimento da resposta do empreiteiro.
- `server/dolores/leitura/notas.ts` — `listar_notas_obra` e o carregamento (só leitura) dos lançamentos do BPO.
- `server/dolores/acoes/notas.ts` — preparo de `conciliar_nota_obra` e `salvar_nota_obra` (fila).
- `server/dolores/conciliacao.ts` — execução dos itens aprovados (vínculo na nota; arquivo no Drive).
- `server/dolores/notas-router.ts` — rotas `dolores.notas.*` (só admin por papel).
- `client/src/components/admin/DoloresNotasCard.tsx` — tela (computador e iPad).
- `server/dolores/notas-regras.test.ts`, `server/dolores/notas-obra.test.ts` — testes.
- `docs/dolores/agente-etapa5.md`.
Alterados (aditivo):
- `drizzle.config.ts` (schema novo); `server/dolores/testes-banco.ts` (0128 duas vezes).
- `server/dolores/classificacao.ts` (exports reaproveitados; documento de grupo de obra não é classificado; tipo da ferramenta geral).
- `server/dolores/whatsapp.ts` (função `dolores_notas` na porta `bloqueioAtual`; `credencialDaLeituraDeNota`; webhook despacha obra × cliente e reconhece a resposta).
- `shared/funcoes-anthropic.ts` (função "Dolores — leitura de notas de obra").
- `server/dolores/funcoes.ts`, `server/dolores/acoes/registro.ts`, `server/dolores/permissoes.ts` (etapa 5), `server/dolores/prompt.ts`,
  `server/dolores/aprovacoes.ts` (tempo mínimo de `salvar_nota_obra`), `server/dolores/router.ts`, `shared/drive-estrutura.ts`
  (`caminhoNotasObra`), `client/src/pages/admin/AdminIntegracoes.tsx`.
- `docs/dolores/como-ligar.md` (Etapa 5), `docs/dolores/ferramentas-etapa1.json` (regenerado).
- Testes anteriores só com a etapa em vigor (4 → 5) e as listas novas: `ponte.test.ts`, `whatsapp.test.ts`, `acoes.test.ts`,
  `correcoes-e3.test.ts`, `integracoes-modelo-por-funcao.test.ts`. `server/integracoes-anthropic.test.ts` intacto.

## Dev Notes
Registro interno × fila:
- REGISTRO INTERNO (sem fila): `obra_notas` (o rascunho) e `obra_notas_respostas` (a resposta reconhecida). Tabelas próprias da
  Dolores, só aditivas, que não tocam obra, BPO, Drive nem CRM; o gatilho da 0128 impede apagar e mudar o que foi lido.
- FILA: tudo o que liga a nota a um módulo do sistema — o vínculo com o lançamento do BPO (`conciliar_nota_obra`) e o arquivo
  na pasta da obra (`salvar_nota_obra`). Também quando proposto pela tela (o admin só PROPÕE; o dono aprova na fila).

Confirmação do empreiteiro (indício, NÃO assinatura): reconhecida no webhook, por código (`lerRespostaDoEmpreiteiro` +
`ligarRespostaANota` + telefone do empreiteiro vinculado à obra, DDD + 8 finais), sem chamar a IA. Grava remetente
mascarado, hora e texto filtrado. Nunca é usada como autorização de pagamento; a tela e a leitura dizem isso (AVISO_CONFIRMACAO).

Decisões próprias:
- [AUTO-DECISION] Reaproveitar a classificação da E4 em vez de duplicar → a leitura de nota usa a MESMA reivindicação da
  mensagem, a mesma reserva (`reservarClassificacao`: uma por vez global, folga do dono, orçamento próprio dos documentos),
  os mesmos tetos do dia (`dolores_grupos_contagem`), a mesma pausa por excesso e a mesma falha fechada do consumo (r3 N7)
  (razão: um orçamento só para "IA nos documentos dos grupos"; documentos nunca bloqueiam os comandos do dono). Por isso a
  0128 não tem contagem própria (a tabela `obra_notas_contagem` do rascunho inicial saiu).
- [AUTO-DECISION] Dois interruptores para ler nota: "classificação dos documentos" (E4) E "leitura de notas" (E5), os dois
  desligados por padrão (razão: o primeiro é o interruptor geral da IA nos documentos; o segundo, o desta etapa).
- [AUTO-DECISION] Sem o arquivo dentro dos limites (formato, tamanho, páginas, contagem prévia), a nota NÃO vai à IA: fica
  "não lida" (razão: ler nota "pelo nome e pela legenda" seria inventar campo; e não gasta).
- [AUTO-DECISION] Mesmo arquivo (SHA-256) de nota já registrada não vai à IA de novo (razão: duplicata e spam sem custo).
- [AUTO-DECISION] Confiança por campo < 80% → campo vazio + dúvida (razão: o dado não pode ser inventado; 80% acima dos 75%
  da classificação porque são valores).
- [AUTO-DECISION] Resposta ligada à nota por CITAÇÃO da mensagem da nota OU por "NOTA <nº do sistema>" (razão: o texto
  sugerido traz o número; com as duas, precisam apontar para a mesma nota); prazo padrão 7 dias (1 a 60 na tela), com 1 dia
  de folga para relógios diferentes; só a primeira resposta vale.
- [AUTO-DECISION] Conciliação só com lançamento de DESPESA, fora da limpeza reversível e dos "a classificar"; o vínculo só é
  aceito com o pagamento PAGO e vindo do extrato (bank_transaction_id) e um pagamento concilia com uma nota só (índice único)
  (razão: "conciliada com o pagamento do banco" do teste de aceite; segunda nota no mesmo pagamento = provável duplicata).
- [AUTO-DECISION] NÃO criar lançamento no BPO nem pagamento na obra a partir da nota nesta etapa (razão: o pedido diz "só
  aponta" e o rascunho "nunca um lançamento"; criar lançamento a partir de dado de terceiro fica para decisão do dono).
- [AUTO-DECISION] CPF do emitente gravado em dígitos (precisa para duplicidade e conciliação), mostrado na tela só com os 2
  finais e na leitura pela regra `campoPessoal` (opção B do dono); CNPJ inteiro. Dados bancários: campo inexistente na saída
  e filtro do registro nos textos.
- [AUTO-DECISION] Drive: Obras › Obra (nº) › "Notas fiscais", nome "Nota N — dd-mm-aaaa.ext" montado pelo sistema; o arquivo
  só sobe se o SHA-256 baixado na aprovação for o lido (razão: o dono aprova o que viu).
- [AUTO-DECISION] A tela pode PROPOR os itens da fila (autora: a usuária Dolores; o admin só no resumo da auditoria, sem FK —
  mesma lição da E4 para não barrar exclusão de usuário).

Em aberto (não bloqueia a etapa):
- Criar o pagamento da obra / lançamento do BPO a partir do rascunho (precisa de decisão do dono).
- A pendência da tela de grupos (E4) ainda lista documentos de grupo de obra "a classificar" (só visual; o botão da E4 não
  os classifica). O organizador do Drive não conhece a pasta "Notas fiscais" (os arquivos não são movidos por ele).
- Paridade com o Grupo Santa Fé suspensa por ordem do dono (16/11); registrar no ROADMAP ao fechar o epic.
- E4b (resposta quando marcada): não depende desta etapa; ao juntar, conferir só os conflitos de lista em
  `shared/funcoes-anthropic.ts`, `permissoes.ts`, `prompt.ts` e no teste de modelo por função.

## Progresso
- b5dd856 merge da `main` (E3 + termo de consentimento) sobre a E4; conflitos só de arquivos idênticos à E3 final (lado da E4
  mantido) e do `drizzle.config.ts` (as duas listas somadas). `tsc` ok.
- 4518885 wip: migração, schema e story (retomada depois do reinício do ambiente).
- merge da `epic025-dolores-etapa4` (2ª rodada do QA: contagem prévia, uma por vez, orçamento próprio, 0130) logo no início,
  sem conflito, para reaproveitar as travas novas.
- a469c87 regras puras + exports da classificação; 71f5df5 leitura da nota e reconhecimento da resposta; f1d4df6 conciliação,
  ações de fila e `listar_notas_obra`; rotas `dolores.notas`; 4f0d0ce tela; cc61824 testes anteriores na etapa 5.
- testes: regras puras (23) e ponta a ponta (41); 087a886/051783d correções (consulta fora da transação; folga de relógio).
- merge da `epic025-dolores-etapa4` (3ª rodada: falha fechada do consumo) sem conflito; 6cd0001 a leitura de nota adota a mesma
  falha fechada (+1 teste).
- docs: `como-ligar.md` (Etapa 5) e `agente-etapa5.md`.
- Verificação (17/11, 2 processos): `npx tsc --noEmit` ok; lista-alvo (server/dolores, integracoes-anthropic,
  integracoes-modelo-por-funcao, bpo*, whatsapp*, drive*, auth-session, imports-esm, api-rotas-producao) 48 arquivos / 753
  testes ok; `npx vite build` ok; suíte completa 254 arquivos / 2719 testes ok. Novos: notas-regras (23) e notas-obra (41).

## Change Log
- 17/11/2026 — @dev (Dex): story criada (Draft → InProgress), critérios tirados do prompt mestre (seções 2, 4.5, 4.6, 5, 6, 7 e 9).
- 17/11/2026 — @dev (Dex): implementação concluída (InProgress → InReview); migração 0128 NÃO aplicada no banco.
