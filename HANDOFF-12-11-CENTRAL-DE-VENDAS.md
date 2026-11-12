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
- Etapa 1 — diagnóstico, épico e stories (este commit).

## Pendências
- Etapas 2 a 11.

## Testes
- (a) automáticos: nenhum nesta etapa (só documentação).
- (b) manuais: leitura do código.
- (c) produção: nada.

## Próximo passo exato
Etapa 2: criar `drizzle/0110_central_vendas.sql` + `drizzle/schema-central-vendas.ts` + teste PGlite.
