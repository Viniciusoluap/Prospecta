# EPIC-028 — Etapa 4: página pública por lote, status e WhatsApp — relatório

Data: 22/11/2026 · @dev (Dex) · Branch `epic028-e4` (de `feat/maquete-3d-editor` em `2b01979`; commits locais, sem
push, **nenhum banco alterado**) · Story: `E4-rota-por-lote.md`. Custo: zero (nenhuma IA, nenhuma API paga, nada da
Higgsfield, nenhuma dependência nova).

## O que foi feito

- **Endereço público**: `/maquete/<empreendimento>/<lote>-<código>`, ex.:
  `/maquete/vila-esmeralda/qd18-lote4-k3m9x2pq7a`. O código (10 símbolos aleatórios, ≈ 49 bits) é o último pedaço do
  segmento do lote. Sem o código certo a página diz "Esta maquete não está disponível" — a mesma resposta para lote que
  não existe, código errado, lote desligado ou sem itens publicados. O link antigo `/maquete/<token>` (um segmento)
  continua igual.
- **Servidor** (`server/maquete-3d/lotes.ts`, rota pública `maquetePublica.porLote`): lê `maquete_3d_lotes` → maquete da
  planta → versão de itens PUBLICADA (a fixada no lote ou a publicada da maquete; só versão que já foi publicada, nunca
  rascunho, e da estrutura atual). Devolve só: empreendimento, quadra, lote, a planta (medidas do arquivo do servidor,
  sem as anotações internas `nota`) com os itens publicados, e o status. Nada de comprador, preço, ids, autor, versões.
  `X-Robots-Tag: noindex, nofollow` na resposta e nas páginas `/maquete/*` (vercel.json), e meta `robots` na página.
- **Status (só leitura)**: vem de `incorporation_units.status` — o inventário da Incorporação/Central de Vendas
  (`disponivel` / `reservada` / `vendida` → Disponível / Reservado / Vendido). Lote sem unidade ligada: sem status.
- **WhatsApp**: número da empresa (99) 98139-2210 (`CANAL_DO_TITULAR`, já cadastrado no código) em todos os lotes, com a
  mensagem "Olá! Vi a maquete 3D do Lote 4, Quadra 18 (Vila Esmeralda) e quero saber mais sobre este lote." codificada
  em `https://wa.me/5599981392210?text=…`. No celular o botão fica fixo no rodapé.
- **Página** (`client/src/pages/MaqueteLote.tsx`, pedaço lazy): celular abre na planta 2D (o 3D não é baixado); "Ver em
  3D" e os cômodos carregam o visualizador da Etapa 2; computador abre no 3D. Tabela de áreas dos cômodos e aviso de
  "imagens ilustrativas".
- **Admin** (`maquete3d.lotes.*`, só papel admin, conferido antes de qualquer consulta; painel `PainelLotes` dentro da
  tela do editor da maquete): ligar o lote padrão (semente), ligar outros lotes à mesma planta, escolher a versão de
  itens de cada lote, ligar/trocar a unidade da Incorporação, gerar/regenerar e copiar o link, desligar/religar a página.
  A tela mostra em vermelho por que a página de um lote não abre (sem publicação, sem código, desligado, versão de uma
  planta anterior).
- **Banco**: `drizzle/0147_maquete_3d_lote_link.sql` (aditiva e idempotente, **não aplicada**): `codigo_link`,
  `empreendimento_nome`, `quadra`, `lote_numero` em `maquete_3d_lotes`, CHECK do código e índice único. A 0146 não mudou.
- **Semente**: "Ligar o lote padrão desta planta" liga Lote 4, Quadra 18, Vila Esmeralda (`vila-esmeralda/qd18-lote4`) à
  maquete `lote4-qd18`; rodar de novo não muda nada. Liga a unidade só se houver UMA num estudo "Vila Esmeralda" com
  código de Quadra 18 Lote 4; senão fica sem unidade (ligar pela tela).
- `glb_url` continua vazio (Higgsfield fora desta entrega). A prévia `/maquete-demo/lote4-qd18` continua.

## Como o admin gera o link (passo a passo)

1. Entrar no Prospecta como administrador e abrir `https://<endereço do Prospecta>/maquete-demo/lote4-qd18`.
2. Tocar em **Editar** (canto de cima).
3. Se os itens ainda não foram publicados: ajustar o que quiser e tocar em **Salvar rascunho** e depois em **Publicar**.
   Sem publicação a página do lote não abre.
4. Descer até **Lotes com esta planta · página do cliente**.
5. Na primeira vez, tocar em **Ligar o lote padrão desta planta**. Deve aparecer o cartão "Vila Esmeralda · Lote 4,
   Quadra 18" com o link (`…/maquete/vila-esmeralda/qd18-lote4-<código>`).
6. Se o cartão disser "Sem unidade: a página não mostra status", tocar em **Ligar unidade**, buscar "Esmeralda" e
   tocar na unidade certa. O status passa a aparecer (e acompanha o que a Incorporação marcar).
7. Em **Itens que este lote mostra**, deixar "Seguir a publicada da maquete" (padrão) ou fixar numa versão já publicada.
8. Tocar em **Copiar link** e mandar ao cliente. Se o link vazar, **Gerar novo link** (o anterior para de abrir na hora).
9. Outro lote com a mesma planta: **Ligar outro lote a esta planta** → empreendimento, quadra, lote → **Ligar lote**.

## O que o cliente vê

Sem login: "Vila Esmeralda · maquete 3D", o título "Lote 4, Quadra 18", o selo de status (verde Disponível, âmbar
Reservado, cinza Vendido; nenhum se o lote não tem unidade), as medidas do lote e da casa, a planta 2D com cotas (no
celular) ou a maquete 3D (no computador), botões Planta 2D / Ver em 3D / cômodos / Telhado, a tabela de áreas e o botão
verde "Falar sobre este lote no WhatsApp", que abre a conversa com a empresa já com a mensagem do lote.

## Capturas (`screenshots/etapa-4/`, conferidas com a ferramenta Read)

| Arquivo | O que mostra |
|---|---|
| `celular-lote-planta` / `celular-lote-pagina` | 390 × 844: abre na planta 2D, status Disponível, WhatsApp fixo no rodapé. |
| `celular-lote-geral` | Depois de tocar em "Ver em 3D". |
| `celular-lote-reservado` / `celular-lote-sem-status` | Selo Reservado; lote sem unidade, sem selo. |
| `desktop-lote-geral` / `desktop-lote-pagina` / `desktop-lote-reservado` | 1440 × 900: 3D, status e WhatsApp no cabeçalho. |
| `desktop-admin-lotes` / `celular-admin-lotes` | Painel de lotes no editor: lote padrão ligado, link, pendência em vermelho. |

`node scripts/maquete/screenshots.mjs --lote` (harness sem servidor: `?pagina=lote&status=…` com dados de teste e lotes
em memória): 17 conferências, todas OK — modo inicial (planta no celular, 3D no computador), nome, status, link do
WhatsApp com o lote, 3D não baixado na abertura do celular, sem status sem unidade, link do lote padrão no painel.

## Testes

- `server/maquete-3d-lote-publico.test.ts`: 12 testes, todos passando (ver a story).
- Todos os `server/maquete-3d*.test.ts` (`timeout 1500 npx vitest run server/maquete-3d --maxWorkers=2 --minWorkers=1`):
  16 arquivos, 366 testes, todos passando (uma falha apareceu na primeira rodada porque o texto da mensagem foi
  alterado durante a execução; o arquivo rodado de novo depois: 12/12).
- `npx tsc --noEmit` sem erro. `npx vite build` sem erro.

## Pacote (`npx vite build`)

Página do lote: `MaqueteLote` 11,2 kB (3,9 kB gzip) + `Planta2D` (compartilhado com a prévia) 37,5 kB (14,2 kB gzip);
o 3D (`VisualizadorFonte`, 33,6 kB / 13,5 kB gzip, mais three.js) só ao tocar em "Ver em 3D". `PainelLotes` 11,8 kB (só
admin). Observação: o pacote principal do app (`index`, ≈ 1,2 MB gzip) é carregado por todas as páginas, inclusive esta;
reduzi-lo está fora do escopo da etapa.

## Defeitos e limitações conhecidos

1. **Ordem de publicação**: aplicar a 0146 e a 0147 no banco ANTES de publicar este código (o Drizzle passa a citar as
   colunas novas).
2. Sem limite de taxa na rota pública: o projeto não tem padrão para isso; a proteção é o código de ≈ 49 bits e a
   resposta uniforme.
3. Se a estrutura da planta mudar, versões antigas fixadas em lotes deixam de abrir (a página dá "não disponível") até
   o admin escolher outra; o painel avisa em vermelho.
4. O link do painel usa o endereço em que o admin está (`window.location.origin`).
5. A mensagem usa "(Vila Esmeralda)" entre parênteses para servir a qualquer nome de empreendimento (sem "do/da").

## Pendências

- Portão de QA (@qa) desta etapa (e da Etapa 3).
- Aplicar 0146 + 0147 numa branch do Neon, testar logado, depois produção (depende do "autorizo" do dono para banco).
- Push e PR: com @devops / a sessão principal.
- Higgsfield/GLB: fora (zero crédito).
