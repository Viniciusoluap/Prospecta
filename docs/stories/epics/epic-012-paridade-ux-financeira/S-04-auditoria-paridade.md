# S-04 — Auditoria de paridade Grupo Santa Fé → Prospecta

**Status:** Done — checkpoint da Etapa 2 publicado em 11/09/2026

## Resultado

A declaração anterior de “roadmap 100% concluído” significava que as stories então planejadas haviam sido fechadas. Ela **não provava paridade integral do produto**. Esta auditoria confrontou rotas, entidades, APIs/actions, telas, permissões e testes dos dois repositórios e estabeleceu a nova linha de base.

| Domínio Santa Fé | Evidência na Prospecta | Estado | Próxima ação |
|---|---|---|---|
| Painel/indicadores | `/admin/dashboard` e analytics de orçamentos, obras, sorteios, UTEF e usuários | Parcial | Consolidar relatórios e exportações |
| Agenda | Visitas em Portal/CRM e tarefas com SLA | Parcial | Criar agenda operacional global |
| Agregador | Entidades/backend e jornada pública Mercado de Imóveis | Parcial | Expor gestão administrativa |
| Avaliações | Lista, criação, detalhe, checklist e sugestões por IA | Parcial | Portar edição dedicada e laudos em lote |
| BPO Financeiro | Clientes, cobranças, despesas, DRE e contas bancárias | Núcleo equivalente | UAT com credenciais reais |
| Comissões | CRUD e baixa de comissões dentro de Corretores | Parcial | Separar visão e relatórios de comissões |
| Configurações/RBAC | Papéis básicos e configuração de pagamentos | Ausente | Criar gestão de usuários e permissões granulares |
| Contabilidade | Livro-razão em `/admin/contabilidade` | Núcleo equivalente | UAT operacional |
| Contratos | Contratos, documentos e chat vinculados ao Portal/CRM | Parcial | Consolidar no fluxo Jurídico global |
| Corretores | Comissões operacionais, sem cadastro completo de perfis | Parcial | Portar CRUD e detalhes de corretores |
| Feeds | Backend e publicação pública | Parcial | Criar tela de administração/configuração |
| Financiamentos | `/admin/financiamentos`, schema, API, checklist, filtros e status | Núcleo equivalente | Completar edição/vínculos e UAT |
| Imóveis | Lista, cadastro, edição e canais de publicação | Núcleo equivalente | UAT de publicação real |
| Incorporação | Fluxo administrativo de 13 etapas e motor de viabilidade | Núcleo equivalente | UAT integral |
| Jurídico | Primitivas de contratos/documentos/chat dentro do Portal | Parcial | Criar módulo jurídico dedicado e visão global |
| Leads/CRM | Pipeline, cadastro, detalhe e evolução de status | Núcleo equivalente | UAT integral |
| Mapa | Mapas locais em Imóveis/Incorporação | Parcial | Criar mapa operacional global |
| Obras | Lista, edição, detalhe e medições | Núcleo equivalente | UAT integral |
| Projetos | Orçamentos, obras e projetos executivos distribuídos | Parcial | Unificar ciclo de vida de projetos |
| Regularização | CRUD, documentos e uploads | Núcleo equivalente | UAT integral |
| Relatórios | Indicadores e PDFs distribuídos por módulo | Parcial | Criar central de relatórios/exportações |
| WhatsApp | Conexão Meta, leads, modelos, envio e histórico | Núcleo equivalente | UAT com credenciais reais |

### Placar da auditoria

- **9/22 com núcleo equivalente:** BPO, Contabilidade, Financiamentos, Imóveis, Incorporação, Leads/CRM, Obras, Regularização e WhatsApp.
- **12/22 parciais:** Painel/indicadores, Agenda, Agregador, Avaliações, Comissões, Contratos, Corretores, Feeds, Jurídico, Mapa, Projetos e Relatórios.
- **1/22 ausente:** administração de usuários e permissões granulares (RBAC).

“Núcleo equivalente” significa que as regras e operações centrais existem, não que o módulo esteja dispensado de UAT, integração com credenciais reais ou ajustes residuais. Portanto, os dois sistemas ainda não podem ser declarados 100% operacionais.

## Método AIOX para fechar a paridade

Para cada domínio: mapear rota e entidade na origem, identificar regra de negócio, comparar schema/API/UI/permissão, criar story com critérios de aceite, implementar na stack Vite+tRPC+Drizzle e validar com UAT autenticado. Similaridade visual isolada não encerra uma story.

## Gate concluído

O checkpoint detalhado da etapa contém:

- origem e destino;
- regra de negócio;
- tabelas e APIs;
- telas e papéis autorizados;
- teste automatizado;
- evidência de produção e pendências de UAT;
- exceção aprovada pelo proprietário, quando houver.

O plano executável resultante está em `CHECKPOINT-ETAPA-2.md`. A Etapa 3 não começa sem a comunicação e autorização do proprietário, conforme combinado.
