# S-2 — Rascunhos de nota dentro da aba "Contabilidade" (sem emitir nada)

**Status:** Draft · **Epic:** EPIC-029 · **Etapa:** 2 · **Tamanho:** L · **Migração:** `0154_fiscal_notas.sql` · **Depende de:** S-1

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
1. Um lançamento de honorário pago vira **um** rascunho `A_DECIDIR`; rodar o gerador 3× não cria outro (teste PGlite).
2. Recebimento de regularização ligado a lançamento do BPO gera **uma** nota (origem = regularização) — teste R8.
3. Recebimento da Caixa de uma obra em Parauapebas → município de incidência = Parauapebas, não Imperatriz.
4. Item ITBI nasce com motivo sugerido "ITBI repassado" e status `A_DECIDIR` (não decidido).
5. **Sem redundância:** nenhum formulário do fiscal pede razão social, CNPJ, regime, nome/CPF/CNPJ do tomador, competência ou
   centro de custo (teste de componente lista os campos); trocar o CNPJ do cliente no BPO aparece no rascunho sem editar a nota.
6. "Não emitir" sem motivo é recusado no servidor; com `outro` exige texto.
7. Toda mudança grava histórico; `UPDATE`/`DELETE` no histórico ou `DELETE` em `fiscal_notas` falha no banco.
8. Edição concorrente com `versao` antiga é recusada.
9. PDF com a marca d'água em todas as páginas (teste lendo o PDF com `unpdf`).
10. Relatório: com nota + sem nota + a decidir + diferença listada = "Receita realizada" do mesmo período e empresa.
11. Com dois perfis (Prospecta e outro CNPJ), o filtro "Empresa" separa cartões, notas e relatório.
12. Colaborador não decide (403); "Emitir" não tem rota ativa; nenhuma chamada de rede (teste vigia de `fetch`).

## Dependências do dono
Nenhuma para construir. Ligar o gerador e escolher a data de corte: na aba, pelo dono.

## Riscos
Classificação de receita (R9); volume inicial (data de corte); `ensureTaxSchema` cria `tax_*` em tempo de execução — colunas
novas só por migração numerada, e o teste de migração confere que as duas coexistem.
