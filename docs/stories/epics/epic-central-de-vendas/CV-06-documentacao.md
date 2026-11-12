# CV-06 — Documentação e encaminhamento para análise

Status: InReview

## Critérios de aceite
- [x] Checklist por produto/modalidade editável em tela (nenhum documento fixo no código).
- [x] Lista de pendentes enviada automaticamente após a qualificação.
- [x] Mídia recebida classificada (tipo de documento) e vinculada a `lead_documents`; baixa confiança → 'a conferir' sem parar o fluxo.
- [x] Lembretes D+1/D+3/D+7 pelo cron diário existente.
- [x] Checklist completo → status documental completo, análise 'em análise', tarefa para o analista e mensagem ao cliente, exatamente uma vez.

## File List
- `server/central-vendas/documentos.ts`
- `shared/central-vendas/regras.ts (classificarPorNome`
- ` pendentesDoChecklist)`
- `server/central-vendas-documentos.test.ts`

## Change Log
- 12/11/2026 — story criada (Draft) a partir da seção 7 do prompt.
- 12/11/2026 — implementada (InReview). [AUTO-DECISION] Classificação só por metadados (nome do arquivo, tipo, legenda) — primeiro por regra, depois pela IA — porque a seção 5 do prompt proíbe enviar documentos para fora do sistema. Documento 'a conferir' conta para o checklist (o fluxo não para) e o operador é avisado. Tela de checklists na etapa 9.
