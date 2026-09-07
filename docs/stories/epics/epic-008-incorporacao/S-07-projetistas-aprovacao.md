# Story S-07 — Contratação de Projetistas e Aprovação de Projeto
**Epic:** EPIC-008
**Status:** Done
**executor:** @dev
**quality_gate:** @dev
**quality_gate_tools:** [tsc, build, test, manual-review]

## Contexto

Sexto e sétimo módulos `*_json` do épico (agrupados numa única story por serem pequenos e sequenciais no fluxo). "Contratação de Projetistas" gerencia os profissionais/empresas contratados por disciplina (arquitetura, estrutural, instalações etc.), com prazo de entrega e status até a compatibilização técnica entre disciplinas. "Projeto Aprovado" controla os processos de aprovação legal junto a órgãos competentes (prefeitura, bombeiros, concessionárias, meio ambiente, cartório), com protocolo, prazo previsto e status até a aprovação final. Ambos são checklists operacionais com poucos cálculos (percentual concluído, itens atrasados).

## Acceptance Criteria

- [x] AC-01: Contratação de Projetistas — cadastro por disciplina (lista fixa: Arquitetura, Estrutural, Instalações Hidrossanitárias/Elétricas/Gás, Terraplenagem/Drenagem, Paisagismo, Interiores, Outra) com empresa/profissional, contato, prazo de entrega e status (não contratado → contratado → em desenvolvimento → entregue → compatibilizado)
- [x] AC-02: Aprovação de Projeto — cadastro por órgão (lista fixa: Prefeitura, Corpo de Bombeiros, Concessionária de Água/Esgoto, Concessionária de Energia, Órgão Ambiental, Cartório, Outro) com número de protocolo, prazo previsto, status (não protocolado → protocolado → em análise → exigência/aprovado/indeferido) e observações
- [x] AC-03: Ambos calculam resumo (total, percentual concluído) e alertam sobre itens com prazo vencido que ainda não foram concluídos
- [x] AC-04: Os dois blocos gravam de forma independente (`designersJson`, `projectApprovalJson`)
- [x] AC-05: `tsc --noEmit`, `npm run build` e `npm test` (com testes novos) passam limpos

## Decisões de implementação (adaptações deliberadas, não invenção)

- **Cálculos 100% portados**: `resumoProjetistas` e `resumoAprovacaoProjeto` são cópias fiéis do Santa Fé — mesmo critério de "atrasado" (tem prazo, prazo já passou, e o item ainda não está na situação final que o exclui do atraso), mesmas listas fixas de disciplinas/órgãos.
- **Parâmetro `hoje` mantido explícito**: ambas as funções recebem a data de referência como parâmetro opcional (default `new Date()`), replicando a assinatura do Santa Fé — isso é o que torna os testes de "atrasado" determinísticos (sem depender do relógio real).
- **Um único componente com dois cards**: `ProjetistasAprovacao.tsx` agrupa as duas ferramentas, seguindo o mesmo padrão de consolidação já usado em `EstudoMercado.tsx`/`OrcamentoNegociacao.tsx`.
- **Somente admin**: as duas novas mutations (`saveProjetistas`/`saveAprovacaoProjeto`) seguem `requireRole(ctx, ["admin"])`.

## Validação — honestidade de status (regra do dono do produto)

**Testado automaticamente:** `tsc --noEmit` limpo, `npm run build` limpo, `npm test` (158/158 passando, 12 testes novos: `server/incorporacao-projetistas.test.ts` e `server/incorporacao-aprovacao-projeto.test.ts` cobrindo contagens de status, percentuais, detecção de atraso com data de referência fixa, e o parser seguro do JSON salvo para o indicador de conclusão total). Toda a lógica é a mesma do Santa Fé, verificada linha a linha.

**Não testado de ponta a ponta:** preenchimento real dos formulários em um navegador — mesma limitação de sandbox documentada em todas as stories anteriores.

## Tasks

- [x] `shared/incorporacao/projetistas.ts` — `resumoProjetistas`/`projetistasCompatibilizadosDoJson`
- [x] `shared/incorporacao/aprovacao-projeto.ts` — `resumoAprovacaoProjeto`/`projetoTotalmenteAprovadoDoJson`
- [x] `server/routers.ts` — mutations `incorporacao.saveProjetistas`/`saveAprovacaoProjeto`
- [x] `client/src/components/incorporacao/ProjetistasAprovacao.tsx` — os dois cards
- [x] Integração em `client/src/pages/admin/AdminIncorporacaoDetail.tsx` (remove o item de `FUTURE_MODULES`)
- [x] Testes: `server/incorporacao-projetistas.test.ts`, `server/incorporacao-aprovacao-projeto.test.ts`
- [x] `tsc --noEmit`, `npm run build`, `npm test`

## File List

- `shared/incorporacao/projetistas.ts`
- `shared/incorporacao/aprovacao-projeto.ts`
- `server/routers.ts`
- `client/src/components/incorporacao/ProjetistasAprovacao.tsx`
- `client/src/pages/admin/AdminIncorporacaoDetail.tsx`
- `server/incorporacao-projetistas.test.ts`
- `server/incorporacao-aprovacao-projeto.test.ts`

## Validation Notes (@po)

Story simples e fiel ao original, sem nenhuma dependência de módulo inexistente (diferente de S-05/S-06) — implementação direta. **Score: 9/10**.

**Verdict: GO**

## QA Results (@qa)

Code review: critério de atraso correto em ambos (`atrasados` exclui itens já concluídos, mesmo com prazo vencido). Percentuais corretos. Mutations restritas a admin. `tsc`/`build`/`test` limpos (158/158). **Verdict: PASS**.

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-06 | 0.1.0 | Story criada e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-06 | 1.0.0 | Implementado e validado — Status: Ready → Done | @dev / @qa |
