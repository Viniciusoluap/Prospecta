# E1 — Leitura (ponte, usuária Dolores, consultas e auditoria)

Status: InReview
Epic: EPIC-025 (Etapa 1) — "Operação Dolores — Prompt Mestre" (16/11/2026)
Paridade: suspensa por ordem do dono em 16/11 (Grupo Santa Fé em espera); registrar no ROADMAP ao fechar o epic.
Tamanho estimado: G
Dependência: nenhuma. A etapa 2 (WhatsApp) liga a Central de WhatsApp a esta ponte.

## Problema

A Dolores é uma funcionária digital de operações: um agente no Claude Console que decide e chama funções AUTORIZADAS
do sistema. Ela nunca acessa o banco direto; é uma usuária do sistema e tudo o que consulta fica registrado no nome
dela. Nesta etapa ela só lê. O teste de aceite (pergunta do dono ao agente): "Dolores, analise todos os processos de
regularização e informe os atrasados, pendências, responsáveis e próximas providências."

## Critérios de aceite
- [x] AC1: `POST /api/dolores/ponte` (Express local e `api/index.ts`) com Bearer de `DOLORES_PONTE_TOKEN`, comparação em
      tempo constante; sem a variável, recusa tudo; o token nunca vai para log.
- [x] AC2: só funções da lista da etapa (`permissoes.ts`) são executadas; desconhecida ou não liberada é recusada e
      auditada.
- [x] AC3: entrada de toda função validada com zod; saída limitada (página, máximo de linhas, texto cortado); datas ISO
      com o fuso; dinheiro em número com a moeda.
- [x] AC4: `GET /api/dolores/ferramentas` lista as funções com o JSON Schema da entrada (fonte única das ferramentas do
      agente); `docs/dolores/ferramentas-etapa1.json` gerado do mesmo registro.
- [x] AC5: limite de chamadas por minuto e chave de pausa gravada no banco (`dolores_config`): pausada, a ponte recusa tudo.
- [x] AC6: usuária Dolores criada/achada em `users` de forma idempotente, sem senha e com perfil que não abre o painel;
      nenhuma regra de permissão existente foi enfraquecida.
- [x] AC7: consultas de regularizações, clientes, histórico de atendimento, conversas, tarefas, documentos, atrasos,
      obras, medições, financiamentos e recebíveis, com dados reais e o que faltar dito como faltando.
- [x] AC8: LGPD — CPF mascarado, sem conteúdo de arquivo, dados bancários, senhas, tokens ou segredos; telefone só
      parcial para identificar o contato.
- [x] AC9: `dolores_acoes` (migração `0123`, aditiva e idempotente) com uma linha por chamada (função, argumentos
      saneados, resumo em contagens, resultado ok/recusada/erro, duração, pedidoId, autora Dolores); falha da auditoria
      não derruba a leitura, mas é registrada no log.
- [x] AC10: responsável padrão da migração do Trello (vazio) aparece como "a confirmar".
- [x] AC11: prompt do agente (`docs/dolores/agente-etapa1.md`) e passo a passo do dono (`docs/dolores/como-ligar.md`).

## Tarefas
- [x] T1: levantamento do que existe (tabelas, regras de atraso/vencimento já usadas nas telas).
- [x] T2: regras puras em `shared/dolores/` (formato, máscara, limites, responsável, situação do processo).
- [x] T3: migração `drizzle/0123_dolores_acoes.sql` + `drizzle/schema-dolores.ts` (ligado como os demais).
- [x] T4: `server/dolores/perfil.ts`, `auditoria.ts`, `permissoes.ts`, `ponte.ts`; rotas montadas nos dois servidores.
- [x] T5: `server/dolores/leitura/*.ts` (somente leitura).
- [x] T6: testes (PGlite): autenticação, pausa, limite, lista liberada, cada leitura, cenário de aceite, limites da saída,
      máscara de CPF, auditoria (ok/recusa/erro, falha sem derrubar), guarda de escrita estática e em tempo de execução.
- [x] T7: documentos do dono (`docs/dolores/`); `npx vitest run server/dolores`, `npx tsc --noEmit`, `npx vite build`.

## Testes previstos
- Automáticos: `server/dolores/*.test.ts`.
- Manuais: chamada à ponte com `curl` depois da publicação (token cadastrado pelo dono).
- Pendente em produção: migração `0123` aplicada no Neon; agente criado no Console; pergunta de aceite com dados reais.

## Depende do dono
Token `DOLORES_PONTE_TOKEN` na Vercel; agente criado no Claude Console com o prompt e as ferramentas.

## File List
- `drizzle/0123_dolores_acoes.sql` (novo) — `dolores_acoes` (só inserção, gatilho) e `dolores_config` (pausa, limite).
- `drizzle/schema-dolores.ts` (novo); `drizzle.config.ts` (schema ligado).
- `shared/dolores/formato.ts`, `shared/dolores/regras.ts` (novos, puros).
- `server/dolores/perfil.ts`, `auditoria.ts`, `permissoes.ts`, `funcoes.ts`, `ponte.ts` (novos).
- `server/dolores/leitura/comum.ts`, `regularizacoes.ts`, `clientes.ts`, `tarefas.ts`, `documentos.ts`, `atrasos.ts`,
  `obras.ts`, `financeiro.ts` (novos, somente leitura).
- `api/index.ts`, `server/_core/index.ts` — rotas da ponte montadas.
- `server/dolores/testes-banco.ts` (cenário PGlite), `server/dolores/{regras,leituras,ponte,leitura-somente}.test.ts`.
- `scripts/dolores-ferramentas.ts` → `docs/dolores/ferramentas-etapa1.json` (gerado; o teste acusa se ficar velho).
- `docs/dolores/agente-etapa1.md`, `docs/dolores/como-ligar.md`.

## Dev Notes (implementação, 16/11/2026)
- IDS: reaproveitadas as regras das telas — `tarefaAtrasada` (Tarefas), `situacaoDoLancamento`/`recebidoDoLancamento`/
  `contaNoResultado` e o filtro de lançamentos do BPO, `calcularFinanceiroRegularizacao`, `progressoDasEtapas`,
  `rotuloStatusProcesso`, rótulos de CRM/serviço/obra/financiamento, `CLIENT_DOCUMENT_CHECKLIST`, prazo do card
  (lead-card-due-digest). Token Bearer no molde da Central de Vendas (`central-vendas/rotas.ts`), sem cofre: o dono
  pediu variável de ambiente.
- [AUTO-DECISION] Responsável "a confirmar" → vazio ou marcador ("sem responsável", "a definir"…) vira "a confirmar"
  (o padrão gravado pela migração do Trello em `lead-services-router.ts` é `responsible: ""`); `motivoResponsavel`
  diz se veio do Trello. O responsável do CRM vai em campo separado e nunca substitui o do processo.
- [AUTO-DECISION] Prazo "atrasado" = prazo do processo (previsão de término; sem ela, o prazo do serviço no CRM)
  anterior a hoje. Campos de prazo/vencimento são lidos pelo dia gravado (meia-noite UTC, como as telas), instantes
  (atualização, atividade) no fuso de Imperatriz. "Parado" = 15 dias sem movimentação (padrão; argumento `diasParado`).
- [AUTO-DECISION] Chamadas sem token válido não entram em `dolores_acoes` (um estranho não enche a auditoria nem gasta o
  limite dela); vão ao log sem o token, com limite de 20 tentativas por IP/minuto. Todas as autenticadas são auditadas.
- [AUTO-DECISION] Limite por minuto contado no próprio `dolores_acoes` (vale entre instâncias da Vercel; padrão 60, em
  `dolores_config.limite_por_minuto`); sem a linha de configuração a ponte não executa (falha fechada).
- [AUTO-DECISION] Usuária Dolores: `openId = 'sistema:dolores'`, perfil `user` (sem área, sem adminProcedure), sem senha,
  sem e-mail, sem módulos. Se alguém der senha, outro perfil ou módulos a ela, a ponte para (503).
- Lacunas (dado que não existe no sistema): motivo do atraso só quando há observação na etapa ou no processo; próxima
  providência só quando há tarefa/follow-up; processo sem previsão de término não pode ser dado como atrasado
  ("semPrazoRegistrado"); documentos exigidos por tipo de regularização não existem como checklist (só os documentos
  do cliente, o cadastro antigo da regularização e o checklist do financiamento); responsável de tarefa é texto livre.
- Não há script `lint` no `package.json`; qualidade conferida por `tsc --noEmit`, testes e `vite build`.

## Testes executados
- (a) Automáticos: `npx vitest run server/dolores` — 4 arquivos, 42 testes passando; `server/auth-session.test.ts` e
  `server/imports-esm.test.ts` (build da Vercel) e `server/api-rotas-producao.test.ts` passando; `npx tsc --noEmit` sem erros;
  `npx vite build` ok. Suíte completa (`npx vitest run`): 221 arquivos, 2010 testes passando.
- (b) Manuais: nenhum (sem banco real nesta etapa).
- (c) Pendentes em produção: migração 0123 no Neon; `DOLORES_PONTE_TOKEN` na Vercel; `curl` na ponte; agente no Console
  e a pergunta de aceite com os dados reais.

## Próximo passo
Portão de QA; aplicar a 0123 no Neon e publicar; dono cadastra o token; Etapa 2 (WhatsApp) liga a Central à ponte e
faz o laço de ferramentas com a API da Anthropic (ver `docs/dolores/como-ligar.md`, passo 5).

## Change Log
- 16/11/2026 — @dev (Dex): Ready → InProgress → InReview (implementação da etapa 1).
