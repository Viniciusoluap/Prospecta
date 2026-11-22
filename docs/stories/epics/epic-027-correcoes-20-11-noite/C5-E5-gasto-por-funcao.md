# C5-E5 — Dolores: gasto separado por função + alerta em 80%

Status: InReview (ramo `epic027-c5gasto`, criado da etapa 2; implementada, aguarda o portão de QA de segurança).
Epic: EPIC-027 — Correções de 20/11/2026 (noite) (`EPIC.md`). Plano técnico: `C5-PLANO-dolores-jarvis.md` (seção E5).
Paridade: Dolores é exceção registrada no ROADMAP (sem porte ao Grupo Santa Fé).
Migração: `drizzle/0148_dolores_gasto_por_funcao.sql` (aditiva e idempotente; NÃO aplicada em banco nenhum por esta etapa).

## Pedido
Decisões do dono (21/11): "Dolores: cada função com seu gasto", para uma função não consumir o crédito das outras. Divisão da
cota mensal: **conversa com o dono 55% · documentos (classificação de documentos e notas de obra) 20% · grupos (resposta quando
marcada) 10% · clientes (atendimento a cliente cadastrado) 10% · avisos (proatividade/relatórios) 5%**. Teto total R$ 1.621/mês
(`TETO_DONO_REAIS`). Aprovado em 21/11: **alerta ao dono quando o gasto chegar a 80%** (antes só havia o bloqueio em 100%).

## Critérios de aceite
- [x] AC1 — Cada chamada à IA da Dolores é contada na sua função (`dolores_consumo.funcao`, 0148). Linhas antigas (NULL) contam pela
      regra antiga: mensagem do dono = conversa; parada "grupo…" = grupos; "cliente…" = clientes; o resto = documentos
      (`funcaoSql` em `server/dolores/consumo.ts` = `funcaoDaChamada` em `shared/dolores/custo.ts`). Nenhuma linha antiga é alterada.
- [x] AC2 — Cada função tem a sua parte do limite mensal. Ao atingir a parte, SÓ aquela função para (falha fechada): conversa →
      «Dolores: bati o limite do mês da nossa conversa; os grupos e os documentos continuam funcionando. …» ao dono; grupo e cliente
      ficam no silêncio/aviso padrão de sempre (motivo `limite_da_funcao` / `orcamento_marcacao` / `orcamento_atendimento`);
      documentos e notas voltam para "a classificar" (`orcamento_classificacao`). Estouro de grupos/clientes/documentos nunca bloqueia
      a conversa. A soma das partes é 100% e cada reserva conta a própria reserva contra a parte → o total não passa do limite.
      Mantidos: tetos por dia de grupo/cliente/classificação, "uma chamada de terceiros por vez", o orçamento próprio da
      classificação (`orcamento_classificacao_pct`, 1–50%) e o peso do cache (escrita ×1,25, leitura ×0,1). Onde se sobrepõem, vale o
      mais restritivo.
- [x] AC3 — Percentuais em `dolores_gasto_partes` (linha única, padrão do dono), editáveis só pelo ADMIN na tela de operação
      (`dolores.operacao.salvarPartes`, `soAdmin`): inteiros, 5 funções, cada uma de 1 a 96, soma exatamente 100 — conferido no
      servidor (zod + `erroDasPartes`) e no banco (CHECK). Auditado (`operacao_config`). Sem a 0148, vale a divisão padrão.
- [x] AC4 — Alertas ao dono no WhatsApp (texto fixo, sem IA, sem custo; `textoDoAlerta`): quando o gasto do mês cruza 80% do teto
      total e quando UMA função cruza 80% da parte dela; em 100% (limite inteiro ou a parte), aviso de modo sem IA. UMA vez por mês
      por (alvo, nível) — `dolores_gasto_alertas` com chave primária, `INSERT … ON CONFLICT DO NOTHING` (idempotente sob
      concorrência); envio que falhou devolve a vaga. Reais pela mesma conta da tela; sem preço completo, tokens contra a cota.
- [x] AC5 — Tela (`DoloresOperacaoCard`): barra por função (gasto × parte), total, estado dos alertas do mês, edição da divisão e
      "voltar à divisão do dono". Relatório diário: o gasto por função numa linha ("Por função: …").
- [x] AC6 — Testes em `server/dolores/c5-e5-gasto-por-funcao.test.ts`.

## Decisões autônomas
- [AUTO-DECISION] Folga do dono (80% para terceiros) → passou a contar só o uso dos TERCEIROS (tudo menos a conversa). Motivo: com
  a conversa na parte dela (55%), contar o uso da conversa faria a conversa comer o crédito dos grupos/clientes — o contrário da
  decisão do dono. A folga continua valendo se o admin der aos terceiros mais de 80% somados.
- [AUTO-DECISION] Partes de grupos e clientes substituem os 10% fixos de antes (`ORCAMENTO_MARCACAO_PCT`/`ORCAMENTO_ATENDIMENTO_PCT`
  viram o padrão da parte). Motivo: era a mesma fatia; agora editável pelo admin.
- [AUTO-DECISION] A trava continua em TOKENS (o sistema não inventa preço); o alerta de 80% sai pela primeira medida que chegar
  (tokens contra a cota ou R$ contra o teto/parte, quando há preço completo). O de 100% diz "modo sem IA" só quando a trava (tokens)
  bate de fato — com os limites padrão, o limite em reais (pior caso R$ 480) fica abaixo do teto de R$ 1.621.
- [AUTO-DECISION] Com 100% devido sem o de 80% ter saído, vai UMA mensagem (a de 100%) e o 80% fica marcado junto.
- [AUTO-DECISION] Avisos (E4) ainda não chamam a IA: a parte "avisos" existe (5%, conta, tela, alerta), e a E4 usa
  `conferirTerceiro`/`registrarConsumo({ funcao: "avisos" })` quando a proatividade ganhar a reserva própria.
- [AUTO-DECISION] A coluna `funcao` fica fora do schema Drizzle e é usada por SQL só quando existe (`temColunaFuncao`): publicar o
  código antes da 0148 não quebra o registro de consumo.

## Como cada função foi mapeada para as 5 partes
| Parte | Chamadas | Reserva |
|---|---|---|
| conversa (55%) | laço do dono no WhatsApp (`cerebro.ts`, `mensagemId` do dono) | `reservarChamada` → `orcamento_conversa` |
| documentos (20%) | classificação de documentos dos grupos (`classificacao.ts`) e leitura de notas de obra (`notas-obra.ts`) | `reservarClassificacao` → `orcamento_classificacao` |
| grupos (10%) | resposta em grupo quando marcada (`marcacao.ts`, parada "grupo…") | `reservarMarcacao` → `orcamento_marcacao` |
| clientes (10%) | atendimento a cliente cadastrado (`atendimento.ts`, parada "cliente…") | `reservarAtendimento` → `orcamento_atendimento` |
| avisos (5%) | proatividade/relatórios da E4 (hoje o relatório é texto fixo, sem IA) | — (E4) |

## File List
- `drizzle/0148_dolores_gasto_por_funcao.sql` (novo)
- `drizzle/schema-dolores-operacao.ts` (tabelas `dolores_gasto_partes`, `dolores_gasto_alertas`)
- `shared/dolores/custo.ts` (funções, partes, validação, situação, alertas e textos)
- `shared/dolores/operacao.ts` (linha "Por função" no relatório)
- `shared/dolores/whatsapp.ts` (motivo `limite_da_funcao`, `FRASE_LIMITE_DA_CONVERSA`)
- `server/dolores/consumo.ts` (coluna `funcao`, uso por função, partes, reservas por parte, disparo dos alertas)
- `server/dolores/custo.ts` (consumo por função pela coluna)
- `server/dolores/operacao-gasto.ts` (novo — situação por função e alertas)
- `server/dolores/operacao-router.ts` (situação por função, `salvarPartes`)
- `server/dolores/rondas.ts` (partes na seção de consumo)
- `server/dolores/cerebro.ts` (parada `limite_da_conversa` — 3 linhas)
- `server/dolores/whatsapp.ts` (pré-conferência da parte em `bloqueioAtual` e frase da conversa — pontos mínimos)
- `server/dolores/testes-banco.ts` (aplica a 0148)
- `client/src/components/admin/DoloresOperacaoCard.tsx` (barras por função, alertas, divisão)
- `server/dolores/c5-e5-gasto-por-funcao.test.ts` (novo)

## Change Log
- 21/11/2026 — @dev (Dex): Ready → InProgress → InReview. Implementação completa; aguarda o portão de QA de segurança.
