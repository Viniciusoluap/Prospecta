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
| EPIC-001 | Catálogo de Imóveis | Claude | Done (S-01, S-02, S-03) | EPIC-000, EPIC-009 |
| EPIC-002 | Portal do Cliente | Codex | Draft | EPIC-009 |
| EPIC-003 | Avaliações | Claude | Done (S-01, S-02, S-03, S-04) | EPIC-001 |
| EPIC-004 | Regularização | Codex | Draft (schema já existe — reaproveitar) | EPIC-009 |
| EPIC-005 | Agregador/Feeds | Claude | Done (S-01, S-02) | EPIC-001 |
| EPIC-006 | WhatsApp (Evolution API) | Codex | Draft | — |
| EPIC-007 | Financeiro avançado (Pluggy/BPO/Contabilidade) | Codex | Draft | Config de credenciais fica com o usuário |
| EPIC-008 | Incorporação | Claude | In Progress (S-01 a S-08 Done) | EPIC-001, demais fecharem |
| EPIC-009 | Alinhamento de papéis (admin/corretor/colaborador/cliente) | Claude | Done (S-01, S-02, S-03) | — |
| EPIC-010 | Páginas institucionais (serviços/sobre/contato/mercado/cursos/instituto) | Claude | Done (S-01, S-02) | — |

## Decisões do dono do produto (06/09/2026)

1. **Tabelas órfãs em produção** (`incorporation_studies`, `regularizacoes`, `regularizacao_documents`) — todas vazias (0 linhas), sem nenhum código associado. Estrutura confirmada compatível com os modelos do Santa Fé (`EstudoIncorporacao`, `Regularizacao`/`RegDocumento`). Decisão: **reaproveitar** — serão declaradas no schema Drizzle e ligadas a router/UI nos EPIC-008 e EPIC-004, em vez de recriar do zero.
2. **Credenciais Asaas (`payment_settings`)** — o usuário mesmo vai configurar a chave/token reais quando for a hora de conectar de verdade. Adiantar tudo o que não depende disso (schema, UI, criptografia) — não bloquear nem esperar a credencial real para avançar o resto.
3. **Páginas institucionais do Santa Fé** (`/servicos`, `/sobre`, `/contato`, `/mercado`, `/cursos`, `/instituto`) — **precisam existir no Prospecta também**. Só a landing page em si (`/`) e o ecossistema de sorteios ficam exclusivos/diferentes. Virou EPIC-010.
4. **Papéis de usuário** — confirmado: alinhar `admin/user` (Prospecta) com `admin/corretor/colaborador/cliente` (Santa Fé). Vira EPIC-009, foundational — feito primeiro porque bloqueia o Portal do Cliente (EPIC-002, Codex) e o restante da minha trilha.
5. **Sugestão de valor por IA (EPIC-003 S-03)** — decidido usar Anthropic direto + ferramenta `web_search` (paridade exata com o Santa Fé), em vez do gateway de LLM genérico já existente no Prospecta (`invokeLLM`/Gemini, que não suporta busca na web). Implica nova dependência (`@anthropic-ai/sdk`) e `ANTHROPIC_API_KEY` real a configurar no Vercel do Prospecta quando for validar em produção — mesmo padrão já adotado no Santa Fé.
6. **EPIC-010 (páginas institucionais)** — atribuído diretamente à trilha Claude (antes "a dividir" com a trilha Codex), a ser feito após o restante do EPIC-001.
7. **EPIC-008 (Incorporação)** — atribuído diretamente à trilha Claude (antes "a dividir"), a ser feito em seguida.
8. **EPIC-009 S-02 original (helper RBAC)** — nunca tinha sido implementado (a story "S-02" registrada era, na verdade, uma correção de review externo não relacionada). Fechado como S-03 (`server/_core/rbac.ts`, `hasRole`/`requireRole`/`STAFF_ROLES`), substituindo as ~50 checagens de papel inline nos routers por chamadas ao helper.
9. **EPIC-008 S-03 (correção de escopo)** — a S-03 estava descrita no `EPIC.md` como "Estudo urbanístico e de mercado" agrupando dois temas por suposição, sem checar a estrutura real do Santa Fé antes de escrever o épico. Ao implementar, ficou claro que parâmetros urbanísticos/potencial construtivo não têm aba própria lá — são consumidos dentro do módulo de Massa/Quadro de Áreas. A S-03 foi re-escopada para cobrir só "Estudo de Mercado" (pesquisa por IA + precificação por comparáveis + pesquisa primária); os campos urbanísticos passaram para a S-04. Detalhes em `epic-008-incorporacao/S-03-estudo-mercado.md`.
10. **EPIC-008 — módulo de Viabilidade Econômica ausente do plano original** — durante a S-08, foi descoberto que o Grupo Santa Fé tem um módulo inteiro ("Estudo de Viabilidade Econômica": motor de VGV/fluxo de caixa/VPL/TIR/payback/análise de sensibilidade, `lib/finance/eve.ts` + `viabilidade-tab.tsx`, ~1.100 linhas de referência) que nunca constou como story no `EPIC.md` original desta trilha. É a fonte real do "VGV bruto"/"investimento total" que as stories S-05 (negociação do terreno) e S-06 (business plan) precisaram tornar campo manual, documentando essa limitação explicitamente. Em vez de encaixar uma versão reduzida do motor às pressas na S-08 ou inventar um cálculo simplificado, o achado foi registrado e uma nova story de backlog (S-13) foi criada para o motor completo. Detalhes em `epic-008-incorporacao/S-08-registro-orcamento-preliminar.md`.

## Coordenação entre trilhas

- Trilha Claude (EPIC-000/001/003/005/008/009/010) e trilha Codex (EPIC-002/004/006/007) trabalham em branches separadas no mesmo repositório Prospecta.
- Ambas tocam `drizzle/schema.ts`. O EPIC-000 remove tabelas; os demais adicionam. A trilha Codex deve segurar a geração da migration SQL final até o EPIC-000 estar mergeado, para não colidir numeração de migration.
- Nenhuma trilha mexe no ecossistema de sorteios (`draws`/`tickets`/`utef`/`products`) nem na landing page.
- **Arquivos compartilhados tocados pela trilha Claude que a trilha Codex também usa:** o helper de RBAC (EPIC-009 S-03) substituiu ~50 checagens de papel inline em `server/routers.ts` por chamadas a `requireRole(...)` — incluindo trechos de `leads`/CRM (base do Portal do Cliente, EPIC-002) e de `financial_transactions`/`payment_settings` (base do EPIC-007). Nenhuma lógica de negócio foi alterada (mesmo comportamento, mesmos papéis permitidos) — mas se a trilha Codex tiver alterações locais ainda não mergeadas nessas mesmas linhas, é esperado um conflito de texto trivial (não de lógica) ao mergear, resolvível como qualquer merge normal.

## Achado (06/09/2026) — PR #7 do Codex (`codex/nextjs-santa-fe-unification`)

Existe um PR aberto e em rascunho (**#7**, "Checkpoint: unificação Prospecta + Grupo Santa Fé") que parece ser uma frente **diferente** de trabalho do Codex: uma tentativa de unificação via reescrita/integração em Next.js, com 505 arquivos alterados, baseada num commit de `main` (`e507a2e`) bem anterior à criação deste `ROADMAP.md` e a todo o trabalho da trilha Claude descrito aqui (EPIC-000 em diante). O próprio corpo do PR diz que fica em rascunho "para impedir merge concorrente e preservar uma fila única de integração", e lista pendências próprias (conflito em `.env.example`, ajuste de escopo do ESLint, revalidação de staging/UAT) — nada relacionado aos épicos deste roadmap.

**Não foi mexido por ninguém desta trilha.** Como está muito desatualizado em relação ao `main` atual (que já incorpora EPIC-000/001/003/005/008/009/010 inteiros), qualquer tentativa futura de mergeá-lo vai exigir reconciliação extensa. Registrado aqui para visibilidade — cabe ao dono do produto ou a quem estiver conduzindo a sessão do Codex decidir se essa frente ainda está ativa ou se foi substituída pela abordagem incremental (Vite/tRPC) deste roadmap.
