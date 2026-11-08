# HANDOFF 08/11 — Prompt mestre: parcelamento, desenho técnico, mercado, unidades e negociação

Branch: `claude/intelligent-ptolemy-av0qoh` (Prospecta). Checkpoint inicial recuperável:
tag local `checkpoint/pre-parcelamento-20261108` = `61362b1` (main na época, árvore limpa).
Escopo: só Prospecta (o prompt proíbe alterar outros repositórios). Paridade com o Santa Fé
fica **sinalizada** aqui e no relatório — não foi portada.

## Estado por correção

| # | Correção | Estado |
|---|----------|--------|
| 01 | Parâmetros exatos + área viária manual + quadro | ✅ motor (etapa 1) · UI pendente |
| 02 | Determinismo + 3 cenários por critério + mensagens | ✅ motor (etapa 1) · UI pendente (remover seed `Date.now()`) |
| 03 | Rua Simples | ✅ motor (etapa 1) · UI pendente |
| 04 | Desenho técnico universal | ⏳ pendente |
| 05 | Quantidade dinâmica | ✅ motor + testes |
| 06 | Mercado: 2 motores independentes | ⏳ pendente |
| 07 | Unidades: ordenação numérica + paginação 6 | ⏳ pendente |
| 08 | Negociação: excluir proposta + permuta % VGV | ⏳ pendente |

## Etapa 1 — motor de parcelamento v2 (concluída)

Causas encontradas (auditoria):
- **Aleatoriedade**: `massa-tab.tsx` chamava o motor com `seed: Date.now() % 100000` → cada clique, um resultado.
- **Parâmetros alterados**: o algoritmo genético buscava `testada ∈ [t, 2,2t]`, `profundidade ∈ [0,7p, 1,4p]`
  e `via ∈ [v, 1,4v]` — por isso 20 × 250 virava 20,3 × 273,3 e via de 3 m virava 4 m+.
- **Lotes irregulares**: o desenho final recortava lotes pela gleba e aceitava até 60% da área nominal.
- **Contagem ≠ desenho**: a busca avaliava por amostragem de 5 pontos; o desenho usava recorte exato.
- **Viário fictício**: o quadro chamava de "sistema viário" todo o resto (vias + sobras).
- **Lote sem acesso**: lotes na borda podiam ficar de frente para via fora da gleba.

Arquivos:
- `shared/incorporacao/geometria-parcelamento.ts` (novo): índice espacial de arestas, teste exato
  "retângulo dentro da poligonal" (côncava inclusive), ponto-no-polígono indexado, validação de
  poligonal (auto-interseção, fechamento, área nula), envelope girado.
- `shared/incorporacao/rua-simples.ts` (novo): tipologia Rua Simples (via reta única de mão dupla,
  lotes dos dois lados, trecho de acesso a partir da divisa, sem balão) + varredura determinística.
- `shared/incorporacao/massa.ts` (reescrito, mesma API pública): `gerarEstudoMassa` (novo, retorna
  cenários + inviabilidade com causas) e `gerarCenariosMassa` (compatível). Grade e Cul-de-sac
  preservados (mesma lógica de quadras/balões), agora com lotes exatos, exigência de via em frente
  ao lote e corredores viários desenhados. Busca determinística (ângulos das arestas + a cada 10°,
  refino ±5° e fases da malha). Seleção: 1) maior área vendável, 2) melhor eficiência viária
  (≥75% da melhor área), 3) alternativa distinta; equivalentes descartados. `VERSAO_ALGORITMO_MASSA`
  e `assinaturaEntradas` (cache/auditoria). Modo manual da área viária (Rua Simples define o
  comprimento da via; Grade/Cul-de-sac aceitam só se a área desenhada bater ±5%, senão divergência).
- `shared/incorporacao/massa-quadro-areas.ts`: viário geométrico opcional + `sobrasM2` (legado intacto).

Testes (a) automáticos:
- `server/incorporacao-parcelamento-v2.test.ts` — 33 testes ✅ (dimensões exatas nas 3 tipologias,
  sem sobreposição/fora da gleba, via de 3 m, incompatibilidade de área mínima, quadro fechando e
  área das ruas recalculada de forma independente, **10 execuções idênticas** por tipologia
  (JSON idêntico — tolerância efetiva zero; documentada 1e-4 m / 0,01 m²), Morada sintética = 29,
  mesma geometria via KML (`parseKmlTerreno`) = 29, geometria menor = 20 (não força 29),
  quantidade dinâmica 8/14/30/60/100, área viária manual ok/divergente/negativa/acima da área).
- Regressão: `incorporacao-massa*.test.ts` 46 ✅ (1 asserção ajustada: identidade agora inclui sobras).
- Suíte completa antes da correção do índice: 1467/1468 (a falha era o bug do índice, corrigido).
- Benchmark 100 ha / 200 vértices: grade ~3,3 s, cul-de-sac ~5,4 s, rua simples ~7,6 s (Node).

Pendente de validação (c): **KML real do Morada do Bosque não está no repositório** — os 29 lotes
foram verificados só em geometria sintética com os mesmos parâmetros. Validar com o KML real.

## Próximo passo exato
Etapa 2: UI do Estudo de Massa (`client/src/components/incorporacao/estudo/massa-tab.tsx`):
tipologia Rua Simples, campo "Área do sistema viário (m²)" com modo automático/manual, chamar
`gerarEstudoMassa` em Web Worker (progresso real, sem execução concorrente), mostrar critério e
motivo/causas de inviabilidade; depois Etapa 3: desenho técnico (SVG) com alternância Satélite.
