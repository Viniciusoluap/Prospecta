# S-2 — Rascunhos de nota dentro da aba "Contabilidade" (sem emitir nada)

**Status:** InReview (ramo `epic029-s2`, criado de `epic029-s1` + `epic029-fiscal-plano`; implementada, aguarda o portão de QA) · **Epic:** EPIC-029 · **Etapa:** 2 · **Tamanho:** L · **Migração:** `0154_fiscal_notas.sql` · **Depende de:** S-1

## Por quê
Cada recebimento de serviço precisa de uma decisão do dono: emitir nota, não emitir (com motivo) ou decidir depois. Nada
sai do sistema nesta etapa.

## Regra de desenho (decisão do dono k, 22/11/2026)
O fiscal fica **dentro da aba "Contabilidade" do BPO Financeiro** (`AdminBpo.tsx:968` → `TaxAccountingPanel.tsx`), "para não
termos campos redundantes". **Nenhuma informação já cadastrada é digitada de novo.** Mapa completo em `DIAGNOSTICO.md` §7.1:
- **Emissor** = perfil tributário que a aba já cadastra (`tax_profiles`: empresa, CNPJ, regime). O complemento fiscal só traz o
  que o perfil não tem.
- **Tomador** = cliente do BPO (`bpo_clients`) ou card do CRM (`leads`), por referência. Faltou CNPJ/endereço → corrige-se **no
  cadastro** (com `CampoCnpj`/`CampoCep` da S-1), não na nota.
- **Valor, competência, descrição, centro de custo, obra** = do lançamento do BPO ou do registro de origem. A nota só guarda um
  ajuste quando o dono edita.
- Cópia congelada do emissor/tomador **só no ato da emissão** (S-4), porque a nota emitida não pode mudar se o cadastro mudar.

## Escopo
**Tabelas novas (`drizzle/schema-fiscal.ts`)**
1. `fiscal_emissores` — chave `cnpj` (único; liga ao `tax_profiles` vigente desse CNPJ; **sem** razão social nem regime, que
   são lidos do perfil); `municipio_ibge`, `inscricao_municipal` (nulo), `serie_dps`, `proximo_numero_dps` (bigint),
   `ambiente` (`desligado`|`producao_restrita`|`producao`, padrão **desligado**), `ativo`. Multi-CNPJ desde o início (decisão i).
   Criado na tela a partir de um perfil tributário existente ("Dados fiscais deste perfil"), nunca com CNPJ digitado de novo.
2. `fiscal_tipos_servico` — `nome`, `emissor_id`, `codigo_tributacao_nacional`, `codigo_nbs`, `item_lc116`, `descricao_padrao`,
   `aliquota_iss`, `retencoes` jsonb, `regra` com CHECK **só** `('sempre_perguntar','nunca_gerar')` (decisão h), padrão
   `sempre_perguntar`; mapa de origens (categoria do BPO, `chave_padrao` da regularização, tipo de avaliação, tipo de comissão).
   Códigos e alíquotas nascem **nulos** ("a preencher pelo contador") — a S-4 recusa emitir com campo nulo.
3. `fiscal_notas` — `emissor_id`, `tipo_servico_id`, `origem_tipo` (`bpo_lancamento`|`obra_movimento`|
   `regularizacao_recebimento`|`avaliacao`|`comissao_empresa`), `origem_id`, **único `(origem_tipo, origem_id)`**;
   referências do tomador (`bpo_client_id` **ou** `lead_id`) e da obra/serviço (`obra_id`, `lead_service_id`);
   `valor_ajustado_centavos` (nulo = valor da origem), `descricao_ajustada` (nula = sugerida), `municipio_incidencia_ibge`
   (nulo = calculado: obra → município da obra; senão o do tomador/emissor); `status` CHECK `A_DECIDIR|ADIADA|SEM_NOTA|EMITINDO|
   EMITIDA|CANCELADA|ERRO` (as quatro últimas só a partir da S-4); `motivo_sem_nota` CHECK da lista + `motivo_texto`
   (obrigatório em `outro`); `motivo_sugerido`; `adiada_ate`; `versao`; `decidida_por`, `decidida_em`. Reservados e nulos até a
   S-4: `dps_id`, `numero_dps`, `chave_acesso varchar(50)`, `xml_dps`, `xml_nfse`, `protocolo`, `ibscbs` jsonb, `congelado`
   jsonb (emissor + tomador + valores enviados), `emitida_em`, `emitida_por`, `cancelada_em`, `cancelada_por`.
4. `fiscal_notas_historico` — só inserção (`antes`, `depois`, `usuario_id`, `via` tela|whatsapp|sistema); gatilho sem
   UPDATE/DELETE/TRUNCATE (padrão de `bpo_lancamento_historico`).
5. `fiscal_config` (linha única): `ligado` (padrão false), `inicio_em` (corte da varredura), `ultima_varredura_em`.
- Gatilho em `fiscal_notas`: sem DELETE; `EMITIDA`/`CANCELADA` bloqueados até a S-4; depois de `EMITIDA` nada do que foi
  enviado muda.

**Motivos de "sem nota"** (`shared/fiscal/motivos.ts`): reembolso de custas/cartório, ITBI repassado, taxa da Caixa repassada,
serviço não faturável, emitida fora do sistema, outro (texto livre obrigatório).

**Gerador (`server/fiscal/gerador.ts`)** — varredura idempotente (DIAGNOSTICO §3.2, opção C), desde `inicio_em`:
`bpo_lancamentos` (`honorario`/`receita` pagos, válidos, **não cobertos** por registro de módulo; `reembolso` nasce com motivo
sugerido), `obra_movimentos` (`recebimento_cef`/`entrada` confirmados), `regularizacao_recebimentos` confirmados (motivo sugerido
nos itens de repasse), `avaliacoes` entregues com `valor_servico`, `operational_commissions` `beneficiary='empresa'` pagas. Tipo
`nunca_gerar` não cria. Origem cancelada depois → rascunho volta a `A_DECIDIR` com alerta (nunca apaga). Roda no cron diário
existente e nos crons da Dolores, no botão "Atualizar" e logo após a baixa manual do BPO e o recebimento de regularização
(fora da transação; falha não derruba a baixa).

**Tela — seções novas na aba Contabilidade (`TaxAccountingPanel.tsx`)**
- **Filtro "Empresa"** no topo da aba (um por perfil tributário/emissor): os cartões existentes passam a respeitá-lo
  (`tax.overview` por CNPJ) e ganham o cartão "Notas a decidir".
- **Dados fiscais do perfil** (dentro do perfil tributário que já existe): município, inscrição municipal, série, ambiente.
- **Notas a decidir**: lista com filtros (empresa, cliente, obra, município, período, status); colunas vêm da origem e do
  cadastro (nada digitado). Botões: **Prévia** (PDF com marca d'água diagonal "RASCUNHO — SEM VALOR FISCAL" em todas as
  páginas, `server/fiscal/previa-pdf.ts`, jspdf); **Emitir** desabilitado ("disponível após homologação"); **Editar** (valor,
  descrição, município — e "abrir cadastro do tomador" para CNPJ/endereço); **Não emitir** (motivo obrigatório; sugerido vem
  pré-selecionado mas só grava com o clique); **Depois** (data opcional).
- **Tipos de serviço**: tabela editável pelo admin; campos do contador marcados "a preencher".
- **Notas × receita do mês** (relatório do contador, `server/fiscal/relatorio-mensal.ts`): por competência e empresa — com
  nota, sem nota (por motivo) e a decidir, somando exatamente a "Receita realizada" do cartão da aba (mesma conta,
  `receitaRealizada`, `tax-router.ts:95`); diferença, se houver, listada linha a linha (ex.: receita de `financial_transactions`
  sem origem fiscal). CSV.
- Decidir/editar: **admin por papel**; colaborador com módulo BPO só vê.

**Fora:** emissão, XML, certificado (S-4); Dolores (S-3); regra `automatico`; aba ou menu novo.

## Critérios de aceite
- [x] 1. Um lançamento de honorário pago vira **um** rascunho `A_DECIDIR`; rodar o gerador 3× não cria outro (teste PGlite).
- [x] 2. Recebimento de regularização ligado a lançamento do BPO gera **uma** nota (origem = regularização) — teste R8.
- [x] 3. Recebimento da Caixa de uma obra em Parauapebas → município de incidência = Parauapebas, não Imperatriz.
- [x] 4. Item ITBI nasce com motivo sugerido "ITBI repassado" e status `A_DECIDIR` (não decidido).
- [x] 5. **Sem redundância:** nenhum formulário do fiscal pede razão social, CNPJ, regime, nome/CPF/CNPJ do tomador, competência ou
   centro de custo (teste de componente lista os campos); trocar o CNPJ do cliente no BPO aparece no rascunho sem editar a nota.
- [x] 6. "Não emitir" sem motivo é recusado no servidor; com `outro` exige texto.
- [x] 7. Toda mudança grava histórico; `UPDATE`/`DELETE` no histórico ou `DELETE` em `fiscal_notas` falha no banco.
- [x] 8. Edição concorrente com `versao` antiga é recusada.
- [x] 9. PDF com a marca d'água em todas as páginas (teste lendo o PDF com `unpdf`).
- [x] 10. Relatório: com nota + sem nota + a decidir + diferença listada = "Receita realizada" do mesmo período e empresa.
- [x] 11. Com dois perfis (Prospecta e outro CNPJ), o filtro "Empresa" separa cartões, notas e relatório.
- [x] 12. Colaborador não decide (403); "Emitir" não tem rota ativa; nenhuma chamada de rede (teste vigia de `fetch`).

## Dependências do dono
Nenhuma para construir. Ligar o gerador e escolher a data de corte: na aba, pelo dono.

## Riscos
Classificação de receita (R9); volume inicial (data de corte); `ensureTaxSchema` cria `tax_*` em tempo de execução — colunas
novas só por migração numerada, e o teste de migração confere que as duas coexistem.

---

## Implementação (dev — 22/11/2026)

### Decisões tomadas sem perguntar (registradas)
- [AUTO-DECISION] Botão "Atualizar" com o gerador desligado → roda mesmo assim (é pedido explícito do admin); o cron só roda
  com o gerador **ligado** na aba (padrão desligado). Motivo: o dono liga o automático quando quiser, mas pode conferir antes.
- [AUTO-DECISION] Onde roda a varredura → dentro de `/api/cron/lead-card-due` (diário) e dos `/api/cron/dolores/08…14`
  (de hora em hora, só com o segredo do cron), sem cron novo, idempotente, nunca lança. Motivo: `vercel.json` no limite.
- [AUTO-DECISION] Chamada imediata após a baixa manual do BPO e o recebimento de regularização → **não feita nesta etapa**
  (fica como pendência). Motivo: não mexer nas transações de baixa; o botão "Atualizar" e o cron de hora em hora cobrem.
- [AUTO-DECISION] Sem chave estrangeira para tabelas existentes (`users`, `bpo_clients`, `leads`, obra…) → as referências
  são conferidas pelo servidor. Motivo: migração 100% aditiva, sem travar tabela de produção e sem `ON DELETE SET NULL`
  esbarrar no histórico imutável.
- [AUTO-DECISION] Município de incidência → nome + UF (a obra ainda não tem código IBGE; S-1 não criou as colunas). Ordem:
  ajuste do dono → cidade da obra → cidade do tomador → município do emissor. Código IBGE fica nulo até haver a coluna.
- [AUTO-DECISION] Empresa (emissor) do rascunho → a do tipo de serviço; se não houver e existir **um só** emissor, ele; com dois
  ou mais, fica "a escolher" (o dono escolhe em Editar). Motivo: o lançamento do BPO não indica a empresa.
- [AUTO-DECISION] "Reabrir" (SEM_NOTA/ADIADA → A_DECIDIR) existe para corrigir uma decisão; fica no histórico.
- [AUTO-DECISION] Multi-CNPJ (ajustado após o QA, M4): `tax.profiles.create` desativa os perfis do **mesmo CNPJ** e, quando o novo tem CNPJ, também os vigentes sem CNPJ (antes desativava todos,
  o que impedia dois CNPJs vigentes). `tax.overview` ganhou `cnpj` opcional (filtro "Empresa"); sem filtro, igual a antes.
- [AUTO-DECISION] "Receita realizada" com filtro de empresa → continua de todas as empresas (o lançamento não indica a empresa) e
  a tela diz isso; no relatório, o que é de outra empresa aparece separado ("outra empresa"), e a soma continua fechando.
- [AUTO-DECISION] Origem cancelada depois → volta a A_DECIDIR com alerta **uma vez** (o alerta fica; o dono decide de novo sem
  o sistema desfazer a decisão dele na passada seguinte).
- [AUTO-DECISION] Ambiente do emissor → só "desligado" nesta etapa (o servidor não aceita outro valor).
- [AUTO-DECISION] Tipos de serviço iniciais (6, todos "sempre perguntar", códigos nulos) semeados pela própria 0154 na tabela nova.

### IDS (reaproveitar antes de criar)
| Peça | Decisão | Base |
|---|---|---|
| Histórico imutável | ADAPT | gatilho de `obra_movimentos_historico` (0035) e guarda de `obra_notas` (0128) |
| Receita realizada | REUSE | `receitaRealizada` + consulta extraída para `linhasDaReceitaRealizada` (`server/tax-router.ts`) |
| PDF | REUSE | `jspdf` no servidor (padrão de `server/caixa/medicao-pdf.ts`) |
| Permissão | REUSE | `adminProcedure` + mapa de módulos (`fiscal: "bpo"`) + "admin por papel" (padrão de `integracoes-router.ts`) |
| Teste com banco | REUSE | PGlite + DDL gerado do schema Drizzle (padrão de `server/dolores/testes-banco.ts`) |
| Telas | CREATE | 4 seções novas em `client/src/components/fiscal/`, dentro da aba (sem aba nem menu novo) |

### Arquivos
- Criados: `drizzle/0154_fiscal_notas.sql`, `drizzle/schema-fiscal.ts`, `shared/fiscal/status.ts`, `shared/fiscal/motivos.ts`,
  `shared/fiscal/origens.ts`, `server/fiscal/gerador.ts`, `server/fiscal/notas.ts`, `server/fiscal/previa-pdf.ts`,
  `server/fiscal/relatorio-mensal.ts`, `server/fiscal/router.ts`, `server/fiscal/rascunhos.test.ts`,
  `client/src/components/fiscal/NotasADecidir.tsx`, `…/DadosFiscaisDoPerfil.tsx`, `…/TiposServico.tsx`, `…/NotasReceitaMes.tsx`.
- Alterados: `client/src/pages/admin/TaxAccountingPanel.tsx` (filtro Empresa, cartão "Notas a decidir", seções novas),
  `server/tax-router.ts` (`linhasDaReceitaRealizada`, `overview` por CNPJ, perfil vigente por CNPJ), `server/routers.ts`
  (`fiscal`), `server/_core/trpc.ts` (`fiscal: "bpo"`), `api/index.ts` (varredura nos crons existentes), `drizzle.config.ts`.
- `EditarRascunho.tsx` do diagnóstico ficou dentro de `NotasADecidir.tsx` (diálogos da própria lista).

### Testes
- (a) Automáticos: `server/fiscal/rascunhos.test.ts` — 24 testes (gerador idempotente 3×, data de corte e padrão, cron
  desligado/ligado, R8 nos dois sentidos, ITBI sugerido, Parauapebas, avaliação/comissão, `nunca_gerar`, origem cancelada,
  transições, motivo obrigatório e "outro" com texto (servidor e CHECK), versão antiga, histórico e gatilhos de imutabilidade,
  Emitir recusado (rota e banco), CNPJ do cliente lido ao vivo, formulários sem campos redundantes, permissões, PDF com marca em
  todas as páginas via `unpdf`, relatório = `tax.overview.revenue`, CSV sem CPF/CNPJ, multi-CNPJ). Vigia de `fetch` em todos.
  Vizinhos: `consulta-cadastral`, `imports-esm`, `auth-session`, `lote-18-10`, `operacional`, `operational-consolidation`,
  `dolores/c4-horario-relatorio`, `ycloud/ycloud-c72` — 176 testes, todos passando. `npx tsc --noEmit` e `npx vite build` ok.
- (b) Manuais: não feitos nesta sessão (sem banco real).
- (c) Pendentes em produção: aplicar a 0154 no Neon; abrir a aba e conferir.

### Como testar (3–5 passos)
1. Aplicar `drizzle/0154_fiscal_notas.sql` (aditiva; pode rodar duas vezes).
2. BPO › Contabilidade: "Configurar tributação" com o CNPJ da empresa; em "Dados fiscais do perfil", "Preencher dados fiscais".
3. Em "Notas a decidir", clicar **Atualizar**: cada honorário/receita recebido desde o 1º dia do mês vira um rascunho
   "A decidir" (clicar de novo não duplica). **Prévia** baixa o PDF com "RASCUNHO — SEM VALOR FISCAL".
4. Num rascunho: **Não emitir** (sem motivo o botão não libera; "Outro" pede texto), **Depois**, **Editar**; abrir **Histórico**.
   **Emitir** aparece desabilitado.
5. Em "Notas × receita do mês", conferir que "Receita realizada do mês" = com nota + sem nota + a decidir + diferença; baixar o CSV.

### Pendências
- Chamada imediata do gerador logo após a baixa manual do BPO e o recebimento de regularização (hoje: botão + cron de hora em hora).
- Avaliação recebida pelo BPO sem ligação com a avaliação pode gerar dois rascunhos (não há coluna de ligação); o dono marca um
  como "sem nota — emitida fora"/"outro". Resolver com a ligação na S-3/S-4 se aparecer.
- Código IBGE do município de incidência (depende de coluna na obra/tomador).
- Paridade Santa Fé: já registrada no ROADMAP (porte adiado pelo dono).

## QA Results

**Portão @qa (Quinn), 22/11/2026, commit `a6434e4` (`server/fiscal/rascunhos-qa.test.ts`): CONCERNS → corrigido pelo @dev.**
Os 5 `it.fails` viraram `it` e passam. As correções têm testes próprios no bloco "correções do portão de QA" de `server/fiscal/rascunhos.test.ts`.

| # | Achado | Correção |
|---|---|---|
| M1 | `LIMIT 500` aplicado antes de descartar "nunca gerar": a fila travava | `filtroNuncaGerar` exclui "nunca gerar" DENTRO da consulta (mesma precedência: subtipo vence "origem:*"; subtipo como parâmetro) e cada origem pagina por `id > último visto` (`gerador.ts`) |
| M2 | Injeção de fórmula no CSV | célula que começa com `= + - @`, tab ou CR ganha `'` na frente (número negativo continua número) (`relatorio-mensal.ts`) |
| M3 | Com filtro "Empresa", "Tributos estimados" usava a receita de todas; "Obrigações vencidas" sem filtro | com filtro: `estimatedTax = null` e a tela mostra "Estimativa indisponível por empresa (a receita do BPO não indica a empresa)"; obrigações e vencidas filtradas pelos `profile_id` daquele CNPJ (`tax-router.ts`, `TaxAccountingPanel.tsx`) |
| M4 | Perfil sem CNPJ continuava vigente junto do novo; sem como desativar | criar com CNPJ desativa também os ativos sem CNPJ; rota `tax.profiles.desativar` (só admin por papel; não apaga nada) e `tax.profiles.historico`; tabela nova `tax_profiles_historico` na 0154, imutável pelo mesmo gatilho; botão "Desativar perfil" na aba |
| M5 | Varredura no cron sem prazo | `gerarRascunhosNoCron(getDb, limiteMs)`: com < 5 s, pula; senão para no prazo entre consultas (`parcial: true`; a próxima passada continua). Nos crons: `min(15 s, 45 s − decorrido)`, deixando ~10 s para o modelo padrão |
| B6 | UF e data só com regex; erro do banco chegava com o SQL | UF da lista das 27 e data que existe no calendário (zod → BAD_REQUEST); erro inesperado vira "Não foi possível concluir agora…" sem SQL (log só com o tipo do erro) |
| B7 | (baixo) endereçado à S-4 | **Registrado para a S-4**, sem mudança nesta etapa |
| B8 | CPF do tomador inteiro para o colaborador | CPF mascarado (`***.456.789-**`) para quem não é admin, na lista, no detalhe e na prévia em PDF; CNPJ (empresa) inteiro |

Testes depois da correção:
- `npx vitest run server/fiscal`: 43 de 43 (31 do dev + 12 do QA).
- Vizinhos `bpo-extrato`, `consulta-cadastral`, `imports-esm`, `auth-session`: 59 de 59.
- `npx tsc --noEmit` e `npx vite build`: ok.

**Atenção na publicação:** `tax.profiles.create`, `desativar` e `historico` agora usam `tax_profiles_historico`, que vem da 0154. Aplicar a migração ANTES de publicar o código.

## Change Log
- 22/11/2026 — @dev (Dex): Draft → InProgress → InReview. Implementação completa da S-2 no ramo `epic029-s2`; migração 0154 NÃO aplicada.
- 22/11/2026 — @qa (Quinn): portão CONCERNS (M1–M5, B6–B8), commit `a6434e4`.
- 22/11/2026 — @dev (Dex): correções M1–M5, B6 e B8; B7 registrado para a S-4. Continua InReview, aguardando a reconferência do @qa.
