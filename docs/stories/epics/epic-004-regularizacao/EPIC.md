# EPIC-004: Regularização imobiliária

**Epic Owner:** Codex
**Status:** Done — validação somente-leitura do Neon documentada como pendência operacional

## Problema e origem da regra

O Grupo Santa Fé possui o módulo `Regularizacao`/`RegDocumento`, com workflow de processos e documentos. Sem o equivalente no Prospecta, o histórico do cliente, as etapas de cartório, os valores e a documentação ficavam separados.

Em 06/09/2026 foi confirmado que as tabelas `regularizacoes` e `regularizacao_documents` já existiam vazias no Neon do SiteProspecta. O dono do produto decidiu reaproveitar essa estrutura, vinculando `lead_id` conceitualmente ao CRM, em vez de recriá-la.

## Decisão de compatibilidade

O código apenas passa a declarar e consumir as tabelas existentes. A migração associada registra metadados no Drizzle e não contém `CREATE TABLE` nem `ALTER TABLE`. A estrutura informada no adendo de 06/09/2026 e confirmada pela trilha Claude é a fonte de verdade.

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
| S-04 | Verificação e implantação segura | Concluída localmente; Neon pendente de acesso |
