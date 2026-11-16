# S-03 — Maquete: PDF que o leitor próprio não lê (leitura híbrida)

Status: Ready for Review (código, testes e tela; sem chave real e sem o PDF real escaneado)
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

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 16/11/2026 | @dev (Dex) | Story criada e implementada (YOLO, regra do EPIC-024 de não parar entre etapas) |
