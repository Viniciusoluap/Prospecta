# C6 — Texto do botão "Assumir (humano)"

Status: InReview (ramo `epic027-d`; implementada, aguarda QA).
Epic: EPIC-027 — Correções de 20/11/2026 (noite) (`EPIC.md`).
Paridade: a Central WhatsApp existe no Grupo Santa Fé — o botão "Assumir/Devolver" (EPIC-026 C6) já está como pendência no
ROADMAP; o texto novo vai junto quando for portado.
Migração: nenhuma.

## Problema
Em `client/src/components/whatsapp/ConversasWhatsApp.tsx`, com "Dolores atendendo", a frase abaixo do botão dizia "A Dolores fica
calada nesta conversa até alguém devolver. Nenhuma mensagem é enviada." — parece que ela JÁ está calada.

## Critérios de aceite
- [x] AC1: com "Dolores atendendo", a frase diz o efeito de TOCAR: "Toque em Assumir para a Dolores parar de responder nesta
      conversa até você devolver. Tocar não envia nada ao cliente."
- [x] AC2: "Equipe atendendo (assumida)": "A Dolores está parada nesta conversa. Toque em Devolver para ela voltar: responde só a
      próxima mensagem do cliente; as antigas sem resposta ficam com a equipe. Tocar não envia nada."
- [x] AC3: "Equipe atendendo" (silêncio automático depois de resposta da equipe): "A Dolores está parada porque a equipe
      respondeu; ela volta sozinha no horário indicado. Toque em Devolver para ela voltar antes: responde só a próxima mensagem
      do cliente. Tocar não envia nada."
- [x] AC4: os textos ficam em `shared/dolores/modo-conversa.ts` (`TEXTO_MODO`, `ajudaDoEstado`), uma frase por estado.

## Arquivos
- `shared/dolores/modo-conversa.ts`, `client/src/components/whatsapp/ConversasWhatsApp.tsx`

## Testes
- Só texto (sem regra nova). `npx tsc --noEmit` limpo; `server/dolores/c6-*.test.ts` continuam passando.

## Change Log
- 20/11/2026 — @dev (Dex): Draft → InProgress → InReview.
