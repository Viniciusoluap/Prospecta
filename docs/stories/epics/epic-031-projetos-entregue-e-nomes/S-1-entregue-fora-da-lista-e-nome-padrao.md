# EPIC-031 S-1 — Projeto entregue sai da lista e nome padrão dos arquivos

**Status:** InReview (commit local no ramo `projetos-entregue-nomes`; sem push, PR nem migração)

## Pedido do dono (26/11/2026, tela "Projetos")

> "se o projeto alterou o status para entregue ele sai dessa lista; ele só aparece novamente se eu botar o filtro lá pra
> aparecer os entregues, mas ele não deve mais aparecer nessa lista; todos os arquivos enviados devem ser automaticamente
> renomeados para a nomenclatura padrão e curta — hoje tem vários arquivos com nomes diversos e muitos muito extensos;
> isso precisa ser trocado".

## Critérios de aceite

- [x] Lista de Projetos: com o filtro Status vazio ("todos") ou em qualquer status que não seja "Entregue", projeto
      entregue não aparece; com "Entregue", só os entregues. A busca por texto respeita a mesma regra.
- [x] Frase curta perto do filtro: os entregues ficam guardados e aparecem escolhendo "Entregue" (sem botão novo).
- [x] Todo arquivo dos Projetos (itens do checklist, documentos antigos sem item e entregas de revisão) aparece com
      o nome padrão e curto, e o download sai com esse nome (cabeçalho `Content-Disposition`).
- [x] Vale para arquivos já enviados, calculado NA LEITURA: nada é apagado nem alterado no banco nem no Drive; o nome
      original continua guardado e aparece como dica (title) e no texto "original: …" que já existia.
- [x] Arquivo novo já é gravado no Drive com o nome padrão.
- [x] Número `n` estável: é a versão do arquivo dentro do item e tipo (PDF/editável), atribuída no envio sob trava.

## Padrão de nome

`<Item>-<Primeiro-Ultimo>-<n>.<ext>` — no máximo 40 caracteres antes da extensão, sem acento, espaço nem símbolo.

- **Item** (tabela fixa `ITEM_ARQUIVO_PROJETO_CURTO`): Projeto Arquitetônico → `Arquitetonico`; Projeto Estrutural →
  `Estrutural`; Projeto Elétrico → `Eletrico`; Projeto Hidrossanitário → `Hidrossanitario`; Orçamento de Obra →
  `Orcamento`; Laudo Técnico → `Laudo`; ART / RRT → `ART`. Item de texto livre: até duas palavras (sem "Projeto" e sem
  "de/da/do/e…"), máx. 16 caracteres, cortado na palavra. Entrega de revisão → `Revisao`. Sem item → `Doc`.
- **Cliente**: primeiro e último nome, capitalizados, sem acento e sem emoji; uma palavra só → ela; vazio → `Cliente`.
- **n**: versão do arquivo no item (1, 2, 3…); arquivo antigo sem versão → posição no item; nome repetido sobe o número.
- **Extensão**: a original, em minúsculas (só a última: `planta.final.DWG` → `dwg`); sem extensão → `pdf` (PDF) ou `bin`.

| Antes (gravado) | Depois (na tela e no download) |
|---|---|
| `PROJETO_TECNICO_RESIDENCIA_KEILANE_COSTA_PROJETO_ELETRICO_V02.pdf` | `Eletrico-Keilane-Costa-2.pdf` |
| `PRANCHA FINAL revisada 03 (1) cópia.dwg` (item Projeto Arquitetônico, v1) | `Arquitetonico-Keilane-Costa-1.dwg` |
| `ART assinada Márcio.pdf` (item ART / RRT) | `ART-Marcio-Paiva-1.pdf` |
| `planta situação.DWG` (item livre "Planta de situação e localização") | `Planta-Situacao-Maylanne-1.dwg` (cliente "Maylanne 🌻") |
| entrega da revisão 4, PDF v3 | `Revisao-Marcio-Paiva-3.pdf` |
| documento antigo sem item | `Doc-Keilane-Costa-1.pdf` |

## Decisões

- Filtro feito no cliente (a lista `projetos.list` já vem inteira e é filtrada na tela); a regra está em
  `shared/projetos-lista.ts` (pura, testada). A tela não tem contadores/resumos. Outras telas não mudaram.
- Sem migração: o nome padrão é calculado dos metadados (`item_id`, `version`, `original_name`, `mime`) e do projeto.
- Download pelo servidor em partes de 1 MB (limite de resposta da Vercel), salvo no navegador com o nome padrão.
  Quando o arquivo não tem `documentId` (registros muito antigos), o link continua indo ao Drive, mostrando o nome padrão.

## File List

- `shared/projeto-documentos.ts` — `nomePadraoArquivoProjeto`, `nomePadraoDocumentoProjeto`, `nomesPadraoArquivosProjeto`,
  `itemCurtoArquivoProjeto`, `clienteCurtoArquivoProjeto`, `ITEM_ARQUIVO_PROJETO_CURTO` (substitui `projectDocumentCanonicalName`).
- `shared/projetos-lista.ts` — `filtrarListaProjetos` (novo).
- `shared/projeto-revisao.ts` — campos opcionais já gravados na entrega (`nomeOriginal`, `versao`, `documentId`).
- `server/routes/projeto-documentos.ts` — nome padrão no envio; rota `GET /api/projetos/:id/documentos/:docId/arquivo`.
- `client/src/lib/projeto-arquivo.ts` — download em partes (novo).
- `client/src/pages/admin/AdminProjetos.tsx` — filtro, frase, nomes padrão e download.
- `client/src/pages/admin/ProjetoRevisoes.tsx` — nomes padrão das entregas de revisão.
- `server/projetos-entregue-e-nome-padrao.test.ts` (novo), `server/projeto-documentos.test.ts` (teste do nome antigo removido).

## Testes

- (a) Automáticos: `npx tsc --noEmit` limpo; `server/projetos-entregue-e-nome-padrao.test.ts` 8/8 (PGlite; Drive simulado),
  `server/projeto-documentos.test.ts` 4/4, `server/projeto-revisao.test.ts` 5/5, `server/api-rotas-producao.test.ts` 2/2.
- (b) Manuais: nenhum.
- (c) Pendentes em produção: abrir Projetos no iPad, conferir que entregues somem e voltam com o filtro; baixar um
  arquivo antigo e um novo e conferir o nome salvo.
