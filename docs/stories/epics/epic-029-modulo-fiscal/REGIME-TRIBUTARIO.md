# EPIC-029 — Regime tributário: qual é o atual e qual adotar em 2027

> Análise do @analyst em 22/11/2026, a pedido do dono: "o regime tributário eu vou precisar de uma orientação sua de qual
> regime nós vamos adotar e que você também verifique qual é o regime atual; encontre uma forma de confrontar isso".
> **Isto é orientação, não parecer contábil.** A decisão final, os números exatos e o prazo são com o contador.
> Nenhum código foi alterado. Nenhum dado pessoal (RG, CPF de sócio, endereço de sócio) foi copiado para este arquivo.

## Resumo em uma frase

A Prospecta **está no Simples Nacional desde a abertura (07/05/2021) e deve continuar nele em 2027**, com o IBS/CBS
"por dentro" do DAS — mas falta confirmar no extrato do Simples (PGDAS-D) se as obras estão sendo declaradas no
**Anexo IV** (o certo) e se o INSS patronal está sendo pago à parte. O cadastro do sistema ainda está vazio.

---

## (a) Regime atual — o que foi confirmado e de onde veio

| Fonte | O que diz | Situação da conferência |
|---|---|---|
| **Receita Federal** (consulta pública ao CNPJ pela Brasil API, feita pela sessão principal em 22/11/2026) | PROSPECTA CONSTRUCOES E AVALIACAO IMOBILIARIA LTDA, CNPJ 41.865.900/0001-89, Imperatriz-MA, ATIVA, porte **ME**, capital R$ 100 mil. **Optante pelo Simples Nacional desde 07/05/2021, sem data de exclusão.** Não é MEI. | **Confirmado** |
| **Documentos do Google Drive** (contrato social, DAS, extratos do PGDAS-D, DEFIS, balanços) | — | **[NÃO CONFIRMADO] — não foi possível ler.** Nesta sessão do agente as ferramentas do Google Drive não estavam disponíveis (o carregador de ferramentas não foi entregue ao agente). Ver "Como fazer a conferência do Drive" abaixo. |
| **Sistema Prospecta** (BPO › Contabilidade › Perfil tributário, tabela `tax_profiles`) | **Vazio** — nenhum perfil tributário cadastrado (informação da sessão principal). | **Confirmado: vazio** |

**Conclusão de (a):** pelo cadastro oficial da Receita, o regime atual é **Simples Nacional**. Falta a prova "de fato"
(que os impostos estão sendo pagos pelo DAS do Simples e em qual anexo), que só os documentos do Drive ou o contador dão.

### Como fazer a conferência do Drive (passo que ficou pendente)

Procurar no Drive, nesta ordem, e anotar só **nome do arquivo e data** (sem copiar dados pessoais):

1. **Extrato do PGDAS-D** dos últimos 3 meses (PDF "Extrato do Simples Nacional" ou "PGDAS-D – Declaração"). Ele mostra,
   linha por linha, **em que anexo** cada receita foi declarada (III, IV ou V), a receita dos últimos 12 meses (RBT12) e a
   alíquota efetiva do mês. É o documento mais importante.
2. **DAS pagos** (guia do Simples) — prova de que o regime é exercido de fato.
3. **DEFIS** do ano-calendário 2025 (entregue até 31/03/2026) — faturamento anual e folha.
4. **Guia do INSS (DCTFWeb / DARF previdenciário)** — se as obras estão no Anexo IV, **tem que existir** guia do INSS
   patronal (20% + RAT) fora do DAS. Se não existir, ou as obras estão no anexo errado, ou há passivo de INSS.
5. **Contrato social e alterações** — conferir se os CNAEs do contrato batem com os da Receita.
6. **Inscrição municipal / alvará de Imperatriz** — conferir se a prefeitura também registra a empresa como Simples.
7. **Efficaz** (correspondente Caixa): cartão CNPJ próprio, se houver. Termos de busca: "Efficaz", "cartão CNPJ",
   "correspondente".

Termos de busca sugeridos: `PGDAS`, `Simples Nacional`, `DAS`, `DEFIS`, `extrato`, `DCTFWeb`, `contrato social`,
`alteração contratual`, `inscrição municipal`, `alvará`, `balanço`, `DRE`, `faturamento`, `41.865.900`, `Efficaz`.

---

## (b) Divergências e pontos de atenção encontrados

| # | Divergência / risco | Por que importa | O que fazer |
|---|---|---|---|
| D1 | **Sistema vazio × Receita "Simples"** | O cartão "Regime vigente" e o "Tributos estimados" da aba Contabilidade não mostram nada; o módulo fiscal (S-4) depende do regime para montar a nota (DPS). | Cadastrar o perfil (ver seção f). |
| D2 | **O formulário do sistema já vem com "Lucro Presumido" marcado** (`TaxAccountingPanel.tsx`, valor inicial `regime: "lucro_presumido"`) | Se alguém salvar sem trocar, o sistema fica **errado** (Presumido, quando o real é Simples). | Ao cadastrar, trocar para **Simples Nacional**. Sugestão ao @dev (fora deste escopo): deixar o campo vazio e obrigatório. |
| D3 | **Porte ME × faturamento** | ME é quem fatura até R$ 360 mil por ano. Se a Prospecta faturou mais que isso em 2025, o porte deveria ser EPP (não muda o regime, mas indica cadastro desatualizado — e muda faixa do Simples). | Comparar o RBT12 do PGDAS-D com R$ 360 mil. [NÃO CONFIRMADO] |
| D4 | **Anexo das obras** (risco mais caro) | Construção de imóveis e obras de engenharia ficam no **Anexo IV**, com o INSS patronal pago **fora** do DAS. Declarar obra no Anexo III (que já inclui o INSS) é erro comum e gera dívida de INSS com multa. | Ver no extrato do PGDAS-D em que anexo as receitas de obra estão; ver se há guia de INSS patronal. [NÃO CONFIRMADO] |
| D5 | **Atividades misturadas** | A empresa tem CNAEs de 3 anexos diferentes: obras (IV), corretagem (III), gestão/administração de imóveis e serviços de engenharia/projetos e software (V, ou III se o Fator R ≥ 28%). Cada nota tem que ser declarada no anexo da sua atividade. | O módulo fiscal já separa por "tipo de serviço" (S-2): o contador deve dizer o anexo de cada tipo. |
| D6 | **Efficaz sem CNPJ conhecido** | Se a Efficaz tem CNPJ próprio, ela tem regime próprio e precisa de um segundo perfil tributário. Se fatura pelo CNPJ da Prospecta, a comissão de correspondente entra no Simples da Prospecta. | Confirmar no Drive/contador. [NÃO CONFIRMADO] |
| D7 | **Venda de imóvel próprio** | Se em algum caso a Prospecta compra lote, constrói e **vende a casa como dona** (e não constrói para o cliente que já é dono do lote), isso é atividade imobiliária que pode **não ser permitida no Simples** e tem tributação própria. | Perguntar ao contador como os contratos são feitos hoje. [NÃO CONFIRMADO] |

---

## (c) Comparação simples dos regimes (para 2027)

**Faturamento e folha reais não foram encontrados** (Drive não lido). Os números abaixo são **cenários** por faixa de
faturamento anual, para mostrar a ordem de grandeza. Valores em **% do faturamento**, sem contar o INSS sobre a folha,
que aparece numa linha à parte porque depende do tamanho da folha.

### Quanto cada regime cobra, em linhas gerais

| | **Simples Nacional** (atual) | **Lucro Presumido** | **Lucro Real** |
|---|---|---|---|
| Como funciona | Uma guia (DAS) com quase tudo junto; a alíquota sobe com o faturamento. | O governo "presume" um lucro sobre o faturamento e cobra IR e CSLL sobre ele; ISS e PIS/COFINS (em 2027: CBS) à parte. | Imposto sobre o lucro de verdade (contabilidade completa). |
| Obra **com todo o material** | Anexo IV | IR sobre 8% e CSLL sobre 12% do faturamento (≈ 2,3%) + ISS + PIS/COFINS 3,65% (até 2026) | 15% + adicional de IR e 9% de CSLL sobre o lucro real + PIS/COFINS não cumulativo |
| Obra **só mão de obra** (ou material parcial) | Anexo IV | IR e CSLL sobre **32%** (≈ 7,7%) + ISS + PIS/COFINS | idem |
| Corretagem de imóveis | Anexo III (INSS já incluído) | 32% (≈ 7,7%) + ISS + PIS/COFINS | idem |
| Gestão/administração de imóveis | **Anexo V**, ou III se o Fator R ≥ 28% (Perguntas e Respostas do Simples, Receita) | 32% (≈ 7,7%) + ISS + PIS/COFINS | idem |
| Serviços de engenharia/projetos | Anexo V; cai para o III se a folha for ≥ 28% do faturamento (Fator R) | 32% | idem |
| INSS patronal sobre a folha | **Obras (Anexo IV): pago à parte**, 20% + RAT (sem "terceiros"). Anexo III/V: já incluído no DAS. | 20% + RAT + terceiros (≈ 26% a 29%). Para construção, em 2027 pode haver a contribuição sobre a receita de transição (1,8% da receita + 15% da folha). | igual ao Presumido |
| Trabalho de contabilidade | Baixo | Médio | Alto (caro) |

### Cenários (só a parte que incide sobre o faturamento)

> **Atenção (base 2026):** as colunas do Presumido abaixo usam PIS/COFINS cumulativos (3,65%), que **acabam em 2027**, quando entram a CBS cheia e o IBS de teste (0,1%). Estes números servem para comparar o cenário de 2026; **não estabelecem sozinhos qual regime é mais barato em 2027**. Para 2027, o contador precisa simular o Presumido com CBS/IBS (e créditos), com os números reais. A recomendação de ficar no Simples em 2027 se apoia no fato de que, no Simples, CBS/IBS ficam dentro do DAS e o total praticamente não muda (fonte: https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/reforma-tributaria-do-consumo/entenda).

| Faturamento em 12 meses | Simples Anexo IV (alíquota efetiva, já com ISS, IR, CSLL, PIS/COFINS) | Presumido, obra **com** todo material (IR+CSLL ≈ 2,3% + PIS/COFINS 3,65% + ISS 3%–5%) | Presumido, **só mão de obra** (≈ 7,7% + 3,65% + ISS 3%–5%) |
|---|---|---|---|
| R$ 300 mil | **6,3%** | ≈ 9% a 11% | ≈ 14% a 16% |
| R$ 720 mil | **8,5%** | ≈ 9% a 11% | ≈ 14% a 16% |
| R$ 1,5 milhão | **11,4%** | ≈ 9% a 11% (+ INSS mais caro na folha) | ≈ 14% a 16% |
| R$ 3 milhões | **≈ 15,9%** | ≈ 9% a 11% (+ INSS mais caro na folha) | ≈ 14% a 16% |

Conta do Anexo IV (LC 123/2006): (faturamento × alíquota da faixa − parcela a deduzir) ÷ faturamento. Faixas usadas:
até R$ 180 mil 4,5%; até R$ 360 mil 9% (−R$ 8.100); até R$ 720 mil 10,2% (−R$ 12.420); até R$ 1,8 milhão 14%
(−R$ 39.780); até R$ 3,6 milhões 22% (−R$ 183.780); até R$ 4,8 milhões 33% (−R$ 828.000). As faixas de 4,5%, 9% e 33%
foram confirmadas em fontes; as de 10,2%, 14% e 22% são as da LC 155/2016 e precisam ser conferidas no texto da lei
pelo contador. ISS de Imperatriz para obra (item 7.02): **[NÃO CONFIRMADO]** — a faixa geral do município é de 2% a 5%;
usei 3% a 5%.

**Leitura dos cenários:**
- Até perto de **R$ 1 milhão por ano**, o Simples ganha com folga em qualquer tipo de obra.
- Entre **R$ 1,5 e R$ 2 milhões**, se quase todos os contratos forem **com todo o material**, o Presumido começa a empatar
  — mas o INSS na folha fica mais caro no Presumido (entram "terceiros", ≈ 5,8% a mais), o que costuma devolver a vantagem
  ao Simples quando a folha é grande.
- Se a maior parte for **só mão de obra** ou material parcial, o Simples ganha em todas as faixas até o limite.
- **Lucro Real** só compensa com margem muito baixa ou prejuízo e exige contabilidade completa; não se aplica ao porte
  atual.
- O limite do Simples é **R$ 4,8 milhões/ano** (acima de R$ 3,6 milhões o ISS sai do DAS). [faixas: LC 123/2006]

### Efeito da reforma tributária (IBS/CBS) — o que muda em 2027

- **2026 (ano de teste):** o optante do Simples **não** paga os 0,9% de CBS + 0,1% de IBS do teste. Nada muda.
- **2027:** PIS e COFINS acabam e entra a **CBS** cheia; o **IBS** começa com 0,1%. Para quem está no Simples, a CBS e o
  IBS **ficam dentro do DAS** (substituem a parte do PIS/COFINS) — **o valor total do DAS praticamente não muda**.
- **Opção "por fora"** (LC 214/2025, art. 41 §3º): o optante pode escolher recolher IBS/CBS pelo regime normal, fora do
  DAS. Vantagem: o **cliente empresa** que está no regime normal aproveita crédito cheio. Desvantagem: mais trabalho e,
  em geral, mais imposto para quem vende a pessoa física.
  - Prazo para o 1º semestre de 2027: **1 a 30 de setembro de 2026 — já passou.** Se nada foi feito, a Prospecta está,
    por padrão, com IBS/CBS **dentro** do DAS — o que é o certo para ela.
  - Há notícia da Receita de nova janela em **março de 2027** (efeito no 2º semestre de 2027) **[NÃO CONFIRMADO — a
    regra do CGSN para essa janela precisa ser conferida pelo contador]**.
- **Por que "por dentro" serve para a Prospecta:** a maioria dos clientes é **pessoa física** com financiamento da Caixa.
  Pessoa física não aproveita crédito de imposto, então recolher por fora só aumentaria custo e trabalho. Só valeria a
  pena se a Prospecta passar a prestar muito serviço para **construtoras/incorporadoras** no regime normal.
- **Para o regime normal (Presumido/Real), a reforma traz um redutor de 50%** no IBS/CBS das operações com imóveis,
  incluindo construção civil (LC 214/2025, regime específico de bens imóveis — arts. 251 a 270; a redução está no
  art. 261 segundo fontes; **numeração [NÃO CONFIRMADO]**), e crédito do imposto pago no material. Isso deixa o
  Presumido/Real um pouco mais competitivo **a partir de 2027–2029**, mas não muda a conclusão no porte atual.
- **Nota fiscal:** a partir de 2026 a NFS-e tem campos de IBS/CBS (o módulo fiscal já prevê isso na S-4). Para o optante
  do Simples, a nota informa o regime e o grupo de tributação do Simples.

---

## (d) Recomendação

**Manter o Simples Nacional em 2027, com IBS/CBS dentro do DAS.**

Justificativa curta:
1. É o regime em que a empresa já está, confirmado na Receita, e não exige nenhuma ação em janeiro (a opção continua
   valendo sozinha; só seria preciso agir para **sair**).
2. Nas faixas de faturamento prováveis para uma empresa ainda registrada como ME, o Simples é o mais barato e o mais
   simples de manter.
3. Os clientes são, na maioria, pessoas físicas — o crédito de IBS/CBS "por fora" não traz vantagem para eles.

**Quando rever (gatilhos):**
- Faturamento dos últimos 12 meses passando de **R$ 1,5 milhão** com a maior parte das obras **com todo o material** →
  pedir ao contador a simulação do Presumido.
- Passar a atender principalmente **empresas** no regime normal → avaliar IBS/CBS "por fora" na próxima janela.
- Passar a **vender casa própria** (comprar lote, construir e vender) → ver com o contador se continua permitido no
  Simples e se vale um CNPJ separado.
- Chegar perto de **R$ 3,6 milhões** (ISS sai do DAS) ou **R$ 4,8 milhões** (sai do Simples).

**Prazo:** se o contador concluir que vale **sair** do Simples em 2027, o pedido de exclusão no Portal do Simples
Nacional tem de ser feito **até o último dia útil de janeiro de 2027 (sexta-feira, 29/01/2027)**, valendo para o ano
inteiro. Depois disso, só em janeiro de 2028.

Confiança: **média**. Alta quanto ao regime atual (Receita); média quanto à recomendação, porque faltam faturamento,
folha e o anexo declarado (Drive não lido).

---

## (e) O que levar ao contador (lista para a reunião)

1. Extrato do **PGDAS-D** dos últimos 12 meses — pergunta: "em que anexo estão as receitas de obra? E as de corretagem,
   gestão e engenharia?"
2. Guias de **INSS patronal (DCTFWeb)** — pergunta: "estamos pagando o INSS patronal das obras fora do DAS, como manda o
   Anexo IV? Há algo a regularizar?"
3. **Faturamento** de 2025 e de jan–out/2026 e **folha de pagamento** (salários + pró-labore) dos mesmos meses —
   pergunta: "qual o Fator R? Os serviços de engenharia caem no Anexo III ou V?"
4. Modelo de **contrato de obra** usado com os clientes da Caixa — pergunta: "é empreitada com todo o material, parcial ou
   só mão de obra? Em algum caso vendemos imóvel próprio?"
5. Pergunta sobre o **porte**: "faturamos mais de R$ 360 mil? O porte ME está correto?"
6. Pergunta sobre a **reforma**: "confirmamos IBS/CBS dentro do DAS em 2027? Existe mesmo a janela de março de 2027?"
7. Pergunta sobre a **Efficaz**: "tem CNPJ próprio? Qual o regime? As comissões de correspondente são faturadas por qual
   CNPJ?"
8. Pedido de **simulação Simples × Presumido** com os números reais, para decidir até **29/01/2027**.
9. Para o módulo fiscal (S-4): **inscrição municipal** em Imperatriz, **alíquota de ISS** de cada tipo de serviço,
   código de serviço nacional de cada um e se a prefeitura exige retenção.
10. Paridade (regra do projeto): a mesma conferência vale para a empresa do **Grupo Santa Fé** — levar o CNPJ dela se o
    contador for o mesmo. (Nenhum documento do Santa Fé foi analisado aqui.)

---

## (f) O que configurar no sistema (BPO Financeiro › aba Contabilidade › Perfil tributário)

Fazer **depois** de ter o extrato do PGDAS-D em mãos (ou logo, e ajustar a alíquota depois):

| Campo da tela | Preencher com |
|---|---|
| CNPJ | 41.865.900/0001-89 (a razão social é preenchida pela consulta à Receita) |
| Empresa | PROSPECTA CONSTRUCOES E AVALIACAO IMOBILIARIA LTDA |
| **Regime** | **Simples Nacional** — atenção: a tela já vem com "Lucro Presumido" marcado; trocar. |
| Alíquota estimada | A **alíquota efetiva** do último extrato do PGDAS-D (ex.: 6,3% se o faturamento de 12 meses for R$ 300 mil no Anexo IV). Sem extrato: deixar uma estimativa e anotar "provisória" nas premissas. |
| Vigência inicial | 07/05/2021 (data da opção pelo Simples na Receita) |
| Premissas/observações | "Simples Nacional desde 07/05/2021 (Receita). Obras no Anexo IV: INSS patronal (20% + RAT) pago fora do DAS e **não** incluído na alíquota estimada. Corretagem no Anexo III; gestão de imóveis e engenharia no V (ou III se o Fator R ≥ 28%). 2027: IBS/CBS dentro do DAS. Alíquota tirada do extrato PGDAS-D de <mês/ano>." |

Depois, em **"Dados fiscais do perfil"** (S-2): município Imperatriz-MA, inscrição municipal (do alvará/cadastro da
prefeitura), série e ambiente — e, em **"Tipos de serviço"**, marcar com o contador o anexo/alíquota de cada tipo.
Se a Efficaz tiver CNPJ próprio, criar um **segundo perfil** para ela.

Observação: o cartão "Tributos estimados" multiplica a receita pela alíquota estimada; ele **não inclui** o INSS
patronal das obras. Isso deve ficar escrito nas premissas para ninguém achar que o custo total é só aquele.

---

## Pendências desta análise

- **Leitura do Google Drive** (todas as evidências documentais): não feita — as ferramentas do Drive não estavam
  disponíveis para o agente. Próximo passo exato: rodar a busca da lista "Como fazer a conferência do Drive" e preencher a
  linha "Documentos do Google Drive" da tabela (a) com nome do arquivo e data; depois refazer a tabela (c) com
  faturamento e folha reais.
- Leitura direta de páginas oficiais: o acesso a alguns sites (ex.: agenciagov.ebc.com.br) estava bloqueado nesta sessão;
  os dados vieram de buscas. Itens marcados [NÃO CONFIRMADO] devem ser conferidos.

## Fontes

- LC 123/2006 (Simples Nacional, art. 18 §5º-C — Anexo IV; Fator R): https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm
- LC 214/2025, texto compilado (IBS/CBS; art. 41 §3º opção do Simples; regime de bens imóveis): https://www.planalto.gov.br/ccivil_03/LEIS/LCP/Lcp214compilado.htm
- Receita/Agência Gov — opção do Simples por IBS/CBS fora do DAS (setembro/2026 e março/2027): https://agenciagov.ebc.com.br/noticias/202609/empresas-do-simples-nacional-ja-podem-optar-pelo-recolhimento-de-ibs-e-cbs-fora-do-regime-unificado
- Prazo de setembro/2026 para 2027: https://documentacao.senior.com.br/exigenciaslegais/noticias/federal/2026/2026-09-15-reforma-tributaria-prazo-para-opcao-pelo-simples-nacional-e-escolha-do-modelo-de-recolhimento-do-ibs-e-da-cbs-para-2027
- Construção civil e redução de 50% (regime de imóveis): https://www.conjur.com.br/2025-set-26/alguns-aspectos-da-reforma-tributaria-na-construcao-civil/ e https://sienge.com.br/blog/regime-especifico-das-operacoes-com-bens-imoveis/
- Anexo IV e CPP fora do DAS (IN RFB 2.110/2022, art. 164 §1º): https://www.e-auditoria.com.br/blog/anexo-iv-do-simples-nacional/ e https://contaja.com.br/blog/anexo-4-simples-nacional/
- Lucro Presumido na construção (8%/12% com todo material; 32% parcial/mão de obra; IN RFB 1.700/2017 art. 33): https://tributodevido.com.br/portal/percentuais-de-presuncao-no-lucro-presumido-para-empresas-de-construcao-civil/
- Reoneração da folha da construção (Lei 14.973/2024): https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2024/Lei/L14973.htm e https://sienge.com.br/blog/desoneracao-da-folha-de-pagamento-na-construcao/
- Fator R (engenharia, Anexo III × V): https://www.contabilizei.com.br/contabilizei-responde/empresa-de-engenharia-pode-ser-optante-do-simples-nacional/
- ISS em Imperatriz (faixa 2%–5%, fonte secundária; Código Tributário Municipal LC 005/2022): https://buscadorncm.com.br/iss/ma/imperatriz e https://transparencia.imperatriz.ma.gov.br/upload/decretos/105%20-%20DECRETO%20-%20Disp%C3%B5e%20sobre%20a%20ado%C3%A7%C3%A3o%20do%20modelo%20nacional%20da%20NFSE.pdf

## Atualização 22/11/2026 ~17:45 UTC — conferência feita pela sessão líder (Receita + Drive)

Consulta pública à Receita (Brasil API) e leitura de documentos do Drive (só dados da empresa; nenhum dado pessoal copiado):

| Empresa | CNPJ | Situação | Simples Nacional | Atividade principal |
|---|---|---|---|---|
| Prospecta Construções e Avaliação Imobiliária LTDA | 41.865.900/0001-89 | Ativa, ME | **Optante desde 07/05/2021, sem exclusão** | 4299-5/99 Outras obras de engenharia civil |
| Prospecta Construções LTDA ("VFX Capital", antiga Alto Impacto) | 58.121.993/0001-30 | Ativa, ME | Optante desde 16/11/2024 — **exclusão registrada para 30/11/2026** | 4120-4/00 Construção de edifícios |
| Efficaz Serviços Financeiros LTDA | 04.578.232/0001-82 | Ativa, ME | **Excluída em 31/12/2024** (estava desde 01/01/2021) | 6619-3/02 Correspondentes de instituições financeiras |

Achados:
1. **Urgente (58.121.993):** a Receita mostra exclusão do Simples com data de 30/11/2026. A partir de 01/12/2026 essa empresa passa a recolher fora do Simples (Presumido ou Real) se nada for feito. Confirmar com o contador o motivo (pedido próprio, débito, atividade vedada, sócio) e se cabe regularizar; a alteração contratual de 04/11/2026 (troca de sócio, nome e objeto) pode ter relação.
2. **Efficaz:** fora do Simples desde 2025 — hoje Presumido ou Real; confirmar qual com o contador. Tem CNPJ próprio (não usa o da Prospecta).
3. **Drive:** não foram encontrados extratos PGDAS-D, guias DAS, DEFIS ou DRE — o anexo do Simples declarado e o faturamento continuam sem evidência. Há contratos sociais e cartões CNPJ.
4. **Segurança:** existe um certificado digital (.p12) da Efficaz guardado como arquivo comum no Drive. Recomenda-se tirar de lá (o lugar dele é o cofre do sistema/Jurídico).
5. O sistema (perfil tributário) está vazio para as três.

Orientação (preliminar, a decidir com o contador): Prospecta 41.865.900 — continuar no Simples (Anexo IV para obras, INSS patronal à parte). 58.121.993 — tratar a exclusão antes de 30/11. Efficaz — confirmar o regime atual e simular Presumido × Real.

## Decisão do dono — 22/11/2026

"Certo, vamos trabalhar então tudo no Simples Nacional." Registrado no CLAUDE.md. Feito no sistema: perfil tributário da
Prospecta Construções e Avaliação Imobiliária (41.865.900/0001-89) cadastrado como Simples Nacional desde 07/05/2021
(alíquota estimada pendente do extrato PGDAS-D); a tela passa a sugerir Simples Nacional por padrão. VFX Capital e Efficaz:
só entram como Simples depois da ação do contador (exclusão em 30/11/2026; nova opção em janeiro, até 29/01/2027).
