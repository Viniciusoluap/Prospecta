# S-3 — Dolores no fluxo fiscal (conversa natural)

**Status:** Draft · **Epic:** EPIC-029 · **Etapa:** 3 · **Tamanho:** M · **Migração:** `0155_dolores_aviso_fiscal.sql`
**Depende de:** S-2 e da branch `epic027-c5int2` (avisos proativos, migração 0150) **na `main`**.

## Por quê
O dono quer decidir as notas pelo WhatsApp, **conversando** — "quero conversar com ela e que ela me responda como qualquer IA
normal" (correção dele em 22/11/2026). Não há comandos para decorar.

## Regra de conversa (decisão e, corrigida)
- **Sem palavras fixas.** VER / EMITIR / NÃO / DEPOIS **não** são comandos e não entram em `whatsapp.ts` como reconhecimento por
  código. O dono fala em linguagem natural ("me mostra essa nota", "essa não precisa, foi reembolso de cartório", "deixa pra
  depois", "corrige o valor para 1.200") e o **modelo escolhe** a leitura ou a ação.
- **Ver a prévia = leitura** (não muda nada).
- **Marcar "sem nota", "depois" ou editar = registro**: a Dolores propõe ("Marco a nota do João Silva, R$ 1.200, como sem nota
  — reembolso de custas/cartório. Pode?") e só grava com a resposta afirmativa natural reconhecida por código em
  `shared/dolores/confirmacao.ts` ("pode", "sim", "isso", "manda ver"…). Resposta negativa ("não", "deixa") descarta a proposta.
- **Emitir = ação séria**: exige "confirmo" (mesmo mecanismo, `nivelDoItem` → `serio`, validade 10 min). Até a S-5 a execução
  responde que a emissão ainda não está ativa e **nada sai**.
- Só na **conversa direta com o número do dono**. Em grupo, de cliente, de colaborador: as funções fiscais nem são oferecidas
  ao modelo (valores em dinheiro). Mensagem encaminhada continua bloqueada como hoje.
- Quem decide nível, permissão e o que é gravado é o **código** (função + argumentos guardados), nunca a IA. O motivo de "sem
  nota" é validado contra a lista fechada; texto livre só no motivo `outro`.

## Escopo
1. **Leituras só do dono** (`server/dolores/leitura/fiscal.ts`, registradas como as `LEITURAS_DO_DONO`):
   - `listar_notas_fiscais` (filtros: status, cliente, obra, período; padrão: a decidir e adiadas);
   - `ver_nota_fiscal` (detalhe + **envia o PDF da prévia** ao número do dono, com marca d'água).
2. **Ações** (`server/dolores/acoes/fiscal.ts`, padrão `preparar*`/`executar*Aprovado`):
   - `decidir_nota_fiscal` {notaId, decisao: `sem_nota`|`adiada`, motivo?, motivoTexto?, adiadaAte?} → **registro**;
   - `editar_rascunho_nota` {notaId, valorCentavos?, descricao?, tomadorDocumento?, municipioIbge?} → **registro** (decisão do
     dono). A proposta mostra o antes e o depois, por extenso, e a edição usa a `versao` lida;
   - `emitir_nota_fiscal` {notaId} → **sério**; até a S-5 a execução devolve "emissão ainda não ativa".
   - `nivelDoItem` (`shared/dolores/confirmacao.ts:70`) ganha os três casos (função desconhecida continua "sério").
   - Execução grava em `fiscal_notas_historico` (via `whatsapp`) e em `dolores_acoes`.
3. **Envio de PDF**: `enviarDocumentoEvolution` em `server/_core/evolution.ts` (`/message/sendMedia`, `mediatype: "document"`,
   nome do arquivo sem dado pessoal) [formato a confirmar na Evolution]; usado só para o número do dono.
4. **Aviso de rascunho** — tipo novo `nota_fiscal` em `shared/dolores/avisos.ts` / `server/dolores/avisos.ts`: achado = nota
   `A_DECIDIR` (ou `ADIADA` vencida). Texto fixo (ou pela IA dos avisos, se ligada), **sem lista de comandos**, terminando com
   pergunta natural, ex.: "Rascunho de nota: João Silva, R$ 1.200,00, regularização, Imperatriz. Quer que eu te mostre a prévia
   ou já sabe o que fazer com ela?". Respeita tudo dos avisos: só ao dono, 07h–20h, seg–sáb, até 6/dia, agrupado, silenciável.
5. **Resumo das 18h** — no tipo `nota_fiscal`, a rodada da rota `/api/cron/dolores-avisos/18` (21:00 UTC) agrupa todas as
   pendentes ("Você tem 4 notas a decidir, somando R$ 5.300,00: …"). **Sem cron novo.** Nos outros horários só o achado novo.
6. Migração 0155: alarga o CHECK de `dolores_avisos_tipos.tipo` com `'nota_fiscal'` (DROP/ADD CONSTRAINT com a lista antiga
   + o valor novo; nenhum dado muda).

**Fora:** emissão real (S-5); qualquer envio ao tomador; comandos fixos.

## Critérios de aceite
1. "me mostra a nota do João" na conversa do dono → o modelo chama `ver_nota_fiscal` e o dono recebe o PDF com marca d'água.
2. "essa não precisa, foi reembolso de cartório" → proposta de `sem_nota` com motivo "reembolso de custas/cartório"; "pode" →
   status `SEM_NOTA` + histórico (via whatsapp); "não" → nada muda.
3. "deixa pra depois" → proposta `adiada`; "isso" → `ADIADA`.
4. "emite essa" → proposta séria; "pode" **não** basta (pede "confirmo"); "confirmo" → resposta "emissão ainda não está ativa",
   status inalterado, nenhuma chamada de rede.
5. Motivo fora da lista proposto pela IA → recusado no preparo (teste com argumentos forjados).
6. Mesmo texto vindo de grupo, de cliente cadastrado ou encaminhado → nenhuma função fiscal oferecida/executada (testes de
   segurança no padrão `*-qa-seguranca.test.ts`).
7. Aviso `nota_fiscal` não contém "VER", "EMITIR", "responda" nem lista de opções; termina com "?" (teste de texto).
8. Resumo às 18h (relógio simulado 21:00 UTC) agrupa as pendentes num aviso só; às 10h só o achado novo; tipo silenciado → nada.
9. Valor e nome saem só ao número do dono; CPF/CNPJ do tomador seguem o interruptor `DOLORES_MASCARAR_DADOS_PESSOAIS`.
10. Portão de QA de segurança aprovado antes da `main` (regra da Dolores de 16/11).

## Dependências do dono
Nenhuma para construir; ligar o tipo de aviso "Notas fiscais" na tela é decisão dele.

## Riscos
R6 (avisos fora da `main`); custo da IA (as leituras usam a conversa já existente, sem ferramenta nova cara); "não precisa"
sozinho é negativa de proposta aberta — se não houver proposta, segue para o modelo (comportamento atual, coberto por teste).
