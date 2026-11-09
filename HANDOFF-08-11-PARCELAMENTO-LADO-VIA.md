# Handoff — Trocar rua de lado no Estudo de Massa

## Concluído

- Em Rua Simples com traçado pela divisa, a caixa “Trocar rua de lado” gera os cenários na divisa oposta à do primeiro cenário automático.
- O motor recalcula o sistema viário, os lotes, as áreas, o aproveitamento e o VGV a partir da geometria. Quando não há cenário válido na divisa oposta, o formulário informa a inviabilidade.
- O estudo salvo guarda a escolha junto aos parâmetros e cenários. Estudos antigos assumem o lado automático.

## Validação

- (a) TypeScript e 46 testes de regressão de geração de cenários passaram.
- (b) O teste com a poligonal do Morada do Bosque confirmou a mudança da divisa oeste para a leste com via de 6 m, com áreas, testadas e VGV recalculados.
- (c) Pendente a conferência no ambiente publicado após a integração.

## Próximo passo

Revisar o PR da branch `codex/parcelamento-trocar-lado-via-20261109` e conferir a caixa e o desenho após a publicação.

## Atualização 09/11 (Claude) — rua por lados: cima, esquerda, direita, baixo

**Pedido do dono:** a rua deve ficar só na divisa que ele escolher (print com a divisa leste circulada); trocar
"Trocar rua de lado" por quatro caixas — Rua de cima, Rua da esquerda, Rua da direita, Rua de baixo — combináveis
(ex.: cima + direita = via em "L"); frente exata de 20 m, fundo pode variar; "580 m ÷ 20 = 29 lotes".

**Medição no KML do Morada do Bosque (estudo 5):** cima 265,7 m · esquerda 627,8 m · direita 513,6 m · baixo 266,1 m.
A divisa circulada (direita/leste) tem 513,6 m, não 580 m → no máximo 25 frentes de 20 m (513,6 ÷ 20 = 25,7).
Pela rua da ESQUERDA (627,8 m) cabem 28 lotes com frente exata de 20 m; o 29º só cabe alargando uma frente (~29 m),
porque a área limita: (149.378 − 3.756 de via) ÷ 5.000 = 29,1.

**Concluído:**
- `shared/incorporacao/lados-gleba.ts`: classifica cada aresta pela normal externa (norte = cima etc.), mede cada
  lado, junta lados vizinhos numa via contínua e trata lados opostos como vias separadas; traça todas as vias antes
  dos lotes (nenhum lote atravessa outra via); via ocupa a divisa inteira.
- `rua-divisa.ts` (`implantarNaDivisa`, extras opcionais): fundo variável — a frente fica exata na testada e, quando a
  faixa não atinge a área mínima, a divisa lateral gira (até 75°) em vez de alargar a frente; ocupados externos;
  via inteira; fundo máximo = profundidade quando há vias em divisas separadas. Sem os extras, comportamento igual.
- `massa.ts`: parâmetro `ladosVia` (validado; ordem canônica; entra na assinatura), cenários marcados com `ladosVia`.
  O legado `inverterLadoVia` continua aceito para estudos salvos.
- `massa-tab.tsx`: as quatro caixas no lugar de "Trocar rua de lado", com o comprimento de cada divisa ao lado;
  salvar exige cenários gerados com os mesmos lados.

**Resultados (Morada, testada 20, prof. 250, via 6, mín. 5.000 m²):** direita 25 lotes (todos 20,0 m; só o da ponta
24,2 m, absorvendo a sobra) · esquerda 28 (todos 20,0 m). Revisão Codex: frente nunca alarga num lote do meio; a
primeira divisa sem lote não bloqueia as outras; divisas processadas da mais longa para a mais curta.
Tempo: direita ~7 s, esquerda ~15 s, cima+direita ~35 s, quatro lados ~47 s.

**Testes:** (a) `server/incorporacao-lados-via.test.ts` (5) + `incorporacao-parcelamento-v2.test.ts` (44, inclusive o
legado de trocar lado) verdes; suíte completa 188 arquivos / 1569 testes e build OK. (b) Aba renderizada no Chromium com a poligonal real:
caixas com os comprimentos; marcar "Rua da direita" gerou 25 lotes com a via só na divisa leste. (c) Produção: pendente.

**Próximo passo:** autorização do dono para merge/deploy; depois conferir no estudo 5. Melhorias possíveis: acelerar
combinações de vários lados; portar ao Santa Fé (ROADMAP).
