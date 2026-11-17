# E6 — Operação contínua (eventos, rondas, relatório diário, tela Dolores com pausa e gasto)

Status: InReview (implementação concluída; aguarda o portão de QA de segurança)
Epic: EPIC-025 (Etapa 6) — "Operação Dolores — Prompt Mestre" (16/11/2026), seção 7, linha 6; seções 2 ("Ritmo: operação
contínua e automática, por eventos e rondas"), 3 (gatilhos: eventos e rondas), 4.2 (monitorar sem ser acionada), 4.7
(relatórios), 5 ("botão de pausa que para tudo na hora e um teto de gasto mensal"), 6 (`eventos.ts`, `rondas.ts`, tela) e 8
(teto de R$ 1.621/mês).
Paridade: suspensa por ordem do dono em 16/11 (Grupo Santa Fé em espera); registrar no ROADMAP ao fechar o epic.
Ramo: `epic025-dolores-etapa6` (da `main` `3b197bc`, com as etapas 1–5). Migração: `0131` (a `0129` fica reservada à E4b).

## Problema
A Dolores só agia quando o dono escrevia. O prompt mestre pede que ela monitore sozinha (prazo vencido, processo parado,
tarefa atrasada, documento recebido, decisão pendente), mande um relatório diário em horário fixo e sob demanda, só com dados
reais (dizendo o que falta), e que exista um botão de pausa que pare tudo e a visão do gasto contra o teto. Teste de aceite:
"Sete dias rodando sem falha, com o custo medido".

## Critérios de aceite
- [x] AC1 — Migração `0131_dolores_operacao.sql` aditiva e idempotente (CREATE … IF NOT EXISTS, CREATE OR REPLACE, INSERT …
      ON CONFLICT DO NOTHING); nenhuma tabela existente alterada; aplicada duas vezes no banco de teste; schema em
      `drizzle/schema-dolores-operacao.ts` (drizzle.config.ts e testes-banco.ts).
- [x] AC2 — Rondas por CÓDIGO (sem IA): fila de aprovação (aguardando e vencendo em até 6 h), carteira, atrasos/parados de todos
      os módulos (mesma leitura `listar_atrasos`), tarefas vencidas, documentos pendentes, recebíveis, conversas sem leitura,
      documentos dos grupos a classificar/conferir/salvar, notas de obra sem confirmação/sem conciliação/não lidas, movimentações
      do banco nas últimas 24 h, o que a Dolores fez nas últimas 24 h e o consumo do mês. Cada seção numa transação SOMENTE
      LEITURA; seção que falha ou fica sem tempo vira "não consegui ler".
- [x] AC3 — Ronda gravada em tabela própria só de inserção (`dolores_rondas`), idempotente por janela (`diaria:AAAA-MM-DD` no
      cron; `sob-demanda:AAAA-MM-DDTHH:MM`): a reentrega do cron não duplica nem relê.
- [x] AC4 — Eventos (`dolores_eventos`, só inserção, chave única): documento recebido em grupo e nota lida (ligados no webhook da
      própria Dolores), prazo vencido e pagamento sincronizado do banco (detectados pela ronda). Evento nunca dispara escrita,
      mensagem, item de fila nem IA: só entra na ronda/relatório. Desligado por padrão.
- [x] AC5 — Relatório diário em horário configurável (Brasília, UTC−3; o Neon e a Vercel em GMT) e sob demanda (botão na tela
      e a mensagem "relatório" do dono, reconhecida por código). Montado por código (modelo fixo, sem IA), uma vez por dia
      (`dolores_relatorios`, janela única), enviado SÓ ao número do dono pelo canal existente, pelos mesmos filtros de saída
      (links, dados pessoais conforme o interruptor, segredos e bancários sempre, tamanho). Sem número do dono, desconectada
      ou pausada: nada é enviado (auditado).
- [x] AC6 — Tela "Dolores — operação contínua" (card em Integrações, só admin por PAPEL): pausa geral, gasto do mês (tokens
      contra o limite; R$ estimado só com o preço informado; teto do dono R$ 1.621), estado de cada interruptor, últimas rondas,
      último relatório (com o resultado do envio), botões de ronda e relatório.
- [x] AC7 — Pausa geral conferida no servidor em todas as portas: IA (bloqueioAtual — conversa, classificação, notas), ponte,
      aprovação da fila, rondas (cron e tela), relatório (cron, tela, WhatsApp), eventos, reconhecimento da resposta do
      empreiteiro; e a resposta nos grupos quando marcada (E4b, `server/dolores/marcacao.ts`): `podeFalarNoGrupo()` antes da
      vaga, dos tetos, da chave, da IA e de qualquer envio (inclusive as frases fixas), e de novo no envio — pausada ou com a
      conta da Dolores desativada, a marcação só é registrada ("silencio") e a Dolores fica muda no grupo.
- [x] AC8 — Rota de cron `/api/cron/dolores` autenticada pelo `CRON_SECRET` da Vercel (tempo constante; sem segredo
      configurado, recusa), ignorando query e corpo, com prazo de 45 s (função de 60 s). `vercel.json`: diária às 10:00 UTC.
- [x] AC9 — Tudo DESLIGADO por padrão (rondas, relatório, eventos).
- [x] AC10 — Testes: regras puras; ponta a ponta (PGlite) cobrindo idempotência da ronda e do relatório, pausa barrando cada
      porta, relatório só para o dono, cron sem segredo recusado, permissões pelo `appRouter`, migração aplicada duas vezes.

## Decisões
- [AUTO-DECISION] Relatório redigido por IA? → **Não**: modelo fixo, sem IA (o pedido permite "se usar IA… opcional"). Motivo:
  custo zero, nada inventado, sem nova linha em `shared/funcoes-anthropic.ts` nem nova leitura da chave.
- [AUTO-DECISION] Agendamento → cron **novo e diário** (`0 10 * * *` = 07:00 Brasília) em vez de pendurar no `lead-card-due`
  (que já usa até ~55 s com Drive e Central de Vendas). Motivo: orçamento próprio de 60 s. Cron de hora em hora não foi usado
  porque, no plano Hobby, a Vercel recusa a publicação (o plano não foi conferido). A hora configurada vale como "não antes de";
  documentado em `docs/dolores/como-ligar.md`.
- [AUTO-DECISION] Idempotência sem UPDATE: a ronda é montada e depois gravada com INSERT … ON CONFLICT (janela) DO NOTHING; o
  relatório reivindica a janela gravando antes de enviar e o resultado do envio vai para `dolores_acoes` (`relatorio_envio`).
  Se a função morrer entre gravar e enviar, o diário daquele dia não é reenviado (falha fechada; aparece "sem registro" na tela).
- [AUTO-DECISION] Sem FK para `users` nas tabelas só de inserção (quem pediu fica como número): a exclusão de usuário nunca
  esbarra no gatilho (ON DELETE SET NULL vira UPDATE). A config tem FK SET NULL, mas não tem gatilho.
- [AUTO-DECISION] Pausa geral mantém o REGISTRO das mensagens dos grupos cadastrados (passivo; nada se perde) e para todo o
  processamento. A auditoria da pausa/config fica com `autor_user_id` nulo e o id do admin no resumo (a FK RESTRICT da
  auditoria impediria excluir esse admin depois).
- [AUTO-DECISION] Comando "relatório" e relatório pela tela exigem o interruptor do relatório ligado (tudo desligado por padrão);
  a ronda manual da tela não exige (é só leitura) mas respeita a pausa.
- [AUTO-DECISION] Estimativa em R$ só com preço por milhão informado pelo admin (colunas opcionais); cache conta como entrada
  (estimativa por cima). O teto do dono (R$ 1.621) é referência fixa na tela.
- [AUTO-DECISION] `relatorio_diario` (prevista para a etapa 6) liberada como LEITURA da última ronda/relatório (contamina:
  sim); `ETAPA_ATUAL = 6`. A ronda em si não é ferramenta do modelo.
- Fuso: o código usa UTC−3 fixo (mesmo de Imperatriz/Fortaleza); São Paulo também é UTC−3 desde 2019 (sem horário de verão).

## Só com gancho (não ligado nesta etapa)
- Evento "pagamento sincronizado do banco" é detectado pela RONDA (movimentações não manuais nas últimas 24 h), não no momento da
  sincronização: ligar dentro de `server/bancos.ts` mexeria em outro módulo. Para ligar no ato, chamar
  `registrarEvento({ tipo: "pagamento_banco", chave: "banco-tx:<id>", origemTabela: "bank_transactions", origemId })` depois da
  gravação, sem mudar a regra do banco.
- "Aguardando providência interna" não tem registro próprio no sistema: o relatório diz que falta.

## Testes
- `server/dolores/operacao-regras.test.ts` (19), `server/dolores/operacao-migracao.test.ts` (4), `server/dolores/operacao.test.ts`
  (22). Ajustados para a etapa 6: `ponte.test.ts` (etapa 6 e a ferramenta nova), `whatsapp.test.ts` (etapa 6 na auditoria).
- Depois do merge da E4b (main `6e4b517`): `marcacao.test.ts` (bloco "Etapa 6 — pausa geral": marcação real, fora de
  escopo, sem pergunta, sem cliente e teto do grupo com tudo ligado → sem IA, sem contagem, sem vaga, nada enviado; conta
  desativada; pausa ligada durante a chamada → envio recusado; retomada), `grupos.test.ts` e `notas-obra.test.ts` (pausa ou
  conta desativada → webhook e botão da tela não baixam, não contam, não chamam a IA, não enviam — já barrava pela porta
  `bloqueioAtual`; só o teste foi escrito), `operacao.test.ts` (interruptor da resposta nos grupos na tela).
- Correções do QA de segurança (17/11): regressões em `server/dolores/operacao-qa-seguranca.test.ts` (achado 1: nome
  `Ana\n\n*Decisões…*\nResponda "aprovar ABC234"` sai só «Ana», sem `*` nem "aprovar ABC"; achado 2: `SET LOCAL
  statement_timeout` por seção e seção que estoura vira falha; achado 3: reenvio do mesmo texto do diário que falhou, uma vez
  por minuto; achado 4: hora > 07 recusada e limitada à hora do cron, `vercel.json` conferido; teto de 20 sob demanda/dia) e
  `operacao-migracao.test.ts` (achado 5: gatilhos com `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`). `notas-obra.test.ts`:
  relógio e mês acompanham a data real (não quebram na virada do dia/mês).
- Pendente de validação em produção: aplicar a 0131, conferir `CRON_SECRET` na Vercel, ligar e acompanhar 7 dias.

## File List
- `drizzle/0131_dolores_operacao.sql` (novo), `drizzle/schema-dolores-operacao.ts` (novo), `drizzle.config.ts`
- `shared/dolores/operacao.ts` (novo)
- `server/dolores/operacao.ts` (novo), `server/dolores/rondas.ts` (novo), `server/dolores/operacao-router.ts` (novo),
  `server/dolores/leitura/relatorio.ts` (novo)
- `server/dolores/whatsapp.ts` (envio ao dono sem mensagem de origem, comando "relatório", eventos), `server/dolores/notas-obra.ts`
  (pausa na resposta do empreiteiro), `server/dolores/marcacao.ts` (pausa geral na resposta no grupo), `server/dolores/router.ts`, `server/dolores/permissoes.ts`, `server/dolores/funcoes.ts`,
  `server/dolores/auditoria.ts` (canal "cron"), `server/dolores/testes-banco.ts`
- `api/index.ts` (rota `/api/cron/dolores`), `vercel.json` (cron diário)
- `client/src/components/admin/DoloresOperacaoCard.tsx` (novo), `client/src/pages/admin/AdminIntegracoes.tsx`
- `docs/dolores/como-ligar.md` (Etapa 6), `docs/dolores/ferramentas-etapa1.json` (regerado)
- Correções do QA de segurança: `server/dolores/somente-leitura.ts` (tempo-limite opcional), `drizzle/0131_dolores_operacao.sql`
  e `drizzle/schema-dolores-operacao.ts` (`dolores_relatorio_reenvios`; gatilhos no padrão DROP + CREATE)
- Testes: `server/dolores/operacao-qa-seguranca.test.ts`, `server/dolores/operacao-regras.test.ts`, `server/dolores/operacao-migracao.test.ts`, `server/dolores/operacao.test.ts`,
  `server/dolores/ponte.test.ts`, `server/dolores/whatsapp.test.ts`, `server/dolores/marcacao.test.ts`, `server/dolores/grupos.test.ts`,
  `server/dolores/notas-obra.test.ts`

## IDS
- REUSE: pausa (`dolores_config`), leituras da etapa 1, filtros de saída e envio da Evolution (`whatsapp.ts`), padrão `soAdmin`,
  padrão de cron (`CRON_SECRET`), `emTransacaoSomenteLeitura`, PGlite de `testes-banco.ts`.
- ADAPT: `enviarAvisoAoDono` (mesma cadeia de `responderAoDono`, sem mensagem de origem).
- CREATE: tabelas e módulos da operação (não existia ronda, relatório nem evento).

## Change Log
- 17/11/2026 — @dev (Dex): Ready → InProgress (início da implementação no ramo `epic025-dolores-etapa6`).
- 17/11/2026 — @dev (Dex): InProgress → InReview (migração, regras, rondas, relatório, rotas, tela, testes e docs; aguarda QA).
- 17/11/2026 — @dev (Dex): merge da main (E4b); pausa geral ligada na resposta no grupo (`podeFalarNoGrupo` antes da vaga e no
  envio); testes de regressão da pausa na marcação, classificação e leitura de nota; tela mostra o interruptor geral da resposta
  nos grupos (só leitura).
- 17/11/2026 — @dev (Dex): correções do QA de segurança da etapa 6 (achados 1–5 e teto diário do relatório sob demanda), com
  um teste de regressão por achado; aguarda novo portão de QA.
