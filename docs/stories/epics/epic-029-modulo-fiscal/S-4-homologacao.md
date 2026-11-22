# S-4 — Homologação na API Nacional (produção restrita)

**Status:** Draft · **Epic:** EPIC-029 · **Etapa:** 4 · **Tamanho:** XL · **Migração:** `0156_fiscal_emissao.sql`
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
