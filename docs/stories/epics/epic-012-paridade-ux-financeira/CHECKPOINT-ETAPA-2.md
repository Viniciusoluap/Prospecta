# Checkpoint — Etapa 2: auditoria de paridade

**Data:** 11/09/2026  
**Status:** Concluída  
**Escopo:** Grupo Santa Fé (fonte da verdade) → Prospecta

## O que foi validado

- inventário das rotas administrativas dos dois repositórios;
- comparação de entidades, APIs/actions, telas, permissões e testes por domínio;
- distinção entre módulo visualmente presente e fluxo operacional equivalente;
- separação das exceções deliberadas da Prospecta (landing page e ecossistema VFX/UTEF);
- confirmação de que login e sessão de produção foram validados pelo proprietário;
- confirmação do deploy de Financiamentos, já iniciado dentro do pacote P0.

## Fotografia consolidada

| Classificação | Quantidade | Domínios |
|---|---:|---|
| Núcleo equivalente | 9 | BPO, Contabilidade, Financiamentos, Imóveis, Incorporação, Leads/CRM, Obras, Regularização, WhatsApp |
| Paridade parcial | 12 | Painel/indicadores, Agenda, Agregador, Avaliações, Comissões, Contratos, Corretores, Feeds, Jurídico, Mapa, Projetos, Relatórios |
| Ausente | 1 | Configurações de usuários e permissões granulares (RBAC) |

## Plano aprovado para as próximas etapas

### Etapa 3 — P0

1. fechar os resíduos de Financiamentos (edição, vínculos e UAT);
2. criar Jurídico global (contratos, documentos, status, assinatura e comunicação);
3. criar Configurações administrativas, usuários e RBAC granular.

### Etapa 4 — P1

1. Agenda operacional;
2. cadastro completo de Corretores e visão de Comissões;
3. ciclo de Projetos;
4. Mapa operacional global.

### Etapa 5 — P2

1. central de Relatórios e exportações;
2. administração de Feeds/Agregador;
3. edição dedicada e laudos de Avaliações em lote;
4. acabamento dos fluxos parciais remanescentes.

### Etapa 6 — qualidade integrada

- testes unitários, integração, autorização por papel e regressão;
- validação responsiva em celular, tablet e desktop;
- segurança, tratamento de erros, observabilidade e desempenho;
- UAT autenticado dos fluxos completos.

### Etapa 7 — operação real

- configurar e validar credenciais reais de Asaas, Pluggy, Meta WhatsApp e Anthropic;
- executar testes de produção sem dados destrutivos;
- registrar evidências, procedimento operacional e rollback;
- somente então declarar os dois sistemas 100% operacionais.

## Regra de entrega

Cada etapa será encerrada com documentação de checkpoint, gates automatizados, PR, merge e deploy confirmado. Este arquivo encerra somente a Etapa 2; a Etapa 3 aguarda comunicação ao proprietário antes de começar.
