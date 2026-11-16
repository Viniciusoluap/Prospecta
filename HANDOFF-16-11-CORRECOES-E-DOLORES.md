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

## Testes
- (a) Automáticos — PR #233: 54 arquivos, 642 testes; `tsc` limpo; `vite build` ok.
- (b) Manuais — aba Estudo de Massa real em navegador de teste (computador e iPad) com o ImperaCity e o contorno
  real: gera em ~8 s, faixa verde "APP com o contorno real (121.472,02 m²)", nota de acesso atravessando a APP.
- (c) Pendentes em produção — abrir o mapa do Terreno dos estudos com APP para o sistema guardar o contorno
  completo (ANA + OSM); reimportar o backup do Conta Azul depois de publicada a S-01.

## Próximo passo exato
Receber o retorno de cada agente; o que o QA aprovar, publicar pela receita acima (uma etapa por PR), aplicando a
migração da etapa antes. Depois lançar S-03 e S-05, e por fim o EPIC-025 (Dolores), etapa 1.

## Atualização — 16/11 — EPIC-025 Dolores, etapa 2 (WhatsApp) — @dev
- **Ramo:** `epic025-dolores-etapa2` (cópia: `claude/wip-epic025-dolores-etapa2`), sobre `origin/main` `3142f6b`. Sem PR.
- **Story:** `docs/stories/epics/epic-025-dolores/E2-whatsapp.md` (InReview). Migração **`0124_dolores_whatsapp.sql`**
  (só tabelas novas) — NÃO aplicada; aplicar antes de publicar (o webhook e a tela leem as tabelas novas; a ponte da
  etapa 1 não depende delas).
- **O que foi feito:** webhook próprio `POST /api/dolores/whatsapp` (segredo HMAC próprio, idempotente, ignora grupo,
  própria e antiga), só o número do dono comanda, laço de ferramentas com a Anthropic pela mesma porta da ponte
  (`executarFuncao`), frases fixas quando a IA não pode rodar, consumo por chamada e limite mensal com aviso uma vez,
  cartão "Dolores" em Integrações (QR code, número do dono, limites, interruptor), rotas `dolores.*` só de admin.
- **Testes (a) automáticos:** ver "Testes executados" na story. **(b) manuais:** nenhum (sem Evolution/Anthropic reais
  aqui). **(c) pendentes em produção:** 0124 no Neon; dono cadastra chave/modelo, limites, número dele e conecta o
  número da Dolores; teste de aceite pelo WhatsApp.
- **Depende do dono:** chip/número da Dolores e o QR code; chave da Anthropic com créditos; limites; ligar a IA.
  Passo a passo: `docs/dolores/como-ligar.md`, seção Etapa 2.
- **Próximo passo exato:** portão de QA da E2; aplicar 0124; publicar; avisar o dono dos passos 2 a 6 da Etapa 2.

## Atualização — 16/11 — EPIC-025 E2: correções do portão de QA (FAIL) — @dev
- **Concluído (ramo `epic025-dolores-etapa2`, cópia `claude/wip-epic025-dolores-etapa2`):** achados 1–9 do QA e o extra,
  um commit por achado (`fix: … [EPIC-025 E2]`), cada um com teste de regressão — tabela completa na story, seção
  "Correções do portão de QA". Achado 1 (bloqueava): número do dono agora conferido com DDI 55 (estrangeiro com os
  mesmos 8 finais não comanda nem recebe resposta).
- **0124 mudou (continua NÃO aplicada, só aditiva/idempotente):** `dolores_mensagens` ganhou `reserva_entrada`,
  `reserva_saida`, `reserva_ate` (também por `ADD COLUMN IF NOT EXISTS`) e há tabela nova `dolores_remetentes_estranhos`.
- **Achado 10 (informativo):** seção "Diferença em relação ao prompt mestre — para o dono confirmar" na story e em
  `docs/dolores/como-ligar.md` (cérebro no servidor em vez do agente no Console; a IA só liga com o interruptor dele).
- **Testes (a) automáticos:** tsc ok; 28 arquivos / 301 testes (comando da story) passando; vite build ok.
  **(b) manuais:** nenhum. **(c) pendentes em produção:** os mesmos da E2 (0124 no Neon, dono cadastra e conecta, aceite).
- **Pendências:** `dolores_mensagens` ainda recebe uma linha por mensagem de número estranho (é a idempotência; o spam
  infla essa tabela, não mais a auditoria); conferir `senderPn`/`remoteJidAlt` e os tipos `protocolMessage`/`editedMessage`
  na Evolution real.
- **Próximo passo exato:** nova rodada do portão de QA da E2 sobre o ramo; aprovado, aplicar 0124 e publicar.

## Atualização — 16/11 — EPIC-025 E2: correções da 2ª rodada do QA (CONCERNS) — @dev
- **Concluído (ramo `epic025-dolores-etapa2`, cópia `claude/wip-epic025-dolores-etapa2`):** N1–N8 e o informativo, um
  commit por achado (N1+N7 juntos), cada um com teste de regressão — tabela na story, seção "Correções da 2ª rodada do QA".
  Principal: filtro de dados pessoais reescrito (CPF/CNPJ com DV em qualquer separação, telefones colados/pontuados,
  e-mail com espaço, disfarces Unicode) e sem mascarar anos/lotes/nota fiscal/área.
- **0124 mudou (continua NÃO aplicada, só aditiva/idempotente):** dois índices parciais em `dolores_mensagens`
  (`…_processando_idx` WHERE situacao='processando'; `…_reserva_idx` WHERE reserva_ate IS NOT NULL). Estranho não grava
  mais linha em `dolores_mensagens`.
- **Testes (a) automáticos:** tsc ok; 28 arquivos / 318 testes passando; vite build ok. **(b) manuais:** nenhum.
  **(c) pendentes em produção:** 0124 no Neon, dono cadastra e conecta, aceite; tipos pin/enquete/botão na Evolution real.
- **Para o dono decidir:** retenção (nenhuma rotina apaga nada; `dolores_remetentes_estranhos` cresce no máximo uma linha
  por remetente estranho por hora, sem texto).
- **Próximo passo exato:** 3ª rodada do portão de QA da E2; aprovado, aplicar 0124 e publicar.

## Atualização — 16/11 — EPIC-025 E2: correções da 3ª rodada do QA (CONCERNS) — @dev
- **Concluído (ramo `epic025-dolores-etapa2`, cópia `claude/wip-epic025-dolores-etapa2`):** R5 `60bb93b` (texto + interação
  é texto), R4 `c2bbb51` (e-mail sem tempo quadrático), R1 `6696919` (casa/unidade/valor… não livram telefone; celular
  antigo de 8 dígitos sai; palavra de telefone anula rótulos), R2 `ad2dbfe` (celular + ",1" sai), R3 `c5d732b` (janela
  deslizante, sem corte de 16 grupos), informativos `4c7fe97` (dígitos de outras escritas, `|`/`/` no telefone, chave de
  NF-e tudo ou nada, nota do 9 do dono em `como-ligar.md`). Tabela na story, seção "Correções da 3ª rodada do QA".
- **0124 NÃO foi alterada.**
- **Testes (a) automáticos:** tsc ok; 28 arquivos / 324 testes passando (dolores+whatsapp+central-vendas+auth+imports+rotas);
  vite build ok; 200 kB patológicos < 1 s (antes ~60 s). **(b) manuais:** nenhum. **(c) produção:** igual à r2.
- **Próximo passo exato:** 4ª rodada do portão de QA da E2; aprovado, publicar (0124 já em aplicação, como está).


## Atualização — 16/11 — EPIC-025 E2: correções da 7ª rodada do QA (CONCERNS, opção B) — @dev
- **Concluído** (ramo `epic025-dolores-etapa2`, cópia em `claude/wip-epic025-dolores-etapa2`): A1 `8fe9b55` (credenciais
  sem "senha"), A6 `566b588` (segredos disfarçados), A5 `d508c17` (PIX/conta disfarçados), A4 `5d6391e` (interruptor falha
  fechado), A3 `ba4a53a` (ponte HTTP mascarada por padrão, `DOLORES_PONTE_DADOS_PESSOAIS`), A2 `08a323b` (links só do
  sistema e do Trello, sem prévia), A7 `e1afff8`+`e1c6717` (nome de função desconhecida com hash), A8 `3c8e941` (comando
  sem segredos ao modelo). Tabela completa na story E2 ("Correções da 7ª rodada").
- **Testes:** (a) automáticos — `tsc` ok; lista pedida do vitest 361 testes em 29 arquivos (1 ajustado ao A7 e repassado);
  `vite build` ok. (b) manuais — nenhum. (c) produção — os mesmos de antes; agora também conferir `PUBLIC_SITE_URL` na
  Vercel (sem ela, links do sistema saem da resposta) e decidir se a ponte precisa de `DOLORES_PONTE_DADOS_PESSOAIS=1`.
- **Pendências:** ver "Em aberto" na seção da 7ª rodada (grafias soletradas de "senha", chave `re_…`, "chave aleatória"
  sem "pix"). Paridade com o Santa Fé: a pendência da Dolores no ROADMAP vale também para estas regras.
- **Próximo passo exato:** 8ª rodada do portão de QA da E2 sobre o ramo; aprovado, publicar.

## Atualização — 16/11 — EPIC-025 E3 (Ações) — @dev
- **Ramo:** `epic025-dolores-etapa3` (base: `epic025-dolores-etapa2` em `bc470d1`, ainda em QA), cópia em
  `claude/wip-epic025-dolores-etapa3`. Story: `docs/stories/epics/epic-025-dolores/E3-acoes.md`.
- **Concluído:** ações `criar_tarefa`/`registrar_acompanhamento` (diretas) e `preparar_cobranca`/`gerar_documento` (fila),
  pela mesma porta `executarFuncao`; fila `dolores_aprovacoes` com decisão por código ("aprovar CÓDIGO") no WhatsApp e na
  tela Integrações › Dolores — fila de aprovação (só admin); autoria em `dolores_autoria`; migração `0125_dolores_fila.sql`
  (aditiva, NÃO aplicada). Docs: `docs/dolores/como-ligar.md` (Etapa 3) e `docs/dolores/agente-etapa3.md`.
- **Testes:** ver a story, seção "Testes executados" (a: automáticos; b: nenhum manual; c: produção pendente).
- **Pendências:** E2 passar no QA e ir para a `main` antes; aplicar 0124 e 0125; validar em produção uma PCI gerada pela
  Dolores (prompt mestre, seção 8) e uma cobrança aprovada; "atualizar etapa de processo" (seção 4.3) não entrou na linha
  da etapa 3 do prompt mestre — fica para decisão do dono.
- **Próximo passo exato:** portão de QA da E3 sobre o ramo (depois do QA da E2); aprovado, rebase sobre a `main` com a E2,
  aplicar 0125 e publicar.

## Atualização — 16/11 — EPIC-025 E3: integração com a Etapa 2 final — @dev
- **Concluído (ramo `epic025-dolores-etapa3`, cópia `claude/wip-epic025-dolores-etapa3`):** merge de
  `epic025-dolores-etapa2` em `2dd8ae9` (`78e29e8`; conflito só neste HANDOFF). Ajuste `668c9e5`: a instrução do quadro de
  pendências dizia "códigos" e o filtro novo de dados pessoais a apagava como senha; testes de integração (número estrito,
  dono fixo, reentrega, temporária/encaminhada/reação/edição, quadros pelo filtro, limite com reserva). Detalhes na story E3,
  seção "Integração com a Etapa 2 final".
- **Testes (a) automáticos:** tsc ok; área 40 arquivos / 471 testes; vite build ok; suíte completa: 235 arquivos, 2.350 testes passando.
  **(b) manuais:** nenhum. **(c) produção:** 0124 e 0125 não aplicadas; aceite pelo WhatsApp.
- **Próximo passo exato:** QA da E2 (4ª rodada) e da E3 sobre este ramo; aprovadas, E2 na `main`, rebase da E3, aplicar
  0125 e publicar.

## Atualização — 16/11 — EPIC-025 E3: correções do portão de QA (FAIL → 9 achados corrigidos) — @dev
- **Concluído (ramo `epic025-dolores-etapa3`, cópia `claude/wip-epic025-dolores-etapa3`):** achado 5 gatilho `09e0a2c`;
  1 (bloqueio: regra de contaminação — depois de ler dados no comando, ação direta vai para a fila marcada "pedido surgido
  durante a leitura de dados"; ações só com intenção do dono) e 8 (código do item repetido) `d6e5466`; 2 e 3 (PCI sem
  regravar o rascunho; PCI gerada nunca vira "não foi executado") `56647cc`; 4 (orçamento de tempo, 1 PCI por mensagem,
  Drive com prazo, prazo da porta) `33c961f`; 6 e 7 (cobrança com lista mudada recusada; dado vira uma linha sem
  colchetes) `66866ad`; 9 (prazo de hoje passado, título, fila em transação) `a0558cb`; docs `6f5134d`. Tabela na story E3,
  seção "Correções do portão de QA". `shared/dolores/sanitizar.ts` não foi tocado.
- **0125 editada (ainda NÃO aplicada):** gatilho mais estrito, continua só aditiva e idempotente.
- **Testes (a) automáticos:** tsc ok; área 26 arquivos / 365 testes; vite build ok; suíte completa 237 arquivos / 2.372
  testes passando. **(b) manuais:** nenhum. **(c) produção:** 0125 e aceite pelo WhatsApp; uma PCI gerada pela Dolores
  conferida (rascunho intacto, cópia no Drive).
- **Próximo passo exato:** nova rodada do portão de QA da E3 sobre `epic025-dolores-etapa3`; aprovada, E2 na `main`,
  rebase da E3, aplicar 0125 e publicar.

## Atualização — 16/11 — EPIC-025 E3: correções da 2ª rodada do QA (CONCERNS → N1–N3 e M1–M6 corrigidos) — @dev
- **Concluído (ramo `epic025-dolores-etapa3`, cópia `claude/wip-epic025-dolores-etapa3`):** N1 texto colado `28d711c`; N2
  retorno das ações sem texto do banco + contaminação ok/erro + nome do perfil ≤ 100 `0bb8914`; N3 o dono lê tudo o que
  aprova (resumo inteiro, recusa se não couber, conferência SHA-256) `b615194`; M4 `b6ba02f`; M5 `ce06cdc`; M1 `4125bb1`;
  M2 `d23fa68`; M3 `01d7c65`; M6 `87c243d`; garantia do gatilho portada `531c6d3`. Tabela na story E3, seção "Correções da
  2ª rodada". `shared/dolores/sanitizar.ts` não foi tocado.
- **0125 editada (ainda NÃO aplicada):** `resumo` varchar(2000), coluna `conferencia` varchar(64) (imutável no gatilho) e,
  para banco com a versão anterior, `ALTER COLUMN "resumo" TYPE varchar(2000)` + `ADD COLUMN IF NOT EXISTS "conferencia"`.
  Continua só aditiva e idempotente.
- **Testes (a) automáticos:** tsc ok; área 35 arquivos / 473 testes; vite build ok; suíte completa 241 arquivos / 2.412
  testes passando. **(b) manuais:** nenhum. **(c) produção:** aplicar 0125; aceite pelo WhatsApp (pedido curto direto;
  e-mail colado → fila marcada; item com descrição mostra o texto inteiro).
- **Próximo passo exato:** 3ª rodada do portão de QA da E3 sobre `epic025-dolores-etapa3`; aprovada, E2 na `main`, rebase
  da E3, aplicar 0125 e publicar.


## Atualização — 16/11 — EPIC-025 E3: integração com a Etapa 2 final (opção B) — @dev
- **Concluído (ramo `epic025-dolores-etapa3`, cópia `claude/wip-epic025-dolores-etapa3`):** merge de
  `epic025-dolores-etapa2` em `ff1477d` (`6538052`; conflitos em `cerebro.ts`, `ponte.ts`, `ponte.test.ts`, HANDOFF e
  ROADMAP, as duas coisas preservadas); ajustes `0be8d46` (texto a gravar com link/segredo recusado — direto e fila —,
  filtro do canal nos quadros e nas respostas das ações, autoria filtrada como registro, R3-M1 `umaLinha`) e testes
  `e2d327f`. Detalhes na story E3, seção "Integração com a Etapa 2 final — opção B". 0125 não mudou.
- **Testes (a) automáticos:** tsc ok; área 52 arquivos / 642 testes; vite build ok; suíte completa SUITE_NUMEROS.
  **(b) manuais:** nenhum. **(c) produção:** 0124 e 0125 não aplicadas; aceite pelo WhatsApp (tarefa com link → recusa
  explicada; tarefa com CPF → gravada com o CPF, opção B).
- **Próximo passo exato:** E2 na `main` (depois do QA dela); rebase da E3 sobre a `main`, aplicar 0125 e publicar.
