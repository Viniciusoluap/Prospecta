# Epic 014 — Correções de conteúdo, visual e simulador (lote do dono do produto)

## Contexto

Lote de 17 correções pontuais reportadas pelo dono do produto via prints/fotos de tela,
coletadas e organizadas numa única sessão (08/10/2026) antes de qualquer execução, por
pedido explícito dele. Cobre: dados institucionais errados (razão social, e-mails,
endereço, preços), navegação redundante, ativos visuais, dois textos autorais (missão +
novo curso), o simulador de financiamento, e falta de notificação de mensagens recebidas
pelo site.

## Decisões já tomadas (não reabrir sem pedido explícito)

1. **Razão social oficial**: `Prospecta Construções e Avaliação Imobiliária Ltda` (a que
   já está no rodapé) — padronizar em Regulamento do Sorteio e Política de Privacidade,
   que hoje mostram "Efficaz Promoção de Vendas".
2. **Regras do simulador (MCMV)**: não existe API pública oficial da Caixa/Ministério das
   Cidades (confirmado por pesquisa — só portarias em PDF; sites tipo valorfinal.com.br
   são blogs comerciais, não oficiais, e divergem entre si). Decisão: **lembrete
   automático por e-mail ao admin a cada 30 dias** para conferir a portaria oficial/
   simulador da Caixa e atualizar manualmente os valores no painel — sem scraping de
   fonte não-oficial, sem aviso visual no simulador público.
3. **Branch de trabalho**: branch novo e PR separado do PR #63 (que é só backend:
   chargeback + primeiro acesso) — mantém os dois pacotes revisáveis independentemente.

## Lotes de execução

Cada lote roda os gates (`tsc --noEmit`, `vitest run`, `npm run build`, `git diff --check`)
antes do commit. Checkpoint/relato ao dono do produto entre lotes; autorização já dada em
bloco para seguir sem parar lote a lote, exceto no Lote 4 (texto autoral — aprovação de
conteúdo antes de publicar).

### Lote 1 — Conteúdo institucional (texto/dados, baixo risco, sem lógica nova)
- #4 Projeto "Planta Baixa 47m²": R$160.000/160.000 UTEFs → R$215.000/215.000 UTEFs
- #5 E-mail rodapé: `contato@prospectaempreendimentos.com` → `atendimento@prospectaconstrucoes.com`
- #6 "Outros Projetos": 60m²→R$260.000, 80m²→R$305.000, 100m²→R$380.000
- #8 Remover logo quebrado "Exclusive Club" em Parceiros
- #9 Endereço Imperatriz (rodapé): `R. Gonçalves Dias, 1993 - Juçara, Imperatriz - MA, 65900-545`
- #10 Regulamento do Sorteio: razão social + e-mail (`contato@grupoefficaz.com.br` → `atendimento@prospectaconstrucoes.com`)
- #11 Termos de Uso: e-mail (mesmo domínio errado)
- #12 Política de Privacidade: razão social + e-mail (`privacidade@grupoefficaz.com.br` → `atendimento@prospectaconstrucoes.com`)
- #16 Endereço Imperatriz (página Contato) + horário de funcionamento **em todo o site**: "Seg-Sex 8h-18h" → "Segunda a sexta, das 9h às 17h"
- Sweep adicional: varrer o código inteiro atrás de `grupoefficaz.com.br` e `EFFICAZ PROMOÇÃO DE VENDAS` pra garantir que não sobra nenhuma ocorrência fora das já mapeadas.

### Lote 2 — Ativos visuais
- #7 Trocar as 3 fotos dos cards de casa na home (Smart/Concept/Luxo) pelos arquivos enviados, preservando qualidade/proporção
- #13 Ícone do WhatsApp flutuante → ícone oficial do WhatsApp

### Lote 3 — Navegação
- #1 Padronizar botão "Voltar" no canto superior esquerdo; eliminar duplicidade nas abas que já tinham um

### Lote 4 — Textos institucionais autorais (precisa aprovação antes de publicar)
- #14 Sobre Nós: estatísticas ("Em breve" → 300 imóveis / 150 clientes / 100 obras) + reescrita do texto da Missão
- #15 Cursos: novo card "Mentoria VFX" (turmas em andamento), copy nova

### Lote 5 — Notificação de mensagens por e-mail
- #17 `budgetRequests.create` e `leads.createPublic` (e qualquer outro formulário público encontrado na varredura) passam a enviar e-mail para `atendimento@prospectaconstrucoes.com` quando alguém envia mensagem/solicita orçamento

### Lote 6 — Simulador de financiamento
- #2 Simulador calcula a parcela também pela tabela Price
- #3 Lembrete automático por e-mail ao admin a cada 30 dias para revisar/atualizar as regras (sem fonte automática, por decisão acima)

## Fora do escopo / não assumir
- Nenhuma mudança de preço/regra além das explicitamente listadas acima.
- Nenhuma automação de scraping de fonte não-oficial para dados financeiros.
- PR #63 (chargeback, primeiro acesso, tiles admin) não é tocado por este epic.
