# Checkpoint — C2: Navegação e acessos visuais (Prospecta)

**Data:** 14/09/2026
**Status:** Concluída após validação local (TypeScript, testes, build)
**Escopo:** frente C2 do plano de correção Prospecta ↔ Grupo Santa Fé (coordenado com Astra)

## Entregas

| Frente | Resultado |
|---|---|
| Navegação (staff) | `AdminAcesso.tsx`: corrigido tile "Agregador" (apontava para `/mercado`, agora para `/admin/agregador`); adicionada entrada "Relatórios" (ausente, apesar de tela/permissão existentes) |
| Menu mobile | `Navbar.tsx`: botão "Entrar"/"Sair" movido para `SheetFooter` fixo, fora da área rolável — sempre visível |
| C1 (análise) | Problema confirmado (relatórios lendo só `broker_commissions` legado, CRUD gravando em `operational_commissions` novo); mapeamento de campos e regra de inclusão de histórico documentados em `C1-analise-relatorios-comissoes.md`; implementação não iniciada — C2 era a frente de menor complexidade e foi priorizada |
| Grupo Santa Fé (equivalente) | Auditoria completa realizada; 4 entradas de menu ausentes corrigidas (Relatórios/Agregador/Contabilidade/Contratos) + falha de autorização real fechada em `bpo`/`avaliacoes`/`juridico` (`requirePageRole`) — ver PR #119 e `Grupo-Santa-Fe/web/docs/stories/epics/epic-005-paridade-navegacao-comissoes/` |

## Coordenação com Astra

Nenhuma alteração em autenticação, middleware de permissões, webhooks, migrações ou adapter
de produção nos dois repositórios. No Grupo Santa Fé, a única mudança que toca a superfície
de autorização é usar um helper já existente (`requirePageRole`) em 3 páginas que estavam sem
proteção real — sinalizado explicitamente para revisão de Astra na PR #119.

## Achados adicionais comunicados a Astra (não implementados, tocam catálogo de permissões)

Ver `S-10-navegacao-acessos-visuais.md`, seção "Achados registrados, sem ação nesta rodada":
IDs duplicados em `AdminAcesso.tsx` (projetos/incorporação, dashboard/tarefas), permissões
`banco`/`configuracoes` sem rota correspondente, descompasso de granularidade `AdminBpo`
(rota `module="bpo"` vs backend `module="banco"`).

## Evidências de encerramento (Prospecta)

- TypeScript aprovado (`npx tsc --noEmit`, zero erros);
- Vitest: 49 arquivos, 330 testes aprovados;
- build Vite e bundle do servidor (`esbuild`) aprovados;
- `git diff --check` aprovado;
- sem migration — nenhuma tabela alterada.

**Não testado nesta sessão:** navegação em navegador real (sandbox sem acesso à internet
externa).
