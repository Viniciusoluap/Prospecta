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
