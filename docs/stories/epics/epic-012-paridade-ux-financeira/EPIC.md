# EPIC-012: Paridade real, navegação e arquitetura financeira

**Owner:** Codex / AIOX

**Status:** Em andamento

**Origem:** validação visual do proprietário em produção (8 evidências, 09/09/2026)

## Problema

O roadmap anterior marcou os módulos como concluídos, mas a validação do produto revelou dois problemas diferentes:

1. inconsistências de UX e nomenclatura na Prospecta;
2. paridade de funcionalidades avaliada por épicos isolados, sem uma verificação final rota a rota e fluxo a fluxo contra o Grupo Santa Fé.

O Grupo Santa Fé continua sendo a fonte da verdade para regras de negócio. Landing page, identidade visual e ecossistema VFX/UTEF continuam sendo exceções deliberadas.

## Decisões de arquitetura

- A jornada pública `Projetos e Orçamentos` + `Imóveis` + `Mercado de Imóveis` terá uma única entrada de navegação: **Imóveis**. As rotas antigas permanecem disponíveis temporariamente para não quebrar links externos.
- O menu hambúrguer fica restrito a celular. Tablet e desktop recebem navegação horizontal abaixo da marca.
- O menu móvel usa a altura útil da viewport e rolagem flexível, permitindo alcançar integralmente o botão de entrada.
- As credenciais Asaas, Stripe e Pluggy ficam centralizadas em **Configurações de Pagamento**. O BPO consome a integração, mas não configura credenciais.
- O módulo `AdminFinanceiro` já é o livro-razão da empresa descrito como **Contabilidade** no Santa Fé. Ele será apresentado como Contabilidade; não será apagado nem confundido com BPO.
- **BPO Financeiro** permanece separado: clientes de terceirização, cobranças, despesas, DRE e contas bancárias.
- `/admin/financeiro` permanece apenas como rota legada invisível, evitando quebra de favoritos; a rota oficial passa a ser `/admin/contabilidade`.

## Stories

| Story | Escopo | Status |
|---|---|---|
| S-01 | Consolidar navegação pública e responsividade do menu | Done |
| S-02 | Centralizar Pluggy em Configurações de Pagamento | Done |
| S-03 | Corrigir taxonomia Financeiro → Contabilidade e preservar BPO | Done |
| S-04 | Auditoria comparativa completa Santa Fé → Prospecta | Done |
| S-05 | Portar lacunas P0: Financiamentos, Jurídico e Configurações/RBAC | Done |
| S-06 | Portar lacunas P1: Agenda, Comissões, Projetos e Mapa | Backlog |
| S-07 | Portar lacunas P2: Relatórios, avaliações em lote e acesso administrativo a feeds | Backlog |
| S-08 | UAT autenticado e responsivo em produção | Backlog |

## Critérios de aceite imediatos

- Não existem três entradas concorrentes para a mesma jornada imobiliária no menu.
- Hambúrguer oculto a partir de `md`; navegação horizontal visível.
- Todos os itens e o botão Entrar são alcançáveis no menu móvel.
- BPO não apresenta formulário de credenciais Pluggy.
- Configurações de Pagamento apresenta Asaas, Stripe (estado atual) e Pluggy.
- Painel administrativo apresenta Contabilidade e BPO Financeiro como funções distintas.
- Typecheck, testes e build passam antes da publicação.
