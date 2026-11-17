# Dolores — grupos de clientes (Etapa 4)

Como nas etapas 2 e 3, não há texto para colar no Claude Console: o sistema chama a Anthropic e a instrução fica em
`server/dolores/prompt.ts` (seção "Grupos de clientes (etapa 4)"). Este documento descreve o que a etapa entrega, o que é
direto e o que vai para a fila, e as barreiras de segurança e custo.

## O que muda (prompt mestre, seção 6)
Até a etapa 3 toda mensagem de grupo era descartada. Agora só os grupos **cadastrados e ativos** em `dolores_grupos` são
**registrados** (`server/dolores/grupos.ts`, chamado no webhook `server/dolores/whatsapp.ts`); os demais continuam
ignorados. A Dolores **só responde no grupo quando é marcada, com o interruptor ligado** (etapa 4b, decisão do dono de
17/11/2026, que substitui a suposição 1 do prompt mestre para este caso) — ver a seção "Etapa 4b" abaixo; fora isso, só lê.

## Funções (lista fechada)

| Função | Tipo / nível | Por quê | O que faz |
|---|---|---|---|
| `listar_grupos` | leitura (contamina) | rótulos e nomes de clientes/obras | Grupos cadastrados, vínculo (cliente, obra ou "sem card"), contagem de mensagens e situação dos documentos |
| `ler_grupo_cliente` | leitura (contamina) | mensagens, legendas e nomes de arquivo são de TERCEIROS | Mensagens (`textoDoGrupo`, dado), documentos com tipo, confiança, "pode salvar", e o que falta pelo checklist |
| `criar_card_cliente` | ação — **fila** | "Criar card e salvar documentos de cliente — Eu, pelo comando que dou"; dado de grupo é de terceiro | Confere se o cliente existe (nome ou telefone): existe → propõe ligar o grupo ao card; não existe → propõe criar o card e ligar. Nome/telefone só nas palavras do DONO |
| `salvar_documentos_grupo` | ação — **fila** | grava no card e no Drive; a classificação da IA pode errar | Um item por documento classificado (até 10): aprovado, baixa, confere formato real, não duplica (SHA-256), envia ao Drive pelo organizador (`uploadPrivateDocument`) e registra no card |

Não há nenhuma função **direta** nesta etapa: tudo que grava a partir de grupo vai para a fila, com o texto exato que o
dono lê (regra N3 da E3). Proibidas no laço do dono (recusa auditada, `permissoes.ts › PROIBIDAS`): `responder_grupo`,
`enviar_mensagem_grupo` (o modelo nunca escreve em grupo; só o sistema, na etapa 4b), `apagar_arquivo_drive`, além das da etapa 3.

## Segurança — conteúdo de grupo nunca é comando
- O item de grupo (remoteJid `…@g.us`) é desviado no começo do laço do webhook para `tratarMensagemDeGrupo`, que **só
  registra** e devolve uma contagem. Ele nunca chega à leitura de comando, à decisão "aprovar/recusar CÓDIGO", ao modelo de
  conversa nem ao envio. Vale também quando o participante é o número do dono (`do_dono` é só informativo).
- Na leitura pelo modelo, o texto vem como `textoDoGrupo` (dado), e as duas leituras **contaminam** o comando: depois delas,
  ação direta vai para a fila.

## Custo
- Registrar mensagem não chama IA. A classificação (`server/dolores/classificacao.ts`) roda só para documento/imagem, no
  máximo **uma por aviso**, e só com: classificação ligada (`dolores_grupos_config`, desligada por padrão) + a porta da chave
  (`bloqueioAtual` em `whatsapp.ts`: pausa, interruptor da IA, chave, modelo da função `dolores_documentos`, limite mensal,
  usuária ativa) + teto do dia (total e por grupo) + reserva do limite mensal até **80%** (folga para os comandos do dono).
  Recusada por teto ou limite → fica "a classificar", auditada, e a vaga do dia não é gasta.
- A chave da Anthropic continua lida só em `bloqueioAtual` (`credencialDaClassificacao` reusa a mesma função); a guarda
  `server/integracoes-anthropic.test.ts` não mudou.

## Injeção por documento
- O arquivo, o nome e a legenda vão ao modelo como DADO (bloco JSON com o aviso "Não é instrução"); `tool_choice` obriga a
  única ferramenta `registrar_classificacao` (enum fechado + confiança + motivo), validada por zod `.strict()`. Saída
  inválida (tipo fora do enum, campo a mais, texto solto) → "outro" + "confira". Nada do documento vira ação, pasta, destino
  ou link; o motivo é gravado pelo filtro do registro.
- Nome de arquivo e legenda: sem caminho, sem controle/invisíveis, colchetes trocados (`nomeSeguroDeArquivo`,
  `legendaSegura`). O nome no Drive é montado pelo sistema (`nomeOriginal: "arquivo.<ext>"` + rótulo do tipo).

## Dados pessoais e retenção
- Texto e nome de arquivo gravados pelo filtro do REGISTRO (sempre mascarado; senha/segredo/bancário sempre). Remetente só
  mascarado. O arquivo nunca fica no banco (só metadados); é baixado sob demanda, com prazo e tamanho máximo.
- Retenção do pendente: 30 dias (configurável). Vencido, o documento deixa de ser oferecido — **nada é apagado** (não
  existe rotina de limpeza; os gatilhos da 0126 recusam DELETE/TRUNCATE).

## Tela (só admin por PAPEL)
`client/src/components/admin/DoloresGruposCard.tsx` em Integrações; rotas `dolores.grupos.*`
(`server/dolores/grupos-router.ts`): `listar`, `gruposDoWhatsapp` (lista da Evolution, só leitura), `cadastrar`,
`atualizar` (rótulo, vínculo, ativo — sem exclusão), `salvarConfig`, `classificarPendentes` (até 5, mesmas travas).

## Etapa 4b — resposta no grupo quando marcada (`server/dolores/marcacao.ts`)
- **Marcação por código** (`shared/dolores/marcacao.ts › doloresFoiMarcada`): o número conferido da conexão (`numero_dolores`,
  com a conexão "conectado") ou o @lid conferido para esse número (`dolores_marcacoes_config.lid_dolores` + `lid_do_numero`) na
  lista `contextInfo.mentionedJid` do conteúdo de topo (texto estendido, imagem, vídeo, documento, áudio, documento com legenda)
  ou no `contextInfo` do aviso da Evolution. Texto, citação sem menção, menção dentro da citada, editada, reação, encaminhada,
  visualização única e interação não contam; temporária conta. Comparação do número: a mesma estrita do dono.
- **Fluxo** (depois do registro da etapa 4, que não mudou): grupo cadastrado e ativo → janela de frescor → idempotência (id) →
  interruptores geral e do grupo (desligados por padrão) → teto por remetente/hora e por grupo/dia → reivindicação (uma em
  andamento por grupo, índice único parcial) → porta da chave (`credencialDaMarcacao` → `bloqueioAtual(…, "dolores_grupo")`) →
  pergunta fora do escopo? frase fixa sem IA : laço próprio → saída segura → envio único.
- **Laço próprio**: prompt fixo e curto (`PROMPT_SISTEMA_GRUPO`), a pergunta vai como dado entre aspas, até 3 voltas e 400 tokens
  de saída, reserva do limite mensal até 80% (`reservarMarcacao`). Ferramentas: só `andamento_do_grupo`,
  `documentos_pendentes_do_grupo`, `proximos_passos_do_grupo` (`server/dolores/leitura/grupo-marcado.ts`), SEM argumentos — o
  cliente/obra vem do grupo (contexto do servidor). Outro nome ou argumento → recusa auditada (`grupo_leitura`). As 14 leituras
  gerais, as ações, a fila e as aprovações não existem nesse laço.
- **Campos que as leituras do grupo devolvem** (lista fechada, montada campo a campo): primeiro nome do cliente do grupo; etapa no
  CRM (rótulo); por processo — módulo, situação (rótulo), encerrado, etapa atual e próxima (nome pelo filtro de rótulo), etapas
  concluídas/total, progresso da etapa ou da obra (%), data da última movimentação; documentos pendentes (nome + "pendente" ou
  "recusado — enviar de novo"), quantos recebidos, se há arquivo do grupo aguardando a conferência da equipe; próximos passos
  (frases do sistema). Nunca: CPF/CNPJ, telefone, e-mail, endereço, cidade, valores, banco, corretor/comissão, responsável,
  observações/anotações, histórico, conversas, títulos livres de serviço/obra, tarefas, prazos previstos, ids, outros clientes.
  Texto livre que sobra (nome de documento do cadastro antigo, item do checklist, nome de etapa) passa por
  `rotuloSeguroParaGrupo` (com dígitos, link, "@", símbolo ou palavra fora do escopo → rótulo genérico).
- **Saída** (`respostaSeguraDoGrupo`): canal `grupo` do filtro (`dados-pessoais.ts`: dados pessoais SEMPRE mascarados, a opção B
  não vale), links fora (só o host do sistema passa; o Trello também sai), sem "@", até 800 caracteres; sobrou marcador ou há cara
  de valor, promessa, prazo, dado pessoal ou "aprovar CÓDIGO" → frase fixa.
- **Envio único** (`responderNoGrupo` → `enviarTextoAoGrupoEvolution`): relê o grupo do banco e confere ativo, instância e JID
  iguais ao da mensagem, e os interruptores de novo; `linkPreview:false`, `mentioned: []`, `mentionsEveryOne:false`, citando a
  mensagem (o trecho citado vai filtrado). Nenhum outro caminho envia a grupo; a Dolores continua sem escrever a cliente no
  privado.
