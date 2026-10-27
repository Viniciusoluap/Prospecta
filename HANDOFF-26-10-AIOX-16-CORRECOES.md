# HANDOFF 26/10 — AIOX, 16 correções

## Retomada após limite dos agentes — 27/10/2026, entrega controlada

- Trabalho interrompido recuperado dos worktrees e protegido em commits: Prospecta 038f8f3 e Santa Fé cb9647c; integrados na branch de trabalho.
- Recebimentos parciais implementados com chave idempotente, limite do saldo, histórico e quitação apenas no total. Testes adicionais: Prospecta arquivo BPO 12/12; Santa Fé 5/5 testes de baixas. TypeScript Santa Fé aprovado.
- Prospecta: transações interativas agora usam sessão Neon WebSocket nativa do Node 24, preservando consultas e batch HTTP existentes. Teste real SELECT 1/transação e rollback aprovados sem alterações de dados.
- Migrações de produção já aplicadas: Prospecta 0077–0082; Santa Fé projeto_documentos, identificador Pluggy, auditoria BPO, índice CRM sem exclusão, templates e vínculos operacionais.
- Revisão automática rejeitou a antiga migração CRM por conter exclusões; alternativa aditiva aplicada com sucesso, sem apagar clientes nem reescrever vínculos. Coluna histórica servicos preservada.
- Backups aiox_backup_20261027 preservados. Registros bancários legados com origem não comprovada protegidos como legado.
- Ainda aplicar: Prospecta 0083 e Santa Fé 20261027150000 (recebimentos parciais), após publicação deste checkpoint.
- Pendências reais: build remoto dos últimos ajustes, PR/merge, deploy produção e smoke. Validação de dispositivos físicos iPhone/Android/PWA não realizada nesta sessão; não declarar aceite físico.

## Pré-entrega autorizada — 27/10/2026

- Autorização reiterada pelo proprietário para concluir, migrar, merge e deploy.
- Suíte completa em lotes: Prospecta 147 arquivos/1.093 testes aprovados; Santa Fé 115 arquivos/829 testes aprovados (arquivos de banco real separados não executados nessa rodada). Logs locais temporários em /tmp; contagens registradas aqui para continuidade.
- As duas prévias Vercel estavam READY nos commits remotos 532e6e7 (Prospecta) e 4c636a6 (Santa Fé).
- Estrutura real dos bancos consultada por conectores; migrações iniciais validadas em PGlite sobre cópia do schema real.
- Neon recusou nova branch e snapshot por limites do plano; nenhum recurso de outro agente foi removido.
- Backup lógico pré-migração criado em schema privado aiox_backup_20261027 nos dois bancos: lançamentos, clientes e revisões. Prospecta: 1.011 lançamentos, zero clientes; Santa Fé: 5 lançamentos, zero clientes.
- Restauração: tabelas de backup mantêm os valores anteriores; realizar recuperação seletiva por ID após inspeção, nunca substituir integralmente dados novos.
- Diagnóstico Pluggy real: autenticação 200; endpoint legado 410 ENDPOINT_DEPRECATED; v2 200, sem transações; item UPDATED/SUCCESS. Não declarar importação de movimentações sem registros retornados.
- Integrações finais BPO/WhatsApp/Projetos em revisão; migrações novas, testes finais e smoke autenticado ainda pendentes. Merge/deploy do lote ainda não realizados.

## Revisão de aceite WhatsApp/Projetos — 27/10/2026

- Repositório: Prospecta; branch isolada `codex/aiox-whatsapp-projects-acceptance`, base HEAD da branch principal de trabalho publicada.
- Objetivo desta etapa: fechar lacunas 03/05/06 encontradas na revisão estática e manter paridade.
- Corrigido: serviços não são mais inferidos automaticamente do cadastro ao montar o envio; a seleção explícita prevalece e a ausência bloqueia a variável.
- Corrigido: campos de dia/horário permanecem visíveis e editáveis após preenchimento. PDF abre em visualizador com retorno; outros documentos têm diálogo e download em outra aba, preservando a montagem da conversa.
- A rota de mídia agora entrega PDF como `application/pdf; inline`, mantendo sandbox e download forçado para HTML/SVG.
- Santa Fé: RLS habilitado em templates, sem acesso para anon/authenticated via Data API; uso exclusivamente via servidor autorizado.
- Correção 16: revisão estática confirmou reserva de versão e checklist derivado do status ativo após upload concluído. Validação real da disponibilidade no Drive e navegação em dispositivos depende de ambiente autenticado.
- Correção 16: PDF rejeitado no campo Editável para impedir dupla conclusão usando o mesmo documento PDF nos dois campos; quatro testes de documentos passaram novamente em cada sistema.
- (a) Automáticos: TypeScript aprovado em ambos; Prospecta 22 testes focados e Santa Fé 18 testes focados aprovados.
- (b) Manuais: revisão estática; nenhum navegador/dispositivo real usado nesta etapa.
- (c) Produção: nenhuma migração aplicada, nenhum deploy e nenhuma mensagem real enviada. Publicação remota será feita pelo agente principal após integração.
- Próximo passo exato: integrar o commit desta branch, publicar checkpoint e realizar smoke test autenticado dos documentos/templates.

## Recebimentos parciais — 27/10/2026

- Etapa adicional solicitada pelo orquestrador para fechar Correção 13: criar baixas parciais sem duplicar receita e manter parcelas como lançamentos independentes.
- Migração aditiva `0083_bpo_recebimentos_parciais.sql`: acumulado `valor_recebido` e tabela imutável `bpo_recebimentos`, com chave única por envio e referência restritiva para preservar rastreabilidade.
- API de recebimento bloqueia o lançamento em transação, impede valor maior que saldo, registra antes/depois no histórico e só marca pago quando totaliza a cobrança. Repetir requestKey não soma novamente. Fontes Asaas/extrato devem ser baixadas na plataforma de origem/conciliação.
- Interface oferece Registrar recebimento com valor, data e observações e mostra recebido/saldo. Totais por cliente consideram valores parciais. DRE por competência mantém valor original da receita, sem lançar uma segunda receita por baixa.
- Quitação manual pela rota antiga também usa o serviço auditável. Edição impede reduzir valor abaixo do já recebido e recalcula pago se o valor total aumentar.
- Navegação reversa disponível no cabeçalho dos módulos operacionais para financeiro filtrado por categoria; financeiro aceita também `vinculoOperacionalId` como filtro persistente no URL.
- Teste PGlite focado aprovado: 40 + 60 completa 100, retry não duplica, 61 sobre saldo de 60 é bloqueado, ficam 1 cobrança, 2 baixas e 2 históricos.
- Próximo passo: confirmar typecheck/testes finais deste lote, integrar commit, publicar checkpoint e aplicar 0083 em ambiente seguro antes do deploy. Nenhuma produção alterada nesta etapa.

## Auditoria final BPO — 27/10/2026, início

- Worktree isolado `wt-prospecta-bpo-final`, branch `codex/prospecta-bpo-final`, base `90cd49f`.
- Lacunas confirmadas: limpeza não protege origem manual conciliada/novo vínculo operacional; despesa de comissão aponta cadastro errado; retry de criação não tem chave idempotente; edição não inclui vínculo operacional; sincronização CRM não considera cadastro livre com mesmo documento.
- Próximos passos: corrigir regras, adicionar testes críticos e verificar TypeScript; integração/publicação será feita pelo orquestrador.

### Conclusão do lote final BPO

- Corrigida a limpeza para preservar lançamentos de origem independente/manual e registros com vínculo operacional persistente, mesmo conciliados com a conta removida. Os novos importados recebem origem efetiva `extrato` explicitamente.
- Despesas de Comissões usam Imóveis como registro vinculado; receitas de Comissões continuam usando Comissões. UI e servidor compartilham a regra.
- Adicionada migração aditiva `0082_bpo_request_key.sql`: chave única por submissão impede duplicação em retry; outra chave permite nova parcela do mesmo serviço.
- Edição auditável permite trocar cliente, categoria e vínculo operacional, tipo de despesa e etapa. A validação do ID operacional é feita novamente no servidor. A lista financeira oferece navegação ao registro vinculado.
- Importação CRM reaproveita cadastro livre com mesmo documento e mantém dados financeiros; conflitos de documentos abortam a sincronização sem alterações parciais. Removido da UI o fluxo de seleção manual individual de leads.
- (a) Automáticos: TypeScript aprovado; PGlite limpeza 3/3, BPO 10/10, extrato 16/16 e teste adicional de importação CRM 1/1 aprovados. `git diff --check` aprovado.
- (b) Manuais: revisão de predicados de origem, mapeamento de comissão e fluxo de edição.
- (c) Produção: migração 0082 ainda não aplicada, publicação/merge/deploy a cargo do orquestrador. Recebimentos parciais continuam dependendo dos mecanismos existentes dos módulos; este lote não cria uma nova tabela de baixas parciais.
- Próximo passo exato: integrar este commit na branch principal de trabalho, publicar checkpoint, validar migração 0082 e testar no ambiente de homologação.
- Verificação final após remoção do seletor CRM: corrigida uma referência residual `modoCliente` no bloqueio do botão; TypeScript foi reexecutado e passou em 27/10/2026.

## Validação real Pluggy/Cora — 27/10/2026

- Diagnóstico real somente leitura na conexão ativa do Prospecta: autenticação HTTP 200; endpoint legado /transactions HTTP 410, código ENDPOINT_DEPRECATED, instruindo usar /v2/transactions. Endpoint v2 HTTP 200, results vazio e next nulo; item HTTP 200, status UPDATED, execução SUCCESS, conector MeuPluggy. Não afirmar recuperação de movimentações: a conta não disponibilizou transações nesta leitura.
- Documentação oficial consultada: https://v2.docs.pluggy.ai/en/reference/transaction/transactions-list-by-cursor e https://v2.docs.pluggy.ai/en/reference/transaction/transactions-list .
- Corrigido parâmetro de data para dateFrom; cursor aceito somente no formato query string previsto na API; chave externa histórica t.id preservada para não duplicar ao trocar v1 por v2. providerId/providerCode permanecem em identificador bancário separado.
- OFX agora preserva FITID. Importação consulta tanto a chave bancária nova como a chave histórica calculada por atributos/ocorrência, usando a existente antes de inserir. Isso impede duplicação ao reimportar um OFX antigo após a melhoria da extração.
- Nenhuma credencial foi alterada e nenhuma movimentação foi gravada em produção nesta validação.
- Testes automáticos: Prospecta: 3 arquivos/27 testes focados aprovados e TypeScript aprovado.
- Próxima etapa: integrar os commits, aplicar migrações aditivas, publicar e testar a sincronização administrativa. Reconciliação de itens recriados com IDs diferentes continua dependente do identificador bancário disponibilizado pelo provedor.

## Publicação remota confirmada — 27/10/2026

- Branch: `codex/aiox-16-correcoes-20261026`.
- Checkpoint publicado: `2fc4649b75b2934a1f9f014117e4acc7f9080888`.
- HEAD local de origem preservado: `82f0d938d3e68bd91d46162e1b0ea22463f6f063`.
- Publicação por conector GitHub em commit consolidado; a árvore remota foi comparada com a árvore local e é idêntica (`1196c2874cb68a4e075a0ada1106d9886190482b`).
- Todos os arquivos e Handoffs pendentes deste HEAD estão protegidos no GitHub. Os hashes dos commits locais originais não foram reescritos.
- Este checkpoint não representa merge, aplicação de migrações nem deploy. Pendências de validação permanecem registradas abaixo.

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
