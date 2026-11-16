# S-03 — Maquete: PDF que o leitor próprio não lê (leitura híbrida)

Status: Ready for Review — correções do portão de QA de 16/11 (rodadas 1 e 2) feitas (ver "QA — achados e correções"); sem chave real e sem o PDF real escaneado
Epic: EPIC-024 (Fase 4) — correção 03 do dono (16/11/2026)
Paridade: Maquete 3D — exceção já registrada no `ROADMAP.md` (EPIC-022). Não portar.
Tamanho estimado: G
Dependência: S-10 (chave cadastrada em Integrações → Anthropic, isolada em `server/_core/anthropic-painel.ts`).

## Problema

A maquete 8 de produção tem um PDF que passou pelo iLovePDF: uma única imagem JPEG de 7144 × 5012, legível a olho,
sem nenhuma linha vetorial. O leitor próprio (`geometrico.ts`) recusa a página ("A prancha é uma imagem…") e a
montagem falha. Decisão do dono (16/11): "se não houver como garantir a qualidade, faça ler pela IA". Regra da S-10:
o painel da Anthropic não liga a IA em lugar nenhum sozinho; esta story é a opção explícita e autorizada.

## Critérios de aceite
- [x] AC1: roteamento automático por prancha — vetorial vai ao leitor próprio (sem custo); a IA só recebe a prancha
      quando (a) ela é uma imagem ou (b) a leitura própria é objetivamente insuficiente; nunca quando é boa.
- [x] AC2: terceiro modo `motor: "hibrido"`; é o padrão só quando há chave da IA (sem chave, tudo como antes);
      `"geometrico"` (nunca IA) e `"ia"` (sempre IA) continuam selecionáveis em Configurações.
- [x] AC3: chave e modelo: `configuracaoAnthropicPainel()` primeiro (chave + modelo preferencial do painel);
      sem chave no painel, `ENV.anthropicApiKey` + `modeloIA` das configurações. `ENV` nunca é alterado.
- [x] AC4: sem chave nenhuma, o passo para num estado "aguardando" (não é erro) com a mensagem "esta prancha é uma
      imagem e precisa da leitura por IA; cadastre a chave em Integrações → Anthropic (ou envie o PDF exportado do
      programa de desenho)"; pedido, pagamento e passos feitos ficam; a leitura retoma do passo que parou.
- [x] AC5: antes do primeiro uso da IA numa maquete, o administrador vê quantas pranchas irão e confirma uma vez
      (confirmação gravada; vale também para "ler de novo do zero").
- [x] AC6: por passo ficam o motor, o modelo e os tokens devolvidos pela API; o painel mostra "lida pelo leitor
      próprio" / "lida pela IA (modelo X)".
- [x] AC7: teto de pranchas pela IA por maquete (Configurações, padrão 8); o que passa dele fica com o leitor próprio
      e é dito na tela.
- [x] AC8: só a página necessária vai para a IA, cada passo dentro do limite da função; tempo esgotado ou
      sobrecarga viram erro do passo, que pode ser repetido, com mensagem simples.
- [x] AC9: nada inventado — o que a IA lê de uma imagem fica `confirmada: false` salvo cota escrita; sem escala
      legível, pendência pedindo para acertar uma medida conhecida na revisão; a revisão manual com a prancha ao
      fundo continua igual.
- [x] AC10: testes com cliente da IA FALSO; teste de isolamento da chave do painel atualizado para permitir só a
      leitura da maquete.

## Tarefas
- [x] T1: `regras.ts` — modo `hibrido`, `motorEfetivo`, `limitePranchasIA`, passo `prancha_ia`, estado `aguardando`,
      motor/modelo/tokens/envio por passo, `confirmacaoIA` e `foraDoLimiteIA` no estado da leitura.
- [x] T2: `base.ts` — `resolverCredencialIA` (painel → ambiente), `modeloDaLeitura`, anexos (imagem / PDF de uma
      página), prazo do passo, mensagens de sobrecarga e de conexão; dependência injetável `credencialIA`.
- [x] T3: `pdf-pagina.ts` (novo) — extrai o JPEG da página sem biblioteca nova e monta um PDF de uma página.
- [x] T4: `leitura.ts` — `motivoParaIA`, `passoPrancha` (agenda a IA antes da montagem), `passoPranchaIA`,
      `plantasDaIA`, `anexoDaPagina`, `confirmarIA`, `pularIA`; confirmação mantida ao reler.
- [x] T5: `geometrico.ts` — `diagnostico.tituloDePlanta` (só informação; a leitura não muda).
- [x] T6: router — `config` com o motor efetivo e a origem da chave; `detalhe` com motor/modelo/tokens por passo e
      o resumo da IA; `avancarLeitura` devolve `aguardando`; `confirmarIA` (só admin) e `pularIA`.
- [x] T7: tela — três modos e o teto em Configurações; no painel da leitura, quem leu cada prancha, o aviso de
      espera com "Confirmar e ler N prancha(s) pela IA" (admin) e "Continuar sem a IA".
- [x] T8: testes (`server/maquete-3d-hibrida.test.ts`, 11) e o teste de isolamento da chave.
- [ ] T9: conferência com chave real e com o PDF real da maquete 8 (depende do dono cadastrar a chave).

## Critérios de envio à IA (documentados no código, `motivoParaIA`)
- (a) **imagem**: menos de 40 traços vetoriais e uma imagem cobrindo ≥ 25 % da página.
- (b) **insuficiente**: página com título de planta baixa/layout e nenhuma planta lida; TODAS as plantas lidas com o
  aviso de leitura parcial (tempo ou limite de quantidade); ou nenhuma planta com cômodo nomeado.
- Nunca: leitura própria com ao menos uma planta inteira com cômodos nomeados; folha de implantação/urbanismo; página
  sem desenho. Modo `geometrico`: nunca. Modo `ia`: toda prancha com desenho (o fluxo antigo por inventário continua
  no modo `ia` da leitura principal).

## Envio da página e limites
O SDK instalado (`@anthropic-ai/sdk` 0.106.0) não traz limites de tamanho nos tipos (`Base64ImageSource` aceita
jpeg/png/gif/webp; `Base64PDFSource` só `application/pdf`). Foram usados os limites publicados da API, conservadores:
imagem até 5 MB depois do base64 (3,75 MB de JPEG) e 8000 px de lado; PDF até 100 páginas e 22 MB (`MAX_BYTES_DOCUMENTOS`,
que fica abaixo do teto de 32 MB da requisição). Não há `pdf-lib` no projeto e nenhuma dependência nova foi
adicionada. Ordem de envio (`anexoDaPagina`):
1. o JPEG da página (filtro DCTDecode), copiado sem decodificar → bloco `image` (o caso do iLovePDF);
2. JPEG grande demais → um PDF de uma página só com esse JPEG (`pdfDeUmJpeg`) → bloco `document`;
3. sem JPEG extraível (prancha vetorial fraca, JPEG 2000, PNG comprimido, PDF criptografado) → o PDF original com a
   instrução "leia SOMENTE a página N". Custo: a API cobra todas as páginas do PDF enviado; o teto por maquete e a
   confirmação limitam isso. PDF com mais de 100 páginas é recusado com mensagem.

## Dev Notes
- [AUTO-DECISION] Confirmação guardada no estado da leitura (`confirmacaoIA`) e copiada ao "ler de novo do zero" →
  sem migração nesta story (a 0121 é da S-05).
- [AUTO-DECISION] Leitura pela IA é um passo separado (`prancha_ia`), agendado antes da montagem: o leitor próprio
  passa por todas as pranchas primeiro, então a tela já sabe quantas irão para a IA quando pede a confirmação.
- [AUTO-DECISION] "Continuar sem a IA" (`pularIA`) para quem não quer ou não pode cadastrar a chave: a prancha fica
  com o que o leitor próprio leu e a planta pode ser desenhada na revisão.
- [AUTO-DECISION] Sem configuração salva, a tela salva o motor só se o administrador o escolher — salvar preços não
  fixa o padrão.
- A resposta da IA por prancha usa o mesmo formato do leitor próprio (`PlantaLida`); a montagem é a mesma. Planta lida
  pela IA não tem alinhamento automático com o fundo (a revisão permite alinhar à mão).
- Risco: uma prancha muito carregada pode passar dos 52 s do passo com o modelo e o esforço escolhidos; vira erro
  repetível com a orientação de reduzir o esforço.

## Testes
- (a) Automáticos: `npx vitest run server/maquete-3d` — 6 arquivos; `server/maquete-3d-hibrida.test.ts` (11 testes):
  imagem sem chave → aguardando e retoma; com chave → confirmação uma vez, IA chamada uma vez só para a prancha
  escaneada e as vetoriais sem IA; padrão híbrido com chave; modo leitor próprio nunca chama a IA; teto; tempo
  esgotado/sobrecarga repetíveis; seguir sem a IA; critérios; envio (imagem, PDF de uma página, PDF original);
  extração com fluxo de objetos; conversão sem cota; credencial do painel antes do ambiente e `ENV` intacto.
  `server/integracoes-anthropic.test.ts`: só `server/maquete-3d/base.ts` pode usar o acessor do painel.
- (b) Manuais: não feitos (sem navegador nesta sessão).
- (c) Pendentes em produção: chave real cadastrada pelo dono; leitura do PDF real da maquete 8 pela IA (qualidade,
  tempo do passo, tokens).

## QA — achados e correções (portão de 16/11, veredito FAIL → corrigido)
Decisões do líder aplicadas (não reabertas). **AC5 e AC7 foram substituídos pela regra 1 do dono**: a confirmação
vale só para a execução atual e o teto é por maquete, no total (o texto original dos AC fica como histórico).
Testes de regressão em `server/maquete-3d-qa-s03-s05.test.ts` (versões invertidas dos testes adversariais Q1–Q12).

| Achado | Correção | Teste |
|---|---|---|
| 1 (bloqueia) confirmação eterna; teto não era por maquete | `confirmacaoIA` nasce `null` em "ler de novo" e em cada importação; traz `pranchas` autorizadas e `usadas`, e expira ao chegar nelas (`confirmacaoValida`). Contador `maquetes_3d.ia_pranchas_lidas` (0121) soma leituras + importações; acima do teto, o passo espera `aguardando: "teto"` e só passa com `confirmarIA({ alemDoTeto: true })` do admin. A confirmação comum autoriza no máximo o que sobra do teto. | "achado 1: com teto 1 e UMA confirmação, reler 3 vezes e importar 3 vezes não chama a IA de novo"; "achado 1: a confirmação traz o número de pranchas e expira"; hibrida: "teto…", "além do teto…" |
| 2 sem trava contra execução dupla | `execucao-ia.ts`: antes de chamar a IA, `reservarChamada` grava o passo como `executando`, soma +1 na confirmação e no contador, num `UPDATE … WHERE leitura = texto lido [AND ia_pranchas_lidas < teto] RETURNING`. Perdeu a corrida: `ExecucaoConcorrente`, sem chamada. Toda gravação de passo é condicional ao texto lido. Reserva com mais de 75 s vira erro "interrompida" (conta como usada). Erro sem cobrança (conexão, 429, 5xx, 529, chave) devolve a reserva. | "achado 2: dois 'avançar' simultâneos…UMA chamada"; "achado 2: reserva velha…"; hibrida: "tempo esgotado ou IA sobrecarregada…" |
| 3 motor "ia" chamava a IA sem confirmação | `passoAntigoIA`: o fluxo antigo passa pelo mesmo `bloqueioDaIA` (chave → teto → confirmação) e pela mesma reserva; sem chave, espera (não é erro). A chave do painel sozinha nunca liga gasto. `prazoMs` também no fluxo antigo. | "achado 3: motor 'IA em tudo' não chama a IA sem a confirmação"; "achado 3: só cadastrar a chave…"; `maquete-3d.test.ts` (fluxo antigo com `avancarIA`) |
| 5 anexo podia ser só o logotipo; resposta vazia apagava a leitura própria | `pdf-vetorial.ts` mede `coberturaImagem` (fração da página da maior imagem); `anexoDaPagina` só manda a imagem com cobertura ≥ 0,6, senão a página/PDF original. IA sem planta (ou fora do formato): fica a leitura própria com pendência "Ficou o que o leitor próprio leu desta prancha". | "achado 5: prancha escaneada…imagem"; "achado 5: a IA voltou sem planta…"; "achado 5 (Q11): …logotipo" |
| 8 resposta fora do esquema virava erro cru e repetir cobrava | `resposta-ia.ts` (zod): item inválido descartado com pendência; resposta inteira inválida = "A IA devolveu uma resposta fora do formato esperado" (nunca lança). O passo conclui (a chamada foi cobrada); repetir só com confirmação nova. | "achados 8 e 9: resposta fora do formato…"; "achado 8: resposta inteira fora do esquema…"; "achado 8 (Q12)…nunca lança" |
| 9 geometria absurda entrava sem aviso | Filtro: cômodo com < 3 pontos, área < 0,3 m², coordenada > 500 m ou ≥ 60 % por cima de outro; parede < 5 cm; abertura sem parede; escada sem contorno — tudo descartado com pendência visível na revisão. | "achados 8 e 9…"; "achado 9: filtros de geometria…" |
| 4, 6, 7, 10 | Ver S-05 (mesmo ramo; o achado 4 vale também para a leitura principal e o fundo da revisão). | — |

- [AUTO-DECISION] Erros cobrados ou não: timeout e resposta recebida contam como usados (conservador); conexão, 401/403,
  429, 5xx e 529 devolvem a prancha à confirmação e ao contador.
- [AUTO-DECISION] O teto vale também para o fluxo antigo ("IA em tudo"): cada passo é uma chamada paga; o campo do teto
  passa a aparecer para os motores híbrido e IA.
- [AUTO-DECISION] "Seguir sem a IA" com prancha parada no teto registra a frase de sempre em `foraDoLimiteIA`.
- Tela: aviso "teto" com o botão "Autorizar além do teto" (só admin, com confirmação do navegador); passo em curso em
  outra aba aparece como "sendo lida pela IA agora" e o laço da tela para sem chamar de novo.

## QA rodada 2 (16/11, veredito CONCERNS) — achados N1–N7 e correções
Testes de regressão em `server/maquete-3d-qa-s03-s05.test.ts` (blocos "rodada 2"). Commits no ramo `epic024-s03-s05`.

| Achado | Correção | Commit | Teste |
|---|---|---|---|
| N1 (importante) mexer na leitura com um passo "executando" jogava fora a resposta paga | `exigirSemPassoEmCurso` (execucao-ia.ts): `confirmarIA`, `pularIA` e `iniciarLeitura` respondem CONFLICT "Um passo está sendo lido pela IA agora; aguarde terminar" enquanto houver reserva válida; `iniciarLeitura` também exige a leitura conferida na condição do UPDATE. Tela: `ia.emCurso` desabilita confirmar, "Continuar sem a IA" e "Ler de novo do zero". Segunda barreira: `gravarSobreOAtual` aplica o resultado do passo sobre o estado atual quando o mesmo passo ainda tem a mesma reserva. Mensagem da reserva vencida: "foi interrompida antes de terminar". | `6b159b6` | "N1: com um passo da leitura sendo lido pela IA…"; "N1 (segunda barreira)…" |
| N2 mensagens amigáveis nunca apareciam (`e.name` é "Error" no SDK) | `tipoDoErroIA` (base.ts) com `instanceof` das classes do SDK, nome da classe e `status`; `erroSeguro` e `naoCobrado` usam ela. 400/404/413 viram "A IA não aceitou o pedido deste passo (código N)" com o motivo sem a chave. | `c9ffaa1` | "N2: erros reais do SDK viram mensagens amigáveis…"; hibrida "tempo esgotado…" com classes reais |
| N3 `reservadoEm` no futuro prendia o passo | `reservaVencida`: data além de 5 s à frente do relógio = vencida. | `860bc75` | "N3: reserva com data à frente do relógio…" |
| N4 closet na suíte / cozinha em "Sala/Cozinha" descartados | `comodoRepetido` (resposta-ia.ts): só repete com áreas parecidas (≥ 0,7) E mesma função ou nome; cômodo contido em outro fica, com pendência "confira". | `c5cfff5` | "N4: closet dentro da suíte…"; texto do "achados 8 e 9" ajustado |
| N5 planta em centímetros passava como metros | `medidaSuspeita`: área desenhada × escrita (mediana fora de 1/4–4) e lado do pavimento > 80 m viram pendência (com a provável unidade), que fica em aberto e impede validar. | `87c4183` | "N5: planta em centímetros…" (pura) e "N5: … impede validar" (fluxo) |
| N6 rótulo "(depois de cadastrar a chave)" no teto/confirmação | `rotuloContinuarLeitura` (`client/src/components/maquete-3d/rotulos-leitura.ts`). | `a9293b2` | "N6: …só aparece quando o que falta é a chave" |
| N7 folga dos 60 s | `semTempoParaIA`: com menos de 10 s do orçamento (contado do início do pedido, `Execucao.inicio`) não reserva nem chama; o passo fica pendente e a tela chama de novo; após 3 devoluções seguidas, erro claro sem cobrança. `prazoDaIA` conta do início do pedido. | `e38d837` | dois "N7: …" |

- [AUTO-DECISION] N2: conexão caída (`APIConnectionError` sem status) passa a contar como cobrada — a resposta pode ter
  sido gerada antes de a conexão cair; é o lado seguro do teto. Devolvem a reserva só 401, 403, 429, 5xx e 529.
- [AUTO-DECISION] N1: a segunda barreira não se aplica ao inventário do fluxo antigo ("IA em tudo"), que reescreve a
  lista de passos; nele, a primeira barreira (CONFLICT) é a proteção.
- [AUTO-DECISION] N7: limite de 3 devoluções seguidas, para a tela nunca ficar em laço se preparar o PDF for sempre lento.

## File List
- `shared/maquete-3d/regras.ts` — modos, teto, passo `prancha_ia`, estado `aguardando`, confirmação.
- `server/maquete-3d/base.ts` — credencial (painel → ambiente), modelo, anexos, prazo, mensagens.
- `server/maquete-3d/pdf-pagina.ts` (novo) — JPEG da página e PDF de uma página, sem dependência nova.
- `server/maquete-3d/leitura.ts` — roteamento híbrido, passo pela IA, conversão, confirmação, seguir sem a IA.
- `server/maquete-3d/geometrico.ts` — `diagnostico.tituloDePlanta`.
- `server/maquete-3d/router.ts` — config, detalhe, avançar, `confirmarIA`, `pularIA`.
- `server/_core/anthropic-painel.ts` — comentário: único uso autorizado.
- `client/src/pages/admin/AdminMaquete3D.tsx` — Configurações e painel da leitura.
- `server/maquete-3d-hibrida.test.ts` (novo), `server/integracoes-anthropic.test.ts`, `server/maquete-3d.test.ts`.
- Correções do QA: `server/maquete-3d/execucao-ia.ts` (novo), `server/maquete-3d/resposta-ia.ts` (novo),
  `server/maquete-3d/pdf-vetorial.ts`, `server/maquete-3d/leitura.ts`, `server/maquete-3d/router.ts`,
  `shared/maquete-3d/regras.ts`, `client/src/components/maquete-3d/ImportarPlanta.tsx`,
  `server/maquete-3d-qa-s03-s05.test.ts` (novo).
- QA rodada 2: `server/maquete-3d/execucao-ia.ts`, `server/maquete-3d/base.ts`, `server/maquete-3d/resposta-ia.ts`,
  `server/maquete-3d/leitura.ts`, `server/maquete-3d/importacao.ts`, `server/maquete-3d/router.ts`, `shared/maquete-3d/regras.ts`,
  `client/src/pages/admin/AdminMaquete3D.tsx`, `client/src/components/maquete-3d/ImportarPlanta.tsx`,
  `client/src/components/maquete-3d/rotulos-leitura.ts` (novo), `server/maquete-3d-qa-s03-s05.test.ts`, `server/maquete-3d-hibrida.test.ts`.

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 16/11/2026 | @dev (Dex) | Story criada e implementada (YOLO, regra do EPIC-024 de não parar entre etapas) |
| 16/11/2026 | @dev (Dex) | Correções dos achados 1, 2, 3, 5, 8 e 9 do portão de QA, com testes de regressão |
| 16/11/2026 | @dev (Dex) | QA rodada 2: N1–N7 corrigidos, cada um com teste de regressão; pronto para a 3ª revisão |
