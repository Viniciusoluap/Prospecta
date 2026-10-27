# Checkpoint — grupo incorporacao-core (correções 06, 08, 10, 11 · AD-03, AD-04)

Agente: Dex (@dev) · branch `claude/lote2-22-correcoes-20261027` (nos dois repos) · sem commit (orquestrador commita; checkpoint 3d0d3fa já contém etapas 1–2).

## Estado
- [x] Etapa 1 — funções puras + testes (Prospecta)
  - `shared/incorporacao/massa.ts`: tipologia grid/cul-de-sac (via-tronco + ruas sem saída com balão, recortado à poligonal), restrições não parceláveis nos parâmetros (APP, supressão, faixa de transmissão, faixa de servidão, outras), doações sobre a área parcelável separadas em institucional/verde, numeração quadra/lote dos vendáveis, `quadroAreas`, `inviabilidade`, `limitacoes`, `ROTULO_ESTUDO_PRELIMINAR`. Projeção métrica local (equiretangular em metros) confirmada — `criarProjecao`.
  - `shared/incorporacao/massa-quadro-areas.ts`: `calcularQuadroAreasMassa` (pura, sem dupla subtração) + `linhasQuadroAreas`.
  - `shared/incorporacao/lotes-avulsos.ts`: lotes avulsos (sem KML), `terrenoLiberado`, `AVISO_SEM_POLIGONAL`, `prepararLotesAvulsosParaGravar`.
  - `shared/incorporacao/estudos-massa.ts`: regras dos estudos salvos + **`cenarioPrincipalDe`** (consulta do cenário principal).
  - Testes: `server/incorporacao-massa-lote2.test.ts` (21) + `server/incorporacao-massa.test.ts` (25) — passando.
- [x] Etapa 2 — servidor (Prospecta)
  - `drizzle/0084_incorporacao_sem_kml_estudos_salvos.sql` (não aplicada): colunas `sem_kml`, `loose_lots_json`, `responsible_user_id`; tabela `incorporation_mass_studies` (RLS habilitado).
  - `drizzle/schema.ts`: colunas + `incorporationMassStudies`.
  - `server/incorporacao-estudos-massa-router.ts` (`incorporacao.massStudies.{list,get,save,setPrincipal,delete,principal}`) + `obterCenarioPrincipal(studyId)`.
  - `server/routers.ts`: `saveSemKml`, `saveLotesAvulsos`, `responsibleUserId` em create/update; `server/db.ts`: `getIncorporationStaff` (+ `role`, `engenheiro`), `resolveIncorporationResponsible`.
- [x] Etapa 3 — UI Prospecta
  - [x] `compat/acoes.ts`: salvarSemKml, salvarLotesAvulsos, listar/abrir/salvar/marcarPrincipal/excluir estudos de massa
  - [x] `camadas-base.ts` (Esri World Imagery + ruas/rótulos Esri + alternância OSM + escala) usado em `mapa-terreno.tsx` e `mapa-massa.tsx` (Stamen removido — serviço desativado)
  - [x] `mapa-massa.tsx`: cores por destinação, balões, tooltip quadra/lote
  - [x] `massa-tab.tsx`: tipologia, restrições, rótulo preliminar, quadro de áreas, inviabilidade, salvar/nova versão/novo, Estudos Salvos (abrir, principal, excluir c/ confirmação), aviso sem poligonal
  - [x] `lotes-avulsos-editor.tsx` (novo: `SemKmlToggle` + CRUD de lotes avulsos) usado em `terreno-tab.tsx`
  - [x] `incorporacao-detail.tsx`: gating por `terrenoLiberado` (inclui Relatório Executivo); `topografia-tab.tsx`: aviso sem poligonal
  - [x] `AdminIncorporacaoDetail.tsx` (Dados Gerais: "Nome do empreendimento", Responsável = select admin/colaborador/engenheiro salvo por ID, 4 campos removidos do formulário) e `AdminIncorporacao.tsx` (diálogo de criação: mesmo rótulo e select)
  - [x] `relatorio-tab.tsx`: rótulo "Estudo preliminar…" na seção de massa do PDF
  - Testes: `pnpm vitest run server/incorporacao` → 29 arquivos / 242 testes OK; `tsc --noEmit` limpo nos meus arquivos (erros restantes só em `server/caixa/pci-gerador.ts`, de outro agente)
- [ ] Etapa 4 — porte SF (migração `20261027120000_incorporacao_estudos_salvos`, prisma, actions, UI)
- [ ] Etapa 5 — typecheck + testes nos dois repos

## Cenário principal (para ondas 12, 15, 20)
- Prospecta: `obterCenarioPrincipal(studyId)` em `server/incorporacao-estudos-massa-router.ts`; tRPC `incorporacao.massStudies.principal({ studyId })`.
- Retorno `CenarioPrincipal` (`shared/incorporacao/estudos-massa.ts`): `{ origem: "estudo_salvo"|"legado"|"lotes_avulsos", estudoSalvoId, nome, versao, cenarioId, tipologia, precoM2Lote, lotes: [{quadra, lote, areaM2, testadaM, profundidadeM}], quadroAreas }`.
- Precedência: estudo salvo principal → colunas legadas → lotes avulsos (sem KML).

## Decisões
- [AUTO-DECISION] Restrições sem geometria → conversão proporcional dos menores lotes em "não parcelável" (área dos lotes × fração restrita), mantendo desenho e números coerentes.
- [AUTO-DECISION] Principal sem índice único parcial; troca num único UPDATE (`is_principal = (id = alvo)`) + espelho legado no mesmo comando CTE.
- [AUTO-DECISION] Espelho do principal inclui `product_mix_json` (SF `mixJson`) ao marcar/salvar principal.
- [AUTO-DECISION] Excluir o principal só é bloqueado se houver unidades/orçamento parametrizado/viabilidade; sem dependentes, limpa o espelho legado (massa + cenário escolhido).
- Estudos antigos: na 1ª listagem, colunas legadas viram "Estudo anterior (importado)" principal (INSERT condicional idempotente).
- Matrícula/CAR/Zoneamento: saem do formulário; colunas e relatório executivo preservados (update não envia mais esses campos).

## Próximo passo
Etapa 4 — porte SF: copiar `massa.ts` → `web/src/lib/geo/massa.ts` (imports @turf/* separados), puros → `web/src/lib/incorporacao/{massa-quadro-areas,lotes-avulsos,estudos-massa}.ts`, prisma (EstudoIncorporacao: semKml, lotesAvulsosJson, responsavelId; model EstudoMassaSalvo), migração `20261027120000_incorporacao_estudos_salvos`, actions em `web/src/lib/actions/incorporacao.ts` (+ `obterCenarioPrincipal`), componentes em `web/src/app/admin/incorporacao/_components/`, `editar/page.tsx`, `novo/page.tsx`, `[id]/page.tsx`.
