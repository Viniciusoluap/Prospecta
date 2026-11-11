# Handoff — Estudo de Massa: tipologia "Vias públicas" (11/11)

## Pedido do dono
Quarta opção em "Tipologia do cenário": **Vias públicas**. Terrenos cujas divisas JÁ são vias públicas (por fora e
por dentro): só desmembrar, sem via interna → 100% de aproveitamento, lotes de frente para as vias existentes.
Referência: projeto aprovado (SEPLU Imperatriz, 24/08/2026) do Lote 01 Qd O, 7.592,63 m² → 60 lotes ≥ 125 m², com
testadas variando (mínimo 5 m) e área total mantida. É o estudo 1 ("Empreendimento Polímeros"); não é regra geral.

## Concluído
- `shared/incorporacao/vias-publicas.ts`: divide o contorno em trechos (quebra em cantos > 45°); implanta lotes ao longo
  de cada trecho SEM via (`implantarNaDivisa` com `semVia`), frente ≥ testada (cresce onde a faixa é rasa), fundo até a
  profundidade e área ≥ mínima; trechos convexos/retos primeiro (do maior para o menor ou na sequência do contorno) e os
  côncavos (contorno de balão que entra no terreno) por último, com variações de sentido, fase e leque; depois
  `completarAproveitamento`: sobra com frente e área próprias vira lote, o resto vai ao lote vizinho (100%).
- `rua-divisa.ts`: extra `semVia` (sem via interna; comportamento antigo intacto).
- `massa.ts`: tipologia `vias_publicas` ("Vias públicas (divisas já voltadas para vias — 100% de aproveitamento)");
  quadra máx. e largura da via não se aplicam (aceitam 0); só seguem as variações com mais lotes.
- `massa-tab.tsx`: rótulo e texto de ajuda da opção.

## Resultado no KML real (estudo 1, testada 5, profundidade 25, mínimo 125 m²)
**58 lotes**, todos ≥ 125 m² e frente ≥ 5 m, 100% de aproveitamento (7.581,70 m² na projeção usada pelo motor; o KML
cadastra 7.592,63 — diferença de 0,14% da projeção), sistema viário 0. O projeto aprovado tem 60 (desenho manual do
projetista). Tempo ~45 s.

## Testes
- (a) `server/incorporacao-vias-publicas.test.ts` (4) + suíte completa 189 arquivos / 1576 testes, typecheck e build OK.
- (b) Aba do Estudo de Massa no Chromium com o KML real: opção aparece; "Gerar" mostra 58 lotes, 100%, viário 0,00 m²;
  desenho técnico com lotes em leque no arco externo e ao redor do balão.
- (c) Produção: pendente.

## Próximo passo
Autorização do dono para merge/deploy; conferir no estudo 1. Possível melhoria: aproximar dos 60 lotes do projeto
(otimização fina das sobras) e reduzir o tempo. Paridade com o Santa Fé registrada no ROADMAP.


## Atualização 11/11 (2ª rodada) — correção do cálculo: 58 → **60 lotes** (igual ao projeto aprovado)
**Retorno do dono:** 58 estava errado — no projeto as frentes variam (não são todas 5 m), o fundo varia, "acha a
proporção entre os mínimos" e há cantos não retos. Referência: Alvará SEPLU, processo 1769/2026 + memorial e planta
(LT 02–12 com 7,44 × 16,81 = 125 m², faixa de 33,6 m entre a Rua dos Uirapurus e a Rua das Andorinhas dividida ao meio).

**O que estava errado no motor e foi corrigido:**
1. Fundo fixo em 25 m de um lado → agora o fundo vai até o **eixo entre as vias** (fração da travessia medida no
   próprio lote) e a frente é a que fecha a área mínima — ex.: 33,6 m → fundo 16,8 m, frente 125 ÷ 16,8 = 7,44 m.
2. O lote da ponta "dobrava a esquina" e tomava a frente da via vizinha → com vias públicas em todas as divisas a
   esquina é repartida pela **bissetriz do ângulo** (cantos não retos), limitada até onde a bissetriz sai do terreno.
3. Sobras na ponta de cada trecho viravam lotes maiores → **redivisão por área**: cada zona (lotes do trecho + sobras)
   é redividida (guloso pela área mínima nos dois sentidos e, se couber, áreas iguais), e **trechos vizinhos no
   contorno são agrupados** quando a área passa de um para o outro pela esquina (rende ⌊área do grupo ÷ 125⌋).
4. O lado de frente longa (arco externo) fica com 57% da travessia (o balão, limitado pela frente, com 43%) — como
   no projeto (lotes do balão ≈ 13,5 m de fundo). Testa 57%, 50% e 65% e para ao atingir o teto ⌊área ÷ mínimo⌋.
5. Zonas robustas: zona = gleba − tudo dos outros trechos (frestas numéricas não partem a zona); sobra que liga
   duas partes de uma zona vai para ela; nenhum lote abaixo da mínima (margem de 5 cm² no corte).

**Resultado no KML real (estudo 1):** **60 lotes** (teto ⌊7.581,7 ÷ 125⌋ = 60), todos entre 125,0 e 139,3 m², frentes
de 5,00 a ~19 m (esquinas), 100% de aproveitamento, viário 0, ~15 s.

**Arquivos:** `shared/incorporacao/vias-publicas.ts` (zonas, agrupamento, redivisão), `shared/incorporacao/rua-divisa.ts`
(`fundoAteMeio`, `fracaoFundo`, bissetriz nas esquinas, `dividirZonaPorArea`), teste atualizado (60).
