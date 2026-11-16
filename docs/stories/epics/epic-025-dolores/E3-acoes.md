# E3 — Ações (tarefas, acompanhamentos, cobranças preparadas, geradores, fila de aprovação)

Status: InProgress
Epic: EPIC-025 (Etapa 3) — "Operação Dolores — Prompt Mestre" (16/11/2026), seção 7, linha 3; seções 4.3 e 5
Paridade: suspensa por ordem do dono em 16/11 (Grupo Santa Fé em espera); registrar no ROADMAP ao fechar o epic.
Tamanho estimado: G
Dependência: E2 (WhatsApp, laço de ferramentas, `executarFuncao`) — ramo `epic025-dolores-etapa2` (2ª rodada de QA).

## Problema

Até a etapa 2 a Dolores só lê. O prompt mestre (seção 4.3) quer que ela execute no sistema — criar tarefas com
responsável e prazo, registrar acompanhamentos, preparar cobranças de documentos e acionar os geradores de documentos —
dentro da tabela "Quem aprova o quê" (seção 5): criar tarefa e registrar acompanhamento são diretos, com registro;
mensagem a cliente só com aprovação do dono (e nenhuma categoria foi liberada ainda); o resto vai para uma fila de
aprovação (`dolores_aprovacoes`, seção 6). Teste de aceite (seção 7): "Dolores, identifique quais clientes estão com
documentos pendentes e prepare as cobranças."

## Critérios de aceite
- [ ] AC1: funções de AÇÃO pela MESMA porta `executarFuncao` (pausa, usuária ativa, lista fechada, zod com limites,
      vaga do minuto, filtro de dados pessoais, auditoria em `dolores_acoes`); cada função declara o nível — `direto`
      (só o que a seção 5 libera sem aprovação e é reversível) ou `fila` (todo o resto).
- [ ] AC2: `criar_tarefa` (direto) — título, responsável (admin/colaborador ativo, pela mesma regra da tela de
      Tarefas), prazo plausível, prioridade e vínculo opcional (cliente do CRM ou obra), pelas funções de serviço da tela.
- [ ] AC3: `registrar_acompanhamento` (direto) — anotação/ligação no histórico do cliente do CRM.
- [ ] AC4: `preparar_cobranca` (fila) — para cada cliente, a cobrança de documentos é PREPARADA com os documentos
      pendentes reais (mesma regra de `listar_documentos`), texto montado pelo sistema (não pelo modelo), último contato
      e consentimento LGPD do cadastro; aprovada, vira registro no histórico e o texto volta ao dono. Nunca é enviada ao
      cliente nem registra pagamento.
- [ ] AC5: `gerar_documento` (fila) — PCI pelo gerador existente (`gerarPciDaObra`), a partir do rascunho salvo pela
      equipe (a Dolores não preenche dado); sai sem assinatura, para o engenheiro responsável conferir.
- [ ] AC6: fila de aprovação (`dolores_aprovacoes`): quem pediu (mensagem do dono), o que será feito (função +
      argumentos validados + resumo legível montado pelo sistema), código curto, situação, quem decidiu/quando, resultado,
      vencimento configurável (`dolores_fila_config.validade_horas`).
- [ ] AC7: aprovação pelo dono no WhatsApp por regra DETERMINÍSTICA (mensagem inteira = "aprovar CÓDIGO" ou "recusar
      CÓDIGO", só do número do dono, não encaminhada) — nunca pela interpretação do modelo; e pela tela (papel admin).
- [ ] AC8: execução só depois da aprovação, revalidando tudo na hora, uma única vez (reivindicação atômica; aprovação
      dupla ou simultânea não executa duas vezes); vencidos não executam; execução interrompida não é refeita.
- [ ] AC9: limites fixos impossíveis por qualquer caminho (excluir, editar lançamento confirmado, pagar/baixar/estornar,
      usuários/acessos/credenciais/dados bancários, assinar documento, inventar dado, enviar a cliente/terceiro): lista
      fechada no código, recusa auditada, testes de tentativa.
- [ ] AC10: autoria — tudo o que ela cria leva a usuária Dolores e a referência ao pedido/aprovação (`dolores_autoria` +
      `pedido_id` de `dolores_acoes`).
- [ ] AC11: injeção — ação só nasce de comando do dono no WhatsApp (a ponte HTTP não executa ações); dado de ferramenta
      não aprova item nem vira destino; testes com dados envenenados.
- [ ] AC12: leitura continua em READ ONLY; ações em transação de escrita separada e mínima; teto de ações por comando.
- [ ] AC13: IA desligada por padrão (nada muda), 60 s e tetos do laço, ações no mesmo limite mensal, segredos e números
      fora de log/resposta/erro.
- [ ] AC14: migração `0125_dolores_fila.sql` aditiva e idempotente; schema no `drizzle.config.ts`; `dolores_acoes` segue
      só de inclusão.
- [ ] AC15: rotas/tela da fila só admin por PAPEL, testadas pelo `appRouter` com o caminho completo.

## Tarefas
- [ ] T1: levantamento (tarefas, histórico do CRM, documentos pendentes, gerador de PCI, contratos, e-mail).
- [ ] T2: regras puras `shared/dolores/fila.ts` (código, decisão do dono, texto da cobrança, prazo, resumo).
- [ ] T3: migração `0125_dolores_fila.sql` + `drizzle/schema-dolores-fila.ts` (+ drizzle.config).
- [ ] T4: `server/dolores/escrita.ts`, `server/dolores/acoes/*`, `server/dolores/aprovacoes.ts`; ponte (`executarFuncao`
      com ações), permissões (etapa 3), cérebro (ferramentas do WhatsApp), WhatsApp (decisão determinística e quadro de
      pendências), prompt.
- [ ] T5: rotas `dolores.fila.*` e a tela `DoloresFilaCard` em Integrações.
- [ ] T6: testes (limites fixos, injeção, fila, permissões).
- [ ] T7: documentos (`como-ligar.md` Etapa 3, `agente-etapa3.md`), HANDOFF; tsc, testes, build.

## File List
(preenchida ao longo da implementação)

## Dev Notes
(decisões [AUTO-DECISION] ao longo da implementação)

## Change Log
- 16/11/2026 — @dev (Dex): story criada (Draft → InProgress), critérios tirados do prompt mestre (seções 4.3, 5, 6, 7).
