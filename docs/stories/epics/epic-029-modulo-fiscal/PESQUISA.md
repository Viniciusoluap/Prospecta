# EPIC-029 — Pesquisa (fontes e o que NÃO foi confirmado)

**1ª rodada (22/11/2026, manhã):** a rede bloqueou `www.gov.br`, `brasilapi.com.br` e `viacep.com.br`; ficou quase tudo
[NÃO CONFIRMADO].
**2ª rodada (22/11/2026, tarde) — esta versão:** `www.gov.br`, `brasilapi.com.br` e `viacep.com.br` liberados. Foram
**baixados e lidos** os documentos oficiais do Portal NFS-e (manuais, anexos I/II/IV em planilha, esquemas XSD, NT 007,
008 e 009, Perguntas Frequentes v1.4). **Continuam bloqueados pela política de rede da sessão** (proxy responde 403): os
hosts `*.nfse.gov.br` (Swagger da Sefin e do ADN), os sites das prefeituras (`imperatriz.ma.gov.br`,
`parauapebas.pa.gov.br`), `servicodados.ibge.gov.br` e a calculadora (`consumo.tributos.gov.br`,
`piloto-cbs.tributos.gov.br`). O que dependia deles segue [NÃO CONFIRMADO], com o motivo.

Regra (Constituição, Artigo IV): o que não foi confirmado está escrito **[NÃO CONFIRMADO]** e precisa ser conferido antes
de virar código — na S-4, com o Swagger da produção restrita aberto com o certificado do dono.

Legenda: **[OFICIAL]** = lido no documento oficial citado; **[TERCEIROS]** = só projeto aberto/blog; **[NÃO CONFIRMADO]**.

## 0. Documentos oficiais lidos (URLs exatas)

| Sigla | Documento | URL |
|---|---|---|
| APIS | Página "APIs – Prod. Restrita e Produção" (atualizada 20/08/2026) | https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao |
| MAN-API | Manual dos Contribuintes — APIs do Emissor Público Nacional (Sefin), v1.2 out/2025 | https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-emissor-publico-api-sistema-nacional-nfs-e-v1-2-out2025.pdf |
| MAN-ADN | Manual dos Contribuintes — APIs do ADN, v1.0 12/02/2026 | https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-apis-adn-sistema-nacional-nfse.pdf |
| MANINT | Manual Integrado do Sistema Nacional NFS-e v1.00.02 (set/2022, seção "leiautes antigos" — único texto oficial com o padrão de assinatura e o limite de 50 por lote) | https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/leiaute-e-esquemas-antigos/manualintegradosnnfse_v1-00-02-producao.pdf |
| XSD-P | Esquemas XSD de **produção** v1.01 (09/02/2026) | https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/nfse-esquemas_xsd-v1-01-20260209.zip |
| XSD-PR | Esquemas XSD de **produção restrita** v1.01 (20/10/2026) | https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita/esquemas_prod_restrita_20261020.zip |
| AI-P | Anexo I (leiaute + regras DPS/NFS-e), produção, 09/02/2026 | https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/anexo_i-sefin_adn-dps_nfse-snnfse-v1-01-20260209.xlsx |
| AI-PR | Anexo I, produção restrita, 20/10/2026 | https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita/anexo_i-sefin_adn-dps_nfse-snnfse_prodrest-v1-01-20261020.xlsx |
| AII-PR | Anexo II (eventos), produção restrita, 20/10/2026 (produção: `.../documentacao-atual/anexo_ii-sefin_adn-pedregevt_evt-snnfse-v1-01-20260122.xlsx`) | https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita/anexo_ii-sefin_adn-pedregevt_evt-snnfse_prodrest-v1-01-20261020.xlsx |
| AIV | Anexo IV (ADN — recepção e distribuição), 16/12/2025 | https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/anexo_iv-adn-snnfse-v1-00-20251216.xlsx |
| NT009 | Nota Técnica 009 v1.01 (11/09/2026) — RTC/IBS-CBS, CNPJ alfanumérico | https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/nota-tecnica-009-se-cgnfs-e-v-1-01.pdf |
| NT008 | Nota Técnica 008 v1.02 (14/07/2026) — DANFSe | https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/nt-008-se-cgnfse-danfse-20260714-v1-02.pdf |
| IMPL | Página "Atualizações e implantações" (atualizada 18/11/2026) | https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/atualizacoes-e-implantacoes |
| FAQ | Perguntas Frequentes NFS-e v1.4 (18/11/2026) | https://www.gov.br/nfse/pt-br/perguntas-frequentes/perguntas-frequentes-nfs-e-v1-4-20261118.pdf |
| ADES | Monitoramento das adesões | https://www.gov.br/nfse/pt-br/municipios/monitoramento-adesoes |

## 1. Endereços e caminhos da API

### 1.1 Endereços (Swagger oficiais listados em APIS) — [OFICIAL]

| API | Produção restrita (testes) | Produção |
|---|---|---|
| Sefin Nacional (emissão a partir da DPS, eventos) | Swagger `https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional/docs/index` | Swagger `https://sefin.nfse.gov.br/SefinNacional/docs/index` |
| ADN — contribuintes (distribuição, eventos) | `https://adn.producaorestrita.nfse.gov.br/contribuintes/docs/index.html` | `https://adn.nfse.gov.br/contribuintes/docs/index.html` |
| ADN — DANFSe (suspensa, ver 1.6) | `https://adn.producaorestrita.nfse.gov.br/danfse/docs/index.html` | `https://adn.nfse.gov.br/danfse/docs/index.html` |
| ADN — parâmetros municipais | `https://adn.producaorestrita.nfse.gov.br/parametrizacao/docs/index.html` | `https://adn.nfse.gov.br/parametrizacao/docs/index.html` |

**Base das chamadas (dedução):** pelo caminho dos Swagger, a base da Sefin seria
`https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional` (produção restrita — **com** `/API`) e
`https://sefin.nfse.gov.br/SefinNacional` (produção — **sem** `/API`). Um projeto de terceiros (rustnf) usa
`https://sefin.producaorestrita.nfse.gov.br/SefinNacional` para a produção restrita — **divergente**.
**[NÃO CONFIRMADO]** a base exata: o Swagger está em `*.nfse.gov.br`, bloqueado nesta sessão. Na S-4, deixar a base em
configuração por ambiente e conferir no Swagger antes do 1º envio. ADN contribuintes: base
`https://adn[.producaorestrita].nfse.gov.br/contribuintes` (os métodos do MAN-ADN ficam sob esse prefixo) — consistente com
o projeto akretion/nfelib (TERCEIROS).

### 1.2 Métodos da Sefin Nacional — [OFICIAL, MAN-API §1.2–1.5]

| Método | Para quê |
|---|---|
| `POST /nfse` | Emissão **síncrona**: recebe a DPS, valida e devolve o XML da NFS-e ou a rejeição. Se a DPS traz `subst/chSubstda`, gera junto o evento de cancelamento por substituição da nota original. |
| `GET /nfse/{chaveAcesso}` | Consulta a NFS-e pela chave. |
| `GET /dps/{id}` | Devolve a chave da NFS-e gerada a partir da DPS (só para prestador/tomador/intermediário pelo certificado). **Base da idempotência.** |
| `HEAD /dps/{id}` | Só diz se a DPS já gerou NFS-e (qualquer certificado válido). |
| `POST /nfse/{chaveAcesso}/eventos` | Registro de evento (cancelamento etc.). **Resolve a divergência da 1ª rodada: o caminho é este.** |
| `GET /nfse/{chaveAcesso}/eventos[/{tipoEvento}[/{numSeqEvento}]]` | Consulta de eventos. (Um projeto de terceiros relata que na prática a listagem sem tipo/sequência responde 404 — usar a forma com tipo e sequência; [NÃO CONFIRMADO]). |
| `GET /parametros_municipais/{codigoMunicipio}/convenio` e `/{codigoMunicipio}/{codigoServico}` e `/{codigoMunicipio}/{CPF/CNPJ}` | Convênio do município, alíquotas/regimes por subitem, retenções e benefícios do contribuinte. |

**Nomes dos campos JSON** (o manual só diz "mensagens em JSON; XML compactado GZip em base64binary" — MANINT §6.1.1-c):
`{"dpsXmlGZipB64": "..."}` no `POST /nfse`, resposta com `chaveAcesso` e `nfseXmlGZipB64`; `{"pedidoRegistroEventoXmlGZipB64":
"..."}` no evento, resposta com `eventoXmlGZipB64` — **[TERCEIROS]**, iguais em dois projetos independentes
(https://github.com/akretion/nfelib — `nfelib/nfse/client/v1_0/nfse.py`; https://github.com/nfse-nacional/nfse-php —
`src/Http/Client/SefinClient.php`). Nome exato **[NÃO CONFIRMADO no Swagger]** (bloqueado).

### 1.3 ADN — distribuição — [OFICIAL]

- `GET /DFe/{NSU}` e `GET /NFSe/{ChaveAcesso}/Eventos` (MAN-ADN §1.1.1). Devolve documentos em que o CNPJ é **emitente,
  tomador ou intermediário**; aceita certificado com o **mesmo CNPJ raiz**, e há um parâmetro para informar o CNPJ
  consultado diferente do CNPJ do certificado (MAN-ADN §1.1). Nome do parâmetro: `cnpjConsulta`, e `lote=true` para pedir
  o lote — **[TERCEIROS]** (nfelib).
- **Até 50 documentos por chamada**, em ordem crescente de NSU, devolvendo o último NSU para a próxima chamada
  (MANINT §17.2.2; FAQ 19.2). **Confirmado o limite de 50.**
- **Quando não há documento novo** (NSU informado = maior NSU disponível): **esperar no mínimo 1 hora** antes de nova
  consulta (FAQ 19.2 e tema 6). A S-5 precisa guardar `ultima_consulta_em` e respeitar isso no cron.
- A ordem é a de **recepção no ADN**, não a de emissão (FAQ 19.2). Erros: E2215 (nada a partir do NSU), E2230, E2240,
  E2241 (AIV, planilha ADN-RN_DISTRIB_MUN_CONTRIB).
- Ambiente de testes do ADN existe para contribuintes (FAQ 19.5).

### 1.4 Chave de acesso e identificadores — [OFICIAL, XSD-PR `tiposSimples_v1.01.xsd`; FAQ 18.x]

- **Chave: 50 posições**; `Id` da NFS-e = "NFS" + 50 = 53. Composição: Cód. município (7) + ambiente gerador (1) + tipo de
  inscrição (1) + inscrição federal (14) + nº da NFS-e (13) + AAMM da emissão (4) + código numérico (9) + DV (1).
- **Atenção (CNPJ alfanumérico):** o padrão do XSD é `[0-9]{6}([0-9A-Z]{14})[0-9]{30}` — as 14 posições da inscrição
  **podem ter letras**. O FAQ diz "50 dígitos numéricos", mas o XSD já aceita letras. **Consequência para a S-5:** o CHECK
  `^[0-9]{50}$` em `obra_notas.chave_acesso` está errado; usar `^[0-9]{44}$|^[0-9]{6}[0-9A-Z]{14}[0-9]{30}$`.
- **Id da DPS (45):** "DPS" + município (7) + tipo de inscrição (1: CPF, 2: CNPJ) + inscrição (14; CPF com zeros à
  esquerda) + série (5) + número (15). Padrão: `DPS[0-9]{7}(1[0-9]{14}|2[0-9A-Z]{14})[0-9]{20}`. Confirmado.
- **Série:** `[0-9]{1,4}|[0-8][0-9]{4}`; faixa **00001–49999 para aplicativo próprio** (API) — regra E0010 (AI-PR).
  50000–69999 móvel, 70000–79999 web, 80000–89999 transcrição manual. Confirmado.
- **Número da DPS:** `[1-9][0-9]{0,14}` (sem zero à esquerda). Numeração já usada **nunca** pode ser reutilizada, nem em
  contingência (FAQ 18.5 — Decreto 12.955, art. 124, §3º): reforça a reserva com `FOR UPDATE` + consulta `GET /dps/{id}`
  antes de reenviar.

### 1.5 Cancelamento (evento) — [OFICIAL, AII-PR; XSD-PR `tiposEventos_v1.01.xsd`]

- **Código 101101** (elemento `e101101`, "Cancelamento de NFS-e"), autor = emitente, **assinatura obrigatória**, recebido
  pelo sistema que gerou a NFS-e (Sefin Nacional), evento único (`nSeqEvento` = 001).
- Campos específicos: `xDesc` ("Cancelamento de NFS-e"), **`cMotivo`** (1 = erro na emissão; 2 = serviço não prestado;
  9 = outros) e `xMotivo` (justificativa).
- Pedido: elemento `pedRegEvento`/`infPedReg` com `Id` = "PRE" + chave (50) + tipo do evento (6) + nº do pedido (3);
  `tpAmb`, `verAplic`, `dhEvento`, `CNPJAutor` (raiz igual à do certificado — E0812), `chNFSe`, e o grupo `e101101`.
- Outros códigos úteis: 105102 (cancelamento por substituição — gerado pela Sefin), 101103 (solicitação de análise fiscal
  para cancelar fora do prazo), 105104/105105 (deferido/indeferido pelo município), 305101 (cancelamento de ofício).

### 1.6 DANFSe — [OFICIAL, NT008 §1; IMPL 03/08/2026; FAQ 17.8]

**Mudança importante:** a API de geração do DANFSe do ADN **foi suspensa em 03/08/2026**. Desde então **cabe ao sistema
emissor gerar o PDF** a partir do XML, seguindo a NT 008 (uma página; em produção restrita, a frase "NFS-e SEM VALIDADE
JURÍDICA" no cabeçalho). **Consequência para a S-4 item 7:** não há PDF oficial para baixar; o Prospecta precisa gerar o
DANFSe (a Receita publicou um gerador aberto na organização https://github.com/ReceitaFederal — avaliar licença e linguagem
antes de usar [NÃO CONFIRMADO]).

## 2. Autenticação e formato — [OFICIAL]

- **mTLS** (autenticação mútua TLS) com certificado ICP-Brasil, comunicação REST/JSON (MANINT §6.1.2 e §6.2.4).
  Requisitos do certificado de transmissão (AI-PR, planilha RN_RECEP_DPS, E1200–E1209): X.509 v3, não pode ser de AC,
  KeyUsage com **Autenticação de Cliente**, válido, cadeia ICP-Brasil, **LCR acessível** (E1206), extensão de CNPJ
  (OtherName OID 2.16.76.1.3.3) ou CPF. Tipo **A1 ou A3**; e-CNPJ da RFB é aceito (FAQ 17.1).
- **Certificado de assinatura** (E0714–E0718): KeyUsage **Assinatura Digital + Não Recusa**; deve ser do **emitente da DPS**
  (ou de procurador com procuração eletrônica na Receita — FAQ 17.7). O mesmo A1 do emissor serve para os dois papéis.
- **Sem OAuth nem chave de API**; cabeçalhos especiais **não** aparecem em nenhum documento oficial lido
  ([NÃO CONFIRMADO] além de `Content-Type: application/json`).
- **Corpo:** XML **UTF-8 com declaração** (E1229), **sem prefixo de namespace** (E1228), sem espaços/quebras entre tags nem
  zeros não significativos, compactado **GZip** e em **Base64** dentro do JSON (MANINT §6.1.1-c/d; E1225/E1226).
  Namespace `http://www.sped.fazenda.gov.br/nfse`.
- **Renegociação TLS** pedida pelo servidor: [NÃO CONFIRMADO] (só relato de terceiros) — testar na S-4.

## 3. Leiaute da DPS e assinatura

### 3.1 Versão — [OFICIAL]
- Atributo `versao="1.01"` (tipo aceita `1.00|1.01`; IBS/CBS só a partir de 1.01 — E0854).
- **Produção e produção restrita estão com XSDs diferentes:** produção = v1.01 de 09/02/2026; produção restrita = v1.01 de
  20/10/2026, que já traz a NT 009 (implantada **só na produção restrita** em 20/10/2026 — IMPL): `finNFSe` saiu do grupo
  IBSCBS para `infDPS`; `CST`/`cClassTrib` reposicionados (agora em `IBSCBS/valores/trib`, com `gIBSCBS` facultativo);
  `vDedRed` + `gReeRepRes` fundidos em `vAjusteBC`; `cIndOp` passou a opcional (regra pela calculadora). **Consequência:**
  a DPS que passa na homologação pode não passar na produção até a Receita publicar a NT 009 em produção — o gerador da
  S-4 deve ter as duas variantes (por ambiente) e validar contra o XSD do ambiente de destino. Data da NT 009 em produção:
  **[NÃO CONFIRMADO]** (IMPL não traz).

### 3.2 Campos obrigatórios mínimos de `infDPS` (XSD-PR; "?" = opcional) — [OFICIAL]
`tpAmb` (2 = homologação), `dhEmi` (AAAA-MM-DDThh:mm:ss±hh:mm), `verAplic`, `serie`, `nDPS`, `dCompet` (AAAA-MM-DD),
`tpEmit` (1 = prestador), `finNFSe` (0 = regular; só PR), `cLocEmi` (IBGE do emissor),
`prest` (CNPJ; `regTrib` com `opSimpNac` e `regEspTrib`; ?IM, ?nome/endereço — o prestador é completado pelo cadastro),
?`toma`, `serv` (`locPrest/cLocPrestacao`; `cServ/cTribNac` + `xDescServ`; ?`cNBS`; ?`obra` com `cObra` (CNO) **ou** `cCIB`
**ou** endereço), `valores` (`vServPrest/vServ`; `trib/tribMun` com `tribISSQN` e `tpRetISSQN`; `trib/totTrib`),
?`IBSCBS`. O Anexo I (planilha "MUN.INCID_INFO.SERV.") diz, por código de serviço, quando o grupo `obra` é obrigatório —
consultar para os códigos 07.xx da construção civil.

### 3.3 Assinatura — [OFICIAL, MANINT §6.1.4; FAQ 17.1; AI-PR]
- XML-DSig **enveloped**, dentro da tag que contém o atributo `Id` (`infDPS`, e `infPedReg` no evento); `Reference
  URI="#<Id>"`; transformações **enveloped-signature + C14N** `http://www.w3.org/TR/2001/REC-xml-c14n-20010315`
  (canonicalização **inclusiva**, sem comentários); `CanonicalizationMethod` igual; só o certificado do usuário final em
  `X509Data/X509Certificate` (EndCertOnly); sem LCR no XML.
- **Algoritmo:** o texto oficial (MANINT, 2022) fixa **RSA-SHA1** (`xmldsig#rsa-sha1`) e digest **SHA-1**
  (`xmldsig#sha1`). Projetos de terceiros dizem que a Sefin também aceita RSA-SHA256 — **[NÃO CONFIRMADO no oficial]**.
  **Recomendação:** começar com o que o manual diz (SHA-1, que o `xml-crypto` e o Node aceitam) e, na homologação, testar
  SHA-256; ficar com o que passar, registrando a prova.
- A Sefin rejeita assinatura inválida (E0714), certificado inválido (E0715/E0716), falta de assinatura (E0717) e assinatura
  de quem não é o emitente (E0718).

## 4. Prazo de cancelamento e substituição — [OFICIAL]

- **Não há prazo nacional fixo:** cada município emissor parametriza; **se não definir, o teto é 730 dias (2 anos)**
  (FAQ 9.2). Fora do prazo → rejeição **E0822**; aí o caminho é o evento **101103** (solicitação de análise fiscal), que o
  município defere/indefere (FAQ 9.4). O município também pode limitar o valor (E0823), proibir cancelar nota sem tomador
  (E0824) e com tributo já recolhido (E0827), e bloquear cancelamento por ofício (E0844).
- **Na tela da S-4:** mostrar "prazo definido pela prefeitura (até 2 anos)" e o erro da Sefin quando vier; o prazo real de
  cada município pode ser lido pela API de parâmetros municipais [campo exato NÃO CONFIRMADO — Swagger bloqueado].
- **Substituição** (DPS com `subst/chSubstda` + `cMotivo` 01–05/99 e `xMotivo` obrigatório se 99 — E0078): a Sefin cancela
  a original com o evento 105102 e gera a nova no mesmo `POST /nfse`. Prazo também parametrizado pelo município, **máximo
  2 anos** (E0050; exceto enquadramento/desenquadramento no Simples). Não substitui nota cancelada (E0046), nota com
  manifestação de confirmação (E0070/E0072), nota com análise fiscal pendente (E0068). Em vários regimes não se pode mudar
  competência, código de serviço, local da prestação, tomador ou valor (E0059–E0064). Mudar o tomador → cancelar e emitir
  outra (FAQ 10.3).

## 5. IBS/CBS na NFS-e — [OFICIAL]

- **A Sefin calcula.** O grupo `IBSCBS` da **NFS-e** é "informações **geradas pelo sistema**"; o da **DPS** é
  "informações **declaradas pelo emitente**" (AI-P/AI-PR, linhas 46 e 335). A Sefin "na autorização/geração do documento
  [tem] integração online com a calculadora para validação de campos, verificação de regras e retorno de valores"
  (NT009 p. 22-23); a NFS-e traz `verCalcIBSCBS` (versão da calculadora usada) (NT009 §2.9). Erros da calculadora voltam
  como **E1000** (IMPL 24/04/2026).
- **O emissor informa só a classificação**, não os valores: na DPS (XSD-PR) `IBSCBS` = ?`indFinal`, ?`cIndOp`, ?`tpOper`,
  ?`gRefNFSe`, ?`tpEnteGov`, `indDest`, ?`dest`, ?`imovel`, ?`bensMoveis`, `valores/trib/` **`CST` + `cClassTrib`** e,
  conforme o caso, ?`gIBSCBS` (crédito presumido, diferimento `gDif`, tributação regular `gTribRegular`). Valores de IBS/CBS
  na DPS só existem nas **notas de ajuste** (`gIBSCBSAjuste`, NT009 §2.2) — fora do escopo da S-4.
- **Obrigatoriedade:** permitido a partir da competência 01/01/2026 (E0850); **obrigatório para competência a partir de
  01/10/2026 (E0855)** — regra presente no Anexo I de **produção restrita** (20/10/2026), ausente no de produção
  (09/02/2026): se já vale em produção **[NÃO CONFIRMADO]**. **Optantes do Simples: grupos IBSCBS só obrigatórios a partir
  de 2027** (AI-P/AI-PR). `gIBSCBS` e `cIndOp` obrigatórios só quando o indicador `ind_gIBSCBS` do `cClassTrib` for 1
  (E0960/E0860); proibidos quando 0 (CST 400, 410, 820 — FAQ, tema 15).
- **Calculadora oficial:** online em https://consumo.tributos.gov.br/servico/calcular-tributos-consumo/calculadora/regime-geral ;
  versão offline em código aberto https://consumo.tributos.gov.br/servico/calcular-tributos-consumo/calculadora/calculadora-offline
  (= https://github.com/ReceitaFederal/calculadora-rtc-regime-regular); tabela CST/cClassTrib em
  https://consumo.tributos.gov.br/servico/calcular-tributos-consumo/calculadora/classificacoes-tributarias (NT009 p. 22-23).
  O Anexo I cita a documentação da API em `https://piloto-cbs.tributos.gov.br/servico/calculadora-consumo/calculadora/documentacao`
  e um endereço interno do Serpro (`*.estaleiro.serpro`, não público). **API HTTP pública utilizável: [NÃO CONFIRMADO]** —
  os hosts `consumo.tributos.gov.br` e `piloto-cbs.tributos.gov.br` estão bloqueados nesta sessão; continua valendo a
  observação da 1ª rodada (pacote não oficial `rfbcalc` aponta para a API piloto sem chave).
- **Decisão que isto permite para a S-4:** não hospedar a calculadora. A DPS leva `CST`/`cClassTrib`/`indDest` (e `cIndOp`
  quando exigido) definidos pelo contador por tipo de serviço; os valores de IBS/CBS vêm da NFS-e devolvida e são guardados
  como memória de cálculo. A prévia na tela, se quiserem, fica opcional e desligada.

## 6. Adesão dos municípios

| Município (IBGE, via Brasil API) | Situação | Fonte | Grau |
|---|---|---|---|
| Todos os 5.571 entes | Conveniados à plataforma nacional (convênio = ADN; **não** quer dizer emissão pelo Emissor Nacional) | ADES | [OFICIAL] |
| **Imperatriz-MA (2105302)** | Adotou o modelo nacional desde **01/01/2026** (Decreto nº 105, de 24/12/2025) | decreto e FAQ municipais citados na 1ª rodada (sites da prefeitura bloqueados nesta rodada: 403) | Municipal, não relido; "exclusivamente pelo Emissor Nacional" [NÃO CONFIRMADO] |
| **Parauapebas-PA (1505536)** | Tutorial da prefeitura (dez/2025): a partir de 01/01/2026 o Emissor Nacional é a plataforma oficial; sistema municipal deixa de emitir. Blog: exigência desde 22/12/2025 | https://parauapebas.pa.gov.br/wp-content/uploads/2025/12/Tutorial-NFS-e.pdf (não aberto: 403); https://notagateway.com.br/blog/parauapebas-pa-passa-a-exigir-nfs-e-no-padrao-nacional-a-partir-de-22-de-dezembro-de-2025/ | [TERCEIROS]; data exata [NÃO CONFIRMADO] |
| **Canaã dos Carajás-PA (1502152)** | Convênio concluído com emissão ainda no sistema web municipal; Emissor Nacional **obrigatório a partir de 01/11/2026** | https://notagateway.com.br/blog/canaa-dos-carajas-pa-conclui-adesao-ao-padrao-nacional-da-nfs-e/ ; https://notagateway.com.br/blog/emissor-nacional-de-nfs-e-sera-obrigatorio-em-canaa-dos-carajas-pa-a-partir-de-novembro-de-2026/ | [TERCEIROS]; [NÃO CONFIRMADO no oficial] |
| **Santa Inês-MA (2109908)** | Nenhum decreto encontrado; indícios de emissor municipal próprio | https://nfe.io/docs/prefeituras-integradas/maranhao/santa-ines-ma-2109908/ | **[NÃO CONFIRMADO]** |

**Como confirmar por código na S-4 (fonte oficial, FAQ 19.6):** a API de parâmetros municipais devolve
`aderenteEmissorNacional` (1 = emite pela Sefin Nacional, `ambGer` = 2; 0 = sistema próprio da prefeitura, que depois
compartilha com o ADN) e `situacaoEmissaoPadraoContribuintesRFB` (1 = qualquer CNPJ do município já pode emitir; 0 = a
prefeitura precisa cadastrar cada contribuinte no CNC). Consultar `GET /parametros_municipais/{IBGE}/convenio` para os 4
municípios com o certificado do dono, antes da 1ª emissão, e bloquear a emissão pela API nacional se
`aderenteEmissorNacional = 0`. **Importante:** quem emite é o município do **prestador** (`cLocEmi`, sede da Efficaz/emissor
do grupo); o município da obra entra como local da prestação/incidência — a adesão que decide a S-4 é a do município sede.

## 7. Brasil API e ViaCEP

- **Brasil API — limites:** nenhum número publicado. Termos (README oficial, https://github.com/BrasilAPI/BrasilAPI ,
  seção "Termos de Uso"): "não abuse", **não fazer crawling automatizado**; "o volume de consultas deve ter a natureza de
  uma pessoa real requisitando um determinado dado". Sem chave. O site `brasilapi.com.br/docs` é aplicação JS (não lida).
- **Brasil API — respostas conferidas nesta rodada (chamadas reais):**
  - `GET https://brasilapi.com.br/api/cep/v2/{cep}` → `{cep, state, city, neighborhood, street, service, ibge: {city,
    state}, timezoneName, location}` — **o IBGE vem como objeto `ibge.city`** (ex.: Imperatriz `"2105302"`); CEP sem
    logradouro (65900000) → HTTP **404**. Campo `ibge` depende do provedor (`service`) [presença sempre NÃO CONFIRMADO].
  - `GET https://brasilapi.com.br/api/cnpj/v1/{cnpj}` → campos confirmados: `razao_social`, `nome_fantasia`,
    `descricao_situacao_cadastral`, `situacao_cadastral`, `cnae_fiscal`, `cnae_fiscal_descricao`, `cnaes_secundarios`,
    `codigo_municipio_ibge`, `municipio`, `uf`, `cep`, `logradouro`, `numero`, `complemento`, `bairro`,
    `opcao_pelo_simples`, `opcao_pelo_mei`, `data_opcao_pelo_simples`, `data_exclusao_do_simples`, `regime_tributario`,
    `porte`, `natureza_juridica`, `qsa`, `email`, `ddd_telefone_1` (teste com CNPJ público de banco estatal).
    Cabeçalhos sem limite (`x-ratelimit` ausente).
  - `GET https://brasilapi.com.br/api/ibge/municipios/v1/{UF}` → `[{nome, codigo_ibge}]` (usado para os códigos acima).
- **ViaCEP (https://viacep.com.br/):** gratuito, sem chave; aviso oficial na página: **"Uso massivo para validação de bases
  de dados locais poderá automaticamente bloquear seu acesso por tempo indeterminado."** Busca por endereço limitada a 50
  CEPs. `GET https://viacep.com.br/ws/{cep}/json/` devolve `ibge` (ex.: `"2105302"`); CEP inexistente → HTTP 200 com
  **`{"erro": "true"}` (string, não booleano)** — o código deve aceitar os dois. Limite numérico: não publicado.
- `servicodados.ibge.gov.br` bloqueado nesta sessão (403) — usar a rota de municípios da Brasil API como reserva.

## 8. Calculadora da Receita — repositório (1ª rodada, mantido)

- https://github.com/ReceitaFederal/calculadora-rtc-regime-regular — MIT; Java 25 / Spring Boot, SQLite; rotas
  `POST /api/calculadora/regime-geral`, `POST /api/calculadora/base-calculo/base-calculo-unificada-nfse`, `/xml/generate`,
  `/xml/validate`, `/dados-abertos/...`. Não roda na função Node da Vercel; hospedar à parte é serviço novo (fora do custo
  zero). Com a §5 (Sefin calcula), **não é necessária** para emitir.

## 9. CNPJ alfanumérico — [OFICIAL, NT009 §2.1; XSD-PR]

Todos os campos CNPJ do leiaute passaram de numérico para caractere: `TSCNPJ` = `[0-9A-Z]{14}`; chave e Id da DPS também
(ver §1.4). Data de início citada pela NT: "a partir de julho de 2026". Impacto: validadores e CHECKs do sistema
(DIAGNOSTICO §2) e o CHECK de `chave_acesso` da S-5.

## 10. Assinatura XML e mTLS cabem na função da Vercel?

| Peça | Biblioteca | Licença | Custo | Cabe? |
|------|-----------|---------|-------|-------|
| Ler `.pfx` (inclusive legado RC2/3DES) | `pkijs` 3.4 (já no projeto); alternativa `node-forge` (BSD; RC2 no PKCS#12 [NÃO CONFIRMADO]) | MIT/BSD | 0 | Sim. `https.Agent({ pfx })` no OpenSSL 3 recusa PFX legado → converter para PEM em memória. |
| XML-DSig enveloped, **RSA-SHA1 + C14N inclusiva 20010315** (oficial; SHA-256 a testar) | `xml-crypto` (MIT) + `@xmldom/xmldom` + `xpath` | MIT | 0 | Sim. |
| mTLS | `node:https` com `cert`/`key` PEM e `ca` ICP-Brasil (padrão de `server/_core/inter.ts:60`); nunca `rejectUnauthorized: false` | — | 0 | Sim. Renegociação TLS [NÃO CONFIRMADO]. |
| GZip/Base64 | `node:zlib` | — | 0 | Sim. |
| DANFSe (PDF) | gerar no Prospecta pela NT 008 (API do ADN suspensa) | — | 0 | Sim (PDF de 1 página); biblioteca a escolher na S-4. |

Referência aberta em Node/TS: https://github.com/marciotisouza/nfse-nacional (MIT; usa `rejectUnauthorized: false` — não
adotar).

## 11. O que muda nas stories por causa desta rodada

1. **S-4 item 6:** caminho do cancelamento confirmado (`POST /nfse/{chave}/eventos`, `e101101`, `cMotivo` 1/2/9 +
   `xMotivo`); prazo = do município (padrão 2 anos), erro E0822 → oferecer "pedir análise fiscal" (101103).
2. **S-4 item 7:** **não há DANFSe oficial para baixar** desde 03/08/2026 — gerar o PDF pela NT 008 (com "NFS-e SEM VALIDADE
   JURÍDICA" na homologação).
3. **S-4 item 2:** gerar a DPS nas duas variantes de leiaute (produção 09/02/2026 × produção restrita 20/10/2026) e validar
   contra o XSD do ambiente; grupo IBSCBS = classificação, sem valores.
4. **S-4 item 3:** assinatura RSA-SHA1/C14N inclusiva conforme o manual; testar SHA-256 na homologação.
5. **S-4 (novo passo):** consultar `parametros_municipais/{IBGE}/convenio` do município sede de cada emissor e só liberar a
   emissão pela API nacional com `aderenteEmissorNacional = 1`.
6. **S-5:** CHECK de `chave_acesso` deve aceitar letras nas posições 7–20; distribuição com até 50 por chamada e pausa de
   1 hora quando não há novidade.

## 12. Continua [NÃO CONFIRMADO] (e por quê)

| Item | Motivo | Como fechar |
|---|---|---|
| Base exata da Sefin (com/sem `/API`) | Swagger em `*.nfse.gov.br` bloqueado (403) | Abrir o Swagger na S-4 |
| Nomes dos campos JSON (`dpsXmlGZipB64` etc.) e parâmetros `lote`/`cnpjConsulta` | Idem; só terceiros | Swagger |
| Aceitação de RSA-SHA256 | Oficial só cita SHA-1 | Teste na produção restrita |
| E0855 (IBS/CBS obrigatório desde 01/10/2026) e NT 009 em produção | Só no anexo de produção restrita; IMPL sem data para produção | Acompanhar IMPL |
| API pública da calculadora | Hosts bloqueados | Não é necessária para emitir |
| Adesão de Parauapebas, Canaã e Santa Inês; texto do decreto de Imperatriz | Sites municipais bloqueados; Power BI de adesões não acessível | `parametros_municipais/{IBGE}/convenio` com o certificado |
| Campo do prazo de cancelamento na API de parâmetros | Swagger bloqueado | Swagger |
| Limites numéricos da Brasil API e do ViaCEP | Não publicados | — (cache de 30 dias e consulta por digitação completa) |
