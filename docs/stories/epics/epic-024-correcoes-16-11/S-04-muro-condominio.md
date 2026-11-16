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
- `server/maquete-3d-muro.test.ts` (novo) — 29 testes (16 do QA loop).
- `server/maquete-3d.test.ts` — teste de router do muro (QA loop).
- `shared/maquete-3d/vias.ts` — limites da implantação contam as áreas extras (QA loop).
- `client/src/components/maquete-3d/EditorPlanta.tsx` — desenha as áreas extras do terreno (QA loop).

## QA Results

### Gate 1 (16/11/2026, @qa) — CONCERNS
Código sólido (sem exceção nem NaN em contornos hostis, cantos fechados, portão no eixo da rua), com 3 pontos médios e
4 leves. Correções do @dev (QA loop, 16/11/2026), cada uma com teste:

| # | Achado | Correção | Commit |
|---|---|---|---|
| M1 | KML com várias áreas: muro só na maior, lotes das outras sem muro e sem aviso | `implantacao.terrenosExtras` (opcional; a maior continua em `terreno`, então todo leitor antigo segue igual); um muro por área, cada uma com o seu portão automático; `portao.area` (ausente = 0); editor lista os portões por área; maquete antiga com lote fora do `terreno` e sem áreas extras ganha aviso "Atualize a implantação a partir do estudo" | 889e5d4, 97c256b, 7711e78 |
| M2 | Link publicado mudaria sem revisão | `porToken` devolve `modeloParaLinkPublico` (muro ausente = desligado: o link fica como foi publicado); `salvarModelo` e `publicar` gravam o muro que vale (`comMuroGravado`); a tela mostra "Condomínio publicado antes do muro: revise e publique de novo para o cliente ver o muro" (`publicadoSemMuro`) | 97c256b |
| M3 | Segunda rua que chega à divisa era murada | Regra corrigida pelo coordenador (ver abaixo): portão automático só nos acessos reais; as outras ruas que terminam na divisa são fechadas pelo muro, listadas no editor ("Rua termina no muro" + "Abrir portão aqui") e contadas em UM aviso da validação. Nunca há muro no corredor de rua com portão | 889e5d4, 7711e78, (ver "Regra dos portões") |
| L4 | Lascas de muro fora do terreno; gravata-borboleta sem muro e sem mensagem | Todo vértice que sai é levado ao ponto mais perto da divisa (índice por faixas); nota "o muro foi afinado"; contorno sem área = ERRO de validação claro; contorno que se cruza com área = aviso | 889e5d4, 5a94074 |
| L5 | Frestas de 17 cm / 13,6 cm sob o muro em relevo íngreme | Estações também onde cada face cruza as arestas da malha do terreno (o pé segue a malha exatamente) e fundação de 0,5 m (`ENTERRO_MURO`) | 889e5d4 |
| L6 | Portões editados guardados em metros do vértice 1 sobreviviam à mudança do contorno | `muro.contorno` (assinatura) gravado ao editar; "Atualizar a implantação" leva cada portão ao ponto da nova divisa mais perto da posição anterior, marca `reancorado` (aviso na validação e na tela, com "Conferi os portões"); planta do editor mostra o vértice 1 de cada área, a portaria (■) e os secundários (▲) | 97c256b, 7711e78 |
| L7 | Campo numérico limitava a cada tecla | Limita só ao sair do campo ou com Enter (`numeroConfirmado`) | 7711e78, 9af4895 |

Sondas do QA (`probe.mts`, `probe2.mts`) antes → depois: agulha 5,9 cm → 0; ponta de 3° 1,6 cm → 0; fechadura 46 cm → 0;
faixa de 0,3 m 16,5 cm → 0; serrilhado 17,6 cm → 0; vértices de muro no corredor da 2ª rua 74 → 0; vala a 45° 17,3 cm → 0;
barranco 2:1 13,6 cm → 0. Desempenho: contorno de 4.000 pontos ~65 ms; serrilhado hostil 4.000 pontos 271 → ~585 ms
(conferência do contorno), dentro do orçamento do teste (2,5 s).

### Regra dos portões (decisão do coordenador, 16/11/2026 — substitui a primeira versão do item M3)
Condomínio é fechado por definição. Na grade do estudo de massa as ruas vão "de divisa a divisa" e terminam na divisa
por recorte: isso NÃO é acesso.
1. Abertura automática só nos acessos reais: os pontos do estudo de massa ligados a uma via pública mapeada
   (`acessos[].viaExistente`, via a até 40 m — `DISTANCIA_MAX_ACESSO_M` em `shared/incorporacao/massa.ts`; o nome da
   via vem em `nomeVia`). O mais perto da via é a portaria; os outros acessos reais, portões secundários.
2. Sem acesso real: UMA portaria no ponto da divisa mais perto da rua principal (a mais larga das que chegam à divisa;
   sem nenhuma, a mais larga de todas), com nota para conferir a posição.
3. As outras ruas que só terminam na divisa são fechadas pelo muro (ruas sem saída dentro do condomínio). O editor as
   lista ("Rua termina no muro" + "Abrir portão aqui") e a validação mostra UM aviso com a contagem — não é erro.
4. Nunca há muro no corredor de uma rua que leva a um portão que exista (portaria ou secundário) — com teste.
Resultado: o estudo de massa real (grade) do teste passa de 12 aberturas para 1 portaria (não há acesso real).

Testes: `server/maquete-3d-muro.test.ts` 29 (16 novos); `server/maquete-3d.test.ts` +1 teste de router (duas áreas,
portões reposicionados, link publicado sem muro, salvar grava o muro). `npx vitest run server/maquete-3d
server/auth-session.test.ts server/imports-esm.test.ts`: 8 arquivos, 158 testes passam. `tsc` e `vite build` sem erro.
Capturas: `aereo-duas-areas-duas-ruas.png` e `portaria-e-secundario.png` (pasta de rascunho da sessão, `s04/`).

## Change Log
| Data | Autor | Mudança |
|---|---|---|
| 16/11/2026 | Dex (@dev) | Story criada a partir da correção 04 do EPIC-024; Status Ready → InProgress. |
| 16/11/2026 | Dex (@dev) | Implementação concluída (modelo, geometria, visualizador, edição, testes, conferência visual); Status InProgress → InReview. |
| 16/11/2026 | Dex (@dev) | QA loop 1: correções M1–M3 e L4–L7 do gate CONCERNS, com testes; segue InReview para o re-gate. |
| 16/11/2026 | Dex (@dev) | Regra dos portões corrigida (condomínio fechado: portão só nos acessos reais; ruas que terminam na divisa fechadas, com UM aviso). |
