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
- [x] AC1: o contorno da APP calculado no mapa do Terreno fica gravado no estudo (migração aditiva).
- [x] AC2: o motor não desenha lote nem rua dentro da APP: ela sai da área loteável pelo contorno real.
- [x] AC3: a APP aparece no desenho na posição real, identificada como APP, com o destino escolhido na tela (conta
      como área verde, como institucional, ou só não parcelável) — sem contar duas vezes no quadro de áreas.
- [x] AC4: o quadro de áreas continua fechando em 100% da gleba; a regra de aproveitamento (APP abate a área verde
      exigida) continua valendo.
- [x] AC5: estudo antigo sem o contorno gravado continua funcionando como hoje (só m²), com aviso claro dizendo para
      abrir o mapa do Terreno para o sistema guardar o contorno.
- [x] AC6: KML com várias áreas e furos continua funcionando; APP que corta a gleba em pedaços também.
- [x] AC7: a maquete 3D montada do estudo mostra a APP como área verde no lugar certo.
- [x] AC8: testes automáticos com terreno e APP sintéticos (nenhum lote ou via com interseção relevante com a APP).

## Tarefas
- [x] T1: migração `0117` (coluna de texto para o contorno), `saveApp` recebendo a geometria, `EstudoData`.
- [x] T2: motor — opção de restrições com geometria; recorte da gleba; lotes de APP no resultado; quadro de áreas.
- [x] T3: aba Estudo de Massa passa a geometria; aviso para estudo sem contorno; planta técnica identifica a APP.
- [x] T4: testes; conferência com o ImperaCity e o Cajueiro reais (fora do repositório).
- [ ] T5: QA, HANDOFF, migração no Neon, publicação.

## Arquivos principais
- `drizzle/0117_*.sql`, `drizzle/schema.ts`, `server/routers.ts` (`saveApp`), `shared/incorporacao/estudo-data.ts`
- `shared/incorporacao/massa.ts`, `shared/incorporacao/massa-quadro-areas.ts`, `shared/incorporacao/planta-tecnica.ts`
- `client/src/components/incorporacao/estudo/{mapa-terreno,massa-tab,executar-massa}.ts(x)`, `massa.worker.ts`
- `shared/maquete-3d/implantacao.ts`

## Notas de implementação (16/11)
- Motor: `gerarEstudoMassa(..., { restricoes: [{ tipo: "app", poligonos }] })`. As restrições com contorno são recortadas
  pela gleba (sem sobreposição entre tipos), tiradas da área loteável e as partes que sobram são loteadas como áreas
  contínuas (mesmo caminho do KML com várias áreas). A peça entra no resultado com `restricao: "app"` e o destino
  escolhido; o m² vem do contorno (o `appM2` dos parâmetros é substituído, com nota). O mínimo de área verde/institucional
  continua sobre a área parcelável da gleba inteira, e a APP aproveitada abate o mínimo.
- Sem contorno, o resultado é idêntico ao de antes (conferido byte a byte nos estudos reais 1, 4, 5 e 6).
- AC7: a maquete recebe a APP como lote não vendável `uso: "verde"`, nome "APP" (também quando o destino é "só não
  parcelável"). Furos da peça não são desenhados na maquete (o modelo 3D não tem furo em lote).
- T5 (QA, HANDOFF, migração 0117 no Neon e publicação) fica com o líder. A migração tem de ir ao Neon ANTES do código:
  `getIncorporationStudyById` faz `select *` e a coluna nova precisa existir.

## QA loop — iteração 1 (16/11)
- Trocar o KML (`uploadKml`) apaga o contorno da APP (a área fica até o mapa do Terreno recalcular a do terreno novo).
- `saveApp`: `contorno` ausente (cliente antigo) mantém o gravado, salvo se a área mudar mais de 2%; `null` apaga
  (`server/incorporacao-app-contorno.ts`).
- Contorno vazio, inválido ou fora da gleba: o motor usa o m² informado e avisa para reabrir o mapa do Terreno (nunca
  zera a APP em silêncio).
- Cada cenário leva a marca do contorno com que foi gerado (`contornoRestricoes`); a aba avisa "cenários gerados sem o
  contorno da APP — gere de novo" no lugar da faixa verde, e marca o estudo principal salvo. A assinatura do resultado
  inclui o contorno.
- A aba mede a APP dentro da gleba como o motor (`medirRestricoesNaGleba`); se der 0, mostra o aviso âmbar.
- `contornoAppParaGravar` simplifica até ~50 m e, no limite, descarta furos e peças menores — sempre guarda um contorno
  para uma APP válida; se nada couber, o mapa do Terreno avisa que o contorno é complexo demais.
- Acesso: parte cercada pela APP, ou com as vias mapeadas do outro lado dela, tem nota de que o acesso exige atravessar
  a APP (licença ambiental); ponto na borda da APP não conta como acesso pela divisa.
- Maquete: peça com furo (APP em volta de uma parte loteável) é cortada em pedaços sem furo.
- Diferença conhecida (item 7 do QA): a APP aparece com três números próximos — o do mapa do Terreno (área geodésica do
  turf, ex.: ImperaCity 122.055 m² só com OSM), o gravado em `app_area_m2` (o mesmo cálculo com ANA + OSM, 124.304 m²) e
  o do motor (projeção plana local, 121.472 m², ~0,5% abaixo do geodésico). O quadro de áreas e a aba usam o do motor.

## File List
- `drizzle/0117_contorno_app_estudo.sql` (novo), `drizzle/schema.ts`
- `server/routers.ts` (`saveApp` recebe `contorno`)
- `shared/incorporacao/estudo-data.ts` (`appContornoJson`)
- `shared/geo/camadas-terreno.ts` (`noTerreno` no `calcularApp`, `contornoAppParaGravar`, `MAX_VERTICES_CONTORNO_APP`)
- `shared/incorporacao/massa.ts` (restrições com geometria, recorte, composição, assinatura)
- `shared/incorporacao/planta-tecnica.ts` (rótulo "APP", cor e legenda)
- `shared/maquete-3d/implantacao.ts`, `client/src/components/maquete-3d/visualizador/Implantacao.tsx`
- `client/src/components/incorporacao/estudo/{mapa-terreno.tsx,massa-tab.tsx,executar-massa.ts,massa.worker.ts,mapa-massa.tsx,compat/acoes.ts}`
- `server/incorporacao-massa-app-geometria.test.ts` (novo), `server/incorporacao-app-contorno.ts` (novo),
  `server/incorporacao-app-contorno.test.ts` (novo)
