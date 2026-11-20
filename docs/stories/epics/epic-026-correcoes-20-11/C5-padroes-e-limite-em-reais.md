# C5 — Valores padrão e limite mensal em reais

Status: InReview (implementada no ramo `claude/wip-epic026-c45`; aguarda portão de QA).
Epic: EPIC-026 — Correções de 20/11/2026 (`EPIC.md` no ramo do C2).
Paridade: Dolores é exceção (exclusiva do Prospecta). Sem migração de banco.

## Pedido do dono (20/11/2026, palavras dele)
"já preencha no sistema … para ficarmos como um padrão … deixe com todas essas opções para caso um dia eu querer editar
… dê a previsão correta dos valores pra que eu consiga acompanhar".

Em produção já foram gravados em 20/11, a pedido dele: limites 15.000.000 (entrada) / 1.000.000 (saída); preços
(US$ por milhão) claude-haiku-5-5 = 0,10 / 0,50 / 0,125 / 0,01 e claude-opus-5-5 = 4 / 20 / 5 / 0,20; dólar a 6,00.

## Critérios de aceite
- [x] AC1: tabela de preços SUGERIDOS no código (`shared/dolores/precos-padrao.ts`), com data e fonte ("tabela oficial
      da Anthropic em 20/11/2026"), só com os modelos de preço confirmado (Haiku 5.5 e Opus 5.5). Modelo sem preço
      confirmado (ex.: claude-sonnet-5-5) fica sem sugestão. Só id exato.
- [x] AC2: a sugestão é só SUGESTÃO: na tela da operação, modelo sem preço cadastrado mostra o sugerido e o botão
      "Usar o sugerido", que grava num clique (rota `dolores.operacao.usarPrecoSugerido`, valores vindos do servidor).
      A conta do gasto nunca usa o sugerido sozinha; a estimativa continua dizendo quando usou a reserva.
- [x] AC3: cartão "Dolores — WhatsApp": ao lado dos limites, "equivale a até R$ X por mês" (pior caso: tudo no modelo
      mais caro em uso entre as funções da Dolores) e "se for só o modelo da conversa: até R$ Y", recalculado enquanto o
      admin digita (a mesma função pura do servidor).
- [x] AC4: aviso vermelho quando o pior caso passa do teto do dono (R$ 1.621); aviso amarelo quando a saída é maior que a
      entrada ou o pior caso passa de 5× o teto. Modelo em uso sem preço → aviso de que a previsão pode ficar abaixo.
- [x] AC5: botão "Usar o padrão (15.000.000 / 1.000.000)" (pela rota de sempre, `dolores.salvar`). A trava e a forma
      de contar o limite não mudaram.
- [x] AC6: tela da operação: "Previsão em reais" — gasto até agora, projeção até o fim do mês pelo ritmo atual (gasto ÷
      dias corridos contando hoje × dias do mês) e o máximo pelos limites (pior caso e só a conversa), com os mesmos
      avisos; cotação vazia → botão "Usar a sugerida (R$ 6)".
- [x] AC7: rotas novas/alteradas só admin por PAPEL (`soAdmin`), testado pelo `appRouter`.
- [x] AC8: texto simples, em português; valores com vírgula decimal.

## Decisões
- [AUTO-DECISION] Conta do limite em reais → entrada inteira a preço cheio de entrada + saída a preço de saída, vezes a
  cotação (o limite conta o cache como entrada cheia: é o pior caso real). Preço do modelo cadastrado; sem ele, a reserva
  (como no resto do sistema, e dito como "pelo preço de reserva"); sem nenhum, fica fora e a tela avisa.
- [AUTO-DECISION] "Modelos em uso" → o modelo resolvido de cada função da Dolores em Integrações › Anthropic › Modelo por
  função (`dolores_*`, mesma regra da hora de chamar a IA), sem ler a chave. "Modelo da conversa" = `dolores_whatsapp`.
- [AUTO-DECISION] "Usar o sugerido" ganhou rota própria (em vez de o navegador mandar os números) para que o valor
  gravado seja exatamente o da tabela do código.
- [AUTO-DECISION] Cotação sugerida 6,00 também entra como padrão (botão aparece só com a cotação vazia).
- Sem migração: tudo usa as tabelas da 0134 e a config da 0124.

## Arquivos
- `shared/dolores/precos-padrao.ts` (novo) — preços sugeridos, limites padrão, cotação sugerida, `previsaoDoLimite`, `projecaoDoMes`.
- `server/dolores/custo.ts` — `modelosEmUsoDaDolores`, `previsaoDoLimiteAtual`.
- `server/dolores/router.ts` — `dolores.status` devolve `previsao`, `limitesPadrao`, `tetoDonoReais`, `cotacaoSugerida`.
- `server/dolores/operacao-router.ts` — `gasto.precosPorModelo[].sugerido`, `gasto.sugestao`, `gasto.previsao`; rota `usarPrecoSugerido`.
- `client/src/components/admin/DoloresCard.tsx` — previsão em reais, avisos, botão do padrão.
- `client/src/components/admin/DoloresOperacaoCard.tsx` — previsão em reais, "Usar o sugerido", cotação sugerida.
- `server/dolores/c5-padroes-e-limite.test.ts` (novo).

## Testes
- (a) Automáticos: `c5-padroes-e-limite.test.ts` — 15M/1M com dólar a 6: Opus R$ 480, Haiku R$ 12; pior caso = o mais
  caro; avisos vermelho (60M/5M no Opus = R$ 2.040) e amarelo (trocados; 300M/10M = R$ 8.400 > 5× teto); sugestão fora da
  conta até o clique (pelo `appRouter`, com banco); "usar o sugerido" grava os valores do código e recusa modelo sem
  sugestão e campo a mais; padrão dos limites; projeção; permissões (colaborador com todos os módulos, corretor, user e
  admin inativo recusados).
- (b) Manuais: nenhum.
- (c) Em produção: conferir os números na tela (os valores já gravados devem dar R$ 480 no pior caso se o Opus estiver
  escolhido em alguma função da Dolores; R$ 12 se for só o Haiku).
