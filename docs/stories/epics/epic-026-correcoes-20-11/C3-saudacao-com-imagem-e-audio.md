# C3 — Saudação da campanha com imagem e áudio

Status: InReview (implementada no ramo `epic026-c3`; aguarda portão de QA de segurança).
Epic: EPIC-026 — Correções de 20/11/2026 (`EPIC.md`).
Paridade: a saudação de campanha é da Central WhatsApp (não é exceção) — pendência registrada no ROADMAP (Etapa 9, parte da
Central). Migração ADITIVA `drizzle/0137_saudacao_midia.sql` (NÃO aplicada em produção por esta sessão).

## Pedido do dono (20/11/2026, palavras dele)
"na tela de saudação permita também adicionar imagem e áudio como profissionais além do texto".

## Contexto
A etapa 9 da Dolores (EPIC-025 E9) criou a saudação da campanha: um texto fixo em Central › Templates, UMA campanha ativa por
vez, enviado UMA vez por número a quem escreve e não está cadastrado (`enviarSaudacao` em `server/dolores/roteamento.ts`).

## Critérios de aceite
- [x] AC1: no editor da campanha, além do texto, o administrador anexa UMA imagem (JPG ou PNG, até 5 MB) e/ou UM áudio (OGG/Opus,
      MP3 ou M4A, até 2 minutos e 5 MB), com pré-visualização (imagem na tela, áudio com o tocador), botão "Trocar", botão
      "Remover" (com confirmação) e mensagem de erro em linguagem simples. Campanha nova: depois de "Salvar", o editor continua
      aberto com a campanha criada para anexar.
- [x] AC2: ordem do envio — com imagem: a imagem com o texto como LEGENDA (uma mensagem só); depois o áudio como mensagem de voz.
      Sem imagem: o texto, depois o áudio. Sem mídia: só o texto (igual a antes).
- [x] AC3: falha de mídia nunca impede o texto: se a imagem falhar, o texto sai sozinho; se o texto não sair de jeito nenhum, o
      áudio sozinho não vai (a saudação fica como erro).
- [x] AC4: continua UMA vez por número por campanha (a reivindicação no banco não mudou). O que saiu fica registrado em
      `whatsapp_saudacoes` (`texto_saiu`, `imagem_saiu`, `audio_saiu`; null = a campanha não tinha a parte). Nenhuma parte é
      reenviada depois (imagem saiu e áudio falhou → nada sai de novo para esse número nessa campanha).
- [x] AC5: segurança — só administrador por PAPEL grava, remove e vê a mídia (`soAdmin` de `atendimento-router.ts`; testado pelo
      `appRouter` com colaborador e corretor que têm o módulo); tipo pelos BYTES (assinatura JPG/PNG; Ogg com "OpusHead", MP3 por
      quadros válidos, M4A com faixa de som e sem faixa de vídeo), nunca pela extensão nem pelo tipo declarado; tamanho e duração
      conferidos no servidor (e de novo na hora do envio); nenhuma URL vem do cliente (esquema estrito, o arquivo sobe pelas partes
      do próprio sistema e só as partes do próprio usuário valem); a mídia não tem URL pública — vai à Evolution em base64 dentro do
      pedido; nome do arquivo limpo (sem caminho, sem caracteres estranhos, extensão do tipo real); nenhum nome de arquivo, número
      ou conteúdo em log ou auditoria.
- [x] AC6: limite de corpo — nenhum pedido passa do teto da Vercel (cerca de 4,5 MB): o arquivo sobe em partes de 1 MB
      (`documentChunks.part`, cerca de 1,4 MB por pedido em base64) e a pré-visualização volta em pedaços de 1 MB. Por isso os
      5 MB da imagem e do áudio cabem de verdade.
- [x] AC7: o eco (fromMe) da imagem e do áudio da saudação é reconhecido como mensagem AUTOMÁTICA na Central (não cala a Dolores
      como se fosse a equipe e não duplica a conversa), mesmo chegando antes de o envio gravar o id.
- [x] AC8: a resposta da Dolores a cliente, os avisos de ligação/áudio e a Central não mudam de comportamento.
- [x] AC9: testes vitest (abaixo).

## Decisões
- [AUTO-DECISION] Onde guardar a mídia? → no próprio banco, tabela `whatsapp_campanha_midias` (bytea, CHECK de 5 MB, UMA por
  campanha e tipo). Motivo: o projeto já guarda a mídia do WhatsApp no banco por regra do dono ("sem storage externo",
  `server/whatsapp-midia.ts`); o `storagePut` existente depende do proxy Manus Forge, que não é o padrão das mídias do WhatsApp.
  Reaproveitados: o envio em partes `documentChunks.part` / `readUpload` (já usado pelo logotipo, KML e documentos) e o padrão
  bytea de `schema-incorporacao-logos.ts`. São no máximo 2 arquivos por campanha (até 10 MB por campanha).
- [AUTO-DECISION] Como a Evolution recebe o arquivo? → em base64 dentro do pedido (`/message/sendMedia` com `mediatype: "image"`
  e `caption`; `/message/sendWhatsAppAudio` com `encoding: true`, que converte para OGG/Opus e manda como mensagem de voz). Motivo:
  sem URL pública, nada do sistema fica exposto e não há como a Evolution (ou alguém) buscar outro arquivo.
- [AUTO-DECISION] Formatos de áudio → OGG/Opus, MP3 e M4A (AAC): os que a Evolution converte para mensagem de voz e os que celular
  e computador gravam. WAV ficou de fora (5 MB de WAV dão menos de 30 s).
- Prazo do envio de mídia → 15 s por arquivo (texto continua 8 s); mídia só é tentada com pelo menos 6 s até o fim do prazo do
  aviso (senão: imagem → texto puro; áudio → não vai). Pior caso: imagem 15 s + texto 8 s (só quando a imagem falhou de fato) +
  áudio 15 s = 38 s, dentro dos 45 s do aviso (função de 60 s); cada envio também para no prazo final. (Portão de QA, achado 5b.)
- [AUTO-DECISION] Na Central, a mídia automática aparece com o mesmo rótulo das mídias recebidas ("[imagem] legenda", "[áudio]"),
  sem o arquivo (a Central não tenta baixar). O eco fromMe de imagem/áudio passa a ter esse mesmo texto no roteamento, para casar
  com a linha automática; para mídia que a equipe manda pelo celular nada muda (não há linha automática igual).
- Imagem SEM CONFIRMAÇÃO (o pedido estourou o prazo ou a conexão caiu — pode ter chegado com a legenda): o texto NÃO vai de novo
  e o áudio também não (o dono prefere não duplicar mensagem ao cliente). Só cai para texto puro quando a Evolution RESPONDE com
  erro. Registro: `imagem_saiu` = null (desconhecido), `texto_saiu` = false, `sem_confirmacao` = true, situação "erro" (não conta
  como saudação enviada). Áudio sem confirmação: `audio_saiu` = null e `sem_confirmacao` = true. (Portão de QA, achado 5a.)
- Retorno novo `saudacao-enviada-parcial` (texto saiu, alguma mídia falhou) na contagem de rotas do aviso (só contagem, sem conteúdo).

## Correções do portão de QA de segurança (CONCERNS, 20/11)
- [x] Achado 1 (importante) — eco de mídia: o rótulo genérico ("[áudio]", "[imagem] …") só casa com mídia automática EM ANDAMENTO
      (`status = 'enviando'`), criada há no máximo 30 s (`JANELA_ECO_MIDIA_MS`, relógio do banco); a gravação do id também exige
      "enviando". Fora disso é da EQUIPE e cala a Dolores (na dúvida, lado humano). O eco de TEXTO ficou como antes.
- [x] Achado 2 (médio) — imagem: largura e altura lidas (IHDR no PNG; SOF0/SOF1/SOF2 no JPG), recusa acima de 8 000 px por lado ou
      40 megapixels; estrutura mínima exigida (PNG: IHDR primeiro, blocos encadeados, IDAT e IEND; JPG: segmentos com tamanho,
      SOF, SOS e EOI FF D9); depois do fim só até 64 bytes de zeros (poliglota e arquivo truncado recusados). Efeito colateral
      aceito: foto "com movimento" (vídeo colado depois do JPG) é recusada com mensagem para salvar como JPG comum.
- [x] Achado 3 (médio) — áudio: Ogg percorre todas as páginas encadeadas (sem lixo entre elas), usa a MAIOR posição, exige início
      do fluxo com OpusHead e recusa segundo fluxo (outro número de série ou segundo início); M4A exige mdhd da faixa de som
      concordando com o mvhd (até 1 s ou 5 %), uma faixa de som, nenhuma de vídeo e o mdat; para todos, tamanho/duração até
      64 kB/s (`MAX_BYTES_POR_SEGUNDO_AUDIO`).
- [x] Achado 5 (baixo) — sem duplicata e dentro do tempo (decisões acima). Coluna nova `sem_confirmacao` na mesma 0137 (ainda não
      aplicada).
- Achados 4 (teto de envio em partes por usuário, pré-existente) e 6 (aplicar 0137 antes da publicação): com a sessão principal.

## Tarefas
- [x] Regras puras: `shared/whatsapp/saudacao-midia.ts` (tipo pelos bytes, duração Ogg/MP3/M4A, limites, nome seguro, escopo).
- [x] Migração aditiva `drizzle/0137_saudacao_midia.sql` + schema Drizzle (`whatsappCampanhaMidias`, colunas novas de `whatsappSaudacoes`).
- [x] Evolution: `enviarImagemEvolution` e `enviarAudioEvolution` (`server/_core/evolution.ts`).
- [x] Servidor: `server/dolores/saudacao-midia.ts` (gravar, remover, metadados, pedaço da pré-visualização, mídias conferidas para envio).
- [x] Envio: `enviarAoContato` aceita mídia (`deps.enviarMidia`); `enviarSaudacao` com ordem, queda para texto e registro.
- [x] Router: `salvarMidia`, `removerMidia`, `midiaDaCampanha` (todos `soAdmin`); `status` com os metadados; `criarCampanha` devolve `criadaId`.
- [x] Eco fromMe de imagem/áudio com rótulo (`shared/dolores/roteamento.ts`).
- [x] Tela: `client/src/components/whatsapp/CampanhasEAvisos.tsx`.
- [x] Testes e `npx tsc --noEmit`.
- [x] ROADMAP: pendência de paridade.
- [ ] Portão de QA de segurança (@qa).
- [ ] Aplicar `0137` no Neon de produção (feito pela sessão principal) e conferir na tela publicada com um número de teste.

## Testes
(a) automáticos — `server/dolores/c3-saudacao-midia.test.ts` (22 testes) e `server/dolores/c3-qa-seguranca.test.ts` (17, do portão de QA, com os
"ACHADO" invertidos para "CORRIGIDO"): validação pelos bytes (PNG/JPG, arquivo falso, SVG,
GIF, áudio no lugar da imagem e o contrário), duração de OGG/MP3/M4A, vídeo MP4 recusado, limites de 5 MB e 2 minutos, nome
sanitizado, corpo dos pedidos à Evolution (base64, legenda, `encoding`), permissão por papel pelo `appRouter`, partes de outro
usuário recusadas, URL recusada pelo esquema estrito, gravação/pré-visualização/remoção, ordem do envio (imagem+legenda → áudio;
texto → áudio; só texto), queda para texto quando a imagem falha, idempotência com falha parcial (áudio falhou → nada reenviado),
texto que não sai → áudio não vai, mídia gravada inválida não sai, eco reconhecido como automático.
Suítes `server/dolores` e `server/whatsapp*` inteiras (51 arquivos, em 4 lotes): 878 testes passando, 0 falhas. `npx tsc --noEmit`: sem erros.
(b) manuais — nenhum nesta sessão (sem Evolution real aqui).
(c) pendentes de validação em produção — mandar de um número de teste desconhecido com uma campanha com imagem e áudio e conferir:
a imagem chega com a legenda, o áudio chega como mensagem de voz (bolinha azul do microfone), e a Central mostra as duas como
automáticas. Conferir também o tempo do envio de uma imagem de 5 MB.

## File List
- `shared/whatsapp/saudacao-midia.ts` (novo)
- `drizzle/0137_saudacao_midia.sql` (novo)
- `drizzle/schema-whatsapp-atendimento.ts`
- `server/_core/evolution.ts`
- `server/dolores/saudacao-midia.ts` (novo)
- `server/dolores/roteamento.ts`
- `server/dolores/atendimento-router.ts`
- `shared/dolores/roteamento.ts`
- `server/dolores/testes-banco.ts`
- `server/dolores/c3-saudacao-midia.test.ts` (novo)
- `server/dolores/c3-qa-seguranca.test.ts` (do portão de QA; expectativas invertidas e exemplos com estrutura válida)
- `client/src/components/whatsapp/CampanhasEAvisos.tsx`
- `docs/stories/epics/ROADMAP.md`

## Change Log
- 20/11/2026 — @dev (Dex): Draft → InProgress → InReview. Implementação completa; aguarda portão de QA.
- 20/11/2026 — @dev (Dex): correções dos achados 1, 2, 3 e 5 do portão de QA de segurança; volta para InReview.
