# C4 — Dolores não responde quando é marcada no grupo (defeito em produção)

Status: InReview (ramo `epic027-d`; implementada, aguarda o portão de QA de segurança).
Epic: EPIC-027 — Correções de 20/11/2026 (noite) (`EPIC.md`).
Paridade: a Dolores é exceção (exclusiva do Prospecta); nada a portar para o Grupo Santa Fé.
Migração: nenhuma para a C4 (a 0139 é da C3).

## Evidência (produção, 20/11, noite)
- `dolores_marcacoes`: 0 linhas desde que a função existe.
- `dolores_marcacoes_config`: `responder_ligado = true`, mas `lid_dolores`, `lid_do_numero` e `lid_conferido_em` NULOS.
- As mensagens do grupo chegam e são gravadas (`grupo-registrada` no contador de recebimento).
- O dono marcou "@Central Efficaz" três vezes num grupo de engenharia confirmado: nenhuma resposta, nenhum registro.
- `dolores_marcacoes_grupo` só tem linha para UM grupo (id 2).

## Causa raiz
1. **A menção vem por @lid e o @lid da conta nunca foi aprendido.** O WhatsApp novo marca por `"<lid>@lid"` na lista
   `contextInfo.mentionedJid`, não pelo número. Em `server/dolores/marcacao.ts:625-629` (versão da `main`), quando a menção não
   casa com o número, o código lê o @lid conferido; com o @lid nulo, `doloresFoiMarcada` devolve `mencao_de_outro` e a função
   devolve `null` — **sem gravar nada e sem contar em lugar nenhum**. Por isso a tabela ficou com 0 linhas.
2. **O @lid só era aprendido por ação do admin na tela** (`server/dolores/grupos-router.ts:55-75`, `conferirLid`, chamado só por
   `ligarMarcacaoGrupo` ao LIGAR o interruptor de um grupo e pelo botão "Conferir @lid"). Os grupos da etapa 7 já nascem com o
   interruptor ligado, então ninguém clica; e a única tentativa (grupo 2) não gravou — a conferência só olhava
   `/group/participants`, que em algumas versões da Evolution não traz o par @lid ↔ número (sem reserva).
3. **Interruptor do grupo sem linha = desligado** (`grupoLigado`, `marcacao.ts:79`): a etapa 7 (AC9) diz que o do grupo "nasce
   LIGADO para grupo avisado/confirmado", mas grupo confirmado sem linha (caminhos antigos, cadastro manual, aceite com tipo
   pendente depois definido por outro caminho) ficaria mudo mesmo com o @lid resolvido; e a tela mostrava "não responde".
4. (c) O tipo engenharia/internos passa pelo mesmo caminho de resposta (`escopoDoGrupo` → leituras internas) — não era a causa.
5. (d) A janela de frescor (120 s) não era a causa (o aviso chega em segundos), mas descartava em silêncio: agora conta no quadro.

## Critérios de aceite
- [x] AC1: a marcação é reconhecida pelo NÚMERO e pelo @lid da própria conta, só por código (lista de menções).
- [x] AC2: o @lid da conta é aprendido sozinho, só de fonte do SERVIDOR: (a) na marcação por @lid desconhecido, a Evolution é
      consultada (participantes do grupo e, de reserva, os dados do grupo `findGroupInfos`), no máximo uma vez a cada 10 min por
      grupo e só em grupo da lista, ativo e não recusado; (b) aviso de grupo da Evolution (`group-participants.update`) com o par
      @lid ↔ número da conta; (c) mensagem que a PRÓPRIA conta mandou no grupo (`key.fromMe`), com o número do aviso conferido.
      Nunca pelo texto, pela menção ou por campo que um terceiro controle; um @lid já conferido para o número não é trocado
      sozinho por mensagem própria nem por aviso.
- [x] AC3: sem saber o @lid, não responde e o motivo fica visível ("a menção veio por @lid e o @lid da Dolores ainda não foi
      conferido").
- [x] AC4: toda marcação (ou possível marcação) recebida deixa o desfecho num quadro sem texto nem telefone (mesmo contador
      do recebimento da C2 do EPIC-026, destino `marcacao`, fora da conta de "sem desfecho"): respondida, interruptor desligado,
      @lid desconhecido, conexão não confirmada, grupo fora da lista/recusado/aguardando, pausa, teto, IA bloqueada, atrasada,
      reentrega, erro. A tela "Responder no grupo quando marcada" mostra as últimas 24 h em português simples.
- [x] AC5: grupo da etapa 7 aceito e de tipo conhecido SEM linha no interruptor do grupo = ligado (AC9 da E7), no webhook, no
      envio e na tela; recusado, aguardando o dono, indefinido, desativado e grupo manual antigo (etapa 4b) sem linha continuam
      desligados. O interruptor geral continua valendo por cima; linha gravada (o admin/dono desligou) continua valendo.
- [x] AC6: tetos, interruptores, pausa, escopo por tipo e o envio único continuam iguais; nenhuma chamada nova à IA.

## O que o dono faz em produção
Nada obrigatório: na primeira marcação depois da publicação ela consulta a Evolution e aprende o @lid sozinha. Se o quadro
"O que aconteceu com as marcações" mostrar "@lid da Dolores ainda não foi conferido", o passo a passo vai no relatório da
publicação (tocar "Conferir @lid" no grupo, ou mandar uma mensagem qualquer no grupo pelo celular da empresa).

## Decisões
- [AUTO-DECISION] Grupo sem linha no interruptor → padrão da etapa 7 (ligado para aceito de tipo conhecido) em vez de "desligado"
  (reason: AC9 da E7 e regra do dono de 19/11 "não quero ter que cadastrar grupo por grupo"; o manual antigo da 4b mantém o
  desligado da época).
- [AUTO-DECISION] O quadro reaproveita `whatsapp_recebimento_contagem` (destino novo `marcacao`, sem migração) em vez de tabela
  nova (reason: já é sem conteúdo, por hora, com retenção de 7 dias).
- [AUTO-DECISION] Grupo fora da lista/desativado/recusado também passa por `tratarMarcacao` só para o quadro (sem marcação real
  nem consulta o banco; nada é gravado em `dolores_marcacoes` nem respondido).

## Testes
- `server/dolores/c4-marcacao-lid.test.ts` (10): aprende pela Evolution e responde num grupo de engenharia sem linha no interruptor;
  sem o par na Evolution → não responde, motivo no quadro, consulta com teto de 10 min; menção de outra pessoa não conta; conexão
  não confirmada; terceiro não ensina @lid (menção, texto, `participantAlt` de terceiro); mensagem própria e aviso de grupo
  ensinam; interruptor sem linha (recusado, manual antigo, aceito); regra pura `ligadoPorPadrao`.

## Arquivos
- `server/dolores/marcacao.ts` (aprendizado do @lid, quadro, interruptor por padrão)
- `shared/dolores/marcacao.ts` (`mencoesDoItem`, `lidDaPropriaMensagem`, rótulos do quadro)
- `shared/dolores/grupos-tipo.ts` (`ligadoPorPadrao`)
- `server/dolores/whatsapp.ts` (quadro por marcação; mensagem própria e aviso de grupo ensinam o @lid; grupo fora da lista no quadro)
- `server/dolores/grupos-router.ts` (conferência única; tela com o padrão e o quadro)
- `server/_core/evolution.ts` (prazo da consulta de participantes)
- `server/whatsapp-recebimento.ts` (destino `marcacao`, `desfechosDasMarcacoes`)
- `client/src/components/admin/DoloresGruposCard.tsx` (quadro e texto do @lid)
- `server/dolores/c4-marcacao-lid.test.ts`

## Change Log
- 20/11/2026 — @dev (Dex): Draft → InProgress → InReview. Implementada no ramo `epic027-d`.
