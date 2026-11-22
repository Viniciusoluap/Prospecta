# EPIC-029 — Códigos de serviço para a NFS-e (pesquisa em fonte oficial)

**Data da pesquisa:** 22/11/2026 · **Quem fez:** @analyst (Atlas) · **Status:** proposta para o contador conferir.

Pedido do dono: "os códigos de serviço você vai ter que procurar e achar". Aqui estão, para cada tipo de serviço
cadastrado em `fiscal_tipos_servico` (migração `drizzle/0154_fiscal_notas.sql`), os códigos que a NFS-e Nacional
pede. Tudo o que está na tabela principal saiu das planilhas oficiais do gov.br/nfse; o que não deu para conferir em
fonte oficial está marcado **[NÃO CONFIRMADO]**. Nenhum código foi inventado (Artigo IV).

## 1. Fontes oficiais usadas (baixadas e lidas linha a linha)

| Sigla | Documento oficial | Link |
|---|---|---|
| **[B]** | Anexo B — Lista de Serviços Nacional (cTribNac) + Lista NBS 2.0, v1.01 de 22/01/2026 | https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/anexo_b-nbs2-lista_servico_nacional-snnfse-v1-01-20260122.xlsx |
| **[VIII]** | Anexo VIII — Tabela de correlação Item LC 116 × NBS × código de atividade do Simples (cAtvSN) × indicador de operação (IndOp) × cClassTrib, v01.02.00 de 26/10/2026 | https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/anexo_viii-tabela-correlacao-v01-02-00-20261026.xlsx |
| **[I]** | Anexo I — Leiaute e regras da DPS/NFS-e (aba "MUN.INCID INFO.SERV." = local de incidência do ISS por código), v1.01 de 09/02/2026 | https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/anexo_i-sefin_adn-dps_nfse-snnfse-v1-01-20260209.xlsx |
| **[III]** | Anexo III — Cadastro Nacional de Contribuintes (CNC), v1.00 | https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/anexo_iii-cnc-snnfse-v1-00-20251216.xlsx |
| **[VI]** | Anexo VI — Leiaute e regras RTC (IBS/CBS) v1.04.01 (NT 009) | https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/anexovi-leiautesrn_rtc_ibscbs-v1-04-01-nt009.xlsx |
| **[A]** | Anexo A — Municípios IBGE: Imperatriz-MA = **2105302**; Canaã dos Carajás-PA = **1502152** | https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/anexo_a-municipio_ibge-paises_iso2-v1-00-snnfse-20251210.xlsx |
| **[CT]** | Calculadora de Tributos do Consumo — dados abertos, tabela de cClassTrib (base V0073, "IT 2025.002 v.1.71", 30/10/2026) | https://consumo.tributos.gov.br/servico/calcular-tributos-consumo/api/calculadora/dados-abertos/classificacoes-tributarias/cbs-ibs?data=2026-11-22 |

Não abriram nesta sessão (rede bloqueada): planalto.gov.br (texto da LC 116 e da LC 123), camara.leg.br,
receita.fazenda.gov.br (Soluções de Consulta), sites da Prefeitura de Imperatriz (imperatriz.ma.gov.br,
transparencia.imperatriz.ma.gov.br). Por isso, o texto da lei em si e a lei de Imperatriz ficaram **[NÃO CONFIRMADO]**.

### Como ler os códigos
- **cTribNac** tem sempre 6 dígitos: item (2) + subitem (2) + desdobro nacional (2). A planilha [B] mostra sem o zero
  da frente (ex.: `70202`); na nota e no banco vai **`070202`** (a coluna `codigo_tributacao_nacional` já exige 6 dígitos).
- **NBS**: na tela aparece `1.0101.11.00`; no banco (`codigo_nbs`, 9 dígitos) vai **`101011100`**.
- **cAtvSN** (campo novo da NFS-e, obrigatório para optante do Simples — regra 449 de [VI]): 7 = Anexo III;
  9 = Fator R (Anexo III ou V); 12 = construção 7.02/7.05 no Anexo III; 13 = construção 7.02/7.05 no **Anexo IV**;
  IMP = atividade **impeditiva** no Simples ([VIII]).
- **CST** do IBS/CBS = os 3 primeiros dígitos do cClassTrib (000 = tributação integral; 200 = alíquota reduzida).

## 2. Tabela principal (proposta)

| # | Tipo de serviço no sistema | Item LC 116 | cTribNac | NBS sugerida | Onde o ISS é devido [I] | Simples: cAtvSN / anexo [VIII] | ISS Imperatriz | cClassTrib (sugestão) [VIII][CT] |
|---|---|---|---|---|---|---|---|---|
| 1a | Assessoria e honorários (BPO) — **parte contábil** (escrituração, folha, apuração) | 17.19 | `171901` | 1.1302.21.00 (contabilidade) · alt. 1.1302.23.00 (folha) | Estabelecimento do prestador | **7** — Anexo III (ou 8, se o município permitir ISS fixo de escritório contábil) | [NÃO CONFIRMADO] | `200052` (profissões intelectuais, −30%) **se** cumprir os requisitos; senão `000001` |
| 1b | Assessoria e honorários (BPO) — **parte financeira** (contas a pagar/receber, conciliação, gestão de terceiros) | 17.12 | `171201` | 1.1401.21.00 (gestão em processos de negócios) | Estabelecimento do prestador | **9** — Fator R (III ou V) | [NÃO CONFIRMADO] | `000001` (integral) |
| 2 | Outras receitas do BPO | segue o serviço que gerou a receita (1a ou 1b) | idem | idem | idem | idem | idem | idem. **Reembolso de despesa não é serviço**: ver obs. 4.3 |
| 3 | Recebimento de obra (empreitada) — casa para pessoa física financiada pela Caixa | 7.02 | `070202` (empreitada/subempreitada) | 1.0101.11.00 (edificação residencial de 1 e 2 pavimentos) · 1.0101.12.00 se tiver mais de 2 | **Local da obra** (e o grupo "obra" é obrigatório na nota: CNO, CIB ou endereço) | **13** — Anexo IV (INSS patronal fora do DAS) | [NÃO CONFIRMADO]; a nota usa a alíquota do **município da obra** | `200046` (operações com bens imóveis, −50%) |
| 3b | Obra por **administração** | 7.02 | `070201` | idem 3 | Local da obra | 13 — Anexo IV | idem | `200046` |
| 3c | Reforma/reparo | 7.05 | `070501` | 1.0101.11.00 · 1.0107.90.00 (acabamento) | Local da obra | 13 — Anexo IV (alguns NBS de 7.02/7.05, ex. pintura 1.0107.30.00, aparecem como 12 = Anexo III) | idem | `200046` |
| 4a | Regularização e despachante — **parte documental** (averbação, certidões, protocolo em cartório e prefeitura) | 17.01 | `170101` | 1.1301.30.00 (documentação e certificação, exceto notariais e de registro) · alt. 1.1001.90.00 (serviços imobiliários não classificados) | Estabelecimento do prestador | **9** — Fator R | [NÃO CONFIRMADO] | `000001` |
| 4b | Regularização — **parte técnica** (levantamento topográfico, projeto de REURB, planta, memorial, ART) | 7.01 | `070103` agrimensura · `070104` urbanismo · `070101` engenharia | 1.1402.21.00 (planejamento urbano) · 1.1403.21.10 (engenharia p/ construção residencial) · 1.1403.90.00 | Estabelecimento do prestador | **9** — Fator R | [NÃO CONFIRMADO] | `200052` se cumprir os requisitos; senão `000001` |
| 5 | Avaliação de imóvel (laudo do engenheiro) | **28.01** (recomendado) | `280101` | **1.1001.30.00 (serviços de avaliação de imóveis)** | Estabelecimento do prestador | **9** — Fator R | [NÃO CONFIRMADO] | `000001` |
| 5-alt | — alternativa se o contador preferir "laudo técnico" | 17.09 | `170901` | 1.1404.49.00 (análises e exames técnicos não classificados) | Estabelecimento do prestador | 9 | idem | `000001` |
| 6 | Comissão de correspondente Caixa Aqui | **17.01** (provisório — ver seção 3) | `170101` | 1.1413.00.00 (prospecção de clientes) · alt. 1.1401.39.00 (assessoria empresarial não classificada) | Estabelecimento do prestador | 9 no Anexo VIII para 17.01 — **anexo real do correspondente: [NÃO CONFIRMADO]** (ver seção 3) | [NÃO CONFIRMADO]; nota antiga da Efficaz: 4% a 5% | `000001` |
| 7 | Corretagem de imóveis | 10.05 | `100501` | 1.1001.21.00 (intermediação de compra e venda de imóveis residenciais) · 1.1001.22.00 (não residenciais) | Estabelecimento do prestador | **7** — Anexo III (linha do NBS 1.1001.21.00) | [NÃO CONFIRMADO] | `200046` (−50%) |
| 8 | Administração/gestão de imóveis de terceiros | 17.12 | `171201` | 1.1001.11.00 (administração e locação de imóveis residenciais) · 1.1001.12.90 (não residenciais) | Estabelecimento do prestador | **9** — Fator R (linha do NBS 1.1001.11.00) | [NÃO CONFIRMADO] | `200046` (−50%) |

**Códigos evitados de propósito** (o Anexo VIII marca como **impeditivos no Simples** e com cClassTrib `820007`,
"serviços financeiros"): 10.02 (`100202` intermediação de contratos quaisquer), 15.08, 15.18 (`151801` avaliação e
vistoria de imóvel ou obra **relacionada a crédito imobiliário**) e 15.01. Usar um deles numa empresa do Simples faria a
nota sair com um código que o próprio sistema trata como atividade proibida no regime.

## 3. Correspondente bancário: 17.01 é o certo?

O que se sabe:
- A Efficaz emitia em Imperatriz com **17.01 "Assessoria ou consultoria"** (atividade 7319-0/02 "Promoção de vendas",
  ISS 4% a 5%) e em Canaã dos Carajás com a descrição "serviço de correspondência bancária da Caixa".
- Não existe na LC 116 um item com o nome "correspondente bancário". As opções da lista oficial [B] são:

| Opção | cTribNac | Prós | Contras |
|---|---|---|---|
| **17.01.01** Assessoria ou consultoria **não contida em outros itens** | `170101` | Já aceito por Imperatriz nas notas antigas; compatível com o Simples (cAtvSN 9); cClassTrib integral `000001` | É item "residual": se o fiscal entender que a atividade cabe em outro item, pode reenquadrar |
| 10.02.02 Agenciamento, corretagem ou intermediação de **contratos quaisquer** | `100202` | Descreve bem o que o correspondente faz (intermedia o contrato de financiamento) | Anexo VIII marca **IMP** (impeditivo no Simples) e `820007` (documento de serviço financeiro) |
| 15.06 / 15.08 / 15.18 (serviços bancários, crédito imobiliário) | `1506xx`, `1508xx`, `1518xx` | Ligados ao financiamento | Item 15 é de instituição financeira; 15.08 e 15.18 são **IMP** no Simples |

**Recomendação:** manter **17.01.01** (`170101`) por enquanto, porque é o que a prefeitura de Imperatriz já aceitou
e porque não deixa a nota com código impeditivo no Simples. **A decisão final é do contador**, de preferência com uma
consulta escrita à Secretaria de Finanças de Imperatriz (ver seção 5).

**Anexo do Simples para correspondente — [NÃO CONFIRMADO em fonte oficial]:** fontes não oficiais (Contábeis, Tributo
Devido, Sebrae-PR) dizem que o CNAE 6619-3/02 (correspondentes de instituições financeiras) **pode** optar pelo Simples
desde 2012 (passou de "impeditivo" para "ambíguo", com declaração de exercer só atividade permitida) e que o mais citado
é o **Anexo III**; há divergência sobre aplicar o Fator R. As Soluções de Consulta citadas por esses sites (Cosit 41/2018,
237/2015) não puderam ser abertas aqui (site da Receita bloqueado nesta sessão). Observação importante: o anexo do Simples
é definido pela **atividade** declarada no PGDAS-D, não pelo código da nota; o cAtvSN da nota deve bater com o que o
contador declara.

## 4. Observações por tema

### 4.1 Obra (itens 7.02 e 7.05)
- **Local do ISS:** pela aba "MUN.INCID INFO.SERV." do Anexo I [I], os códigos `070201`, `070202`, `070501` e `071901`
  têm incidência no **Local da Prestação**, e o grupo de informações **"obra"** é obrigatório. Isso reflete o art. 3º, III,
  da LC 116/2003 (ISS devido no local da obra) — o texto da lei não foi aberto (planalto bloqueado), mas a regra do
  sistema oficial é inequívoca. **Consequência prática:** obra em Imperatriz paga ISS a Imperatriz; obra em outra cidade
  paga à outra cidade, com a alíquota de lá, mesmo emitindo do mesmo CNPJ.
- **Dedução de materiais:** o leiaute [I] tem o tipo de dedução **"02 – Materiais"** (e "08 – Subempreitada de mão de
  obra"), e a regra E0446 diz que a dedução só é aceita se o **município de incidência** tiver parametrizado o código
  para permitir dedução. Os subitens 07.02 e 07.05 estão na lista de exceção à regra do ISS mínimo de 2% ([I], linha 389).
  A base legal (art. 7º, §2º, I, da LC 116 — materiais fornecidos pelo prestador) e o percentual aceito por Imperatriz:
  **[NÃO CONFIRMADO]** — o contador precisa confirmar se Imperatriz permite e como (valor, percentual ou nota de compra).
- **Simples:** cAtvSN **13** = Anexo IV, em que o INSS patronal (CPP) é pago fora do DAS, na folha (LC 123, art. 18,
  §5º-C — texto não aberto aqui, mas o próprio código 13 do Anexo VIII diz "Anexo IV").
- **IBS/CBS:** `200046` "Operações com bens imóveis", redução de 50% [CT]. Para o optante do Simples, o IBS/CBS fica
  dentro do DAS (campo `regApIBSCBSSN` = 1 na nota), salvo se a empresa optar pelo regime regular para eles.

### 4.2 Onde o ISS dos demais serviços é devido
Todos os outros códigos da tabela (17.01, 17.09, 17.12, 17.19, 28.01, 7.01, 10.05) têm incidência no
**estabelecimento do prestador** [I] — ou seja, em Imperatriz, para a empresa de Imperatriz, mesmo que o cliente ou o
imóvel estejam em outra cidade.

### 4.3 "Outras receitas do BPO" e reembolsos
- Receita que vem de serviço prestado: usar o mesmo código do serviço (1a ou 1b).
- **Reembolso de despesa** (ex.: taxa de cartório paga pelo escritório e cobrada do cliente): não é preço de serviço. A
  NFS-e nova tem o campo `vCalcReeRepRes` ("reembolso, repasse ou ressarcimento", fora da base do ISS e do IBS/CBS) e o
  tipo de dedução "04 – Reembolso de despesas" [I][VI]. Sugestão para o sistema: o tipo "Outras receitas do BPO" fica
  com **"sempre perguntar"**, e reembolso puro pode ir para **"nunca gerar"** ou ser informado como reembolso — **decisão
  do contador**.

### 4.4 Redução "profissões intelectuais" (`200052`, −30%)
O Anexo VIII oferece `200052` para 7.01, 7.03, 17.19 e 17.20. A redução vale só para profissões regulamentadas e
fiscalizadas por conselho (engenheiro, arquiteto, contador, administrador, economista…), com condições para a empresa
(LC 214/2025, art. 127 — **[NÃO CONFIRMADO]** o texto exato, a lei não pôde ser aberta). Corretor de imóveis **não**
aparece com `200052` no Anexo VIII. Na dúvida, usar `000001` e deixar o contador ligar a redução.

### 4.5 Ano de 2026
Em 2026 o IBS/CBS ainda é de teste. A regra 447 de [VI] diz: se o bloco IBS/CBS for informado na nota, a **NBS passa a
ser obrigatória** — por isso a tabela já traz NBS para todos os tipos.

## 5. Imperatriz-MA (código IBGE 2105302)

### 5.1 Alíquotas de ISS por item — [NÃO CONFIRMADO]
- O decreto municipal que adota a NFS-e Nacional cita a **Lei Complementar Municipal nº 005/2022** como Código
  Tributário Municipal (fonte: resultado de busca apontando para
  https://transparencia.imperatriz.ma.gov.br/upload/decretos/105%20-%20DECRETO%20-%20Disp%C3%B5e%20sobre%20a%20ado%C3%A7%C3%A3o%20do%20modelo%20nacional%20da%20NFSE.pdf
  — o arquivo não abriu nesta sessão).
- A tabela de alíquotas por item (anexo da LC 005/2022) **não foi lida**. Sites não oficiais
  (https://buscadorncm.com.br/iss/ma/imperatriz, https://www.boaconta.com.br/iss/imperatriz/) dizem que a maioria dos
  itens é 5% e que a faixa vai de 2% a 5%; as notas antigas da Efficaz mostram 4% a 5% para 17.01. **Não usar esses
  números sem o contador confirmar.**
- Dica para confirmar sem ler a lei: no Emissor Nacional, ao escolher o município 2105302 e o código de serviço, o
  sistema mostra a alíquota que a prefeitura cadastrou (a mesma parametrização que valida a nota — regra 440 de [VI]: o
  código precisa estar "administrado" pelo município, senão a nota é rejeitada).

### 5.2 Inscrição municipal ("Indicador Municipal") — o que é oficial
Pelas regras do Anexo I [I] e do Anexo III [III]:
1. **Por padrão, toda empresa com endereço no município pelo CNPJ está habilitada** a emitir no Emissor Nacional
   ([III], campo `cStatEmiss`: "Por padrão todos os contribuintes com endereço em um município pelos cadastros RFB estão
   habilitados… Para desabilitar, o município registra o complemento").
2. **Se a prefeitura cadastrou a empresa no CNC** (cadastro complementar, com a inscrição municipal), a nota **tem que
   levar a IM** (regra E0116) e a IM tem que estar "Autorizada" (E0119).
3. **Se a prefeitura não cadastrou**, a nota **não pode** levar IM (E0120) — informar IM "por garantia" faz a nota ser
   rejeitada.
4. A prefeitura pode mudar a "situação padrão" do município para "não habilitado" (regra 188); aí só emite quem ela
   cadastrar no CNC.

Se Imperatriz exige inscrição prévia (cadastro mobiliário) e qual a situação padrão dela: **[NÃO CONFIRMADO]**. Um site
não oficial cita o Decreto 19/2023 e a Portaria 15/2024 de Imperatriz sobre retenção para prestador com ou sem cadastro
mobiliário.

### 5.3 Como a empresa obtém a inscrição se não tiver — [NÃO CONFIRMADO]
Caminho usual (precisa ser confirmado com a prefeitura): pedir a inscrição no cadastro mobiliário da Secretaria
Municipal de Finanças/Fazenda de Imperatriz (ou pela REDESIM, se o município integrar), com contrato social, cartão
CNPJ, alvará e documento do responsável; depois a prefeitura lança a IM no CNC Nacional. **O jeito mais rápido de
descobrir:** entrar no Emissor Nacional com o CNPJ da empresa — se o campo "Indicador Municipal (Inscrição)" já vier com
um número para escolher, a prefeitura já cadastrou; se vier vazio e a emissão funcionar, a empresa está habilitada pelo
padrão e **não deve** informar IM.

## 6. O que o contador precisa só confirmar (lista curta)

1. BPO: os honorários são de **contabilidade** (17.19.01) ou de **gestão financeira** (17.12.01)? Se forem os dois, separar
   em duas notas ou usar o item da parte principal.
2. Obra: confirmar `070202` + NBS 1.0101.11.00 + cAtvSN 13, e se Imperatriz (e as outras cidades das obras) aceitam
   **dedução de materiais** — e de que forma.
3. Avaliação: aceitar **28.01.01** com NBS "avaliação de imóveis", ou preferir 17.09.01 / 7.01.01.
4. Correspondente: manter **17.01.01** ou mudar; e o **anexo do Simples** da empresa correspondente (III com ou sem Fator R).
5. Regularização: quando o serviço for técnico (topografia, projeto), usar 7.01.xx; quando for papelada, 17.01.01.
6. Alíquotas de ISS de Imperatriz para cada código (anexo da LC 005/2022) e se há código municipal (`cTribMun`) exigido.
7. Se a empresa já tem inscrição no CNC de Imperatriz (ver 5.3).
8. Ligar ou não a redução `200052` para os serviços de engenharia e contabilidade.

## 7. Para o desenvolvimento (S-2 rascunhos)

- Os valores da tabela podem ir como **sugestão pré-preenchida** na tela de tipos de serviço, sempre com a marca
  "a confirmar pelo contador" — nunca gravados como definitivos sem ele.
- Formato no banco: cTribNac com zero à esquerda (`070202`), NBS sem pontos (`101011100`), `item_lc116` no formato
  `7.02`/`17.01` (a regra CHECK aceita `^[0-9]{1,2}\.[0-9]{2}$`).
- Obra exige o grupo "obra" na nota (CNO ou CIB ou endereço da obra) e município de incidência = município da obra.
- Prever o campo **cAtvSN** (código da atividade do Simples) no tipo de serviço: é obrigatório para optante (regra 449 de [VI]).

---
Fontes não oficiais consultadas só como pista (não sustentam nenhum código da tabela):
[Contábeis — tributação de correspondentes bancários](https://www.contabeis.com.br/forum/tributos-federais/321347/tributacao-de-correspondentes-bancarios/),
[Tributo Devido — correspondente bancário no Simples](https://tributodevido.com.br/portal/correspondente-bancario-no-simples-nacional/),
[Sebrae-PR — tributação de correspondente bancário](https://sebraepr.com.br/comunidade/artigo/entenda-a-tributacao-de-correspondente-bancario-no-simples-nacional),
[contabilidade.com — CNAE 6619-3/02](https://contabilidade.com/blog/cnae-6619302-correspondentes-de-instituicoes-financeiras-simples-nacional-fator-r-e-abertura-de-empresa/),
[NCM Buscador — ISS Imperatriz](https://buscadorncm.com.br/iss/ma/imperatriz),
[Boa Conta — ISS Imperatriz](https://www.boaconta.com.br/iss/imperatriz/).
