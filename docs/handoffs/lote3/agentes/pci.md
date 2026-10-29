# Checkpoint — agente PCI (correções 05, 06, 07, 08, 09b, 10)

- Branch `claude/lote3-18-correcoes-20261029` (sem commit — orquestrador commita).

## Feito (Prospecta, typecheck ok)
- 05: `client/src/pages/AdminEditarObra.tsx` — galeria só para empreiteiro na aba fotos. SF `editar-obra-client.tsx` idem.
- 07: `shared/pci-listas.ts` (gerado do JSON por script em scratchpad), `shared/pci-gerador.ts` (tipo "lista", campos novos Q63, AL63, AS89, DATec N76/X76/N77/X77, norma L79/V79, fabricante G83, AN140, AS161, M163/AA163, AG155, G165, G245; AH64; longitude sem AC58).
- 06: `numeroPci` = lerNumero; `analisarCronogramaPci`, `errosPci`, `alertaPrazoPci`, `limiteBdiPci`; `shared/pci-curvas.ts` (Curvas_padrão conferida na fixture).
- 10: `server/caixa/biff8.ts` lê DV (71 no oficial), `temCelula`; `PastaXlsx.validacoesDeDados`; `server/caixa/pci-modelo-estrutura.ts` (estrutura + relatório); `gerarPlanilhaPci` só gera .xls.

## Pendente
- Prospecta: server/pci-gerador.ts (erros no salvar/gerar, base .xls, exclusão lógica, confirmação crítica), migração 0096, schema, SubPciAtual, GeradorPciAba (seletores, incremental), PLS 08 (medicao-xls/pdf, pci.ts, rota), medicao-caixa opções Alteração, testes, MAPEAMENTO-PCI-SISTEMA.md.
- SF: espelhar tudo.
