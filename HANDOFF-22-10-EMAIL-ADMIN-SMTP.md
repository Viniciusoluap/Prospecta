# Handoff — identidade do admin e SMTP Prospecta (22/10/2026)

## Concluído

- O retorno de e-mail mostrou falha DNS para o domínio do endereço antigo de login. O admin em produção existia nesse endereço; o endereço institucional desejado já estava ocupado por um corretor de teste.
- Em transação guardada, mantivemos o ID e a senha do admin, transferimos seu e-mail para `atendimento@prospectaconstrucoes.com` e desativamos o corretor de teste, retirando apenas seu e-mail e invalidando sua sessão. Os vínculos do corretor e registros de negócio não foram apagados. Leitura posterior confirmou um admin ativo no endereço correto e o corretor de teste inativo.
- Na Vercel do projeto Prospecta, `SMTP_USER` foi definido como o endereço institucional e `SMTP_PASSWORD` recebeu a credencial fornecida pelo dono, ambos somente em Production e do tipo sensível. Não registrar a senha neste arquivo nem em commits. `SMTP_HOST` e `SMTP_PORT` existentes foram preservados.
- `scripts/setup-db.ts` passa a criar o admin inicial no endereço institucional somente com `INITIAL_ADMIN_PASSWORD` de ambiente e não imprime essa senha. `scripts/migrate.sql` deixou de conter o seed com e-mail e hash de senha fixos. O login em produção lê o campo `users.email`, portanto mantém a senha atual do site.
- As notificações institucionais e as solicitações de medição já usam o endereço institucional no código; `sendEmail` usa `SMTP_USER` como remetente.

## Verificação e resultado

- (a) Automática: `git diff --check`, busca dos identificadores antigos no código executável, 16/16 testes de SMTP/medição e `tsc --noEmit` passaram. O wrapper `pnpm exec` tentou instalar dependências e encontrou bloqueio de scripts de build; a execução direta dos binários instalados passou.
- (b) Manual: leitura do registro de admin e conflito no banco, leitura de volta dos dois registros após a troca, inspeção dos nomes/escopos das variáveis da Vercel sem revelar valores.
- (c) GitHub/Vercel: PR #152 mesclado em `main` no commit `dd1f564ab990027be63fb69cf0a6da8c5b70f215`; deploy de produção `dpl_3qp5APDgKV9jN9yQyNnRzc812xni` em estado READY.
- (d) Envio real: formulário público Contato na URL do deploy de produção confirmou “MENSAGEM ENVIADA!”. `email_logs.id=33`, criado em 22/10/2026 às 18:10:35 UTC, registra destinatário institucional, `admin_notification`, status `sent`, `error_message=NULL` e `sent_at=18:10:36 UTC`. Isto confirma aceitação pelo servidor SMTP; o recebimento final na caixa de entrada e eventual filtragem antispam não foram inspecionados.
- O teste criou um lead identificado como “Teste técnico SMTP Prospecta”, telefone fictício e observação explícita de desconsiderar como lead comercial. O registro foi mantido para rastreabilidade, sem apagar dados de produção.

## Paridade

O Grupo Santa Fé usa outro domínio, outro remetente e outro admin; não substituir sua identidade institucional pela da Prospecta. A regra comum continua sendo login por usuário existente e SMTP configurado por ambiente.
