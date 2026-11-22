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

## Atualização — 17/11, ~00:15 UTC
- **Publicado:** PR #244 — **S-11 modelo da IA por função** (produção `6862f03`; sem migração; QA PASS na 2ª rodada).
  PR #245 — **Dolores etapa 3 (Ações com fila de aprovação)** (produção `8e7c21d` READY; migração `0125` aplicada
  antes: `dolores_aprovacoes`, `dolores_autoria`, `dolores_fila_config`, fila vazia, validade 48 h). QA: 1ª FAIL,
  2ª CONCERNS, 3ª PASS; conferência final sobre a `main` CONCERNS sem bloqueio, achados 1–3 corrigidos no próprio PR
  (`server/dolores/correcoes-e3-final.test.ts`). Relatórios em `scratchpad/qa-dolores-e3*/RELATORIO.md`.
- **Estado em produção:** etapas 1, 2 e 3 da Dolores no ar e DESLIGADAS (IA desligada, WhatsApp desconectado,
  limites 0, ponte sem token). O dono pode ligar quando quiser pelo passo a passo de `docs/dolores/como-ligar.md`.
- **Em curso — Dolores etapa 4 (Grupos de clientes):** @dev no worktree `dolores-e4`, ramo
  `epic025-dolores-etapa4` (cópia `claude/wip-epic025-dolores-etapa4`), base `25ccea2` + falta unir `f8232ca`/`main`.
  Migração reservada `0126` (NÃO aplicada). O ambiente reiniciou às ~23:50 UTC e matou o primeiro agente com trabalho
  sem commit (não se perdeu: os arquivos ficaram no worktree); o agente novo faz commit e push a cada parte.
- **Faltam:** etapa 4 (QA, `0126`, publicar), etapa 5 (notas de obra) e etapa 6 (operação contínua).

## Próximo passo exato (17/11, 00:15 UTC)
1. Receber o @dev da etapa 4 → portão de QA (segurança) → corrigir → aplicar `0126` → publicar pela receita
   (ramo novo a partir da `main`, aplicar o diff da etapa, tsc, vitest com `--maxWorkers=2 --minWorkers=1`, vite build,
   guarda da Vercel, prévia READY, mesclar, conferir produção). 2. Etapa 5 e etapa 6, do mesmo jeito. 3. Relatório final.

## Decisões pendentes do dono (não travam)
1. Com a opção B, o texto que ele manda a Dolores gravar (tarefa/acompanhamento) fica com CPF/telefone em claro na
   fila e no registro — confirmar ou pedir para mascarar. 2. Confirmar que o laço da Dolores roda no servidor (e não no
   agente do Console). 3. Ponte HTTP mascarada por padrão — confirmar ou liberar (`DOLORES_PONTE_DADOS_PESSOAIS`).

## Atualização — 17/11, ~02:10 UTC
- **Publicado:** PR #246 — **S-12 termo de consentimento no primeiro acesso** (produção `2b7f064` READY; migração
  `0127` aplicada antes: tabela `consentimentos`, 0 aceites, 11 usuários intactos). QA: 1ª CONCERNS, 2ª PASS
  (`scratchpad/qa-s12*/RELATORIO.md`). Texto provisório até o jurídico (pendências só na janela do admin).
  Desligado por decisão pendente do dono: `CONSENTIMENTO_PEDIR_NO_LOGIN` (pedir a quem já tem senha).
- **O dono confirmou em 17/11** as três decisões pendentes da Dolores (ver `CLAUDE.md`) e mandou "continuar sem parar
  até concluir tudo".
- **Dolores etapa 4 (Grupos de clientes):** 1ª rodada de QA FAIL (gatilho da `0126` quebrava exclusões do CRM; PDF
  comprimido furava o teto de páginas); 8 achados corrigidos (`3901fef`…`e3e99af`, HEAD `a386300`, cópia
  `claude/wip-epic025-dolores-etapa4`); 2ª rodada em curso (`scratchpad/qa-dolores-e4-r2/RELATORIO.md`).
  `0126` NÃO aplicada.
- **Dolores etapa 5 (Notas de obra):** @dev em curso no worktree `dolores-e5`, ramo `epic025-dolores-etapa5` (cópia
  `claude/wip-epic025-dolores-etapa5`), migração reservada `0128`. Base = etapa 4 + `main`.
- **Falta:** publicar a etapa 4; QA e publicação da etapa 5; etapa 6 (operação contínua: eventos, rondas, relatório
  diário, tela com pausa e gasto); relatório final.

## Próximo passo exato (17/11, 02:10 UTC)
1. E4: receber o QA r2 → corrigir o que for importante → `0126` → publicar pela receita. 2. E5: receber o @dev → QA →
`0128` → publicar. 3. E6: lançar o @dev em cima da E5, QA, migração `0129`, publicar. 4. Relatório final ao dono com
a classificação de cada item e o que depende só dele.

## Atualização — 17/11, ~10:10 UTC

### Concluído e publicado
- **Dolores etapa 4 (grupos de clientes)** — PR #248, squash `44715cb` na `main`, produção READY. Arquivos principais:
  `shared/dolores/grupos.ts`, `server/dolores/{grupos,classificacao,documentos-cliente,grupos-router}.ts`,
  `server/dolores/acoes/grupos.ts`, `server/dolores/leitura/grupos.ts`, `DoloresGruposCard.tsx`.
- **Banco de produção (Neon):** aplicadas a `0126_dolores_grupos.sql` (tabelas `dolores_grupos`, `dolores_grupo_mensagens`,
  `dolores_grupos_contagem`, `dolores_grupos_config`, `dolores_grupos_consumo_mes`) e a `0130_dolores_fila_guarda.sql`
  (a guarda da fila aceita a exclusão do usuário que decidiu). Aplicadas até aqui: 0117–0127 e 0130. **Faltam 0128 e 0129.**
- Regra do dono gravada no `CLAUDE.md`: nos grupos a Dolores só responde quando é marcada.

### Em andamento (ramos locais, cópia no GitHub)
- **E4b — resposta no grupo quando marcada:** worktree `dolores-e4b`, cópia `claude/wip-epic025-dolores-etapa4b`, migração `0129`.
  @dev unindo a etapa 4 final; depois QA de segurança.
- **E5 — notas de obra:** worktree `dolores-e5`, cópia `claude/wip-epic025-dolores-etapa5` (HEAD `db6f862`), migração `0128`.
  Em QA de segurança.
- **E6 — operação contínua:** não começou.

### Testes
- (a) automáticos: etapa 4 no ramo de publicação — `tsc` limpo, 48 arquivos / 671 testes, `vite build` ok; prévia da Vercel READY.
- (b) manuais: nenhum (a Dolores está desligada em produção).
- (c) pendentes de validação em produção pelo dono: conectar o número, cadastrar um grupo real, conferir o formato da marcação.

## Próximo passo exato (17/11, 10:10 UTC)
1. Receber o QA da E5; devolver ao @dev o que bloquear; aplicar a `0128`; publicar pela receita do topo.
2. Receber a E4b unida; QA de segurança; aplicar a `0129`; publicar.
3. E6 em cima da `main` com E4b e E5; QA; migração; publicar.
4. Relatório final ao dono.

## Atualização — 17/11, ~11:40 UTC

### Concluído e publicado
- **Dolores etapa 5 (notas de obra)** — PR #250, squash `3b197bc`, produção READY. Migração `0128` aplicada no Neon.
  QA de segurança: CONCERNS sem bloqueio; os 5 achados corrigidos antes de publicar (duplicidade sem limite de 100,
  gatilho mais estrito, vínculo perdido religável só com nova aprovação, reconferência do fornecedor, grupo desativado).
- **Dolores etapa 4b (resposta no grupo só quando marcada)** — PR #251, squash `6e4b517`, produção READY. Migração `0129`
  aplicada. QA de segurança: CONCERNS sem bloqueio; os 5 achados corrigidos (sem etapa comercial nem aprovado/reprovado,
  texto ditado barrado, frase fixa verdadeira, rajada não cala o grupo, vaga liberada em erro).
- **Banco de produção:** aplicadas 0117–0130. Próxima: `0131` (etapa 6).
- `.claude/settings.json`: idioma em português (pedido do dono).

### Em andamento
- **E6 — operação contínua:** worktree `dolores-e6`, ramo `epic025-dolores-etapa6` (criado da main `3b197bc`), cópia em
  `claude/wip-epic025-dolores-etapa6`, migração `0131`. @dev construindo; depois QA de segurança.

### Testes
- (a) automáticos: E5 no ramo de publicação — 38 arquivos / 642 testes; E4b — 31 arquivos / 559 testes; `tsc` e `vite build` ok; prévias READY.
- (b) manuais: nenhum (tudo desligado em produção).
- (c) pendentes do dono em produção: conectar o número da Dolores, cadastrar grupo real, marcar a Dolores num grupo de teste
  (formato real da menção/@lid), enviar uma nota real num grupo de obra.

## Próximo passo exato (17/11, 11:40 UTC)
1. Receber a E6 do @dev; unir a `origin/main` (tem a 4b); QA de segurança; corrigir; aplicar a `0131`; publicar pela receita do topo
   (`git diff origin/main...<HEAD>` com três pontos).
2. Marcar a etapa 6 no EPIC; ROADMAP (paridade com o Santa Fé só anotada); relatório final ao dono.

## Atualização — 17/11, ~14:20 UTC — EPIC-025 COMPLETO NA MAIN

### Concluído e publicado
- **Dolores etapa 6 (operação contínua)** — PR #252, squash `f33393f`. Migração `0131` aplicada no Neon
  (`dolores_operacao_config`, `dolores_rondas`, `dolores_relatorios`, `dolores_relatorio_reenvios`, `dolores_eventos`).
  Arquivos principais: `shared/dolores/operacao.ts`, `server/dolores/{operacao,rondas,operacao-router}.ts`,
  `server/dolores/leitura/relatorio.ts`, `DoloresOperacaoCard.tsx`, rota `/api/cron/dolores` (cron `0 10 * * *`).
  QA de segurança: CONCERNS sem bloqueio; os 5 achados baixos corrigidos com teste de regressão.
- A pausa geral agora cala também a resposta nos grupos (`podeFalarNoGrupo`).
- Testes das notas de obra deixaram de depender da data do calendário.
- **Todas as etapas do EPIC-025 (1, 2, 3, 4, 4b, 5, 6) estão na `main`. Banco de produção: 0117–0131 aplicadas.**
- **Tudo da Dolores está DESLIGADO em produção** até o dono ligar.

### Testes
- (a) automáticos: ramo de publicação da E6 — `tsc` limpo, 35 arquivos / 624 testes, `vite build` ok; prévia READY.
- (b) manuais: nenhum.
- (c) pendentes de validação em produção, só o dono consegue fazer:
  1. Integrações › Anthropic: escolher o modelo de cada função (conversa, plantas da maquete, documentos dos grupos,
     notas de obra, resposta nos grupos).
  2. Maquete 3D: reler o PDF da maquete 8 com um modelo mais forte.
  3. Dolores: conectar o número (QR code), cadastrar o número do dono e os limites, ligar a IA; mandar "relatório".
  4. Grupos: incluir o número da Dolores num grupo real, cadastrar o grupo, marcar a Dolores (formato real da menção/@lid),
     enviar um documento e, em grupo de obra, uma nota.
  5. Vercel: conferir que existem `PUBLIC_SITE_URL` e `CRON_SECRET` (sem o segredo o cron da Dolores recusa sempre).
  6. Operação: informar o preço por milhão de tokens na tela para o gasto aparecer em R$; ligar rondas e relatório.

### Pendências (não travam)
- Decisões do dono em aberto: pedir o aceite do termo a quem já tem senha (`CONSENTIMENTO_PEDIR_NO_LOGIN`, desligado);
  criar lançamento/pagamento a partir da nota (hoje a nota só aponta); revisão do termo pelo jurídico (5 marcadores) e
  consentimento dos clientes do CRM sem login; provedor de imagem para a IA de logos.
- Ganchos prontos, não ligados: evento de pagamento do banco no momento da sincronização (`server/bancos.ts`);
  organizador do Drive ainda não conhece a pasta "Notas fiscais".
- Paridade com o Grupo Santa Fé: em espera por ordem do dono; lista no ROADMAP.

## Próximo passo exato
Nada pendente de código. Acompanhar a validação do dono em produção (lista (c) acima) e corrigir o que ele apontar.

## Atualização — 20/11, ~01:50 UTC

### Concluído e publicado
- **Etapa 8 — respostas longas e custo real** — PR #258 (`c5c05ff`), migração `0134` aplicada. Resposta cortada nunca é
  descartada (até 3 mensagens, quadros do sistema na primeira); `plano_de_atrasos` divide atrasos por dia por código;
  custo por modelo e por tipo de token (caso real: 3 perguntas no Haiku 5.5 = US$ 0,0088).
- **Etapa 7 — grupos automáticos, por tipo** — PR #259 (`b58e4b3`), migração `0133` aplicada. Só vale grupo em que o
  número do dono adicionou a Dolores (prova positiva pelo evento de add); sem prova → aguardando o dono; recusado/
  aguardando só é aceito por comando dele no WhatsApp. Duas rodadas de QA de segurança (FAIL → CONCERNS, reforços feitos).
- Banco de produção: 0117–0134 aplicadas.

### Em andamento
- **Etapa 9 — conexão única, roteamento, saudação de campanha, Dolores atende cliente cadastrado, aviso de ligação,
  transcrição de áudio (Cloudflare), dois canais preparados** — autorizada pelo dono ("Autorizo os itens 1 a 7").
  Worktree `dolores-e9`, ramo `epic025-dolores-etapa9b`, cópia `claude/wip-epic025-dolores-etapa9b`, migração `0135`.
  Regra no CLAUDE.md desse ramo. (O ramo antigo `claude/wip-epic025-dolores-etapa9` ficou obsoleto.)
- Coexistência (WhatsApp Web + API oficial no mesmo número): fase separada, depois de confirmar Brasil/grupos/requisitos.

### Pendente do dono
- Em Integrações › Dolores: clicar "Reativar recebimento" (eventos de grupo); aceitar os grupos atuais pelo comando.
- Corrigir os limites mensais (estão 24.000.000/120.000.000; para R$ 500: 15.000.000 de entrada e 1.000.000 de saída).
- Preencher preços por modelo (Haiku 5.5: 0,10/0,50; Opus 5.5: 4/20 US$/milhão) e cotação do dólar na tela da operação.
- Depois da etapa 9: criar conta na Cloudflare e cadastrar a chave.

### Testes
- (a) automáticos: E8 37 arquivos/666 testes; E7 40 arquivos/722 testes; tsc e vite build ok; prévias READY.
- (b) manuais: nenhum.
- (c) produção, pelo dono: comando "relatório" e o pedido de divisão de atrasos; adicionar a Dolores num grupo novo.

## Próximo passo exato (20/11, 01:50 UTC)
Receber a etapa 9 do @dev → QA de segurança → corrigir → aplicar 0135 → publicar.

## Atualização — 20/11, ~10:50 UTC

### Concluído e publicado
- **Etapa 9 — WhatsApp com conexão única, atendimento e campanhas** — PR #261 (`7ae8fd2`), migração `0135` aplicada
  (com `lock_timeout`; tabelas pequenas). Autorizada pelo dono ("Autorizo os itens 1 a 7"); regra no CLAUDE.md
  ("WhatsApp — uma conexão só, atendimento e campanhas"). Conexão da empresa em Integrações (instância já conectada,
  sem novo QR); roteamento por código (dono → Dolores; lead → Central e Dolores se ligado; vários cadastros/usuário →
  Central; desconhecido → Central + saudação; grupo → Dolores); saudação de campanha; Dolores atende cliente cadastrado
  (desligado); ligação recusada com aviso e áudio transcrito pela Cloudflare (transcrição desligada; avisos ligados com
  teto); disparo em massa pelo número principal bloqueado (10/min, 200/dia). Duas rodadas de QA (FAIL → CONCERNS).
- Banco de produção: 0117–0135 aplicadas.

### Pendente do dono (produção)
1. Integrações › WhatsApp da empresa: "Reativar recebimento" (assina ligação e eventos de grupo).
2. "Remover a conexão antiga da Central" (instância antiga da linha do admin; só limpa com confirmação da Evolution).
3. Cloudflare: criar token com o modelo "Workers AI" e copiar o Account ID; cadastrar no cartão de transcrição.
   (O dono pediu que eu cadastrasse; não é possível: a conexão da Cloudflare desta sessão não cria tokens, e chaves são
   digitadas por ele.)
4. Ligar quando quiser: "Dolores responde clientes", "transcrição"; criar a primeira campanha em Templates.
5. Limites mensais da Dolores (15.000.000 / 1.000.000) e preços por modelo + cotação, se ainda não corrigidos.

### Pendências técnicas (não travam)
- Limpeza periódica de `whatsapp_roteamento_vistos` e dos contadores por minuto.
- Conferir em produção o formato real da resposta do Whisper da Cloudflare (host bloqueado no ambiente de testes).
- Dados antigos da instância antiga em `user_notifications` / Central de Vendas / mídias: contar pelo número do dono
  (só leitura) antes de qualquer limpeza — limpeza exige confirmação do dono.
- Coexistência (WhatsApp Web + API oficial): fase separada.

### Testes
- (a) automáticos: E9 no ramo de publicação — 50 arquivos / 843 testes; tsc e vite build ok; prévia READY.
- (b) manuais: nenhum.
- (c) produção, pelo dono: ligar para o número (deve recusar e mandar aviso); mandar mensagem de um número
  desconhecido com campanha ativa; cliente cadastrado perguntando do andamento com o interruptor ligado.

## Próximo passo exato (20/11, 10:50 UTC)
Nada pendente de código no EPIC-025. Acompanhar a validação do dono em produção e corrigir o que ele apontar.

## Atualização — 20/11, ~19:15 UTC — EPIC-026 (correções de 20/11)

Epic novo: `docs/stories/epics/epic-026-correcoes-20-11/EPIC.md`. Ordem: C2 → C4/C5 → C3 → C1A → C1B.

### Concluído e publicado (produção READY conferida na Vercel)
- **C4 + C5 — PR #263** (squash `89efee7`): hora do relatório diário de 07:00 a 14:00 (10 crons diários no
  `vercel.json`, uma rotina só, um reenvio por dia se o envio falhar), preços sugeridos por modelo e limite mensal
  mostrado em reais. Sem migração. Arquivos: `shared/dolores/{operacao,precos-padrao}.ts`, `server/dolores/rondas.ts`,
  `DoloresCard.tsx`, `DoloresOperacaoCard.tsx`.
- **C2 — PR #264** (squash `356afeb`): leitura tolerante do aviso da Evolution (nome do evento, `{messages}`, sufixo de
  aparelho, `@lid`), contagem de tudo o que chega e quadro "Recebimento nas últimas 24 h" no cartão "WhatsApp da
  empresa". Migração **0136** (`whatsapp_recebimento_contagem`, `whatsapp_lid_numeros`) aplicada no Neon antes do
  deploy. Arquivos: `server/whatsapp-recebimento.ts`, `server/dolores/{whatsapp,roteamento}.ts`,
  `server/whatsapp-evolution-webhook.ts`, `server/whatsapp-conexao-empresa.ts`, `ConversasWhatsApp.tsx`.

### Em andamento
- **C3** (saudação da campanha com imagem e áudio): @dev no worktree `epic026-c3` (wip em `claude/wip-epic026-c3`,
  migração prevista `0137_saudacao_midia.sql`, ainda NÃO aplicada). Depois: portão de QA de segurança → aplicar 0137 →
  publicar.

### Pendente do dono
1. Repetir o teste: mandar mensagem de outro número e enviar o print do quadro "Recebimento nas últimas 24 h"
   (Integrações › WhatsApp da empresa). "Central/não identificado: 1" = resolvido; "Ignoradas" = o motivo diz o ajuste;
   "Chegaram: 0" = a Evolution não entregou (olhar a Evolution na Railway).
2. YCloud (C1B): conta criada no plano gratuito. Ele é administrador dos portfólios "Grupo Eficaz" (o da campanha —
   usar este) e "Vinicius VFX". Falta o print de Contas › Contas do WhatsApp do Grupo Eficaz. **Só vincular a
   coexistência depois do teste do item 1** (passo a passo já enviado).

### Testes
- (a) Automáticos: #263 — tsc limpo, 47 arquivos / 832 testes, build ok. #264 (já com a #263 junto) — tsc limpo,
  51 arquivos / 890 testes (`server/dolores`, `server/whatsapp`, guarda da Anthropic), build ok.
- (b) Manuais: nenhum nesta etapa.
- (c) Pendentes em produção: teste do outro número (C2); conferir amanhã que o relatório sai uma vez na hora escolhida.

## Próximo passo exato (20/11, 19:15 UTC)
Receber o agente da C3 → QA de segurança → aplicar 0137 no Neon → publicar pela receita de sempre. Depois C1A (campos
da API oficial no cartão, com aviso sobre grupos) e C1B (integração YCloud: chave digitada pelo dono em Integrações;
disparo de campanha pela YCloud; recebimento continua pela Evolution). Ler o resultado do teste do dono antes de
liberar a vinculação.

## Atualização — 20/11, ~20:55 UTC — EPIC-026: C6 e C3 publicadas; YCloud pausada

### Concluído e publicado
- **C6 — PR #266** (squash `80050d9`, produção READY): botão "Assumir (humano)" / "Devolver para a Dolores" na conversa
  da Central (número da empresa). Tabela `whatsapp_atendimento_modo` (migração **0138**, aplicada antes do deploy).
  Arquivos: `shared/dolores/modo-conversa.ts`, `server/dolores/modo-conversa.ts`, `server/dolores/roteamento.ts`,
  `server/whatsapp-router.ts`, `ConversasWhatsApp.tsx`. QA de segurança: CONCERNS sem importante; M1, M2, B1–B3 corrigidos.
- **C3 — PR #267** (squash `adb41c7`): saudação da campanha com imagem e áudio. Migração **0137** aplicada antes do
  deploy (`whatsapp_campanha_midias` + 4 colunas em `whatsapp_saudacoes`). Arquivos: `shared/whatsapp/saudacao-midia.ts`,
  `server/dolores/saudacao-midia.ts`, `server/dolores/roteamento.ts`, `server/_core/evolution.ts`,
  `CampanhasEAvisos.tsx`. QA de segurança em 3 rodadas (CONCERNS, CONCERNS, PASS); tudo fechado com teste.
- C2 confirmada em produção pelo dono (quadro "Recebimento": Central 1, Ignoradas 0; conversa apareceu).

### YCloud (C1B) — pausada, depende do dono
- Dono é admin dos portfólios "Grupo Eficaz" (verificação comercial REVOGADA; razão social "EFFICAZ…") e "Vinicius VFX".
  O número pessoal dele (final 8139-2210) já tem conta na Meta; o da empresa (final 9100-2210) não tinha.
- Tentou a coexistência 3× pelo iPad (método "Entrar com o app WhatsApp Business", por QR): a janela da Meta chega ao
  "Finish", mas a página da YCloud fica carregando e a conta não aparece na lista. No celular fica "YCloud — termine a
  configuração". Tradução automática do Chrome quebrava o formulário (erro ao escolher o país); sem tradução chega ao fim,
  mas o retorno para a YCloud se perde no iPad. **Refazer em computador.** Antes: desconectar a YCloud no celular
  (Configurações › Conta › Plataforma comercial) e esperar 15 min (erro #2655094).
- **Cada tentativa DERRUBA a conexão da Evolution** (aparelhos conectados): religar pelo QR em Integrações › WhatsApp da
  empresa e tocar em "Reativar recebimento". Em 20/11 ficou fora 16:54–17:06 e de novo desde 17:13 (BRT) — conferir.
- Pesquisa da API: `docs.ycloud.com` liberado no ambiente. Fatos: `X-API-Key`, base `https://api.ycloud.com/v2`,
  `POST /whatsapp/messages` (fila, template aprovado), `GET /whatsapp/phoneNumbers`, `GET /whatsapp/templates`,
  webhooks com `YCloud-Signature` (segredo `whsec_…`, corpo bruto, deduplicar por `id`), coexistência a 5 msg/s, grupos
  não passam pela API. Não assinar `whatsapp.inbound_message.received` (duplicaria com a Evolution).

### Pendências
- C1A/C1B: integração no Prospecta (chave digitada pelo dono em Integrações; disparo de campanha por template pela
  YCloud; conferência do número; webhook de status com assinatura). Só faz sentido depois da vinculação concluída.
- Teste em produção da C3: áudio chega como mensagem de voz? tempo de imagem grande.
- Baixos registrados: teto de upload em partes por usuário (`server/document-upload-chunks.ts`, pré-existente);
  `whatsapp_messages.external_id` sem índice único.

### Testes
- (a) Automáticos: #266 — tsc limpo, 53 arquivos / 919 testes, build ok. #267 (com a C6 junto) — tsc limpo,
  55 arquivos / 979 testes, build ok.
- (b) Manuais: dono testou a C2 em produção (ok).
- (c) Pendentes em produção: botão Assumir/Devolver na conversa real; saudação com mídia; relatório na hora escolhida.

## Próximo passo exato (20/11, 20:55 UTC)
1. Dono: desconectar a YCloud no celular e religar o Prospecta pelo QR (está desconectado). 2. Conferir produção READY
do `adb41c7`. 3. Quando houver computador: refazer a vinculação YCloud, religar o Prospecta e só então construir C1A/C1B.

---

## Atualização de 21/11/2026 ~14:00 UTC — EPIC-027 (correções de 20/11 à noite)

**Autorização do dono (21/11):** "Tudo autorizado pode fazer a migração e na sequência fazer a produção de todos e todas as
correções definidas até aqui que não pare até concluir tudo" — registrada no `CLAUDE.md` (#274), junto com as respostas dele.

### Concluído e em produção
| Frente | PR | Migração no Neon |
|---|---|---|
| C1 leitura da maquete em segundo plano (lotes) | #269 | — |
| C7 YCloud (API oficial, coexistência) | #270 | `0141` aplicada |
| C3/C4/C6 Dolores responde quando marcada, categorias, só o admin classifica | #272 (`6b16f00`) | `0139` e `0144` aplicadas (0144 logo após a publicação) |
| C2 grupos do WhatsApp na Central (módulo WhatsApp; corretor não vê) | #275 (`e43a047`) | `0142` aplicada antes do merge |
| Regras e respostas do dono | #271, #273, #274 | — |

### Em andamento (código pronto, fechando achados do portão de QA)
- **C5-E1 voz e memória** (worktree `epic027-c5`, espelho `claude/wip-epic027-c5`): QA r4 = CONCERNS só de custo (cache não acerta
  com a janela cheia; cota conta cache lido como cheio). @dev corrigindo (janela em blocos, peso do cache, piso da reserva).
  Migração `0143_dolores_conversa.sql` NÃO aplicada.
- **C7.1 colaborador opera campanha** (worktree `epic027-y2`, espelho `claude/wip-epic027-y2`): QA = CONCERNS baixos (prévia
  mostra tier/tetos/número mascarado ao colaborador; colaborador continua campanha pausada pelo admin). @dev corrigindo e ligando
  `ehEcoDeCampanhaOficial` no roteamento. Sem migração prevista.
- **C8 logotipo por IA** (worktree `epic027-logo`, espelho `claude/wip-epic027-logo`): QA = CONCERNS (aninhamento profundo estoura
  a pilha da limpeza de SVG; escapes de CSS; bomba de `<use>`). @dev corrigindo. Sem migração.

### Pendente (ainda não começado)
- C5 etapas seguintes: E2 resolver ("pode"/"confirmo"), E3 registrar a partir do grupo (só o dono), E5 gasto por função
  (55/20/10/10/5), E4 proatividade (07–20h seg–sáb, 6/dia), memória de longo prazo com tela. Próximo número de migração livre: 0145.
- Paridade Santa Fé (ROADMAP): C2 e C7/C7.1 da Central; C8 logotipo.

### Testes
- (a) Automáticos: #272 — 62 arquivos / 1.126 testes; #275 — 65 arquivos / 1.168 testes + r3 do QA (54); `tsc` e `vite build` limpos;
  portões de QA: C3/C4/C6 PASS (5 rodadas), C2 PASS (3 rodadas).
- (b) Manuais: nenhum nesta data.
- (c) Pendentes de validação em produção pelo dono: marcar a Dolores num grupo aceito; aba Grupos da Central (ver, escrever,
  Assumir/Devolver) com admin e com colaborador que tem WhatsApp; leitura real de planta da maquete pela IA; chave da YCloud e
  primeiro envio; saudação em áudio; relatório diário.

### Próximo passo exato
Receber os três @dev, reenviar ao @qa só o commit novo de cada um, e publicar na ordem C5-E1 (aplicar 0143 antes do merge) →
C7.1 → C8, cada uma com `tsc`, vitest (`--maxWorkers=2 --minWorkers=1`), `vite build`, prévia READY e produção READY. Depois,
abrir as stories das etapas E2–E5 e memória de longo prazo a partir de `C5-PLANO-dolores-jarvis.md`.

---

## PLANO B — "Agente Claude" (alternativa guardada a pedido do dono em 21/11/2026)

Palavras do dono: "eu quero que você salve no Handoff o agente Claude para um plano alternativo caso eu não goste do resultado
da Dolores, para que ele já fique salvo e a gente saiba o que fazer se eu te falar sobre ele".

**Quando usar:** só se o dono testar a Dolores atual (depois das etapas do plano de 21/11) e disser que não gostou, citando o
"agente Claude" / "plano B". Até lá NÃO construir nada disto. Antes de começar, apresentar a estrutura e esperar o "autorizo".

**O que é:** hoje a Dolores roda dentro do servidor do Prospecta (laço próprio em `server/dolores/cerebro.ts`, chave do painel,
travas no código — decisão do dono de 17/11). O plano B troca o LUGAR onde ela pensa: um agente hospedado pela Anthropic
(Claude Agent SDK / Managed Agents), que conversa com liberdade e usa o Prospecta por ferramentas.

**O que se ganha:** conversa e raciocínio mais soltos, tarefas abertas (ler arquivos, pesquisar, encadear muitos passos),
memória em arquivos do próprio agente. **O que se perde ou precisa ser refeito:** as travas hoje garantidas no servidor
(só o número do dono comanda; escopo por tipo de grupo; cliente só vê o próprio caso; teto de gasto; fila de aprovação;
auditoria) teriam de ser expostas como FERRAMENTAS do Prospecta — o agente nunca fala direto com o banco; gasto menos
previsível; os dados passam por mais um lugar (entra no termo de consentimento / jurídico).

**Como fazer, sem jogar fora o que existe (ordem):**
1. Adaptador de runtime: isolar em `server/dolores/` a interface "recebe mensagem do dono → devolve resposta + pedidos de
   ferramenta", para o laço atual e o agente hospedado serem trocáveis por um interruptor (desligado por padrão).
2. Ferramentas: reaproveitar o registro atual (`server/dolores/funcoes.ts`, `acoes/registro.ts`, `leitura/*`) atrás da ponte
   HTTP (`/api/dolores/ponte`, hoje só leitura, token próprio, dados pessoais mascarados por padrão). Escrita só pelas ações
   já listadas, com "pode"/"confirmo" reconhecidos por código no servidor — nunca decididos pelo agente.
3. WhatsApp: continua pela conexão única (Evolution); o servidor entrega ao agente só as mensagens do número do dono. Grupos e
   clientes continuam no laço atual, com o escopo travado no servidor (o plano B vale só para a conversa do dono).
4. Custo: mesma contabilidade (`dolores_consumo`), teto de R$ 1.621/mês, bloqueio em 100% e alerta em 80%.
5. Portão de QA de segurança completo antes de ligar; teste lado a lado (mesmas perguntas nos dois) para o dono comparar.
6. Depende do dono: créditos e criação do agente no Claude Console (chave digitada por ele no painel; nunca em chat).

**Alternativa ainda mais leve, a testar antes do plano B:** trocar só o MODELO da função "conversa da Dolores" em
Integrações › Anthropic (ex.: de Haiku para um modelo maior) — muda muito a naturalidade sem mexer em arquitetura.

**Não confundir com:** OpenClaw (assistente pessoal genérico; avaliar só se o dono pedir, e só pela ponte de leitura).

## Atualização de 21/11/2026 ~17:30 UTC

### Em produção hoje (além do registrado acima)
| Frente | PR | Migração |
|---|---|---|
| C8 logotipo por IA (chave do painel, SVG) | #277 | — |
| C7.1 colaborador opera campanha YCloud | #278 | — |
| C5-E1 Dolores: voz natural e memória (100 msgs / 6 h; cota pelo peso do cache) | #279 | `0143` aplicada |

YCloud em produção (conferido no banco): chave salva, número confere (VFX Capital, CONNECTED), avisos ativos, disparos LIGADOS,
teto 200/dia; falta só modelo aprovado pela Meta.

### Em andamento
- **C7.2 modelos da YCloud pelo sistema** — PR #280 (branch `claude/epic027-c72`), testes 213/213 e build ok; aguardando o
  portão de QA. Sem migração. Depois de publicar: conferir se `novidades_prospecta` foi criado sozinho (cron 07–14h BRT).
- **C5-E2 "pode / confirmo"** — worktree `epic027-c5e2` (@dev); migração `0145` se houver; depois QA e publicar.
- **EPIC-028 maquete fiel à planta + editor** — branch `feat/maquete-3d-editor` (no GitHub). Etapa 0 (plano) e Etapa 1 (JSON
  `data/plantas/lote4-qd18.json` + validações, 31 testes) prontas; Etapa 2 (gerador web + screenshots) com o @dev. Custo zero
  (Higgsfield 10 créditos, intocados). O dono mandou seguir as etapas sem parar; PUBLICAÇÃO da maquete em produção ainda
  depende da resposta dele (o prompt dela diz PR sem merge e migração só em branch do Neon). PDF da planta fica fora do repo.
  Pendências do dono: telhado 20% × 25% e platibanda 1,15 × 1,60; altura do balcão (1,10 estimada); folha fixa da P2.

### Plano novo da Dolores (apresentado em 21/11; AGUARDANDO o "aprovo" do dono — não pôr na fila antes)
1 pode/confirmo (em construção) · 2 anotar a partir do grupo · 3 gasto por função + alerta 80% · 4 memória de longo prazo
com tela · 5 ler o CARAXES (Obsidian no Drive) como base de conhecimento, só leitura (falta ele dizer a pasta) · 6 proatividade
· 7 análise de regularização com roteiro REURB · 8 tarefa demorada sem travar · 9 "criadora de mesas" (ele quer) · 10 mesa
comercial/maquete · 11 três achados baixos da YCloud + `ycloud-qa-c71-r2.test.ts`. Fora: Kapso/n8n, agente hospedado (plano B
acima), escritório 3D, MCP de escrita, vídeo por IA.

### Regra do dono reforçada em 21/11
Ele não quer mais tarefa manual: o que o sistema puder fazer com o que já tem (chaves guardadas no servidor), o sistema faz.
Botão novo só se nenhum existente servir.

### Próximo passo exato
Receber o QA da C7.2 → publicar #280; receber a E2 da Dolores → QA → `0145` → publicar; receber a Etapa 2 da maquete → conferir
os screenshots → Etapa 3 (editor + tabelas em branch do Neon). Perguntas abertas ao dono: aprovar o plano da Dolores; pasta do
CARAXES; se a maquete pode ser publicada a cada etapa.

---

## Atualização de 22/11/2026 ~03:40 UTC — EPIC-027 e EPIC-028

### Em produção (desde a atualização anterior)
| Frente | PR | Migração no Neon |
|---|---|---|
| C7.2 modelos da YCloud enviados pelo sistema (formulário de templates + modelo padrão automático) | #280 | — |
| C5-E2 Dolores "pode" / "confirmo" | #285 | `0145` aplicada |
| C7.3 ajustes da campanha pelo colaborador (filtro, eco exato, pausa do admin) | #287, #290 | — |
| C2 grupos na Central — 3 defeitos da revisão automática | #289 | — |
| EPIC-028 maquete nova: etapas 1–2 (#283), editor (#288), página por lote + decisões do dono (#292), painel de lotes (#293) | #283 #288 #292 #293 | `0146` e `0147` aplicadas |
Detalhe da maquete: `HANDOFF-21-11-MAQUETE-EDITOR.md`.

### Em andamento
- **Pacote Dolores integrado** (worktree `epic027-c5int`, HEAD `527336e`, espelho a criar): E3 registrar a partir do grupo
  (sem migração) + E5 gasto por função e alerta 80% (`0148`) + memória de longo prazo (`0149`) + 6 correções da revisão
  automática das etapas 1 e 2 (segredo em rótulo de grupo indo ao modelo; último pedido vale; validade real da proposta;
  `ligadoPorPadrao` na leitura; memória guarda só o texto entregue; elegibilidade antes do LIMIT). Suíte ~1.317 testes verdes
  em duas partes. Em portão de QA de segurança. `0148` e `0149` NÃO aplicadas.
- **Proatividade (E4)** — worktree `epic027-c5pro` (`0150`); **criadora de mesas** — `epic027-c5mesas` (`0151`); **mesa
  comercial/maquete** — `epic027-c5com` (sem migração). As três nascem do `epic027-c5int`.

### Pendente (não começado)
- Análise de regularização com roteiro de REURB (usar o conteúdo da skill A.68 do dono); tarefa demorada sem travar a conversa.
- YCloud: histórico de tentativas do modelo padrão por conta ao voltar para uma conta anterior (baixo).
- Conferir depois das 07h BRT se `novidades_prospecta` foi criado (`dashboard_settings` com chave `ycloud.%`).
- CARAXES: fora até planejar com o dono. Segundo prompt do dono: ainda não enviado.

### Testes
- (a) Automáticos: cada PR com `tsc`, vitest dos módulos afetados e `vite build`; portões de QA: C5-E2 (2 rodadas, PASS),
  C7.2 (CONCERNS corrigido), C7.3 (segurança OK), maquete E3 (CONCERNS corrigido) e E4 (PASS).
- (b) Manuais: nenhum.
- (c) Pendentes de validação em produção pelo dono: Dolores marcada em grupo; aba Grupos da Central; "pode"/"confirmo" pelo
  WhatsApp; memória da conversa; logotipo por IA; envio de template à Meta pelo formulário; maquete (editar, publicar, gerar
  link do lote e abrir no celular); leitura real de planta pela IA (EPIC-027 C1).

### Próximo passo exato
Receber o QA do pacote integrado → corrigir achados → aplicar `0148` e `0149` → branch a partir da `main` com
`git -C ../epic027-c5int diff origin/main...HEAD` → PR → esperar o Codex concluir → merge → conferir a Vercel. Depois integrar
proatividade, criadora de mesas e mesa comercial sobre a `main`, com QA, e publicar.
