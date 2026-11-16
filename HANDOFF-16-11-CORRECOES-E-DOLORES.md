# HANDOFF — 16/11/2026 — EPIC-024 (10 correções) e EPIC-025 (Dolores)

Regra de execução: `CLAUDE.md`, seção "EPIC-024 … e EPIC-025 (Dolores)". O dono foi dormir em 16/11 mandando não
parar: tudo autorizado (migração aditiva, merge e publicação a cada etapa). Grupo Santa Fé em espera.
Método: AIOX — @architect auditou, @dev implementa cada story em worktree próprio, @qa faz o portão; o que o QA
reprova volta ao @dev (ciclo de até 5 rodadas). Nada é publicado sem portão de QA resolvido.

## Como publicar uma etapa (o ramo de trabalho tem coisa inacabada — não publicar ele inteiro)
1. `git worktree add -B claude/<etapa> .claude/worktrees/publicacao origin/main`
2. trazer só os commits/arquivos da etapa (cherry-pick do ramo do agente, ou `git checkout <ramo> -- <arquivos>`)
3. `npx tsc --noEmit`, suítes da área, `npx vite build` **e o comando do build da Vercel:**
   `npx vitest run server/auth-session.test.ts server/imports-esm.test.ts` (importação relativa em `shared/` sem `.js`
   derruba a publicação — aconteceu no PR #235, corrigido no #236). Depois de abrir o PR, ESPERAR o status "Vercel"
   da prévia ficar verde antes de mesclar.
4. aplicar ANTES no Neon as migrações aditivas da etapa (projeto `plain-cake-26372935`)
5. push do ramo, PR rascunho → pronto → merge (squash, `expectedHeadSha` com 40 caracteres) → conferir a Vercel
6. realinhar `claude/motor-maquetes-3d-hwqvkz` com `git reset --soft origin/main` + commit do que sobrou

## Estado em 16/11, ~08:30 UTC

### Publicado
- PR #232 — validação com dados reais (CRM no iPad, vaga 18,75 m², área verde e rua da divisa no 3D, Overpass).
- PR #233 — **APP com o contorno real no Estudo de Massa (S-I)** + achados do QA do #232. Migração `0117` aplicada.
  ImperaCity (estudo 6): contorno da APP gravado direto no banco (calculado só com o rio do OpenStreetMap,
  122.055 m²; ao abrir o mapa do Terreno o sistema regrava com ANA + OSM). Os cenários salvos de antes aparecem com o
  aviso "gerados sem o contorno — gere de novo".

### Banco de produção (feito com autorização expressa do dono)
- Backup completo: ramificação Neon `backup-2026-11-16-antes-das-10-correcoes` (`br-odd-wind-aniucvpr`), conferida.
- Nove ramificações antigas de teste apagadas (o limite de 10 impedia o backup).
- BPO: todos os lançamentos arquivados apagados em definitivo — 1.528 do Conta Azul, 879 do legado e 132 do Asaas.
  Cópias em `bpo_lancamentos_backup_conta_azul_20261116` e `bpo_lancamentos_backup_legado_asaas_20261116` (NÃO
  apagar). `bpo_lancamentos` está com 0 linhas; o histórico (2.539) foi preservado.
- Migrações aplicadas: `0117` (coluna `app_geometry_json`). **Ainda não aplicadas:** `0118` (PCI), `0119` (logos),
  `0120` (enum do e-mail da proposta), `0122` (expurgo do BPO) — aplicar cada uma antes de publicar a etapa dela.

### Em andamento (ramos locais dos agentes, em `.claude/worktrees/agent-*`)
| Story | Ramo local | Situação |
|---|---|---|
| S-H leitor de PDF (EPIC-023) | `validacao-16-11` (= `claude/motor-maquetes-3d-hwqvkz`) | QA reprovou 2 vezes; 3ª rodada do @dev em curso. Achados da 2ª rodada: corte virando pavimento, regra de hachura apagando parede, teto de 150 mil candidatos cortando prancha grande sem aviso, mescla/ordem de pavimentos |
| S-10 Anthropic + S-01 Conta Azul | `epic024-s10-s01` | QA: S-10 CONCERNS, S-01 FAIL (limpeza definitiva não era só do admin); @dev corrigindo |
| S-09 PCI | `epic024-s09` | implementado (81 testes); no portão de QA |
| S-07, S-08, S-02, S-06 Incorporação | `epic024-incorporacao` | @dev em curso |
| S-04 muro do condomínio | `epic024-s04` | @dev em curso |
| S-03 PDF-imagem pela IA, S-05 importar planta | — | começam quando o leitor (S-H) passar no QA e a S-10 estiver publicada |
| EPIC-025 Dolores | — | depois do EPIC-024 |

### Decisões e fatos que o próximo agente precisa saber
- O PDF que o dono não conseguia ler (maquete 8) passou pelo iLovePDF: é uma única imagem JPEG, sem linhas. Decisão
  do dono: quando o leitor próprio não garantir a qualidade, ler pela IA. A chave é digitada por ele no painel da S-10
  (`configuracaoAnthropicPainel()` é a porta de entrada; nenhuma outra função usa essa chave).
- `adminProcedure` neste código só confere o MÓDULO, não o papel de admin; teste feito com `createCaller` de
  sub-router perde o prefixo do caminho e dá falso positivo. Testar permissão sempre pelo `appRouter`.
- Publicar código que lê coluna/tabela nova só depois da migração: `getIncorporationStudyById` faz `select()` de
  todas as colunas.

## Atualização — 16/11, ~11:30 UTC
- **Publicado:** PR #234 — painel Anthropic (S-10, só cadastro) e Conta Azul (S-01). Migração `0122` aplicada.
  Vercel READY; nenhum erro de execução em produção nas últimas 12 h.
- **O ambiente reiniciou várias vezes entre 08:00 e 11:20 UTC** e matou agentes no meio. Nada se perdeu: os ramos
  locais foram copiados para o GitHub como `claude/wip-epic024-incorporacao`, `claude/wip-epic024-s04`,
  `claude/wip-epic024-s09`, `claude/wip-epic024-s10-s01`. Agente morto não pode ser retomado: lançar outro com
  o resumo do que faltava. Os QAs agora gravam `RELATORIO.md` em `scratchpad/qa-*` enquanto trabalham.
- **Leitor de PDF (S-H):** 3ª rodada de QA = FAIL com dois bloqueios pequenos (H1: "PISO" no título fazia o
  pavimento sumir; H2: edícula na mesma prancha empilhada como 2º andar sem aviso). 4ª rodada do @dev em curso
  neste worktree (commit parcial `e7f9826`).
- **S-09 PCI:** os 9 achados do QA corrigidos (commits `815bf24`, `a46a637`, `48b0546`, `1173158` em `epic024-s09`,
  94 testes); 2ª revisão de QA em curso. Falta aplicar `0118` antes de publicar.
- **S-07/S-08/S-02/S-06 (Incorporação):** implementados em `epic024-incorporacao` (`cb18563`, `7a70417`, `38db454`,
  `946a19c`); QA em curso. Migrações `0119` e `0120` por aplicar. Atenção ao mesclar: `uploadKml` mudou na `main`
  (limpa o contorno da APP).
- **S-04 muro:** implementado em `epic024-s04` (`37e471d`, `80e17f3`, `28bd890`, `821a253`; 135 testes); QA em curso.
- **EPIC-025 Dolores, etapa 1:** @dev em curso (ramo `epic025-dolores-etapa1`, migração reservada `0123`).
- **Falta lançar:** S-03 (PDF-imagem pela IA, via `configuracaoAnthropicPainel()`) e S-05 (importar planta na
  revisão) — depois que o leitor passar no QA, porque mexem nos mesmos arquivos.

## Atualização — 16/11, ~11:50 UTC
- **Publicado:** PR #235 (Incorporação: S-07 filtros, S-08 KML/KMZ, S-02 logotipo, S-06 proposta) + PR #236
  (correção das importações que derrubaram a publicação do #235). Migrações `0119` e `0120` aplicadas.
- **QA do PCI (2ª) e do muro:** CONCERNS nos dois; @dev corrigindo em `epic024-s09` e `epic024-s04`
  (relatórios em `scratchpad/qa-s09b/RELATORIO.md` e `scratchpad/qa-s04/RELATORIO.md`).
- **Leitor (S-H):** 4ª rodada do @dev concluída (`b647d3a`, `7cdad02`; 142 testes); 4ª revisão de QA em curso
  (`scratchpad/qa-leitor4/RELATORIO.md`).

## Atualização — 16/11, ~13:45 UTC
- **Publicado desde a última nota:** PR #237 (S-09 PCI, migração `0118`), PR #238 (leitor de PDF da Maquete, S-H),
  PR #239 (S-04 muro do condomínio), PR #240 (**Dolores etapa 1 — leitura**, migração `0123` aplicada antes).
  Produção do #239 READY; a do #240 (`3142f6b`) estava em construção ao escrever — conferir.
- **EPIC-024, situação por correção:** 01, 02, 04, 06, 07, 08, 09, 10 publicadas. **03 (PDF-imagem pela IA) e 05
  (importar planta na revisão)** implementadas em `epic024-s03-s05` (cópia no GitHub: `claude/wip-epic024-s03-s05`,
  commits `0a02cc4`, `ff70a37`, `630bd5b`, `d92e99c`, `f40a306`, `fa3596f`, `0cb5e4e`, `a00c6ea`; 2.130 testes
  segundo o @dev). Portão de QA em curso (`scratchpad/qa-s03-s05/RELATORIO.md`). **Migração `0121` ainda NÃO
  aplicada** — aplicar antes de publicar.
- **EPIC-025 Dolores:** etapa 1 no ar, mas a ponte fica desligada (503) até o dono cadastrar `DOLORES_PONTE_TOKEN`
  na Vercel (`docs/dolores/como-ligar.md`). Etapa 2 (WhatsApp) com o @dev no ramo `epic025-dolores-etapa2`
  (cópia: `claude/wip-epic025-dolores-etapa2`; migração reservada `0124`; progresso em
  `scratchpad/dolores-e2/PROGRESSO.md`). A IA da Dolores nasce desligada: chave do painel + interruptor próprio.
- **Depende só do dono:** chave da Anthropic no painel de Integrações (libera a 03 e a Dolores); provedor de
  imagem para "Gerar com IA" do logotipo; token da ponte na Vercel; número/QR code da Dolores e inclusão nos
  grupos; categorias de mensagem a cliente; abrir o mapa do Terreno dos estudos com APP.

## Testes
- (a) Automáticos — PR #233: 54 arquivos, 642 testes; `tsc` limpo; `vite build` ok.
- (b) Manuais — aba Estudo de Massa real em navegador de teste (computador e iPad) com o ImperaCity e o contorno
  real: gera em ~8 s, faixa verde "APP com o contorno real (121.472,02 m²)", nota de acesso atravessando a APP.
- (c) Pendentes em produção — abrir o mapa do Terreno dos estudos com APP para o sistema guardar o contorno
  completo (ANA + OSM); reimportar o backup do Conta Azul depois de publicada a S-01.

## Próximo passo exato
Ver a seção 'Próximo passo exato (atual)' no fim do arquivo.

## Atualização — 16/11, S-03 e S-05 (ramo `epic024-s03-s05`, base `claude/motor-maquetes-3d-hwqvkz`)
- **S-03 (leitura híbrida):** modo `hibrido` (padrão só com chave), IA só nas pranchas que são imagem ou que o leitor
  próprio lê de forma insuficiente (`motivoParaIA`); chave do painel primeiro (`resolverCredencialIA` em
  `server/maquete-3d/base.ts`, único arquivo autorizado pelo teste de isolamento), depois `ANTHROPIC_API_KEY`; sem
  chave o passo fica "aguardando" e retoma dele; confirmação do custo uma vez por maquete (admin); teto por maquete
  (padrão 8); motor/modelo/tokens por passo. Só a página vai para a IA (JPEG extraído do PDF sem biblioteca nova,
  `server/maquete-3d/pdf-pagina.ts`). Story `S-03-pdf-imagem.md`.
- **S-05 (importar planta):** candidata separada do modelo, comparação lado a lado, aplicar na construção padrão ou
  num pavimento (trava de versão; publicada sai do ar), histórico `maquete_3d_revisoes` com restauração. Story
  `S-05-importar-planta-revisao.md`. **Migração `0121` por aplicar no Neon antes de publicar** (sem ela, salvar a
  planta falha ao gravar a revisão).
- Testes (a) automáticos: `server/maquete-3d*` + integrações Anthropic verdes; `tsc` e `vite build` ok; guarda de
  build ok. (b) manuais: nenhum. (c) produção: chave real no painel; PDF real da maquete 8; 0121 no Neon.
- Próximo passo: QA do ramo; aplicar 0121; publicar; com a chave cadastrada, rodar a maquete 8 em "Continuar leitura".

## Atualização — 16/11, correções do portão de QA de S-03/S-05 (ramo `epic024-s03-s05`, cópia em `claude/wip-epic024-s03-s05`)
- **Concluído:** os 10 achados do QA (relatório do Quinn) corrigidos, cada um com teste de regressão em
  `server/maquete-3d-qa-s03-s05.test.ts` (20 testes). Tabela achado → correção → teste nas stories S-03 e S-05.
  Principais: confirmação da IA por execução, com número de pranchas, expirando ao usá-las; teto por maquete no total
  (coluna nova `ia_pranchas_lidas`), passar dele só com "Autorizar além do teto" do admin; reserva da chamada paga
  antes de chamar a IA (UPDATE condicional) e toda gravação de passo condicional; motor "IA em tudo" com a mesma
  confirmação; PDF achado pela identidade (fonte + id), nunca pela posição; imagem só vai à IA se cobrir ≥ 60 % da
  página; IA sem planta mantém o leitor próprio; resposta da IA validada com zod e geometria absurda filtrada (com
  pendência); planta anterior guardada ANTES de qualquer substituição (falhou → nada muda); "ler de novo" bloqueado
  com importação aberta.
- **Migração 0121 mudou (ainda NÃO aplicada em banco nenhum):** ganhou
  `ALTER TABLE "maquetes_3d" ADD COLUMN IF NOT EXISTS "ia_pranchas_lidas" integer NOT NULL DEFAULT 0;` (aditiva e
  idempotente). Tem de ser aplicada no Neon ANTES de publicar o código (sem ela, listar/detalhe/link público quebram).
- **Testes:** (a) automáticos — `npx tsc --noEmit` OK; 8 suítes da Maquete + auth-session + imports-esm: 10 arquivos,
  200 testes verdes; `npx vite build` OK. (b) manuais: não feitos (sem navegador). (c) produção: chave real, PDF real
  da maquete 8, aplicar a 0121.
- **Próximo passo exato:** @qa refaz o portão de S-03/S-05 neste ramo; depois aplicar a 0121 no Neon e publicar.

## Atualização — 16/11, correções da 2ª rodada de QA de S-03/S-05 (ramo `epic024-s03-s05`, cópia em `claude/wip-epic024-s03-s05`)
- **Concluído:** N1–N7 do relatório da 2ª rodada (CONCERNS), um commit por achado: N2 `c9ffaa1`, N3 `860bc75`,
  N1 `6b159b6`, N4 `c5cfff5`, N5 `87c4183`, N6 `a9293b2`, N7 `e38d837`. Tabela achado → correção → teste na S-03
  (e o que vale para a importação na S-05). Principais arquivos: `server/maquete-3d/execucao-ia.ts`, `base.ts`,
  `resposta-ia.ts`, `leitura.ts`, `importacao.ts`, `router.ts`; tela `AdminMaquete3D.tsx`, `ImportarPlanta.tsx`,
  `rotulos-leitura.ts` (novo).
- **Testes (a) automáticos:** `npx tsc --noEmit` OK; `npx vitest run server/maquete-3d*.test.ts server/integracoes-anthropic.test.ts
  server/auth-session.test.ts server/imports-esm.test.ts` = 11 arquivos, 228 testes, todos passando (31 em
  `maquete-3d-qa-s03-s05.test.ts`, 11 deles da rodada 2); `npx vite build` OK. **(b) manuais:** não feitos (sem
  navegador nesta sessão). **(c) produção:** a 0121 continua tendo de ser aplicada no Neon ANTES de publicar (não mudou);
  leitura real com a chave do dono.
- **Pendências:** nada da 2ª rodada em aberto. Nenhuma migração nova (a `0121` não foi alterada).
- **Próximo passo exato:** @qa faz a 3ª revisão de S-03/S-05 neste ramo; aprovado, aplicar a 0121 no Neon e publicar.

## Atualização — 16/11, ~17:30 UTC
- **Publicado:** PR #242 — **S-03 (PDF-imagem lido pela IA) e S-05 (importar planta na revisão)**, unidas ao muro
  (S-04). Migração `0121` aplicada antes (12 maquetes conferidas intactas). Produção `11ebb96` READY.
  QA: 1ª rodada FAIL (10 achados), 2ª CONCERNS (7), 3ª **PASS** (3 ajustes pequenos aplicados). Relatórios em
  `scratchpad/qa-s03-s05*/RELATORIO.md`.
- **EPIC-024: as 10 correções estão publicadas.** Falta só o que depende do dono (chave da Anthropic para testar a
  leitura real do PDF da maquete 8; provedor de imagem para o logotipo por IA).
- **Dolores etapa 2 (WhatsApp):** QA deu FAIL (bloqueio: a conferência do número do dono ignorava o código do país —
  +995/+998 com o mesmo final passavam como o dono). @dev corrigindo os 9 achados em `epic025-dolores-etapa2`
  (cópia `claude/wip-epic025-dolores-etapa2`; relatório `scratchpad/qa-dolores-e2/RELATORIO.md`; progresso em
  `scratchpad/qa-dolores-e2/CORRECOES.md`). Migração `0124` ainda NÃO aplicada.
- **Para o dono confirmar:** na etapa 2 o "cérebro" roda no servidor com a chave do painel (a API não executa
  ferramenta própria sozinha), e não no agente do Console como dizia o prompt mestre. A IA nasce desligada.
- **Limite de uso:** às ~14:30 UTC o limite de 5 horas derrubou dois agentes sem commit; relançados às 16:45.
  Agentes agora fazem commit e push a cada achado.

## Próximo passo exato (atual)
1. Dolores etapa 2: receber o @dev → 2ª rodada de QA → aplicar `0124` → publicar pela receita. 2. Etapas 3 a 6 da
Dolores, uma por PR, cada uma com portão de QA. 3. Relatório final ao dono (classificação de cada correção e o que
depende só dele).

## Atualização — 16/11, ~23:10 UTC
- **Publicado:** PR #243 — **Dolores etapa 2 (WhatsApp)**. Migração `0124` aplicada antes. Produção `3a9575b` READY.
  QA: oito rodadas (relatórios em `scratchpad/qa-dolores-e2*/RELATORIO.md` e `…-r2` a `…-r8`); a última deu
  CONCERNS sem bloqueio e os achados foram corrigidos antes da mescla (conferidos à mão os casos de link).
- **Decisões do dono na noite de 16/11 (estão no `CLAUDE.md`):** segurança é prioridade; **dados pessoais liberados
  para a Dolores no WhatsApp ("opção B")** atrás de `DOLORES_MASCARAR_DADOS_PESSOAIS` (ponte HTTP mascarada por
  padrão, interruptor próprio `DOLORES_PONTE_DADOS_PESSOAIS`); **modelo da IA por função** (S-11). A chave da
  Anthropic foi cadastrada por ele (modelo preferencial `claude-haiku-5-5`).
- **Estado em produção:** IA da Dolores DESLIGADA, WhatsApp desconectado, limites em 0, ponte fechada (sem token).
- **S-11 (modelo por função):** QA PASS (2ª rodada, `scratchpad/qa-s11-r2`); @dev fazendo 4 ajustes menores no
  worktree `s11` (ramo `epic024-s11-modelo-por-funcao`, cópia `claude/wip-epic024-s11`). Base antiga = ramo de
  publicação da E2 em `756d941`; **falta unir com a `main` atual** e publicar. Sem migração.
- **Dolores etapa 3 (Ações):** QA PASS (3ª rodada, `scratchpad/qa-dolores-e3-r3`); @dev unindo a E2 final
  (worktree `dolores-e3`, ramo `epic025-dolores-etapa3`, cópia `claude/wip-epic025-dolores-etapa3`). Falta: trazer
  as últimas correções da E2 (`ff1477d..150b8f0` do ramo `epic025-dolores-etapa2`), aplicar a `0125` e publicar.
- **Ambiente:** pouca memória — rodar vitest com `--maxWorkers=2 --minWorkers=1`.

## Próximo passo exato (23:10 UTC)
1. S-11: receber o @dev, unir com a `main`, publicar. 2. E3: receber o @dev, unir com a `main` (que já tem a E2),
aplicar `0125`, publicar. 3. Dolores etapas 4, 5 e 6 (grupos de clientes, notas de obra, operação contínua), uma por
PR, cada uma com portão de QA. 4. Relatório final ao dono.

## Depende só do dono (não trava o trabalho)
- Testar a leitura do PDF da maquete 8 pela IA (Maquete 3D → "Ler de novo do zero" → confirmar); de preferência
  com um modelo mais capaz que o Haiku para a função de leitura de plantas.
- Para ligar a Dolores: conectar o número dela pelo QR code, cadastrar o número dele e os limites mensais em
  Integrações › Dolores, e ligar o interruptor — **só depois** de a etapa 3 estar publicada.
- Conferir que `PUBLIC_SITE_URL` existe na Vercel (sem ela, links do próprio sistema saem das respostas da Dolores).
- Confirmar a diferença em relação ao prompt mestre: o laço da Dolores roda no servidor, não no agente do Console.
- Conferir com o jurídico se o termo de consentimento dos clientes cobre o envio de dados à Anthropic (opção B).
- Provedor de imagem para "Gerar com IA" do logotipo (correção 02).
