# S-7 — Fechar a emissão: envio da DPS, cancelamento, DANFSe e validação do leiaute

**Status:** InReview · **Epic:** EPIC-029 · **Etapa:** 7 (fecha a S-4 do lado do código) · **Tamanho:** XL ·
**Migração:** `drizzle/0167_fiscal_emissao.sql` (aditiva, idempotente; **NÃO aplicada** em banco nenhum)
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
- **Migração 0167 NÃO aplicada** em banco nenhum. A publicação desta branch exige aplicar a 0167 ANTES (o schema lê as colunas novas).
- Nomes dos campos JSON da Sefin e dos parâmetros municipais continuam [TERCEIROS/NÃO CONFIRMADO] (Swagger só com o A1): a leitura
  trata o que não reconhece como INCERTO (consulta antes de reenviar), nunca como sucesso.
- CNO da obra (7.02/7.05): não há onde guardá-lo; a DPS desses itens continua recusada com a frase.
- Tabela de alíquotas do Simples (RBT12 + anexo): outra frente; ponto de entrada pronto.
- Cadeia do A1: usa `completarCadeiaIcp` do Jurídico (commit 981ea52 da frente `juridico-cadeia`, trazido por cherry-pick para esta
  branch: intermediárias oficiais embarcadas em `server/certificados/icp-intermediarias.json` + AIA). Ordem: o que veio no .pfx →
  embarcadas sem rede → AIA; o caminho folha→raiz é conferido de novo aqui. Ao guardar, a cadeia mostrada já sai completada sem rede.
- Vercel: `vercel.json` inclui `shared/fiscal/xsd/**` e `node_modules/xmllint-wasm/**` no pacote da função; conferir no primeiro
  deploy que o validador carrega (se não carregar, a emissão recusa — falha fechada).

### Testes
- Automáticos: `server/fiscal/emissao-s7.test.ts` (28: Sefin simulada com mTLS local — sucesso, rejeição, queda depois/antes de
  gerar, 5xx, concorrência, produção; gatilho; cancelamento; DANFSe pelo texto do PDF; XSD válido/inválido; alíquota; parâmetros
  municipais; certificado). Ajustados: `emissao-fundacao`, `certificado`, `emissao-qa`, `rascunhos*`, `s3-fiscal*`, `acoes`.
- Manuais: nenhum (nada ligado). Pendente em produção: homologação com o A1 do dono.

## File List
- Novos: `drizzle/0167_fiscal_emissao.sql`; `server/fiscal/{leiaute,retorno,evento,emissao,danfse,aliquota,parametros-municipais}.ts`;
  `server/fiscal/emissao-s7.test.ts`; `shared/fiscal/municipios.ts`; `shared/fiscal/xsd/**` (XSD oficiais + README);
  `client/src/components/fiscal/AliquotasOficiais.tsx`; esta story.
- Alterados: `drizzle/schema-fiscal.ts`; `server/fiscal/{dps,sefin,certificado,certificado-router,notas,router}.ts`;
  `shared/fiscal/dps-campos.ts`; `client/src/components/fiscal/{NotasADecidir,DadosFiscaisDoPerfil,TiposServico}.tsx`;
  `server/dolores/{acoes/fiscal,acoes/registro,cerebro,permissoes,whatsapp,leitura/fiscal}.ts`; `shared/dolores/{fiscal,confirmacao,voz}.ts`;
  testes `server/fiscal/{emissao-fundacao,certificado,emissao-qa,rascunhos,rascunhos-qa}.test.ts`, `server/dolores/{s3-fiscal,s3-fiscal-qa,acoes}.test.ts`;
  `package.json`/`pnpm-lock.yaml` (`xmllint-wasm` 5.3.0, MIT); `vercel.json` (includeFiles).

## Change Log
- 22/11/2026 — @dev: story criada (Draft→InProgress) e implementada; InProgress → InReview (aguarda portão de QA).
- 23/11/2026 — @dev: cadeia do A1 completada por `completarCadeiaIcp` do Jurídico (cherry-pick 981ea52), sem recusar o .pfx sem intermediários.
