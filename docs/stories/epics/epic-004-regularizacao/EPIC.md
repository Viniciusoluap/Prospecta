# EPIC-004: Regularização imobiliária

**Epic Owner:** Codex
**Status:** Implementado — validação de produção pendente

## Problema

Os processos de regularização imobiliária eram acompanhados fora do Prospecta. Isso separava o histórico do cliente, as etapas de cartório, os valores e a documentação necessária.

## Decisão de compatibilidade

As tabelas `regularizacoes` e `regularizacao_documents` já existem no Neon do SiteProspecta. O código apenas passa a declará-las no Drizzle e consumi-las; não deve ser criada migração para essas duas tabelas. A estrutura informada no adendo de 2026-09-06 é a fonte de verdade.

## Requisitos funcionais

| ID | Requisito |
|---|---|
| RF-01 | Administrador cadastra e atualiza um processo de regularização. |
| RF-02 | Administrador filtra processos por etapa e consulta valores contratados/pagos. |
| RF-03 | Processo pode ser associado opcionalmente a um lead existente. |
| RF-04 | Checklist documental permite criar exigências e atualizar seu estado. |
| RF-05 | PDF, JPEG ou PNG de até 10 MB pode ser anexado a um documento. |
| RF-06 | Operações do módulo exigem papel `admin`. |

## Restrições

- Não recriar nem alterar automaticamente as tabelas já existentes em produção.
- Não modificar os domínios de sorteios, bilhetes, UTEF ou produtos.
- Uploads aceitam somente tipos explicitamente permitidos e nomes são normalizados.
- Exclusão de processo remove primeiro seus registros documentais; o arquivo remoto não é apagado.

## Stories

| Story | Entrega | Estado |
|---|---|---|
| S-01 | Mapear schema existente | Concluída |
| S-02 | API administrativa e workflow | Concluída |
| S-03 | Tela de gestão e documentos | Concluída |
| S-04 | Verificação e implantação segura | Em validação |
