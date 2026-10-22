# Handoff — identidade do admin e SMTP Prospecta (22/10/2026)

## Concluído

- O retorno de e-mail mostrou falha DNS para o domínio do endereço antigo de login. O admin em produção existia nesse endereço; o endereço institucional desejado já estava ocupado por um corretor de teste.
- Em transação guardada, mantivemos o ID e a senha do admin, transferimos seu e-mail para `atendimento@prospectaconstrucoes.com` e desativamos o corretor de teste, retirando apenas seu e-mail e invalidando sua sessão. Os vínculos do corretor e registros de negócio não foram apagados. Leitura posterior confirmou um admin ativo no endereço correto e o corretor de teste inativo.
- Na Vercel do projeto Prospecta, `SMTP_USER` foi definido como o endereço institucional e `SMTP_PASSWORD` recebeu a credencial fornecida pelo dono, ambos somente em Production e do tipo sensível. Não registrar a senha neste arquivo nem em commits. `SMTP_HOST` e `SMTP_PORT` existentes foram preservados.
- `scripts/setup-db.ts` passa a criar o admin inicial no endereço institucional somente com `INITIAL_ADMIN_PASSWORD` de ambiente e não imprime essa senha. `scripts/migrate.sql` deixou de conter o seed com e-mail e hash de senha fixos. O login em produção lê o campo `users.email`, portanto mantém a senha atual do site.
- As notificações institucionais e as solicitações de medição já usam o endereço institucional no código; `sendEmail` usa `SMTP_USER` como remetente.

## Verificação e pendências

- (a) Automática: `git diff --check`, busca dos identificadores antigos no código executável, 16/16 testes de SMTP/medição e `tsc --noEmit` passaram. O wrapper `pnpm exec` tentou instalar dependências e encontrou bloqueio de scripts de build; a execução direta dos binários instalados passou.
- (b) Manual: leitura do registro de admin e conflito no banco, leitura de volta dos dois registros após a troca, inspeção dos nomes/escopos das variáveis da Vercel sem revelar valores.
- (c) Produção: ainda é preciso publicar o código, conferir deploy READY e enviar uma mensagem de teste com retorno SMTP e recebimento na caixa. O conector da Vercel não devolve o conteúdo sensível de `SMTP_HOST`, então um envio real determinará se host/porta e autenticação estão coerentes.
- Próximo passo: testar, publicar PR, verificar preview e deploy de produção, fazer teste de envio e registrar resultado; se o provedor exigir senha específica de aplicativo ou servidor SMTP diferente, ajustar apenas as variáveis sensíveis.

## Paridade

O Grupo Santa Fé usa outro domínio, outro remetente e outro admin; não substituir sua identidade institucional pela da Prospecta. A regra comum continua sendo login por usuário existente e SMTP configurado por ambiente.
