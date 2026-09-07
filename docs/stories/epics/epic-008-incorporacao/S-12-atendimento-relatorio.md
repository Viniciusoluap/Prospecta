# Story S-12 — Atendimento aos Clientes e Relatório Executivo (PDF)
**Epic:** EPIC-008
**Status:** Done
**executor:** @dev
**quality_gate:** @dev
**quality_gate_tools:** [tsc, build, test, manual-review]

## Contexto

Décimo-oitavo e último módulo `*_json` do épico. "Atendimento aos Clientes" é uma central de pós-venda: repasses bancários, assembleias de condomínio, entrega de chaves, assistência técnica e documentação, cada chamado com cliente/unidade/tipo/status. "Relatório Executivo" gera um PDF consolidado do estudo (terreno com APP automática, pesquisa de cidade/mercado, cenário de massa escolhido), com seções omitidas automaticamente quando os dados correspondentes não existem — fechando o épico com a mesma disciplina de honestidade usada em toda a trilha.

## Acceptance Criteria

- [x] AC-01: Atendimento aos Clientes — cadastro de chamados (cliente, unidade, tipo entre 6 categorias fixas, status aberto/em andamento/concluído, datas de abertura/conclusão), resumo com percentual concluído
- [x] AC-02: Relatório Executivo — geração de PDF client-side (sem chamada ao servidor) consolidando terreno (S-02), cidade/mercado (S-03) e cenário de massa escolhido (S-04); indicador visual de quais seções têm dado disponível antes de gerar
- [x] AC-03: Seções sem dado são omitidas do PDF automaticamente, sem inventar números ou textos de preenchimento
- [x] AC-04: O relatório documenta explicitamente, tanto na UI quanto no PDF, que a seção de Viabilidade Econômica não está disponível (motor completo é a story de backlog S-13)
- [x] AC-05: `tsc --noEmit`, `npm run build` e `npm test` (com testes novos) passam limpos, com o novo chunk de `jspdf-autotable` corretamente isolado via import dinâmico

## Decisões de implementação (adaptações deliberadas, não invenção)

- **`resumoAtendimentoClientes` 100% portado**: mesma lógica de contagem/percentual do Santa Fé.
- **Reuso de dependências já instaladas**: `jspdf` e `jspdf-autotable` já eram dependências do Prospecta (usadas em `AdminEditarObra.tsx` para relatórios de obra) — nenhuma dependência nova foi adicionada. O padrão de import dinâmico (`import("jspdf")` dentro do handler de clique) segue exatamente o precedente já estabelecido nesse arquivo.
- **Geração 100% client-side, sem mutation nova**: assim como no Santa Fé (`relatorio-tab.tsx`), o PDF é montado inteiramente no navegador a partir dos dados já carregados via `getById` — não há endpoint novo no router para isso, só a mutation de salvar os chamados de atendimento.
- **Seção de Viabilidade Econômica omitida, não inventada**: diferente do Santa Fé (que tem a seção "4. VIABILIDADE ECONÔMICA" preenchida pelo motor EVE), o relatório do Prospecta simplesmente não inclui essa seção — e diz por quê, tanto na UI quanto na nota final da página de detalhe do estudo. Nenhum número de VGV/VPL/TIR foi calculado ou aproximado para preencher essa lacuna.
- **Cores adaptadas ao tema do Prospecta**: cabeçalho do PDF trocado do preto/amarelo do Santa Fé para o azul-marinho/dourado (`#0F1923`/`#C9A961`) do Prospecta — mudança visual, não de conteúdo.
- **Nota final substituindo o card "Em construção"**: como esta story fecha o último item de `FUTURE_MODULES`, o card genérico de "módulos futuros" foi substituído por uma nota específica e honesta sobre a única lacuna real remanescente (o motor de Viabilidade Econômica, S-13), explicando quais campos anteriores (VGV bruto, investimento total, duração de obra) dependem dele hoje como entrada manual.
- **Somente admin**: a nova mutation (`saveAtendimentoClientes`) segue `requireRole(ctx, ["admin"])`; a geração de PDF não requer mutation (é só leitura de dados já carregados pela página, que já é admin-only).

## Validação — honestidade de status (regra do dono do produto)

**Testado automaticamente:** `tsc --noEmit` limpo, `npm run build` limpo (novo chunk `jspdf.plugin.autotable` de 31 kB corretamente isolado via import dinâmico, mesma técnica já usada para `leaflet` e `jspdf`), `npm test` (217/217 passando, 4 testes novos em `server/incorporacao-atendimento-clientes.test.ts` cobrindo contagens por status, percentual concluído e o parser de conclusão total).

**Não testado de ponta a ponta:** geração real do PDF em um navegador (o `jsPDF`/`autoTable` rodam inteiramente no cliente, não há como executar isso no sandbox headless) e preenchimento do formulário de atendimento — mesma limitação de sandbox documentada em todas as stories anteriores. **Recomendação:** após o deploy, gerar um relatório de um estudo com terreno/mercado/massa preenchidos e conferir visualmente a formatação do PDF.

## Tasks

- [x] `shared/incorporacao/atendimento-clientes.ts` — `resumoAtendimentoClientes`/`atendimentoTodosConcluidosDoJson`
- [x] `server/routers.ts` — mutation `incorporacao.saveAtendimentoClientes`
- [x] `client/src/components/incorporacao/AtendimentoRelatorio.tsx` — checklist de atendimento + gerador de PDF
- [x] Integração em `client/src/pages/admin/AdminIncorporacaoDetail.tsx` (remove o card "Em construção" genérico, substitui por nota específica sobre a S-13)
- [x] Testes: `server/incorporacao-atendimento-clientes.test.ts`
- [x] `tsc --noEmit`, `npm run build`, `npm test`
- [x] Marca EPIC-008 como fechado (S-01 a S-12 Done) em `EPIC.md`/`ROADMAP.md`, com a S-13 (Viabilidade Econômica) permanecendo como único item de backlog

## File List

- `shared/incorporacao/atendimento-clientes.ts`
- `server/routers.ts`
- `client/src/components/incorporacao/AtendimentoRelatorio.tsx`
- `client/src/pages/admin/AdminIncorporacaoDetail.tsx`
- `server/incorporacao-atendimento-clientes.test.ts`
- `docs/stories/epics/epic-008-incorporacao/EPIC.md`
- `docs/stories/epics/ROADMAP.md`

## Validation Notes (@po)

Story fecha o épico com a mesma disciplina de honestidade aplicada desde a S-01: o relatório PDF omite dados que não existem em vez de fabricá-los, e a nota final é explícita sobre a única lacuna real (Viabilidade Econômica). Reaproveitamento de dependências já instaladas evita inchar o bundle. **Score: 9/10**.

**Verdict: GO**

## QA Results (@qa)

Code review: `resumoAtendimentoClientes` confere com a origem. Geração de PDF replica fielmente a estrutura do relatório do Santa Fé nas seções que têm dado disponível no Prospecta, omitindo corretamente o resto. Nenhuma chamada de rede nova, nenhuma dependência nova. Mutation restrita a admin. `tsc`/`build`/`test` limpos (217/217). **Verdict: PASS**.

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-06 | 0.1.0 | Story criada e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-06 | 1.0.0 | Implementado e validado; EPIC-008 fechado (S-01 a S-12 Done, S-13 backlog) — Status: Ready → Done | @dev / @qa |
