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

## Maquete 3D — executar até o fim, migrando e publicando a cada etapa (REGRA — estabelecida pelo usuário em 15/11/2026)

**Vale para o EPIC-022 (Maquete 3D), só no Prospecta** (exceção de paridade já registrada no ROADMAP).

Ordem do dono em 15/11/2026: "eu autorizo tudo; estabeleça uma regra para não parar até concluir tudo, e a cada
etapa você vai fazer a migração e vai publicar, e isso eu já deixo autorizado".

Na prática, para qualquer agente que continuar este epic:
1. **Não parar entre etapas.** Concluída uma etapa do `docs/stories/epics/epic-022-maquete-3d/EPIC.md`, seguir
   direto para a próxima, sem pedir confirmação, até as quatro etapas estarem entregues.
2. **A cada etapa concluída, já está autorizado** (sem perguntar de novo):
   - aplicar no Neon de produção as migrações **aditivas** do epic (`CREATE ... IF NOT EXISTS`, `ADD COLUMN`,
     novos valores de enum/CHECK);
   - fazer o merge do PR da etapa na `main` e conferir que a publicação da Vercel terminou sem erro.
3. **Continua exigindo confirmação do dono** (a autorização acima não cobre): apagar ou alterar dados existentes,
   remover tabela/coluna, mexer em credenciais, e qualquer mudança fora do escopo do EPIC-022.
4. Só parar antes do fim por bloqueio real que dependa do dono (ex.: uma chave que só ele pode cadastrar) —
   e, nesse caso, deixar o bloqueio escrito no HANDOFF e seguir com tudo o que não depende dele.
5. O handoff a cada etapa (regra acima) continua valendo: `HANDOFF-14-11-MAQUETE-3D.md`.

## EPIC-023 (13 correções de 15/11) — executar até o fim, migrando e publicando a cada etapa (REGRA — estabelecida pelo usuário em 15/11/2026)

Ordem do dono em 15/11/2026, ao aprovar o plano do EPIC-023: "autorizo tudo, continue continuamente sem parar e a cada
etapa faça a migração e a publicação". Vale para as etapas A–G de `docs/stories/epics/epic-023-correcoes-15-11/EPIC.md`,
inclusive as que mexem fora da Maquete 3D (CRM, Usuários e acesso, Mapa operacional, Incorporação).

1. **Não parar entre etapas**: concluída uma etapa, seguir para a próxima sem pedir confirmação.
2. **Já autorizado a cada etapa**: migrações aditivas no Neon de produção, merge do PR na `main` e conferência da publicação na Vercel.
3. **Decisões já tomadas pelo dono (não perguntar de novo):** colaborador perde o acesso ao cadastro de corretores (fica só
   com o admin, em "Usuários e acesso"); a regra CHECK de vínculo da maquete pode ser trocada para aceitar cliente do CRM;
   as maquetes paradas em "Lendo o projeto" podem ter a leitura zerada para o leitor novo refazer.
4. **Continua exigindo confirmação**: apagar ou alterar outros dados existentes, remover tabela/coluna, credenciais e
   qualquer coisa fora do EPIC-023.
5. Handoff a cada etapa: `HANDOFF-15-11-CORRECOES.md`. Porte para o Grupo Santa Fé: pendências no ROADMAP.
