# Plano de execução — EPIC-015

## Checkpoint local — 08/10/2026

- Typecheck aprovado.
- Suíte completa aprovada: 55 arquivos e 396 testes.
- Build de produção aprovado; permanece apenas o aviso já conhecido de tamanho de bundle.
- Reparação automática CRM → serviços → Obras implementada e protegida contra duplicidade.
- Módulos consolidados e rotas antigas preservadas como compatibilidade.
- Migration tributária criada, mas ainda não aplicada em produção.
- Nenhuma alteração desta branch foi implantada ou executada contra o banco de produção.
- Próximo gate: integrar a branch paralela, publicar preview, realizar UAT autenticado e conferir as
  contagens antes/depois da reparação.

## S-01 — Baseline e matriz de impacto

### Entregas

- Inventário de rotas, componentes, routers, tabelas, permissões e contagens por módulo.
- Comparação entre produção, `main` e a branch paralela do EPIC-014.
- Lista de rotas legadas e destino de cada redirecionamento.
- Backup/snapshot e roteiro de rollback antes de qualquer migration.

### Gate

Nenhuma alteração de schema ou dado começa sem contagens de referência.

## S-02 — Serviços e Obras

### Implementação

- Definir uma tabela/contrato canônico de roteamento de tipo de serviço para módulo operacional.
- Centralizar a criação do vínculo e do registro operacional numa transação.
- Usar chave única por `lead_service_id` no destino para impedir duplicidade.
- Fazer o vínculo novo criar o destino imediatamente.
- Criar rotina de reparação dos serviços já existentes, com modo de simulação e execução.
- Reconciliar os cartões do inventário Trello com os leads e serviços atuais.
- Permitir concluir, desvincular e excluir com regras explícitas:
  - concluir preserva histórico e registro operacional;
  - desvincular remove a associação, mas não apaga silenciosamente o operacional;
  - excluir exige confirmação e explica o efeito sobre o registro operacional.

### Testes mínimos

- vínculo novo cria Obra;
- serviço antigo cria Obra na reparação;
- segunda execução não duplica;
- falha no destino desfaz a transação;
- serviço sem dados mínimos fica pendente com motivo acionável;
- concluir/desvincular/excluir respeitam histórico.

## S-03 — BPO, tributação e relatórios

### Interface final

Abas: `Clientes`, `Cobranças`, `Despesas`, `DRE`, `Bancos`, `Contabilidade`, `Relatórios`.

### Contabilidade tributária

- Cadastro de empresas/CNPJs, regime e vigência.
- Bases tributáveis por período e origem.
- Tributos estimados, alíquotas, vencimentos e status.
- Cenários comparativos com premissas explícitas.
- RET por incorporação: empreendimento, CNPJ/SPE, afetação, adesão, vigência, base, estimativa e
  documentos/pendências.
- Calendário e alertas de obrigações.
- Recomendações de adequação baseadas em regras auditáveis, nunca em texto sem premissa.

### Relatórios

- Reutilizar a mesma fonte de dados e componentes da central atual.
- Preservar filtros, indicadores, gráficos, DRE e exportações.
- Redirecionar `/admin/contabilidade` e `/admin/relatorios` para `/admin/bpo` com a aba correta.

### Dados

O livro-razão financeiro atual não será apagado. Ele alimentará BPO/Relatórios e, quando aplicável,
as bases de cálculo tributário.

## S-04 — Tarefas e Agenda

### Interface final

Uma página `Tarefas e Agenda` com visualizações `Lista de tarefas`, `Agenda` e `Calendário`.

### Preservação

- Manter APIs e tabelas atuais inicialmente.
- Criar uma camada de composição no frontend/backend.
- Consolidar permissões por união de `dashboard/tarefas` e `agenda`.
- Redirecionar `/admin/tarefas` e `/admin/agenda` para a visualização correspondente.

### Critérios específicos

- Tarefas mantêm SLA, prioridade, responsável, prazo e estado.
- Agenda mantém visita, lead, imóvel, corretor, cliente avulso, horário e observações.
- Um compromisso pode originar tarefa sem duplicar o evento.

## S-05 — Imóveis e Agregador/Feeds

### Interface final

Uma página `Imóveis` com abas `Catálogo`, `Captação/Feeds` e `Publicação`.

### Preservação

- `agregador_imoveis` continua como staging.
- `imoveis` continua como catálogo canônico.
- A importação registra origem e vínculo para não importar duas vezes.
- Proteções SSRF e verificação manual permanecem obrigatórias.
- `/admin/agregador` redireciona para `/admin/imoveis?aba=captacao`.

## S-06 — Painel e produtos

### Painel

- Remover somente da navegação: Dashboard, Orçamentos e Emails.
- Renomear Pagamentos para API Contas.
- Manter Usuários e Acessos.
- Verificar consumidores antes de qualquer exclusão posterior de código ou tabela.

### Upload de produto

- Endpoint autenticado de upload com limite, MIME permitido e nome aleatório.
- Armazenamento persistente configurado por ambiente.
- Campo de arquivo com `accept="image/*"` e captura de câmera compatível com dispositivos móveis.
- Prévia, progresso, erro, troca e remoção.
- Compatibilidade com `imageUrl` existente.
- Limpeza segura de arquivo órfão apenas depois de confirmar que nenhum produto o referencia.

## S-07 — RBAC, rotas e botão Voltar

- Criar aliases de permissões durante a transição.
- Migrar usuários pela união das permissões antigas.
- Proteger cada endpoint pelo novo domínio consolidado.
- Manter redirecionamentos das rotas antigas e telemetria de uso.
- Auditar todas as rotas administrativas de lista/detalhe/edição/criação.
- Adotar um componente de retorno com histórico quando válido e fallback explícito por módulo.
- Validar posição, contraste, teclado, leitor de tela e viewport móvel.

## S-08 — Qualidade, migração e produção

### Pipeline

1. Typecheck.
2. Testes unitários de roteamento e permissões.
3. Testes de integração de banco e idempotência.
4. Build de produção.
5. Preview deploy.
6. UAT autenticado em desktop e iPad/iPhone.
7. Snapshot do banco.
8. Migration e reparação em modo simulação.
9. Aprovação das contagens.
10. Execução real e conciliação.
11. Deploy gradual e monitoramento.

### Evidências obrigatórias

- Matriz antes/depois por módulo.
- Relatório da reparação de serviços/Obras.
- Capturas das interfaces consolidadas.
- Resultado de testes e build.
- Checklist de rotas antigas.
- Plano de rollback testado.

## Coordenação com a branch paralela

- Base de implementação: `origin/main` após o merge do EPIC-014 ou rebase explícito sobre a branch
  `fix/correcoes-site-institucional-20261008`.
- Arquivos com risco de conflito: `client/src/App.tsx`, `client/src/pages/Admin.tsx`,
  `server/routers.ts` e documentação de roadmap.
- Cada story deve virar um commit isolado; migrations ficam em commit próprio.
- Não promover a produção enquanto a branch institucional ainda estiver divergente nesses arquivos.

## Paridade Grupo Santa Fé

Depois de estabilizar a Prospecta, abrir um épico espelho no Grupo Santa Fé com os mesmos critérios
de negócio. A implementação será adequada à stack Next.js/Prisma, preservando bancos separados.
Nenhuma mudança deve ser considerada encerrada globalmente até a matriz de paridade ser assinada.

