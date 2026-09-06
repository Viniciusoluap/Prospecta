# Story S-02 — Seis Páginas Institucionais + Navegação
**Epic:** EPIC-010
**Status:** Done
**executor:** @dev
**quality_gate:** @dev
**quality_gate_tools:** [tsc, build, test, manual-review]

## Contexto

Segunda e última story do EPIC-010 — implementa as seis páginas institucionais do Grupo Santa Fé (`/servicos`, `/sobre`, `/contato`, `/mercado`, `/cursos`, `/instituto`), conforme decisão do dono do produto registrada no `ROADMAP.md` ("essas páginas precisam existir no Prospecta também"). Consome os procedures públicos construídos na S-01 (`leads.createPublic`, `agregador.listPublic`) e o catálogo de imóveis do EPIC-001. Segue o padrão visual público (tema escuro navy/dourado) já estabelecido em `Home.tsx`/`Produtos.tsx`/`Imoveis.tsx`, com `Navbar`/`SEO`.

## Acceptance Criteria

- [x] AC-01: `/servicos` — lista de serviços reais já oferecidos pelo Prospecta (corretagem, financiamento, obras, avaliação, loteamento), com um serviço declarado "em estruturação" (regularização) em vez de fingir disponibilidade
- [x] AC-02: `/sobre` — institucional com fatos confirmados (fundação 2020, endereço, missão, valores) e métricas/estatísticas ainda não confirmadas marcadas honestamente como "Em breve"
- [x] AC-03: `/contato` — formulário funcional que efetivamente cria um lead via `leads.createPublic`, com dados de contato reais (telefone/endereço/horário já usados no site) e CTA de WhatsApp
- [x] AC-04: `/mercado` — lista imóveis do agregador com `status: "verificado"` via `agregador.listPublic`, com busca/filtro por fonte/tipo e CTA de WhatsApp por anúncio
- [x] AC-05: `/cursos` — página honesta de captação de interesse (não afirma turmas abertas nem certificações que não existem), com formulário que cria lead via `leads.createPublic`
- [x] AC-06: `/instituto` — braço social institucional com estatísticas marcadas "Em breve" (mesmo padrão de honestidade que o próprio Santa Fé usa nessa página) e CTA para contato
- [x] AC-07: Rotas registradas em `App.tsx` e seção "Institucional" adicionada ao menu de navegação (`Navbar.tsx`)
- [x] AC-08: `tsc --noEmit`, `npm run build` e `npm test` passam limpos

## Decisões de implementação (adaptações deliberadas, não invenção)

- **Nenhum dado fictício apresentado como real**: seguindo decisão explícita do dono do produto nesta story, toda estatística, linha do tempo ou nome de equipe que no Santa Fé é específico da empresa (ex.: "500+ imóveis negociados", nomes de corretores, ano exato de marcos históricos) foi substituído por "Em breve" ou omitido — nunca inventado. Fatos usados são apenas os já confirmados no código-fonte do Prospecta: `foundingDate: "2020"` e endereço/telefone/Instagram de `organizationSchema`/`localBusinessSchema` (`components/SEO.tsx`), e o horário comercial de `localBusinessSchema.openingHoursSpecification`.
- **Serviços listados = serviços reais**: `/servicos` só lista o que o Prospecta já tem funcionando (imóveis, simulador de financiamento, projetos e orçamentos, avaliação). "Regularização Imobiliária" (schema já existe, mas sem UI/EPIC-004 ainda não implementado pela trilha Codex) aparece marcada como "em breve" em vez de ser apresentada como disponível.
- **`/cursos` sem fabricar currículo**: diferente do Santa Fé (que já roda cursos reais com carga horária e certificação CRECI-PA confirmadas), o Prospecta não oferece cursos hoje. A página foi montada como captação de interesse honesta ("em estruturação"), sem inventar horas, grade curricular ou certificação — apenas duas áreas de interesse ligadas a serviços que o Prospecta já presta de fato (corretagem, financiamento).
- **`/instituto` com nome derivado do próprio nome da empresa**: sem uma marca de instituto social confirmada para o Prospecta, foi usado "Instituto Prospecta" (derivado de `APP_TITLE`), não uma marca inventada. Conteúdo segue o mesmo padrão de honestidade que a própria página do Santa Fé já usa para dados que também não tem ainda (a maioria dos números da página original do Santa Fé já é "Em breve").
- **`/contato` sem e-mail fabricado**: `organizationSchema` do Prospecta não tem um campo de e-mail de contato confirmado (diferente do Santa Fé) — o bloco de e-mail foi omitido em vez de inventado; mantidos apenas telefone/WhatsApp, endereço e horário, todos já confirmados em `SEO.tsx`.
- **Filtros de `/mercado`**: idênticos em espírito aos do Santa Fé (`MercadoClient`), mas usando os campos reais retornados por `agregador.listPublic` (S-01).

## Validação — honestidade de status (regra do dono do produto)

**Testado automaticamente:** `tsc --noEmit` limpo, `npm run build` limpo, `npm test` (69/69 passando, sem regressão). Todos os campos usados em `/mercado` conferidos contra o retorno real de `agregador.listPublic`; o formulário de `/contato` e `/cursos` usa exatamente o schema zod de `leads.createPublic` (S-01).

**Não testado de ponta a ponta (limitação de ambiente já documentada em todas as stories anteriores deste projeto):** sandbox bloqueia conexão direta ao Neon de produção e acesso a URLs de preview do Vercel — não foi possível confirmar visualmente a submissão real do formulário de contato nem a listagem real de imóveis verificados. **Recomendação:** após o deploy, testar o envio do formulário de `/contato` e conferir se o lead aparece no CRM admin (`/admin/crm`), e cadastrar ao menos um imóvel `verificado` no agregador para validar `/mercado` visualmente.

## Tasks

- [x] `client/src/pages/Servicos.tsx`
- [x] `client/src/pages/Sobre.tsx`
- [x] `client/src/pages/Contato.tsx`
- [x] `client/src/pages/Mercado.tsx`
- [x] `client/src/pages/Cursos.tsx`
- [x] `client/src/pages/Instituto.tsx`
- [x] Rotas em `client/src/App.tsx`
- [x] Seção "Institucional" em `client/src/components/Navbar.tsx`
- [x] `tsc --noEmit`, `npm run build`, `npm test`

## File List

- `client/src/pages/Servicos.tsx`
- `client/src/pages/Sobre.tsx`
- `client/src/pages/Contato.tsx`
- `client/src/pages/Mercado.tsx`
- `client/src/pages/Cursos.tsx`
- `client/src/pages/Instituto.tsx`
- `client/src/App.tsx`
- `client/src/components/Navbar.tsx`

## Validation Notes (@po)

Fecha o EPIC-010 cobrindo as 6 páginas exigidas pela decisão do dono do produto (FR-01 a FR-06). Conteúdo tratado com a honestidade exigida — nenhuma estatística, curso ou serviço inexistente apresentado como real; tudo o que não está confirmado aparece como "Em breve"/"em estruturação". `/contato` e `/mercado` são funcionais de ponta a ponta no código (formulário grava lead real; listagem consome dados reais do agregador), não apenas decorativas. Risco: validação visual pendente por limitação de rede do ambiente, declarado explicitamente. **Score: 8/10**.

**Verdict: GO (com validação visual pendente pós-deploy)**

## QA Results (@qa)

Code review: `trpc.leads.createPublic` e `trpc.agregador.listPublic` usados nas páginas batem exatamente com os procedures definidos na S-01. Nenhum dado factual inventado — verificado contra `organizationSchema`/`localBusinessSchema` e contra o estado real dos épicos (regularização e cursos corretamente marcados como não disponíveis). Rotas e navegação registradas corretamente. `tsc`/`build`/`test` limpos, sem regressão. **Verdict: PASS** (com a ressalva de validação visual pendente, registrada e não escondida).

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-06 | 0.1.0 | Story criada e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-06 | 1.0.0 | Implementado e validado (exceto renderização visual, pendente por limitação de rede do ambiente) — Status: Ready → Done | @dev / @qa |
