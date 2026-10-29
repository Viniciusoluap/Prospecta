# Checkpoint — agente PCI (correções 05, 06, 07, 08, 09b, 10)

- Branch `claude/lote3-18-correcoes-20261029` (sem commit — orquestrador commita).

## Prospecta — implementado (typecheck ok; 126 testes dos arquivos PCI/PLS passando)
- 05 `client/src/pages/AdminEditarObra.tsx`: galeria só para empreiteiro na aba fotos.
- 06/07 `shared/pci-gerador.ts`, `shared/pci-listas.ts` (gerado do JSON), `shared/pci-curvas.ts`; UI `client/src/components/obra/GeradorPciAba.tsx` (selects, campos condicionais, cronograma com incremental/erros); servidor rejeita salvar/gerar (`errosPci`).
- 08 `server/caixa/pci.ts` (cronograma de AS161/AI, AH64 como reserva da vigência), `server/caixa/medicao-xls.ts` (`situacaoDaPls`, AV78, U110/U111), `server/caixa/medicao-pdf.ts` (status, "pendente: …"), `server/routes/obra-medicao-caixa.ts` (aferido = received_at; relê a PCI), `shared/medicao-caixa.ts` + `MedicaoCaixa.tsx` (listas oficiais da Alteração).
- 09b/10 `drizzle/0096_pci_lote3.sql`, `drizzle/schema.ts`, `server/pci-gerador.ts` (exclusão lógica, prévia, auditoria, relatório, confirmação crítica, base .xls), `server/caixa/biff8.ts` (DV), `server/caixa/pci-modelo-estrutura.ts`, `server/caixa/pci-gerador.ts` (só .xls, DV do xlsm), `client/src/components/admin/SubPciAtual.tsx`.
- Testes: `server/pci-lote3.test.ts`, `server/pci-lote3-db.test.ts`, ajustes em `server/pci-gerador.test.ts` ("Rede de Esgoto" etc.) e `server/pci-gerador-db.test.ts`.

## Pendente
- SF: espelhar tudo (em andamento).
- `docs/handoffs/lote3/MAPEAMENTO-PCI-SISTEMA.md`.
