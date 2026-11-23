# Esquemas XSD oficiais da NFS-e Nacional (EPIC-029 S-7)

Cópia **sem alteração** (bytes iguais aos do .zip oficial: BOM e quebras CRLF mantidas) dos esquemas usados para validar a
DPS assinada e o pedido de evento **antes** de qualquer envio à Sefin Nacional (`server/fiscal/leiaute.ts`).
Baixados em 22/11/2026 do Portal NFS-e (gov.br). Só os arquivos da versão 1.01 que a DPS e o evento usam foram copiados.

| Pasta | Ambiente que usa | Versão | URL de origem | SHA-256 do .zip |
|---|---|---|---|---|
| `producao-20260209/` | `producao` (tpAmb 1) | v1.01 de 09/02/2026 (sem a NT 009) | https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/nfse-esquemas_xsd-v1-01-20260209.zip (pasta `Schemas/1.01/` do .zip) | `e7935cbd9470527c6cc32984c1b2263e614183bf0139ce2733eaaed2de9a8072` |
| `producao-restrita-20261020/` | `producao_restrita` (tpAmb 2, homologação) | v1.01 de 20/10/2026 (com a NT 009) | https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita/esquemas_prod_restrita_20261020.zip | `25fdcecc651a67a216496ab10d7566631e6ed10f721e37d62c7845dadb0ea267` |

Arquivos em cada pasta: `DPS_v1.01.xsd` (raiz da DPS), `pedRegEvento_v1.01.xsd` (raiz do pedido de evento),
`tiposComplexos_v1.01.xsd`, `tiposSimples_v1.01.xsd`, `tiposEventos_v1.01.xsd`, `xmldsig-core-schema.xsd`, e
`NFSe_v1.01.xsd`/`evento_v1.01.xsd` (o que a Sefin devolve; guardados para conferência). Diferenças entre as pastas:
`tiposComplexos`, `tiposSimples` (NT 009) e o cabeçalho DOCTYPE do `xmldsig-core-schema.xsd`.

## Ajuste feito NA HORA DE VALIDAR (os arquivos ficam intactos)

O `tiposSimples_v1.01.xsd` de produção tem um padrão com âncoras de expressão regular (`^0{0,4}\d{1,5}$`, tipo da série).
Na linguagem de padrões do XSD `^` e `$` **não são âncoras** (o padrão inteiro já é ancorado) e o libxml2 os trata como
letras — nenhuma série passaria. O validador .NET da Sefin os trata como âncoras. `server/fiscal/leiaute.ts` tira o `^`
inicial e o `$` final dos `pattern` em memória antes de validar (mesmo significado do servidor oficial).

## Atualizar

Baixar o .zip novo da página "Documentação atual" / "Produção restrita" do Portal NFS-e, criar uma pasta nova com a data,
apontar `PASTA_DO_AMBIENTE` em `server/fiscal/leiaute.ts` e atualizar esta tabela (versão, URL, SHA-256).
