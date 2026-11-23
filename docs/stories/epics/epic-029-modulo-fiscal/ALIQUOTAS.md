# EPIC-029 — Alíquotas para a NFS-e (ISS dos municípios e Simples Nacional)

**Data da pesquisa:** 22/11/2026 · **Quem fez:** @analyst (Atlas) · **Status:** pesquisa nossa, a pedido do dono ("nós
pesquisamos e incluímos as alíquotas, sem esperar o contador"). Complementa `CODIGOS-SERVICO.md` (códigos) e
`REGIME-TRIBUTARIO.md` (regime). **Orientação técnica, não parecer contábil.**

Como ler as marcas:
- **[OFICIAL]**: número lido no documento oficial, com link e artigo/linha.
- **[OFICIAL — trecho]**: o documento é oficial (site da Prefeitura ou da Câmara), mas só li o trecho que a busca
  mostrou, porque o site está bloqueado nesta sessão.
- **[NÃO CONFIRMADO]**: não achei em fonte oficial. Vem com a melhor fonte secundária e o grau de confiança.

## 0. Limite desta pesquisa (ler antes)

Desta sessão, **só os sites gov.br abriram** (portal da NFS-e e Receita/gov.br). Ficaram **bloqueados** pela rede:
planalto.gov.br (LC 116 e LC 123), camara.leg.br, legis.senado.leg.br, normas.receita.fazenda.gov.br,
www8.receita.fazenda.gov.br (Portal do Simples), imperatriz.ma.gov.br (e os subdomínios novo., transparencia., sti.,
diariooficial.), camaraimperatriz.ma.gov.br, parauapebas.pa.gov.br, sapl.parauapebas.pa.leg.br,
canaadoscarajas.pa.gov.br, leismunicipais.com.br e os sites de contabilidade. **Para fechar os itens [NÃO CONFIRMADO],
esses domínios precisam ser liberados nas configurações de rede da sessão**, ou o número tem que ser lido no Emissor
Nacional (ver 1.6).

Consequência:
- As **tabelas do Simples (seção 3)** foram montadas a partir do texto da LC 123 com a redação da LC 155/2016 (em vigor
  desde 01/01/2018), conferidas com várias fontes secundárias que concordam entre si e com a conta de que cada linha de
  repartição soma 100,00%. Confiança **alta**, mas o texto do Planalto não foi aberto nesta sessão.
- **As alíquotas de ISS por item dos três municípios não estão publicadas em nenhuma fonte que eu consegui abrir.** O que
  há é a alíquota geral (5%) por fonte secundária ou por trecho de documento oficial.

---

## 1. Imperatriz-MA (IBGE 2105302)

### 1.1 Lei que vale
- **Código Tributário do Município de Imperatriz (CTMI): Lei Complementar Municipal nº 001/2003**, com texto atualizado
  publicado pela Prefeitura [OFICIAL — trecho]:
  https://novo.imperatriz.ma.gov.br/media/site/download/legislacao/Lei_Complementar_n%C2%BA_001_-_2003_-_Atualizada.pdf
  · índice: https://www.camaraimperatriz.ma.gov.br/upload/codigo_tributario/43607.pdf
  Pelo trecho lido, as alíquotas ("ALCs – Alíquotas Correspondentes") estão no **anexo único** dessa lei.
- O Decreto nº 105/2025 (adoção da NFS-e Nacional) cita a **LC Municipal nº 005/2022** como Código Tributário
  (https://transparencia.imperatriz.ma.gov.br/upload/decretos/105%20-%20DECRETO%20-%20Disp%C3%B5e%20sobre%20a%20ado%C3%A7%C3%A3o%20do%20modelo%20nacional%20da%20NFSE.pdf).
  **[NÃO CONFIRMADO]** se a LC 005/2022 substituiu a LC 001/2003 ou só a alterou. Um documento municipal citado pela
  busca trata a LC 005/2022 como alteração (presunção de receita omitida na fiscalização).

### 1.2 Alíquota de ISS por item — [NÃO CONFIRMADO]

| Item LC 116 | Serviço | Alíquota em Imperatriz | Fonte / confiança |
|---|---|---|---|
| 17.12 | Administração em geral (BPO financeiro) | **5%** (provável) | [NÃO CONFIRMADO]. Secundária: NCM Buscador diz que 5% é a alíquota de 272 dos 334 códigos de Imperatriz (https://buscadorncm.com.br/iss/ma/imperatriz); Boa Conta dá a faixa de 2% a 5% (https://www.boaconta.com.br/iss/imperatriz/). Confiança: média |
| 7.02 | Obra por empreitada/administração | **[NÃO CONFIRMADO]**. Faixa possível: abaixo de 2% a 5% (ver 1.3) | Nenhuma fonte deu o número do 7.02. O NCM Buscador põe o 7.02 entre os itens com ISS no local da obra. Confiança: baixa |
| 17.01 | Assessoria/consultoria (regularização, despachante, comissão) | **5%** (provável) | [NÃO CONFIRMADO]. Notas antigas da Efficaz em Imperatriz saíram com 4% a 5% (CODIGOS-SERVICO.md, seção 3). Confiança: média |
| 28.01 | Avaliação de bens | **5%** (provável) | [NÃO CONFIRMADO]. Mesma fonte secundária geral. Confiança: média-baixa |
| 17.19 | Contabilidade | **[NÃO CONFIRMADO]**, 2% a 5% | Muitos municípios usam alíquota menor ou ISS fixo para escritório contábil. Confiança: baixa |
| 17.09 | Perícias e laudos | **5%** (provável) | [NÃO CONFIRMADO]. Confiança: média-baixa |
| 7.01 | Engenharia, agrimensura, urbanismo | **[NÃO CONFIRMADO]**, 2% a 5% | Confiança: baixa |
| 7.05 | Reforma/reparo | **[NÃO CONFIRMADO]**, igual ao 7.02 na maioria dos municípios | Confiança: baixa |

**Regra para o sistema:** essas alíquotas valem só para empresa **fora do Simples** (hoje: as Efficaz, excluídas em
31/12/2024 e 31/08/2025, ver REGIME-TRIBUTARIO.md) e para o caso de **retenção** (ver 1.5). Para a Prospecta
(Simples), o ISS sai pela tabela do Simples (seção 3), não pela alíquota da prefeitura.

### 1.3 Alíquota mínima de 2% (LC 116, art. 8º-A)
- Regra nacional: o ISS mínimo é 2%, e o município não pode dar benefício, redução de base ou crédito que deixe a carga
  abaixo de 2% (art. 8º-A, caput e §1º, LC 116/2003, incluído pela LC 157/2016). **Exceções do próprio §1º: subitens
  7.02, 7.05 e 16.01.** Para obra (7.02/7.05), o município **pode** cobrar menos de 2%. Fonte do texto: Planalto
  (https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm, não aberto nesta sessão). **Confirmação oficial
  indireta [OFICIAL]:** o leiaute da NFS-e Nacional (Anexo I, linha 389, v1.01 de 09/02/2026) traz 07.02 e 07.05 na
  lista de exceção à validação de ISS mínimo de 2% (já registrado em CODIGOS-SERVICO.md, 4.1).
- Nota de 2% "efetiva" no Simples: as tabelas da LC 155/2016 foram montadas para o ISS da 1ª faixa ficar em ~2%
  (Anexo III: 6% × 33,5% = 2,01%; Anexo IV: 4,5% × 44,5% = 2,0025%; Anexo V: 15,5% × 14% = 2,17%).

### 1.4 Dedução de materiais na construção (7.02 / 7.05)
- **Lei nacional:** não entra na base do ISS "o valor dos materiais fornecidos pelo prestador dos serviços previstos nos
  itens 7.02 e 7.05" (LC 116, art. 7º, §2º, I). [Texto: Planalto, não aberto nesta sessão.] O alcance é disputado: há
  decisões recentes do STJ (fim de 2024) que restringem a dedução a material produzido **fora** do canteiro e sujeito
  ao ICMS. [NÃO CONFIRMADO]: os números dos acórdãos não foram lidos.
- **Imperatriz aceita dedução:** **Decreto Municipal nº 35/2018** regula a redução da base do ISSQN na construção
  civil. O prestador pode optar pelo **tratamento simplificado: dedução de até 40% da base**, lançada no portal da nota
  da prefeitura. Subempreitada só se deduz se o ISS dela foi pago a Imperatriz (não se deduz subempreiteiro autônomo,
  isento ou que pagou ISS a outro município). Fontes: notícia da Prefeitura (https://imperatriz.ma.gov.br/noticias/planejamento/prefeitura-simplifica-cobranca-de-imposto-para-construcao-civil.html)
  e O Imparcial (https://www.imparcial.com.br/noticias/desconto-de-40-no-iss-beneficia-construcao-civil,9664).
  **[OFICIAL — trecho]**: a notícia é do site da Prefeitura. O decreto não foi aberto, e **não confirmei que o decreto
  continua em vigor em 2026**.
- **Na NFS-e Nacional:** a dedução só passa se o município parametrizou o código para aceitar (regra E0446; tipo de
  dedução "02 – Materiais" no leiaute antigo; na NT 009 virou ajuste de base, `vAjusteBC`). Se o município só aceita
  percentual, mandar valor em reais faz a nota ser rejeitada (FAQ NFS-e v1.4, de 18/11/2026, item 21 [OFICIAL]). O
  sistema deve consultar `GET /parametros_municipais/{codMun}/aliquotas` (ver 1.6) para saber se o município aceita
  dedução em valor, percentual ou por documento.
- **No Simples:** o ISS entra no DAS pela receita bruta total. **[NÃO CONFIRMADO]** se o PGDAS-D deixa abater
  materiais do ISS. Pelo que li, o abatimento só vale quando o município concede redução na forma do art. 18, §20, da
  LC 123. **Para a Prospecta, não abater no sistema sem o contador ligar.**

### 1.5 Retenção na fonte pelo tomador
- **Regra nacional (LC 116, art. 6º, §2º, II):** a **pessoa jurídica** tomadora (mesmo imune ou isenta) é responsável
  pelo ISS dos subitens 3.05, **7.02**, 7.04, **7.05**, 7.09, 7.10, 7.12, 7.14, 7.15, 7.16, 7.17, 7.19, 11.02, 17.05
  e 17.10, entre outros. O município pode ampliar a lista por lei própria (art. 6º, caput). [Texto: Planalto, não
  aberto.]
- **Imperatriz — Decreto nº 085, de 28/07/2020** [OFICIAL — trecho]
  (https://novo.imperatriz.ma.gov.br/media/site/download/legislacao/Decreto_n%C2%BA_085_de_28.07.2020.PDF):
  regula a retenção do ISSQN. Pelos trechos lidos: (a) a empresa tomadora dos itens 7.02/7.05, mesmo imune ou isenta,
  é substituta tributária; (b) ser do Simples **não** livra a ME/EPP da retenção; (c) quem paga ISS fixo mensal não
  sofre retenção; (d) a retenção usa a alíquota vigente, e há um caso em que se aplica 5%. Provável: quando a nota não
  traz a alíquota, como no art. 21, §4º, V, da LC 123. Um site não oficial cita também o Decreto 19/2023 e a Portaria
  15/2024 [NÃO CONFIRMADO].
- **Retenção de prestador do Simples (LC 123, art. 21, §4º):** a alíquota a reter é o **percentual de ISS da faixa**
  do prestador no mês anterior, informado na nota (inciso I). Sem alíquota na nota, retém 5% (inciso V). O valor retido é
  definitivo, e essa receita sai do ISS do DAS (inciso VII). Quem paga ISS fixo não sofre retenção (inciso IV). [Texto:
  Planalto, não aberto. A regra aparece igual em várias fontes secundárias.]
- **Na prática da Prospecta:** obra para **pessoa física** com financiamento da Caixa **não tem retenção** (a
  responsabilidade do art. 6º, §2º, II é de pessoa jurídica). Há retenção quando o tomador é **empresa** (construtora,
  incorporadora, órgão público) e o serviço está na lista. Para os itens 17.xx e 28.01 não há retenção pela lei
  nacional, a não ser que a lei municipal inclua [NÃO CONFIRMADO para Imperatriz].

### 1.6 Convênio com a NFS-e Nacional [OFICIAL]
- Planilha oficial "municípios aderentes", de 10/11/2026
  (https://www.gov.br/nfse/pt-br/municipios/monitoramento-adesoes/municipios-aderentes-20261110.xlsx), lida linha a
  linha: **IMPERATRIZ (CNPJ 06.158.455/0001-16): Conveniado Ativo · Ambiente Nacional = Sim · Emissor Nacional = Sim ·
  MAN = Sim · Ativo na base = Sim · Ativo no último período = Sim.**
- **Desde quando:** Decreto Municipal nº 105/2025. O modelo nacional vale em Imperatriz **a partir de 01/01/2026**,
  com emissão pelo Emissor Nacional. O decreto mantém o Decreto 114/2021 no que não conflitar. Fontes: FAQ da Prefeitura
  (https://sti.imperatriz.ma.gov.br/media/portal/files/page/faq/faq_nfse_imperatriz_sefazgo.pdf) [OFICIAL — trecho] e
  notícia da Prefeitura (https://imperatriz.ma.gov.br/noticias/prefeitura-de-imperatriz-disponibiliza-novos-atalhos-e-manuais-da-nfs-e-nacional-para-contribuintes.html).
- **Simples Nacional:** pela Resolução CGSN nº 191/2026, ME/EPP do Simples são obrigadas ao padrão nacional desde
  **01/11/2026**. Ela revogou a Res. CGSN 189/2026, que previa 01/09/2026 (fontes secundárias:
  https://www.contadores.cnt.br/noticias/tecnicas/2026/10/28/simples-nacional-devera-adotar-emissor-nacional-da-nfs-e-a-partir-de-1o-de-novembro-de-2026.html)
  [NÃO CONFIRMADO no texto da resolução].
- **Como o sistema lê a alíquota oficial sem depender de lei:** a API da Sefin Nacional tem
  `GET /parametros_municipais/{codigoMunicipio}/aliquotas` (alíquotas, regimes especiais e deduções por subitem) e
  `.../retencoes` (Manual de integração, item 14.2.2 [OFICIAL]). É **a mesma parametrização que valida a nota**. Ela
  exige o certificado A1 da empresa (mTLS): testei sem certificado e a resposta foi 403. **Recomendação: a S-4 chama
  essa API com o certificado do cofre e grava a alíquota oficial por município e código. As alíquotas deste documento
  ficam só como valor inicial.**

---

## 2. Canaã dos Carajás-PA (IBGE 1502152) e Parauapebas-PA (IBGE 1505536)

Por que importam: o **ISS da obra (7.02/7.05) é devido no local da obra** (LC 116, art. 3º, III e V, e aba
"MUN.INCID" do Anexo I da NFS-e [OFICIAL]). A filial da Efficaz fica em Canaã. Os demais itens (17.xx, 28.01, 7.01)
pagam no **estabelecimento do prestador**: a filial de Canaã paga a Canaã, e a matriz de Imperatriz paga a Imperatriz.

### 2.1 Canaã dos Carajás

| Tema | O que achei | Marca |
|---|---|---|
| Lei | Código Tributário do Município (texto em Leis Municipais: https://leismunicipais.com.br/codigo-tributario-canaa-dos-carajas-pa, bloqueado) | [NÃO CONFIRMADO] |
| Alíquota geral | **5%**, pela Lei Municipal nº 053/2003, que subiu de 3% para 5% a partir de 01/2004 (art. 4º, parágrafo único). Fonte: imprensa local (https://www.zedudu.com.br/a-decisao-que-transformou-a-arrecadacao-de-canaa-dos-carajas/ e https://carajasojornal.com.br/lei-no-053-2003-a-decisao-historica-que-transformou-a-arrecadacao-de-canaa-dos-carajas/) | [NÃO CONFIRMADO]. Confiança: média |
| 7.02 / 17.01 / 17.12 / 28.01 por item | Nenhuma fonte deu alíquota por item. Sem lei específica, vale a geral: **5%** provável | [NÃO CONFIRMADO] |
| Dedução de materiais | Não achei regra municipal. Vale a LC 116, art. 7º, §2º, I, mais a parametrização do município no Emissor Nacional | [NÃO CONFIRMADO] |
| Retenção | Não achei a lei municipal. Vale no mínimo a LC 116, art. 6º, §2º, II (empresa tomadora de 7.02/7.05 retém) | [NÃO CONFIRMADO] |
| NFS-e Nacional | Planilha oficial de 10/11/2026: **Conveniado Ativo · Ambiente Nacional Sim · Emissor Nacional Sim · MAN Não · Ativo Sim** (CNPJ 01.613.321/0001-24) [OFICIAL]. Integração concluída em 12/2025, emissão **obrigatória pelo Portal Nacional desde 01/11/2026**, inclusive para o Simples (https://notagateway.com.br/blog/emissor-nacional-de-nfs-e-sera-obrigatorio-em-canaa-dos-carajas-pa-a-partir-de-novembro-de-2026/ e https://www.gazetacarajas.com/noticia/canaa-dos-carajas-adota-emissor-nacional-de-nfs-e) | Convênio [OFICIAL]; data [NÃO CONFIRMADO] |

### 2.2 Parauapebas

| Tema | O que achei | Marca |
|---|---|---|
| Lei | **Lei Ordinária nº 4.296, de 19/12/2005** (Código Tributário), no SAPL da Câmara: https://sapl.parauapebas.pa.leg.br/ta/66/text | [OFICIAL — trecho] |
| Alíquota | **5% para todos os serviços da lista do Anexo I**, o 7.02 incluído, pelo trecho da lei no SAPL | [OFICIAL — trecho]. Não confirmei que não houve alteração depois |
| Dedução de materiais (7.02/7.05) | A lei prevê excluir da base "o valor dos materiais fornecidos pelo prestador dos serviços previstos nos itens 7.02 e 7.05 da lista do Anexo I", com nota fiscal de saída. Pelo texto em Leis Municipais, só material produzido fora do local da obra, sujeito a ICMS. Um decreto regulamenta: https://sapl.parauapebas.pa.leg.br/ta/230/text | [OFICIAL — trecho]. Percentual/forma: [NÃO CONFIRMADO] |
| Retenção | Decreto de 2019 no SAPL (https://sapl.parauapebas.pa.leg.br/ta/155/text): retenção na fonte a **5% sobre o valor total** do serviço | [OFICIAL — trecho] |
| NFS-e Nacional | Planilha oficial: **Conveniado Ativo · Ambiente Nacional Sim · Emissor Nacional Sim · MAN Não · Ativo Sim** (CNPJ 22.980.999/0001-15) [OFICIAL]. Emissão **exclusiva pelo Emissor Nacional desde 22/12/2025**, comunicado da Prefeitura: https://parauapebas.pa.gov.br/destaque/emissao-de-notas-fiscais-a-partir-de-22-de-dezembro-de-2025/ | [OFICIAL — trecho] |

---

## 3. Simples Nacional — tabelas para o sistema calcular (LC 123/2006, redação da LC 155/2016, vigente em 2026)

**Fonte da lei:** LC 123/2006, Anexos III, IV e V (https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm), **não
aberta nesta sessão**. Conferência: e-Auditoria (https://www.e-auditoria.com.br/blog/tabela-simples-nacional/ e
https://www.e-auditoria.com.br/blog/anexo-iv-do-simples-nacional/), Contabilizei
(https://www.contabilizei.com.br/contabilidade-online/anexo-3-simples-nacional/), Qipu
(https://qipu.com.br/simples-nacional/anexo-3/) e Calculadora Contábil
(https://www.calculadoracontabil.com.br/tabelas/simples-nacional/anexo-iii). Toda linha de repartição abaixo foi somada
e dá 100,00%. **Marca geral da seção: [NÃO CONFIRMADO no Planalto], confiança alta.**

> **Atenção, 2027:** a LC 214/2025 reescreve a **repartição** dos anexos a partir de 2027 (PIS/Cofins saem; entram CBS
> e IBS). Existem tabelas "2027–2028", "2029–2032" e "2033 em diante" (ex.: https://mentorfiscal.com.br/tabelas-simples-nacional-2027-2028/,
> e anexos XX a XXII da LC 214 no Senado: https://legis.senado.leg.br/norma/40180341/publicacao/40181123). **O sistema
> deve guardar as tabelas por período de vigência.** As de baixo valem até 31/12/2026. As de 2027 ficam
> [NÃO CONFIRMADO] e são tarefa da próxima pesquisa. Pelo que vi, faixas e alíquotas nominais seguem iguais; muda a
> repartição.

### 3.1 Fórmula (art. 18, §1º, §1º-A e §1º-B)
- **RBT12** = receita bruta dos 12 meses anteriores ao mês de apuração (art. 18, §1º).
- **Alíquota efetiva** = (RBT12 × Alíq. nominal − Parcela a deduzir) ÷ RBT12 (art. 18, §1º-A).
- **Parte de cada tributo** = alíquota efetiva × percentual de repartição da faixa (art. 18, §1º-B).
- **Fator r** = folha de salários dos 12 meses anteriores ÷ RBT12 (art. 18, §5º-J e §24). Folha = salários + pró-labore
  + FGTS + CPP recolhidos (§24). Aluguéis e distribuição de lucros não contam (§26 [NÃO CONFIRMADO o número do §]).
  **r ≥ 28% → Anexo III; r < 28% → Anexo V** (§5º-J e §5º-M).
- **Na NFS-e:** o campo `pTotTribSN` (valor aproximado dos tributos, Lei 12.741/2012) leva a **alíquota nominal** da
  faixa, nunca a efetiva (FAQ NFS-e Nacional v1.4, 18/11/2026, item 20.5 [OFICIAL]:
  `gov.br/nfse`, "Perguntas Frequentes"). O ISS de quem é do Simples **não é destacado** na nota. Ele vai no DAS.
- **Acima de R$ 3,6 milhões (sublimite, LC 123, art. 13-A e art. 19):** o ISS sai do DAS e é pago ao município pela
  alíquota municipal. Por isso a 6ª faixa não tem ISS na repartição.

### 3.1-A Sublimite do ISS: vale a receita do ANO-CALENDÁRIO, não o RBT12 (acréscimo do portão de QA da S-8, 23/11/2026)
**Fontes:** LC 123/2006, arts. 13-A, 19 e 20 (sublimite de R$ 3,6 milhões para ISS/ICMS no DAS) e art. 3º §§ 2º, 10 e 12 (limite
proporcional no ano de início e efeitos do excesso); Res. CGSN 140/2018, arts. 9º a 13 (efeitos da ultrapassagem) e art. 25
(cálculo do ISS de quem tem RBT12 acima de R$ 3,6 milhões sem estar impedido). **[NÃO CONFIRMADO no texto oficial nesta sessão —
conferir com o contador.]**
- **Ano anterior** com receita bruta acima de R$ 3,6 mi → o ISS sai do DAS no ano seguinte inteiro (é pago ao município).
- **Ano em curso** acima de R$ 3,6 mi: excesso de **até 20%** (até R$ 4,32 mi) → efeito só no ano seguinte (o ISS continua no DAS);
  **acima de 20%** → efeito a partir do mês seguinte ao do excesso.
- **Ano de início de atividade:** limite proporcional, R$ 300 mil × meses entre o início e dezembro.
- **RBT12 acima de R$ 3,6 mi sem excesso no ano** → o ISS continua no DAS: percentual de ISS calculado pela alíquota nominal,
  parcela a deduzir e percentual de ISS da **5ª faixa**, limitado a 5%; os federais seguem a 6ª faixa.
- Regra no código: `sublimiteDoIss` e `issNaSextaFaixa` em `shared/fiscal/simples.ts`.

### 3.2 Anexo III — serviços (inclui os do Fator R quando r ≥ 28%)

| Faixa | RBT12 (R$) | Alíq. nominal | Parcela a deduzir (R$) |
|---|---|---|---|
| 1ª | até 180.000,00 | 6,00% | 0 |
| 2ª | 180.000,01 a 360.000,00 | 11,20% | 9.360,00 |
| 3ª | 360.000,01 a 720.000,00 | 13,50% | 17.640,00 |
| 4ª | 720.000,01 a 1.800.000,00 | 16,00% | 35.640,00 |
| 5ª | 1.800.000,01 a 3.600.000,00 | 21,00% | 125.640,00 |
| 6ª | 3.600.000,01 a 4.800.000,00 | 33,00% | 648.000,00 |

| Faixa | IRPJ | CSLL | Cofins | PIS/Pasep | CPP | **ISS** |
|---|---|---|---|---|---|---|
| 1ª | 4,00% | 3,50% | 12,82% | 2,78% | 43,40% | **33,50%** |
| 2ª | 4,00% | 3,50% | 14,05% | 3,05% | 43,40% | **32,00%** |
| 3ª | 4,00% | 3,50% | 13,64% | 2,96% | 43,40% | **32,50%** |
| 4ª | 4,00% | 3,50% | 13,64% | 2,96% | 43,40% | **32,50%** |
| 5ª | 4,00% | 3,50% | 12,82% | 2,78% | 43,40% | **33,50% (*)** |
| 6ª | 35,00% | 15,00% | 16,03% | 3,47% | 30,50% | — (fora do DAS) |

(*) **Teto do ISS na 5ª faixa:** o ISS efetivo máximo é **5%**. A diferença passa, na proporção, aos tributos federais
da mesma faixa. Na prática, quando a **alíquota efetiva passar de 14,92537%** (5% ÷ 33,5%): ISS = 5,00%, e o excedente
(alíq. efetiva − 5%) se divide em IRPJ 6,02%, CSLL 5,26%, Cofins 19,28%, PIS 4,18% e CPP 65,26% (soma 100%).

### 3.3 Anexo IV — construção (§5º-C), CPP **fora** do DAS

| Faixa | RBT12 (R$) | Alíq. nominal | Parcela a deduzir (R$) |
|---|---|---|---|
| 1ª | até 180.000,00 | 4,50% | 0 |
| 2ª | 180.000,01 a 360.000,00 | 9,00% | 8.100,00 |
| 3ª | 360.000,01 a 720.000,00 | 10,20% | 12.420,00 |
| 4ª | 720.000,01 a 1.800.000,00 | 14,00% | 39.780,00 |
| 5ª | 1.800.000,01 a 3.600.000,00 | 22,00% | 183.780,00 |
| 6ª | 3.600.000,01 a 4.800.000,00 | 33,00% | 828.000,00 |

| Faixa | IRPJ | CSLL | Cofins | PIS/Pasep | **ISS** |
|---|---|---|---|---|---|
| 1ª | 18,80% | 15,20% | 17,67% | 3,83% | **44,50%** |
| 2ª | 19,80% | 15,20% | 20,55% | 4,45% | **40,00%** |
| 3ª | 20,80% | 15,20% | 19,73% | 4,27% | **40,00%** |
| 4ª | 17,80% | 19,20% | 18,90% | 4,10% | **40,00%** |
| 5ª | 18,80% | 19,20% | 18,08% | 3,92% | **40,00% (*)** |
| 6ª | 53,50% | 21,50% | 20,55% | 4,45% | — (fora do DAS) |

(*) **Teto do ISS na 5ª faixa:** quando a **alíquota efetiva passar de 12,5%** (5% ÷ 40%): ISS = 5,00%, e o excedente
(alíq. efetiva − 5%) se divide em IRPJ 31,33%, CSLL 32,00%, Cofins 30,13% e PIS 6,54% (soma 100%). Uma fonte secundária
(Saipos) mostra "40,50%" na 1ª faixa. É erro de digitação: com 40,50% a linha soma 96%, e com 44,50% soma 100%.

**CPP (INSS patronal) no Anexo IV:** não está no DAS. É paga à parte, 20% + RAT sobre a folha (LC 123, art. 18,
§5º-C; IN RFB 2.110/2022, art. 164, §1º, por fonte secundária). O sistema **não pode** tratar a alíquota do DAS do
Anexo IV como custo total.

### 3.4 Anexo V — serviços do §5º-I quando r < 28%

| Faixa | RBT12 (R$) | Alíq. nominal | Parcela a deduzir (R$) |
|---|---|---|---|
| 1ª | até 180.000,00 | 15,50% | 0 |
| 2ª | 180.000,01 a 360.000,00 | 18,00% | 4.500,00 |
| 3ª | 360.000,01 a 720.000,00 | 19,50% | 9.900,00 |
| 4ª | 720.000,01 a 1.800.000,00 | 20,50% | 17.100,00 |
| 5ª | 1.800.000,01 a 3.600.000,00 | 23,00% | 62.100,00 |
| 6ª | 3.600.000,01 a 4.800.000,00 | 30,50% | 540.000,00 |

| Faixa | IRPJ | CSLL | Cofins | PIS/Pasep | CPP | **ISS** |
|---|---|---|---|---|---|---|
| 1ª | 25,00% | 15,00% | 14,10% | 3,05% | 28,85% | **14,00%** |
| 2ª | 23,00% | 15,00% | 14,10% | 3,05% | 27,85% | **17,00%** |
| 3ª | 24,00% | 15,00% | 14,92% | 3,23% | 23,85% | **19,00%** |
| 4ª | 21,00% | 15,00% | 15,74% | 3,41% | 23,85% | **21,00%** |
| 5ª | 23,00% | 12,50% | 14,10% | 3,05% | 23,85% | **23,50%** |
| 6ª | 35,00% | 15,50% | 16,44% | 3,56% | 29,50% | — (fora do DAS) |

O Anexo V não tem a regra do teto: a maior alíquota efetiva da 5ª faixa é 21,275%, e 21,275% × 23,5% = 4,9996%, abaixo
de 5%.

### 3.5 Exemplos para o teste automático (conferidos à mão)

| Caso | Conta | Alíq. efetiva | ISS dentro do DAS |
|---|---|---|---|
| Obra, Anexo IV, RBT12 R$ 500.000 | (500.000 × 10,2% − 12.420) ÷ 500.000 | **7,7160%** | 7,7160% × 40% = **3,0864%** |
| Serviço, Anexo III, RBT12 R$ 500.000 | (500.000 × 13,5% − 17.640) ÷ 500.000 | **9,9720%** | 9,9720% × 32,5% = **3,2409%** |
| Serviço, Anexo V, RBT12 R$ 500.000 | (500.000 × 19,5% − 9.900) ÷ 500.000 | **17,5200%** | 17,52% × 19% = **3,3288%** |
| Anexo III, 5ª faixa, RBT12 R$ 3.000.000 | (3.000.000 × 21% − 125.640) ÷ 3.000.000 | **16,8120%** (> 14,92537%) | **5,0000%**; IRPJ = 11,812% × 6,02% = 0,7111% |
| Anexo IV, 5ª faixa, RBT12 R$ 2.000.000 | (2.000.000 × 22% − 183.780) ÷ 2.000.000 | **12,8110%** (> 12,5%) | **5,0000%**; IRPJ = 7,811% × 31,33% = 2,4472% |
| Fator r | folha 12m R$ 150.000 ÷ RBT12 R$ 500.000 | r = 30% | ≥ 28% → **Anexo III** |

---

## 4. Enquadramento de cada serviço da Prospecta (CNPJ 41.865.900/0001-89, Simples desde 07/05/2021)

Códigos cAtvSN lidos agora no **Anexo VIII da NFS-e** (v01.02.00, 26/10/2026 [OFICIAL]:
https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/anexo_viii-tabela-correlacao-v01-02-00-20261026.xlsx):
7 = só Anexo III; 8 = contábil com ISS fixo (Anexo III); 9 = Fator R (III ou V); 12 = construção 7.02/7.05 no
Anexo III; 13 = construção 7.02/7.05 no Anexo IV; 14 = serviço no Anexo IV; IMP = impeditiva.

Os incisos do §5º-I abaixo seguem o texto do Planalto mostrado pela busca. A Res. CGSN 135/2017 numera alguns
diferente, então confira o número do inciso no texto vigente.

| Serviço | Item LC 116 | cAtvSN (Anexo VIII) | Anexo | Base na LC 123, art. 18 |
|---|---|---|---|---|
| Assessoria/BPO, parte financeira/gestão | 17.12 | **9** (NBS 1.1001.11.00 e demais do 17.12) | **V, ou III se r ≥ 28%** | **§5º-I, IX** ("auditoria, economia, consultoria, gestão, organização, controle e administração"), com §5º-J/§5º-M |
| Assessoria/BPO, parte contábil (se separar) | 17.19 | **7** (ou **8** se o município der ISS fixo) | **III** | **§5º-B, XIV** (escritórios de serviços contábeis), com §§22-B e 22-C |
| Recebimento de obra / empreitada | 7.02 | **13** (NBS 1.0101.11.00 e 1.0105.50.00). Algumas NBS dão 12, ex. 1.0105.40.00 | **IV** (CPP fora do DAS) | **§5º-C, I** ("construção de imóveis e obras de engenharia em geral, inclusive sob a forma de subempreitada…") |
| Reforma/reparo (alternativo) | 7.05 | **13** (1.0101.11.00, 1.0107.90.00); **12** para pintura (1.0107.30.00) | **IV** (ou III quando cAtvSN 12) | §5º-C, I (obra); o Anexo III cabe em instalação/reparo/manutenção em geral (§5º-B, IX) |
| Regularização e despachante | 17.01 | **9** | **V, ou III se r ≥ 28%** | **§5º-I, V** ("serviços de comissaria, de despachantes, de tradução e de interpretação"); a parte de assessoria entra no §5º-I, IX |
| Regularização, parte técnica (alternativo) | 7.01 | **9** | V/III | §5º-I, VI (arquitetura, engenharia, medição, cartografia, topografia…) |
| Avaliação de imóvel | 28.01 | **9** | **V, ou III se r ≥ 28%** | **§5º-I, VIII** ("perícia, leilão e avaliação") |
| Laudo (alternativo) | 17.09 | **9** | V/III | §5º-I, VIII |
| Comissão de correspondente bancário/imobiliário | 17.01 | **9** | **V, ou III se r ≥ 28%** | **§5º-I, VII** ("representação comercial e demais atividades de intermediação de negócios e serviços de terceiros"). [NÃO CONFIRMADO]: fontes não oficiais citam Anexo III sem Fator R para o CNAE 6619-3/02 (ver CODIGOS-SERVICO.md, seção 3). Vale o que o contador declarar no PGDAS-D, e o cAtvSN tem que bater com isso |

Notas:
1. **Fator R é da empresa, não da nota.** Todo serviço com cAtvSN 9 da Prospecta cai no mesmo anexo no mês (III ou V),
   conforme o r dos 12 meses anteriores. O sistema calcula r por mês e mostra o resultado.
2. **Mesmo RBT12 para todos os anexos:** a faixa é definida pela receita total da empresa (todos os serviços somados).
   Cada receita usa a tabela do seu anexo (art. 18, §3º e §4º).
3. **Comissão de correspondente e as Efficaz:** as Efficaz estão **fora do Simples** hoje (REGIME-TRIBUTARIO.md). Para
   elas, a nota vai **sem cAtvSN** (proibido para não optante), e o ISS é o da prefeitura: Imperatriz para a matriz,
   Canaã para a filial 0002-63, 5% provável nos dois (seções 1.2 e 2.1).

---

## 5. Quadro final

| Tipo de serviço | Item LC 116 | cAtvSN | Anexo do Simples | ISS Imperatriz (quem não é do Simples) | Observações |
|---|---|---|---|---|---|
| Assessoria / BPO | **17.12** (contábil: 17.19) | **9** (17.19: 7) | V, ou III se r ≥ 28% (17.19: III) | **5%** [NÃO CONFIRMADO; secundária, confiança média] | ISS no estabelecimento do prestador. Sem retenção pela lei nacional. LC 123 §5º-I, IX (17.19: §5º-B, XIV) |
| Recebimento de obra / empreitada | **7.02** (reforma: 7.05) | **13** (12 em algumas NBS) | **IV**, CPP fora do DAS | **[NÃO CONFIRMADO]**; pode ser < 2% (exceção do art. 8º-A, §1º); 5% se seguir a regra geral | ISS **no local da obra**: Canaã 5% e Parauapebas 5% para não optante. Dedução de materiais: Imperatriz até 40% simplificado (Dec. 35/2018, vigência não confirmada); Parauapebas prevista em lei; no Simples, não abater sem o contador. Empresa tomadora retém (LC 116 art. 6º §2º II; Imperatriz Dec. 085/2020); pessoa física não retém. LC 123 §5º-C, I |
| Regularização e despachante | **17.01** (técnica: 7.01) | **9** | V, ou III se r ≥ 28% | **5%** [NÃO CONFIRMADO; secundária] | Estabelecimento do prestador. LC 123 §5º-I, V (e IX) |
| Avaliação de imóvel | **28.01** (alt.: 17.09) | **9** | V, ou III se r ≥ 28% | **5%** [NÃO CONFIRMADO; secundária, confiança média-baixa] | Estabelecimento do prestador. Não usar 15.18 (impeditivo no Simples). LC 123 §5º-I, VIII |
| Comissão de correspondente bancário/imobiliário | **17.01** | **9** | V, ou III se r ≥ 28% ([NÃO CONFIRMADO]: alguns citam III direto) | **5%** [NÃO CONFIRMADO; notas antigas da Efficaz: 4% a 5%] | As Efficaz estão fora do Simples: nota sem cAtvSN, ISS municipal (matriz Imperatriz, filial Canaã 5%). LC 123 §5º-I, VII |

**Município conveniado à NFS-e Nacional [OFICIAL, planilha de 10/11/2026]:** Imperatriz (desde 01/01/2026, Dec.
105/2025), Parauapebas (exclusivo desde 22/12/2025) e Canaã dos Carajás (obrigatório desde 01/11/2026). Os três estão
como "Conveniado Ativo" e usam o Emissor Nacional.

## 6. Próximo passo (para quem continuar)

1. **S-4 / desenvolvimento:** chamar `GET /parametros_municipais/{2105302|1502152|1505536}/aliquotas` e `/retencoes`
   com o certificado da empresa (Produção Restrita primeiro). Gravar a alíquota e a regra de dedução **oficiais** por
   município e código, e trocar os [NÃO CONFIRMADO] deste quadro pelo resultado. É o caminho mais rápido e confiável,
   porque a API devolve a mesma regra que valida a nota.
2. **Rede:** liberar planalto.gov.br, camara.leg.br, novo.imperatriz.ma.gov.br, camaraimperatriz.ma.gov.br,
   sapl.parauapebas.pa.leg.br e leismunicipais.com.br para ler o anexo de alíquotas do CTMI, os Decretos 35/2018 e
   085/2020 completos, e as tabelas do Simples 2027 (LC 214).
3. **Sistema:** guardar as tabelas do Simples por período de vigência (até 2026; 2027–2028; …) e calcular o r todo mês.
4. **Paridade (CLAUDE.md):** as tabelas do Simples e as regras de cálculo valem igual para o Grupo Santa Fé. As
   alíquotas municipais dependem da cidade de lá (não pesquisada aqui).

---
Fontes oficiais lidas: planilha de municípios aderentes (gov.br/nfse, 10/11/2026), Anexo VIII v01.02.00 (gov.br/nfse,
26/10/2026), FAQ NFS-e v1.4 (18/11/2026) e Manual de integração/API (parâmetros municipais), todos baixados de
www.gov.br/nfse nesta sessão. Os demais links estão citados linha a linha acima.
