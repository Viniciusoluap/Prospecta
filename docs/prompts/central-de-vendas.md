# PROMPT — CENTRAL DE VENDAS (repositório Viniciusoluap/Prospecta)

Cole este prompt inteiro na sessão do agente de código (Claude Code ou Codex) aberta no repositório `Viniciusoluap/Prospecta`.

---

## 1. Seu papel

Você é o engenheiro responsável por implementar o módulo **Central de Vendas** dentro do sistema próprio da Prospecta Construções (ecossistema VFX Capital). Trabalhe de forma autônoma, etapa por etapa, sem me pedir confirmações intermediárias de código. Siga à risca o `CLAUDE.md` e o `AGENTS.md` do repositório.

Objetivo de negócio: receber, qualificar, acompanhar e converter clientes **de forma automática**, sem tarefas manuais repetitivas para a equipe comercial. A equipe humana só atua em três situações: (1) análise e decisão de aprovação ou reprovação; (2) atendimento transferido pela automação em casos complexos; (3) leitura inicial do QR Code para conectar o número de WhatsApp (feita uma única vez).

## 2. Contexto já verificado no repositório (confirme antes de usar)

Stack: Vite + React (client), Express + tRPC (server), Drizzle + Neon (`@neondatabase/serverless`, driver neon-http), deploy na Vercel (`vercel.json`), SDK `@anthropic-ai/sdk` já instalado.

Já existe e deve ser **reaproveitado, nunca duplicado**:
- CRM de leads: tabela `leads` (campos `stage`, `temperature`, `sourceChannel`, `responsibleUserId`, `lgpdConsent`, `followupDate`, `income`, `fgtsAmount` etc.), `lead_activities`, `lead_documents`, `lead_follow_ups`, `lead_services`; telas `AdminCRM.tsx` e `AdminLeadDetail.tsx`.
- WhatsApp por QR Code via Evolution API: `whatsapp_connections`, `whatsapp_messages` (com `direcao` entrada/saída e mídia), `whatsapp_midias` (com cópia no Drive), `whatsapp_conversation_links`, `whatsapp_templates`, `server/whatsapp-evolution-webhook.ts`, `server/whatsapp-router.ts`, `shared/whatsapp/*`, tela `AdminWhatsApp.tsx`.
- Documentos e solicitações: `server/lead-documents-router.ts`, `server/document-request-notifications.ts`, integração com Google Drive.
- Cron diário: `/api/cron/lead-card-due` (o padrão do projeto é acoplar rotinas diárias a ele, sem criar novos crons na Vercel).
- Cofre de segredos: `server/_core/secret-vault.ts`.
- Atenção conhecida: o driver neon-http **não suporta transação interativa**; use `database.batch` (ver `HANDOFF-21-10-NEON-HTTP-LEADS.md`).

Antes de escrever código, leia os HANDOFFs mais recentes e o `docs/stories/epics/ROADMAP.md`, mapeie as etapas atuais do pipeline do CRM e registre no handoff o que será reaproveitado.

## 3. Decisão de arquitetura

1. A Central de Vendas é um **módulo nativo do sistema Prospecta**, construído sobre o CRM e o WhatsApp (Evolution) já existentes. O sistema Prospecta continua sendo a fonte oficial de todos os dados.
2. A **Logyca** entra apenas como **adaptador opcional**, desligado por padrão (feature flag `centralVendas.logyca.ativo = false`). Implemente somente o que a documentação oficial confirma (https://logyca-tecnologia.gitbook.io/logyca-tecnologia/llms.txt):
   - envio de mensagem de texto e mídia: POST com `Authorization: Bearer <token>` e corpo `{ "number", "message" }`, endpoint copiado do menu "Mensagens API" da plataforma;
   - recebimento de chamadas HTTP feitas pelo bloco "HTTP Request" dos fluxos da Logyca: crie um endpoint de entrada autenticado por token próprio.
   - A documentação **não** confirma webhooks, API de contatos, tags ou pipeline. Não invente endpoints. Se precisar de algo além disso, registre como pendência "a validar com a Logyca" no handoff.
3. Separe os três status, em vez de um campo só:
   - `status_atendimento`: novo, em atendimento IA, em atendimento humano, aguardando cliente, sem resposta, encerrado;
   - `status_documental`: não iniciado, aguardando documentos, parcial, completo;
   - `status_analise`: não enviado, em análise, pendente, aprovado, reprovado.
   Mapeie esses status para as etapas atuais do pipeline (`leads.stage`) sem quebrar telas, filtros e relatórios existentes. Migrações devem ser **apenas aditivas**.

## 4. Automações obrigatórias (tudo sem ação manual)

### 4.1 Captação
- Toda mensagem recebida no webhook da Evolution de um telefone sem lead vinculado cria o lead automaticamente, com deduplicação pela chave de telefone já usada no projeto (`chaveTelefone`/`phoneKey`).
- Origem automática: interpretar o código de campanha da primeira mensagem (links wa.me com texto pré-preenchido, ex. "Olá! [ref:instagram-colina-park]"), gravando `sourceChannel`, campanha e empreendimento. Crie na tela um gerador desses links por campanha e empreendimento.
- Também aceitar leads vindos do site e do adaptador Logyca pelo mesmo serviço de entrada (idempotente: a mesma origem e o mesmo ID externo nunca criam dois leads).

### 4.2 Distribuição
- Atribuição automática em rodízio entre os usuários ativos marcados como operadores da Central, respeitando horário de atendimento configurável.
- Se o SLA de primeira resposta humana for estourado (configurável, padrão 15 min em horário comercial), reatribuir automaticamente e registrar o evento.

### 4.3 Agente de IA de atendimento inicial
Use o SDK Anthropic já presente, com a chave obtida do cofre e as configurações do projeto.
- Saudação, coleta do consentimento LGPD (grava `lgpdConsent` e `lgpdConsentAt`) e qualificação: nome, cidade, renda e tipo de renda, FGTS, estado civil e composição de renda, empreendimento ou produto de interesse. Grave cada resposta no campo correspondente do lead.
- A base de conhecimento dos empreendimentos e produtos deve ser **editável em tela** (descrição, cidade, faixa de preço, requisitos). A IA só fala o que está cadastrado.
- Regras proibidas, garantidas por código e por testes: a IA **nunca** promete aprovação de financiamento, nunca informa taxa, parcela ou condição comercial que não esteja cadastrada, nunca decide nada financeiro e nunca marca um cliente como aprovado.
- Transferência automática para humano quando: o cliente pedir; houver reclamação, questão jurídica ou negociação de valor; a confiança da resposta for baixa; ou houver três mensagens seguidas sem progresso. A conversa vai para o operador atribuído, com um resumo gerado pela IA.
- Controle de custo: limite mensal de tokens configurável e registro de consumo por lead. Ao atingir o limite, a IA para e tudo segue para atendimento humano, com alerta ao administrador.

### 4.4 Documentação
- Checklist de documentos por produto ou modalidade (ex.: MCMV, ATC, SBPE), **editável em tela**, sem documentos fixos no código.
- Após a qualificação, o sistema envia automaticamente a lista de documentos pendentes.
- Cada mídia recebida (já salva em `whatsapp_midias` e no Drive) é classificada automaticamente pela IA quanto ao tipo de documento e vinculada a `lead_documents`. Com baixa confiança, o documento é marcado "a conferir" e o fluxo do cliente não para.
- Lembretes automáticos dos documentos pendentes (ex.: D+1, D+3, D+7), executados pelo cron diário existente.
- Quando o checklist estiver completo, `status_documental` vira "completo" e o **encaminhamento para análise acontece automaticamente**: `status_analise` vira "em análise", uma tarefa é criada para o responsável pela análise e o cliente recebe uma mensagem de confirmação. Esse é o gatilho principal do módulo.

### 4.5 Retorno da análise
- A decisão (pendente, aprovado, reprovado) é sempre registrada por um humano, no sistema Prospecta.
- Cada decisão dispara automaticamente:
  - **pendente**: mensagem ao cliente com as pendências descritas pelo analista; volta para "aguardando documentos" e os lembretes recomeçam;
  - **aprovado**: o lead entra na fila de follow-up comercial e o operador é avisado; o cliente recebe uma mensagem de template aprovado, sem citar valores que não estejam registrados;
  - **reprovado**: mensagem neutra ao cliente e transferência para atendimento humano, sem detalhar o motivo por automação.

### 4.6 Follow-up e reativação
- Sequências automáticas configuráveis em tela: follow-up comercial após a aprovação, cliente sem resposta e reativação de contatos inativos (ex.: 30, 60 e 90 dias).
- Proteções obrigatórias: envio apenas entre 8h e 20h (America/Fortaleza); opt-out automático quando o cliente responder "SAIR" ou "PARAR"; limite diário de mensagens automáticas por número e intervalo aleatório entre envios, para reduzir o risco de bloqueio do número (a conexão por QR Code não é a API oficial da Meta).
- Reaproveite `whatsapp_templates` para todos os textos automáticos.

### 4.7 Painel e indicadores
Página "Central de Vendas" no menu administrativo, com: leads recebidos, qualificados, tempo de primeira resposta, atendimentos por operador, aguardando documentos, documentação completa, enviados à análise, pendências, aprovados, taxa de conversão, tempo médio por etapa e origem das oportunidades. Filtros por período, operador, empreendimento e origem. Exportação em CSV. Calcule só com dados reais; onde não houver dado, mostre "sem dados", nunca números estimados.

### 4.8 Controles do administrador
Uma tela de configuração com: interruptor geral das automações; interruptor por automação (IA, documentos, lembretes, follow-up, reativação); **modo de teste**, em que as mensagens só saem para números de uma lista autorizada; horários; SLA; limites de envio e de tokens; checklists; base de produtos; templates.

## 5. Segurança, LGPD e integridade

- Toda automação grava eventos em uma tabela de auditoria (`central_vendas_eventos`: tipo, lead, origem, payload resumido sem dados sensíveis, resultado, erro, data).
- Fila de reprocessamento: falhas de envio ou de IA ficam registradas e são reprocessadas automaticamente com backoff, sem nunca duplicar mensagens (idempotência por chave de evento).
- Endpoints de entrada autenticados por token próprio, guardado no cofre, com validação de payload (zod) e limitação de taxa.
- Documentos nunca são enviados para fora do sistema: apenas referências. Dados pessoais não vão para logs.
- Fonte oficial de cada informação: o sistema Prospecta. Em caso de conflito com dado vindo da Logyca, prevalece o do Prospecta e o conflito é registrado.
- Permissões: só administradores alteram configurações; operadores veem apenas os próprios atendimentos, seguindo o padrão de permissões já existente.

## 6. Regras de trabalho (obrigatórias)

- Nunca altere lógica financeira, BPO, cadastros existentes ou processos atuais sem mapear as dependências e cobrir com testes.
- Migrações apenas aditivas e reversíveis; nunca apague dados.
- **Paridade Grupo Santa Fé** (regra do `CLAUDE.md`): registre no ROADMAP a pendência de portar a Central de Vendas para o Grupo Santa Fé, com a mesma regra de negócio.
- A cada etapa concluída: atualize o `HANDOFF-<dd-mm>-CENTRAL-DE-VENDAS.md` (concluído, pendências, testes automáticos, manuais e pendentes de produção, próximo passo exato), faça commit e push na branch `claude/central-de-vendas` e confirme que o push chegou ao GitHub.
- Ao final, abra um Pull Request. **Merge, deploy e migração em produção só com a minha autorização.**
- Nunca peça nem exponha senhas ou tokens no chat. Use `.env.example` e o cofre de segredos.

## 7. Ordem de implementação

1. Diagnóstico: leitura do código, mapeamento do pipeline e plano registrado no handoff.
2. Migração aditiva: status separados, configurações, produtos, checklists, eventos, fila e sequências.
3. Serviço de entrada de leads (WhatsApp, site, Logyca), com deduplicação e origem.
4. Distribuição automática e SLA.
5. Agente de IA de atendimento e qualificação, com as regras proibidas testadas.
6. Documentação: checklist, classificação, lembretes e encaminhamento automático para análise.
7. Retorno da análise e mensagens automáticas.
8. Follow-up, reativação e proteções de envio.
9. Painel de indicadores e tela de configurações.
10. Adaptador Logyca (desligado por padrão).
11. Testes ponta a ponta em modo de teste, Pull Request e handoff final.

## 8. Testes e critérios de aceite

Cubra com vitest, no mínimo:
- mensagem de número novo cria um único lead, mesmo com webhook repetido;
- rodízio de distribuição e reatribuição por SLA;
- a IA não promete aprovação nem inventa condição, mesmo quando o cliente pede (testes com respostas simuladas e verificação de saída);
- transferência para humano em cada gatilho;
- checklist completo dispara o encaminhamento para análise exatamente uma vez;
- cada decisão da análise dispara a mensagem correta, e nenhuma automação consegue marcar "aprovado";
- opt-out, janela de horário, limite diário e modo de teste bloqueiam envios;
- falha de envio vai para a fila e é reprocessada sem duplicar;
- indicadores batem com os dados de teste.

Antes de cada push rode `pnpm check` e os testes afetados. Use `--maxWorkers=1` se faltar memória.

Critério de pronto: em modo de teste, um número autorizado manda "Olá [ref:teste]" e, sem nenhuma ação manual, o lead é criado, atribuído, atendido e qualificado pela IA, recebe a lista de documentos, envia os documentos, é encaminhado para análise e, depois da decisão registrada pelo analista, recebe automaticamente a mensagem correspondente, com tudo visível no painel e na auditoria.

## 9. Entrega final

No final, responda com: o link do Pull Request, o resumo do que foi feito, as variáveis de ambiente e configurações que eu preciso preencher, o que ficou pendente e o passo a passo do teste ponta a ponta em modo de teste.
