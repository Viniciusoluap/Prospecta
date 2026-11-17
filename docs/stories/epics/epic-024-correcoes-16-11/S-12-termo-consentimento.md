# S-12 — Termo de consentimento no primeiro acesso (criação de senha)

Status: InReview (implementada; aguardando QA; migração 0127 a aplicar antes do deploy)
Epic: EPIC-024 — pedido complementar do dono (17/11/2026), ligado à Dolores (EPIC-025, opção B: dados pessoais liberados)
Paridade: o primeiro acesso por link existe nos dois sistemas — porte para o Grupo Santa Fé fica como pendência no
ROADMAP (Santa Fé em espera por decisão do dono).
Tamanho estimado: M
Migração: `drizzle/0127_consentimentos.sql` (só aditiva e idempotente; tabela nova, nenhuma tabela existente alterada).

## Pedido do dono (17/11/2026, palavras dele)
"Todo mundo ao criar a sua senha de primeiro acesso deve aceitar um termo bem simples de consentimento desses dados;
bote de uma maneira bem simples e prática."

Contexto: o dono autorizou a Dolores (assistente de IA) a consultar dados pessoais de clientes (CPF, telefone, e-mail),
que são enviados a um fornecedor de IA (Anthropic) para montar respostas.
Decisão já tomada com o dono (não reabrir): o termo é CURTO e RÁPIDO, mas NÃO escondido — nada de caixa pré-marcada,
letra miúda, texto disfarçado ou aceite implícito.

## > LIMITAÇÃO (importante — decisão do dono e do jurídico)
> O termo cobre **só quem cria login** no sistema. Clientes e leads do CRM que nunca acessam o sistema **não passam por
> ele** — e são justamente os dados deles (CPF, telefone, e-mail) que a Dolores consulta. O consentimento dessas
> pessoas precisa vir de outro lugar: contrato, ficha de cadastro ou atendimento. Isso é decisão do dono com o jurídico;
> esta story não resolve.

## Como uma senha é criada hoje (levantamento de 17/11)
| # | Caminho | Quem | Tela / rota | Coberto pela S-12? |
|---|---|---|---|---|
| 1 | Admin cadastra usuário em "Usuários e acesso" (`configuracoes.createUser`) → e-mail com link de 7 dias → a pessoa define a senha em `/definir-senha/:token` (`primeiroAcesso.definirSenha`) | admin, colaborador, engenheiro, corretor, cliente, empreiteiro | `client/src/pages/DefinirSenha.tsx` | **Sim** — aceite obrigatório |
| 2 | Corretor cadastrado "sem convite" → depois o admin clica em "Enviar link de redefinição" (`configuracoes.resetPassword`) → mesmo `/definir-senha/:token` | corretor | mesma tela | **Sim** — conta nova sem aceite = primeiro acesso, aceite obrigatório |
| 3 | Admin envia "link de redefinição" para conta que já tinha senha (`configuracoes.resetPassword`) → mesmo `/definir-senha/:token` | todos | mesma tela | Redefinição: **não pede de novo** se já aceitou a versão atual; conta antiga sem aceite **não é bloqueada** (caixa opcional) |
| 4 | Admin digita a senha do cliente no painel do lead (`portal.admin.provisionAccess`, `AdminPortalLeadPanel.tsx`) | cliente do portal | nenhuma tela da pessoa | **Não** — a senha é criada pelo admin, a pessoa não passa por tela de criação. Ver "Em aberto" |
| 5 | Usuária técnica da Dolores (`server/dolores/perfil.ts`) | sistema | — | Não se aplica (sem senha e sem e-mail) |
| 6 | Login OAuth legado (`server/_core/oauth.ts`, `sdk.ts` → `upsertUser`) | — | sem senha | Não se aplica (não cria senha) |

Não existe "esqueci minha senha" self-service: a redefinição é sempre disparada pelo admin (caminho 3).

## Critérios de aceite
- [x] AC1: na tela de criar senha, logo acima do botão: uma frase curta, uma caixa de seleção **desmarcada** e o link
      "Ler o termo completo" (abre `/termo-de-consentimento` em página própria, legível no celular). Sem marcar, o botão
      não envia e aparece um aviso curto. `<label>` ligado à caixa, navegável por teclado, contraste adequado.
- [x] AC2: termo completo em arquivo único (`shared/termo-consentimento.ts`, `VERSAO_DO_TERMO` + seções), linguagem
      simples, sem afirmar conformidade legal; dados que o sistema não tem ficam como "[A PREENCHER PELO JURÍDICO: …]".
- [x] AC3: tabela só de inclusão `consentimentos` (usuário, versão, data/hora, canal, resumo técnico mínimo sem IP nem
      user-agent); gatilho recusa UPDATE/DELETE/TRUNCATE. Aceite gravado na **mesma transação** que grava a senha (falha
      em um desfaz o outro). O servidor exige `aceitouTermo: true` + `versaoDoTermo` atual no primeiro acesso.
- [x] AC4: quem já tem senha não muda de login. Opção "pedir o aceite uma vez no próximo login" pronta e **desligada**
      (variável `CONSENTIMENTO_PEDIR_NO_LOGIN`), documentada.
- [x] AC5: mudar `VERSAO_DO_TERMO` não invalida acessos; admin vê quantos aceitaram cada versão.
- [x] AC6: admin (por PAPEL) vê por usuário se aceitou, quando e qual versão, e lê o termo vigente (com o aviso
      "Texto provisório — revisar com o jurídico"). Sem editar nem apagar.
- [x] AC7: redefinição não pede de novo quando já há aceite da versão atual; conta antiga nunca aceita não é bloqueada.
- [x] AC8: migração `0127_consentimentos.sql` aditiva e idempotente; schema em `drizzle.config.ts`.
- [x] AC9: permissões testadas pelo `appRouter` com caminho completo.
- [x] AC10: pendência de porte no ROADMAP (Santa Fé, em espera).
- [x] AC11: limitação registrada em destaque (acima).

## Regra de "primeiro acesso" (servidor, `server/consentimento.ts`)
O mesmo link e a mesma tela servem para primeiro acesso e redefinição. O servidor decide:
- já existe aceite da versão atual → não pede (a caixa não aparece);
- senão, é **primeiro acesso** (aceite obrigatório) quando: a conta foi criada a partir de `INICIO_DO_TERMO`
  (17/11/2026), **ou** o link é o convite da criação da conta (vence 7 dias depois do cadastro, ±10 min) — cobre convites
  antigos ainda não usados;
- senão (conta antiga redefinindo a senha) → a caixa aparece como opcional; marcada, o aceite é gravado; desmarcada,
  a senha é salva normalmente.

## Texto curto (ao lado da caixa)
"Li e concordo com o tratamento dos meus dados pela Prospecta, inclusive por ferramentas de inteligência artificial
usadas no atendimento. **Ler o termo completo**" (link, abre em nova aba). Aviso sem marcar: "Para criar a senha,
marque a caixa de concordância com o termo." Em conta antiga redefinindo a senha, a frase ganha "(opcional)".

## Marcadores "[A PREENCHER PELO JURÍDICO]"
1. Endereço da sede (o sistema só mostra "Imperatriz - MA").
2. Nome e contato do encarregado.
3. Prazo de guarda dos dados após o fim da relação.
4. Prazo de resposta aos pedidos do titular.
Razão social, CNPJ, e-mail e telefone de contato vêm do que o site já exibe (rodapé e Política de Privacidade).

## Como ligar "pedir o aceite no próximo login" (DESLIGADO)
Na Vercel, variável `CONSENTIMENTO_PEDIR_NO_LOGIN=1` e nova publicação. Ligada, quem entrar em `/admin`, `/portal`,
`/corretor`, `/empreiteiro` ou `/perfil` sem aceite da versão vigente vê o termo uma vez (`ConsentimentoNoLogin.tsx`),
sem poder fechar sem aceitar; o aceite fica com canal "login". Para pedir de novo após mudar o texto: subir
`VERSAO_DO_TERMO` e ligar a variável. Desligada, ninguém é perguntado e a rota `consentimento.aceitar` recusa.

## Decisões próprias
- [AUTO-DECISION] Como distinguir primeiro acesso de redefinição, se o link e a tela são os mesmos? → pela conta (criada
  a partir de 17/11 00:00 UTC, ou link = convite emitido no cadastro, ±10 min) e por aceite anterior (razão: não há
  coluna que diga isso e `users` não pode ganhar coluna; cobre também o corretor cadastrado "sem convite").
- [AUTO-DECISION] Conta antiga redefinindo a senha → caixa opcional (não bloqueia, mas permite registrar o aceite).
- [AUTO-DECISION] Quem aceitou uma versão anterior → caixa opcional na redefinição (versão nova não bloqueia; item 5).
- [AUTO-DECISION] `consentimentos.user_id` sem chave estrangeira → excluir usuário continua funcionando como hoje e a
  prova (número da conta, versão, data) permanece. Integridade garantida pela transação com o UPDATE da senha.
- [AUTO-DECISION] Resumo técnico = só a categoria do aparelho (celular/tablet/computador/desconhecido) e se veio com a
  senha. IP e user-agent NÃO são guardados (não são necessários para a prova).
- [AUTO-DECISION] O botão fica clicável (esmaecido, `aria-disabled`) sem a caixa marcada: o clique mostra o aviso e
  leva o foco à caixa, em vez de um botão morto sem explicação. Nada é enviado.
- [AUTO-DECISION] `consentimento.minhaSituacao` é pública (responde "não pedir" sem login), porque o cliente redireciona
  ao login em qualquer UNAUTHORIZED; só roda nas áreas logadas. Com a opção desligada não consulta o banco.
- [AUTO-DECISION] O link do termo abre em nova aba, para não perder a senha já digitada.
- Duas promessas tiradas do rascunho por não serem garantidas pelo sistema ("não vendemos seus dados", "decisões
  sempre tomadas por pessoas").

## Em aberto
- `portal.admin.provisionAccess` (admin digita a senha do cliente no painel do lead): a pessoa não passa por tela de
  criar senha, então não há aceite. Opções para o dono: trocar esse caminho pelo link por e-mail, ou ligar a opção do
  login (que cobre essas contas).
- Contas antigas com convite ainda não usado mas emitido depois do cadastro (ex.: corretor antigo "sem convite" que
  receber o link agora) caem na regra "opcional".
- Marcadores do jurídico; revisão do texto; limitação dos leads do CRM (acima).

## File List
- `docs/stories/epics/epic-024-correcoes-16-11/S-12-termo-consentimento.md` (nova)
- `docs/stories/epics/epic-024-correcoes-16-11/EPIC.md` (linha 11)
- `docs/stories/epics/ROADMAP.md` (pendência Santa Fé)
- `HANDOFF-16-11-CORRECOES-E-DOLORES.md` (atualização 17/11)
- `shared/termo-consentimento.ts` (novo — texto, versão, frase curta)
- `drizzle/0127_consentimentos.sql` (nova), `drizzle/schema-consentimentos.ts` (novo), `drizzle.config.ts`
- `server/consentimento.ts` (novo — regra, transação, rotas), `server/consentimento.test.ts` (novo, 17 testes)
- `server/configuracoes-router.ts` (`primeiroAcesso.validarToken` e `definirSenha`), `server/routers.ts` (`consentimento`)
- `client/src/components/consentimento/{CaixaDoTermo,TextoDoTermo,ConsentimentoNoLogin}.tsx` (novos)
- `client/src/pages/TermoConsentimento.tsx` (nova), `client/src/pages/DefinirSenha.tsx`, `client/src/App.tsx`
- `client/src/pages/admin/AdminConfiguracoes.tsx` (botão e janela do termo, situação por usuário)

## Testes
- Automáticos: `server/consentimento.test.ts` 17/17 (recusa sem aceite, versão errada, aceite+senha juntos, falha no
  aceite desfaz a senha, link reusado não grava aceite, convite antigo, redefinição sem repetir, conta antiga não
  bloqueada, versão anterior, só inclusão, exclusão da conta mantém a prova, opção desligada/ligada, permissões pelo
  appRouter). Suítes `auth*`, `admin*`, `imports-esm`, `api-rotas-producao`, `email-identidade`, `drive-exclusoes`,
  `operacional`: 116/116 (10 arquivos). `tsc --noEmit` ok. `vite build` ok.
- Manuais (Playwright, computador 1366, iPhone 13, iPad): caixa desmarcada; sem marcar nada é enviado e o aviso
  aparece; marca pelo teclado (espaço); label ligado; link abre `/termo-de-consentimento` em nova aba; envio leva
  `aceitouTermo: true` + versão; modo "opcional" envia sem aceite; modo "aceito" sem caixa; termo com 8 seções; consulta
  do admin com aviso "Texto provisório"; nenhuma rolagem lateral.
- Pendente em produção: aplicar 0127, criar usuário de teste e definir a senha pelo link.

## Progresso
- [x] Story e linha no EPIC.md
- [x] Servidor: regra, transação, tabela só de inclusão, rotas
- [x] Testes do servidor
- [x] Telas: caixa, termo, consulta do admin, aviso no login (desligado)
- [x] Verificação (tsc, vitest, vite build, Playwright)
- [ ] QA → aplicar 0127 → publicar
