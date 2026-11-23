# xmllint-wasm 5.3.0 — cópia do validador XSD dentro do repositório (EPIC-029 S-7)

Por que existe: a função da Vercel não aceita pacote com pasta que é link simbólico, e o pnpm guarda o `xmllint-wasm` em
`node_modules/.pnpm/…` com `node_modules/xmllint-wasm` sendo só um link. Incluir esse caminho no `includeFiles` derrubou a
publicação do #324 ("invalid deployment package … symlinked directories"). Esta pasta entra na função pelo glob
`shared/fiscal/xsd/**` do `vercel.json` (arquivos comuns, sem link) e é a ÚNICA fonte do validador em tempo de execução:
`server/fiscal/leiaute.ts` carrega daqui, nunca de `node_modules`.

- Pacote: `xmllint-wasm` **5.3.0** (libxml2 compilado para WebAssembly), licença MIT (`LICENSE` = `COPYING` do pacote).
- Origem: https://registry.npmjs.org/xmllint-wasm/-/xmllint-wasm-5.3.0.tgz (repositório https://github.com/noppa/xmllint-wasm).
  SHA-256 do .tgz: `9fcb07451467c6ed64421acb4bafc1302cf559f95f1f699eba0dbdc7434d01ad`; integridade no `pnpm-lock.yaml`:
  `sha512-sEgRXdf2t13eYCFCURmCE6h2hwleEOIS9VL/jOh9JJJnez2YXIooi2Ghm05/JZEPXyPawN8sMASPVZlmh8Sd6A==`.
- Copiados em 23/11/2026 **sem alteração** (bytes iguais aos do .tgz). Só os arquivos da versão para Node:

| Arquivo | O que é | SHA-256 |
|---|---|---|
| `index-node.js` | ponto de entrada (`validateXML`); abre o worker `xmllint-node.js` por `__dirname` | `f67ca560eb11541b29caf3104747c4e8cb9605b2f3789b0fc45e976aa88421b9` |
| `xmllint-node.js` | worker (Emscripten) que lê `xmllint.wasm` por `__dirname` | `135ef53a1f3be23e850ab262e39c15732c4b19df5538e6e15891aa64c7bc0f30` |
| `xmllint.wasm` | o libxml2/xmllint em WebAssembly | `4e3cc21a67e8dd40ccb59822e4193fd1923b4cda08b40fe8ff8973de5eed9515` |
| `LICENSE` | licença MIT (cópia do `COPYING`) | `74f6fb26dabad238799d4c3bf65c26bbb1c82b7cbaefe6e9443cd7d091947cc9` |

`package.json` desta pasta (só `"type": "commonjs"`) é nosso: o projeto é `"type": "module"` e os dois `.js` acima são
CommonJS (`require`, `__dirname`). Os SHA-256 da tabela são conferidos por `server/fiscal/leiaute-vendor.test.ts`.

## Atualizar

Baixar o .tgz da versão nova (`npm pack xmllint-wasm@<versão>`), copiar os mesmos três arquivos e o `COPYING` (como
`LICENSE`), atualizar a tabela acima e `SHA256_DO_VALIDADOR` em `server/fiscal/leiaute.ts`, e rodar os testes do leiaute.
