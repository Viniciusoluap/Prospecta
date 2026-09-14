# Checkpoint — C1: Relatórios de comissões unificados

**Data:** 14/09/2026
**Status:** Concluída após validação local (TypeScript, testes, build)
**Escopo:** frente C1 do plano de correção Prospecta ↔ Grupo Santa Fé (coordenado com Astra)

## Entregas

| Frente | Resultado |
|---|---|
| Ranking de corretores | `relatoriosRouter.overview` agora soma `broker_commissions` (legado) e `operational_commissions` (novo), sem duplicar — cada fonte contada uma única vez, novo só conta quando `status = "paga"` |
| Exportação CSV | `exportComissoesCsv` unifica as duas fontes com campo `origem` e `referencia`; status do legado inferido e rotulado como tal, status do novo é o valor real do banco |
| Testes | Novo `relatorios-comissoes.test.ts` (14 testes): legado pago/parcial, novo pago/pendente/cancelado, soma sem duplicação, beneficiário empresa, corretor sem cadastro, limite/ordenação do ranking |
| Frontend | `AdminRelatorios.tsx` — CSV exportado com colunas atualizadas (Origem/Referência/Status) |
| Dados | Nenhuma migration — nenhuma tabela nova, alterada ou migrada; nenhum dado movido entre tabelas |

## Por que isso importa

Antes desta correção, qualquer comissão cadastrada a partir da Etapa 4 (usando o CRUD atual,
`operational_commissions`) simplesmente não aparecia nos relatórios — nem no ranking de
corretores, nem na exportação CSV, que só liam a tabela legada `broker_commissions`. Isso
significava que os números de comissão pagos exibidos em `/admin/relatorios` estavam
sistematicamente incompletos desde que o novo modelo entrou em uso.

## Situação após esta entrega

- C1 (relatórios de comissões) e C2 (navegação e acessos visuais) — as duas frentes do plano
  de correção coordenado com Astra — estão concluídas.
- P0 (Etapa 3), P1 (Etapa 4), P2 (Etapa 5) e o hardening de RBAC legado (S-09) já estavam
  concluídos.
- UAT completo por papel/dispositivo em produção (S-08) continua pendente — depende de acesso
  a navegador real.

## Evidências de encerramento

- TypeScript aprovado (`npx tsc --noEmit`, zero erros);
- Vitest: 50 arquivos e 344 testes aprovados (14 novos desta entrega);
- build Vite e bundle do servidor (`esbuild`) aprovados;
- `git diff --check` aprovado, sem erros de espaço em branco;
- sem migration a validar ou aplicar.

**Não testado nesta sessão:** validação visual dos números de `/admin/relatorios` com dados
reais em navegador (sandbox sem acesso à internet externa) — mesma limitação já documentada em
checkpoints anteriores.
