# E3 — Modo edição dos itens (admin), versões rascunho × publicado e tabelas

Status: InReview (Etapa 3 implementada em 21/11/2026; aguarda portão de QA e a revisão do dono)
Epic: EPIC-028 — Maquete fiel à planta com editor de itens (`ETAPA-0-PLANO.md`)
Paridade: Maquete 3D é exceção registrada no `docs/stories/epics/ROADMAP.md` (EPIC-022): nada a portar ao Grupo Santa Fé.
Tamanho: G. Migração `drizzle/0146_maquete_3d_itens_e_lotes.sql` criada e testada em banco de teste (PGlite), **não
aplicada** em nenhum banco. Custo zero: nenhuma IA, nenhuma API paga, nenhuma dependência nova.
Branch: `feat/maquete-3d-editor` (commits locais, sem push).

## Objetivo
O administrador do Prospecta edita os itens (móveis, bancadas, balcão) da maquete gerada do JSON-fonte: seleciona,
move, gira, muda campos, troca o tipo, adiciona e remove, com as regras da Etapa 1 bloqueando salvar; salva como
rascunho versionado (sem tocar na estrutura) e publica quando quiser trocar o que o cliente vê.

## Critérios de aceite (pedido do dono, item a item)
- [x] AC1 Botão "Editar" só para o usuário ADMIN (papel conferido no servidor em toda rota; colaborador com o módulo
      Maquete 3D, corretor, empreiteiro, cliente e anônimo recebem FORBIDDEN sem consulta ao banco).
- [x] AC2 Selecionar por toque/clique no 3D ou na planta 2D (contorno amarelo; vermelho se o item tem erro). Paredes,
      aberturas, piso e telhado não selecionam (o raio só testa o grupo dos itens).
- [x] AC3 Mover arrastando no plano do piso (mouse e um dedo; a câmera não gira durante o arraste; dois dedos voltam
      à câmera), com encaixe de 5 cm e na face da parede mais próxima (até 15 cm; o fundo do móvel encosta na face).
- [x] AC4 Girar: botões de 90° e ajuste fino de 15°.
- [x] AC5 Painel de campos (16 px, alvos ≥ 44 px): ambiente, X, Z, rotação, largura, profundidade, altura, material e
      cor; muda o 3D na hora e mostra o valor novo quando o item é arrastado.
- [x] AC6 Converter tipo dentro do grupo (ex.: bancada ↔ balcão ↔ armário), mantendo posição, giro e medidas.
- [x] AC7 Catálogo procedural: adicionar (medidas padrão: geladeira 0,70 × 0,70 × 1,80; fogão 0,55 × 0,60 × 0,85 —
      desenho novo; etc.) e remover.
- [x] AC8 Regras com aviso em vermelho que BLOQUEIA salvar e publicar: atravessar parede, sair do ambiente, vão de
      porta, giro da folha, faixa livre de 0,80 m, item alto sob janela (até 1,10 m pode), itens sobrepostos. As MESMAS
      de `validarFonte`, ao vivo na tela e de novo no servidor ao salvar e ao publicar (contra a estrutura do servidor).
      As zonas da porta bloqueada aparecem em vermelho no 3D e na planta.
- [x] AC9 Desfazer/refazer (Ctrl+Z, Ctrl+Shift+Z ou Ctrl+Y, e botões; um arraste inteiro = um passo) e
      "Restaurar padrão da planta".
- [x] AC10 Salvar grava só os itens, como versão nova e imutável (rascunho); "Publicar" troca a versão que o cliente
      vê; estado "Rascunho não publicado" na barra. Concorrência otimista (versão base; CONFLICT com "Recarregar").
- [x] AC11 Cor e material de cada item aplicados no 3D (antes só o estilo "moderno").
- [x] AC12 Banco: migração 0146 aditiva e idempotente (aplicada 2× no teste), `maquete_3d_itens` e `maquete_3d_lotes`,
      colunas `glb_url`, `itens_versao_publicada` e `fonte_slug`, origem `'fonte'`; semente idempotente da maquete
      `lote4-qd18` ao abrir o editor. Leitura pública só do publicado (`itensPublicados`, sem rota nova).
- [x] AC13 Editor em pedaço próprio (lazy), baixado só quando o admin toca em "Editar"; funciona em 390 × 844.
- [x] AC14 Testes vitest e capturas Playwright (computador e celular) conferidas.

## Decisões
- [AUTO-DECISION] Onde guardar a ligação maquete ↔ JSON do repositório? → coluna `fonte_slug` (aditiva, única por
  planta) em `maquetes_3d` (razão: semente idempotente sem script manual; a estrutura sempre vem do arquivo do servidor).
- [AUTO-DECISION] Mudar o ambiente no painel → o item vai para o centro do ambiente novo (senão fica "fora do
  ambiente" na hora). No arraste, o ambiente segue o lugar onde o centro do item cai.
- [AUTO-DECISION] Converter tipo troca as opções de desenho (pia, cooktop, tampo) pelas do tipo novo; mantém posição,
  giro, medidas, material e cor (pedido literal do dono).
- [AUTO-DECISION] Publicar exige que a versão seja a última salva e da estrutura atual; publicar arquiva a publicada
  anterior e os rascunhos mais antigos num só comando (sem transação interativa, neon-http).
- [AUTO-DECISION] Maquetes de origem `'fonte'` ficam fora da lista antiga de maquetes (`maquete3d.listar`), para a tela
  antiga não receber uma origem que ela não conhece.
- [AUTO-DECISION] O papel "engenheiro" não existe no Prospecta (`user_role`: user, admin, corretor, colaborador,
  cliente, empreiteiro); o teste cobre todos os papéis existentes e um papel inventado.
- Vercel: `includeFiles: "data/plantas/**"` na função para o servidor ler o JSON-fonte.

## Fora do escopo (Etapa 4)
Rota pública por lote, status do lote, WhatsApp, ligação de lote pela tela, ROADMAP.

## File List
Criados:
- `shared/maquete-3d/edicao.ts`
- `drizzle/0146_maquete_3d_itens_e_lotes.sql`
- `server/maquete-3d/itens.ts`
- `server/maquete-3d-edicao.test.ts`, `server/maquete-3d-itens.test.ts`
- `client/src/components/maquete-3d/editor/{EditorItens,Interacao3D,PainelItem,Catalogo,BarraEdicao}.tsx`, `editor/conexao.ts`
- `client/src/components/maquete-3d/visualizador/materiais-itens.ts`
- `docs/stories/epics/epic-028-maquete-editor/{E3-modo-edicao,ETAPA-3-RELATORIO}.md`, `screenshots/etapa-3/*.png`

Alterados:
- `drizzle/schema-maquete-3d.ts` (colunas e tabelas novas)
- `server/maquete-3d/router.ts` (`maquete3d.itens.*`, lista antiga sem origem `'fonte'`)
- `shared/maquete-3d/mobilia.ts` (tipo `fogao`), `shared/maquete-3d/rotulos-itens.ts`, `shared/maquete-3d/fonte-cena.ts` (material/cor na peça)
- `client/src/components/maquete-3d/visualizador/{CenaFonte,VisualizadorFonte}.tsx`, `moveis/intimo-servico.tsx` (fogão), `moveis/garagem.tsx` (pintura #rrggbb)
- `client/src/components/maquete-3d/planta2d/Planta2D.tsx` (modo edição)
- `client/src/pages/MaqueteDemo.tsx` (botão Editar e editor lazy)
- `scripts/maquete/harness/main.tsx` (conexão em memória, `?admin=1`), `scripts/maquete/screenshots.mjs` (`--editor`)
- `vercel.json` (`includeFiles`)
- `server/maquete-3d{,-hibrida,-importacao,-lote,-lote-qa,-qa-s03-s05}.test.ts` (aplicam também a 0146: as colunas novas
  entram em todo INSERT do Drizzle em `maquetes_3d`)

## Testes
- `server/maquete-3d-edicao.test.ts` (21): cada regra bloqueia salvar; encaixe 5 cm e na parede; arraste; giro;
  conversão mantendo posição/medidas; catálogo e medidas padrão; desfazer/refazer; formato zod; travados; portas bloqueadas.
- `server/maquete-3d-itens.test.ts` (11): migração 0146 aplicada 2× sobre banco com maquetes antigas; só aditiva;
  imutabilidade (gatilho); semente idempotente; mover → salvar → recarregar; cada regra recusada no servidor; rascunho ×
  publicado; concorrência; revalidação ao publicar (regra e estrutura); restaurar padrão; permissões sem consulta.
- Todos os `server/maquete-3d*.test.ts`: 15 arquivos, 354 testes, todos passando. `npx tsc --noEmit` sem erro.
- Playwright (`node scripts/maquete/screenshots.mjs --editor`): 10 capturas e 20 conferências do fluxo, todas OK.

## Change Log
- 21/11/2026 — @dev (Dex): Ready → InProgress → InReview. Etapa 3 implementada (ver `ETAPA-3-RELATORIO.md`).
