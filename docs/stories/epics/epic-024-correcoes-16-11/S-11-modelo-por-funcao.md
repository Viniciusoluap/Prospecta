# S-11 — Modelo da Anthropic por função (Integrações › Anthropic)

Status: InProgress
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
- [ ] AC1: registro único das funções que usam a chave do painel (`shared/funcoes-anthropic.ts`): `maquete_leitura`
      ("Leitura de plantas em PDF — Maquete 3D") e `dolores_whatsapp` ("Dolores — conversa pelo WhatsApp"), cada uma com
      rótulo, descrição curta (o que faz e quando gasta) e recomendação em texto.
- [ ] AC2: o modelo de cada função fica em `dashboard_settings["segredo.anthropic_painel_modelo.<funcao>"]` (vazio =
      usar o preferencial). Uma função única `modeloDaFuncao(funcao)` resolve: modelo da função → (Dolores: modelo antigo
      do cartão dela) → modelo preferencial do painel → padrão da função (config da maquete). `modeloDaFuncao` não lê a
      chave.
- [ ] AC3: salvar valida o id contra a lista atual de modelos da conta (`modelosAnthropicPainel`), ou aceita vazio.
      Nenhum id inventado.
- [ ] AC4: modelo escolhido que deixou de existir na conta (percebido ao listar os modelos ou ao trocar a chave) é
      limpo — a função cai para o preferencial — e o painel mostra o aviso até o admin escolher de novo.
- [ ] AC5: painel "Modelo por função": uma linha por função (rótulo, descrição, recomendação, seletor com os modelos da
      conta + "Usar o preferencial (X)", salvar por função, modelo valendo agora). Sem chave: seção desabilitada com
      explicação. Só admin por PAPEL (colaborador com todos os módulos → FORBIDDEN, testado pelo `appRouter`).
      Funciona no iPad.
- [ ] AC6: a leitura da Maquete usa `modeloDaFuncao("maquete_leitura")` quando a chave é a do painel; a Dolores usa
      `modeloDaFuncao("dolores_whatsapp")`. O cartão da Dolores mostra o modelo em uso e o atalho "alterar em
      Integrações › Anthropic"; o campo de modelo do cartão sai. Valor antigo de `dolores_whatsapp_config.modelo` é
      respeitado como queda enquanto a função não tiver modelo no painel. Ligar a IA da Dolores continua exigindo um
      modelo resolvido.
- [ ] AC7: escolher modelo não chama a Anthropic para a função, não liga o interruptor da Dolores e não dispensa a
      confirmação de custo da Maquete.
- [ ] AC8: a guarda da chave (`server/integracoes-anthropic.test.ts`) continua: a chave só é lida em
      `resolverCredencialIA` e em `bloqueioAtual`; nenhuma rota devolve a chave; chave e modelo fora de log/erro.
- [ ] AC9: pendência de paridade no ROADMAP (seção EPIC-024, em espera).

## Fora do escopo
- Outras funções de IA (avaliação, mercado, Central de Vendas, `INCORPORACAO_IA_MODELO`) — usam `ENV.anthropicApiKey`,
  não a chave do painel; não entram no registro.
- Migração de banco; apagar a coluna `dolores_whatsapp_config.modelo`.

## Tarefas
- [ ] T1: `shared/funcoes-anthropic.ts` (registro) e `server/_core/modelo-por-funcao.ts` (`modeloDaFuncao`, só nomes
      de modelo).
- [ ] T2: `server/_core/anthropic-painel.ts` — salvar/validar por função, limpar o que sumiu da conta, status por função.
- [ ] T3: rotas em `integracoes-router.ts` (`modelosPorFuncaoAnthropic`, `salvarModeloFuncaoAnthropic`), só admin por papel.
- [ ] T4: ligações — `server/maquete-3d/base.ts`, `server/dolores/whatsapp.ts`, `server/dolores/router.ts`.
- [ ] T5: telas — `AnthropicCard.tsx` (seção "Modelo por função") e `DoloresCard.tsx` (modelo em uso + atalho).
- [ ] T6: testes, `tsc`, `vite build`, conferência visual (computador e iPad).

## Dev Notes
(preenchido durante a implementação)

## File List
(preenchido durante a implementação)

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 16/11/2026 | @dev (Dex) | Story criada a partir do pedido do dono; Draft → InProgress (YOLO) |
