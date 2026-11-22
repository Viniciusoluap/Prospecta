# S-4 — Homologação na API Nacional (produção restrita)

**Status:** InProgress (fundação pronta; homologação depende do dono) · **Epic:** EPIC-029 · **Etapa:** 4 · **Tamanho:** XL · **Migração:** `0162_fiscal_certificados.sql` (fundação; antes previsto 0156)
**Depende de:** S-2; itens do dono/contador (abaixo). **Construir antes** tudo o que não depende deles.

## Escopo
1. **Certificado A1 no painel** (decisão b): card `CertificadoFiscalCard` em Integrações, um por emissor. O dono envia o
   `.pfx` (≤ 1 MiB) e digita a senha; o servidor abre (pkijs; PFX legado RC2/3DES incluído — R4), confere validade, CNPJ do
   titular = CNPJ do emissor (raiz igual) e cadeia ICP-Brasil; guarda **cifrado** (`encryptSecret`) o PFX e a senha em
   colunas separadas de `fiscal_emissores_certificado`; a tela mostra só titular, CNPJ, emissor, validade, impressão digital.
   Aviso 30 dias antes do vencimento (tipo `integracao` dos avisos). Leitura só em `server/fiscal/certificado.ts`; teste-vigia.
2. **DPS** (`server/fiscal/dps.ts`, `shared/fiscal/dps-campos.ts`): leiaute nacional [conferir XSD da versão vigente], Id
   "DPS"+IBGE+tipo+CNPJ+série+número, `tpAmb` 2, prestador (emissor), tomador, serviço (código de tributação nacional, NBS,
   município de incidência = da obra), valores, grupo de obra (CNO/endereço) quando construção civil, grupo **IBS/CBS** conforme
   NT 007 (classificação; valores só se o leiaute exigir — PESQUISA §4). Validação local contra o XSD antes de enviar.
   Campo do contador nulo → recusa com a lista do que falta.
3. **Assinatura** (`server/fiscal/assinatura.ts`): XML-DSig envelopada RSA-SHA256 sobre `infDPS`, `xml-crypto` (MIT) +
   `@xmldom/xmldom`; mesma função assina o evento de cancelamento. Teste: verificação independente com OpenSSL/xmlsec.
4. **Cliente mTLS** (`server/fiscal/sefin.ts`), padrão de `server/_core/inter.ts:60`: `https.request` com `cert`/`key` PEM em
   memória e `ca` ICP-Brasil; **proibido** `rejectUnauthorized: false`; tempo-limite 25 s; GZIP+Base64 do XML.
5. **Emissão idempotente**: reserva `numero_dps` numa transação (`proximo_numero_dps` com `FOR UPDATE`), grava `EMITINDO`,
   envia; sucesso → `EMITIDA` com chave (50 dígitos), XML da NFS-e, protocolo e o IBS/CBS devolvido (memória de cálculo);
   tempo esgotado/erro de rede → continua `EMITINDO` e a próxima tentativa **consulta a DPS** antes de reenviar; rejeição →
   `ERRO` com código e mensagem do Sefin (sem dado pessoal no log).
6. **Cancelamento** (evento 101101, caminho a confirmar — PESQUISA §1) com justificativa obrigatória; prazo legal
   [NÃO CONFIRMADO] mostrado na tela quando confirmado.
7. **DANFSe**: baixar o PDF oficial do ADN e guardar; sem ele, a prévia continua com marca d'água.
8. Interruptor por emissor: `ambiente = 'producao_restrita'` só pelo admin; `producao` **bloqueado** nesta story (CHECK de
   aplicação + teste).
9. Tela: "Emitir" ativo **só** para emissor em produção restrita, com faixa "AMBIENTE DE TESTES — SEM VALOR FISCAL".

## Migração 0156 (aditiva)
`fiscal_emissores_certificado` (emissor, pfx cifrado, senha cifrada, titular, cnpj, validade, impressão digital, enviado por/em);
`fiscal_eventos` (nota, tipo, xml, protocolo, situação, criado_em; só inserção). Nenhuma coluna existente muda.

## Critérios de aceite
1. PFX legado e moderno abrem; senha errada, vencido, CNPJ diferente do emissor → recusados com mensagem clara.
2. O certificado nunca aparece em resposta de API, log, erro, histórico ou `dolores_acoes` (teste-vigia varrendo o código e
   as respostas).
3. DPS gerada valida no XSD oficial; assinatura verifica fora do sistema.
4. **10 notas de teste** emitidas e **canceladas** na produção restrita sem erro (prova: chaves e protocolos guardados).
5. Queda simulada após o envio → nenhuma DPS duplicada (teste com servidor falso).
6. Tentar `producao` nesta etapa falha.

## Dependências do dono / contador (bloqueiam só a execução real)
Regime de cada CNPJ; Efficaz emite pelo próprio CNPJ?; A1 + senha (enviados pelo dono, passo a passo com links na hora);
inscrição municipal; códigos de serviço, alíquotas e retenções; CNO das obras; tomador por tipo de receita; conferência do
contador nas 10 primeiras notas com IBS/CBS (pedido original).

## Riscos
Documentação oficial não lida nesta sessão (R12); renegociação TLS; cálculo de IBS/CBS (PESQUISA §4); prazo de 60 s (R10).

---

## Implementação — parte que NÃO depende do dono (22/11/2026, @dev, branch `epic029-s4`)

Tudo **desligado**: nenhuma chamada real ao governo, o gatilho `fiscal_notas_guarda` (0154) e a rota `fiscal.notas.emitir`
continuam recusando EMITINDO/EMITIDA. A migração desta story é a **`0162_fiscal_certificados.sql`** (o número 0156 do
cabeçalho ficou com outra frente; 0161 é da S-3 e 0163 da S-5).

### Feito
1. **Cofre do A1** (`server/fiscal/certificado.ts`, único ponto que abre o .pfx e decifra a senha):
   - **Caminho principal (pedido do dono em 22/11):** o A1 que ele **já cadastrou no Jurídico** é enviado do próprio cartão de
     lá — botão **"Usar também para emitir notas fiscais"** (só admin), com caixa de ciência desmarcada explicando que o
     certificado e a senha passam a ficar guardados cifrados no servidor para emitir NFS-e daquele CNPJ. A senha vem da que
     está salva no aparelho (`recuperarSenha`) ou é digitada. Envio direto do .pfx fica como **alternativa** no cartão de
     Integrações.
   - Abre .pfx moderno e **legado RC2/3DES** em JS puro (`P12Signer` do `@libpdf/core` + `pkijs`; chave em PEM só em memória).
   - Confere: validade, **CNPJ do titular (OtherName ICP 2.16.76.1.3.3 ou sufixo do CN) = raiz do CNPJ do emissor**
     (`fiscal_emissores`; sem `emissorId`, acha o emissor pelo CNPJ do certificado), não é certificado de AC, e — se o
     certificado restringe usos — tem **"Autenticação de Cliente"** (requisito oficial do certificado de transmissão).
     Cadeia ICP-Brasil (raízes `server/certificados/icp-raizes.json`, as do #301) é **conferida e mostrada**, não recusa
     (o .pfx muitas vezes não traz os intermediários) — `[AUTO-DECISION]`.
   - Guarda `.pfx` e senha **cifrados em colunas separadas** (`encryptSecret`); certificado novo desativa o anterior (um
     ativo por emissor); **remover = desativar**; o banco recusa apagar, truncar, trocar o conteúdo cifrado e reativar.
   - Tela: `CertificadoFiscalCard` em Configurações › Integrações mostra **só** titular, CNPJ, AC, validade, impressão
     digital SHA-256, cadeia, origem, aviso de vencimento (≤ 30 dias), atalho para Jurídico › Certificados digitais
     (`/admin/juridico?aba=certificados`), Desativar e Testar conexão.
   - Rotas `integracoes.certificadoFiscal.{status, enviar, desativar, testarConexao}` — só **admin por papel**; nenhuma devolve
     arquivo, senha ou chave. Histórico `fiscal_certificados_historico` (enviado / desativado / recusado / teste_conexao),
     só inserção, sem segredo.
2. **DPS** (`server/fiscal/dps.ts` + `shared/fiscal/dps-campos.ts`), função pura: leiaute **v1.01** com **duas variantes**
   (produção restrita 20/10/2026 com NT 009: `finNFSe` em infDPS e CST/cClassTrib em `IBSCBS/valores/trib`; produção
   09/02/2026: `finNFSe` e `gIBSCBS` dentro de IBSCBS). Id de 45 no padrão oficial (aceita CNPJ alfanumérico), série 1–49999,
   nDPS sem zero à esquerda, UTF-8 com declaração, sem prefixo, sem espaço entre tags. **IBS/CBS: só a classificação**
   (indDest, CST, cClassTrib; cIndOp/indFinal opcionais) — nenhum valor/alíquota. **Simples Nacional (decisão do dono):**
   `opSimpNac`/`regApTribSN` têm de ser coerentes com `tax_profiles.regime`; para optante, o grupo IBSCBS fica fora até
   2027 quando não classificado. Campo do contador nulo → `ErroDps` com a lista do que falta. Adaptador `entradaDaNota`
   (rascunho + emissor + tipo de serviço; nada digitado de novo).
3. **Assinatura** (`server/fiscal/assinatura.ts`, `xml-crypto` 6.4.0, MIT): enveloped, `Reference URI="#Id"`,
   enveloped-signature + C14N inclusiva 20010315; **`<Signature>` filha de `<DPS>`, irmã de `<infDPS>` (logo depois)** —
   igual para `infPedReg` em `pedRegEvento`; só o certificado final no `X509Data`. Padrão **RSA-SHA1/SHA-1** (manual);
   SHA-256 disponível para testar na homologação.
4. **Cliente mTLS** (`server/fiscal/sefin.ts`): `https.request` com cert/key PEM em memória, `ca` = raízes do Node +
   ICP-Brasil, `rejectUnauthorized: true` sempre, TLS ≥ 1.2, tempo-limite 25 s, teto de 5 MiB na resposta, erro só com o
   código (nada de XML/corpo/certificado em log). Host e base **fixos por ambiente** (`fiscal_emissores.ambiente`):
   desligado → recusa; produção → bloqueada nesta etapa; produção restrita → `sefin.producaorestrita.nfse.gov.br/API/SefinNacional`
   (base alternativa `/SefinNacional` por opção). URL montada aqui; caminho com outro host/`..`/`//`/`@` recusado.
   Caminhos oficiais (`/nfse`, `/nfse/{chave}`, `GET|HEAD /dps/{id}`, `/nfse/{chave}/eventos`,
   `/parametros_municipais/{ibge}/convenio`, ADN `/DFe/{nsu}`) em `CAMINHOS`; **DANFSe sem caminho** (API do ADN suspensa
   em 03/08/2026 — NT 008: o PDF terá de ser gerado pelo sistema). **Ainda [NÃO CONFIRMADO] e isolado:** base do ADN
   (`baseConfirmada: false`, o cliente recusa) e nomes dos campos JSON (`CAMPOS_JSON`, sem uso).
   "Testar conexão": desligado recusa sem rede; produção restrita só faz o GET do **convênio municipal** (só leitura).

### Depende do dono / contador (nada disto foi feito)
- Mudar o `ambiente` de um emissor para `producao_restrita` (hoje a tela só grava `desligado`) e enviar o A1 pelo Jurídico.
- Códigos do contador por tipo de serviço/emissor: `opSimpNac` (ME/EPP ou MEI), `regApTribSN`, `regEspTrib`, `tribISSQN`,
  `tpRetISSQN`, `indTotTrib`, classificação IBS/CBS (indDest, CST, cClassTrib, cIndOp se exigido), CNO das obras,
  inscrição municipal. **Ainda não há onde gravá-los** (próxima parte da S-4: colunas/tela para esses parâmetros).
- Homologação: 10 notas emitidas e canceladas, conferência do Swagger (campos JSON, base do ADN), SHA-1 × SHA-256, XSD.

### Ainda não construído nesta parte (próximos passos da S-4, não dependem do dono)
Emissão idempotente (reserva de número com `FOR UPDATE`, EMITINDO → consulta `/dps/{id}` antes de reenviar), evento de
cancelamento 101101 (`cMotivo` 1/2/9, Id "PRE"+chave+101101+nº), tabela `fiscal_eventos`, DANFSe gerado pelo sistema
(NT 008, "NFS-e SEM VALIDADE JURÍDICA" na homologação), validação contra o XSD oficial (baixar os XSD para o repositório),
consulta opcional da calculadora pública (`ind_gIBSCBS`, com cache), aviso de vencimento pelos avisos da Dolores
(hoje só na tela), troca do gatilho da 0154 (só na homologação com o dono).

### Como testar
- Automático: `npx vitest run server/fiscal --maxWorkers=2 --minWorkers=1` (inclui `certificado.test.ts` e
  `emissao-fundacao.test.ts`; certificados de **teste** gerados com `openssl` no próprio teste; PGlite com 0154 + 0162 duas
  vezes; servidor HTTPS falso local; nenhuma rede externa).
- Manual (depois da migração 0162 e da publicação): Jurídico › Certificados digitais → no cartão do A1, "Usar também para
  emitir notas fiscais" → marcar a caixa → "Guardar para emitir notas" → em Configurações › Integrações, cartão
  "Certificado A1 — emissão de NFS-e" mostra titular/CNPJ/validade/impressão digital; "Testar conexão" com emissor
  desligado responde que nada foi enviado.

### File List (esta parte)
- `drizzle/0162_fiscal_certificados.sql` (novo) · `drizzle/schema-fiscal.ts` (tabelas novas)
- `server/fiscal/certificado.ts`, `certificado-router.ts`, `dps.ts`, `assinatura.ts`, `sefin.ts` (novos)
- `shared/fiscal/dps-campos.ts` (novo)
- `server/fiscal/certificado.test.ts`, `emissao-fundacao.test.ts`, `certificados-teste.helper.ts` (novos, só teste)
- `server/integracoes-router.ts` (monta `certificadoFiscal`)
- `client/src/components/admin/CertificadoFiscalCard.tsx` (novo) · `client/src/pages/admin/AdminIntegracoes.tsx`
- `client/src/components/admin/CertificadosJuridico.tsx` (botão "Usar também para emitir notas fiscais") ·
  `client/src/lib/certificados-digitais.ts` (`pfxParaEmissao`) · `client/src/pages/admin/AdminJuridico.tsx` (`?aba=certificados`, prop `admin`)
- `package.json` / `pnpm-lock.yaml` (`xml-crypto` 6.4.0, MIT)

### Change Log
- 22/11/2026 — @dev: fundação da emissão (cofre do A1 com envio pelo Jurídico, DPS v1.01 em duas variantes, assinatura,
  cliente mTLS), tudo desligado. Status segue Draft→InProgress (parte do dono pendente).
