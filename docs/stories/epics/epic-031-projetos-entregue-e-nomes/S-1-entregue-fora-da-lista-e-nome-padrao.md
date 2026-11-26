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
      o nome padrão e curto. O clique continua abrindo no Drive exatamente como antes (mesmo link, nova aba): muda só o
      texto mostrado, com o nome original como dica (title).
- [x] Vale para arquivos já enviados, calculado NA LEITURA: nada é apagado nem alterado no banco nem no Drive; o nome
      original continua guardado e aparece como dica (title) e no texto "original: …" que já existia.
- [x] Arquivo novo já é gravado no Drive com o nome padrão.
- [x] Número `n` estável: é a versão do arquivo dentro do item e tipo (PDF/editável), atribuída no envio sob trava.

## Padrão de nome

`<Item>-<Primeiro-Ultimo>-<n>.<ext>` — no máximo 40 caracteres antes da extensão, sem acento, espaço nem símbolo.

- **Item** (tabela fixa `ITEM_ARQUIVO_PROJETO_CURTO`): Projeto Arquitetônico → `Planta`; Projeto Estrutural →
  `Estrutural`; Projeto Elétrico → `Eletrico`; Projeto Hidrossanitário → `Hidrossanitario`; Orçamento de Obra →
  `Orcamento`; Laudo Técnico → `Laudo`; ART / RRT → `ART`. Item de texto livre: até duas palavras (sem "Projeto" e sem
  "de/da/do/e…"), máx. 16 caracteres, cortado na palavra. Entrega de revisão → `Revisao`. Sem item → `Doc`.
- **Cliente**: primeiro e último nome, capitalizados, sem acento e sem emoji; uma palavra só → ela; vazio → `Cliente`.
- **n**: versão do arquivo no item (1, 2, 3…); arquivo antigo sem versão → posição no item; nome repetido sobe o número.
- **Extensão**: a original, em minúsculas (só a última: `planta.final.DWG` → `dwg`); sem extensão → `pdf` (PDF) ou `bin`.

| Antes (gravado) | Depois (na tela) |
|---|---|
| `PROJETO_TECNICO_RESIDENCIA_KEILANE_COSTA_PROJETO_ELETRICO_V02.pdf` | `Eletrico-Keilane-Costa-2.pdf` |
| `PRANCHA FINAL revisada 03 (1) cópia.dwg` (item Projeto Arquitetônico, v1) | `Planta-Keilane-Costa-1.dwg` |
| `ART assinada Márcio.pdf` (item ART / RRT) | `ART-Marcio-Paiva-1.pdf` |
| `planta situação.DWG` (item livre "Planta de situação e localização") | `Planta-Situacao-Maylanne-1.dwg` (cliente "Maylanne 🌻") |
| entrega da revisão 4, PDF v3 | `Revisao-Marcio-Paiva-3.pdf` |
| documento antigo sem item | `Doc-Keilane-Costa-1.pdf` |

## Decisões

- Filtro feito no cliente (a lista `projetos.list` já vem inteira e é filtrada na tela); a regra está em
  `shared/projetos-lista.ts` (pura, testada). A tela não tem contadores/resumos. Outras telas não mudaram.
- Sem migração: o nome padrão é calculado dos metadados (`item_id`, `version`, `original_name`, `mime`) e do projeto.
- Sem rota de download nova: o clique abre no Drive como antes (visualizador do Drive preservado, inclusive no iPad).
  Consequência: ao baixar pelo Drive, arquivo ANTIGO sai com o nome que tem no Drive; arquivo NOVO já é gravado no Drive
  com o nome padrão.

## Pendências do dono

- ~~Renomear os arquivos ANTIGOS no próprio Google Drive~~ — autorizado pelo dono em 26/11/2026 ("Pode renomear os
  arquivos do Google Drive sim"); feito na S-2 (`S-2-renomear-no-drive.md`).
- Confirmar as abreviações (`Planta` para Projeto Arquitetônico; `ART` para ART / RRT) e o limite de 16 caracteres do item livre.

## File List

- `shared/projeto-documentos.ts` — `nomePadraoArquivoProjeto`, `nomePadraoDocumentoProjeto`, `nomesPadraoArquivosProjeto`,
  `itemCurtoArquivoProjeto`, `clienteCurtoArquivoProjeto`, `ITEM_ARQUIVO_PROJETO_CURTO` (substitui `projectDocumentCanonicalName`).
- `shared/projetos-lista.ts` — `filtrarListaProjetos` (novo).
- `shared/projeto-revisao.ts` — campos opcionais já gravados na entrega (`nomeOriginal`, `versao`).
- `server/routes/projeto-documentos.ts` — nome padrão no envio novo (gravado no banco e no Drive).
- `client/src/pages/admin/AdminProjetos.tsx` — filtro, frase e nome padrão no texto dos links do Drive.
- `client/src/pages/admin/ProjetoRevisoes.tsx` — nomes padrão das entregas de revisão.
- `server/projetos-entregue-e-nome-padrao.test.ts` (novo), `server/projeto-documentos.test.ts` (teste do nome antigo removido).

## Testes

- (a) Automáticos: `npx tsc --noEmit` limpo; `server/projetos-entregue-e-nome-padrao.test.ts` 9/9 (PGlite; Drive simulado: envio novo grava o nome padrão
  no banco e no Drive, antigo não é alterado, nome na leitura para o antigo),
  `server/projeto-documentos.test.ts` 4/4, `server/projeto-revisao.test.ts` 5/5, `server/api-rotas-producao.test.ts` 2/2.
- (b) Manuais: nenhum.
- (c) Pendentes em produção: abrir Projetos no iPad, conferir que entregues somem e voltam com o filtro; conferir o nome
  padrão nos links e que o clique abre o Drive como antes; enviar um arquivo novo e ver o nome no Drive.
