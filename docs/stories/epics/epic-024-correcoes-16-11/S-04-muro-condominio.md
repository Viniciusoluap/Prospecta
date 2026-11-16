# S-04 — Maquete 3D: muro de divisa do condomínio

Status: InReview
Epic: EPIC-024 (Fase 4) — correção 04 do dono (16/11/2026)
Paridade: Maquete 3D — exceção já registrada no `ROADMAP.md` (EPIC-022). Não portar.
Tamanho estimado: M
Migração: nenhuma (campos opcionais no JSON do modelo; `VERSAO_MODELO` continua 1).

## Problema

Com "Condomínio" escolhido, a maquete não tem muro: o condomínio só difere da casa na validação
(`shared/maquete-3d/modelo.ts`, `validarModelo`). O dono quer o muro de divisa gerado sozinho em todo o contorno
externo do terreno, como geometria 3D de verdade (não um desenho 2D nem uma linha), com portão de acesso, sem muro
entre lotes, e editável.

## Critérios de aceite
- [x] AC1: com "Condomínio", o muro é gerado automaticamente em todo o contorno externo do terreno (KML/KMZ ou implantação).
- [x] AC2: o muro tem altura e espessura e é modelado em 3D (malha extrudada), com materiais e textura.
- [x] AC3: acompanha contornos irregulares e côncavos (cantos fechados), por dentro da divisa, nos dois sentidos de desenho.
- [x] AC4: há abertura para o portão de acesso, no lugar onde a rua sai do terreno; nunca há muro no corredor dessa rua.
- [x] AC5: ruas, lotes e construções são preservados; não há muro entre lotes.
- [x] AC6: o muro aparece na Implantação, na Vista de cima, em perspectiva, no link público e na foto em alta.
- [x] AC7: as características do muro podem ser editadas (ligar/desligar, altura, espessura, recuo, acabamento, cor, portões).
- [x] AC8: "Casa" não tem muro obrigatório; "Condomínio" tem muro geral obrigatório (erro de validação se desligado e houver contorno).
- [x] AC9: sem contorno do terreno (maquete de Projeto), nada é inventado: a tela e a validação dizem que não há onde levantar o muro.

## Tarefas
- [x] T1: modelo — `muroSchema`/`portaoMuroSchema`, `implantacao.muro` e `implantacao.acessos` opcionais; `muroDaMaquete`, `muroParaTipo`, `muroPadraoDoTipo`; validação.
- [x] T2: geometria pura `shared/maquete-3d/muro.ts` — anel orientado, meias-esquadrias, estações no relevo, aberturas, capa, pilastras, pilares e portão; malhas juntas por material; resumo 2D.
- [x] T3: portão automático (`portoesAutomaticos`) — acesso do estudo de massa, ponta de rua na divisa ou ponto mais perto da rua principal, com nota.
- [x] T4: `implantacaoDoEstudo` guarda os acessos da malha; `aplicarTipo` e "Atualizar a implantação a partir do estudo" aplicam o muro do tipo e mantêm o editado.
- [x] T5: visualizador — `visualizador/Muro.tsx` (texturas por código, sombras), ligado em `Implantacao.tsx`/`Visualizador.tsx`.
- [x] T6: edição — `EditorMuro.tsx` na revisão da planta, gravado por "Salvar planta" (trava de versão de `salvarModelo`).
- [x] T7: testes `server/maquete-3d-muro.test.ts`; suítes da maquete, `tsc`, `vite build`.
- [x] T8: conferência visual com Playwright (vista de cima e perspectiva).

## Dev Notes (implementação, 16/11/2026)
- Modelo: `implantacao.muro = { ativo, editado, altura 1,8–4 (2,5), espessura 0,10–0,50 (0,20), recuo 0–3 (0), acabamento
  (reboco/bloco/tijolo/pedra), cor, portoesEditados, portoes[{ id, posicao, largura, tipo veiculos|pedestres }] }`.
  `posicao` = metros ao longo da divisa a partir do vértice 1, no sentido do desenho. Ausente/nulo = padrão do tipo:
  maquete antiga de condomínio já abre com o muro automático, sem migração.
- [AUTO-DECISION] Campos `acessos` e `muro` são `.optional()` (sem `.default`) → o tipo `Implantacao` continua aceitando
  objetos montados à mão (`server/maquete-3d/leitura.ts`, que está com outro agente e não foi tocado).
- [AUTO-DECISION] Portão automático: só UM (o acesso principal — portaria de condomínio fechado). Ordem: acesso com via
  pública mapeada (mais perto dela) → rua mais larga → mais perto do centro. Os outros acessos aparecem na tela como
  "Outros acessos de rua na divisa", com botão para abrir portão também neles. Largura = leito da rua (pista +
  calçadas, 3–20 m) dividido pelo seno do ângulo com a divisa, mais 30 cm de folga de cada lado. Centro = onde o
  eixo da rua corta a linha do muro (não a divisa), para o vão ficar alinhado mesmo com recuo.
- [AUTO-DECISION] Relevo: estações a cada 2 m (e nas bordas dos portões); o pé de cada face fica na cota da MESMA malha
  do terreno do visualizador (`alturaNaMalha`) menos 30 cm de fundação; o topo segue o chão a altura constante
  (muro "inclinado", sem degraus) — barato e sem frestas.
- Cantos: deslocamento por meia-esquadria (limitada a 4× nas pontas agudas). Nas arestas, as estações são levadas às
  linhas de dentro/de fora no esquadro; perto de canto convexo param no canto, num reentrante vão até a esquadria.
  Contorno denso (KML) tem pontos alinhados retirados (desvio < 2 cm) e o muro fica 2,5 cm para dentro da divisa
  (`FOLGA_DIVISA`), para a corda nunca passar dela.
- Portão de veículos de correr, desenhado aberto (estacionado por dentro, junto do muro) para a rua ficar livre;
  pedestres: folha fechada entre os pilares. Pilares do portão só engrossam para dentro (face de fora alinhada).
- Desempenho: três malhas (corpo, capa, portão), uma chamada de desenho cada; 4.000 pontos ≈ 33 mil vértices em ~0,15 s.

## Testes
- (a) Automáticos: `server/maquete-3d-muro.test.ts` (13) — ver File List e o HANDOFF.
- (b) Manuais: navegador automatizado (Playwright + SwiftShader), capturas em vista de cima e perspectiva.
- (c) Pendentes em produção: estudo real de condomínio com KML de verdade; celular/iPad real; tela de edição do
  muro aberta por uma pessoa.

## File List
- `shared/maquete-3d/modelo.ts` — esquema do muro e dos portões, acessos da implantação, regras do tipo, validação.
- `shared/maquete-3d/muro.ts` (novo) — geometria pura do muro e portões automáticos.
- `shared/maquete-3d/implantacao.ts` — guarda os acessos da malha à divisa vindos do estudo de massa.
- `server/maquete-3d/router.ts` — `aplicarTipo` e `implantacaoDoEstudo` aplicam `muroParaTipo`.
- `client/src/components/maquete-3d/visualizador/Muro.tsx` (novo) — malhas e materiais do muro.
- `client/src/components/maquete-3d/visualizador/Implantacao.tsx` — desenha o muro.
- `client/src/components/maquete-3d/visualizador/Visualizador.tsx` — passa o muro que vale (`muroDaMaquete`).
- `client/src/components/maquete-3d/EditorMuro.tsx` (novo) — edição do muro e dos portões.
- `client/src/pages/admin/AdminMaquete3D.tsx` — editor do muro na revisão da planta.
- `server/maquete-3d-muro.test.ts` (novo) — 13 testes.

## Change Log
| Data | Autor | Mudança |
|---|---|---|
| 16/11/2026 | Dex (@dev) | Story criada a partir da correção 04 do EPIC-024; Status Ready → InProgress. |
| 16/11/2026 | Dex (@dev) | Implementação concluída (modelo, geometria, visualizador, edição, testes, conferência visual); Status InProgress → InReview. |
