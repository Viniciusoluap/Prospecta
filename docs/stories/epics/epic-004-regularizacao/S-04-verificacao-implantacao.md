# S-04 — Verificação e implantação segura

## Critérios de aceitação

- [x] TypeScript sem erros.
- [x] Testes automatizados aprovados (51 testes).
- [x] Build de produção aprovado.
- [ ] Schema remoto confrontado em modo somente leitura.
- [x] Migração de registro contém somente comentários, sem `CREATE` ou `ALTER`.
- [x] Geração seguinte retorna `No schema changes`.

## Implantação

1. Fornecer acesso somente leitura ao Neon e comparar colunas, nulabilidade, defaults e chaves.
2. Gerar a migração consolidada dos demais EPICs apenas após a comparação.
3. Revisar o SQL e bloquear qualquer `CREATE TABLE`/`ALTER TABLE` de `regularizacoes` e `regularizacao_documents`.
4. Publicar aplicação e executar smoke test com uma regularização de teste.
