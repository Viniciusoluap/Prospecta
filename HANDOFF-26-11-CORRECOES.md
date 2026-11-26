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

## Em andamento
- **Projetos — renomear os arquivos antigos no Google Drive** (autorizado pelo dono em 26/11) [EPIC-031 S-2]: neste ramo, a partir do ramo local
  `projetos-entregue-nomes` (commits `faac36f`, `320f13b`, `df60988`, `26e3006`, `64e3a0a`). 4 portões de QA: 3 FAIL (nome duplicado com registro
  apagado/em envio; nome anterior perdido; log com dado pessoal) e o 4º CONCERNS, com os 3 ajustes pedidos já feitos em `64e3a0a`.
  - Arquivos: `server/projetos-nome-drive.ts`, `server/projetos-nome-drive.test.ts` (32), `server/drive-documents.ts`, `api/index.ts` (cron dos avisos),
    `drizzle/0175_projeto_documentos_nome_drive.sql` (ADITIVA, **ainda não aplicada**), story `S-2-renomear-no-drive.md` (com "Como desfazer").
  - **Publica em modo "só conferindo"**: sem `PROJETOS_NOME_DRIVE_ESCREVER=1` na Vercel a rotina só conta (`pendentes`, `semVinculoNaTela`,
    `desistidos`, `colisoes`), não chama o Drive e não grava nada. Ligar a escrita depende do dono cadastrar a variável.
  - Schema Drizzle sem as colunas novas, de propósito (o envio de arquivo não depende da 0175).

## Próximo passo exato
1. PR do Drive: confirmação do QA sobre `64e3a0a`, Codex "Completed" lido, aplicar a 0175 no Neon (aditiva) ANTES de mesclar, prévia READY,
   mesclar, conferir produção e, no cron da tarde (15h–19h), o campo `nomesDrive` com as contagens.
2. Depois de um dia de contagens coerentes: passo a passo ao dono para cadastrar `PROJETOS_NOME_DRIVE_ESCREVER=1` na Vercel.
3. Dono: confirmar a PCI no Excel (sem "reparo") e na CAIXA. PCI #345 e Dolores E11 #341 já estão em produção (ver seções acima e
   `HANDOFF-16-11-CORRECOES-E-DOLORES.md`).
4. Ressalvas baixas em aberto: PCI (uid único, tabela do grupo, validador com CONTINUE) e E11 (`grupos-decisao.ts:235`, "pode só o da …").
