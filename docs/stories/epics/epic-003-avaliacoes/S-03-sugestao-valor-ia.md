# Story S-03 — Sugestão de Valor via IA
**Epic:** EPIC-003
**Status:** Done
**executor:** @dev
**quality_gate:** @dev
**quality_gate_tools:** [tsc, build, vitest, manual-review]

## Contexto

O Grupo Santa Fé usa o Claude (via `@anthropic-ai/sdk`, com a ferramenta nativa `web_search`) para sugerir o valor de mercado de uma avaliação: o modelo busca imóveis comparáveis reais (ZAP/VivaReal/OLX/Imovelweb) na região, calcula o valor pelo método comparativo direto, e ajusta o resultado conforme a situação documental e a condição física apuradas no checklist de vistoria (fonte: `web/src/app/api/avaliacoes/sugestao/route.ts`).

## Decisão de arquitetura (registrada, consultado o dono do produto)

O Prospecta já tinha um gateway de LLM genérico (`server/_core/llm.ts`, `invokeLLM`, hoje falando com Gemini via endpoint OpenAI-compatible) — mas ele **não suporta a ferramenta nativa `web_search` do Claude**, que é o que dá ao Santa Fé dados reais de mercado (sem isso, a sugestão vira um chute sem comparáveis). Perguntado, o dono do produto escolheu **manter paridade exata com o Santa Fé**: Anthropic direto + `web_search`, em vez de reaproveitar o gateway genérico. Isso trouxe duas mudanças de infraestrutura, ambas necessárias e de baixo risco:
- Nova dependência `@anthropic-ai/sdk` (mesma versão do Santa Fé, `^0.106.0`)
- `vercel.json`: `maxDuration` de `api/index.ts` de 10s → 60s (uma chamada Claude com busca na web não cabe em 10s; 60s é o mesmo valor usado pela rota equivalente do Santa Fé)

## Acceptance Criteria

- [x] AC-01: `server/_core/avaliacao-ia.ts` porta fielmente a lógica do Santa Fé — `buildChecklistContext` (mesmas regras de ajuste por documentação/condição física), prompt, chamada ao Claude com `web_search`, parsing do JSON de resposta
- [x] AC-02: Router `avaliacoes.sugerirValor` (mutation, roles admin/corretor/colaborador) carrega a avaliação pelo id, gera a sugestão e persiste em `sugestaoJson`
- [x] AC-03: Erro claro (não travar o processo) quando `ANTHROPIC_API_KEY` não está configurada — mesmo comportamento do Santa Fé (503/mensagem explícita, não invenção de fallback)
- [x] AC-04: `tsc --noEmit`, `npm run build` e `npm test` (51/51) passam limpos
- [x] AC-05: Nenhuma migration de banco necessária — usa a coluna `sugestaoJson` já existente desde a S-01

## Tasks

- [x] `pnpm add @anthropic-ai/sdk@^0.106.0`
- [x] `ENV.anthropicApiKey` em `server/_core/env.ts` (lê `process.env.ANTHROPIC_API_KEY`, mesmo padrão dos demais campos de `ENV`)
- [x] `server/_core/avaliacao-ia.ts`: `buildChecklistContext` + `gerarSugestaoValor` portados do Santa Fé (adaptado só o texto do prompt: "Pará e Sudeste do Pará" → "Pará e Maranhão (Canaã dos Carajás e Imperatriz)", refletindo as duas cidades reais do Prospecta)
- [x] Router `avaliacoes.sugerirValor` em `server/routers.ts`
- [x] `vercel.json`: `maxDuration` 10 → 60
- [x] `tsc --noEmit`, `npm run build`, `npm test`

## File List

- `package.json` / `pnpm-lock.yaml` (nova dependência)
- `server/_core/env.ts`
- `server/_core/avaliacao-ia.ts`
- `server/routers.ts`
- `vercel.json`

## Validation Notes (@po)

Decisão de arquitetura (Anthropic direto vs. gateway genérico) foi levada ao dono do produto antes de implementar, por envolver nova credencial/custo e mudança em arquivo de config compartilhado (`vercel.json`) — não é decisão que um agente deva tomar sozinho. Resposta obtida: paridade com Santa Fé. Escopo bem definido (lógica de IA + endpoint; UI de "Sugerir valor" fica pra S-04). Sem invenção — prompt e regras de ajuste transcritos do Santa Fé, único ajuste é textual (duas cidades). Risco médio-baixo: a chamada real à IA não pôde ser testada de ponta a ponta neste ambiente (sem `ANTHROPIC_API_KEY` real localmente) — fica registrado como pendência de validação em produção. **Score: 8/10** (nota reduzida por essa pendência de validação real).

**Verdict: GO (com nota de validação pendente em produção)**

## QA Results (@qa)

Code review: lógica idêntica ao Santa Fé linha a linha (prompt, regras de desconto por documentação/condição física, parsing do JSON). Segurança: `sugerirValor` exige role operacional; erro claro e sem stack trace vazado quando a API key não está configurada. `tsc`/`build`/`test` (51/51) limpos. **Honestidade de status (regra do dono do produto):** a chamada real ao Claude com `web_search` **não foi testada de ponta a ponta** — não há `ANTHROPIC_API_KEY` real neste ambiente. Testado automaticamente: compilação, tipos, ausência de regressão nos 51 testes existentes. Não testado: resposta real da IA, formato exato do JSON retornado pelo modelo em produção, comportamento do timeout de 60s no Vercel real. **Verdict: PASS** (funcionalidade implementada e íntegra; validação de produção fica pendente e documentada, não escondida).

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-06 | 0.1.0 | Story criada, decisão de arquitetura consultada ao dono do produto, validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-06 | 1.0.0 | Implementado e validado (exceto chamada real à IA, pendente de credencial em produção) — Status: Ready → Done | @dev / @qa |
