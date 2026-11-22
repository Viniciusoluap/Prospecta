# EPIC-028 — Etapa 2: gerador web a partir do JSON-fonte — relatório

Data: 21/11/2026 · @dev (Dex) · Branch `feat/maquete-3d-editor` (commits locais, sem push, sem banco) · Story: `E2-gerador-web.md`
Custo: zero (nenhuma IA, nenhuma API, nenhuma dependência nova; texturas desenhadas em canvas; nada da Higgsfield).

## O que foi feito

- **Conversor puro** `shared/maquete-3d/fonte-cena.ts`: o JSON-fonte vira (1) `ModeloMaquete` (`fonteParaModelo`) e peças
  do catálogo (`pecasDaFonte`), para o visualizador do EPIC-022 abrir a mesma casa com os itens do JSON no lugar da
  mobília automática (`pecasDoPavimento`); (2) a cena detalhada (`cenaDaFonte`): paredes recortadas com peitoril e verga
  na base e na altura de cada parede, encontros em L/T sem faces sobrepostas, muros, pisos por ambiente e nível,
  soleiras e pingadeiras de granito, esquadrias (modelo, folhas, dobradiça, lado do giro), cobertura (forro só na parte
  coberta, platibanda com rufo, telhas em duas águas com a inclinação do JSON, calhas nas bordas baixas), calçada e
  rua, uma luz por cômodo, rótulos e as vistas do tour.
- **Planta 2D** `shared/maquete-3d/planta2d.ts` + `Planta2D.tsx` (SVG): paredes cortadas, aberturas com símbolo (arco de
  giro, folhas de correr, portão), itens em contorno (tracejado = estimado), cadeias de cotas da casa (as faixas do
  JSON) e totais 5,00 / 9,45, nome/área/medidas dos ambientes, norte, escala e legenda.
- **Visualizador** `CenaFonte.tsx` + `VisualizadorFonte.tsx`: geometria mesclada (uma chamada por material), ACES,
  `RoomEnvironment` gerado localmente, sombras PCF suaves, quadros sob demanda, pixel ratio ≤ 2, transição de câmera
  de 1,1 s (instantânea com `prefers-reduced-motion`). Balcão americano novo no catálogo procedural.
- **Prévia sem banco** `/maquete-demo/lote4-qd18` (rota `lazy`, `noindex`); modo pelo endereço: `#geral`, `#telhado`,
  `#planta`, `#sala`, `#cozinha`, `#quarto-1`, `#quarto-2`, `#banheiro`, `#area-de-servico`, `#garagem-e-frente`.
  No celular abre na planta (o 3D só é baixado ao escolher uma vista).
- **JSON**: câmeras do tour (do protótipo; Q1, Q2 e banheiro afastados da folha da porta), norte (estimado) e o
  balcão de 1,10 m aprovado pelo dono (deixa de ser estimado).

## Como abrir

- No app: `npm run dev` e abrir `http://localhost:3000/maquete-demo/lote4-qd18` (ou a porta que o servidor indicar).
- Sem servidor: `node scripts/maquete/screenshots.mjs [pasta]` monta o harness (`scripts/maquete/harness`), abre a
  mesma página no Chromium e grava as capturas (`--so=geral,sala`, `--tela=desktop|celular`).

## Capturas (`screenshots/etapa-2/`, conferidas uma a uma)

| Arquivo (desktop-… e celular-…) | O que mostra |
|---|---|
| `geral` | Visão geral em corte, sem telhado: topo das paredes em cinza de corte, rótulos dos cômodos, muros, quintal e carro. |
| `telhado` | A mesma vista com forro, platibanda com rufo e fibrocimento em duas águas a 20% escondido pela platibanda. |
| `sala` | Sala a 1,60 m: sofá, mesa com 4 cadeiras, rack/TV; ao fundo o balcão baixo aberto para a sala com a geladeira junto dele; forro. |
| `cozinha` | Cozinha: P3 livre e aberta para dentro, J1 de 4 folhas com pingadeira, bancadas em L com pia e cooktop, geladeira no canto. |
| `quarto-1` / `quarto-2` | Cama de casal, criados e a J1 com peitoril de 1,10. |
| `banheiro` | Vaso, box de vidro com ralo e lavatório; piso cerâmico. |
| `area-de-servico` | Vista do quintal: área de serviço descoberta (+0,35) com tanque e máquina, P3 e J1 da cozinha. |
| `garagem-e-frente` | Do portão: piso de concreto, carro, fachada com P2 de vidro e J1 do quarto 2. |
| `planta` | Planta 2D com cotas (página inteira), quadro de áreas e de esquadrias. |

Defeitos visuais que ficaram (menores): no banheiro e nos quartos aparece uma faixa escura do batente ou da folha
aberta na borda da imagem; tampos de pedra escura mostram faixas do reflexo (8 bits); algumas capturas grandes foram
reduzidas (até 80%) para ficar abaixo de 600 KB; na planta, o texto da área de serviço encosta no contorno do tanque.

## Pacote (`npx vite build`)

Pedaços novos: `MaqueteDemo` 48,5 kB (17,3 kB gzip, sem three.js), `VisualizadorFonte` 24,4 kB (9,6 kB gzip), JSON
da planta 18,2 kB (5,1 kB gzip). O 3D reaproveita os pedaços já existentes de three/r3f/drei e do catálogo de móveis.

## Testes

- `server/maquete-3d-gerador.test.ts` (20 testes): toda parede/muro/abertura/item do JSON aparece; peitoril e verga
  nas alturas do JSON; muros; sem sobreposição de blocos; balcão nunca é parede (e tem 1,10 m); pisos e níveis;
  soleiras; cobertura (cumeeira, platibanda, forro só no coberto, troca para 25% avisa); vistas a 1,60 m; ModeloMaquete
  (paredes, aberturas, nível 0,40, pé-direito 2,80, cobertura 20%, 1 vaga); itens substituem a mobília automática;
  cotas somam 5,00 e 9,45; símbolos de abertura e arcos; quadro de esquadrias.
- Todos os testes de maquete (`server/maquete-3d*.test.ts`): 13 arquivos, 322 testes, todos passando.
  `npx tsc --noEmit` sem erro. O projeto não tem script `lint`.

## Pendências

1. ~~Dono: telhado~~ — RESOLVIDO em 21/11: 20% e platibanda 1,15 (protótipo).
2. ~~Dono: qual folha da P2 é fixa~~ — RESOLVIDO em 21/11: a do lado do sofá; a outra corre (desenhada com puxador e seta na planta).
3. ~~PT1~~ — RESOLVIDO em 21/11: portão de correr (folha única sobre trilho, chapa e gradil).
4. Cor de cada item do JSON ainda não aplicada (móveis no estilo "moderno" do catálogo).
5. Etapa 3 (banco, editor de itens, versões) não iniciada, como pedido.
