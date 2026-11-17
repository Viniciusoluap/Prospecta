# Dolores — notas de obra (Etapa 5)

Como nas etapas 2 a 4, não há texto para colar no Claude Console: o sistema chama a Anthropic e a instrução fica em
`server/dolores/prompt.ts` (seção "Notas de obra (etapa 5)"). A leitura da nota em si NÃO é uma ferramenta do agente: o
sistema a faz quando o documento chega no grupo da obra (`server/dolores/notas-obra.ts`), com a instrução própria
`SISTEMA_NOTA` e uma única ferramenta de saída (`registrar_leitura_nota`).

## Funções (lista fechada)

| Função | Tipo / nível | Por quê | O que faz |
|---|---|---|---|
| `listar_notas_obra` | leitura (contamina) | emitente, descrição e itens vêm de nota de TERCEIRO | Rascunhos com os campos conferidos, dúvidas, alertas, resposta do empreiteiro (indício), apontamento da conciliação e o texto sugerido para o DONO enviar |
| `conciliar_nota_obra` | ação — **fila** | financeiro é do dono; a nota é de terceiro | Propõe ligar a nota ao pagamento do BPO que confere (pago e vindo do banco). Aprovado: grava só o vínculo na nota; o BPO não muda |
| `salvar_nota_obra` | ação — **fila** | arquivo na pasta da obra | Propõe salvar o arquivo (o mesmo lido, SHA-256) em Obras › Obra › Notas fiscais, com nome do sistema |

Proibida nova: `pedir_confirmacao_nota` (a Dolores não fala com o empreiteiro nem no grupo). Continuam proibidas as de
pagamento, edição de lançamento, exclusão, usuários/credenciais e assinatura.

## Registro interno × fila — por quê
- **Registro interno (direto, sem fila):** o rascunho (`obra_notas`) e a resposta reconhecida do empreiteiro
  (`obra_notas_respostas`). São tabelas próprias da Dolores, só aditivas, que não mexem em nenhum módulo do sistema (obra,
  BPO, Drive, CRM) e servem para o dono conferir. O gatilho da 0128 garante: nada é apagado, o que foi lido não muda, a
  confirmação não volta a "pendente", o vínculo com o BPO e o arquivo no Drive só são gravados uma vez.
- **Fila (aprovação do dono):** tudo o que liga a nota a um módulo do sistema — o vínculo com o lançamento do BPO e o arquivo
  na pasta da obra. A nota é conteúdo de terceiro (contaminado), então nada disso é direto, nem quando pedido pela tela.
  O resumo do item mostra exatamente o que será gravado; a execução revalida tudo na hora.
- **Fora do escopo desta etapa:** criar lançamento no BPO ou pagamento na obra a partir da nota. O rascunho mostra os dados;
  o lançamento continua sendo feito pela equipe nas telas de sempre (decisão registrada na story).

## Como a confirmação do empreiteiro é reconhecida (código, não modelo)
1. Só texto de grupo **cadastrado e ligado a obra**, não encaminhado, sem mídia (o registro da etapa 4 vem antes: teto
   diário e idempotência por instância + id da mensagem).
2. O texto INTEIRO precisa ser uma das formas fechadas (`lerRespostaDoEmpreiteiro`): "confirmo", "confirmado", "confere",
   "sim, confirmo", "confirmo nota 12" → confirmação; "corrigir nota 12 …", "não confere …" → correção. Negação, dúvida,
   pergunta ou outro número → ambígua (nada registrado).
3. Ligação à nota certa (`ligarRespostaANota`): a resposta **cita** a mensagem da nota (o id da mensagem citada,
   `contextInfo.stanzaId`) ou escreve "NOTA <número do sistema>" — se tiver as duas, têm de ser a mesma nota. A nota tem de
   ser do MESMO grupo e da obra ligada ao grupo, estar dentro do prazo e ainda sem resposta.
4. Quem respondeu: o telefone do participante (DDD + 8 finais) tem de ser o do **empreiteiro vinculado à obra** (usuário
   ativo, papel empreiteiro). Só o mascarado é gravado.
5. Grava a resposta e muda a nota para "confirmada (a conferir)" ou "correção pedida" numa transação; só a primeira vale.
   Qualquer falha → nada muda e a tentativa vai para `dolores_acoes` como recusada.

## Segurança — a nota é dado
- O arquivo, o nome e a legenda vão ao modelo como DADO; a resposta só vale pela ferramenta `registrar_leitura_nota`
  (estrutura fechada, `.strict()`; campo a mais = leitura inválida inteira). Valores, CPF/CNPJ, datas e chave são
  conferidos por código; nada do texto vira ação, destino, nome de pasta ou link; o nome do arquivo no Drive é montado pelo
  sistema.
- Não existe campo de dado bancário na saída; o texto lido passa pelo filtro do registro (bancários sempre fora).
- A chave da Anthropic continua lida só no ponto único (`bloqueioAtual` em `whatsapp.ts`, função `dolores_notas`).
