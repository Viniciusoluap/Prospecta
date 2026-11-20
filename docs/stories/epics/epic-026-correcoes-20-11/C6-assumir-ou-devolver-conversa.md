# C6 — Botão "Assumir (humano)" / "Devolver para a Dolores" na conversa da Central WhatsApp

Status: InReview (ramo `epic026-c6`; aguarda portão de QA de segurança).
Epic: EPIC-026 — Correções de 20/11/2026 (`EPIC.md`).
Paridade: a Dolores é exceção (exclusiva do Prospecta); nada a portar para o Grupo Santa Fé.
Migração: `drizzle/0138_atendimento_modo_conversa.sql` (aditiva; NÃO aplicada — aplicar no Neon na publicação).

## Pedido do dono (20/11/2026, palavras dele)
"Faça um botão nas mensagens lá no WhatsApp para que coloque para assumir o humano ou devolver pra Dolores e assim nós
podemos fazer isso manualmente quando necessário."

## Problema (produção, 20/11)
Uma cliente cadastrada perguntou da obra e a Dolores não respondeu porque alguém da equipe tinha respondido 2 min antes:
`dolores_atendimentos` gravou `situacao = 'silencio'`, motivo "a equipe respondeu nesta conversa: Dolores calada por algumas
horas" (`whatsapp_atendimento_config.silencio_horas` = 6). Não havia como encerrar esse silêncio antes do prazo, nem como
calar a Dolores de propósito sem mandar mensagem.

Como o silêncio é calculado hoje: toda mensagem da EQUIPE pelo número da empresa (resposta pela Central, "Enviar
mensagem"/Templates e o que sai pelo celular — `tratarPropria`, eco não automático) chama `silenciarConversa`, que grava em
`whatsapp_silencio` (chave = resumo HMAC do número) `ate = envio + silencio_horas` (nunca encurta). `conversaEmSilencio` diz
se `ate > agora`; `tratarAtendimento` confere antes de responder e de novo na hora de enviar.

## Critérios de aceite
- [x] AC1: na conversa aberta da Central (conexão da EMPRESA: admin e colaborador), um indicador de quem está atendendo:
      "Dolores atendendo", "Equipe atendendo (assumida por <nome> em <data>)" ou "Equipe atendendo até <data hora>" (o
      silêncio automático depois de resposta da equipe).
- [x] AC2: "Dolores atendendo" → botão **Assumir (humano)**: a Dolores fica calada nesta conversa até alguém devolver, sem
      prazo e sem mandar mensagem.
- [x] AC3: "Equipe atendendo" (assumida OU silêncio automático) → botão **Devolver para a Dolores**: encerra o silêncio na
      hora; a próxima mensagem do cliente já pode ser respondida por ela. A tela diz, em uma frase curta, que ela não
      responde mensagens antigas.
- [x] AC4: depois de "Devolver", uma nova resposta manual da equipe volta a calar pelo prazo normal (regra existente);
      um eco atrasado de mensagem da equipe ANTERIOR ao "Devolver" não cala de novo. Depois de "Assumir", responder
      manualmente não muda nada (continua assumida até devolver).
- [x] AC5: o botão só aparece quando a conversa é de cliente que a Dolores atenderia (número que o servidor identifica como
      UM cliente do CRM e "Dolores responde clientes cadastrados" ligado). Nos outros casos, uma frase curta diz por que a
      Dolores não responde aqui (sem botão). Conexão própria de corretor: nada aparece.
- [x] AC6: persistência por conversa (instância + resumo HMAC do número), com quem mudou e quando (tabela
      `whatsapp_atendimento_modo`, migração aditiva 0138 + schema Drizzle). Nenhum número completo gravado.
- [x] AC7: permissão no SERVIDOR: admin e colaborador com o módulo WhatsApp; corretor → FORBIDDEN. A rota recusa a conversa
      do dono, a do próprio número da empresa, grupo e conversa de número não identificado ("@lid"), e só age sobre conversa
      que existe na Central da empresa.
- [x] AC8: segurança: o botão nunca chama a IA nem envia mensagem; não amplia o escopo da Dolores; tetos, pausa geral e
      interruptor continuam valendo; com o atendimento a cliente desligado a rota recusa e nada é ligado. Cada ação fica na
      auditoria (`dolores_acoes`, função `atendimento_conversa`: quem, quando, id da conversa e do lead — sem telefone).
- [x] AC9: testes vitest (abaixo); `npx tsc --noEmit` passa.

## Decisões
- [AUTO-DECISION] Onde guardar "assumida"? → tabela nova `whatsapp_atendimento_modo` (uma linha por instância + chave do
  número; `modo` = `humano` | `dolores`), separada de `whatsapp_silencio`. Motivo: o silêncio automático tem prazo e "nunca
  encurta"; a assunção não tem prazo e precisa de autor. Misturar mudaria a regra existente.
- [AUTO-DECISION] Precedência → assumida > silêncio automático > Dolores. "Devolver" grava `modo = dolores` com a hora e
  encerra o silêncio automático (`ate = agora`); um silêncio novo só vale para mensagem da equipe enviada DEPOIS do
  "Devolver" (o eco atrasado de mensagem anterior não recala).
- [AUTO-DECISION] Instância diferente da atual (troca da conexão) → a leitura do roteamento usa a instância conectada; quem
  chama sem instância (só testes antigos) considera qualquer instância (falha fechada: calada).
- [AUTO-DECISION] Falha ao ler o modo → calada (falha fechada, igual ao silêncio). Exceção: tabela ainda inexistente (migração
  0138 não aplicada, erro 42P01) → sem assunção (o resto continua como hoje), para a publicação antes da migração não calar
  todas as conversas.
- [AUTO-DECISION] Fora dos casos elegíveis: sem botão, com frase curta (mais claro do que botão desabilitado). A rota também
  recusa (BAD_REQUEST) — a tela não é a única barreira.
- [AUTO-DECISION] Atendimento a cliente desligado → a rota recusa "Assumir" e "Devolver" (nada é ligado). O estado gravado
  continua valendo quando o admin religar.

## Tarefas
- [x] Migração `drizzle/0138_atendimento_modo_conversa.sql` + `whatsappAtendimentoModo` em `drizzle/schema-whatsapp-atendimento.ts`.
- [x] Regra pura `estadoDoAtendimento` e textos em `shared/dolores/modo-conversa.ts`.
- [x] Servidor: `situacaoDoSilencio` / `conversaEmSilencio` com a assunção; `silenciarConversa` respeita o "Devolver";
      `tratarAtendimento` grava o motivo próprio ("a equipe assumiu esta conversa").
- [x] Servidor: `server/dolores/modo-conversa.ts` (ler, assumir, devolver) e rotas `whatsapp.atendimentoDaConversa` /
      `whatsapp.mudarAtendimentoDaConversa`.
- [x] Tela: indicador e botão em `client/src/components/whatsapp/ConversasWhatsApp.tsx`.
- [x] Testes `server/dolores/c6-assumir-devolver.test.ts`; migração carregada em `server/dolores/testes-banco.ts`.

## Arquivos (File List)
- `drizzle/0138_atendimento_modo_conversa.sql` (novo)
- `drizzle/schema-whatsapp-atendimento.ts`
- `shared/dolores/modo-conversa.ts` (novo)
- `server/dolores/modo-conversa.ts` (novo)
- `server/dolores/roteamento.ts`
- `server/dolores/atendimento.ts`
- `server/whatsapp-router.ts`
- `client/src/components/whatsapp/ConversasWhatsApp.tsx`
- `server/dolores/testes-banco.ts`
- `server/dolores/c6-assumir-devolver.test.ts` (novo)
- `server/dolores/c6-qa-seguranca.test.ts` (novo, do @qa; asserções de M1/B2 invertidas)
- `docs/stories/epics/epic-026-correcoes-20-11/EPIC.md`

## Testes
(a) Automáticos (20/11):
- `server/dolores/c6-assumir-devolver.test.ts` — 15 testes, todos passam: precedência pura; migração 0138 aditiva e idempotente;
  assumir (calada sem prazo, resposta manual da equipe não muda, nenhum envio e nenhuma chamada à IA pelo botão, motivo próprio
  em `dolores_atendimentos`); devolver (próxima mensagem respondida, antigas não; silêncio automático encerrado na hora; eco
  atrasado não recala; resposta nova da equipe recala pelo prazo normal; assunção presa à instância; pausa geral continua
  valendo); recusas (atendimento desligado não liga nada; não cliente; conversa inexistente; dono, empresa, grupo, "@lid");
  permissões pelo `appRouter` (admin e colaborador com o módulo sim; corretor, colaborador sem o módulo e inativo não; entrada
  estrita); auditoria sem telefone.
- Regressão: `npx vitest run server/dolores --maxWorkers=2 --minWorkers=1` → 51 arquivos, 875 testes passam;
  `server/whatsapp-*` → 6 arquivos, 52 testes passam. `npx tsc --noEmit` passa.
(b) Manuais: nenhum (sem ambiente com WhatsApp conectado nesta sessão).
(c) Pendentes de validação em produção: aplicar a 0138 no Neon; na Central, abrir a conversa de um cliente cadastrado com o
atendimento ligado, "Assumir (humano)", mandar uma mensagem do celular do cliente (a Dolores não responde; registro
"a equipe assumiu esta conversa"), "Devolver para a Dolores" e mandar outra (ela responde).

## Correções do portão de QA de segurança (QA-SEG C6, 20/11 — CONCERNS, sem achado importante)
- [x] M1: resposta da equipe pelo celular no mesmo segundo do "Devolver" não recalava (eco em segundos × "Devolver" em ms).
      Agora a comparação tem folga de 5 s a favor do silêncio (`FOLGA_DEVOLVER_MS`, `silencioValeDepoisDeDevolver`); pior
      caso: um eco de até 5 s antes recala (seguro).
- [x] M2: a conferência "a conversa existe na Central" lia todos os destinatários da conexão a cada 10 s. Agora filtra no banco
      pelos 8 dígitos finais (`connection_id` usa `whatsapp_messages_conversa_idx`), com DISTINCT e LIMIT 20, e confere o número
      exato em memória (LIMIT 20 em vez de 1 para não perder a conversa quando outro DDD tem os mesmos 8 finais). A tela consulta
      a cada 30 s e refaz a consulta logo depois do clique.
- [x] B1: corrida "Devolver" × resposta pela Central: o "Devolver" só encerra o silêncio gravado até aquele instante
      (fim <= agora + prazo); o de uma resposta que entrou depois fica. Mesmo relógio do roteamento, nunca o now() do banco.
- [x] B2: a mutação dá a MESMA recusa (BAD_REQUEST, `MENSAGEM_SEM_CONVERSA`) para a conversa do dono, a da empresa e a que não
      existe (sem oráculo). A consulta já respondia `{ mostrar: false }` igual para todas.
- [x] B3: "humano" vale para QUALQUER instância (na dúvida, calada); "Devolver" devolve a conversa em todas as instâncias.
- [x] B4 (registrado, sem mudança de código): quem usa o botão entra na auditoria `dolores_acoes` (`autor_user_id`, FK RESTRICT da
      0123, tabela só de inserção). Depois disso o usuário não pode mais ser EXCLUÍDO do banco, só desativado. É o mesmo efeito
      que já existe para quem configura o atendimento ou as campanhas. Se o dono quiser apagar usuários, isso precisa de decisão
      própria (não mexemos na guarda da auditoria).
- Provas: `server/dolores/c6-qa-seguranca.test.ts` (asserções que confirmavam M1 e B2 invertidas) e os testes novos B1/B3 em
  `server/dolores/c6-assumir-devolver.test.ts`.

## Change Log
- 20/11/2026 — @dev (Dex): Ready → InProgress → InReview. Implementação completa; aguarda @qa (portão de segurança).
- 20/11/2026 — @dev (Dex): correções do QA-SEG C6 (M1, M2, B1, B2, B3; B4 registrado). Volta para o @qa.
