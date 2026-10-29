# Checkpoint — agente PCI (correções 05, 06, 07, 08, 09b, 10) — 29/10/2026

- Branch `claude/lote3-18-correcoes-20261029` (sem commit manual; os checkpoints automáticos do orquestrador já incluíram a maior parte).
- Estado: **implementado nos dois sistemas; typecheck e testes dos arquivos PCI/PLS passando.** Falta validação manual/produção.

## Arquivos
Prospecta: `client/src/pages/AdminEditarObra.tsx` (05) · `shared/pci-gerador.ts`, `shared/pci-listas.ts` (gerado do JSON), `shared/pci-curvas.ts`, `shared/medicao-caixa.ts`, `client/src/components/obra/GeradorPciAba.tsx`, `client/src/components/obra/MedicaoCaixa.tsx` (06/07) · `server/caixa/pci.ts`, `server/caixa/medicao-xls.ts`, `server/caixa/medicao-pdf.ts`, `server/routes/obra-medicao-caixa.ts` (08) · `drizzle/0096_pci_lote3.sql`, `drizzle/schema.ts`, `server/pci-gerador.ts`, `server/caixa/biff8.ts`, `server/caixa/pci-gerador.ts`, `server/caixa/pci-modelo-estrutura.ts`, `client/src/components/admin/SubPciAtual.tsx` (09b/10) · `docs/handoffs/lote3/MAPEAMENTO-PCI-SISTEMA.md`.
Santa Fé (web/): `editar-obra-client.tsx` (05) · `src/lib/pci-gerador.ts`, `pci-listas.ts`, `pci-curvas.ts`, `medicao-caixa.ts`, `src/components/obras/gerador-pci.tsx`, `.../_components/medicao-caixa.tsx` · `src/lib/caixa/{pci,medicao-xls,medicao-pdf,biff8,pci-gerador,pci-modelo-estrutura}.ts`, `src/lib/obras/medicao-gerar.ts` · `prisma/migrations/20261029112000_pci_lote3/`, `prisma/schema.prisma` (PciModelo + PciModeloAuditoria), `src/lib/obras/pci-gerador-dados.ts`, `src/lib/actions/pci-gerador.ts`, `src/app/api/pci-modelos/route.ts`, `src/components/admin/sub-pci-atual.tsx` · `docs/handoffs/lote3/MAPEAMENTO-PCI-SISTEMA.md`.
Arquivos caixa/* e pci-gerador/listas/curvas são gêmeos textuais (só imports diferem).

## Testes
(a) automáticos — P: `pnpm check` ok; vitest 126/126 (pci-gerador, pci-gerador-db, pls-fiel-pci, caixa-medicao, pci-legada, medicoes, caixa-pci-migration, pci-lote3, pci-lote3-db, numero-mascara, galeria, medicao-solicitacao, alvara-pls, medicao-solicitacao-db). SF: tsc ok; eslint 0 erros; vitest 140 (138 ok; 2 falhas pré-existentes em `medicao-drive.db.test.ts`, ver abaixo) + `pci-modelos-lote3.db.test.ts` com banco real ok.
(b) manuais: nenhum (sem navegador).
(c) produção: migrações 0096 / 20261029112000 NÃO aplicadas; validar no Excel que o .xls gerado abre com as listas; conferir rótulos DATec N76/X76/N77/X77.

## Pendências / observações
- SF `medicao-drive.db.test.ts` (2 falhas): "PCI enviada e não vinculada" espera erro, mas `salvarProgressoObra` só valida com PCI vinculada — não usa código deste grupo (falha anterior/estado do banco compartilhado).
- Rascunhos antigos com valores fora da lista (ex.: "Rede pública", pavimentos 5) agora são recusados ao salvar até a pessoa escolher a opção oficial (o select mostra o valor antigo como "fora da lista").
- Execução do item fora de passos de 5%: aviso no PDF da PLS (não bloqueia, para não quebrar medições históricas).

## Próximo passo
Orquestrador: commit/push; aplicar migrações em homologação; teste manual do Gerador (seletores, cronograma), do envio de versão .xlsm (relatório/confirmação) e da exclusão de versão.
