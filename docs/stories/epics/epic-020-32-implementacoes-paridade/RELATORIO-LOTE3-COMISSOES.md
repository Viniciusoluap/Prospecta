# EPIC-020 · Lote 3 (item 32) — Comissões automáticas e investigação do corretor Chaleilson

Data da investigação: 12/10/2026 · Fonte: banco de produção da Prospecta (Neon `plain-cake-26372935`),
consultas somente leitura. Este relatório é exclusivo da Prospecta: nenhum dado daqui foi levado ao
Grupo Santa Fé.

## 1. Causa raiz da ausência de comissões de obras

1. **Não existia sincronização**: o módulo Comissões só tinha registros cadastrados à mão
   (`operational_commissions`) — nada nascia das obras com corretor no CRM.
2. **Nenhuma obra tinha os dados da fórmula**: das 37 obras, nenhuma tinha VGV preenchido (só a
   obra 35, migrada no Lote 2, que não tem corretor) e não existia lugar para cadastrar o
   percentual de comissão (nem na obra nem no corretor).
3. O formulário manual de comissão usava como base da obra o `contract_value`, que desde o Lote 2 é
   o **Orçamento Previsto** — base errada para comissão (corrigido para VGV).

## 2. O que foi implementado (igual nos dois sistemas)

- **Comissão = VGV × Percentual / 100** (centavos, arredondamento HALF_UP). Teste G:
  230.000 × 5% = **R$ 11.500,00** ✅.
- **Regra cadastrada**: percentual da própria obra (aba Custos) ou, na falta dele, o **percentual
  padrão do corretor** (cadastro de Corretores). **Nenhum percentual é presumido**: sem regra, a
  comissão aparece como **Dados incompletos** e sem valor.
- **Comissões de obras (automáticas pelo CRM)**: seção nova no módulo Comissões listando **toda
  obra cujo lead tem corretor, inclusive as antigas**. A lista é derivada a cada leitura (obra +
  CRM + pagamentos), então novas obras aparecem sozinhas e **não há registro duplicado**.
- **Pagamentos**: lançamentos de categoria "Comissão" no financeiro da obra (manuais ou vinculados
  ao BPO) → situação Pendente / Paga parcialmente / Paga, com saldo; pagamento acima do calculado
  gera alerta.
- **Condições contratuais preservadas**: comissões manuais já cadastradas para a mesma obra não são
  alteradas; aparecem lado a lado e a divergência (outro corretor ou outro valor) é sinalizada.
- Na aba Custos, com corretor + regra + VGV, o campo Comissão passa a ser automático (somente
  leitura) e alimenta o Lucro Estimado; sem regra, o valor informado antes é preservado.

## 3. Investigação obrigatória — corretor Chaleilson

| # | Verificação | Resultado |
|---|---|---|
| 1 | Cadastro | Usuário #9 "Chaleilson Miranda Azevedo", papel corretor, ativo, criado em 11/10/2026. **CRECI "0000"** (valor provisório — inconsistente). Sem perfil em `broker_profiles` (sem observações/regra). Permissões de módulo: mapa, imóveis, corretores. Um único cadastro (sem duplicidade de usuário). |
| 2 | Leads vinculados | **10 leads** (24, 15, 42, 44, 32, 60, 59, 30, 62, 61), todos ativos. 3 em "medições" com temperatura "fechado" (24, 30, 32); 7 em "acompanhamento" (morno). |
| 3 | Obras vinculadas | **10 obras**, uma por lead: 3, 4, 5, 6, 10, 12, 17, 18, 22, 27 — todas em "planejamento". Vínculo obra↔lead↔corretor íntegro. |
| 4 | Percentuais de comissão | **Nenhum cadastrado** (não existia campo). Nenhum percentual foi inventado: as 10 obras aparecem como "Dados incompletos" até a regra ser cadastrada. |
| 5 | VGV das obras | **Nenhuma das 10 obras tem VGV.** Os leads 32 e 30 têm valor aprovado/simulado de R$ 200.000,00 e o lead 24, de R$ 180.000,00 — **não foram copiados para o VGV** (valor aprovado de financiamento não é necessariamente o VGV da obra; precisa de confirmação). |
| 6 | Comissões já existentes | **Nenhuma** (nem nas comissões atuais nem nas legadas de quatro parcelas). |
| 7 | Pagamentos anteriores | **Nenhum** pagamento de comissão encontrado no BPO, nas transações financeiras nem nos lançamentos de obra. |
| 8 | Problemas de integração | (a) ausência de sincronização obra→comissão (corrigida); (b) base de cálculo da comissão manual de obra apontava para o orçamento (corrigida); (c) não havia onde registrar o percentual (criado). |
| 9 | Duplicidades | Nenhuma para o Chaleilson. |

### Obras e dados inconsistentes encontrados (ação do proprietário)

- **Obras 3, 4, 5, 6, 10, 12, 17, 18, 22, 27 (Chaleilson)**: sem VGV e sem percentual → informar VGV
  em Valores da Operação e o percentual (padrão do corretor em Corretores, ou por obra em Custos).
  Para 17, 18 e 27 há valor aprovado no lead (200.000 / 200.000 / 180.000) que pode ser o VGV —
  **confirmar antes de usar**.
- **Obra 11 (corretor Paulo Gomes)**: mesma situação (sem VGV e sem percentual).
- **CRECI "0000"** do Chaleilson: provável valor provisório.
- **Comissão manual #1** (Paulo Gomes, "Casa lu", R$ 1.000,00, 5%, pendente): tipo "obra" mas
  **sem obra vinculada** (texto livre anterior ao vínculo obrigatório) — não há obra "Casa lu"
  cadastrada; preservada como está, revisar manualmente.
- **Possíveis obras duplicadas (sem corretor, não afetam comissões)**: leads 23 (obras 26 e 35),
  25 (obras 28 e 33) e 26 (obras 29 e 34) — as primeiras de cada par foram criadas na importação de
  08/10 e não têm serviço do CRM vinculado. Nada foi apagado; revisar e cancelar a que sobrar.

## 4. Grupo Santa Fé (mesma lógica, dados próprios)

Produção do Santa Fé em 12/10/2026: 5 obras, **nenhuma com corretor no lead**, nenhuma com VGV;
3 corretores (sem regra de comissão); 1 comissão manual (extra, já paga). Portanto nenhuma obra é
elegível hoje — a seção aparece vazia e passa a listar as obras assim que um lead de obra tiver
corretor. Nenhum dado da Prospecta foi copiado.
