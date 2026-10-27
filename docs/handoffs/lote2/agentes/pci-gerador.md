# Checkpoint — GRUPO pci-gerador (correção 03, AD-06)

Branch `claude/lote2-22-correcoes-20261027` nos dois repos. Sem commits deste agente (o orquestrador commita).

## Status
- [x] Prospecta — implementado e testado
- [ ] SF — espelho (próximo)

## Prospecta — arquivos
- NOVOS: `shared/pci-gerador.ts` (campos/mapa de células, normalização, pré-preenchimento, engenheiro, totais, pendências, formato do modelo),
  `server/caixa/pci-gerador.ts` (XLS via PastaBiff8 + cache das fórmulas + imagem no quadro da poligonal; XLSM via XML no zip/fflate; leitura xls/xlsm/xlsb; PDF jsPDF+autotable),
  `server/pci-gerador.ts` (routers `pciGerador` [módulo Obras] e `pciModelos` [só admin] + rotas Express POST `/api/pci-modelos` (partes de 1 MB em `pci_upload_chunks`, project_id='pci-modelo'), GET `/api/pci-modelos/:id/arquivo`, GET `/api/obras/:projectId/pci-geradas/:id/(planilha|pdf)` com `?parte=`),
  `drizzle/0082_pci_gerador.sql` (pci_models, pci_generator_drafts, pci_generated; RLS),
  `client/src/components/obra/GeradorPciAba.tsx`, `client/src/components/admin/SubPciAtual.tsx`, `client/src/lib/pci-gerador-arquivos.ts`,
  `server/pci-gerador.test.ts`, `server/pci-gerador-db.test.ts`.
- ALTERADOS (mínimo): `drizzle/schema.ts` (3 tabelas após constructionPci), `server/routers.ts` (2 linhas + import), `server/_core/trpc.ts` (`pciGerador: "obras"`), `api/index.ts` + `server/_core/index.ts` (rotas), `client/src/pages/AdminEditarObra.tsx` (aba), `client/src/pages/admin/AdminIntegracoes.tsx` (1 linha + import).

## Decisões
- Aba "Fotos" → "Gerador de PCI" (admin/colaborador com Obras). A galeria por medição continua em Detalhes da Obra E logo abaixo do gerador na mesma aba. Empreiteiro: a aba continua "Fotos" só com a galeria (não usa o gerador; `pciGerador` não está em PROCEDIMENTOS_DO_EMPREITEIRO).
- Pré-preenchimento: PCI enviada da obra (lerFormularioPci, mesmo mapa; xls/xlsb) tem prioridade; cadastro do lead/obra/localização completa só lacunas. Sem fonte = vazio. Rascunho salvo prevalece sobre o automático (botão "Dados automáticos" recarrega).
- Engenheiro (RTP/RTE): nome, e-mail, telefone, CREA e UF do perfil (`listarEngenheiros`); sem CREA → registro vazio + aviso. CPF do RT não existe no perfil → digitado.
- Modelo: nova versão vira atual; mesmo arquivo (sha256) só volta a ser atual; "Tornar atual" para versões antigas. xlsb é guardado e lido, mas gerar exige xls/xlsm (mensagem clara).
- XLSM: valores gravados como inlineStr/número preservando o estilo; fórmulas nunca sobrescritas (aviso); `fullCalcOnLoad=1`. Limitação: imagem de localização só no PDF quando o modelo é .xlsm.
- Valor financiado: não existe célula na aba da proposta → campo informativo só no PDF.
- Prazo do lerPci vem primeiro da aba PLS (preenchida na medição); o prazo da proposta é T161 (gravado).

## Testes (a) automáticos
- `pnpm check`: 0 erros.
- `pnpm vitest run server/pci-gerador.test.ts server/pci-gerador-db.test.ts` 15/15 (ida e volta xls com a fixture + lerPci; imagem no quadro; xlsm sintético com macros/fórmulas; xlsb; PDF; pré-preenchimento; engenheiro; permissões; PGlite: migração 2x, versões, rascunho, gerar, histórico, construction_pci intacta).
- 27 suítes relacionadas (obra/pci/medição/permissões/rotas/esm): 195/195.
## (b) manuais: nenhum (sem navegador). (c) produção: aplicar 0082; enviar modelo oficial real (.xls/.xlsm) em Integrações; abrir PCI gerada no Excel e conferir listas suspensas/macros; validar no SIOPI.

## Próximo passo
- SF: espelhar (web/src/lib/pci-gerador.ts, web/src/lib/caixa/pci-gerador.ts, migração 20261027100000_pci_gerador, schema.prisma, actions/rotas, UI).
