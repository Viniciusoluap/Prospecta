# CV-03 — Serviço de entrada de leads

Status: InReview

## Critérios de aceite
- [x] Mensagem de telefone sem lead no webhook da Evolution cria o lead uma única vez (chave de telefone `chaveTelefone`), mesmo com webhook repetido ou concorrente.
- [x] Código de campanha `[ref:...]` na primeira mensagem grava origem (`sourceChannel`), campanha e empreendimento.
- [x] Gerador de links wa.me por campanha e empreendimento.
- [x] Site e Logyca usam o mesmo serviço; mesma origem + mesmo ID externo nunca criam dois leads.
- [x] Endpoints de entrada com token próprio (cofre), zod e limitação de taxa.

## File List
- `server/central-vendas/entrada.ts`
- `server/central-vendas/rotas.ts`
- `server/central-vendas/base.ts`
- `server/central-vendas/envio.ts`
- `shared/central-vendas/config.ts`
- `shared/central-vendas/regras.ts`
- `shared/central-vendas/templates.ts`
- `server/whatsapp-evolution-webhook.ts (gancho)`
- `api/index.ts (rotas + cron)`
- `server/_core/index.ts (rotas)`
- `server/__fixtures__/central-vendas/cenario.ts`
- `server/central-vendas-entrada.test.ts`

## Change Log
- 12/11/2026 — story criada (Draft) a partir da seção 7 do prompt.
- 12/11/2026 — implementada (InReview). Gerador de links: regra pura `linkCampanha` (tela na etapa 9). Lead já existente no CRM fica com atendimento humano (a IA só atende quem entrou pela Central) — [AUTO-DECISION].
