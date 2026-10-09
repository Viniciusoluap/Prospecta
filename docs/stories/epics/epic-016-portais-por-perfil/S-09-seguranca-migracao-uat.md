# Story S-09 — Segurança, migração, UAT e produção

**Epic:** EPIC-016  
**Status:** Draft  
**Executor previsto:** @qa + @devops  
**Quality gate:** proprietário do produto

## Objetivo

Validar o conjunto completo, conciliar os vínculos existentes e promover os dois sistemas com
evidência, snapshot e rollback.

## Acceptance Criteria

- [ ] AC-01: typecheck, testes e builds passam nos dois repositórios
- [ ] AC-02: testes cruzados comprovam isolamento de cliente e corretor
- [ ] AC-03: dry-run informa todas as alterações e pendências antes do backfill real
- [ ] AC-04: contagens antes/depois são conciliadas sem perda ou duplicidade
- [ ] AC-05: UAT autenticado cobre cliente, corretor, admin e colaborador em três viewports
- [ ] AC-06: snapshot é criado antes de cada migration de produção
- [ ] AC-07: smoke test pós-deploy e monitoramento não apontam erro crítico
- [ ] AC-08: rollback está documentado e executável

## Tasks

- [ ] executar checklist de segurança e privacidade
- [ ] gerar evidências automatizadas e manuais
- [ ] executar preview/UAT
- [ ] aprovar e executar migrations/backfills
- [ ] deploy gradual nos dois sistemas
- [ ] monitorar e encerrar redirects somente após estabilidade

## Dependências

S-01 a S-08 concluídas e aprovadas.

