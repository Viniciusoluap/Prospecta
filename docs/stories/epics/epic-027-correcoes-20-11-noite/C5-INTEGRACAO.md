# C5 — integração das três frentes da Dolores (E5 gasto · E3 grupo · MLP memória)

Ramo `epic027-c5int`, a partir da `main` em `04f8e3b` (etapa 2 "pode/confirmo" publicada em squash). Merges, nesta ordem:
`epic027-c5gasto` → `epic027-c5e3` → `epic027-c5mem`. Mais o teste de QA `server/dolores/c5-e2-qa-r2.test.ts` (ramo `epic027-c5e2`).
Nenhuma migração aplicada em banco (0148 e 0149 continuam pendentes no Neon).

## Conflitos reais
- `server/dolores/testes-banco.ts` (únicos conflitos de texto, nos dois merges): entram a 0148 (gasto) e a 0149 (memória longa),
  nesta ordem, cada uma aplicada 2× (idempotência). Sem 0146/0147 (a 0146 é da maquete, a 0147 não foi usada).
- `cerebro.ts`, `whatsapp.ts`, `marcacao.test.ts`, `drizzle.config.ts`, `EPIC.md`: juntaram sozinhos; conferidos à mão.
- `server/_core/trpc.ts` continua SEM `"dolores.grupos.definirTipo"`.

## Contradições entre frentes (resolvidas na suíte integrada)
- `grupos-qa-r2.test.ts` (lista fixa de arquivos que chamam `configEvolution(`): a E3 acrescentou `grupo-pedido-dono.ts`, que liga
  o `semRedirecionamento` (o mesmo teste confere) → lista atualizada.
- `correcoes-e3.test.ts` (lista fixa de `contaminaOComando` por ação): as 3 ações da memória longa vão à fila → contaminam, como as
  outras de fila → lista atualizada.

## Piso da reserva
- `RESERVA_MINIMA_ENTRADA` = 15.000 (o maior: memória 15.000; gasto e E3 14.000). Só a memória acrescentou ferramentas.
- Prefixo medido no código integrado (sistema + ferramentas, estimativa por cima): 2.121 + 11.177 = **13.298**; + sobrecarga 500 =
  13.798 ≤ 15.000 (folga ~1.200). Piso mantido. Conferido por `c5-e1-memoria.test.ts` ("o piso cobre…").

## Classificação das ações
- E3 não cria ação nova (usa `registrar_acompanhamento`, `salvar_documentos_grupo`, `salvar_nota_obra`, todas "registro").
- MLP: `guardar_memoria`/`corrigir_memoria`/`esquecer_memoria` = "registro". E5 não cria ação. Desconhecida → "sério" (inalterado).

## Testes cruzados acrescentados
- `c5-e3-grupo-registro.test.ts` › "integração C5": (1) por código, `ACOES_DO_GRUPO` sem ação de memória, todas "registro", e os
  arquivos da E3 não leem a memória longa; (2) "anota: lembra que…" do dono no grupo vira anotação no cliente, nunca memória; a
  memória ativa não aparece em nada enviado; sem IA e sem linha em `dolores_consumo`; (3) pedido não reconhecido segue a marcação
  comum, conta em "grupos" e não leva a memória ao modelo.
- `c5-memoria-longa.test.ts`: a chamada com o bloco da memória conta na parte "conversa".
- Mapeamento do gasto: a E3 não chama a IA (nada a contar); a marcação comum fica em "grupos"; a memória entra na reserva da "conversa".

## Suíte integrada (vitest `--maxWorkers=2 --minWorkers=1`)
- `server/dolores` + `integracoes-anthropic`, `integracoes-modelo-por-funcao`, `admin-permissions`, `operacional`, `relatorios`:
  **72 arquivos, 1.303 testes, todos verdes** (1ª rodada parou no teto de 3.000 s com 48 arquivos/1.099 testes e as 2 falhas acima;
  os 24 restantes rodaram à parte: 204 verdes; os 2 arquivos corrigidos de novo: 43 verdes).
- `npx tsc --noEmit` limpo; `npx vite build` ok.

## Correções da revisão automática (etapas 1 e 2, já em produção) — feitas nesta integração
Sem migração. Cada uma com teste que falha sem a correção e passa com ela.
- **A (segurança)** `server/dolores/memoria.ts`: rótulo de referência (nome de grupo/cliente/obra) passa por `rotuloSeguro`
  (`sanitizarTexto(…, FILTRO_DO_REGISTRO)` + `limparNomeDeTerceiro`) ANTES de gravar (`gravarNaConversa`, `referenciaDoGrupo`,
  `referenciasDoResultado`) e de novo na LEITURA (`janelaDe`: rótulo e texto de linhas antigas). `server/dolores/memoria-longa.ts`:
  texto da lembrança filtrado de novo na leitura. Teste: `revisao-automatica-c5.test.ts` › A (senha, `sk-ant-…`, agência/conta).
  Resultado de consulta e resumo da fila já passavam pelo filtro (`sanitizarResposta`/`textoParaGravar`).
- **B** `server/dolores/leitura/grupos.ts`: sem linha em `dolores_marcacoes_grupo`, `respondeQuandoMarcada` = `ligadoPorPadrao` (o
  mesmo da marcação). Teste: `revisao-automatica-c5.test.ts` › B.
- **C** `server/dolores/whatsapp.ts`: entrega incompleta → a memória guarda só o texto do modelo das partes enviadas (`textoEntregue`,
  sem numeração nem quadros) + `MARCA_ENTREGA_INCOMPLETA`. Teste: `e8-qa-seguranca.test.ts` (2 testes novos).
- **D** `server/dolores/grupos-decisao.ts` (`gruposEsperandoTipo`): tipo indefinido, entrada provada e pergunta dos últimos 30 min no
  SQL, antes do `LIMIT 50` (ordem por id; o filtro em JS continua). Teste: `revisao-automatica-c5.test.ts` › D (60 vencidos + 2).
- **1** `server/dolores/aprovacoes.ts` (`porNaFila`, vale para TODAS as ações: grupo, tarefa, acompanhamento, cobrança, notas,
  memória longa, registro a partir do grupo): pedido novo para o mesmo alvo com argumentos/resumo diferentes SUBSTITUI o que esperava
  (o antigo → `vencida`, motivo "substituído…"); executa e mostra o ÚLTIMO pedido.
- **2** idem + `server/dolores/pendencia.ts` + `shared/dolores/confirmacao.ts`: na conversa com "pode" (validade curta), o mesmo
  pedido repetido RENOVA o item (código e prazo novos; a validade gravada não muda por causa do gatilho da 0125); a proposta nunca
  vale mais que o menor `venceEm` dos itens e a pergunta diz a validade real ("Vale por N minutos"). Fila da tela (horas): pedido
  igual continua reaproveitando o item. Testes: `c5-e2-resolve.test.ts` › "revisão automática" (4).
- Teste ajustado ao comportamento corrigido: `correcoes-e3-whatsapp.test.ts` › A9 (pedido repetido: o antigo vence, um só executável).

## Suíte depois das correções
- 73 arquivos (os 72 + `revisao-automatica-c5`): 48 arquivos/1.105 testes + 25 arquivos/212 testes; a única falha (A9, acima)
  foi ajustada e o arquivo passou (5/5). `npx tsc --noEmit` limpo; `npx vite build` ok.
