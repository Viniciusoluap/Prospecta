# S-E — Camadas do mapa do terreno que não voltam "indisponível"

Status: Draft
Epic: EPIC-023 (Etapa E) — correção 9 do dono (15/11/2026)
Paridade: **portar ao Grupo Santa Fé**.
Tamanho estimado: M
Bloqueios: decisão 1 do dono (publicar e aplicar migração aditiva fora do EPIC-022).

## Problema

As camadas do mapa do terreno voltam "indisponível": MapBiomas/EPE com 503; linhas de transmissão e dutos com EPE
503 e IBAMA sem resposta; Overpass com 406/429. Em `server/_core/geo/camadas-terreno-busca.ts` não há repetição, o
cache é só em memória por 12 h e `obterJson` (:27-35) não envia User-Agent.

## Critérios de aceite
- [ ] AC1: toda consulta externa envia User-Agent identificando o sistema de forma genérica.
- [ ] AC2: falhas temporárias (503, 429, tempo esgotado) são repetidas com espera crescente; o Overpass respeita o
      limite dele (não repete antes do tempo pedido e não dispara consultas em paralelo além do permitido).
- [ ] AC3: o último resultado bom de cada camada, por terreno, é gravado com a data em tabela nova (migração aditiva,
      `CREATE TABLE IF NOT EXISTS`).
- [ ] AC4: se a fonte falhar, o mapa mostra o último resultado bom e a data dele.
- [ ] AC5: a mensagem separa "fonte fora do ar" (com data do último resultado bom, se houver) de "nada no entorno"
      (fonte respondeu e não há elemento).
- [ ] AC6: o cache em memória continua, mas não é mais a única proteção.

## Tarefas
- [ ] T1: User-Agent em `obterJson`.
- [ ] T2: repetição com espera crescente e controle de limite do Overpass.
- [ ] T3: migração aditiva da tabela do último resultado bom; leitura e gravação no servidor.
- [ ] T4: estados distintos em `shared/geo/camadas-terreno.ts` e mensagens em `mapa-terreno.tsx`.
- [ ] T5: suíte, `pnpm check`, `vite build`; aplicar migração no Neon (após decisão 1); HANDOFF; pendência de porte.

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

## File List
_(vazio — preencher na implementação)_

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 15/11/2026 | @pm (Bob) | Story criada em Draft |
