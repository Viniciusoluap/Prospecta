# CV-07 — Retorno da análise

Status: InReview

## Critérios de aceite
- [x] Decisão (pendente/aprovado/reprovado) só registrada por humano.
- [x] Pendente: mensagem com as pendências, volta a aguardando documentos e lembretes recomeçam.
- [x] Aprovado: fila de follow-up comercial, operador avisado, template sem valores não registrados.
- [x] Reprovado: mensagem neutra e transferência para humano, sem motivo.
- [x] Nenhuma automação consegue marcar aprovado.

## File List
- `server/central-vendas/analise.ts`
- `server/central-vendas-analise.test.ts`

## Change Log
- 12/11/2026 — story criada (Draft) a partir da seção 7 do prompt.
- 12/11/2026 — implementada (InReview). Decisão só por admin ou analista marcado na Central (ativo); CHECK no banco exige decisao_por. Mensagens da decisão são proativas (janela 8h–20h). Motivo da reprovação fica só em leads.rejection_reason. Tela da decisão na etapa 9.
