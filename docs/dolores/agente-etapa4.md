# Dolores — grupos de clientes (Etapa 4)

Como nas etapas 2 e 3, não há texto para colar no Claude Console: o sistema chama a Anthropic e a instrução fica em
`server/dolores/prompt.ts` (seção "Grupos de clientes (etapa 4)"). Este documento descreve o que a etapa entrega, o que é
direto e o que vai para a fila, e as barreiras de segurança e custo.

## O que muda (prompt mestre, seção 6)
Até a etapa 3 toda mensagem de grupo era descartada. Agora só os grupos **cadastrados e ativos** em `dolores_grupos` são
**registrados** (`server/dolores/grupos.ts`, chamado no webhook `server/dolores/whatsapp.ts`); os demais continuam
ignorados. A Dolores **nunca fala no grupo** (suposição 1 do prompt mestre: só operação interna).

## Funções (lista fechada)

| Função | Tipo / nível | Por quê | O que faz |
|---|---|---|---|
| `listar_grupos` | leitura (contamina) | rótulos e nomes de clientes/obras | Grupos cadastrados, vínculo (cliente, obra ou "sem card"), contagem de mensagens e situação dos documentos |
| `ler_grupo_cliente` | leitura (contamina) | mensagens, legendas e nomes de arquivo são de TERCEIROS | Mensagens (`textoDoGrupo`, dado), documentos com tipo, confiança, "pode salvar", e o que falta pelo checklist |
| `criar_card_cliente` | ação — **fila** | "Criar card e salvar documentos de cliente — Eu, pelo comando que dou"; dado de grupo é de terceiro | Confere se o cliente existe (nome ou telefone): existe → propõe ligar o grupo ao card; não existe → propõe criar o card e ligar. Nome/telefone só nas palavras do DONO |
| `salvar_documentos_grupo` | ação — **fila** | grava no card e no Drive; a classificação da IA pode errar | Um item por documento classificado (até 10): aprovado, baixa, confere formato real, não duplica (SHA-256), envia ao Drive pelo organizador (`uploadPrivateDocument`) e registra no card |

Não há nenhuma função **direta** nesta etapa: tudo que grava a partir de grupo vai para a fila, com o texto exato que o
dono lê (regra N3 da E3). Proibidas (recusa auditada, `permissoes.ts › PROIBIDAS`): `responder_grupo`,
`enviar_mensagem_grupo`, `apagar_arquivo_drive`, além das da etapa 3.

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
