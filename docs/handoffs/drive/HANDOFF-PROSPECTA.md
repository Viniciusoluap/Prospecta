# HANDOFF — Organização completa do Google Drive (Prospecta) — 29/10/2026

Branch: `claude/drive-organizacao-20261029` · Spec: `docs/handoffs/drive/SPEC-DRIVE-ORGANIZACAO.md`

## Etapa 1 — concluída
- `shared/drive-estrutura.ts`: funções puras de caminho/nome dos tipos novos (Equipe, Modelos/PCI CAIXA,
  Obras/Fotos, Obras/Gerador de PCI, WhatsApp no cliente e sem cliente, Incorporação/Orçamento) e etiquetas da spec.
- `server/drive-estrutura.test.ts`: testes dos caminhos/nomes novos.

## Pendências
- Migração 0093 + schema; upload ao gravar; lixeira ao excluir; sincronizador + cron + botão.

## Testes
- (a) automáticos: `pnpm vitest run server/drive-estrutura.test.ts` — 14/14.
- (b) manuais: nenhum. (c) produção: tudo pendente.

## Próximo passo
- Migração `drizzle/0093_drive_organizacao.sql` e `server/drive-arquivos.ts`.
