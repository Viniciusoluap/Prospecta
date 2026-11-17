# E5 — Notas de obra (leitura da nota, rascunho, confirmação do empreiteiro, conciliação com o BPO)

Status: InProgress
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
- [ ] AC1 — Grupo de obra habilitado: documento/imagem que chega num grupo cadastrado e ligado a uma OBRA vai para a leitura de
      nota (não para a classificação da E4); grupo de cliente continua exatamente como na E4.
- [ ] AC2 — Leitura da nota: IA com o documento aberto (modelo da função nova "Dolores — leitura de notas de obra"), saída numa
      ferramenta única com estrutura fechada validada por zod: tipo (NF-e, NFS-e, NFC-e, recibo, cupom, outro), emitente,
      CPF/CNPJ, número, data, valor total, descrição, itens (até 30), chave de acesso, categoria e etapa sugeridas (enums do
      sistema), sinais (ilegível, adulteração, dados bancários presentes) e confiança POR CAMPO. Confiança baixa → "confira".
- [ ] AC3 — Conferência determinística (código, não o modelo): dígito verificador do CNPJ/CPF; soma dos itens × total; data
      plausível (não futura, não absurda); valor > 0 e dentro do teto; chave de NF-e (estrutura, DV) cruzada com CNPJ,
      número e mês da nota. O que falha ou não foi lido fica VAZIO e marcado como dúvida — nunca inventado.
- [ ] AC4 — Rascunho: a leitura vira um RASCUNHO interno da Dolores (`obra_notas`), nunca um lançamento: obra do grupo,
      empreiteiro da obra (só sugerido quando o CPF/CNPJ da nota confere com o cadastro dele), categoria, etapa, valor, data,
      dúvidas e alertas. Visível para o admin (tela) e para o dono (leitura `listar_notas_obra`).
- [ ] AC5 — Injeção por documento: a nota vai ao modelo como DADO; nada do texto vira ação, destino, nome de pasta ou link;
      textos lidos passam pelo filtro do registro e sem links; dados bancários nunca são gravados (campo não existe na saída;
      texto filtrado; sinal "a nota traz dados bancários — não gravados").
- [ ] AC6 — Nota duplicada (mesmo arquivo — SHA-256 — ou mesma chave de acesso, ou mesmo número + emitente), adulterada
      (chave que não bate) ou ilegível é SINALIZADA na nota e na tela, nunca "resolvida" em silêncio; nota duplicada não pode
      ser conciliada.
- [ ] AC7 — Confirmação do empreiteiro (DADO, não autenticação): o sistema reconhece por código, no webhook, uma resposta
      inequívoca ("CONFIRMO NOTA 45", ou "confirmo" respondendo/citando a mensagem da nota) de um participante cujo telefone
      confere com o empreiteiro cadastrado DAQUELA obra, no MESMO grupo da nota, dentro do prazo — e registra remetente
      mascarado, hora e texto filtrado. "CORRIGIR NOTA 45 …" registra "correção pedida". Forjada (outro número, outro grupo,
      fora do prazo, ambígua, sem referência, negativa) → nada é confirmado e a tentativa é auditada. Confirmação não lança,
      não paga e não dispensa a aprovação do dono; a tela e a story dizem que é indício, não assinatura.
- [ ] AC8 — Texto sugerido: a tela e a leitura mostram ao dono o texto para ELE MESMO enviar ao empreiteiro (com o número da
      nota no sistema e as palavras que o sistema reconhece). A Dolores não envia nada.
- [ ] AC9 — Conciliação com o BPO: por nota, comparação com os lançamentos de despesa do BPO (valor, data, fornecedor — CPF/CNPJ
      do cadastro BPO ou nome do titular —, obra) e apontamento: já lançado (pagamento encontrado), provável duplicata (já
      conciliado com outra nota), divergente (valor, fornecedor ou obra), sem lançamento; e, por obra, pagamentos sem nota.
      Só aponta.
- [ ] AC10 — Fila: `conciliar_nota_obra` (FILA) propõe ligar a nota ao lançamento do BPO VINDO DO BANCO (pago e com
      movimentação bancária); aprovado pelo dono, grava só o vínculo na nota (registro da Dolores) — o lançamento do BPO não é
      alterado. `salvar_nota_obra` (FILA) salva o arquivo na pasta da obra no Drive (Obras › Obra › Notas fiscais), nome
      montado pelo sistema, conferindo que o arquivo baixado é o mesmo que foi lido (SHA-256). O resumo mostra exatamente o
      que será gravado (regra N3).
- [ ] AC11 — Custo: leitura só com a leitura de notas ligada (DESLIGADA por padrão) e pela porta `bloqueioAtual` (pausa →
      interruptor da IA → chave → modelo da função → limite → usuária), teto diário de leituras, reserva do pior caso dentro da
      fração do limite da E4 (folga do dono), pausa do dia se o uso real passar da reserva, travas de tamanho/páginas e
      download com teto da E4; no webhook, no máximo uma chamada de IA por aviso. Registrar mensagem e reconhecer confirmação
      não chamam a IA. Chave lida só no ponto único (guarda `server/integracoes-anthropic.test.ts` intacta).
- [ ] AC12 — Limites fixos intactos: nunca pagar, baixar, estornar; nunca editar lançamento confirmado; nunca excluir; nunca
      assinar; nunca enviar mensagem a cliente, empreiteiro ou grupo; nunca mexer em usuários/credenciais/dados bancários.
- [ ] AC13 — Migração `drizzle/0128_dolores_notas.sql` só aditiva e idempotente (não aplicada aqui); FKs revisadas contra os
      gatilhos (o `ON DELETE SET NULL` de obra, usuário, lançamento do BPO não é barrado); schema em `drizzle.config.ts`.
- [ ] AC14 — Rotas e tela (`dolores.notas.*`, `DoloresNotasCard`): só admin por PAPEL, testadas pelo `appRouter` com o caminho
      completo; computador e iPad.

## Tarefas
- [x] T1: levantamento (E4: webhook de grupo, classificação, download, reserva; obras, empreiteiros, obra_movimentos, BPO, Drive).
- [ ] T2: migração 0128 + `drizzle/schema-dolores-notas.ts` + drizzle.config.
- [ ] T3: regras puras `shared/dolores/notas.ts` (saída zod, conferências, duplicidade, confirmação, conciliação, texto sugerido).
- [ ] T4: `server/dolores/notas-obra.ts` (leitura pela IA, rascunho, reconhecimento da confirmação) e ligação no webhook.
- [ ] T5: `server/dolores/conciliacao.ts` (apontamentos, preparo e execução das ações de fila).
- [ ] T6: leitura `listar_notas_obra`; ações `conciliar_nota_obra` e `salvar_nota_obra`; permissões etapa 5; prompt.
- [ ] T7: rotas `dolores.notas.*` e tela `DoloresNotasCard`.
- [ ] T8: testes (cada regra dura: tentativa → recusa auditada; nota envenenada, duplicada, confirmação forjada).
- [ ] T9: docs (`como-ligar.md` Etapa 5, `agente-etapa5.md`); tsc, testes, build.

## File List
(ver seção Progresso; mantida ao fim)

## Dev Notes
(decisões [AUTO-DECISION] registradas ao longo da implementação)

## Progresso
- b5dd856 merge da `main` (E3 + termo de consentimento) sobre a E4; conflitos só de arquivos idênticos à E3 final (lado da E4
  mantido) e do `drizzle.config.ts` (as duas listas somadas). `tsc` ok.

## Change Log
- 17/11/2026 — @dev (Dex): story criada (Draft → InProgress), critérios tirados do prompt mestre (seções 2, 4.5, 4.6, 5, 6, 7 e 9).
