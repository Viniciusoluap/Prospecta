# S-E — Camadas do mapa do terreno que não voltam "indisponível"

Status: Done (publicada em 15/11/2026)
Epic: EPIC-023 (Etapa E) — correção 9 do dono (15/11/2026)
Paridade: **portar ao Grupo Santa Fé**.
Tamanho estimado: M
Bloqueios: decisão 1 do dono (publicar e aplicar migração aditiva fora do EPIC-022).

## Problema

As camadas do mapa do terreno voltam "indisponível": MapBiomas/EPE com 503; linhas de transmissão e dutos com EPE
503 e IBAMA sem resposta; Overpass com 406/429. Em `server/_core/geo/camadas-terreno-busca.ts` não há repetição, o
cache é só em memória por 12 h e `obterJson` (:27-35) não envia User-Agent.

## Critérios de aceite
- [x] AC1: toda consulta externa envia User-Agent identificando o sistema de forma genérica.
- [x] AC2: falhas temporárias (503, 429, tempo esgotado) são repetidas com espera crescente; o Overpass respeita o
      limite dele (não repete antes do tempo pedido e não dispara consultas em paralelo além do permitido).
- [x] AC3: o último resultado bom de cada camada, por terreno, é gravado com a data em tabela nova (migração aditiva,
      `CREATE TABLE IF NOT EXISTS`).
- [x] AC4: se a fonte falhar, o mapa mostra o último resultado bom e a data dele.
- [x] AC5: a mensagem separa "fonte fora do ar" (com data do último resultado bom, se houver) de "nada no entorno"
      (fonte respondeu e não há elemento).
- [x] AC6: o cache em memória continua, mas não é mais a única proteção.

## Tarefas
- [x] T1: User-Agent em `obterJson`.
- [x] T2: repetição com espera crescente e controle de limite do Overpass.
- [x] T3: migração aditiva da tabela do último resultado bom; leitura e gravação no servidor.
- [x] T4: estados distintos em `shared/geo/camadas-terreno.ts` e mensagens em `mapa-terreno.tsx`.
- [x] T5: suíte, `pnpm check`, `vite build`; aplicar migração no Neon (após decisão 1); HANDOFF; pendência de porte.
      _(feito: suíte, `tsc --noEmit`, `vite build`, HANDOFF. Pendente: aplicar `drizzle/0116_camadas_terreno_cache.sql`
      no Neon — o líder aplica; o código funciona sem a tabela, só sem persistência — e o porte ao Grupo Santa Fé.)_

## Arquivos principais
- `server/_core/geo/camadas-terreno-busca.ts`, `server/routes/camadas-terreno.ts`
- `shared/geo/camadas-terreno.ts`
- `client/src/components/incorporacao/estudo/mapa-terreno.tsx`
- `drizzle/schema.ts`, nova migração em `drizzle/`

## Testes previstos
- Automáticos (`server/geo-camadas-terreno.test.ts`): User-Agent enviado; 503 repetido e depois sucesso; 429 do
  Overpass respeita a espera; falha total devolve o último resultado bom com data; "fora do ar" diferente de "nada
  no entorno".
- Manuais: mapa do terreno de um estudo real com as fontes respondendo e com uma fonte simulada fora do ar.
- Pendente em produção: comportamento real das fontes públicas a partir da Vercel.

## Riscos
- Fontes públicas fora do controle do sistema → último resultado bom com data.
- Repetição aumentar o tempo de resposta → limite de tentativas e de espera.

## Dev Notes (15/11/2026)
- [AUTO-DECISION] Quantas repetições? → 2 extras por consulta (1 por servidor no Overpass, que tem 4 espelhos);
  espera 1 s, 2 s (+ até 0,5 s de jitter) ou o Retry-After, o que for maior (razão: pedido do dono e limite de 60 s).
- [AUTO-DECISION] Orçamento → 50 s por requisição; cada fonte principal deixa 12 s reservados por espelho seguinte
  (razão: repetir a principal não pode deixar o espelho sem tempo).
- [AUTO-DECISION] O que repetir → tempo esgotado, erro de rede, 408/425/429, 5xx e erro 429/5xx do ArcGIS com
  HTTP 200; 400/404/406 não (razão: só falhas passageiras).
- [AUTO-DECISION] O que gravar → "ok" e "vazio" (os dois são resposta da fonte); salvo com menos de 12 h vale como
  cache (cobre o reinício da função na Vercel); "tentar de novo" ignora os dois caches mas ainda cai no salvo.
- [AUTO-DECISION] Overpass com 200 + `remark` de "runtime error" → falha temporária (antes virava "nada mapeado").
- Retry-After do servidor fica guardado por host: não é consultado de novo antes do tempo pedido.

## File List
- `server/_core/geo/camadas-terreno-busca.ts` — User-Agent/Accept, repetição com espera crescente + jitter só em
  falha temporária, Retry-After, orçamento de 50 s por requisição com reserva para os espelhos, fila por servidor do
  Overpass, Overpass interrompido ("remark") não vira "vazio", leitura/gravação do último resultado bom.
- `server/_core/geo/camadas-terreno-armazem.ts` (novo) — armazenamento no banco (tolera a tabela ausente).
- `server/routes/camadas-terreno.ts` — passa o armazenamento do banco para a busca.
- `shared/geo/camadas-terreno.ts` — `desatualizado`/`salvoEm` em `EstadoCamada`; 4 instâncias do Overpass.
- `client/src/components/incorporacao/estudo/mapa-terreno.tsx` — "consultado: …", "fonte fora do ar ou sem
  resposta", "dado salvo em dd/mm/aaaa — fonte fora do ar agora"; "tentar de novo" também no dado salvo.
- `drizzle/0116_camadas_terreno_cache.sql` (novo) — migração aditiva (`CREATE TABLE IF NOT EXISTS`).
- `drizzle/schema-camadas-terreno.ts` (novo) e `drizzle.config.ts` — tabela no schema Drizzle.
- `server/geo-camadas-terreno-resiliencia.test.ts` (novo) — 21 testes.
- `server/geo-camadas-terreno.test.ts` — testes antigos sem espera real entre repetições.
- `HANDOFF-15-11-CORRECOES.md` — Etapa E.

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 15/11/2026 | @pm (Bob) | Story criada em Draft |
| 15/11/2026 | @dev (Dex) | Draft → InProgress → Ready for Review: implementação, testes e migração escrita (não aplicada) |
