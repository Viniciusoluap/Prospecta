# Regras do projeto Prospecta (preferências do dono)

## Paridade obrigatória Grupo Santa Fé ↔ Prospecta (REGRA ABSOLUTA — estabelecida pelo usuário em 08/09/2026)

**Esta regra tem prioridade máxima e vale nos dois repositórios (Grupo Santa Fé e Prospecta).**
Está duplicada, com o mesmo texto, em `Grupo-Santa-Fe/CLAUDE.md`.

**Toda vez que o usuário pedir uma funcionalidade, correção ou processo em qualquer um dos
dois sistemas (Grupo Santa Fé ou Prospecta), a mesma função tem que existir e se comportar
igual no outro sistema também** — não é opcional, não depende de o usuário pedir explicitamente
nos dois lugares. As duas plataformas são a mesma operação (construção/imóveis financiados) em
duas cidades e devem permanecer espelhadas.

**Únicas exceções permitidas** — as diferenças que já existem hoje, documentadas em
`docs/stories/epics/ROADMAP.md`:
- Landing page e layout público de cada site (visual/institucional, não regra de negócio).
- Ecossistema de sorteios do Prospecta (`draws`, `tickets`, `utefBalances`, `utefTransactions`,
  `products`, `productConversions`) — exclusivo do Prospecta, sem equivalente no Santa Fé.
- Nomes/stack técnica de cada repositório (Next.js/Prisma no Santa Fé, Vite/Express/tRPC/Drizzle
  no Prospecta) — a regra de negócio deve ser a mesma, a implementação técnica pode diferir
  para se adequar à stack de cada lado.

**Nenhuma outra exceção deve ser assumida ou inventada.** Se uma nova diferença genuína for
necessária, ela precisa ser registrada explicitamente (com justificativa) no ROADMAP do
Prospecta antes de ser tratada como exceção — nunca implementada silenciosamente como "só faz
sentido de um lado".

**Na prática, isso significa:**
- Ao implementar algo no Prospecta, verificar se o Grupo Santa Fé já tem o equivalente; se não
  tiver, sinalizar isso ao usuário/à sessão responsável pelo Santa Fé para portar.
- Ao implementar algo no Grupo Santa Fé que se originou de um pedido novo (não presente ainda
  no Prospecta), registrar como pendência/epic/story no ROADMAP do Prospecta para portar.
- Nunca tratar uma funcionalidade como "exclusiva" de um dos lados sem que essa exclusividade já
  esteja listada nas exceções acima ou explicitamente autorizada pelo dono do produto.

## Handoff a cada etapa (REGRA PERMANENTE — estabelecida pelo usuário em 19/10/2026)

**Vale nos dois repositórios (Grupo Santa Fé e Prospecta) e para qualquer agente (Claude, Codex, AIOX).**

Ao concluir cada etapa de trabalho (não só no fim da tarefa), sempre:
1. Atualizar o HANDOFF da frente em andamento (ex.: `HANDOFF-18-10-MEDICOES-CAIXA.md`; se não houver, criar `HANDOFF-<dd-mm>-<assunto>.md` na raiz) com:
   - o que foi concluído (commits e arquivos principais);
   - pendências;
   - testes executados e resultados, separando (a) automáticos, (b) manuais e (c) pendentes de validação em produção;
   - o próximo passo exato para quem continuar.
2. Fazer commit e push na branch de trabalho, e confirmar que o push chegou ao GitHub antes de dizer que está salvo.

Objetivo: se os créditos acabarem no meio, outra sessão (Claude ou Codex) continua do ponto exato, sem perder trabalho.
