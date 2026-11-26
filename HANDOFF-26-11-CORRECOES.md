# HANDOFF — correções de 26/11/2026 (Prospecta)

Ramo: `claude/inspiring-feynman-e8rqmc` · PR #340.

## Concluído neste PR
- **E12 — grupo: escolher cliente/obra pelo nome** (commit `e40aa99`): rota `dolores.grupos.buscarVinculo` (só admin; id + nome; até 20; sem
  excluídos; sem acento), componente `client/src/components/admin/BuscaClienteOuObra.tsx`, usado em `DoloresGruposCard.tsx` (cadastro manual e
  corrigir tipo/vínculo) e `whatsapp/GruposWhatsApp.tsx`. Story: `docs/stories/epics/epic-025-dolores/E12-grupo-escolher-cliente-pelo-nome.md`.
- **EPIC-031 S-1 — Projetos** (commits `59154bb`, `124e924`): projeto entregue sai da lista (só aparece com o filtro "Entregue";
  `shared/projetos-lista.ts`); nome padrão curto dos arquivos `<Item>-<Primeiro-Ultimo>-<n>.<ext>` calculado na leitura
  (`shared/projeto-documentos.ts`), envio novo já gravado no Drive com esse nome; o clique continua abrindo no Drive. Sem migração.

## Em andamento (outras pastas, ainda fora deste PR)
- **PCI — planilha rejeitada pela Caixa** (URGENTE): `/home/user/Prospecta-pci-xls`, ramo local `pci-xls-caixa`. O Excel abre "reparando" e o
  sistema da Caixa não anexa. Agente investigando a estrutura BIFF8 (foto grande/CONTINUE, CF, índices).
- **Projetos — renomear os arquivos antigos no Google Drive**: autorizado pelo dono em 26/11 ("Pode renomear os arquivos do Google Drive sim").
  `/home/user/Prospecta-projetos`, ramo local `projetos-entregue-nomes`. Só o nome; `original_name` nunca muda.
- **Dolores E11** — PR #341 (ramo `claude/dolores-e11-conversa-direta`): 13 portões de QA + 5 passadas do Codex corrigidas; aguardando a 6ª.

## Testes
- (a) Automáticos: `npx tsc --noEmit` limpo; `server/dolores/e12-buscar-vinculo.test.ts` 7/7; `server/projetos-entregue-e-nome-padrao.test.ts` 9/9;
  `projeto-documentos` 4/4; `projeto-revisao` 5/5.
- (b) Manuais: nenhum (sem navegador nesta sessão).
- (c) Pendentes em produção: busca pelo nome nos 3 lugares (iPad); filtro de entregues; nomes dos arquivos na tela de Projetos.

## Próximo passo exato
1. PR #340: Codex "Completed" + `get_review_comments` lidos, prévia da Vercel pronta, mesclar (squash), conferir produção.
2. Receber os agentes da PCI e do Drive, revisar, portão de QA na PCI, publicar cada um.
3. E11: ler a 6ª passada do Codex no #341.
