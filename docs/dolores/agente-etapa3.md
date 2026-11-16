# Dolores — ações e fila de aprovação (Etapa 3)

Como na etapa 2, não há texto para colar no Claude Console: o sistema chama a Anthropic e a instrução fica em
`server/dolores/prompt.ts` (`PROMPT_SISTEMA_WHATSAPP`, seção "O que você pode fazer nesta etapa (etapa 3 — ações)").

## Funções de ação (lista fechada — `server/dolores/acoes/registro.ts`)

| Função | Nível | Por quê (prompt mestre, seção 5) | O que faz |
|---|---|---|---|
| `criar_tarefa` | direto | "Criar tarefa … execução direta, com registro"; reversível na tela de Tarefas | Tarefa com título, responsável (admin/colaborador ativo), prazo (hoje a 1 ano), prioridade e vínculo (cliente/obra), pelas funções da tela; não duplica tarefa aberta igual |
| `registrar_acompanhamento` | direto | "registrar acompanhamento … execução direta, com registro" | Anotação ou ligação no histórico do cliente do CRM, autor "Dolores (funcionária digital)" |
| `preparar_cobranca` | fila | "Mensagem ou e-mail para cliente: eu (o dono)"; envio ainda não liberado | Confere pendências reais, último contato e LGPD; texto montado pelo sistema; aprovada → registro no histórico + texto ao dono; **nunca enviada** |
| `gerar_documento` (`tipo: "pci"`) | fila | Grava na pasta da obra e é documento técnico (na dúvida, fila) | Aprovado → `gerarPciDaObra` com o rascunho salvo pela equipe; sai **sem assinatura** |

Não existem (recusa auditada, motivo em `permissoes.ts › PROIBIDAS`): enviar mensagem/e-mail/cobrança, aprovar item,
excluir, pagar/baixar/estornar, editar lançamento, alterar usuário/senha/dados bancários, assinar documento.

## Regra de contaminação (portão de QA da E3 — barreira principal contra injeção)
- Cada função tem a marca `contamina` (`funcoes.ts › CONTAMINA`; ações em `acoes/registro.ts`): a resposta traz texto
  de terceiros ou do banco (histórico, anotações, mensagens, observações, títulos, nomes, documentos). Hoje TODAS as
  leituras contaminam; nome desconhecido contamina (na dúvida, contamina). Ações diretas não contaminam (devolvem só ids);
  as de fila sim (o resumo traz nomes).
- O laço (`cerebro.ts`) marca o comando como contaminado assim que o resultado `ok` de uma função que contamina entra no
  laço. A partir daí, a porta NÃO executa ação direta: `criar_tarefa`/`registrar_acompanhamento` vão para a fila com o
  resumo "Pedido surgido durante a leitura de dados; confira antes de aprovar: …" (`paraFila`); aprovadas, rodam a
  mesma execução, com as mesmas conferências, numa transação de escrita. Antes de qualquer leitura, continuam diretas.
- Reforço: `intencaoDeAcao` (`shared/dolores/fila.ts`, verbos de ação reconhecidos por código). Sem intenção na mensagem
  do dono, o modelo não recebe as ferramentas de ação e a porta recusa ação (403 auditado, `semAcoes`).
- Testes: `correcoes-e3.test.ts` e `correcoes-e3-whatsapp.test.ts` (A8 invertido; ação antes/depois da leitura; dado
  envenenado com intenção de ação para outra coisa).
- **Texto colado (QA R2 N1):** a intenção de ação só é procurada no trecho do DONO (`trechoDoDono`: o começo da mensagem
  até a primeira quebra de linha, aspas, ">", "---", dois-pontos que não seja de hora — no máximo 200 caracteres). E a
  mensagem com cara de colagem/citação (`pareceColagem`: mais de 3 linhas, mais de 300 caracteres, citação ">", cabeçalho
  de e-mail "De:/Assunto:/Enviado:", separador, aspas abrindo bloco de 40+ caracteres, dois-pontos seguido de bloco,
  parágrafo novo) nasce CONTAMINADA: toda ação vai para a fila com "Pedido feito em mensagem com texto colado ou citado;
  confira antes de aprovar: …". Pedido curto e direto continua executando na hora.
- **Retorno das ações (QA R2 N2):** ao modelo vão só ids, datas e códigos do sistema (`criar_tarefa` devolve
  `responsavelId`, não o nome). A porta marca `contamina` em cada resposta (fora do corpo): leitura ok, item na fila (o
  resumo cita nomes) e recusa com texto do banco (`RecusaAcao(..., { comDados: true })`, ex.: lista de nomes da equipe,
  cada um cortado em 60 caracteres) contaminam — ok OU erro. `user.updateProfile` aceita nome com até 100 caracteres e uma
  linha só (nomes antigos não são alterados; na recusa ao modelo vão cortados).
- **O dono lê tudo o que aprova (QA R2 N3):** o resumo do item mostra TODO o texto que será gravado (título, descrição,
  texto do acompanhamento, prazo, responsável já conferido, prioridade, vínculo, todos os documentos da cobrança), no
  máximo 1.500 caracteres (`resumoDaFila`). Não cabe → recusa "Texto longo demais para aprovar pelo WhatsApp…" (nunca
  corta). Os argumentos guardados são os textos na forma mostrada (`comoMostrado`); a linha guarda `conferencia`
  (SHA-256 de função + resumo + argumentos), conferida antes de executar; e a execução confere que cada texto gravado
  está no resumo lido (`conferirMostrado`). Identidade do item `criar_tarefa` (M4): todo o conteúdo.
- Testes: `correcoes-e3-r2.test.ts` e `correcoes-e3-r2-whatsapp.test.ts` (R2-N1…N3 e M1–M6 invertidos).

## Como uma ação passa pela porta (`executarFuncao`)
1. Mesmas travas da leitura: pausa, usuária ativa, lista liberada (etapa 3), zod estrito com limites, vaga do minuto.
2. Ação só com `canal: "whatsapp"` e a mensagem do dono (`mensagemId`) — a ponte HTTP recusa (403).
3. Teto: 10 ações por comando do dono (diretas + itens na fila).
4. `direto` (comando ainda não contaminado): transação de ESCRITA mínima (`server/dolores/escrita.ts`) com o registro e a
   linha de `dolores_autoria` juntos, com o prazo da porta (`SET LOCAL statement_timeout` e `bancoDaAcao()` recusa
   depois do prazo — a transação se desfaz). Desfecho único (QA R2 M6): a porta espera a transação (prazo interno = metade
   do da porta) — COMMIT confirmado → "feito"; desfeita → 504 "passou do prazo e foi desfeita: nada foi gravado". Só se o
   banco não responder nem em prazo + 2 s: 504 "confira no sistema" (último recurso). As leituras seguem em READ ONLY.
5. `fila`: a função só confere (leituras em READ ONLY) e o item entra em `dolores_aprovacoes` com função, argumentos
   validados, resumo do sistema, código e vencimento — tudo numa transação (falhou um item, nenhum fica). O modelo
   recebe só o resumo (sem código); o laço recebe os códigos por fora (`aoPorNaFila`) para o quadro do dono, inclusive
   os que já aguardavam de outro comando. Texto de dados entra em resumo/quadro como uma linha, sem colchetes
   (`textoDeDado`): nenhum dado forja "[CÓDIGO]".
6. Auditoria em `dolores_acoes` (ok / recusada / erro).

## Decisão (`server/dolores/aprovacoes.ts`)
- WhatsApp: a mensagem do dono (número estrito, não encaminhada, sem mídia) que seja EXATAMENTE "aprovar|aprovo|recusar|
  recuso" + códigos (`shared/dolores/fila.ts › lerDecisaoDoDono`) — reconhecida antes da IA, sem custo. O modelo não tem
  ferramenta de aprovação e o texto dele nunca é lido como decisão.
- Tela: `dolores.fila.aprovar/recusar` (papel admin), com o id de quem decidiu.
- Aprovar = `UPDATE … SET situacao='executando' WHERE codigo=… AND situacao='aguardando' AND vence_em > agora` (uma
  execução só), revalidação dos argumentos (zod) e do estado atual, execução, resultado. Erro/recusa na revalidação →
  "erro", nada feito. "executando" há mais de 3 min → "erro", não refeito. Gatilho no banco: item não é apagado; o que
  será feito, o resumo, a validade, o pedido e o autor não mudam; "aguardando" só vai para executando/recusada/vencida;
  a decisão é gravada uma vez; o resultado só ao encerrar a execução; item encerrado não reabre.
- Orçamento de tempo (WhatsApp): mínimo restante por função para COMEÇAR (`MINIMO_POR_FUNCAO_MS`: PCI 30 s; demais 6 s);
  no máximo 1 PCI por mensagem de decisão; as cópias ao Drive da PCI têm prazo (`comPrazoNoDrive`, AbortSignal) — passou,
  a cópia fica pendente para o organizador. Sem tempo, o item não começa e o dono é avisado para aprovar de novo.
- Depois que a ação aconteceu, nenhuma falha de registro vira "não foi executado": PCI gerada com autoria que falhou →
  "executada" com a referência e o texto "FOI gerada …, mas não consegui registrar a autoria; confira".
- PCI: `gerarPciDaObra(..., { regravarRascunho: false, prazoDriveMs })` — o rascunho da equipe não é regravado.
- Cobrança aprovada com a lista de pendências diferente da aprovada → recusa ("peça de novo"), como a PCI.

## Resposta ao dono
Depois do texto do modelo, o sistema anexa dois quadros lidos do banco: "Registrado no sistema por mim" (autoria do
comando) e "Aguardando a sua aprovação" (códigos e resumos). Testes: `server/dolores/acoes.test.ts`,
`acoes-whatsapp.test.ts`, `fila-router.test.ts`.

## Quadros e orçamento (QA R2 M3/M5)
- Quadro "Aguardando a sua aprovação": itens INTEIROS (até 10) enquanto couberem nos 3.800 caracteres; os demais viram
  "- e mais N item(ns) aguardando — veja a fila em Integrações › Dolores"; a instrução "Responda só…" vem sempre no fim.
  O quadro "Registrado no sistema por mim" usa o que sobra; o texto do modelo fica com o resto (mínimo 200).
- Aprovação pela tela: mesmo orçamento do WhatsApp (`decisorDaTela`, 42 s; PCI só começa com 30 s; Drive no que sobra).
- Drive: PCI gerada pendente é adotada pelo organizador (mesmo nome e MD5) em vez de reenviada (M1); o token OAuth da conta
  do dono respeita o prazo do `comPrazoNoDrive` (M2).
