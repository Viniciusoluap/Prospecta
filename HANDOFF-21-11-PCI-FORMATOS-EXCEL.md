# PCI da obra — XLS, XLSX, XLSM e XLSB (21/11/2026)

## Pedido, autorização e isolamento
- Dono pediu aceitar XLSX e XLSM além de XLS ao enviar/trocar e vincular a PCI da obra (prints da obra Emily); autorizou migração e produção imediatamente após concluir.
- Branch exclusiva `codex/pci-formatos-excel-20261121`, baseada na main `6ba284be0b4f88443a77e173846ac2f374753422`.
- Preservar correções do Fabel: sem editar suas branches ou incorporar mudanças de outras frentes. Na consulta inicial não havia PR aberto; conferir a main novamente antes do merge.

## Concluído
- Lista compartilhada das quatro extensões, seus MIME e mensagem de erro. Seletor com extensões e MIME para iPad; nomes em maiúsculas e `File.type` vazio funcionam.
- `PciObra`: Enviar/Trocar PCI aceita os quatro formatos. Envio em partes de 1 MiB, limite de 8 MiB e ação explícita de Vincular PCI preservados.
- Servidor: distingue OLE/XLS, workbook.bin/XLSB e workbook.xml/XLSX ou XLSM pelo conteúdo real. OOXML usa o leitor `xlsx` já instalado, somente valores/resultados em cache; não executa macros e não regrava a planilha.
- Identificação, incidências dos 20 serviços, validação de soma 100%, contrato, datas e cronograma mantêm a mesma leitura. PCI inválida continua recusada.
- Download e cópia/organização no Drive usam o MIME do formato e conservam o original.
- Gerador de novas PCI e cadastro de modelo oficial não mudaram: o pedido é sobre a PCI enviada/vinculada à obra.
- Sem dependência nova e sem migração de banco: arquivo e formato já ficam em bytea/JSON nas tabelas existentes. Sem alterar dados ou a PCI da cliente automaticamente.

## Testes
### (a) Automáticos
- 64 testes aprovados em 7 suítes: pci-formatos-excel (14 novos), pci-upload, caixa-medicao, pls-fiel-pci, pci-gerador, pci-legada e caixa-pci-migration.
- Modelo real anonimizado da CAIXA convertido em XLSX/XLSM/XLSB para exercitar cada leitor: mesmos dados e incidências, inclusive precisão completa, datas e cronograma. Bytes originais conservados; VBA de teste inerte conservado.
- React/happy-dom com o componente real: quatro extensões/MIME no seletor, Trocar PCI, envio em partes e finalização para XLS/XLSX/XLSM/XLSB com MIME vazio, ação Vincular PCI e recusa de PDF. Rede/persistência simuladas; sem chamadas a dados de clientes.
- TypeScript do leitor e do módulo compartilhado de upload; `git diff --check`.
- Preview completo Vercel pendente. A cópia local de trabalho não é um clone completo atualizado da main: apenas arquivos relevantes sincronizados; o PR leva somente o diff dos arquivos listados.
### (b) Manuais
- Conferidos os prints: seletor cinza para `PCI EMILY`; documento oficial exibido na CAIXA é `PCI EMILY .xlsx`.
- Revisão de nomes, MIME, limite, preservação de versões/incidências e escopo do diff.
### (c) Produção
- Após preview READY e merge: conferir deployment de produção READY, SHA e HTTP dos domínios.
- Validação com o arquivo real da Emily no iPad permanece para o usuário: Trocar PCI → escolher XLSX/XLSM → aguardar envio → Vincular PCI. Nenhuma PCI de cliente foi substituída nestes testes.

## Paridade e próximo passo
- Conferido `Grupo-Santa-Fe/web/src/lib/caixa/pci.ts`: ainda só distingue XLS/XLSB; portar a mesma regra de upload/leitura/MIME na frente responsável pela paridade. Nenhum arquivo Santa Fé alterado nesta entrega isolada.
- Revisar PR, corrigir eventuais achados, confirmar preview, conferir main/conflitos e integrar somente este pedido. Publicação já autorizada; nenhuma migração DDL necessária.
