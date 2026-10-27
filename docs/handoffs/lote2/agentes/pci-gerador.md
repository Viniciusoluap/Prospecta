# Checkpoint — GRUPO pci-gerador (correção 03, AD-06)

## Status
- [x] Leitura: preâmbulo, ADs, checkpoints engenheiro/obras-mapa, leitor `server/caixa/pci.ts` (mapa de células extraído da fixture).
- [ ] Prospecta: shared/pci-gerador.ts, server/caixa/pci-gerador.ts (XLS/XLSM/PDF), migração 0082, schema, router + rotas, UI
- [ ] SF: espelho
- [ ] Testes / typecheck

## Decisões
- Routers Prospecta: `pciGerador` (módulo Obras) e `pciModelos` (fora do mapa → só admin).
- Upload de modelo reaproveita `pci_upload_chunks` (project_id = 'modelo').
- Imagem de localização: quadro da poligonal na aba Proposta (col 6..48, linhas 193..213 base zero) via `substituirFotos`.

## Próximo passo
- Implementar Prospecta.
