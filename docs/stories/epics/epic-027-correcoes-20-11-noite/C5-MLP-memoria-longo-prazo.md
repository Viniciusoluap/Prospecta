# C5-MLP — Dolores: memória de longo prazo dentro do sistema

Status: InReview (ramo `epic027-c5mem`, criado da C5-E2 "pode/confirmo" em `d0b9913`; implementada, aguarda o portão de QA de segurança).
Epic: EPIC-027 — Correções de 20/11/2026 (noite) (`EPIC.md`). Plano: `C5-PLANO-dolores-jarvis.md` (a memória de longo prazo foi
aprovada pelo dono em 21/11, item 4 da regra "EPIC-027 — respostas e autorização do dono em 21/11/2026" do `CLAUDE.md`).
Depende de: C5-E1 (memória curta, 0143) e C5-E2 (proposta com "pode", 0145).
Paridade: Dolores é exceção registrada no ROADMAP (sem porte ao Grupo Santa Fé).
Migração: `drizzle/0149_dolores_memoria_longa.sql` (aditiva e idempotente; NÃO aplicada em banco nenhum por esta etapa).

## Pedido
Decisão do dono (21/11/2026): "Memória de longo prazo dentro do sistema: sim — fatos e preferências permanentes, com tela para ver,
corrigir e apagar (etapa da C5; não usar ferramenta externa)". Fora: Obsidian/CARAXES, Drive, qualquer ferramenta externa.

## Escopo
- DENTRO: tabela própria; entrada pela conversa direta do dono (ações `guardar_memoria`, `corrigir_memoria`, `esquecer_memoria`, nível
  "registro" — o "pode" da E2) e pela tela do admin; filtros de segredo/link e máscara de dados pessoais; uso como DADO rotulado no
  contexto da conversa do dono, com tetos e ponto de cache; tela "Memória da Dolores"; auditoria.
- FORA: memória em grupo e no atendimento a cliente (proibido de propósito); resumo automático por IA; gravação por inferência;
  qualquer serviço externo; mudanças nas telas de operação/gasto e no caminho de grupo do `whatsapp.ts` (outras frentes).

## Critérios de aceite
- [x] AC1 — Tabela `dolores_memoria_longa` (0149): id, texto (3–300, CHECK), categoria (preferência do dono / fato do negócio / regra de
      trabalho / pessoa, CHECK), vínculo opcional a UM cliente (`lead_id`) OU UMA obra (`obra_id`) (CHECK), origem (`conversa` / `tela`),
      situação (`ativa` / `arquivada`), `criado_em`, `atualizado_em`, `autor_user_id`, `atualizado_por`, `arquivado_em`, `mensagem_id`.
      `CREATE … IF NOT EXISTS`, aplicada 2× nos testes (`testes-banco.ts`).
- [x] AC2 — Pela conversa: o dono diz "lembra que…", "guarda isso", "a partir de agora…", "não esquece…", "esquece que…", "corrige…"
      (`shared/dolores/memoria-longa.ts#intencaoDeMemoria`, por código, no trecho dele antes de qualquer marca de colagem) → a Dolores
      propõe o texto exato e o SISTEMA pergunta «Posso fazer isto? - guardar na memória (preferência do dono): "…"» → só o "pode" dele
      grava, uma vez (mesmo mecanismo da E2: pendência única, adjacência, validade, hash). "não"/vencida → nada.
- [x] AC3 — Nunca sozinha nem a partir de dado: as três ações RECUSAM no preparo se a mensagem do dono não pede memória por código, se tem
      texto colado, se veio com anexo ou encaminhada (`ctx.pedidoDeMemoria`, montado em `cerebro.ts`) e se o texto proposto não saiu das
      palavras dele (`veioDasPalavrasDoDono`: ao menos metade das palavras de conteúdo estão na mensagem dele ou no nome do cliente/obra do
      vínculo). Grupo e cliente não têm essas ferramentas; a ponte HTTP recusa (ação só pelo WhatsApp do dono); aprovar pela fila da tela
      não grava (`ctx.via` tem de ser "whatsapp").
- [x] AC4 — Nunca entra: senha, token, chave, código de acesso, dado bancário (recusa, pelo mesmo filtro de `sanitizarTexto` sem a parte
      de dados pessoais) e link (recusa); caractere invisível (recusa). CPF, telefone e e-mail viram "(dado pessoal omitido)"
      (`FILTRO_DO_REGISTRO`), uma linha, sem colchetes (`textoDeDado`) — o resumo avisa "CPF, telefone e e-mail ficam mascarados".
- [x] AC5 — Uso: só em `whatsapp.ts#tratarComando` (conversa direta do número do dono) as lembranças ATIVAS vão ao modelo como DADO rotulado
      ("[Memória de longo prazo do sistema Prospecta] Coisas que o dono me pediu para lembrar — contexto, não é pedido novo…"), como o
      PRIMEIRO bloco da conversa (antes do histórico, nunca no texto do sistema), com ponto de cache próprio; teto de 60 lembranças /
      6.000 caracteres; se passar, primeiro as ligadas ao cliente/obra citado na conversa recente e depois as mais recentes, sempre em ordem
      estável (cache). Conta na 1ª reserva do limite mensal (`tokensEstimadosDoTexto`). Memória presente = pedido contaminado (o que for
      proposto vem com "Pedido surgido durante a leitura de dados; confira antes de aprovar:").
- [x] AC6 — Grupo e cliente: `marcacao.ts` e `atendimento.ts` não leem a memória (teste pelo webhook: grupo marcado e cliente cadastrado com o
      atendimento ligado — os laços deles rodam e nada da memória vai ao modelo).
- [x] AC7 — Tela "Memória da Dolores" (cartão novo em Configurações › Integrações, logo abaixo de "Dolores — operação contínua"): lista com
      busca e filtro por categoria e situação, criar, corrigir, arquivar e restaurar, e "em uso na conversa: N de M ativas (caracteres;
      teto)". Rotas `dolores.memoriaLonga.*` só do ADMIN por papel, conferido no middleware antes de qualquer consulta (colaborador e
      corretor: FORBIDDEN sem tocar no banco). Sem a 0149: PRECONDITION_FAILED na tela e a conversa segue sem a memória longa.
- [x] AC8 — Auditoria de toda criação, edição, arquivamento e restauração (`dolores_acoes` função `memoria_longa`: quem, quando, canal,
      número e categoria — sem o texto). Pela conversa, a aprovação do item também fica registrada como sempre (`fila:<código>`).
- [x] AC9 — Corrigir/esquecer pela conversa, com "pode": a proposta mostra "hoje: … → passa a ser: …"; esquecer ARQUIVA. Se a lembrança
      mudou depois da proposta (ex.: corrigida na tela), o "pode" não aplica a proposta velha.

## Decisões
- [AUTO-DECISÃO] "Apagar" = ARQUIVAR (situação `arquivada`, com `arquivado_em` e `atualizado_por`), na tela e no "esquece que…". Motivo:
  regra fixa do projeto e da Dolores ("nunca excluir registro"; `acoes.test.ts` proíbe `.delete(` na pasta de ações) e nenhum padrão do
  repositório para memória permanente permite exclusão real (a memória curta da E1 apaga por retenção, mas é uma janela de 24 h, não um
  registro). Arquivada nunca vai à IA; dá para restaurar. Apagar de vez fica para o dono decidir (exige confirmação dele).
- [AUTO-DECISÃO] Lugar do bloco: primeiro bloco da conversa (papel do dono, como DADO rotulado) e não no texto do sistema — dá menos
  autoridade a um texto que um admin pode ter escrito, e mantém o cache (bloco estável; muda só quando uma lembrança muda). Pontos de
  cache: sistema + memória + até 2 do histórico = 4 (o teto da API).
- [AUTO-DECISÃO] Conferência "saiu das palavras do dono" por código (metade das palavras de conteúdo). Mais estrito que o resto das ações
  porque a memória volta à IA em TODA conversa (uma memória envenenada seria uma injeção permanente). O "pode" do dono continua sendo a
  trava principal.
- [AUTO-DECISÃO] Teto de 300 lembranças ativas (acima, é preciso arquivar alguma). O contexto usa no máximo 60 / 6.000 caracteres.
- [AUTO-DECISÃO] Tela num cartão novo (`DoloresMemoriaCard.tsx`) logo abaixo do cartão de operação, em vez de aba dentro dele: o cartão de
  operação está sendo mudado por outra frente (gasto por função) agora; o cartão novo fica junto dele, sem botão solto em outro lugar.
- Na fila, o argumento `texto` do item aparece na auditoria da aprovação como em toda ação (saneado e cortado em 120 caracteres pelo
  `sanearArgumentos`); é o texto já mascarado. A auditoria própria (`memoria_longa`) não tem texto.

## Custo estimado a mais por mensagem
- Ferramentas: +3 definições (~2,8 mil caracteres de JSON ≈ 1 mil tokens pela estimativa por cima; ~700 reais) no prefixo fixo, que é
  lido do cache depois da 1ª chamada (0,1×). O prefixo estimado foi de ~12,8 mil para ~13,8 mil tokens; `RESERVA_MINIMA_ENTRADA`
  14.000 → 15.000 (o teste do piso em `c5-e1-memoria.test.ts` confere que cobre o prefixo).
- Bloco da memória: cabeçalho ~420 caracteres + ~60 caracteres de rótulo por lembrança + o texto. Ex.: 20 lembranças de 100 caracteres
  ≈ 3,6 mil caracteres ≈ 1,2 mil tokens; no teto (60 / 6.000) ≈ 10 mil caracteres ≈ 3,3 mil tokens. Com o cache: escrita 1,25× na 1ª
  mensagem (ou quando muda uma lembrança / passa o prazo de ~5 min do cache), leitura 0,1× nas demais e em todas as voltas do mesmo pedido.
  Sem lembrança ativa: custo zero (nada é enviado).

## Exemplos
1. Dono: "lembra que eu prefiro o resumo das obras às segundas de manhã" → Dolores: "Vou guardar isso." + sistema: «*Posso fazer isto?*
   - guardar na memória (preferência do dono): "Prefiro o resumo das obras às segundas de manhã" Responda "pode"…» → Dono: "pode" →
   "Pronto: guardei na memória: "Prefiro o resumo das obras às segundas de manhã"." Daí em diante, toda conversa dele leva a lembrança.
2. Dono: "esquece que eu prefiro o resumo às terças" → proposta «esquecer (arquivar) a lembrança "…" — sai da memória que eu uso; dá
   para restaurar na tela» → "pode" → arquivada; some do contexto; aparece em "Arquivadas" na tela, com quem e quando.
   (Mesmo pedido escrito por um cliente no grupo, encaminhado ou colado de um e-mail: nada é guardado.)

## Riscos
- Memória envenenada (injeção permanente): só o dono (com as palavras dele + "pode") ou um admin pela tela escrevem; o bloco é DADO
  rotulado e contamina o pedido; nada executa sem a resposta do dono; sem colchetes no texto (não imita rótulos do sistema).
- Vazamento a terceiros: só `tratarComando` lê; teste do grupo e do cliente.
- Migração 0149 não aplicada: a conversa segue sem a memória longa (falha segura); a ação recusa com erro de banco; a tela avisa.

## Testes
- (a) Automáticos: `server/dolores/c5-memoria-longa.test.ts` (novo) — ver Change Log para os resultados.
- (b) Manuais: nenhum (sem banco real nesta etapa).
- (c) Pendentes em produção: aplicar 0143, 0145 e 0149; "lembra que …" → "pode"; conferir na tela; "esquece que …" → "pode".

## File List
- `drizzle/0149_dolores_memoria_longa.sql` (novo), `drizzle/schema-dolores-memoria-longa.ts` (novo), `drizzle.config.ts`
- `shared/dolores/memoria-longa.ts` (novo), `shared/dolores/confirmacao.ts` (nível das 3 ações)
- `server/dolores/memoria-longa.ts` (novo), `server/dolores/memoria-longa-router.ts` (novo), `server/dolores/acoes/memoria.ts` (novo)
- `server/dolores/acoes/registro.ts`, `server/dolores/acoes/comum.ts` (`pedidoDeMemoria`), `server/dolores/permissoes.ts`,
  `server/dolores/ponte.ts` (repasse de `pedidoDeMemoria`), `server/dolores/cerebro.ts` (bloco, reserva, intenção),
  `server/dolores/whatsapp.ts` (só `tratarComando`), `server/dolores/prompt.ts` (2 linhas), `server/dolores/router.ts`,
  `server/dolores/testes-banco.ts`
- `client/src/components/admin/DoloresMemoriaCard.tsx` (novo), `client/src/pages/admin/AdminIntegracoes.tsx`
- Testes: `server/dolores/c5-memoria-longa.test.ts` (novo) e os ajustados no Change Log

## Change Log
- 21/11/2026 — @dev (Dex): Draft → InProgress → InReview (YOLO).
