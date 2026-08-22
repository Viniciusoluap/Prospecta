# Paridade operacional Prospecta x Grupo Santa Fé

## Objetivo

O Prospecta deverá alcançar paridade funcional com o sistema operacional do Grupo Santa Fé, mas mantendo a identidade, o layout, os nomes, os territórios e as regras da Prospecta. A implementação será incremental e não substituirá a landing page atual nem o ecossistema UTEF.

## Escopo preservado da Prospecta

A landing page atual permanece como referência pública principal. Devem ser preservados os vídeos validados com clientes, os blocos de Instagram e YouTube, depoimentos, prova social, FAQ, chamadas para ação, navegação pública e identidade visual já existente.

O ecossistema UTEF continua ativo e isolado. Nenhum módulo importado pode renomear, remover, substituir ou recalcular suas entidades, regras ou fluxos sem uma etapa específica de compatibilidade.

## Módulos que precisam alcançar paridade funcional

| Domínio | Paridade esperada | Adaptação Prospecta |
|---|---|---|
| CRM e leads | Cadastro, funil, interações, visitas e acompanhamento | Prospecta e Maranhão/adjacências |
| Obras | Cadastro, etapas, documentos, custos, progresso e indicadores | Obras da Prospecta; origem e território explícitos |
| Regularização | Processos, documentos, responsáveis, prazos e pendências | Regularização imobiliária do Maranhão e áreas atendidas |
| Incorporação | Viabilidade, terreno, mercado, orçamento, projetos, aprovação e lançamento | Prospecta incorporadora |
| Jurídico e contratos | Contratos, documentos, ações e histórico | Identidade e modelos jurídicos da Prospecta |
| Comunicação | Notificações, WhatsApp, e-mail e histórico de contato | Canais e permissões próprios da Prospecta |
| Financeiro operacional | Receitas, custos, repasses e indicadores de negócio | Sem misturar com Exclusive Club ou Factoring |
| Auditoria e gestão | Visões gerenciais, filtros, trilha e divergências | Eventos exportáveis para Dolores 9A |

## Fronteiras de dados

O Prospecta é o sistema operacional das obras, regularização e incorporação do Maranhão. O Grupo Santa Fé é o sistema operacional das obras e negócios do Pará, incluindo Canaã dos Carajás e Parauapebas. O mesmo cliente pode ter referências em mais de uma empresa, mas cada operação deve possuir empresa responsável, território, domínio, ID de origem e fonte oficial.

O AuditX/Dolores 9A não será usado como banco operacional do Prospecta. Ele receberá leituras, snapshots, eventos e indicadores, sem sobrescrever dados do Prospecta. O banco canônico do AuditX é o Neon; o Supabase AuditX é legado e não canônico.

## Regra de implementação

Não copiar pastas inteiras do Grupo Santa Fé sobre o Prospecta. Cada módulo deve ser portado como paridade de comportamento, adaptado à stack existente, com testes de contrato e preservação dos módulos antigos. A primeira entrega deve priorizar CRM, obras, regularização, incorporação, documentos, notificações e exportação somente leitura para Dolores 9A.

## Critérios de aceite

1. A landing page atual permanece visualmente e funcionalmente disponível.
2. O UTEF continua acessível e sem alteração de dados.
3. Cada módulo portado possui rota, schema, permissões e teste de regressão.
4. Nenhuma entidade do Grupo Santa Fé é misturada silenciosamente com uma entidade Prospecta.
5. Todos os registros exportados para Dolores 9A carregam sistema de origem, tipo, ID externo, atualização e hash.
6. O Prospecta não escreve no Grupo Santa Fé, Exclusive Club, Efficaz Factoring ou AuditX durante a primeira fase.
7. A implementação pode ser desativada por feature flag sem remover o comportamento existente.
