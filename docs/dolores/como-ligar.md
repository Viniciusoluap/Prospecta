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
3. No mesmo cartão: "Escolher modelo" → escolher o modelo → "Salvar preferência". (Opcional: o cartão da Dolores aceita
   um modelo próprio, que tem precedência.)
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

## Parar
- **Desligar a IA** (Integrações › Dolores): vale na hora; ela passa a responder só a frase fixa.
- Pausa geral (`dolores_config.pausada`, etapa 1): para a ponte e o WhatsApp.
- Desconectar o número (Integrações › Dolores) ou desativar a usuária Dolores em Usuários e acesso.
