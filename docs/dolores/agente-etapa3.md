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

## Como uma ação passa pela porta (`executarFuncao`)
1. Mesmas travas da leitura: pausa, usuária ativa, lista liberada (etapa 3), zod estrito com limites, vaga do minuto.
2. Ação só com `canal: "whatsapp"` e a mensagem do dono (`mensagemId`) — a ponte HTTP recusa (403).
3. Teto: 10 ações por comando do dono (diretas + itens na fila).
4. `direto`: transação de ESCRITA mínima (`server/dolores/escrita.ts`) com o registro e a linha de `dolores_autoria`
   juntos. As leituras seguem em READ ONLY.
5. `fila`: a função só confere (leituras em READ ONLY) e o item entra em `dolores_aprovacoes` com função, argumentos
   validados, resumo do sistema, código e vencimento. O modelo recebe só o resumo (sem código).
6. Auditoria em `dolores_acoes` (ok / recusada / erro).

## Decisão (`server/dolores/aprovacoes.ts`)
- WhatsApp: a mensagem do dono (número estrito, não encaminhada, sem mídia) que seja EXATAMENTE "aprovar|aprovo|recusar|
  recuso" + códigos (`shared/dolores/fila.ts › lerDecisaoDoDono`) — reconhecida antes da IA, sem custo. O modelo não tem
  ferramenta de aprovação e o texto dele nunca é lido como decisão.
- Tela: `dolores.fila.aprovar/recusar` (papel admin), com o id de quem decidiu.
- Aprovar = `UPDATE … SET situacao='executando' WHERE codigo=… AND situacao='aguardando' AND vence_em > agora` (uma
  execução só), revalidação dos argumentos (zod) e do estado atual, execução, resultado. Erro/recusa na revalidação →
  "erro", nada feito. "executando" há mais de 3 min → "erro", não refeito. Gatilho no banco: item não é apagado, o que
  será feito não muda e item encerrado não reabre.

## Resposta ao dono
Depois do texto do modelo, o sistema anexa dois quadros lidos do banco: "Registrado no sistema por mim" (autoria do
comando) e "Aguardando a sua aprovação" (códigos e resumos). Testes: `server/dolores/acoes.test.ts`,
`acoes-whatsapp.test.ts`, `fila-router.test.ts`.
