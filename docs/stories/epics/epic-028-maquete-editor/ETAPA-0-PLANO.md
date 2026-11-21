# EPIC-028 — Maquete fiel à planta com editor de itens — ETAPA 0 (plano)

Data: 21/11/2026 · Autor: @architect (Aria) · Base lida: `origin/main` em `ebd78d7` (#278)
Situação: **plano, só leitura**. Nenhum código, branch ou banco foi alterado. Aguarda o "autorizo" do dono para a Etapa 1.
Paridade: a Maquete 3D é **exceção registrada** no `docs/stories/epics/ROADMAP.md` (EPIC-022, reconfirmada em 17/11/2026):
nada a portar ao Grupo Santa Fé.

Pedido (resumo): maquete 3D fiel à planta da casa do **Lote 4, Qd 18, Vila Esmeralda** (casa 5,00 × 9,45 m, lote 5 × 30 m),
gerada a partir de um JSON-fonte `data/plantas/lote4-qd18.json` com `estrutura` travada (paredes, aberturas, ambientes,
cobertura) e `itens` editáveis (móveis, bancadas, balcão); modos visão geral em corte, tour por cômodo a 1,60 m e planta
2D com cotas; modo edição só para admin com regras que bloqueiam salvar; itens versionados (rascunho × publicado);
rota pública `/maquete/<empreendimento>/<lote>` com status do lote só leitura e botão de WhatsApp; validações
automáticas; duas correções na cozinha (balcão americano no lugar da "mureta" de 1,19 m; geladeira fora da frente da P3).
Regras: zero crédito da Higgsfield, texturas procedurais ou CC0, branch `feat/maquete-3d-editor`, migração só numa
branch do Neon, etapas 0 → 4 com parada a cada uma.

---

## 1. O que já existe e onde o pedido se encaixa

### 1.1 Inventário (EPIC-022, publicado em 15/11/2026, com aprimoramentos do EPIC-023/024)

| Peça | Onde | Serve para este pedido? |
|---|---|---|
| Modelo único em três camadas (implantação, edificação, tipologia), zod, metros, y para baixo | `shared/maquete-3d/modelo.ts` | **Sim, é a "estrutura"**: `paredeSchema` (a, b, espessura, externa), `aberturaSchema` (paredeId, posição do centro, largura, altura, peitoril, tipo porta/janela/porta_janela/vão), `comodoSchema` (polígono, função, `areaInformada`), `edificacao.cobertura`, `implantacao.terreno/lotes`. Já tem `validarModelo`, `areaPoligono`, `TOLERANCIA_AREA` (5%). |
| Geometria pura (sem three.js, testável) | `shared/maquete-3d/geometria3d.ts` | **Sim**: `blocosDaParede` (parede recortada pelas aberturas, com peitoril e verga), colisão, `comodoEm`, telhado, roteiro do tour. |
| Motor de mobília automática (regras: não bloquear portas/janelas, faixa livre na frente de cada passagem, teste de sobreposição `sobrepoe`) | `shared/maquete-3d/mobilia.ts` | **Parcial**: o formato `PecaMobilia` (tipo, x, z, rot, largura, profundidade, altura, elevação, opções) é exatamente o que um "item" precisa; as regras de bloqueio são o ponto de partida das regras do editor. **Mas a mobília é recalculada a cada abertura e nunca é gravada**: não há item persistido nem editável. |
| Visualizador react-three-fiber: casa (pisos por função, paredes recortadas, esquadrias com vidro, peitoril, lajes, escadas, cobertura), céu/horário, caminhada com olhos a 1,60 m (`ALTURA_OLHOS`), tour automático, telhado liga/desliga, corte por nível (`corteAte`), qualidade alta/média/econômica (celular começa em "média"), botão WhatsApp | `client/src/components/maquete-3d/visualizador/*` (`Visualizador.tsx`, `Casa.tsx`, `Navegacao.tsx`, `Mobilia.tsx`, `materiais.ts`) | **Sim, reaproveita quase tudo.** Falta: "visão geral em corte" de verdade (paredes cortadas a uma altura, vista de cima), "tour por cômodo" (pular para um ambiente escolhido), planta 2D com cotas. |
| Catálogo de móveis paramétricos (35 tipos, desenhados em código) | `client/src/components/maquete-3d/visualizador/moveis/{estar,intimo-servico,garagem}.tsx` | **Sim** = "catálogo procedural". Falta o tipo **balcão americano** (não existe nenhum "balc*" no código). |
| Texturas | `materiais.ts` (`CanvasTexture` desenhadas em código: madeira, tecido, pedra) e `Ceu.tsx` (`Environment` com `Lightformer`, sem baixar HDR de CDN) | **Sim**: já é 100% procedural, atende "procedural ou CC0" sem arquivo novo. |
| Revisão 2D da estrutura (SVG, edita paredes/aberturas/cômodos sobre o PDF) | `client/src/components/maquete-3d/EditorPlanta.tsx`, `fundo-pdf.ts` | Sim como referência de desenho SVG; não desenha linhas de cota. Ele edita a **estrutura** (que aqui fica travada), não os itens. |
| Leitura de PDF (vetorial + IA opcional), importação, histórico de revisões do modelo | `server/maquete-3d/{leitura,geometrico,pdf-vetorial,importacao,revisoes}.ts` | Não é necessário: aqui a fonte é o JSON. Pode ser usado depois para conferir o PDF do dono. |
| Banco | `drizzle/schema-maquete-3d.ts`; migrações `0111`–`0115`, `0121` | `maquetes_3d` (token, status `…/validada/publicada`, `modelo` JSON, `modelo_versao`, `comercial`, `study_id`), `maquete_3d_revisoes` (histórico do modelo). **Não há tabela de itens nem ligação com lote.** |
| Router | `server/maquete-3d/router.ts` (`adminProcedure` + `exigirAdmin` por papel; `maquetePublica.porToken` público, só publicada) | Sim: padrão de permissão, versão otimista (`salvarModelo` com `versao`), publicar/despublicar. |
| Link público | `client/src/pages/MaquetePublica.tsx`, rota `/maquete/:token` em `client/src/App.tsx` (linha ~292); visualizador carregado com `lazy()` | Sim. A rota nova `/maquete/:empreendimento/:lote` (dois segmentos) **não colide** com `/maquete/:token`. |
| Status de venda | `unidadesDoEstudo()` no router lê `incorporation_units (code, status)` do estudo da Incorporação (`disponivel/reservado/vendido`), sem comprador nem preço | Sim para o "status só leitura". **Atenção:** a "Central de Vendas" do Prospecta (`drizzle/schema-central-vendas.ts`) é o funil de leads; ela tem `central_vendas_produtos` (empreendimento), mas **não tem lote nem status de lote**. O status de lote vive em `incorporation_units` (ver dúvida 3). |

### 1.2 O que é diferente no pedido

1. **Fonte**: JSON escrito à mão a partir da planta, em vez de PDF lido pela IA. Estrutura travada (ninguém edita pela tela).
2. **Itens persistidos e editáveis**, versionados, com rascunho × publicado — hoje não existe.
3. **Editor 3D de itens** com encaixe, giro, regras que bloqueiam salvar, desfazer/refazer — hoje não existe.
4. **Rota por lote** (`/maquete/vila-esmeralda/qd18-lote4`) e "lote aponta para modelo + versão" — hoje o link é por token.
5. Modos extras: corte, tour por cômodo, planta 2D com cotas.

### 1.3 Recomendação: **evolução do módulo existente** (não módulo paralelo)

| Opção | Prós | Contras |
|---|---|---|
| A. Módulo novo ao lado (gerador Three.js próprio, tabelas `maquete_modelos`/`maquete_itens` literais) | Isolado; segue o texto do pedido ao pé da letra | Duplica parede recortada, esquadria, piso, telhado, caminhada, catálogo de móveis, link público e permissões; dois visualizadores para manter; o protótipo `maquete.html` vira um segundo motor |
| **B. Evolução (recomendada)** | Reaproveita ~70% (modelo, geometria, visualizador, catálogo, texturas, permissões, link); maquetes antigas não mudam; qualquer casa futura ganha o editor | Exige adaptador JSON-fonte → `ModeloMaquete`; nomes das tabelas ficam no padrão do módulo (`maquete_3d_*`) |

**Recomendação: B.** O JSON-fonte vira uma **nova origem** do modelo (`shared/maquete-3d/fonte.ts` converte `estrutura` → `ModeloMaquete` e `itens` → peças), a mesma cena 3D ganha os itens gravados (quando existem, substituem a mobília automática; quando não existem, nada muda) e o editor é uma camada só de admin, carregada à parte.
Equivalência com o pedido: `maquete_modelos` ≙ `maquetes_3d` (o JSON de estrutura já é a coluna `modelo`; ganha `glb_url`), `maquete_itens` ≙ `maquete_3d_itens` (nova). Ver dúvida 2.

[AUTO-DECISION] Seguir o `maquete.html` protótipo como motor? → Não; usá-lo, quando chegar, só como referência visual/de comportamento (razão: o motor do repositório já faz o que ele faz e tem testes; dois motores divergem).

---

## 2. Stack e peso no celular

- **Já em uso, versões fixas** (`package.json`): `three` **0.185.1**, `@react-three/fiber` **9.6.1**, `@react-three/drei` **10.7.7** (usados hoje: `OrbitControls`, `Environment`, `Lightformer`, `Sky`, `Stars`, `RoundedBox`), React 19, wouter 3.
- **Decisão: r3f + drei, como o repositório já faz.** Nenhuma dependência nova. Three "puro" só dentro de geometrias (`BufferGeometry`) como hoje.
- Editor: arrasto feito por raio no plano do piso (evento de ponteiro do r3f) + encaixe calculado em `shared/` — **sem** `TransformControls` do drei (ruim no toque e pesa sem necessidade).
- Planta 2D com cotas: **SVG** (sem WebGL), como o `EditorPlanta.tsx`.
- Carregamento:
  - o chunk do 3D (three + r3f + drei + visualizador) já é separado por `lazy()` em `MaquetePublica.tsx` e `AdminMaquete3D.tsx`; a página nova do lote reusa **o mesmo chunk**;
  - a página do lote entra no `App.tsx` com `lazy()` (hoje `MaquetePublica` é importada direto no `App.tsx`; corrigir junto, mudança pequena e compatível);
  - o **editor** (`editor/*`) fica num chunk próprio, importado só dentro da tela de admin: o visitante do link nunca baixa código de edição;
  - a planta 2D abre antes do 3D (é leve) e o botão "Ver em 3D" baixa o chunk; no celular, qualidade inicial "econômica" para casa térrea pequena (sombras desligadas, DPR 1) — a casa tem ~30 paredes e ~25 itens, cabe com folga.
- **Meta (medir na Etapa 1 com `vite build`, sem chute):** página do lote ≤ 60 kB gzip antes do 3D; chunk 3D sem crescer mais que 10% sobre o atual; JSON publicado ≤ 50 kB; primeira imagem em celular médio (4G) ≤ 4 s.
- **Higgsfield:** zero chamadas. Nenhuma imagem ou vídeo gerado. Nenhuma ferramenta externa é necessária (texturas já são procedurais em `materiais.ts`). Se alguma textura CC0 for usada, fica em `client/public/maquete/texturas/` com o arquivo de licença ao lado.

---

## 3. Arquivos por etapa

Convenções do repositório que o plano segue: testes vitest só em `server/**/*.test.ts` (`vitest.config.ts`); validações puras em `shared/`; schema Drizzle em arquivo próprio (`drizzle/schema-maquete-3d.ts`); migração SQL aditiva e idempotente com cabeçalho de reversão (modelo: `drizzle/0121_maquete_3d_revisoes.sql`).

### Etapa 1 — JSON-fonte, conversor e validações (sem banco, sem tela nova)

Criar:
- `data/plantas/lote4-qd18.json` — `estrutura` + `itens` com as cotas escritas pelo dono; cada medida com `"origem": "a_conferir"` até o PDF chegar. Já com as duas correções: sem parede entre cozinha e sala (vão); `balcao` como item (altura 1,10 m, tampo 0,30–0,40 m para o lado da sala); geladeira em posição fora da faixa da P3.
- `data/plantas/LEIA-ME.md` — formato do JSON, unidades, convenção de eixos (a mesma do `modelo.ts`), o que é travado e o que é editável.
- `shared/maquete-3d/fonte.ts` — schema zod do JSON-fonte; `fonteParaModelo()` (estrutura → `ModeloMaquete`: ambientes → `comodos`, paredes/aberturas, cobertura, lote 5 × 30 na `implantacao`); `itensDaFonte()`.
- `shared/maquete-3d/itens.ts` — schema `ItemMaquete` (id estável, tipo, ambienteId, x, z, rot, largura, profundidade, altura, elevação, opções), medidas padrão por tipo, conversão para `PecaMobilia`; limites (máx. 300 itens, textos curtos).
- `shared/maquete-3d/regras-itens.ts` — regras que bloqueiam salvar: atravessar parede; sair do ambiente; ocupar vão de abertura; invadir o raio de giro da folha da porta (arco = largura da folha, lado de abertura); invadir a faixa livre de 0,80 m na frente de passagens; item alto (acima do peitoril) sob janela; sobreposição entre itens (reusa `sobrepoe` de `mobilia.ts`). Retorna lista de problemas com mensagem em português.
- `shared/maquete-3d/validacao-fonte.ts` — validações da planta: área de cada ambiente ±2% da área informada; soma das faixas (larguras internas + espessuras) = 5,00 m e = 9,45 m; toda abertura cabe na parede (posição ± largura/2 dentro do comprimento, sem sobrepor outra); nenhum item padrão bloqueia porta; balcão da cozinha com altura < 1,20 m e do tipo item (nunca parede).
- `shared/maquete-3d/cotas.ts` — linhas de cota puras (externas totais, faixas por ambiente, aberturas), usadas pelo relatório e pela planta 2D.
- `scripts/maquete/relatorio-cotas.ts` — imprime o relatório de cotas (medida, origem "a conferir/confirmada", desvio) a partir do JSON.
- Testes: `server/maquete-3d-fonte.test.ts`, `server/maquete-3d-validacao-fonte.test.ts`, `server/maquete-3d-regras-itens.test.ts`.

Alterar:
- `shared/maquete-3d/mobilia.ts` — acrescentar `"balcao"` em `TIPOS_MOVEL` (aditivo) e exportar os auxiliares de bloqueio que hoje são privados (sem mudar o comportamento da mobília automática; os testes atuais continuam passando).

### Etapa 2 — Gerador: cena fiel ao JSON e os três modos (sem banco)

Criar:
- `client/src/components/maquete-3d/visualizador/moveis/cozinha-balcao.tsx` — desenho do balcão americano (base + tampo em balanço); registrar em `moveis/index.ts`.
- `client/src/components/maquete-3d/planta2d/Planta2D.tsx` — planta em SVG com cotas (`shared/maquete-3d/cotas.ts`), nome e área de cada ambiente, itens em contorno.
- `client/src/components/maquete-3d/visualizador/Corte.tsx` — visão geral em corte (paredes cortadas a ~1,20 m, vista de cima inclinada, telhado desligado).
- `scripts/maquete-harness/{index.html,main.tsx,vite.config.ts}` — página de teste que abre o visualizador com o JSON-fonte, sem banco (mesmo padrão de `scripts/layout-check/`).

Alterar:
- `client/src/components/maquete-3d/visualizador/Visualizador.tsx` — prop `itens?` (quando presente, substitui `mobiliaDaEdificacao`); modos novos "corte", "planta" e "ir para cômodo" (lista de ambientes; câmera a 1,60 m no ponto interno do cômodo, olhando para o centro).
- `client/src/components/maquete-3d/visualizador/Mobilia.tsx` — aceitar peças vindas de itens gravados.
- `client/src/components/maquete-3d/visualizador/Casa.tsx` — altura de corte opcional das paredes (para o modo corte).

### Etapa 3 — Banco, editor de itens e versões (admin)

Criar:
- `drizzle/0146_maquete_3d_itens_e_lotes.sql` (seção 4).
- `server/maquete-3d/itens.ts` — salvar rascunho (versão otimista), publicar versão, restaurar padrão (itens do JSON-fonte), listar versões; **o servidor revalida** `regras-itens.ts` e recusa salvar com erro (não confia na tela).
- `server/maquete-3d/fonte.ts` — "Criar maquete a partir do JSON-fonte" (admin): grava `maquetes_3d` com `origem = 'fonte'` e o modelo convertido; a estrutura não é editável depois.
- `shared/maquete-3d/edicao.ts` — encaixe no piso (5 cm), encaixe na parede (encosta as costas do item na face da parede mais próxima até 15 cm), giro 90°/15°, conversão de tipo (mantém posição, aplica medidas do novo tipo), pilha de desfazer/refazer (pura, testável).
- `client/src/components/maquete-3d/editor/EditorItens.tsx` (cena + seleção + arrasto), `editor/PainelItem.tsx` (campos: tipo, largura, profundidade, altura, elevação, giro, posição), `editor/Catalogo.tsx` (catálogo procedural), `editor/BarraEdicao.tsx` (desfazer, refazer, restaurar padrão, salvar rascunho, publicar; botão Salvar desativado com a lista de problemas).
- Testes: `server/maquete-3d-itens.test.ts` (colaborador e corretor recebem FORBIDDEN; versão antiga recebe CONFLICT; salvar com regra violada é recusado; publicar não altera o rascunho; restaurar padrão), `server/maquete-3d-edicao.test.ts`, `server/maquete-3d-0146.test.ts` (SQL só aditivo, padrão do `central-vendas-0110.test.ts`).

Alterar:
- `drizzle/schema-maquete-3d.ts` — tabelas e colunas novas.
- `server/maquete-3d/router.ts` — procedimentos `itens.*`, `criarDaFonte`, `ligarLote`, todos com `exigirAdmin`; `origem` aceita `'fonte'`.
- `server/maquete-3d/base.ts` — leitura dos itens publicados.
- `client/src/pages/admin/AdminMaquete3D.tsx` — botão "Editar itens" (lazy) e quadro "Lotes ligados".

### Etapa 4 — Página pública do lote, status, WhatsApp, Playwright

Criar:
- `client/src/pages/MaqueteLote.tsx` — `/maquete/:empreendimento/:lote`, leve: capa com nome, status do lote (selo "Disponível/Reservado/Vendido", só leitura), planta 2D, botão "Ver em 3D" (lazy) e botão WhatsApp.
- `scripts/maquete/screenshots.mjs` — Playwright + Chromium (`/opt/pw-browsers`, playwright global em `/opt/node22/lib/node_modules/playwright`, mesmo padrão de `scripts/layout-check/check.mjs`) sobre o harness da Etapa 2: capturas em 390 × 844 e 1440 × 900 (visão geral em corte, tour na cozinha, planta 2D, editor) e o **teste de edição** (arrastar a geladeira para a frente da P3 → Salvar desativado com o motivo; colocar em lugar válido → Salvar ativo).
- Teste: `server/maquete-3d-lote-publico.test.ts` (só versão publicada; rascunho nunca aparece; sem comprador/preço; lote desligado = 404).

Alterar:
- `client/src/App.tsx` — rota nova com `lazy()`; `MaquetePublica` também passa a `lazy()`.
- `server/maquete-3d/router.ts` — `maquetePublica.porLote` (público).
- `docs/stories/epics/ROADMAP.md` — registrar o EPIC-028 dentro da exceção de paridade da Maquete 3D.

---

## 4. Tabelas, migração e permissões

Número: o último arquivo na `main` é `0144`; `0143` está numa branch da Dolores (não aplicada); o HANDOFF de 16/11 reserva `0145` para a Dolores. **Proposta: `0146_maquete_3d_itens_e_lotes.sql`** (conferir de novo no dia, com `git log --all -- 'drizzle/014*'`). Aplicada **só numa branch do Neon** criada para este epic; a produção depende do dono (dúvida 6).

SQL (aditivo e idempotente; nada existente é alterado ou apagado):

```sql
-- "maquete_modelos" do pedido = maquetes_3d (o JSON da estrutura já é a coluna "modelo").
ALTER TABLE "maquetes_3d" ADD COLUMN IF NOT EXISTS "glb_url" text;            -- vazio por enquanto
ALTER TABLE "maquetes_3d" ADD COLUMN IF NOT EXISTS "itens_versao_publicada" integer;
-- origem passa a aceitar 'fonte' (troca do CHECK de origem: DROP CONSTRAINT IF EXISTS + ADD com a lista anterior + 'fonte')

-- "maquete_itens" do pedido.
CREATE TABLE IF NOT EXISTS "maquete_3d_itens" (
  "id" serial PRIMARY KEY,
  "maquete_id" integer NOT NULL REFERENCES "maquetes_3d" ("id"),
  "versao" integer NOT NULL,
  "itens" text NOT NULL,                 -- ItemMaquete[] em JSON (json_itens)
  "modelo_versao" integer NOT NULL,      -- versão da estrutura a que os itens se referem
  "situacao" varchar(20) NOT NULL CHECK ("situacao" IN ('rascunho','publicada','arquivada')),
  "motivo" varchar(400),
  "autor_id" integer,                    -- autor
  "created_at" timestamp NOT NULL DEFAULT now()   -- criado_em
);
CREATE UNIQUE INDEX IF NOT EXISTS "maquete_3d_itens_versao_idx" ON "maquete_3d_itens" ("maquete_id","versao");

-- Lote aponta para modelo + versão publicada.
CREATE TABLE IF NOT EXISTS "maquete_3d_lotes" (
  "id" serial PRIMARY KEY,
  "empreendimento_slug" varchar(80) NOT NULL,   -- ex.: vila-esmeralda
  "lote_slug" varchar(80) NOT NULL,             -- ex.: qd18-lote4
  "maquete_id" integer NOT NULL REFERENCES "maquetes_3d" ("id"),
  "itens_versao" integer,                        -- null = segue a versão publicada da maquete
  "unit_id" integer REFERENCES "incorporation_units" ("id"),  -- de onde vem o status (opcional)
  "ativo" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "maquete_3d_lotes_slug_idx" ON "maquete_3d_lotes" ("empreendimento_slug","lote_slug");
-- Reversão: DROP TABLE maquete_3d_lotes, maquete_3d_itens; DROP COLUMN glb_url, itens_versao_publicada (nada depende delas).
```

Como se liga ao que existe:
- Uma maquete (`maquetes_3d`) = uma planta. Vários lotes com a mesma casa podem apontar para a mesma maquete (casa repetida no loteamento).
- Status do lote: `maquete_3d_lotes.unit_id` → `incorporation_units.status` (`disponivel/reservado/vendido`), lido do mesmo jeito que `unidadesDoEstudo()` já faz (só código e status; nunca comprador nem preço). Sem `unit_id`, a página não mostra selo (nunca inventa status).
- Rascunho × publicado: o editor grava sempre uma nova linha `rascunho`; "Publicar" marca aquela versão como `publicada`, arquiva a anterior e atualiza `maquetes_3d.itens_versao_publicada`. O link público lê **só** a versão publicada. Publicar exige a maquete com `status = 'publicada'` (regra já existente para o link).
- Compatibilidade: maquete sem itens gravados continua com a mobília automática; `/maquete/:token` não muda.

Permissões:
- Editar, salvar rascunho, publicar, restaurar padrão, criar da fonte e ligar lote: `adminProcedure` **+ `exigirAdmin`** (papel `admin`; colaborador com o módulo Maquete 3D não edita — "modo edição só para admin").
- Leitura pública (`porLote`): `publicProcedure`, só lote `ativo`, maquete `publicada` e versão `publicada`; resposta com estrutura, itens, nome comercial, status e WhatsApp; nada de dado pessoal, preço interno, autor ou histórico.
- Segurança: slugs validados por expressão (`^[a-z0-9-]{1,80}$`); itens validados por zod com limites de tamanho; o servidor revalida as regras ao salvar; `glb_url`, quando usado, só aceita endereço do próprio armazenamento (evita link externo arbitrário na página do cliente); endereço legível é adivinhável (dúvida 4).

---

## 5. Validação, testes e capturas

- **Validação geométrica**: funções puras em `shared/maquete-3d/validacao-fonte.ts`, `regras-itens.ts`, `edicao.ts`, `cotas.ts` — mesma lógica na tela (botão Salvar) e no servidor (recusa). Tolerâncias num só lugar (`TOLERANCIAS` em `validacao-fonte.ts`: área 2%, soma de faixas 1 cm, encaixe 5 cm, faixa livre 0,80 m, balcão < 1,20 m).
- **Testes automáticos (vitest, `npm test`)**: os arquivos da seção 3. Casos obrigatórios: o JSON do Lote 4 passa em tudo; cada regra tem um caso que falha (item atravessando parede, fora do ambiente, no vão, no raio da porta, na faixa de 0,80 m, item alto sob janela, balcão com 1,19 m como parede → erro, geladeira na frente da P3 → erro); soma 5,00 e 9,45; abertura maior que a parede → erro; desfazer/refazer; encaixe 5 cm e na parede; testes atuais da Maquete 3D continuam verdes.
- **Capturas e teste de edição (Playwright)**: o projeto **não** tem `@playwright/test` no `package.json`; usa o Playwright global (`/opt/node22/lib/node_modules/playwright`) com o Chromium de `/opt/pw-browsers` no script `scripts/layout-check/check.mjs`. Seguir o mesmo padrão (script `.mjs`, sem dependência nova), sobre o harness sem banco. WebGL sem placa de vídeo: lançar o Chromium com SwiftShader (`--use-angle=swiftshader`, `--enable-unsafe-swiftshader`). Capturas salvas fora do repositório (pasta temporária) e anexadas ao HANDOFF/PR.
- **Relatório de cotas**: `scripts/maquete/relatorio-cotas.ts` — cada cota, origem ("a conferir" × "confirmada pelo PDF") e desvio; vai no HANDOFF a cada etapa.
- Portão de QA (@qa) ao fim de cada etapa, como exige o `CLAUDE.md`.

---

## 6. Riscos e dúvidas para o dono (6)

1. **Os dois anexos não chegaram** (PDF da planta e `maquete.html`). Procurei no repositório: não há `data/plantas/`, nenhum `*.html` de maquete (só `client/index.html` e `scripts/layout-check/index.html`) e os únicos PDFs são os de teste (`server/fixtures/maquete-3d/terrea.pdf` e `sobrado.pdf`, de outras casas). **Bloqueio da Etapa 1:** sem o PDF eu monto o JSON com as cotas que você escreveu, marcadas "a conferir", mas não dá para garantir que está fiel à planta, nem saber onde fica exatamente a porta P3 (necessário para tirar a geladeira da frente dela). Pode reenviar os dois arquivos?
2. **Nomes das tabelas.** Você pediu `maquete_modelos` e `maquete_itens`. Já existe a tabela das maquetes (`maquetes_3d`) que guarda a planta; recomendo usá-la como "modelo" (ganha o campo `glb_url`) e criar só `maquete_3d_itens` e `maquete_3d_lotes`, para não ter duas tabelas de maquete. Pode ser assim? E o `glb_url` é para quê (baixar o arquivo 3D, ver em realidade aumentada)? Se não for usar agora, o campo fica vazio.
3. **De onde vem o status do Lote 4 Qd 18?** No Prospecta, o status de lote (disponível/reservado/vendido) fica na **Incorporação** (unidades do estudo). A Central de Vendas cuida dos clientes interessados, não dos lotes. A Vila Esmeralda está cadastrada como estudo na Incorporação, com o Lote 4 da Quadra 18? Se não estiver, a página mostra a maquete sem o selo de status até ser cadastrada.
4. **Endereço legível** (`/maquete/vila-esmeralda/qd18-lote4`) é fácil de adivinhar: qualquer pessoa pode trocar o número e ver a maquete publicada de outro lote. Para material de venda isso costuma ser bom. Tudo bem, ou prefere um código no endereço?
5. **Botão de WhatsApp:** leva ao número da empresa (a conexão única de Integrações) ou ao número do consultor cadastrado na maquete (como o link atual faz)?
6. **Produção:** você pediu migração só numa branch do Neon. Ao terminar a Etapa 4, aplico a mesma migração (só aditiva) na produção e publico, ou espero o seu "autorizo" naquele momento? (A regra antiga do EPIC-022 no `CLAUDE.md` autorizava direto; vou seguir o pedido novo, mais restrito, até você dizer.)

Riscos técnicos (sem decisão sua): WebGL no Chromium sem placa pode gerar capturas diferentes das do celular (mitigação: SwiftShader e comparação por elemento, não por pixel); arrasto por toque no editor é mais difícil que no mouse (editor pensado primeiro para computador; no celular, campos numéricos do painel); a regra do estacionamento de prédios não se aplica (casa térrea), mas nada neste epic sugere quantidade de unidades.

---

## 7. Tamanho e ordem

| Etapa | Conteúdo | Tamanho | Depende de |
|---|---|---|---|
| 0 | Este plano | pequena | — |
| 1 | JSON-fonte, conversor, validações puras, relatório de cotas, testes | **média** | dúvida 1 (sem PDF segue com "a conferir") |
| 2 | Cena fiel ao JSON, balcão, corte, tour por cômodo, planta 2D com cotas, harness | **média/grande** | Etapa 1 |
| 3 | Migração 0146 (branch do Neon), editor de itens, versões, permissões | **grande** | Etapa 2; dúvidas 2 |
| 4 | Página pública do lote, status, WhatsApp, Playwright, ROADMAP | **média** | Etapa 3; dúvidas 3, 4, 5, 6 |

Ordem: 0 → 1 → 2 → 3 → 4, com parada a cada etapa; todas na branch `feat/maquete-3d-editor` (ainda não existe no GitHub), HANDOFF em `HANDOFF-21-11-MAQUETE-EDITOR.md` a cada etapa.
