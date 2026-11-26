# HANDOFF — correções de 26/11/2026 (Prospecta)

## Publicado
- **PR #340** (squash `b41fb71`, produção `dpl_jUq9ZVLAh7iYe1XHAepwSNbutihk` READY em 26/11):
  - **E12 — grupo: escolher cliente/obra pelo nome**: rota `dolores.grupos.buscarVinculo` (só admin; id + nome; até 20; sem excluídos; sem
    acento), componente `client/src/components/admin/BuscaClienteOuObra.tsx` em `DoloresGruposCard.tsx` e `whatsapp/GruposWhatsApp.tsx`.
  - **EPIC-031 S-1 — Projetos**: projeto entregue sai da lista (`shared/projetos-lista.ts`); nome padrão curto dos arquivos
    `<Item>-<Primeiro-Ultimo>-<n>.<ext>`, único e estável no projeto (`shared/projeto-documentos.ts`); envio novo gravado no Drive com esse
    nome; revisões como `Rev<N>-…`; o clique continua abrindo no Drive. Sem migração. Portão de QA: CONCERNS (corrigidos); Codex sem achados.

## Neste PR (#344) — PCI: planilha rejeitada pela CAIXA [EPIC-030 S-2]
Ramo `claude/inspiring-feynman-e8rqmc`, commit `495ee1d` (origem: `3d61d9a` no ramo local `pci-xls-caixa`, pasta `/home/user/Prospecta-pci-xls`).
- **Sintoma:** o Excel abre a PCI "reparando ou removendo o conteúdo ilegível" e o sistema da CAIXA não anexa.
- **Inconsistências corrigidas (65 no arquivo de produção → 0):**
  1. INDEX (0x020B) e DBCELL (0x00D7) com ponteiros velhos — `serializarFluxo` em `server/caixa/biff8.ts` só refazia BOUNDSHEET/EXTSST; agora
     refaz INDEX/DBCELL a cada gravação.
  2. Id (spid) da foto fora do cluster de ids do desenho da aba, e id do OBJ derivado dele — `server/caixa/biff8-imagens.ts`.
  3. Trava no ajuste de cor do CF (`server/caixa/pci-gerador.ts`).
- Novo validador `server/caixa/biff8-validador.ts` e teste `server/caixa/pci-xls-estrutura.test.ts` (imita o modelo oficial com macros, que tem
  INDEX/DBCELL; o modelo anônimo dos testes não tinha — por isso nada acusava).
- Story: `docs/stories/epics/epic-030-pci-correcoes-24-11/S-2-planilha-rejeitada-pela-caixa.md`.

### Pendências da PCI
- **Não está provado que essas inconsistências eram a causa da recusa**: sem Excel real e sem o sistema da CAIXA aqui. O dono confirma.
- **Tamanho do arquivo (segundo suspeito):** produção com 5,47 MB (3,48 MB são um PNG sem uso que veio no modelo enviado); regerar a partir de
  uma PCI já gerada crescia 5,47 → 6,88 → 8,29 MB. Correção pronta e NÃO publicada: commit local `20cb79b` em `/home/user/Prospecta-pci-xls`
  (esvazia o BSE das fotos que o gerador substituiu; normaliza spid antigo; RSTRING no validador). Segurada de propósito: o "slot vazio" do BSE
  segue a especificação [MS-ODRAW] mas não tem exemplo gravado pelo Excel — só publicar depois de o dono testar a primeira correção, para não
  misturar duas mudanças estruturais num teste só.
- PCIs já salvas, geradas pelo código antigo, continuam com o id antigo da foto: gerar a PCI de novo depois de publicar.

### Testes da PCI
- (a) Automáticos: `npx tsc --noEmit` limpo; `server/caixa/pci-xls-estrutura.test.ts` 6/6; os 10 `server/pci-*.test.ts`, `server/caixa/*.test.ts`,
  os 4 `server/medicao*.test.ts`, `server/pls-fiel-pci.test.ts` e `server/caixa-medicao.test.ts` passando (200 testes no portão de QA).
- (b) Manuais: arquivo de produção usado como modelo e regerado — validador do dev (TS e Python) e validador independente do QA: 0
  inconsistências; comparação registro a registro: nenhum registro de célula, fórmula, SST ou CF muda; LibreOffice converte as 9 abas idênticas.
- (c) Pendentes em produção (só o dono): gerar a PCI de novo, abrir no Excel sem a mensagem de reparo e anexar no sistema da CAIXA.

## PCI — tamanho do arquivo (causa CONFIRMADA pela CAIXA em 26/11) [EPIC-030 S-2, parte 2]
- O #344 (INDEX/DBCELL e id da foto) foi publicado (squash `842b8d9`, produção READY). O dono gerou de novo e o sistema da CAIXA respondeu:
  "Operação não permitida. O tamanho máximo permitido para o arquivo é 5120 KB. Tamanho deste arquivo: 5342 KB."
- **O que pesava:** PNG de 3.484.635 bytes que nenhuma forma usa (veio no modelo enviado) + foto de localização (337 KB) + fotos antigas a cada regeração.
- **Correção (commits `20cb79b`, `99f4516` do ramo local `pci-xls-caixa`, neste PR):** `trocarImagensSemUso` em `server/caixa/biff8-imagens.ts` — imagem
  que nenhuma forma/propriedade referencia vira PNG 1×1 válido (posições e `pib` intactos; imagem em uso igual byte a byte); foto nova reduzida no
  cliente (JPEG, até 1.600 px, alvo 400 KB) e recusada no servidor acima de 1,5 MB; aviso na tela acima de 5.000 KB e tamanho no botão de baixar
  (`LIMITE_ANEXO_CAIXA_KB`, `AVISO_TAMANHO_PCI_KB` em `shared/pci-gerador.ts`); spid antigo da foto normalizado; RSTRING no validador.
- **Entrega imediata ao dono:** a planilha da Keilane regravada sem mudar dado nenhum — 1.911 KB (era 5.342 KB); 23.705 registros comparados, só o
  id da foto mudou; render das 15 páginas idêntico. Enviada na conversa em 26/11.
- **Testes:** (a) `npx tsc --noEmit` limpo; `server/caixa/pci-xls-estrutura.test.ts` 10/10 (3 gerações em cadeia não crescem e ficam < 5.000 KB; imagem
  sem uso deixa de pesar; em uso intacta; aviso acima do limite); suítes `pci-*`, `caixa/*`, `medicao*`, `pls-fiel-pci`, `caixa-medicao` passando.
  (b) arquivo de produção regerado com foto de ~1 MB: 2.563 KB nas 3 gerações, validador 0. (c) só o dono: anexar na CAIXA e abrir no Excel sem reparo.

- **Publicado em 26/11:** PR #345 mesclado na `main` (squash `cf2a848`), produção `dpl_9cVb3fnZw1qk12YvVzekqLycvSrM`. Sem migração.
  Codex: 1 achado P1 (desenho partido em MSODRAWING + CONTINUE fazia imagem em uso ser trocada) corrigido em `a0b722e` — a varredura junta o
  desenho de cada aba e, se o fluxo não fecha, não troca nada; 2ª passada sem achados. Portão de QA: PASS (12/12 no arquivo; 206/206 em 18 arquivos).
- **Ressalvas baixas do QA (não feitas):** (1) todas as imagens trocadas têm o mesmo uid — dar uid único por entrada; (2) a tabela de propriedades
  padrão do grupo de desenhos não é varrida por `referenciasDeImagens` (no modelo atual não tem imagem); (3) `biff8-validador.ts` não junta
  MSODRAWING + CONTINUE (só usado em testes); comentário "67 bytes" do PNG mínimo (são 70).

## Projetos — renomear os arquivos antigos no Google Drive [EPIC-031 S-2] — PUBLICADO em modo "só conferindo" (26/11)
- **PR #346 mesclado na `main`** (squash `8f6692f`). Autorizado pelo dono em 26/11 ("Pode renomear os arquivos do Google Drive sim").
- **Banco (Neon de produção, projeto SiteProspecta):** migração aditiva `drizzle/0175_projeto_documentos_nome_drive.sql` aplicada — 12 colunas novas
  em `project_documents` (conferido por contagem). Nada alterado nem apagado. O schema Drizzle não tem essas colunas, de propósito.
- **Arquivos:** `server/projetos-nome-drive.ts`, `server/projetos-nome-drive.test.ts` (37), `server/drive-documents.ts`, `api/index.ts` (cron dos
  avisos da tarde), story `docs/stories/epics/epic-031-projetos-entregue-e-nomes/S-2-renomear-no-drive.md` (com "Como desfazer").
- **Estado em produção:** sem `PROJETOS_NOME_DRIVE_ESCREVER=1` na Vercel a rotina NÃO chama o Drive e NÃO grava nada; devolve só contagens
  (`pendentes`, `semVinculoNaTela`, `desistidos`, `colisoes`) no campo `nomesDrive` da resposta do cron.
- **Revisões:** portão de QA em 5 rodadas (3 FAIL corrigidos, 1 CONCERNS, PASS final em `64e3a0a`). Codex: 3 passadas com 5 achados P2, todos
  corrigidos com teste (`5ed76a4`, `eaf2b5b`, `5531076`); 4ª passada sem achados.
- **ATENÇÃO antes de ligar a escrita:** as 3 correções do Codex (preservar o "antes" em 4xx/5xx/volta do alvo, coluna `drive_name_applied`, fila que
  gira) entraram DEPOIS do PASS do QA. Rodar um portão de QA sobre `64e3a0a..5531076` antes de cadastrar `PROJETOS_NOME_DRIVE_ESCREVER=1`.
- **Testes:** (a) automáticos — tsc limpo; `projetos-nome-drive` 37/37; `projetos-entregue-e-nome-padrao` 14/14; `projeto-documentos` 4/4;
  `api-rotas-producao` 2/2; `imports-esm` 2/2. (b) manuais — nenhum (sem Drive real). (c) pendentes em produção — contagens do cron da tarde;
  comportamento real do Google (PATCH cortado pelo tempo, `canRename` em Drive compartilhado, cotas).

- **Portão de QA sobre `64e3a0a..5531076` (26/11): FAIL para LIGAR A ESCRITA.** 34.992 sequências de até 4 passagens: o "Como desfazer" sempre
  devolve o nome real, mas (ALTA) dois arquivos do projeto podiam ficar com o mesmo nome no Drive — `colide` ignorava o nome posto por um PATCH
  nosso aplicado e não confirmado de outro registro; (MÉDIA) o giro por hora deixava posições do grupo com erro sem vez. Corrigido neste ramo:
  `nomesNoDrive` (canonical_name + `drive_name_target`/`drive_name_applied` com a marca) e giro por dia×5+hora. `projetos-nome-drive` 39/39.
  **A escrita continua DESLIGADA em produção; não ligar antes de novo PASS do QA sobre esta correção.**

- **PR #347 mesclado na `main`** (squash `b1082b8`, 26/11): colisão considera PATCH nosso não confirmado de outro registro; giro avança a cada
  execução. Codex sem achados. Portão de QA (7ª rodada, sobre `32493ba`): **CONCERNS — pode ligar a escrita**. 20.772 passagens com dois
  arquivos disputando nomes + 3.000 sequências aleatórias: nenhum nome duplicado, desfazer sempre devolve o nome real; giro cobre grupos de 1 a 30.
- **Limite conhecido (não bloqueia):** colisão PERMANENTE quando (a) um registro `deleted` ficou com marca/alvo de um PATCH antigo, ou (b) dois
  arquivos com PATCH aplicado e não confirmado trocam de nome entre si. Não duplica nem perde nome; aparece em `nomesDrive.colisoes` e
  `restante: true`. Destrava seguindo o "Como desfazer" da story no registro que segura o nome. (Ainda falta escrever isso na story.)

## Próximo passo exato
1. Conferir a produção da Vercel READY para `b1082b8`.
2. Depois de pelo menos uma execução do cron da tarde (18h–22h UTC) com contagens coerentes em `nomesDrive`, mandar ao dono o passo a passo
   para cadastrar `PROJETOS_NOME_DRIVE_ESCREVER=1` na Vercel (Settings › Environment Variables, Production) e fazer Redeploy. Ligar é decisão dele.
3. Com a escrita ligada: acompanhar `renomeados`, `falhas`, `colisoes` e `restante`; colisão que não some → "Como desfazer" no registro bloqueador.
4. Dono: confirmar a PCI no Excel (sem "reparo") e na CAIXA. PCI #345 e Dolores E11 #341 já estão em produção.
5. Ressalvas baixas em aberto: PCI (uid único, tabela do grupo, validador com CONTINUE), E11 (`grupos-decisao.ts:235`, "pode só o da …") e a
   nota do limite conhecido na story S-2 do Drive.
