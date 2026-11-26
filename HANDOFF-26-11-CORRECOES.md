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

## Em andamento, fora deste PR
- **Projetos — renomear os arquivos antigos no Google Drive** (autorizado pelo dono em 26/11: "Pode renomear os arquivos do Google Drive sim"):
  commit local `4161fb8` em `/home/user/Prospecta-projetos` (ramo `projetos-entregue-nomes`). Roda no cron dos avisos da tarde, 25 por execução,
  só o nome, `original_name` intacto. Precisa da migração aditiva `drizzle/0175_projeto_documentos_nome_drive.sql` no Neon ANTES de publicar e
  de ser reconciliada com a mudança de assinatura das funções de nome feita no #340 (`nomesPadraoArquivosProjeto` agora preserva o gravado).
- **Dolores E11** — PR #341 (ramo `claude/dolores-e11-conversa-direta`): 14 portões de QA e 8 passadas do Codex; último commit `ff50c69`.

## Próximo passo exato
1. #344: prévia da Vercel pronta + Codex "Completed" lido → mesclar (squash) → conferir produção → pedir ao dono para gerar a PCI e testar na CAIXA.
2. Conforme o resultado do dono: publicar (ou não) o commit `20cb79b` do tamanho.
3. Drive: reconciliar com a main, portão de QA, aplicar a 0175, publicar.
4. E11: ler a passada do Codex sobre `ff50c69`; sem achado → mesclar e conferir produção; atualizar `HANDOFF-16-11-CORRECOES-E-DOLORES.md`.
