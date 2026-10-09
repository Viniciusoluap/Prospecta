# EPIC-016: Portais segmentados por perfil

**Owner:** Codex / AIOX  
**Status:** In Progress — implementação autorizada em 08/10/2026  
**Tipo:** Brownfield / evolução do EPIC-002  
**Complexidade AIOX:** 22/25 — complexa  
**Dependências:** EPIC-002, EPIC-009 e estabilização do EPIC-015

## Objetivo

Organizar os acessos do site por perfil autenticado, separando com segurança as experiências de
cliente, corretor e administrador. O portal do cliente será ampliado para Obras, Financiamentos e,
somente na Prospecta, Bilhetes, Saldo UTEF e Conversões. O corretor terá um portal próprio para
consultar o catálogo, cadastrar imóveis e acompanhar exclusivamente as próprias comissões.

O painel administrativo permanece como fonte completa de gestão. Nenhum portal externo reproduz
controles internos, dados financeiros sensíveis, observações administrativas ou registros de
outros usuários.

## Problema atual

- Obras, Bilhetes, Saldo e Conversões aparecem dispersos na navegação autenticada.
- A rota atual de Obras permite ao usuário criar e alterar obras; esse comportamento não representa
  o acompanhamento somente leitura solicitado para clientes.
- O Portal do Cliente existente já possui vínculo `users.lead_id`, mas Obras ainda são buscadas por
  `construction_projects.user_id`, criando duas fontes de escopo.
- Financiamentos só possuem procedures administrativas; não há projeção segura para o cliente.
- O módulo de Comissões possui uma fonte nova vinculada por `broker_id` e uma fonte legada vinculada
  apenas por nome, insuficiente para isolamento seguro do corretor.
- A autenticação possui um papel principal por conta. Escolher “Cliente” ou “Corretor” na interface
  não pode elevar o papel real armazenado no servidor.

## Resultado esperado

| Perfil | Acessos | Regra de escopo |
|---|---|---|
| Cliente | Minhas Obras, Meu Financiamento, Meus Bilhetes, Meu Saldo UTEF e Minhas Conversões | somente o `lead_id` e o `user_id` derivados da sessão |
| Corretor | Imóveis e Minhas Comissões | catálogo completo; criação com autoria; comissões pelo `broker_id` da sessão |
| Administrador | Painel Admin | acesso administrativo atual, sem regressão |
| Colaborador | somente módulos administrativos já autorizados | permissões atuais, fora dos portais Cliente/Corretor |

Bilhetes, Saldo UTEF e Conversões são exclusivos da Prospecta e não serão criados no Grupo Santa
Fé. Obras, Financiamentos, Imóveis e Comissões devem manter paridade de regra de negócio entre os
dois sistemas, com bancos e stacks separados.

## Requisitos funcionais

| ID | Requisito |
|---|---|
| FR-01 | Remover Obras, Meus Bilhetes, Meu Saldo UTEF e Minhas Conversões da navegação pública/global |
| FR-02 | “Minha Conta” deve oferecer entradas explícitas para Login Cliente, Login Corretor, Painel Admin quando autorizado e Sair quando autenticado |
| FR-03 | A escolha da entrada de login define o destino esperado, mas nunca altera o papel ou o escopo autorizado da conta |
| FR-04 | Cliente vinculado a obra deve consultar somente suas obras, etapas públicas, progresso, datas e arquivos/fotos liberados |
| FR-05 | Cliente não pode criar, editar, excluir, concluir ou acessar dados internos de obras |
| FR-06 | A aba Minhas Obras só aparece quando houver obra vinculada ao `lead_id` do cliente |
| FR-07 | Cliente com financiamento ativo deve consultar somente seu processo, etapa, progresso, próximos passos e pendências públicas |
| FR-08 | A aba Meu Financiamento só aparece quando houver financiamento ativo vinculado ao `lead_id` do cliente |
| FR-09 | Cliente pode enviar documento apenas quando existir solicitação aberta, dentro de MIME, tamanho e contexto permitidos |
| FR-10 | Bilhetes, Saldo UTEF e Conversões continuam isolados pelo `user_id`, mas passam a compor o Portal do Cliente da Prospecta |
| FR-11 | Corretor pode consultar todos os imóveis do catálogo e cadastrar novo imóvel |
| FR-12 | Imóvel criado por corretor deve registrar autoria e entrar em estado de revisão antes da publicação pública |
| FR-13 | Corretor consulta somente comissões cujo `broker_id` corresponda ao usuário autenticado |
| FR-14 | Registros legados de comissão sem vínculo inequívoco não serão atribuídos automaticamente por semelhança de nome |
| FR-15 | Administrador mantém as interfaces completas de Obras, Financiamentos, Imóveis e Comissões |
| FR-16 | Regras equivalentes serão implementadas no Grupo Santa Fé, exceto o ecossistema exclusivo da Prospecta |

## Requisitos não funcionais

| ID | Requisito |
|---|---|
| NFR-01 | Todo escopo é calculado no backend a partir da sessão; IDs enviados pelo navegador nunca ampliam acesso |
| NFR-02 | E-mails são normalizados somente para provisionamento/conciliação; consultas operacionais usam FKs persistidas |
| NFR-03 | Colisão ou duplicidade de e-mail bloqueia a vinculação automática e gera pendência administrativa |
| NFR-04 | Rotas antigas permanecem como redirecionamentos temporários, sem contornar o novo RBAC |
| NFR-05 | Uploads usam armazenamento persistente, nome aleatório, validação de assinatura/MIME/tamanho e autorização por recurso |
| NFR-06 | Migrações são aditivas, idempotentes, transacionais e precedidas de snapshot |
| NFR-07 | Auditoria registra provisionamento, upload, criação de imóvel e tentativa de acesso negado relevante |
| NFR-08 | A experiência funciona em desktop, iPad e celular, incluindo câmera/biblioteca/arquivo quando upload for permitido |
| NFR-09 | Dados internos não devem ser carregados para o cliente para depois serem apenas ocultados no frontend |
| NFR-10 | Typecheck, testes, build, testes de isolamento e UAT autenticado são gates obrigatórios |

## Regras de negócio

1. “Login Cliente” e “Login Corretor” são portas de entrada, não seletores livres de permissão.
2. Uma conta com papel incompatível recebe mensagem clara e não entra no portal solicitado.
3. A conta cliente deve estar vinculada a exatamente um lead por FK antes de acessar dados.
4. Obras e financiamentos do cliente são obtidos pelo `lead_id` da sessão.
5. Financiamento ativo significa qualquer estado diferente de `liberado` ou `cancelado`.
6. A ausência de obra ou financiamento oculta a respectiva aba; acesso direto retorna estado vazio ou
   `NOT_FOUND`, nunca dados globais.
7. O cliente recebe uma projeção pública dos registros. Campos internos são excluídos no select/API.
8. O corretor é identificado pelo próprio `users.id`; comissões novas usam esse valor como
   `broker_id`.
9. Comissões legadas só entram no portal após conciliação administrativa inequívoca.
10. Cadastro de imóvel pelo corretor não concede edição ou exclusão de imóveis de terceiros.
11. Nenhum valor ausente será inventado durante migração ou conciliação.

## Stories

| Story | Escopo | Status |
|---|---|---|
| [S-01](S-01-identidade-contexto-acesso.md) | Identidade, provisionamento e resolvedor de escopo | Draft |
| [S-02](S-02-minha-conta-rotas-perfil.md) | Minha Conta, entradas de login e rotas por perfil | Draft |
| [S-03](S-03-cliente-minhas-obras.md) | Minhas Obras somente leitura e isoladas | Draft |
| [S-04](S-04-cliente-financiamento-documentos.md) | Meu Financiamento e envio controlado de documentos | Draft |
| [S-05](S-05-cliente-ecossistema-prospecta.md) | Bilhetes, Saldo UTEF e Conversões dentro do portal | Draft |
| [S-06](S-06-corretor-imoveis.md) | Catálogo e cadastro de imóveis pelo corretor | Draft |
| [S-07](S-07-corretor-comissoes.md) | Minhas Comissões isoladas por corretor | Draft |
| [S-08](S-08-paridade-grupo-santa-fe.md) | Paridade funcional no Grupo Santa Fé | Draft |
| [S-09](S-09-seguranca-migracao-uat.md) | Migração, testes de isolamento, UAT e produção | Draft |

## Métricas de sucesso

- Zero consulta de cliente ou corretor baseada em ID livre enviado pelo navegador.
- Zero obra, financiamento ou comissão de outro usuário nos testes cruzados.
- 100% das obras e financiamentos ativos conciliáveis aparecem para o cliente correto.
- 100% das comissões com `broker_id` aparecem apenas para o corretor correto.
- Zero ação de escrita administrativa disponível nos portais externos.
- Paridade assinada entre Prospecta e Grupo Santa Fé para os domínios compartilhados.

## Fora de escopo

- Permitir que um usuário altere o próprio papel.
- Impersonação de cliente/corretor pelo administrador.
- Edição de obras ou financiamentos pelo cliente.
- Publicação automática de imóvel criado por corretor sem revisão.
- Atribuição probabilística de registros legados por nome parecido.
- Replicar Bilhetes, UTEF ou Conversões no Grupo Santa Fé.
- Executar migration, alterar produção ou publicar deploy durante esta fase de estruturação.

## Gates AIOX

1. **@pm — Epic:** escopo e decisões de produto confirmados.
2. **@architect — Impacto:** arquitetura e superfícies afetadas aprovadas.
3. **@sm — Stories:** cada story passa do estado Draft para Ready.
4. **@po — Validação:** checklist de requisitos, dependências e critérios de aceite aprovado.
5. **@dev — Implementação:** uma story por vez, com commits independentes.
6. **@qa — Verificação:** isolamento, regressão, uploads, mobile e paridade aprovados.
7. **@devops — Produção:** snapshot, migrations, deploy gradual, smoke test e rollback.

## Documentos relacionados

- [Arquitetura proposta](ARQUITETURA.md)
- [Plano de execução](PLANO-EXECUCAO.md)

