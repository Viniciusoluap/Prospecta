# Story S-01 — Conexão WhatsApp Business, Envio em Massa, Templates e Histórico
**Epic:** EPIC-006
**Status:** Done
**executor:** @dev
**quality_gate:** @dev
**quality_gate_tools:** [tsc, build, test, manual-review]

## Contexto

Porta a "Central WhatsApp" do Grupo Santa Fé (`/admin/whatsapp`), que hoje não existe no Prospecta. Corretores e o admin conectam seu próprio número via WhatsApp Business Cloud API (Meta), disparam mensagens em massa para leads com templates prontos, e acompanham status de entrega/leitura. Colaboradores usam a conexão do admin.

**Correção de referência (achada ao abrir o código-fonte):** o ROADMAP nomeia este épico "WhatsApp (Evolution API)". `lib/evolution.ts` do Santa Fé (cliente Evolution/Baileys, QR code) é código morto — nenhum import fora de si mesmo. A integração real em produção usa a **Business Cloud API oficial da Meta** (`graph.facebook.com`), configurada por token + Phone Number ID. Esta story porta a integração real.

## Acceptance Criteria

- [x] AC-01: Schema Drizzle para `whatsapp_connections` (1 por usuário staff) e `whatsapp_messages` (histórico), migration aplicada em produção
- [x] AC-02: Router tRPC com conexão (salvar/desconectar), leitura de conexão própria (com regra especial de colaborador usando a do admin), lista de conexões dos corretores (admin), histórico (escopado por papel) e envio em massa
- [x] AC-03: Envio via Meta Graph API (`enviarWhatsappBusiness`), com registro de status por destinatário (enviada/falhou) e atualização assíncrona via webhook (entregue/lida/falhou)
- [x] AC-04: Tela `/admin/whatsapp` com 4 abas (Conexão/Enviar Mensagem/Templates/Histórico), mesmos 6 templates fixos da origem, KPIs (leads disponíveis/enviadas/taxa de leitura/falhas)
- [x] AC-05: `tsc --noEmit`, `npm run build` e `npm test` (com testes novos) passam limpos; segunda geração do Drizzle retorna "No schema changes"

## Decisões de implementação (adaptações deliberadas, não invenção)

- **Só a Business Cloud API é portada** — a Evolution API (QR code/Baileys) é código morto na origem, não replicada.
- **Token criptografado em vez de texto plano**: a origem grava `token` em texto plano no Postgres; o Prospecta já tem `encryptSecret`/`decryptSecret` (usado para credenciais Asaas) — reaproveitado aqui para o token do WhatsApp. Mesma prática de segurança já adotada no projeto, não uma feature nova.
- **Sem filtro de leads por corretor**: o Santa Fé filtra a lista de leads disponíveis para envio por `lead.corretorId` quando o papel é corretor. O Prospecta não tem essa FK — `leads.responsible` é um enum fixo de nomes, não uma referência a `users`. Em vez de inventar essa associação, todo papel staff (admin/corretor/colaborador) vê a lista completa de leads para envio nesta versão.
- **Rota `/admin/whatsapp` protegida por `AdminRoute` (admin-only no cliente)**: assim como toda página `/admin/*` existente no Prospecta hoje, mesmo que o router tRPC já suporte corretamente `corretor`/`colaborador` (`STAFF_ROLES`) na lógica de negócio. O Prospecta ainda não tem uma área própria de navegação para corretor/colaborador fora do admin — criar uma agora seria escopo novo não pedido por esta story. Documentado como limitação conhecida, não invenção.
- **Webhook registrado com corpo bruto (`express.raw`) antes do `express.json()`**, mesmo padrão já usado para o webhook do Stripe — necessário para a verificação HMAC opcional (`WHATSAPP_WEBHOOK_SECRET`) funcionar corretamente.
- **Templates portados como dado estático** (`shared/whatsapp/templates.ts`) — mesmos 6 textos da origem, com "Grupo Santa Fé" trocado por "Prospecta".

## Validação — honestidade de status (regra do dono do produto)

**Testado automaticamente:** `tsc --noEmit` limpo, `npm run build` limpo, `npm test` — **245/245 passando** (8 testes novos em `server/whatsapp-business.test.ts`: normalização de número de telefone, mapeamento de status de webhook, integridade dos templates). Migration aplicada em produção com snapshot de segurança antes (`snap` do Neon), schema resultante confirmado (`whatsapp_connections`/`whatsapp_messages` existem, migration registrada), segunda geração do Drizzle confirma "No schema changes".

**Não testado de ponta a ponta:** envio real de mensagem via Meta Graph API (exige conta Meta Business verificada e token real, que não existem neste ambiente) e navegação da tela em navegador real (mesma limitação de sandbox sem acesso à internet documentada nas stories anteriores). **Recomendação:** após configurar uma conta Meta Business de teste, conectar pela aba "Conexão" e validar o envio real para um número de teste.

## Tasks

- [x] `drizzle/schema.ts` — tabelas `whatsappConnections`/`whatsappMessages` + migration `0009_chilly_slapstick.sql` aplicada em produção
- [x] `shared/whatsapp/templates.ts` — 6 templates fixos
- [x] `server/_core/whatsapp-business.ts` — `enviarWhatsappBusiness`/`normalizarNumero`/`normalizarStatusWebhook`
- [x] `server/whatsapp-router.ts` — router tRPC completo + `aplicarStatusWebhook`
- [x] `server/whatsapp-webhook.ts` + registro em `server/_core/index.ts` (raw body antes do `express.json()`)
- [x] `client/src/pages/admin/AdminWhatsApp.tsx` — tela com 4 abas
- [x] Rota `/admin/whatsapp` em `client/src/App.tsx` + card no dashboard (`client/src/pages/Admin.tsx`)
- [x] Testes: `server/whatsapp-business.test.ts`
- [x] `tsc --noEmit`, `npm run build`, `npm test`
- [x] EPIC-006 marcado Done em `EPIC.md`/`ROADMAP.md`

## File List

- `drizzle/schema.ts`
- `drizzle/0009_chilly_slapstick.sql`
- `shared/whatsapp/templates.ts`
- `server/_core/whatsapp-business.ts`
- `server/whatsapp-router.ts`
- `server/whatsapp-webhook.ts`
- `server/_core/index.ts`
- `server/routers.ts`
- `server/whatsapp-business.test.ts`
- `client/src/pages/admin/AdminWhatsApp.tsx`
- `client/src/App.tsx`
- `client/src/pages/Admin.tsx`
- `docs/stories/epics/epic-006-whatsapp/EPIC.md`
- `docs/stories/epics/ROADMAP.md`

## Validation Notes (@po)

Story fecha um épico inteiro que estava "a dividir" e nunca havia sido iniciado pela trilha Codex. Correção de referência (Business API real vs. Evolution API morta) registrada com a mesma transparência do EPIC-008 S-13. Adaptação sobre filtro de leads por corretor documentada em vez de inventar uma FK inexistente. **Score: 9/10**.

**Verdict: GO**

## QA Results (@qa)

Code review: `enviarWhatsappBusiness`/`normalizarStatusWebhook` conferem termo a termo com a origem. Token armazenado criptografado (melhoria de segurança sobre a origem, consistente com o padrão já usado para Asaas). Webhook com corpo bruto, mesma técnica do Stripe. Nenhuma dependência nova. Mutations restritas por papel (`requireRole`). `tsc`/`build`/`test` limpos (245/245), migration validada em produção. **Verdict: PASS**.

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-07 | 0.1.0 | Story criada e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-07 | 1.0.0 | Implementado e validado; EPIC-006 fechado — Status: Ready → Done | @dev / @qa |
