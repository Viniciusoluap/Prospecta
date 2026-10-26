# HANDOFF 25/10 (noite) — 11 pedidos (ver PLANO-25-10-NOITE-11-ITENS.md)

Autorizado pelo dono ("Com aiox e com hand off"). Execução por agentes AIOX (@dev), Prospecta primeiro, depois porte Santa Fé.
Branch: `claude/sync-mirrored-repos-bsqnz3` nos 2 repos.

## Achados de produção (somente leitura)
- Sarah ex-funcionária = valor legado do enum `leads.responsible` ('sarah','vinicius','bianca'); 61 leads com 'sarah' (4 sem
  responsible_user_id → mostram "Sem usuário (antigo: Sarah)"). Usuária id 15 "Sarah" (corretor, ativa) = corretora — NÃO tocar.
- bpo_clients = 0 (cadastro falhando). bank_transactions sem titular (reimportar extrato após correção).

## Andamento
- [x] Prospecta Agente A: BPO (8, 9, 10, 11, 13, 14, OFX iPad) + Regularização (6, 7) — commit b2db0ae; resumo BPO no lead 7fde712. Suíte 1087/1087, check/build OK. Migração 0075 (titular, descricao_original, bpo_regras_titular, bpo_clients.lead_id, asaas_payment_id).
- [x] Prospecta Agente B: WhatsApp (1, 2, 4 + botão flutuante), Imóveis (3), Sarah (5), item 12 — commit f9bd460. check/build OK; suíte 1084/1087 (3 falhas em arquivos do Agente A em andamento). Migração 0076 (mídia + leads.responsible sem default/NULL). Pendente prod: aplicar 0076 ANTES do deploy; prévia+reconciliação imóveis; `UPDATE leads SET responsible=NULL WHERE responsible='sarah'` (61) após prévia.
- [ ] Itens 12 (opção B: admin conecta em Integrações; corretor no portal dele) → Agente B; 13 (Voltar → Painel) e 14 (cobranças emitidas do Asaas) → Agente A — autorizados 25/10 20:45
- [ ] Santa Fé porte — agente WhatsApp/Imóveis/Sarah/12 em andamento (migração 20261025230000_whatsapp_midia); agente BPO/Regularização também em andamento (migração 20261025220000_bpo_titular_clientes)
- [ ] Publicação (testes, migrações prod, PRs, merge, deploy) + dados (16 imóveis, Sarah)

## Próximo passo exato
Ver lista acima; cada agente reporta arquivos e testes; Claude revisa, commita, atualiza este arquivo e faz push.

## Registro
- Asaas: dono criou a conta no BPO (data inicial 01/01/2020); 566 movimentações sincronizadas (2022-06 a 2026-10), todas viraram lançamentos; saldo real 0,00.
- Pluggy: 401 "client keys are invalid" — dono recola chaves do dashboard.pluggy.ai.
- OFX cinza no iPad (accept do input) → Agente A.

## Prévias de dados (Prospecta prod, somente leitura, 26/10)
- Imóveis gerados de obra: 17 (16 com preço 0, 14 com cidade 'Não informada') → reconciliação após deploy.
- Leads com responsible='sarah': 61 (4 sem responsible_user_id) → `UPDATE leads SET responsible=NULL WHERE responsible='sarah'` após 0076.

## Ordem de publicação Prospecta
1. Aplicar 0075 e 0076 no Neon (aditivas). 2. Merge/deploy. 3. Reconciliar imóveis + limpar Sarah (com aval do dono). 4. Dono reimporta OFX da Cora.

## Checkpoint Codex — 26/10, revisão de publicação
- Implementação remota confirmada em `5a8f6b42ecd71dc1eb59965df866ee46db7b370c`; PR [#171](https://github.com/Viniciusoluap/Prospecta/pull/171) aberto e sem conflito, prévia Vercel com status de sucesso. O código não foi refeito.
- (a) Automáticos: 147 arquivos/1.087 testes, `check` e build aprovados na validação anterior. As migrações SQL `0075` (13 comandos) e `0076` (7 comandos) passaram em transações na branch Neon de prévia `preview/claude/sync-mirrored-repos-bsqnz3`; conferidos 9 campos e 2 tabelas criados.
- (b) Manual: inspeção da configuração e do esquema de produção. A branch de produção Neon ainda não recebeu `0075`/`0076`. A tentativa de criar uma branch adicional de teste encontrou o limite de branches; a branch de prévia existente foi usada.
- (c) Produção: migrações, merge/deploy e reconciliação dos 16 imóveis/61 leads continuam pendentes. A corretora Sarah (usuária 15) permanece fora da limpeza. Sem alteração de dados de produção neste checkpoint.
- Próximo passo exato: aplicar os SQLs `0075` e `0076` em produção antes do merge/deploy, verificar campos e tabelas, mesclar o PR #171 e validar o deploy. Só então obter a prévia da reconciliação dos imóveis e da limpeza dos 61 valores legados, aplicar a mudança aprovada e conferir contagens. O diário automático do Drizzle termina em `0060`; esses SQLs posteriores são geridos manualmente, não via `db:push`.

## Checkpoint final de publicação — 26/10
- `0075` e `0076` aplicadas em transações no Neon de produção antes do merge. Conferidos 9 campos novos, 2 tabelas e `leads.responsible` aceitando NULL. PR #171 mesclado em `32d00fccf9c8d1ab272599edf023531b826beefd`; Vercel produção `dpl_4VvXcosRJuhCco4SSGEC92F6dd4z` em READY, com domínio de produção associado.
- Prévia dos imóveis: 17 gerados por obra elegíveis; 16 preços zerados, 14 cidades “Não informada”. Aplicadas 17 atualizações condicionais pelo ID, slug e valor anterior: 16 preços pelo VGV, 14 cidades e 9 estados; nenhum endereço exigiu alteração. Releitura confirmou todos os campos previstos, sem divergência. Imóveis manuais não foram incluídos.
- Valor legado Sarah: 61 leads atualizados de `responsible='sarah'` para NULL (4 sem `responsible_user_id`); consulta posterior encontrou 0 legados. Usuária corretora Sarah id 15 permaneceu intacta.
- (a) Automáticos: migrações e leitura de esquema em produção; status READY do deploy; reconciliação por transação e leitura posterior; suíte/check/build documentados no checkpoint anterior. (b) Manual: inspeção de PRs, domínios e prévias de dados; sem teste interativo autenticado. (c) Pendente de validação real: QR e mídia WhatsApp, sincronização Asaas/Pluggy com credenciais válidas, reimportação OFX da Cora para preencher titulares históricos. A Pluggy havia retornado 401 por chaves inválidas.
- Próximo passo exato: validar os fluxos autenticados e integrações com as contas reais; na Cora, reimportar o extrato com a rotina nova. Para qualquer migração futura, conferir o esquema e aplicar os SQLs versionados posteriores a `0060` explicitamente, pois o diário do Drizzle não os relaciona.
