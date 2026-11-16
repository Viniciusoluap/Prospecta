# S-08 — Importação de KML e KMZ do terreno

Status: Ready for Review
Epic: EPIC-024 (Fase 1) — correção 08 do dono (16/11/2026)
Paridade: Incorporação existe nos dois sistemas — pendência de porte para o Grupo Santa Fé no ROADMAP (Santa Fé em espera).
Tamanho estimado: S
Dependência: nenhuma.

## Problema

A aba Terreno só aceitava `.kml` (`accept=".kml"`), lido no navegador com `file.text()` e mandado inteiro no corpo da
requisição. O Google Earth e o SIGEF exportam KMZ (KML compactado). Defeito latente: KML entre ~4,5 e 10 MB passava
pelo limite da tela e era recusado pela Vercel (corpo acima de ~4,5 MB).

## Critérios de aceite
- [x] AC1: botão "Enviar KML/KMZ do terreno" (e "Trocar KML/KMZ"); aceita os dois formatos.
- [x] AC2: KMZ validado e descompactado com segurança; usa `doc.kml` ou o primeiro `.kml`; ignora `__MACOSX`, `._*` e
      imagens; com vários KML, diz qual foi usado.
- [x] AC3: o KML segue o mesmo caminho geoespacial (`parseKmlTerreno`): todos os polígonos válidos, furos e
      sobreposições pela união, sem área contada duas vezes.
- [x] AC4: área em m² como número principal e hectares como secundário (já era assim no cartão de Área).
- [x] AC5: integração com estudo de massa, lotes e 3D preservada (mesmos campos gravados).
- [x] AC6: em falha, o terreno já salvo não é apagado.
- [x] AC7: KML e KMZ equivalentes dão resultado idêntico.
- [x] AC8: arquivos acima de 4,5 MB (até 20 MB) chegam ao servidor em partes de 1 MiB.
- [x] AC9: bomba de compressão, entradas demais, caminhos com `..`/absolutos, ZIP64, senha e compressão desconhecida
      recusados com mensagem clara.

## Tarefas
- [x] T1: `server/_core/geo/kmz.ts` — leitor do diretório central, escolha do KML, descompactação em fluxo com limite.
- [x] T2: `server/incorporacao-terreno-arquivo.ts` — KML do envio em partes (`readUpload`), aviso de vários KML.
- [x] T3: `incorporacao.uploadKml` aceita `uploadId` + `fileName` (o `kmlContent` antigo continua aceito); edição mínima.
- [x] T4: cliente envia por `enviarPartes` (`documentChunks.part`), limite de 20 MB; tela com KMZ e aviso.
- [x] T5: testes.

## Dev Notes
- [AUTO-DECISION] Transporte em partes (opção "chunked" do pedido) em vez de baixar o limite: reaproveita
  `documentChunks.part` + `readUpload` (escopo `incorporacao-terreno:<id>`, 20 MiB, 30 min) e limpa a área temporária
  ao final.
- Bomba de compressão: o tamanho declarado no ZIP pode mentir, então a descompactação conta os bytes que saem
  (`Inflate` do fflate, blocos de 16 KiB) e para em 20 MiB; o tamanho declarado também é conferido antes. Máx. 1.000
  entradas. ZIP64 recusado (KMZ de terreno nunca precisa).
- Edição em `server/routers.ts` limitada ao `uploadKml` (entrada, uma linha antes do `parseKmlTerreno` e o campo
  `aviso` no retorno) — outro agente mexe nessa rota.

## Testes
- Automáticos: `server/incorporacao-kml-kmz.test.ts` (10 testes) — passando. KMZ montado no teste com fflate a partir do
  KML de referência (dois polígonos sobrepostos + um com furo): geometria/área/perímetro idênticos; KMZ sem compressão;
  vários KML; KMZ sem KML; bomba (inclusive com tamanho declarado falso); entradas demais; .kmz que não é ZIP; ZIP
  corrompido; rota em partes (PGlite) com KML e KMZ gravando o mesmo; arquivo > 5 MB; falhas sem gravar; permissão.
- `npx tsc --noEmit` — sem erros.
- Manuais: enviar KMZ real do Google Earth e do SIGEF no navegador (celular, tablet, computador).
- Pendente em produção: KMZ real do Google Earth/SIGEF; envio em partes pela Vercel.

## File List
- `server/_core/geo/kmz.ts` (novo)
- `server/incorporacao-terreno-arquivo.ts` (novo)
- `server/routers.ts` (só `uploadKml` e um import)
- `client/src/components/incorporacao/estudo/compat/acoes.ts` (`uploadKml`)
- `client/src/components/incorporacao/estudo/terreno-tab.tsx`
- `server/incorporacao-kml-kmz.test.ts` (novo)
- `docs/stories/epics/epic-024-correcoes-16-11/S-08-kml-kmz.md` (esta story)

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 16/11/2026 | @dev (Dex) | Story criada e implementada (YOLO); Ready for Review |
