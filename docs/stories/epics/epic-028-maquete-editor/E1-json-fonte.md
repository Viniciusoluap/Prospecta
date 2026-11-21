# E1 — JSON-fonte do Lote 4 Qd 18 e validações puras

Status: InReview (Etapa 1 implementada em 21/11/2026; aguarda portão de QA e a revisão do dono)
Epic: EPIC-028 — Maquete fiel à planta com editor de itens (`ETAPA-0-PLANO.md`)
Paridade: Maquete 3D é exceção registrada no `docs/stories/epics/ROADMAP.md` (EPIC-022): nada a portar ao Grupo Santa Fé.
Tamanho: M. Sem banco, sem tela, sem migração, sem IA nem serviço pago.
Branch: `feat/maquete-3d-editor` (commits locais).

## Objetivo
Descrever a casa do Lote 4, Quadra 18 (Vila Esmeralda) num JSON-fonte com `estrutura` travada e `itens` editáveis,
conferido contra a prancha (PDF A0, 1:50), e ter funções puras que acusam qualquer desvio da planta ou item que
bloqueie porta, janela ou passagem.

## Critérios de aceite
- [x] AC1: `data/plantas/lote4-qd18.json` no formato do dono (`lote`, `niveis`, `estrutura.{paredes, aberturas,
      ambientes, cobertura}`, `itens`), com `fonte` em toda medida e `estimado: true` em toda medida sem cota na prancha.
- [x] AC2: estrutura do protótipo mantida, exceto: a "mureta" de 1,19 m sai de `paredes` e vira o item `balcao`
      (x 0,95→2,14, face em z 3,65, altura 1,10 estimada, tampo de 0,40 avançando para a sala); geladeira fora da
      frente da P3 (canto junto ao balcão e ao quarto 1, onde a prancha a desenha); bancada lateral encurtada como na
      prancha; mobília toda em `itens`.
- [x] AC3: `shared/maquete-3d/fonte.ts` — schema zod, tipos e geometria pura (contorno de item girado, retângulo de
      parede, recorte de polígonos, setor de giro de porta).
- [x] AC4: `shared/maquete-3d/validacao-fonte.ts` — `validarFonte()` devolve erros e avisos em português:
      área × quadro (±2%); soma das faixas = 5,00 e 9,45 e cada faixa de parede é uma parede do modelo; contorno da
      casa; paredes ortogonais sem sobreposição indevida (L/T permitidos); abertura cabe na parede (comprimento,
      altura, sem sobrepor outra, vão não tapado); item fora do vão, do giro da folha (quadrante de raio = largura,
      lado `esq|dir`, no ambiente `abre_para`) e da faixa livre de 0,80 m na frente de portas e portões (correr: só vão
      e faixa); item não atravessa parede nem sai do ambiente; item alto (> 1,10 m) não fica sob janela; itens não se
      sobrepõem; balcão da cozinha < 1,20 m e sem parede no trecho dele.
- [x] AC5: testes vitest com caso que passa e caso que falha para cada regra; regressões: geladeira na posição antiga
      → porta P3 bloqueada; mureta recolocada como parede → erro.
- [x] AC6: relatório `ETAPA-1-RELATORIO.md` (cotas, áreas, estimados, divergências e decisões, pendências).

## Fora do escopo (próximas etapas)
Conversor JSON-fonte → `ModeloMaquete` e cena 3D (Etapa 2), banco/editor/versões (Etapa 3), página pública (Etapa 4).

## Decisões
- [AUTO-DECISION] Convenção `esq|dir` → `esq` = dobradiça no começo do vão (lado do `offset`), `dir` = no fim; o lado
  do giro vem de `abre_para` (razão: determinístico e testável; não depende de "olhando de onde").
- [AUTO-DECISION] Paredes no JSON pelo eixo central + espessura, sem prolongar as pontas (razão: reproduz exatamente
  as caixas do protótipo; encontros em L/T ficam como sobreposição permitida).
- [AUTO-DECISION] Faixa livre de 0,80 m em toda a largura do vão, dos dois lados, também na P2 de correr (razão:
  leitura literal da regra; a prancha não diz qual folha da P2 é fixa) → sofá e rack recuados (pendência ao dono).
- [AUTO-DECISION] Cobertura: mantido o telhado do protótipo (20%, platibanda 1,15) e registrada a divergência da
  prancha (25%, platibanda 1,60) para o dono decidir (razão: ordem "a estrutura do protótipo não muda").
- [AUTO-DECISION] Muro da frente pela prancha (PT1 em x 0,20–3,20 e P1 em x 3,70–4,70; lote de 30,00 m) (razão: a
  P1 está no quadro de esquadrias e não cabe com o portão do protótipo em x 1,00–4,00).
- [AUTO-DECISION] Hall com 1,03 × 1,85 (x 2,17–3,20), estimado (razão: 0,91 × 1,85 dá 1,68 m², 11% abaixo do quadro;
  área e perímetro do quadro só fecham com 1,03 m).
- `"balcao"` acrescentado a `TIPOS_MOVEL` (aditivo; a mobília automática não o usa).

## Testes
- (a) Automáticos (21/11/2026): `server/maquete-3d-fonte.test.ts` — 31 testes, todos passando; regressão da Maquete 3D
  que usa `mobilia.ts` (`server/maquete-3d.test.ts`, `server/maquete-3d-padrao.test.ts`,
  `server/maquete-3d-visualizador.test.ts`) — passando (5 arquivos, 95 testes no total da rodada). `npx tsc --noEmit`
  sem erro. O projeto não tem script `lint` no `package.json`.
- (b) Manuais: leitura da prancha por recortes (planta baixa, corte A, corte B, cobertura, quadros, fachada norte).
- (c) Produção: nada nesta etapa.

## File List
- `data/plantas/lote4-qd18.json` (novo)
- `shared/maquete-3d/fonte.ts` (novo)
- `shared/maquete-3d/validacao-fonte.ts` (novo)
- `shared/maquete-3d/mobilia.ts` (alterado: `"balcao"` em `TIPOS_MOVEL`)
- `server/maquete-3d-fonte.test.ts` (novo)
- `docs/stories/epics/epic-028-maquete-editor/ETAPA-0-PLANO.md` e `referencia/maquete-prototipo.html` (trazidos da
  branch `claude/wip-epic028-plano`)
- `docs/stories/epics/epic-028-maquete-editor/ETAPA-1-RELATORIO.md` (novo)
- `docs/stories/epics/epic-028-maquete-editor/E1-json-fonte.md` (esta story)

## Change Log
- 21/11/2026 — @dev (Dex): Ready → InProgress → InReview. Etapa 1 implementada (JSON-fonte, validações, testes, relatório).
