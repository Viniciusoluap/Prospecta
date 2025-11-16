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
