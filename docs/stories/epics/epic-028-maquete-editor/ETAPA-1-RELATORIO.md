# EPIC-028 — Etapa 1: JSON-fonte e validações — relatório

Data: 21/11/2026 · @dev (Dex) · Branch `feat/maquete-3d-editor` (commits locais, sem push, sem banco)
Story: `E1-json-fonte.md`

## Como a planta foi lida

A prancha é um PDF A0 de uma página, **só imagem** (uma foto JPEG de 150 ppp; não há texto nem linhas vetoriais, o
`pdftotext` sai vazio). Ela foi lida por recortes em imagem: planta baixa, cobertura, corte A, corte B, fachada norte,
quadro de janelas, tabela de portas e quadro de ambientes. As medidas sem cota escrita foram medidas no desenho
(1:50 a 150 ppp ≈ 118 pixels por metro, precisão de uns 2 a 3 cm) e ficaram marcadas `"estimado": true`.
O PDF não foi copiado para o repositório.

Eixos do JSON (os do protótipo): x = largura (0 no lado da cozinha e da sala, 5,00 no lado dos quartos); z =
profundidade, z = 0 no fundo da casa (quarto 1 / cozinha) e z = 9,45 na frente. Paredes pelo eixo central + espessura.

## Cotas: planta × modelo × fonte

| Cota | Planta (PDF) | Modelo (JSON) | Fonte |
|---|---|---|---|
| Lote | 5,00 × 30,00 (0,15 · 10,00 · 9,45 · 10,25 · 0,15) | 5,00 × 30,00; z de −10,15 a 19,85 | planta |
| Casa | 5,00 × 9,45 | 5,00 × 9,45 | planta |
| Faixas na largura | 0,15 · 1,99 · 0,15 · 2,56 · 0,15 | igual (soma 5,00) | planta |
| Faixas na profundidade (lado direito) | 0,15 · 3,50 · 0,15 · 1,85 · 0,15 · 3,50 · 0,15 | igual (soma 9,45) | planta e corte B |
| Faixas lado esquerdo (a partir de z 0,86) | 0,15 · 1,76 · 1,06 · 4,14 · 0,15 | parede da frente da sala em z 7,95–8,10 (pela cadeia daria 7,97–8,12) | protótipo |
| Hall × banheiro | 0,91 · 0,15 · 1,50 | igual | planta |
| Passagem cozinha → sala | 0,80 | 0,80 (x 0,15–0,95) | planta |
| Elemento entre cozinha e sala | 1,19 (desenhado como parede) | item `balcao` 1,19 × 0,40 | planta + decisão do dono |
| Área de serviço | 1,99 de largura; profundidade sem cota | 1,99 × 1,33 (z −0,47 a 0,86) | quadro de ambientes (perímetro) |
| Cota "0,86" | horizontal, dentro da área de serviço (divisa → pilarete/tanque) | parede da cozinha com face em z 0,86 (medido no desenho: 0,85) | planta / protótipo |
| Varanda | 1,99 × 1,37 | 1,99 × 1,35 (até a face da casa) | planta |
| Níveis | interno +0,40; serviço e varanda +0,35; banheiro +0,39; box +0,38; garagem +0,20; rua 0,00 | igual | planta |
| Pé-direito | 2,80 (cortes A e B), forro de gesso, +3,20 | 2,80; forro +3,20 | cortes A/B |
| J1 (3×) | 1,00 × 1,20, peitoril 1,10, correr 4 folhas | igual; quartos a 0,78 da divisa direita | quadro de janelas |
| P1 | 1,00 × 2,50 pivotante (madeira), no muro da frente | x 3,70–4,70 do muro da frente | tabela de portas + planta |
| P2 | 1,60 × 2,50 correr 2 painéis | x 0,52–2,12 (desenho: 0,53–2,13) | tabela de portas |
| P3 (2×) | 0,60 × 2,10 de abrir | cozinha x 0,24–0,84 (abre para a cozinha); banheiro z 5,00–5,60 (abre para o banheiro) | tabela de portas + planta |
| P4 (2×) | 0,70 × 2,10 de abrir | quarto 1 x 2,32–3,02; quarto 2 x 2,38–3,08 (abrem para os quartos) | tabela de portas + planta |
| PT1 | 3,00 × 2,40 portão da garagem (de enrolar na fachada) | x 0,20–3,20 do muro da frente | tabela de portas + planta |
| Cobertura | fibrocimento **25%**, duas águas de 4,40, calhas e rufos de zinco; platibanda **1,60** acima do forro (corte B) | 20%, cumeeira em z 4,725, platibanda 1,15 (protótipo mantido) | protótipo — **divergência** |

## Áreas: quadro × calculada

| Ambiente | Quadro (m²) | Calculada (m²) | Desvio |
|---|---|---|---|
| Quarto 1 | 9,07 | 8,96 | −1,2% |
| Quarto 2 | 9,07 | 8,96 | −1,2% |
| Sala de estar/jantar | 8,21 | 8,26 | +0,6% |
| Cozinha | 5,40 | 5,37 | −0,5% |
| Banheiro | 2,78 | 2,78 (2,775) | −0,2% |
| Área de serviço | 2,64 | 2,65 | +0,3% |
| Hall | 1,90 | 1,91 | +0,3% |

Todas dentro de ±2%. Os quartos ficam 1,2% abaixo porque o quadro da prancha mede 2,57 × 3,53 (área e perímetro do
quadro), um pouco maior que as cotas 2,56 × 3,50; o modelo segue as cotas.

## Itens e medidas `estimado`

- **Itens**: bancada do fogão (fim em z 2,77 medido no desenho), geladeira (0,70 × 0,70 × 1,80), balcão (altura 1,10
  e tampo 0,40), as 4 cadeiras (altura com encosto 0,90), sofá e rack (recuados), carro. Os demais itens vêm do
  protótipo (`fonte: "protótipo"`).
- **Estrutura**: J1 da cozinha (posição), PT1 e P1 (posição medida no desenho), altura dos muros (1,80 do protótipo;
  muro da frente ≈ 3,00 medido na fachada norte), hall (1,03 de largura, ver abaixo), área de serviço (profundidade
  pelo perímetro do quadro), quintal (nível).

## Diferenças entre o PDF, o texto do dono e o protótipo (e a decisão)

1. **Elemento de 1,19 m entre cozinha e sala.** A planta o desenha como parede, e o corte A mostra a ponta dele
   subindo até o forro (linha vertical do piso ao forro em x ≈ 0,95). Não há cota de altura de balcão nem de mureta.
   **Decisão (ordem do dono):** não é parede; virou o item `balcao`, altura 1,10 m **estimada**.
2. **Geladeira.** A planta desenha a geladeira no canto da cozinha junto ao elemento de 1,19 e à parede do quarto 1
   (x ≈ 1,30–2,14; z ≈ 2,77–3,65), com a bancada do fogão terminando em z ≈ 2,77. O protótipo a colocava na frente da
   P3. **Decisão:** geladeira em x 1,44–2,14, z 2,95–3,65 (posição do PDF e da sugestão do dono); bancada do fogão
   encurtada para terminar em z 2,77, como na planta.
3. **Inclinação do telhado.** O dono e o protótipo falam em 20%; a planta de cobertura marca **25%** nas duas águas.
   **Decisão:** mantido 20% (ordem "o telhado do protótipo não muda"); divergência para o dono decidir.
4. **Platibanda.** O corte B dá **1,60 m** acima do forro (+3,20 → +4,80) e mostra uma laje acima do forro; o
   protótipo usa 1,15 m. **Decisão:** mantido o protótipo; para o dono decidir.
5. **P1 e portão.** O protótipo põe o portão em x 1,00–4,00 e não tem a P1. A planta e a fachada norte mostram o
   portão PT1 à esquerda (x ≈ 0,22–3,21) e a porta pivotante P1 à direita (x ≈ 3,70–4,70). **Decisão:** seguir a
   planta, porque a P1 está no quadro de esquadrias e não cabe ao lado do portão do protótipo.
6. **Comprimento do lote.** A cadeia da planta fecha 30,00 m com a face da rua em z 19,85; o protótipo vai até z 20,00
   (30,15). **Decisão:** planta.
7. **Hall.** Com a cota de 0,91 o hall dá 1,68 m², 11% abaixo do quadro (1,90). O quadro (área 1,90 e perímetro 5,76)
   só fecha com 1,03 × 1,85: o hall do quadro inclui parte da faixa sem parede entre o hall e a sala. **Decisão:** hall
   em x 2,17–3,20, marcado estimado.
8. **Área de serviço.** O texto do dono liga a cota 0,86 à área de serviço; na planta a cota 0,86 é horizontal (da
   divisa até o pilarete/tanque). A profundidade da área de serviço não tem cota; o perímetro do quadro (6,64 m) dá
   1,33 m. **Decisão:** área de serviço de z −0,47 a 0,86 (protótipo: −0,45); parede da cozinha mantida em z 0,86.
9. **Sofá e rack na frente da P2.** Na planta e no protótipo o sofá vai até a parede da frente da sala, dentro da
   faixa de 0,80 m em frente à P2 (porta de correr de 1,60). **Decisão:** a faixa vale na largura toda do vão (a
   planta não diz qual folha é fixa); sofá recuado para z 5,40–7,15 e rack para z 6,05–7,10.
10. Pequenas diferenças de 1 a 3 cm entre o desenho e o protótipo (P2, P3, J1 da cozinha, parede da frente da sala):
    mantido o protótipo, anotado em `nota`.

## Posição final da geladeira e do balcão

- **Geladeira**: x 1,44 → 2,14; z 2,95 → 3,65 (encostada na parede do quarto 1 e na face do balcão), virada para a
  cozinha; 1,80 m de altura. Fica fora do vão, do giro (raio 0,60) e da faixa de 0,80 m da P3, que vai de x 0,24 a 0,84.
- **Balcão**: x 0,95 → 2,14 (1,19 m); base de 0,15 na linha z 3,65–3,80 (onde a planta desenhava o elemento) e tampo
  de 0,40 de z 3,65 a 4,05, avançando 0,25 m para a sala; 1,10 m de altura. Passagem livre de 0,80 m entre a divisa e o
  balcão (x 0,15–0,95). Nenhuma parede no trecho.

## Validações (resultado no JSON de referência)

`validarFonte()` no `lote4-qd18.json`: **nenhum erro e nenhum aviso**. Regras e tolerâncias em `TOLERANCIAS`
(`shared/maquete-3d/validacao-fonte.ts`): área ±2%; medidas ±1 cm; faixa livre 0,80 m; "debaixo da janela" até 0,60 m
da face da parede; item alto > 1,10 m; balcão < 1,20 m.

Regressões testadas: geladeira na posição antiga → "porta P3 bloqueada" (giro e faixa); mureta recolocada como parede
→ erro do balcão e do item atravessando parede.

## Pendências

1. Dono decidir o telhado: 20% (protótipo) ou 25% (cobertura), e platibanda 1,15 (protótipo) ou 1,60 (corte B).
2. Dono confirmar a altura do balcão (1,10 estimada; a prancha desenha o elemento até o forro).
3. Dono confirmar qual folha da P2 é fixa (se a faixa de 0,80 m puder valer só na folha que corre, o sofá volta para
   perto da parede, como na planta).
4. Medidas reais da geladeira e altura dos muros (sem cota).
5. Etapa 2: conversor JSON-fonte → `ModeloMaquete` (cena 3D) e desenho do balcão americano no catálogo.
