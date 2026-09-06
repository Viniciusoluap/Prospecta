# Roadmap — Paridade de Funcionalidades Prospecta ↔ Grupo Santa Fé

**Owner:** dono do produto (Paulo Vinícius)
**Contexto:** Prospecta e Grupo Santa Fé são a mesma operação (construção/imóveis financiados) em duas cidades. Grupo Santa Fé é a fonte da verdade de negócio. Prospecta deve reproduzir fielmente todos os módulos do Santa Fé, na própria stack (Vite/React + Express/tRPC + Drizzle/Neon) — não é cópia de arquivo, é a mesma regra de negócio reimplementada.

**Exceções (ficam diferentes/exclusivas no Prospecta, não entram no espelhamento):**
- Landing page e layout público
- Ecossistema de sorteios (`draws`, `tickets`, `utefBalances`, `utefTransactions`, `products`, `productConversions`)

**Restrição de banco:** tudo continua no Neon (Postgres). Pode criar tabelas novas para módulos que faltam. Não migrar de provedor.

## Épicos

| Epic | Nome | Owner | Status | Depende de |
|------|------|-------|--------|------------|
| EPIC-000 | Limpeza: remover contractors/investors/lots/partnerDistributions | Claude | Done | — |
| EPIC-001 | Catálogo de Imóveis | Claude | In Progress (S-01 Done) | EPIC-000, EPIC-009 |
| EPIC-002 | Portal do Cliente | Codex | Draft | EPIC-009 |
| EPIC-003 | Avaliações | Claude | In Progress (S-01, S-02 Done) | EPIC-001 |
| EPIC-004 | Regularização | Codex | Draft (schema já existe — reaproveitar) | EPIC-009 |
| EPIC-005 | Agregador/Feeds | Claude | Draft | EPIC-001 |
| EPIC-006 | WhatsApp (Evolution API) | Codex | Draft | — |
| EPIC-007 | Financeiro avançado (Pluggy/BPO/Contabilidade) | Codex | Draft | Config de credenciais fica com o usuário |
| EPIC-008 | Incorporação | A dividir | Backlog (schema já existe — reaproveitar) | EPIC-001, demais fecharem |
| EPIC-009 | Alinhamento de papéis (admin/corretor/colaborador/cliente) | Claude | Done (S-01) | — |
| EPIC-010 | Páginas institucionais (serviços/sobre/contato/mercado/cursos/instituto) | A dividir | Draft | — |

## Decisões do dono do produto (06/09/2026)

1. **Tabelas órfãs em produção** (`incorporation_studies`, `regularizacoes`, `regularizacao_documents`) — todas vazias (0 linhas), sem nenhum código associado. Estrutura confirmada compatível com os modelos do Santa Fé (`EstudoIncorporacao`, `Regularizacao`/`RegDocumento`). Decisão: **reaproveitar** — serão declaradas no schema Drizzle e ligadas a router/UI nos EPIC-008 e EPIC-004, em vez de recriar do zero.
2. **Credenciais Asaas (`payment_settings`)** — o usuário mesmo vai configurar a chave/token reais quando for a hora de conectar de verdade. Adiantar tudo o que não depende disso (schema, UI, criptografia) — não bloquear nem esperar a credencial real para avançar o resto.
3. **Páginas institucionais do Santa Fé** (`/servicos`, `/sobre`, `/contato`, `/mercado`, `/cursos`, `/instituto`) — **precisam existir no Prospecta também**. Só a landing page em si (`/`) e o ecossistema de sorteios ficam exclusivos/diferentes. Virou EPIC-010.
4. **Papéis de usuário** — confirmado: alinhar `admin/user` (Prospecta) com `admin/corretor/colaborador/cliente` (Santa Fé). Vira EPIC-009, foundational — feito primeiro porque bloqueia o Portal do Cliente (EPIC-002, Codex) e o restante da minha trilha.

## Coordenação entre trilhas

- Trilha Claude (EPIC-000/001/003/005) e trilha Codex (EPIC-002/004/006/007) trabalham em branches separadas no mesmo repositório Prospecta.
- Ambas tocam `drizzle/schema.ts`. O EPIC-000 remove tabelas; os demais adicionam. A trilha Codex deve segurar a geração da migration SQL final até o EPIC-000 estar mergeado, para não colidir numeração de migration.
- Nenhuma trilha mexe no ecossistema de sorteios (`draws`/`tickets`/`utef`/`products`) nem na landing page.
