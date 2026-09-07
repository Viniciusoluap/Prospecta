# EPIC-006: WhatsApp

**Epic Owner:** originalmente Codex, assumido pela trilha Claude em 07/09/2026 (Codex ainda não havia iniciado; ver `ROADMAP.md` para o raciocínio)
**Status:** Done (S-01)

**Correção de nome do épico:** o `ROADMAP.md` original nomeia este épico "WhatsApp (Evolution API)". Ao abrir o módulo real do Grupo Santa Fé para portar, ficou claro que `lib/evolution.ts` (cliente da Evolution/Baileys API, não-oficial, via QR code) é **código morto** — nenhum arquivo o importa. A integração de fato em produção é a **API oficial do WhatsApp Business (Meta Cloud API)**, configurada por token de acesso + Phone Number ID, com envio via `graph.facebook.com` e recebimento de status via webhook HMAC-verificado. Esta story porta a integração real (Business API), não a Evolution API — mesmo padrão de correção de referência já visto no EPIC-008 (S-13, `eve.ts` vs `loteamento.ts`).

## Problem Statement

O Grupo Santa Fé tem uma "Central WhatsApp" (`/admin/whatsapp`) que permite a cada corretor/admin conectar seu próprio número via WhatsApp Business Cloud API, disparar mensagens em massa para leads (com templates prontos), e acompanhar histórico de entrega/leitura. Colaboradores usam a conexão do admin. O Prospecta ainda não tem esse módulo.

## Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-01 | Schema Drizzle para conexão WhatsApp (por usuário staff) e histórico de mensagens |
| FR-02 | Envio de mensagem via WhatsApp Business Cloud API (Meta Graph API), com registro de status |
| FR-03 | Webhook para atualização assíncrona de status (entregue/lida/falhou), com verificação HMAC opcional |
| FR-04 | Tela `/admin/whatsapp` com 4 abas: Conexão, Enviar Mensagem, Templates, Histórico — comportamento por papel (admin/corretor gerenciam a própria conexão; colaborador usa a do admin; cliente não tem acesso) |

## Constraints

| ID | Constraint |
|----|-------------|
| CON-01 | Só a Business Cloud API é portada — o caminho Evolution/Baileys (QR code) é código morto na origem e não é replicado (No Invention) |
| CON-02 | Prospecta não tem uma coluna de propriedade de lead por corretor (Santa Fé usa `lead.corretorId`; Prospecta só tem `leads.responsible`, um enum fixo de nomes, não uma FK para `users`) — a lista de leads disponíveis para envio não é filtrada por corretor nesta versão; todo papel staff vê a lista completa. Documentado como adaptação, não invenção de uma FK que não existe. |
| CON-03 | Token de acesso armazenado criptografado (`encryptSecret`/`decryptSecret`, já usado para credenciais Asaas) em vez de texto plano como na origem — mesma prática de segurança já adotada no Prospecta, não uma feature nova |

## Stories

| Story | Title | Status |
|-------|-------|--------|
| S-01 | Conexão WhatsApp Business, envio em massa, templates e histórico | Done |

_Épico de escopo único — a integração é uma unidade coesa (conexão → envio → status), sem sub-módulos independentes como o EPIC-008._
