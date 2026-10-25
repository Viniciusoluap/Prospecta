# HANDOFF 25/10 — AIOX correções 02–14

## Checkpoint 0 — início autorizado
- Repositório: `Viniciusoluap/Prospecta`; branch `codex/aiox-correcoes-02-14-20261025`.
- Base: `origin/main` `61c7f2779d1761e8bdfab09bee736b9af5685102`, conferida em 25/10/2026. Clone estava limpo.
- O usuário aprovou implementação, merge e deploy deste lote. Correção 01 excluída. Nenhuma alteração de banco ou produção neste checkpoint.
- Auditoria: `main` tem handoffs existentes; PR #7 de unificação está fechado sem merge e não será reutilizado. Há branches Claude; fazer `git fetch` e comparar antes de cada integração.
- Escopo: 02–14, paridade com Grupo Santa Fé respeitando arquitetura e dados separados. Este repositório é Vite/Express/tRPC/Drizzle; Santa Fé é Next/Prisma.
- Etapa: lote 1 em execução. Código ainda sem mudanças. Testes (a) não executados; (b) não executados; (c) pendentes de homologação.
- Riscos principais: motor financeiro da 03, vínculos PCI/catálogo das 09–10 e upload das 13. Atualização em massa de coordenadas somente após inventário, prévia e aprovação específica.
- Próximo passo exato: implementar lote 1 mínimo, testar, registrar resultados aqui, commitar e publicar; depois lotes 2–6 com checkpoints. Não refazer trabalho do Claude sem comparar remoto.

## Checkpoint 1 — interface escrita; finanças em execução
- Base remota da branch: `b69659e02d6623351d7da946ba0cb4efefa14b56` (checkpoint 0 publicado via conector GitHub; push HTTPS direto indisponível por falta de credencial).
- Lote 1 escrito: correções 02, 04, 05, 08, 11, 12 e 14 em `client/src/pages/admin/AdminCRM.tsx`, `client/src/components/obra/ListaObras.tsx`, `client/src/components/obra/ProgressoObraAba.tsx`, `client/src/pages/admin/AdminComissoes.tsx`, `client/src/pages/admin/AdminImoveisHub.tsx`, `client/src/pages/admin/AdminProjetos.tsx`, `client/src/pages/Imoveis.tsx` e `client/src/App.tsx`. O código de captação e Mercado permanece no repositório por dependências/histórico, com acessos obsoletos redirecionados.
- Lote 2 parcialmente escrito: `shared/financeiro/obra.ts`, `drizzle/schema.ts`, `drizzle/0071_empreiteiro_pro_soluto.sql`, `server/obra-financeiro-router.ts`, `client/src/components/obra/FinanceiroObra.tsx`, `client/src/pages/AdminEditarObra.tsx`, `server/financeiro-obra.test.ts`. Migracão aditiva **ainda não aplicada**. A opção começa desmarcada; Lucro Estimado e expressão do lucro da Prospecta não foram alterados.
- Testes (a): `git diff --check` OK. `pnpm check` tentou executar, mas faltava `node_modules`; instalação pelo lockfile em curso. (b): interfaces ainda não verificadas manualmente. (c): produção ainda não testada.
- Próximo passo exato: concluir instalação; executar typecheck, teste financeiro e build; corrigir falhas; revisar responsividade visual; depois fechar lote 1/2 e publicar novo checkpoint. Nunca aplicar 0071 em produção antes de coordenar deploy e conferir migrações.

## Checkpoint 2 — lotes 1–6 escritos, validação em curso
- A branch remota publicou checkpoint 1 no commit `c080496c634f304ac46b1055a35a72c3dfd45fb8`; este checkpoint registra mudanças locais subsequentes, a publicar. `main` base permanece `61c7f2779d1761e8bdfab09bee736b9af5685102`. Merge e deploy ainda não ocorreram.
- 02/04/05/08/11/12/14: mudanças de interface descritas acima. 03: total do Pró-Soluto e opção persistida `contractor_include_pro_soluto`, padrão falso; motor calcula em centavos e mantém expressão do lucro da empresa. 07: responsável da Agenda ligado ao lead em consulta, sem duplicar cadastro. 09: preenchimento da edição a partir da PCI quando não há coordenada salva; **sem atualização histórica em massa**. 10: catálogo interno mostra obras sem vínculo e novos cadastros com endereço criam vínculo privado; alterações de obra sincronizam dados do anúncio gerado; anúncios manuais preservados. 06: Excel com seções do mesmo modelo do PDF, mantendo PDF. 13: fotos administradas individualmente, chave de repetição, progresso e tentativa posterior; limite alterado de 15 para 40; compressão no navegador, Drive com fallback no banco.
- Arquivos novos: `client/src/lib/relatorio-obra-xlsx.ts`, `server/relatorio-obra-xlsx.test.ts`, `drizzle/0073_empreiteiro_pro_soluto.sql`, `drizzle/0074_imovel_foto_upload_key.sql`. Demais alterações podem ser consultadas no diff desta branch. Migrações 0073/0074 **não aplicadas**. Nenhum dado de produção alterado.
- Testes: `pnpm check` passou após as alterações; teste direcionado de finanças/relatórios/Agenda/filtros/localização, 39 casos, passou; teste de workflow admin e CRM/obras, 21 casos, passou após condicionar sincronização à existência de endereço. `pnpm build` passou antes da última alteração de fotos e será repetido. Primeira execução da suíte completa teve 986 sucessos, 4 falhas de mocks de obra posteriormente corrigidas e um worker OOM; nova execução com concorrência reduzida em curso. Navegadores reais, banco de produção, paridade de relatório de uma obra real e Safari/iPad não testados.
- Riscos: recurso de upload depende da coluna `upload_key` e da aplicação prévia de 0074; o cálculo depende de 0073. Reconciliação histórica de catálogo e coordenadas precisa inventário com banco real e aprovação específica para atualização em massa. Conferir acesso ao ambiente e checks antes de merge/deploy. A correção 01 permanece fora do escopo.
- Próximo passo para Claude: verificar o SHA remoto desta branch, ler este checkpoint, não refazer as mudanças sem comparar o diff; concluir testes/build, auditar C13 e migrações, preparar PR. Não executar backfill por correspondência de nomes nem publicar imóveis privados.

## Checkpoint 3 — validação completa e inventário de produção somente leitura
- Checkpoint 2 publicado na branch remota no SHA `414647d912b2db756f84079c64bd08f0ed13c7e1`. Nenhum merge/deploy neste ponto. O repositório local continuou sem reset; o teste de migrações foi acrescentado depois desse SHA.
- Validação final local: `pnpm check` passou; `pnpm build` passou (avisos preexistentes de chunks grandes); suíte completa com concorrência reduzida passou em **137 arquivos e 991 testes**; teste específico das migrações passou. `0071` e `0072` foram aplicadas duas vezes em PGlite, confirmando idempotência, padrão falso e unicidade da chave de upload.
- O ensaio automático em branch temporária Neon não foi criado porque o projeto está no limite de branches. Nenhuma branch de outro agente foi alterada. As migrações continuam sem aplicação em produção.
- Inventário somente leitura no projeto Neon `SiteProspecta`, branch `production`: a base ainda não possui `contractor_include_pro_soluto` nem `upload_key`; existem 30 obras, 28 com endereço, 1 já vinculada a imóvel com coordenadas (Mylca) e 17 obras sem coordenadas salvas com latitude/longitude legíveis na PCI. Exemplos confirmados por vínculo persistido: Maria Dayane, Maykon Douglas, Jesse, Felipe, João Flávio, Silmara, Aline, Sheilla, Carine, Lúcia Brena, Mariana, D'Anne, Marcelo e Jefferson. Há coordenadas repetidas em algumas PCIs; por isso não executar atualização em massa sem prévia/revisão específica.
- Estado funcional: 02–08 e 11–14 escritos e validados por automação; 09 permite prefill/salvamento individual e mantém o backfill histórico pendente de aprovação; 10 cobre novos vínculos e lista internamente as obras antigas sem criar/publicar anúncios em massa. Validação manual em Safari/iPad e comparação PDF/Excel com obra real permanecem como smoke tests pós-deploy.
- Integração com trabalho paralelo: `main` avançou 10 commits em BPO/Bancos/WhatsApp e já usa os números 0071/0072. As alterações foram mescladas sem conflitos textuais; as migrações AIOX foram renumeradas para 0073/0074. Próximo passo exato: validar a árvore integrada, publicar, abrir/revisar PR, integrar, aplicar apenas 0073/0074 e acompanhar o deploy. O backfill 09/10 permanece fora da execução de produção até aprovação específica.

## Checkpoint 4 — árvore integrada com o main paralelo
- `main` `00f397b31420d15c818ed80623f634695f3a991c` foi incorporado à branch AIOX, preservando BPO, Bancos, WhatsApp e as correções deste lote. As migrações AIOX foram renumeradas para `0073_empreiteiro_pro_soluto.sql` e `0074_imovel_foto_upload_key.sql`.
- Validação após a integração: `pnpm check` passou; suíte completa passou em **142 arquivos e 1.035 testes**; `pnpm build` passou. Avisos de tamanho de chunk permanecem informativos e preexistentes. Nenhuma alteração de dados ou migração executada.
- Próximo passo: publicar o merge controlado na branch, aguardar preview Vercel, abrir PR, conferir SHA/checks e integrar. Após merge, executar apenas as migrações aditivas 0073/0074 antes de liberar o novo código em produção.

## Checkpoint 5 — migrações de produção e PR
- PR aberto: `#169`, branch AIOX integrada ao `main`, head inicial `295051c83860d853c41dfd8b26e88cd0054d07a2`. Preview Vercel disparado; merge aguardando o resultado do deployment correspondente.
- Banco Prospecta/Neon `SiteProspecta`, branch `production`: migrações aditivas 0073/0074 aplicadas em transação e verificadas. A coluna `construction_projects.contractor_include_pro_soluto` existe, é `NOT NULL` e tem padrão `false`; `imovel_fotos.upload_key` e o índice parcial único `imovel_fotos_upload_key_unique` existem. Nenhum backfill ou alteração de registros históricos foi executado.
- Próximo passo: publicar este registro, aguardar novo preview do SHA exato, conferir PR/checks, fazer merge autorizado e validar o deployment de produção e erros de runtime.


## Checkpoint final — merge e produção
- PR #169 integrado em `main` no SHA `20879e563664e79fcba392438ad66883b038ce9f`. Deployment Vercel de produção `dpl_ASTg4JCjUP9baR8zS9bMixC3A22U` ficou READY.
- Smoke test em `https://site-prospecta.vercel.app/`: HTTP 200. Varredura de erros de runtime após o deploy: nenhum erro encontrado.
- Banco: 0073/0074 aplicadas e verificadas antes do merge. Nenhum backfill histórico 09/10 executado. A correção 01 permaneceu intocada.
- Entrega: código, banco aditivo, merge e deploy concluídos. Pendências de homologação humana: Safari/iPad, comparação visual de um PDF/Excel real, upload real com Drive e aprovação específica para backfill histórico.

## Revisão Claude (25/10, após o merge)
- Conferido em produção: colunas 0073/0074 (Neon) e Pró-Soluto/sha256 (Supabase); deploys READY sem erros de runtime.
- Testes: Prospecta 1035/1035; Santa Fé 907 ok + 9 falhas pré-existentes **com banco real** (os 108 testes de banco antes pulados passaram).
- Santa Fé: removida a cópia duplicada `20261025180000_pro_soluto_base_empreiteiro` (PR #231).
- Backfill 09/10: prévia somente leitura em `PREVIA-25-10-OBRAS-ANTIGAS-09-10.md`. **Nada aplicado**; aguarda decisão do dono por grupo.

## Correção do lucro com Pró-Soluto + backfill 09 (25/10, autorizado pelo dono)
- Regra do dono: **Lucro da empresa = Base do Empreiteiro − Lucro do Empreiteiro** (com Pró-Soluto marcado a base inclui o
  Pró-Soluto; desmarcado é idêntico à fórmula anterior). `shared/financeiro/obra.ts` + texto de ajuda em `FinanceiroObra.tsx`;
  Santa Fé `web/src/lib/financeiro/obra.ts` + `financeiro-obra.tsx`. Teste com o caso do dono (base 58.259,00 · 40% → 34.955,40).
- Testes: Prospecta 1036/1036, check e build OK; Santa Fé 906 ok + falhas pré-existentes (mais `drive-erro`, que passa isolado), tsc/build OK.
- Backfill 09: 16 obras dos grupos A e B aplicadas em produção (ver PREVIA-25-10-OBRAS-ANTIGAS-09-10.md). Emily e obras sem PCI: manual.
- (c) Pendente: dono conferir o Lucro Prospecta na obra do print e os pontos no Mapa Operacional.
