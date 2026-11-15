# S-F — Estudo de Massa: KML com várias áreas e malha viária conectada, sem sobras em branco

Status: Draft
Epic: EPIC-023 (Etapa F) — correções 8 e 10 do dono (15/11/2026)
Paridade: **portar ao Grupo Santa Fé**.
Tamanho estimado: GG (maior risco do epic)
Bloqueios: decisão 1 do dono (publicar fora do EPIC-022).

## Problema

- Correção 8: KML com áreas separadas impede o estudo. O erro está em
  `client/src/components/incorporacao/estudo/massa-tab.tsx:202-204`, e o motor `gerarEstudoMassa`
  (`shared/incorporacao/massa.ts:833`) recebe um único anel; furos são ignorados.
- Correção 10: os cenários geram ruas sem conexão (loteamento morto), áreas perdidas junto à divisa sem lote nem via e
  não se ligam às ruas existentes do mapa. Causas: grade, cul-de-sac e rua simples retangular descartam o retângulo
  que cruza a divisa (`massa.ts:373`; `rua-simples.ts:144`); não há verificação de conectividade (`corredoresGrade`,
  :439-483); AV/INST/não parcelável são marcados nos lotes menores (`classificar`, :569-587), sem geometria própria;
  notas dizem que "ligação com vias externas não é modelada" (`massa.ts:426-431` e outras); rótulos sem detecção de
  colisão (`shared/incorporacao/planta-tecnica.ts:208-233`). As vias do OSM no entorno já existem em
  `normalizarOverpass` (`shared/geo/camadas-terreno.ts:355`) e não são usadas pelo motor.

O dono pede: nada pode ficar em branco; tudo preenchido, calculado e com lógica.

## Critérios de aceite

### Correção 8
- [ ] AC1: KML com várias áreas separadas não gera erro; o estudo é gerado para todas as áreas.
- [ ] AC2: furos do polígono são respeitados (não recebem lote nem via).
- [ ] AC3: os consumidores aceitam o resultado com várias áreas: planta técnica, mapa da massa,
      `shared/incorporacao/unidades.ts`, orçamento (`orcamento-parametrizado-tab.tsx:53`) e
      `shared/maquete-3d/implantacao.ts` (hoje usa o anel com mais vértices, :44).

### Correção 10
- [ ] AC4: malha viária conectada é regra obrigatória: toda via interna se liga, direta ou indiretamente, a uma via
      existente do entorno (vias do OSM de `normalizarOverpass`); cenário com via isolada não é entregue.
- [ ] AC5: lotes que cruzam a divisa são recortados por ela, em vez de descartados.
- [ ] AC6: sobras que não formam lote viram área verde, área institucional ou via, com geometria própria desenhada
      e somada no quadro de áreas (não mais marcadas sobre os lotes menores).
- [ ] AC7: soma das áreas (lotes + vias + verde + institucional + não parcelável) = 100% da área do terreno, com
      teste automatizado e tolerância declarada no teste.
- [ ] AC8: as notas de "ligação com vias externas não é modelada" deixam de existir porque a ligação passa a ser
      modelada.
- [ ] AC9: rótulos da planta técnica não se sobrepõem (detecção de colisão) e continuam legíveis.
- [ ] AC10: vale para todas as tipologias afetadas (grade, cul-de-sac, rua simples e as que usam o mesmo recorte).

## Tarefas
- [ ] T1: aceitar várias áreas e furos na entrada (`massa-tab.tsx`) e no motor (`gerarEstudoMassa`).
- [ ] T2: adaptar consumidores para várias áreas (AC3).
- [ ] T3: entrada das vias existentes do OSM no motor.
- [ ] T4: malha conectada obrigatória com verificação de conectividade.
- [ ] T5: recorte de lotes pela divisa (`massa.ts:373`, `rua-simples.ts:144`).
- [ ] T6: sobras → verde/institucional/via com geometria; ajuste de `classificar`.
- [ ] T7: teste de soma = 100%.
- [ ] T8: detecção de colisão de rótulos em `planta-tecnica.ts`.
- [ ] T9: revisar os ~124 testes atuais do motor; registrar no HANDOFF cada teste cuja expectativa mudou e por quê.
- [ ] T10: suíte, `pnpm check`, `vite build`; HANDOFF; pendência de porte.

## Arquivos principais
- `shared/incorporacao/massa.ts`, `shared/incorporacao/rua-simples.ts`, `shared/incorporacao/planta-tecnica.ts`,
  `shared/incorporacao/unidades.ts`
- `shared/geo/camadas-terreno.ts`, `shared/maquete-3d/implantacao.ts`
- `client/src/components/incorporacao/estudo/massa-tab.tsx`, `mapa-massa`, `orcamento-parametrizado-tab.tsx`

## Testes previstos
- Automáticos: `server/incorporacao-massa.test.ts`, `server/incorporacao-massa-lote2.test.ts` revistos; novos:
  KML com duas áreas e com furo; conectividade de todas as vias; lote recortado na divisa; soma = 100% em todas as
  tipologias; rótulos sem sobreposição.
- Manuais: cenários com os KML reais do dono, conferidos na planta técnica e no mapa.
- Pendente em produção: estudos reais já salvos abertos com o motor novo.

## Riscos
- Regressão no motor central da Incorporação e em todos os consumidores → AC3, revisão dos testes, conferência visual.
- Mudança de números em estudos já salvos → registrar no HANDOFF que cenários regenerados podem diferir dos antigos.
- Sem vias do OSM no entorno (fonte fora do ar ou área sem dados) → depende da Etapa E; o comportamento nesse caso
  precisa ficar explícito na tela.

## File List
_(vazio — preencher na implementação)_

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 15/11/2026 | @pm (Bob) | Story criada em Draft |
