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
- [x] Lotes de 25, com limite de tempo: um arquivo só começa se ainda couber o pior caso inteiro dele — leitura no Drive
      (8 s) + espera da trava (2 s) + espera da trava (2 s) + troca no Drive (8 s) = 20 s — dentro do prazo (cada chamada
      ao Drive recebe `min(8 s, restante)`); falha num arquivo não interrompe os outros, não grava nada dele e
      fica registrada (só etapa/código HTTP/motivo do Google; log só com o id e códigos — nunca a mensagem do erro do
      banco, que traz os parâmetros da consulta com nomes de cliente e de arquivo; erro do banco sai como `banco:<SQLSTATE>`). Só erro 4xx do Google (fora limite de taxa)
      conta para as 5 falhas que fazem a rotina desistir do arquivo; 5xx e tempo esgotado ficam registrados em
      `drive_rename_error` e contados em `falhasTemporarias`, sem desistência. Limite de taxa (429 ou 403 `*rateLimit*`)
      para o lote sem contar como falha.
- [x] Reversível: ANTES de qualquer escrita no Drive, numa transação própria já CONFIRMADA, o registro guarda (uma vez só,
      nunca sobrescrito) o nome que o arquivo tinha no Drive, o `canonical_name` anterior, o nome que estava na lista da
      tela e se a rotina acrescentou o nome original na lista. Se o banco falhar depois do PATCH, ou o tempo esgotar com o
      Google já tendo aplicado o nome, o nome real antigo continua guardado e a passagem seguinte completa a gravação.
- [x] Modo "só conferir" (`conferir: true`): quantos seriam renomeados, quantos colidiriam e até 10 exemplos antes →
      depois, sem tocar no Drive nem no banco.
- [x] Modo "um dia só conferindo" no cron: sem `PROJETOS_NOME_DRIVE_ESCREVER=1` (variável na Vercel), o cron só confere e
      devolve SÓ contagens (`pendentes`, `semVinculoNaTela`, `desistidos`, `colisoes`) — nunca os exemplos (têm nome de
      cliente), nem na resposta nem em log. Com `=1`, renomeia.
- [x] Roda sozinho, sem botão novo e sem cron novo: no cron dos avisos da tarde da Dolores (`/api/cron/dolores-avisos/15`
      a `/19`, 15h–19h de Brasília), depois dos avisos, só com o `CRON_SECRET`, no máximo 30 s (e nunca além de 50 s do
      total do cron, abaixo dos 60 s da Vercel, contando as esperas de trava) e 25 arquivos por execução.
      Nunca lança nem muda o status da resposta; o resumo (só contagens) vai em `nomesDrive`.

## Desenho

- `server/drive-documents.ts` — em duas chamadas separadas: `lerArquivoNoDrive(fileId)` (só GET de
  `name,trashed,capabilities(canRename)`) e `trocarNomeNoDrive(fileId, nome)` (só `PATCH` do nome; mesmo
  cliente/credencial; escopo `drive` completo). No máximo 8 s cada.
- `server/projetos-nome-drive.ts`:
  - `planoDoProjeto`: reproduz a tela (lista + revisões) e marca, para cada arquivo antigo com registro, onde o nome está
    guardado (posição no JSON `files` ou na entrega da revisão).
  - `renomearDocumentosProjetoNoDrive({ conferir, limite, prazoMs })`: lista os pendentes e, para cada um:
    1. **LER** no Drive (sem trava). Lixeira ou sem permissão (e nome diferente) → não toca.
    2. **GUARDAR o "antes"**: transação curta e CONFIRMADA (ver "Sob a trava" abaixo) que grava, com `COALESCE` (nunca
       sobrescreve), `drive_name_before` + `drive_name_before_origem`, `canonical_name_before`, `list_name_before` e
       `list_original_added`. Regra de ouro: `drive_name_before` nunca recebe um nome que já está no padrão novo vindo de
       "já estava": nesse caso, se nada foi guardado antes, recebe o `canonical_name` anterior do registro com origem
       `registro` (ESTIMADO); se o `canonical_name` também já é o nome novo, fica nulo (não há o que voltar no Drive).
    3. **RENOMEAR e GRAVAR**: nova transação sob a trava; confere tudo de novo; se o nome lido era diferente, `PATCH`;
       grava o nome na lista/entrega e em `canonical_name`. `drive_renamed_at` = agora quando o PATCH foi feito; também
       quando "já estava" mas o `drive_name_before` guardado (origem `drive`) é outro nome — o Drive FOI renomeado por
       nós numa passagem anterior que não terminou (banco falhou depois do PATCH, ou tempo esgotado depois de o Google
       aplicar). Esse caso conta como `renomeados`.
    - **Sob a trava** (passos 2 e 3): `SET LOCAL lock_timeout = '2000ms'`,
      `pg_advisory_xact_lock(hashtext('project-document:<id do projeto>'))` (a MESMA trava da reserva do envio em
      `server/routes/projeto-documentos.ts`) e `SELECT … FOR UPDATE` na linha do projeto; relê tudo, confere que o nome da
      tela ainda é o mesmo (senão `mudaram`) e que não colide com o `canonical_name` de nenhum registro do projeto
      (consulta à parte, qualquer status). Trava esperando mais de 2 s (SQLSTATE 55P03) → o projeto é pulado nesta
      execução (`ocupados`), sem contar falha do arquivo.
  - `renomearNomesDriveNoCron(autorizado, prazoMs)`: o lote do cron (ou só a conferência, sem a variável); nunca lança.

## O que é gravado (só depois de o Drive aceitar)

| Onde | O quê |
|---|---|
| `operational_projects.files` (item do checklist / documento antigo) | `name` = nome novo; `originalName` = o que já havia, ou `project_documents.original_name` |
| `project_revision_requests.deliveries` (entrega de revisão) | `nome` = nome novo; `nomeOriginal` = o que já havia, ou `project_documents.original_name` |
| `project_documents` | `canonical_name` = nome novo; `drive_renamed_at` = agora (só se o Drive foi de fato renomeado); `drive_rename_error` = NULL |
| `project_documents` (para desfazer; gravado e CONFIRMADO ANTES do PATCH; `COALESCE`: só se ainda vazio) | `drive_name_before` = nome lido no Drive antes de renomear (`drive_name_before_origem = 'drive'`, exato) ou, se o arquivo já estava com o nome novo e nada fora lido antes, o `canonical_name` anterior (`drive_name_before_origem = 'registro'`, ESTIMADO); `canonical_name_before` = `canonical_name` antes da rotina; `list_name_before` = `name`/`nome` que estava na lista; `list_original_added` = `true` se a rotina acrescentou `originalName`/`nomeOriginal`, `false` se já existia |
| `project_documents` (falha 4xx, lixeira, sem permissão) | `drive_rename_failures + 1`; `drive_rename_error` = código |
| `project_documents` (5xx, tempo esgotado) | só `drive_rename_error` = código (não conta para a desistência) |

Nenhum outro campo do JSON muda (link, `documentId`, `driveFileId`, versão, tipo). `updated_at` do projeto e do pedido
não muda (não é atividade de ninguém). `project_documents.original_name` nunca muda.

## Migração

`drizzle/0175_projeto_documentos_nome_drive.sql` — ADITIVA (`ADD COLUMN IF NOT EXISTS`), AINDA NÃO aplicada:
`drive_renamed_at`, `drive_rename_failures`, `drive_rename_error` e, para desfazer, `drive_name_before varchar(255)`,
`list_name_before varchar(255)`, `list_original_added boolean`, `canonical_name_before varchar(255)` e
`drive_name_before_origem varchar(20)` (`'drive'` exato / `'registro'` estimado) — nulas, sem default. Nomes acima de 255 caracteres são
guardados cortados em 255 (limite conhecido). Fora do schema do Drizzle de propósito (os `select()` existentes não
dependem delas). Sem a migração, a rotina devolve `{ erro: true }` no cron e o resto do sistema segue igual.

## Como desfazer

**Antes de tudo, desligar a escrita** (abaixo): com ela ligada, o registro voltaria a ser renomeado na próxima execução.
Para voltar UM registro `<id>`:
1. Ler a linha: `SELECT id, project_id, drive_file_id, canonical_name, drive_renamed_at, drive_name_before,
   drive_name_before_origem, canonical_name_before, list_name_before, list_original_added FROM project_documents
   WHERE id = <id>;`
2. **Drive** — conforme o caso:
   - `drive_renamed_at` preenchido e `drive_name_before_origem = 'drive'` (renomeado por nós, inclusive quando a passagem
     que fez o PATCH não terminou e a seguinte completou): trocar o nome no Drive para `drive_name_before`
     (`trocarNomeNoDrive(drive_file_id, drive_name_before)`; é o nome lido no Drive antes do PATCH — volta exata).
   - `drive_renamed_at` nulo e `drive_name_before_origem = 'drive'`: a rotina guardou o "antes" mas a passagem não
     terminou. Ler o nome atual no Drive (`lerArquivoNoDrive`): se já é o nome novo (`canonical_name` do passo 3 da rotina
     = nome da tela), o PATCH chegou ao Google — trocar para `drive_name_before`; se é o próprio `drive_name_before`,
     nada a fazer no Drive.
   - `drive_name_before_origem = 'registro'` (ESTIMADO) ou nulo: o arquivo já estava com o nome novo quando a rotina
     chegou; ela NÃO mexeu no Drive — nada a fazer (se o dono quiser mesmo assim, `drive_name_before` é a melhor
     estimativa: o nome que o sistema tinha gravado).
3. **Lista da tela**: achar o item pelo `documentId = <id>` (ou pelo `driveFileId`/link com `drive_file_id`) em
   `operational_projects.files` do `project_id`; se não estiver lá, procurar nas `deliveries` de TODOS os
   `project_revision_requests` do `project_id` (o `revision_id` dos registros antigos pode ser nulo). Voltar `name`
   (lista) / `nome` (entrega) para `list_name_before`. Se `list_original_added = true`, REMOVER a chave `originalName`
   (lista) / `nomeOriginal` (entrega) — a tela volta a calcular o nome, como antes; se `false`, deixar como está.
   Se `list_name_before` é nulo, a rotina não chegou a gravar a lista: nada a fazer aqui.
4. **Registro**: `UPDATE project_documents SET canonical_name = COALESCE(canonical_name_before, canonical_name),
   drive_renamed_at = NULL, drive_name_before = NULL, drive_name_before_origem = NULL, canonical_name_before = NULL,
   list_name_before = NULL, list_original_added = NULL WHERE id = <id>;` — `canonical_name_before` dá a volta exata.
   Passos 3 e 4 na mesma transação, com `pg_advisory_xact_lock(hashtext('project-document:<project_id>'))` e
   `SELECT … FOR UPDATE` no projeto.

O teste `server/projetos-nome-drive.test.ts` executa exatamente estes passos (função `desfazer`) e confere que o Drive,
a lista, a entrega e o registro voltam ao estado de antes, inclusive nos casos (a) e (b).

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

- `server/drive-documents.ts` — `lerArquivoNoDrive` e `trocarNomeNoDrive` (novos; GET e PATCH separados).
- `server/projetos-nome-drive.ts` (novo).
- `server/projetos-nome-drive.test.ts` (novo).
- `drizzle/0175_projeto_documentos_nome_drive.sql` (novo, não aplicada; + 5 colunas para desfazer).
- `api/index.ts` — chamada no cron dos avisos da tarde (até 30 s, total 50 s).
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

## Correções da re-revisão do portão de QA (26/11, sobre 320f13b)

1. (ALTA) Nome anterior do Drive não se perde mais quando o banco falha depois do PATCH ou o tempo esgota com o Google já
   tendo aplicado: GET e PATCH separados; o "antes" (`drive_name_before`, `canonical_name_before`, `list_name_before`,
   `list_original_added`, `drive_name_before_origem`) é gravado e confirmado numa transação curta própria ANTES do PATCH.
   Regra de ouro: "já estava" nunca vira `drive_name_before` de origem `drive`; sem nada guardado, usa o
   `canonical_name` anterior com origem `registro` (estimado). "Já estava" com `drive_name_before` (origem `drive`)
   diferente → `drive_renamed_at` gravado. "Como desfazer" reescrito para todos os casos.
2. (MÉDIA, LGPD) Log do cron só com `banco:<SQLSTATE>` (ou `falha`), nunca a mensagem do erro (o Drizzle põe nela os
   parâmetros com nomes). Os demais logs e `drive_rename_error` já eram só códigos.
3. (BAIXA) `lock_timeout` de 2 s; o lote só começa um arquivo se couber o pior caso (2 × (8 s + 2 s) = 20 s); o cron dá até
   30 s à rotina, sempre dentro de 50 s do total (pior caso < 60 s da Vercel).

## Testes

- (a) Automáticos (depois da re-revisão do portão de QA): `npx tsc --noEmit` limpo; `server/projetos-nome-drive.test.ts`
  25/25 — novos: (a) banco falha depois do PATCH (gatilho no banco de teste): o nome real antigo fica guardado, a
  passagem seguinte grava `drive_renamed_at` sem novo PATCH e o "desfazer" volta Drive, lista e registro ao estado exato;
  o log tem só `banco:40001`, sem nome de cliente/arquivo nem "Failed query"; (b) tempo esgotado depois de o Google
  aplicar: idem, inclusive com `originalName` acrescentado e na entrega de revisão; "antes" estimado (origem `registro`)
  quando o arquivo já estava com o nome novo; orçamento de 20 s por arquivo e prazo por chamada.
  Na rodada anterior (23/23): colisão com registro `deleted` e com `uploading` (escrita e conferir); nome anterior guardado e não
  sobrescrito na 2ª passagem; lock_timeout pula o projeto sem falha; 5xx/tempo
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
