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

## EPIC-024 (10 correções de 16/11) e EPIC-025 (Dolores) — executar até o fim, migrando e publicando a cada etapa (REGRA — estabelecida pelo usuário em 16/11/2026)

Ordem do dono em 16/11/2026, depois de enviar os dois prompts (as 10 correções e a Operação Dolores): "já fica tudo
autorizado para os dois, e a cada etapa você pode migrar e publicar, no ritmo contínuo e constante dos dois; só pare
quando finalizar, sem que seja necessária a minha intervenção constante".

1. **Não parar entre etapas** das 10 correções (`docs/stories/epics/epic-024-correcoes-16-11/`) nem da Dolores
   (`docs/stories/epics/epic-025-dolores/`). Isto substitui, por decisão posterior do dono, a exigência do prompt da
   Dolores de pedir autorização a cada etapa e a cada merge.
2. **Já autorizado a cada etapa**: migrações aditivas no Neon de produção, merge do PR na `main` e conferência da
   publicação na Vercel.
3. **Decisões já tomadas pelo dono (não perguntar de novo):**
   - **Grupo Santa Fé**: a espera de 16/11 acabou. Em 17/11/2026 o dono autorizou a paridade (4 blocos: CRM/usuários/
     mapa, Incorporação, financeiro/integrações, termo de consentimento) e a regra de paridade obrigatória do topo deste
     arquivo voltou a valer. **Ficam fora do Santa Fé, por decisão dele: a Maquete 3D e a Dolores** (exceções no ROADMAP).
   - **Conta Azul**: tudo o que foi ARQUIVADO da importação do Conta Azul pode ser apagado em definitivo, para a
     reimportação funcionar. Só esses registros: lançamento ativo e de outra origem não se apaga. Antes de apagar,
     copiar as linhas para tabela de backup e conferir as quantidades.
     Em 16/11 o dono estendeu: "pode apagar também os 1.011 arquivados do legado e Asaas" — feito, com backup em
     `bpo_lancamentos_backup_conta_azul_20261116` e `bpo_lancamentos_backup_legado_asaas_20261116` (não apagar essas tabelas).
   - **Cópias antigas do Neon** (ramificações de teste arquivadas): apagadas em 16/11 com autorização; backup completo
     do banco em `backup-2026-11-16-antes-das-10-correcoes` (conferido: mesmas contagens da produção).
   - **Leitura de PDF da maquete**: se o leitor próprio não garantir a qualidade (PDF que é só uma imagem, leitura
     fraca), pode ler pela IA. A integração Anthropic da correção 10 continua sem uso automático nas demais funções.
4. **Continua exigindo confirmação do dono**: apagar ou alterar outros dados existentes, remover tabela/coluna,
   credenciais (chaves e senhas são digitadas por ele nos painéis), contratar serviço pago novo, e mensagem para
   cliente ou terceiro pela Dolores fora das categorias que ele liberar.
5. A Dolores depende de itens que só o dono fornece (créditos no Claude Console, número e QR code, inclusão nos
   grupos, token na Vercel): nesses pontos, deixar o bloqueio escrito no HANDOFF e seguir com o que não depende dele.
6. Qualidade antes de fechar: nada é dado como concluído sem teste verificável e portão de QA (@qa); "fechar" não
   basta — o dono pediu que cada item seja concluído com o resultado garantido.
7. Handoff a cada etapa: `HANDOFF-16-11-CORRECOES-E-DOLORES.md`.

## Prédios — o estacionamento limita os apartamentos (REGRA DE NEGÓCIO — estabelecida pelo usuário em 15/11/2026)

Palavras do dono: "quando nós falamos de prédios eu quero que você sempre tenha o cuidado de calcular o estacionamento
para não sugerir uma quantidade de apartamentos que não comporta a mesma quantidade de estacionamento dentro dessa área".

Vale para qualquer função, atual ou futura, que proponha quantidade de apartamentos, andares ou torres (Maquete 3D,
Incorporação, viabilidade): a quantidade sugerida nunca pode exigir mais vagas do que o terreno comporta.
- A conta fica em `shared/maquete-3d/padrao.ts` (`vagasDoTerreno`, `contaDoEstacionamento`): a vaga é de UM carro
  (12,5 m² = 2,5 × 5 m); a conta usa 18,75 m² por vaga porque soma a parte do corredor de manobra (ajuste do dono em
  16/11/2026: "25 m² por vaga é muita coisa"; o campo da tela aceita de 15 a 35 m²; no pilotis vale também o que cabe de fato na largura de cada ala), somando pátio, pilotis e subsolos; se não fechar, os andares são reduzidos e a tela mostra a conta.
- Nunca reduzir em silêncio: mostrar quantas vagas cabem, quantas são necessárias e o que foi ajustado.
- `shared/incorporacao/urbanismo.ts` (`calcularPotencial`) calcula "unidades máximas" só pelo coeficiente de
  aproveitamento, sem conferir as vagas. Hoje nenhuma tela usa essa função; antes de ligá-la a uma tela, aplicar esta regra.

## Incorporação — áreas restritas entram nas doações (REGRA DE NEGÓCIO — estabelecida pelo usuário em 16/11/2026)

Palavras do dono: "a área de APP, faixas de servidão ou outras áreas que não poderão ser utilizadas para virar lotes,
essas áreas devem ser incorporadas sempre que permitido nas áreas que devam ser destinadas ao projeto, como área verde
e área institucional. Essa lógica deve estar dentro do motor na hora de fazer os desenhos".

- Vale para o Estudo de Massa e para qualquer função que calcule ou desenhe área verde, institucional ou doação.
- A conta fica em `shared/incorporacao/massa-quadro-areas.ts` (`aproveitarRestricoes`, `DESTINOS_PADRAO`) e é usada pelo
  motor em `shared/incorporacao/massa.ts`: a restrição aproveitada entra no alvo da área verde/institucional e é
  desenhada como tal; da área loteável sai só o que faltar para o mínimo exigido.
- Padrão: APP, vegetação a preservar e faixas (transmissão e servidão) contam como área verde; "outras" não contam;
  nenhuma conta como institucional por padrão (área institucional precisa ser edificável). Cada uma pode ser trocada na tela.
- "Sempre que permitido": o cenário avisa que o aproveitamento depende da legislação municipal. Nunca contar a mesma
  área duas vezes no quadro de áreas.
- Paridade: o Estudo de Massa existe no Grupo Santa Fé — portar junto com as correções 8 e 10 do EPIC-023.

## Dolores — decisões do dono em 16/11/2026 (noite) (REGRA)

1. **Segurança é prioridade** (palavras do dono: "Garanta minha segurança, isso é uma prioridade"). Nada da Dolores
   vai para a `main` reprovado pelo portão de QA; achado "importante" de segurança é corrigido antes de publicar.
2. **Dados pessoais liberados para a Dolores ("opção B")**: o dono autorizou que ela veja e informe CPF, CNPJ,
   telefone e e-mail dos clientes. O mascaramento desses dados fica desligado por padrão, atrás do interruptor
   `DOLORES_MASCARAR_DADOS_PESSOAIS` (variável na Vercel; `1` religa). **Continuam sempre mascarados:** senhas,
   tokens, chaves de API, códigos de acesso e dados bancários. **Continuam fora de log, erro, auditoria e tela de
   admin:** números completos e dados pessoais. A resposta só vai ao número do dono.
3. **Modelo da IA por função**: cada função que usa a chave do painel (hoje: leitura de plantas da Maquete 3D e
   conversa da Dolores no WhatsApp) tem o próprio modelo, escolhido em Integrações › Anthropic (story
   `docs/stories/epics/epic-024-correcoes-16-11/S-11-modelo-por-funcao.md`). Função nova que use a IA ganha a própria
   linha nesse painel. Escolher modelo nunca liga a IA de função nenhuma.
4. A chave da Anthropic foi cadastrada pelo dono no painel em 16/11. Ela só é lida em dois pontos do código
   (`resolverCredencialIA` da maquete e `bloqueioAtual` da Dolores), vigiados por `server/integracoes-anthropic.test.ts`.

## Dolores e consentimento — decisões do dono em 17/11/2026 (REGRA)

1. **Confirmado pelo dono** ("As decisões pendentes minhas eu confirmo todas elas que você sugeriu"): (a) o texto que
   ele manda a Dolores gravar (tarefa, acompanhamento) fica com CPF/telefone em claro na fila e no registro; (b) o laço
   da Dolores roda no servidor do Prospecta com a chave do painel, e não no agente do Claude Console; (c) a ponte HTTP
   (`/api/dolores/ponte`) fica com dados pessoais mascarados por padrão (`DOLORES_PONTE_DADOS_PESSOAIS`).
2. **Termo de consentimento no primeiro acesso** (story `docs/stories/epics/epic-024-correcoes-16-11/S-12-termo-consentimento.md`):
   quem cria a senha do primeiro acesso aceita um termo curto. Regra de implementação combinada com o dono: **curto e
   rápido, nunca escondido** — caixa desmarcada por padrão, frase clara, link para o termo completo, aceite exigido
   também no servidor e registrado (quem, quando, versão). Nada de caixa pré-marcada, letra miúda ou aceite implícito:
   consentimento que a pessoa não percebe não vale pela LGPD.
3. **Limites do termo, que o dono precisa resolver com o jurídico:** ele cobre só quem cria login; clientes e leads do
   CRM que nunca acessam o sistema precisam consentir por contrato/ficha. O texto do termo é provisório até a revisão
   do jurídico (marcadores "[A PREENCHER PELO JURÍDICO]").
4. **Não decidido:** pedir o aceite a quem já tem senha, no próximo login — fica pronto e DESLIGADO até o dono mandar ligar.

## Dolores nos grupos — só responde quando é marcada (REGRA — estabelecida pelo dono em 17/11/2026)

Palavras do dono: "Nos grupos ela só pode responder quando ela for marcada, quando o número for marcado; em nenhum
outro momento ela deve responder as mensagens do grupo e deve apenas observar até ser marcada."

Respostas dele às duas perguntas feitas em seguida:
1. **Quem pode fazê-la responder:** qualquer pessoa do grupo que a marcar (inclusive cliente e empreiteiro).
2. **O que ela pode dizer no grupo:** só sobre o cliente/obra daquele grupo (andamento, pendências, documentos que
   faltam). Nunca dados de outros clientes, CPF, valores internos ou anotações da equipe. Nunca executa ação a partir
   do grupo.

Isto substitui a suposição anterior ("a Dolores não atende cliente / nunca responde em grupo"). Na prática, para
qualquer agente que mexer nisso (story `docs/stories/epics/epic-025-dolores/E4b-resposta-quando-marcada.md`):
- A marcação é reconhecida por código (o número dela na lista de menções da mensagem), nunca pelo texto.
- Quem marca é terceiro: nada do que escreve é comando. Comando continua só na conversa direta do dono.
- O escopo (um cliente só, sem dados pessoais nem valores) é travado no servidor, não no prompt.
- Sem marcação, grupo não cadastrado ou interruptor desligado: silêncio total.
- A segurança continua prioridade: interruptor próprio desligado por padrão, tetos por grupo e por remetente, portão de QA.

## WhatsApp — uma conexão só, feita em Integrações (REGRA — estabelecida pelo dono em 20/11/2026)

Palavras do dono: "Não, eu quero uma conexão só". O número conectado em Integrações é o da empresa: serve a Dolores E a
Central WhatsApp (atendimento). Isto substitui a ideia anterior de "número exclusivo da Dolores, separado da Central".

1. **A conexão é feita só em Configurações › Integrações** (QR code pela Evolution, ou API oficial da Meta). O bloco
   "Minha Conexão WhatsApp" sai da aba "Minha conexão" da Central para o admin; lá fica só "Conexões dos Corretores".
   Corretor e colaborador continuam conectando o próprio número na aba deles (não têm acesso a Integrações).
2. **A Central reflete essa conexão**: Conversas, Enviar mensagem e Templates usam o número conectado em Integrações.
3. **Quem trata cada mensagem que chega nesse número** (decidido por código, nunca pela IA):
   - conversa direta do número do dono → Dolores (comandos); nunca aparece na Central;
   - conversa direta de qualquer outro número → Central (atendimento humano); a Dolores não responde nem age;
   - grupos → Dolores, pelas regras de 17/11 e 19/11 (só quando marcada; só grupo que o dono adicionou).
4. **A Dolores continua sem enviar nada a cliente**: quem escreve ao cliente pela Central é gente da equipe. As
   respostas e os avisos da Dolores vão só ao número do dono (e ao grupo, quando marcada).
5. **API oficial da Meta**: é opção para a mesma conexão única, mas não entrega mensagens de grupo — com ela a Dolores
   não atua em grupos. A tela avisa isso antes de trocar.
6. Segurança continua prioridade: conversa do dono com a Dolores e avisos dela nunca ficam visíveis a corretor ou
   colaborador pela Central; só admin envia pela conexão da empresa, como já era.
