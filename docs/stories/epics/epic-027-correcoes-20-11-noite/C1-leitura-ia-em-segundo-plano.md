# C1 — Maquete 3D: leitura pela IA em segundo plano (sem estourar o tempo, sem gastar à toa, com andamento na tela)

Status: InReview (implementado pelo @dev; aguarda o portão de QA)
Epic: EPIC-027 (correção C1). Defeito de produção relatado pelo dono em 20/11/2026 (noite).
Ramo: `epic027-m` (da `main`, `b60147c`). Sem push (o coordenador cuida).
Migração: **nenhuma** — o estado do lote cabe no JSON de passos que já existe (`maquetes_3d.leitura` e `maquetes_3d.importacao`).
Paridade: Maquete 3D é exceção de paridade (registrada no ROADMAP) — não há porte para o Grupo Santa Fé.

## Relato do dono
Modelo escolhido para a leitura: o melhor (`claude-fable-5-2`). O passo "Leitura pela IA — <arquivo A0>.pdf" falhou duas vezes
com "A leitura deste passo passou do tempo limite. Esta tentativa conta como usada…"; cada tentativa gastou a confirmação
("já usou 1 de 8") sem resultado; durante o processamento a tela só mostrava "Lendo… mantenha esta página aberta".
Palavras dele: "acabei consumindo meus créditos à toa" e "deveria pelo menos ficar alguma animação rodando com a porcentagem,
alguma coisa que a gente veja que o processo está andando".

## Causa (conferida no código)
- `passoPranchaIA` fazia UMA chamada `messages.create` sem streaming, com `timeout` ≤ 52 s e `maxRetries: 0`, dentro da função
  da Vercel (`maxDuration: 60`). Modelo grande + esforço alto + prancha A0 passa de 52 s: o SDK cortava a conexão.
- PDF vetorial ia como `pdf_original`: o arquivo INTEIRO a cada prancha, com "leia SOMENTE a página N" (mais tokens, mais tempo).
- `reservarChamada` soma +1 na confirmação e no contador ANTES da chamada; tempo esgotado não devolvia (a resposta podia ter sido
  gerada e cobrada); os tokens da tentativa que falhou não eram registrados.
- A tela chamava um passo por requisição e só mostrava "Lendo…".

## Critérios de aceite
1. [x] **Leitura em segundo plano pela Message Batches API**: o passo `prancha_ia` envia um lote de UMA requisição e volta em
   poucos segundos, gravando o id do lote e a situação; cada "avançar" seguinte só consulta o lote (chamada curta) até terminar;
   ao terminar, grava a resposta e os tokens REAIS (`usage`).
   - Credencial continua vindo de `deps.credencialIA()` / `resolverCredencialIA` (nenhum ponto novo de leitura da chave;
     `server/integracoes-anthropic.test.ts` passa sem ser mexido).
   - Modelo e esforço: os escolhidos pelo dono (função "maquete_leitura" e Configurações) — os MESMOS parâmetros da chamada
     direta, montados por uma função só (`parametrosDaMensagem`).
   - Lote que termina com erro, expira ou é cancelado: nada foi entregue (e, pela documentação, nada é cobrado) → devolve a
     confirmação e o contador (`devolverReserva`), com mensagem clara. Cortada por `max_tokens`, recusada ou ilegível: foi
     cobrada → conta como usada, guarda os tokens, mensagem clara com os tokens gastos.
   - Botão "Cancelar leitura pela IA", que cancela o lote na Anthropic (leitura e importação).
   - Concorrência: duas abas / duplo clique não criam dois lotes (a reserva condicional de antes vale para o envio); duas
     consultas no fim gravam a leitura e os tokens uma vez só. O estado do lote sobrevive a recarregar e a fechar o navegador.
2. [x] **Só a página da prancha**: prancha vetorial de PDF com várias páginas vai como um PDF novo de uma página
   (`pdfDaPagina`, sem dependência nova). Se não der (PDF protegido, estrutura não entendida, cópia que não abre), vai o arquivo
   inteiro como antes, e o motivo fica no passo (`envioMotivo`, mostrado na tela) e no log (sem dados pessoais).
3. [x] **Consumo honesto**: tokens reais de entrada/saída do lote; "esta maquete já usou N de 8" coerente durante e depois;
   tentativa sem resultado não consome.
4. [x] **Andamento de verdade** nas duas telas (leitura do projeto e planta importada): indicador animado, passo atual,
   "passo X de Y", "prancha X de Y pela IA", situação da prancha na IA em linguagem simples, tempo decorrido, aviso de que pode
   levar alguns minutos e de que PODE fechar a página. Consulta a cada 6 s, parando quando termina; ao reabrir a página com uma
   prancha na IA, a tela retoma sozinha. Sem porcentagem (a API não informa quanto da prancha já foi lido).
5. [x] **Caminho síncrono**: removido da leitura de prancha (não há mais chamada direta para `prancha_ia`). A chamada direta
   (`deps.ia`) fica só no motor "IA em tudo" (fluxo antigo de inventário/estrutura/ambientes com os PDFs inteiros, escolhido
   explicitamente em Configurações), que não é o fluxo relatado e reescreve a lista de passos — ver Pendências.
6. [x] Sem migração.
7. [x] Testes vitest com a API simulada (ver abaixo); testes antigos ajustados sem enfraquecer.

## Decisões
- [AUTO-DECISION] Situação do lote na tela → "Enviando à IA…", "Enviada à IA — na fila ou sendo lida", "Cancelando…",
  "Lida" (motivo: a API só informa `in_progress`/`canceling`/`ended`; separar "na fila" de "sendo lida" seria inventar).
- [AUTO-DECISION] Erro ao CRIAR o lote: resposta de erro da API (inclusive 4xx) → não cobrado, devolve; tempo esgotado ou
  conexão caída → conta como usado (o lote pode ter sido criado e será lido e cobrado — lado seguro do teto). Sem nova
  tentativa automática no envio (`maxRetries: 0`), para não criar um segundo lote pago.
- [AUTO-DECISION] Consulta que falha por instabilidade continua tentando (até 30 seguidas); chave revogada/sem permissão/lote
  não encontrado → erro claro, conta como usado (a leitura pode ter acontecido).
- [AUTO-DECISION] Cancelar pode ser feito por quem pode seguir sem a IA (mesma regra de `pularIA`): cancelar só evita gasto.
  Confirmar a leitura paga continua só do admin.
- [AUTO-DECISION] Com o lote na Anthropic, a reserva não vence pelo relógio (a leitura pode levar até 24 h; o lote expira
  sozinho e a consulta devolve "expired"). Enquanto isso, confirmar, seguir sem a IA, ler de novo, descartar e importar outro
  continuam recusados (QA N1): a pessoa espera ou cancela.
- Tokens: `input_tokens`/`output_tokens` do `usage`, como antes (sem cache). Lote cobra 50% do preço normal (documentação).

## Portão de QA (21/11) — CONCERNS, achados 1 a 6 corrigidos
Provas em `server/maquete-3d-lote-qa.test.ts` (commit do QA `8c387d5`); os testes "ACHADO" foram invertidos ("corrigido").
1. **Envio que cria o lote e estoura o tempo** → o passo NÃO vira erro: fica "executando" com `loteAProcurar` e, depois de
   20 s (para quem criou um lote nesse meio tempo já ter gravado o id), procura na Anthropic (`messages.batches.list`, até
   2 páginas de 50, janela da reserva −10 s até +75 s, prazo do passo, sem nova tentativa automática). Adota só se houver
   UM candidato de uma requisição que não esteja gravado em nenhuma maquete (leitura ou importação). Até 3 procuras; sem
   achar → conta como usada (como antes); mais de um candidato → não adota nenhum. A espera entre procuras é o ciclo da tela.
2. **Função cai entre criar o lote e gravar o id** → com a reserva vencida, antes de "interrompida" faz uma procura; achou,
   adota e segue consultando.
   - `custom_id` agora é único por tentativa: `<leitura|importacao>-<maquete>-<passo>-<hora da reserva em base 36>`.
   - **Limite da API:** a listagem não devolve o `custom_id`; ele é conferido nos resultados, quando o lote termina. Lote
     adotado com o resultado de outro pedido: o resultado NÃO é usado, a tentativa conta como usada e a tela diz isso.
3. **Lote deixado de lado** (30 falhas de consulta, chave revogada, sem permissão, não encontrado) → antes, pede o
   cancelamento à Anthropic (melhor esforço, até 8 s) e registra em `passo.loteAbandonado` se foi aceito; a mensagem diz.
4. **Cancelar** recebe a `chave` da prancha mostrada; o servidor só cancela se ela for a que está na IA (senão, CONFLICT
   pedindo para atualizar a página; nada é cancelado).
5. **Consulta, cancelamento e procura** com `maxRetries: 0` e prazo = o que sobra do passo (entre 3 e 20 s): nunca passam
   dos 60 s; consulta que estoura conta como falha e a tela consulta no ciclo seguinte.
6. **Bomba de compressão**: `inflateSync(…, { maxOutputLength: 64 MB })` nos fluxos de objetos e no JPEG comprimido; passou
   do teto, o fluxo é ignorado, a página não é achada e a prancha vai inteira, com o motivo gravado no passo.

## Portão de QA, rodada 2 (21/11) — R2-1 (importante) e R2-2 (baixo) corrigidos
Provas `QA-R2-1` e `QA-R2-2` em `server/maquete-3d-lote-qa.test.ts` (commit do QA `344e678`), invertidas.
- **R2-1:** lote ADOTADO (`lote.adotado: true`, achado pela listagem, sem o `custom_id` conferido) NUNCA é cancelado na
  Anthropic: "Cancelar", o abandono (30 falhas, chave revogada, sem permissão, não encontrado) e o prazo de **2 h** sem
  terminar (`PRAZO_LOTE_ADOTADO_MS`, contado de `adotadoEm`) só o SOLTAM do passo (`lote = null`,
  `loteAbandonado.cancelamento = "nao_pedido"`), a tentativa conta como usada e a mensagem diz que a leitura não foi
  cancelada na Anthropic porque não foi possível confirmar que era desta maquete. Lote criado normalmente (id recebido na
  criação) continua podendo ser cancelado.
- **R2-2:** quando o lote adotado termina com o resultado de outro pedido, os `custom_id` do resultado vêm no erro
  (`LoteDeOutroPedido.pedidos`). O `custom_id` diz a coluna e a maquete; se lá houver um passo "executando" procurando
  exatamente esse pedido (`loteAProcurar.pedido`), o id do lote é gravado nele com gravação condicional ao texto lido
  (nada é sobrescrito se ele mudou no meio) e ele segue consultando — o resultado pago é aproveitado pela dona.
  Risco aceito: se a dona já tinha desistido (3 procuras sem achar, porque o lote estava com a outra) ou a gravação
  condicional perder a corrida, o lote não é entregue e o resultado fica sem uso (dentro do teto; nada é cobrado além).

## Limitações registradas (não corrigidas nesta story)
- **QA-7:** lote que termina "expired" (ou com erro/cancelado) devolve a confirmação, mas não reenvia sozinho: a pessoa clica
  "Tentar de novo este passo" (a tela não reenvia depois de erro, de propósito, para não gastar sem alguém ver).
- **QA (baixo):** recursos compartilhados no nó "Pages" (ex.: imagens de outras páginas declaradas para todas) vão junto na
  página separada — o PDF fica maior, mas só a página pedida é desenhada; ainda é menor que o arquivo inteiro.
- O `custom_id` do lote adotado só é conferido no fim (limite da API de listagem, ver 2).

## Confirmado na documentação / SDK
- Documentação oficial (docs.claude.com, "Batch processing", lida em 20/11/2026): resultados `succeeded`, `errored`,
  `canceled`, `expired`; "You aren't billed" para errored/canceled/expired; lote expira em 24 h; resultados por 29 dias;
  "most batches complete within 1 hour"; parâmetros NÃO aceitos em lote: `stream: true`, `speed` (fast mode), `fallbacks`,
  `max_tokens: 0`. `output_config` (esforço e formato JSON), imagens e documentos PDF não estão nessa lista; "Vision" consta
  como suportado; "All active models support the Message Batches API".
- SDK instalado `@anthropic-ai/sdk` 0.106.0: `messages.batches.create/retrieve/results/cancel`; o `params` de cada requisição
  é `MessageCreateParamsNonStreaming` (aceita `output_config`).
- **Não confirmado** (sem chamada real, por regra): o tempo real de fila para o `claude-fable-5-2` em produção e o
  comportamento de `output_config.format` em lote numa chamada de verdade (a documentação não o exclui).

## Testes
(a) Automáticos — `npx vitest run server/maquete-3d*.test.ts server/integracoes-anthropic.test.ts --maxWorkers=2 --minWorkers=1`
e `npx tsc --noEmit` (20/11/2026): **tsc sem erros; 11 arquivos, 286 testes, todos passando** (16 novos). Depois das correções do portão de QA (21/11): **tsc sem erros; 12
arquivos, 299 testes, todos passando** (com `server/maquete-3d-lote-qa.test.ts`). Rodada 2: ver o commit da correção. Novos em `server/maquete-3d-lote.test.ts`:
envio → consultas → sucesso com tokens reais; parâmetros no lote (modelo, esforço, esquema, `maxRetries: 0`);
expired/errored/canceled devolvem; cortada conta e guarda tokens; cancelar; duas abas (1 lote, 1 gravação); retomada depois
de "recarregar" 3 h depois; falha de consulta e chave revogada (sem vazar a chave); importação com cancelamento; página
separada (sobrado, PDF 1.5 com fluxo de objetos e herança, protegido) e queda para o arquivo inteiro com o motivo; funções
da tela. Ajustados: `server/maquete-3d-hibrida.test.ts`, `server/maquete-3d-qa-s03-s05.test.ts`, `server/maquete-3d-importacao.test.ts`
(trocam a IA direta simulada pelo lote simulado; o laço de teste continua durante a espera "lote"; os testes de tempo esgotado
e de passo em curso passaram a provar o mesmo no envio e na consulta do lote).
(b) Manuais: nenhum (sem acesso à produção nesta sessão).
(c) Pendentes de validação em produção: uma leitura real de prancha A0 com `claude-fable-5-2` (tempo de fila, tokens e a
planta lida); cancelar um lote real; reabrir a página no meio da leitura.

## Pendências
- Motor "IA em tudo" (fluxo antigo) continua com a chamada direta e o mesmo risco de tempo; levar para lote numa story à
  parte, se o dono usar esse motor.
- O dono pode querer reduzir o esforço do modelo (não foi mudado: escolha dele).

## File List
- `server/maquete-3d/base.ts` — `parametrosDaMensagem`, `interpretarMensagem`, `ClienteLote`, `clienteLoteAnthropic`, dependência `lote`.
- `server/maquete-3d/leitura.ts` — `passoPranchaIA` (envio/consulta), `anexoDaPagina` (página separada), `cancelarLoteIA`, `cancelarLeituraIA`.
- `server/maquete-3d/importacao.ts` — consulta do lote na importação, `cancelarLeituraIAImportacao`.
- `server/maquete-3d/execucao-ia.ts` — `naoCobradoNoEnvio`, reserva com lote não vence, `MENSAGEM_LOTE`, segunda barreira preserva a reserva em curso.
- `server/maquete-3d/pdf-pagina.ts` — `pdfDaPagina`; textos literais/hex marcados no leitor mínimo; herança de atributos da página.
- `server/maquete-3d/router.ts` — rotas `cancelarLeituraIA` e `cancelarLeituraIAImportacao`; `lote`/`envioMotivo` nos passos; espera "lote".
- `shared/maquete-3d/regras.ts` — `LoteDoPasso`, `envioMotivo` no passo.
- `client/src/components/maquete-3d/AndamentoLeitura.tsx` (novo), `client/src/components/maquete-3d/rotulos-leitura.ts`,
  `client/src/components/maquete-3d/ImportarPlanta.tsx`, `client/src/pages/admin/AdminMaquete3D.tsx`.
- `server/fixtures/maquete-3d/lote-simulado.ts` (novo), `server/maquete-3d-lote.test.ts` (novo), `server/maquete-3d-lote-qa.test.ts` (QA, invertido),
  `server/maquete-3d-hibrida.test.ts`, `server/maquete-3d-qa-s03-s05.test.ts`, `server/maquete-3d-importacao.test.ts`.
