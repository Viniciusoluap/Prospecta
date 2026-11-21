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
- 103 testes aprovados em 7 suítes: apartamentos (11 novos), mix, correções 09–12, loteamento SF, viabilidade econômica, relatório executivo e lançamento/viabilidade.
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
