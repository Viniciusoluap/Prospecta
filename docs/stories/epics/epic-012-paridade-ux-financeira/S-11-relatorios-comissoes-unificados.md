# S-11 — C1: Relatórios de comissões unificados (legado + operacional)

**Status:** Done
**Contexto:** frente C1 do plano de correção Prospecta ↔ Grupo Santa Fé (coordenado com
GPT-6 Astra). Executada após C2 (navegação), conforme priorização por complexidade
combinada com o usuário — análise e mapeamento já haviam sido feitos em
`C1-analise-relatorios-comissoes.md`.

## Problema

`server/relatorios-router.ts` (`overview.corretorRanking` e `exportComissoesCsv`) só lia
`broker_commissions` (tabela legada, congelada desde a Etapa 4). O CRUD ativo de comissões
(`server/operacional-router.ts`, `comissoesRouter`) grava em `operational_commissions`
(tabela nova). Resultado: comissões cadastradas a partir da Etapa 4 não apareciam nem no
ranking de corretores nem na exportação CSV dos relatórios.

## Fontes e unidades

| | `broker_commissions` (legado) | `operational_commissions` (novo) |
|---|---|---|
| Granularidade | 1 registro por venda, 4 parcelas (`installment1..4Value/Paid`) | 1 registro por lançamento |
| Beneficiário | `brokerName` (texto livre) | `beneficiary` (`corretor`\|`empresa`) + `brokerId` (FK `users`) |
| Status | Não tem — inferido pela soma das parcelas pagas | Explícito (`pendente`\|`aprovada`\|`paga`\|`cancelada`) |
| Unidade monetária | `decimal(15,2)` em reais, igual ao novo | `decimal(15,2)` em reais |
| Data de referência usada | `createdAt` | `paidAt` quando existe, senão `dueDate` |

As duas tabelas são **disjuntas** (nenhum registro migra de uma para a outra), então somar as
duas nunca duplica um negócio.

## Regra de inclusão do histórico (implementada)

1. **Sem migração de dados** — as duas tabelas continuam existindo e sendo lidas em paralelo.
2. **Ranking de corretores** (`buildCorretorRanking`, `server/relatorios-router.ts`):
   - Legado: soma real das parcelas pagas (`installment1..4Paid`) — pode ser um pagamento
     parcial, já que o legado não tem conceito de "cancelado".
   - Novo: soma o `amount` **somente quando `status === "paga"`** — `pendente`, `aprovada` e
     `cancelada` nunca entram no total pago.
   - As duas somas por corretor (por nome) são combinadas no mesmo `Map`, sem sobreposição
     possível entre fontes.
3. **Exportação CSV** (`buildComissoesExportLegado` + `buildComissoesExportNovas`): cada linha
   ganha um campo `origem` (`legado` | `operacional`) e `referencia` (nome do cliente no
   legado; nome/descrição do imóvel/negócio no novo — os dois modelos não têm um campo
   equivalente de "cliente", então não foi inventada uma correspondência artificial). O
   `status` do legado é **inferido e rotulado como tal** (`pago` / `pago parcial` / `pendente`,
   comparando soma paga com o total); o do novo é o `status` real do banco, sem nenhuma
   inferência.
4. **Beneficiário "empresa"** (sem corretor associado) e **corretor sem cadastro/removido**
   (`brokerId` nulo) recebem rótulos genéricos (`"Empresa"` / `"Corretor sem cadastro"`) em vez
   de serem descartados — nenhum registro desaparece do relatório.

## Decisões de implementação (não invenção)

- A lógica de agregação foi extraída para funções puras exportadas
  (`buildCorretorRanking`, `buildComissoesExportLegado`, `buildComissoesExportNovas`) para
  poder ser testada com dados sintéticos, sem precisar de um banco real — mesmo padrão já
  usado no projeto (`shared/operacional.ts`).
- Não foi inventado um "status" para o legado além do que os próprios valores permitem
  inferir (comparação numérica entre pago e total) — documentado explicitamente como um rótulo
  derivado, não um campo real do banco.
- `client/src/pages/admin/AdminRelatorios.tsx`: exportação CSV atualizada para incluir as
  novas colunas (`Origem`, `Referência`, `Status`), substituindo a coluna antiga `Cliente`
  (que só existia no modelo legado).

## Gates

- TypeScript aprovado (`npx tsc --noEmit`, zero erros);
- Vitest: 50 arquivos, **344 testes** aprovados (14 novos em `relatorios-comissoes.test.ts`,
  cobrindo legado pago, legado parcial, novo pago, novo pendente, novo cancelado, soma sem
  duplicação entre fontes, beneficiário empresa, corretor sem cadastro, limite/ordenação do
  ranking, e os três status de exportação);
- build Vite e bundle do servidor (`esbuild`) aprovados;
- `git diff --check` aprovado;
- sem migration — nenhuma tabela nova, alterada ou migrada.

**Não testado nesta sessão:** navegação em navegador real (sandbox sem acesso à internet
externa) — validação dos números exibidos na tela `/admin/relatorios` com dados reais fica
para quando houver acesso a produção/QA.

## Grupo Santa Fé

Não se aplica — confirmado que o Grupo Santa Fé usa uma única tabela `Comissao`
(`prisma/schema.prisma:152-171`), sem fonte legada paralela (ver
`Grupo-Santa-Fe/web/docs/stories/epics/epic-005-paridade-navegacao-comissoes/EPIC.md`).
