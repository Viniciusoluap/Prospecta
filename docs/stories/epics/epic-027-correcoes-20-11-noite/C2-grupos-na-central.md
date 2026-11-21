# C2 — Grupos do WhatsApp na Central, com permissão por colaborador e escrita

Status: InReview (ramo `epic027-c2`, criado de `epic027-d`; implementada, aguarda o portão de QA de segurança).
Epic: EPIC-027 — Correções de 20/11/2026 (noite) (`EPIC.md`).
Paridade: a Central WhatsApp existe no Grupo Santa Fé — pendência registrada no ROADMAP (seção EPIC-027). A parte da Dolores
(resposta quando marcada, classificar grupo, "Assumir" calando a Dolores) é exceção.
Migração: `drizzle/0142_grupos_na_central.sql` (aditiva e idempotente; NÃO aplicada). Depois da rodada de 21/11 a ordem não importa: o código tolera o banco sem ela. Convive com a `0144` do `epic027-d` (o banco de teste aplica 0139 → 0144 → 0142, cada uma duas vezes).

## Pedido do dono (20/11/2026, noite)
"Aqui nas mensagens do WhatsApp também deve aparecer as mensagens do grupo para que o humano possa intervir". Respostas dele:
(1) quem vê: "Somente o Admin e os colaboradores que tiverem esse campo selecionado lá na hora do cadastro dele, conforme qualquer
outra função que ele só pode visualizar se for liberado pra ele"; (2) quais grupos: "Todos"; (3) intervir: "Pode escrever,
exatamente igual faz na conversa".

## Critérios de aceite
- [x] AC1 — Permissão nova "Grupos do WhatsApp" no cadastro do usuário (Configurações › Usuários e acesso), no mesmo mecanismo
      dos módulos: a chave `whatsappGrupos` em `ADMIN_MODULES` (`shared/admin-permissions.ts`), gravada no JSON de
      `users.permissions` como os demais — sem migração para ela. Desmarcada por padrão. A tela do cadastro mostra, junto dos
      módulos (novo usuário e "Gerenciar acesso"): "quem tiver esta permissão vê TODOS os grupos da empresa na Central WhatsApp,
      inclusive o dos sócios (administrativo) e o jurídico, e pode escrever neles. Precisa também do módulo WhatsApp."
- [x] AC2 — Conferida no SERVIDOR em toda rota de grupo (`whatsappGrupos.*`, `server/whatsapp-grupos-central.ts`), por
      procedimento próprio (`podeVerGruposNaCentral`, `shared/whatsapp/grupos-central.ts`): admin ativo sempre; colaborador ativo
      com o módulo WhatsApp E a permissão; corretor, cliente, empreiteiro, inativo: FORBIDDEN; anônimo: UNAUTHORIZED. O router
      fica fora de `whatsapp.*` de propósito (o `adminProcedure` só confere módulo e deixa o corretor entrar em `whatsapp.*`).
- [x] AC3 — Lista: na aba Conversas da Central, "Conversas | Grupos" (a aba Grupos só aparece para quem pode). Grupos da instância
      da empresa em `dolores_grupos`, ativos; recusado nunca aparece (nem por id); "aguardando o dono" só para o admin, marcado.
      Cada grupo com ícone, nome, tipo (rótulo da lista única do C3), cliente/obra ligado e a última mensagem. Grupo invisível
      para o usuário responde igual a grupo inexistente (sem oráculo). O código do comando do dono só vai ao admin.
- [x] AC4 — Leitura: as mensagens com o NOME de quem enviou, horário e mídia como rótulo ("[imagem]", "[áudio]", "[documento] nome",
      com a legenda), mais as respostas da Dolores no grupo ("Dolores") e o que a equipe escreveu pela Central ("equipe — Fulano").
      60 por vez; "Ver mensagens anteriores" pagina para trás.
- [x] AC5 — Escrever: caixa de envio igual à da conversa; só texto; sai pelo número da empresa via Evolution para o JID do grupo,
      sem citação, sem prévia de link e sem menção a ninguém (`enviarTextoDaEquipeAoGrupoEvolution`). Registrada com QUEM enviou
      (`whatsapp_grupo_envios`: id e nome do usuário daquele momento, id da mensagem, situação). Tetos do envio manual da empresa
      (10/min, 200/dia, `reservarEnvioManualDaEmpresa`) antes do envio; auditoria em `dolores_acoes` ("grupo_central_envio", sem o
      texto; quem enviou no resumo). Grupo cujo autor da adição não foi provado (espera o dono aceitar): só leitura.
- [x] AC6 — Não é comando: a mensagem da Central não marca a Dolores (não leva menção) e o eco chega como mensagem da própria conta
      (fromMe), que o registro de grupo e a marcação já ignoram — não vira marcação, não vira mensagem de terceiro, não duplica (a
      leitura também descarta, por id, qualquer eco que venha a ser registrado). A conversa direta do dono com a Dolores, avisos e
      relatórios dela continuam fora da Central (grupo nunca entra em `whatsapp_messages`; rotas de conversa intocadas).
- [x] AC7 — Classificar pela Central: botão "Definir tipo" na tela do grupo, com a MESMA rota (`dolores.grupos.definirTipo`) e a
      MESMA lista (`CATEGORIAS_GRUPO`), filtrada para o colaborador por `colaboradorPodeClassificar` (travas do C3: só grupo não
      identificado/sem vínculo, só cliente/pós/engenharia de uma obra; tipos de admin só admin; aceitar recusado/sem prova só o dono
      no WhatsApp — a tela não tem "aceitar" nem "ignorar"). O dono recebe o aviso no WhatsApp (já era do C3).
- [x] AC8 — "Assumir (humano)" / "Devolver para a Dolores" por grupo (`whatsapp_grupo_atendimento`): assumir = ela não responde nem
      quando marcada até devolverem (`grupoLigado` em `server/dolores/marcacao.ts` confere primeiro; falha ao ler = calada);
      devolver só tira a trava da equipe — volta a valer o interruptor do grupo e o geral, nunca liga nada. Admin e colaborador com a
      permissão; auditoria "grupo_central_atendimento". Tocar nunca envia nada.

## O que passou a ser guardado das mensagens de grupo
- O texto/legenda já era guardado em `dolores_grupo_mensagens.texto` (uma linha, com o filtro do registro: CPF, telefone e afins
  MASCARADOS; senhas, tokens e dados bancários sempre). A Central mostra esse texto como está — não foi criada cópia sem máscara.
- NÃO havia o nome de quem escreveu (só o número mascarado). A partir da 0142, `dolores_grupo_mensagens.nome_remetente` guarda o nome
  que o participante usa no WhatsApp (pushName), filtrado (uma linha, sem colchetes, filtro do registro, até 80 caracteres) e
  imutável como o resto da linha. O histórico NÃO é puxado: mensagens antigas aparecem com o número mascarado.
- O que for escrito no grupo direto pelo celular da empresa (mensagem da própria conta) continua sem registro — só aparecem as
  respostas da Dolores e o que a equipe escreveu pela Central. A tela avisa isso.

## Migração 0142 (aditiva; aplicar ANTES de publicar)
- `ALTER TABLE "dolores_grupo_mensagens" ADD COLUMN IF NOT EXISTS "nome_remetente" varchar(80)` e a função de guarda da 0126 recriada
  igual + a coluna nova (o nome não muda depois).
- `whatsapp_grupo_envios` (grupo, instância, id da mensagem, texto, situação enviada/falhou, quem enviou e o nome dele) e
  `whatsapp_grupo_atendimento` (grupo, modo humano/dolores, quando, quem).
- Por que antes: o registro das mensagens de grupo passa a gravar `nome_remetente`; com o código novo e o banco velho, a mensagem de
  grupo não é registrada (e a Dolores, sem a tabela de atendimento, fica calada nos grupos — falha fechada).

## Decisões
- [AUTO-DECISION] A permissão é uma chave nova em `ADMIN_MODULES` (e não um campo separado) → (reason: "conforme qualquer outra
  função"; mesmo cadastro, mesma gravação, mesma checagem; não aparece no menu porque não tem página própria).
- [AUTO-DECISION] Exigir também o módulo WhatsApp → (reason: a aba fica dentro da Central, que é o módulo WhatsApp).
- [AUTO-DECISION] "Aguardando o dono" só para o admin (conforme a ordem da tarefa); por isso o colaborador classifica pela Central
  só os grupos aceitos que vê (ex.: grupo de cliente ainda sem vínculo). O "não identificado · aguardando o dono" continua com o
  admin/dono (cartão em Integrações ou WhatsApp).
- [AUTO-DECISION] Escrever em grupo "sem prova de quem colocou a empresa" bloqueado para todos → (reason: o número pode ter sido
  posto num grupo por outra pessoa; até o dono aceitar, só leitura). Grupo que o dono pôs e só falta o tipo: o admin escreve.
- [AUTO-DECISION] A resposta da equipe no grupo NÃO cala a Dolores por horas (diferente da conversa direta) → (reason: no grupo ela
  só fala quando marcada; para calar, há o "Assumir (humano)").
- [AUTO-DECISION] Só texto nesta entrega; mídia fica pendente → (reason: o envio de mídia da conversa comum não é reaproveitável
  sem mexer nele).

## Pendências
- Envio de mídia (imagem, áudio, documento) ao grupo pela Central.
- Contador de não lidas por grupo (hoje o grupo não tem "lida" por usuário).
- Registrar o que for escrito no grupo direto pelo celular da empresa (hoje a mensagem da própria conta é ignorada de propósito).
- O cartão da Dolores em Integrações não mostra o "assumido pela equipe" no interruptor do grupo (a Central mostra).
- Porte da Central (parte de grupos) ao Grupo Santa Fé — ROADMAP.

## Riscos
- O nome do participante (pushName) é escolhido por ele: pode ser enganoso ("Dono", "Equipe"). Aparece filtrado e só como rótulo;
  o "(dono)" ao lado vem do número, por código.
- A permissão dá acesso a TODOS os grupos, inclusive sócios e jurídico (decisão do dono; aviso no cadastro).
- Publicar sem aplicar a 0142 quebra o registro das mensagens de grupo e cala a Dolores nos grupos (falha fechada).

## Testes
- (a) automáticos: `server/dolores/c2-grupos-na-central.test.ts` (16): permissão (cadastro, regra pura e as 5 rotas novas via
  appRouter para admin, colaborador com e sem a permissão, só com a permissão sem WhatsApp, inativo, corretor, cliente, empreiteiro,
  "user" e anônimo); recusado/desativado/outra instância nunca aparecem e "aguardando o dono" só ao admin (lista e por id); nome do
  participante, mídia como rótulo, CPF mascarado, imutável; paginação 60 + anteriores; conversa do dono nunca aparece e grupo nunca
  entra nas conversas diretas; envio com autor, corpo sem menção/citação, auditoria sem texto; tetos 10/min e 200/dia; falha
  registrada e desconectado; eco (fromMe, até com menção) não registra, não marca, não responde, não duplica — e a marcação real
  continua funcionando; estático do envio a grupo; assumir/devolver (cala e não liga nada); classificar pela Central com as travas
  do C3; 0142 aditiva e idempotente. `server/admin-permissions.test.ts` ajustado (lista de módulos).
  Rodada completa em 21/11: `server/dolores` inteira + suítes do WhatsApp, permissões, consentimento, modelo por função, relatórios e
  maquete — 62 arquivos, 1.102 testes, todos passando; `auth-session` + `imports-esm` (build da Vercel) passando; `npx tsc --noEmit`
  limpo; `npx vite build` ok.
- (b) manuais: pendentes (tela).
- (c) em produção: pendentes — aplicar a 0142, abrir Conversas › Grupos como admin e como colaborador com e sem a permissão,
  escrever num grupo de teste e conferir o "equipe — Fulano" e que a Dolores não respondeu.

## Arquivos
- `shared/admin-permissions.ts`, `shared/whatsapp/grupos-central.ts`, `shared/dolores/grupos.ts`
- `drizzle/0142_grupos_na_central.sql`, `drizzle/schema-whatsapp-grupos.ts`, `drizzle/schema-dolores-grupos.ts`, `drizzle.config.ts`
- `server/whatsapp-grupos-central.ts`, `server/routers.ts`, `server/_core/evolution.ts`, `server/dolores/grupos.ts`,
  `server/dolores/marcacao.ts`, `server/dolores/grupo-assumido.ts`, `server/dolores/testes-banco.ts`
- `client/src/components/whatsapp/GruposWhatsApp.tsx`, `client/src/components/whatsapp/ConversasWhatsApp.tsx`,
  `client/src/pages/admin/AdminConfiguracoes.tsx`
- `server/dolores/c2-grupos-na-central.test.ts`, `server/admin-permissions.test.ts`
- `docs/stories/epics/epic-027-correcoes-20-11-noite/EPIC.md`, `docs/stories/epics/ROADMAP.md`

## Change Log
- 21/11/2026 — @dev (Dex): Draft → InProgress → InReview. Implementada no ramo `epic027-c2`.

## Rodada de correção de 21/11 (mudança de regra do dono + portão de QA)
- **Regra nova do dono (21/11):** "eu disse que o colaborador pode ter acesso às mensagens do grupo assim como as mensagens dos
  clientes, mas em nenhum momento eu falei que ele iria classificar". O colaborador com "Grupos do WhatsApp" VÊ, ESCREVE e usa
  Assumir/Devolver; classificar grupo é SÓ do admin (tela) e do dono (WhatsApp). `epic027-d` mesclado (rota `definirTipo` só admin
  com recusa genérica, filtro por instância, sem reativar desativado, `0144`); na Central o "Definir tipo" só aparece para
  `role === "admin"`; `colaboradorPodeClassificar` não é mais usado. Isto substitui o AC7 e a decisão sobre classificação acima.
- Achado 2 (médio, ordem da 0142) — corrigido: a coluna `nome_remetente` saiu da definição principal da tabela (os `select()`
  completos não quebram sem ela) e é gravada logo depois do registro, em separado, por `server/dolores/grupo-mensagens-nome.ts`
  (coluna ausente, 42703 → registra sem o nome); a guarda da 0142 deixa preencher o nome UMA vez e nunca trocar.
  `grupo-assumido.ts`: tabela ausente (42P01) = "não assumido". A Central lê sem as tabelas novas; escrever e assumir respondem
  PRECONDITION_FAILED antes de enviar qualquer coisa.
- Achado 3 (baixo) — corrigido: nome de participante que imita a Dolores, a equipe ou a empresa ("Dolores", "D0lores", "equipe …",
  "Prospecta") volta marcado "Fulano (participante)" (`nomeImitaQuemNaoE`, `autorDoParticipante`); a origem vai explícita no retorno
  e a tela diferencia por ela (ícone, cor, "· participante"), não pelo nome.
- Achado 4 (baixo) — corrigido: na leitura pela Central TODO texto (participante, equipe, Dolores; lista e conversa) passa pelo filtro
  do registro; o que sai ao grupo é o texto original. A frase da tela diz "em todas as mensagens".
- Achado 5 (baixo) — corrigido: gatilho de imutabilidade em `whatsapp_grupo_envios` (na 0142): sem DELETE/TRUNCATE e sem UPDATE; só
  `enviado_por` pode virar NULL (usuário excluído; o nome daquele momento fica).
- Engenheiro com a permissão NÃO vê grupos (mantido de propósito: só admin e colaborador).
- Testes: `c2-grupos-na-central.test.ts` (colaborador FORBIDDEN em `definirTipo` em qualquer caso; guardas da 0142) e
  `epic027-c2-qa-seguranca.test.ts` (os "ACHADO" invertidos para "CORRIGIDO").

## Portão de QA, rodada 2 (21/11) — PASS com ressalvas baixas; B1 e B2 fechadas
- B1 — corrigido: `nomeImitaQuemNaoE` compara pela forma compacta (`formaCompacta`: NFKC, minúsculas, sem diacríticos, homógrafos
  cirílico/grego e dígitos → latim, só as letras a–z; laço por caractere, tempo linear, sem regex com retrocesso). Marca "(participante)"
  quem contém "dolores" ou "equipe", um dos nomes da empresa (`NOMES_DA_EMPRESA`, lista única: "Prospecta", e — a confirmar pelo dono —
  "Central Efficaz", "Efficaz", "Eficaz", "VFX Capital") ou tem nome IGUAL ao de um usuário ativo da equipe (admin/colaborador, lido do
  cadastro no servidor). Provas: "Dоlores" (cirílico), "D o l o r e s", "D.o.l.o.r.e.s", largura total, nome de usuária; teste de tempo.
- B2 — corrigido: se a gravação em `whatsapp_grupo_envios` falhar depois que a Evolution aceitou, a rota tenta mais 2 vezes (150 ms e
  300 ms); se ainda falhar, a auditoria (`dolores_acoes`, "grupo_central_envio", sem o texto) guarda quem enviou (id e nome), o grupo e
  o id da mensagem, e a tela recebe o aviso "A mensagem saiu para o grupo, mas o registro no sistema falhou…". Nunca há mensagem no
  grupo sem autor registrado.
- B3 — documentado, sem mudança de código (decisão do portão): ressalva baixa mantida como risco aceito. `grupoAssumidoPelaEquipe`
  só libera com "tabela inexistente" (42P01); coluna faltando, permissão negada ou qualquer outro erro continuam calando a Dolores no
  grupo (falha fechada, provada em `epic027-c2-qa-seguranca-r2.test.ts`).
- Ajuste dos nomes da empresa: pendência do dono (confirmar a lista em `shared/whatsapp/grupos-central.ts`).
