# E3 — Ações (tarefas, acompanhamentos, cobranças preparadas, geradores, fila de aprovação)

Status: Done (publicada em 17/11/2026, PR #245; QA aprovado).
Epic: EPIC-025 (Etapa 3) — "Operação Dolores — Prompt Mestre" (16/11/2026), seção 7, linha 3; seções 4.3 e 5
Paridade: suspensa por ordem do dono em 16/11 (Grupo Santa Fé em espera); registrar no ROADMAP ao fechar o epic.
Tamanho estimado: G
Dependência: E2 (WhatsApp, laço de ferramentas, `executarFuncao`) — ramo `epic025-dolores-etapa2` (2ª rodada de QA).

## Problema

Até a etapa 2 a Dolores só lê. O prompt mestre (seção 4.3) quer que ela execute no sistema — criar tarefas com
responsável e prazo, registrar acompanhamentos, preparar cobranças de documentos e acionar os geradores de documentos —
dentro da tabela "Quem aprova o quê" (seção 5): criar tarefa e registrar acompanhamento são diretos, com registro;
mensagem a cliente só com aprovação do dono (e nenhuma categoria foi liberada ainda); o resto vai para uma fila de
aprovação (`dolores_aprovacoes`, seção 6). Teste de aceite (seção 7): "Dolores, identifique quais clientes estão com
documentos pendentes e prepare as cobranças."

## Critérios de aceite
- [x] AC1: funções de AÇÃO pela MESMA porta `executarFuncao` (pausa, usuária ativa, lista fechada, zod com limites,
      vaga do minuto, filtro de dados pessoais, auditoria em `dolores_acoes`); cada função declara o nível — `direto`
      (só o que a seção 5 libera sem aprovação e é reversível) ou `fila` (todo o resto).
- [x] AC2: `criar_tarefa` (direto) — título, responsável (admin/colaborador ativo, pela mesma regra da tela de
      Tarefas), prazo plausível, prioridade e vínculo opcional (cliente do CRM ou obra), pelas funções de serviço da tela.
- [x] AC3: `registrar_acompanhamento` (direto) — anotação/ligação no histórico do cliente do CRM.
- [x] AC4: `preparar_cobranca` (fila) — para cada cliente, a cobrança de documentos é PREPARADA com os documentos
      pendentes reais (mesma regra de `listar_documentos`), texto montado pelo sistema (não pelo modelo), último contato
      e consentimento LGPD do cadastro; aprovada, vira registro no histórico e o texto volta ao dono. Nunca é enviada ao
      cliente nem registra pagamento.
- [x] AC5: `gerar_documento` (fila) — PCI pelo gerador existente (`gerarPciDaObra`), a partir do rascunho salvo pela
      equipe (a Dolores não preenche dado); sai sem assinatura, para o engenheiro responsável conferir.
- [x] AC6: fila de aprovação (`dolores_aprovacoes`): quem pediu (mensagem do dono), o que será feito (função +
      argumentos validados + resumo legível montado pelo sistema), código curto, situação, quem decidiu/quando, resultado,
      vencimento configurável (`dolores_fila_config.validade_horas`).
- [x] AC7: aprovação pelo dono no WhatsApp por regra DETERMINÍSTICA (mensagem inteira = "aprovar CÓDIGO" ou "recusar
      CÓDIGO", só do número do dono, não encaminhada) — nunca pela interpretação do modelo; e pela tela (papel admin).
- [x] AC8: execução só depois da aprovação, revalidando tudo na hora, uma única vez (reivindicação atômica; aprovação
      dupla ou simultânea não executa duas vezes); vencidos não executam; execução interrompida não é refeita.
- [x] AC9: limites fixos impossíveis por qualquer caminho (excluir, editar lançamento confirmado, pagar/baixar/estornar,
      usuários/acessos/credenciais/dados bancários, assinar documento, inventar dado, enviar a cliente/terceiro): lista
      fechada no código, recusa auditada, testes de tentativa.
- [x] AC10: autoria — tudo o que ela cria leva a usuária Dolores e a referência ao pedido/aprovação (`dolores_autoria` +
      `pedido_id` de `dolores_acoes`).
- [x] AC11: injeção — ação só nasce de comando do dono no WhatsApp (a ponte HTTP não executa ações); dado de ferramenta
      não aprova item nem vira destino; testes com dados envenenados.
- [x] AC12: leitura continua em READ ONLY; ações em transação de escrita separada e mínima; teto de ações por comando.
- [x] AC13: IA desligada por padrão (nada muda), 60 s e tetos do laço, ações no mesmo limite mensal, segredos e números
      fora de log/resposta/erro.
- [x] AC14: migração `0125_dolores_fila.sql` aditiva e idempotente; schema no `drizzle.config.ts`; `dolores_acoes` segue
      só de inclusão.
- [x] AC15: rotas/tela da fila só admin por PAPEL, testadas pelo `appRouter` com o caminho completo.

## Tarefas
- [x] T1: levantamento (tarefas, histórico do CRM, documentos pendentes, gerador de PCI, contratos, e-mail).
- [x] T2: regras puras `shared/dolores/fila.ts` (código, decisão do dono, texto da cobrança, prazo, resumo).
- [x] T3: migração `0125_dolores_fila.sql` + `drizzle/schema-dolores-fila.ts` (+ drizzle.config).
- [x] T4: `server/dolores/escrita.ts`, `server/dolores/acoes/*`, `server/dolores/aprovacoes.ts`; ponte (`executarFuncao`
      com ações), permissões (etapa 3), cérebro (ferramentas do WhatsApp), WhatsApp (decisão determinística e quadro de
      pendências), prompt.
- [x] T5: rotas `dolores.fila.*` e a tela `DoloresFilaCard` em Integrações.
- [x] T6: testes (limites fixos, injeção, fila, permissões).
- [x] T7: documentos (`como-ligar.md` Etapa 3, `agente-etapa3.md`), HANDOFF; tsc, testes, build.

## Função → nível → por quê

| Função | Nível | Por quê |
|---|---|---|
| `criar_tarefa` | direto | Seção 5: "Criar tarefa … ninguém aprova; execução direta, com registro". Reversível (a equipe conclui/cancela/edita na tela). |
| `registrar_acompanhamento` | direto | Seção 5: "registrar acompanhamento … execução direta, com registro". Só acrescenta ao histórico. |
| `preparar_cobranca` | fila | Seção 5: "Mensagem ou e-mail para cliente ou terceiro: eu (o dono)". Mesmo aprovada, NÃO é enviada (nenhuma categoria liberada): vira registro no histórico e o texto volta ao dono. |
| `gerar_documento` (`pci`) | fila | Grava arquivo na pasta da obra/cliente e é documento técnico; a tabela da seção 5 não o libera sem aprovação — na dúvida, fila. Sai sem assinatura. |

## File List
- `drizzle/0125_dolores_fila.sql` (novo) — `dolores_aprovacoes` (gatilho: sem exclusão, imutável no "o que", sem reabrir
  encerrado), `dolores_autoria` (só inclusão), `dolores_fila_config` (validade, padrão 48 h). Só tabelas novas.
- `drizzle/schema-dolores-fila.ts` (novo); `drizzle.config.ts` (schema ligado, os anteriores mantidos).
- `shared/dolores/fila.ts` (novo, puro) — código, `lerDecisaoDoDono`, `lerPrazo`, `textoDaCobranca`, quadros.
- `server/dolores/escrita.ts` (novo) — transação de escrita mínima (`bancoDaAcao` lança fora dela).
- `server/dolores/acoes/{comum,tarefas,acompanhamentos,cobrancas,documentos,registro}.ts` (novos).
- `server/dolores/aprovacoes.ts` (novo) — fila: pôr, vencer, decidir (reivindicação atômica), listar, quadros.
- `server/dolores/ponte.ts` — `executarFuncao` com ações (canal do dono, teto por comando, direto/fila, recusa 422),
  `ferramentasDoWhatsapp`; `permissoes.ts` — `ETAPA_ATUAL = 3`, `LIBERADAS_ETAPA_3`, `PROIBIDAS`; `auditoria.ts` — canal
  `tela`; `cerebro.ts` — ferramentas do WhatsApp e `mensagemId`; `whatsapp.ts` — decisão por código e quadros; `prompt.ts`.
- `server/dolores/router.ts` — `dolores.fila.{listar,aprovar,recusar,salvarValidade}` (só admin por papel).
- `server/db.ts` — conexão opcional (padrão `getDb()`, aditivo) em `getProjectById`, `getLeadById`,
  `getAssignableLeadById`, `addLeadActivity`, `getAssignableUsers`, `getAssignableUserById`, `createTask`.
- `client/src/components/admin/DoloresFilaCard.tsx` (novo); `client/src/pages/admin/AdminIntegracoes.tsx`;
  `client/src/components/admin/DoloresCard.tsx` (texto da etapa).
- Testes: `server/dolores/acoes.test.ts`, `acoes-whatsapp.test.ts`, `fila-router.test.ts` (novos); `testes-banco.ts`
  (0125 duas vezes); `ponte.test.ts` e `whatsapp.test.ts` (etapa 3 e motivos novos das recusas).
- Docs: `docs/dolores/como-ligar.md` (seção Etapa 3), `docs/dolores/agente-etapa3.md` (novo),
  `docs/dolores/ferramentas-etapa1.json` (regerado: etapa 3, as mesmas 12 leituras — a ponte HTTP não recebe ações),
  `docs/stories/epics/ROADMAP.md` (paridade, etapa 3), `HANDOFF-16-11-CORRECOES-E-DOLORES.md`.

## Dev Notes
- IDS: REUSE da porta `executarFuncao`, da auditoria, da usuária Dolores, do laço e do webhook da E2; REUSE das funções de
  serviço das telas (`createTask`, `getAssignableUsers/UserById`, `getAssignableLeadById`, `getProjectById`,
  `getLeadById`, `addLeadActivity`) com um parâmetro opcional de conexão (ADAPT mínimo, o padrão continua `getDb()`);
  REUSE de `listarDocumentos` (mesma regra de "pendente") e de `gerarPciDaObra`/`modeloAtualPci`/`errosPci` do gerador;
  CREATE só do que não existia (fila, autoria, transação de escrita, regras puras da decisão).
- [AUTO-DECISION] Quais ações entram → as quatro da linha "3. Ações" do prompt mestre (tarefas, acompanhamentos,
  cobranças preparadas, geradores). "Atualizar a etapa de um processo" (seção 4.3) e "notificar a equipe" não estão na
  linha da etapa 3 → ficaram fora (sem inventar escopo); registrado no HANDOFF para o dono decidir.
- [AUTO-DECISION] Ação só pelo WhatsApp do dono → a ponte HTTP (Claude Console) não tem como provar que o pedido veio do
  dono; continua só de leitura (403 auditado). Atende "uma ação só nasce de comando do dono".
- [AUTO-DECISION] Decisão por WhatsApp → mensagem inteira = verbo exato + códigos (5 caracteres, alfabeto sem ambíguos),
  tratada ANTES da IA (sem custo) e só do número do dono, não encaminhada e sem mídia; frase com qualquer outra coisa vai
  ao modelo, que não tem ferramenta de aprovação. O modelo não recebe os códigos: o quadro com códigos e resumos é anexado
  pelo sistema, lido do banco.
- [AUTO-DECISION] Decisão com a IA desligada → permitida (não chama a Anthropic). Aprovar exige Dolores sem pausa e
  usuária ativa; recusar vale sempre (não faz nada no sistema).
- [AUTO-DECISION] Cobrança aprovada → registro "note" no histórico do cliente dizendo que NÃO foi enviada + o texto
  devolvido ao dono; o envio pela Dolores não existe até o dono liberar categorias. O texto é montado pelo sistema
  (primeiro nome + lista de pendências) para nenhum dado livre entrar na mensagem ao cliente. A preparação mostra o último
  contato registrado e o consentimento LGPD (sem consentimento, prepara e avisa; o envio é que dependerá disso).
- [AUTO-DECISION] Gerador → só a PCI, a partir do rascunho salvo pela equipe (a Dolores não preenche dado); rascunho
  alterado entre o pedido e a aprovação → não gera. O contrato (Jurídico) não entrou: documento jurídico com dados de
  partes, sem rascunho prévio por obra. A geração usa as gravações do próprio gerador (fora da transação mínima); a
  fila garante execução única e a autoria é gravada depois.
- [AUTO-DECISION] Execução de item aprovado: em erro de revalidação o item vai a "erro" (não volta a "aguardando");
  interrompido (> 3 min em "executando") vira "erro" e não é refeito. Pedido novo = novo item.
- [AUTO-DECISION] Prazo de tarefa só com data → 18:00 de Imperatriz (fim do expediente); plausível = hoje a 366 dias.
- [AUTO-DECISION] Responsável por NOME (o modelo não conhece ids de usuário): exato, senão um único que contenha; ambíguo
  ou fora da equipe ativa → recusa com a lista. Tarefa aberta igual (mesmo título e vínculo) não é duplicada.
- [AUTO-DECISION] Teto de 10 ações por comando (diretas + itens na fila), para injeção não multiplicar registros.
- [AUTO-DECISION] Validade configurável em tabela própria (`dolores_fila_config`), não em `dolores_config`: mudar o
  `select()` de uma tabela da etapa 1 quebraria a ponte antes de a 0125 ser aplicada.
- [AUTO-DECISION] Autoria em tabela própria (`dolores_autoria`) em vez de coluna nova em `tasks`/`lead_activities`:
  nenhuma tabela existente muda; o registro também traz a marca no texto (descrição/autor).
- Não há script `lint` no `package.json`; qualidade por `tsc --noEmit`, testes e `vite build`. CodeRabbit roda por WSL
  (não disponível neste ambiente Linux) — não executado.

## Testes executados
- (a) Automáticos (16/11): `npx tsc --noEmit` sem erros; `npx vitest run server/dolores server/integracoes-anthropic.test.ts
  server/auth-session.test.ts server/imports-esm.test.ts server/api-rotas-producao.test.ts server/admin-workflows.test.ts` —
  16 arquivos, 215 testes passando (novos: `acoes` 23, `acoes-whatsapp` 6, `fila-router` 2); com os do gerador de PCI
  (`pci-gerador`, `pci-gerador-db`) — 18 arquivos, 230 testes; suíte completa `npx vitest run` — 235 arquivos, 2.320
  testes passando; `npx vite build` ok.
- (b) Manuais: nenhum (sem Evolution, Anthropic nem Neon reais neste ambiente).
- (c) Pendentes em produção: aplicar 0124 (E2) e 0125; teste de aceite pelo WhatsApp ("identifique quais clientes estão
  com documentos pendentes e prepare as cobranças") e a aprovação por código; uma PCI gerada pela Dolores conferida no
  histórico e no Drive (prompt mestre, seção 8: validar cada gerador em produção antes de liberar).

## Em aberto
- "Atualizar a etapa de um processo" e "notificar a equipe" (seção 4.3/5) não estão na linha da etapa 3: o dono decide
  em qual etapa entram.
- Envio de cobrança a cliente: só depois de o dono liberar categorias (e aí conferir horário comercial e LGPD no envio).
- Outros geradores (contratos do Jurídico) não ligados: exigem dados de partes e não têm rascunho por obra.

## Integração com a Etapa 2 final
- **Merge** de `epic025-dolores-etapa2` em `2dd8ae9` (rodadas 2 e 3 do QA da E2: filtro de dados pessoais reescrito em
  `shared/dolores/sanitizar.ts`, conferência estrita do número do dono, N3 "outro pedido", N4 comando sem tempo, N5
  `ativarAvisos`, N6 guarda da chave, N8 estranhos sem linha em `dolores_mensagens`, R1–R5) — commit `78e29e8`.
  Conflito textual só no `HANDOFF-16-11-CORRECOES-E-DOLORES.md` (as duas seções mantidas, em ordem: E2 r2, E2 r3, E3).
  `whatsapp.ts`, `cerebro.ts`, `router.ts`, `whatsapp.test.ts` e `como-ligar.md` juntaram sem conflito; prevaleceu o
  código da E2 em tudo o que ela mudou (nada da E2 foi desfeito).
- **Conferência do que a E2 passou a exigir** (testes novos em `acoes-whatsapp.test.ts`, bloco "integração com a Etapa 2
  final", e em `acoes.test.ts`):
  - a decisão "aprovar/recusar CÓDIGO" só é lida depois de `ehNumeroDoDono` (estrita: `55` + DDD + número; fixo com
    igualdade exata) e da reivindicação da linha em `dolores_mensagens` (`ON CONFLICT DO NOTHING`): outro DDI, número sem
    55, outro DDD e celular com os mesmos 8 finais de um dono fixo não aprovam; reentrega/avisos paralelos da mesma
    decisão executam e respondem uma vez só;
  - encaminhada nunca aprova (inclusive dentro de temporária); temporária desembrulhada aprova; reação e edição com
    "aprovar CÓDIGO" ficam em silêncio e não aprovam;
  - **ajuste necessário:** o filtro de dados pessoais trata "código(s) …" como senha e apagava o fim da instrução do
    quadro ("(um ou mais códigos)." → "[senha omitida]"). A frase passou a "(pode pôr vários, separados por espaço)." e o
    código fica antes do resumo em cada linha. Teste com os 1.024 códigos só de dígitos (3/4/7/9) e mistos, em quadros e
    respostas de decisão com datas, horas e números ao redor: o filtro não altera nada;
  - ações contam no limite mensal com a reserva da E2 (consumo gravado, reserva solta no fim; no limite, o pedido de ação
    não chama o modelo nem grava nada); a decisão por código não chama o modelo;
  - guarda da chave (`integracoes-anthropic.test.ts`): continua com o ponto único (`bloqueioAtual`), passando.
- **Testes (16/11, depois do merge):** `npx tsc --noEmit` sem erros; área (`server/dolores`, `integracoes-anthropic`,
  `central-vendas*`, `whatsapp*`, `admin-workflows`, `pci*`, `auth-session`, `imports-esm`, `api-rotas-producao`) —
  40 arquivos, 471 testes passando; `npx vite build` ok; suíte completa `npx vitest run` — 235 arquivos, 2.350 testes passando.

## Integração com a Etapa 2 final — opção B
- **Merge** de `epic025-dolores-etapa2` em `ff1477d` (7ª rodada do QA da E2: filtro em duas fases, interruptor de dados
  pessoais `server/dolores/dados-pessoais.ts` — opção B do dono, CPF/CNPJ/telefone/e-mail liberados para a Dolores no
  WhatsApp —, `filtroDaSaida(canal)`, `campoPessoal`, `ContextoFuncao.canal`, `promptSistemaWhatsapp(mascarar)`, links
  tratados na resposta ao dono, nome de função desconhecida com hash, comando filtrado só de segredos, `FILTRO_DO_REGISTRO`
  no que é gravado) — commit `6538052`.
- **Conflitos e resolução** (as duas coisas preservadas; em segurança, a versão da E2):
  - `cerebro.ts` (imports): prompt por modo da E2 (`promptSistemaWhatsapp(mascararDadosPessoais("whatsapp"))`) + imports
    das ações da E3 (intenção, colagem, contaminação, `ferramentasDoWhatsapp`);
  - `ponte.ts`: `OpcoesExecucao` da E3 (mensagem do dono, contaminação, `semAcoes`, `aoPorNaFila`) com `CanalDolores` vindo
    de `dados-pessoais.ts`; leitura com `{ agora, canal }` e `filtroDaSaida(canal)` da E2;
  - `ponte.test.ts`: o 403 da ação pela ponte (E3) com o nome desconhecido em hash (E2);
  - HANDOFF e ROADMAP: as duas seções mantidas.
- **Ajustes da integração** (commits `0be8d46`, `e2d327f`):
  - `nomeParaRegistro` mantém também os nomes FIXOS das ações e da lista `PROIBIDAS` (sem dado; antes viravam
    "(desconhecida) …" e a auditoria das tentativas de `enviar_mensagem_whatsapp`/`aprovar_item` ficava ilegível);
  - **regra N3 com a E2 (decisão desta integração):** o texto que o dono manda gravar (título, descrição, acompanhamento)
    passa por `textoDoDono` (`server/dolores/acoes/comum.ts`): se a remoção de links (`tratarLinksDaResposta`) ou o filtro de
    saída do WhatsApp (`filtroDaSaida("whatsapp")`) o alterariam, a ação é RECUSADA com explicação ("contém um link…
    reescreva sem o link" / "contém algo que o filtro de segurança esconde… reescreva sem isso") — tanto o item da fila (não
    entra na fila) quanto a ação direta. O resumo inteiro do item (com nomes e documentos do cadastro) passa pela mesma
    conferência em `resumoDaFila`. Nunca se grava algo diferente do mostrado; antes, um link de terceiro no texto chegava ao
    dono como "[link removido]" e seria gravado inteiro;
  - opção B nas ações: `comoMostrado`, os quadros e o texto do modelo junto dos quadros (`anexarQuadros`) usam
    `filtroDaSaida("whatsapp")` (antes, o filtro padrão mascarava o CPF da resposta sempre que havia quadro). Com o
    interruptor desligado (padrão), o CPF/telefone que o dono mandou gravar fica no texto, no resumo e no registro; com
    `DOLORES_MASCARAR_DADOS_PESSOAIS=1`, um texto com dado pessoal é recusado (o filtro o esconderia do dono);
  - respostas das ações ao modelo pelo filtro do canal (`filtroDaSaida("whatsapp")`);
  - `dolores_autoria.descricao` gravada com `FILTRO_DO_REGISTRO` (é registro: dados pessoais sempre mascarados);
  - prompt: mais uma linha nas instruções de ações ("texto a gravar sem links e sem senha…").
- **O que fica guardado em claro e por quê:** na fila (`dolores_aprovacoes.resumo` e `argumentos`) e no próprio registro
  criado (tarefa, acompanhamento) fica o texto exatamente como o dono mandou gravar — com opção B, inclusive CPF/telefone
  que ele mesmo escreveu. É o conteúdo da ordem: a fila precisa dele para executar o que o dono leu (a conferência SHA-256
  liga resumo e argumentos), e mascarar o argumento gravaria outra coisa. Senhas, chaves, dados bancários e links de
  terceiros nunca chegam lá (a ação é recusada antes). Fica SEMPRE filtrado com `FILTRO_DO_REGISTRO`: a auditoria
  `dolores_acoes` (argumentos, resumo, motivo), o comando guardado em `dolores_mensagens`, `dolores_autoria.descricao`,
  logs e mensagens de erro.
- **Conferido (testes):** quadros e respostas da decisão saem pela remoção de links e pelo filtro sem estragar o código de 5
  caracteres, o resumo nem a instrução final (`- [CÓDIGO] resumo` com CPF liberado e `Responda só "aprovar CÓDIGO"…` intactos; o
  quadro "Registrado no sistema por mim" intacto ao lado de um texto do modelo com senha e link de terceiro, que saem); item com link/segredo não entra na fila; ação direta com link é
  recusada; ponte HTTP continua 403 para ações e com dados mascarados por padrão (`DOLORES_PONTE_DADOS_PESSOAIS`); prompt
  nos dois modos com a seção de ações.
- **R3-M1** (`shared/dolores/fila.ts`, `umaLinha`): somem também U+00AD, U+034F, U+061C, U+115F, U+1160, U+180E,
  U+2066–U+2069, U+3164, U+2800, U+FFA0, U+FE00–U+FE0F e U+E0000–U+E007F (`new RegExp` com flag `u`; sem virar espaço, para
  não partir palavras). Teste em `correcoes-e3-r2.test.ts`.
- **0125:** não mudou.
- **Testes (16/11):** `npx tsc --noEmit` sem erros; área — 52 arquivos, 642 testes passando; `npx vite build` ok; suíte
  completa — 242 arquivos, 2.453 testes passando.

## Correções do portão de QA (Quinn, 16/11 — FAIL: 1 bloqueio, 3 importantes, 5 menores)
Cada achado tem teste de regressão = versão INVERTIDA do ataque do QA (`server/dolores/correcoes-e3.test.ts`,
`server/dolores/correcoes-e3-whatsapp.test.ts`; PCI em `server/pci-gerador-db.test.ts`).

| Achado | Correção | Commit | Teste |
|---|---|---|---|
| 1 BLOQUEIA (A8) dado de terceiro induz ação direta | Regra de CONTAMINAÇÃO em código: marca `contamina` por função (todas as leituras; na dúvida, contamina); depois do 1º resultado que contamina, `criar_tarefa`/`registrar_acompanhamento` vão para a FILA com "Pedido surgido durante a leitura de dados; confira antes de aprovar: …"; reforço: ferramentas de ação só com intenção de ação reconhecida por código (`intencaoDeAcao`), senão a porta recusa (403 auditado) | `d6e5466` | A8 invertido; ação antes da leitura (direta); ação depois da leitura (fila → aprovar grava); veneno + intenção para outra coisa (fila marcada, recusar não grava); porta `contaminado`/`semAcoes` |
| 2 PCI regrava o rascunho | `gerarPciDaObra(..., { regravarRascunho: false })` — a tela continua igual | `56647cc` | `pci-gerador-db`: rascunho intacto (form, autor, data) e a tela ainda regrava; `acoes.test` |
| 3 (A2) PCI existe e o dono lê "não foi executado" | Depois do gerador, nenhuma falha vira erro: autoria com 2 tentativas; falhou → item "executada" com `pciGeradaId`/`autoriaRegistrada: false` e texto "FOI gerada em …, mas não consegui registrar a autoria; confira"; falha ao gravar o resultado na fila → texto "FEITO, mas não consegui registrar…" | `56647cc` | A2 invertido; falha só na 1ª tentativa |
| 4 (A3) sem orçamento de tempo | Mínimo por função para começar (PCI 30 s; demais 6 s); 1 PCI por mensagem de decisão; cópias ao Drive com `AbortSignal` (`comPrazoNoDrive`) dentro do orçamento; ação direta/preparo com o prazo da porta (`comPrazo`, `SET LOCAL statement_timeout` e `bancoDaAcao()` que recusa depois do prazo → transação desfeita; 504 honesto); falha no meio da decisão não apaga o que já foi feito | `33c961f` | A3 invertido (7 s: PCI não começa; cobrança sim); 31 s: 1 PCI, a 2ª aguarda, Drive 12,5 s; ação direta lenta → 504, nada gravado |
| 5 (A1) gatilho | 0125: `vence_em`, `resumo`, `pedido_id`, `autor_user_id` imutáveis; aguardando só → executando/recusada/vencida; decisão gravada uma vez; `resultado`/`executado_em` só ao encerrar a execução | `09e0a2c` | A1 invertido (+ transição legítima continua valendo) |
| 6 (A4) cobrança registra outra lista | Lista mudou entre pedido e aprovação → recusa "peça de novo" | `66866ad` | A4 invertido; lista igual registra o texto aprovado |
| 7 (A6) quebra de linha forja "[CÓDIGO]" | `textoDeDado`: uma linha, sem controle/invisíveis, colchetes → parênteses; aplicado ao gravar o resumo, nos quadros, nas frases e no texto da cobrança | `66866ad` | A6 invertido (exatamente 1 linha "- ["); quadro/frases/cobrança com dado forjado |
| 8 (A9) pedido repetido sem código | A porta devolve ao laço (fora do modelo) os códigos criados/já aguardando; o quadro mostra os dois | `d6e5466` | A9 invertido |
| 9 bordas (A5) | Prazo "hoje" já passado recusado; título: uma linha, sem controle, até 150 caracteres (HTML fica texto); `porNaFila` numa transação (falhou um item, nenhum fica) | `a0558cb` | A5 invertido; título; falha no 2º item da fila |

Também: `docs/dolores/como-ligar.md` (regra explicada ao dono: depois de ler anotações/históricos, a Dolores sempre pede
aprovação antes de agir) e `agente-etapa3.md` — `6f5134d`. `shared/dolores/sanitizar.ts` não foi tocado.
Arquivos: `drizzle/0125_dolores_fila.sql`, `shared/dolores/fila.ts`, `server/dolores/{funcoes,ponte,cerebro,aprovacoes,
escrita,prompt,whatsapp}.ts`, `server/dolores/acoes/{comum,registro,tarefas,acompanhamentos,cobrancas,documentos}.ts`,
`server/pci-gerador.ts`, `server/drive-documents.ts`, `server/drive-organizacao.ts`; testes novos `correcoes-e3*.test.ts`.

**Testes (16/11, depois das correções):** (a) automáticos — `npx tsc --noEmit` sem erros; `npx vitest run server/dolores
server/integracoes-anthropic.test.ts server/admin-workflows*.test.ts server/pci*.test.ts server/auth-session.test.ts
server/imports-esm.test.ts server/api-rotas-producao.test.ts` — 26 arquivos, 365 testes passando (novos: `correcoes-e3` 16,
`correcoes-e3-whatsapp` 5, `pci-gerador-db` +1); `npx vite build` ok; suíte completa `npx vitest run` — 237 arquivos,
2.372 testes passando. Ataques do QA: A1, A2, A3, A4, A5 (prazo), A8 e A9 passam a FALHAR (defeitos corrigidos); as
garantias (teto, A7, A10) seguem passando. (b) manuais: nenhum. (c) produção: aplicar 0125 (ainda NÃO aplicada) e o aceite.

## Correções da 2ª rodada do portão de QA (Quinn, 16/11 — CONCERNS: 3 importantes, 6 menores; segurança como prioridade)
Cada achado tem teste de regressão = versão INVERTIDA do ataque do QA (`server/dolores/correcoes-e3-r2.test.ts`,
`server/dolores/correcoes-e3-r2-whatsapp.test.ts`, `server/drive-pci-gerada-adotar.test.ts`,
`server/google-drive-oauth-prazo.test.ts`).

| Achado | Correção | Commit | Teste |
|---|---|---|---|
| N1 texto de terceiro colado libera ação direta | `intencaoDeAcao` só no trecho do dono (`trechoDoDono`: até a 1ª quebra de linha, aspas, ">", "---", dois-pontos que não seja de hora; máx. 200 caracteres); mensagem com cara de colagem (`pareceColagem`: >3 linhas, >300 caracteres, ">", "De:/Assunto:/Enviado:", separador, aspas com bloco de 40+, dois-pontos com bloco, parágrafo novo) nasce contaminada — toda ação vai para a fila com "Pedido feito em mensagem com texto colado ou citado; confira antes de aprovar:" | `28d711c` | R2-N1 invertido (e-mail colado em várias linhas e numa linha só: ações nem oferecidas, nada gravado); ação pedida + texto colado → fila marcada; >300 caracteres → fila; pedido curto direto → executa; casos de `trechoDoDono`/`pareceColagem` |
| N2 retorno das ações traz texto do banco | `criar_tarefa` devolve `responsavelId` (sem nome); a porta marca `contamina` em cada resposta (ok OU erro): leitura ok, item na fila, recusa com texto do banco (`RecusaAcao(..., { comDados: true })` — nomes da equipe cortados em 60, erros do rascunho/gerador da PCI); `user.updateProfile`: nome ≤ 100 caracteres e uma linha (zod; dados existentes intactos) | `0bb8914` | R2-N2 invertido (nome injetado não volta ao modelo; 422 com nomes contamina → ação seguinte na fila); contamina por tipo de resposta; `updateProfile` |
| N3 o dono aprova texto que não leu | Resumo com TODO o texto gravado (título, descrição, texto, responsável conferido, prazo, prioridade, vínculo, todos os documentos da cobrança), ≤ 1.500 (`resumoDaFila`); não cabe → recusa "Texto longo demais para aprovar pelo WhatsApp…"; argumentos guardados na forma mostrada (`comoMostrado`); coluna `conferencia` (SHA-256 de função + resumo + argumentos) conferida na execução; a execução confere cada texto gravado contra o resumo lido (`conferirMostrado`); quadro mostra o resumo inteiro; 0125: `resumo` varchar(2000) + `conferencia` | `b615194` | R2-N3 invertido (descrição com link aparece e é gravada igual; fim do texto de 1.000 aparece); texto que cresce no filtro → recusa; argumentos trocados por fora (gatilho desligado) → nada feito; conferência imutável; cobrança com todos os documentos / lista longa recusada; dado pessoal guardado na forma mostrada |
| M4 identidade de `criar_tarefa` na fila | Alvo = todo o conteúdo (título, responsável conferido, prazo, prioridade, vínculo, descrição) | `b6ba02f` | pedido com outra descrição/prazo/prioridade = item novo; o mesmo pedido devolve o código do que aguarda |
| M5 quadro cortado | `quadroDePendencias`/`quadroDoQueFoiFeito` com limite: itens inteiros enquanto couberem, "e mais N item(ns) aguardando — veja a fila em Integrações › Dolores", instrução sempre no fim; `anexarQuadros` mede já filtrado | `ce06cdc` | 12 itens longos (função pura) e 9 itens pelo WhatsApp: ≤ 3.800, sem "Resposta cortada", instrução no fim |
| M1 PCI gerada duplicada no Drive | Fonte `pci_gerada_*` com `adotarPrefixo` (nome sem extensão) + MD5 no organizador | `4125bb1` | organizador adota o arquivo já enviado, sem upload |
| M2 token OAuth sem prazo | `tokenOAuth(forcar, sinal?)` e `accessToken` passa o sinal do `comPrazoNoDrive`; sem sinal, igual | `d23fa68` | token cancelado no prazo; sem sinal, sem `signal` |
| M3 aprovação pela tela sem orçamento | `decisorDaTela` (42 s, mesmo mínimo por função e Drive no que sobra) | `01d7c65` | sem 30 s a PCI não começa pela tela; Drive com 15 s / 13 s conforme o que resta |
| M6 prazo da ação direta x commit | A porta espera a transação (prazo interno = metade do da porta): COMMIT = "feito", desfeita = "passou do prazo e foi desfeita: nada foi gravado"; "confira no sistema" só se o banco não responder em prazo + 2 s | `87c243d` | no prazo → feito; atrasada → desfeita, nada gravado; banco travado → último recurso; `foiPrazoDaTransacao` (57014) |

Também: a GARANTIA do gatilho da 0125 (QA R2 B4) foi portada para a suíte com resumo que mostra o texto (`531c6d3`) — a
versão do QA usa resumo "resumo" e agora, corretamente, não executa (o resumo não mostra o texto). `shared/dolores/sanitizar.ts`
não foi tocado.

**Testes (16/11, depois das correções da R2):** (a) automáticos — `npx tsc --noEmit` sem erros; `npx vitest run server/dolores
server/integracoes-anthropic.test.ts server/admin-workflows*.test.ts server/pci*.test.ts server/drive*.test.ts
server/google-drive*.test.ts server/auth-session.test.ts server/imports-esm.test.ts server/api-rotas-producao.test.ts` — 35
arquivos, 473 testes passando (novos: `correcoes-e3-r2` 23, `correcoes-e3-r2-whatsapp` 11, `drive-pci-gerada-adotar` 3,
`google-drive-oauth-prazo` 3); `npx vite build` ok; suíte completa `npx vitest run` — 241 arquivos, 2.412 testes passando.
Ataques do QA (`novos/`): R2-N1, R2-N2 (×2) e R2-N3 (×2) passam a FALHAR (defeitos corrigidos); as garantias de memória
entre comandos, leitura+ação na mesma volta, A6 e intenção seguem passando; a garantia do gatilho foi portada (ver acima).
(b) manuais: nenhum. (c) produção: aplicar a 0125 (ainda NÃO aplicada) e o aceite pelo WhatsApp.

**SQL alterado na 0125 (ainda NÃO aplicada; só aditiva e idempotente):** `"resumo" varchar(2000)` (era 600) e coluna nova
`"conferencia" varchar(64)` no CREATE TABLE; para banco que já tenha a versão anterior, `ALTER TABLE "dolores_aprovacoes"
ALTER COLUMN "resumo" TYPE varchar(2000)` (só aumenta, sem reescrever dados) e `ADD COLUMN IF NOT EXISTS "conferencia"`;
gatilho: `conferencia` imutável como os demais campos do que será feito.

## Change Log
- 16/11/2026 — @dev (Dex): story criada (Draft → InProgress), critérios tirados do prompt mestre (seções 4.3, 5, 6, 7).
- 16/11/2026 — @dev (Dex): InProgress → InReview (implementação, testes e documentos concluídos; aguarda portão de QA).
- 16/11/2026 — @dev (Dex): merge da E2 final (2dd8ae9) e ajuste do quadro de pendências ao filtro novo; continua InReview.
- 16/11/2026 — @dev (Dex): correções do portão de QA (9 achados, um commit por achado) com regressões; volta a InReview para nova rodada do QA.
- 16/11/2026 — @dev (Dex): correções da 2ª rodada do QA (N1–N3, M1–M6, um commit por achado) com regressões; volta a InReview.
- 16/11/2026 — @dev (Dex): merge da E2 final (ff1477d, opção B) com a regra N3 (texto com link/segredo recusado) e R3-M1; continua InReview.
