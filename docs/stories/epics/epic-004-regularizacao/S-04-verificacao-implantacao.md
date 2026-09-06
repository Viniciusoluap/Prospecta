# S-04 — Verificação e implantação segura

## Critérios de aceitação

- [x] TypeScript sem erros.
- [x] Testes automatizados aprovados (53 testes em 2026-09-06, após o checkpoint de recuperação).
- [x] Build de produção aprovado.
- [ ] Schema remoto confrontado em modo somente leitura — **não validado, pendente de acesso ao Neon de produção**.
- [x] Migração de registro contém somente comentários, sem `CREATE` ou `ALTER`.
- [x] Geração seguinte retorna `No schema changes`.

## Implantação

Validação local repetida do zero no commit de recuperação: typecheck, 53 testes e build aprovados. A ausência de credencial somente-leitura foi preservada como pendência; nenhuma conexão ou migração de produção foi simulada.

1. Fornecer acesso somente leitura ao Neon e comparar colunas, nulabilidade, defaults e chaves.
2. Gerar a migração consolidada dos demais EPICs apenas após a comparação.
3. Revisar o SQL e bloquear qualquer `CREATE TABLE`/`ALTER TABLE` de `regularizacoes` e `regularizacao_documents`.
4. Publicar aplicação e executar smoke test com uma regularização de teste.
