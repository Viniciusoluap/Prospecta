# HANDOFF 22/11 — Jurídico: CONTINUIDADE (leia este primeiro)

Escrito pela sessão Claude em 22/11 porque os créditos do dono estão acabando. Complementa
`HANDOFF-22-11-JURIDICO-VALIDACAO-AUTOMATICA.md` (especificação original do Codex — continua valendo).
**Nada desta frente foi mesclado, publicado ou migrado.** Produção continua igual à `main` (`1524c18`).

## Autorização do dono (vale para quem continuar)
- Implementar tudo, migração ADITIVA no Neon, merge e produção **já autorizados** quando passar nos checks
  ("Já está autorizado, pode tacar o pau na máquina" — 22/11).
- **Não atrapalhar outro chat** que trabalha em paralelo na Prospecta: mexer só nos arquivos do Jurídico,
  não mexer em Dolores/maquete/fiscal (EPIC-027/028/029), package.json ou lockfile; integrar sempre com a `main`
  mais recente sem sobrescrever o trabalho dele.
- **Paridade com o Grupo Santa Fé CANCELADA** a partir de 22/11 (decisão do dono): NÃO portar o Jurídico para lá.
  Ao final desta frente, abrir PR só de docs trocando a seção "Paridade obrigatória" do `CLAUDE.md` dos DOIS
  repositórios por "Sistemas independentes desde 22/11/2026 (decisão do dono)" e marcar as pendências de paridade
  abertas do ROADMAP da Prospecta como "canceladas — decisão do dono em 22/11".

## Branches (todas no GitHub)
1. `codex/juridico-validacao-automatica-2211` — frente principal (servidor + tela). Commits:
   - `825265f` núcleo PKI (cadeia ICP-Brasil, LCR, download seguro), relatório por documento, retentativa;
   - `b0b7421` testes (ICP sintética, rede simulada);
   - `02789aa` cadeia montada antes de assinar (endpoint autenticado, só certificado público), importação só na aba
     Certificados digitais, resultado da conferência nos documentos, revalidar pela tela;
   - `7a77bbd` + seguintes: correções do QA (em andamento — ver abaixo).
   - Migração criada e **NÃO aplicada**: `drizzle/0161_juridico_validacao_assinaturas.sql` (só CREATE TABLE/INDEX IF NOT
     EXISTS). Antes de aplicar, `git fetch` e conferir se a `main` não ganhou outra 0161 do outro chat (se sim, renumerar).
2. `claude/juridico-marca-proporcional` — item 1 (marca da assinatura proporcional por inteiro: texto, borda e
   espaçamento escalam; prévia e PDF usam a mesma função `client/src/lib/marca-assinatura.ts`). Feita a partir de
   `825265f`; precisa ser mesclada na branch principal (conflito possível só em `client/src/lib/certificados-digitais.ts`,
   bloco de desenho dentro de `assinarPdf` × `signer.certificateChain`).

## ATUALIZAÇÃO (fim da sessão Claude, 22/11)
- **Todos os 9 achados do QA (A1, A2, M1, M2, M3, B1, B2, B3, B4) foram CORRIGIDOS e têm teste** no commit `7a77bbd`
  (testes em `server/juridico-pki.test.ts` e `server/juridico-validacao.test.ts`; nova `server/juridico-marca-conferencia.ts`).
  Ressalvas: política ICP A1–A4 só com teste negativo (sem certificado ICP real); B2 no CMS sem teste próprio; B4 (lixeira no
  Drive) sem teste. Lacunas de teste listadas pelo QA também cobertas.
- Últimos resultados: `tsc` 0 erros; focados `juridico-pki` 27/27, `juridico-validacao`+`certificados`+`pdf-db` 45/45,
  `juridico-assinatura-cadeia` 3/3, `imports-esm` 2/2; `npx vite build` OK (e bundle ESM do api/index.ts OK).
  **Suíte completa NÃO terminou** (interrompida com 189 aprovados, 0 falhas até ali) — rodar até o fim.
- Marca proporcional (branch `claude/juridico-marca-proporcional`, `d53250f`): pronta, 9/9 testes novos + 7/7 certificados;
  suíte completa e build não rodaram lá. Falta passar `titular`/`documento` de `CertificadosJuridico.tsx` para
  `PosicionarAssinaturaPdf`. Mudança visível: fonte da marca no A4 100% vai de ~9pt para ~11–16pt. Limite: A5 a 50% com nome
  longo ~3,8pt.
- **Portanto o próximo passo começa no item 3 abaixo** (mesclar a marca), seguido do NOVO portão de QA (item 4).

## Portão de QA (revisão de segurança do commit 825265f) — NEEDS_WORK (histórico; corrigido em 7a77bbd)
Aprovado (não mexer): SSRF do download, vazamento (PFX/senha só no navegador), auth das rotas, migração 0161, corrida
entre retentativas.
A corrigir (cada um com teste):
- **A1 ALTO** `server/juridico-validacao.ts:75-76` — vínculo com a origem só confere prefixo; atualização incremental
  que altera a página antes de assinar passa como válida. Correção: além do prefixo, `mesmoConteudo(origem.bytes, bytes)`;
  se divergir → `vinculoOrigem="divergente"`, `estado=invalida`. Teste de regressão: origem + texto "VALOR ALTERADO 999"
  + assinatura da Parte A ⇒ inválida.
- **A2 ALTO** `server/juridico-workflow.ts:23-25`, `juridico-validacao.ts:96-101` — base do retorno do portal é o último
  `assinatura_digital` qualquer. Correção: base só se validação gravada `estado='valida'` e `vinculoOrigem='conferido'`;
  `documentoOrigemId` obrigatório para `assinatura_digital` (`juridico-router.ts:163`); sem base válida, sem conclusão automática.
- **M1** `server/juridico-pki.ts:82-101` — EKU da folha não conferido. Aceitar EKU ausente ou com emailProtection/
  anyExtendedKeyUsage; recusar só serverAuth/timeStamping. Ideal: políticas ICP-Brasil A1/A3 e CPF/CNPJ do SAN otherName
  (2.16.76.1.3.1 / 2.16.76.1.3.3).
- **M2** `server/juridico-revalidacao.ts:62-69` — revalidação conclui com estado antigo. Gravar `documentoBaseId` e status
  esperado; UPDATE exige que ainda seja o último `assinatura_digital` e `signature_status='em_conferencia'`.
- **M3** `server/juridico-revalidacao.ts:37-40`, `85-90` — reserva sem teto: `tentativas < 6` e 7 dias no WHERE;
  try/catch por documento; esgotado/pendente final ao bater o teto.
- **B1** seguir AIA só para emissor conhecido da hierarquia ICP-Brasil (ou lista de domínios) e limitar envios do portal.
- **B2** algoritmo não suportado pelo WebCrypto ⇒ pendente manual, não "inválida".
- B3 (opcional) recusar redirect https→http. B4 (opcional) arquivo órfão no Drive se o batch falhar.
- Lacunas de teste: juridico-validacao/revalidacao/cadeia; conteúdo após a última assinatura ⇒ `estado=invalida`;
  ByteRange manipulado; dois signerInfos; intermediária revogada; LCR delta/IDP; CA sem cRLSign; pathLen; EKU.
Situação de cada achado no momento da parada: ver o último commit `wip(juridico): estado ao parar` da branch principal
(se existir) e rodar os testes — **considere pendente tudo o que não tiver teste passando**.

## Fora do escopo agora
Item 7 do handoff original (contrato real da Maylanne): não há o PDF; não pedir senha/certificado em chat.

## Próximo passo exato (para o Codex ou outra sessão)
1. Checkout limpo de `codex/juridico-validacao-automatica-2211`; `pnpm install --frozen-lockfile`.
2. `npx tsc --noEmit -p .` e `npx vitest run server/juridico*` — ver o que falta do QA acima; terminar A1, A2, M1, M2, M3,
   B1, B2 com testes.
3. Mesclar `origin/claude/juridico-marca-proporcional` nesta branch e resolver o conflito em `certificados-digitais.ts`.
4. Novo portão de segurança (repetir a revisão acima) até aprovar.
5. Mesclar `origin/main` mais recente (preservar o outro chat); tsc + vitest completo + `npx vite build`.
6. Aplicar `0161` no Neon de produção (projeto `plain-cake-26372935`), conferindo antes o número.
7. PR → esperar revisão Codex **Completed**, corrigir achados reais → merge → conferir Vercel READY, `/api/health` 200,
   `/api/trpc/auth.me` 200 sem sessão e `get_runtime_errors` (incidente de 22/11: não remover `with { type: "json" }`).
8. PR de docs encerrando a paridade (ver Autorização acima).

## Testes
(a) automáticos: testes PKI/conferência com ICP sintética passaram em 825265f (QA rodou 29/29 focados); o estado das
correções do QA e da marca está no último commit de cada branch. (b) manuais: nenhum. (c) produção: nada publicado.
