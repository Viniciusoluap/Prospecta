# Editar medição com a PCI vinculada atual — 21/11/2026

## Pedido, autorização e isolamento
- Após trocar/vincular a PCI, salvar a edição da medição existente deve adotar a nova PCI e gerar a PLS com ela, sem criar outra medição.
- Continuação da correção PCI publicada no PR #284; publicação já autorizada nesta conversa. Sem migração de banco: `pci_version_id`, itens, JSON da CAIXA e auditoria já existem.
- Branch exclusiva `codex/editar-medicao-pci-atual-20261121`, base `c1bcfb6337b6be96a3728a5ddbe080d3fb2b3b02`. Não alterar branches/correções do Fabel. Conferir main e conflitos antes do merge.

## Causa e correção
- O backend fixava a edição na `pciVersionId` antiga; o formulário carregava incidências/dados antigos.
- O histórico agora expõe a versão da medição; a PCI atual expõe versão e dados-base próprios, sem herdar contrato/valor de outra medição.
- Abrir Editar aplica incidências da PCI atualmente VINCULADA por chave, mantendo execuções. Quando a versão mudou, atualiza contrato, valor, contratação, alvará e selo; preserva data do levantamento, observações, condições da vistoria, repactuação/alteração e fotos. Campos numéricos são remontados para exibir os valores novos.
- O envio inclui a versão mostrada no formulário. O servidor valida essa versão, usa a PCI vinculada e recalcula itens/progresso. Cliente antigo sem versão também adota a PCI atual; ajustes manuais feitos na tela já atualizada são mantidos.
- Sem PCI atualmente vinculada, a medição conserva sua base histórica. Upload sem vínculo não troca a base.
- Guarda transacional após travar a obra verifica o vínculo/versionamento antes de gravar; troca/desvínculo concorrente aborta todo o batch com CONFLICT. Não salva com base diferente da exibida.
- Edita o mesmo ID e data de criação. Outras medições/versões não mudam; editar uma medição antiga não reaplica seu progresso sobre a vigente. Fotos não são removidas nem recriadas.
- PDF/download/Drive continuam usando a versão gravada NAQUELA medição: a edição explícita atualiza esse vínculo; mera consulta não migra históricos.

## Testes
### (a) Automáticos
- 66 testes em 9 suítes: edição PCI (4 puros + 7 em PostgreSQL/PGlite), atomicidade, solicitação de medição (puro/banco), PLS fiel, medição CAIXA, formatos Excel e migração/histórico PCI.
- Teste integrado salva a mesma medição, troca de XLS anterior para XLSX nova, preserva fotos e outra medição, gera PDF real e confere que traz a identificação NOVA e não a anterior.
- Testa formulário desatualizado, vínculo alterado antes da trava com rollback completo, ausência de PCI vinculada, edição de medição antiga sem mudar a vigente, ajustes manuais após carregar a versão nova.
- DOM com componente real e rede simulada: Editar, novos contrato/valor visíveis, incidências da nova PCI no payload, ID existente e versão atual, execuções/data/observações/foto mantidas, nenhuma chamada a criar nova medição.
- TypeScript estrito do helper compartilhado e `git diff --check` aprovados. Build completo a confirmar no preview (cópia local tem somente os arquivos relevantes sincronizados com a main).
### (b) Manuais
- Prints conferidos: obra mostra a PCI nova vinculada; PDF da medição editada ainda exibia identificação anterior. A correção altera o vínculo da medição no salvamento, não apenas a PCI da obra.
### (c) Produção
- Após preview e revisão: merge exclusivo, conferir Vercel READY, SHA e HTTP. Sem DDL nem atualização em massa de medições.
- No caso real, reabrir Editar na medição já existente, conferir o nome da PCI no aviso e salvar; baixar o PDF novamente. Não foi feita alteração automática de registro da cliente nos testes.

## Próximo passo / paridade
- Revisar PR, conferir preview e publicar (autorização vigente). Atualizar este handoff com SHA/deployment.
- Paridade Santa Fé: portar a mesma lógica no fluxo equivalente de editar medições. Mantida como pendência separada para não tocar na frente do Fabel nem ampliar esta publicação.

## Sincronização com a frente Fabel
- Durante a implementação, a main avançou para `04f8e3b0f0d8af5168e66471cd292d56a1bd04d6` (PR #285, Dolores C5-E2).
- Conferidos os 36 arquivos dessa frente: nenhuma sobreposição com os 6 arquivos desta correção. A branch foi sincronizada preservando integralmente os blobs da main nova; nenhuma migração/credencial/Dolores foi alterada por esta tarefa.
- O próximo preview deve validar a combinação com essa main, antes do merge de produção.

## Achado da revisão corrigido antes de publicar
- As incidências vinculadas ficam somente para leitura durante a edição; execuções continuam editáveis.
- O servidor recusa incidências divergentes da versão exibida (BAD_REQUEST), preservando a medição e evitando salvar um progresso diferente do preview. A adoção automática no backend fica restrita ao cliente legado que não informou versão e ainda usava a PCI anterior.
- Regressão adicional em banco confirma que alterar incidências em formulário da versão atual não grava nada. DOM confere incidências somente para leitura e execuções editáveis. 66 testes aprovados, além do DOM e do TypeScript estrito.

## Produção concluída — 21/11/2026
- PR #286 integrado: `e37e72deeaf27b4c444a869119b9d777ecafda04`. Conferido diff de somente 6 arquivos em relação à main `04f8e3b0f0d8af5168e66471cd292d56a1bd04d6`; frente Fabel/Dolores #285 preservada integralmente.
- Achado da revisão corrigido e thread resolvido; 66 testes em 9 suítes, DOM e TypeScript estrito aprovados.
- Preview final `dpl_FdwrCZZKZJ5ygwy3uoVN54ZSxE72` READY no SHA `09a63c22b107076947758802ea3e5f59598e9088`.
- Produção `dpl_6ppxUwZZ2bg5RV7YgzqpgUTQuPEm` READY, target `production`, SHA igual ao merge; domínios `www.prospectaconstrucoes.com`, `prospectaconstrucoes.com` e `site-prospecta.vercel.app` confirmados.
- Smoke HTTP em https://www.prospectaconstrucoes.com: 200, título Prospecta Construções.
- Sem migração DDL nem edição automática de registros de clientes. Para corrigir a medição já salva no caso real: atualizar a página, reabrir Editar, conferir a PCI exibida, Salvar alterações da medição e baixar o PDF novamente. As demais medições continuam com suas versões históricas.
- Este fechamento fica na branch de trabalho, evitando outro deploy de produção apenas por documentação. Código completo já publicado; validação manual no dispositivo e paridade Santa Fé continuam registradas acima.
