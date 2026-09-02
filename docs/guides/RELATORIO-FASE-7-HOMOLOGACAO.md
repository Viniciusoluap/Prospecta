# Relatório da Fase 7 — preview e homologação

- HEAD inicial local: `7b8a968`
- Checkpoint remoto inicial: `e6fa4666b9e6c7ce17d20d4fc45f8a9ec1049cf4`
- Status: em andamento; preview compilado, UAT interno pendente.

## História verificada

A branch `codex/nextjs-santa-fe-unification` deve gerar um preview Vercel isolado, executar a aplicação Next.js com variáveis e banco de staging e permitir validar landing, autenticação, administração, sorteios, UTEF e pagamentos sandbox de ponta a ponta.

## Primeiro limite quebrado

O push da Fase 6 criou automaticamente o deployment `dpl_AUe7Lc3tfgTGpGxRLh8c6ZYCQrkT`, mas ele falhou antes do build:

```text
ERR_PNPM_LOCKFILE_CONFIG_MISMATCH
Cannot proceed with the frozen installation.
The current "overrides" configuration doesn't match the value found in the lockfile
```

## Causa e correção

O repositório mantinha dois lockfiles concorrentes. O `package-lock.json` corresponde à plataforma Next.js atual e o `vercel.json` define `npm ci`; o `pnpm-lock.yaml` pertencia à aplicação anterior e continha dependências e overrides incompatíveis.

Foi removido somente o lockfile pnpm legado. O lockfile npm e o comando de instalação declarados foram preservados.

## Evidências locais após a correção

| Verificação | Resultado |
| --- | --- |
| `npm ci --ignore-scripts` | aprovado; 891 pacotes instalados em ambiente limpo |
| `npm run check` | aprovado |
| `npm run lint` | aprovado |
| `npm test` | 34 arquivos e 296 testes aprovados |
| `npm run build` | aprovado; 58 páginas geradas |

## Preview publicado

O checkpoint de instalação `b95d83065cd3e2bcc5da9de559091988a1a1dc26` gerou com sucesso o deployment Vercel `dpl_3d5PJy6CbzoSqAS9B1mCWMzeVuV7`.

| Evidência | Resultado |
| --- | --- |
| Estado do deployment | `READY` |
| Instalação | `npm ci` aprovado |
| Framework detectado no build | Next.js 16.2.7 |
| Prisma Client | gerado com sucesso |
| Build Vercel | aprovado |
| Status integrado no GitHub | sucesso |
| Acesso público ao preview | protegido por Vercel SSO |

O SSO impede o smoke test externo automatizado. Também não foi possível confirmar, sem expor valores, um conjunto exclusivo de banco, autenticação e Asaas sandbox para staging. Por isso o deployment pronto não equivale a UAT aprovado.

## Correção preventiva de dependências

Antes de prosseguir com dados ou credenciais de homologação, foi executada uma revisão não destrutiva das dependências:

- Next.js e `eslint-config-next`: 16.2.7 para 16.3.4;
- NextAuth/Auth.js: beta.31 para beta.32, eliminando os alertas críticos de autenticação;
- Drizzle ORM: 0.44.7 para 0.45.2, corrigindo o alerta de injeção em identificadores SQL;
- Vercel Blob: 2.5.0 para 2.8.0;
- Prisma Client e adapter PostgreSQL: 7.8.0 para 7.10.0;
- Prisma CLI movido para `devDependencies`;
- adapters e runtimes SQLite/libSQL sem uso removidos.

O `npm audit` passou de 21 alertas, incluindo 2 críticos, para 4 alertas altos. Os quatro registros restantes estão concentrados em `deepmerge-ts` e `mysql2`, versões fixadas pelo Prisma CLI 7.10. A sugestão automática exigiria regressão para Prisma 6.19.3; ela não foi aplicada por ser uma mudança incompatível. Nenhum `audit fix --force` foi executado.

## Evidências locais atuais

| Verificação | Resultado |
| --- | --- |
| `npm run check` | aprovado |
| `npm run lint` | aprovado |
| `npm test -- --run` | 34 arquivos e 296 testes aprovados |
| `npm run build` | aprovado; 58 páginas geradas com Next.js 16.3.4 e Prisma 7.10.0 |
| `npm audit` | 0 crítico, 4 altos, 0 moderado e 0 baixo |

## Próximos gates

1. Gerar um novo preview a partir do checkpoint atualizado.
2. Conferir as variáveis de preview sem exibir valores.
3. Liberar acesso de homologação ao preview ou fornecer uma sessão autorizada.
4. Validar páginas públicas e mídia no domínio HTTPS.
5. Com banco e credenciais exclusivos de staging, executar autenticação, RBAC, sorteios, UTEF e pagamento sandbox.
6. Registrar erros de runtime e aceite antes de qualquer promoção.

## Restrições

- Este checkpoint não promove deployment para produção.
- Nenhuma migration foi executada.
- Nenhum segredo foi salvo no repositório.
- A Fase 8 permanece bloqueada até UAT e autorização explícita do proprietário.
