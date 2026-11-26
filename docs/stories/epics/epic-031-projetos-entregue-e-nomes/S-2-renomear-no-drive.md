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
- [x] Nunca dois arquivos do mesmo projeto com o mesmo nome no Drive: se o nome já é o `canonical_name` de outro registro
      do projeto (de QUALQUER status — apagado e "enviando" continuam/vão estar no Drive) ou de outro arquivo da tela, não
      renomeia agora (`colisoes`) e tenta na próxima execução.
- [x] Tela = Drive antes e depois, e o nome fica ESTÁVEL: depois de renomear, o nome é gravado (congelado) na lista do
      projeto; a tela passa a mostrá-lo como "gravado" e não recalcula mais, mesmo que outro arquivo seja apagado depois.
- [x] A chamada ao Drive troca só `name` (`PATCH files/{id}` com corpo `{ name }`).
- [x] `project_documents.original_name` nunca é alterado. Idempotente: rodar de novo não chama o Drive.
- [x] Lotes de 25, com limite de tempo: um arquivo só começa se ainda couberem os 8 s da chamada ao Drive dentro do
      prazo (cada chamada recebe `min(8 s, restante)`); falha num arquivo não interrompe os outros, não grava nada dele e
      fica registrada (só etapa/código HTTP/motivo do Google; log só com o id). Só erro 4xx do Google (fora limite de taxa)
      conta para as 5 falhas que fazem a rotina desistir do arquivo; 5xx e tempo esgotado ficam registrados em
      `drive_rename_error` e contados em `falhasTemporarias`, sem desistência. Limite de taxa (429 ou 403 `*rateLimit*`)
      para o lote sem contar como falha.
- [x] Reversível: antes de gravar, o registro guarda (uma vez só, nunca sobrescrito) o nome que o arquivo tinha no Drive,
      o nome que estava na lista da tela e se a rotina acrescentou o nome original na lista.
- [x] Modo "só conferir" (`conferir: true`): quantos seriam renomeados, quantos colidiriam e até 10 exemplos antes →
      depois, sem tocar no Drive nem no banco.
- [x] Modo "um dia só conferindo" no cron: sem `PROJETOS_NOME_DRIVE_ESCREVER=1` (variável na Vercel), o cron só confere e
      devolve SÓ contagens (`pendentes`, `semVinculoNaTela`, `desistidos`, `colisoes`) — nunca os exemplos (têm nome de
      cliente), nem na resposta nem em log. Com `=1`, renomeia.
- [x] Roda sozinho, sem botão novo e sem cron novo: no cron dos avisos da tarde da Dolores (`/api/cron/dolores-avisos/15`
      a `/19`, 15h–19h de Brasília), depois dos avisos, só com o `CRON_SECRET`, no máximo 15 s (e nunca além de 50 s do
      total do cron) e 25 arquivos por execução.
      Nunca lança nem muda o status da resposta; o resumo (só contagens) vai em `nomesDrive`.

## Desenho

- `server/drive-documents.ts` — `renomearArquivoNoDrive(fileId, nome)`: lê `name,trashed,capabilities(canRename)`;
  lixeira ou sem permissão → não toca; nome igual → nada; senão PATCH só do nome (mesmo cliente/credencial; escopo
  `drive` completo). Devolve `{ resultado, nomeAnterior }` (o nome lido no GET, antes de qualquer escrita). No máximo
  8 s por arquivo.
- `server/projetos-nome-drive.ts`:
  - `planoDoProjeto`: reproduz a tela (lista + revisões) e marca, para cada arquivo antigo com registro, onde o nome está
    guardado (posição no JSON `files` ou na entrega da revisão).
  - `renomearDocumentosProjetoNoDrive({ conferir, limite, prazoMs })`: lista os pendentes; para cada um, numa transação
    com `SET LOCAL lock_timeout = '5s'`, `pg_advisory_xact_lock(hashtext('project-document:<id do projeto>'))` (a MESMA
    trava da reserva do envio em `server/routes/projeto-documentos.ts`) e `SELECT … FOR UPDATE` na linha do projeto
    (a trava das outras gravações da lista), relê tudo, confere que o nome da tela ainda é o mesmo (senão `mudaram`) e
    que não colide com o `canonical_name` de nenhum registro do projeto (consulta à parte, qualquer status), renomeia no
    Drive e grava. Trava esperando mais de 5 s (SQLSTATE 55P03) → o projeto é pulado nesta execução (`ocupados`), sem
    contar falha do arquivo.
  - `renomearNomesDriveNoCron(autorizado, prazoMs)`: o lote do cron (ou só a conferência, sem a variável); nunca lança.

## O que é gravado (só depois de o Drive aceitar)

| Onde | O quê |
|---|---|
| `operational_projects.files` (item do checklist / documento antigo) | `name` = nome novo; `originalName` = o que já havia, ou `project_documents.original_name` |
| `project_revision_requests.deliveries` (entrega de revisão) | `nome` = nome novo; `nomeOriginal` = o que já havia, ou `project_documents.original_name` |
| `project_documents` | `canonical_name` = nome novo; `drive_renamed_at` = agora (só se o Drive foi de fato renomeado); `drive_rename_error` = NULL |
| `project_documents` (para desfazer; `COALESCE`: só se ainda vazio) | `drive_name_before` = nome lido no Drive antes de renomear; `list_name_before` = `name`/`nome` que estava na lista; `list_original_added` = `true` se a rotina acrescentou `originalName`/`nomeOriginal`, `false` se já existia |
| `project_documents` (falha 4xx, lixeira, sem permissão) | `drive_rename_failures + 1`; `drive_rename_error` = código |
| `project_documents` (5xx, tempo esgotado) | só `drive_rename_error` = código (não conta para a desistência) |

Nenhum outro campo do JSON muda (link, `documentId`, `driveFileId`, versão, tipo). `updated_at` do projeto e do pedido
não muda (não é atividade de ninguém). `project_documents.original_name` nunca muda.

## Migração

`drizzle/0175_projeto_documentos_nome_drive.sql` — ADITIVA (`ADD COLUMN IF NOT EXISTS`), AINDA NÃO aplicada:
`drive_renamed_at`, `drive_rename_failures`, `drive_rename_error` e, para desfazer, `drive_name_before varchar(255)`,
`list_name_before varchar(255)`, `list_original_added boolean` (nulas, sem default). Nomes acima de 255 caracteres são
guardados cortados em 255 (limite conhecido). Fora do schema do Drizzle de propósito (os `select()` existentes não
dependem delas). Sem a migração, a rotina devolve `{ erro: true }` no cron e o resto do sistema segue igual.

## Como desfazer

Os renomeados pelo sistema têm `drive_renamed_at` preenchido (os que já estavam certos no Drive têm `drive_renamed_at`
nulo e `drive_name_before` igual ao nome atual: no Drive não há o que voltar). Para voltar UM registro `<id>`:
1. Ler a linha: `SELECT id, project_id, revision_id, drive_file_id, canonical_name, drive_name_before, list_name_before,
   list_original_added FROM project_documents WHERE id = <id>;`
2. **Drive**: se `drive_renamed_at` não é nulo, `renomearArquivoNoDrive(drive_file_id, drive_name_before)` (troca só o
   nome; se `drive_name_before` for nulo — registro de antes desta correção —, usar `original_name`).
3. **Lista da tela**: achar o item pelo `documentId = <id>` (ou pelo `driveFileId`/link com `drive_file_id`) em
   `operational_projects.files` do `project_id` — ou, se `revision_id` não é nulo, em
   `project_revision_requests.deliveries` desse id. Voltar `name` (lista) / `nome` (entrega) para `list_name_before`.
   Se `list_original_added = true`, REMOVER a chave `originalName` (lista) / `nomeOriginal` (entrega) — assim a tela
   volta a calcular o nome, como antes; se `false`, deixar como está.
4. **Registro**: `UPDATE project_documents SET canonical_name = drive_name_before, drive_renamed_at = NULL,
   drive_name_before = NULL, list_name_before = NULL, list_original_added = NULL WHERE id = <id>;` (passos 3 e 4 na mesma
   transação, com `pg_advisory_xact_lock(hashtext('project-document:<project_id>'))` e `SELECT … FOR UPDATE` no projeto).
   Atenção: enquanto a rotina estiver ligada, o registro voltaria a ser renomeado na próxima execução — antes de desfazer,
   desligar (abaixo).

Para parar a rotina de ESCREVER: retirar `PROJETOS_NOME_DRIVE_ESCREVER` da Vercel (ou trocar para outro valor) — ela
volta a só conferir. Para parar de vez: retirar a chamada `renomearNomesDriveNoCron` de `api/index.ts`.

## Pendências e limites

- Aplicar a 0175 no Neon de produção (aditiva) antes ou junto da publicação.
- Ligar a escrita: depois de UM dia só conferindo (contagens em `nomesDrive` nos logs da Vercel), cadastrar
  `PROJETOS_NOME_DRIVE_ESCREVER=1` na Vercel (decisão/ação do dono).
- Arquivo da tela sem registro em `project_documents` (só no JSON `files`) não é renomeado nem congelado: continua com
  o nome antigo no Drive e com o nome calculado na tela (que pode mudar se a lista mudar).
- Enquanto um arquivo antigo não foi processado, o nome calculado dele pode mudar (ex.: outro arquivo apagado antes); a
  rotina sempre usa o nome da tela no momento da gravação (conferido sob trava) e, depois, ele não muda mais.

## File List

- `server/drive-documents.ts` — `renomearArquivoNoDrive` (novo; devolve também o nome anterior).
- `server/projetos-nome-drive.ts` (novo).
- `server/projetos-nome-drive.test.ts` (novo).
- `drizzle/0175_projeto_documentos_nome_drive.sql` (novo, não aplicada; + 3 colunas para desfazer).
- `api/index.ts` — chamada no cron dos avisos da tarde (total 50 s).
- `drizzle/schema.ts` — sem mudança, de propósito: `server/routes/projeto-documentos.ts` faz `select()` completo de
  `project_documents`; com as colunas no schema, o envio de arquivo quebraria se a publicação saísse antes da 0175.

## Correções do portão de QA (26/11)

1. (ALTA) Colisão compara com o `canonical_name` de TODOS os registros do projeto (qualquer status, consulta à parte) e a
   transação pega a mesma `pg_advisory_xact_lock` da reserva do envio.
2. (ALTA) Reversibilidade: `drive_name_before`, `list_name_before`, `list_original_added` (gravados com `COALESCE`);
   "Como desfazer" reescrito com essas colunas.
3. (MÉDIA) Prazo: só começa um arquivo se couberem os 8 s; cada chamada recebe `min(8 s, restante)`; cron com 50 s no total.
4. (BAIXA) `SET LOCAL lock_timeout = '5s'`; estourou → projeto pulado (`ocupados`), sem contar falha.
5. (BAIXA) Só 4xx (fora limite de taxa) conta para as 5 falhas; 5xx/tempo esgotado → `falhasTemporarias`.
6. Modo "um dia só conferindo" no cron (`PROJETOS_NOME_DRIVE_ESCREVER`), só contagens; conferir conta colisões.

## Testes

- (a) Automáticos (depois das correções do portão de QA): `npx tsc --noEmit` limpo; `server/projetos-nome-drive.test.ts`
  23/23 — novos: colisão com registro `deleted` e com `uploading` (escrita e conferir); nome anterior guardado e não
  sobrescrito na 2ª passagem; corte do prazo (+8 s) e prazo por chamada; lock_timeout pula o projeto sem falha; 5xx/tempo
  esgotado não contam e 4xx conta; cron sem a variável só confere e devolve só contagens (sem nome de cliente).
  Antes (15/15) (PGlite com a 0175; Drive
  simulado): só os antigos, com o nome da tela; já gravado no padrão não é tocado; apagado/sem registro/fora da tela
  nunca; `original_name` intacto; nome gravado na lista e na entrega com o original; tela igual antes, no meio e depois;
  estável depois de apagar outro arquivo; idempotência; falha parcial sem gravar e desistência; lixeira/sem permissão;
  limite de taxa; colisão com outro registro; dois itens com o mesmo nome curto (`Eletrico-BlocoA`/`-BlocoB`); revisões
  `Rev1`/`Rev2` pela ordem; lote de 25 e prazo; dry-run; Drive não configurado; cron sem segredo; sem a migração.
  Também: `server/projetos-entregue-e-nome-padrao.test.ts` 14/14, `server/projeto-documentos.test.ts` 4/4,
  `server/api-rotas-producao.test.ts` 2/2, `server/imports-esm.test.ts` 2/2 (e, na rodada anterior,
  `server/projeto-revisao.test.ts` 5/5).
- (b) Manuais: nenhum. Nada foi rodado contra o Drive ou o banco reais.
- (c) Pendentes em produção: aplicar a 0175; um dia só conferindo (contagens em `nomesDrive`); ligar
  `PROJETOS_NOME_DRIVE_ESCREVER=1`; depois do cron seguinte, abrir no Drive um arquivo antigo para ver o nome igual ao
  da tela e conferir `drive_name_before` preenchido. A espera real da trava (lock_timeout) só foi testada simulada.
