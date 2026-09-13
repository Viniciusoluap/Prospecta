# Checkpoint — Etapa 5: lacunas P2

**Data:** 13/09/2026
**Status:** Concluída após validação local (TypeScript, testes, build)
**Escopo:** Relatórios/exportações, Avaliações (edição dedicada + laudos em lote), gestão administrativa de Feeds/Agregador

## Entregas

| Frente | Resultado |
|---|---|
| Relatórios | `/admin/relatorios` novo, permissão RBAC dedicada, indicadores consolidados (imóveis, leads, financiamentos, avaliações, DRE), gráficos e exportação CSV de comissões |
| Avaliações | Edição dedicada `/admin/avaliacoes/:id/editar`; laudo individual e em lote como página HTML de impressão (`window.print()`), corpo do laudo compartilhado entre os dois fluxos |
| Feeds/Agregador | `/admin/agregador` novo, consumindo o backend já existente (scraper com SSRF, CRUD, fluxo pendente→verificado→importado→arquivado) sem alteração de schema |
| RBAC | Módulo `relatorios` adicionado ao catálogo de permissões e ao mapa `procedureModules` do middleware tRPC |
| Dados | Nenhuma migration — nenhuma tabela nova ou alterada nesta etapa |

## Coordenação com a Etapa 4 (Codex, em andamento)

O ranking de corretores em Relatórios usa o modelo `broker_commissions` já existente, sem antecipar a reestruturação de Corretores/Comissões que é escopo da Etapa 4 — evita colisão de schema/merge entre as duas frentes paralelas. Quando a Etapa 4 estabelecer um modelo de comissão por corretor mais rico, o ranking de Relatórios deve ser revisado para consumi-lo.

## Situação após a Etapa 5

- P0 (Etapa 3) e P2 (Etapa 5) da auditoria de paridade estão concluídos;
- P1 (Agenda, Corretores/Comissões, Projetos, Mapa) segue com o Codex na Etapa 4;
- UAT completo por papel/dispositivo continua na Etapa 6;
- credenciais e integrações reais (Asaas, Pluggy, WhatsApp, Anthropic) continuam na Etapa 7;
- a migração dos endpoints administrativos legados de `STAFF_ROLES` para permissão granular continua planejada para a Etapa 6.

## Evidências de encerramento

- TypeScript aprovado (`npx tsc --noEmit`, zero erros);
- Vitest: 47 arquivos e 285 testes aprovados (8 novos desta etapa);
- build Vite e bundle do servidor (`esbuild`) aprovados;
- `git diff --check` aprovado, sem erros de espaço em branco;
- sem migration a validar ou aplicar — confirmado que nenhuma tabela foi criada ou alterada.

A inspeção visual em navegador real não foi possível nesta sessão (sandbox sem acesso à internet externa), mesma limitação já registrada nas etapas anteriores. UAT autenticado completo permanece planejado para a Etapa 6.
