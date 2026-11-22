# EPIC-029 — Pesquisa (fontes e o que NÃO foi confirmado)

Feita em 22/11/2026. **Limite da sessão:** a rede bloqueou `www.gov.br`, `brasilapi.com.br` e `viacep.com.br` (falha de DNS
no ambiente do agente). Os documentos oficiais desses domínios foram **localizados** pela busca (URLs abaixo), mas não lidos
diretamente. O que veio só de terceiros está marcado. Regra (Constituição, Artigo IV): o que não foi confirmado está escrito
**[NÃO CONFIRMADO]** e precisa ser conferido antes de virar código — na etapa 4, com o Swagger da produção restrita aberto
com o certificado do dono.

## 1. API do Sistema Nacional NFS-e (Sefin Nacional e ADN)

**Documentação oficial localizada (não lida nesta sessão):**
- Biblioteca técnica: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica
- Manual dos contribuintes — Emissor Público / API, v1.2 (out/2025):
  https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-emissor-publico-api-sistema-nacional-nfs-e-v1-2-out2025.pdf
- Manual dos contribuintes — APIs do ADN:
  https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-apis-adn-sistema-nacional-nfse.pdf
- Guia do Emissor Público Nacional web (produção restrita) v1.2.1:
  https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita/guia_emissor_publico_nacional_web_snnfse-ern_versao_1-2-1.pdf
- NT 007 (RTC — IBS/CBS na NFS-e): https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/nt-007-se-cgnfse-v1-0.pdf
- Perguntas frequentes v1.2 (27/10/2026): https://www.gov.br/nfse/pt-br/perguntas-frequentes/perguntas-frequentes-nfs-e-v1-2-20261027.pdf

**O que as fontes indicam (cruzando projetos abertos e guias; conferir no oficial):**

| Item | Indicação | Fonte | Situação |
|------|-----------|-------|----------|
| Base Sefin — produção restrita | `https://sefin.producaorestrita.nfse.gov.br/SefinNacional` | https://github.com/Admnwk/rustnf (README, tabela de ambientes) | [NÃO CONFIRMADO no oficial] |
| Base Sefin — produção | `https://sefin.nfse.gov.br/sefinnacional` | idem | [NÃO CONFIRMADO no oficial] |
| ADN contribuintes | `adn.producaorestrita.nfse.gov.br/contribuintes/docs/index.html` e `adn.nfse.gov.br/contribuintes/docs/index.html` (Swagger) | guia de terceiros (notagateway) citado na busca | [NÃO CONFIRMADO] |
| Autenticação | mTLS com certificado ICP-Brasil (A1/A3) do contribuinte; sem OAuth | várias (notagateway; https://github.com/heviane/nfse-nacional-api/issues/6; https://github.com/marciotisouza/nfse-nacional) | Consenso entre fontes; [NÃO CONFIRMADO no oficial] |
| Emitir | `POST /nfse` com JSON `{"dpsXmlGZipB64": "…"}` (XML da DPS assinado → GZIP → Base64); resposta com `chaveAcesso` e `nfseXmlGZipB64` | heviane issue #6; marciotisouza README | [NÃO CONFIRMADO] |
| Consultar | `GET /nfse/{chaveAcesso}`; `GET /dps/{id}` (recuperar a nota de uma DPS já enviada — base da idempotência) | marciotisouza README | [NÃO CONFIRMADO] |
| Cancelar | evento **101101** — `POST /nfse/{chave}/eventos` (marciotisouza) ou `POST /eventos` (heviane) | dois projetos, caminhos diferentes | **[NÃO CONFIRMADO — divergente]** |
| DANFSe | `GET {adn}/danfse/{chave}` (PDF oficial); fórum alerta que o caminho mudou recentemente no Swagger | marciotisouza; fórum citado na busca | [NÃO CONFIRMADO] |
| Distribuição (notas recebidas) | `GET {adn}/contribuintes/DFe/{NSU}`, até 50 documentos por chamada, emitidos e recebidos pelo CNPJ; certificado com o mesmo CNPJ raiz | manual ADN (citado pela busca); marciotisouza | [NÃO CONFIRMADO o limite de 50] |
| Chave de acesso | **50 dígitos** (NF-e tem 44); `Id` da NFS-e = "NFS" + 50 | https://nfe.io/docs/distribuicao-nfse-inbound-conceitos/ ; https://buscadorncm.com.br/nfse/chave-de-acesso ; heviane issue #6 | Consenso; composição posição a posição [NÃO CONFIRMADO] |
| Id da DPS | "DPS" + IBGE do município emissor (7) + tipo de inscrição (1) + CNPJ/CPF (14) + série (5) + número (15) = 45 caracteres | manual oficial (trecho citado pela busca) e nfe.io | Provável; conferir |
| Série da DPS via API | faixa 1–49999 | projeto citado pela busca | [NÃO CONFIRMADO] |
| Assinatura | XML-DSig RSA-SHA256 envelopada sobre `infDPS` (Id "DPS…"); rustnf diz que o leiaute não fixa o algoritmo | rustnf README | Canonicalização [NÃO CONFIRMADO] |
| Declaração XML | erro E1229 exige a declaração UTF-8 no XML | marciotisouza README | [NÃO CONFIRMADO] |
| IBS/CBS | "a DPS não carrega o IBS/CBS calculado; o Sefin calcula e o valor da NFS-e é o que vale" | rustnf README | **[NÃO CONFIRMADO — decisivo para S-4]** |
| Prazo de cancelamento | — | — | **[NÃO CONFIRMADO]** (fora do prazo, pedido de cancelamento por análise fiscal no município) |

**Imperatriz:** adotou a NFS-e Nacional desde 01/01/2026 (Decreto nº 105, de 24/12/2025):
https://transparencia.imperatriz.ma.gov.br/upload/decretos/105%20-%20DECRETO%20-%20Disp%C3%B5e%20sobre%20a%20ado%C3%A7%C3%A3o%20do%20modelo%20nacional%20da%20NFSE.pdf
e FAQ municipal: https://sti.imperatriz.ma.gov.br/media/portal/files/page/faq/faq_nfse_imperatriz_sefazgo.pdf . A notícia de que a
emissão é **exclusivamente** pelo Emissor Nacional vem de fonte secundária (notagateway) [NÃO CONFIRMADO no FAQ].
Parauapebas publicou tutorial da NFS-e (https://parauapebas.pa.gov.br/wp-content/uploads/2025/12/Tutorial-NFS-e.pdf); adesão
de Canaã dos Carajás e Santa Inês [NÃO CONFIRMADO].

## 2. Brasil API

- Repositório: https://github.com/BrasilAPI/BrasilAPI (licença MIT; princípio "custos devem ser zero"). Site
  `brasilapi.com.br/docs` não abriu nesta sessão.
- Rotas: `GET /api/cnpj/v1/{cnpj}` (exemplo em atores Apify citados na busca) e `GET /api/cep/v2/{cep}` (v2 com geolocalização
  e vários provedores com reserva; v1 sem geolocalização — documentação do cliente Elixir, https://hexdocs.pm/brasilapi/readme.html).
  **[NÃO CONFIRMADO no site oficial]**.
- Campos do CNPJ (`razao_social`, `nome_fantasia`, `descricao_situacao_cadastral`, `cnae_fiscal`, `codigo_municipio_ibge`,
  endereço) — **[NÃO CONFIRMADO]**; o código lê os campos de forma defensiva e testa com respostas gravadas.
- Limite de uso: sem chave; "limites para evitar abuso" sem números publicados **[NÃO CONFIRMADO]**. O cache de 30 dias e
  uma consulta por digitação completa (não por tecla) protegem.
- Código IBGE no CEP v2 **[NÃO CONFIRMADO]** — por isso a reserva do ViaCEP e o resolvedor de município (abaixo).

## 3. ViaCEP

- `https://viacep.com.br/ws/{cep}/json/`, resposta com `ibge` e `{"erro": true}` para CEP inexistente — conhecimento comum,
  **[NÃO CONFIRMADO nesta sessão]** (site bloqueado). Sem chave; o próprio serviço pede para não fazer consultas em massa
  [NÃO CONFIRMADO].
- Município → IBGE quando nenhum dos dois traz o código: API de localidades do IBGE
  (`servicodados.ibge.gov.br/api/v1/localidades/estados/{UF}/municipios`) ou Brasil API `/api/ibge/municipios/v1/{UF}`
  [NÃO CONFIRMADO], com cache por UF no mesmo cache de 30 dias.

## 4. Calculadora de Tributos da Receita Federal (IBS/CBS)

- **Existe e é código aberto:** https://github.com/ReceitaFederal/calculadora-rtc-regime-regular — licença **MIT**.
- **Linguagem:** API REST em **Java 25**, Spring Boot 4.1.2, SQLite + Flyway, Springdoc. Roda com `./mvnw spring-boot:run`
  (perfil `offline`) ou `java -jar target/api-regime-geral.jar`; serve em `http://localhost:8080/api`. Exige gerar antes o
  banco `calculadora/db/calculadora-pro.db` por migração Flyway. Sem Docker documentado; sem releases publicadas.
- **Rotas** (base `/api/calculadora`): `POST /regime-geral`, `POST /base-calculo/base-calculo-unificada-nfse`,
  `POST /xml/generate`, `POST /xml/validate`, `/dados-abertos/…` (alíquotas de referência, classificações, fundamentação).
- Outros repositórios da Receita: calculadora do **Simples Nacional** e gerador de **DANFSe** em PDF (organização
  https://github.com/ReceitaFederal). Notícias: https://tecnoblog.net/noticias/receita-federal-publica-pela-primeira-vez-codigos-no-github/ ,
  https://www.reformatributaria.com/iva/calculadora-de-tributos-receita-libera-codigos-de-3-ferramentas-da-reforma-tributaria-no-github/ .
- **Data de publicação:** divergente (13/11 em https://dootax.com.br/calculadora-da-reforma-tributaria/ ; 16/11 em
  https://smartsolve.com.br/calculadora-cbs-ibs-github/ ) — **[NÃO CONFIRMADO]**. O roadmap da Receita diz que a calculadora
  não substitui os sistemas de autorização de documentos fiscais (https://spedy.com.br/blog/calculadora-de-tributos-no-github).
- **API pública hospedada pela Receita:** um pacote não oficial (https://pypi.org/project/rfbcalc/) aponta
  `https://piloto-cbs.tributos.gov.br/servico/calculadora-consumo/api` + `POST /calculadora/regime-geral`, sem chave desde
  09/2026. É ambiente **piloto**; endereço de produção **[NÃO CONFIRMADO]**.
- **Roda em Node/serverless?** **Não.** É JVM com banco SQLite em arquivo; não cabe na função Node da Vercel. Hospedar à parte
  (VM, contêiner) é serviço novo e, em geral, pago — fora do "custo zero" sem autorização.
- **Recomendação:** (1) na emissão, confiar no cálculo que o Sefin devolve [confirmar na homologação] e guardar o grupo de
  IBS/CBS que voltou como memória de cálculo; (2) prévia opcional pela API piloto da Receita, atrás de interruptor desligado,
  se o endereço de produção for confirmado; (3) reavaliar hospedar o motor só se o Sefin exigir os valores na DPS.

## 5. CNPJ alfanumérico

IN RFB 2.229/2024: 12 primeiras posições alfanuméricas, 2 dígitos verificadores numéricos (módulo 11); primeiro CNPJ
alfanumérico emitido em 31/07/2026 segundo a imprensa (https://olhardigital.com.br/2026/08/20/pro/por-que-o-cnpj-passou-a-ter-letras-em-2026/ ;
https://www.sefaz.pe.gov.br/Noticias/Paginas/CNPJ-alfanum%C3%A9rico-entra-em-vigor-em-Julho-de-2026--e-exige-adequa%C3%A7%C3%A3o-de-sistemas-para-novas-inscri%C3%A7%C3%B5es.aspx ;
perguntas e respostas da Receita: https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/perguntas-e-respostas/cnpj/cnpj-alfanumerico.pdf ).
Data exata **[NÃO CONFIRMADO no oficial]**. Impacto: todos os validadores e CHECKs numéricos do sistema (ver DIAGNOSTICO §2).

## 6. Assinatura XML e mTLS cabem na função da Vercel?

| Peça | Biblioteca | Licença | Custo | Cabe? |
|------|-----------|---------|-------|-------|
| Ler `.pfx` (inclusive legado RC2/3DES) | `pkijs` 3.4 (já no projeto) — PKCS#12 com `PFX`/`SafeContents`; alternativa `node-forge` (https://github.com/digitalbazaar/forge, BSD ou GPL-2, escolher BSD; suporte a RC2 no PKCS#12 **[NÃO CONFIRMADO]**) | MIT/BSD | 0 | Sim, JS puro. O `https.Agent({ pfx })` do Node 22+/OpenSSL 3 recusa PFX legado ("Unsupported PKCS12 PFX data", relatado em marciotisouza) → converter para PEM em memória. |
| XML-DSig envelopada RSA-SHA256, C14N | `xml-crypto` (https://github.com/node-saml/xml-crypto, **MIT**, linha 6.x; C14N inclusiva e exclusiva, `enveloped-signature`, referência por `Id`) + `@xmldom/xmldom` (já no projeto) + `xpath` (MIT) | MIT | 0 | Sim; leve, sem binário nativo. |
| mTLS | `node:https` com `cert`/`key` PEM e `ca` ICP-Brasil (padrão de `server/_core/inter.ts:60`) | — | 0 | Sim. Ponto a testar: renegociação TLS pedida pelo servidor depois da conexão aberta (relato de terceiros) [NÃO CONFIRMADO]. Nunca `rejectUnauthorized: false`. |
| GZIP/Base64 | `node:zlib` | — | 0 | Sim. |
| Tempo | assinatura < 50 ms; chamada ao Sefin ~1–5 s [estimativa, NÃO CONFIRMADO] | — | — | Cabe nos 60 s, uma nota por chamada. |

Referência de projeto aberto em Node/TypeScript que já faz isso (para estudo, não para copiar sem revisão):
https://github.com/marciotisouza/nfse-nacional (MIT). Atenção: usa `rejectUnauthorized: false` — **não adotar**.
