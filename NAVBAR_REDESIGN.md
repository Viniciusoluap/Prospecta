# Redesign da Navbar - Layout Simplificado

## 📋 Requisitos do Cliente

### Mobile
- ✅ Menu hambúrguer à **ESQUERDA**
- ✅ Logo à **DIREITA**
- ✅ Todos os links dentro do menu hambúrguer

### Desktop
- ✅ Layout simplificado com apenas **3 elementos** na sequência:
  1. **Menu hambúrguer** (à esquerda)
  2. **Logo + Nome da Empresa** (centro)
  3. **Fale Conosco** (à direita)
- ✅ TODOS os links de navegação movidos para dentro do menu hambúrguer
- ✅ Removidos: telefones, dropdown "Ecossistema Efficaz", botões de usuário, "Meus Bilhetes"

## 🎯 Estrutura do Menu Hambúrguer (Mobile e Desktop)

O menu lateral contém:
- Informações do usuário (se logado) ou botão "Entrar/Cadastrar"
- **Navegação Principal:**
  - Início
  - Projetos e Orçamentos
  - Minhas Obras (se logado)
- **Ecossistema Efficaz:**
  - Sorteios
  - Produtos
  - Como Funciona
  - Comprar UTEFs
- **Minha Conta** (se logado):
  - Meus Bilhetes
  - Meu Saldo UTEF
  - Minhas Conversões
  - Painel Admin (se admin)
  - Sair

## ✅ Implementação Concluída

- [x] Menu hambúrguer posicionado à esquerda (mobile e desktop)
- [x] Logo posicionada à direita no mobile, centro no desktop
- [x] Botão "Fale Conosco" à direita em ambas as versões
- [x] Todos os links movidos para dentro do menu lateral
- [x] Menu lateral com scroll funcional
- [x] Correção de erros TypeScript (user?.role)
- [x] Layout responsivo mantido
