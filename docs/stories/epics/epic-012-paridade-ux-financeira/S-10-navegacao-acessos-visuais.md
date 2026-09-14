# S-10 — C2: Navegação e acessos visuais

**Status:** Done
**Contexto:** frente C2 do plano de correção Prospecta ↔ Grupo Santa Fé, coordenado com
GPT-6 Astra (responsável por pagamentos/webhooks/autenticação/permissões/adapter de
produção/validação integrada). Escolhida como a frente de menor complexidade para execução
imediata; C1 (relatórios de comissões) permanece mapeado, aguardando implementação.

## Método

Auditoria completa (somente leitura) da navegação: rotas (`client/src/App.tsx`), dashboard
admin pleno (`Admin.tsx`), central administrativa de staff (`AdminAcesso.tsx`), menu público
(`Navbar.tsx`) e menu mobile (Sheet).

## Achados e correções aplicadas

| Achado | Severidade | Correção |
|---|---|---|
| `AdminAcesso.tsx`: tile "Agregador" apontava para `/mercado` (página pública) em vez de `/admin/agregador` | Alto | `href` corrigido para `/admin/agregador` |
| `AdminAcesso.tsx`: módulo `relatorios` é uma permissão válida e concedível (`ADMIN_MODULES`), a tela existe e está correta em `Admin.tsx`/`App.tsx`, mas não havia entrada nenhuma na central de staff — um colaborador com a permissão concedida não tinha como chegar lá pela UI | Alto | Adicionada entrada `{ id: "relatorios", label: "Relatórios", href: "/admin/relatorios", icon: BarChart3 }` |
| Menu mobile (`Navbar.tsx`): botão "Entrar"/"Sair" ficava dentro da `ScrollArea` do Sheet, sem estar fixo — risco de exigir rolagem em telas baixas com muitos submenus | Médio | Movido para um `SheetFooter` fixo, fora da área rolável — sempre visível sem depender de scroll |

## Achados registrados, sem ação nesta rodada (fora do escopo estrito de "navegação"; envolvem o catálogo de permissões, território de Astra)

- `id` duplicado `"projetos"` (Projetos + Incorporação) e `"dashboard"` (Painel + Tarefas) em
  `AdminAcesso.tsx` — não é link quebrado (ambos os módulos usam o mesmo `module=` no
  `App.tsx`, então o comportamento é consistente), mas impede conceder um sem o outro.
- Módulos `banco` e `configuracoes` são concedíveis em `AdminConfiguracoes.tsx` mas não
  correspondem a nenhuma rota com `module=` em `App.tsx` — permissão "morta" do ponto de
  vista de UI (fail-safe, não fail-open).
- `AdminBpo.tsx` (rota `module="bpo"`) expõe uma aba bancária cujo backend exige o módulo
  `"banco"` (`server/_core/trpc.ts:34`) — descompasso de granularidade entre rota e ação, não
  uma falha de segurança (o backend protege corretamente).
- `console.log` residuais em `client/src/components/ProtectedRoute.tsx` — não tocado por ser
  parte do sistema de proteção de rotas (autorização), fora do escopo desta frente.

Todos os quatro itens acima foram comunicados a Astra na mensagem de entrega (ver
`CHECKPOINT-C2.md`), por tocarem o catálogo/granularidade de permissões.

## Sem correção necessária

- `client/src/App.tsx`: ordem das rotas no `<Switch>` do wouter está correta em todos os
  grupos com potencial conflito (`avaliacoes/laudos` antes de `:id`, `imoveis/novo` antes de
  `:id/editar` etc.).
- `Admin.tsx` (dashboard do admin pleno): todos os 7 módulos citados (Relatórios, Agregador,
  Agenda, Projetos, Mapa, Comissões, Corretores) já têm tile com destino correto.
- Duplicidade `/admin/financeiro` vs `/admin/contabilidade`: intencional e documentada em
  comentário no próprio `App.tsx` (compatibilidade com favoritos antigos), sem link ativo
  apontando para a rota legada.

## Gates

- TypeScript aprovado (`npx tsc --noEmit`, zero erros);
- Vitest: 49 arquivos, 330 testes aprovados — nenhuma regressão;
- build Vite e bundle do servidor (`esbuild`) aprovados;
- `git diff --check` aprovado.

**Não testado nesta sessão:** navegação em navegador real (sandbox sem acesso à internet
externa), mesma limitação já documentada em checkpoints anteriores.
