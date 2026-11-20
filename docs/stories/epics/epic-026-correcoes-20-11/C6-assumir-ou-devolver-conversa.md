# C6 — Botão "Assumir (humano)" / "Devolver para a Dolores" na conversa da Central WhatsApp

Status: InProgress (ramo `epic026-c6`; aguarda portão de QA de segurança).
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
- `docs/stories/epics/epic-026-correcoes-20-11/EPIC.md`

## Testes
Ver o relatório do @dev no fim desta etapa (preenchido ao concluir).
