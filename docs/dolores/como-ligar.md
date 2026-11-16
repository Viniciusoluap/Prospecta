# Como ligar a Dolores (Etapa 1 — Leitura)

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
