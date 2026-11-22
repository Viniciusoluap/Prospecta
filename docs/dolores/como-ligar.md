# Como ligar a Dolores (Etapa 1 — Leitura; Etapa 2 — WhatsApp, no fim)

Passos do dono. O que está marcado **[confirmar na tela]** depende de telas de terceiros (Vercel, Claude Console)
que podem ter mudado de nome ou lugar: siga o sentido do passo e confira o rótulo na tela.

## 1. Gerar o token da ponte
O token é a senha que o agente usa para falar com o sistema. Precisa ter **pelo menos 32 caracteres** — mais curto, a
ponte fica desligada (resposta 503 e aviso no log, sem o token). Gere direto num arquivo, sem que ele apareça na tela
nem no histórico do terminal:

```
openssl rand -hex 32 > ~/.dolores-token && chmod 600 ~/.dolores-token
```

Para colar na Vercel, abra o arquivo num editor e copie. Guarde-o também num cofre de senhas. Ele nunca deve ir para
mensagem, planilha ou print.

## 2. Cadastrar o token na Vercel
1. Vercel → projeto do Prospecta → **Settings → Environment Variables** [confirmar na tela].
2. Nova variável: nome `DOLORES_PONTE_TOKEN`, valor = o token do passo 1, ambiente **Production**.
3. Publicar de novo (Redeploy) para a variável valer. Sem essa variável a ponte recusa tudo (resposta 503).
   Trocar ou apagar a variável também só vale depois de um novo Redeploy.

## 3. Banco (feito pela equipe técnica, já autorizado)
Aplicar no Neon a migração aditiva `drizzle/0123_dolores_acoes.sql` (cria `dolores_acoes`, `dolores_config` e
`dolores_limite`).
A usuária "Dolores (funcionária digital)" é criada sozinha na primeira chamada: sem senha, sem e-mail, sem acesso ao painel.

## 4. Conferir a ponte
Endereços (troque pelo domínio de produção):
- `GET  https://<domínio>/api/dolores/ferramentas` — lista as funções liberadas.
- `POST https://<domínio>/api/dolores/ponte` — executa uma função.

Teste (o cabeçalho é lido de um arquivo, então o token não fica no histórico do terminal):

```
printf 'Authorization: Bearer %s\n' "$(cat ~/.dolores-token)" > ~/.dolores-cabecalho && chmod 600 ~/.dolores-cabecalho
curl -s https://<domínio>/api/dolores/ferramentas -H @"$HOME/.dolores-cabecalho"
curl -s -X POST https://<domínio>/api/dolores/ponte -H @"$HOME/.dolores-cabecalho" \
  -H "Content-Type: application/json" \
  -d '{"funcao":"listar_processos_regularizacao","argumentos":{"situacao":"atrasados"}}'
rm ~/.dolores-cabecalho
```

Resposta esperada: `"ok": true` e os processos. Cada chamada fica registrada em `dolores_acoes`.

## 5. Criar o agente no Claude Console
1. Claude Console (console.anthropic.com), com créditos na conta [confirmar na tela onde ficam agentes/Workbench].
2. Criar o agente e colar como instrução de sistema o texto de `docs/dolores/agente-etapa1.md` (a partir de
   "Você é a Dolores").
3. Cadastrar as ferramentas com o conteúdo de `ferramentas-etapa1.json` (cada item tem `name`, `description` e
   `input_schema`, o formato de ferramenta da API da Anthropic).

**Ponto a confirmar antes de contar com o passo 5:** na API da Anthropic, quem executa uma ferramenta própria é o
programa que chama o modelo — o modelo devolve "chame `listar_tarefas` com estes argumentos" e alguém precisa fazer a
chamada HTTP à ponte e devolver o resultado. Se o Console permitir cadastrar um endereço HTTP com cabeçalho de
autorização para as ferramentas, registre ali a URL da ponte e o token (`Authorization: Bearer <TOKEN>`). Se não
permitir, quem fará esse papel é o próprio sistema, na **Etapa 2** (a Central de WhatsApp recebe a mensagem do dono,
chama o modelo com estas ferramentas, executa cada chamada na ponte e devolve a resposta). Nesse caso, o Console serve
nesta etapa para testar o prompt no Workbench, colando à mão o resultado da ponte (passo 4).

## 6. Teste de aceite
Pergunta ao agente: "Dolores, analise todos os processos de regularização e informe os atrasados, pendências,
responsáveis e próximas providências." A resposta deve citar a função de cada dado e marcar "a confirmar" nos
processos migrados do Trello sem responsável.

## Pausar
A pausa fica em `dolores_config.pausada` (a tela com o botão chega na etapa 6). Enquanto não houver tela, a equipe
técnica pausa com `UPDATE dolores_config SET pausada = true, motivo_pausa = '...' WHERE id = 1;` — com a pausa ligada a
ponte recusa tudo (resposta 423). Outras formas de parar:
- **desativar a usuária "Dolores (funcionária digital)"** em Usuários e acesso — vale na hora (resposta 503). Ela não
  pode ser apagada depois de ter ações registradas (o registro de ações é preservado); desativar é o caminho;
- apagar a variável `DOLORES_PONTE_TOKEN` na Vercel — só vale **depois de um novo Redeploy**.

---

# Etapa 2 — WhatsApp (comando e resposta pelo número do dono)

Na etapa 2 quem chama o modelo e executa as ferramentas é o próprio sistema (a dúvida do passo 5 acima fica resolvida
assim): o dono escreve para o número da Dolores, o sistema confere que a mensagem veio do número dele, chama a Anthropic
com as ferramentas de leitura, executa cada consulta pela mesma porta da ponte (com a mesma auditoria) e responde no
WhatsApp. **Não é preciso criar agente no Claude Console nem cadastrar o token da ponte para o WhatsApp funcionar** — o
token continua servindo só para chamadas HTTP diretas à ponte.

A IA começa **desligada** e só liga quando o administrador aperta "Ligar a IA" depois de cumprir os passos abaixo. Desligada,
pausada ou sem limite, a Dolores responde ao dono uma frase fixa ("estou desligada… Nada foi consultado.") e não gasta nada.

## Diferença em relação ao prompt mestre — para o dono confirmar

**O que mudou.** O prompt mestre (seção 2) diz que o "cérebro" da Dolores é um agente criado no Claude Console. Nesta
etapa, o cérebro roda **dentro do próprio sistema Prospecta**: quando o dono escreve no WhatsApp, o servidor do sistema
chama o modelo da Anthropic com a chave cadastrada em Integrações › Anthropic, recebe os pedidos de consulta do modelo,
executa cada um pela mesma porta da ponte da etapa 1 e devolve a resposta no WhatsApp. Não há agente no Console.

**Por quê.** Na API da Anthropic, quem executa uma ferramenta é o programa que chama o modelo — o modelo só diz "consulte
isto". Um agente no Console não recebe mensagens do WhatsApp nem consegue, sozinho, chamar a ponte do sistema; alguém
teria de fazer essa ponte entre o WhatsApp, o modelo e as consultas. Fazendo isso no próprio sistema: (1) o comando do
dono, a conferência do número e o envio da resposta ficam no mesmo lugar, com a mesma auditoria (`dolores_acoes`);
(2) o limite mensal de gasto, os tetos por pedido e o prazo de 60 s são controlados pelo sistema; (3) o token da ponte
não precisa sair do sistema. O texto de instrução da Dolores (`agente-etapa2.md`) é o mesmo que iria para o Console.

**O que continua igual.** O modelo é o da Anthropic, escolhido por você em Integrações › Anthropic; as ferramentas são as
mesmas da etapa 1 (só leitura); nenhuma escrita no sistema.

**A IA só liga com o seu interruptor.** Cadastrar a chave não liga nada: a Dolores só chama a Anthropic depois que um
administrador aperta "Ligar a IA" em Integrações › Dolores (desligada por padrão), com número do dono, chave, modelo e
limites mensais cadastrados, sem pausa. Se preferir o agente no Console, basta não ligar o interruptor e avisar a equipe
— nada é gasto enquanto ele estiver desligado.

## 1. Banco (equipe técnica, já autorizado)
Aplicar no Neon a migração aditiva `drizzle/0124_dolores_whatsapp.sql` (cria `dolores_whatsapp_config`,
`dolores_mensagens`, `dolores_consumo` e `dolores_remetentes_estranhos`; não altera nenhuma tabela anterior). Depois, publicar.

## 2. Chave e modelo da Anthropic (o dono)
1. Claude Console (console.anthropic.com) → conta da Prospecta com créditos → **API Keys** → criar uma chave
   [confirmar na tela]. Copie a chave (começa com `sk-ant-`); ela não aparece de novo.
2. No sistema: **Integrações › Anthropic — Inteligência Artificial** → "Adicionar chave" → colar → "Validar e salvar".
3. No mesmo cartão: "Escolher modelo" → escolher o modelo → "Salvar preferência". Depois, em **Modelo por função**, na
   linha "Dolores — conversa pelo WhatsApp", escolher o modelo dela (ex.: um Haiku, mais barato) → "Salvar" — ou deixar
   "Usar o preferencial". O cartão da Dolores só mostra o modelo em uso e leva até aqui (EPIC-024 S-11).
4. Recomendado: no Claude Console, definir também um limite de gasto mensal da conta abaixo do teto [confirmar na tela
   — Billing/Limits]. É a segunda trava, independente do sistema.

## 3. Limites mensais (o dono, em Integrações › Dolores)
O sistema mede tokens; ele **não sabe o preço** do modelo e não o inventa. Para converter o teto de R$ 1.621/mês (tudo
incluído — reserve parte para o Neon e o restante da operação):
1. Abra a página de preços da Anthropic e anote o preço do modelo escolhido por milhão de tokens de **entrada** e de
   **saída** (em dólares).
2. Decida quanto do teto vai para a Dolores (ex.: R$ 600) e o câmbio do dia. Divida esse valor entre entrada e saída
   (num pedido típico a entrada é a maior parte: as consultas voltam como texto para o modelo).
3. Tokens de entrada = (reais para entrada ÷ câmbio) ÷ preço de entrada × 1.000.000; idem para a saída.
4. Digite os dois números em "Limite mensal — tokens de entrada/saída" e salve. 0 = bloqueada.
Ao bater qualquer um dos dois, a IA para até o mês seguinte (ou até o limite subir) e o dono recebe, uma vez no mês, o
aviso com o uso. O consumo de cada chamada fica em `dolores_consumo`.

## 4. Número do dono (o dono, em Integrações › Dolores)
Digite o seu número (DDD + número) em "Número do dono" e salve — só número brasileiro é aceito. A tela mostra só
`(99) *****-4567`. Só esse número comanda; a conferência é estrita: precisa ser +55, com o mesmo DDD e os mesmos 8
últimos dígitos (só o nono dígito pode faltar). Número de outro país com os mesmos finais **não** comanda. Mensagem de
qualquer outro número é ignorada, sem resposta, e fica registrada em `dolores_acoes` (uma linha por número por hora; a
contagem fica em `dolores_remetentes_estranhos`).

**Cadastre o celular sempre com o 9 na frente** (ex.: `99 9 9123-4567`). A falta do nono dígito só é tolerada quando os 8
últimos começam com 6–9 (celular antigo); se o seu celular, sem o 9, começa com 2–5, o WhatsApp pode entregar o número
sem o 9 e ele não vai casar com o cadastro — a Dolores fica em silêncio (falha fechada). Número **fixo** (8 dígitos
começando com 2–5) só comanda com igualdade exata: DDD e os mesmos 8 dígitos, sem 9 a mais nem a menos.

## 5. Conectar o número da Dolores (o dono, com o celular dela)
Pré-requisito: o servidor da Evolution já salvo em Integrações › WhatsApp (o mesmo da Central).
1. Integrações › Dolores → **"Conectar o número da Dolores (QR code)"**.
2. No celular com o chip DA DOLORES: WhatsApp → Aparelhos conectados → Conectar aparelho → ler o QR code da tela.
3. A tela confirma "Número da Dolores conectado" (ao ver a conexão, ela pede ao sistema para confirmar). O sistema
   confere o número conectado e registra o aviso de mensagens da Dolores
   (`/api/dolores/whatsapp`, com segredo próprio, diferente do da Central). Se o número for o da empresa, de um corretor
   ou o do dono, a conexão é desfeita e a tela explica. Se o sistema não conseguir ler o número conectado, nada é ativado:
   desconecte e conecte de novo.
4. Se um dia as mensagens pararem de chegar: "Reativar recebimento".

## 6. Ligar e testar
1. Integrações › Dolores → conferir que a lista "falta" sumiu → **"Ligar a IA"** → confirmar.
2. Do seu celular, mande para o número da Dolores: "Dolores, analise todos os processos de regularização e informe os
   atrasados, pendências, responsáveis e próximas providências." A resposta chega em até ~1 minuto, com a fonte de cada
   dado entre colchetes. Se o pedido for grande demais, ela responde o que conseguiu e diz que parou.
3. Conferir na tabela `dolores_acoes` (canal `whatsapp`): a mensagem recebida, cada consulta e a resposta.

O que ela não trata como pedido: mensagem **encaminhada** (responde pedindo que você escreva o pedido com as suas
palavras), reação e edição de mensagem (ignoradas). Mensagem temporária ou de visualização única com texto vale normalmente.
Se o sistema cair no meio de um pedido, na próxima mensagem ela avisa "não consegui terminar o pedido de HH:MM; mande de
novo" (uma vez, sem gastar de novo). Vários pedidos de uma vez: os que não couberem no prazo de 1 minuto recebem "não deu
tempo de tratar o de HH:MM; mande de novo".

## Dados dos clientes — decisão do dono em 16/11/2026 (opção B)

**O que mudou.** A Dolores passa a **ver e informar** o CPF, o CNPJ, o telefone e o e-mail dos clientes: os campos do
cadastro (cliente do CRM, financiamentos, processos de regularização, conversas do WhatsApp) e o que aparece nos textos
(anotações, mensagens, observações). Antes, o sistema trocava esses números por "***" ou "[dado pessoal omitido]" antes de
mandar para a IA, e o e-mail nem saía.

Exemplos de pedido que ela passa a responder com o dado completo:
- "Dolores, qual o telefone do cliente João Atrasado?"
- "Qual o CPF e o e-mail da Maria Trello?"
Ela informa quando você pede ou quando o dado é útil para a resposta; não manda listas de CPFs e telefones que você não pediu.

**Atenção, em linguagem simples:**
- A cada pergunta, os dados dos clientes que a Dolores consulta (inclusive CPF, telefone e e-mail) são **enviados à
  Anthropic**, a empresa da IA, para ela montar a resposta.
- **Confira com o jurídico** se o termo de consentimento que os clientes assinam cobre esse envio (LGPD) antes de usar.
- A resposta com esses dados vai **só para o seu número**, conferido a cada mensagem.

**O que continua sempre escondido**, nos dois modos, pelo filtro de texto (melhor esforço: pega as formas comuns de
escrever; um texto digitado de um jeito muito diferente pode escapar):
- senhas, tokens, códigos de acesso/verificação/2FA, PIN e OTP — com a palavra ("senha", "pwd", "pass") ou com cara de
  senha logo depois de "login", "acesso", "usuário", "credencial", "gov.br", "INSS", "e-CAC", "portal" (ex.: "acesso gov:
  529… Maria@2025": a senha sai; o CPF segue a regra de dado pessoal); "Nome@2025" (arroba sem domínio) também sai;
- chaves de API e credenciais em forma reconhecível (`sk-ant-…`, `sk_live_…`, `Bearer …`, `github_pat_…`, `AIza…`,
  `apikey=…`, chave privada PEM);
- agência e conta quando vêm com o rótulo ("agência", "ag", "conta", "c/c", "cta") ou com o nome de um banco comum ("Itaú
  0001 12345-6", "conta do Bradesco 12345-6");
- chave PIX quando vem depois de "pix"/"chave pix" (também "pix é …", "pix -> …", "PIX CNPJ …", "pix aleatória …"):
  sai inteira, mesmo quando é um CPF, telefone ou e-mail. Fora disso, um CPF ou e-mail solto segue a regra de dado pessoal.

Endereço, arquivos e links do Drive continuam fora das consultas.

**Links na resposta.** Para que um texto de cliente não consiga fazer a Dolores montar um link com dados dentro, a
resposta que chega ao seu WhatsApp só leva links do **próprio sistema** (o domínio da variável `PUBLIC_SITE_URL` da
Vercel) e do **Trello** (`trello.com`), e mesmo esses em `https://`, sem porta e sem a parte depois de "?" ou "#".
Qualquer outro link vira "[link removido]" — inclusive endereço sem "http" ("site.com", "site.com/x", "192.168.0.1/x").
Nomes de arquivo ("contrato.pdf") e abreviações de endereço ("Av.Brasil/120") ficam. Mesmo assim, não toque em endereço
que não seja do sistema ou do Trello. Sem a variável `PUBLIC_SITE_URL`, nenhum link do sistema passa (só o Trello). A mensagem é enviada sem
prévia de link (ninguém abre o endereço para montar a prévia).

**O que continua sem dado pessoal**, qualquer que seja a escolha: o registro de ações (`dolores_acoes`), o pedido
guardado (`dolores_mensagens`), os números estranhos (`dolores_remetentes_estranhos`), a tela de Integrações › Dolores, os
logs e as mensagens de erro.

**A ponte HTTP (etapa 1) tem interruptor próprio.** A sua autorização vale para a Dolores no WhatsApp. Quem chama a
ponte diretamente (`/api/dolores/ponte`, com o token) recebe CPF, CNPJ, telefone e e-mail **mascarados**, mesmo com a
opção B ligada. Assim, um token vazado não abre os dados dos clientes. Para liberar também na ponte (só se um agente
externo realmente precisar):
1. Na Vercel: criar `DOLORES_PONTE_DADOS_PESSOAIS` com o valor `1` (Production) e fazer um **Redeploy**.
2. Valores que liberam: `1`, `true`, `sim`, `on` ou `yes`. Ausente ou **qualquer outro valor**: mascarado.
3. Para voltar a mascarar: apagar a variável e fazer outro Redeploy.

Os dois interruptores são **independentes**: `DOLORES_MASCARAR_DADOS_PESSOAIS` só vale para o WhatsApp e
`DOLORES_PONTE_DADOS_PESSOAIS` só vale para a ponte. Exemplo: com `DOLORES_MASCARAR_DADOS_PESSOAIS=1` e
`DOLORES_PONTE_DADOS_PESSOAIS=1`, o WhatsApp mascara e a ponte libera.

**Como voltar atrás (religar o filtro).**
1. Na Vercel: Settings › Environment Variables → criar `DOLORES_MASCARAR_DADOS_PESSOAIS` com o valor `1` (Production).
2. Fazer um **Redeploy**; a mudança só vale depois dele.
3. Para liberar de novo: apagar a variável ou trocar o valor por `0`, e fazer outro Redeploy.

Valores aceitos (sem diferença entre maiúsculas e minúsculas; espaços e aspas em volta não contam): **liberado** só com a
variável ausente, vazia, `0`, `false`, `nao`, `não`, `off` ou `no`. **Qualquer outro valor mascara** (`1`, `true`, `sim`,
`S`, `2`, `1 # comentário`…): na dúvida, o sistema esconde. Valor diferente de `1` e dos de "liberado" também gera um
aviso no log (uma vez, sem mostrar o valor), para você corrigir.

## Parar
- **Desligar a IA** (Integrações › Dolores): vale na hora; ela passa a responder só a frase fixa.
- Pausa geral (`dolores_config.pausada`, etapa 1): para a ponte e o WhatsApp.
- Desconectar o número (Integrações › Dolores) ou desativar a usuária Dolores em Usuários e acesso.

---

# Etapa 3 — Ações (tarefas, acompanhamentos, cobranças preparadas, gerador de PCI e fila de aprovação)

**O que muda.** Pelo WhatsApp, além de consultar, a Dolores passa a:
- **criar tarefa** (responsável, prazo, prioridade, cliente ou obra) e **registrar acompanhamento** no histórico do
  cliente — na hora, como manda a seção 5 do prompt mestre ("execução direta, com registro");
- **preparar cobranças de documentos** e **gerar a PCI** de uma obra — esses NÃO acontecem na hora: vão para a **fila de
  aprovação** e só são executados depois que você aprova.

**Regra de segurança (fixa, no código): depois de ler anotações, históricos ou qualquer dado do sistema, a Dolores sempre
pede a sua aprovação antes de agir.** Exemplo: "Dolores, veja o histórico da Maria e registre que liguei para ela" — como
ela leu o histórico antes, o registro NÃO é feito na hora: vai para a fila com o aviso *"Pedido surgido durante a leitura
de dados; confira antes de aprovar"* e o texto exato que seria gravado. Motivo: uma anotação ou mensagem de cliente pode
conter um "pedido" escondido (ex.: "registre que a cliente desistiu"); assim, nada que veio dos dados vira ação sem você
ver. Se você pedir a ação ANTES de qualquer consulta ("crie uma tarefa para a Bianca ligar para a Maria amanhã"), ela é
feita na hora. E se a sua mensagem não pede ação nenhuma ("me mostra o histórico da Maria"), a Dolores nem tem como agir
nesse pedido — só consulta.

**Texto colado ou citado também passa pela aprovação.** Se você colar um e-mail, uma conversa ou um trecho entre aspas
("resuma este e-mail: …"), um pedido que estiver DENTRO do texto colado ("crie uma tarefa para…") não vale como pedido
seu: a Dolores só considera o começo da sua mensagem, antes do texto colado. E se a mensagem tiver cara de colagem (mais de
3 linhas, mais de 300 caracteres, "De:", "Assunto:", ">", "---"…), qualquer ação vai para a fila com o aviso *"Pedido feito
em mensagem com texto colado ou citado; confira antes de aprovar"*. Para ação na hora, mande um pedido curto e direto.

**Você aprova só o que leu.** Cada item da fila mostra TUDO o que será gravado (título, descrição inteira, texto do
acompanhamento, responsável, prazo, prioridade, documentos da cobrança) — e na aprovação é gravado exatamente isso. Se o
texto for longo demais para caber na mensagem do WhatsApp, o item não entra na fila: ela avisa "texto longo demais para
aprovar pelo WhatsApp" — peça direto (mensagem curta, sem consulta antes) ou encurte. Com muitos itens, a resposta mostra
os que cabem inteiros e diz "e mais N item(ns) — veja a fila em Integrações › Dolores".

**O que continua proibido (está no código, não só na instrução):** excluir registro, editar lançamento financeiro, pagar,
baixar ou estornar, mexer em usuários/acessos/credenciais/dados bancários, assinar documento técnico ou jurídico, inventar
dado e **enviar mensagem ou e-mail a cliente ou terceiro** (você ainda não liberou nenhuma categoria). A cobrança aprovada
vai para o histórico do cliente e o texto volta para você; quem envia é a equipe (ou você, encaminhando). A PCI sai sem
assinatura, para o engenheiro responsável conferir e assinar. Pela ponte HTTP (Claude Console) continuam só consultas.

## 1. Banco (equipe técnica, já autorizado)
Aplicar no Neon a migração aditiva `drizzle/0125_dolores_fila.sql` (cria `dolores_aprovacoes`, `dolores_autoria` e
`dolores_fila_config`; não altera nenhuma tabela existente). Depois, publicar.

## 2. Usar
1. Mande à Dolores, por exemplo: "Dolores, identifique quais clientes estão com documentos pendentes e prepare as cobranças."
2. Ela responde com o que encontrou e, no fim, um quadro montado pelo próprio sistema:
   `*Aguardando a sua aprovação*` com um **código** para cada item (ex.: `[K7M3P] Cobrança de documentos para Maria … —
   rascunho, não será enviada: 1 pendente(s): RG. Último contato registrado: … Consentimento LGPD no cadastro: …`).
3. Para decidir, responda **só** com a palavra e o(s) código(s): `aprovar K7M3P` · `aprovar K7M3P AC3DE` · `recusar K7M3P`.
   Qualquer frase diferente (ex.: "pode aprovar o K7M3P, por favor") NÃO vale como aprovação — a aprovação é reconhecida
   pelo sistema, nunca pela IA; uma mensagem encaminhada também não vale.
4. Aprovado, ela confere tudo de novo na hora (o cliente ainda existe? a lista de documentos pendentes é a mesma? o
   rascunho da PCI mudou?) e executa uma única vez. Aprovar duas vezes não repete nada. Se a lista de pendências mudou
   depois do pedido, ela não registra outra coisa: avisa e pede para você mandar preparar de novo.
   Se você pedir de novo algo que já está aguardando, ela não duplica: o quadro mostra o item que já estava na fila, com
   o código dele.
   A PCI leva tempo: ela gera **no máximo uma PCI por mensagem** de aprovação e só começa se ainda houver tempo (senão
   avisa "não deu tempo; continua aguardando — mande aprovar de novo" e nada é feito).
5. Também dá para decidir pela tela: **Integrações › Dolores — fila de aprovação** (só administrador): Aprovar / Recusar,
   histórico e a validade dos itens.

## 3. Validade da fila
Item não decidido vence em 48 horas (padrão) e não é mais executado. Para mudar: Integrações › Dolores — fila de
aprovação → "Validade dos itens novos (horas)" → Salvar (de 1 a 336 horas; vale para os itens novos).

## 4. Gerar PCI pela Dolores
Ela usa o **rascunho que a equipe salvou** no Gerador de PCI da obra (ela não preenche nenhum dado e **não altera o
rascunho**: quem salvou continua aparecendo como autor). Se a PCI for gerada mas o registro de autoria falhar, ela diz a
verdade ("a PCI FOI gerada em …, mas não consegui registrar a autoria; confira"). Sem rascunho, ou com
campo que impede a geração, ela diz o que falta e nada vai para a fila. Antes de liberar o uso real, conferir em produção
uma geração feita por ela (a planilha e o PDF no histórico da obra e a cópia na pasta da obra no Drive).

## 5. Conferir
- `dolores_acoes`: cada pedido, cada ação (ok/recusada/erro) e cada decisão da fila (`pedido_id` = `fila:CÓDIGO`).
- `dolores_autoria`: cada registro criado por ela (tarefa, acompanhamento, PCI), com o pedido e o item aprovado.
- As tarefas criadas por ela trazem "Criada por Dolores (funcionária digital) a pedido do dono" na descrição; os
  acompanhamentos aparecem no histórico do cliente com o autor "Dolores (funcionária digital)".

## Limites desta etapa
- O texto que você manda gravar (título, descrição, anotação) não pode ter link nem senha, código de acesso, chave ou dado
  bancário: a Dolores recusa e pede para reescrever (os links e esses dados saem da mensagem que você lê, e ela nunca grava
  algo diferente do que você leu). CPF, telefone e e-mail que você escrever ficam no texto (opção B); com
  `DOLORES_MASCARAR_DADOS_PESSOAIS=1`, um texto com eles também é recusado.
- No máximo 10 ações (diretas + itens na fila) por mensagem sua.
- Tudo conta no mesmo limite mensal de tokens da etapa 2. Com a IA desligada, os comandos não agem; "aprovar/recusar
  CÓDIGO" funciona sem IA (não gasta nada). Com a Dolores pausada, nada é aprovado (recusar continua valendo).

---

# Etapa 4 — Grupos de clientes (leitura dos grupos cadastrados, card, classificação e Drive)

> **Desde a Etapa 7 (19/11/2026), não é mais preciso cadastrar grupo**: o grupo entra sozinho, com o tipo descoberto pelo nome
> (ver "Etapa 7", no fim). O cadastro manual abaixo continua existindo, recolhido na tela, para casos raros.

A Dolores passa a **ler** os grupos de WhatsApp de clientes que o administrador cadastrar. Ela **só responde no grupo quando
é marcada, com o interruptor ligado** (seção "Responder no grupo quando marcada", abaixo); fora isso não responde, não reage,
não manda nada e não marca como lida de propósito. **Nada escrito no grupo é comando** — nem
quando é o dono quem escreve lá: "aprovar CÓDIGO" num grupo não aprova nada. Pedido só vale na conversa DIRETA do dono
com a Dolores. Grupo desativado continua ignorado (nada é gravado); grupo desconhecido entra sozinho (Etapa 7), salvo com a
"entrada automática de grupos" desligada.

## 1. Banco (equipe técnica, já autorizado)
Aplicar `drizzle/0126_dolores_grupos.sql` no Neon (só aditiva e idempotente: 5 tabelas novas, gatilhos que impedem
apagar e mudar o que chegou, e a linha de configuração com a classificação DESLIGADA). Sem ela, os grupos continuam
ignorados e a tela de grupos avisa que a migração falta. Antes, conferir que ela nunca foi aplicada
(`SELECT to_regclass('dolores_grupos_contagem')` precisa voltar NULL): a 0126 foi editada dentro dos CREATE TABLE.
Aplicar também `drizzle/0130_dolores_fila_guarda.sql` (só `CREATE OR REPLACE FUNCTION`): corrige a guarda da fila da etapa 3
para que excluir um usuário que decidiu item da fila pela tela funcione (o item continua encerrado, só sem quem decidiu).

A classificação tem orçamento próprio: no máximo 20% do limite mensal da Dolores (ajustável de 1% a 50% na tela), contando
o uso real da classificação, e nunca passa de 80% do limite somando tudo. Uma classificação por vez. Antes de mandar o
arquivo, a Dolores pede à Anthropic a contagem de tokens do pedido (gratuita): se passar da reserva (28,3 mil), der erro
ou demorar mais de 5 s, o arquivo não vai e a classificação sai só pelo nome e pela legenda, sempre com "confira".

## 2. Colocar a Dolores no grupo (o dono, pelo celular)
O dono adiciona o número da Dolores ao grupo do cliente, no próprio WhatsApp. O sistema nunca entra em grupo sozinho.
Combinado: **um grupo por cliente**.

## 3. Cadastrar o grupo (raro desde a Etapa 7 — em Integrações › Dolores — grupos › "Cadastrar um grupo à mão")
1. "Ver os grupos em que a Dolores está" lista os grupos pela Evolution (só leitura) → "Usar este id"; ou digite o id
   (termina em `@g.us`).
2. Dê um rótulo (como a equipe chama o grupo) e, se já existir, o nº do cliente no CRM (ou o nº da obra). Pode deixar sem
   card: o dono pede depois para a Dolores criar.
3. Cadastrar. A partir daí as mensagens novas do grupo são registradas. Desativar = parar de ler (nada é apagado).

## 4. Classificação dos documentos (desligada por padrão)
- Ligue em "Classificação dos documentos pela IA". Também precisa do interruptor da IA da Dolores ligado, da chave da
  Anthropic e de limite mensal. O modelo é o da função **"Dolores — classificação de documentos"** em Integrações ›
  Anthropic › Modelo por função (recomendação: um que leia imagem e PDF; o mais barato costuma bastar).
- Só documento e foto são classificados (texto nunca chama a IA), **no máximo um por aviso** do WhatsApp, até os tetos:
  30 por dia no total e 10 por grupo por dia (padrão; ajuste na tela). A classificação usa **no máximo 80% do limite
  mensal**: o resto fica para os comandos do dono. Sem isso, o documento fica "a classificar" e pode ser classificado
  depois pelo botão "Classificar pendentes agora".
- Tipos possíveis (lista fechada): RG, CNH, comprovante de endereço, comprovante de renda, FGTS, certidão, PIS,
  documento do cônjuge, matrícula, contrato, planta, foto de obra, nota fiscal, outro. Confiança abaixo de 75% =
  **"confira"**.
- Arquivo acima de 10 MB (padrão) não é baixado. PDF acima de 4 MB ou 5 páginas e imagem acima de 3,75 MB vão à IA só pelo
  nome e pela legenda (sempre "confira").

## 5. Usar (teste de aceite)
O dono escreve para a Dolores: **"Dolores, cria o card deste cliente (Maria Souza, 99 99123-4567) e salva a documentação do
grupo."** Ela:
1. confere se o cliente já existe (mesmo nome ou telefone). Existe → propõe **ligar** o grupo ao card existente; não
   existe → propõe **criar** o card (etapa inicial, origem "Dolores — grupo do WhatsApp"). Vai para a **fila**.
2. com o card ligado, propõe salvar cada documento classificado no card e na pasta do cliente no Drive (Clientes › Nome
   (nº) › área). Também vai para a **fila**, um item por documento (até 10), dizendo o tipo e a confiança.
3. diz quais documentos ainda não foram classificados ou lidos e o que falta pelo checklist.
Aprovado ("aprovar CÓDIGO" na conversa direta ou na tela da fila): o card é criado/ligado; o arquivo é baixado na hora,
conferido pelo conteúdo (PDF, JPG, PNG, WEBP), enviado como **arquivo novo** (o nome no Drive é montado pelo sistema:
rótulo + data) e registrado no card. O mesmo arquivo já no card não vai de novo. Nada é sobrescrito nem apagado.

## 6. O que fica guardado e por quanto tempo
- `dolores_grupos`: o cadastro (nunca apagado; desativa-se).
- `dolores_grupo_mensagens`: cada mensagem dos grupos cadastrados — o texto/legenda **já filtrado** (CPF, telefone,
  e-mail mascarados; senha, código, chave e dado bancário sempre), o remetente **mascarado**, o tipo e os metadados do
  arquivo (nome limpo, formato, tamanho) e a classificação. **O arquivo não fica no banco**: é baixado da Evolution só para
  classificar e, depois da aprovação, para enviar ao Drive. Nunca é apagada (sem rotina de limpeza).
- Retenção do pendente: **30 dias** (padrão, de 1 a 365 na tela). Depois disso o documento não salvo deixa de ser
  oferecido para classificar ou salvar (peça para reenviar no grupo) — **nada é apagado**.
- `dolores_grupos_contagem`: uma linha por grupo por dia (mensagens, ignoradas pelo teto, classificações).
- Teto de 300 mensagens registradas por grupo por dia (padrão): acima disso o spam só soma a contagem.

## 7. Conferir
- `dolores_acoes`: `grupo_mensagem` (teto atingido), `classificar_documento` (ok/recusada/erro, com tipo e confiança, sem
  texto do documento), `criar_card_cliente`, `salvar_documentos_grupo` e as ações da tela (`cadastrar_grupo`,
  `atualizar_grupo`, `configurar_grupos`).
- `dolores_consumo`: cada classificação conta no consumo do mês.

---

# Etapa 4b — Responder no grupo quando marcada

Decisão do dono (17/11/2026): "Nos grupos ela só pode responder quando ela for marcada, quando o número for marcado; em
nenhum outro momento ela deve responder as mensagens do grupo e deve apenas observar até ser marcada." Qualquer pessoa do grupo
pode marcá-la (cliente, parente, empreiteiro, o próprio dono); ela responde **só sobre o cliente/obra daquele grupo**.

**Atenção: o que ela escreve no grupo é lido por todos os participantes.**

## 1. Banco (equipe técnica, já autorizado)
Aplicar `drizzle/0129_dolores_marcacoes.sql` no Neon **depois** da `0126` (só aditiva e idempotente: 4 tabelas novas, um
gatilho que impede apagar o registro e mudar o que chegou, e a linha de configuração com o interruptor DESLIGADO). Nenhuma
tabela existente é alterada. Sem ela, a Dolores continua só lendo os grupos, e a seção da tela avisa que a migração falta.

## 2. Como ligar (administrador, em Integrações › Dolores › Grupos de clientes › "Responder no grupo quando marcada")
1. Confira que a conexão da Dolores está **confirmada** (o número dela aparece no cartão da Dolores) e que a IA dela está ligada,
   com chave, modelo e limite mensal.
2. Em Integrações › Anthropic › Modelo por função, escolha o modelo de **"Dolores — resposta em grupo quando marcada"** (o mais
   barato costuma bastar). Sem escolha, vale o modelo preferencial.
3. Ligue o interruptor **geral** da seção e, na lista, o interruptor **de cada grupo** em que ela pode responder. Os dois nascem
   desligados: ela só responde onde os dois estiverem ligados.
4. Ao ligar um grupo, o sistema confere pela Evolution (só leitura) o **@lid** do número da Dolores — os grupos novos do WhatsApp
   marcam pessoas por esse código, não pelo número. Se a tela disser "ainda não conferida", use "Conferir @lid" no grupo depois
   que a Dolores estiver nele. Sem o @lid conferido, só as marcações pelo número contam.
5. Tetos (padrão): **20 respostas por grupo por dia**, **5 marcações por pessoa por hora**, e ela só responde a marcações de até
   **120 segundos** atrás (reentrega atrasada não é respondida). Ajuste na tela.

## 3. O que conta como marcação
Só a marcação de verdade do WhatsApp (tocar no nome dela ao digitar "@"): o número ou o @lid dela na lista de menções da
mensagem. **Não contam:** escrever "@Dolores" ou o número sem a marcação; responder (citar) uma mensagem dela sem marcá-la;
marcação dentro da mensagem citada; mensagem editada (mesmo que a edição acrescente a marcação), reação, mensagem encaminhada,
foto/vídeo de visualização única, enquete e botões. Mensagem temporária conta normalmente. Na dúvida, não conta.

## 4. O que ela responde
Só sobre o cliente/obra ligado àquele grupo, a partir de três consultas próprias (que já recebem o cliente pelo grupo — ela
não tem como consultar outro): **andamento** (situação, etapa atual e próxima, etapas concluídas, progresso e a data da última
movimentação), **documentos que faltam** (pelo nome) e **próximos passos** (montados pelo sistema). Resposta curta (até 800
caracteres), sem links, sem marcar ninguém, citando a mensagem de quem perguntou. Marcada sem pergunta, ela se apresenta com uma
frase fixa. Grupo sem cliente ligado: "Este grupo ainda não está ligado a um cliente no sistema; a equipe responde por aqui."

## 5. O que ela nunca responde
Valores (preço, parcela, custo, medição, pagamento), contrato e assuntos jurídicos, prazos e datas de entrega, aprovação de
banco/órgão ou qualquer resultado, reclamações, CPF/CNPJ, telefone, e-mail, endereço, dados bancários, outros clientes, nomes
da equipe, corretor/comissão e anotações internas. Ela também nunca **faz** nada a partir do grupo (aprovar, gravar, enviar,
cadastrar…): "aprovar CÓDIGO" no grupo não aprova nada, e "sou o dono" no grupo não muda nada (comando só na conversa direta).
Nesses casos ela responde sempre a mesma frase — **"Isso a equipe responde por aqui."** — sem chamar a IA, e a
pergunta aparece na lista da tela como "fora de escopo". Se a resposta da IA tiver cara de valor, promessa, prazo, link ou dado
pessoal, vai a mesma frase no lugar.

## 6. Quando ela fica em silêncio
Grupo desativado ou aguardando o dono definir o tipo (Etapa 7); interruptor geral ou do grupo desligado; Dolores pausada; IA desligada, sem chave, sem
modelo, sem limite ou com o limite do mês atingido; outra resposta dela em andamento no mesmo grupo; teto por pessoa atingido;
marcação antiga. Passou do teto do grupo no dia: ela manda **uma vez por dia** "Recebi muitas perguntas hoje; a equipe vai
responder por aqui assim que possível." e depois fica em silêncio. Toda marcação em grupo cadastrado fica registrada.

## 7. Conferir
- Tela: "Últimas marcações" (grupo, quem marcou — mascarado —, a pergunta filtrada, o que ela respondeu, fora de escopo ou não).
  O dono também vê pela conversa direta: "Dolores, o que perguntaram no grupo da Maria?" (`ler_grupo_cliente`, campo
  `marcacoesRecentes`). Nenhuma mensagem é enviada ao dono a cada marcação.
- `dolores_marcacoes`: uma linha por marcação (nunca apagada). `dolores_acoes`: `grupo_marcacao` (desfecho), `grupo_leitura`
  (cada consulta do grupo; função fora do conjunto = recusada), `grupo_resposta` (cada envio ao grupo; destino que não confere =
  recusada), e as ações da tela (`configurar_marcacoes`, `ligar_marcacao_grupo`, `conferir_lid_dolores`).
- `dolores_consumo`: cada chamada da resposta em grupo conta no mesmo limite mensal (no máximo 80% dele, como a classificação:
  o resto fica para os comandos do dono).

---

# Etapa 5 — Notas de obra (leitura da nota, rascunho, confirmação do empreiteiro, conciliação com o BPO)

A nota fiscal ou o recibo que chega num grupo cadastrado e **ligado a uma OBRA** é lido pela IA e vira um **rascunho interno
da Dolores** (tabela `obra_notas`) — **nunca um lançamento**: nada é lançado, pago, baixado nem estornado. A Dolores continua
**sem falar no grupo** (não pede a confirmação; a tela mostra o texto para o dono enviar). Ligar a nota a um pagamento do
BPO e salvar o arquivo na pasta da obra só acontecem com a **aprovação do dono, pela fila**. A resposta do empreiteiro no
grupo, quando aparece, é registrada como um **indício** — não é assinatura, não autoriza pagamento e não dispensa o dono.
(A marcação da E4b — a Dolores responder quando marcada — não muda nada aqui: resposta ao empreiteiro não é comando e a
Dolores não pede confirmação a ninguém.)

## 1. Banco (equipe técnica)
Aplicar `drizzle/0128_dolores_notas.sql` no Neon (só aditiva e idempotente: 3 tabelas novas — `obra_notas`,
`obra_notas_respostas` e `obra_notas_config` —, índices, gatilhos que impedem apagar e mudar o que foi lido, e a linha de
configuração com a leitura DESLIGADA). Precisa da 0126 (etapa 4) e da 0125 (fila) aplicadas antes. Sem a 0128, a tela das
notas avisa que a migração falta e os documentos dos grupos de obra ficam "a classificar".
Exclusões que já existiam continuam funcionando: excluir a obra, o usuário empreiteiro ou o lançamento do BPO (ex.: a
transação do banco removida) só esvazia o vínculo na nota (`ON DELETE SET NULL`, aceito pelo gatilho); a nota fica.

## 2. Grupo da obra (administrador, em Integrações › Dolores — grupos de clientes)
Ligue o grupo da obra ao **nº da obra** (não o do cliente) — desde a Etapa 7, pelo comando do dono
`grupo <código> engenharia <nº da obra>` ou em "Corrigir tipo ou vínculo" na tela. Um grupo ligado a obra passa a mandar os documentos para a
leitura de nota; grupo de cliente continua na classificação da etapa 4, igual. O empreiteiro que pode confirmar é o
**empreiteiro vinculado à obra** (tela da obra), com o **telefone** cadastrado no usuário dele (papel empreiteiro, ativo).

## 3. Ligar a leitura (desligada por padrão)
Em Integrações › Dolores — notas de obra, ligue "Leitura das notas pela IA". Precisa também: interruptor da IA da Dolores,
"Classificação dos documentos pela IA" (etapa 4) ligada, chave da Anthropic e limite mensal. O modelo é o da função
**"Dolores — leitura de notas de obra"** (Integrações › Anthropic › Modelo por função; um que leia bem imagem e PDF).
Custo — as MESMAS travas da classificação da etapa 4, somadas a ela:
- uma chamada de IA por aviso do WhatsApp e **uma leitura/classificação por vez** no sistema todo;
- tetos do dia da etapa 4 (total e por grupo) e o **orçamento dos documentos** (padrão 20% do limite mensal, contando o
  uso real das classificações e das notas), nunca passando de 80% do limite somando tudo — os comandos do dono sempre têm
  folga;
- arquivo até 10 MB (download cortado acima), PDF até 4 MB e 5 páginas contadas com segurança, imagem até 3,75 MB, e a
  **contagem prévia de tokens** (gratuita, `messages.countTokens` do SDK) dentro da reserva da leitura (30,3 mil tokens de
  entrada; saída até 2 mil). Fora disso **a IA não é chamada**: a nota fica "não lida pela IA" para o dono conferir no grupo;
- o mesmo arquivo de uma nota já registrada não vai de novo à IA (duplicada, sem custo); texto de grupo nunca chama a IA.

## 4. O que a leitura faz
- Emitente, CPF/CNPJ, número, data, valor, descrição, itens (até 30), chave de acesso, categoria e etapa sugeridas, com
  **confiança por campo**. Abaixo de 80% o campo **não é gravado** e vira "confira".
- O sistema confere por código: dígito verificador do CPF/CNPJ; soma dos itens × total; data real, não futura e não mais
  velha que 18 meses; valor entre R$ 0,01 e R$ 5 milhões; chave de acesso (44 dígitos, DV, modelo 55/65) cruzada com o CNPJ,
  o número e o mês da nota — divergência = "possível adulteração". O que falha fica VAZIO; nada é completado.
- Textos lidos passam pelo filtro do registro, sem links; **dados bancários (banco, agência, conta, PIX) nunca são gravados**
  — fica só o alerta "a nota traz dados bancários: NÃO foram gravados".
- Nota duplicada (mesmo arquivo, mesma chave de acesso ou mesmo número + emitente) é marcada e não concilia.
- O empreiteiro da obra só é sugerido se o CPF/CNPJ da nota for o dele.

## 5. Confirmação do empreiteiro (dado, não autenticação)
O dono copia o texto sugerido da tela (ou da resposta da Dolores) e envia ele mesmo no grupo, se quiser. O sistema reconhece,
**por código** e sem chamar a IA, uma resposta inequívoca — "CONFIRMO NOTA 12", ou "confirmo" **respondendo à mensagem da
nota** — vinda do telefone do empreiteiro cadastrado DAQUELA obra, no MESMO grupo, dentro do prazo (padrão 7 dias). "CORRIGIR
NOTA 12 …" registra o pedido de correção. Fica guardado: quem (telefone **mascarado**), quando e o texto filtrado. Outro
número, outro grupo, fora do prazo, encaminhada, ambígua ("confirmo, mas…"), negativa ou sem referência à nota: nada é
confirmado e a tentativa fica na auditoria. Só a primeira resposta vale.

## 6. Conciliação com o BPO (só aponta)
Para cada nota, a tela e a leitura `listar_notas_obra` comparam com os lançamentos de DESPESA do BPO perto da data (±30 dias,
ajustável): valor ao centavo, fornecedor (CPF/CNPJ do cadastro do BPO ou nome) e obra (vínculo operacional "obras" ou
pagamento da obra ligado). Resultado: **já lançado**, **provável duplicata** (o pagamento já está ligado a outra nota),
**divergente** (valor, fornecedor ou obra), **mais de um possível**, **sem lançamento**; e, filtrando por obra, os
**pagamentos sem nota** dos últimos 90 dias. Nenhum lançamento é criado, ligado ou alterado por isso.
Para LIGAR a nota ao pagamento: "Propor ligar ao pagamento" na tela ou pedir à Dolores (`conciliar_nota_obra`). Vai para a
fila; só é aceito com o pagamento **pago e vindo do extrato do banco**. Aprovado, grava só o vínculo NA NOTA (uma vez; o
gatilho impede trocar) — o lançamento do BPO não muda.
Para SALVAR o arquivo: "Propor salvar na pasta da obra" ou `salvar_nota_obra`. Aprovado, baixa de novo, confere que é o
MESMO arquivo lido (SHA-256) e envia como arquivo novo para Obras › Obra (nº) › Notas fiscais, com o nome montado pelo
sistema ("Nota 12 — 15-11-2026.pdf").

## 7. Conferir
- `dolores_acoes`: `ler_nota_obra` (ok/recusada/erro, contagens e tokens, sem texto da nota), `resposta_empreiteiro_nota`
  (confirmação registrada ou tentativa recusada, com o remetente mascarado), `conciliar_nota_obra`, `salvar_nota_obra` e as
  ações da tela (`configurar_notas_obra`).
- `dolores_consumo` e `dolores_grupos_consumo_mes`: cada leitura conta no limite mensal e no orçamento dos documentos.

# Etapa 6 — Operação contínua (eventos, rondas, relatório diário, tela com pausa e gasto)

A Dolores passa a trabalhar sem ser chamada, **sem IA e sem custo**: uma **ronda** por código conta o que precisa de atenção
(fila de aprovação perto de vencer, atrasados e parados, tarefas vencidas, documentos pendentes, recebimentos, conversas sem
leitura, documentos dos grupos a conferir, notas de obra sem confirmação ou sem conciliação, movimentações do banco, o que ela
fez nas últimas 24 h e o gasto do mês) e o **relatório** sai em texto fixo **só para o número do dono**. Eventos (documento
recebido em grupo, nota lida, prazo vencido, pagamento sincronizado do banco) são **só registro**: no máximo entram no
relatório; nunca disparam ação, mensagem, item de fila nem IA. **Tudo nasce desligado.**

## 1. Banco (equipe técnica)
Aplicar `drizzle/0131_dolores_operacao.sql` no Neon (só aditiva e idempotente: `dolores_operacao_config` com tudo desligado,
`dolores_rondas`, `dolores_relatorios`, `dolores_relatorio_reenvios` e `dolores_eventos` — estas quatro só aceitam inserção, com
janela/chave únicas; os gatilhos seguem o padrão das outras migrações da Dolores, `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`). Nenhuma
tabela existente muda. Sem a 0131, a tela avisa e o cron responde "sem-configuracao".

## 2. Agendamento (já no `vercel.json`)
`/api/cron/dolores` todo dia às **10:00 UTC = 07:00 em Brasília** (o Neon e a Vercel estão em GMT; a conta do horário local é
feita no código, UTC−3). A rota só aceita o cabeçalho `Authorization: Bearer <CRON_SECRET>` que a própria Vercel manda
(comparação em tempo constante); **sem `CRON_SECRET` cadastrado na Vercel, ela recusa sempre** (o cron `lead-card-due` já usa
a mesma variável — confira que existe em Settings › Environment Variables). Query e corpo são ignorados. Cabe em 45 s.
O relatório diário sai UMA vez por dia, na hora escolhida na tela entre **07:00 e 14:00** (Brasília; padrão 07:00). O cron
chama a rotina nessas 8 horas (`CRON_DOLORES_AGENDAS` em `shared/dolores/operacao.ts`, conferida por teste contra o
`vercel.json`); o relatório sai na primeira chamada em que a hora escolhida já chegou. Se o envio falhar, a chamada seguinte
do mesmo dia reenvia o mesmo texto uma única vez; depois disso, fica o botão de reenvio na tela. Hora antiga gravada
(00:00–06:00) vale 07:00.

## 3. Ligar (administrador, em Integrações › "Dolores — operação contínua")
1. **Rondas** (liga a varredura diária).
2. **Relatório diário** (exige rondas ligadas e o número do dono cadastrado) e a hora.
3. **Eventos** (opcional).
4. **Preço por milhão de tokens** (opcional, em R$; entrada e saída): só serve para a tela e o relatório estimarem o gasto em
   reais contra o teto do dono (R$ 1.621/mês). Sem preço, a tela mostra só os tokens — o sistema não inventa preço.
Botões: **Fazer ronda agora** (só leitura; no máximo uma por minuto) e **Enviar relatório agora ao dono**.
Pelo WhatsApp, o dono manda só **"relatório"** (ou "relatório agora", "Dolores, relatório do dia"): é reconhecido por código,
não chama a IA nem gasta; vale só do número do dono; repetido no mesmo minuto não manda de novo. Relatório sob demanda (tela +
WhatsApp) tem **teto de 20 por dia**: passou disso, a resposta é uma frase fixa ("já saíram 20 relatórios sob demanda hoje…"),
sem ronda nem relatório.

**Relatório diário que não chegou.** O relatório do dia é gravado ANTES do envio (assim a reentrega do cron nunca manda duas
vezes). Se o envio falhar (Dolores desconectada, Evolution recusou, sem tempo), a tela mostra em "Relatório diário de hoje":
*gerado, envio FALHOU (motivo) — use "Enviar agora"*. O botão **Enviar agora** reenvia o **mesmo texto gravado** do dia (não faz
ronda nem monta outro relatório; o diário continua um só), só ao número do dono e pelos mesmos filtros de saída; no máximo um
reenvio por minuto (`dolores_relatorio_reenvios`, janela única) e, depois que um envio der certo, o botão some e o servidor
recusa novo reenvio. O resultado de cada tentativa fica em `dolores_acoes` (`relatorio_envio`, pedido `relatorio:<id>`, com
`reenvio: true` no resumo).

**Nomes de terceiros no relatório.** Nome de cliente e de responsável vêm de cadastro (inclusive leads de fora) e aparecem
entre aspas angulares («Ana»): o texto é cortado no primeiro caractere que não seja letra, espaço, hífen, apóstrofo ou ponto,
perde `*`, `_`, `~`, crase e aspas, perde "aprovar"/"recusar" e o código que vier depois, e tem no máximo 40 caracteres — um
nome nunca vira título de seção nem pedido de aprovação.

## 4. Pausa geral (o botão que para tudo)
"Pausar tudo agora" grava `dolores_config.pausada` (a mesma pausa da etapa 1) e, conferido no servidor, para: IA da conversa,
classificação dos documentos, leitura das notas, ponte, aprovação de item da fila, rondas, relatório (cron, tela e WhatsApp),
eventos e o reconhecimento da resposta do empreiteiro. As mensagens dos grupos cadastrados continuam só REGISTRADAS (para nada
se perder). A resposta nos grupos quando marcada (etapa 4b) também para: com a pausa ligada (ou a conta da Dolores desativada) ela fica muda no grupo, e a marcação só é registrada (`podeFalarNoGrupo()` em `server/dolores/operacao.ts`).
"Retomar a Dolores" volta cada função ao estado do próprio interruptor.

## 5. Teste de aceite (prompt mestre): "sete dias rodando sem falha, com o custo medido"
Ligar rondas e relatório; conferir por 7 dias, na tela, que há uma ronda por dia sem "sem leitura", um relatório diário com
envio "enviado" e o gasto do mês. O custo da IA é o de `dolores_consumo` (as rondas e o relatório não usam IA).

## 6. Conferir
- `dolores_rondas` (uma por dia + as sob demanda), `dolores_relatorios` (texto já mascarado), `dolores_relatorio_reenvios`
  (reenvios pela tela do relatório diário que falhou), `dolores_eventos`.
- `dolores_acoes`: `ronda` (ok/erro com as seções sem leitura, ou recusada pela pausa), `relatorio_envio` (ok, ou recusada:
  sem número do dono / desconectada / pausada), `pausa_geral` e `operacao_config` (tela).
- Ferramenta nova para a conversa: `relatorio_diario` (só lê a última ronda e o último relatório; não faz ronda).

---

# Etapa 7 — Grupos automáticos, por tipo (regra do dono de 19/11/2026)

Palavras do dono: "eu não quero ter que cadastrar grupo por grupo". **Todo grupo em que o DONO colocar o número da Dolores
entra sozinho** na lista (pelo aviso de que ela foi adicionada). A primeira mensagem e o botão "Atualizar grupos" também põem o
grupo na lista, mas sem provar quem a colocou: aí ele fica **aguardando você** (ver abaixo). A tela passa a servir para VER e
CORRIGIR.

**Só vale grupo em que a Dolores foi adicionada pelo número do dono** (o cadastrado em Integrações › Dolores). Palavras dele:
"somente o número principal, que no caso foi cadastrado meu lá na integração, pode adicionar o número da Dolores em grupo, e
assim nós não corremos risco de qualquer pessoa adicionar ela em outros grupos". Ela só aceita um grupo sozinha com **prova
positiva** (por código, nunca pelo texto das mensagens):
1. o aviso `group-participants.update` da Evolution (ação "add", com a Dolores entre os adicionados) traz o **autor**
   (`author`) = o número do dono (autor em `@lid` só vale se os participantes do grupo na Evolution mostrarem que aquele `@lid` é
   o número do dono). Aviso de "add" cujo autor não dá para provar (sem autor, `@lid` desconhecido) → **recusado**;
2. (QA-SEG E7 r2) o aviso `groups.upsert` **não aceita sozinho**: a lista de participantes que ele traz não prova que a Dolores
   estava no grupo desde a criação. Grupo criado agora por você, já com a Dolores, fica **aguardando você** e ela pergunta
   ("grupo <código> aceitar"). Para não precisar responder, crie o grupo sem ela e adicione-a depois, pelo seu número.
Sem esses avisos (primeira mensagem, "Atualizar grupos", grupos em que ela já estava): se os dados do grupo na Evolution mostram
o dono participante e criador/admin, o grupo fica **aguardando você: não sei quem me colocou** — ela só observa (não fala, nem
marcada; nada vai à IA) e manda: "Estou no grupo «X» e não sei quem me colocou. Se foi você, responda: grupo <código> aceitar".
Senão, **recusado**: ela não lê, não registra mensagens e não responde, e você recebe UM aviso ("fui colocada no grupo «X» por
outra pessoa; ignorei…"). Se chegar o aviso de que outra pessoa a adicionou a um grupo que você ainda não decidiu, ele passa a
recusado. Grupo que você já decidiu (adicionou ou aceitou) não é rebaixado se outra pessoa remover e recolocar a Dolores: você
recebe "«Fulano» me recolocou no grupo «X»" (no máximo um por grupo por dia). **Só você aceita**: responda `grupo <código> aceitar` na conversa direta com ela, ou adicione-a você mesmo (remova e
adicione de novo pelo seu número). A tela mostra e explica, deixa desativar, mas não aceita. Se o número do dono for trocado
depois, os grupos já aceitos continuam aceitos; os novos seguem o número novo.

**Depois da publicação, os grupos em que a Dolores JÁ está vão ficar aguardando você.** Sem o aviso de quem a adicionou (eles são
anteriores), nenhum é aceito sozinho: na primeira mensagem de cada um (ou no "Atualizar grupos") você recebe a pergunta com o
código. Aceite cada um com `grupo <código> aceitar`, ou remova a Dolores do grupo e adicione de novo pelo seu número (o aviso de
"add" prova que foi você). Até lá eles só observam.

**Instância já conectada: reaplique os avisos.** Os avisos de grupo (`GROUP_PARTICIPANTS_UPDATE`, `GROUPS_UPSERT`) passaram a
ser assinados pela instância da Dolores. Quem já estava conectado precisa clicar em **"Reativar recebimento"** em
Integrações › Dolores (o mesmo botão de antes) depois da publicação. Sem isso, os grupos novos ficam aguardando você (sem prova).

## 1. Banco (equipe técnica, já autorizado)
Aplicar `drizzle/0133_dolores_grupos_tipo.sql` no Neon **antes** de publicar o código (inclui as colunas de quem adicionou a Dolores e a situação `recusado`) (só aditiva e idempotente: colunas novas em
`dolores_grupos` e `dolores_grupos_config`, CHECKs e índices só se faltarem, e a guarda `dolores_grupos_guarda` trocada por
`CREATE OR REPLACE`, mantendo tudo o que já protegia; a exigência de decisão do dono para tipo/vínculo vale só para as linhas da
Etapa 7, então o código antigo continua funcionando sobre os grupos cadastrados à mão enquanto a publicação não termina). Nenhuma linha existente muda e nada é ligado: o interruptor geral de
"responder quando marcada" continua como está (desligado por padrão). Sem a 0133, as leituras de grupo falham fechado
(grupos ignorados).

## 2. Como ela descobre o tipo (por código, pelo NOME do grupo no WhatsApp; nunca pela IA nem pelas mensagens)
- Nome com **Jurídico**, **Administrativo**, **Parceiros** ou **Engenharia** (palavra inteira; acento e maiúscula não importam)
  → grupo interno daquele tipo.
- Nome igual ao de **um único** cliente do CRM (ou contendo o nome completo dele) → grupo de **cliente**; com "pós",
  "pós-atendimento" ou "pós venda" no nome → **pós-atendimento**.
- Dois clientes com o mesmo nome, nome curto (menos de 2 palavras ou 6 letras), dois tipos no nome ou nada casando →
  **não identificado**: ela pergunta a você e **só observa** (não fala nada lá, nem marcada) até você responder.
- Mudar o nome do grupo depois **não muda** o tipo nem o vínculo.

## 3. O aviso e a correção (o dono, no WhatsApp da Dolores)
Para cada grupo novo ela manda **um** aviso: "entrei no grupo «X». Entendi: cliente «Fulano» (nº 123). Se estiver errado,
responda: …". Para corrigir ou definir, responda na conversa direta com ela, a mensagem inteira:
- `grupo K7HM cliente 456` · `grupo K7HM pós 456` (nº do cliente no CRM)
- `grupo K7HM jurídico` · `grupo K7HM administrativo` · `grupo K7HM parceiros`
- `grupo K7HM engenharia` (geral) ou `grupo K7HM engenharia 12` (ligado à obra nº 12)
- `grupo K7HM ignorar` (desativa: não lê nem fala; nada é apagado)
- `grupo K7HM aceitar` (aceita um grupo recusado ou "aguardando você: não sei quem me colocou")
O código de 4 letras de cada grupo está no aviso e na tela. A mesma frase escrita dentro de um grupo, ou mandada por outro
número, não faz nada. Também dá para corrigir na tela ("Corrigir tipo ou vínculo", "Ignorar este grupo" — só admin), menos
aceitar e definir o tipo de grupo aguardando você: grupo recusado ou aguardando você (inclusive o que você adicionou mas de tipo
não identificado) só sai desse estado pelo seu comando no WhatsApp; a tela mostra o comando a enviar.

## 4. O que ela responde quando marcada, por tipo (travado no servidor)
- **Cliente / pós-atendimento:** só aquele cliente (andamento, etapas, documentos que faltam), como na Etapa 4b.
- **Administrativo (sócios):** as consultas gerais da Dolores, com CPF/telefone/e-mail **sempre mascarados** neste canal e nunca
  senhas, tokens, chaves ou dados bancários. Valores só os que vierem das consultas.
- **Jurídico:** processos, regularizações e documentos (sem valores: os campos de dinheiro — e os alertas e a conciliação das
  notas — saem no servidor antes de chegar à IA; nos textos que sobram, valores em dinheiro viram "[valor omitido]"; resposta com
  palavra de quantia — saldo, parcela, orçamento, valor… — vira a frase fixa; "foi paga"/"aguardando pagamento" passam se não
  houver número de dinheiro na frase).
- **Engenharia:** obras, medições e notas (sem valores, do mesmo jeito). Grupo ligado a uma obra (com o empreiteiro) continua só com aquela obra.
- **Parceiros:** só o andamento dos clientes que o **corretor que marcou** indicou (identificado pelo telefone do cadastro dele —
  número completo com 55, só a variação do 9º dígito —, usuário ativo de papel corretor). Sem identificar, responde uma frase fixa. Nunca cliente de outro parceiro, valores ou comissão.
- **Não identificado / desativado / recusado:** silêncio.
Em todos: só quando marcada, nunca faz nada a partir do grupo, os mesmos tetos, o orçamento e a pausa geral.

## 5. Interruptores e tetos (Integrações › Dolores — grupos)
- **Entrada automática de grupos:** nasce ligada (pedido do dono). Desligada, grupo novo é ignorado.
- **Teto de grupos novos por dia** (padrão 20) e **de avisos por dia** (padrão 25): passou, os grupos novos do dia ficam de fora e
  você recebe um aviso, uma vez. Os grupos sem prova (recusados ou aguardando você) têm a contagem deles, separada: quem coloca a
  Dolores em grupos à toa não tira a vaga dos grupos que VOCÊ adiciona. Deles você recebe no máximo 5 avisos por dia e depois um
  resumo único (os demais aparecem na tela, com o código).
- **Alguém entrou no grupo administrativo:** você recebe um aviso (um por grupo por dia, com contagem própria, separada dos
  avisos de grupo novo), porque lá ela responde sobre tudo.
- O interruptor de cada grupo já nasce **ligado** nos grupos reconhecidos; nada fala enquanto o interruptor GERAL de "responder
  quando marcada" estiver desligado.
- Documentos só vão à classificação em grupo de cliente/pós com cliente ligado (ou de obra, para a nota); em grupo interno ficam
  só registrados.
- O relatório diário mostra quantos grupos novos aguardam a sua resposta.

## 6. Reversão (cuidado apontado pelo QA)
Antes de voltar ao código anterior à Etapa 7 com a 0133 já aplicada, **desative os grupos `recusado` e `aguardando_dono`**
(`UPDATE dolores_grupos SET ativo = false WHERE situacao_confirmacao IN ('recusado', 'aguardando_dono')`, com a autorização do
dono): o código antigo não conhece essas situações e trataria esses grupos como ativos (leria e registraria as mensagens deles).

## 7. Conferir
`dolores_acoes`: `grupo_entrada` (entrou / aguardando / recusado / rebaixado / aceito / teto), `grupo_entrada_aviso` (aviso ao dono), `grupo_decisao` (comando ou tela),
`grupo_leitura` (consultas feitas quando marcada, com o tipo), `atualizar_grupos` (botão da tela).

---

# Etapa 8 — Respostas longas e custo real

Dois problemas reais de produção (19/11/2026): um pedido longo do dono ("divida os clientes do CRM em atraso até o fim do mês,
igualmente por dia") voltou como "não consegui concluir" (a resposta parou por tamanho e o texto parcial era descartado), e a
tela mostrava perto de US$ 2 para três perguntas no Haiku, quando o custo real foi de centavos.

## 1. Banco (equipe técnica)
Aplicar `drizzle/0134_dolores_precos.sql` no Neon (só aditiva e idempotente: `dolores_precos_modelo` e `dolores_cotacao`, com
`atualizado_por` em ON DELETE SET NULL; nenhuma tabela existente muda). **O número é 0134** porque a 0133 é da etapa 7
(`0133_dolores_grupos_tipo.sql`). Sem a 0134, a tela avisa "migração 0134 ainda não aplicada" e a estimativa usa só a reserva.

## 2. Respostas longas (nada a ligar)
- A resposta ao dono pode sair em **até 3 mensagens** seguidas, numeradas "(1/3)", cada uma com até 3.800 caracteres, cortadas
  em quebra de linha. Todas passam pelos mesmos filtros (links, dados pessoais conforme o interruptor, segredos e bancários
  sempre) e vão **só para o número do dono** (o destino é conferido uma vez e é o mesmo para todas). Se uma falhar, as seguintes
  não saem. Os quadros do sistema (o que foi feito e a fila, com os códigos) nunca são cortados.
- Se a IA parar por tamanho, o dono recebe o que já foi escrito, cortado no fim da última linha completa, com o aviso
  "(continua — … peça o restante em partes …)". Se ela parou sem texto nenhum, o sistema faz uma última chamada sem consultas
  pedindo a resposta curta. **"continuar" não foi implementado** (ver a story E8): o dono pede o resto em partes.
- A saída de cada chamada vai até 5.000 tokens, limitada ao que cabe no tempo que resta do pedido (45 s).
- Ferramenta nova: **`plano_de_atrasos`** (só leitura): os mesmos itens de `listar_atrasos`, do mais atrasado para o menos,
  divididos **igualmente** pelos dias até a data-limite (padrão: fim do mês; só dias úteis seg–sex por padrão; feriados não são
  conhecidos). Quem faz a conta é o sistema; a IA só repete.

## 3. Custo real (administrador, em Integrações › "Dolores — operação contínua" › Gasto da IA)
1. Em **Preços por modelo**, a tela lista os modelos que aparecem no consumo do mês e os escolhidos em Integrações › Anthropic.
   Para cada um, digite os preços da página da Anthropic em **US$ por milhão de tokens**: entrada, saída, escrita de cache e
   leitura de cache. Deixando escrita/leitura de cache vazias, o sistema assume **1,25×** e **0,1×** do preço de entrada (e a
   tela diz isso). O sistema não inventa preço.
2. Digite a **cotação do dólar** (R$ por US$) para ver em reais.
3. A tela mostra o gasto do mês em US$ e R$, **por modelo** e **por função** (conversa com o dono; resposta em grupo; documentos
   dos grupos e notas de obra — estas duas gravam o consumo do mesmo jeito e não dá para separar uma da outra).
4. Os dois campos antigos (R$ por milhão, preço único) viraram **preço de reserva**: só valem para modelo sem preço cadastrado,
   e a tela diz quando a estimativa usou a reserva. Se você tinha preenchido o preço do modelo mais caro neles, cadastre o preço
   de cada modelo acima (a reserva deixa de ser usada para ele).
O relatório do dono (diário e sob demanda) usa a mesma conta.

**O limite mensal continua em tokens** e, desde a C5-E1 (EPIC-027, rodada 4 do portão), conta o cache pelo peso do preço:
cada token de escrita de cache vale 1,25 e cada token de leitura de cache vale 0,1 (a proposta da story E8). Antes contava os dois
como entrada cheia, o que fazia a memória da conversa (que lê o histórico do cache) gastar a cota muito mais rápido que o dinheiro.
Os tokens brutos continuam gravados por chamada e a tela mostra "entrada contada no limite" ao lado do custo estimado.

## 4. Conferir
- `dolores_precos_modelo` e `dolores_cotacao` (quem mudou fica em `atualizado_por`); `dolores_acoes` com `operacao_config`
  ("preço por modelo alterado pela tela", "cotação do dólar alterada pela tela").
- Resposta em várias mensagens: uma linha `whatsapp_resposta` por mensagem, com `parte: "1/3"` no resumo.

# Etapa 9 — WhatsApp com uma conexão só, atendimento e campanhas (20/11/2026)

Regra do dono: CLAUDE.md, "WhatsApp — uma conexão só, atendimento e campanhas". Story:
`docs/stories/epics/epic-025-dolores/E9-conexao-unica-e-atendimento.md`. Tudo o que é novo nasce DESLIGADO.

## 1. Banco (equipe técnica)
- Aplicar `drizzle/0135_whatsapp_conexao_unica.sql` (aditiva e idempotente; pode rodar duas vezes). Não mexe na instância
  conectada nem na linha do admin em `whatsapp_connections`.

## 2. A conexão (administrador, Integrações › "WhatsApp da empresa (Dolores e Central)")
1. O número que já estava conectado na Dolores continua conectado: **não leia QR de novo**.
2. Clique **"Reativar recebimento"** UMA vez depois desta atualização: ele registra de novo o aviso da Evolution com o evento
   de LIGAÇÃO (`CALL`) e liga a recusa automática de ligações (lendo e regravando as configurações da instância, só trocando
   `rejectCall`). Sem isso, o aviso "não atendo ligações" não sai.
3. A Central (Conversas, Enviar mensagem, Templates) do admin e do colaborador passa a usar esse número. A aba "Minha conexão"
   do admin mostra só as conexões dos corretores; corretores continuam conectando o próprio número ali.
4. Se o cartão mostrar **"Ainda existe a conexão antiga da Central"**, clique **"Remover a conexão antiga da Central"** (só o
   administrador vê). Ele desliga e apaga no servidor do WhatsApp a instância que o admin/colaborador tinha conectado pela Central
   antes da conexão única, e limpa só a instância e a situação daquela linha (o histórico das conversas continua). A conexão da
   empresa não é tocada. Enquanto a antiga existir com o mesmo número, "Conferir conexão"/"Reativar recebimento" recusam (sem
   derrubar nada). Ela já não grava nada na Central.
5. Pelo número da empresa a Central nunca escreve ao dono nem ao próprio número, nem mostra essas conversas; envios manuais têm
   teto de 10 por minuto e 200 por dia (somando todos os usuários).

## 3. Ordem para ligar (cada passo é opcional; nada liga sozinho)
1. **Saudação de campanha** — Central › Templates › "Saudação de campanha": cadastre a campanha (nome, empreendimento
   opcional, texto FIXO, sem `{{…}}`) e clique **Ativar** (só uma fica ativa). Vai UMA vez por número a quem não está
   cadastrado. Teto diário em Integrações › "Atendimento pelo WhatsApp da empresa" (padrão 50/dia).
2. **Avisos de ligação e de áudio** — textos na mesma tela (padrão já preenchido); no máximo 1 a cada 3 h por número. LIGADOS
   por padrão (pedido do dono), com interruptor próprio e teto de 50 por dia no total, em Integrações › "Atendimento pelo WhatsApp
   da empresa".
3. **Dolores responde clientes cadastrados** — Integrações › "Atendimento pelo WhatsApp da empresa" › Ligar. Exige a IA da
   Dolores ligada, a chave da Anthropic e os limites mensais. Modelo: Integrações › Anthropic › Modelo por função ›
   "Dolores — resposta a cliente cadastrado" (o mais barato basta). Tetos: 10 por cliente/dia, 100 por dia; orçamento
   próprio de 10% do limite mensal; calada por 6 h na conversa em que a equipe respondeu.
4. **Transcrição de áudio (Cloudflare Workers AI, faixa gratuita)**:
   - No painel da Cloudflare: Workers AI › copiar o **Account ID** (32 caracteres) e criar um **API Token** com a permissão
     "Workers AI — Read/Edit" (só ela).
   - Em Integrações › "Atendimento pelo WhatsApp da empresa" › Cloudflare: colar os dois e Salvar (a tela mostra só o final).
   - Depois, "Transcrição de áudio" › Ligar. Duração máxima 120 s; 10 por número/dia; 100 por dia.
   - Modelo `@cf/openai/whisper-large-v3-turbo`, chamado em
     `POST https://api.cloudflare.com/client/v4/accounts/{Account ID}/ai/run/@cf/openai/whisper-large-v3-turbo` com
     `{ "audio": "<base64>", "task": "transcribe", "language": "pt" }`. **Conferir na documentação oficial ao ligar**: o host
     da Cloudflare não estava liberado na rede do ambiente de desenvolvimento, e os testes usam cliente simulado.
   - O áudio vai à Cloudflare: isso entra no termo de consentimento (pendência do jurídico).

## 4. O que NUNCA muda
- Comando só do número do dono, por TEXTO, na conversa direta. Áudio do dono não é transcrito nem vira comando (ele recebe
  "só entendo texto"). Mensagem de cliente, de grupo, áudio transcrito e o que o próprio número enviou nunca são comando.
- A conversa do dono com a Dolores e os grupos nunca aparecem na Central.
- Disparo em massa pelo número principal fica bloqueado até a coexistência com a API oficial (fase separada): a aba
  "Enviar mensagem" aceita um contato por vez pelo número da empresa.

## 5. Conferir
- `whatsapp_messages.automatica = true`: o que o sistema enviou sozinho (resposta da Dolores, saudação, aviso).
- `dolores_atendimentos`: cada mensagem de cliente tratada (situação, motivo, tokens); `whatsapp_saudacoes`: quem recebeu
  qual campanha (número só como resumo HMAC e mascarado); `dolores_acoes` com `whatsapp_automatica`, `cliente_atendimento`,
  `cliente_leitura`, `configurar_atendimento`, `campanha_saudacao`, `configurar_cloudflare`.
- Desligar tudo: "Desligar" nos dois interruptores e "Desativar" na campanha. A pausa geral da Dolores também cala tudo isso.

---

# EPIC-027 C5-E5 — Gasto separado por função e alerta em 80% (decisão do dono de 21/11/2026)

"Cada função com seu gasto": o limite mensal (tokens, em Integrações › Dolores) é dividido em partes, e uma função não consome
o crédito das outras. Story: `docs/stories/epics/epic-027-correcoes-20-11-noite/C5-E5-gasto-por-funcao.md`.

## 1. Banco (equipe técnica, já autorizado)
Migração `drizzle/0148_dolores_gasto_por_funcao.sql` (aditiva e idempotente): coluna `dolores_consumo.funcao` (linhas antigas
ficam vazias e contam pela origem), `dolores_gasto_partes` (a divisão) e `dolores_gasto_alertas` (os alertas já enviados).
Sem ela, vale a divisão padrão e não há alerta.

## 2. A divisão (padrão do dono)
| Função | Parte | O que é |
|---|---|---|
| Conversa com o dono | 55% | o WhatsApp do dono com a Dolores |
| Documentos | 20% | classificação dos documentos dos grupos e leitura das notas de obra |
| Grupos | 10% | resposta no grupo quando marcada |
| Clientes | 10% | atendimento a cliente cadastrado |
| Avisos | 5% | avisos automáticos (proatividade, etapa E4) |

Ao bater a parte, **só aquela função** fica sem IA até o mês seguinte. A conversa recebe "bati o limite do mês da nossa
conversa; os grupos e os documentos continuam funcionando"; grupo e cliente ficam em silêncio (a equipe responde). Continuam
valendo os tetos por dia, o orçamento próprio da classificação e o limite inteiro.

Mudar a divisão (só o administrador):
1. Abra o Prospecta em **Configurações › Integrações** e role até o cartão **"Dolores — operação contínua"**.
2. Em **"Gasto por função"**, no quadro **"Divisão do limite"**, digite as cinco porcentagens (inteiras, cada uma de 1 a 96,
   somando 100). A linha "Soma" mostra o total e o problema, se houver.
3. Toque em **"Salvar divisão"**. Para voltar ao padrão, **"Voltar à divisão do dono (55 · 20 · 10 · 10 · 5)"**.
Ao final, cada barra mostra o gasto da função contra a nova parte.

## 3. Alertas no WhatsApp do dono (texto fixo, sem IA, sem custo)
- **80%**: quando o gasto do mês chega a 80% do teto (total) e quando uma função chega a 80% da parte dela — com quanto gastou,
  quanto resta e qual função. Em reais pela mesma conta da tela, quando todos os modelos têm preço e há cotação; senão, pelos
  tokens.
- **100%**: aviso de que entrou em modo sem IA (no total ou só naquela função).
- Cada um sai **uma vez por mês** (o estado aparece no cartão, abaixo das barras). Só números e nomes de função: nunca nome de
  cliente, telefone ou CPF.

# EPIC-027 C5-E4 — Avisos automáticos ao dono (decisão do dono de 21/11/2026)

A Dolores avisa você sozinha, no seu WhatsApp, do que as REGRAS do sistema acharem relevante (obras com atraso, tarefas vencidas
paradas, documentos pendentes no card do cliente, notas de obra sem confirmação ou divergentes, regularizações paradas, grupos esperando
a sua decisão, contas bancárias sem sincronizar). De segunda a sábado, das 07h às 20h (Brasília), no máximo 6 avisos por dia, tudo
agrupado num aviso só. Nasce DESLIGADO. Story: `docs/stories/epics/epic-027-correcoes-20-11-noite/C5-E4-proatividade.md`.

## 1. Banco (equipe técnica, já autorizado)
Aplicar `drizzle/0150_dolores_avisos.sql` no Neon (aditiva e idempotente). Conferir na Vercel (Settings › Cron Jobs) que aparecem os
15 crons (os 10 de antes e os 5 novos `/api/cron/dolores-avisos/15` … `/19`).

## 2. Ligar (você, administrador)
1. Abra https://prospecta-crm.vercel.app/admin/integracoes (ou o endereço do sistema › Configurações › Integrações).
2. Desça até o cartão **"Dolores — operação contínua"** e, no fim dele, a seção **"Avisos automáticos ao dono"**.
3. Ligue a chave **"Avisos"**. Ela só liga com o número do dono cadastrado (em "WhatsApp da empresa (Dolores e Central)").
4. (Opcional) Ajuste os limites (ex.: "Obra atrasada há (dias)") e toque em **"Salvar limites"**.
5. (Opcional) Ligue **"IA escreve o texto"** — só redige o aviso, gastando a parte "avisos" (5%) do limite; precisa do interruptor da
   IA da Dolores ligado. Desligada, sai o texto fixo (o conteúdo é o mesmo).
6. Ao final, você deve ver "Avisos **ligados**". O primeiro aviso sai na próxima chamada do cron dentro da janela.

## 3. Silenciar um tipo
- Na mesma seção, desligue a chave do tipo (ex.: "tarefas vencidas paradas"); ou
- no WhatsApp, diga à Dolores: "pare de me avisar de tarefas vencidas" e responda **pode** à pergunta dela. Para voltar: "volta a me
  avisar de tarefas vencidas" e **pode**.
