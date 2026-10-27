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

## Checkpoint de retomada — 27/10/2026, validação 1

- Correções 04–08: a tela de Templates passou a usar os registros persistentes, ganhou criação/edição, prévia e validação; a seção visual de Histórico foi removida, preservando a consulta usada pelos indicadores.
- Correção 05: seleção múltipla dos serviços reais e bloqueio do envio sem seleção confirmados no compositor.
- Correção 14: corrigido o contrato interno da importação CRM idempotente para sempre fornecer a lista vazia de serviços legados.
- Correção 16: mocks dos testes atualizados para validar a nova transação de solicitação de revisão sem enfraquecer o bloqueio concorrente.

### Testes deste checkpoint

- TypeScript: `./node_modules/.bin/tsc --noEmit` — aprovado.
- Focados: 8 arquivos, 62 testes; a primeira execução identificou 4 falhas de expectativas/mocks anteriores à nova regra. Após correção, os 23 testes afetados (`projeto-revisao` e `whatsapp-noite`) passaram.
- O `pnpm check` não foi usado porque o wrapper tentou purgar `node_modules` sem TTY; o binário TypeScript local equivalente foi executado diretamente, sem alterar dependências.
- Produção: nenhuma migração, merge ou deploy executado neste checkpoint.

### Próximo passo exato

Executar a suíte completa e o build, revisar migrações 0077–0081, integrar as conclusões paralelas do Santa Fé e publicar os commits remotos antes das ações de banco/merge/deploy.

## Checkpoint de validação — 27/10/2026, lote BPO/WhatsApp/Projetos

- Removida a cópia antiga `0077_bpo_vinculos_operacionais.sql`; a versão válida permanece sequencial em `0080`, evitando duas migrações com o mesmo conteúdo.
- O teste PGlite do BPO agora aplica as migrações 0077/0080/0081 e cobre a exigência do vínculo operacional; passou 9/9.
- Build de produção Vite + bundle do servidor aprovado. Há apenas avisos conhecidos de tamanho de chunks e import estático/dinâmico do jsPDF.
- Suíte ampla: 146 arquivos e 1.092 testes passaram; um worker encerrou por limite de heap de 2 GB antes do último arquivo. Não houve falha de asserção nesta execução. A validação será completada em lotes para reiniciar memória entre processos.
- Produção continua inalterada neste checkpoint.

### Próximo passo exato

Concluir a suíte em lotes, publicar a branch remota, abrir PR e validar migrações em banco seguro antes de merge/deploy.
