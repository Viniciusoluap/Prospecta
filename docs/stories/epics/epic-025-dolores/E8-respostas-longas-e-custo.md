# E8 — Respostas longas e custo real

Status: InReview (implementação concluída; aguarda o portão de QA de segurança)
Epic: EPIC-025 (Etapa 8) — correção de dois problemas reais de produção da Dolores (19/11/2026).
Paridade: suspensa por ordem do dono em 16/11 (Grupo Santa Fé em espera); a Dolores é exclusiva do Prospecta até nova ordem.
Ramo: `epic025-dolores-etapa8` (da `main` `feeae01`). Migração: **`0134`** (a `0133` é da Etapa 7, `0133_dolores_grupos_tipo.sql`;
a `0132` já é a de consentimentos — o número `0133` pedido para esta etapa colidiria).

## Problema
1. O dono pediu no WhatsApp: "Divida todos esses clientes do crm em atraso para resolvermos todos até o fim do mês, igualmente
   por dia. Exemplo: 11 processos em 11 dias restantes dá um por dia". Resposta: "Dolores: não consegui concluir. (Parei antes de
   terminar: a resposta ficou longa demais. Consultei: listar_atrasos. Nada foi alterado no sistema.)". No banco: 2 voltas, a 2ª
   com `stop_reason = max_tokens` (`MAX_TOKENS_SAIDA = 2000`); o corpo enviado ficou vazio — o parcial não chegou ao dono.
2. Três perguntas no Haiku 5.5 apareceram na tela/relatório como perto de US$ 2; o real foi de centavos. Causas: o cache
   (escrita e leitura) era somado como entrada cheia, e havia um preço único — preenchido com o preço do modelo mais caro.

## Critérios de aceite
- [x] AC1 — Nunca descartar: a volta que para em `max_tokens` manda o parcial (pelos mesmos filtros de saída), cortado no fim da
      última linha completa, com o aviso "(continua — … peça o restante em partes …)". Um `tool_use` cortado no meio não é
      executado; sem texto nenhum, uma última chamada SEM ferramentas pede a resposta curta (`PEDIDO_DE_RESUMO`).
- [x] AC2 — "continuar": avaliado e NÃO implementado (decisão abaixo); o aviso orienta a pedir em partes.
- [x] AC3 — Resposta em até 3 mensagens (`partesDaResposta`): cada uma ≤ 3.800 caracteres, cortada em quebra de linha, numerada
      "(1/3)"; todas pelos mesmos filtros (o texto inteiro e, de novo, cada parte) e para o mesmo destino conferido (só o número do
      dono); os quadros do sistema (fila/feito) nunca são cortados; falha de envio para as seguintes; uma linha de auditoria por
      mensagem (`parte` no resumo).
- [x] AC4 — `MAX_TOKENS_SAIDA = 5000`, limitado ao que cabe no prazo (`tokensDeSaidaNoPrazo`: 100 tokens/s por baixo, piso
      1.000); a reserva do limite mensal usa exatamente a saída pedida em cada chamada; `TETO_ENTRADA_POR_PEDIDO` (150.000) e o
      prazo de 45 s inalterados.
- [x] AC5 — Leitura nova `plano_de_atrasos` (só leitura, `contamina: true`, entrada estrita zod), regra pura em
      `shared/dolores/plano-atrasos.ts`: mesmos itens de `listar_atrasos` (filtro de módulo), do mais atrasado para o menos,
      divididos igualmente até a data-limite (padrão fim do mês, fuso UTC−3; só dias úteis por padrão; resto para os primeiros
      dias; mais dias que itens = um por dia nos primeiros). Formato compacto com total e conferência. Liberada junto da etapa 6
      (a etapa em vigor não muda). Descrição e prompt dizem quando usar; `docs/dolores/ferramentas-etapa1.json` regerado.
- [x] AC6 — `listar_atrasos` enxuto: campos vazios (null) e `false` omitidos de cada item (ausente = não registrado).
- [x] AC7 — Prompt: listas longas compactas (total primeiro, uma linha por item, sem repetir cabeçalho); conta é do sistema.
- [x] AC8 — Custo por modelo e por tipo de token (`shared/dolores/custo.ts`): tabela de preços por modelo em US$/milhão (entrada,
      saída, escrita e leitura de cache) + cotação, informados pelo admin; cache vazio = 1,25× / 0,1× da entrada (a tela diz);
      os campos antigos viram reserva (só para modelo sem preço; a tela diz quando usou).
- [x] AC9 — Migração `0134_dolores_precos.sql` aditiva e idempotente (`dolores_precos_modelo`, `dolores_cotacao`), aplicada duas
      vezes no banco de teste; schema em `drizzle/schema-dolores-operacao.ts`.
- [x] AC10 — Tela: modelos do consumo do mês + escolhidos em Integrações › Anthropic, 4 campos por modelo e a cotação; gasto em
      US$ e R$ por modelo e por função (conversa; grupos; documentos e notas — estas duas não se separam no registro).
      Rotas novas `salvarPrecoModelo` e `salvarCotacao` só admin por PAPEL (`soAdmin`), entrada estrita, auditadas.
- [x] AC11 — Relatório do dono (diário e sob demanda) usa a mesma conta (a ronda guarda o consumo por modelo e função).
- [x] AC12 — Limite mensal (2d): conferido e mantido; a tela mostra "entrada contada no limite" e o custo real lado a lado.
- [x] AC13 — Cache (2e): avaliado; aplicado só o enxugamento seguro (abaixo).

## Decisões
- [AUTO-DECISION] "continuar" → não implementado (reason: o comando anterior guardado está pelo filtro do REGISTRO — CPF/telefone
  mascarados —, então refazê-lo não é o mesmo pedido; refazer um pedido com intenção de ação poderia repetir ação; não há onde
  guardar o ponto do corte sem coluna nova; o custo seria em dobro. Com 3 mensagens, a saída maior e a conta no código, o corte
  fica raro; o aviso orienta a pedir em partes).
- [AUTO-DECISION] Número da migração → `0134` (reason: a `0133` já existe na Etapa 7; dois arquivos `0133` confundem a ordem).
- [AUTO-DECISION] Cotação em tabela própria (`dolores_cotacao`) e não coluna nova em `dolores_operacao_config` (reason: a leitura
  da configuração da operação faz `select *`; uma coluna nova quebraria a operação inteira entre o deploy e a migração).
- [AUTO-DECISION] `plano_de_atrasos` em `LIBERADAS_ETAPA_6` (reason: é leitura derivada de `listar_atrasos`; subir `ETAPA_ATUAL`
  mudaria a etapa gravada em toda a auditoria e conflitaria com a Etapa 7).
- Limite mensal (2d): `usoDoMes`, `reservarChamada`, `reservarClassificacao`, `reservarMarcacao` e
  `registrarConsumoDaClassificacao` somam `tokens_entrada + tokens_cache_escrita + tokens_cache_leitura` como entrada cheia.
  Mantido (é conservador). Com os números reais, 101.408 tokens "de entrada" no limite para 13.068 de entrada sem cache.
  Para o dono decidir: contar o cache pelo peso (escrita 1,25, leitura 0,1) deixaria o limite ~2,6× mais folgado nesse padrão.
- Cache (2e): texto do sistema + ferramentas ≈ 12.600 tokens, regravado nas 3 perguntas (intervalos de 6 e 25 min > 5 min).
  1 hora custa 2× a entrada na escrita (contra 1,25×): só compensa com 2+ perguntas por hora; com perguntas esparsas, custa
  60% a mais. No Haiku, a diferença é de frações de centavo por pergunta. Mantido em 5 min. Aplicado: o aviso do filtro que se
  repetia nas 17 descrições de leitura (~470 caracteres cada, ~2.000 tokens) sai das ferramentas do laço do WhatsApp e vai UMA
  vez no texto do sistema (`ferramentasParaOModelo`); a ponte HTTP e o JSON das ferramentas continuam com a descrição inteira.
  Nenhuma regra de segurança do prompt foi removida. Observação: as ferramentas de ação só entram quando a mensagem tem
  intenção de ação — isso gera um segundo prefixo de cache (lista diferente), regravado à parte.

## Arquivos
- `server/dolores/cerebro.ts` — parcial em `max_tokens`, resumo sem ferramentas, `MAX_TOKENS_SAIDA = 5000`, `tokensDeSaidaNoPrazo`, `ferramentasParaOModelo`.
- `server/dolores/prompt.ts` — conta pelo sistema, listas compactas, até 3 mensagens, aviso do filtro uma vez, `PEDIDO_DE_RESUMO`.
- `server/dolores/whatsapp.ts` — só o envio da resposta ao dono (`responderAoDono` em partes; `montarQuadros`).
- `shared/dolores/whatsapp.ts` — `partesDaResposta`, `MAX_PARTES_RESPOSTA`.
- `shared/dolores/plano-atrasos.ts`, `server/dolores/leitura/plano-atrasos.ts` (novos); `server/dolores/leitura/atrasos.ts` (`carregarItensDeAtraso`, `itemEnxuto`).
- `server/dolores/funcoes.ts`, `server/dolores/permissoes.ts`, `docs/dolores/ferramentas-etapa1.json`.
- `shared/dolores/custo.ts`, `server/dolores/custo.ts` (novos); `shared/dolores/operacao.ts`, `server/dolores/rondas.ts`, `server/dolores/operacao-router.ts`.
- `drizzle/0134_dolores_precos.sql` (nova), `drizzle/schema-dolores-operacao.ts`, `server/dolores/testes-banco.ts`.
- `client/src/components/admin/DoloresOperacaoCard.tsx`.
- `server/dolores/e8-respostas-e-custo.test.ts` (novo), `server/dolores/ponte.test.ts`, `server/dolores/e8-qa-seguranca.test.ts` (provas do QA, achados invertidos).
- `docs/dolores/como-ligar.md` (Etapa 8).

## Testes
Última execução (19/11): `npx tsc --noEmit` ok; vitest (server/dolores + anthropic, modelo por função, auth-session, imports-esm, api-rotas-producao; `--maxWorkers=2 --minWorkers=1`) 36 arquivos, 652 testes, 0 falhas; `npx vite build` ok. `server/dolores/e8-respostas-e-custo.test.ts` cobre: caso real (2ª
volta em `max_tokens` → o dono recebe o parcial), `max_tokens` sem texto, resposta em 2–3 mensagens só para o dono e filtrada,
falha de envio no meio, `plano_de_atrasos` (11/11, 25/10, 3/10, dias úteis, fim de mês, soma), custo real no Haiku (centavos)
contra a conta antiga (~US$ 1,85), reserva com aviso, relatório com a mesma conta, permissões pelo `appRouter`, migração 3×.

## Para o QA de segurança olhar
- `responderAoDono`: o destino é conferido uma vez e reutilizado; cada parte passa de novo pelo filtro; nenhuma parte é escolhida por texto.
- `cerebro.ts`: o `tool_use` cortado em `max_tokens` não é executado nem reenviado; a chamada de resumo é sem ferramentas e reserva o limite antes.
- `ferramentasParaOModelo`: só tira o sufixo exato `AVISO_DADOS`; o filtro da ponte continua rodando igual.
- `consumoDoMesDetalhado`: o único `sql.raw` é a constante `PARADA_GRUPO` (código, só letras).
- Rotas novas: `soAdmin`, `.strict()`, id de modelo por regex, preços com teto, auditoria sem valores sensíveis.

## Correções do portão de QA de segurança (19/11)
- **A1 (médio)** — os quadros do sistema (o que foi gravado e a fila, com código) vão SEMPRE no começo da PRIMEIRA mensagem
  (`partesDaResposta`); o texto do modelo vem depois e é ele que se corta. O laço guarda 1,5 s a mais por parte extra
  (`FOLGA_DO_LACO_MS` = 3 s + 2 × 1,5 s; `MINIMO_PARA_COMANDO_MS` acompanha) e o envio reduz o número de partes ao que cabe no
  tempo (`TEMPO_POR_PARTE_MS`). Se esta parte cabe e as seguintes não, ela leva "faltou parte da resposta; peça de novo em
  partes"; se uma parte depois da 1ª falha, uma mensagem curta avisa (se couber). A auditoria registra "resposta incompleta:
  faltou parte" com `partesPrevistas`, `partesEnviadas` e `avisoDeFalta` (sem texto nem número).
- **A2 (médio)** — resposta cortada em `max_tokens` com bloco `tool_use` (cortado ou completo, não executado): o aviso diz "A
  consulta/ação que eu ia fazer foi cortada e NÃO foi executada."; sem ação executada no pedido, "Nada foi alterado no sistema.";
  com ação executada antes, manda conferir o quadro do sistema (que vai primeiro). Vale também quando a chamada de resumo responde.
- **A3 (baixo)** — `semNumeracaoForjada`: "(n/m)" no começo de linha do texto do modelo sai; a numeração do sistema é a única.
- **A4 (baixo)** — a chamada de resumo não acontece com `TETO_ENTRADA_POR_PEDIDO` estourado (fica a frase fixa); documentado em
  `MAX_VOLTAS` que o máximo é MAX_VOLTAS + 1 chamadas (fechamento OU resumo).
- Teste de custo com os preços reais do Haiku 5.5 (0,10 / 0,50 / 0,125 / 0,01 US$ por milhão): US$ 0,00875.
