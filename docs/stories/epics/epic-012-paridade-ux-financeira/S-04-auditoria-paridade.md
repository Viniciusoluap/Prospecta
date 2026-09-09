# S-04 — Auditoria de paridade Grupo Santa Fé → Prospecta

**Status:** Em andamento — inventário estrutural concluído; validação funcional profunda pendente

## Resultado preliminar

A declaração anterior de “roadmap 100% concluído” significa que as stories planejadas foram fechadas. Ela **não prova paridade integral do produto**. O inventário atual confirma lacunas de módulos e de exposição na interface.

| Domínio Santa Fé | Situação na Prospecta | Prioridade |
|---|---|---|
| Contabilidade | Implementada como `AdminFinanceiro`; nomenclatura/acesso corrigidos neste épico | Feito |
| BPO Financeiro | Implementado; configuração Pluggy removida do BPO e centralizada | Feito |
| Financiamentos | Não há módulo administrativo dedicado equivalente | P0 |
| Jurídico | Não há módulo dedicado equivalente | P0 |
| Configurações e permissões | Há configuração de pagamentos, mas não um módulo administrativo equivalente de usuários/RBAC | P0 |
| Agenda | Visitas existem dentro do CRM/Portal, sem agenda operacional equivalente | P1 |
| Comissões | Há dados pontuais em Corretores, sem módulo completo equivalente | P1 |
| Projetos | Há Orçamentos/Obras, mas falta validar e fechar a equivalência do fluxo de Projetos | P1 |
| Mapa | Existem mapas dentro de Incorporação, sem mapa operacional global equivalente | P1 |
| Feeds/agregador | Há backend e página Mercado; falta acesso/gestão administrativa equivalente | P2 |
| Contratos e relatórios | Há funções distribuídas em Portal/Obras; falta equivalência dos módulos dedicados | P2 |

## Método AIOX para fechar a paridade

Para cada domínio: mapear rota e entidade na origem, identificar regra de negócio, comparar schema/API/UI/permissão, criar story com critérios de aceite, implementar na stack Vite+tRPC+Drizzle e validar com UAT autenticado. Similaridade visual isolada não encerra uma story.

## Próximo gate

Antes de declarar os dois sistemas 100% operacionais, produzir uma matriz funcional por fluxo contendo:

- origem e destino;
- regra de negócio;
- tabelas e APIs;
- telas e papéis autorizados;
- teste automatizado;
- evidência de produção;
- exceção aprovada pelo proprietário, quando houver.

