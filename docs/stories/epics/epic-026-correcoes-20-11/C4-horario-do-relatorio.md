# C4 — Hora do relatório diário entre 07:00 e 14:00 (Brasília)

Status: InReview (implementada no ramo `claude/wip-epic026-c45`; aguarda portão de QA).
Epic: EPIC-026 — Correções de 20/11/2026 (`EPIC.md` no ramo do C2).
Paridade: Dolores é exceção (exclusiva do Prospecta). Sem migração de banco.

## Pedido do dono (20/11/2026, palavras dele)
"a rotina é apenas uma vez por dia mesmo, eu quero só que eu tenha o poder de escolha dentro desses horários"
(07:00, 08:00, 09:00, 10:00, 11:00, 12:00, 13:00 e 14:00, horário de Brasília).

## Problema
Em Integrações › "Dolores — operação contínua" › "Relatório a partir das", a lista ia de 00:00 a 07:00 porque o cron
rodava uma vez por dia às 07:00 de Brasília (`0 10 * * *`); hora mais tarde faria o relatório nunca sair.

## Critérios de aceite
- [x] AC1: lista única `HORAS_DO_RELATORIO` = 7..14 em `shared/dolores/operacao.ts`; a tela e a validação do servidor
      (`dolores.operacao.salvar`) usam essa lista. Fora dela → BAD_REQUEST.
- [x] AC2: valor antigo no banco (0..6), fora da lista ou inválido vale 07 (`horaDoRelatorio`). Padrão continua 07.
      A coluna `relatorio_hora` tem CHECK 0..23: sem migração.
- [x] AC3: o cron chama a rotina nas 8 horas (07..14 de Brasília = 10..17 UTC) com 8 entradas DIÁRIAS no `vercel.json`
      (`0 10 * * *` … `0 17 * * *`), geradas da constante `CRON_DOLORES_AGENDAS`; sem faixa `10-17`.
- [x] AC4: a ronda diária continua uma por dia (janela `diaria:<dia>`, a primeira chamada faz, as outras não repetem).
- [x] AC5: o relatório sai na primeira chamada cuja hora de Brasília seja >= a escolhida (janela `diario:<dia>`, uma vez
      por dia); se a chamada da hora não chegar, a seguinte envia. Chamadas depois disso → `ja_enviado` sem ler nada.
- [x] AC6: segurança inalterada: segredo do cron em tempo constante, nada do chamador (query, corpo, caminho) muda alvo
      ou janela, cabe no prazo de 45 s da rota (função de 60 s).
- [x] AC7: testes (abaixo).

## Decisões
- [AUTO-DECISION] Caminhos iguais ou distintos no `vercel.json`? → distintos: `/api/cron/dolores` (07h) e
  `/api/cron/dolores/08` … `/api/cron/dolores/14`. Motivo: não há garantia de que a Vercel aceite a mesma rota repetida;
  caminhos distintos são aceitos com certeza. O servidor registra os 8 caminhos fixos (`CAMINHOS_CRON_DOLORES`) na mesma
  rotina e IGNORA o fim do caminho: a hora vem do relógio do servidor (teste confere que `tratarCronDolores` não lê
  `req.query/params/body/path/url`).
- [AUTO-DECISION] Refazer a ronda na hora do relatório? → sim. Se a ronda do dia foi feita numa chamada ANTERIOR (hora
  escolhida depois das 07h, ou a chamada da hora não chegou), o relatório usa uma ronda nova numa janela própria do dia
  (`relatorio:<dia>`, só inserção, única) — dados do momento, sem quebrar a idempotência. Se a ronda diária foi feita na
  mesma chamada, é ela que vai no relatório (não lê duas vezes). Se a ronda refeita falhar, o relatório sai com a da
  manhã. Nunca há duas leituras completas na mesma chamada (cabe no prazo).
- Plano da Vercel: no Hobby cada cron roda no máximo uma vez por dia e pode disparar em qualquer minuto dentro da hora
  agendada — a regra ">=" cobre isso (a chamada das 13 UTC cai sempre nas 10h de Brasília). O projeto passa de 3 para
  10 entradas de cron. **Pendente de conferência na publicação**: confirmar no painel da Vercel que os 8 crons
  aparecem (o limite de quantidade de crons do plano não pôde ser consultado daqui, sem acesso à internet).

## Arquivos
- `shared/dolores/operacao.ts` — lista de horas, `horaDoRelatorio`, `CRON_DOLORES_AGENDAS`, `CAMINHOS_CRON_DOLORES`, `janelaRondaDoRelatorio`.
- `server/dolores/rondas.ts` — `tratarCronDolores` (relatório já montado → não relê; ronda refeita na hora do relatório).
- `server/dolores/operacao-router.ts` — validação pela lista; `agendamento.horasDoRelatorio` e `chamadasPorDia`.
- `api/index.ts` — a rota atende os 8 caminhos fixos.
- `vercel.json` — 8 entradas diárias.
- `client/src/components/admin/DoloresOperacaoCard.tsx` — texto explicativo (a lista já vinha de `HORAS_DO_RELATORIO`).
- `server/dolores/c4-horario-relatorio.test.ts` (novo); ajustes em `server/dolores/operacao.test.ts` e
  `server/dolores/operacao-qa-seguranca.test.ts` e `server/dolores/operacao-regras.test.ts` (hora 6 agora é recusada; 7..14 aceitas; 08 espera as 08:00).

## Testes
- (a) Automáticos: `c4-horario-relatorio.test.ts` — cada hora 7..14 com o dia inteiro de chamadas (e reentrega de cada
  uma) envia UMA vez, na hora certa; uma ronda diária; ronda refeita uma vez só quando a hora é depois das 07h; chamada
  perdida → a seguinte envia; hora antiga (03) vale 07; fuso e virada do dia (23:30 de Brasília não repete; dia
  seguinte envia de novo); `vercel.json` = constante. Mais os testes existentes da operação.
- (b) Manuais: nenhum.
- (c) Em produção: conferir os 8 crons no painel da Vercel e o relatório saindo na hora escolhida.
