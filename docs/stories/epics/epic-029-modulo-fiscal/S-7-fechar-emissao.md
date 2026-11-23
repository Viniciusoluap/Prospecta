# S-7 — Fechar a emissão: envio da DPS, cancelamento, DANFSe e validação do leiaute

**Status:** InReview · **Epic:** EPIC-029 · **Etapa:** 7 (fecha a S-4 do lado do código) · **Tamanho:** XL ·
**Migração:** `drizzle/0167_fiscal_emissao.sql` e `drizzle/0171_fiscal_historico_sem_xml.sql` (aditivas, idempotentes; **NÃO aplicadas** em banco nenhum)
**Depende de:** S-4 (cofre do A1, DPS, assinatura, cliente mTLS) e S-5 parte 1. **Branch:** `epic029-s7`.

## Por quê
A S-4 deixou a fundação pronta e desligada. Faltava a parte que fecha o ciclo da nota: enviar a DPS assinada e guardar o
retorno, cancelar, gerar o DANFSe (a API do ADN foi suspensa em 03/08/2026 — NT 008) e conferir o leiaute contra o XSD
oficial antes de qualquer envio. **Nada é ligado nesta etapa**: `EMISSAO_DISPONIVEL` continua `false`, cada emissor ganha o
próprio interruptor `emissao_liberada` (falso por padrão, sem rota que o ligue) e o ambiente continua "desligado" por padrão.

## Critérios de aceite
1. **Emitir** (tela e Dolores) só roda com as três travas abertas: `EMISSAO_DISPONIVEL` (constante do código), `emissao_liberada`
   do emissor (banco) e ambiente `producao_restrita` ou `producao`. Qualquer uma fechada → recusa sem rede e sem gravar.
2. **Produção** só é escolhida pelo admin, na tela, digitando a frase "EMITIR EM PRODUÇÃO"; pela Dolores, emitir é ação séria
   ("confirmo"). O servidor confere a frase (a tela não basta).
3. **Idempotência**: o Id da DPS de um rascunho é fixo depois da 1ª reserva (mesmo número para sempre); a reserva usa
   `FOR UPDATE` no emissor e na nota; o banco tem índice único no `dps_id` e em `(emissor_id, numero_dps)`; uma emissão em
   andamento trava o rascunho; depois de tempo esgotado ou erro de rede a nota fica `EMITINDO` e a próxima tentativa
   **consulta `GET /dps/{id}`** antes de reenviar. Teste: queda depois do envio → nenhuma segunda nota.
4. **Retorno**: sucesso grava chave (50), número da NFS-e, XML autorizado, protocolo e status `EMITIDA`; rejeição grava `ERRO`
   com os códigos da Sefin e mostra **frase fixa** (nunca o texto cru); o retorno fica no banco (`fiscal_eventos`), e o log
   leva só o código/status.
5. **Cancelamento** (e101101): só admin; motivo da lista (1 erro na emissão, 2 serviço não prestado, 9 outros) e justificativa de
   15 a 255 caracteres; prazo de 730 dias conferido localmente (o município pode ter prazo menor: a recusa E0822 volta em
   frase própria); pedido assinado, validado no XSD, enviado a `POST /nfse/{chave}/eventos`; status `CANCELADA`; evento
   guardado em `fiscal_eventos` (só inserção). Pela Dolores: ação séria ("confirmo").
6. **DANFSe** (NT 008): PDF gerado do **XML autorizado** (nunca do rascunho), com chave, QR Code
   `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=<chave>`, prestador, tomador, serviço, valores e tributos; em
   produção restrita, "NFS-e SEM VALIDADE JURÍDICA"; nota cancelada leva "CANCELADA". Baixar na tela (admin) e mandar pela
   Dolores só ao número do dono.
7. **Parâmetros municipais** (pedido do coordenador): botão só-admin "Buscar alíquotas oficiais" no tipo de serviço consulta a
   Sefin com o mTLS do emissor (`/parametros_municipais/{IBGE}/{código do serviço}` e `/{IBGE}/{CNPJ}`, MAN-API v1.2 §1.2.1) para
   Imperatriz, Canaã dos Carajás, Parauapebas, Santa Inês, o município do emissor e os de incidência já gravados; grava por
   município e serviço com data e origem "Sefin" e o retorno; diferente da digitada → "pendente" e o admin escolhe. Na DPS,
   quem não é do Simples usa a oficial aceita do município de incidência (obra 7.02/7.05 = município da obra).
8. **Leiaute**: XSD oficiais em `shared/fiscal/xsd/` (versão, URL e SHA-256 no README); DPS assinada e pedido de evento
   validados contra o XSD do ambiente (produção 09/02/2026 × produção restrita 20/10/2026) antes do envio; inválido → recusa
   sem rede. Validador: `xmllint-wasm` (libxml2 em WebAssembly, MIT, roda na função da Vercel). Validador indisponível → recusa
   (falha fechada).
9. **Alíquota**: ponto de entrada `resolverAliquotaIss` — Simples pela fonte do RBT12/anexo (outra frente entrega a tabela;
   sem ela, recusa com a frase do que falta), demais regimes pela `aliquota_iss` do tipo de serviço. Regime desconhecido,
   "a_confirmar" ou "outro" → a DPS não é montada.
10. **Pendências da revisão da S-4**: (1) certificado sem os intermediários: a cadeia é COMPLETADA no servidor (rotina do Jurídico, `montarCadeia` com intermediários
   embarcados + AIA) e o mTLS manda cert + intermediários; só recusa se, mesmo completando, não fechar numa raiz ICP-Brasil
   (correção do coordenador: o A1 real da Prospecta veio sem intermediários); (2) `testarConexao` com emissor
   inexistente → frase própria, não 500; (3) `emissorId` explícito de emissor inativo → recusado; (4) matriz e filial com a
   mesma raiz → pede para escolher o emissor; (5) corrida no índice único do certificado ativo → frase clara; (6)
   `credencialDoEmissor` confere também `validoDe`; (7) `xNome` do tomador cortado em 300 (limite do leiaute).

## Tarefas
- [x] Story (este arquivo) antes do código.
- [x] XSD oficiais baixados (`shared/fiscal/xsd/`), README com versão, URL e SHA-256 dos .zip.
- [x] `server/fiscal/leiaute.ts`: validação XSD por ambiente (xmllint-wasm), mensagens sem valores do XML.
- [x] Correções do leiaute achadas pelo XSD na DPS da S-4 (ver Notas).
- [x] `server/fiscal/evento.ts`: pedido de cancelamento e101101.
- [x] `server/fiscal/emissao.ts`: emitir, retomar (`EMITINDO`), cancelar, frases fixas dos erros, travas.
- [x] `server/fiscal/danfse.ts`: DANFSe do XML autorizado.
- [x] Migração 0167 + `drizzle/schema-fiscal.ts`.
- [x] Rotas: `notas.emitir`, `notas.cancelar`, `notas.danfse`, `notas.xml`, `emissores.ambiente`, parâmetros do contador.
- [x] Tela: botões Emitir/Cancelar/DANFSe/XML, troca de ambiente com a frase de produção.
- [x] Dolores: emitir executa pela mesma função (com as travas); `cancelar_nota_fiscal` (séria); DANFSe ao dono.
- [x] Pendências da revisão da S-4 (AC 9).
- [x] Testes com Sefin simulada (mTLS falso, sucesso, rejeição, tempo esgotado, duplicidade), cancelamento, DANFSe, XSD.

## Implementação (22/11/2026, @dev Dex, branch `epic029-s7`)

### Pronto
- **XSD oficiais** baixados do gov.br em `shared/fiscal/xsd/` (produção 09/02/2026 e produção restrita 20/10/2026; README com
  URL e SHA-256 dos .zip). **Validador:** `xmllint-wasm` 5.3.0 (MIT, libxml2 em WebAssembly, sem binário do sistema) em
  `server/fiscal/leiaute.ts`; falha fechada; mensagens só com o NOME do campo. O XSD de produção tem `^…$` num `pattern` (série):
  tirado em memória (o libxml2 lê `^`/`$` como letras; o validador .NET da Sefin, como âncoras). Ida ~0,3 s por documento.
- **O XSD achou 4 erros na DPS da S-4 (corrigidos):** `cAtvSN` NÃO existe no `regTrib` da v1.01 (nem produção, nem restrita) —
  deixou de ser exigido e enviado (`CATVSN_EM_REGTRIB = false`; a coluna e a tela ficam); `cNBS` vem ANTES de `xDescServ` na
  produção restrita e DEPOIS na produção; `pAliq` é `TSDec1V2` ("5.00", não "5.0000"); o `cIndOp` é obrigatório no XSD de produção.
  `xNome` do tomador cortado em 300 (TSNomeRazaoSocial).
- **Emissão** (`server/fiscal/emissao.ts`): três travas (constante `EMISSAO_DISPONIVEL` = false, `fiscal_emissores.emissao_liberada`
  = false por padrão e **sem rota que o ligue**, ambiente); reserva do número com `FOR UPDATE` (emissor + nota) e Id da DPS fixo do
  rascunho (gatilho + índice único); DPS assinada e validada no XSD do ambiente DENTRO da reserva (inválida → nada reservado);
  `EMITINDO` com trava de 90 s; tempo esgotado/rede/5xx/resposta ilegível = incerto (fica `EMITINDO`); rejeição → consulta
  `GET /dps/{id}` antes de marcar `ERRO`; retomada consulta e só reenvia o MESMO XML assinado se a DPS não gerou nota; sucesso grava
  chave, número, XML autorizado, protocolo (`nDFSe` quando o JSON não traz), IBS/CBS devolvido e o retrato congelado.
  Frases fixas por código (`retorno.ts#FRASES_ERRO`); retorno no banco (`fiscal_eventos`, só inserção), nada em log.
  **Série padrão**: sem série cadastrada, `"1"` (00001, primeira da faixa 1–49999 do aplicativo próprio — E0010), gravada no
  emissor na 1ª emissão (o emissor 1 de produção está sem série).
- **Cancelamento** (`server/fiscal/evento.ts` + `emissao.ts#cancelarNota`): e101101, Id `PRE`+chave+`101101` (59, padrão do XSD
  v1.01 — sem nº de pedido), motivo 1/2/9, justificativa 15–255, prazo local 730 dias, mesmo ambiente da emissão, assinado
  (`infPedReg`), validado no XSD; rejeição/incerto → consulta `GET /nfse/{chave}/eventos/101101/1` antes de desistir; `CANCELADA`
  com motivo, justificativa, quem e quando; E0822 em frase própria. Trava: só `EMISSAO_DISPONIVEL` [AUTO-DECISION: o interruptor
  do emissor desliga emissões novas, mas cancelar o que já saiu continua possível].
- **DANFSe** (`server/fiscal/danfse.ts`, jspdf + qrcode do projeto): 1 página A4, blocos da NT 008, QR
  `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=`, "NFS-e SEM VALIDADE JURÍDICA" quando tpAmb 2, "CANCELADA" na cancelada;
  só do XML autorizado (o XML da DPS é recusado). Tela: botões DANFSe/XML (só admin). Dolores: `ver_nota_fiscal` com
  `enviarPrevia` numa nota emitida manda o DANFSe ao número do dono (mesmo caminho da prévia, conferindo o número).
- **Parâmetros municipais** (`server/fiscal/parametros-municipais.ts`, tabela `fiscal_parametros_municipais`): ver AC 7. Leitura
  só aceita UMA alíquota sem ambiguidade (campos `aliq…` do JSON — nomes [NÃO CONFIRMADO no Swagger]); senão "sem_valor".
  Retenções guardadas e mostradas (não mudam a DPS sozinhas). Ambiente desligado → recusa sem rede.
- **Alíquota** (`server/fiscal/aliquota.ts`): Simples pela fonte registrada por `registrarFonteSimples` (hoje nenhuma → recusa com
  a frase); demais: oficial aceita > digitada; pendente → recusa pedindo a escolha; regime fora de `REGIMES_CONHECIDOS` → recusa.
  IBGE do município de incidência pelo nome para os municípios da operação (`shared/fiscal/municipios.ts`).
- **Ambiente**: `fiscal.emissores.ambiente` (só admin); `producao` só com "EMITIR EM PRODUÇÃO" conferido no servidor; recusa com
  nota EMITINDO. `destinoDo` deixou de recusar produção (a decisão é das travas).
- **Parâmetros do contador**: `emissores.parametros` (opSimpNac, regApTribSN, regEspTrib) e `tipos.parametros` (tribISSQN,
  tpRetISSQN, indTotTrib, classificação IBS/CBS), só números, nada preenchido por padrão; telas "Códigos da empresa"/"Códigos da nota".
- **Dolores**: `emitir_nota_fiscal` executa `emitirNota` (fora da transação da Dolores, de propósito) quando a emissão estiver
  ativa; `cancelar_nota_fiscal` nova, séria ("confirmo"), justificativa conferida contra as palavras do dono. Piso
  `RESERVA_MINIMA_ENTRADA` 21.000 → 21.500 (a ferramenta nova; folga ≥ 1.000 no pior caso).
- **Revisão da S-4**: os 7 itens (AC 10), com teste cada.
- **Segurança**: lista/ver das notas nunca levam `xmlDps`/`xmlNfse`/`congelado` (só o download de admin).

### Não feito / depende de outros
- Ligar qualquer coisa (por ordem): `EMISSAO_DISPONIVEL`, `emissao_liberada` do emissor, ambiente — nada foi ligado.
- **Migrações 0167 e 0171 NÃO aplicadas** em banco nenhum. A publicação desta branch exige aplicar a 0167 ANTES (o schema lê as colunas novas); a 0171 depois da 0167.
- Nomes dos campos JSON da Sefin e dos parâmetros municipais continuam [TERCEIROS/NÃO CONFIRMADO] (Swagger só com o A1): a leitura
  trata o que não reconhece como INCERTO (consulta antes de reenviar), nunca como sucesso.
- CNO da obra (7.02/7.05): não há onde guardá-lo; a DPS desses itens continua recusada com a frase.
- Tabela de alíquotas do Simples (RBT12 + anexo): outra frente; ponto de entrada pronto.
- Cadeia do A1: usa `completarCadeiaIcp` do Jurídico (commit 981ea52 da frente `juridico-cadeia`, trazido por cherry-pick para esta
  branch: intermediárias oficiais embarcadas em `server/certificados/icp-intermediarias.json` + AIA). Ordem: o que veio no .pfx →
  embarcadas sem rede → AIA; o caminho folha→raiz é conferido de novo aqui. Ao guardar, a cadeia mostrada já sai completada sem rede.
- Vercel: `vercel.json` inclui `shared/fiscal/xsd/**` e `node_modules/xmllint-wasm/**` no pacote da função; conferir no primeiro
  deploy que o validador carrega (se não carregar, a emissão recusa — falha fechada).

### Correções do portão de QA (23/11/2026, @dev Dex — veredito CONCERNS; `server/fiscal/s7-qa.test.ts`, os 4 `it.fails` viraram `it`)
- **I1** (`server/dolores/acoes/fiscal.ts`): o item aprovado de `emitir_nota_fiscal` agora leva `ambiente` (o do emissor na preparação)
  e `liberada` (`EMISSAO_DISPONIVEL` E `emissao_liberada` na preparação; ausente = false). Na execução, a nota é relida: ambiente ou
  liberação diferentes → recusa `FRASE_EMISSAO_MUDOU` ("prepare de novo"), sem rede. O ambiente aprovado vai a `emitirNota`
  (`ambienteEsperado`), que confere de novo antes e DENTRO da reserva (`FOR UPDATE`) e na retomada — a corrida fica fechada.
- **I2** (`parametros-municipais.ts#aliquotaMunicipalVigente`): exige o ambiente; só vale a alíquota lida no MESMO ambiente da emissão.
- **M1**: a vigente ignora consultas falhas (HTTP fora de 2xx ou `sem_valor`); `resolverAliquotaIss` recusa (`FALTA_CONSULTA_FALHOU`,
  "busque as alíquotas oficiais de novo") se receber uma consulta sem valor — nunca cai em silêncio na digitada. `recusada` (o admin
  escolheu a digitada) continua valendo a digitada. A mensagem da busca que falhou diz que a oficial já aceita continua valendo.
- **M2** (`retorno.ts#conferirNfse`): só "autorizada" com prova positiva — grupo DPS/infDPS presente com o mesmo Id, `tpAmb` do ambiente
  da emissão e CNPJ do `emit` igual ao do emissor; faltou qualquer um (ou o esperado não veio) → INCERTA.
- **B1**: `fiscal.notas.verificarManualmente` (só admin) / `emissao.ts#marcarVerificarManualmente` + botão "Marcar como verificar
  manualmente" na nota EMITINDO: EMITINDO → ERRO com `ultimo_erro.manual = true`, sem rede e sem apagar (histórico da 0154 grava quem e
  quando); libera o emissor (troca de ambiente). Recusa com a trava recente (90 s). Nova tentativa de emitir um rascunho que já tem DPS
  reservada (volta de ERRO) **consulta `GET /dps/{id}` antes de reenviar**.
- **B2**: 408 e 429 = incertas (emissão e evento), não rejeição.
- **B3**: orçamento total `ORCAMENTO_EMISSAO_MS` = 50 s por emissão/cancelamento (função de 60 s); o prazo de cada chamada é o menor
  entre 25 s e o que resta; com menos de 2 s restando a chamada nem sai (resultado incerto, nada enviado).
- **B4**: DANFSe recebe `ambienteEmissao` como reserva do aviso "NFS-e SEM VALIDADE JURÍDICA" (tpAmb 2 OU nota emitida em produção restrita).
- **B5**: DANFSe pela Dolores passa pelo mesmo interruptor da prévia (`DOLORES_MASCARAR_DADOS_PESSOAIS`): CPF/CNPJ, telefone e e-mail do
  tomador por `campoPessoal`, textos livres por `sanitizarTexto`. A tela (admin) baixa o documento como autorizado.
- **B6**: migração NOVA `0171_fiscal_historico_sem_xml.sql` (CREATE OR REPLACE da função do histórico, que omite `xml_dps`/`xml_nfse`);
  a 0154 e a 0167 não foram editadas; linhas antigas do histórico ficam como estão (imutável).
- **B7**: `xmllint-wasm` carregado sob demanda (import dinâmico dentro do try) — se faltar no pacote, só a validação falha, FECHADA,
  sem derrubar o servidor; antes de validar, confere `xmllint.wasm`/`xmllint-node.js`/`index-node.js` no caminho REAL (links do pnpm
  resolvidos). `vercel.json` passou a incluir também `node_modules/.pnpm/xmllint-wasm@*/node_modules/xmllint-wasm/**`.
- **B8** [AUTO-DECISION: cancelar com emissor desligado → recusa (razão: o mais seguro; "desligado" quer dizer que nada sai à Sefin)]:
  `cancelarNota` exige também o emissor com ambiente de emissão e `emissao_liberada`; a tela mostra o botão desabilitado com o motivo
  (`FRASE_CANCELAMENTO_DESLIGADO` no servidor). O cancelamento continua indo ao ambiente em que a nota foi emitida.

### Merge da S-8 (23/11/2026, @dev Dex) — alíquota do Simples ligada na emissão
- `origin/main` com a S-8 (#321) mesclada. Conflitos resolvidos por união: `dps.ts` (cAtvSN continua fora do `regTrib` v1.01;
  `pAliq` pelo `aliquotaDaDps` da S-8, 2 casas; formato do leiaute conferido também na alíquota do Simples; faltas da S-8 mantidas),
  `router.ts` (`emissores.salvarSimples` da S-8 dentro de `emissores`, junto de `ambiente`/`parametros`), `schema-fiscal.ts`,
  `whatsapp.ts` (teto de leitura da S-3b + DANFSe da S-7), telas `DadosFiscaisDoPerfil`/`NotasADecidir` (os dois lados).
- **Ligação**: `emissao.ts` chama `registrarFonteSimples(fonteSimplesDaS8)` (`server/fiscal/simples.ts`, que roda
  `paraDps(aliquotaSimplesDaNota(db, nota))`). Emissor do Simples → `pAliq` = a alíquota CALCULADA (nunca a digitada); sem cálculo →
  recusa com a frase da S-8 (`alíquota do Simples: …`), sem rede e sem reservar número; produção ainda exige receita completa e início
  de atividade (regras da S-8 no `faltasDps`). Regime `a_confirmar`/desconhecido → recusa. `resolverAliquotaIss` aceita da fonte o
  número (testes) ou o resultado completo da S-8.
- Testes de ponta a ponta em `s7-qa.test.ts` ("S-7 × S-8"): Simples → DPS enviada com o `pAliq` da S-8; sem tabela do período → recusa
  da S-8; `a_confirmar` → recusa; fonte registrada = a da S-8. `s8-qa`/`simples-servidor` passaram a aplicar a 0167 (o schema lê as colunas da emissão).

### Testes
- Depois das correções do portão de QA e do merge da main (23/11): `server/fiscal/*` 11 arquivos / 265 testes OK (`s7-qa` com 32:
  os 4 achados viraram `it` + testes de I1, M1, M2, B1–B8); `server/dolores/{s3-fiscal,s3-fiscal-qa,acoes,acoes-whatsapp,c5-e2-resolve}`
  + `server/{auth-session,imports-esm}` 7 arquivos / 119 OK; `tsc --noEmit` OK; `vite build` OK. Merge: conflitos só nos arquivos do
  Jurídico (cadeia ICP), resolvidos com a versão da main (já com o portão de QA do Jurídico). (Depois: S-8 mesclada e ligada — ver acima.)
- Automáticos: `server/fiscal/emissao-s7.test.ts` (28: Sefin simulada com mTLS local — sucesso, rejeição, queda depois/antes de
  gerar, 5xx, concorrência, produção; gatilho; cancelamento; DANFSe pelo texto do PDF; XSD válido/inválido; alíquota; parâmetros
  municipais; certificado). Ajustados: `emissao-fundacao`, `certificado`, `emissao-qa`, `rascunhos*`, `s3-fiscal*`, `acoes`.
- Manuais: nenhum (nada ligado). Pendente em produção: homologação com o A1 do dono.

## File List
- Novos: `drizzle/0167_fiscal_emissao.sql`; `drizzle/0171_fiscal_historico_sem_xml.sql` (QA B6); `server/fiscal/s7-qa.test.ts` (portão de QA); `server/fiscal/{leiaute,retorno,evento,emissao,danfse,aliquota,parametros-municipais}.ts`;
  `server/fiscal/emissao-s7.test.ts`; `shared/fiscal/municipios.ts`; `shared/fiscal/xsd/**` (XSD oficiais + README);
  `client/src/components/fiscal/AliquotasOficiais.tsx`; esta story.
- Alterados: `drizzle/schema-fiscal.ts`; `server/fiscal/{dps,sefin,certificado,certificado-router,notas,router}.ts`;
  `shared/fiscal/dps-campos.ts`; `client/src/components/fiscal/{NotasADecidir,DadosFiscaisDoPerfil,TiposServico}.tsx`;
  `server/dolores/{acoes/fiscal,acoes/registro,cerebro,permissoes,whatsapp,leitura/fiscal}.ts`; `shared/dolores/{fiscal,confirmacao,voz}.ts`;
  testes `server/fiscal/{emissao-fundacao,certificado,emissao-qa,rascunhos,rascunhos-qa}.test.ts`, `server/dolores/{s3-fiscal,s3-fiscal-qa,acoes}.test.ts`;
  `package.json`/`pnpm-lock.yaml` (`xmllint-wasm` 5.3.0, MIT); `vercel.json` (includeFiles).

## Change Log
- 22/11/2026 — @dev: story criada (Draft→InProgress) e implementada; InProgress → InReview (aguarda portão de QA).
- 23/11/2026 — @dev: merge da S-8 (#321) e alíquota do Simples ligada na emissão (`registrarFonteSimples(fonteSimplesDaS8)`).
- 23/11/2026 — @dev: correções do portão de QA (CONCERNS): I1, I2, M1, M2 e B1–B8 (ver "Correções do portão de QA"); merge da main.
- 23/11/2026 — @dev: cadeia do A1 completada por `completarCadeiaIcp` do Jurídico (cherry-pick 981ea52), sem recusar o .pfx sem intermediários.
