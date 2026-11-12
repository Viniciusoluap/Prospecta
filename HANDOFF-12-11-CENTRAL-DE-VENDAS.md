# Handoff — 12/11/2026 — Central de Vendas (Prospecta)

Branch: `claude/central-de-vendas` (a partir de `origin/main` em `eebdf3f`).
Especificação: `docs/prompts/central-de-vendas.md`. Épico e stories: `docs/stories/epics/epic-central-de-vendas/`.
Merge, deploy e migração em produção: **só com autorização do dono**. Nenhuma migração foi aplicada em banco real.

## Paridade Grupo Santa Fé
Suspensa por ordem do dono em 12/11 (Santa Fé em stand-by). Nada foi portado. Pendência registrada no
`docs/stories/epics/ROADMAP.md`: portar a Central de Vendas com a mesma regra de negócio quando o dono mandar.

## Diagnóstico (etapa 1)

### Pipeline atual (`shared/lead-pipeline.ts`)
`leads.stage` é varchar com 7 etapas comerciais: `lead_new` (Lead Novo) → `attending` (Em Atendimento) →
`approved_projects` (Aprovado e Follow up) → `followup` (Projetos e Vistorias) → `contracts_registry`
(Contratos e Cartório) → `measurements` (Medições) → `finalized` (Finalizado). Etapas legadas
(`waiting_docs`, `analysis`, `approved`, `rejected`...) só aparecem como rótulo de leitura.

### Mapeamento dos três status para as etapas (sem quebrar telas/filtros/relatórios)
Os status ficam numa tabela nova 1:1 (`central_vendas_leads`), não em `leads`; `leads.stage` só avança, nunca recua:
- `status_atendimento` novo → `lead_new`; em atendimento IA/humano, aguardando cliente → `attending` (se ainda em `lead_new`);
- `status_documental` e `status_analise` (não enviado, em análise, pendente) → continuam em `attending`;
- `status_analise = aprovado` → `approved_projects` (se o lead estiver antes dessa etapa);
- reprovado → etapa não muda (transferência para humano); encerrado → etapa não muda.

### Reaproveitado (não duplicado)
- `leads` (nome, telefone, cidade, `income`, `incomeType`, `fgtsAmount`, `hasSpouse`, `incomeComposition`,
  `sourceChannel`, `responsibleUserId`, `lgpdConsent`, `lgpdConsentAt`, `stage`), `lead_activities`
  (handoff/status_change/document), `lead_documents` (documentos classificados), `tasks` (tarefa do analista),
  `user_notifications` (avisos a operador/analista/admin).
- WhatsApp Evolution: `whatsapp_connections`, `whatsapp_messages` (direção, mídia), `whatsapp_midias` (cópia no
  Drive), `whatsapp_conversation_links`, `whatsapp_templates` (todos os textos automáticos, slug `cv-*`),
  `server/whatsapp-evolution-webhook.ts` (gancho único depois de gravar a mensagem recebida),
  `configEvolution` + `enviarTextoEvolution`, `chaveTelefone` (DDD + 8 últimos dígitos).
- Cofre: `encryptSecret`/`decryptSecret` (`server/_core/secret-vault.ts`) para tokens de entrada, token da Logyca
  e chave opcional da IA (reserva: `ANTHROPIC_API_KEY`, igual ao resto do sistema).
- Cron diário `/api/cron/lead-card-due` (sem cron novo na Vercel).
- Permissões: router `centralVendas` no módulo `crm`; configurações só admin; colaborador vê só os próprios atendimentos.
- Neon HTTP sem transação interativa: nada usa `transaction`; atomicidade por `INSERT ... ON CONFLICT`,
  `UPDATE ... WHERE <estado> RETURNING` (reivindicação) e chaves únicas.

### Plano por etapa
Ver `docs/stories/epics/epic-central-de-vendas/EPIC.md` (CV-01 a CV-11).

## Concluído
- Etapa 1 — diagnóstico, épico e stories (`4946d13`).
- Etapa 2 — migração aditiva `drizzle/0110_central_vendas.sql`, `drizzle/schema-central-vendas.ts` (`0eb15bd`).
- Etapa 3 — serviço de entrada (`f3022a1`): `server/central-vendas/entrada.ts` (`receberContato` +
  `aoReceberMensagemWhatsapp`), `rotas.ts` (POST `/api/central-vendas/entrada/site` e `/entrada/logyca`, Bearer com
  token próprio cifrado, zod `.strict()`, 30 req/min por origem+IP), gancho de 4 linhas no webhook da Evolution,
  rotas registradas em `api/index.ts` e `server/_core/index.ts`, rotina no cron diário existente.
  Regras puras em `shared/central-vendas/regras.ts`; configuração em `shared/central-vendas/config.ts`.
  **Atenção:** os módulos de servidor das etapas 4–8 (`distribuicao.ts`, `ia.ts`, `documentos.ts`, `analise.ts`,
  `sequencias.ts`, `envio.ts`, `rotina.ts`) já entraram neste commit porque o serviço de entrada depende deles;
  cada etapa seguinte traz os testes dela e as correções que os testes apontarem.
- Etapa 4 (`47ec117`) — distribuição e SLA: rodízio por id entre operadores ativos (`atribuirOperador`, preenche também o
  `responsibleUserId` do CRM quando vazio) e `verificarSla` (estouro → próximo operador, aviso, auditoria
  `sla_reatribuido`, relógio recomeça; sem outro operador → `sla_estourado` + aviso ao admin uma vez).
- Etapa 5 (`c0f6481`) — agente de IA (`server/central-vendas/ia.ts`): prompt com só os produtos cadastrados; saída JSON em lista
  fechada (`lerSaidaIA` descarta qualquer campo extra, como "statusAnalise"); dados gravados nos campos do lead só
  após o consentimento LGPD (`lgpdConsent`/`lgpdConsentAt`); toda resposta passa por `violacoesResposta` antes de
  sair (promessa de aprovação, valor/taxa/parcela fora do cadastro, "reprovado") → bloqueada e vai para humano;
  gatilhos por código no texto do cliente (atendente, reclamação, jurídico, negociação) nem chamam a IA; baixa
  confiança, pedido do modelo e 3 mensagens sem progresso → humano com resumo da IA (reserva sem IA); limite mensal
  de tokens com consumo por lead e aviso ao admin 1x/mês; falha da IA → fila com backoff → esgotou → humano.
- Etapa 6 (`e5d113f`) — documentação (`server/central-vendas/documentos.ts`): checklist do lead = do produto/campanha ou o
  checklist padrão da configuração (nenhum documento fixo no código; sem checklist → evento `sem_checklist` +
  aviso ao operador); lista de pendentes logo após a qualificação; cada mídia recebida vira `lead_documents`
  (link `/api/whatsapp/midia/<id>` + cópia do Drive quando houver), classificada por metadados (regra → IA);
  confiança < 0,7 → "a conferir" (conta, o fluxo segue, operador avisado); lembretes D+1/D+3/D+7 (configuráveis)
  no cron diário; checklist completo → `completo` + `em_analise` + tarefa ao analista + aviso + mensagem, uma vez
  (UPDATE condicionado ao estado anterior).
- Etapa 7 (`bf0adfc`) — retorno da análise (`server/central-vendas/analise.ts`, `registrarDecisao`): só admin ou analista da
  Central, ativo; pendente → mensagem com as pendências descritas, volta a "aguardando documentos" e os lembretes
  recomeçam da decisão; aprovado → etapa `approved_projects` (só avança), temperatura `hot`, aviso ao operador e
  template sem valores (entra no follow-up da etapa 8); reprovado → mensagem neutra, atendimento humano, motivo só
  em `leads.rejection_reason`. Mensagens da decisão respeitam a janela 8h–20h.
- Etapa 8 (`86f33c6`) — follow-up, reativação e proteções (`envio.ts`, `sequencias.ts`, `rotina.ts`): fila única com chave
  idempotente; opt-out "SAIR"/"PARAR" (confirmação 1x, pendentes cancelados, próximos descartados); modo de teste;
  janela 8h–20h America/Fortaleza para proativas (adiadas para a abertura + até 30 min espalhados); limite diário
  por número (adiado para o dia seguinte); intervalo aleatório entre envios seguidos; falha → backoff 1/2/4/8 min,
  5 tentativas → "falhou" + aviso ao admin; queda no meio → "incerto" (nunca reenviado sozinho). Sequências
  `followup_aprovado`, `sem_resposta` e `reativacao` com passos em dias e template; só o passo mais avançado
  vencido vai (sem rajada); o cliente responder reinicia o ciclo.
- Etapa 9 (`b50ed47`) — painel e configurações: `shared/central-vendas/indicadores.ts` (recebidos, qualificados, 1ª resposta,
  por operador, aguardando docs, docs completos, enviados à análise, em análise, pendências, aprovados,
  reprovados, conversão, tempo médio por etapa, origem; null → "sem dados"; CSV ";" + BOM sem telefone/CPF/renda);
  router `centralVendas` (`server/central-vendas/router.ts`, módulo `crm`; configurações/produtos/checklists/
  sequências/campanhas/templates/auditoria/fila só admin; operador vê só os próprios; decisão só admin/analista);
  tela `client/src/pages/admin/AdminCentralVendas.tsx` em `/admin/central-vendas` (cartão "Central de Vendas" no
  painel administrativo), abas Painel, Atendimentos (decisão da análise, reativar automação, encerrar),
  Configurações (interruptor geral e por automação, modo de teste + números, operadores/analistas, horários, SLA,
  limites, tokens, modelo, lembretes, checklist padrão, tokens de entrada gerados e mostrados 1x, Logyca, chave da
  IA no cofre, "executar rotina agora"), Produtos, Checklists, Sequências, Campanhas (gerador de links wa.me),
  Templates (`whatsapp_templates` slug `cv-*`) e Auditoria (eventos + fila com reprocessar).
  `server/whatsapp-router.ts`: templates `cv-*` no banco não escondem mais os 6 templates padrão da Central WhatsApp.
- Etapa 10 (`325a4ac`) — adaptador Logyca (`server/central-vendas/logyca.ts`), **desligado por padrão**
  (`config.logyca.ativo = false`): envio POST https no endpoint copiado de "Mensagens API", `Authorization: Bearer`,
  corpo `{ "number", "message" }` (usado pela fila quando "Enviar pela Logyca" estiver ligado, com backoff);
  entrada POST `/api/central-vendas/entrada/logyca` para o bloco "HTTP Request" (token próprio gerado na tela).
  Conflito de dado: prevalece o Prospecta e o conflito vai para a auditoria (`conflito_logyca`).

- Etapa 11 (este commit) — teste ponta a ponta do critério de pronto (`server/central-vendas-e2e.test.ts`); analista
  passa a ver na aba Atendimentos os leads que aguardam a decisão dele (antes via só os próprios).

## A validar com a Logyca (a documentação não confirma)
- Formato da resposta do envio (há ID da mensagem? status de entrega?) — hoje só `HTTP 2xx` = enviado.
- Se o envio de **mídia** usa o mesmo endpoint/corpo (a doc cita texto e mídia; só texto foi implementado).
- Webhooks de mensagens recebidas, API de contatos, tags e pipeline — **não implementados** (não documentados).
- Corpo que o bloco "HTTP Request" deve mandar: definido por nós —
  `{ "telefone", "nome"?, "email"?, "cidade"?, "mensagem"?, "idExterno"?, "campanha"?, "consentimentoLgpd"? }`
  com `Authorization: Bearer <token de entrada da Logyca>`; confirmar se o bloco permite cabeçalho e JSON assim.

### Decisões automáticas (YOLO)
- [AUTO-DECISION] Lead que já existia no CRM e escreve no WhatsApp → entra na Central com atendimento humano
  (operador = responsável atual). A IA só atende quem entrou pela Central (não muda atendimentos em curso).
- [AUTO-DECISION] Modo de teste: números fora da lista são ignorados pela Central (nem lead, nem IA); o WhatsApp
  continua gravando a conversa como antes. Começa **ligado**; o interruptor geral começa **desligado**.
- [AUTO-DECISION] SLA: a Vercel só tem o cron diário; a verificação de SLA roda a cada aviso de mensagem do
  WhatsApp (no máximo 1x por minuto), ao abrir o painel e no cron diário. Sem tráfego de mensagens, um SLA pode ser
  detectado com atraso — alternativa (manual, opcional): um pinger externo chamando o cron.
- [AUTO-DECISION] Documento nunca vai à IA: a classificação usa só nome do arquivo, tipo e legenda (seção 5 do
  prompt: "documentos nunca são enviados para fora do sistema"). Classificação visual pela IA ficaria a critério do dono.
- [AUTO-DECISION] Janela 8h–20h: vale para mensagens por iniciativa da empresa (lembretes, sequências, decisão da
  análise, saudação do site). Resposta imediata a uma mensagem do cliente (IA, lista de documentos, confirmação de
  análise, transferência) sai na hora; o limite diário vale para todas.
- [AUTO-DECISION] Opt-out fica até um humano reativar a automação do lead (botão na tela da Central).
- [AUTO-DECISION] Permissão: a Central faz parte do módulo `crm` (sem módulo novo em `ADMIN_MODULES`, lista
  espelhada com o Santa Fé e coberta por testes). Configurações só admin; analista = colaborador marcado na Central.
- [AUTO-DECISION] Lead do site recebe a saudação `cv-saudacao` (com o pedido de consentimento LGPD) pelo WhatsApp,
  respeitando a janela 8h–20h. Texto vindo da Logyca não aciona a IA (a Logyca tem os próprios fluxos).

## Migrações criadas (NÃO aplicadas em banco real)
- `drizzle/0110_central_vendas.sql` — só `CREATE TABLE/INDEX IF NOT EXISTS` (12 tabelas `central_vendas_*`).
  Reversão: `DROP TABLE` das `central_vendas_*`. Nenhuma tabela existente alterada.

## O que o dono precisa preencher (depois do merge/deploy autorizados)
1. Aplicar a migração 0110 no Neon (com autorização).
2. Variáveis já existentes no sistema (nenhuma nova obrigatória): `ANTHROPIC_API_KEY` (ou a chave própria da IA na
   tela, guardada no cofre), `JWT_SECRET` (cofre), `CRON_SECRET` (cron diário), Evolution conectada por QR code.
3. Na tela Central de Vendas › Configurações: operadores e analistas; números de teste; checklist(s) e
   checklist padrão; produtos/empreendimentos (descrição, preço, requisitos, condições — a IA só fala isso);
   sequências (follow-up, sem resposta, reativação 30/60/90 — nenhuma vem criada); campanhas; gerar o token do
   site (se o site for mandar leads) e, se for usar, o token de entrada e o endpoint/token de envio da Logyca.
4. Ligar o interruptor geral (começa **desligado**; o modo de teste começa **ligado**).

## Pendências / não feito
- Validação visual da tela em navegador (não aberta nesta sessão; só `tsc` e `vite build`).
- SLA em minutos depende de tráfego (aviso do WhatsApp, painel aberto) ou do cron diário — não há cron de minutos.
- Classificação de documentos só por metadados (nome/tipo/legenda), por regra de privacidade do prompt.
- Envio de mídia pela Logyca, resposta/ID do envio e formato do bloco HTTP Request: a validar com a Logyca.
- Paridade Santa Fé suspensa: pendência registrada no `ROADMAP.md` da Prospecta. O `CLAUDE.md` atualizado também
  pede registro em `HANDOFF-12-11-STANDBY-PARIDADE.md` na raiz do **Grupo Santa Fé** — não feito, porque esta
  sessão foi proibida de mexer no repositório do Santa Fé; fica para quem tiver essa permissão.
- Pull Request: não aberto (o coordenador abre). Merge, deploy e migração em produção: só com o dono.

## Testes
- (a) automáticos (12/11, nesta branch): `npx tsc --noEmit -p .` ✅; `npx vitest run` (suíte completa) ✅
  **205 arquivos, 1715 testes**; `npx vite build` ✅; `git diff --check` ✅. Da Central: 10 arquivos
  `server/central-vendas-*.test.ts` (0110, entrada, distribuição, IA, documentos, análise, envio, painel,
  Logyca, e2e). Nenhum teste chama Anthropic, Evolution ou Logyca de verdade (envio/IA/fetch simulados) e nenhum
  toca banco real (PGlite em memória, tabelas geradas do `drizzle/schema.ts` + 0110).
- (b) manuais: nenhum (sem navegador nem banco real nesta sessão).
- (c) produção: aplicar a 0110; conectar a Evolution; rodar o roteiro abaixo com um número de teste.

## Teste ponta a ponta em modo de teste (roteiro manual)
1. Configurações: modo de teste ligado, seu número na lista, você como operador e analista, salvar.
2. Checklists: criar "MCMV" com RG, comprovante de renda e de residência. Produtos: criar código `teste` com o
   checklist. Ligar o interruptor geral. Salvar.
3. Do número autorizado, mandar "Olá [ref:teste]" para o WhatsApp conectado → o lead aparece no CRM atribuído a
   você e a IA pede o consentimento LGPD.
4. Responder SIM e os dados (nome, cidade, renda e tipo, FGTS, estado civil, composição, interesse) → chega a
   lista de documentos.
5. Mandar os 3 documentos (PDF/foto com nome claro, ex. "rg.pdf", "holerite.pdf", "comprovante de residencia.pdf")
   → mensagem "encaminhado para análise" e tarefa "Análise — <nome>" na Agenda.
6. Central de Vendas › Atendimentos → Aprovar (ou Pendente/Reprovar) → a mensagem correspondente chega.
7. Conferir Painel (recebidos, qualificados, enviados, aprovados) e Auditoria (eventos e fila).
8. Mandar "SAIR" → confirmação e mais nenhuma mensagem automática.

## Próximo passo exato
Coordenador abre o PR de `claude/central-de-vendas`; com autorização do dono: merge, deploy, aplicar a 0110 e
executar o roteiro acima. Depois, QA (`@qa`) das stories CV-02 a CV-11 e, quando o dono mandar, portar ao Santa Fé.
