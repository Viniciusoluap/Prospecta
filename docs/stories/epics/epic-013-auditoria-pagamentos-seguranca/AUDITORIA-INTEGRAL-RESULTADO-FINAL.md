# Auditoria Integral Prospecta ↔ Grupo Santa Fé — Resultado Final

**Branch de trabalho (ambos os repositórios):** `codex/auditoria-correcao-20260914`
**Documento completo (tabela final detalhada):**
`Grupo-Santa-Fe/web/docs/stories/epics/epic-006-auditoria-rbac-seguranca/AUDITORIA-INTEGRAL-RESULTADO-FINAL.md`

Este documento é a referência cruzada, no lado Prospecta, do resultado final da auditoria
integral executada em ambos os repositórios (Etapas 0 a 5), conforme a seção
"11. RESULTADO FINAL OBRIGATÓRIO" do mandato original. A tabela completa (ambos os sistemas)
vive no documento do Grupo Santa Fé linkado acima; aqui está o recorte específico do Prospecta.

## PRs do Prospecta nesta auditoria (branch `codex/auditoria-correcao-20260914`)

| Etapa | PR(s) | Commit de merge | Migração | Testes | Deployment | Status | Pendências |
|---|---|---|---|---|---|---|---|
| 1 — Pagamentos/sorteios | [#53](https://github.com/Viniciusoluap/Prospecta/pull/53) + [#54](https://github.com/Viniciusoluap/Prospecta/pull/54) | `036f118e05c1ae069b4ff316f44328509255f827` | `0016_etapa1_payment_integrity.sql` | 373/373 (52 arquivos) | `dpl_7GErMUmvZ1zuD2SzWghtgSqCAWtY` READY | Concluído | Refund/chargeback pós-liquidação vai para `review_required` — aguarda regra do dono do produto |
| 2 — Revogação de sessão (paridade com Santa Fé S-03) | [#55](https://github.com/Viniciusoluap/Prospecta/pull/55) + [#56](https://github.com/Viniciusoluap/Prospecta/pull/56) | `94ead0fbf4a5c130a1e4a1f0e155c50b26fdd912` | `users.sessionVersion integer default(0)` | 380/380 (53 arquivos) | `dpl_6ZgVGJnmFwRGpNYvcVqvvJiiVuxM` READY | Concluído | Nenhuma |
| 3 — `/api/upload-photo` sem autenticação | [#57](https://github.com/Viniciusoluap/Prospecta/pull/57) + [#58](https://github.com/Viniciusoluap/Prospecta/pull/58) | `2a303a0f05207fe0966d85bdc38977dea56edee5` | Nenhuma | 380/380 | `dpl_62EVWDHvvKvHjXP6kfdkSyYDK5ti` READY | Concluído | Achado mais severo de toda a auditoria — rota Express fora do tRPC, zero autenticação (nem client-side) |
| 4-5 (C1) — Unificação de comissões (relatórios) | [#51](https://github.com/Viniciusoluap/Prospecta/pull/51) + [#52](https://github.com/Viniciusoluap/Prospecta/pull/52) | `cb907ba` | Nenhuma | Verde no momento do merge | Confirmado READY no momento do merge | Concluído | Nenhuma |
| 4-5 (C2) — Navegação administrativa | [#49](https://github.com/Viniciusoluap/Prospecta/pull/49) | `4da1f60` | Nenhuma | Verde no momento do merge | Confirmado READY no momento do merge | Concluído | Nenhuma |
| 4-5 — Regressão completa final | — | HEAD atual da branch | — | `npm run check` (tsc) limpo + `npm run test` 380/380 (53 arquivos) | — | Concluído | Nenhuma regressão introduzida |

## Achados do lado Santa Fé com paridade verificada no Prospecta (sem ação necessária aqui)

Durante esta auditoria, cada achado de RBAC/segurança encontrado no Grupo Santa Fé teve seu
equivalente auditado no Prospecta, conforme a regra absoluta de paridade. Nos seguintes casos,
o Prospecta já estava correto e nenhuma ação foi necessária:

- **Agregador/Obras/Projetos/Regularização sem guarda real** (Santa Fé S-07): verificado
  `server/routers.ts` — `construction` usa checagem de posse-ou-admin em todo procedure (correto
  para o modelo de negócio, já que `construction` no Prospecta é a obra do próprio cliente, não
  um módulo interno de staff como `Obras` no Santa Fé); `budgetRequests` já usa
  `requireRole(ctx, ["admin"])` explicitamente.
- **Sub-rotas BPO sem guarda** (Santa Fé S-08): verificado `server/routers.ts` — todo procedure
  do bloco `bpo` é `adminProcedure` ou `protectedProcedure` + `requireRole(ctx, ["admin"])`
  explícito. O modelo tRPC do Prospecta não tem equivalente ao padrão "página sem guard" do
  Next.js — o próprio roteamento nega a chamada antes de qualquer lógica.
- **WhatsApp confiava em dados do cliente** (Santa Fé Etapa 2, 4/N): verificado
  `server/whatsapp-router.ts` — `salvarConexao` já deriva `userId` de `ctx.user.id`; `enviar` já
  é `adminProcedure` (só admin envia WhatsApp no Prospecta).
- **Sub-rotas de Avaliações sem guarda** (Santa Fé Etapa 2, 5/N): verificado
  `server/routers.ts` — `avaliacoes: router` já usa `adminProcedure` em todos os procedures;
  essa classe de bug estruturalmente não existe no modelo SPA+tRPC de gate único.

## Pendências abertas do lado Santa Fé (sem equivalente/ação no Prospecta)

As três pendências de infraestrutura registradas no documento final do Santa Fé (Blob público
de avaliações; Vercel Preview Deployments compartilhando banco de produção; corretores sem
`usuarioId` retroativo) são específicas da stack/dados do Santa Fé e não têm equivalente direto
no Prospecta — não geram pendência de paridade aqui.

## Encerramento

Com este documento, a Etapa 4-5 (reconciliação C1/C2 + regressão completa + tabela final) da
auditoria integral Prospecta ↔ Grupo Santa Fé está concluída também do lado Prospecta.
