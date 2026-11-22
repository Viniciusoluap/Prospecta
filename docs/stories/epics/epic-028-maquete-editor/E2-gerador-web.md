# E2 — Gerador web: cena 3D e planta 2D a partir do JSON-fonte

Status: InReview (Etapa 2 implementada em 21/11/2026; aguarda portão de QA e a revisão do dono)
Epic: EPIC-028 — Maquete fiel à planta com editor de itens (`ETAPA-0-PLANO.md`)
Paridade: Maquete 3D é exceção registrada no `docs/stories/epics/ROADMAP.md` (EPIC-022): nada a portar ao Grupo Santa Fé.
Tamanho: M/G. Sem banco, sem migração. Custo zero: nenhuma IA, nenhuma API paga, nenhuma dependência nova; texturas
desenhadas em canvas; nada da Higgsfield.
Branch: `feat/maquete-3d-editor` (commits locais, sem push).

## Objetivo
Gerar no navegador, a partir de `data/plantas/lote4-qd18.json`, a maquete fiel à estrutura do JSON (paredes com
recortes reais, esquadrias com caixilho e vidro, soleiras, piso por ambiente, telhado liga/desliga) em qualidade alta,
com três modos — visão geral em corte, tour por cômodo (olhos a 1,60 m do piso) e planta 2D com cotas — e uma página de
prévia sem banco para o dono ver e para as capturas.

## Critérios de aceite
- [x] AC1 Conversor puro (`shared/maquete-3d/fonte-cena.ts`): JSON-fonte como nova origem do `ModeloMaquete`
      (`fonteParaModelo`) e `pecasDaFonte` (itens → peças do catálogo); os itens SUBSTITUEM a mobília automática
      (`pecasDoPavimento` em `mobilia.ts`, usado por `Mobilia.tsx`/`Visualizador.tsx` via prop `itens`); maquete sem
      itens continua igual. `cenaDaFonte` monta a cena detalhada.
- [x] AC2 Paredes com recortes reais (peitoril e verga, base e altura de cada parede), muros, níveis (interno +0,40,
      externo +0,35, banheiro +0,39, garagem +0,20), soleiras (no nível do piso mais alto dos dois lados) e
      pingadeiras de granito nas janelas; encontros em L/T sem faces sobrepostas.
- [x] AC3 Esquadrias com caixilho e vidro: J1 de correr 4 folhas (dois trilhos), P1 pivotante, P2 de correr em vidro
      (2 folhas), P3/P4 de abrir com batente e folha desenhada aberta a 90° para o lado do giro, PT1 portão gradeado.
- [x] AC4 Piso por ambiente com texturas procedurais distintas: porcelanato (interno), cerâmica (banheiro), cimentado
      (serviço e varanda), concreto (garagem), grama (quintal), calçada e asfalto; acabamento trocável no JSON.
- [x] AC5 Telhado liga/desliga: fibrocimento ondulado em duas águas com a inclinação do JSON, platibanda com rufo,
      calhas nas bordas baixas, forro de gesso só na parte coberta (serviço e varanda ficam descobertas, `interno: false`).
- [x] AC6 Balcão americano no catálogo procedural (corpo de alvenaria nas costas + tampo de pedra em balanço para a
      sala com mãos-francesas); os demais tipos do JSON usam o catálogo existente (35 tipos desenhados).
- [x] AC7 Visual: `ACESFilmicToneMapping`, `RoomEnvironment` do three gerado localmente (PMREM, sem HDR de CDN),
      sombras suaves (PCF com raio), uma luz por cômodo coberto, exposição contida.
- [x] AC8 Modos: visão geral em corte (sem telhado, topo das paredes em cinza de corte e rótulos dos cômodos); tour
      por cômodo com botões, câmera a 1,60 m do piso do cômodo e transição suave (instantânea com
      `prefers-reduced-motion`); planta 2D com cotas em SVG gerada do MESMO JSON.
- [x] AC9 Leve no celular: pixel ratio ≤ 2, geometria mesclada (uma chamada por material), quadros sob demanda, 3D em
      chunk `lazy` (o celular abre na planta e só baixa o 3D ao escolher uma vista), alvos de toque ≥ 44 px.
- [x] AC10 Página de prévia sem banco `/maquete-demo/lote4-qd18` (não é a rota pública do lote; `noindex`).
- [x] AC11 Capturas Playwright em computador (1440 × 900, escala 2) e celular (390 × 844, escala 2), conferidas.
- [x] AC12 Testes vitest do conversor e da planta 2D; testes existentes da maquete verdes.

## Decisões
- [AUTO-DECISION] Cena nova (`CenaFonte.tsx`) ao lado do `Casa.tsx` em vez de estender o `Casa.tsx` → o modelo antigo
  tem um nível por pavimento e não descreve base por parede, muro, soleira, platibanda nem o tipo de folha; a cena nova
  lê o JSON direto e o `ModeloMaquete` continua disponível para o visualizador antigo (razão: não quebrar maquetes
  existentes e manter a fidelidade ao JSON).
- [AUTO-DECISION] Câmeras do tour no JSON (`ambientes[].camera`, opcional), vindas do protótipo; a altura NÃO vem do
  JSON (sempre piso + 1,60). Quarto 1, Quarto 2 e Banheiro foram afastados 13–32 cm da folha das portas, agora
  desenhadas abertas (anotado em `nota`).
- ~~[AUTO-DECISION] PT1 desenhado como portão gradeado~~ — substituído em 22/11: o dono definiu portão de correr.
- [AUTO-DECISION] Forro só sobre os ambientes `interno: true` (o protótipo cobria também serviço e varanda).
- [AUTO-DECISION] Visão geral "em corte" = paredes inteiras sem telhado, topo das paredes da casa em cinza (convenção
  de corte), como o protótipo validado.
- Do dono (21/11/2026): balcão de 1,10 m APROVADO (deixa de ser estimado no JSON); telhado (20%, platibanda 1,15) e a
  folha fixa da P2 continuam como no protótipo. Trocar o telhado é só mudar `cobertura.inclinacao` e
  `cobertura.platibanda.altura` no JSON (o gerador avisa se a cumeeira passar da platibanda).

## Decisões do dono (21/11/2026) — pendências da planta fechadas
- **Regra geral das plantas da Prospecta: a folha que abre da porta de correr fica do lado OPOSTO ao sofá** (palavras
  do dono: "sempre coloco o oposto do sofá"). No JSON, `aberturas[].folha_fixa` (`inicio` = lado do `offset`, `fim` =
  o outro; só em `abertura: "correr"`). Declarada, o vão útil e a faixa livre de 0,80 m valem só na metade que corre
  (`trechoUtilDaPorta` em `shared/maquete-3d/validacao-fonte.ts`); sem a declaração, valem no vão inteiro, como antes.
- P2 da sala: folha fixa x 0,52–1,32 (lado do sofá), folha que corre x 1,32–2,12. Sofá de volta à posição do
  protótipo (x 0,15–0,95, z 6,00–7,80). Rack com as medidas e o x do protótipo (x 1,85–2,14), mas em z 6,05–7,15
  (protótipo 6,30–7,40): ele fica em frente à folha que corre e a posição do protótipo invadiria 25 cm da faixa livre.
- Telhado: vale o do protótipo (20%, platibanda 1,15 m); `cobertura.fonte` = "decisão do dono em 21/11".
- PT1: portão DE CORRER (nem gradeado de abrir, nem de enrolar), 3,00 × 2,40, folha única sobre trilho, chapa embaixo
  e gradil simples em cima (modelo `portao_correr` na cena e na planta 2D).

## Testes
- (a) Automáticos: `server/maquete-3d-gerador.test.ts` (conversor, alturas, níveis, balcão, cobertura, vistas,
  ModeloMaquete, itens × mobília automática, planta 2D e cotas; 20 testes) e todos os `server/maquete-3d*.test.ts`:
  13 arquivos, 322 testes passando em 21/11/2026. `npx tsc --noEmit` sem erro; `npx vite build` sem erro. O projeto
  não tem script `lint`.
- (b) Manuais: capturas conferidas uma a uma (lista no relatório).
- (c) Produção: nada nesta etapa (sem banco, sem publicação).

## Limitações
- Capturas em Chromium com SwiftShader (sem placa de vídeo): cores e sombras podem diferir um pouco das de um celular.
- Os móveis usam os materiais do estilo "moderno" do catálogo; a `cor` de cada item do JSON ainda não é aplicada.
- Calhas são caixas simples (sem condutores); a platibanda sobrepõe 15 × 15 cm nos cantos (mesmo material).
- A folha das portas de abrir é desenhada aberta a 90°; a P1 (pivotante), o PT1 (de correr) e a P2, fechados.

## File List
- `shared/maquete-3d/fonte-cena.ts` (novo) — conversor puro: cena, `fonteParaModelo`, `pecasDaFonte`, legendas.
- `shared/maquete-3d/planta2d.ts` (novo) — planta 2D com cotas (pura).
- `shared/maquete-3d/rotulos-itens.ts` (novo) — nomes em português dos tipos de item.
- `shared/maquete-3d/fonte.ts` (alterado, aditivo) — `acabamento`, `funcao`, `camera` nos ambientes; `norte`.
- `shared/maquete-3d/validacao-fonte.ts` (alterado) — `ladoDoAmbiente` exportado.
- `shared/maquete-3d/mobilia.ts` (alterado, aditivo) — `pecasDoPavimento` (itens substituem a mobília automática).
- `data/plantas/lote4-qd18.json` (alterado) — câmeras do tour, norte, balcão aprovado pelo dono.
- `client/src/components/maquete-3d/visualizador/CenaFonte.tsx` (novo) — cena r3f.
- `client/src/components/maquete-3d/visualizador/VisualizadorFonte.tsx` (novo) — Canvas, câmera e transições.
- `client/src/components/maquete-3d/visualizador/materiais-fonte.ts` (novo) — materiais e texturas procedurais.
- `client/src/components/maquete-3d/visualizador/materiais.ts` (alterado) — helpers de textura exportados.
- `client/src/components/maquete-3d/visualizador/moveis/intimo-servico.tsx` (alterado) — `balcao`.
- `client/src/components/maquete-3d/visualizador/Mobilia.tsx`, `Visualizador.tsx` (alterados) — prop `itens`.
- `client/src/components/maquete-3d/planta2d/Planta2D.tsx` (novo) — SVG da planta.
- `client/src/pages/MaqueteDemo.tsx` (novo) e `client/src/App.tsx` (rota `lazy` `/maquete-demo/:planta`).
- `scripts/maquete/harness/{index.html,main.tsx,harness.css,vite.config.ts}` (novos) e `scripts/maquete/screenshots.mjs`.
- `server/maquete-3d-gerador.test.ts` (novo); `server/maquete-3d-fonte.test.ts` (alterado: balcão aprovado).
- `docs/stories/epics/epic-028-maquete-editor/screenshots/etapa-2/*.png` (capturas).
- `docs/stories/epics/epic-028-maquete-editor/ETAPA-2-RELATORIO.md` e esta story.

## Change Log
- 21/11/2026 — @dev (Dex): Ready → InProgress → InReview. Etapa 2 implementada (conversor, cena, modos, prévia,
  capturas, testes).
- 22/11/2026 — @dev (Dex): decisões do dono de 21/11 aplicadas (P2 com folha fixa e regra da faixa só na folha que corre,
  sofá/rack, telhado do protótipo, PT1 de correr); capturas da Etapa 2 regravadas (geral, sala, garagem, planta).
