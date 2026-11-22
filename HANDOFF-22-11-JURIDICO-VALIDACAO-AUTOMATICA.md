# Jurídico — validação automática e ajustes da assinatura

**STATUS (22/11/2026, Claude/AIOX @dev):** itens 2 a 11 implementados e testados nesta branch. O item 1 (marca proporcional)
foi para outra frente (`claude/juridico-marca-proporcional`). O item 12 (contrato real da Maylanne) NÃO foi feito. As correções
do portão de QA (A1, A2, M1, M2, M3 e B1 a B4) foram aplicadas, cada uma com teste; **falta o novo portão de QA**. A migração
0161 foi criada e **NÃO foi aplicada**. Nada foi publicado, mesclado ou migrado. Nenhum e-mail real, nenhum contrato real e
nenhuma chamada de rede real nos testes.

Branch: `codex/juridico-validacao-automatica-2211` (base main `1524c18`). Commits desta etapa: `825265f` (núcleo PKI,
relatório, retentativa), `b0b7421` (testes), `02789aa` (cadeia antes de assinar, aba de certificados, exibição, retentativa na
tela), `7a77bbd` (correções do QA) e o commit deste handoff.

## Pedido e autorização do dono (sem mudança)

1. Automatizar a conferência técnica do PDF no fluxo de assinatura: integridade, cadeia ICP-Brasil e revogação, com o
   resultado salvo junto ao documento. Falha ou inconclusão aparece como pendência, nunca como aprovação.
2. Marca da assinatura proporcional por inteiro (prints IMG_4200/IMG_4201). **Agora na frente `claude/juridico-marca-proporcional`.**
3. Importação do certificado só na aba Certificados digitais; sem certificado, a janela orienta a ir para essa aba.
4. Migração aditiva, merge e produção autorizados quando passar nos checks. Preservar as correções do Fabel. Nunca enviar
   e-mail real nem assinar contrato real em teste.

## O que foi entregue (por item)

- **Download PKI seguro** (`server/juridico-pki-download.ts`). Uma `SessaoPki` por conferência, com:
  - prazo total de 18 s (inclui DNS, conexões e redirecionamentos);
  - até 12 requisições e 24 MiB por sessão, 10 MiB por resposta e 4 downloads simultâneos no processo;
  - só http/https em porta padrão, sem usuário/senha, sem IP literal (v4/v6) e com nome de domínio completo;
  - resolução SÓ em IPv4, e todos os IPs precisam ser públicos (redes privadas/reservadas bloqueadas, IPv6 recusado);
  - IP fixado na conexão (o lookup trata `all: true`);
  - redirecionamento reconferido, no máximo 2, e HTTPS→HTTP recusado.
  Só recebe URLs AIA/LCR de certificados em conferência. O AIA só é seguido quando o emissor declarado é da hierarquia das
  raízes confiáveis (O= da raiz; nas oficiais, ICP-Brasil).
- **Cadeia e revogação** (`server/juridico-pki.ts`).
  - Montagem própria (certificados fornecidos → raízes → AIA) + `CertificateChainValidationEngine` do PKIjs 3.4.0: folha por
    último em `certs`, sem duplicata de raiz/folha, `certificatePath` folha→raiz conferido.
  - Regras que o PKIjs não aplica: extensão crítica desconhecida (pendente manual), pathLen, CA com keyCertSign, keyUsage e EKU
    da folha (e-mail, qualquer, assinatura de documento), política ICP-Brasil A1–A4 quando a raiz é oficial, CPF/CNPJ pelo SAN
    otherName (2.16.76.1.3.1/3.3) com o CN como alternativa.
  - LCR: emissor certo com cRLSign, assinatura válida, thisUpdate/nextUpdate, sem delta, sem extensão crítica desconhecida, IDP
    compatível (onlyUser/onlyCA/URI), entradas com crítica desconhecida recusadas.
  - Cache por URL+emissor até o nextUpdate (máx. 6 h, 32 itens, 48 MiB).
  - Algoritmo não suportado pelo WebCrypto (ex.: secp256k1) → pendente manual.
- **Verificação** (`server/juridico-verificar-assinaturas.ts`). Por assinatura: ByteRange, /Contents, um único signerInfo e
  integridade CMS. Por documento: cobertura total. Estados `valida`/`pendente`/`invalida`, com `transitoria`. Falha de rede
  nunca vira inválida, timeout nunca vira válido. A regra antiga de partes e testemunhas foi preservada.
- **Endpoint de cadeia** (`server/juridico-cadeia.ts` + `juridico.montarCadeia`, admin).
  - Só aceita certificado DER estrito (sem bytes extras; PFX recusado) e até 5 da cadeia; 12 chamadas a cada 10 min por usuário.
  - No navegador, `assinarPdf(..., montarCadeia)` inclui os intermediários em `signer.certificateChain` antes de assinar
    (`incluirIntermediarios`, sem duplicar). Senha, PFX e chave não saem do navegador.
- **Upload `assinatura_digital`** (`server/juridico-router.ts`).
  - `documentoOrigemId` é obrigatório: contrato gerado ou anexo do mesmo contrato.
  - `relatorioEmpresa` confere integridade, cadeia e LCR, e que o titular da última assinatura é a Parte A.
  - Confere também o vínculo com a origem: prefixo idêntico + conteúdo conservado. Só a marca visível do titular pode entrar
    (`server/juridico-marca-conferencia.ts`).
  - Inválido ou pendente nunca recebe rótulo de validado. O upload normal e o original ficam preservados.
- **Persistência** (`server/juridico-validacao.ts` + `drizzle/0161_juridico_validacao_assinaturas.sql`).
  - Relatório por documento com SHA-256, origem, horário, tentativas e `execucao` (token), gravado no MESMO lote do
    documento, do arquivo e do status.
  - Sem a migração, nada é gravado e o fluxo continua; o resultado volta na resposta.
  - Se o lote falhar com o Drive ativo, a cópia vai para a lixeira.
- **Exibição** (`client/src/components/admin/ValidacaoAssinatura.tsx` no detalhe do contrato, `AdminJuridico.tsx`).
  - Mostra válida/pendente/inválida, titular(es), motivo, horário e próxima tentativa, com o aviso "não é o relatório oficial
    do VALIDAR/ITI".
  - As fases "Assinado pela empresa" e "Assinado por todos" continuam separadas.
  - Os avisos depois de assinar refletem o resultado real (`client/src/lib/juridico-conferencia.ts`).
- **Aba de certificados** (`CertificadosJuridico.tsx`). Sem certificado, a janela mostra o aviso e o botão "Ir para
  Certificados digitais", que troca para a aba existente. O formulário de importação fica só na aba.
- **Retentativa** (`server/juridico-revalidacao.ts`).
  - Roda ao abrir o contrato (a tela chama `juridico.revalidarDocumento`) e no cron diário existente `/api/cron/lead-card-due`
    (até 10 s, nunca lança).
  - Esperas de 10 min, 30 min, 2 h, 6 h e 24 h. Teto de 6 tentativas e 7 dias, aplicado NA reserva; no teto vira pendência
    manual. Try/catch por documento.
- **Portal** (`salvarRetornoContrato`).
  - Base = última `assinatura_digital` cuja conferência gravada é `valida` com vínculo `conferido`.
  - Conclui sozinho só com todas as identidades + revisão da empresa conservada (P1 da PR #297 mantido).
  - A retentativa só conclui se o contrato ainda está `em_conferencia` e a base ainda é a última assinatura válida da empresa.
  - Limite de 6 envios por hora por cliente.
- **Paridade**: pendência registrada no fim de `docs/stories/epics/ROADMAP.md`. O Santa Fé não foi tocado.

## Migração (para o Neon — NÃO aplicada)

`drizzle/0161_juridico_validacao_assinaturas.sql`. Número 0161 porque o maior da main é 0160 e a faixa 0154–0159 está reservada
à frente fiscal; conferir de novo com `git fetch` antes de aplicar. Aditiva e idempotente:
`CREATE TABLE IF NOT EXISTS portal_contract_document_validacoes` com document_id (PK → portal_contract_documents, ON DELETE
CASCADE), estado (CHECK valida/pendente/invalida), origem (CHECK), sha256 (char(64) hex), relatorio jsonb, verificado_em,
tentativas, proxima_tentativa, primeira_em, execucao, versao e atualizado_em, mais um índice parcial das pendentes.
Reversão: `DROP TABLE`.

## Pendências

- **Novo portão de QA** sobre o commit das correções (A1, A2, M1, M2, M3 e B1 a B4).
- Item 1 (marca proporcional) está na outra frente. Quando ela mudar o desenho, conferir que `desenhoSoDaMarca` continua
  aceitando a marca. Operadores permitidos: q/Q, cores, w, m/l/h/S/re, BT/ET, Tf/TL/Tm/Td, Tj/TJ; texto do vocabulário da
  marca; tudo dentro da caixa.
- Item 12 (contrato real da Maylanne): não feito, porque não há acesso autorizado ao PDF real.
- Não há OCSP nem carimbo de tempo: a conferência vale para a data da consulta, não é histórica. Uma âncora de confiança
  assinando diretamente (raiz como folha) é aceita sem LCR; isso só acontece com raízes de teste.
- A política ICP-Brasil (A1–A4) só é exigida com as raízes oficiais. Sem certificado ICP real nos testes, essa regra tem só o
  teste negativo de unidade.
- Antes de publicar: revisão automática Codex do PR, preview e smoke de `/api/health` e `/api/trpc/auth.me` (por causa do
  incidente do import JSON).

## Verificações desta etapa

(a) Automáticos:
- `npx tsc --noEmit -p .`: sem erros. Os 3 TS2802 do rascunho foram corrigidos com `Array.from`, sem mexer no tsconfig.
- Testes focados com `npx vitest run`:
  - `server/juridico-pki.test.ts`: 27/27;
  - `server/juridico-validacao.test.ts`: 30/30;
  - `server/juridico-assinatura-cadeia.test.ts`: 3/3;
  - aprovados também `juridico-certificados`, `juridico-pdf-db`, `juridico`, `juridico-modelos` e `juridico-formulario`. Os
    testes antigos de raízes sintéticas continuam valendo (integridade + raízes + todas as partes).
  - Dois testes antigos de `juridico-pdf-db.test.ts` passaram a informar `documentoOrigemId` (exigência A2), sem apagar asserções.
- Suíte completa e `npx vite build`: resultado na seção "Resultado final", abaixo.
- Cobertura nova:
  - ICP sintética real (OpenSSL + PKIjs): válida, revogada, intermediária revogada, vencida, indisponível, prazo esgotado, LCR
    adulterada/de outro emissor/vencida/delta/IDP, CA sem cRLSign, pathLen, EKU, SAN, secp256k1 e outro emissor;
  - SSRF: IPs privados/reservados/IPv6, redirecionamentos, limites, concorrência e IP fixado (com servidor local);
  - PDF: múltiplas assinaturas, testemunha, byte alterado, conteúdo depois da assinatura, ByteRange manipulado, dois signerInfos;
  - upload: relatório atômico, sem migração, A1 ("VALOR ALTERADO 999", retângulo preenchido), A2, retentativa, corrida, teto
    M3, M2 e portal.

(b) Manuais: nenhuma validação visual em navegador nesta etapa (não há navegador no executor).

(c) Produção: nada publicado, nada migrado. Falta: aplicar a 0161 no Neon, preview, smoke da API e do login, assinatura real
de teste pelo dono e conferência do resultado no detalhe do contrato.

## Resultado final

(preenchido no commit seguinte com a suíte completa e o build)

## Próximo passo exato

1. Pedir o novo portão de QA (@qa) sobre esta branch.
2. Corrigir os achados.
3. Rodar `git fetch` e reconferir o número 0161.
4. Abrir o PR (por @devops), esperar a revisão Codex "Completed" e ler os comentários.
5. Aplicar a 0161 no Neon (aditiva), mesclar, conferir a Vercel e fazer o smoke de `/api/health` + `/api/trpc/auth.me`.
6. O dono assina um contrato de teste e confere o selo.
