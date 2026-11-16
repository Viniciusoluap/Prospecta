# S-11 — Modelo da Anthropic por função (Integrações › Anthropic)

Status: InReview
Epic: EPIC-024 — pedido complementar do dono (16/11/2026), sobre a correção 10 (S-10)
Paridade: Admin › Integrações existe nos dois sistemas — porte para o Grupo Santa Fé fica como pendência no ROADMAP
(Santa Fé em espera por decisão do dono).
Tamanho estimado: M
Dependência: S-10 (chave e modelo preferencial no painel), S-03 (leitura por IA da Maquete), EPIC-025 E2 (Dolores no
WhatsApp). Base: `claude/epic025-dolores-etapa2` (Etapa 2 da Dolores, em QA). Sem migração de banco.

## Pedido do dono (16/11/2026, palavras dele)
"Quanto ao motor a ser utilizado para ler o PDF vamos estipular diferentes motores para diferentes funções, por exemplo
na conversa do WhatsApp pode ser o haiku que é mais barato e consegue conversar bem; já para ler as plantas em PDF a
gente pode escolher outro, já fixo. Coloque isso lá no painel de integração para que cada função em específico escolha
motores diferentes."

## Problema
Hoje há um único "modelo preferencial" no painel. A Dolores tem um campo de modelo próprio no cartão dela
(`dolores_whatsapp_config.modelo`) e a leitura da Maquete usa o preferencial ou o das configurações da maquete. O dono
quer escolher, num lugar só (Integrações › Anthropic), o modelo de cada função.

## Critérios de aceite
- [x] AC1: registro único das funções que usam a chave do painel (`shared/funcoes-anthropic.ts`): `maquete_leitura`
      ("Leitura de plantas em PDF — Maquete 3D") e `dolores_whatsapp` ("Dolores — conversa pelo WhatsApp"), cada uma com
      rótulo, descrição curta (o que faz e quando gasta) e recomendação em texto.
- [x] AC2: o modelo de cada função fica em `dashboard_settings["segredo.anthropic_painel_modelo.<funcao>"]` (vazio =
      usar o preferencial). Uma função única `modeloDaFuncao(funcao)` resolve: modelo da função → (Dolores: modelo antigo
      do cartão dela) → modelo preferencial do painel → padrão da função (config da maquete). `modeloDaFuncao` não lê a
      chave.
- [x] AC3: salvar valida o id contra a lista atual de modelos da conta (`modelosAnthropicPainel`), ou aceita vazio.
      Nenhum id inventado.
- [x] AC4: modelo escolhido que deixou de existir na conta (percebido ao listar os modelos ou ao trocar a chave) é
      limpo — a função cai para o preferencial — e o painel mostra o aviso até o admin escolher de novo.
- [x] AC5: painel "Modelo por função": uma linha por função (rótulo, descrição, recomendação, seletor com os modelos da
      conta + "Usar o preferencial (X)", salvar por função, modelo valendo agora). Sem chave: seção desabilitada com
      explicação. Só admin por PAPEL (colaborador com todos os módulos → FORBIDDEN, testado pelo `appRouter`).
      Funciona no iPad.
- [x] AC6: a leitura da Maquete usa `modeloDaFuncao("maquete_leitura")` quando a chave é a do painel; a Dolores usa
      `modeloDaFuncao("dolores_whatsapp")`. O cartão da Dolores mostra o modelo em uso e o atalho "alterar em
      Integrações › Anthropic"; o campo de modelo do cartão sai. Valor antigo de `dolores_whatsapp_config.modelo` é
      respeitado como queda enquanto a função não tiver modelo no painel. Ligar a IA da Dolores continua exigindo um
      modelo resolvido.
- [x] AC7: escolher modelo não chama a Anthropic para a função, não liga o interruptor da Dolores e não dispensa a
      confirmação de custo da Maquete.
- [x] AC8: a guarda da chave (`server/integracoes-anthropic.test.ts`) continua: a chave só é lida em
      `resolverCredencialIA` e em `bloqueioAtual`; nenhuma rota devolve a chave; chave e modelo fora de log/erro.
- [x] AC9: pendência de paridade no ROADMAP (seção EPIC-024, em espera).

## Fora do escopo
- Outras funções de IA (avaliação, mercado, Central de Vendas, `INCORPORACAO_IA_MODELO`) — usam `ENV.anthropicApiKey`,
  não a chave do painel; não entram no registro.
- Migração de banco; apagar a coluna `dolores_whatsapp_config.modelo`.

## Tarefas
- [x] T1: `shared/funcoes-anthropic.ts` (registro) e `server/_core/modelo-por-funcao.ts` (`modeloDaFuncao`, só nomes
      de modelo).
- [x] T2: `server/_core/anthropic-painel.ts` — salvar/validar por função, limpar o que sumiu da conta, status por função.
- [x] T3: rotas em `integracoes-router.ts` (`modelosPorFuncaoAnthropic`, `salvarModeloFuncaoAnthropic`), só admin por papel.
- [x] T4: ligações — `server/maquete-3d/base.ts`, `server/dolores/whatsapp.ts`, `server/dolores/router.ts`.
- [x] T5: telas — `AnthropicCard.tsx` (seção "Modelo por função") e `DoloresCard.tsx` (modelo em uso + atalho).
- [x] T6: testes, `tsc`, `vite build`, conferência visual (computador e iPad).

## Dev Notes (16/11/2026)
- Resolução (`server/_core/modelo-por-funcao.ts`, `modeloDaFuncao`): modelo da função → `anterior` (só a Dolores:
  `dolores_whatsapp_config.modelo`) → preferencial do painel → `padrao` (só a Maquete: `config.modeloIA`). Nunca lança:
  banco fora = "não escolhido" e cai para o próximo. Devolve `{ modelo, origem }` para a tela dizer de onde veio.
- O módulo `modelo-por-funcao.ts` lê só nomes de modelo; não importa o acessor do painel nem o cofre. A guarda trata o
  arquivo como "modelos" (falha se citar o módulo do painel, o cofre, `decryptSecret`, `apiKey` ou a chave do segredo).
- Maquete: `resolverCredencialIA` (ponto único da chave) passa o preferencial já lido para
  `modeloDaFuncao("maquete_leitura")`; `modeloDaLeitura` continua síncrona e usa `credencial.modelo` (função →
  preferencial) ou, sem isso / com a chave do servidor, `config.modeloIA`.
- Dolores: `bloqueioAtual` (ponto único da chave) chama `modeloDaFuncao("dolores_whatsapp", { anterior: cfg.modelo,
  preferencial: painel.modelo })`; sem modelo resolvido continua "sem_modelo". `dolores.status` usa a mesma resolução e
  devolve `origemModelo`.
- [AUTO-DECISION] Onde guardar "modelo sumiu"? → ao listar os modelos (`modelosAnthropic`) e ao trocar a chave, o modelo
  da função que a conta não oferece é limpo e o id vai para `segredo.anthropic_painel_modelo_sumiu.<funcao>`; o painel
  avisa até o admin escolher de novo (reason: em tempo de execução não dá para conferir a conta sem chamar a API; a
  conferência acontece nos dois momentos em que a lista é consultada, como o preferencial da S-10).
- [AUTO-DECISION] Dolores: o campo de modelo sai do cartão e da rota `dolores.salvar` (`.strict()` recusa `modelo`); o
  valor antigo em `dolores_whatsapp_config.modelo` continua valendo como queda. Quando o admin salva a linha "Dolores"
  no painel (qualquer valor, inclusive "Usar o preferencial"), o campo antigo é zerado (reason: depois disso a fonte é
  o painel; sem zerar, "Usar o preferencial" seria vencido em silêncio pelo valor antigo). Sem migração; a coluna fica.
- [AUTO-DECISION] Maquete com a chave do servidor (`ANTHROPIC_API_KEY`) continua com o modelo das configurações da
  maquete (reason: a lista do painel é da conta da chave do painel; o id pode não existir na outra conta). A linha da
  função mostra essa nota.
- [AUTO-DECISION] Remover a chave também limpa os modelos por função (como já limpa o preferencial).
- [AUTO-DECISION] Rotas novas usam `adminPorPapel` (adminProcedure + papel admin), como o `soAdmin` da Dolores.
- Escolher modelo não chama a IA da função (só `models.list`, que não consome tokens), não liga o interruptor da Dolores
  e não toca na confirmação de custo da Maquete.

## Testes
- Automáticos: `server/integracoes-modelo-por-funcao.test.ts` (12): resolução função → anterior → preferencial →
  padrão; cada função com o seu; banco fora; nunca lê a chave; sem chave a seção lista e recusa salvar; id validado
  contra a conta; vazio = preferencial; nada liga; Dolores antiga respeitada e limpa ao escolher no painel; modelo
  sumido (listar e trocar chave) cai para o preferencial com aviso; remover limpa; permissões pelo `appRouter`
  (colaborador com todos os módulos, corretor, cliente, user, empreiteiro, admin inativo → FORBIDDEN); Maquete usando o
  modelo da função. `server/integracoes-anthropic.test.ts` (guarda ajustada sem alargar a leitura da chave; Dolores
  router passa a poder importar só `existeChaveAnthropicPainel`). `server/dolores/router.test.ts` e
  `server/dolores/whatsapp.test.ts`: modelo da função vence o antigo; antigo respeitado; ligar exige modelo.
- Manuais (Playwright, harness simulado): Integrações em 1366 px e iPad (810 px), com e sem chave; sem rolagem lateral.
- Pendente em produção: escolher os modelos reais da conta do dono.

## File List
- `shared/funcoes-anthropic.ts` (novo) — registro das funções (rótulo, descrição, recomendação).
- `server/_core/modelo-por-funcao.ts` (novo) — `modeloDaFuncao` e leitura dos modelos gravados (sem chave).
- `server/_core/anthropic-painel.ts` — salvar/validar por função, limpar modelo sumido, status por função, remover.
- `server/integracoes-router.ts` — `modelosPorFuncaoAnthropic`, `salvarModeloFuncaoAnthropic` (só admin por papel);
  `modelosAnthropic` confere os modelos das funções.
- `server/maquete-3d/base.ts` — `resolverCredencialIA` com o modelo da função.
- `server/dolores/whatsapp.ts`, `server/dolores/router.ts` — modelo da função; campo de modelo sai de `salvar`.
- `client/src/components/admin/AnthropicCard.tsx` — seção "Modelo por função".
- `client/src/components/admin/DoloresCard.tsx` — modelo em uso + atalho para Integrações › Anthropic.
- `docs/dolores/como-ligar.md` — passo do modelo da Dolores.
- `server/integracoes-modelo-por-funcao.test.ts` (novo), `server/integracoes-anthropic.test.ts`,
  `server/dolores/router.test.ts`, `server/dolores/whatsapp.test.ts`.
- `docs/stories/epics/epic-024-correcoes-16-11/EPIC.md`, `docs/stories/epics/ROADMAP.md`.

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 16/11/2026 | @dev (Dex) | Story criada a partir do pedido do dono; Draft → InProgress (YOLO) |
| 16/11/2026 | @dev (Dex) | InProgress → InReview: registro, resolução única, painel por função, ligações e testes |
