# Handoff — Anexos de qualquer tipo na Due Diligence (11/11)

## Pedido do dono
"Quero poder adicionar tudo e qualquer tipo de arquivo": foto, DWG e Word apareciam apagados no seletor do iPad.

## Causa
- O campo de arquivo tinha `accept="application/pdf,image/jpeg,image/png"` (o iPad apaga o resto).
- Cliente e servidor só aceitavam PDF/JPG/PNG e até 3 MiB; a coluna `mime_type` tinha 40 caracteres (o tipo do
  Word .docx tem 71).
- A Vercel limita cada requisição/resposta a ~4,5 MB: arquivo grande (DWG, foto) não cabe numa chamada só.

## Concluído (branch `claude/intelligent-ptolemy-av0qoh`, junto do PR #199)
- `shared/incorporacao/anexos.ts`: tipo pelo navegador → extensão → genérico; limite 50 MB; partes de 2 MiB;
  lista do que pode abrir na aba (PDF, fotos JPG/PNG/GIF/WEBP, texto, MP4/MP3). HTML/SVG/XML nunca abrem.
- `server/incorporacao-documents-router.ts`: `uploadPart` (parte na área temporária, dono = usuário/estudo/item),
  `uploadFinish` (confere partes e tamanho, grava no Drive; recusando, junta as partes no próprio banco com
  `string_agg`), `contentPart` (leitura em partes: banco com `substring`, Drive com `Range`). `upload` antigo aceita
  qualquer tipo até 3 MiB. PDF/JPG/PNG sem assinatura válida ficam como arquivo genérico. Levantamento topográfico
  mantém as regras (CSV/TXT/XYZ/DXF).
- `server/drive-documents.ts`: `readPrivateDocumentRange`.
- `drizzle/0101_anexos_qualquer_tipo.sql` (não destrutiva): `mime_type` → varchar(120) e tabela
  `incorporation_upload_parts` (partes abandonadas >1 dia são apagadas no próximo envio).
- Telas: Due Diligence e Registro de Incorporação sem `accept`; abrir passa o nome para decidir aba × download.

## Testes
- (a) `server/incorporacao-anexos.test.ts` (8, Postgres real em memória com a 0101): Word com MIME longo, DWG de
  5 MiB em 3 partes íntegro no download, Drive com leitura por Range, recusas (incompleto, outro usuário,
  levantamento, item inexistente). Suíte completa 190 arquivos / 1584 testes, typecheck e build OK.
- (b) Chromium com servidor simulado: campo sem `accept`; DWG de 5,3 MB enviado em 3 partes (≤ 2,8 MB cada) + finalização, sem erros.
- (c) Produção: pendente. **Antes do deploy aplicar a 0101 no Neon (plain-cake-26372935)**; depois conferir no iPad
  anexar foto, DWG e Word e abrir/baixar.

## Próximo passo
Com autorização do dono: aplicar a 0101 no Neon de produção, mergear o PR #199 (vias públicas + anexos) e
conferir o deploy. Paridade: registrada no ROADMAP (Santa Fé).

## Merge, migração e deploy (autorizados pelo dono em 11/11)
- Migração 0101 aplicada no Neon de produção (plain-cake-26372935) antes do merge: `mime_type` = varchar(120) e
  tabela `incorporation_upload_parts` criada (conferido por consulta; 3 documentos existentes intactos).
- PR #199 mergeado em `main` (0d08bc3); deploy de produção READY, sem erros de runtime.
- (c) Pendente: no iPad, anexar foto, DWG e Word na Due Diligence e abrir/baixar cada um.
