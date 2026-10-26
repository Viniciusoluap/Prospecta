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
