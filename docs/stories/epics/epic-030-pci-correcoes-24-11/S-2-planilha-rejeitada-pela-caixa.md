# EPIC-030 S-2 — PCI .xls rejeitada pela CAIXA e "reparada" pelo Excel

**Status:** InReview (causa confirmada pela CAIXA: tamanho acima de 5.120 KB; correção e testes prontos; anexar de novo depende do dono)

## Causa CONFIRMADA (26/11/2026): tamanho do arquivo

Print do sistema da CAIXA enviado pelo dono, com a planilha gerada já com a 1ª correção (3d61d9a): **"Operação não permitida. O tamanho
máximo permitido para o arquivo é 5120 KB. Tamanho deste arquivo: 5342 KB."**

O que pesava no arquivo de produção (5.470.208 bytes): um PNG de 3.484.635 bytes no armazenamento de imagens que NENHUMA forma usa
(veio no modelo enviado, com cRef 1), a foto de localização (337 KB) e, a cada regeração, as fotos antigas (3d61d9a: +1 MB por vez).

Correção (3ª etapa):
- `trocarImagensSemUso` (`biff8-imagens.ts`), chamada antes de salvar na PCI e na medição/PLS: toda imagem do armazenamento que nenhuma
  forma usa — nenhuma propriedade com o bit fBid (pib, fillBlip…), em nenhuma aba, gráfico embutido ou grupo; formas que vão sair não
  contam — troca os bytes por um PNG 1×1 transparente VÁLIDO (67 bytes), com o FBSE normal (btWin32/btMacOS 6 = PNG, rgbUid = MD5 da
  imagem, como as fotos que o gerador já insere, tag 0xFF, cRef 0). Mesma posição na tabela (nenhum pib muda); BStore, dggContainer e
  CONTINUE recalculados. Se a pasta tiver imagem de cabeçalho/rodapé (HEADERIMG), nada é trocado. Imagem em uso fica byte a byte igual.
  Isto substitui o "slot vazio" do 20cb79b, que não tinha exemplo gravado pelo Excel.
- Foto de localização preparada na tela (`GeradorPciAba.tsx`): lado maior até 1.600 px, JPEG 0,82, mirando até 400 KB (se passar, 1.280 px/0,78
  e 1.024 px/0,72); o servidor continua recusando foto acima de 1,5 MB com mensagem ("A imagem de localização deve ter até 1,5 MB.").
  As fotos da medição já vão com 1.024 px e até 200 KB.
- Trava final: acima de 5.000 KB a geração devolve o aviso "A planilha ficou com X KB; o sistema da CAIXA aceita até 5.120 KB. Troque a foto
  de localização por uma menor (ou gere sem foto) e, se o modelo enviado for uma PCI já preenchida, envie a planilha oficial em branco
  como modelo." O tamanho em KB aparece no botão de baixar a planilha do histórico (vermelho acima de 5.000 KB).

Números: arquivo do dono regravado SEM mudar dado (só a imagem sem uso e o id da foto) — 5.470.208 → 1.956.352 bytes (1.911 KB);
validador 0; registros comparados um a um (23.705): nenhuma célula, fórmula ou texto mudou; só 1 MSODRAWING mudou (o id da foto);
render do LibreOffice das 15 páginas idêntico pixel a pixel (60 e 150 dpi), com logos, ícones e a foto. Regerado do arquivo de produção
com foto sintética de ~1 MB: 1× 2.563 KB, 2× 2.563 KB, 3× 2.564 KB (antes: 6.478 → 7.487 → 8.496 KB); validador 0; foto de 4 MB recusada.

## Sintoma (25/11/2026)

- O Excel abre a PCI gerada com a mensagem "O Excel não pôde abrir o arquivo reparando ou removendo o conteúdo ilegível. O Excel
  recuperou fórmulas e valores de células, mas talvez alguns dados tenham sido perdidos".
- O sistema da CAIXA não aceita o arquivo: "essa planilha está com erro, não está anexando".
- Arquivo de produção analisado: 5,4 MB, gerado a partir do modelo oficial **com macros** (o dado do cliente não entrou no repositório).

## Inconsistências encontradas (com evidência)

Inconsistências corrigidas; a confirmação de que eram a causa é do dono, no Excel e na CAIXA.

Foi escrito um validador estrutural (BIFF8 + CFB + desenhos Escher) e aplicado ao arquivo de produção, ao modelo do repositório e a
planilhas geradas pelo código. O modelo do repositório (`server/caixa/__fixtures__/pci-modelo-anonimo.xls`) passa limpo e as planilhas
geradas a partir dele também — ele **não tem** os registros INDEX/DBCELL nem as macros. O modelo oficial em uso tem. No arquivo de
produção o validador achou **65 inconsistências, todas criadas pelo gerador**:

1. **INDEX com posições velhas (52 ocorrências) e DBCELL com distâncias velhas (6 + 6).** O INDEX de cada aba guarda a posição
   absoluta, no fluxo Workbook, de cada DBCELL; o DBCELL guarda distâncias dentro do bloco de linhas. O gerador acrescenta bytes antes
   das abas (textos novos no SST, a foto no grupo de desenhos — 4 MB neste arquivo) e troca células de tamanho, mas só recalculava
   BOUNDSHEET e EXTSST. Resultado: todos os 9 INDEX apontavam para o meio de outros registros. Código: `server/caixa/biff8.ts`,
   `serializarFluxo` (linhas 678–705 antes da correção); o arquivo já chega assim no primeiro commit do histórico atual (7bd6595).
   Atinge toda PCI gerada do modelo com macros, com ou sem foto.
2. **A foto ganhava um id de forma fora do grupo de ids da aba (1 ocorrência).** O id vinha de `spidCur + 1` do cabeçalho do desenho.
   No modelo com macros o `spidCur` da aba da proposta é 143934 (o grupo de ids dela é 1024–2047, registrado no FDGG); a foto ficava
   com 143935, num grupo de ids que não pertence a desenho nenhum. O id do objeto (OBJ) também era derivado desse número.
   Código: `server/caixa/biff8-imagens.ts`, `substituirFotos` (linhas 325, 332 e 353 antes da correção); também já presente no
   primeiro commit do histórico atual (7bd6595). As listas suspensas da validação de dados que o próprio Excel grava (OBJ do tipo 0x14) usam esse número e
   continuam como estão.

Descartados com evidência: registros acima de 8.224 bytes (nenhum; o grupo de desenhos de 4 MB já é dividido em CONTINUE corretos);
tamanhos dos contêineres Escher, BStore/FBSE/BLIP, ordem MSODRAWING→OBJ→TXO, BOF/EOF, BOUNDSHEET, EXTSST e contêiner OLE (setores,
cadeias, fluxos das macros e de resumo preservados byte a byte) — todos coerentes. A troca da cor automática do CF (PR #338) mexe só no
campo certo: nenhum CF do modelo tem o bloco de formato de número antes da fonte; ficou uma trava para esse caso.

3. **Tamanho que cresce a cada regeração (achado do portão de QA).** Ao tirar a foto antiga, `substituirFotos` baixava o `cRef` do
   FBSE para 0 mas deixava os bytes da imagem. Gerar de novo a partir de uma PCI já gerada acumulava as fotos: arquivo de produção
   regenerado com foto sintética de ~1 MB, código de 3d61d9a: 5,47 → 6,48 → 7,49 → 8,50 MB. Pode ser uma terceira razão do "não está
   anexando", se o sistema da CAIXA tiver limite de tamanho.

Observação: o arquivo de produção carrega uma imagem PNG de 3,4 MB no armazenamento de imagens que nenhuma forma usa (veio no modelo
enviado; provavelmente a foto de uma PCI anterior usada como modelo). Na 1ª e 2ª etapas ela não foi tocada; o tamanho virou o
problema confirmado (26/11) e a 3ª etapa a troca pelo PNG 1×1 (ver "Causa CONFIRMADA").

## Correção

- [x] `biff8.ts`: na gravação, os DBCELL são refeitos pelas distâncias reais do bloco e os INDEX pelas posições reais dos DBCELL e do
  DEFCOLWIDTH (duas passadas, porque o INDEX vem antes dos DBCELL da própria aba). A convenção foi conferida no modelo oficial: todos
  os blocos que o gerador não tocava batem exatamente com ela.
- [x] `biff8-imagens.ts`: o id da foto sai do grupo de ids que pertence ao desenho da aba (depois do maior id usado nele) e o
  contador do grupo é atualizado; o id do OBJ é o maior da aba + 1. Sem grupo livre, erro explícito (aviso na geração), nunca em silêncio.
- [x] `pci-gerador.ts`: a troca da cor automática do CF pula regras com bloco de formato de número (o deslocamento 12+80 não vale nelas).
- [x] `biff8-imagens.ts` (2ª etapa, SUBSTITUÍDA na 3ª): o "slot vazio" deu lugar ao PNG 1×1 válido de `trocarImagensSemUso` (acima).
- [x] `biff8-imagens.ts` (2ª etapa, achado baixo): sempre que `substituirFotos` roda (PCI ou medição/PLS), toda forma COM imagem cujo
  id está fora do grupo de ids do desenho da sua aba ganha um id livre no grupo certo — corrige a PCI salva pelo código antigo
  (foto 143935). Lista suspensa (OBJ 0x14) e formas sem imagem não são tocadas.
- [x] `biff8-validador.ts` (novo): `validarXls` / `validarFluxoWorkbook` com todas as amarrações acima; inclui o slot vazio coerente
  (44 bytes, cRef 0, recInstance = tipo, nenhuma forma apontando para ele) e RSTRING (0x00D6) entre os registros de célula.

## Testes

(a) Automáticos — `server/caixa/pci-xls-estrutura.test.ts` (10 testes): o modelo do repositório ganha INDEX/DBCELL e o `spidCur` 143934
como o oficial (sem dado de cliente); gera sem foto, com JPEG sintético de 20 KB e de 1,4 MB, e regera a partir de uma PCI já gerada:
validador sem nenhuma inconsistência e foto no grupo 1024–2047. Controle: o validador acusa INDEX/DBCELL/id adulterados. Com o código
antigo os 6 primeiros falham; só com a correção do INDEX, falham os 3 com foto (id fora do grupo). 2ª etapa: gerar 3 vezes em
cadeia com foto sintética de ~1 MB mantém o tamanho (diferença < 16 KB), abaixo de 5.000 KB e com validador 0, e as fotos antigas
viram o PNG 1×1; 3ª etapa: imagem sem uso deixa de pesar (> 100 KB liberados no modelo do repositório) e imagem em uso fica igual byte a
byte; o aviso de tamanho sai acima de 5.000 KB;
uma PCI com a foto no id 143935 sai normalizada quando a PLS recebe foto. Suítes da PCI e da medição (`server/pci-*.test.ts`,
`server/caixa/*.test.ts`, `server/medicao*.test.ts`, `server/pls-fiel-pci.test.ts`, `server/caixa-medicao.test.ts`) passam; `tsc --noEmit` limpo.

(b) Manuais (sessão, fora do repositório): o arquivo de produção usado como modelo e gerado de novo com foto sintética de 1,4 MB —
código antigo: 67 inconsistências; código novo: 0. Regeração em cadeia do arquivo de produção (5.470.208 bytes) com foto sintética
de ~1 MB — 3d61d9a: 6.477.824 → 7.486.976 → 8.495.616; agora: 6.137.856 → 6.137.856 → 6.137.856, validador 0 nas três; o LibreOffice
converte a 3ª e mantém a foto e os ícones. O LibreOffice converte o arquivo novo para .xlsx sem aviso (o LibreOffice é mais
tolerante que o Excel: isso não prova a aceitação pelo Excel).

(c) Pendente do dono (a causa de tamanho foi confirmada pela CAIXA; falta conferir a entrega): gerar a PCI de novo na produção (depois de publicado), abrir no Excel do computador e conferir que não aparece a
mensagem de reparo; anexar no sistema da CAIXA e confirmar que aceita.

## Arquivos

- `server/caixa/biff8.ts`
- `server/caixa/biff8-imagens.ts`
- `server/caixa/pci-gerador.ts`
- `server/caixa/biff8-validador.ts` (novo)
- `server/caixa/pci-xls-estrutura.test.ts` (novo)
- `server/caixa/medicao-xls.ts`
- `shared/pci-gerador.ts`
- `client/src/components/obra/GeradorPciAba.tsx`
