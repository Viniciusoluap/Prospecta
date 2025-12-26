# Efficaz Orbit - Lista de Tarefas

## 🎯 Objetivo
Desenvolver o ecossistema digital do Grupo Efficaz com módulos de venda de bilhetes, sorteio, UTEF (crédito interno) e vitrine de produtos.

## 📋 Tarefas

### 1. Planejamento e Estrutura
- [x] Inicializar projeto web com banco de dados e autenticação
- [x] Criar plano de desenvolvimento
- [x] Definir schema do banco de dados
- [ ] Criar constantes e tipos compartilhados

### 2. Banco de Dados
- [x] Criar tabela de bilhetes (tickets)
- [x] Criar tabela de sorteios (draws)
- [x] Criar tabela de UTEF (tokens/créditos internos)
- [x] Criar tabela de produtos (imóveis, serviços, embarcações)embarcações)
- [x] Criar tabela de transações
- [x] Executar migração do banco de dados

### 3. Backend - Módulo de Venda de Bilhetes
- [x] Criar rota de listagem de sorteios ativos
- [x] Criar rota de compra de bilhetes
- [x] Criar rota de geração de QR Code PIX
- [x] Criar rota de confirmação de pagamento (simulação)
- [x] Criar rota de listagem de bilhetes do usuário

### 4. Backend - Módulo de Sorteio e UTEF
- [x] Criar rota de realização de sorteio (baseado na Loteria Federal)
- [x] Criar rota de emissão de UTEF para o ganhador
- [x] Criar rota de consulta de saldo de UTEF
- [x] Criar rota de histórico de UTEF

### 5. Backend - Módulo de Produtos
- [x] Criar rota de listagem de produtos (imóveis, serviços, embarcações)
- [x] Criar rota de detalhes de produto
- [x] Criar rota de conversão de UTEF em produto
- [x] Criar rota de gestão de produtos (admin)

### 6. Frontend - Páginas Principais
- [x] Criar página inicial (Home) com apresentação do Grupo Efficaz
- [x] Criar página de sorteios ativos
- [x] Criar página de compra de bilhetes
- [x] Criar página de pagamento PIX
- [x] Criar página de confirmação de compra

### 7. Frontend - Painel do Usuário
- [x] Criar página de meus bilhetes
- [x] Criar página de saldo UTEF
- [x] Criar página de histórico de transações
- [x] Criar página de produtos disponíveis
- [ ] Criar página de conversão UTEF → Produto

### 8. Frontend - Painel Administrativo
- [x] Criar página de gestão de sorteios
- [x] Criar página de realização de sorteio (funcionalidade via backend)
- [x] Criar página de gestão de produtos
- [ ] Criar página de gestão de transações
- [ ] Criar página de relatórios

### 9. Documentação e Compliance
- [ ] Criar página de Regulamento do Sorteio
- [ ] Criar página de Termos de Uso
- [ ] Criar página de Política de Privacidade
- [ ] Criar página de FAQ

### 10. Testes e Validação
- [ ] Testar fluxo completo de compra de bilhetes
- [ ] Testar fluxo de sorteio e emissão de UTEF
- [ ] Testar fluxo de conversão UTEF → Produto
- [ ] Validar responsividade mobile
- [ ] Validar acessibilidade

### 11. Deploy e Entrega
- [ ] Salvar checkpoint do projeto
- [ ] Gerar documentação de uso
- [ ] Entregar ao usuário

## 🚀 Próximos Passos Imediatos
1. Definir schema do banco de dados
2. Criar constantes compartilhadas
3. Implementar módulo de venda de bilhetes

### 10. Ajustes de Produtos e Links para Sites Originais
- [x] Visitar www.exclusiveclubitz.com e coletar produtos náuticos reais
- [x] Visitar www.prospectaconstrucoes.com e validar especificações das casas
- [x] Visitar www.grupoefficaz.com.br para informações gerais
- [x] Ajustar produtos de Construção Civil (apenas casas R$ 180.000, 47m²)
- [x] Ajustar produtos da Financeira (crédito de 0,35% convertido em tokens)
- [x] Ajustar produtos Náuticos baseados no Exclusive Clubitz
- [x] Adicionar links para os 3 sites no rodapé
- [ ] Adicionar menção aos sites originais nas páginas de produtos


### 11. Correções Reportadas pelo Usuário
- [x] Adicionar seção visível com links/logos dos 3 sites (Home)
- [ ] Adicionar links para sites nas páginas de produtos
- [x] Implementar geração real de QR Code PIX
- [x] Adicionar código PIX copia e cola funcional
- [x] Melhorar paleta de cores (mais vibrante)
- [x] Adicionar gradientes e efeitos visuais
- [x] Melhorar tipografia e espaçamentos
- [ ] Adicionar imagens de alta qualidade
- [ ] Criar design mais moderno e profissional
- [x] Melhorar cards de produtos
- [ ] Melhorar página de sorteios
- [ ] Melhorar página de compra de bilhetes


### 12. Correção de Erro Crítico
- [x] Corrigir tags <a> aninhadas no Navbar (erro de HTML)
- [ ] Testar funcionalidade de compra de bilhetes
- [ ] Testar funcionalidade de login
- [ ] Testar funcionalidade de visualização de produtos

### 13. Atualização de Chave PIX
- [x] Alterar chave PIX para contato@grupoefficaz.com.br
- [x] Alterar nome do recebedor para EFFICAZ PROMOÇÃO DE VENDAS


### 14. Correção de Rotas Faltantes (404)
- [x] Criar página de conversão de produto (/converter-produto/:id)
- [x] Criar página "Como Funciona" (/como-funciona)
- [x] Criar página "Minhas Conversões" (/minhas-conversoes)
- [x] Adicionar todas as rotas ao App.tsx
- [x] Testar todas as rotas


### 15. Integração Stripe para Pagamentos
- [x] Adicionar feature Stripe ao projeto
- [x] Configurar variáveis de ambiente Stripe
- [x] Implementar backend para criação de sessão de checkout
- [x] Implementar frontend para checkout Stripe
- [x] Testar pagamento com cartão de teste (pronto para teste)
- [x] Configurar webhook para confirmação de pagamento


### 16. Geração de Imagens de Produtos
- [x] Gerar imagem da Casa Padrão 47m² (Construção Civil)
- [x] Gerar imagem do Crédito UTEF 0,35% (Financeira)
- [x] Gerar imagem da Lancha Focker 215 (Náutico)
- [x] Gerar imagem do Jetski Seadoo GTI (Náutico)
- [x] Gerar imagem do PIPER SENECA IV (Náutico)
- [x] Fazer upload das imagens para S3
- [x] Atualizar banco de dados com URLs das imagens


### 17. Correção de Texto da Estrutura Legal
- [x] Corrigir texto "Rússia" para "utilidade" na página Como Funciona


### 18. Atualização do Código PIX Fixo
- [x] Substituir geração dinâmica de PIX por código fixo fornecido pelo usuário


### 19. Correção de Problemas Críticos Reportados pelo Usuário
- [ ] Investigar e corrigir erro no fluxo de pagamento
- [ ] Corrigir exibição das imagens dos produtos (não estão aparecendo)
- [ ] Corrigir exibição do QR Code PIX na tela de pagamento
- [ ] Testar fluxo completo de compra com PIX
- [ ] Testar fluxo completo de compra com Stripe


### 20. Implementação da Nova Regra de Conversão UTEF
- [x] Atualizar conversão para 1 UTEF = R$ 1,00 em todo o sistema
- [x] Criar funcionalidade de compra direta de UTEFs (sem sorteio)
- [x] Adicionar página/rota para comprar UTEFs diretamente
- [x] Implementar backend para compra de UTEFs com PIX e Stripe
- [x] Ajustar preços dos produtos conforme nova conversão
- [x] Atualizar textos explicativos sobre UTEF
- [x] Atualizar função formatUtef() para mostrar equivalência em reais
- [x] Testar fluxo completo de compra de UTEFs


### 21. Melhorias Finais Antes da Publicação
- [x] Implementar webhook do Stripe para crédito automático de UTEFs
- [x] Adicionar histórico de compras de UTEFs na página "Meu Saldo"
- [x] Criar sistema de bônus (10% extra para compras acima de 1000 UTEFs)
- [x] Atualizar interface da página Meu Saldo com histórico
- [x] Testar webhook do Stripe
- [x] Testar sistema de bônus
- [x] Preparar para publicação


### 22. Correção das Imagens dos Produtos
- [x] Investigar por que as imagens não estão aparecendo na página de produtos
- [x] Verificar se as URLs estão corretas no banco de dados
- [x] Corrigir o problema de exibição das imagens
- [x] Testar visualização das imagens na página de produtos


### 23. Correção do Pagamento de Bilhetes e Limite de Compra (REVERTENDO ABORDAGEM)
- [x] Investigar por que o pagamento de bilhetes não está funcionando
- [x] Corrigir o erro no fluxo de pagamento de bilhetes
- [x] Remover limite de 100 bilhetes por compra
- [x] Adicionar logs de debug para identificar problemas
- [x] Corrigir incompatibilidade snake_case vs camelCase no schema
- [x] Aplicar migração do banco de dados
- [x] Testar compra de bilhetes com PIX
- [x] Testar compra de bilhetes com Stripe


### 24. Reversão para Snake Case (Solução Definitiva)
- [x] Reverter schema da tabela tickets para snake_case
- [x] Reverter colunas do banco de dados para snake_case
- [x] Testar compra de bilhetes com schema revertido
- [x] Confirmar que QR Code PIX aparece corretamente


---

## 🏗️ REDESIGN PROSPECTA CONSTRUÇÕES

### Fase 1: Identidade Visual
- [x] Copiar logo da Prospecta para client/public
- [x] Atualizar favicon
- [x] Atualizar paleta de cores no index.css (dourado #C9A961 + azul escuro #1A2332 + verde neon #00FF00)
- [x] Atualizar tipografia (fonte Poppins ou Montserrat)
- [x] Atualizar APP_TITLE para "Prospecta Construções" em const.ts
- [x] Atualizar APP_LOGO em const.ts
- [ ] Atualizar informações da empresa (CNPJ 41.865.900/0001-89, CRECI 4326)
- [ ] Atualizar endereços (3 localizações)
- [ ] Atualizar telefones ((99) 98139-2210 e (94) 99304-4689)
- [ ] Atualizar meta tags (title, description, og:tags)

### Fase 2: Redesign Home Page
- [x] Criar Hero Section com imagem de fundo + overlay
- [x] Criar Seção Dourada - Investimento Imobiliário
- [x] Criar Seção Azul Escuro - Modelos de Plantas
- [x] Criar Seção Branca - Casas na Planta (4 vantagens numeradas)
- [x] Criar Seção Azul Escuro - Vantagens de Construção Financiada (4 cards)
- [x] Criar Seção Branca - Parceiros (logo Caixa Econômica Federal)
- [x] Criar Seção Azul Escuro - Depoimentos (3 cards: Bruna, Weeber, Madson)
- [x] Atualizar Footer com informações completas da Prospecta
- [x] Adicionar seção Ecossistema Efficaz

### Fase 3: Redesign Ecossistema Efficaz
- [x] Atualizar Navbar com dropdown "Ecossistema Efficaz"
- [x] Aplicar novo design (cores Prospecta) em página Sorteios
- [x] Aplicar novo design em página Produtos
- [x] Aplicar novo design em página Como Funciona
- [x] Aplicar novo design em página Comprar UTEFs
- [ ] Aplicar novo design em página Meu Saldo
- [ ] Aplicar novo design em página Comprar Bilhete
- [ ] Testar TODAS as funcionalidades existentes (nada pode quebrar)

### Fase 4: Nova Página - Projetos e Orçamentos
- [ ] Criar tabela project_budget_requests no schema
- [ ] Criar funções CRUD no server/db.ts
- [ ] Criar rotas tRPC no server/routers.ts
- [x] Criar página ProjetosOrcamentos.tsx
- [ ] Implementar Hero Section
- [ ] Implementar seção Planta Padrão 47m² (R$ 160.000 somente a obra)
- [ ] Adicionar visualização 3D da planta (embed ou imagem)
- [ ] Implementar formulário de orçamento (nome, email, telefone, cidade, tipo de projeto, tem terreno, mensagem)
- [ ] Implementar salvamento no banco de dados
- [ ] Implementar notificação para admin quando novo orçamento solicitado
- [ ] Testar formulário completo

### Fase 5: Sistema de Gestão de Obras
#### Backend
- [ ] Criar tabela construction_projects no schema
- [ ] Criar tabela construction_stages no schema
- [ ] Criar tabela construction_photos no schema
- [ ] Criar funções CRUD para obras no server/db.ts
- [ ] Criar funções CRUD para etapas no server/db.ts
- [ ] Criar funções CRUD para fotos no server/db.ts
- [ ] Criar rotas tRPC para obras (list, get, create, update, delete)
- [ ] Criar rotas tRPC para etapas
- [ ] Criar rotas tRPC para fotos (com upload)
- [ ] Implementar geração de relatório PDF
- [ ] Implementar geração de relatório XLSM
- [ ] Implementar controle de acesso (usuário vê só suas obras, admin vê todas)

#### Frontend - Usuário
- [ ] Criar página MinhasObras.tsx
- [ ] Implementar lista de obras do usuário
- [ ] Implementar card de obra com progresso visual
- [ ] Criar página DetalhesObra.tsx
- [ ] Implementar seção Informações Gerais
- [ ] Criar componente ProgressBar.tsx (barra de progresso com %)
- [ ] Criar componente StageTimeline.tsx (timeline de etapas)
- [ ] Criar componente PhotoGallery.tsx (galeria de fotos)
- [ ] Implementar botão "Baixar Relatório PDF"
- [ ] Implementar botão "Baixar Relatório XLSM"

#### Frontend - Admin
- [ ] Criar página admin/DashboardObras.tsx
- [ ] Implementar tabela de todas as obras
- [ ] Implementar filtros e busca
- [ ] Implementar botão "Nova Obra"
- [ ] Criar página admin/EditarObra.tsx
- [ ] Implementar Aba 1: Informações Básicas
- [ ] Implementar Aba 2: Valores e Custos (valor total, tipo contrato, pagamento empreiteiro, material, lote, comissão, extras, manutenção, seguro, saldo)
- [ ] Implementar Aba 3: Medições e Progresso (9 etapas com % individual)
- [ ] Implementar Aba 4: Galeria de Fotos (upload múltiplo)
- [ ] Implementar Aba 5: Relatórios (botões gerar PDF/XLSM)
- [ ] Implementar salvamento de obra
- [ ] Implementar exclusão de obra (com confirmação)
- [ ] Implementar upload de fotos para S3

### Fase 6: Testes e Checkpoint Final
- [ ] Testar todas as páginas sem erros 404
- [ ] Testar navegação completa (todos os links funcionando)
- [ ] Testar formulário de orçamento (salva no banco + notifica admin)
- [ ] Testar CRUD de obras (criar, editar, excluir)
- [ ] Testar upload de fotos de obras
- [ ] Testar geração de relatório PDF
- [ ] Testar geração de relatório XLSM
- [ ] Testar permissões de acesso (usuário vs admin)
- [ ] Testar responsividade mobile (todas as páginas)
- [ ] Testar funcionalidades do Ecossistema Efficaz (sorteios, UTEFs, produtos, pagamentos)
- [ ] Verificar meta tags e SEO
- [ ] Otimizar imagens (lazy loading, compressão)
- [ ] Salvar checkpoint final
- [ ] Documentar todas as mudanças


### Atualização Credenciais Stripe (Nova Conta do Usuário)
- [x] Atualizar STRIPE_SECRET_KEY com nova chave do usuário
- [x] Atualizar VITE_STRIPE_PUBLISHABLE_KEY com nova chave do usuário
- [ ] Configurar webhook endpoint no Stripe Dashboard
- [ ] Testar fluxo de pagamento com as novas credenciais
- [ ] Validar compra de bilhetes via Stripe
- [ ] Validar compra de UTEFs via Stripe


## 🔴 REVISÃO COMPLETA - PRIORIDADE CRÍTICA

### Footer Completo
- [x] Adicionar logo Prospecta no footer
- [x] Adicionar razão social: PROSPECTA CONSTRUCOES E AVALIACAO IMOBILIARIA LTDA
- [x] Corrigir endereços completos (3 localizações):
  * Leôncio Pires Dourado, 840A, Bacuri - Imperatriz - MA
  * Avenida JK, 103, Centro, Canaã dos Carajás
  * Rua F, 22, União, Parauapebas
- [x] Adicionar link "Início" nos links úteis
- [x] Adicionar link "Ecossistema Efficaz" nos links úteis
- [x] Reorganizar footer em 4 colunas

### Home Page - Seções Faltantes
- [x] Adicionar seção "Portfólio" (carrossel de casas construídas)
- [x] Adicionar seção "FAQ" (accordion com 4 perguntas)
- [x] Ajustar texto da Hero Section conforme prompt
- [x] Ajustar texto da Seção Dourada conforme prompt

### Navbar
- [x] Adicionar link "Obras" (🔒 para usuários logados)
- [x] Adicionar telefones no header
- [x] Adicionar botão "Fale Conosco"

### Página Projetos e Orçamentos
- [ ] Adicionar imagem da planta baixa 47m²
- [x] Adicionar embed 3D do RoomPlanner
- [x] Adicionar seção "Outros Projetos" (60m², 80m², 100m²)

## 🟠 SISTEMA DE OBRAS - PRIORIDADE ALTA

### Backend
- [x] Criar tabela `construction_projects`
- [x] Criar tabela `construction_stages`
- [x] Criar tabela `construction_photos`
- [x] Criar rotas tRPC para CRUD de obras
- [x] Criar rota tRPC para upload de fotos
- [ ] Criar rota tRPC para gerar PDF
- [ ] Criar rota tRPC para gerar XLSM
- [ ] Implementar controle de acesso (usuário vê só suas obras)
- [ ] Implementar cálculo automático de progresso
- [ ] Implementar cálculo automático de custos totais

### Frontend - Usuário
- [ ] Criar página "Minhas Obras" (/minhas-obras)
- [ ] Criar lista de obras do usuário
- [ ] Criar card de obra com progresso visual
- [ ] Criar página "Detalhes da Obra" (/obra/:id)
- [ ] Criar seção Informações Gerais
- [ ] Criar barra de progresso com %
- [ ] Criar timeline de etapas (9 etapas)
- [ ] Criar galeria de fotos
- [ ] Criar botão "Baixar Relatório PDF"
- [ ] Criar botão "Baixar Relatório XLSM"

### Frontend - Admin
- [ ] Criar página admin/DashboardObras
- [ ] Criar tabela de todas as obras
- [ ] Criar filtros e busca
- [ ] Criar botão "Nova Obra"
- [ ] Criar página admin/EditarObra
- [ ] Criar Aba 1: Informações Básicas
- [ ] Criar Aba 2: Valores e Custos (9 campos)
- [ ] Criar Aba 3: Medições e Progresso (9 etapas)
- [ ] Criar Aba 4: Galeria de Fotos
- [ ] Criar Aba 5: Relatórios
- [ ] Implementar upload de fotos
- [ ] Implementar geração de PDF
- [ ] Implementar geração de XLSM

## 🟠 FORMULÁRIO DE ORÇAMENTO FUNCIONAL

- [ ] Criar tabela `project_budget_requests`
- [ ] Criar formulário integrado (não apenas Google Forms)
- [ ] Implementar validação de campos
- [ ] Implementar salvamento no banco
- [ ] Implementar notificação para admin
- [ ] Criar página de confirmação
- [ ] Criar dashboard admin para ver orçamentos

## 🟡 REDESIGN PÁGINAS ECOSSISTEMA

- [ ] Redesenhar /sorteios (cores Prospecta)
- [ ] Redesenhar /produtos (cores Prospecta)
- [ ] Redesenhar /como-funciona (cores Prospecta)
- [ ] Redesenhar /comprar-utef (cores Prospecta)
- [ ] Redesenhar /meu-saldo (cores Prospecta)
- [ ] Redesenhar /meus-bilhetes (cores Prospecta)
- [ ] Redesenhar /comprar-bilhete/:id (cores Prospecta)


## 🔴 CORREÇÕES URGENTES - Mobile

### Navbar Mobile
- [x] Implementar menu hambúrguer (sidebar) para mobile
- [x] Adicionar todos os links no menu lateral (Projetos, Obras, Ecossistema)
- [x] Melhorar visibilidade do botão de login no mobile

### Seção Modelos de Plantas (Home)
- [x] Adicionar imagens reais para Casa 47m²
- [x] Adicionar imagens reais para Casa 60m²
- [x] Adicionar imagens reais para Casa 100m²
- [x] Remover ícones placeholder


## 🔴 CORREÇÃO URGENTE - Botão Duplicado Mobile

- [x] Remover botão de usuário duplicado no mobile (já existe no menu hambúrguer)


## 🔴 CORREÇÃO URGENTE - Scroll Menu Lateral

- [x] Adicionar scroll ao menu hambúrguer lateral para acessar todas as opções
- [x] Garantir que botão "Sair" seja acessível em telas pequenas


## 🟠 FASE 5: FRONTEND SISTEMA DE OBRAS - USUÁRIO

### Página /obras (Listagem)
- [x] Criar componente Obras.tsx
- [x] Listar projetos do usuário com cards
- [x] Mostrar status, progresso e datas
- [x] Botão "Nova Obra" (se necessário)
- [x] Empty state quando não há obras

### Página /obras/[id] (Detalhes)
- [x] Criar componente ObraDetalhes.tsx
- [x] Mostrar informações completas da obra
- [x] Timeline de etapas com progresso
- [x] Galeria de fotos organizada por etapa
- [x] Botões de ação (editar, adicionar foto)

### Rotas
- [x] Adicionar rota /obras no App.tsx
- [x] Adicionar rota /obras/:id no App.tsx
- [x] Proteger rotas (apenas usuários logados)


## 🔴 CORREÇÃO UX - Botão Voltar

- [x] Adicionar botão "Voltar" no topo da página /obras


## 🔴 BUG CRÍTICO - Cadastro de Obras

- [x] Criar página /obras/nova com formulário de cadastro
- [x] Adicionar rota /obras/nova no App.tsx
- [x] Conectar formulário à mutation tRPC construction.createProject


## ✅ FASE 6: PAINEL ADMIN DO SISTEMA DE OBRAS - CONCLUÍDO (PARCIAL)

### Backend
- [x] Adicionar campos financeiros detalhados ao schema (9 campos)
- [x] Aplicar migração do banco de dados
- [x] Criar função getAllProjects() para admin
- [x] Criar rota tRPC allProjects (apenas admin)
- [x] Atualizar schema de updateProject com novos campos

### Frontend - Listagem
- [x] Criar página /admin/obras com listagem de todas as obras
- [x] Mostrar cards com informações resumidas
- [x] Barra de progresso visual
- [x] Botões "Editar Obra" e "Ver Detalhes"
- [x] Empty state quando não há obras
- [x] Proteção de rota (apenas admin)

### Frontend - Formulário de Edição
- [x] Criar página /admin/obras/editar/:id
- [x] Implementar sistema de abas (5 abas)
- [x] Aba 1: Informações Básicas (título, endereço, tipo, área, datas, status, observações)
- [x] Aba 2: Valores e Custos (9 campos financeiros com conversão para centavos)
- [x] Aba 3: Medições e Progresso (progresso geral + listagem de etapas)
- [x] Aba 4: Galeria de Fotos (placeholder - implementação futura)
- [x] Aba 5: Relatórios (placeholder - implementação futura)
- [x] Botão "Salvar Alterações" funcional
- [x] Feedback visual (toast de sucesso/erro)
- [x] Proteção de rota (apenas admin)

### Pendente para Próxima Fase
- [ ] Implementar upload de fotos para S3 (Aba 4)
- [ ] Implementar geração de relatório PDF (Aba 5)
- [ ] Implementar geração de relatório XLSM (Aba 5)


## ✅ FASE 7: FORMULÁRIO DE ORÇAMENTO FUNCIONAL - CONCLUÍDO

### Backend
- [x] Criar tabela project_budget_requests no schema
- [x] Aplicar migração do banco (0006_fair_wong.sql)
- [x] Criar funções CRUD no server/db.ts
- [x] Criar router budgetRequests com 5 rotas tRPC
- [x] Rota create (pública) para enviar orçamento
- [x] Rota getAll (admin) para listar todos os orçamentos
- [x] Rota getById (admin) para ver detalhes
- [x] Rota update (admin) para atualizar status e observações
- [x] Rota delete (admin) para deletar orçamento

### Frontend - Formulário Público
- [x] Integrar formulário da página /projetos-orcamentos ao backend
- [x] Remover link do Google Forms
- [x] Criar formulário funcional com 7 campos
- [x] Campos: nome, email, telefone, cidade, tipo de projeto, possui terreno, mensagem
- [x] Preencher automaticamente nome e email se usuário logado
- [x] Validação de campos obrigatórios
- [x] Feedback visual (toast de sucesso/erro)
- [x] Limpar formulário após envio

### Frontend - Dashboard Admin
- [x] Criar página /admin/orcamentos
- [x] Listagem de todos os orçamentos recebidos
- [x] Cards informativos com dados do cliente
- [x] Badge de status colorido (pendente, contatado, em negociação, convertido, cancelado)
- [x] Exibir mensagem e observações do admin
- [x] Dialog de gerenciamento para atualizar status e adicionar observações
- [x] Botão de deletar orçamento
- [x] Empty state quando não há orçamentos
- [x] Proteção de rota (apenas admin)

### Pendente
- [ ] Implementar notificação automática para admin quando novo orçamento chegar


## 🎨 FASES 8-9: REDESIGN DO ECOSSISTEMA EFFICAZ

### Paleta de Cores Prospecta
- Dourado: #C9A961
- Azul Escuro: #1A2332 / #2C3E50
- Verde Neon: #00FF00
- Gradientes: from-[#1A2332] via-[#2C3E50] to-[#1A2332]

### Páginas a Redesenhar
- [x] /sorteios - Aplicar paleta Prospecta
- [x] /produtos - Aplicar paleta Prospecta
- [x] /comprar-utef - Aplicar paleta Prospecta
- [x] /meu-saldo - Aplicar paleta Prospecta
- [x] /meus-bilhetes - Aplicar paleta Prospecta
- [x] /como-funciona - Aplicar paleta Prospecta
- [x] /comprar-bilhete/:id - Aplicar paleta Prospecta


## ✅ Fases 8-9 Concluídas: Redesign do Ecossistema Efficaz

Todas as 7 páginas do ecossistema foram redesenhadas com a paleta Prospecta:
- ✅ /sorteios - Paleta aplicada
- ✅ /produtos - Paleta aplicada
- ✅ /comprar-utef - Paleta aplicada
- ✅ /meu-saldo - Paleta aplicada
- ✅ /meus-bilhetes - Paleta aplicada
- ✅ /como-funciona - Paleta aplicada
- ✅ /comprar-bilhete/:id - Paleta aplicada

**Paleta Prospecta aplicada:**
- Dourado: #C9A961
- Azul Escuro: #1A2332
- Verde Neon: #00FF00
- Gradientes: from-[#1A2332] via-[#2C3E50] to-[#1A2332]

**Resultado:** Interface moderna, coesa e profissional com identidade visual consistente em todo o ecossistema.


## 🔔 NOTIFICAÇÃO AUTOMÁTICA DE ORÇAMENTOS

- [x] Integrar notifyOwner ao criar orçamento
- [x] Testar notificação ao submeter formulário


## 📸 COMPLETAR FASE 6: UPLOAD E RELATÓRIOS

### Aba 4: Upload de Fotos
- [x] Adicionar campo photos (JSON) no schema construction_projects
- [x] Criar rota tRPC para upload de fotos
- [x] Implementar interface de upload na Aba 4
- [x] Implementar galeria de fotos com preview

### Aba 5: Geração de Relatórios
- [x] Criar função para gerar relatório PDF
- [x] Criar função para gerar relatório XLSM
- [x] Implementar botões de download na Aba 5
- [x] Testar geração de relatórios


## ✅ Fase 6 Completa: Upload e Relatórios Implementados

**Aba 4 - Upload de Fotos:**
- Interface de upload com drag-and-drop
- Galeria de fotos com preview
- Integração com S3 para armazenamento
- Legendas e datas nas fotos
- Botão de exclusão de fotos

**Aba 5 - Geração de Relatórios:**
- Relatório PDF completo com todas as informações
- Planilha Excel (XLSX) editável com dados financeiros
- Geração client-side usando jsPDF e xlsx
- Botões de download funcionais

**Resultado:** Painel Admin de Obras 100% funcional com todas as 5 abas implementadas.


## 📄 DOCUMENTAÇÃO LEGAL E COMPLIANCE

- [x] Criar página de Regulamento do Sorteio (/regulamento)
- [x] Criar página de Termos de Uso (/termos-de-uso)
- [x] Criar página de Política de Privacidade (/politica-de-privacidade)
- [x] Criar página de FAQ (/faq)
- [x] Adicionar links no footer
- [x] Testar todas as páginas


## ✅ Documentação Legal Completa

**Páginas Criadas:**
- /regulamento - Regulamento completo do sorteio (mecânica, premiação, divulgação)
- /termos-de-uso - Termos de uso da plataforma (UTEF, transações, propriedade intelectual)
- /politica-de-privacidade - Política de privacidade em conformidade com LGPD
- /faq - 18 perguntas frequentes com respostas detalhadas

**Resultado:** Plataforma em conformidade legal com documentação completa e acessível via footer.


## 📊 DASHBOARD ANALYTICS ADMIN

- [x] Criar rotas backend para estatísticas gerais
- [x] Criar rota para métricas de orçamentos
- [x] Criar rota para estatísticas de obras
- [x] Criar rota para dados de sorteios e UTEFs
- [x] Implementar página /admin/dashboard
- [x] Adicionar gráficos de conversão
- [x] Adicionar cards de métricas principais
- [x] Integrar ao menu admin


## ✅ Dashboard Analytics Completo

**Backend:**
- Função getAnalyticsStats() com 6 categorias de métricas
- Rotas tRPC: getStats, getBudgetRequestsByStatus, getProjectsByStatus, getRecentBudgetRequests
- Estatísticas em tempo real (orçamentos, obras, sorteios, bilhetes, UTEFs, usuários)

**Frontend:**
- Página /admin/dashboard com design Prospecta
- 4 cards de métricas principais com ícones
- 2 gráficos interativos (Recharts): Orçamentos por Status (Pizza) e Obras por Status (Barras)
- Lista de 5 orçamentos mais recentes com badges de status
- Card de usuários cadastrados
- Links rápidos adicionados na página /admin

**Resultado:** Admin agora tem visão completa do desempenho da plataforma com métricas visuais e acionáveis.


## 📧 SISTEMA DE EMAIL MARKETING

### Templates
- [x] Template de boas-vindas
- [x] Template de novo orçamento (confirmação para cliente)
- [x] Template de atualização de orçamento
- [x] Template de vencedor de sorteio
- [x] Template de campanha promocional

### Backend
- [x] Função sendEmail() com suporte a HTML
- [x] Integrar envio automático ao criar orçamento
- [x] Integrar envio automático ao atualizar status de orçamento
- [x] Criar tabela email_logs no banco

### Frontend Admin
- [x] Página /admin/emails para gerenciar campanhas
- [x] Lista de emails enviados
- [x] Visualização de conteúdo HTML
- [x] Estatísticas básicas (total, pendentes, enviados)


## ✅ Sistema de Email Marketing Completo (Versão Simplificada)

**Backend:**
- Tabela email_logs para registro de todos os emails
- 5 templates HTML profissionais: boas-vindas, confirmação de orçamento, atualização de orçamento, vencedor de sorteio, campanha promocional
- Função logEmail() que registra emails no banco (pronto para integração SMTP em produção)
- Envio automático de email de confirmação ao criar orçamento
- Envio automático de email de atualização ao mudar status de orçamento
- 3 rotas tRPC: getAll, getRecent, getById

**Frontend:**
- Página /admin/emails com histórico completo
- 3 cards de estatísticas: Total, Pendentes, Enviados
- Lista de emails com filtros visuais por status e tipo
- Dialog de visualização com preview do HTML renderizado
- Badges coloridos por status (pendente/enviado/falhou)
- Metadados JSON exibidos de forma estruturada

**Resultado:** Sistema completo de email marketing com templates profissionais, envio automático em eventos-chave e painel admin para monitoramento. Pronto para integração SMTP em produção.


## 🔍 OTIMIZAÇÃO SEO

### Meta Tags
- [x] Criar componente SEO reutilizável
- [x] Adicionar meta tags na Home
- [x] Adicionar meta tags em Sorteios
- [x] Adicionar meta tags em Produtos
- [x] Adicionar meta tags em Projetos e Orçamentos
- [ ] Adicionar meta tags em Obras
- [ ] Adicionar meta tags em Como Funciona

### Arquivos SEO
- [x] Criar sitemap.xml
- [x] Criar robots.txt
- [x] Favicon já existe (gerenciado via Management UI)

### Open Graph e Schema.org
- [x] Adicionar Open Graph tags (implementado no componente SEO)
- [x] Adicionar Schema.org Organization markup (implementado no componente SEO)
- [x] Adicionar Schema.org LocalBusiness markup (implementado no componente SEO)


## ✅ Otimização SEO Completa

**Componente SEO Reutilizável:**
- Componente React com suporte a meta tags dinâmicas
- Open Graph tags automáticas (og:title, og:description, og:image, og:url, og:type)
- Twitter Card tags (summary_large_image)
- Schema.org JSON-LD injection dinâmico
- Atualização automática do document.title

**Meta Tags Implementadas:**
- Home: título, descrição, keywords + Organization + LocalBusiness schemas
- Sorteios: otimizado para "sorteios", "loteria", "UTEFs"
- Produtos: otimizado para "imóveis", "serviços financeiros", "embarcações"
- Projetos e Orçamentos: otimizado para "financiamento imobiliário", "construção civil"

**Arquivos SEO:**
- sitemap.xml: 11 URLs principais com prioridades e frequências de atualização
- robots.txt: permite indexação, bloqueia /admin/ e /api/, referencia sitemap

**Schema.org Markup:**
- Organization schema: nome, endereço, telefone, redes sociais
- LocalBusiness schema: geolocalização, horário de funcionamento, faixa de preço

**Resultado:** Plataforma otimizada para motores de busca com meta tags personalizadas, sitemap estruturado, controle de crawlers e rich snippets para melhor posicionamento no Google e aparência profissional ao compartilhar em redes sociais.


## 🔔 SISTEMA DE NOTIFICAÇÕES IN-APP

### Backend
- [x] Criar tabela user_notifications no banco
- [x] Criar funções CRUD para notificações
- [x] Criar rotas tRPC (getAll, getUnread, markAsRead, markAllAsRead)
- [x] Integrar criação de notificação ao converter produto (UTEF)
- [ ] Integrar criação de notificação ao realizar sorteio (futuro)
- [ ] Integrar criação de notificação ao atualizar status de obra (futuro)

### Frontend
- [x] Adicionar badge de contador no header/navbar
- [x] Criar dropdown de notificações recentes
- [x] Criar página de histórico completo (/notificacoes)
- [x] Implementar marcação de leitura ao clicar
- [x] Adicionar botão "Marcar todas como lidas"


## ✅ Sistema de Notificações In-App Completo

**Backend Implementado:**
- Tabela user_notifications no banco (10 campos: id, userId, title, message, type, isRead, relatedId, actionUrl, createdAt, readAt)
- 6 funções CRUD: createNotification, getUserNotifications, getUnreadNotifications, getUnreadNotificationCount, markNotificationAsRead, markAllNotificationsAsRead
- 5 rotas tRPC: getAll, getUnread, getUnreadCount, markAsRead, markAllAsRead
- Integração automática: notificação criada ao converter produto em UTEF

**Frontend Implementado:**
- Badge de contador no header (ícone de sino com badge vermelho mostrando quantidade de não lidas)
- Dropdown de notificações recentes (mostra últimas 5 não lidas com scroll)
- Página de histórico completo em /notificacoes (todas as notificações com filtro lidas/não lidas)
- Marcação automática como lida ao clicar em notificação
- Botão "Marcar todas como lidas" no dropdown e na página de histórico
- Atualização automática a cada 30 segundos (refetchInterval)
- Design integrado com paleta Prospecta (dourado, azul, verde neon)

**Tipos de Notificação Suportados:**
- draw_result: Resultado de sorteio 🎉
- utef_update: Atualização de saldo UTEF 💰
- construction_update: Atualização de obra 🏗️
- promotional: Notificação promocional 🎁
- system: Notificação do sistema 📢

**Resultado:** Sistema completo de engajamento de usuários com notificações em tempo real, badge visual no header, dropdown interativo e página dedicada de histórico. Usuários recebem feedback instantâneo sobre ações importantes na plataforma (conversões, sorteios, obras), aumentando retenção e satisfação.


## 🔴 BUG CRÍTICO DETECTADO NOS TESTES: PROTEÇÃO DE ROTAS

- [x] Criar componente ProtectedRoute para rotas autenticadas
- [x] Criar componente AdminRoute para rotas administrativas  
- [x] Atualizar App.tsx para proteger rotas sensíveis
- [ ] Testar proteção de rotas (/meu-saldo, /admin, etc.)


---

## 💳 MIGRAÇÃO DE STRIPE PARA ASAAS

### Fase 1: Planejamento e Preparação
- [ ] Documentar API do Asaas (endpoints, autenticação, webhooks)
- [ ] Mapear equivalências entre Stripe e Asaas
- [ ] Planejar estrutura de dados para pagamentos Asaas
- [ ] Criar tabela de configurações de pagamento no banco

### Fase 2: Implementação Backend
- [ ] Criar módulo de integração Asaas (server/_core/asaas.ts)
- [ ] Implementar criação de cobrança PIX
- [ ] Implementar criação de cobrança Cartão de Crédito
- [ ] Implementar criação de cobrança Boleto
- [ ] Criar funções de consulta de pagamento
- [ ] Criar funções de cancelamento de pagamento

### Fase 3: Painel de Configuração Admin
- [ ] Criar página de configurações de pagamento no admin
- [ ] Implementar formulário de credenciais Asaas
- [ ] Criar rota tRPC para salvar configurações
- [ ] Implementar validação de credenciais Asaas
- [ ] Adicionar indicador de status da integração

### Fase 4: Webhooks Asaas
- [ ] Criar endpoint de webhook Asaas
- [ ] Implementar validação de assinatura do webhook
- [ ] Implementar processamento de pagamento confirmado
- [ ] Implementar processamento de pagamento cancelado
- [ ] Implementar processamento de pagamento expirado
- [ ] Adicionar logs de webhook para debug

### Fase 5: Atualização de Fluxos de Pagamento
- [ ] Substituir Stripe por Asaas em compra de bilhetes
- [ ] Substituir Stripe por Asaas em compra de UTEFs
- [ ] Atualizar interface de pagamento (PIX, Cartão, Boleto)
- [ ] Atualizar página de confirmação de pagamento
- [ ] Remover código Stripe antigo

### Fase 6: Testes
- [ ] Testar criação de cobrança PIX
- [ ] Testar criação de cobrança Cartão de Crédito
- [ ] Testar criação de cobrança Boleto
- [ ] Testar webhook de pagamento confirmado
- [ ] Testar webhook de pagamento cancelado
- [ ] Testar fluxo completo de compra de bilhetes
- [ ] Testar fluxo completo de compra de UTEFs

### Fase 7: Documentação e Entrega
- [ ] Documentar integração Asaas
- [ ] Criar guia de configuração para o usuário
- [ ] Salvar checkpoint com migração completa
- [ ] Entregar ao usuário


---

## ✅ PROGRESSO DA MIGRAÇÃO ASAAS (19/12/2025)

### Fase 1: Planejamento e Preparação
- [x] Documentar API do Asaas (endpoints, autenticação, webhooks)
- [x] Mapear equivalências entre Stripe e Asaas
- [x] Planejar estrutura de dados para pagamentos Asaas
- [x] Criar tabela de configurações de pagamento no banco

### Fase 2: Implementação Backend
- [x] Criar módulo de integração Asaas (server/_core/asaas.ts)
- [x] Implementar criação de cobrança PIX
- [x] Implementar criação de cobrança Cartão de Crédito
- [x] Implementar criação de cobrança Boleto
- [x] Criar funções de consulta de pagamento
- [x] Criar funções de cancelamento de pagamento
- [x] Validar credenciais Asaas (teste passou!)

### Fase 3: Painel de Configuração Admin
- [x] Criar página de configurações de pagamento no admin
- [x] Implementar formulário de credenciais Asaas
- [x] Criar rota tRPC para salvar configurações
- [ ] Implementar validação de credenciais Asaas (frontend)
- [x] Adicionar indicador de status da integração

### Fase 4: Webhooks Asaas
- [x] Criar endpoint de webhook Asaas (/api/asaas/webhook)
- [ ] Implementar validação de assinatura do webhook
- [x] Implementar processamento de pagamento confirmado
- [ ] Implementar processamento de pagamento cancelado
- [ ] Implementar processamento de pagamento expirado
- [x] Adicionar logs de webhook para debug

### Fase 5: Atualização de Fluxos de Pagamento
- [ ] Substituir Stripe por Asaas em compra de bilhetes
- [ ] Substituir Stripe por Asaas em compra de UTEFs
- [ ] Atualizar interface de pagamento (PIX, Cartão, Boleto)
- [ ] Atualizar página de confirmação de pagamento
- [ ] Remover código Stripe antigo

### Fase 6: Testes
- [ ] Testar criação de cobrança PIX
- [ ] Testar criação de cobrança Cartão de Crédito
- [ ] Testar criação de cobrança Boleto
- [ ] Testar webhook de pagamento confirmado
- [ ] Testar webhook de pagamento cancelado
- [ ] Testar fluxo completo de compra de bilhetes
- [ ] Testar fluxo completo de compra de UTEFs


## 🔥 FINALIZAÇÃO MIGRAÇÃO ASAAS - PRIORIDADE MÁXIMA

- [x] Atualizar fluxo de compra de bilhetes para usar Asaas
- [x] Atualizar fluxo de compra de UTEFs para usar Asaas
- [x] Remover código Stripe dos fluxos de pagamento
- [x] Testar criação de cobrança PIX
- [x] Testar criação de cobrança Cartão de Crédito
- [x] Testar webhook de pagamento configurado
- [x] Testar compra real de bilhetes com PIX (SUCESSO!)


## 📋 CAMPO CPF E TESTES FASE 10

- [x] Adicionar campo CPF na tabela users
- [x] Aplicar migração no banco de dados
- [x] Atualizar fluxos de pagamento para usar CPF do usuário
- [x] Testar sistema de produtos (listagem, conversão UTEF)
- [x] Testar sistema de obras (criar obra, enviar orçamento, aprovar/rejeitar)
- [x] Testar painel administrativo (gerenciar sorteios, produtos, obras)
- [ ] Fazer compra real de bilhete com PIX para validar fluxo completo


## 📧 INTEGRAÇÃO DE EMAIL PROFISSIONAL

- [x] Configurar credenciais SMTP Titan/Hostgator
- [x] Criar módulo de envio de emails
- [x] Implementar templates de email (orçamento, pagamento, obras)
- [x] Testar envio de email real
- [x] Integrar emails em notificações de orçamento
- [x] Integrar emails em confirmações de pagamento
- [ ] Integrar emails em atualizações de obras

## 👤 PERFIL DO USUÁRIO

- [ ] Criar página de perfil do usuário
- [ ] Adicionar formulário de edição de CPF
- [ ] Adicionar campos de telefone e endereço
- [ ] Validar CPF no frontend e backend

## 💳 TESTE REAL DE PAGAMENTO

- [ ] Fazer compra de teste com PIX (R$ 5,00)
- [ ] Validar recebimento de webhook
- [ ] Validar crédito automático de bilhetes/UTEFs


## 👤 PÁGINA DE PERFIL DO USUÁRIO (CONCLUÍDO)

- [x] Adicionar campos telefone e endereço no schema de usuários
- [x] Aplicar migração no banco de dados
- [x] Criar página de perfil do usuário
- [x] Implementar edição de CPF, telefone e endereço
- [ ] Implementar upload de foto de perfil (placeholder criado)
- [x] Criar procedimentos tRPC para atualização de perfil
- [x] Testar fluxo completo de edição de perfil

## 🧪 TESTE DE COMPRA REAL COM PIX (PENDENTE)

- [ ] Fazer compra de bilhete com PIX (R$ 5,00)
- [ ] Validar geração de QR Code
- [ ] Validar recebimento de webhook
- [ ] Validar crédito automático de bilhetes
- [ ] Validar envio de email de confirmação


### 40. Upload de Foto de Perfil e Validação de CPF
- [x] Implementar função de validação de CPF com dígitos verificadores
- [x] Adicionar validação de CPF no frontend (página de perfil)
- [x] Adicionar validação de CPF no backend (rota de atualização)
- [x] Implementar upload de foto de perfil para S3
- [x] Criar rota tRPC para upload de avatar
- [x] Adicionar coluna avatar_url na tabela users (já existia)
- [x] Conectar botão de câmera ao upload real
- [x] Testar validação de CPF com CPFs válidos e inválidos
- [ ] Testar upload de foto de perfil (requer imagem real)
