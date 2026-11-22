# EPIC-027 C5 — Análise de regularização REURB pela Dolores

**Status:** InReview — implementado na branch `epic027-c5reurb` (base `epic027-c5int`) — aguardando portão de QA (@qa).
**Origem:** plano da Dolores aprovado pelo dono em 21–22/11/2026 (CLAUDE.md, "Decisões do dono em 21–22/11/2026", item 1:
"análise de regularização com roteiro de REURB").

## O que foi feito

Na conversa **direta do dono** no WhatsApp, a Dolores ganhou a consulta `analisar_regularizacao_reurb` (somente leitura):

1. O dono pede ("analise a REURB da Vila Esperança"); a Dolores acha o processo (`listar_processos_regularizacao`) e chama a
   análise com o id.
2. O **código** monta os dados do caso (os mesmos de `carregarProcessos`: tipo, situação, etapas com observações, documentos
   pendentes e recebidos, tarefas atrasadas, próxima providência, cartório) — **sem telefone e sem valores em dinheiro** — e junta
   o conhecimento destilado (`shared/dolores/reurb-conhecimento.ts`) e o formato do parecer.
3. O **modelo** redige o parecer curto: enquadramento provável (REURB-S/REURB-E), etapa do rito, documentos e peças que faltam,
   próximos passos e pontos para revisão do jurídico e do engenheiro.
4. O **aviso fixo** ("Rascunho para revisão: … depende da legislação municipal … conferência do jurídico e do engenheiro …") é
   posto **por código** no FIM da resposta sempre que houve parecer (`comAvisoReurb` em `cerebro.ts`): se o modelo o esqueceu ou o
   pôs em outro lugar, ele é tirado de onde estiver e recolocado no fim, uma vez só. No envio (`partesDaResposta`,
   `shared/dolores/whatsapp.ts`), ele é um fecho fixo do sistema (`FECHOS_FIXOS`): o espaço dele é reservado antes do corte e ele
   fecha a última mensagem, com 1, 2 ou 3 partes e com ou sem quadro — quem é cortado é o texto do modelo.

REURB é reconhecida **por código** só pelo cadastro: tipo do processo e nomes das etapas contendo "REURB" ou "regularização
fundiária". Observações (texto livre escrito por pessoas) não contam.
Processo inexistente ou de outro tipo (averbação, usucapião, desmembramento…) → `analisavel: false`, com a mensagem, sem
conhecimento e sem parecer.

## Escopo e segurança

| Onde | Comportamento |
|------|---------------|
| Conversa direta do dono (WhatsApp, `executarComando`) | oferecida (com e sem intenção de ação) e executa |
| Ponte HTTP (`/api/dolores/ponte`, `/api/dolores/ferramentas`) | fora da lista; chamada direta → 403 auditado |
| Grupos (inclusive administrativo/sócios) | fora: a função não está em `FUNCOES`, e `LEITURAS_INTERNAS` é montado de `FUNCOES` |
| Cliente atendido | fora (leituras próprias em `leitura/cliente-atendido.ts`) |
| `canal` WhatsApp sem `mensagemId` do dono | 403 |
| A própria leitura com canal ≠ `whatsapp` | devolve `analisavel: false` sem dado (segunda trava) |

- Somente leitura: roda na transação READ ONLY da porta; não grava nada nem põe item na fila (teste confere as contagens).
- Saída pelo filtro da porta: senhas, tokens, chaves e dados bancários **sempre** mascarados; dados pessoais conforme a opção B.
- `contamina: true` (nome do cliente e observações são texto do banco): ação pedida depois dela vai para a confirmação do dono.
- **Gasto:** o parecer é redigido no mesmo laço da conversa do dono → conta na função de gasto **"conversa"** (55%), já
  existente. Nenhuma linha nova de orçamento; nenhuma migração.

## Conhecimento (Artigo IV — No Invention)

Fonte única: a skill interna "A.68 — Agente REURB" e a Lei 13.465/2017 que ela cita. Texto próprio e enxuto: modalidades
(REURB-S/REURB-E, definidas pelo município), as 7 etapas do rito (requerimento → … → CRF → registro), peças técnicas, os 5 dados do
núcleo (o que faltar vira `[FALTA: …]`), cuidados (APP/risco, legitimação com marco temporal `[CONFERIR]`, nada de título antes da
CRF, nada de prazo/valor sem `[CONFERIR]`). Nenhum número além da lei; nenhum artigo, prazo, valor, percentual ou renda-limite
(teste `conhecimento: sem invenção`). Nenhum dado pessoal ou segredo da skill foi copiado (ela não tem).

## Arquivos

- `shared/dolores/reurb-conhecimento.ts` (novo) — conhecimento, formato do parecer, aviso fixo, `textoIndicaReurb`, `comAvisoReurb`.
- `server/dolores/leitura/reurb.ts` (novo) — `analisarRegularizacaoReurb` (somente leitura, reaproveita `carregarProcessos`).
- `server/dolores/funcoes.ts` — campo `soConversaDoDono`, lista `FUNCOES_DO_DONO`, `funcaoPorNome` procura nas duas, contaminação.
- `server/dolores/permissoes.ts` — `LIBERADAS_ETAPA_7_REURB` (etapa 7).
- `server/dolores/ponte.ts` — recusa fora da conversa do dono; `ferramentasDaConversaDoDono`; `ferramentasDoWhatsapp` a inclui.
- `server/dolores/cerebro.ts` — 4 linhas: ferramentas sem ação vêm de `ferramentasDaConversaDoDono`; aviso fixo por código.
- `shared/dolores/voz.ts` — rótulo "análise de REURB".
- `shared/dolores/whatsapp.ts` — `FECHOS_FIXOS`/`fechoFixo`: o aviso no fim nunca é cortado em `partesDaResposta`.
- `server/dolores/c5-reurb.test.ts` (novo) — 17 testes.
- `server/dolores/c5-reurb-qa.test.ts` (portão de QA, commit 1693d5d) — achados M1, B1 e B2 corrigidos; `it.fails` trocados por `it`.

## Testes

(a) Automáticos: `npx tsc --noEmit` sem erro; `server/dolores/c5-reurb.test.ts` 14/14; suíte da Dolores (`npx vitest run server/dolores shared/dolores --maxWorkers=2 --minWorkers=1`): 70 arquivos, 1.243 testes, todos passando (inclui os 14 novos; `c5-e1-qa-r4`, piso do prefixo, continua verde).
Correções do portão de QA (M1, B1, B2): `npx tsc --noEmit` sem erro; `npx vitest run server/dolores/c5-reurb.test.ts
server/dolores/c5-reurb-qa.test.ts server/dolores/c5-e1-qa-r4.test.ts shared/dolores --maxWorkers=2 --minWorkers=1`: 3 arquivos,
39 testes, todos passando; e, por mexer em `partesDaResposta`, `e8-qa-seguranca`, `e8-respostas-e-custo` e `whatsapp.test`: 3 arquivos,
79 testes, todos passando.
(b) Manuais: nenhum.
(c) Pendentes em produção: pedir à Dolores, pelo número do dono, a análise de um processo cadastrado como REURB e conferir o
parecer e o aviso.

## Pendências e riscos

- Hoje o tipo do processo é texto livre: processo de REURB cadastrado sem "REURB"/"regularização fundiária" no tipo
  ou nos nomes das etapas sai como "outro tipo". Correção: ajustar o tipo na tela de Regularizações (sem mudança de código).
- O prefixo fixo das chamadas cresceu ~1 ferramenta (descrição curta); o piso `RESERVA_MINIMA_ENTRADA` continua coberto pelo teste
  existente (`c5-e1-qa-r4`).
- Mensagem única com quadro do sistema: o aviso fica depois do quadro (fecha a mensagem); o quadro continua inteiro.
- Paridade: a Dolores é exceção registrada (fica fora do Grupo Santa Fé) — nada a portar.

## Change Log

- 22/11/2026 — @dev: implementação (a625525, 3f813a3) → InReview.
- 22/11/2026 — @qa: portão de QA (1693d5d) com 3 achados: M1 (aviso cortado no envio), B1 (aviso só por `includes`), B2 (REURB
  reconhecida por observação).
- 22/11/2026 — @dev: M1, B1 e B2 corrigidos; testes do portão trocados de `it.fails` para `it` → InReview (novo portão).
