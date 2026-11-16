# S-I — APP e áreas restritas com o contorno real no Estudo de Massa

Status: InProgress
Epic: EPIC-023 (Etapa I) — apontado pelo dono em 16/11/2026, com imagem do ImperaCity: "essa parte que eu circulei foi
identificada como área de APP, e no desenho foi colocado um monte de lote ali onde deveria ser outra coisa".
Paridade: Estudo de Massa não é exceção — entra na lista de porte ao Grupo Santa Fé (arquivada por decisão do dono).
Tamanho estimado: G
Dependência: S-F (motor de malha conectada) e a regra das áreas restritas nas doações (16/11).

## Problema

O mapa do Terreno calcula a APP com o contorno real (`calcularApp` em `shared/geo/camadas-terreno.ts` devolve a
`faixa`), mas só a ÁREA em m² é gravada (`incorporation_studies.app_area_m2`). O motor do Estudo de Massa recebe só o
número: reserva o tamanho certo de área verde, mas em qualquer lugar, e desenha lotes e ruas em cima da APP de verdade.

## Critérios de aceite
- [ ] AC1: o contorno da APP calculado no mapa do Terreno fica gravado no estudo (migração aditiva).
- [ ] AC2: o motor não desenha lote nem rua dentro da APP: ela sai da área loteável pelo contorno real.
- [ ] AC3: a APP aparece no desenho na posição real, identificada como APP, com o destino escolhido na tela (conta
      como área verde, como institucional, ou só não parcelável) — sem contar duas vezes no quadro de áreas.
- [ ] AC4: o quadro de áreas continua fechando em 100% da gleba; a regra de aproveitamento (APP abate a área verde
      exigida) continua valendo.
- [ ] AC5: estudo antigo sem o contorno gravado continua funcionando como hoje (só m²), com aviso claro dizendo para
      abrir o mapa do Terreno para o sistema guardar o contorno.
- [ ] AC6: KML com várias áreas e furos continua funcionando; APP que corta a gleba em pedaços também.
- [ ] AC7: a maquete 3D montada do estudo mostra a APP como área verde no lugar certo.
- [ ] AC8: testes automáticos com terreno e APP sintéticos (nenhum lote ou via com interseção relevante com a APP).

## Tarefas
- [ ] T1: migração `0117` (coluna de texto para o contorno), `saveApp` recebendo a geometria, `EstudoData`.
- [ ] T2: motor — opção de restrições com geometria; recorte da gleba; lotes de APP no resultado; quadro de áreas.
- [ ] T3: aba Estudo de Massa passa a geometria; aviso para estudo sem contorno; planta técnica identifica a APP.
- [ ] T4: testes; conferência com o ImperaCity e o Cajueiro reais (fora do repositório).
- [ ] T5: QA, HANDOFF, migração no Neon, publicação.

## Arquivos principais
- `drizzle/0117_*.sql`, `drizzle/schema.ts`, `server/routers.ts` (`saveApp`), `shared/incorporacao/estudo-data.ts`
- `shared/incorporacao/massa.ts`, `shared/incorporacao/massa-quadro-areas.ts`, `shared/incorporacao/planta-tecnica.ts`
- `client/src/components/incorporacao/estudo/{mapa-terreno,massa-tab,executar-massa}.ts(x)`, `massa.worker.ts`
- `shared/maquete-3d/implantacao.ts`
