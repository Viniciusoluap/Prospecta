# EPIC — Central de Vendas (Prospecta)

Status: InProgress
Data: 12/11/2026
Branch: `claude/central-de-vendas`
Especificação: `docs/prompts/central-de-vendas.md` (prompt do dono do produto)
Handoff: `HANDOFF-12-11-CENTRAL-DE-VENDAS.md`

## Objetivo

Receber, qualificar, acompanhar e converter clientes de forma automática, sobre o CRM (`leads`) e o
WhatsApp por QR Code (Evolution) já existentes. A equipe humana só atua em: decisão da análise,
atendimento transferido pela automação e leitura do QR Code (uma vez).

## Paridade Grupo Santa Fé

Suspensa por ordem do dono em 12/11/2026 (Santa Fé em stand-by). A Central de Vendas deve ser portada
para o Grupo Santa Fé, com a mesma regra de negócio, quando o dono autorizar — pendência registrada no
`ROADMAP.md`. Não é exceção de paridade.

## Stories (ordem da seção 7 do prompt)

| # | Story | Status |
|---|-------|--------|
| CV-01 | Diagnóstico, mapeamento do pipeline e plano | Done |
| CV-02 | Migração aditiva (status, configuração, produtos, checklists, eventos, fila, sequências) | InReview |
| CV-03 | Serviço de entrada de leads (WhatsApp, site, Logyca) com deduplicação e origem | InReview |
| CV-04 | Distribuição automática (rodízio) e SLA | Draft |
| CV-05 | Agente de IA de atendimento e qualificação, com regras proibidas | Draft |
| CV-06 | Documentação: checklist, classificação, lembretes e encaminhamento para análise | Draft |
| CV-07 | Retorno da análise e mensagens automáticas | Draft |
| CV-08 | Follow-up, reativação e proteções de envio | Draft |
| CV-09 | Painel de indicadores e tela de configurações | Draft |
| CV-10 | Adaptador Logyca (desligado por padrão) | Draft |
| CV-11 | Testes ponta a ponta em modo de teste e handoff final | Draft |

## Critério de pronto (seção 8 do prompt)

Em modo de teste, um número autorizado manda "Olá [ref:teste]" e, sem ação manual, o lead é criado,
atribuído, atendido e qualificado pela IA, recebe a lista de documentos, envia os documentos, é
encaminhado para análise e, após a decisão registrada pelo analista, recebe a mensagem
correspondente, com tudo visível no painel e na auditoria.

Merge, deploy e migração em produção só com autorização do dono.
