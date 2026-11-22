# E4 — Página pública por lote: /maquete/[empreendimento]/[lote], status e WhatsApp

Status: InReview (Etapa 4 implementada em 22/11/2026; aguarda portão de QA e a revisão do dono)
Epic: EPIC-028 — Maquete fiel à planta com editor de itens (`ETAPA-0-PLANO.md`)
Paridade: Maquete 3D é exceção registrada no `docs/stories/epics/ROADMAP.md` (EPIC-022; EPIC-028 registrado na mesma
linha de exceção nesta etapa): nada a portar ao Grupo Santa Fé.
Tamanho: M. Migração `drizzle/0147_maquete_3d_lote_link.sql` criada e testada em banco de teste (PGlite, 2×), **não
aplicada** em nenhum banco. Custo zero: nenhuma IA, nenhuma API paga, nada da Higgsfield, nenhuma dependência nova.
Branch: `epic028-e4` (nasce de `feat/maquete-3d-editor` em `2b01979`; commits locais, sem push).

## Pedido do dono
"Rota /maquete/[empreendimento]/[lote], leve no celular. Status do lote só leitura (Central de Vendas). Botão de WhatsApp
(99) 98139-2210 com mensagem do lote. Um JSON de estrutura por planta, N lotes apontando para ele; cada lote pode ter a
sua versão de itens." Padrões aceitos ("tudo aprovado"): endereço com código não adivinhável; WhatsApp da empresa em
todos os lotes, mensagem pronta com empreendimento, quadra e lote.

## Critérios de aceite
- [x] AC1 Rota pública sem login `/maquete/:empreendimento/:lote` (o segmento do lote termina no código:
      `/maquete/vila-esmeralda/qd18-lote4-<código>`), resolvida por `maquete_3d_lotes` → maquete → versão de itens
      PUBLICADA. A rota antiga `/maquete/:token` (um segmento) continua igual.
- [x] AC2 Visualizador da Etapa 2: no celular abre na planta 2D e o 3D só é baixado quando a pessoa toca em "Ver em 3D"
      ou num cômodo; no computador abre no 3D. Nome do empreendimento, quadra e lote.
- [x] AC3 Status do lote só leitura (Disponível / Reservado / Vendido), lido de `incorporation_units.status` (o mesmo
      inventário da Incorporação/Central de Vendas). Lote sem unidade ligada: a página não mostra status.
- [x] AC4 Botão de WhatsApp da empresa (99) 98139-2210 com a mensagem do lote, texto codificado
      (`https://wa.me/5599981392210?text=…`); no celular fica fixo no rodapé.
- [x] AC5 Nunca expõe rascunho, comprador, preço, dados pessoais, ids internos, autor, versões ou rotas de escrita; as
      anotações internas da planta (`nota`) também saem da resposta.
- [x] AC6 Servidor: `maquetePublica.porLote` público e só de leitura; resposta mínima; `X-Robots-Tag: noindex,
      nofollow` na resposta e nas páginas `/maquete/*` (vercel.json) e meta `robots` na página; 404 uniforme (mesma
      mensagem para formato inválido, código errado, lote inexistente, lote desligado, sem publicação ou versão de uma
      estrutura antiga).
- [x] AC7 Admin (papel conferido no servidor antes de qualquer consulta), dentro da tela do editor da maquete: ligar lote
      à planta (N lotes → a mesma maquete), escolher a versão publicada do lote (padrão: a publicada da maquete), ligar a
      unidade da Incorporação, gerar/regenerar o código, copiar o link, desligar/religar a página.
- [x] AC8 Migração aditiva e idempotente 0147 (`codigo_link`, `empreendimento_nome`, `quadra`, `lote_numero`, CHECK do
      código, índice único do código). A 0146 não foi editada.
- [x] AC9 Semente idempotente disparada pelo admin: Lote 4, Quadra 18, Vila Esmeralda → maquete `lote4-qd18`.
- [x] AC10 A prévia `/maquete-demo/lote4-qd18` continua existindo.
- [x] AC11 Higgsfield/GLB fora desta entrega: `glb_url` continua vazio (ver "Fora do escopo").
- [x] AC12 Testes vitest (`server/maquete-3d-lote-publico.test.ts`) e capturas Playwright conferidas.

## Decisões
- [AUTO-DECISION] Onde fica o código no endereço? → no fim do segmento do lote (`qd18-lote4-k3m9x2pq7a`), separado pelo
  último hífen (razão: a rota pedida tem dois segmentos; não colide com `/maquete/:token`, que tem um só).
- [AUTO-DECISION] Código: 10 símbolos de um alfabeto de 31 (sem 0/o, 1/l/i), `crypto.randomInt` → ≈ 49 bits; índice
  único; regenerar troca na hora (o link anterior para de abrir).
- [AUTO-DECISION] Limite de taxa: o projeto não tem padrão para rotas públicas (só tetos de envio de WhatsApp); não foi
  criado um novo. O código de 49 bits torna a adivinhação inviável e a resposta não diz se o lote existe.
- [AUTO-DECISION] Versão fixa do lote: aceita só versão que JÁ FOI publicada (`publicada_em` marcada; hoje "publicada"
  ou "arquivada") e da estrutura atual. Rascunho nunca, nem gravado direto no banco (a leitura pública confere de novo).
- [AUTO-DECISION] Status: `disponivel/reservada/vendida` → Disponível/Reservado/Vendido; valor desconhecido ou unidade
  apagada → sem status (nada inventado).
- [AUTO-DECISION] Número do WhatsApp: reaproveita `CANAL_DO_TITULAR.telefone` (`shared/termo-consentimento.ts`), o
  canal da empresa já cadastrado no código, em `WHATSAPP_EMPRESA` (`shared/maquete-3d/lote-publico.ts`).
- [AUTO-DECISION] Semente: liga a unidade da Incorporação só se houver UMA num estudo com "Vila Esmeralda" no nome e
  código "Quadra 18 Lote 4" (Q18 L4, QD 18 LOTE 04…); senão o lote fica sem unidade (sem status) e o admin liga pela
  tela. Rodar de novo não mexe no que já existe.
- [AUTO-DECISION] Textos do lote (nome do empreendimento, quadra, lote) em colunas próprias (0147), não deduzidos do
  endereço.
- [AUTO-DECISION] Cabeçalho `X-Robots-Tag` em `/maquete/(.*)` no `vercel.json`: vale também para o link antigo (só
  tira dos buscadores; não muda o funcionamento). O link antigo não tinha nada de noindex.

## Fora do escopo
- Higgsfield / GLB pronto: opcional no pedido e o dono exige zero crédito. `maquetes_3d.glb_url` continua vazio.
- Aplicar a 0146 e a 0147 no Neon (depende do "autorizo" do dono para mexer em banco) e publicar.

## File List
Criados:
- `drizzle/0147_maquete_3d_lote_link.sql`
- `shared/maquete-3d/lote-publico.ts`
- `server/maquete-3d/lotes.ts`
- `server/maquete-3d-lote-publico.test.ts`
- `client/src/pages/MaqueteLote.tsx`
- `client/src/components/maquete-3d/editor/PainelLotes.tsx`
- `docs/stories/epics/epic-028-maquete-editor/{E4-rota-por-lote,ETAPA-4-RELATORIO}.md`, `screenshots/etapa-4/*.png`

Alterados (só acréscimos):
- `drizzle/schema-maquete-3d.ts` (colunas da 0147 em `maquete3dLotes`)
- `server/maquete-3d/router.ts` (`maquete3d.lotes.*` e `maquetePublica.porLote`)
- `client/src/App.tsx` (rota `/maquete/:empreendimento/:lote`, lazy)
- `client/src/components/maquete-3d/editor/conexao.ts` (tipos e rotas dos lotes)
- `client/src/pages/MaqueteDemo.tsx` (painel de lotes, lazy, dentro do editor)
- `scripts/maquete/harness/main.tsx` (`?pagina=lote`, lotes em memória), `scripts/maquete/screenshots.mjs` (`--lote`)
- `vercel.json` (`X-Robots-Tag` em `/maquete/*`)
- `docs/stories/epics/ROADMAP.md` (linha do EPIC-028 dentro da exceção da Maquete 3D)

## Testes
- `server/maquete-3d-lote-publico.test.ts` (12): 0147 aplicada 2× sobre banco com lote da 0146 (que fica igual); só
  aditiva; WhatsApp (número, mensagem, codificação, `&`/`#`); formato do endereço e status; semente idempotente com a
  unidade; só publicado (sem publicação não abre, rascunho salvo depois não aparece, versão fixada em rascunho não abre);
  resposta mínima (sem comprador, preço, ids, autor, versões, `nota`); 8 entradas ruins → a mesma resposta; regenerar
  código; dois lotes na mesma planta com versões diferentes e status de cada um; permissões de todas as rotas de lotes
  (6 perfis, sem consulta ao banco); rota antiga `/maquete/:token` intacta.
- Ver `ETAPA-4-RELATORIO.md` para a suíte inteira, `tsc`, `vite build` e as capturas.

## Change Log
- 22/11/2026 — @dev (Dex): Ready → InProgress → InReview. Etapa 4 implementada (ver `ETAPA-4-RELATORIO.md`).
