# EPIC-030 S-2 — PCI .xls rejeitada pela CAIXA e "reparada" pelo Excel

**Status:** InReview (correção e testes prontos; aceitação pelo Excel real e pelo sistema da CAIXA depende do dono)

## Sintoma (25/11/2026)

- O Excel abre a PCI gerada com a mensagem "O Excel não pôde abrir o arquivo reparando ou removendo o conteúdo ilegível. O Excel
  recuperou fórmulas e valores de células, mas talvez alguns dados tenham sido perdidos".
- O sistema da CAIXA não aceita o arquivo: "essa planilha está com erro, não está anexando".
- Arquivo de produção analisado: 5,4 MB, gerado a partir do modelo oficial **com macros** (o dado do cliente não entrou no repositório).

## Causa raiz (com evidência)

Foi escrito um validador estrutural (BIFF8 + CFB + desenhos Escher) e aplicado ao arquivo de produção, ao modelo do repositório e a
planilhas geradas pelo código. O modelo do repositório (`server/caixa/__fixtures__/pci-modelo-anonimo.xls`) passa limpo e as planilhas
geradas a partir dele também — ele **não tem** os registros INDEX/DBCELL nem as macros. O modelo oficial em uso tem. No arquivo de
produção o validador achou **65 inconsistências, todas criadas pelo gerador**:

1. **INDEX com posições velhas (52 ocorrências) e DBCELL com distâncias velhas (6 + 6).** O INDEX de cada aba guarda a posição
   absoluta, no fluxo Workbook, de cada DBCELL; o DBCELL guarda distâncias dentro do bloco de linhas. O gerador acrescenta bytes antes
   das abas (textos novos no SST, a foto no grupo de desenhos — 4 MB neste arquivo) e troca células de tamanho, mas só recalculava
   BOUNDSHEET e EXTSST. Resultado: todos os 9 INDEX apontavam para o meio de outros registros. Código: `server/caixa/biff8.ts`,
   `serializarFluxo` (linhas 678–705 antes da correção), desde a criação do leitor/gravador BIFF8 (18/10; primeiro commit no
   histórico atual: 7bd6595). Atinge toda PCI gerada do modelo com macros, com ou sem foto.
2. **A foto ganhava um id de forma fora do grupo de ids da aba (1 ocorrência).** O id vinha de `spidCur + 1` do cabeçalho do desenho.
   No modelo com macros o `spidCur` da aba da proposta é 143934 (o grupo de ids dela é 1024–2047, registrado no FDGG); a foto ficava
   com 143935, num grupo de ids que não pertence a desenho nenhum. O id do objeto (OBJ) também era derivado desse número.
   Código: `server/caixa/biff8-imagens.ts`, `substituirFotos` (linhas 325, 332 e 353 antes da correção), desde a criação da inserção
   de fotos (18/10). As listas suspensas da validação de dados que o próprio Excel grava (OBJ do tipo 0x14) usam esse número e
   continuam como estão.

Descartados com evidência: registros acima de 8.224 bytes (nenhum; o grupo de desenhos de 4 MB já é dividido em CONTINUE corretos);
tamanhos dos contêineres Escher, BStore/FBSE/BLIP, ordem MSODRAWING→OBJ→TXO, BOF/EOF, BOUNDSHEET, EXTSST e contêiner OLE (setores,
cadeias, fluxos das macros e de resumo preservados byte a byte) — todos coerentes. A troca da cor automática do CF (PR #338) mexe só no
campo certo: nenhum CF do modelo tem o bloco de formato de número antes da fonte; ficou uma trava para esse caso.

Observação: o arquivo de produção carrega uma imagem PNG de 3,4 MB no armazenamento de imagens que nenhuma forma usa (veio no modelo
enviado; provavelmente a foto de uma PCI anterior usada como modelo). Não foi apagada — mexer no armazenamento do modelo tem risco
próprio. Se o tamanho virar problema na CAIXA, enviar como modelo a planilha oficial em branco.

## Correção

- [x] `biff8.ts`: na gravação, os DBCELL são refeitos pelas distâncias reais do bloco e os INDEX pelas posições reais dos DBCELL e do
  DEFCOLWIDTH (duas passadas, porque o INDEX vem antes dos DBCELL da própria aba). A convenção foi conferida no modelo oficial: todos
  os blocos que o gerador não tocava batem exatamente com ela.
- [x] `biff8-imagens.ts`: o id da foto sai do grupo de ids que pertence ao desenho da aba (depois do maior id usado nele) e o
  contador do grupo é atualizado; o id do OBJ é o maior da aba + 1. Sem grupo livre, erro explícito (aviso na geração), nunca em silêncio.
- [x] `pci-gerador.ts`: a troca da cor automática do CF pula regras com bloco de formato de número (o deslocamento 12+80 não vale nelas).
- [x] `biff8-validador.ts` (novo): `validarXls` / `validarFluxoWorkbook` com todas as amarrações acima.

## Testes

(a) Automáticos — `server/caixa/pci-xls-estrutura.test.ts` (6 testes): o modelo do repositório ganha INDEX/DBCELL e o `spidCur` 143934
como o oficial (sem dado de cliente); gera sem foto, com JPEG sintético de 20 KB e de 1,4 MB, e regera a partir de uma PCI já gerada:
validador sem nenhuma inconsistência e foto no grupo 1024–2047. Controle: o validador acusa INDEX/DBCELL/id adulterados. Com o código
antigo os 6 falham; só com a correção do INDEX, falham os 3 com foto (id fora do grupo). Suítes da PCI e da medição (`server/pci-*.test.ts`,
`server/caixa/*.test.ts`, `server/medicao*.test.ts`, `server/pls-fiel-pci.test.ts`, `server/caixa-medicao.test.ts`) passam; `tsc --noEmit` limpo.

(b) Manuais (sessão, fora do repositório): o arquivo de produção usado como modelo e gerado de novo com foto sintética de 1,4 MB —
código antigo: 67 inconsistências; código novo: 0. O LibreOffice converte o arquivo novo para .xlsx sem aviso (o LibreOffice é mais
tolerante que o Excel: isso não prova a aceitação pelo Excel).

(c) Pendente do dono: gerar a PCI de novo na produção (depois de publicado), abrir no Excel do computador e conferir que não aparece a
mensagem de reparo; anexar no sistema da CAIXA e confirmar que aceita.

## Arquivos

- `server/caixa/biff8.ts`
- `server/caixa/biff8-imagens.ts`
- `server/caixa/pci-gerador.ts`
- `server/caixa/biff8-validador.ts` (novo)
- `server/caixa/pci-xls-estrutura.test.ts` (novo)
