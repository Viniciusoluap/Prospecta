# S-06 — Proposta formal de aquisição do terreno (PDF e e-mail)

Status: Ready for Review
Epic: EPIC-024 (Fase 2) — correção 06 do dono (16/11/2026)
Paridade: Incorporação existe nos dois sistemas — pendência de porte para o Grupo Santa Fé no ROADMAP (Santa Fé em espera).
Tamanho estimado: M
Dependência: S-02 (usa o logotipo do empreendimento no cabeçalho quando existe). Migração:
`drizzle/0120_proposta_terreno_email.sql` (aditiva, idempotente; NÃO aplicada).

## Problema

A Negociação do Terreno só registra as propostas; não há como emitir a proposta formal ao proprietário nem enviá-la.

## Critérios de aceite
- [x] AC1: campo "E-mail do proprietário/terreneiro" (gravado no JSON da negociação, sem migração).
- [x] AC2: em cada proposta da Prospecta, "Baixar proposta em PDF" e "Enviar proposta por e-mail".
- [x] AC3: PDF corporativo: identidade da Prospecta, empreendimento, proprietário, terreno, modalidade, valor proposto,
      condições de pagamento, prazos e observações registrados, data de emissão, proponente e campo de aceite.
- [x] AC4: nunca inventa termos — só o que está registrado; campos vazios são omitidos, sem marcadores.
- [x] AC5: envio: escolher a proposta → prévia → confirmar destinatário → enviar o PDF correspondente → registrar data,
      destinatário e situação → tratar falha e permitir reenvio.
- [x] AC6: enviar NÃO marca a proposta como aceita (nem muda a situação).
- [x] AC7: o PDF baixado e o anexado ao e-mail são idênticos (mesmos bytes para a mesma data de emissão).
- [x] AC8: destinatário validado (zod `email`); usuário sem o módulo Incorporação recusado.
- [x] AC9: logotipo do empreendimento (S-02) no cabeçalho quando existe; a identidade da Prospecta sempre aparece.
- [x] AC10: responsivo (botões empilham no celular; prévia em quadro no tablet/computador e "Abrir em nova aba" no celular).

## Tarefas
- [x] T1: gerador único e puro `shared/incorporacao/proposta-terreno-pdf.ts` (jsPDF; data de emissão injetada; data de
      criação e identificador do PDF derivados da entrada → bytes reproduzíveis).
- [x] T2: `server/incorporacao-proposta-router.ts` (`incorporacao.propostaTerreno.pdf`, `.enviar`, `.envios`).
- [x] T3: migração 0120 (valor `proposta_terreno` no enum + tabela `incorporation_proposal_sends`) e schemas.
- [x] T4: aba — campo de e-mail, botões, diálogo de prévia/envio, histórico com reenvio.
- [x] T5: testes.

## Dev Notes
- O PDF sai sempre do servidor, do que está GRAVADO: os botões salvam a negociação antes. A prévia devolve a data de
  emissão e o envio usa a mesma → anexo = prévia = download do mesmo dia (sha256 registrado em cada envio).
- [AUTO-DECISION] Envios em tabela própria (`incorporation_proposal_sends`), não no JSON da negociação: o salvamento
  automático da aba reescreve o JSON e uma gravação concorrente poderia perder o registro. A 0120 cria a tabela junto
  do valor do enum (o valor novo não é usado na migração).
- [AUTO-DECISION] PDF formal só para propostas com autor "Prospecta"; para as registradas como do proprietário a aba
  explica o motivo (o texto do PDF é "a Prospecta apresenta…").
- [AUTO-DECISION] Valor 0 conta como não informado (a aba grava 0 quando o campo fica vazio). Permuta financeira mostra
  o percentual registrado, não o valor estimado pelo VGV (estimativa interna, não termo registrado).
- Proponente = empresa (`IDENTIDADE_EMAIL`: "Prospecta Construções - VFX Capital") + usuário que emite. Mesmo usuário
  e mesma data → mesmos bytes; outro usuário emitindo muda o nome do responsável no PDF (esperado).
- Data de emissão aceita: hoje (Brasília) ou até 2 dias antes (prévia aberta na véspera); futuro é recusado.
- Falha de envio: sem SMTP configurado → "Servidor de e-mail (SMTP) não configurado"; com SMTP → recusa registrada (o
  detalhe técnico fica em `email_logs`, tipo `proposta_terreno`).

## Testes
- Automáticos: `server/incorporacao-proposta-terreno.test.ts` (11 testes, PGlite com a 0120 aplicada duas vezes) —
  passando: cada campo registrado no PDF; campos vazios omitidos (sem "undefined", "null", "R$ 0,00"); permuta pelo
  percentual; bytes reproduzíveis; download === anexo; envio não muda a situação; envios sobrevivem ao salvamento da aba;
  falha registrada e reenvio; validações (e-mail, data, autor, proposta/estudo inexistente); permissão; logotipo do S-02.
  `server/incorporacao-negociacao.test.ts` continua passando. `npx tsc --noEmit` — sem erros.
- Manuais: PDF conferido visualmente (uma página A4 com todos os campos); conferir a aba no celular, tablet e computador.
- Pendente em produção: aplicar a 0120 no Neon; entrega real pelo SMTP (caixa de entrada, anexo, spam).

## File List
- `shared/incorporacao/proposta-terreno-pdf.ts` (novo)
- `shared/incorporacao/negociacao.ts` (`proprietarioEmail`)
- `server/incorporacao-proposta-router.ts` (novo)
- `server/routers.ts` (montagem de `incorporacao.propostaTerreno` e um import)
- `drizzle/0120_proposta_terreno_email.sql` (novo)
- `drizzle/schema-incorporacao-propostas.ts` (novo)
- `drizzle/schema.ts` (valor `proposta_terreno` no enum)
- `drizzle.config.ts`
- `client/src/components/incorporacao/estudo/compat/proposta-terreno.ts` (novo)
- `client/src/components/incorporacao/estudo/proposta-terreno-envio.tsx` (novo)
- `client/src/components/incorporacao/estudo/negociacao-terreno-tab.tsx`
- `server/incorporacao-proposta-terreno.test.ts` (novo)
- `docs/stories/epics/epic-024-correcoes-16-11/S-06-proposta-terreno.md` (esta story)

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 16/11/2026 | @dev (Dex) | Story criada e implementada (YOLO); Ready for Review |
