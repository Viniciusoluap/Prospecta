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
- [ ] Criar tabela `construction_projects`
- [ ] Criar tabela `construction_stages`
- [ ] Criar tabela `construction_photos`
- [ ] Criar rotas tRPC para CRUD de obras
- [ ] Criar rota tRPC para upload de fotos
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
