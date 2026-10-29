# HANDOFF — Organização completa do Google Drive (Prospecta) — 29/10/2026

Branch: `claude/drive-organizacao-20261029` · Spec: `docs/handoffs/drive/SPEC-DRIVE-ORGANIZACAO.md`
Paridade: Grupo Santa Fé implementou a mesma spec (`Grupo-Santa-Fe/docs/handoffs/drive/HANDOFF-SANTAFE.md`, commit 82d1a6a);
as regras extras do Santa Fé (exclusão de lead, proteção dos órfãos, portfólio de projeto, cron existente) foram adotadas aqui.
Status: implementação concluída na branch; **migração 0093 NÃO aplicada em produção** (o orquestrador aplica).

## Concluído (commits)
- `520bc5d` — `shared/drive-estrutura.ts`: caminhos/nomes/etiquetas novos (Equipe, Modelos/PCI CAIXA, Obras/Fotos/<Medição NN — data | Sem medição>,
  Obras/Gerador de PCI, Clientes/…/Atendimento/WhatsApp, WhatsApp sem cliente/+número, Incorporação/…/Orçamento) + `entidadeDaChave`.
- `0de1d4e` — `drizzle/0093_drive_organizacao.sql` + `drizzle/schema.ts` (só aditiva): `drive_file_id` em `user_documents`, `pci_models`,
  `construction_photos`, `construction_pci`, `whatsapp_midias`; `sheet_drive_file_id`/`pdf_drive_file_id` em `pci_generated`;
  `budget_import_drive_file_id`/`budget_import_sha256` em `incorporation_studies`; tabelas `drive_trash_queue` (lixeira pendente) e
  `drive_sync_state` (cursor, trava e último relatório).
- `4c8744b` — `server/drive-arquivos.ts` (fontes de arquivos: o que está só no banco, o que já está no Drive, destino de cada um; registros
  existentes; arquivos em uso), `server/drive-organizacao.ts` (organizador retomável com prazo/lotes, lixeira segura, cópia ao gravar),
  primitivas novas em `server/drive-documents.ts` (`reorganizar` passou a usar as mesmas fontes).
- `4d19e2a`/`0555fae`/`6eb27e7`/`f931b75` — integração:
  - cópia ao gravar: documento do usuário/engenheiro (`server/usuario-documentos.ts`; substituição manda a versão anterior à lixeira),
    modelo de PCI e PCI gerada (`server/pci-gerador.ts`), foto de obra (`server/routes/obra-fotos.ts`), PCI original (guarda o id;
    `server/routes/obra-medicao-caixa.ts`), mídia do WhatsApp (`server/whatsapp-midia.ts`), planilha do orçamento (ao salvar o orçamento).
  - exclusões → lixeira (banco primeiro, nunca bloqueia): lead (`cliente:<id>`; antes move documentos compartilhados e mídias de WhatsApp;
    se falhar, fica na fila), obra, estudo, projeto (`projeto-<id>`), imóvel, usuário/corretor (`equipe:<id>`), checklist de financiamento e
    documentos da regularização (arquivos), documento do usuário, foto de obra, conversa do WhatsApp.
  - lead: documento com cópia no Drive não bloqueia mais a exclusão definitiva; só documento sem cópia no Drive bloqueia (`server/db.ts`).
  - leitura: documentos guardados no banco (fallback) continuam sendo lidos do banco mesmo depois da cópia no Drive.
  - "Organizar Drive": no fim do cron diário existente `/api/cron/lead-card-due` (sem cron novo; máx. 45 s, ≤ ~50 s da requisição) e
    botão "Organizar Drive agora" + último relatório no cartão Google Drive (só admin; `googleDrive.organizar`/`ultimaOrganizacao`).
  - proteção dos órfãos: só pastas de entidade com etiqueta dentro da raiz atual; lead arquivado conta como existente; `cliente:projeto-<id>`
    conferido contra `operational_projects`; >25 órfãs numa página e mais da metade dela → nada apagado + aviso no relatório; teto de 50 por execução;
    pasta com arquivo ainda usado por algum registro não vai para a lixeira.

## Decisões
- PCI original fica em Medições CAIXA (onde já é gravada); envio pendente reconhece a cópia antiga pelo prefixo "PCI original — ".
- Mídia do WhatsApp com rótulo literal da spec: "Mídia — dd-mm-aaaa.ext".
- Documentos de lead/estudo/contrato que caíram no fallback "banco" ganham cópia no Drive e continuam com `storage = 'banco'`.

## Limitações / pendências
- Execuções simultâneas evitadas por trava de 90 s no `drive_sync_state`; cópia ao gravar concorrente com o organizador pode, raramente, gerar uma cópia duplicada no Drive.
- Reenvio de uma versão antiga da PCI (mesmo checksum de versão já vista) não reenvia: o pendente adota a "PCI original" mais recente da pasta.
- Pastas de topo duplicadas com a mesma etiqueta: a varredura de órfãs usa a que está na raiz atual.

## Testes
(a) automáticos: `pnpm check` limpo; `pnpm vitest run server/` — 164 arquivos, 1264 testes passando (inclui `server/drive-estrutura.test.ts`,
    `server/drive-organizacao.test.ts`, `server/drive-exclusoes.test.ts`, `server/drive-erro.test.ts`, `server/lead-exclusao-definitiva.test.ts`,
    `server/whatsapp-noite.test.ts`). Nenhum teste chama o Google.
(b) manuais: nenhum (sem Google real nesta sessão).
(c) produção: aplicar a migração 0093; clicar "Organizar Drive agora" até o relatório indicar "completa"; conferir Equipe/<engenheiro>;
    excluir um lead de teste arquivado e ver a pasta na lixeira do Drive.

## Paridade com a revisão do PR #239 do Santa Fé — 29/10
- P1 (pasta órfã com arquivo em uso): a Prospecta já mantinha a pasta (lista recursiva e paginada + `arquivosEmUso`).
  Alinhado com o Santa Fé: `lixeiraPastaSegura` agora tenta antes levar cada arquivo em uso para a pasta do registro
  dono (`destinoDe` = `destinoAtualDoArquivo`) e só manda a pasta para a lixeira se nada continuar em uso; senão fica
  (`pastasAguardando`) e a fila/organizador tenta de novo. Vale para órfãs, fila e exclusões.
- P2 (fila durável da lixeira): já existia (`drive_trash_queue`, 0093) — sem mudança. O Santa Fé ganhou a gêmea `drive_lixeira_pendente`.
- P3 (fotos de imóveis sem limite): não se aplica — não há varredura de fotos fora do laço com prazo/lote.
- Testes (a): 2 casos novos em `server/drive-organizacao.test.ts`; `drive-organizacao`/`drive-exclusoes`/`drive-estrutura` 46/46; `pnpm check` limpo.

## Próximo passo exato
Orquestrador: revisar, aplicar `drizzle/0093_drive_organizacao.sql` em produção, merge e deploy; depois rodar o botão
"Organizar Drive agora" (ou esperar o cron diário) até o ciclo concluir.
