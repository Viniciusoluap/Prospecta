# Handoff — PCI legada e desvinculação (22/10/2026)

## Contexto e estado confirmado

- A agenda unificada foi mesclada no Prospecta em `d4d32ac` (PR #147) e publicada no Vercel READY. A herança das datas de alvará nas medições PLS foi aprovada em QA (20 testes e TypeScript), teve prévia READY e foi mesclada em `d6aa84af4b42ca729a57c31fbc628d2758e9f8ff` (PR #148). O deploy de produção desse último commit ainda deve ser confirmado.
- Branch isolada desta frente: `codex/pci-legado-desvincular-20261022`, criada do `main` em `d6aa84a` no worktree `Prospecta-pci-legacy`. Não tocar worktrees antigos com mudanças preexistentes.
- Prints enviados pelo usuário em 22/10: `image(20261022-143410).png`, `image(20261022-143427).png`, `image(20261022-143441).png` na pasta `upload` do scratch. A PCI `PCI MARIANA VIGENCIA NOV24.xls` está vinculada na obra de Mariana Torres da Silva. O sistema mostra incidências deslocadas e total de **77,90%**, quando a planilha fotografada mostra os itens 1–20 nas **linhas 113–132** e total 100,00%. Exemplo: o primeiro item da planilha tem 3,10%, mas a aplicação mostra 9,00% (valor do item da linha 120). O código de `server/caixa/pci.ts` fixa `LINHA_PRIMEIRO_SERVICO_PCI = 120`, lendo 120–139. Isso explica o deslocamento nesta versão antiga; ainda falta validar o arquivo real, que não foi anexado (somente prints).
- O usuário pediu botão **Desvincular PCI** junto dos controles da PCI, restaurando as incidências padrão da obra. Manter a execução de cada serviço e o histórico das medições. Evitar apagamento do arquivo original e versões da PCI sem pedido explícito. Uma medição anterior vinculada a uma versão deve continuar auditável e gerar arquivos com a versão correspondente.
- Agentes AIOX para esta frente (`pci_prospecta`, `pci_santafe`, `pci_qa`) foram iniciados mas interrompidos por limite de uso; nenhuma alteração de código deles foi entregue. Continuar diretamente ou por Claude.

## Próximos passos exatos

1. Fazer o parser em `server/caixa/pci.ts` encontrar a tabela correta em PCI antiga e atual, validando 20 itens, índices e total 100% (tolerância apenas de arredondamento), sem aceitar janela deslocada ou planilha incompleta. Mapear as colunas realmente presentes no arquivo, quando acessível. Preservar as demais coordenadas da planilha onde corretas e revisar as faixas mínimo/máximo relativas à linha escolhida.
2. Inspecionar `server/obra-progresso-router.ts`, `server/routes/obra-medicao-caixa.ts`, `shared/financeiro/progresso.ts`, `client/src/components/obra/MedicaoCaixa.tsx` e o esquema de `construction_pci`. Projetar mutação de desvincular com autorização igual à de vincular, atualização atômica da marca `linkedAt`/versão atual e itens padrão via `itensProgressoIniciais`/`mesclarComPadrao`, preservando `execucao` e medições históricas. Atualizar cache e tela após a mutação.
3. Ao enviar/substituir uma PCI antiga, exigir total coerente antes de oferecer vínculo; decidir reparo de `parsed` já persistido (reprocessar bytes originais) e evitar vincular 77,90% novamente. O usuário poderá desvincular/revincular ou substituir a PCI depois da correção; não alterar dados da obra de Mariana em produção sem validação do arquivo real.
4. Testar ao menos: planilha antiga 113–132, modelo atual 120–139, rejeição de janela deslocada/incompleta; desvincular/restaurar padrão, execução intacta, histórico e versão íntegros, permissões, revincular. Garantir paridade Grupo Santa Fé.
5. Atualizar este handoff com mudanças, testes (automáticos/manuais/produção), commit e pendências. Commit e push da branch e confirmar árvore remota. PR, prévia Vercel READY, merge e deploy autorizados pelo usuário; só efetuar após QA.

## Verificação até este checkpoint

- Automática: nenhuma do lote PCI ainda; parser inspecionado por código.
- Manual: prints examinados e comparação visual do primeiro item e total; arquivo `.xls` original não disponível localmente.
- Produção pendente: confirmar deploy da herança de alvará; testar leitura da PCI de Mariana e o novo desvínculo com sessão autorizada depois da publicação.
