# Relatório da Fase 7 — preview e homologação

- HEAD inicial local: `7b8a968`
- Checkpoint remoto inicial: `e6fa4666b9e6c7ce17d20d4fc45f8a9ec1049cf4`
- Status: em andamento.

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

## Próximos gates

1. Confirmar que o novo deployment Vercel chega a `READY`.
2. Conferir as variáveis de preview sem exibir valores.
3. Validar páginas públicas e mídia no domínio HTTPS.
4. Com banco e credenciais exclusivos de staging, executar autenticação, RBAC, sorteios, UTEF e pagamento sandbox.
5. Registrar erros de runtime e aceite antes de qualquer promoção.

## Restrições

- Este checkpoint não promove deployment para produção.
- Nenhuma migration foi executada.
- Nenhum segredo foi salvo no repositório.
