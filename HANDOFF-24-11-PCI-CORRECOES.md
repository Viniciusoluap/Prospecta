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

- **Foto recortada na proporção do quadro** (pedido do dono: "não pode ficar no meio com bordas sobrando"): a tela recorta a foto em ~3,03 por 1
  (`recorteParaQuadroPci`), com a escolha "de cima / do meio / de baixo". Foto antiga de rascunho: a tela avisa e oferece o recorte.
- **Etapa B — PDF idêntico à planilha (FEITO):** `server/caixa/pci-pdf-fiel.ts` (`gerarPdfFielPci`), `biff8-planilha.ts`, `biff8-formulas.ts`,
  `formato-numero-xls.ts`. O PDF é desenhado a partir do .xls gerado (grade, cores, bordas, logotipo, foto) com as 148 fórmulas da área de
  impressão recalculadas (conferidas contra o LibreOffice na planilha do dono). Se falhar, sai o PDF antigo com aviso.
- Portão de QA rápido da parte da tela (commit `ddc7863`): PASS, com 3 observações baixas (a do CNPJ com letras foi corrigida).

## Pendências
- **Google Planilhas:** as regras condicionais do modelo oficial usam a cor de fonte "automática" (0x7FFF), que o Google Planilhas lê como
  branco. A planilha gerada troca essa cor por preto explícito (`corAutomaticaVisivelNoGooglePlanilhas`, só o campo da cor; nenhuma regra
  sai). Conferido: página renderizada no LibreOffice idêntica, pixel a pixel, à de antes. **Falta o dono confirmar no iPad** (não há como
  abrir o Google Planilhas daqui).
- O PDF usa Helvetica (o modelo pede "CAIXA Std"): alguns textos longos quebram em linha diferente do Excel.
- Avisos do PDF com motivo técnico entre parênteses: simplificar o texto se aparecerem para o usuário.
- Conferir em produção na obra da cliente.

## Testes
- (a) Automáticos: `npx tsc --noEmit` limpo. `server/pci-correcoes-24-11.test.ts` 12/12; `server/caixa/pci-pdf-fiel.test.ts` 18/18; `server/pci-gerador-db.test.ts` 6/6 (estava
  quebrado na `main` desde o #339: faltava `pci_lot_cost` na tabela de teste); `pci-lote3`, `pci-gerador`, `pci-s09`, `pci-s09-db`,
  `pci-lote3-db`, `pci-formatos-excel`, `caixa-medicao`: passam (rodados por arquivo, `--maxWorkers=2`).
- (b) Manuais: planilha enviada pelo dono reprocessada com a foto dele e renderizada no LibreOffice — a foto aparece no quadro (antes não).
- (c) Pendentes em produção: abrir o Gerador de PCI da obra, conferir os campos automáticos, gerar e abrir planilha e PDF.

## Próximo passo exato
1. PR #338: esperar o Codex ficar "Completed" e a prévia da Vercel pronta; ler os comentários; mesclar (squash); conferir produção.
2. Pedir ao dono para abrir o Gerador de PCI da obra, usar "Converter em R$" nos custos, escolher a parte da foto e gerar.
3. Pendências acima.
