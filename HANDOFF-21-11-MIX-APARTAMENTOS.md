# Mix de produtos — Apartamento (21/11/2026)

## Pedido e isolamento
- Adicionar a caixa Apartamento ao lado de Casa pronta e contar apartamentos por bloco, sem interferir na frente em andamento.
- Branch exclusiva: `codex/apartamentos-mix-20261121`, baseada na main `bbcf673f3fb9515ea067cf3a9f60a07795aa7f20`.
- Nenhuma alteração na branch ou nos arquivos da frente WhatsApp/Dolores/YCloud (PR #280), credenciais, banco ou dados de produção. Campos novos opcionais no JSON já existente; sem migração.

## Concluído
- Caixa Apartamento, mutuamente exclusiva com Casa pronta. Alternar preserva preço por unidade e campos anteriores.
- Campos editáveis: apartamentos por andar (6), andares (4), terreno por bloco com estacionamento (1.000 m²), vagas por bloco (24).
- Quantidade continua sendo apartamentos vendidos; blocos = teto(quantidade / apartamentos por bloco). Cada bloco reserva um lote e sua área completa, mesmo incompleto.
- Exemplo do dono: 216 apartamentos = 9 blocos = 9 lotes, terreno total 9.000 m² e VGV R$ 45.360.000 a R$ 210.000 por apartamento.
- Infraestrutura manual considera o terreno dos blocos, sem multiplicar a área de um bloco por cada apartamento. Relatórios e recálculo usam o mesmo motor.
- Capacidade vertical homogênea considera blocos inteiros e vagas. Alerta para estacionamento insuficiente, configuração inválida, falta de área/lotes e lotes individualmente pequenos. Quantidade digitada nunca é reduzida silenciosamente.
- Misturas com casa/lote contam a ocupação de cada produto. Área por bloco já inclui estacionamento e circulação; vagas são a premissa informada pelo usuário, não uma implantação arquitetônica calculada. A verificação individual é por área; formato, recuos e acesso precisam de implantação.
- Arquivos: `viabilidade-tab.tsx`, `mix-produtos.ts`, `ocupacao-mix.ts`, `viabilidade-economica.ts`, `incorporacao-apartamentos.test.ts`.

## Testes
### (a) Automáticos
- 106 testes aprovados em 7 suítes: apartamentos (14 novos), mix, correções 09–12, loteamento SF, viabilidade econômica, relatório executivo e lançamento/viabilidade.
- DOM com React/happy-dom e componente real: Casa → Apartamento, exclusividade das caixas, 24 apartamentos/bloco, 9 blocos, área, VGV, salvar, desmontar/reabrir com JSON salvo, voltar a Casa com valores preservados. Somente a ação de persistência foi substituída por gravação em memória. Sem chamadas ao banco.
- TypeScript dos quatro módulos compartilhados de viabilidade/ocupação e `git diff --check`.
- A verificação TypeScript global da cópia local não é evidência válida da main: a cópia-base disponível era de 11/11, com 621 arquivos diferentes da main de 21/11; foram sincronizados os módulos relevantes de Incorporação. O restante contém routers e dependências antigos (por exemplo maplibre/maquete/logo). Nenhum desses arquivos será enviado por este PR. Confirmar o build completo no preview da Vercel.
### (b) Manuais
- Revisão da conta do print: 9 blocos × 24 = 216; 9 × 1.000 = 9.000 m², dentro de 9.895,97 m²; 216 × 210.000 = 45.360.000.
- Revisão do diff restrito ao pedido; nenhuma edição da frente em andamento.
### (c) Produção pendente
- Conferir preview e, após integração, abrir o estudo do print, marcar Apartamento, revisar 6/4/1.000/24 e salvar. Dados já existentes não são convertidos automaticamente pelo nome do produto.
- Validar em tela real de iPad os campos novos.

## Paridade e próximo passo
- Conferido `Grupo-Santa-Fe/web/src/lib/finance/loteamento.ts`: ainda não tem a opção Apartamento por bloco. Porte pendente para a sessão responsável, com as mesmas fórmulas/testes, conforme regra de paridade; nenhum arquivo do Santa Fé alterado nesta frente isolada.
- Revisar o PR exclusivo, conferir preview e integrar preservando os PRs concorrentes. Depois validar o estudo real; não mexer na configuração de WhatsApp/Dolores para esta entrega.

## Publicação autorizada — 21/11/2026
- Dono autorizou nesta conversa: "Autorizado pode fazer a migração e a produção".
- PR: https://github.com/Viniciusoluap/Prospecta/pull/282; código testado no commit `c7d3f199a28c6da7b881792db6a6a0ee5d368050`.
- Preview Vercel `dpl_J65o8k3UWWY4FuZZLrnNg3SjaozT` conferido READY; build completo concluído. Esta evidência substitui a pendência de build local descrita acima.
- Migração de banco dispensada: novos campos opcionais ficam em `loteamentoJson`/mix existente. Sem DDL ou alteração de registros.
- Próximo passo autorizado: integrar somente este PR e acompanhar o deployment de produção até READY, confirmando o SHA e os domínios. Validação autenticada do estudo real e do iPad permanece pendente; nenhum estudo existente será modificado automaticamente.

## Revisão antes da produção — três achados corrigidos
- P1: estacionamento agora calcula a capacidade física, descontando a projeção do prédio, aproveitando 70% do pátio e usando 18,75 m²/vaga com manobra; constantes reutilizadas da regra existente em `shared/maquete-3d/padrao.ts` (arquivo não alterado). Limite = menor entre vagas físicas, declaradas e apartamentos do bloco.
- Novo campo editável `areaProjecaoBlocoM2`: projeção do prédio no solo, incluindo áreas comuns. Sugestão inicial explícita de 50 m² por apartamento no pavimento; o usuário ajusta conforme a planta. A tela mostra vagas físicas, previstas e necessárias. As vagas já não dependem só da declaração.
- P2: misturas verticais agora alocam blocos inteiros por densidade, usando a sobra com outras tipologias. É uma estimativa de implantação possível por área, não uma otimização arquitetônica nem imposição de proporção entre os produtos.
- P2: PDF executivo reconhece preço por apartamento, terreno por bloco, projeção e conferência de vagas; não mostra campos legados de preço/m² como premissas do apartamento.
- Regressões adicionadas: 24 vagas declaradas em apenas 10 m² não validam a capacidade; 24 aptos/1.000 m² + 12 aptos/500 m² em 1.499 m² retornam 24, jamais 35; PDF exibe R$ 210.000/unidade e 9 blocos, preservando VGV.
- Validação final: 106 testes em 7 suítes e DOM de alternância/salvamento/reabertura aprovados novamente. Repetir preview após este commit antes de integrar.
- Cuidado reforçado pelo dono: preservar o trabalho do Fabel. Somente os 7 arquivos deste pedido entram no PR; PR #280 e sua branch permanecem intocados. Conferir novamente a main e conflitos imediatamente antes do merge.

## Produção concluída — 21/11/2026
- PR #282 integrado por squash: `db3559ea097b8e69513ff5465d5e7788376c2ed2`. Confirmado diff de exatamente 7 arquivos em relação à main anterior; nenhuma sobreposição com os 15 arquivos do PR #280, que continua aberto com head `1fb46c040b86ecf348798c502625668eb185c656`.
- Os três threads da revisão foram resolvidos após as correções e suas regressões.
- Preview final `dpl_HpLqFmseHoCDven2wzqt47rSE4an` READY; produção `dpl_HCLLKcUGkrmDZXSXBaTK2zyM6wKh` READY, target `production`, SHA conferido igual ao merge.
- Domínios de produção confirmados pela Vercel: `prospectaconstrucoes.com`, `www.prospectaconstrucoes.com`, `site-prospecta.vercel.app`.
- Smoke HTTP da produção: status 200, título Prospecta Construções e bundle `/assets/index--lncWXWy.js`, igual ao preview validado. Sem alteração de estudos/dados de clientes.
- Migração dispensada (JSON existente); 106 testes e DOM aprovados. Falta somente a validação autenticada do estudo real/no iPad: marcar Apartamento no produto existente e conferir suas premissas. O nome do produto não muda seu tipo automaticamente.
- Este registro final fica salvo na branch de trabalho para não disparar outro deploy de produção apenas por documentação. Código da entrega já publicado integralmente. Paridade Santa Fé continua como pendência explicitada acima.
