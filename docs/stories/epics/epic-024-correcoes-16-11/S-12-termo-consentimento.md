# S-12 — Termo de consentimento no primeiro acesso (criação de senha)

Status: InProgress
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
- [ ] AC1: na tela de criar senha, logo acima do botão: uma frase curta, uma caixa de seleção **desmarcada** e o link
      "Ler o termo completo" (abre `/termo-de-consentimento` em página própria, legível no celular). Sem marcar, o botão
      não envia e aparece um aviso curto. `<label>` ligado à caixa, navegável por teclado, contraste adequado.
- [ ] AC2: termo completo em arquivo único (`shared/termo-consentimento.ts`, `VERSAO_DO_TERMO` + seções), linguagem
      simples, sem afirmar conformidade legal; dados que o sistema não tem ficam como "[A PREENCHER PELO JURÍDICO: …]".
- [ ] AC3: tabela só de inclusão `consentimentos` (usuário, versão, data/hora, canal, resumo técnico mínimo sem IP nem
      user-agent); gatilho recusa UPDATE/DELETE/TRUNCATE. Aceite gravado na **mesma transação** que grava a senha (falha
      em um desfaz o outro). O servidor exige `aceitouTermo: true` + `versaoDoTermo` atual no primeiro acesso.
- [ ] AC4: quem já tem senha não muda de login. Opção "pedir o aceite uma vez no próximo login" pronta e **desligada**
      (variável `CONSENTIMENTO_PEDIR_NO_LOGIN`), documentada.
- [ ] AC5: mudar `VERSAO_DO_TERMO` não invalida acessos; admin vê quantos aceitaram cada versão.
- [ ] AC6: admin (por PAPEL) vê por usuário se aceitou, quando e qual versão, e lê o termo vigente (com o aviso
      "Texto provisório — revisar com o jurídico"). Sem editar nem apagar.
- [ ] AC7: redefinição não pede de novo quando já há aceite da versão atual; conta antiga nunca aceita não é bloqueada.
- [ ] AC8: migração `0127_consentimentos.sql` aditiva e idempotente; schema em `drizzle.config.ts`.
- [ ] AC9: permissões testadas pelo `appRouter` com caminho completo.
- [ ] AC10: pendência de porte no ROADMAP (Santa Fé, em espera).
- [ ] AC11: limitação registrada em destaque (acima).

## Regra de "primeiro acesso" (servidor, `server/consentimento.ts`)
O mesmo link e a mesma tela servem para primeiro acesso e redefinição. O servidor decide:
- já existe aceite da versão atual → não pede (a caixa não aparece);
- senão, é **primeiro acesso** (aceite obrigatório) quando: a conta foi criada a partir de `INICIO_DO_TERMO`
  (17/11/2026), **ou** o link é o convite da criação da conta (vence 7 dias depois do cadastro, ±10 min) — cobre convites
  antigos ainda não usados;
- senão (conta antiga redefinindo a senha) → a caixa aparece como opcional; marcada, o aceite é gravado; desmarcada,
  a senha é salva normalmente.

## Marcadores "[A PREENCHER PELO JURÍDICO]"
(lista final em "Progresso")

## Decisões próprias
(lista final em "Progresso")

## File List
(lista final em "Progresso")

## Progresso
- [ ] Story e linha no EPIC.md
