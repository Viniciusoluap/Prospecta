# Configuração segura do Asaas

A integração aceita `ASAAS_API_KEY` e `ASAAS_ENVIRONMENT=sandbox|production` no ambiente ou a configuração cifrada salva pelo painel administrativo. A seleção do endpoint é sempre explícita, o padrão local é `sandbox` e nenhuma chave é inventada quando a configuração está ausente.

O painel administrativo valida a credencial no servidor e persiste o segredo cifrado com AES-256-GCM. Essa cifragem exige `JWT_SECRET`; a API nunca devolve a chave ou o token de webhook ao navegador. Segredos não devem ser incluídos no código-fonte, documentação, logs ou fixtures.

Para SMTP, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` e `SMTP_PASSWORD`. A suíte local usa dependências simuladas e não requer essas variáveis.

Os testes padrão são unitários e não acessam Asaas, Stripe, SMTP ou banco externo. Uma verificação externa, quando necessária, deve ser executada separadamente, com opt-in e somente contra o sandbox.
