# Handoff — Vias públicas: desenho igual ao memorial aprovado (11/11)

## Pedido do dono
"Você leu todo o memorial descritivo? Lá tem a medida exata de cada lote... o seu desenho ainda está errado."

## O que o memorial (SEPLU 1769/2026) mostra — Lote 01 Qd O, 60 lotes
Transcrição completa por lote: scratchpad da sessão (`memo/lotes.md`); resumo da regra:
- Rua das Andorinhas (via interna em U com rotatória): lotes de fundo fixo 16,81 m (= metade dos 33,62 m do
  braço reto) e frente 7,44 m (125 ÷ 16,81), dos dois lados do U (lotes 36–44 e 50–60).
- Rotatória (raio 8,10): frente ≈ 5,3–5,5 m (mínimo 5) e fundo encolhendo até fechar 125 m² (13,5–13,8 m) — lotes 45–49.
- Rua dos Uirapurus (externa): lotes de costas para os da Andorinhas, laterais na mesma direção; ficam com o resto
  da profundidade (16,81 no braço estreito; 17,24 → 28,12 no braço largo, frentes em diagonal 6,87 → 5,03).
  Curva externa: lotes radiais (13–22).
- Av. dos Marrecos (ponta larga): lotes 30–35 de frente para a avenida (6,10 × 20,75), 35 triangular; esquinas 1, 30, 36, 60.
- Lotes regulares com 125,00 m² exatos; a sobra fica nas esquinas e na rotatória (soma das sobras 92,63 m²).

## Concluído até agora (não ligado ao sistema ainda)
- `shared/incorporacao/vias-publicas-faixas.ts`: novo motor "em faixas" (via de referência com fundo P = metade da
  largura entre as divisas paralelas mais longas; leque da rotatória com frente mínima e fundo que fecha a área;
  lado de trás com laterais na direção das da referência; divisão das duas pontas para o meio com área exata).
- Resultado atual no KML do estudo 1: **59 lotes** com a estrutura do aprovado (falta a ponta da Marrecos).

## Pendências / próximo passo exato
1. Ponta larga (Av. dos Marrecos): faixa de lotes de frente para a Marrecos (como 30–35 do aprovado), para não
   perder área nos lotes muito fundos da Uirapurus → chegar a 60.
2. Ligar `buscarFaixas` em `buscarViasPublicas` (preferir quando tiver ≥ lotes do motor atual) e retirar logs DBG_FAIXAS.
3. Teste: 60 lotes, lotes da Andorinhas 7,44 × 16,81 (125,00 m²), soma = gleba.
4. Handoff/ROADMAP, commit, push, PR #199 atualizado; pedir autorização de merge/deploy (inclui migração 0101 dos anexos).

## Testes
- (a) ainda não há teste novo; suíte atual verde no 0b8bbe7 (190 arquivos / 1584).
- (b) desenhos gerados em SVG/PNG no scratchpad para comparar com a planta aprovada.
- (c) produção: nada publicado desta frente.
