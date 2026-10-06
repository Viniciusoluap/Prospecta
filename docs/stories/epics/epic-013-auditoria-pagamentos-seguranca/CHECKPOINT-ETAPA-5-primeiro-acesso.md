# Checkpoint — Primeiro acesso / redefinição de senha pelo próprio usuário (Passo 61 — paridade)

## Contexto

Durante a aplicação da regra de paridade obrigatória, foi confirmado que o
`configuracoes-router.ts` do Prospecta tinha a mesma falha que o Grupo Santa Fé
corrigiu na S-10: tanto `createUser` quanto `resetPassword` deixavam o **admin
digitar a senha de outra pessoa diretamente** — seja a senha inicial de uma
conta nova, seja a nova senha ao redefinir.

Diferente do Santa Fé, o Prospecta **já tem um sistema de email funcional**
(`server/_core/email-smtp.ts`, SMTP real via `nodemailer`), então a entrega do
link pôde ser 100% automática — sem precisar de nenhum passo manual (nem
sequer o "copiar e enviar por WhatsApp" que o Santa Fé precisou).

## Solução

- `users` ganha `tokenPrimeiroAcesso` (único) + `tokenPrimeiroAcessoExpiraEm`
  (7 dias de validade) — migration aditiva.
- `email_template_type` ganha o valor `"primeiro_acesso"`.
- `shared/session.ts` ganha `tokenPrimeiroAcessoAindaValido(expiraEm, agora?)`
  — função pura, testada isoladamente (mesmo padrão de `sessaoAindaValida`).
- `server/_core/email-smtp.ts` ganha `primeiroAcessoTemplate`.
- `server/configuracoes-router.ts`:
  - `createUser` não recebe mais `password` — cria a conta com um hash
    placeholder inutilizável e dispara o email de definição de senha
    automaticamente.
  - `resetPassword` não recebe mais `password` — só o `id`; incrementa
    `sessionVersion` na hora (revoga sessões já emitidas imediatamente,
    sem esperar o link ser usado) e dispara o email com o link.
  - Novo `primeiroAcessoRouter` (público, sem autenticação):
    `validarToken` (query, pra renderizar a página) e `definirSenha`
    (mutation, com reivindicação atômica do token — guarda contra reuso em
    corrida).
- `client/src/pages/DefinirSenha.tsx` (novo) + rota pública
  `/definir-senha/:token` em `App.tsx`.
- `client/src/pages/admin/AdminConfiguracoes.tsx`: os dois formulários que
  pediam senha digitada agora são um clique só ("Criar usuário" sem campo de
  senha; "Enviar link de redefinição" no lugar do campo de nova senha).

## Por que isso é mais automático que no Santa Fé

O Santa Fé não tem nenhum mecanismo de email, então o link de primeiro acesso
precisa ser copiado pelo admin e entregue manualmente (WhatsApp, ligação
etc.) — documentado como o único passo genuinamente inevitável naquele
sistema. Aqui não: o Prospecta manda o email sozinho. Se o envio falhar (SMTP
mal configurado), a conta/token ainda são criados normalmente e a UI avisa o
admin para conferir a configuração — mas o caminho feliz é 100% automático.

## Gates executados

- `npx tsc --noEmit` — limpo.
- `npx vitest run` — 53 arquivos, 391/391 testes (4 novos para
  `tokenPrimeiroAcessoAindaValido`).
- `npm run build` — passa (aviso de bundle size pré-existente).
- `git diff --check` — limpo.
- Migration validada e aplicada em produção (Neon `plain-cake-26372935`) —
  confirmada via `information_schema.columns` e `pg_enum`.

## Não testado nesta sessão

Envio real de email em produção (exigiria credenciais SMTP reais e uma caixa
de entrada de teste, indisponíveis neste ambiente) — a lógica de envio em si
(`sendEmail`, `server/_core/email-smtp.ts`) já tinha cobertura de teste
própria (`email-smtp.test.ts`), reaproveitada sem alteração.
