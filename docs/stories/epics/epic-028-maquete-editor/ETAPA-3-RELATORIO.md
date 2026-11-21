# EPIC-028 — Etapa 3: modo edição dos itens, versões e tabelas — relatório

Data: 21/11/2026 · @dev (Dex) · Branch `feat/maquete-3d-editor` (commits locais, sem push, **nenhum banco alterado**) ·
Story: `E3-modo-edicao.md`. Custo: zero (nenhuma IA, nenhuma API paga, nenhuma dependência nova).

## O que foi feito

- **Regras e operações puras** (`shared/maquete-3d/edicao.ts`): catálogo com medidas padrão por tipo (geladeira
  0,70 × 0,70 × 1,80; fogão 0,55 × 0,60 × 0,85 — tipo e desenho novos; etc.), grupos para "converter tipo" (bancada ↔
  balcão ↔ armário…), encaixe de 5 cm e na face da parede (até 15 cm), giro 90°/15°, item novo, desfazer/refazer com
  gesto (um arraste = um passo), portas bloqueadas (zonas em vermelho) e o formato zod aceito pelo servidor (lista
  fechada de materiais, cor `#rrggbb`, sem `<`/`>`, números finitos e limitados, no máximo 150 itens, campo a mais é
  recusado). As regras são as de `validarFonte` (Etapa 1), as mesmas na tela e no servidor.
- **Banco** (`drizzle/0146_maquete_3d_itens_e_lotes.sql`, aditiva e idempotente, **não aplicada**):
  - `maquetes_3d`: `glb_url`, `itens_versao_publicada`, `fonte_slug` (uma maquete por planta do repositório, índice
    único); origem aceita `'fonte'` (as duas CHECK de origem recriadas com a lista anterior + `'fonte'`).
  - `maquete_3d_itens`: maquete, versão, JSON dos itens, quantidade, versão do modelo e hash da estrutura, situação
    (rascunho/publicada/arquivada), origem (rascunho/restauração/semente), autor, publicada em/por, criado em. Gatilho:
    versão gravada não muda nem é apagada (nem TRUNCATE); só a situação anda para a frente; excluir usuário continua
    funcionando (autor vira null).
  - `maquete_3d_lotes`: empreendimento e lote (slugs `a-z0-9-`, únicos juntos), maquete, versão fixa opcional,
    `unit_id` → `incorporation_units`, ativo, criado por. Só a tabela (a rota do lote é da Etapa 4).
- **Servidor** (`server/maquete-3d/itens.ts`, rotas `maquete3d.itens.*`, todas `adminProcedure` + `exigirAdmin` antes de
  qualquer consulta):
  - `abrir` (mutation): cria a maquete da planta na primeira vez (semente idempotente, sem script manual) e devolve a
    estrutura do servidor + o rascunho mais recente (ou publicado, ou padrão);
  - `salvar`: confere os itens (zod, itens travados, `validarFonte` contra a estrutura DO SERVIDOR) e grava versão nova
    com concorrência otimista (`INSERT … WHERE max(versao) = base`, índice único; CONFLICT se outra aba salvou);
  - `publicar`: só a última versão e da estrutura atual; revalida; num só comando marca publicada, arquiva a anterior
    e os rascunhos antigos e aponta a maquete para ela;
  - `restaurarPadrao`, `versoes`; e `itensPublicados(maqueteId)` para a Etapa 4 (só publicado, sem rota nova).
  - A lista antiga de maquetes (`maquete3d.listar`) não mostra as de origem `'fonte'`.
- **Tela** (`/maquete-demo/lote4-qd18`): botão **Editar** só para o usuário logado com papel admin; o editor
  (`EditorItens`, pedaço lazy de 29,9 kB / 8,6 kB gzip) mostra o 3D (vista geral em corte) e a planta 2D com o mesmo
  estado: tocar seleciona (contorno amarelo; vermelho com erro), arrastar com um dedo/mouse move no plano do piso sem
  girar a câmera (dois dedos voltam à câmera), painel de campos (16 px, alvos ≥ 44 px), conversão de tipo, catálogo,
  remover, Ctrl+Z / Ctrl+Shift+Z e botões, restaurar padrão, salvar rascunho, publicar e o estado ("Alterações não
  salvas", "Rascunho não publicado (versão N) · o cliente vê a versão M", "Publicado · versão N"). Erros em vermelho
  (clicar leva ao item) bloqueiam salvar e publicar; zonas da porta bloqueada em vermelho no 3D e na planta.
- **Cor e material** de cada item aplicados no 3D (`materiais-itens.ts`): o material escolhe que partes do móvel
  recebem a cor; o carro usa a cor do item como pintura.

## Como testar o editor

- Sem servidor: `node scripts/maquete/screenshots.mjs --editor` (monta o harness com uma conexão em memória que imita
  as rotas, abre `?admin=1`, faz o fluxo e grava as capturas). Para mexer à mão: depois do build do harness, servir
  `scripts/maquete/harness/dist/` e abrir `/?admin=1&editar=1`.
- No app: aplicar a 0146 numa branch do Neon, `npm run dev`, entrar como admin e abrir
  `http://localhost:3000/maquete-demo/lote4-qd18` → "Editar".

## Capturas (`screenshots/etapa-3/`, conferidas uma a uma)

| Arquivo | O que mostra |
|---|---|
| `desktop-editor-selecionado` / `celular-editor-selecionado` | Geladeira selecionada: contorno amarelo no 3D (caixa e moldura no piso) e na planta. |
| `desktop-editor-painel` / `celular-editor-painel` | Painel de campos: tipo, ambiente, X, Z, largura, profundidade, altura, rotação, giros, material, cor, remover. |
| `desktop-editor-porta-bloqueada` / `celular-editor-porta-bloqueada` (página inteira) / `celular-editor-porta-bloqueada-planta` | Geladeira arrastada para a frente da P3: zonas da porta em vermelho, avisos em vermelho, Salvar e Publicar desligados. |
| `desktop-editor-catalogo` / `celular-editor-catalogo` | Catálogo por grupo com as medidas padrão e o ambiente de destino. |
| `desktop-editor-pagina` | Página inteira depois de salvar e publicar ("Publicado · versão 1"). |

Fluxo conferido pelo script nas duas telas (20/20 OK): Editar aparece para o admin; seleção abre o painel; geladeira
solta em 0,55 × 1,35 (pedido 0,54 × 1,36, encaixe de 5 cm) gera erro citando a P3 e bloqueia Salvar; Ctrl+Z desfaz;
Ctrl+Shift+Z refaz; campo Z = 3,20 libera Salvar; salvar → "Rascunho não publicado"; publicar → "Publicado".

## Testes

- `server/maquete-3d-edicao.test.ts` (21) e `server/maquete-3d-itens.test.ts` (11) — ver a story.
- Todos os `server/maquete-3d*.test.ts`: 15 arquivos, 354 testes, todos passando (as maquetes antigas continuam
  funcionando; os testes antigos passaram a aplicar a 0146, porque o Drizzle inclui as colunas novas em todo INSERT).
- `npx tsc --noEmit` sem erro; `npx vite build` sem erro. O projeto não tem script `lint`.

## Pacote (`npx vite build`)

`EditorItens` 29,9 kB (8,6 kB gzip, só para o admin que toca em Editar); `VisualizadorFonte` 33,6 kB (13,5 kB gzip;
era 24,4 kB: cor e material dos itens, que importa a lista de materiais de `edicao.ts`, e as camadas do editor dentro do Canvas); `MaqueteDemo` 51,7 kB (18,3 kB gzip).

## Defeitos e limitações conhecidos

1. **Ordem de publicação:** com o schema novo, todo INSERT do Drizzle em `maquetes_3d` cita `glb_url`,
   `itens_versao_publicada` e `fonte_slug`. A 0146 precisa estar aplicada no banco ANTES de publicar este código, senão
   criar maquete (fluxo antigo) falha.
2. No computador, a vista 3D do editor é a vista geral (da frente): a cozinha fica pequena ao fundo; dá para girar e
   aproximar, mas não há botão "ir até o item selecionado".
3. A planta 2D da barra lateral (computador) fica pequena (até 40% da altura da tela) para o painel caber.
4. O fogão novo não aparece nas capturas (o fluxo não adiciona item); o desenho foi conferido só por tipo/compilação.
5. A prévia `/maquete-demo` continua mostrando os itens do JSON ao visitante; os itens publicados só aparecem na
   página do lote (Etapa 4, via `itensPublicados`).
6. Encaixe na parede só com o item alinhado (giro múltiplo de 90°); a face lateral não encaixa.

## Pendências

- Aplicar a 0146 numa branch do Neon e testar o editor no app logado (depende do "autorizo" para mexer em banco).
- Portão de QA (@qa) desta etapa.
- Etapa 4 (não iniciada, como pedido): rota pública por lote, status do lote, WhatsApp, ligar lote pela tela, ROADMAP.
- Push e PR: com @devops / a sessão principal.
