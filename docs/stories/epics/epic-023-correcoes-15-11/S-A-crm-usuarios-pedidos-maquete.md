# S-A — CRM no iPad, fim da tela "Corretores", filtro de perfis e lista de pedidos da Maquete 3D

Status: Done (publicada em 15/11/2026)
Epic: EPIC-023 (Etapa A) — correções 1, 2, 3 e 5 do dono (15/11/2026)
Paridade: correções 1, 2 e 3 **portar ao Grupo Santa Fé**; correção 5 é Maquete 3D (exceção registrada).
Tamanho estimado: M
Bloqueios: decisão 1 do dono (publicar fora do EPIC-022); decisão 2 (acesso de colaborador a corretores) bloqueia só
a remoção da tela.

## Problema

1. No iPad, a página inteira do CRM Pipeline rola e arrasta, sobram vazios e dá para deixar a tela toda preta. Só os
   cartões dentro das colunas devem se mover.
2. "Corretores" repete o que "Usuários e acesso" já faz, mas "Usuários e acesso" ainda não tem tudo que "Corretores"
   tem.
3. "Usuários e acesso" não filtra por tipo de usuário.
4. Na lista de pedidos da Maquete 3D não há excluir na linha, e a coluna "Criada em" aparece cortada.

## Critérios de aceite

### Correção 1 — CRM Pipeline
- [x] AC1: a tela do Pipeline ocupa exatamente a altura do viewport (`100dvh`); a página em si não rola nem arrasta
      no iPad (Safari), em retrato e paisagem.
- [x] AC2: o trilho de colunas rola só na horizontal (`flex-1 min-h-0`), e a lista de cartões de cada coluna rola só
      na vertical (`flex-1 overflow-y-auto overscroll-contain`), sem altura fixa de 600 px.
- [x] AC3: não é possível puxar a tela para fora e deixá-la preta (rolagem não "vaza" para a página).
- [x] AC4: arrastar cartão entre colunas continua funcionando como hoje (`touch-action` definido por eixo).

### Correção 2 — remover "Corretores" sem perder função
- [x] AC5: "Usuários e acesso" passa a ter, para usuários com perfil Corretor: comissão padrão (%), observações,
      busca por nome/e-mail/CRECI, filtro "Situação" e criar corretor sem envio de e-mail de senha.
- [x] AC6: os dados continuam em `broker_profiles` (`notes`, `default_commission_pct`); nada é apagado nem migrado
      de tabela. `default_commission_pct` continua lido por obra-financeiro-router, juridico-modelos e comissões.
- [x] AC7: só depois de AC5 e AC6 testados: o tile (`Admin.tsx:68`), a rota `/admin/corretores` e a tela
      `AdminBrokerDirectory.tsx` são removidos; o acesso antigo à rota cai em "Usuários e acesso" (sem tela quebrada).
- [x] AC8: o tratamento do colaborador segue a decisão 2 do dono (perder o acesso, ou ter a parte de corretores
      liberada). Sem decisão, AC7 não é executado.
- [x] AC9: os consumidores são ajustados: `shared/admin-permissions.ts`, `server/_core/trpc.ts:87`,
      `GlobalBackButton.tsx:46`. O `corretoresRouter` (`server/operacional-router.ts:286-427`) só sai quando nenhuma
      chamada restar; o que ainda for usado passa para `server/configuracoes-router.ts`.

### Correção 3 — filtro de perfil
- [x] AC10: "Usuários e acesso" tem filtro com as opções Todos, Administrador, Corretor, Colaborador, Engenheiro,
      Cliente e Empreiteiro — exatamente os perfis de `PERFIS`/`ROLE_LABEL` (`AdminConfiguracoes.tsx:17-23`).
- [x] AC11: o filtro combina com a busca e com o filtro de situação.

### Correção 5 — lista de pedidos da Maquete 3D
- [x] AC12: cada linha da lista tem botão de excluir.
- [x] AC13: se o pedido ainda não foi recusado, excluir pede antes a confirmação da recusa com motivo (mesmo fluxo de
      `recusar`, `server/maquete-3d/router.ts:224-230`) e depois exclui (`excluir`, :232-238); se já está recusado,
      pede confirmação simples.
- [x] AC14: a coluna "Criada em" não quebra nem corta (`whitespace-nowrap`, `AdminMaquete3D.tsx:103`).

## Tarefas
- [x] T1: reestruturar o layout de `AdminCRM.tsx` (:216, :487, :492, :500) conforme AC1–AC4.
- [x] T2: levar comissão padrão, observações, busca, filtro de situação e criação sem e-mail para
      `AdminConfiguracoes.tsx` e `server/configuracoes-router.ts`.
- [x] T3: testes das funções migradas (permissão só admin, gravação em `broker_profiles`).
- [x] T4: registrar a decisão 2 do dono; aplicar a regra de acesso do colaborador.
- [x] T5: remover tile, rota e tela de Corretores; ajustar `shared/admin-permissions.ts`, `server/_core/trpc.ts:87`,
      `GlobalBackButton.tsx:46`; remover ou mover o `corretoresRouter`.
- [x] T6: filtro de perfil em "Usuários e acesso".
- [x] T7: botão excluir com recusa prévia na lista de `AdminMaquete3D.tsx`; `whitespace-nowrap` em "Criada em".
- [x] T8: suíte, `pnpm check`, `vite build`; HANDOFF; registrar pendência de porte (1, 2, 3) no ROADMAP.

## Arquivos principais
- `client/src/pages/admin/AdminCRM.tsx`
- `client/src/pages/admin/AdminConfiguracoes.tsx`, `server/configuracoes-router.ts`
- `client/src/pages/admin/AdminBrokerDirectory.tsx`, `client/src/pages/admin/Admin.tsx`, `server/operacional-router.ts`
- `shared/admin-permissions.ts`, `server/_core/trpc.ts`, `GlobalBackButton.tsx`
- `client/src/pages/admin/AdminMaquete3D.tsx`, `server/maquete-3d/router.ts`

## Testes previstos
- Automáticos: ajustar `server/admin-navigation.test.ts`, `server/admin-permissions.test.ts`,
  `server/colaborador-modulos.test.ts`, `server/operacional.test.ts`; novos testes para comissão/observações/criação
  sem e-mail em configurações; filtro de perfil; excluir pedido de maquete não recusado exige recusa antes
  (`server/maquete-3d.test.ts`).
- Manuais: CRM Pipeline em iPad real (retrato e paisagem), arrastar cartão entre colunas; lista de pedidos.
- Pendente em produção: uso real pelo dono no iPad.

## Riscos
- Remover tela antes de migrar tudo perde função → ordem obrigatória T2–T3 antes de T5.
- Colaborador perder acesso sem aviso → T5 depende da decisão 2.

## File List
- `client/src/pages/admin/AdminCRM.tsx` — layout com altura da tela; só os cartões rolam dentro das colunas.
- `client/src/pages/admin/AdminConfiguracoes.tsx` — busca, filtro por tipo de usuário e por situação; comissão padrão, observações e cadastro de corretor sem convite.
- `server/configuracoes-router.ts` — `listUsers`, `createUser` e `updateUser` com os dados de `broker_profiles`.
- `client/src/pages/admin/AdminMaquete3D.tsx` — botão excluir na lista (recusa com motivo antes), coluna "Criada em" sem quebra.
- `client/src/App.tsx`, `client/src/pages/Admin.tsx` — atalho removido; `/admin/corretores` redireciona para "Usuários e acesso" filtrado em Corretor.
- `shared/admin-permissions.ts`, `server/_core/trpc.ts` — "Corretores" deixa de ser módulo (cadastro só do admin — decisão 2 do dono).
- Removidos: `client/src/pages/admin/AdminBrokerDirectory.tsx`, `client/src/pages/admin/AdminCorretores.tsx`.
- Testes: `server/admin-permissions.test.ts`, `server/colaborador-modulos.test.ts`, `server/operacional.test.ts`.

## Notas da implementação
- AC4: o Pipeline não tem arrastar-e-soltar de cartões (o cartão abre o lead ao toque); nada a preservar além do toque.
- `corretoresRouter` (servidor) foi mantido, agora só para admin: nenhuma lógica de comissão, contrato ou obra foi alterada.
- Sem migração: `broker_profiles` já tinha `notes` e `default_commission_pct`.
- Pedido publicado não é excluído pela lista: o botão fica desativado com o aviso "Despublique a maquete antes de excluir".

_(vazio — preencher na implementação)_

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 15/11/2026 | @pm (Bob) | Story criada em Draft |
