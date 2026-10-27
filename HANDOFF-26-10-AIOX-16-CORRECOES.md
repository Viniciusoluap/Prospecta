# HANDOFF 26/10 — AIOX, 16 correções

## Identificação

- Repositório: `Viniciusoluap/Prospecta`
- Branch: `codex/aiox-16-correcoes-20261026`
- Base auditada: `main` em `08fdd3ddd6d6f5b8ade325fc6911c29c6a326e67`
- Sessão iniciada: 26/10/2026
- Autorização do proprietário: execução, merge e deploy.

## Objetivo

Auditar, implementar, testar e publicar as correções 01–16 do prompt mestre de 26/10/2026, mantendo paridade funcional com o Grupo Santa Fé e preservando dados e integrações.

## Estado inicial confirmado

- Clone limpo e alinhado a `origin/main`; nenhum arquivo local pendente.
- Nenhum PR aberto no repositório no início da sessão.
- Handoffs de 25/10 e commits recentes lidos; o lote anterior de BPO, WhatsApp, mídias e integrações já está em `main`.
- Não há código desta nova execução antes deste checkpoint.
- A auditoria requisito a requisito está em andamento para evitar duplicar funcionalidades já entregues.

## Matriz inicial

| Correções | Situação | Próxima ação |
|---|---|---|
| 01–08 WhatsApp | Em auditoria | Comparar UI, serviços, persistência e testes com os aceites |
| 09–15 BPO/integrações | Em auditoria | Mapear origem financeira, vínculos, Pluggy/Cora e migrações |
| 16 Projetos | Em auditoria | Mapear revisão, arquivos, versões e checklist |

## Proteções e decisões

- Nenhuma migração destrutiva será executada sem backup, prévia de impacto e caminho de recuperação.
- Credenciais e dados pessoais não serão registrados neste arquivo.
- Alterações serão feitas nesta branch, com checkpoints publicados por etapa.
- A ordem interna poderá mudar por dependência técnica, com justificativa registrada.
- Testes serão separados em: (a) automáticos, (b) manuais e (c) produção.

## Testes

- (a) Automáticos: ainda não executados neste checkpoint documental.
- (b) Manuais: estado Git, branch principal, HEAD, branches remotas, instruções e Handoffs conferidos.
- (c) Produção: nenhuma alteração realizada.

## Arquivos modificados

- `HANDOFF-26-10-AIOX-16-CORRECOES.md`

## Bloqueios

- Nenhum bloqueio confirmado. O GitHub CLI não está instalado; operações de PR/merge serão realizadas pelo conector GitHub.

## Próximo passo exato

Concluir a auditoria das 16 correções nos dois repositórios, publicar a matriz de lacunas neste Handoff e iniciar o primeiro lote técnico com testes focados.

## Checkpoint de retomada — 26/10/2026, noite

- Recuperados e integrados, sem descarte, os sete checkpoints locais deixados pela execução AIOX interrompida.
- Correções 10/11: migração para Pluggy `/v2/transactions` com cursor, erro detalhado e preservação do identificador bancário; importador Cora ampliado.
- Correção 16: estrutura aditiva para prioridade de revisão/documentos versionados e helper de nome canônico iniciados; UI e transações de revisão ainda pendentes.
- Correções 01–08: correção da identidade `fromMe`, modelos profissionais, variável `dia`, backend inicial de templates e remoção da aba Histórico iniciados; CRUD completo, visualizador e paridade Santa Fé pendentes.
- Correções 09/12: prévia de impacto, backup lógico, limpeza transacional e edição auditável iniciados.
- Correções 13–15: categorias operacionais separadas da classificação contábil, catálogo de registros reais e importação CRM idempotente iniciados.
- Migrações Prospecta renumeradas sequencialmente para `0077`–`0081`, evitando cinco arquivos concorrentes com o mesmo número.

### Testes deste checkpoint

- (a) Automáticos: instalação do Prospecta ainda em conclusão; suíte focada ainda não validada.
- (b) Manuais: commits parciais inventariados, cherry-picks revisados e conflito de imports resolvido preservando os dois blocos.
- (c) Produção: nenhuma migração ou dado alterado; merge/deploy ainda não executados.

### Próximo passo exato

Concluir as lacunas funcionais e a paridade do Santa Fé, criar testes das exclusões/vínculos/revisões/templates, executar typecheck/suítes/builds e publicar o próximo checkpoint antes de qualquer migração de produção.

## Retomada pelo Claude — 27/10/2026
- Base: `origin/codex/aiox-16-correcoes-20261026` (Prospecta `dcc2828`, Santa Fé `edea685`) trazida para a branch
  `claude/sync-mirrored-repos-bsqnz3` por fast-forward (nada descartado). O lote noturno de 25/10 já está em `main` (PRs #171/#234).
- Removida a cópia duplicada `drizzle/0077_bpo_vinculos_operacionais.sql` (idêntica à `0080_bpo_vinculos_operacionais.sql`;
  sequência final 0077 pluggy v2 · 0078 projetos · 0079 templates · 0080 vínculos BPO · 0081 exclusão/edição auditável).
- Atenção: o Codex validou mais coisas depois do último checkpoint publicado (ex.: lacuna WhatsApp Santa Fé com 43 testes),
  mas esses commits locais **não chegaram ao GitHub** antes do limite de uso. Só o que está no remoto foi aproveitado.
- O texto do "prompt mestre" com os aceites das correções 01–16 não está versionado; pedido ao dono para continuar sem inventar requisitos.

### Próximo passo exato
Receber o prompt mestre (01–16) → montar matriz requisito × situação (feito / parcial / falta) nos dois repos → executar as lacunas.
