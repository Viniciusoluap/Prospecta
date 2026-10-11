# EPIC-017: Vínculo real CRM/Leads ↔ Serviços operacionais

**Owner:** Claude / AIOX
**Status:** InReview — implementado na branch `claude/prospecta-epic-017-018-vinculos-reais` (11/10/2026)
**Tipo:** Brownfield
**Dependências:** EPIC-015 (lead_services), EPIC-012

## Problema

Vincular um lead a um serviço (Avaliação, Projeto, Regularização, Obra, Financiamento) era só
decorativo: o módulo listava o lead em "vinculados pelo CRM — Aguardando configuração" e o
profissional precisava recadastrar nome, telefone, e-mail e endereço que o CRM já tinha.

## Investigação (estado anterior)

- `server/lead-services-router.ts → createLeadServiceWithAutomation` só criava registro real para
  Obras (`ensureOperationalRecord`). Para os demais módulos chamava `reconcileExistingProcess`,
  que apenas procura registros já existentes por `lead_id`/`lead_service_id`; sem registro, o
  serviço ficava com `operational_record_id = NULL`.
- `leadServices.listForModule` + `LinkedServiceQueue.tsx` exibiam exatamente esses serviços sem
  registro ("Aguardando configuração" + "Abrir cadastro CRM").
- Os formulários dos módulos ("Solicitar Avaliação", "Novo cadastro" de Projetos, "+ Novo processo"
  de Regularização, "Novo financiamento", "Nova Obra") pediam os dados do cliente à mão; o vínculo
  só acontecia depois, via `attachCompletedProcess`, se houvesse exatamente uma demanda.
- `leads` não tinha CPF, endereço nem bairro — não havia de onde migrar esses dados.
- "Responsável" era o enum fixo `lead_responsible` (`sarah`/`vinicius`/`bianca`).

## Solução

- Fonte única de contato: `shared/lead-snapshot.ts` (`leadContact`, `leadFullAddress`).
- Migration `0031_epic017_018_vinculos_reais`: `leads.cpf/address/neighborhood/responsible_user_id/
  broker_id`, `avaliacoes.lead_service_id` (+ colunas do EPIC-018).
- Projetos e Regularizações: o vínculo no CRM cria o registro real com os dados do lead
  (`ensureLinkedRecord`); demandas antigas são convertidas pela mutation
  `leadServices.materializePending`, disparada automaticamente pela fila do módulo.
- Avaliações, Financiamentos e Obras: criação exige lead do CRM (seletor buscável `LeadPicker`);
  o servidor copia os dados do lead e `linkRecordToLead` conecta (ou cria) o serviço no lead.
- Com lead vinculado, os campos de cliente ficam somente leitura e são sincronizados pelo servidor.

## Stories

| ID | Título | Status |
|---|---|---|
| 1.1 | Avaliações: seletor de lead no lugar do cadastro manual | InReview |
| 1.2 | Projetos: registro real criado pelo vínculo no CRM | InReview |
| 1.3 | Regularização: registro real criado pelo vínculo no CRM | InReview |
| 1.4 | Obras: nunca cadastro avulso | InReview |
| 1.5 | Financiamentos: nunca cadastro avulso | InReview |
| 1.6 | CRM: sem renda/tipo de renda; corretor vinculado | InReview |
| 1.7 | CRM: remover "Desvincular" | InReview |
| 1.8 | CRM: Responsável vindo dos usuários reais | InReview |

## Pré-requisito de deploy

A migration `drizzle/0031_epic017_018_vinculos_reais.sql` (aditiva, idempotente) **precisa ser
aplicada no Neon antes do deploy** — `select()` em `leads` passa a incluir as colunas novas.

## Paridade Grupo Santa Fé

Pendente: portar as mesmas regras para o Santa Fé (ver ROADMAP).
