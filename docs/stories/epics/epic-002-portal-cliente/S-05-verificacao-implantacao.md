# Story S-05 — Verificação e implantação segura

**Epic:** EPIC-002  
**Status:** In Progress (PR/preview pendentes)
**executor:** Codex  
**quality_gate:** TypeScript, Vitest, build, Drizzle, CI e preview

## Contexto

O portal adiciona uma fronteira de autorização sensível e tabelas novas. A entrega só pode ser integrada após validação limpa e sem aplicar automaticamente mudanças no Neon de produção.

## Acceptance Criteria

- [x] AC-01: `npm run check`, `npm test` e `npm run build` passam do zero
- [x] AC-02: migration Drizzle é determinística e uma nova geração não encontra alterações residuais
- [x] AC-03: testes cobrem papéis, vínculo ausente, acesso cruzado, upload inválido e limites do chat
- [ ] AC-04: PR/CI e preview ficam verdes antes do merge
- [x] AC-05: validação no Neon de produção é registrada como realizada com acesso somente leitura ou explicitamente como não validada por falta de acesso
- [x] AC-06: nenhuma migration é aplicada automaticamente em produção

## Tasks

- [x] Executar gates locais limpos
- [x] Revisar SQL gerado e idempotência do snapshot Drizzle
- [ ] Publicar PR e conferir CI/preview
- [ ] Atualizar EPIC/ROADMAP e realizar merge do checkpoint aprovado

## Resultado local

- TypeScript: aprovado.
- Vitest: 237/237 testes aprovados em 36 arquivos.
- Build: aprovado; permanecem apenas avisos preexistentes de placeholders Vite e tamanho do bundle.
- Drizzle: `0008_portal_cliente.sql` gerada e segunda geração retornou `No schema changes`.
- Neon de produção: **não validado, pendente de acesso somente leitura**.
- Migration de produção: não aplicada.

## Change Log

| Date | Version | Change |
|------|---------|--------|
| 2026-09-07 | 0.1.0 | Story de verificação detalhada |
