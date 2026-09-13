# S-09 — Migrar RBAC legado (STAFF_ROLES) para permissão granular por módulo

**Status:** Done
**Etapa:** 6 (parte de código; UAT segue em S-08)

## Contexto

A Etapa 3 introduziu o catálogo de permissões granulares (`shared/admin-permissions.ts`,
`ADMIN_MODULES`) e o middleware `adminProcedure`/`canAccessAdminProcedure`
(`server/_core/trpc.ts`), que restringe corretor/colaborador por módulo específico
concedido no cadastro do usuário. Admin sempre tem acesso total.

Vários routers administrativos, porém, foram implementados antes dessa migração e
continuavam usando `protectedProcedure` + `requireRole(ctx, STAFF_ROLES)` — uma checagem
que libera qualquer usuário com papel `admin`, `corretor` ou `colaborador`,
**ignorando completamente a permissão de módulo**. Na prática, um colaborador sem a
permissão "bpo" (por exemplo) já conseguia acessar o BPO Financeiro, o que contraria o
modelo de permissão granular anunciado desde a Etapa 3. O checkpoint da Etapa 5 já
registrava esta pendência como escopo da Etapa 6.

## Escopo migrado

Todas as procedures abaixo passaram de `protectedProcedure` + `requireRole(ctx, STAFF_ROLES)`
para `adminProcedure` (que usa `procedureModules` já mapeado em `server/_core/trpc.ts`):

| Router | Módulo RBAC | Procedures migradas |
|---|---|---|
| `bpo` | `bpo` | `clientes.list`, `lancamentos.list`, `lancamentos.create`, `lancamentos.marcarPago`, `dre` |
| `bancario` | `banco` | `contas.list`, `contas.atualizarSaldo`, `transacoes.listByConta`, `transacoes.atualizarStatus`, `sincronizar` |
| `avaliacoes` | `avaliacoes` | `leadOptions`, `list`, `getById`, `create`, `update`, `updateChecklist`, `sugerirValor` |
| `agregador` | `agregador` | `scrape`, `list`, `getById`, `create`, `updateStatus` |
| `whatsapp` | `whatsapp` | `minhaConexao`, `leadsParaEnvio`, `historico`, `enviar` |

Também foi removida a chamada redundante `requireRole(ctx, STAFF_ROLES)` dentro do
sub-router `portal.admin.*`, que já usava `adminProcedure` desde a Etapa 3/4 — a checagem
manual não fazia nada além do que o middleware já garantia, mas confundia a leitura do
código (parecia um controle adicional).

## Decisões de implementação (não invenção)

- Procedures que já eram deliberadamente restritas a `admin` (ex.: `bpo.clientes.create`,
  `bancario.contas.create/delete`, `avaliacoes.delete`, `agregador.importarParaCatalogo`,
  `whatsapp.conexoesCorretores`) **não foram alteradas** — continuam com
  `requireRole(ctx, ["admin"])`, pois essa é uma regra de negócio mais restritiva que a
  permissão de módulo (ex.: só admin cadastra cliente BPO ou importa item do agregador
  para o catálogo público), não um bug de RBAC legado.
- `whatsapp.salvarConexao` e `whatsapp.desconectar` também não foram alterados: continuam
  restritos a `admin`/`corretor` (`requireRole(ctx, ["admin", "corretor"])`), porque a
  regra de negócio é que colaborador reutiliza a conexão do admin (`conexaoParaPapel`) em
  vez de ter uma conexão própria — migrar para `adminProcedure` mudaria esse comportamento
  (permitiria colaborador criar conexão própria), o que não foi pedido.
- `avaliacoes.getChecklistCatalog` não foi alterado (permanece `protectedProcedure` sem
  checagem de papel): expõe apenas catálogo estático de opções de vistoria, sem dado de
  cliente ou de negócio.

## Gates

- TypeScript sem erros (`npx tsc --noEmit`);
- Vitest: 48 arquivos, 297 testes aprovados (12 novos em `rbac-legacy-migration.test.ts`,
  cobrindo colaborador/corretor sem permissão negados e com permissão liberados, por
  módulo, além de admin com acesso total e cliente sempre bloqueado);
- build Vite e bundle do servidor (`esbuild`) aprovados;
- `git diff --check` aprovado;
- sem migration — mudança apenas na camada de autorização, nenhuma tabela alterada.

**Não testado nesta sessão:** UAT autenticado por papel em navegador real (sandbox sem
acesso à internet externa) — permanece em S-08.
