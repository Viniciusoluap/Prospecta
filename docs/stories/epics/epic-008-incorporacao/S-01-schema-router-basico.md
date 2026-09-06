# Story S-01 — Schema (Reconciliado) + Router CRUD Básico + Lista/Detalhe Admin
**Epic:** EPIC-008
**Status:** Done
**executor:** @dev
**quality_gate:** @dev
**quality_gate_tools:** [tsc, build, test, manual-review]

## Contexto

Primeira story do maior épico da trilha (EPIC-008, deixado por último de propósito pelo tamanho). O Grupo Santa Fé tem um módulo de incorporação imobiliária com ~24 sub-etapas (terreno, topografia, urbanismo, mercado, massa, quadro de áreas, orçamentos, negociação, business plan, projetistas, aprovação, registro, lançamento, fornecedores, material publicitário, projetos executivos, cronograma de obra, atendimento a clientes), cada uma um campo JSON no modelo `EstudoIncorporacao`. Em produção (Neon, projeto SiteProspecta) já existe a tabela `incorporation_studies`, vazia (0 linhas), sem nenhum código associado, com estrutura já traduzida para inglês e batendo campo-a-campo com o modelo do Santa Fé — confirmado via `describe_table_schema`/`information_schema.columns` antes de qualquer alteração. Esta story reconcilia essa tabela com o Drizzle e entrega o CRUD básico (identificação do estudo + situação), deixando os ~24 módulos JSON para stories futuras (S-02 em diante).

## Acceptance Criteria

- [x] AC-01: `drizzle/schema.ts` declara `incorporationStudies` com todas as colunas já existentes em produção, com tipos/tamanhos conferidos um a um contra `information_schema.columns` (não apenas contra o resumo de `describe_table_schema`, que omite `character_maximum_length`)
- [x] AC-02: Migration gerada (`0006_create_incorporation_studies.sql`) permanece no journal normal do Drizzle (para que um banco novo/preview crie a tabela do zero) — mas em produção, onde a tabela já existe, o hash da migration foi registrado manualmente em `drizzle.__drizzle_migrations` **sem executar o `CREATE TABLE`** (que falharia com "already exists")
- [x] AC-03: Router `incorporacao` (`list`/`getById`/`create`/`update`) cobrindo apenas os campos identificadores (name/city/state/address/latitude/longitude/responsible/status/propertyRef) — os ~24 campos `*_json` ficam de fora do escopo desta story, sem nenhum procedure fingindo suportá-los
- [x] AC-04: `/admin/incorporacao` (lista com filtro por situação e criação) e `/admin/incorporacao/:id` (edição dos campos identificadores) — rotas admin-only
- [x] AC-05: `tsc --noEmit`, `npm run build` e `npm test` passam limpos

## Decisões de implementação (adaptações deliberadas, não invenção)

- **Reconciliação de migration com tabela pré-existente**: diferente de toda tabela criada até agora nesta trilha (imoveis/avaliacoes/agregador_imoveis, todas genuinamente novas), `incorporation_studies` já existia em produção antes desta story — criada fora desta trilha, por decisão do dono do produto (ver `ROADMAP.md`, decisão #1). A migration gerada pelo `drizzle-kit generate` fica normalmente no journal (para que um ambiente novo — preview, staging, outro dev — crie a tabela do zero corretamente), mas **não foi executada em produção**: em vez disso, seu hash sha256 foi inserido manualmente em `drizzle.__drizzle_migrations` (mesmo padrão de registro manual já usado nas migrations anteriores deste projeto, já que o migrator automático do Drizzle está com problema conhecido nesta stack). Isso evita tanto recriar a tabela do zero (perderia a estrutura, mesmo vazia) quanto um erro de "relation already exists" numa futura tentativa de `drizzle-kit migrate`.
- **Larguras de coluna conferidas em detalhe**: o resumo do `describe_table_schema` não mostra `character varying(N)` — só "character varying" — então cada `varchar` foi conferido individualmente via `information_schema.columns` antes de declarar o schema, para não gerar um diff futuro incorreto (ex.: `city` é `varchar(120)` em produção, não `varchar(100)` como eu havia assumido inicialmente).
- **Escopo do router restrito aos campos identificadores**: os ~24 campos `*_json` (terreno, urbanismo, mercado, massa, orçamentos, etc.) já existem na tabela e foram declarados no Drizzle, mas o router desta story **não** expõe nenhum procedure para lê-los/escrevê-los — cada um será uma story futura própria (S-02 a S-12 no `EPIC.md`), com sua própria validação zod e lógica de negócio replicada do Santa Fé. Expor um "update genérico de qualquer campo JSON" agora seria inventar uma superfície de API sem lógica de negócio por trás — evitado deliberadamente.
- **Sem seletor de mapa**: mesma adaptação já usada em EPIC-001 S-03 — o formulário de criação/edição usa campos de texto simples (endereço) em vez de um seletor de localização em mapa (o Santa Fé usa Leaflet); latitude/longitude ficam disponíveis no schema e no router para quando uma story futura precisar deles (ex.: terreno/geometria), mas não têm campo de UI nesta story por não serem necessários ainda.
- **Somente admin**: o módulo de incorporação no Santa Fé é `requirePageRole(session, "admin")` — decisão de negócio de alto nível, não operacional do dia a dia de corretores/colaboradores. Replicado como `requireRole(ctx, ["admin"])` em todos os procedures.

## Validação — honestidade de status (regra do dono do produto)

**Testado automaticamente:** `tsc --noEmit` limpo, `npm run build` limpo, `npm test` (75/75 passando, sem regressão). Estrutura da tabela conferida campo-a-campo contra produção antes e depois da declaração no Drizzle (`describe_table_schema` + `information_schema.columns`). Hash da migration registrado e confirmado via `SELECT * FROM drizzle.__drizzle_migrations`.

**Não testado de ponta a ponta:** criação real de um estudo via UI em ambiente rodando — mesma limitação de rede do sandbox documentada em todas as stories anteriores (não é possível conectar diretamente ao Neon nem acessar a URL de preview do Vercel a partir deste ambiente). **Recomendação:** validar após o deploy, criando um estudo de teste e confirmando que a linha aparece corretamente na tabela `incorporation_studies` (e removendo o teste depois).

## Tasks

- [x] `drizzle/schema.ts` — `incorporationStudies` (53 colunas, espelhando produção)
- [x] Gerar migration, conferir SQL bate exatamente com produção, mover journal/hash para reconciliação manual
- [x] `server/db.ts` — `getAllIncorporationStudies`/`getIncorporationStudyById`/`createIncorporationStudy`/`updateIncorporationStudy`
- [x] `server/routers.ts` — router `incorporacao` (list/getById/create/update, campos identificadores)
- [x] `client/src/pages/admin/AdminIncorporacao.tsx` — lista + filtro + criação
- [x] `client/src/pages/admin/AdminIncorporacaoDetail.tsx` — edição dos campos identificadores + aviso honesto dos módulos futuros
- [x] Rotas em `client/src/App.tsx` e link de navegação em `client/src/pages/Admin.tsx`
- [x] `tsc --noEmit`, `npm run build`, `npm test`

## File List

- `drizzle/schema.ts`
- `drizzle/0006_create_incorporation_studies.sql`
- `drizzle/meta/_journal.json`, `drizzle/meta/0006_snapshot.json`
- `server/db.ts`
- `server/routers.ts`
- `client/src/pages/admin/AdminIncorporacao.tsx`
- `client/src/pages/admin/AdminIncorporacaoDetail.tsx`
- `client/src/App.tsx`
- `client/src/pages/Admin.tsx`

## Validation Notes (@po)

Abre o maior épico da trilha com escopo deliberadamente contido (apenas identificação + situação do estudo), documentando com transparência que os ~24 módulos de negócio ficam para stories futuras — nada foi inventado ou simulado para parecer mais completo do que é (a tela de detalhe é explícita sobre os módulos "em construção"). Reconciliação de migration com tabela pré-existente tratada com cuidado (hash registrado, não recriação), seguindo o padrão já validado neste projeto. **Score: 8/10**.

**Verdict: GO (com validação end-to-end pendente pós-deploy)**

## QA Results (@qa)

Code review: schema confere campo-a-campo com produção (larguras de varchar, precisão/escala de numeric, defaults). Router não expõe nenhum campo `*_json` — apenas os 8 campos identificadores documentados. Migration corretamente reconciliada: presente no journal (bancos novos criam a tabela), hash registrado em produção (não recria em cima da tabela existente). `tsc`/`build`/`test` limpos. **Verdict: PASS** (com a ressalva de validação end-to-end pendente, registrada e não escondida).

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-06 | 0.1.0 | Story criada e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-06 | 1.0.0 | Implementado e validado (exceto teste end-to-end de criação real, pendente por limitação de rede do ambiente) — Status: Ready → Done | @dev / @qa |
