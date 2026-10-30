# HANDOFF 30/10 — WhatsApp › Enviar mensagem › filtro por etapa do lead

Branch: `claude/whatsapp-filtro-etapa-20261030` (gêmea no Grupo Santa Fé, mesmo nome). Sem migração.

## Feito
- Card "Destinatários": select à direita do título com "Todas as etapas" + as 7 etapas do CRM
  (`LEAD_PIPELINE_STAGES` — o mesmo do filtro de etapas do CRM: Lead Novo … Finalizado). No celular o
  select quebra para a linha de baixo (`flex-wrap`, `w-full sm:w-auto`).
- `whatsapp.leadsParaEnvio` devolve `etapa` (= `leads.stage`, como o filtro do CRM; lead com
  `stageClassificationPending` fica sem etapa, como no quadro do CRM, e só aparece em "Todas as etapas").
  Excluídos continuam fora (`deletedAt`).
- Lista sem paginação: "Selecionar todos (N)" mostra o total filtrado (etapa + busca) e marca todos.
- Seleções feitas antes de trocar o filtro são mantidas; "Selecionar todos"/"Limpar" agem só nos visíveis;
  linha "N selecionados no total (M fora deste filtro)".
- Envio: o servidor manda uma mensagem individual por destinatário (laço em `whatsapp.enviar`, não é
  grupo). Como `enviar` aceita no máximo 200 destinatários, a tela agora envia em lotes de 200
  (`lotesDeEnvio`, `LOTE_ENVIO_WHATSAPP` usado também no zod) — etapa com mais de 200 leads envia a todos.
  A prévia usa os 200 primeiros (teto do `previaEnvio`).
- Arquivos: `shared/whatsapp/conversas.ts`, `server/whatsapp-router.ts`,
  `client/src/pages/admin/AdminWhatsApp.tsx`, `server/whatsapp-filtro-etapa.test.ts` (novo),
  `server/whatsapp-lote3.test.ts` (etapa no `leadsParaEnvio`, PGlite).

## Testes
- (a) Automáticos: `pnpm vitest run` whatsapp-filtro-etapa + whatsapp-lote3 (17/17), whatsapp-noite +
  rbac-legacy-migration (30/30); `pnpm check` ok; `pnpm build` ok.
- (b) Manuais: nenhum (sem navegador nesta sessão).
- (c) Pendente em produção: abrir WhatsApp › Enviar mensagem no celular, filtrar por etapa,
  "Selecionar todos", conferir contador e envio individual.

## Próximo passo
Revisar o PR e validar (c) após o deploy. Paridade: Grupo Santa Fé já implementado na branch gêmea.
