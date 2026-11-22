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

## Retomada Codex — 22/11/2026

- Integradas main 9e8a7e3 e marca proporcional d53250f nesta branch. Conflitos de api/index.ts e ROADMAP resolvidos preservando Fiscal e Jurídico. package.json/lockfile intactos.
- Prévia recebe titular/documento do certificado selecionado.
- Revisão identificou uma corrida na conclusão INICIAL do retorno pelo portal: a base podia mudar enquanto a rede era consultada. Agora o lote trava o contrato e só promove o documento se a base ainda for a última validada e o status esperado ainda conferir. Incluído teste específico. Upload da empresa também preserva contrato já concluído durante a consulta.
- Automáticos até este checkpoint: 98/98 testes focados aprovados antes do ajuste da corrida. Regressão após ajuste, suíte completa, TypeScript e build em execução.
- Ambiente local reaproveita dependências existentes e versões declaradas. Instalação frozen com pnpm 10.4.1 interrompida por lentidão de download, sem mudança de lock. Pacotes faltantes locais instalados fora do checkout.
- Migração 0161 ainda NÃO aplicada. Produção ainda sem esta frente. Próximo passo: terminar checks, revisão automática do PR Completed e achados, aplicar migração, merge e validar produção/API/login. Docs de independência ainda pendentes.

### Checkpoint da verificação e migração

- 98/98 testes focados originais aprovados. Novas regressões de concorrência e CMS não suportado aprovadas. PKI atualizado 28/28, incluindo e-CNPJ com CPF do responsável no SAN (CNPJ prevalece em ambas as ordens).
- Checagem TypeScript concluída sem erros. Primeiro preview da integração e preview 6ea7928 READY na Vercel, com build completo aprovado. Build local interrompido por limite de memória, sem mudança de configuração do projeto.
- Marca rasterizada em PDF sintético em 50%, 100% e 160% e inspecionada visualmente. Texto, margem e borda acompanham a escala. Nenhum certificado/contrato real foi usado.
- Migração 0161 APLICADA no Neon plain-cake-26372935/neondb. Tabela e ambos os índices confirmados. Só CREATE TABLE/INDEX IF NOT EXISTS.
- PR #308 aberto. Revisão Codex da versão atual solicitada. Suíte completa em execução, por lotes: 13 arquivos iniciais aprovados preservados e restantes com quatro workers; resultados ficam nos logs temporários. Não afirmar suíte completa aprovada até terminar.
- Próximo passo: terminar suíte, resolver achados da revisão, atualizar preview se preciso, merge/produção e smoke da API. Depois PRs de docs de independência dos sistemas.

### Revisão automática do PR #308

Achado P1 (thread PRRT_kwDOR_rShc66mxhV): a largura final do traço podia esconder uma largura anterior espessa. Corrigido com captura da largura em cada S, pilha q/Q, uma borda fina e cores escuras. Quatro vetores (branco espesso, espesso seguido de reset, estado q/Q e branco fino) agora são recusados. Testes P1 e A1 da marca legítima aprovados (2/2). Correção do e-CNPJ tem 28/28 PKI aprovados. Ajuste de compatibilidade TypeScript para Array.from(Set), sem alterar tsconfig. Checagens finais continuam em execução.

### Segunda rodada de segurança e isolamento dos testes

- Novo P1 da revisão (PRRT_kwDOR_rShc66m0pf): ajustes TJ/avanço Tj podiam pintar fora da caixa medida. Agora TJ é recusado e cada BT/ET aceita uma única linha Tj. As fontes usadas pela marca precisam ser Helvetica Type1 com encoding padrão e sem remapeamentos/métricas personalizadas. Testes dos vetores de deslocamento e da marca legítima aprovados (3/3).
- A revisão automática de execução BLOQUEOU a suíte geral ao detectar tentativa de conexão real à Anthropic, sem payload identificado. Não foi contornada. Alternativa segura: preloader local /tmp/juridico-sem-rede.cjs bloqueia HTTP(S)/fetch e conexão TCP externos e permite somente loopback para testes locais. Prova de bloqueio HTTPS/fetch ao domínio externo executada, sem enviar requisição. Suíte restante reiniciada com essa proteção; arquivos já aprovados preservados (41). Não persistir esse harness temporário como configuração do produto.
- Pendência de tempo em incorporacao-logotipo.test.ts (5 s) deve ser repetida isoladamente com rede bloqueada. Toda falha nova ainda precisa ser analisada. A suíte focada final do Jurídico anterior à segunda rodada passou 100/100. Não marcar suíte geral como aprovada antes da conclusão.

### Terceira rodada da revisão de marca

P1 PRRT_kwDOR_rShc66m3hH: o estado da fonte podia ser herdado após Q. A marca suportada passa a exigir Tf e Tm explícitos em cada BT/ET e recusa q/Q dentro de texto. Isso elimina herança não modelada de fonte e posição. Regressões P1 (traçado, TJ, avanço Tj, fonte e estado Q) + marca legítima aprovadas (4/4). TypeScript novamente em execução. Nenhum serviço pago foi chamado por estes testes. Suíte geral continua com rede externa bloqueada; tempo excedido do teste de logotipo foi refeito isoladamente e 17/17 passaram.

### Conferência da marca e resultado da suíte

- PR #308. O desenho usa o controle de tamanho proporcional e o formulário de importação fica na aba Certificados digitais.
- A validação passou a exigir o perímetro de um único retângulo e o conjunto exato de textos, tamanhos, posições e espessura do layout compartilhado com o assinador. Isso recusa texto sobreposto e reconhece a quebra de nomes longos que o assinador produz. Regressões dos arquivos afetados: 45/45. A bateria focada anterior ao último ajuste passou 105/105 em 10 arquivos, incluindo PKI e imports ESM. TypeScript sem erros no último ajuste. Preview do commit 351e50f READY.
- Na suíte geral houve 22 falhas da Central de Vendas reproduzidas na main 9e8a7e3, além de uma falha preexistente de rótulo ajustada no teste. A falha do aviso de grupo da Dolores também foi reproduzida na mesma main. Um teste do transporte PKI barrado pelo isolador geral passou no teste focado que usa servidor de loopback.
- Último lote da suíte geral reaproveita resultados dos arquivos concluídos e repete com dois workers os arquivos que o primeiro lote interrompeu. O relatório não deve descrever a suíte geral como verde.
- A migração 0161 está aplicada. A API atual, antes do merge, respondeu 200 com Neon conectado. Falta revisar o commit atual, mesclar e verificar a produção dessa versão.

### Publicação do Jurídico

- PR #308 mesclado em `27c4ed170feb33863b7012874f301abcfc1ccefc` após revisão Codex Completed sem apontamentos abertos. Produção Vercel `dpl_5RHRmycy9qgXomsZeEfxdPmEcGZH` READY com esse commit.
- Migração 0161 aditiva aplicada no Neon. No domínio oficial, `/login`, `/admin/juridico`, `/api/health` (Neon conectado) e `/api/trpc/auth.me` (sem sessão) responderam 200. Sem erros fatais ou de execução no período consultado para este deploy.
- A conferência automática funciona para novos documentos no fluxo do Jurídico. Falhas temporárias ficam pendentes e retornos externos ainda exigem confirmação. Os testes usaram certificados sintéticos e a checagem de produção não usou credenciais pessoais nem assinou contratos reais.
- Decisão de 22/11/2026: Prospecta e Santa Fé independentes. A documentação de ambos registra a decisão. O Jurídico foi entregue na Prospecta.
