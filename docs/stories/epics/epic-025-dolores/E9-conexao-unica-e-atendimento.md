# E9 — Conexão única do WhatsApp, atendimento e campanhas

Status: InProgress
Epic: EPIC-025 (Etapa 9). Regra do dono: CLAUDE.md, seção "WhatsApp — uma conexão só, atendimento e campanhas (20/11/2026)",
itens 1 a 8 ("Autorizo os itens 1 a 7, pode executar").
Paridade: suspensa por ordem do dono em 16/11 (Grupo Santa Fé em espera); registrar no ROADMAP o que portar.
Ramo: `epic025-dolores-etapa9b` (sobre a Etapa 7, `fd43b31`); push em `claude/wip-epic025-dolores-etapa9b`.
Migração: **`0135_whatsapp_conexao_unica.sql`** (0117–0134 já em produção).

## Levantamento (código antes da mudança)
1. Duas conexões: (a) Dolores — instância `prospecta-dolores`, linha `dolores_whatsapp_config` (instância, status, número),
   cartão `DoloresCard.tsx` com QR/Conferir/Reativar/Desconectar, webhook `POST /api/dolores/whatsapp` (HMAC próprio +
   checagem da instância) em `server/dolores/whatsapp.ts`; (b) Central — `whatsapp_connections` (UMA por usuário; o
   colaborador usa a do primeiro admin, `donoDaConexao`), webhook `server/whatsapp-evolution-webhook.ts` (acha a conexão pela
   instância), telas `AdminWhatsApp.tsx` + `ConexaoWhatsApp`/`ConexaoQrCode`.
2. No webhook da Dolores, mensagem direta de quem não é o dono só era contada (`dolores_remetentes_estranhos`) e `fromMe` era
   ignorada; grupos seguem E4/E4b/E7. Nada chegava à Central pela instância da Dolores.
3. Cadastros com telefone: `leads.phone` (CRM; obra, incorporação e jurídico se ligam ao lead), `financiamentos.cliente_tel`,
   `regularizacoes.client_phone`, `avaliacoes.cliente_tel`, `operational_projects.client_phone`; usuários em `users.phone`.
   As leituras fechadas da E4b (`leitura/grupo-marcado.ts`) são por `leadId`.
4. Segredos do painel ficam em `dashboard_settings` com `secret-vault` (Anthropic: `segredo.anthropic_painel_api_key`).
5. `whatsapp_messages` não tem índice único por `external_id`; o webhook da Central evita duplicar por consulta prévia.

## Critérios de aceite (itens do dono)
- [ ] AC1 — Conexão única em Integrações (cartão "WhatsApp da empresa (Dolores e Central)"), reaproveitando a instância já
      conectada (sem novo QR). Central do admin opera por ela (conexão efetiva resolvida por código, sem gravar a linha do
      admin). "Minha conexão": admin vê só "Conexões dos Corretores (n)"; corretor/colaborador como hoje.
- [ ] AC2 — Roteamento num ponto só, por código, com reentrega sem duplicar.
- [ ] AC3 — Saudação de campanha (uma ativa, uma vez por número por campanha, só a desconhecido, teto diário, texto fixo filtrado).
- [ ] AC4 — Dolores atende cliente cadastrado (identificação estrita pelo telefone, escopo travado, sem valores, silêncio após a
      equipe, interruptor desligado, tetos, orçamento próprio, falha fechada).
- [ ] AC5 — Ligação e áudio (aviso 1x/3h, textos editáveis, grupo em silêncio; áudio do dono não vira comando).
- [ ] AC6 — Transcrição pela Cloudflare Workers AI (credenciais no painel, desligada por padrão, tetos e prazo).
- [ ] AC7 — Ponto único de escolha do canal de disparo (só Evolution; API oficial desligada) e aviso de disparo em massa bloqueado.
- [ ] AC8 — Migração 0135 aditiva e idempotente (aplicada 2x nos testes).

## Decisões
(preenchido ao longo da implementação)

## File List
- `drizzle/0135_whatsapp_conexao_unica.sql` (novo)
- `drizzle/schema-whatsapp-atendimento.ts` (novo)
- `drizzle/schema.ts` (coluna `whatsapp_messages.automatica`)
- `drizzle.config.ts`
- `server/dolores/testes-banco.ts`

## Change Log
- 20/11/2026 — @dev (Dex): Ready → InProgress; levantamento e migração 0135.
