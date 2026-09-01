# Relatório da Fase 5 — interface, mídia e descoberta pública

- HEAD inicial: `c84220189f7d43806b4d406c26136264212fac7a`
- Status: concluída no ambiente disponível, com validação visual autenticada transferida para o preview da Fase 7.

## Escopo executado

Foi auditada a aplicação Next.js consolidada com foco na preservação da identidade da Prospecta, da landing page existente, dos vídeos e links sociais, além da qualidade técnica das imagens e dos metadados públicos. Nenhum deploy, migration ou acesso a banco foi realizado.

## Preservação da landing Prospecta

| Item | Resultado |
| --- | --- |
| Layout, textos e cores existentes | mantidos |
| Canal do YouTube `@vinigfreitas` | mantido |
| Vídeos `5wQWuppuLwM`, `ILCOWiUJTBM` e `sUKLiYMfFaE` | mantidos e encontrados no HTML de produção |
| Instagram `imoveiscomvinifreitas` | mantido |
| WhatsApp `5599981392210` | mantido |
| Ecossistema de sorteios e UTEF | rotas e funções preservadas; não removidas nesta fase |

## Correções realizadas

1. Seis imagens locais da landing apontavam para caminhos inexistentes no `public/` da aplicação Next.js. Os arquivos originais já existentes em `client/public/` passaram a ser importados estaticamente, sem substituir conteúdo ou identidade visual:
   - `casa-compacta-47m2.jpg`
   - `logo-caixa.png`
   - `logo-inter.png`
   - `logo-bradesco.png`
   - `logo-santander.png`
   - `logo-itau.png`
2. As imagens conhecidas da landing foram migradas para `next/image`, com dimensões responsivas e domínios externos explicitamente permitidos.
3. Imagens dinâmicas de usuário, QR Code e URLs administráveis permaneceram em `<img>` por dependerem de fontes arbitrárias ou `data:` URLs; cada exceção foi documentada no arquivo correspondente.
4. Foram adicionados `metadataBase`, Open Graph, `robots.txt` e `sitemap.xml`.
5. O sitemap inclui 18 rotas comerciais, entre elas `/sorteios` e `/utef`, e não inclui áreas administrativas ou privadas.

## Validação executada

| Verificação | Resultado |
| --- | --- |
| `git diff --check` | aprovado |
| `npm run check` | aprovado |
| `npm run lint` | aprovado sem avisos |
| `npm test` | 32 arquivos e 287 testes aprovados |
| `npm run build` | aprovado; 58 páginas geradas |
| HTTP `/`, `/simulador`, `/projetos-orcamentos`, `/instituto` | 200 |
| HTTP `/robots.txt` e `/sitemap.xml` | 200 |
| Mídia, links sociais e seis imagens locais no HTML compilado | confirmados |

## Limitações reais do ambiente

- O navegador remoto do ambiente não conseguiu acessar o servidor local (`ERR_BLOCKED_BY_CLIENT`). A validação do build foi feita pelo servidor de produção local e requisições HTTP.
- As rotas dependentes de dados, como `/sorteios`, `/utef`, `/produtos` e `/imoveis`, exigem banco e variáveis de ambiente. Sem `DATABASE_URL`, elas não podem ser validadas de ponta a ponta aqui.
- A inspeção visual desktop/mobile, autenticação e fluxos dependentes de dados devem ser concluídos no preview isolado da Fase 7, já com banco e variáveis configurados.

## Arquivos principais alterados

- `src/components/marketing/prospecta-home.tsx`
- `src/app/layout.tsx`
- `src/app/robots.ts`
- `src/app/sitemap.ts`
- `next.config.ts`
- `src/lib/__tests__/metadata-routes.test.ts`
- Componentes com imagens dinâmicas documentadas em `src/app`, `src/components/admin` e `src/components/ecossistema`.

## Migrations criadas/aplicadas

- Nenhuma.

## Commit do checkpoint

- `checkpoint/fase-5: verify branded responsive experience`

## Como reverter

- Reverter o commit deste checkpoint. Não há alterações de dados ou infraestrutura para desfazer.

## Próxima fase autorizada

- Sim. Fase 6 — segurança, qualidade e observabilidade.
