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

## Dolores — grupos entram sozinhos, por tipo (REGRA — estabelecida pelo dono em 19/11/2026)

Palavras do dono: "eu não quero ter que cadastrar grupo por grupo; todos os grupos que a Dolores participar é porque ela
deve participar […] esse número é exclusivo pra Dolores, então não vai existir entrada de grupos aleatórios".

Isto substitui o cadastro manual de grupo no painel (o painel passa a servir para ver e corrigir). Decisões dele:
1. **Só vale grupo em que a Dolores foi adicionada PELO NÚMERO DO DONO** (o número principal cadastrado em Integrações ›
   Dolores). Mudança do dono no mesmo dia 19/11, palavras dele: "somente o número principal, que no caso foi cadastrado meu
   lá na integração, pode adicionar o número da Dolores em grupo, e assim nós não corremos risco de qualquer pessoa adicionar
   ela em outros grupos". Provado por código (nunca pela IA nem pelo texto das mensagens): só há aceitação
   automática com PROVA POSITIVA — o autor do aviso `group-participants.update` da Evolution é o número do dono. Criar o
   grupo já com ela dentro NÃO prova (fica aguardando): o certo é criar o grupo e adicioná-la depois. Adicionada por outra pessoa, ou autor
   que não dá para provar → grupo **recusado** (não lê, não registra, não responde) e o dono recebe um aviso. Sem aviso
   nenhum (grupo antigo, aviso perdido) → **aguardando o dono**: só observa, muda, e pergunta a ele. Grupo recusado ou
   aguardando só é aceito pelo dono, no WhatsApp ("grupo <código> aceitar"), ou quando ele mesmo a adiciona — nunca pela
   tela, nem por outro admin. (Ajuste do portão de QA de 19/11: ser participante e admin do grupo NÃO prova quem a colocou.)
2. **O tipo do grupo é descoberto por código, pelo nome** (nunca pela IA, nunca pelo texto das mensagens):
   - nome igual ao de **um único** cliente do CRM → grupo de **cliente** ou **pós-atendimento** (vale a regra de 17/11:
     só fala daquele cliente);
   - nome com Jurídico, Administrativo, Parceiros ou Engenharia → grupo **interno** daquele tipo.
   Ela **avisa o dono no WhatsApp** o que entendeu de cada grupo novo; ele só responde se estiver errado.
3. **Nome que não bate com nada:** ela só observa e **pergunta ao dono** no WhatsApp; enquanto ele não responder, não
   fala nada naquele grupo.
4. **O que ela pode responder quando marcada, por tipo** (escopo travado no servidor, não no prompt):
   - **Administrativo (sócios):** tudo, menos senhas, tokens, chaves e dados bancários;
   - **Jurídico:** processos, regularizações e documentos;
   - **Engenharia:** obras, medições e notas;
   - **Parceiros comerciais (corretores e correspondentes):** só o andamento dos clientes que o próprio corretor que
     perguntou indicou — nunca cliente de outro parceiro;
   - **Cliente / pós-atendimento:** só aquele cliente (regra de 17/11).
5. Continua valendo em todos: só responde quando marcada; **nunca age a partir de grupo**; mensagem de grupo nunca é
   comando; mudar o nome do grupo depois não muda o tipo nem o vínculo sem o dono confirmar.
6. Story: `docs/stories/epics/epic-025-dolores/E7-grupos-automaticos.md`.

## WhatsApp — uma conexão só, atendimento e campanhas (REGRA — estabelecida pelo dono em 20/11/2026)

Palavras do dono: "Não, eu quero uma conexão só" e, ao aprovar a estrutura, "Autorizo os itens 1 a 7, pode executar".
O número conectado em Integrações é o da empresa: serve a Dolores E a Central WhatsApp. Isto substitui a ideia de
"número exclusivo da Dolores" e a regra "a Dolores nunca envia nada a cliente" (agora ela responde cliente cadastrado,
dentro dos limites do item 4). Story: `docs/stories/epics/epic-025-dolores/E9-conexao-unica-e-atendimento.md`.

1. **Conexão única, feita só em Configurações › Integrações** (QR code pela Evolution; a conexão que já existe é
   reaproveitada, sem novo QR). A Central (Conversas, Enviar mensagem, Templates) usa essa conexão. Na aba "Minha
   conexão" da Central, o admin vê só "Conexões dos Corretores"; corretor e colaborador continuam conectando o próprio
   número ali.
2. **Roteamento por código** (nunca pela IA) de quem escreve para o número da empresa:
   - número do dono → Dolores (comandos); nunca aparece na Central;
   - cliente já cadastrado (telefone de um único cliente em obra, financiamento, incorporação, regularização,
     avaliação ou jurídico) → Dolores responde sobre o caso dele (item 4) e a conversa aparece na Central;
   - número desconhecido → saudação da campanha ativa (item 3) e Central (atendimento humano);
   - grupos → Dolores, pelas regras de 17/11 e 19/11.
3. **Saudação de campanha**: texto salvo em Templates, uma campanha ativa por vez, enviado UMA vez por número por
   campanha a quem não está cadastrado; sem campanha ativa, nada sai. Texto fixo, sem IA.
4. **Dolores atende cliente cadastrado**: só sobre o caso daquela pessoa (andamento, pendências, documentos que faltam);
   sem valores em dinheiro; nunca age; nunca fala de outro cliente; telefone ligado a mais de um cadastro → equipe;
   quando alguém da equipe responde na conversa, ela fica calada nela por algumas horas; interruptor próprio desligado
   por padrão; teto de respostas por cliente por dia, dentro do teto de gasto.
5. **Ligação**: não é atendida; a pessoa recebe por texto que a Dolores não atende ligações e pode escrever.
   **Áudio**: transcrito (item 6) e respondido por texto; com a transcrição desligada ou falhando, o mesmo aviso
   pedindo para escrever. Aviso no máximo uma vez a cada poucas horas por pessoa; texto editável em Templates.
   Nos grupos, silêncio (só fala quando marcada).
6. **Transcrição de áudio pela Cloudflare (Workers AI, Whisper)**, faixa gratuita; chave cadastrada pelo dono em
   Integrações; limite de duração e de quantidade por pessoa por dia; interruptor desligado por padrão. O áudio vai a
   esse serviço: entra no termo de consentimento (pendência do jurídico).
7. **Preparado para dois canais**: receber tudo pelo WhatsApp Web (Evolution) e reservar a API oficial da Meta para
   disparos de campanha. A coexistência no mesmo número é FASE SEPARADA (credenciamento próprio na Meta), só depois de
   confirmar Brasil, grupos e requisitos; até lá, sem disparo em massa pelo número principal.
8. Continua valendo: só o número do dono comanda; mensagem de cliente ou de grupo nunca é comando; conversa do dono com
   a Dolores, avisos e relatórios dela nunca ficam visíveis a corretor/colaborador; chaves nunca saem.

## Tarefa manual do dono — sempre em passo a passo e com links (REGRA — estabelecida pelo dono em 20/11/2026)

Palavras do dono: "Se eu tiver que fazer algo manual me mande sempre em passo-a-passo e com links".

Vale para qualquer agente: tudo o que depender de ação dele (painéis da Vercel, Meta, YCloud, Cloudflare, WhatsApp,
telas do próprio Prospecta) é entregue em passos numerados, um clique por passo, com o link direto da página e o nome
exato do botão ou campo — e dizendo o que ele deve ver ao final. Nunca "configure X" sem o caminho.

Do mesmo dia: quando ele pedir para "estruturar para eu autorizar", apresentar a estrutura e ESPERAR o "autorizo"
antes de construir.

## Dolores "Jarvis", grupos na Central e YCloud — decisões do dono em 20/11/2026 (noite) (REGRA)

Estrutura apresentada e autorizada por ele ("Autorizo"). Epic: `docs/stories/epics/epic-027-correcoes-20-11-noite/EPIC.md`.

1. **Referência de conversa** — palavras do dono: "eu quero algo igual ao Jarvis" e "como se eu tivesse conversando com o
   ChatGPT do meu próprio negócio […] resolver problemas dentro do meu negócio e não simplesmente ter programações". Na
   conversa com o dono a Dolores fala natural e curto, nunca mostra nome de ferramenta nem código interno, lembra do
   contexto ("ela", "esse grupo") e RESOLVE pelo WhatsApp em vez de mandar ir à tela. Confirmação proporcional:
   consultar → direto; registrar (nota, tarefa, vínculo) → um "pode"; sério (dinheiro, apagar, mensagem a cliente) →
   confirmação explícita.
2. **Grupos na Central WhatsApp** — aparecem TODOS os grupos; veem o admin e o colaborador que tiver a permissão própria
   marcada no cadastro; o humano pode escrever no grupo pela Central, "exatamente igual faz na conversa". Isto substitui o
   trecho da regra de 20/11 (manhã) de que grupos nunca aparecem na Central. A conversa direta do dono com a Dolores
   continua fora da Central. O que um humano escreve no grupo não é comando para ela.
3. **Classificar grupo é SÓ do dono/admin** — correção do dono em 21/11/2026, palavras dele: "eu disse que o colaborador
   pode ter acesso às mensagens do grupo assim como as mensagens dos clientes, mas em nenhum momento eu falei que ele iria
   classificar". O colaborador com a permissão de grupos só VÊ as mensagens e ESCREVE no grupo. Classificar (tipo e
   vínculo) é do admin pela tela e do dono pelo WhatsApp; aceitar grupo em que outra pessoa a colocou (recusado / sem
   prova) continua SÓ do dono, pelo WhatsApp (regra de 19/11). Nunca dar a colaborador poder de classificar, vincular
   ou aceitar grupo. (Uma leitura errada da resposta dele em 20/11 chegou a ser implementada e foi desfeita antes de
   publicar — não repetir: na dúvida sobre o alcance de uma permissão, perguntar.)
4. **Agir a partir de grupo** — liberado SÓ quando o NÚMERO DO DONO pede, e SÓ para registrar (salvar nota, orçamento,
   documento). Nunca dinheiro, nunca mensagem a terceiro. Ajusta o item 5 da regra de 19/11; para todos os demais,
   mensagem de grupo continua nunca sendo comando.
5. **Proatividade** — "tudo o que achar relevante". Cuidados aceitos por ele: a relevância é decidida por REGRAS do
   sistema (a IA só escreve o aviso); avisos parecidos agrupados; ele pode silenciar um tipo; função com limite próprio.
6. **Gasto separado por função** — "cada função com seu gasto": conversa com o dono, resposta em grupo, atendimento a
   cliente, classificação de documentos e proatividade, cada uma com limite e modelo próprios, e a tela mostra o consumo
   de cada. Uma função não consome o crédito da outra.
7. **Maquete 3D — leitura pela IA** — roda em lote na Anthropic (segundo plano); tentativa sem resultado não é cobrada
   nem conta no teto; manter o modelo escolhido pelo dono, sem reduzir qualidade por conta própria. Queixa dele que
   originou a mudança: "acabei consumindo meus créditos à toa".
8. **YCloud (API oficial, coexistência)** — número vinculado pelo dono em 20/11 (conta "VFX Capital"). Disparos de
   campanha saem pela API oficial, por modelo aprovado; conversas, grupos e a Dolores continuam pela Evolution (não
   assinar mensagem recebida na YCloud). Cada vinculação/desvinculação na YCloud DERRUBA a Evolution: religar pelo QR em
   Integrações e tocar em "Reativar recebimento". A vinculação só fecha em COMPUTADOR (no iPad a janela da Meta conclui e
   a YCloud não recebe o retorno; a tradução automática do navegador quebra o formulário).

## EPIC-027 — respostas e autorização do dono em 21/11/2026 (REGRA)

**Autorização** (palavras do dono, 21/11/2026, depois da revisão geral que ele pediu): "Tudo autorizado pode fazer a migração
e na sequência fazer a produção de todos e todas as correções definidas até aqui que não pare até concluir tudo". Vale para as
frentes do EPIC-027 definidas até essa data (grupos e Dolores C3/C4/C6, grupos na Central C2, Dolores natural C5 com todas as
etapas e a memória de longo prazo, YCloud C7/C7.1, logotipo por IA C8): migrações aditivas no Neon, merge na `main` e
conferência da Vercel, sem pedir de novo. O portão de QA continua obrigatório antes de cada publicação; apagar/alterar dados,
remover tabela/coluna, credenciais e serviço pago novo continuam exigindo confirmação.

**Respostas dele às dúvidas (não perguntar de novo):**
1. **O nome é Dolores.** "Jarvis" foi só referência de comportamento; não usar esse nome em tela, texto, story nem conversa.
2. **Grupos na Central**: quem já tem o módulo "WhatsApp" marcado (admin ou colaborador) vê os grupos direto — sem campo novo
   de permissão; vê TODOS (inclusive sócios e jurídico), escreve e usa Assumir/Devolver. Corretor não vê. Classificar grupo
   continua só do admin (tela) e do dono (WhatsApp).
3. Grupo aceito e com tipo definido já nasce respondendo quando marcado. Resposta só com número vale ("4 sim" para sócios e
   jurídico). Obra excluída → grupo calado até reclassificar.
4. **Memória da conversa do dono**: últimas 100 mensagens, por 6 horas. **Memória de longo prazo dentro do sistema**: sim —
   fatos e preferências permanentes, com tela para ver, corrigir e apagar (etapa da C5; não usar ferramenta externa).
5. Criar tarefa/anotação: a Dolores pede "pode". Ação séria: pede "confirmo". A partir de grupo: só quando o número do dono
   pede, e só para REGISTRAR; o grupo vê uma frase curta ("Anotado.").
6. Proatividade: tudo o que for relevante, decidido por REGRAS do sistema (a IA só escreve), agrupado, de segunda a sábado,
   das 07h às 20h, no máximo 6 por dia; ele pode silenciar um tipo.
7. Gasto da Dolores separado por função: conversa 55%, documentos 20%, grupos 10%, clientes 10%, avisos 5%.
8. **Campanha pela API oficial (YCloud)**: dispara o admin ou o colaborador com o módulo WhatsApp; chave, liga/desliga e
   limites são só do admin. Não repetir o mesmo modelo ao mesmo contato em 7 dias; 200 por dia.
9. Leitura de planta da maquete pode levar minutos (em segundo plano); cancelar: admin e colaborador com o módulo.
10. Nomes "da empresa" (ninguém de fora pode se passar por eles nos grupos): Prospecta, Central Efficaz, Efficaz, VFX Capital
    e Exclusive.
11. **Logotipo por IA** (pedido de 21/11): o botão da Incorporação usa a chave da Anthropic do painel (desenho em SVG), com
    linha própria em Integrações › Anthropic. Serviço pago de imagem só com autorização dele.
12. OpenClaw: não substitui nem é substituído; a Dolores é o cérebro do negócio dentro do Prospecta, com as travas. Avaliar
    OpenClaw só se ele pedir, e apenas como assistente pessoal pela ponte de leitura.

## Decisões do dono em 21–22/11/2026 — Dolores, maquete nova e processo (REGRA)

1. **Plano da Dolores aprovado** ("Tudo aprovado menos sobre o CARAXES"): resolver com "pode"/"confirmo"; anotar a partir do
   grupo quando o dono pede; gasto por função (55/20/10/10/5) com alerta em 80% do teto; memória de longo prazo no sistema com
   tela; avisos proativos; análise de regularização com roteiro de REURB; tarefa demorada sem travar; "criadora de mesas";
   mesa comercial ligada à maquete. **CARAXES (Obsidian no Drive) FORA** até o plano dele ser desenhado com o dono — não
   executar nada ligado a ele. Ficam fora também: Kapso/n8n, agente hospedado ("plano B", guardado no HANDOFF), escritório 3D,
   servidor MCP de escrita e vídeo por IA.
2. **Confirmação na conversa**: só texto escrito pelo número do dono confirma. **Áudio dizendo "pode" não confirma.** Trocar tipo
   ou vínculo de grupo já definido pede "confirmo". O "pode" vale sempre para o ÚLTIMO pedido feito.
3. **Sem tarefa manual quando o sistema pode fazer**: o que der para fazer com o que já está guardado no servidor (ex.: enviar
   modelo da YCloud com a chave cifrada), o sistema faz. **Botão novo só se nenhum existente servir** — palavras dele: "esses
   botões que têm aí já são mais do que o necessário; coloque a função dentro de um deles".
4. **Frentes em paralelo**: ele pediu várias frentes ao mesmo tempo com agentes do AIOX. A publicação continua uma por vez, com
   portão de QA; migração aditiva e produção a cada etapa estão autorizadas também para a maquete nova (EPIC-028).
5. **Maquete nova (EPIC-028) — custo zero**: sem IA paga para ler a planta nem para desenhar; Higgsfield só ferramentas
   gratuitas (opcional; 10 créditos, não gastar). Cada planta vira um JSON em `data/plantas/` feito em sessão; o PDF do cliente
   não entra no repositório. Decisões da planta do Lote 4 Qd 18: telhado do protótipo (20%, platibanda 1,15 m); balcão de
   1,10 m; **porta de correr: a folha que ABRE fica do lado oposto ao sofá** (regra geral para as próximas plantas); portão de
   correr; link público por lote com código não adivinhável; WhatsApp da empresa (99) 98139-2210.
6. **Revisor automático do GitHub (Codex)**: comenta em todo PR. Antes de mesclar, esperar a revisão ficar "Completed" e ler
   `get_review_comments`; achado real é corrigido (o de segurança, antes de publicar). Em 22/11 uma mesclagem saiu 4 segundos
   antes de a revisão terminar — não repetir.
7. O nome é **Dolores** (nunca "Jarvis" em tela, texto ou conversa).
