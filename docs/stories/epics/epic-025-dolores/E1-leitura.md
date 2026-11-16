# E1 — Leitura (ponte, usuária Dolores, consultas e auditoria)

Status: InProgress
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
- [ ] AC1: `POST /api/dolores/ponte` (Express local e `api/index.ts`) com Bearer de `DOLORES_PONTE_TOKEN`, comparação em
      tempo constante; sem a variável, recusa tudo; o token nunca vai para log.
- [ ] AC2: só funções da lista da etapa (`permissoes.ts`) são executadas; desconhecida ou não liberada é recusada e
      auditada.
- [ ] AC3: entrada de toda função validada com zod; saída limitada (página, máximo de linhas, texto cortado); datas ISO
      com o fuso; dinheiro em número com a moeda.
- [ ] AC4: `GET /api/dolores/ferramentas` lista as funções com o JSON Schema da entrada (fonte única das ferramentas do
      agente); `docs/dolores/ferramentas-etapa1.json` gerado do mesmo registro.
- [ ] AC5: limite de chamadas por minuto e chave de pausa gravada no banco (`dolores_config`): pausada, a ponte recusa tudo.
- [ ] AC6: usuária Dolores criada/achada em `users` de forma idempotente, sem senha e com perfil que não abre o painel;
      nenhuma regra de permissão existente foi enfraquecida.
- [ ] AC7: consultas de regularizações, clientes, histórico de atendimento, conversas, tarefas, documentos, atrasos,
      obras, medições, financiamentos e recebíveis, com dados reais e o que faltar dito como faltando.
- [ ] AC8: LGPD — CPF mascarado, sem conteúdo de arquivo, dados bancários, senhas, tokens ou segredos; telefone só
      parcial para identificar o contato.
- [ ] AC9: `dolores_acoes` (migração `0123`, aditiva e idempotente) com uma linha por chamada (função, argumentos
      saneados, resumo em contagens, resultado ok/recusada/erro, duração, pedidoId, autora Dolores); falha da auditoria
      não derruba a leitura, mas é registrada no log.
- [ ] AC10: responsável padrão da migração do Trello (vazio) aparece como "a confirmar".
- [ ] AC11: prompt do agente (`docs/dolores/agente-etapa1.md`) e passo a passo do dono (`docs/dolores/como-ligar.md`).

## Tarefas
- [ ] T1: levantamento do que existe (tabelas, regras de atraso/vencimento já usadas nas telas).
- [ ] T2: regras puras em `shared/dolores/` (formato, máscara, limites, responsável, situação do processo).
- [ ] T3: migração `drizzle/0123_dolores_acoes.sql` + `drizzle/schema-dolores.ts` (ligado como os demais).
- [ ] T4: `server/dolores/perfil.ts`, `auditoria.ts`, `permissoes.ts`, `ponte.ts`; rotas montadas nos dois servidores.
- [ ] T5: `server/dolores/leitura/*.ts` (somente leitura).
- [ ] T6: testes (PGlite): autenticação, pausa, limite, lista liberada, cada leitura, cenário de aceite, limites da saída,
      máscara de CPF, auditoria (ok/recusa/erro, falha sem derrubar), guarda de escrita estática e em tempo de execução.
- [ ] T7: documentos do dono (`docs/dolores/`); `npx vitest run server/dolores`, `npx tsc --noEmit`, `npx vite build`.

## Testes previstos
- Automáticos: `server/dolores/*.test.ts`.
- Manuais: chamada à ponte com `curl` depois da publicação (token cadastrado pelo dono).
- Pendente em produção: migração `0123` aplicada no Neon; agente criado no Console; pergunta de aceite com dados reais.

## Depende do dono
Token `DOLORES_PONTE_TOKEN` na Vercel; agente criado no Claude Console com o prompt e as ferramentas.

## File List
(atualizada ao fim de cada tarefa)

## Dev Notes
(decisões e lacunas — ver o fim da story)
