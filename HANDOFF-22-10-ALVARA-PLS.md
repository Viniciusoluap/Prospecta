# Handoff — Alvará herdado nas medições PLS (22/10/2026)

## Concluído

- Branch isolada `codex/alvara-pls-heranca-20261022`, atualizada sobre `main` em `d4d32ac` após a publicação da agenda.
- `server/obra-progresso-router.ts`: o padrão de uma nova PLS lê as datas salvas nas medições da mesma obra em ordem decrescente, sem depender do limite visual de 100 registros. A emissão e a vigência são escolhidas separadamente; apenas campos jamais preenchidos usam a PCI.
- `shared/medicao-caixa.ts`: função pura de seleção das datas, ignorando datas legadas malformadas, sem alterar registros existentes.
- `client/src/components/obra/ProgressoObraAba.tsx`: depois de salvar, refaz a leitura antes de reiniciar o formulário, mantendo os novos valores preenchidos; editar medição antiga continua carregando os dados próprios daquela medição.
- `server/alvara-pls.test.ts`: cobre datas vindas de medições diferentes, prioridade em relação à PCI, fallback individual, cópia editável e data legada inválida.

## Pendências

- Publicação/merge/deploy coordenados com a paridade Grupo Santa Fé.

## Testes

- (a) Automáticos: `./node_modules/.bin/tsc --noEmit` passou; `./node_modules/.bin/vitest run server/alvara-pls.test.ts server/caixa-medicao.test.ts` passou (20/20); `git diff --check` passou.
- (b) Manuais: revisão estática do percurso de carregamento, edição e salvamento; sem sessão autenticada para testar na interface.
- QA independente: aprovado, com execução própria dos 20 testes focados e do TypeScript; banco de produção não exercitado.
- (c) Produção: confirmar prefill de datas salvas, ajuste manual e PLS seguinte depois do deploy.

## Próximo passo

Incorporar o parecer QA, publicar a branch com árvore idêntica, aguardar prévia READY, comparar a implementação do Santa Fé, depois merge e deploy autorizados.
