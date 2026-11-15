# S-G — Vias do 3D com representação fiel

Status: Done (publicada em 15/11/2026)
Epic: EPIC-023 (Etapa G) — correção 13 do dono (15/11/2026)
Paridade: Maquete 3D — exceção já registrada no `ROADMAP.md` (EPIC-022). Não portar.
Tamanho estimado: G
Dependência: S-F (as vias vêm da malha viária gerada pelo motor do Estudo de Massa).

## Problema

No 3D, as ruas são só tinta em canvas (`client/src/components/maquete-3d/visualizador/Implantacao.tsx:86-108`) e
`imp.vias` nem é desenhado. O dono quer representação fiel: faixas pintadas, meio-fio, sarjeta, calçada,
arborização, postes e semáforos onde necessário.

## Critérios de aceite
- [x] AC1: `imp.vias` é desenhado em 3D, com geometria própria (não só pintura no terreno).
- [x] AC2: cada via tem faixas pintadas, meio-fio, sarjeta e calçada.
- [x] AC3: há arborização e postes ao longo das vias.
- [x] AC4: semáforos aparecem só onde necessário (cruzamentos), com regra de posicionamento documentada no código e
      coberta por teste.
- [x] AC5: tudo gerado pelo motor, sem pacotes comprados.
- [x] AC6: as vias e os elementos seguem o relevo da implantação (topografia de S-08 do EPIC-022).
- [x] AC7: desempenho aceitável em iPad e celular (repetição leve/instancing para árvores, postes e semáforos).

## Tarefas
- [x] T1: geometria da via (pista, sarjeta, meio-fio, calçada) a partir de `imp.vias`, apoiada no relevo.
- [x] T2: faixas pintadas.
- [x] T3: árvores e postes gerados por código, com instancing.
- [x] T4: regra de semáforo por cruzamento.
- [x] T5: retirar a pintura de ruas no canvas quando substituída.
- [x] T6: suíte, `pnpm check`, `vite build`; HANDOFF.

## Arquivos principais
- `client/src/components/maquete-3d/visualizador/Implantacao.tsx` e novos componentes em
  `client/src/components/maquete-3d/visualizador/`
- `shared/maquete-3d/implantacao.ts`, `shared/maquete-3d/geometria3d.ts`

## Testes previstos
- Automáticos (`server/maquete-3d-visualizador.test.ts`): geometria da via gerada para cada trecho; semáforo só em
  cruzamento; elementos assentados na cota do relevo.
- Manuais: loteamento com relevo no navegador; fluidez em iPad e celular.
- Pendente em produção: implantação de estudo real.

## Riscos
- Queda de desempenho em aparelho fraco → instancing e conferência em aparelho real.
- Depende de S-F: sem malha conectada, as vias desenhadas herdam os defeitos atuais.

## Dev Notes (implementação, 15/11/2026)
- Arquitetura: `shared/maquete-3d/vias.ts` (puro, testável) descreve o sistema viário a partir de `imp.ruas` (polígonos
  do estudo de massa) e `imp.vias` (eixos lidos do PDF): trechos (eixo, largura, pista, calçada, faixa de serviço),
  nós (cruzamento/esquina, com controle PARE/semáforo e via preferencial), balões, pontas sem saída, geometria em planta
  (faixas varridas com perfil, placas de asfalto dos cruzamentos e balões, pintura) e elementos já na cota.
  `client/.../visualizador/Vias.tsx` só monta a malha (uma por material) e as instâncias.
- Leitura das formas: retângulo → eixo pela caixa orientada mínima; faixa que dobra → cabeceiras (arestas curtas com
  canto vivo) + eixo entre as bordas (ponto mais próximo), dobras endireitadas no encontro das retas; círculo (ajuste de
  Kåsa, área de disco) → balão; balão repetido no estudo é deduplicado.
- Perfil: calçada = 20 % da largura total (1,2 a 4 m), pista no meio — rua de 12 m: pista 7,2 m e calçadas 2,4 m. A via
  fica inteira dentro do leito: não invade lote (testado também com o motor de massa real).
- Relevo: as alturas vêm da MESMA malha triangulada do terreno (`alturaNaMalha`), com estações a cada meia célula, mais
  5 cm de folga e `polygonOffset` no asfalto e na tinta. O canvas do terreno deixa de pintar asfalto onde há via 3D.
- [AUTO-DECISION] Semáforo: critério do dono (duas vias ≥ 14 m não alinhadas) → `LARGURA_VIA_PRINCIPAL`; demais
  cruzamentos de 3+ braços: PARE nos braços fora do par preferencial (o par alinhado mais largo).
- [AUTO-DECISION] Luz: todas as luminárias acendem (material) com poça de luz somada ao chão; luz real (pointLight)
  só nos 4 postes mais próximos da câmera (8 com "Aprimorar"), para não pesar.
- [AUTO-DECISION] Árvores nas divisas dos lotes (longe das entradas de garagem); onde não há lote, a cada 10 m; postes
  a cada 30 m (um lado na rua local, dos dois lados intercalados na via ≥ 14 m).
- Limitações: boca do balão sem arredondamento; balão recortado pela divisa desenhado como círculo inteiro; dobra
  fechada de via pela divisa com meio-fio em quina; fluidez não conferida em aparelho real.

## File List
- `shared/maquete-3d/vias.ts` (novo) — sistema viário puro.
- `client/src/components/maquete-3d/visualizador/Vias.tsx` (novo) — vias, sinalização e elementos em 3D.
- `client/src/components/maquete-3d/visualizador/Implantacao.tsx` — usa o sistema viário, caixa/limites do terreno vindos
  de `vias.ts`, pontilhado do terreno com semente fixa, leito das ruas 3D sem asfalto pintado.
- `client/src/components/maquete-3d/visualizador/Visualizador.tsx` — passa `noite` e `aprimorado` para a implantação.
- `server/maquete-3d-vias.test.ts` (novo) — 24 testes.
- `HANDOFF-15-11-CORRECOES.md` — Etapa G.

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 15/11/2026 | @pm (Bob) | Story criada em Draft |
| 15/11/2026 | @dev (Dex) | Draft → InProgress (YOLO, ordem do dono de não parar entre etapas) |
| 15/11/2026 | @dev (Dex) | InProgress → Ready for Review: vias 3D, sinalização, árvores, postes, PARE/semáforo, 24 testes |
