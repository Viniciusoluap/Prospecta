# Matriz de variáveis por ambiente

Este documento registra nomes, finalidade e escopo. Valores reais nunca devem ser salvos no repositório, em tickets, logs ou screenshots.

| Variável | Local | Preview/staging | Produção | Sensível | Finalidade |
| --- | --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | opcional | obrigatória | obrigatória | não | URL canônica, feeds e metadados |
| `DATABASE_URL` | obrigatória para dados | obrigatória | obrigatória | sim | conexão PostgreSQL pooled |
| `DATABASE_URL_UNPOOLED` | opcional | recomendada para migration | recomendada para migration | sim | conexão direta PostgreSQL |
| `AUTH_SECRET` | obrigatória | obrigatória e exclusiva | obrigatória e exclusiva | sim | assinatura de sessão Auth.js e fallback da criptografia |
| `JWT_SECRET` | recomendada | obrigatória e exclusiva | obrigatória e exclusiva | sim | criptografia AES-GCM das configurações financeiras |
| `ASAAS_ENVIRONMENT` | `sandbox` | `sandbox` | `production` | não | seleciona o endpoint do Asaas |
| `ASAAS_API_KEY` | opcional | sandbox | produção | sim | credencial Asaas quando não configurada pelo painel |
| `ASAAS_WEBHOOK_TOKEN` | opcional | sandbox | produção | sim | autenticação dos webhooks Asaas |
| `BLOB_READ_WRITE_TOKEN` | opcional | staging | produção | sim | uploads no Vercel Blob |
| `ANTHROPIC_API_KEY` | opcional | staging | produção | sim | prospecção e análises assistidas |
| `INCORPORACAO_IA_ATIVA` | `0` | `0` ou `1` | `0` ou `1` | não | feature flag das análises de incorporação |
| `OPENTOPOGRAPHY_API_KEY` | opcional | staging | produção | sim | consulta de elevação |
| `PLUGGY_CLIENT_ID` | opcional | sandbox | produção | sim | Open Finance |
| `PLUGGY_CLIENT_SECRET` | opcional | sandbox | produção | sim | Open Finance |
| `EVOLUTION_API_URL` | opcional | staging | produção | não | endpoint WhatsApp/Evolution |
| `EVOLUTION_API_KEY` | opcional | staging | produção | sim | credencial WhatsApp/Evolution |
| `WHATSAPP_WEBHOOK_SECRET` | opcional | staging | produção | sim | assinatura do webhook WhatsApp |
| `PROSPECCAO_CIDADE` | opcional | recomendada | recomendada | não | região padrão da prospecção |

As alternativas `POSTGRES_PRISMA_URL`, `POSTGRES_URL`, `NEON_DATABASE_URL` e `POSTGRES_URL_NON_POOLING` são reconhecidas pelo adaptador legado. Padronize novas instalações em `DATABASE_URL` e `DATABASE_URL_UNPOOLED` para reduzir ambiguidade.

## Regras

- Local, preview e produção usam bancos, credenciais Asaas e segredos de sessão distintos.
- Variáveis sem prefixo `NEXT_PUBLIC_` permanecem exclusivamente no servidor.
- Nunca habilitar `ASAAS_ENVIRONMENT=production` em preview.
- Alterar `JWT_SECRET` impede descriptografar configurações financeiras já persistidas. Antes da rotação, cadastrar novamente as credenciais com a nova chave em uma janela controlada.
- O arquivo `.env.example` contém apenas nomes e valores públicos/inertes.
