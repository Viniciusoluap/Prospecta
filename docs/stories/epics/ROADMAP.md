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
| EPIC-000 | Limpeza: remover contractors/investors/lots/partnerDistributions | Claude | In Progress | — |
| EPIC-001 | Catálogo de Imóveis | Claude | Draft | EPIC-000 |
| EPIC-002 | Portal do Cliente | Codex | Draft | — |
| EPIC-003 | Avaliações | Claude | Draft | EPIC-001 |
| EPIC-004 | Regularização | Codex | Draft | — |
| EPIC-005 | Agregador/Feeds | Claude | Draft | EPIC-001 |
| EPIC-006 | WhatsApp (Evolution API) | Codex | Draft | — |
| EPIC-007 | Financeiro avançado (Pluggy/BPO/Contabilidade) | Codex | Draft | — |
| EPIC-008 | Incorporação | A dividir | Backlog | EPIC-001, demais fecharem |

## Coordenação entre trilhas

- Trilha Claude (EPIC-000/001/003/005) e trilha Codex (EPIC-002/004/006/007) trabalham em branches separadas no mesmo repositório Prospecta.
- Ambas tocam `drizzle/schema.ts`. O EPIC-000 remove tabelas; os demais adicionam. A trilha Codex deve segurar a geração da migration SQL final até o EPIC-000 estar mergeado, para não colidir numeração de migration.
- Nenhuma trilha mexe no ecossistema de sorteios (`draws`/`tickets`/`utef`/`products`) nem na landing page.
