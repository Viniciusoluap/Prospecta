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
