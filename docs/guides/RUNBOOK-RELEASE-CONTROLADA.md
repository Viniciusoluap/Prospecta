# Runbook de release controlada

Este documento prepara a Fase 8. Ele não autoriza migration, deploy de produção, promoção de alias ou merge na `main`.

## 1. Identificação do artefato

Registrar antes da janela:

- SHA remoto aprovado;
- deployment de preview aprovado;
- responsável pela autorização;
- horário inicial e final da janela;
- deployment de produção anterior para rollback.

O SHA aprovado não pode mudar entre o aceite e a promoção.

## 2. Preflight de ambiente

No preview, executar com as variáveis fornecidas pela própria Vercel:

```bash
npm run preflight:preview
```

O comando não imprime valores secretos. Ele reprova:

- ausência de banco, segredos, Asaas ou Blob;
- `AUTH_SECRET` e `JWT_SECRET` iguais;
- Asaas diferente de sandbox no preview;
- deployment em ambiente ou branch inesperados;
- banco de preview com o mesmo fingerprint registrado para produção.

Na janela autorizada de produção, executar:

```bash
CONFIRM_PRODUCTION_RELEASE=RELEASE_AUTORIZADO npm run preflight:production
```

A confirmação é um gate técnico adicional e não substitui a autorização expressa do proprietário.

## 3. Banco e rollback

Antes de qualquer migration:

1. registrar o estado das migrations;
2. gerar backup consistente de produção;
3. restaurar e validar o backup em instância separada;
4. registrar duração, tamanho e responsável;
5. confirmar o comando exato de restauração;
6. interromper a janela se a restauração não for comprovada.

O ensaio foi dispensado apenas enquanto não existia dado legado a recuperar. A dispensa não vale automaticamente para um banco de produção que passe a receber dados.

## 4. Ordem da publicação

1. congelar novos commits na branch aprovada;
2. validar preflight e suíte completa;
3. confirmar backup/restauração;
4. aplicar migrations registradas, se existirem;
5. promover o mesmo artefato aprovado no preview;
6. confirmar webhook Asaas na URL de produção;
7. executar smoke tests;
8. iniciar monitoramento da janela.

Comando de smoke test:

```bash
npm run smoke:deployment -- --base-url=https://dominio-do-deployment
```

O smoke reprova conteúdo vazio, erro HTTP, redirecionamento para origem externa, sessão Auth.js indisponível e rota administrativa sem redirecionamento para login.

O workflow `.github/workflows/preview-smoke.yml` também executa esse comando quando um deployment de Preview termina com sucesso. Em previews protegidos, cadastrar `VERCEL_AUTOMATION_BYPASS_SECRET` somente no GitHub Secrets; o script envia o valor pelo header de automação e não o inclui no relatório. O workflow também aceita execução sob demanda com uma URL de Preview.

O workflow `.github/workflows/quality-gate.yml` executa TypeScript, lint, testes e build em cada push e pull request. Ele valida o código, mas não publica nem promove deployments.

## 5. Critérios de interrupção

Interromper ou reverter se ocorrer qualquer item:

- falha de sessão, RBAC ou middleware;
- erro 5xx nas rotas críticas;
- migration parcial ou divergente;
- webhook sem autenticação ou sem idempotência;
- diferença financeira entre pagamento, bilhete e saldo UTEF;
- aumento sustentado de erros durante a janela.

## 6. Rollback da aplicação

1. registrar o deployment com falha;
2. redirecionar o alias para o deployment anterior conhecido;
3. repetir smoke test no artefato restaurado;
4. manter processamento financeiro suspenso se houver divergência;
5. registrar causa, impacto e horários.

Rollback de aplicação não desfaz automaticamente alterações de banco. O procedimento do banco deve ser decidido a partir da migration aplicada e do backup validado.

## 7. Encerramento da janela

A janela só termina após:

- health checks aprovados;
- login e RBAC aprovados;
- landing, sorteios e UTEF aprovados;
- um pagamento sandbox previamente homologado e o fluxo real monitorado;
- conciliação inicial sem divergência;
- SHA, deployment, migration e resultado documentados.
