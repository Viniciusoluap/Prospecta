# Plano de conclusão — Prospecta + Grupo Santa Fé

Data-base: 2026-08-30  
Branch de trabalho: `codex/nextjs-santa-fe-unification`  
Base: `41e3b00` (`origin/main`)  

## Objetivo imutável

Entregar a Prospecta Construções com a cobertura funcional do Grupo Santa Fé, mantendo:

- identidade visual, cores e marca da Prospecta;
- landing page da Prospecta, incluindo vídeos e links existentes;
- ecossistema próprio de sorteios, bilhetes, UTEF, produtos e conversões;
- compatibilidade segura entre os usuários legados e o novo núcleo operacional;
- coexistência das tabelas legadas com as tabelas operacionais prefixadas por `ops_`.

## Estado confirmado deste checkpoint

| Item | Estado |
| --- | --- |
| Base Next.js do Grupo Santa Fé | Integrada |
| Landing e marca Prospecta | Preservadas |
| Ecossistema de sorteios Prospecta | Integrado |
| Auth legado + operacional | Unificado |
| Namespace Prisma | Isolado em `ops_*` |
| Webhook Asaas | Com idempotência persistida |
| Typecheck | Aprovado |
| Build | Aprovado, 56 rotas |
| Testes | Aprovados, 29 arquivos / 275 testes |
| Lint | Pendente; última medição: 23 erros / 46 avisos |
| Migração/deploy de produção | Não executado |

Checkpoints locais anteriores:

- `057810c` — plataforma Next.js unificada;
- `c63f864` — validação limitada à aplicação Next.js unificada.

## Contrato de execução do AIOX

O AIOX deve executar somente uma fase por vez. Cada fase começa a partir de uma árvore limpa e termina com um commit próprio.

Regras obrigatórias:

1. Conferir `git status --short --branch` e registrar o `HEAD` antes de alterar arquivos.
2. Não alterar a landing, as cores, os vídeos ou os links da Prospecta sem aprovação explícita.
3. Não remover nem renomear tabelas legadas. O novo núcleo deve continuar usando `ops_*`.
4. Não aplicar migrations em produção durante as fases de desenvolvimento ou homologação.
5. Não registrar segredos, tokens, chaves Asaas ou conteúdo de `.env` no Git.
6. Não misturar correções de fases diferentes no mesmo commit.
7. Executar as validações definidas na fase antes do checkpoint.
8. Se um gate falhar, corrigir dentro da mesma fase ou parar e registrar o bloqueio; nunca avançar silenciosamente.
9. Produzir, ao final da fase, um resumo com arquivos alterados, testes, resultado, commit e procedimento de rollback.
10. Não fazer merge em `main`, migration de produção ou deploy de produção sem autorização explícita do proprietário.

Convenção de commit:

```text
checkpoint/fase-N: descrição objetiva
```

Validação mínima comum a fases com alteração de código:

```bash
npm run check
npm test
npm run build
```

O lint passa a ser gate obrigatório a partir da Fase 1.

## Fase 0 — Publicação e recuperação

Objetivo: tornar o estado integrado recuperável remotamente e documentar a sequência de conclusão.

Entregas:

- publicar esta branch sem modificar `main`;
- conservar os checkpoints já criados;
- registrar este plano no repositório;
- confirmar que nenhum segredo entrou no histórico.

Gate:

- branch disponível no GitHub;
- worktree limpa;
- commits e resultados de validação identificados no relatório.

Rollback: excluir apenas a branch remota, sem tocar em `main`.

## Fase 1 — Qualidade estática e dívida herdada

Objetivo: zerar os erros de lint e remover avisos relevantes sem mudar comportamento.

Entregas:

- medir novamente o lint a partir deste checkpoint;
- corrigir os 23 erros conhecidos e revisar os 46 avisos conhecidos;
- eliminar `any` evitável, dependências ausentes em hooks, JSX inválido e violações de componentes React;
- manter os contratos das APIs e as telas existentes.

Gate:

```bash
npm run lint
npm run check
npm test
npm run build
```

Critério de saída: zero erro de lint; avisos restantes precisam estar justificados no relatório.

Checkpoint esperado: `checkpoint/fase-1: stabilize lint and static quality`

## Fase 2 — Auditoria de paridade funcional

Objetivo: provar, em uma matriz verificável, que as funções do Grupo Santa Fé estão presentes na Prospecta.

Entregas:

- comparar rotas, APIs, ações, perfis e fluxos dos dois repositórios;
- classificar cada função como equivalente, adaptada à Prospecta, preservada do legado ou pendente;
- implementar lacunas funcionais reais identificadas;
- preservar a landing e o ecossistema de sorteios durante qualquer correção.

Gate:

- matriz de paridade versionada em `docs/guides/`;
- nenhuma função marcada como pendente sem decisão explícita;
- validação mínima comum e lint aprovados.

Checkpoint esperado: `checkpoint/fase-2: complete functional parity audit`

## Fase 3 — Blindagem do ecossistema de sorteios

Objetivo: garantir consistência financeira e transacional nos fluxos próprios da Prospecta.

Entregas:

- testes para login operacional e legado;
- testes de compra de bilhete, compra de UTEF, conversão e consulta de saldo;
- confirmação de atomicidade em débito, crédito e conversão de produtos;
- testes de repetição e reprocessamento do webhook Asaas;
- testes de autorização administrativa e trilha de auditoria;
- tratamento consistente de estorno, falha e duplicidade.

Gate:

- testes de integração cobrindo caminhos feliz, duplicado, negado e reversão;
- nenhuma alteração de saldo fora de transação;
- validação mínima comum e lint aprovados.

Checkpoint esperado: `checkpoint/fase-3: harden raffle and utef ecosystem`

## Fase 4 — Ensaio de banco de dados

Objetivo: validar as migrations em uma cópia segura do banco real antes de qualquer produção.

Pré-condição: acesso autorizado a um backup sanitizado ou ambiente de staging.

Entregas:

- backup verificável do banco de origem;
- inventário de tabelas, índices, constraints e contagens antes da migration;
- aplicação ensaiada das migrations Drizzle necessárias e da baseline Prisma `ops_*`;
- verificação de colisões entre tabelas legadas e operacionais;
- comparação de contagens e invariantes depois da migration;
- ensaio documentado de rollback/restauração.

Gate:

- migration repetível em staging;
- zero perda ou sobrescrita de dados legados;
- rollback testado;
- relatório com duração e ordem exata dos comandos.

Checkpoint esperado: `checkpoint/fase-4: validate database migration rehearsal`

## Fase 5 — Interface, responsividade e acessibilidade

Objetivo: validar visualmente a experiência da Prospecta sem descaracterizar a marca.

Entregas:

- testes desktop e mobile das rotas públicas, autenticadas e administrativas;
- conferência dos vídeos e links da landing;
- navegação por teclado, foco visível, labels e contraste;
- estados de loading, vazio, erro e sucesso;
- metadados, sitemap, robots e compartilhamento social;
- evidências visuais das páginas críticas.

Gate:

- fluxos críticos aprovados em larguras mobile e desktop;
- nenhum link ou vídeo atual da landing quebrado;
- validação mínima comum e lint aprovados.

Checkpoint esperado: `checkpoint/fase-5: verify branded responsive experience`

## Fase 6 — Segurança e operação

Objetivo: preparar a aplicação para operar com segredos, pagamentos e perfis administrativos.

Entregas:

- matriz de variáveis por ambiente, sem valores secretos;
- revisão de RBAC, sessão, cookies, proxy e rotas administrativas;
- validação de assinatura/origem do webhook Asaas;
- revisão de CSRF, rate limiting, uploads, headers e exposição de erros;
- logs estruturados, alertas e indicadores mínimos;
- runbook de incidentes e rotação de segredos.

Gate:

- nenhum segredo no repositório ou bundle do cliente;
- ações administrativas e financeiras protegidas no servidor;
- validação mínima comum e lint aprovados.

Checkpoint esperado: `checkpoint/fase-6: secure production operations`

## Fase 7 — Homologação e UAT

Objetivo: provar o sistema em um ambiente semelhante ao de produção.

Entregas:

- deploy de preview/staging a partir da branch;
- banco e credenciais exclusivos de staging;
- smoke tests das 56 rotas e dos principais fluxos;
- pagamento e webhook usando sandbox do provedor;
- checklist de aceite do proprietário para landing, operação e sorteios;
- lista final de variáveis e passos de promoção.

Gate:

- UAT aprovado;
- nenhuma migration pendente ou executada manualmente sem registro;
- rollback de aplicação e banco confirmado.

Checkpoint esperado: `checkpoint/fase-7: approve staging and uat`

## Fase 8 — Produção controlada

Objetivo: migrar e publicar com janela, backup e retorno definidos.

Pré-condição: autorização explícita do proprietário após a Fase 7.

Ordem operacional:

1. congelar alterações e registrar os SHAs aprovados;
2. gerar e validar backup de produção;
3. aplicar migrations na ordem ensaiada;
4. publicar a aplicação;
5. configurar/confirmar a URL do webhook;
6. executar smoke tests imediatos;
7. monitorar erros, pagamentos e filas durante a janela de rollback.

Gate:

- health checks e fluxos críticos aprovados;
- dados conciliados após migration;
- tag/release criada no SHA publicado;
- rollback não utilizado ou registrado integralmente.

Checkpoint esperado: `checkpoint/fase-8: release unified prospecta platform`

## Fase 9 — Estabilização e encerramento

Objetivo: confirmar estabilidade e entregar documentação final.

Entregas:

- monitoramento intensivo por 24–48 horas;
- conciliação de pagamentos, bilhetes, saldos UTEF e webhooks;
- correção isolada de incidentes, cada uma com seu próprio checkpoint;
- relatório final de paridade, migrations, deploy e rollback;
- merge em `main` somente após aprovação explícita;
- arquivamento de branches antigas apenas com autorização.

Gate:

- nenhuma divergência financeira ou erro crítico aberto;
- documentação operacional entregue;
- aceite final registrado.

Checkpoint esperado: `checkpoint/fase-9: close post-release stabilization`

## Modelo obrigatório de relatório por fase

```markdown
# Relatório da Fase N

- HEAD inicial:
- Escopo executado:
- Arquivos alterados:
- Migrations criadas/aplicadas:
- Testes e resultados:
- Riscos ou pendências:
- Commit do checkpoint:
- Como reverter:
- Próxima fase autorizada: sim/não
```

## Próxima ação

Concluir a Fase 0 publicando a branch. Em seguida, iniciar somente a Fase 1. Produção permanece fora de escopo até a aprovação explícita prevista na Fase 8.
