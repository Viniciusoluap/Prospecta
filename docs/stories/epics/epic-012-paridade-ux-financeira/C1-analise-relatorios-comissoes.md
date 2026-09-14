# C1 — Relatórios de comissões: análise

**Status:** Implementado — ver `S-11-relatorios-comissoes-unificados.md` e
`CHECKPOINT-C1-COMISSOES.md` para a entrega final. Este documento registra a análise e o
mapeamento originais, que orientaram a implementação.

## Problema confirmado

`server/relatorios-router.ts` (`overview.corretorRanking` e `exportComissoesCsv`) só lê
`broker_commissions` (tabela legada, pré-Etapa 4). O CRUD atual de comissões
(`server/operacional-router.ts`, `comissoesRouter.create/update`) grava em
`operational_commissions` (tabela nova, introduzida na Etapa 4/PR #45). Confirmado também no
próprio checkpoint do Codex (`CHECKPOINT-ETAPA-4.md`): "vinculação direta de comissão a
contrato e consolidação financeira do legado ficam explicitamente para acabamento da
Etapa 5" — esta é exatamente essa pendência.

## Mapeamento de campos

| | `broker_commissions` (legado) | `operational_commissions` (novo) |
|---|---|---|
| Granularidade | 1 registro por venda, com até 4 parcelas (`installment1..4Value/Paid`) | 1 registro por lançamento de comissão |
| Beneficiário | `brokerName` (texto livre, não FK) | `beneficiary` (`corretor`\|`empresa`) + `brokerId` (FK `users`) |
| Status | Não tem campo `status` — "pago" é inferido pela soma das parcelas pagas | `status` explícito (`pendente`\|`aprovada`\|`paga`\|`cancelada`) |
| Datas | `createdAt`/`updatedAt` apenas | `dueDate` (vencimento) + `paidAt` (pagamento) |
| Valor | `totalCommission` + 4 pares valor/pago | `amount` único + `percent` |
| Mutabilidade | Somente leitura (Codex: "comissões legadas preservadas somente leitura... endpoints legados rejeitam gravações") | CRUD completo via `comissoesRouter` |

## Regra de inclusão do histórico (proposta, não implementada)

1. **Não migrar dados** entre as tabelas — ambas continuam existindo, cada uma com seu
   próprio ciclo de vida (legado congelado, novo em uso).
2. Relatórios e CSV devem **unificar as duas fontes com um campo de origem** (`legado` |
   `operacional`), nunca somando as duas sem diferenciar — evita dupla contagem por
   construção, já que não há sobreposição de dados entre as tabelas (registros distintos, sem
   chave em comum), mas a soma unificada tem que ser auditável por origem.
3. **"Pago"**: legado = soma de `installment1..4Paid` (não há campo de status); novo = quando
   `status = "paga"`.
4. **"Pendente"**: legado = soma paga < `totalCommission`; novo = `status` em
   `pendente`/`aprovada`.
5. **"Cancelado"**: só existe no novo modelo (`status = "cancelada"`); o legado não tem esse
   conceito — registros legados nunca deveriam ser tratados como cancelados.
6. Data de referência para filtros de período: legado usa `createdAt`; novo deveria usar
   `dueDate` (vencimento) ou `paidAt` (quando pago) — a decisão exata de qual data usar como
   "data do relatório" fica para a implementação, documentando a escolha.

## Implementação (concluída)

Toda esta proposta foi implementada como descrita, sem alterações à regra. Ver
`S-11-relatorios-comissoes-unificados.md` para o detalhamento final e
`server/relatorios-comissoes.test.ts` para os 14 testes que cobrem exatamente os cenários
listados abaixo (originalmente planejados para a rodada seguinte, já entregues):

- `server/relatorios-router.ts`: `overview.corretorRanking` e `exportComissoesCsv` passaram a
  consultar as duas tabelas, unificando por corretor com o campo de origem.
- Testes cobrindo: registro novo pago, novo pendente, novo cancelado (excluído do total
  "pago" mas visível na exportação com todos os status), legado pago, legado parcialmente
  pago.

## Por que C1 não foi implementado na primeira rodada (contexto histórico)

O pedido original instruiu executar primeiro "a frente de menor complexidade do plano".
C1 exige reconciliar dois modelos de dados com formatos e regras de status diferentes, com
risco real de dupla contagem ou omissão se malfeito — mais complexo que C2 (navegação, que é
essencialmente correção de rotas/links já mapeados). Esta análise fica pronta para a próxima
rodada, sem inventar a implementação às pressas.
