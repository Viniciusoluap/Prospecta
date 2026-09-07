# Story S-03 — Contratos, documentos e assinatura externa gov.br

**Epic:** EPIC-002  
**Status:** Done
**executor:** Codex  
**quality_gate:** TypeScript, Vitest, build e revisão de upload

## Contexto e rastreabilidade

No Santa Fé, a equipe associa contratos e PDFs ao lead. Quando a assinatura é solicitada, o cliente baixa o documento, usa o assinador oficial externo (`https://assinador.iti.br`) e envia o PDF assinado. Não há integração direta com API gov.br.

Fontes: `web/src/app/portal/documentos/page.tsx`, `web/src/app/portal/documentos/_components/assinatura-govbr.tsx`, `web/src/lib/actions/portal.ts` e modelos `Contrato`/`ContratoDocumento`.

## Acceptance Criteria

- [x] AC-01: equipe cria/atualiza contratos do lead e registra documentos com os estados rastreados ao Santa Fé
- [x] AC-02: cliente lista e baixa somente documentos dos próprios contratos
- [x] AC-03: assinatura solicitada apresenta os três passos reais: baixar, assinar externamente no gov.br e reenviar
- [x] AC-04: upload aceita apenas PDF de até 10 MiB, valida conteúdo declarado, contrato e titularidade antes do storage
- [x] AC-05: upload válido cria documento `assinado` e atualiza o estado do contrato de forma consistente

## Tasks

- [x] Implementar CRUD administrativo mínimo de contratos/documentos
- [x] Implementar listagem do cliente e instruções do assinador externo
- [x] Implementar upload seguro via storage configurado
- [x] Testar validação, RBAC e tentativa de acesso cruzado

## Change Log

| Date | Version | Change |
|------|---------|--------|
| 2026-09-07 | 0.1.0 | Story detalhada a partir da fonte Santa Fé |
