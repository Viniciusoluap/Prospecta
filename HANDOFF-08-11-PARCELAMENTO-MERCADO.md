# HANDOFF 08/11 — Prompt mestre: parcelamento, desenho técnico, mercado, unidades e negociação

Branch: `claude/intelligent-ptolemy-av0qoh` (Prospecta). Checkpoint inicial recuperável:
tag local `checkpoint/pre-parcelamento-20261108` = `61362b1` (main na época, árvore limpa).
Escopo: só Prospecta (o prompt proíbe alterar outros repositórios). Paridade com o Santa Fé
fica **sinalizada** aqui e no relatório — não foi portada.

## Estado por correção

| # | Correção | Estado |
|---|----------|--------|
| 01 | Parâmetros exatos + área viária manual + quadro | ✅ motor + UI |
| 02 | Determinismo + 3 cenários por critério + mensagens | ✅ motor + UI (seed `Date.now()` removida) |
| 03 | Rua Simples | ✅ motor + UI |
| 04 | Desenho técnico universal | ✅ (etapa 2) |
| 05 | Quantidade dinâmica | ✅ motor + testes |
| 06 | Mercado: 2 motores independentes | ✅ código + testes simulados · ao vivo pendente (ver abaixo) |
| 07 | Unidades: ordenação numérica + paginação 6 | ✅ (etapa 3) |
| 08 | Negociação: excluir proposta + permuta % VGV | ✅ (etapa 3) |

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

## Etapa 2 — UI do Estudo de Massa + desenho técnico (concluída)

Arquivos:
- `shared/incorporacao/planta-tecnica.ts` (novo): renderizador SVG puro (perímetro, vias, quadras,
  todos os lotes, número/área/dimensões conforme zoom, largura das vias, área viária total, áreas
  públicas, legenda, escala gráfica, norte, seleção + destaque da quadra). Mesma projeção do motor.
- `client/.../planta-tecnica.tsx` (novo): zoom (roda, botões, pinça), pan, seleção, exportar SVG, imprimir.
- `client/.../massa.worker.ts` + `executar-massa.ts` (novos): motor em Web Worker, progresso real,
  um cálculo por vez; fallback para a thread principal.
- `client/.../massa-tab.tsx`: Rua Simples, "Área do sistema viário (m²)" automático/manual, cache por
  assinatura (sem recálculo para entradas idênticas), cartões só com cenários válidos e com o critério,
  motivo + causas da inviabilidade, alternância **Desenho técnico** (padrão) / **Satélite** (mapa antigo).
- `client/.../mapa-massa.tsx`: tooltip das vias genérico (agora inclui corredores).
- `shared/incorporacao/unidades.ts`: `formatarCodigoLote`, `codigoExibicao`, `compararCodigoUnidade`
  (numérico), `paginar` (6/página). O código persistido "Q1 / L1" NÃO muda (identidade comercial).
- Correção no cul-de-sac: a rua sem saída chega até o balão (antes o balão ficava solto).

Testes:
- (a) `server/incorporacao-planta-unidades.test.ts` 10 ✅ (SVG desenha exatamente os lotes e vias do
  cenário nas 3 tipologias; rótulos por zoom; seleção; zoom ancorado; ordenação; paginação; unidades
  da Rua Simples Q01/L01…Q02/L14). Conjunto massa + v2 + planta + unidades: 96 ✅. `tsc` limpo.
  `vite build` ✅ (worker 75,8 kB).
- (b) Manual por mim: SVG renderizado no Chromium (Playwright) e inspecionado nas 3 tipologias;
  bundle de produção do worker executado no Chromium (29 lotes, progresso recebido).
- (c) Pendente em produção: a tela completa logada (não há login/banco nesta sessão); teste em tablet real.

## Etapa 3 — Unidades à Venda e Negociação do Terreno (concluída)

Unidades (`client/.../unidades-tab.tsx`): ordenação numérica real (`compararCodigoUnidade`), exibição
`Q01 / L01` (código persistido e chave comercial inalterados → vendas, reservas, histórico e vínculos
preservados; nada foi renumerado no banco), 6 por página em 2 colunas × 3 linhas, setas
anterior/próxima com "Página X / Y", desabilitadas nas pontas, filtro por status preservado, página
reajustada após inclusão/exclusão.

Negociação:
- Causa do "R$ 0,00": o VGV vinha só das premissas salvas da Viabilidade; sem elas virava 0 e era
  exibido como cálculo concluído. A "proposta atual" era sempre a mais recente (uma enviada posterior
  escondia a aceita).
- `shared/incorporacao/negociacao.ts`: `resolverVgvBruto` (Viabilidade › cenário escolhido do Estudo de
  Massa › manual legado), `calcularPermutaFinanceira` (centavos em BigInt, %, até 4 casas),
  `estimarProposta` ("Cálculo pendente — VGV não disponível"), `resumoNegociacaoV2` (aceita, mais
  recente e selecionada separadas; referência = selecionada › aceita › mais recente),
  `excluirProposta` (só a proposta indicada; aceita exige confirmação reforçada; auditoria
  `historicoExclusoes` no próprio JSON — sem migração), `mesclarNegociacaoParaGravar`.
  Tipo **misto** agora estima dinheiro + permuta financeira (antes só o valor em dinheiro).
- `server/routers.ts`: `excluirPropostaNegociacao` (nova) e `saveNegociacaoTerreno` com mescla
  protetora (nunca apaga auditoria nem ressuscita proposta excluída).
- Tela: botão **Excluir proposta** por proposta (confirmação; aceita pede digitar EXCLUIR),
  "Usar como atual", KPI "Valor estimado — proposta atual" com pendência explícita, quadro de
  aceita/mais recente/referência, lista de exclusões auditadas.

Testes (a): `server/incorporacao-negociacao.test.ts` 21 ✅ (9 legados + 12 novos). `tsc` limpo.
(c) Pendente em produção: exclusão real contra o banco (rota nova) e a tela logada.

## Etapa 4 — Inteligência de Mercado com dois motores (concluída)

Causa do "IA desativada…": `mercado-ia.ts` lançava erro sempre que `INCORPORACAO_IA_ATIVA` ≠ "1"
(desligada por padrão) e a tela tinha UM botão que misturava dados da cidade e de mercado numa
única chamada paga — sem IA, nada funcionava, nem os dados oficiais gratuitos.

- Motor 1 `server/_core/incorporacao/dados-publicos.ts`: IBGE Localidades + Agregados (SIDRA), sem IA,
  sem chave. Indicadores: população estimada (série → crescimento anual derivado), população e
  densidade do Censo, PIB (→ PIB per capita derivado só com população do mesmo ano), pessoal ocupado,
  salário médio. Última competência publicada; nome/unidade vindos do IBGE; conferência por
  palavra-chave descarta variável trocada; cache 24 h; cada indicador independente.
- Motor 2 `server/_core/incorporacao/mercado-anuncios.ts` + `shared/incorporacao/analise-anuncios.ts`:
  provedor isolado (hoje: busca web da API Anthropic, exige ANTHROPIC_API_KEY; liga por padrão quando há
  chave, `INCORPORACAO_IA_ATIVA=0` desliga; modelo em `INCORPORACAO_IA_MODELO`). Tratamento puro:
  link obrigatório, deduplicação (URL canônica + mesmo imóvel em portais), rejeição de incompletos e de
  tipologia/área incompatível, atípicos por Tukey (1,5 IQR), mediana, Q1–Q3, mín/máx, nº de amostras,
  confiabilidade com justificativa, aviso "preço anunciado ≠ transação". Cache 12 h.
  Não há raspagem de portais (termos de uso); não há alternativa gratuita permitida conhecida.
- Rotas: `pesquisarDadosPublicos`, `pesquisarMercadoImobiliario`, `aplicarPrecoReferenciaMercado`
  (só com confirmação). Resultados em chaves novas (`dadosPublicos`, `analiseAnuncios`) — pesquisa
  legada, comparáveis manuais e `precoM2Lote` do usuário preservados.
- Tela `mercado-tab.tsx`: dois botões independentes com estados/erros próprios; pesquisa legada exibida.

Testes (a): `server/incorporacao-mercado-motores.test.ts` 14 ✅ (respostas simuladas no formato das
APIs). Suíte completa: **185 arquivos / 1504 testes ✅**. `tsc` limpo.
(c) Pendente em produção: **consulta ao vivo ao IBGE** (o proxy desta sessão bloqueia
servicodados.ibge.gov.br — os IDs SIDRA 6579/9324, 4714/93/614, 5938/37, 1685/707/1606 não puderam ser
confirmados ao vivo; se algum estiver errado, o indicador aparece como indisponível, nunca trocado) e
**pesquisa de anúncios** (requer ANTHROPIC_API_KEY no servidor).

## Etapa 5 — Retorno do dono (08/11, rodada 2)

1. **KML real do Morada do Bosque** — estava no banco (estudo 5 "Chacreamento Morada do Bosque - Fase 1",
   Ribeirãozinho/MA, KML "projeto aprovado Reginaldo", 150.095 m²), não no repositório. Fixture:
   `server/fixtures/morada-do-bosque.ts`. Resultado com 20 × 250 m, área mínima 5.000 m², via 3 m:
   **23 lotes** (retangular exato) e **25 lotes** (novo formato "acompanha a divisa").
   **29 não é geometricamente viável** com testada ≥ 20 m e área ≥ 5.000 m² numa via única reta:
   só ~480–490 m do eixo de 658 m têm largura ≥ 253 m (cabeceiras inclinadas; largura máx. 270,5 m);
   29 × 5.000 = 145.000 m² exigiria aproveitar 96,6% da gleba. Testadas menores (16–19 m) também dão ~24–25.
2. **IBGE**: o motor 1 já é gratuito (não usa Anthropic). O IBGE recusa conexões de fora do Brasil
   (TLS reset verificado a partir do datacenter desta sessão; o Vercel roda em iad1/EUA). Agora a consulta
   roda **no navegador do usuário** (`shared/incorporacao/dados-publicos.ts`) e o servidor só grava
   (`salvarDadosPublicos`, aceita apenas URLs do IBGE); a rota de servidor ficou como reserva.
3. **Rua Simples** — nova opção "Formato do lote: acompanha a divisa" (frente = testada ou múltiplo,
   fundo até a divisa, máx. 2 × profundidade, área ≥ mínima). Via curva continua não modelada.
4. **Ajuste da malha** (modo manual da área viária, Grade/Cul-de-sac): testa quadras mais curtas
   (nunca acima do máximo informado) e suprime ruas de menor aproveitamento até a via desenhada bater
   ±5%; nunca zera os lotes; o ajuste aparece nas limitações do cenário.
5. **Chave gratuita**: provedor `provedorGeminiBuscaGoogle` (Gemini + Grounding with Google Search,
   chave gratuita do Google AI Studio → `GEMINI_API_KEY`). Padrão quando houver chave; Anthropic opcional.

Testes (a): suíte completa **185 arquivos / 1514 testes ✅**; build igual ao do Vercel ✅.
(c) Pendente em produção: IBGE pelo navegador (CORS do IBGE não testável daqui); anúncios após
cadastrar `GEMINI_API_KEY` no Vercel.

## Etapa 6 — Via que acompanha a divisa (08/11, rodada 3) — PR #188, mergeado

- `shared/incorporacao/rua-divisa.ts` (novo): Rua Simples com **traçado pela divisa (curvo)** —
  `tracadoVia: "divisa"` em `ParametrosMassa`; seletor "Traçado da via" na tela; progresso real.
  A via segue trechos contínuos da poligonal (quebra em cantos > 60°, mais junções de dois trechos),
  nos dois sentidos e com duas fases, com a largura informada, do lado de dentro da gleba.
- Lotes: frente MÍNIMA = testada sobre a borda interna da via (cresce só onde preciso para a área
  mínima — busca binária, arredondada ao cm); fundo até a divisa oposta (máx. 2 × profundidade);
  cabeceiras seguem a divisa vizinha; refino com lotes em leque nas curvas (raios t, 2t, 4t, 8t).
- Garantias: cada lote é recortado pela gleba e subtraído da via e dos lotes anteriores (sem
  sobreposição por construção); geometria limpa a 0,1 mm; qualquer falha booleana RECUSA o lote;
  lote com furo é recusado; **frente efetiva medida após o recorte** (amostragem ≤ 25 cm) — só aceita
  frente efetiva ≥ testada (correção do apontamento Codex no PR #188, commit `f37df3c`).
- Morada do Bosque (KML real, estudo 5): via 3 m pela divisa → **27 lotes** com frente mínima 20 m
  (aproveitamento 98,7%; via 3/6/10 m dá o mesmo número); **29 lotes ≥ 5.000 m² com frente mínima 17 m**.
  Limitante = comprimento de frente (~600 m): fundo até ~270 m faz lote de 20 m ter ~5.400 m²; cabeceiras
  rasas exigem 40–65 m de frente.
- Desempenho: 20–40 s nesta gleba (Web Worker com progresso). Otimização possível (pendência).
- Testes: gleba real 27 e 29, gleba sintética com dobra, determinismo, frente efetiva (caso Codex),
  sem sobreposição lote×lote e lote×via, dentro da gleba, área e frente mínimas.

## Etapa 7 — Chave do Google (08/11)

- O dono enviou uma chave do Google AI Studio. O Vercel recusou criar a variável de ambiente por esta
  sessão (403), então a chave passa a poder ficar no PRÓPRIO banco: `dashboard_settings` com a chave
  `segredo.gemini_api_key` (valor "plain:<chave>" é recriptografado AES-256-GCM no 1º uso —
  `server/_core/incorporacao/segredos-mercado.ts`). `GEMINI_API_KEY` no ambiente continua com prioridade.
  O painel de gestão deixou de devolver linhas `segredo.*` ao navegador (`server/db.ts`).
- **Teste ao vivo da chave (b)**: válida (lista 47 modelos; `gemini-flash-latest` disponível), mas TODA
  geração responde **HTTP 402 — "Your prepayment credits are depleted"**: o projeto Google dessa chave está
  em faturamento PRÉ-PAGO sem crédito; o nível gratuito não se aplica a ele. Mensagem clara adicionada.
- Pendente (dono): criar a chave em um projeto **sem faturamento** no AI Studio (ou recarregar créditos).
- Pendente (agente, após autorização de merge/deploy do PR #188): gravar a chave no banco de produção.
- Testes (a): suíte **185 arquivos / 1521 ✅**.

## Estado em 08/11 ~15h (fim da sessão Claude)

- PRs mergeados e em produção (prospectaconstrucoes.com): **#187** (`36b3e05`) e **#188** (`05f3474`).
  Deploy de produção do `05f3474` = READY no Vercel. Depois disso entrou na `main` o PR #189 (Codex, jurídico).
- Suíte na última execução: **185 arquivos / 1522 testes ✅**; `tsc` limpo; build igual ao do Vercel ✅.
- Ambiente de nuvem padrão do Claude: liberados `servicodados.ibge.gov.br` e `generativelanguage.googleapis.com`.
- Chave Google enviada pelo dono no chat: **NÃO gravada em lugar nenhum** (retorna 402 — projeto com
  crédito pré-pago esgotado). Recomendado ao dono apagá-la no AI Studio (ficou exposta no chat).
- **Decisão do dono (08/11): seguir com o TAVILY** para a pesquisa de anúncios (grátis, ~1.000 buscas/mês,
  sem cartão — conferir na página oficial). Implementação abaixo, a ser feita pelo **Codex**.

## Etapa 8 — Provedor de anúncios Tavily, sem IA (08/11 ~19h) — IMPLEMENTADO PELO CLAUDE

> **Codex: NÃO refazer.** O roteiro que estava aqui foi executado pelo Claude na mesma sessão,
> depois que o dono enviou a chave. O que falta está em "Pendências" e "Próximo passo".

- Chave do dono (plano gratuito "Pesquisador", 1.000 créditos/mês) **gravada no banco de produção**:
  `dashboard_settings` → `segredo.tavily_api_key` = `plain:…` (recriptografada AES-256-GCM no 1º uso
  pelo código novo). Não está no repositório nem no Vercel. O painel de gestão já não devolve `segredo.*`.
- `shared/incorporacao/extracao-anuncios.ts` (novo): extração DETERMINÍSTICA do texto que o Tavily
  devolve (páginas de listagem com vários anúncios): divide em trechos (";" e "·"); só aceita trecho com
  exatamente UM preço de venda e UMA área; descarta aluguel/mês, parcelas/entrada/"a partir de", médias
  ("valor médio"), preço por m², leilão, preço < R$ 1.000, área < 10 m², trecho de outra cidade, página
  e trecho fora do município; entende "150.000", "1,2 milhão", "mil", "2 ha"; extrai bairro quando há.
- `shared/incorporacao/analise-anuncios.ts`: `idTrecho` — anúncios distintos da MESMA página não são
  tratados como duplicados (a deduplicação entre portais por preço+área+bairro continua).
- `server/_core/incorporacao/mercado-anuncios.ts`: `provedorTavily` (POST api.tavily.com/search, Bearer,
  `search_depth: basic`, `max_results: 20`, `country: brazil`; 2 consultas por pesquisa = 2 créditos;
  cache de 12 h por consulta; mensagens para 401/403 e 429/432/433). `provedorPadrao`: Tavily > Google > Anthropic.
- `server/_core/incorporacao/segredos-mercado.ts`: `carregarChaveTavily` (ENV `TAVILY_API_KEY` > banco);
  rota `pesquisarMercadoImobiliario` carrega Tavily e Google. `server/_core/env.ts`: `tavilyApiKey`.
- Tela: textos do botão "Pesquisar anúncios" (Tavily, gratuito, sem IA).

Testes:
- (a) `server/incorporacao-mercado-motores.test.ts` 33 ✅ (extração com trechos REAIS do Tavily, ambíguos,
  aluguel/médias/parcelas, mil/milhão/hectare, mesma página, provedor com fetch simulado, 401/432, padrão,
  chave no banco). Suíte completa: **186 arquivos / 1537 ✅**; `tsc` limpo.
- (b) **Ao vivo** (chave do dono, 6 créditos usados): Imperatriz/MA lote → **7 anúncios reais** (OLX, VivaReal,
  Chaves na Mão, imobiliárias locais), mediana **R$ 321,54/m²**, Q1–Q3 R$ 153–544, confiabilidade **baixa**
  (amostra mistura glebas de 6.000–49.700 m² com lotes de ~220–600 m² → usar área mín./máx. na tela).
  Ribeirãozinho/MA → nenhum anúncio aproveitável (informado como insuficiente, sem estimar).
- (c) Pendente em produção: o botão na tela logada após o deploy deste PR.

Chave Google mostrada no print do dono (`AQ.…`): **não usada nem testada** (o controle de segurança da
sessão bloqueou o uso de uma chave que só aparecia em imagem, sem pedido explícito). Não está gravada.

## Pendências gerais
- Morada do Bosque: validado com o KML real — reta 23 / divisa-reta 25 / via pela divisa 27 (testada 20 m)
  e 29 com testada mínima 17 m (Etapas 5 e 6).
- Ponto de acesso viário informado pelo usuário não é modelado (a via sai da divisa).
- Busca da via pela divisa: 20–40 s em glebas como a do Morada (otimizar: menos cadeias/refino, ou cache).
- **IBGE pelo navegador**: validar em produção (Inteligência de Mercado → "Pesquisar dados oficiais (IBGE)");
  o IBGE recusa acesso de fora do Brasil, por isso não foi testável daqui.
- Pesquisa de anúncios (Tavily): implementada e testada ao vivo; falta o merge/deploy deste PR (#190) e conferir na tela logada.
- Possível melhoria: filtro de área automático pela tipologia/estudo para subir a confiabilidade (hoje é manual).
- Paridade com o Santa Fé registrada em `docs/stories/epics/ROADMAP.md` (não portada; incluir Tavily e via pela divisa).
- Merge e deploy dependem de autorização do dono.

## Próximo passo exato
1. Dono autoriza merge/deploy do PR #190 (Tavily + handoff). Após o deploy, na tela logada: Inteligência de
   Mercado → "Pesquisar anúncios" (lote, Imperatriz) e conferir; preencher área mín./máx. para comparáveis.
2. Validar em produção: Morada do Bosque (Rua Simples → Traçado "Acompanha a divisa"), botão IBGE,
   exclusão de proposta, paginação das unidades em tablet.
3. Próxima frente técnica sugerida: otimizar a busca da via pela divisa (20–40 s) e portar ao Santa Fé (ROADMAP).
