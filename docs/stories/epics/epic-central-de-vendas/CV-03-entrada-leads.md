# CV-03 — Serviço de entrada de leads

Status: Draft

## Critérios de aceite
- [ ] Mensagem de telefone sem lead no webhook da Evolution cria o lead uma única vez (chave de telefone `chaveTelefone`), mesmo com webhook repetido ou concorrente.
- [ ] Código de campanha `[ref:...]` na primeira mensagem grava origem (`sourceChannel`), campanha e empreendimento.
- [ ] Gerador de links wa.me por campanha e empreendimento.
- [ ] Site e Logyca usam o mesmo serviço; mesma origem + mesmo ID externo nunca criam dois leads.
- [ ] Endpoints de entrada com token próprio (cofre), zod e limitação de taxa.

## File List
- (preenchido na implementação)

## Change Log
- 12/11/2026 — story criada (Draft) a partir da seção 7 do prompt.
