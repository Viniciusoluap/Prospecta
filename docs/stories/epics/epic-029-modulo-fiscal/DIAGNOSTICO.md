# EPIC-029 — Diagnóstico (Fase 0, só leitura)

Base lida: `origin/main` em `a3fc88a` (22/11/2026) + branch local `epic027-c5int2` (avisos proativos, ainda fora da `main`).
Nenhum código de produção foi alterado. Linhas citadas como `arquivo:linha` nessa base.

## 1. Stack (o que já existe)

- Front: Vite + React + wouter (`client/src/App.tsx`), telas do admin em `client/src/pages/admin/`.
- API: Express + tRPC numa função só da Vercel (`api/index.ts`, `maxDuration: 60` em `vercel.json:15-19`), Node 24
  (`package.json:5-6`). Routers montados em `server/routers.ts:191-220` (`tax: taxRouter` em :219, `integracoes` em :210).
- Banco: Drizzle + Neon. Migrações numeradas em `drizzle/NNNN_*.sql` (última na `main`: `0149_dolores_memoria_longa.sql`).
  **Números livres para este epic: 0152 e 0154 em diante** (0150 avisos e 0151 mesas estão na branch `epic027-c5int2`; 0153
  é a "tarefa demorada" da Dolores, commit `895ab08`).
- Bibliotecas úteis já instaladas (`package.json`): `jspdf` 3 (:82, usado no servidor em `server/caixa/medicao-pdf.ts:8`),
  `@xmldom/xmldom` 0.9 (:65), `pkijs` 3.4 (:113), `@libpdf/core` 0.5.3 (:112). **Não há** `xml-crypto`, `xpath` nem `node-forge`.
- Crons (`vercel.json:20-31`): `/api/cron/dolores` e `/dolores/08…14` (11–17 UTC). A branch dos avisos acrescenta
  `/api/cron/dolores-avisos/15…19` (18–22 UTC = 15h–19h de Brasília); a **18** roda às 21:00 UTC = 18h de Brasília.

## 2. Cadastros (clientes, leads, cards, fornecedores, empreiteiros)

| Peça | Onde está | O que falta para a nota |
|------|-----------|-------------------------|
| Cliente/lead do CRM (o "card") | `leads` — `drizzle/schema.ts:887-939`: `name`, `phone`, `email`, `city`, `state`, `cpf varchar(14)` (:908), `address text` (:909), `neighborhood` (:910). Serviços do card em `lead_services` (:945-973). | **Não tem CNPJ, CEP, número, complemento nem código IBGE.** Tomador pessoa jurídica não cabe hoje. |
| Cliente BPO (inclui fornecedor/terceiro "cadastro livre") | `bpo_clients` — `schema.ts:1233-1252`: `razao_social`, `cnpj varchar(20)` (:1236), `cpf`, `lead_id` (:1248). | Sem endereço estruturado. É o lugar natural do tomador PJ e do fornecedor. |
| Usuários (empreiteiro é papel) | `users` — `schema.ts:301-331`: `cpf`, `address`, `city`, `state`, `zipCode` (:314). Papel `empreiteiro` em `userRoleEnum` (:22-28). Obra → empreiteiro por `construction_projects.contractor_user_id` (:550). | Sem CNPJ do empreiteiro (a nota recebida traz o CNPJ do emitente: o vínculo precisa dele). |
| Engenheiro | `engineer_profiles` — `schema.ts:2313-2331`: único cadastro com endereço estruturado (`cep` :2318, `street`, `number`, `district`, `city`, `state`). | Modelo a seguir no front para CEP. |
| Obra | `construction_projects` — `schema.ts:486-559`: `address`, `city` (:499), `state` (:500), `lead_id`, `imovel_id` (:554). | **Sem código IBGE do município e sem CNO.** O ISS de obra é do município da obra: precisa do IBGE. |
| Perfil tributário (empresa) | `tax_profiles` — `schema.ts:1396-1410`: `company_name`, `cnpj`, `regime`, `estimated_rate`. `tax_obligations` (:1414), `ret_projects` (:1434). Tela: `client/src/pages/admin/TaxAccountingPanel.tsx`, aba "Contabilidade" do BPO (`AdminBpo.tsx:38`, :648). Router: `server/tax-router.ts` (`adminProcedure`, :107-305). | **Já existe** um cadastro de empresa com CNPJ e regime: `fiscal_emissores` deve apontar para ele (`tax_profile_id`), não repetir. |
| Sede | `shared/empresa.ts` (`SEDE`, Imperatriz-MA, CEP 65900-545). | — |

**Consulta CNPJ/CEP:** não existe em nenhum lugar (busca por `viacep|brasilapi|receitaws` em `client/src`, `server`, `shared`:
zero). O engenheiro digita o CEP à mão.

**Validação de CNPJ:** quatro cópias, todas só numéricas: `shared/dolores/notas.ts:130`, `shared/dolores/sanitizar.ts:57`,
`shared/contratos/modelos.ts:93`, `shared/pci-gerador.ts:1333`. Nenhuma aceita o CNPJ alfanumérico (ver `PESQUISA.md` §5).

## 3. Eventos financeiros (o que existe de fato)

| Evento do pedido | Onde existe | Gravado por | Elegível para rascunho? |
|------------------|-------------|-------------|-------------------------|
| **Honorários** (BPO) | `bpo_lancamentos` (`schema.ts:1255-1298`), `tipo` ∈ `honorario`/`despesa`/`reembolso`/`receita` (`bpoLancamentoTipoEnum`, :260-266), `pago`, `pago_em`, `valor_recebido`, `cliente_id` → `bpo_clients`, `categoria_operacional` + `vinculo_operacional_id` (:1277-1279). Histórico: `bpo_lancamento_historico` (:1323). | Baixa manual `server/db.ts:1566`; extrato bancário `server/bpo-extrato.ts:77`; Asaas `server/bpo-asaas.ts:103`; Conta Azul `server/bpo-conta-azul.ts`. | Sim: `tipo IN ('honorario','receita')`, `pago = true`, `a_classificar = false`, `combinada_em_id IS NULL`, `exclusao_lote_backup_id IS NULL`. `reembolso` nasce com sugestão "reembolso". |
| **Parcela liberada pela Caixa** (recebimento da obra) | `obra_movimentos` (`schema.ts:2223-2242`), `natureza` ∈ `entrada`/`recebimento_cef`/`pagamento`, `bpo_lancamento_id` (:2235), `status confirmado/cancelado`. Histórico: `obra_movimentos_historico` (:2244). | `server/obra-financeiro-router.ts:331` (`adicionarMovimento`), editar :367, cancelar :394. | Sim: `natureza IN ('recebimento_cef','entrada')`, `status = 'confirmado'`. Município = o da obra. |
| Medição (aprovação) | `obra_measurements` (`schema.ts:822-833`, `status`, `approved_at`). Fluxo Caixa: `server/medicao-solicitacao.ts`, `server/caixa/`. | — | **Não** é receita: é o pedido de liberação. A receita é o `recebimento_cef` acima. |
| Tabela `obra_medicoes` | Só em SQL cru em `server/routers.ts:1925-2035` (`status = 'cef_paid'` em :2028); **nenhuma migração cria essa tabela** e a leitura cai num `catch` que devolve `[]`. | — | **Não usar** como gatilho (legado; existência em produção [NÃO CONFIRMADO]). |
| **Avaliação** | `avaliacoes` (`schema.ts:1843-1880+`): `status` (`entregue` em `avaliacaoStatusEnum`, :1834-1841), `valor_servico` (:1875), `cliente_cpf`, `lead_id`, `cidade`/`estado`. | `server/db.ts:1397` (`update(avaliacoes)`). | Sim, quando `status = 'entregue'` e `valor_servico > 0` — **ou** quando o recebimento vier pelo BPO (aí a origem é o lançamento; ver §3.1). |
| **Despachante / regularização** | `regularizacao_itens_financeiros` (`schema.ts:2272-2282`, `chave_padrao` — lista em `shared/financeiro/regularizacao.ts:124-142`: despachante, ART, alvará, ITBI, registro em cartório, taxas da Caixa…), `regularizacao_recebimentos` (:2284-2299, `bpo_lancamento_id`). Histórico: `regularizacao_recebimentos_historico` (:2301). | `server/regularizacao-router.ts:383`. | Sim, todo recebimento confirmado. Itens de **repasse** (`itbi`, `registro_cartorio`, `cert_inteiro_teor`, `vistoria_cef`, `tx_ass_cef`, `seguro_cef`, `alvara`, `habite_se`, `averbacao`, `cnd_cno`) nascem com **motivo sugerido** ("ITBI repassado", "taxa da Caixa repassada", "reembolso de custas/cartório") — sugestão, nunca decisão. |
| **Comissão de correspondente** | `operational_commissions` (`schema.ts:1662-1687`): `beneficiary` ∈ `corretor`/`empresa` (`shared/operacional.ts:131`), `status`, `paid_at`, `construction_project_id`. | `server/operacional-router.ts`. | Sim, quando `beneficiary = 'empresa'` e pago (é receita da empresa). Comissão a corretor é **despesa**: não gera nota emitida. Tomador (banco/Caixa?) é decisão do contador. |
| Lançamentos gerais | `financial_transactions` (`schema.ts:1108-1127`) | Módulo antigo de financeiro (`/admin/financeiro`). | Não nesta fase (receita duplicada do BPO; confirmar com o dono se ainda é usado). |
| Taxas de obra | `obra_fees` (`schema.ts:804-817`): "legado, substituído pela tabela financeira". | — | Não. |
| `broker_commissions` | `schema.ts:838`; router responde `[]` e recusa escrita (`server/routers.ts:1906-1921`). | — | Não (legado). |

### 3.1 Regra contra nota em dobro

`obra_movimentos.bpo_lancamento_id` e `regularizacao_recebimentos.bpo_lancamento_id` ligam o recebimento do módulo ao
lançamento do BPO. Quando a ligação existe, **a origem da nota é o registro do módulo** (traz obra, município e item) e o
lançamento do BPO fica marcado como "coberto" (não gera rascunho próprio). Chave única no banco: `(origem_tipo, origem_id)`.

### 3.2 Onde ligar o gatilho — opções

| Opção | Como | Prós | Contras |
|-------|------|------|---------|
| A. Chamar o gerador em cada ponto de gravação | `db.ts:1566`, `bpo-extrato.ts:77`, `bpo-asaas.ts:103`, Conta Azul, `obra-financeiro-router.ts:331`, `regularizacao-router.ts:383`, `db.ts:1397`, operacional | Rascunho na hora | 8+ pontos; qualquer caminho novo esquece o gancho; transações diferentes |
| B. Gatilho do Postgres (`AFTER INSERT/UPDATE` inserindo em `fiscal_notas`) | SQL | Pega todo caminho | Regra de negócio em PL/pgSQL; difícil testar no PGlite; preencher tomador exige junções pesadas no gatilho |
| **C. Varredura idempotente (recomendada)** | `server/fiscal/gerador.ts` lê as origens elegíveis desde a última passada e faz `INSERT … ON CONFLICT (origem_tipo, origem_id) DO NOTHING` | Um só lugar, idempotente, testável, pega todo caminho (inclusive importações), sem cron novo (roda nos crons da Dolores/avisos e no botão "Atualizar" da aba) | Atraso de até ~1 h; precisa de "marca d'água" de data por origem |

Recomendação: **C**, com chamada imediata e opcional (fire-and-forget, fora da transação) nos dois caminhos manuais mais
usados (baixa do BPO e recebimento de regularização) para o dono ver o rascunho na hora. Corte de data inicial configurável
(`fiscal_config.inicio_em`) para não criar rascunho de todo o histórico.

## 4. Integrações (como as chaves são guardadas)

- Cofre: `server/_core/secret-vault.ts:9-48` — AES-256-GCM, IV de 12 bytes, chave = SHA-256 do `JWT_SECRET`
  (`ENV.cookieSecret`); formato `iv.tag.dados` em base64url; aceita `plain:` (gravado direto no banco) e recifra no uso.
- Padrão de gravação: `server/integracoes-router.ts:230-247` (`salvarAsaas`: `apiKeyEncrypted: deps.encrypt(...)`), :326-331
  (Pluggy), :335-342 (Evolution); chave da Anthropic em `server/_core/anthropic-painel.ts`, vigiada por
  `server/integracoes-anthropic.test.ts` (só dois pontos leem a chave).
- Tela: `client/src/pages/admin/AdminIntegracoes.tsx:204-209` (cards `WhatsappEmpresaCard`, `YcloudCard`, `GoogleDriveCard`,
  `MapboxCard`, `AnthropicCard`). **Card novo: `CertificadoFiscalCard`** (um por emissor).
- mTLS: `server/_core/inter.ts:60-78` (`criarFetchMtls`: `https.request` com `cert`/`key` em PEM, tempo-limite 30 s). A
  credencial do Inter é guardada cifrada por conta (`server/bancos-router.ts:132-140`, lida em `server/bancos.ts:160`).
- Certificado A1 que já existe: **Jurídico**, `client/src/lib/certificados-digitais.ts:20-40` — abre `.pfx` com
  `P12Signer` (`@libpdf/core`) + `pkijs`, guarda **no navegador** (IndexedDB, AES-GCM/PBKDF2), assina PDF no navegador. O
  HANDOFF-21-11-JURIDICO-CERTIFICADOS registra teste com PFX legado RC2/3DES. Serve de referência para abrir/validar o arquivo;
  **não serve** para a emissão (o mTLS sai do servidor).

### 4.1 Guardar o A1 — alternativa de cofre (trade-off)

| Opção | Segurança | Custo/complexidade | Recomendação |
|-------|-----------|--------------------|--------------|
| A. `encryptSecret` atual (chave do `JWT_SECRET`) | Banco vazado sem o `JWT_SECRET` não abre. Mesma chave das outras credenciais. | Zero | **Padrão (decisão b).** |
| B. Envelope com chave própria `FISCAL_CERT_KEY` na Vercel | Separa o raio de dano; trocar `JWT_SECRET` não perde o certificado | O dono precisa criar uma variável (passo a passo com links) | Opcional, se o QA de segurança pedir. |
| C. Cofre externo (KMS) | Melhor | Serviço pago/novo | Fora (custo zero). |

Em qualquer opção: `.pfx` e senha cifrados **separados** (dois campos), leitura só em um ponto (`server/fiscal/certificado.ts`),
sem retorno ao cliente, teste-vigia igual ao da Anthropic, e a tela mostra só titular, CNPJ, emissor, validade e impressão digital.

## 5. Geração de PDF

- Servidor: `jspdf` (`server/caixa/medicao-pdf.ts:8`, `shared/contratos/pdf.ts:1` → `gerarPdfModelo`, gravado por
  `server/juridico-pdf.ts`). Marca d'água: texto rotacionado com opacidade (`GState`) em cada página — cabe no jspdf 3.
- Cliente: `client/src/lib/relatorio-obra-pdf.ts`, `client/src/components/incorporacao/estudo/compat/pdf-loteamento.ts`.
- **Prévia da nota:** gerar no servidor (`server/fiscal/previa-pdf.ts`) para a tela e para a Dolores mandarem o mesmo arquivo.
- DANFSe oficial (etapa 4/5): baixar do ADN (`GET …/danfse/{chave}`) e guardar; gerador local só de reserva.

## 6. Auditoria e histórico

- Padrão do sistema: tabela `*_historico` só inserção com `antes`/`depois` jsonb e `usuario_id`
  (`bpo_lancamento_historico` :1323, `obra_movimentos_historico` :2244, `regularizacao_recebimentos_historico` :2301),
  protegida por gatilho em migração (ex.: guarda de `obra_notas` em `drizzle/0128_dolores_notas.sql:72-153`, que proíbe
  DELETE/TRUNCATE e troca de vínculos).
- Dolores: `dolores_acoes` (`drizzle/schema-dolores.ts:6`), gravada por `registrarAcao` (`server/dolores/auditoria.ts:59`),
  com `sanearArgumentos` (:30).
- **Fiscal:** `fiscal_notas_historico` no mesmo padrão; a ação vinda da Dolores grava nos dois (como as outras ações dela).

## 7. Menus do admin

- Hub: `client/src/pages/Admin.tsx:64-83` (cards por módulo; "BPO Financeiro" em :78). Módulos e permissões:
  `shared/admin-permissions.ts:6-41` (`contabilidade` e `relatorios` já pertencem ao módulo `bpo`, :40-41).
- BPO: `client/src/pages/admin/AdminBpo.tsx` — tipo `Aba` (:67-75: clientes, cobranças, despesas, a classificar, DRE,
  bancos, contabilidade, relatórios), botões das abas (:614-660). Rota `/admin/bpo` em `client/src/App.tsx:324`.
- **Encaixe (decisão do dono k):** **dentro da aba "Contabilidade"** do BPO — sem aba nova, sem menu novo. As ações de decisão
  e emissão ficam só com **admin por papel** (como `adminPorPapel` em `integracoes-router.ts:79`), não só por módulo:
  colaborador com o módulo BPO vê, não decide.

### 7.1 A aba "Contabilidade" e o que o BPO já tem (base para não digitar nada de novo)

**Onde está:** `client/src/pages/admin/AdminBpo.tsx:74` (valor `"contabilidade"` do tipo `Aba`), :121 (aceita `?aba=contabilidade`
na URL), botão :648-649, conteúdo :968 (`{aba === "contabilidade" && <TaxAccountingPanel />}`). Tela:
`client/src/pages/admin/TaxAccountingPanel.tsx` (606 linhas); servidor: `server/tax-router.ts` (`tax.overview` :108,
`tax.profiles` :195, `tax.obligations` :234, `tax.ret` :275), montado em `server/routers.ts:219`.

**O que a aba já mostra/cadastra hoje**

| Seção (TaxAccountingPanel.tsx) | Dados | Tabela |
|--------------------------------|-------|--------|
| Cartões do topo (~:127-170): Regime vigente, Receita realizada, Tributos estimados, Obrigações vencidas | Regime do perfil ativo; receita = `financial_transactions` pagas (income/commission) + `bpo_lancamentos` pagos não-despesa (`receitaRealizada`, `tax-router.ts:95-105`); tributo = receita × alíquota estimada | `tax_profiles`, `financial_transactions`, `bpo_lancamentos` |
| Perfil tributário (diálogo :190-252) | **Empresa, CNPJ, Regime** (simples_nacional, lucro_presumido, lucro_real, ret, outro — :35-41), alíquota estimada, vigência, premissas | `tax_profiles` (`schema.ts:1396-1410`) |
| Obrigações (diálogo :303-348; "Calendário de obrigações" :565) | Tributo, competência, vencimento, valor estimado, pago | `tax_obligations` (:1414) |
| RET (diálogo :400-473; "RET por empreendimento" :538) | Empreendimento, CNPJ/SPE, inscrição, status, alíquota RET, vigência | `ret_projects` (:1434) |
| "Adequações sugeridas" (:514) | Texto de orientação | — |

**O que o resto do BPO já tem e o fiscal reaproveita**

| Dado necessário na nota | Já cadastrado em | Como a nota usa |
|-------------------------|------------------|-----------------|
| Emissor: razão social, CNPJ, regime | `tax_profiles.company_name`, `.cnpj`, `.regime` (perfil vigente daquele CNPJ) | **Lido**, nunca copiado. `fiscal_emissores` aponta por `tax_profile_cnpj` e guarda só numeração/ambiente/município/inscrição/certificado. |
| Obra em RET (SPE) | `ret_projects` (CNPJ/SPE, status, alíquota) | Se a obra estiver em RET ativo com CNPJ próprio, sugere esse emissor (não decide). |
| Tomador PJ/PF | `bpo_clients` (razão social, CNPJ/CPF, e-mail, telefone, `lead_id`) — `schema.ts:1233-1252`; card do CRM `leads` (nome, CPF, endereço) | O rascunho guarda **só a referência** (`bpo_client_id`/`lead_id`) e, no momento da emissão (S-4), uma **cópia congelada** do que foi enviado (exigência fiscal: a nota não pode mudar se o cadastro mudar depois). Antes da emissão não há cópia: editar o tomador = editar o cadastro (com `CampoCnpj` da S-1). |
| Valor, competência, data | `bpo_lancamentos.valor`/`valor_recebido`, `.competencia`, `.pago_em`; ou o registro de origem (obra, regularização, avaliação, comissão) | Lido da origem; o rascunho guarda um **ajuste** só se o dono editar o valor (campo `valor_ajustado_centavos`, nulo = usa o da origem). |
| Descrição | `bpo_lancamentos.descricao`; `regularizacao_itens_financeiros.nome`; `avaliacoes.tipo/finalidade` | Sugestão = descrição padrão do tipo de serviço + descrição da origem; só grava se editada. |
| Centro de custo / categoria | `bpo_lancamentos.centro_custos`, `.categoria`, `.categoria_operacional`, `bpo_centros_custo` (`schema.ts:1315`) | Filtro e agrupamento do relatório; mapa categoria → tipo de serviço. |
| Vínculo com obra/serviço | `bpo_lancamentos.vinculo_operacional_id`/`_rotulo`, `obra_movimentos.project_id`, `regularizacao_recebimentos.regularizacao_id` | Município de incidência = o da obra (coluna `municipio_ibge` da S-1). |
| Recebido/conciliado | `bpo_lancamentos.pago`, `bank_transaction_id`, `asaas_payment_id` | Elegibilidade (só recebido). |
| Relatório do contador | Cartão "Receita realizada" (`tax-router.ts:150`) | O relatório "notas × receita" usa a **mesma** conta de receita realizada: com nota + sem nota + a decidir = receita realizada do período (mesma fonte, sem número divergente). |

**Surpresas desta aba:** (1) `ensureTaxSchema()` (`tax-router.ts:72-80`) cria as tabelas `tax_*` **em tempo de execução**
(`CREATE TABLE IF NOT EXISTS`, :19 e :36) — as colunas novas do fiscal devem ir por migração numerada, não por esse caminho;
(2) `overview` usa **um só** perfil ativo (o mais recente, :131-136) — com dois CNPJs (Prospecta e Efficaz) os cartões precisam de
filtro por empresa; (3) `tax_profiles` não tem CNPJ único (é versionado por vigência), por isso o emissor é chaveado por CNPJ e
lê o perfil vigente.

## 8. Dolores

| Peça | Onde | Uso no fiscal |
|------|------|---------------|
| Porta do dono (conversa direta) | `server/dolores/whatsapp.ts:425-513`: encaminhada bloqueada, decisões por código (`lerDecisaoDoDono`, `lerDecisaoDeGrupo`), confirmação natural (`lerConfirmacao`, :488-497), "relatório" (:500). | **Nada de comando novo aqui** (decisão e). O fiscal entra como funções do modelo. |
| Confirmação natural | `shared/dolores/confirmacao.ts:44-53` (`lerConfirmacao`: lista fechada "pode", "sim", "isso", "manda ver", "não"…), `nivelDoItem` :70-91 (registro × sério, por código; função desconhecida → sério). Pendência: `server/dolores/pendencia.ts` (validade 15 min registro, 10 min sério; sério exige "confirmo", :275). | `decidir_nota_fiscal` e `editar_rascunho_nota` → **registro**; `emitir_nota_fiscal` → **sério**. |
| Leituras do modelo | `server/dolores/funcoes.ts:84` (`FUNCOES`), leituras em `server/dolores/leitura/*.ts` (ex.: `notas.ts`, `financeiro.ts`). "Só do dono": `LEITURAS_DO_DONO` (branch REURB, `permissoes.ts`). | `listar_notas_fiscais` e `ver_nota_fiscal` como leituras **só do dono** (valores em dinheiro: nunca em grupo nem a cliente). |
| Ações | `server/dolores/acoes/*.ts` (`preparar*` / `executar*Aprovado`, `ContextoAcao`, `Preparo` em `acoes/comum.ts:14-71`); conciliação `server/dolores/conciliacao.ts:29`. | `server/dolores/acoes/fiscal.ts`. |
| Envio ao dono | `enviarAvisoAoDono` (`whatsapp.ts:275`); Evolution só envia texto, imagem e áudio (`server/_core/evolution.ts:103-133`). | **Falta envio de documento (PDF)**: função nova `enviarDocumentoEvolution` (`/message/sendMedia` com `mediatype: "document"`) [formato do campo a confirmar na Evolution]. |
| Avisos proativos (branch `epic027-c5int2`) | `server/dolores/avisos.ts` (`REGRAS` por tipo, `executarAvisos`), `shared/dolores/avisos.ts:14` (`TIPOS_AVISO`), migração `0150_dolores_avisos.sql` (CHECK do `tipo` em `dolores_avisos_tipos`; máx. 6 por dia, 07h–20h, segunda a sábado, agrupado). | Tipo novo **`nota_fiscal`** (rascunho a decidir) + resumo das 18h. Exige alargar o CHECK da 0150 (novo valor). |
| Notas de obra | `drizzle/schema-dolores-notas.ts:11-57` (`obra_notas`), migração `0128` (CHECKs :30-53, guarda :72-153); leitura `server/dolores/leitura/notas.ts` (`notasDoBanco` :85, `apontarNotas` :75, `pagamentosSemNotaDaObra` :160); conciliação `server/dolores/conciliacao.ts`; aviso `nota_obra` em `avisos.ts`. | Origem nova `adn` (S-5). Surpresas: `grupo_id`/`mensagem_id` NOT NULL (:26-27), `chave_acesso` só 44 dígitos (:43), `emitente_documento` só numérico (:37). |
| Filtros de saída | `shared/dolores/sanitizar.ts` (CPF/CNPJ, chaves de NF-e 44 dígitos modelo 55/65 em :92) | Testar que a chave de 50 dígitos da NFS-e não é cortada/confundida e que o CNPJ alfanumérico é tratado. |

## 9. Encaixe de cada peça — arquivos a criar e alterar

### Etapa 1 (S-1) — Brasil API
- **Criar:** `server/_core/brasilapi.ts` (fetch com tempo-limite, Brasil API → ViaCEP), `server/fiscal/consulta-cadastro.ts`
  (cache), `server/fiscal/router.ts` (`fiscal.consultarCnpj`, `fiscal.consultarCep`), `shared/fiscal/documento.ts` (CNPJ
  numérico e alfanumérico, CPF), `shared/fiscal/situacao-cnpj.ts`, `client/src/components/fiscal/CampoCnpj.tsx`,
  `client/src/components/fiscal/CampoCep.tsx`, `drizzle/schema-fiscal.ts`, `drizzle/0152_fiscal_consulta_cadastro.sql`.
- **Alterar:** `server/routers.ts` (montar `fiscal`), formulário de cliente BPO em `AdminBpo.tsx`, formulário do lead
  (`AdminCRM.tsx`/`AdminLeadDetail.tsx`), perfil do engenheiro (`PerfilEngenheiroPanel.tsx`), obra (`AdminEditarObra.tsx`).
- **Tabelas/colunas:** `fiscal_consultas_cache` (nova); colunas aditivas `leads.cep`, `leads.numero`,
  `leads.complemento`, `leads.municipio_ibge`; `bpo_clients.cep/logradouro/numero/complemento/bairro/cidade/uf/municipio_ibge`;
  `construction_projects.municipio_ibge`, `construction_projects.cno`; `users.cnpj` (empreiteiro). Sem `leads.cnpj`: PJ é `bpo_clients` (decisão k, sem campo redundante).

### Etapa 2 (S-2) — Rascunhos
- **Criar:** `drizzle/0154_fiscal_notas.sql`, `server/fiscal/gerador.ts`, `server/fiscal/notas.ts` (máquina de estados),
  `server/fiscal/previa-pdf.ts`, `server/fiscal/relatorio-mensal.ts`, `shared/fiscal/status.ts`, `shared/fiscal/motivos.ts`,
  `shared/fiscal/origens.ts`, `client/src/components/fiscal/NotasADecidir.tsx`, `…/EditarRascunho.tsx`,
  `…/NotasReceitaMes.tsx`, `…/TiposServico.tsx`, `…/DadosFiscaisDoPerfil.tsx` (seções da aba Contabilidade).
- **Alterar:** `client/src/pages/admin/TaxAccountingPanel.tsx` (seções novas + filtro por empresa), `server/tax-router.ts`
  (`overview` por CNPJ), `server/fiscal/router.ts`, crons em `api/index.ts` (chamar `gerarRascunhos` dentro do cron diário
  existente). `AdminBpo.tsx` **não** ganha aba.
- **Tabelas:** `fiscal_emissores` (só o complemento do `tax_profiles`), `fiscal_tipos_servico`, `fiscal_notas`,
  `fiscal_notas_historico`, `fiscal_config`.

### Etapa 3 (S-3) — Dolores
- **Criar:** `server/dolores/leitura/fiscal.ts`, `server/dolores/acoes/fiscal.ts`, `drizzle/0155_dolores_aviso_fiscal.sql`.
- **Alterar:** `server/dolores/funcoes.ts`, `server/dolores/permissoes.ts`, `shared/dolores/confirmacao.ts` (`nivelDoItem`),
  `server/dolores/avisos.ts` + `shared/dolores/avisos.ts` (tipo `nota_fiscal`, resumo das 18h), `server/_core/evolution.ts`
  (`enviarDocumentoEvolution`), `server/dolores/prompt.ts` (descrição curta), testes de segurança da Dolores.

### Etapa 4 (S-4) — Homologação
- **Criar:** `server/fiscal/certificado.ts`, `server/fiscal/dps.ts` (montagem), `server/fiscal/assinatura.ts` (XML-DSig),
  `server/fiscal/sefin.ts` (cliente mTLS), `server/fiscal/eventos.ts` (cancelamento), `server/fiscal/danfse.ts`,
  `shared/fiscal/dps-campos.ts`, `server/fiscal/icp-brasil/*.pem` (raízes públicas), `client/src/components/admin/CertificadoFiscalCard.tsx`,
  `drizzle/0156_fiscal_emissao.sql`.
- **Dependências novas:** `xml-crypto` (MIT) + `xpath` (MIT); `node-forge` (BSD/GPL-2, escolher BSD) **só se** pkijs não
  abrir o PFX legado.
- **Alterar:** `server/integracoes-router.ts` (salvar/remover/testar certificado), `AdminIntegracoes.tsx`.

### Etapa 5 (S-5) — Produção e recebidas
- **Criar:** `server/fiscal/distribuicao.ts` (ADN por NSU), `drizzle/0157_obra_notas_origem_adn.sql`.
- **Alterar:** `drizzle/schema-dolores-notas.ts` (colunas `origem`, `nsu`, `xml`), `server/dolores/leitura/notas.ts` (ler a
  origem nova), `server/dolores/avisos.ts` (aviso `nota_obra` passa a incluir as do ADN), card do cliente
  (`AdminLeadDetail.tsx`: XML/PDF da nota), `server/fiscal/router.ts` (emitir).

## 10. Surpresas encontradas

1. Já existe um **perfil tributário** (`tax_profiles`, `tax_obligations`, `ret_projects`) e uma aba "Contabilidade" no BPO —
   o emissor deve reaproveitar, não criar outro cadastro de empresa.
2. `leads` (o card do cliente) não tem CNPJ nem CEP; só `bpo_clients` tem CNPJ. Tomador PJ hoje não cabe no CRM.
3. `obra_notas` foi desenhada só para nota de grupo (grupo e mensagem obrigatórios) e para chave de 44 dígitos (NF-e); a
   NFS-e nacional tem 50.
4. Nenhum validador aceita o CNPJ alfanumérico, em vigor desde julho/2026.
5. `obra_medicoes` (com "cef_paid") é SQL cru sem migração — não confiar como gatilho.
6. A Evolution do projeto não envia documento (só texto, imagem e áudio).
7. O certificado A1 do Jurídico vive no navegador; o da nota precisa viver no servidor — duas guardas diferentes para o mesmo
   tipo de arquivo. Explicar ao dono na tela que são cadastros distintos.
8. Os avisos proativos (base do resumo das 18h) ainda não estão na `main`.
9. A Calculadora da Receita é Java 25/Spring Boot com SQLite: não roda na função Node.
10. "não" sozinho já é palavra de confirmação da Dolores — por isso os comandos fixos do pedido original colidiriam.
11. A aba Contabilidade cria as tabelas `tax_*` em tempo de execução (`ensureTaxSchema`) e só enxerga um perfil ativo — o
    fiscal multi-CNPJ precisa de filtro por empresa nos cartões e de migração numerada para o que acrescentar.
12. A "Receita realizada" da Contabilidade soma também `reembolso` do BPO (`tax-router.ts:103`: tudo que não é despesa) — o
    relatório notas × receita deixa isso visível (reembolso tende a "sem nota").
