# Matriz de paridade funcional — Grupo Santa Fé → Prospecta

Data: 2026-08-31  
Fonte comparada: `../Grupo-Santa-Fe/web` em `f78f7a7`  
Destino: `Prospecta` em `a54d626` antes dos ajustes desta fase

## Decisão de produto

A Prospecta preserva integralmente a cobertura funcional do Grupo Santa Fé e adiciona seu ecossistema próprio de sorteios. Marca, conteúdo visível, landing, vídeos e links públicos permanecem da Prospecta.

## Resultado da comparação

| Área | Grupo Santa Fé | Prospecta | Situação |
| --- | ---: | ---: | --- |
| Páginas Next.js | 69 | 85 | Todas as 69 rotas estão presentes; 16 páginas são extensões da Prospecta |
| APIs Next.js | 28 | 37 | Todas as 28 APIs estão presentes; 9 APIs são extensões do ecossistema Prospecta |
| Arquivos de server actions | 23 | 23 | Equivalentes |
| Exports de server actions | Comparados | Comparados | Nenhum export do Grupo ausente |
| Arquivos de acesso a dados | 11 | 11 | Equivalentes |
| Exports de dados | Comparados | Comparados | Nenhum export do Grupo ausente |
| Tipos compartilhados | Comparados | Comparados | Nenhum arquivo do Grupo ausente |
| Modelos e enums Prisma | 31 | 31 | Equivalentes; tabelas operacionais Prospecta usam `ops_*` |
| RBAC | Comparado | Comparado | Idêntico |
| Métodos de APIs homólogas | Comparados | Comparados | Nenhuma rota/método do Grupo ausente |

## Fluxos homologados pela análise

| Fluxo | Estado na Prospecta |
| --- | --- |
| CRM, leads, corretores e agenda | Equivalente |
| Imóveis, portal e mapa | Equivalente |
| Obras, projetos, regularização e incorporação | Equivalente |
| Avaliações, laudos, contratos e contabilidade | Equivalente |
| BPO, comissões, bancos, relatórios e financiamentos | Equivalente |
| WhatsApp, feeds, agregador e prospecção | Equivalente |
| Perfis admin, corretor, colaborador e cliente | Equivalente |
| Landing, vídeos e canais Prospecta | Preservados |
| Sorteios, bilhetes, UTEF, conversões e Asaas | Extensão exclusiva da Prospecta |

## Adaptações deliberadas

- autenticação operacional do Grupo Santa Fé foi mantida e ampliada para aceitar usuários legados da Prospecta, sem reduzir RBAC;
- schema Prisma operacional usa nomes físicos `ops_*`, evitando colisão com as tabelas legadas de sorteios;
- páginas e APIs exclusivas da Prospecta coexistem com o núcleo operacional;
- a landing atual, vídeos do YouTube e links sociais não foram substituídos.

## Ajustes realizados nesta fase

As últimas referências visíveis à marca Santa Fé foram substituídas por Prospecta Construções em:

- PDF de simulação de financiamento e nome do arquivo gerado;
- PDF de contrato jurídico;
- laudos de avaliação individual e em lote;
- página do Instituto;
- comentário de identificação do schema.

Após esses ajustes, a busca em `src/` não encontrou nenhuma referência visível a Santa Fé.

## Itens pendentes

Nenhuma lacuna funcional do Grupo Santa Fé foi identificada. A otimização visual das imagens HTML é uma pendência já registrada para a Fase 5; não representa lacuna funcional.

## Próxima fase

Fase 3 — blindagem do ecossistema de sorteios, UTEF, pagamentos e webhooks.
