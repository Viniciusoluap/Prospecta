# S-3 — Dolores no fluxo fiscal (conversa natural)

**Status:** InReview (ramo `epic029-s3`, sobre `claude/epic029-s2-rascunhos`; aguarda o portão de QA de segurança) · **Epic:** EPIC-029 · **Etapa:** 3 · **Tamanho:** M · **Migração:** `0165_dolores_aviso_fiscal.sql` (o plano dizia 0155; 0155–0159 e 0162/0163 ficam com o fiscal das S-4/S-5)
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
6. Migração 0161 (era 0155 no plano): alarga o CHECK de `dolores_avisos_tipos.tipo` com `'nota_fiscal'` (DROP/ADD CONSTRAINT com a lista antiga
   + o valor novo; nenhum dado muda).

**Fora:** emissão real (S-5); qualquer envio ao tomador; comandos fixos.

## Critérios de aceite
- [x] 1. "me mostra a nota do João" na conversa do dono → o modelo chama `ver_nota_fiscal` (com `enviarPrevia`) e o dono recebe o PDF com marca d'água.
- [x] 2. "essa não precisa, foi reembolso de cartório" → proposta de `sem_nota` com motivo "reembolso de custas/cartório"; "pode" →
   status `SEM_NOTA` + histórico (via whatsapp); "não" → nada muda.
- [x] 3. "deixa pra depois" → proposta `adiada`; "isso" → `ADIADA`.
- [x] 4. "emite essa" → proposta séria; "pode" **não** basta (pede "confirmo"); "confirmo" → resposta "emissão ainda não está ativa",
   status inalterado, nenhuma chamada de rede.
- [x] 5. Motivo fora da lista proposto pela IA → recusado (zod, 400) e no preparo ("outro" sem texto ou com texto que não saiu das palavras do dono).
- [x] 6. Mesmo texto vindo de grupo, de cliente cadastrado, da ponte ou encaminhado → nenhuma função fiscal oferecida/executada.
- [x] 7. Aviso `nota_fiscal` não contém "VER", "EMITIR", "responda" nem lista de opções; termina com "?" (teste de texto, fixo e IA).
- [x] 8. Resumo às 18h (relógio simulado 21:00 UTC) agrupa as pendentes num aviso só; às 10h/11h só o achado novo; tipo silenciado → nada.
- [x] 9. Valor e nome saem só ao número do dono; CPF/CNPJ do tomador seguem o interruptor `DOLORES_MASCARAR_DADOS_PESSOAIS`.
- [ ] 10. Portão de QA de segurança aprovado antes da `main` (regra da Dolores de 16/11) — pendente (@qa).

## Dependências do dono
Nenhuma para construir; ligar o tipo de aviso "Notas fiscais" na tela é decisão dele.

## Riscos
R6 (avisos fora da `main`); custo da IA (as leituras usam a conversa já existente, sem ferramenta nova cara); "não precisa"
sozinho é negativa de proposta aberta — se não houver proposta, segue para o modelo (comportamento atual, coberto por teste).

---

## Implementação (dev — 22/11/2026)

### Decisões tomadas sem perguntar
- [AUTO-DECISION] Quando oferecer as ferramentas fiscais → só com o assunto fiscal aberto, por código (`shared/dolores/fiscal.ts#intencaoFiscal`:
  nota, NFS-e, fiscal, rascunho, prévia, emitir, tomador no trecho do dono) **ou** quando a conversa recente citou um rascunho (referência
  `nota_fiscal` vinda de consulta ou do aviso). Assim "essa não precisa…" logo depois do aviso funciona. Texto colado/anexo: nada fiscal.
  Motivo: o mesmo padrão das mesas; ~2 mil tokens a menos nas outras mensagens. Não é palavra-comando: só abre as ferramentas.
- [AUTO-DECISION] Ações fiscais abrem mesmo sem verbo de ação geral (só elas; as outras ações continuam exigindo a intenção de ação).
  Motivo: "deixa pra depois" não tem verbo de ação; tudo é de fila e nada grava sem o "pode"/"confirmo" do dono.
- [AUTO-DECISION] Prévia em PDF → **documento pela Evolution** (`/message/sendMedia`, `mediatype: "document"`, base64 no pedido — o mesmo
  endereço que a imagem já usa; sem serviço pago e sem link). A leitura só marca o pedido; `whatsapp.ts` gera o PDF (o mesmo da tela) e
  manda ao número do dono, conferido de novo, DEPOIS da resposta. Falhou → frase curta apontando a aba (nunca link público).
- [AUTO-DECISION] Emitir → proposta séria criada normalmente e, com o "confirmo", a execução recusa ("a emissão de nota fiscal ainda não
  está ativa…"); o resumo da proposta já avisa. Nenhuma rede, nenhuma gravação. Na S-5, trocar `executarEmitirAprovado`.
- [AUTO-DECISION] Execução só com a decisão vinda do WhatsApp do dono (`ctx.via === "whatsapp"`); pela tela da fila, recusa (a aba
  Contabilidade tem os próprios botões, com o papel admin). Histórico com `via = 'whatsapp'`, autor = usuária Dolores; quem decidiu fica
  em `dolores_aprovacoes`/`dolores_acoes`.
- [AUTO-DECISION] Edição não mexe em CPF/CNPJ do tomador (S-2: corrige-se no cadastro); município com nome + UF (a S-2 não tem IBGE).
  Texto livre (motivo "outro", descrição, município) só se saiu das palavras do dono (`veioDasPalavrasDoDono`, o mesmo da memória).
- [AUTO-DECISION] Aviso: tipo `nota_fiscal` **nasce silenciado** (sem linha = silenciado, `SILENCIADOS_POR_PADRAO`); o dono religa na tela
  (ou pela conversa). Os avisos em geral continuam desligados. Achado = `A_DECIDIR` ou `ADIADA` com a data já chegada; "depois" sem data
  fica quieto. Resumo: a partir das 18h (rota das 18h que já existe; sem cron novo) entra um achado "resumo do dia" que leva TODOS os
  pendentes num bloco "Você tem N notas a decidir, somando R$ X"; se a rodada das 18h não enviar, a das 19h envia.
- [AUTO-DECISION] Sem modelo novo por função: as leituras/ações fiscais usam a conversa (modelo "conversa") e o texto do aviso usa a
  IA dos avisos (já existente, opcional). Gasto nas partes "conversa" e "avisos" de sempre.
- [AUTO-DECISION] `RESERVA_MINIMA_ENTRADA` 19.000 → **21.000**: pior caso medido (todas as ferramentas, mesas + fiscais) = sistema 2.474 +
  ferramentas 16.869 + 500 = 19.843; folga 1.157. Sem fiscais e sem mesas: ≈ 16,2 mil. O texto do sistema NÃO mudou (a trava de 6.500
  caracteres do prompt já estava no limite; as orientações ficaram nas descrições das ferramentas).
- [AUTO-DECISION] `RESERVA_ENTRADA_AVISO` 3.000 → **4.000**: com o 9º tipo, o pior caso do aviso pela IA medido foi 3.205 tokens.

### IDS
| Peça | Decisão | Base |
|---|---|---|
| Leituras só do dono | REUSE | `LEITURAS_DO_DONO`/`soConversaDoDono` + recusa 403 da porta |
| Ações de fila | REUSE | `naFila` + `pendencia.ts` + `nivelDoItem`; serviço `server/fiscal/notas.ts` (naoEmitir/adiar/editar) |
| Gate por código | ADAPT | padrão de `intencaoDeMesa`/`abreMesa` |
| Envio de PDF | ADAPT | `enviarImagemEvolution` → `enviarDocumentoEvolution` |
| Aviso | ADAPT | `REGRAS` de `avisos.ts`, texto fixo de `shared/dolores/avisos.ts` |
| Prévia | REUSE | `gerarPreviaPdf` da S-2 |

### Arquivos
- Criados: `shared/dolores/fiscal.ts`, `server/dolores/leitura/fiscal.ts`, `server/dolores/acoes/fiscal.ts`, `drizzle/0165_dolores_aviso_fiscal.sql`,
  `server/dolores/s3-fiscal.test.ts`.
- Alterados: `server/dolores/funcoes.ts`, `server/dolores/permissoes.ts`, `server/dolores/acoes/registro.ts`, `server/dolores/acoes/comum.ts`,
  `server/dolores/acoes/avisos.ts`, `server/dolores/ponte.ts`, `server/dolores/cerebro.ts`, `server/dolores/whatsapp.ts`, `server/dolores/avisos.ts`,
  `server/dolores/memoria.ts`, `server/_core/evolution.ts`, `shared/dolores/avisos.ts`, `shared/dolores/confirmacao.ts`,
  `shared/dolores/voz.ts`, `drizzle/schema-dolores-conversa.ts` (tipo `nota_fiscal` da referência, só TypeScript); testes ajustados às listas
  novas: `acoes.test.ts`, `c5-e4-proatividade.test.ts`, `c5-e2-resolve.test.ts`, `c5-integracao2.test.ts`, `leitura-somente.test.ts` (exceção documentada para `../../fiscal/notas.js`).
- `server/fiscal/*` não foi alterado (só usado).

### Migração 0161 (aplicar no Neon ANTES de religar o tipo na tela; o código funciona sem ela — o tipo só fica silenciado)
```sql
BEGIN;
ALTER TABLE "dolores_avisos_tipos" DROP CONSTRAINT IF EXISTS "dolores_avisos_tipos_tipo_check";
ALTER TABLE "dolores_avisos_tipos" ADD CONSTRAINT "dolores_avisos_tipos_tipo_check"
  CHECK ("tipo" IN ('obra_atrasada', 'tarefa_vencida', 'documento_pendente', 'nota_obra', 'regularizacao_parada', 'grupo_aguardando', 'integracao', 'gasto', 'nota_fiscal'));
COMMIT;
```
Antes de aplicar, conferir o nome real da restrição: `SELECT conname FROM pg_constraint WHERE conrelid = 'dolores_avisos_tipos'::regclass AND contype = 'c';`
(se for outro nome, o DROP IF EXISTS não a remove e as duas conviveriam — a antiga recusaria 'nota_fiscal').

### Testes
- (a) Automáticos: `server/dolores/s3-fiscal.test.ts` — 29 testes (frases naturais variadas; VER/EMITIR não são comando; níveis; escopo:
  ponte/grupo/cliente/tela/encaminhada/colagem recusam; PDF ao dono; CPF segue o interruptor; "pode"/"não"/"isso"/"manda ver"; emitir
  com "confirmo" recusado; argumentos forjados; aviso com teto, silêncio, 10h × 18h, adiada vencida; reserva; 0161). Vigia de `fetch` e
  de `console` (sem CPF) em todos; auditoria sem CPF. Mais `server/fiscal` e os vizinhos da Dolores (ver relatório da entrega).
- (b) Manuais: não feitos (sem WhatsApp real).
- (c) Pendentes em produção: aplicar a 0161; conferir na conexão real que a Evolution entrega o PDF como documento.

### Como testar
1. Aplicar a 0161 (e a 0154 da S-2). 2. No WhatsApp do dono: "tem nota pra decidir?" → lista. 3. "me mostra a do João" → chega o PDF
"RASCUNHO — SEM VALOR FISCAL". 4. "essa não precisa, foi reembolso de cartório" → proposta → "pode" → aba Contabilidade mostra "Sem nota".
5. "emite a outra" → "pode" pede "confirmo"; "confirmo" → "a emissão ainda não está ativa". 6. Na tela de avisos, religar "rascunhos de nota fiscal".

## S-3b — pendências da revisão

Revisão independente do S-3 (já na `main`, #314). Quatro pendências leves, todas corrigidas no ramo `epic029-s3b`. Sem migração, sem
mudança de tela.

- [x] **1. Prévia depois da resposta, com a mensagem já marcada e leitura com teto.** `whatsapp.ts`: `atualizarMensagem(... "respondida")`
  passou para ANTES de `enviarPreviasFiscais` — se a função morrer gerando o PDF, `recuperarPedidosInterrompidos` (que só reivindica linha
  "processando") não manda "mande de novo" de um pedido já respondido. A leitura `carregarNota` roda com `tempoLimiteMs` derivado do que
  resta do prazo (`min(5 s, resta − 3 s)`, mínimo 1 s; o banco cancela a consulta) e, depois da leitura, o tempo é conferido de novo antes
  do envio do documento.
- [x] **2. Todo texto impresso no PDF pelo filtro de saída.** `notaParaPreviaDaDolores` deixou de ter lista de campos (ficava de fora
  `tomador.cidade`/`uf`, `emissor.cnpj`/`regime`/`municipioNome`, códigos do serviço, `origem.competencia`, `origemRotulo`…): agora TODO
  texto da nota, em qualquer nível, passa por `sanitizarTexto(…, filtroDaSaida("whatsapp"))`; só ficam intactos os campos fechados de
  `CAMPOS_ESTRUTURADOS_DA_PREVIA` (enums e datas usados como chave de rótulo). O CPF/CNPJ do tomador passa pelo filtro e por `campoPessoal`
  (opção B: completo; `DOLORES_MASCARAR_DADOS_PESSOAIS=1`: mascarado).
- [x] **3. Retomada da tarefa demorada não manda prévia nem a promete (opção mais segura).** `cerebro.ts`: com `somenteLeitura`, um
  `ver_nota_fiscal` com `enviarPrevia` não vira prévia — o resultado que o modelo lê perde `previaFiscal` e recebe `AVISO_PREVIA_NA_RETOMADA`
  ("não diga que está mandando"); o id volta em `previasRecusadas`, e `tarefa-demorada.ts` acrescenta ao fecho, por código, a frase fixa
  `FRASE_PREVIA_NA_RETOMADA` (peça a prévia de novo na conversa / tela). O único caminho do PDF continua o da conversa direta do dono.
- [x] **4. Prévia e frase de falha na memória da conversa.** Depois do envio, `dolores_conversa` recebe (papel `sistema`, origem `aviso`,
  função `whatsapp_previa_fiscal`) só `memoriaDaPrevia(ids)` — o número do rascunho, sem nome, CPF ou valor — com a referência
  `nota_fiscal`; se a `FRASE_PREVIA_NAO_FOI` chegou ao dono, ela também entra.

### Testes (S-3b)
- (a) Automáticos: `server/dolores/s3-fiscal-revisao.test.ts` — 7 testes: banco lento simulado (a leitura "leva" 60 s e é cancelada; a
  mensagem já estava "respondida" quando a leitura começou; `tempoLimiteMs` entre 1 s e 5 s e menor que o tempo restante; a entrada seguinte
  não manda "mande de novo"); ordem no código; teste que percorre os campos impressos (cada texto da nota vira um marcador de segredo: o PDF
  cru mostra os 20 campos impressos, inclusive `tomador.cidade`; o PDF da Dolores, nenhum); campos fechados intactos e CPF pelo interruptor;
  retomada com `enviarPrevia` (sem documento, aviso ao modelo, frase fixa na resposta); memória da prévia e da frase de falha (sem CPF).
  Rodados também `s3-fiscal*`, `c5-tarefa-demorada*`, `c5-integracao2*`, `ponte*`, `leitura-somente`: 9 arquivos, 185 testes, todos passam.
  `npx tsc --noEmit` e `npx vite build` sem erro.
- (b) Manuais: não feitos (sem WhatsApp real).
- (c) Pendentes em produção: nenhuma nova (sem migração).

### Arquivos (S-3b)
- `server/dolores/whatsapp.ts` (ordem da marcação, teto da leitura, filtro total do PDF, memória da prévia)
- `server/dolores/cerebro.ts` (`AVISO_PREVIA_NA_RETOMADA`, `FRASE_PREVIA_NA_RETOMADA`, `previasRecusadas`)
- `server/dolores/tarefa-demorada.ts` (frase fixa no fecho da retomada)
- `server/dolores/s3-fiscal-revisao.test.ts` (novo)

## Change Log
- 22/11/2026 — @dev (Dex): Draft → InReview. Implementação completa no ramo `epic029-s3` (merge de `cf12927` da S-2); migração 0161 NÃO aplicada.
- 22/11/2026 — @qa (Quinn): portão CONCERNS (`server/dolores/s3-fiscal-qa.test.ts`): M1 (PDF da Dolores sem o filtro de segredos), B1 (trava de
  palavra-comando só em maiúsculas), B2 (sem teto de bytes do PDF).
- 22/11/2026 — @dev (Dex): M1 — `whatsapp.ts#notaParaPreviaDaDolores` passa descrição, centro de custo, tomador, obra, serviço, emissor e motivo
  por `sanitizarTexto(…, filtroDaSaida("whatsapp"))` antes do PDF (a tela não muda); B1 — `temPalavraComando` pega também diga/dizer/fale/
  mande/manda e palavra de comando entre aspas em qualquer caixa (a frase fixa de silenciar é ignorada); B2 — `MAX_BYTES_PREVIA` (1 MB)
  conferido antes do envio, com a frase de falha. Os 2 `it.fails` viraram `it`. Merge de `origin/main`. **Atenção: a `main` já tem
  `drizzle/0161_juridico_validacao_assinaturas.sql` — dois arquivos 0161 convivem; decidir com o coordenador se a desta story é renumerada.**
- 22/11/2026 — @dev (Dex): S-3b — 4 pendências leves da revisão independente corrigidas (seção "S-3b — pendências da revisão").
