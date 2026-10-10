# EPIC-015: Consolidação operacional, serviços e navegação

**Owner:** Codex / AIOX  
**Status:** In Progress — implementação local concluída; integração, migração e UAT pendentes
**Origem:** validação visual do proprietário em produção em 08/10/2026  
**Dependências:** EPIC-012, correções de Obras já publicadas e conclusão/integração do EPIC-014

## Objetivo

Eliminar redundâncias do painel administrativo sem perder dados ou regras, fazer os módulos
operacionais consumirem os serviços escolhidos no CRM e reduzir a operação a uma fonte de
verdade por domínio.

O resultado esperado é um fluxo único:

`Lead/cliente → serviço contratado → registro operacional → tarefas/agenda → financeiro/tributário → relatórios`

## Regras obrigatórias

1. Ocultar um atalho não encerra uma story: dados, API, permissões, histórico e navegação precisam
   convergir para o módulo consolidado.
2. Nenhum registro existente pode ser apagado durante a consolidação.
3. Rotas antigas permanecem temporariamente como redirecionamentos compatíveis, sem aparecer no
   painel, até a validação final.
4. Migrações precisam ser idempotentes, transacionais e precedidas de snapshot do banco.
5. Dados ausentes permanecem vazios; não serão fabricados valores para criar Obras ou outros
   registros operacionais.
6. A criação automática deve ser repetível sem gerar duplicidades.
7. Toda ação destrutiva exige confirmação e deve respeitar vínculos existentes.
8. RBAC precisa ser validado no frontend e no backend.
9. A mesma regra de negócio deverá existir no Grupo Santa Fé, respeitando a stack própria de cada
   sistema e a separação física dos dados.

## Decisões de produto confirmadas

### Obras e serviços do CRM

- Todo serviço vinculado a um lead deve gerar imediatamente o registro operacional correspondente
  quando o destino possuir módulo operacional.
- `Obra / reforma` e demais serviços destinados a Obras devem aparecer em Obras sem depender da
  conclusão do lead ou de uma ação manual posterior.
- O vínculo precisa ser bidirecional: o lead mostra o serviço e o registro operacional mostra o
  lead/cliente de origem.
- Serviços antigos trazidos do Trello serão reprocessados por uma rotina de reparação auditável.
- Deve ser possível concluir, desvincular ou excluir um serviço, com confirmação e tratamento claro
  do registro operacional relacionado.

### BPO Financeiro como núcleo financeiro

- Os atalhos independentes `Contabilidade` e `Relatórios` deixam o painel principal.
- O BPO Financeiro recebe as abas `Contabilidade` e `Relatórios`, preservando as abas atuais.
- `Relatórios` reproduz integralmente a central existente, incluindo período, indicadores, gráficos,
  DRE e exportações.
- A nova aba `Contabilidade` não replica contas a pagar/receber. Ela é o setor tributário da empresa:
  movimentação tributável, estimativas, calendário de obrigações, cenários de enquadramento,
  recomendações de adequação e gestão de RET por incorporação.
- Recomendações tributárias devem mostrar premissas e caráter estimativo; decisões finais dependem
  de validação contábil.

### Tarefas e Agenda

- `Tarefas & SLA` e `Agenda` tornam-se uma única entrada chamada `Tarefas e Agenda`.
- O módulo unificado preserva tarefas, responsáveis, prioridades, prazos, SLA, compromissos,
  visitas, calendário, filtros, estados, criação, edição e exclusão.
- As entidades continuam distintas no banco quando isso preservar melhor suas regras, mas são
  operadas por uma única interface e permissão consolidada.

### Imóveis e Agregador/Feeds

- `Agregador / Feeds` deixa de ser entrada independente.
- `Imóveis` passa a concentrar catálogo, cadastro, edição, captação externa, verificação, importação,
  publicação em feeds e acompanhamento do item captado.
- O staging do agregador continua separado do catálogo publicado para impedir publicação acidental.

### Limpeza e nomenclatura

- Remover do painel `Outras Ferramentas`: `Dashboard`, `Orçamentos` e `Emails`.
- Renomear o atalho `Pagamentos` para `API Contas`, mantendo sua funcionalidade e rota atual até uma
  eventual decisão específica de integração.
- Manter `Usuários e Acessos`.
- A remoção inicial é da navegação. APIs/tabelas só poderão ser eliminadas depois de prova de
  ausência de consumidores e aprovação específica do proprietário.

### Upload de imagem de produtos

- Substituir `URL da Imagem` por upload direto.
- Em celular/tablet, aceitar câmera, biblioteca de fotos e seletor de arquivos.
- Em desktop, aceitar seletor de arquivos e arrastar/soltar quando suportado.
- Exibir prévia, progresso, validação de tipo/tamanho e ações de trocar/remover.
- O arquivo deve ser armazenado em serviço persistente; o banco guarda somente metadados e URL
  interna resultante.
- A URL legada continua sendo exibida nos produtos existentes, sem quebra de imagem.

### Navegação

- Toda página administrativa interna deve possuir retorno previsível para a página anterior e um
  destino seguro quando não houver histórico.
- O botão deve ficar no canto superior esquerdo. Quando a página já tiver retorno próprio, o
  botão global é ocultado para que exista somente uma ação de voltar.
- A auditoria inclui páginas de lista, detalhe, edição, criação e módulos consolidados.

## Stories

| Story | Escopo | Status |
|---|---|---|
| S-01 | Inventário técnico, matriz de rotas/dados/permissões e baseline de produção | Em andamento — baseline local concluído; produção pendente |
| S-02 | Reparar CRM → serviços → módulos e migrar Obras do Trello de forma idempotente | Implementado localmente; execução no banco pendente |
| S-03 | Consolidar Contabilidade tributária e Relatórios dentro do BPO Financeiro | Implementado localmente; UAT pendente |
| S-04 | Unificar Tarefas & SLA e Agenda em `Tarefas e Agenda` | Implementado localmente; UAT pendente |
| S-05 | Unificar Imóveis e Agregador/Feeds em `Imóveis` | Implementado localmente; UAT pendente |
| S-06 | Limpar painel, renomear `API Contas` e implementar upload de imagem | Implementado localmente; upload real pendente de UAT |
| S-07 | Consolidar RBAC, compatibilidade de rotas e retorno em todas as páginas | Implementado localmente; auditoria autenticada pendente |
| S-08 | Testes integrados, migração assistida, UAT, deploy e auditoria pós-deploy | Em andamento — typecheck, 396 testes e build aprovados |

## Ordem de execução

1. Integrar ou rebasedar sobre o EPIC-014 e congelar o baseline.
2. Executar S-01 e produzir a matriz de impacto.
3. Corrigir S-02 antes de reorganizar o painel, pois Obras vazias são falha operacional P0.
4. Executar S-03, S-04 e S-05 em commits separados.
5. Executar S-06 e S-07 depois que os destinos consolidados existirem.
6. Executar S-08, publicar em preview e somente então promover para produção.

## Critérios globais de aceite

- Obras selecionadas no CRM aparecem automaticamente em Obras.
- A rotina de reparação informa quantos vínculos foram examinados, criados, já existentes, ignorados
  e com erro, além dos motivos.
- Reexecutar a reparação não cria duplicidades.
- O painel possui apenas uma entrada para cada domínio consolidado.
- Nenhum dado antigo desaparece das telas consolidadas.
- URLs antigas redirecionam para a aba correta do novo módulo.
- As permissões existentes são migradas por união, sem retirar acesso legítimo.
- Produtos aceitam upload real de imagem em iPhone/iPad e desktop.
- Todas as páginas administrativas possuem retorno funcional e acessível.
- Typecheck, testes, build e UAT autenticado passam.
- Contagens pré e pós-migração são conciliadas e anexadas ao checkpoint.
- Produção não recebe merge enquanto houver branch paralela não integrada que toque os mesmos
  arquivos centrais.

## Fora de escopo sem nova autorização

- Apagar tabelas ou históricos dos módulos antigos.
- Alterar a página pública institucional além dos redirecionamentos necessários.
- Tomar decisões tributárias automáticas ou transmitir obrigações fiscais sem integração oficial.
- Mesclar os bancos da Prospecta e do Grupo Santa Fé.

