# HANDOFF 24/11 — Gerador de PCI: correções pedidas pelo dono

Story: `docs/stories/epics/epic-030-pci-correcoes-24-11/S-1-campos-foto-e-pdf.md` (pedido, diagnóstico e o que cada etapa entrega).
Ramo: `claude/inspiring-feynman-e8rqmc` (PR #338, rascunho). **Nada publicado ainda.**

## Concluído — etapa A (campos da tela e foto)
- Cidade/UF sozinhas (cadastro da obra → fim do endereço da obra → endereço do cliente); construtora/CNPJ pelas empresas do módulo fiscal
  (lista na tela; entra sozinha quando só uma serve); esquadrias internas como lista; local e data automático na geração; área construída
  total com aviso quando difere da área da obra; resumo dos custos na tela; foto de localização gravada na posição certa.
- Arquivos: `shared/pci-gerador.ts`, `server/pci-gerador.ts`, `server/caixa/biff8-imagens.ts`,
  `client/src/components/obra/GeradorPciAba.tsx`, testes em `server/pci-correcoes-24-11.test.ts` e `server/pci-gerador-db.test.ts`.

- **Custos pelos dois campos** (resposta do dono: editar a incidência em % e o valor em R$): `baseDosCustosPci`, `custoDaIncidenciaPci`,
  `incidenciaDoCustoPci`, `custosDigitadosComoPercentualPci` em `shared/pci-gerador.ts`; tabela de custos da tela com as duas colunas.
- O dono pediu para publicar logo a parte da tela ("para eu terminar de usar o sistema agora"): a etapa A + custos vão para a `main`
  sem esperar o PDF novo, que entra numa publicação seguinte.

## Em andamento
- **Etapa B — PDF idêntico à planilha:** agente @dev na worktree `/home/user/Prospecta-pci-pdf` (ramo local `pci-pdf-fiel`, sem push).
  Entrega esperada: `server/caixa/pci-pdf-fiel.ts` + testes + troca mínima em `server/pci-gerador.ts` (cai no PDF antigo se falhar).
  Quando terminar: revisar, mesclar no ramo de trabalho, rodar os testes de PCI, portão de QA.

## Pendências
- Google Planilhas esconde ART, área total, terreno e unitários (formatação condicional do modelo oficial). Avaliar neutralizar no arquivo
  gerado, desde que nada mude no Excel/LibreOffice.
- Portão de QA (@qa) antes de publicar; Codex + prévia da Vercel; sem migração nesta story.

## Testes
- (a) Automáticos: `npx tsc --noEmit` limpo. `server/pci-correcoes-24-11.test.ts` 10/10; `server/pci-gerador-db.test.ts` 6/6 (estava
  quebrado na `main` desde o #339: faltava `pci_lot_cost` na tabela de teste); `pci-lote3`, `pci-gerador`, `pci-s09`, `pci-s09-db`,
  `pci-lote3-db`, `pci-formatos-excel`, `caixa-medicao`: passam (rodados por arquivo, `--maxWorkers=2`).
- (b) Manuais: planilha enviada pelo dono reprocessada com a foto dele e renderizada no LibreOffice — a foto aparece no quadro (antes não).
- (c) Pendentes em produção: abrir o Gerador de PCI da obra, conferir os campos automáticos, gerar e abrir planilha e PDF.

## Próximo passo exato
1. Esperar o agente do PDF; revisar o diff de `pci-pdf-fiel`; `git merge pci-pdf-fiel` no ramo de trabalho; rodar os testes de PCI.
2. Conforme a resposta do dono, implementar a entrada de custos por percentual.
3. Portão de QA; PR #338 pronto para revisão; Codex; prévia; mesclar; conferir produção; atualizar este HANDOFF.
