# HANDOFF 23/11 — Jurídico: cadeia ICP-Brasil do A1 (bug "não pertence a uma cadeia ICP-Brasil")

## Causa
O A1 da Prospecta (AC SAFEWEB RFB v5) só tem AIA na folha (`http://repositorio.acsafeweb.com.br/ac-safewebrfb/ac-safewebrfbv5.p7b`).
As AC de 1º/2º nível da ICP-Brasil (AC SAFEWEB RFB v5, AC Secretaria da RFB v4, AC Certisign RFB G5…) NÃO têm AIA.
O `montarCadeia` antigo só procurava emissor nas raízes, nos certificados fornecidos e no AIA, e do .p7b guardava só o
emissor direto. No 2º salto (AC SAFEWEB RFB v5 → ?) não havia AIA → `invalida` "não pertence…" (não transitória, então
sem retentativa). Mesma causa no envio da cadeia antes de assinar (o PDF saiu sem os intermediários).

## Feito (branch `juridico-cadeia`)
- `server/certificados/icp-intermediarias.json` (128 AC públicas, conferidas por assinatura até `icp-raizes.json`) + `README.md`
  (fonte, SHA-256, como atualizar) + gerador `scripts/icp-intermediarias.mjs`.
- `server/juridico-pki.ts`: `encontrarCaminho` (raízes → fornecidos → embarcadas → AIA; todo o .p7b vai para o pool),
  `certificadosPublicos` lê DER/PEM/PKCS#7 (DER ou PEM) e PEM com vários blocos, `completarCadeiaIcp` exportada (cofre fiscal).
- "Conferir novamente" (admin): `juridico.revalidarDocumento({documentId, manual:true})` reconfere documento pendente OU
  inválido pelos mesmos bytes (SHA-256), 1x/minuto; botão em `ValidacaoAssinatura`.

## Testes
- (a) automáticos: `server/juridico*` 10 arquivos / 120 testes OK (novo `server/juridico-cadeia-icp-real.test.ts`, 16, com a
  cadeia real; teste de reconferência manual em `server/juridico-validacao.test.ts`); `tsc --noEmit` OK; `vite build` OK.
- (b) manuais: nenhum.
- (c) pendente em produção: abrir "Contrato - Maylanne" e clicar "Conferir novamente". Esperado: cadeia conferida. A LCR
  ainda depende da rede da Vercel: AC SAFEWEB RFB v5 → `http://www.receita.fazenda.gov.br/acrfb/acrfbv4.crl`, RFB v4 →
  `http://acraiz.icpbrasil.gov.br/LCRacraizv5.crl`. Se bloqueadas fora do Brasil, o resultado fica "pendente" (retentativa
  automática), não "inválido".

## Próximo passo
1. Merge/publicação; 2. "Conferir novamente" no contrato; 3. se a LCR ficar pendente, ver os logs da Vercel (hosts acima);
4. cofre fiscal: usar `completarCadeiaIcp(folha, intermediarios, { semRede: true })` em `server/fiscal/certificado.ts`
   (`cadeiaChegaNaIcp`) — não feito aqui (fora do escopo / EPIC-029). Paridade Santa Fé: registrar no ROADMAP se o Santa Fé tiver a mesma conferência.
