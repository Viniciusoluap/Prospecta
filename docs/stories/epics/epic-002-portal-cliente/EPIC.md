# EPIC-002: Portal do Cliente

**Epic Owner:** Codex
**Status:** Done (Neon e UAT autenticado pendentes de acesso)

## Problem Statement

O Grupo Santa Fé tem um portal do cliente logado para acompanhar o processo, consultar visitas, acessar contratos/documentos, concluir a assinatura pelo assinador externo do gov.br e conversar com a equipe. Não existe equivalente isolado por cliente no Prospecta.

## Referência (Grupo Santa Fé)

- Snapshot auditado: Grupo Santa Fé `f78f7a75c5d64c7a19329e03218ee8294024eb92`
- Autenticação/vínculo: `web/src/auth.ts`, `web/src/lib/actions/leads.ts`, `Lead.senhaAcesso`
- Portal: `web/src/app/portal/*`, `web/src/lib/data/portal-real.ts`, `web/src/lib/actions/portal.ts`
- Dados: modelos Prisma `Visita`, `Contrato`, `ContratoDocumento` e `ChatMensagem`

## Constraints

| ID | Constraint |
|----|------------|
| CON-01 | Requer alinhar papéis do Prospecta (`admin/user`) para granularidade do Santa Fé (`admin/corretor/colaborador/cliente`) sem quebrar login atual |
| CON-02 | Banco continua no Neon; segurar geração de migration final até EPIC-000 mergear |
| CON-03 | O cliente só pode consultar dados do `leadId` vinculado à própria sessão; IDs recebidos do navegador nunca definem o escopo de leitura |
| CON-04 | Visitas são somente leitura no portal; o agendamento continua sob responsabilidade da equipe, como no Santa Fé |
| CON-05 | A assinatura gov.br é um fluxo externo (baixar PDF, assinar em `assinador.iti.br`, reenviar PDF), sem simular integração de API inexistente |
| CON-06 | Upload assinado aceita somente PDF de até 10 MiB e valida a titularidade do contrato antes de persistir |
| CON-07 | Nenhuma migration será aplicada automaticamente no Neon de produção |

## Stories

| Story | Escopo | Status |
|-------|--------|--------|
| [S-01](S-01-acesso-schema-isolamento.md) | Acesso, schema, vínculo cliente–lead e isolamento | Done |
| [S-02](S-02-dashboard-acompanhamento-visitas.md) | Dashboard, acompanhamento do processo e visitas | Done |
| [S-03](S-03-documentos-assinatura.md) | Contratos, documentos e assinatura externa gov.br | Done |
| [S-04](S-04-chat-cliente-equipe.md) | Chat entre cliente e equipe | Done |
| [S-05](S-05-verificacao-implantacao.md) | Testes, migration e implantação segura | Done |

## Fora de escopo

- Agendamento ou reagendamento autônomo pelo cliente.
- API/OAuth do gov.br ou validação criptográfica da assinatura.
- Alterações na landing page, sorteios, bilhetes, UTEF, produtos e conversões.
- Aplicação automática de migration ou uso de credenciais de produção.
