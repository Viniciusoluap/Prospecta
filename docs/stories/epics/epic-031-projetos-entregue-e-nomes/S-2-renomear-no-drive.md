# EPIC-031 S-2 — Renomear no Google Drive os arquivos antigos dos Projetos (só o nome)

**Status:** InReview (commit local no ramo `projetos-entregue-nomes`; sem push, PR, nem migração aplicada)

## Autorização do dono (26/11/2026)

> "Pode renomear os arquivos do Google Drive sim"

Alcance: os arquivos ANTIGOS dos Projetos podem ter o NOME trocado no próprio Google Drive para o nome padrão curto da
S-1. Só o nome — nunca conteúdo, pasta, permissão nem exclusão. Resolve a pendência "Renomear os arquivos ANTIGOS no
próprio Google Drive" da S-1.

## Critérios de aceite

- [x] O nome no Drive fica IGUAL ao da tela: as mesmas funções puras (`nomesPadraoArquivosProjeto` sobre
      `operational_projects.files`, na mesma ordem; `nomePadraoArquivoProjeto` para as entregas de revisão, igual a
      `ProjetoRevisoes.tsx`). Colisão de nome: a sequência estável da função pura.
- [x] Só renomeia arquivo com registro em `project_documents` (ativo ou substituído) cujo `drive_file_id` é o da tela.
      Nunca: registro apagado, arquivo na lixeira do Drive, arquivo sem permissão de renomear, arquivo que a tela mostra
      sem registro, registro que a tela não mostra, registro com dois nomes possíveis.
- [x] A chamada ao Drive troca só `name` (`PATCH files/{id}` com corpo `{ name }`, sem `addParents`/`removeParents`).
- [x] `original_name` nunca é alterado. Depois de renomear, o nome novo vai para `canonical_name` e a data para
      `drive_renamed_at`. Idempotente: rodar de novo não chama o Drive.
- [x] Lotes de 25, com limite de tempo; falha num arquivo não interrompe os outros e fica registrada
      (`drive_rename_failures`, `drive_rename_error` só com etapa/código HTTP/motivo do Google; log só com o id). Depois de 5
      falhas, a rotina desiste daquele arquivo. Limite de taxa do Google (429 / `rateLimitExceeded`) para o lote sem
      contar como falha.
- [x] Modo "só conferir" (`conferir: true`): devolve quantos seriam renomeados e até 10 exemplos antes → depois, sem
      tocar no Drive nem no banco.
- [x] Roda sozinho em produção, sem botão novo e sem cron novo: dentro do cron que já existe dos avisos da tarde da
      Dolores (`/api/cron/dolores-avisos/15`…`/19`, 15h–19h de Brasília), depois dos avisos, só com o `CRON_SECRET`,
      no máximo 15 s e 25 arquivos por execução (até 125 por dia). Sem pendência: uma leitura do banco e mais nada.
      Nunca lança nem muda o status da resposta do cron; o resumo (só contagens) vai no corpo em `nomesDrive`.

## Desenho

- `server/drive-documents.ts` — `renomearArquivoNoDrive(fileId, nome)`: lê `name,trashed,capabilities(canRename)`;
  lixeira → não toca; nome igual → nada; `canRename=false` → não toca; senão PATCH só do nome. Usa o mesmo cliente
  e credencial do Drive (escopo `drive` completo, que já permite renomear — o "Organizar Drive" já renomeia pastas).
  Cada arquivo tem no máximo 8 s (`comPrazoNoDrive`).
- `server/projetos-nome-drive.ts` — `renomearDocumentosProjetoNoDrive({ conferir, limite, prazoMs })` e
  `renomearNomesDriveNoCron(autorizado, prazoMs)`.
- `drizzle/0175_projeto_documentos_nome_drive.sql` — migração ADITIVA (`ADD COLUMN IF NOT EXISTS`): `drive_renamed_at`,
  `drive_rename_failures`, `drive_rename_error`. As colunas NÃO entram no schema do Drizzle de propósito: os `select()`
  de `project_documents` existentes não passam a depender delas; antes de a migração ser aplicada, a rotina só devolve
  `{ erro: true }` no cron (testado) e o resto do sistema segue igual.

## Como desfazer

O nome original de cada arquivo continua em `project_documents.original_name`. Para voltar um arquivo: trocar o nome no
Drive para `original_name` (mesma função `renomearArquivoNoDrive(drive_file_id, original_name)`) e gravar
`canonical_name = original_name`. Os renomeados pelo sistema são os que têm `drive_renamed_at` preenchido.
Para parar a rotina: retirar a chamada `renomearNomesDriveNoCron` de `api/index.ts` (rota dos avisos da tarde).

## Pendências

- Aplicar `drizzle/0175_projeto_documentos_nome_drive.sql` no Neon de produção (aditiva) antes ou junto da publicação.
- Arquivo antigo que aparece na tela mas não tem registro em `project_documents` (só no JSON `files`) não é renomeado:
  o registro não o reconhece. Fica com o nome antigo no Drive (a tela continua mostrando o nome padrão).

## File List

- `server/drive-documents.ts` — `renomearArquivoNoDrive` (novo).
- `server/projetos-nome-drive.ts` (novo).
- `server/projetos-nome-drive.test.ts` (novo).
- `drizzle/0175_projeto_documentos_nome_drive.sql` (novo, não aplicada).
- `api/index.ts` — chamada no cron dos avisos da tarde.

## Testes

- (a) Automáticos: `npx tsc --noEmit` limpo; `server/projetos-nome-drive.test.ts` 11/11 (PGlite com a migração 0175;
  Drive simulado: só o que difere, `original_name` intacto, apagado/sem registro/fora da tela nunca, idempotência,
  lote de 25 e prazo, falha parcial e desistência, lixeira/sem permissão, limite de taxa, dry-run sem tocar em nada,
  Drive não configurado, sem segredo do cron, sem as colunas da migração nunca lança);
  `server/projetos-entregue-e-nome-padrao.test.ts` 9/9, `server/api-rotas-producao.test.ts` 2/2, `server/imports-esm.test.ts` 2/2.
- (b) Manuais: nenhum. Nada foi rodado contra o Drive ou o banco reais.
- (c) Pendentes em produção: aplicar a 0175; depois do primeiro cron da tarde (15h de Brasília), conferir `nomesDrive` na
  resposta do cron nos logs da Vercel e abrir no Drive um arquivo antigo de um projeto para ver o nome padrão igual ao da tela.
