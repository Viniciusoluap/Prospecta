# EPIC-031 S-2 — Renomear no Google Drive os arquivos antigos dos Projetos (só o nome)

**Status:** InReview (commits locais no ramo `projetos-entregue-nomes`, já com a `main` mesclada — S-1 do PR #340 e PCI
do #344; sem push, PR, nem migração aplicada)

## Autorização do dono (26/11/2026)

> "Pode renomear os arquivos do Google Drive sim"

Alcance: os arquivos ANTIGOS dos Projetos podem ter o NOME trocado no próprio Google Drive para o nome padrão curto da
S-1. Só o nome — nunca conteúdo, pasta, permissão nem exclusão. Resolve a pendência da S-1.

## Critérios de aceite

- [x] O nome no Drive é EXATAMENTE o que a tela mostra hoje: mesmas funções, mesma lista, mesma ordem, mesmos argumentos
      — `nomesPadraoArquivosProjeto(files, { clientName, checklist })` sobre `operational_projects.files` (como
      `AdminProjetos.tsx`, sem `reservados`) e, nas entregas de revisão, o cálculo de `ProjetoRevisoes.tsx`
      (`Rev<ordem da revisão no projeto>`). Itens com o mesmo nome curto saem com a forma distinta (`Eletrico-BlocoA`).
- [x] Arquivo já GRAVADO no padrão (tem nome original guardado e `ehNomePadraoArquivoProjeto(nome)`) não é tocado.
- [x] Só renomeia arquivo antigo com registro em `project_documents` (ativo ou substituído) cujo `drive_file_id` é o da
      tela. Nunca: registro apagado, arquivo na lixeira, sem permissão de renomear, arquivo da tela sem registro, registro
      que a tela não mostra, registro que aparece duas vezes.
- [x] Nunca dois arquivos do mesmo projeto com o mesmo nome no Drive: se o nome já é de outro registro do projeto (no
      Drive) ou de outro arquivo da tela, não renomeia agora (`colisoes`) e tenta na próxima execução.
- [x] Tela = Drive antes e depois, e o nome fica ESTÁVEL: depois de renomear, o nome é gravado (congelado) na lista do
      projeto; a tela passa a mostrá-lo como "gravado" e não recalcula mais, mesmo que outro arquivo seja apagado depois.
- [x] A chamada ao Drive troca só `name` (`PATCH files/{id}` com corpo `{ name }`).
- [x] `project_documents.original_name` nunca é alterado. Idempotente: rodar de novo não chama o Drive.
- [x] Lotes de 25, com limite de tempo; falha num arquivo não interrompe os outros, não grava nada dele e fica registrada
      (só etapa/código HTTP/motivo do Google; log só com o id). Depois de 5 falhas, desiste do arquivo. Limite de taxa do
      Google para o lote sem contar como falha.
- [x] Modo "só conferir" (`conferir: true`): quantos seriam renomeados e até 10 exemplos antes → depois, sem tocar no
      Drive nem no banco.
- [x] Roda sozinho, sem botão novo e sem cron novo: no cron dos avisos da tarde da Dolores (`/api/cron/dolores-avisos/15`
      a `/19`, 15h–19h de Brasília), depois dos avisos, só com o `CRON_SECRET`, no máximo 15 s e 25 arquivos por execução.
      Nunca lança nem muda o status da resposta; o resumo (só contagens) vai em `nomesDrive`.

## Desenho

- `server/drive-documents.ts` — `renomearArquivoNoDrive(fileId, nome)`: lê `name,trashed,capabilities(canRename)`;
  lixeira ou sem permissão → não toca; nome igual → nada; senão PATCH só do nome (mesmo cliente/credencial; escopo
  `drive` completo). No máximo 8 s por arquivo.
- `server/projetos-nome-drive.ts`:
  - `planoDoProjeto`: reproduz a tela (lista + revisões) e marca, para cada arquivo antigo com registro, onde o nome está
    guardado (posição no JSON `files` ou na entrega da revisão).
  - `renomearDocumentosProjetoNoDrive({ conferir, limite, prazoMs })`: lista os pendentes; para cada um, numa transação
    com `SELECT … FOR UPDATE` na linha do projeto (a mesma trava do envio de arquivo), relê tudo, confere que o nome da
    tela ainda é o mesmo (senão `mudaram`) e que não colide, renomeia no Drive e grava.
  - `renomearNomesDriveNoCron(autorizado, prazoMs)`: o lote do cron; nunca lança.

## O que é gravado (só depois de o Drive aceitar)

| Onde | O quê |
|---|---|
| `operational_projects.files` (item do checklist / documento antigo) | `name` = nome novo; `originalName` = o que já havia, ou `project_documents.original_name` |
| `project_revision_requests.deliveries` (entrega de revisão) | `nome` = nome novo; `nomeOriginal` = o que já havia, ou `project_documents.original_name` |
| `project_documents` | `canonical_name` = nome novo; `drive_renamed_at` = agora (só se o Drive foi de fato renomeado); `drive_rename_error` = NULL |
| `project_documents` (em falha) | `drive_rename_failures + 1`; `drive_rename_error` = código |

Nenhum outro campo do JSON muda (link, `documentId`, `driveFileId`, versão, tipo). `updated_at` do projeto e do pedido
não muda (não é atividade de ninguém). `project_documents.original_name` nunca muda.

## Migração

`drizzle/0175_projeto_documentos_nome_drive.sql` — ADITIVA, sem mudança nesta etapa: `drive_renamed_at`,
`drive_rename_failures`, `drive_rename_error`. Fora do schema do Drizzle de propósito (os `select()` existentes não
dependem delas). Sem a migração, a rotina devolve `{ erro: true }` no cron e o resto do sistema segue igual.

## Como desfazer

Os renomeados pelo sistema têm `drive_renamed_at` preenchido. Para voltar um arquivo:
1. no Drive, `renomearArquivoNoDrive(drive_file_id, original_name)`;
2. `project_documents.canonical_name = original_name`;
3. na lista do projeto (ou na entrega), voltar `name`/`nome` para o nome antigo. Se o `originalName`/`nomeOriginal` foi
   ACRESCENTADO pela rotina (arquivo antigo que não o tinha), retirá-lo; com isso a tela volta a calcular o nome.
Para parar a rotina: retirar a chamada `renomearNomesDriveNoCron` de `api/index.ts`.

## Pendências e limites

- Aplicar a 0175 no Neon de produção (aditiva) antes ou junto da publicação.
- Arquivo da tela sem registro em `project_documents` (só no JSON `files`) não é renomeado nem congelado: continua com
  o nome antigo no Drive e com o nome calculado na tela (que pode mudar se a lista mudar).
- Enquanto um arquivo antigo não foi processado, o nome calculado dele pode mudar (ex.: outro arquivo apagado antes); a
  rotina sempre usa o nome da tela no momento da gravação (conferido sob trava) e, depois, ele não muda mais.

## File List

- `server/drive-documents.ts` — `renomearArquivoNoDrive` (novo).
- `server/projetos-nome-drive.ts` (novo).
- `server/projetos-nome-drive.test.ts` (novo).
- `drizzle/0175_projeto_documentos_nome_drive.sql` (novo, não aplicada).
- `api/index.ts` — chamada no cron dos avisos da tarde.

## Testes

- (a) Automáticos: `npx tsc --noEmit` limpo; `server/projetos-nome-drive.test.ts` 15/15 (PGlite com a 0175; Drive
  simulado): só os antigos, com o nome da tela; já gravado no padrão não é tocado; apagado/sem registro/fora da tela
  nunca; `original_name` intacto; nome gravado na lista e na entrega com o original; tela igual antes, no meio e depois;
  estável depois de apagar outro arquivo; idempotência; falha parcial sem gravar e desistência; lixeira/sem permissão;
  limite de taxa; colisão com outro registro; dois itens com o mesmo nome curto (`Eletrico-BlocoA`/`-BlocoB`); revisões
  `Rev1`/`Rev2` pela ordem; lote de 25 e prazo; dry-run; Drive não configurado; cron sem segredo; sem a migração.
  Também: `server/projetos-entregue-e-nome-padrao.test.ts` 14/14, `server/projeto-documentos.test.ts` 4/4,
  `server/projeto-revisao.test.ts` 5/5, `server/api-rotas-producao.test.ts` 2/2, `server/imports-esm.test.ts` 2/2.
- (b) Manuais: nenhum. Nada foi rodado contra o Drive ou o banco reais.
- (c) Pendentes em produção: aplicar a 0175; depois do primeiro cron das 15h, conferir `nomesDrive` nos logs da Vercel e
  abrir no Drive um arquivo antigo para ver o nome igual ao da tela.
