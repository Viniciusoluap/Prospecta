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
- Etapa 3 — serviço de entrada (este commit): `server/central-vendas/entrada.ts` (`receberContato` +
  `aoReceberMensagemWhatsapp`), `rotas.ts` (POST `/api/central-vendas/entrada/site` e `/entrada/logyca`, Bearer com
  token próprio cifrado, zod `.strict()`, 30 req/min por origem+IP), gancho de 4 linhas no webhook da Evolution,
  rotas registradas em `api/index.ts` e `server/_core/index.ts`, rotina no cron diário existente.
  Regras puras em `shared/central-vendas/regras.ts`; configuração em `shared/central-vendas/config.ts`.
  **Atenção:** os módulos de servidor das etapas 4–8 (`distribuicao.ts`, `ia.ts`, `documentos.ts`, `analise.ts`,
  `sequencias.ts`, `envio.ts`, `rotina.ts`) já entraram neste commit porque o serviço de entrada depende deles;
  cada etapa seguinte traz os testes dela e as correções que os testes apontarem.

### Decisões automáticas (YOLO)
- [AUTO-DECISION] Lead que já existia no CRM e escreve no WhatsApp → entra na Central com atendimento humano
  (operador = responsável atual). A IA só atende quem entrou pela Central (não muda atendimentos em curso).
- [AUTO-DECISION] Modo de teste: números fora da lista são ignorados pela Central (nem lead, nem IA); o WhatsApp
  continua gravando a conversa como antes. Começa **ligado**; o interruptor geral começa **desligado**.
- [AUTO-DECISION] Lead do site recebe a saudação `cv-saudacao` (com o pedido de consentimento LGPD) pelo WhatsApp,
  respeitando a janela 8h–20h. Texto vindo da Logyca não aciona a IA (a Logyca tem os próprios fluxos).

## Migrações criadas (NÃO aplicadas em banco real)
- `drizzle/0110_central_vendas.sql`

## Pendências
- Etapas 4 a 11.

## Testes
- (a) automáticos: `npx tsc --noEmit -p .` ✅; `server/central-vendas-0110.test.ts` ✅ (2);
  `server/central-vendas-entrada.test.ts` ✅ (8: aviso repetido cria 1 lead; 3 avisos simultâneos criam 1 lead; com/sem
  9º dígito; origem/campanha/empreendimento por `[ref:...]`; lead antigo do CRM não é recriado; modo de teste; Central
  desligada; site exige token, valida payload, idempotente por ID externo, sem eco de telefone; Logyca desligada por
  padrão e conflito registrado com o Prospecta prevalecendo; limitação de taxa 429). Testes existentes do WhatsApp
  (7 arquivos, 53 testes) ✅ com o gancho no webhook.
- (b) manuais: nenhum.
- (c) produção: aplicar a 0110 e ligar a Central (só com autorização do dono).

## Próximo passo exato
Etapa 4: testes de rodízio e SLA (`server/central-vendas-distribuicao.test.ts`) sobre `server/central-vendas/distribuicao.ts`.
