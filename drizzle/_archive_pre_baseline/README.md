# Migrations arquivadas (pré-baseline)

Estas migrations (`0000` a `0025`) e seus snapshots foram arquivados em 2026-09-06 e
substituídos por um baseline único (`drizzle/0000_baseline_postgres_2026_09_06.sql`).

## Por quê

- Os snapshots `0000` a `0013` tinham `"dialect": "mysql"` — resíduo de uma configuração
  antiga, incompatível com o projeto real (Postgres/Neon). Isso fazia `drizzle-kit generate`
  reportar "data is malformed" e silenciosamente não gerar nada (saía com exit 0 sem
  criar migration nenhuma).
- `drizzle/meta/_journal.json` não tinha entrada para a migration `0024_secure_payment_settings.sql`,
  que já existia como arquivo — o journal estava desatualizado em relação aos próprios arquivos SQL.
- Verificado diretamente no banco de produção (Neon, projeto `SiteProspecta`): a tabela de
  controle `drizzle.__drizzle_migrations` não existia. Ou seja, `drizzle-kit migrate`/`db:push`
  nunca rodou de fato contra produção — o schema real foi mantido por outros meios (muito
  provavelmente execução manual de SQL pela plataforma Manus, que originou o projeto; ver
  `.manus/db/`). Isso também explica por que a tabela `payment_settings` (migration 0024)
  não existia em produção até este baseline ser aplicado.
- Também foram encontradas em produção três tabelas (`incorporation_studies`, `regularizacoes`,
  `regularizacao_documents`) que não aparecem em nenhum lugar do código (nem `schema.ts`, nem
  routers, nem estas migrations arquivadas). Origem desconhecida — provavelmente um
  experimento abandonado. Não foram tocadas; ficam de fora do schema Drizzle até alguém
  decidir adotá-las (candidatas naturais para os EPIC-004/EPIC-008 do roadmap) ou descartá-las.

## O que foi feito

1. Estas migrations/snapshots foram movidos para cá (histórico preservado, fora do caminho
   ativo do drizzle-kit).
2. `drizzle-kit generate` foi rodado do zero contra o `schema.ts` atual (já sem `contractors`/
   `investors`/`lots`/`partnerDistributions`, removidos no EPIC-000), gerando um único baseline
   `0000_baseline_postgres_2026_09_06.sql` com dialect `postgresql` correto.
3. Produção foi conferida tabela a tabela contra esse baseline. A única diferença real era a
   tabela `payment_settings` (migration 0024, nunca aplicada) — foi criada agora, vazia.
4. A tabela `drizzle.__drizzle_migrations` foi criada em produção e uma linha foi inserida
   marcando o baseline como já aplicado (hash sha256 do arquivo + `created_at` igual ao `when`
   do journal), para que `drizzle-kit migrate` não tente recriar tabelas que já existem.

## Daqui pra frente

`npm run db:push` (`drizzle-kit generate && drizzle-kit migrate`) volta a ser seguro de usar
para mudanças incrementais de schema. Ainda assim, para qualquer migration que remova dados
(DROP TABLE/COLUMN), prefira revisar o SQL gerado antes de aplicar — `drizzle-kit migrate` não
pede confirmação.
