# HANDOFF — 15/11/2026 — EPIC-023 (13 correções pedidas pelo dono)

## Leia primeiro
- Plano e stories: `docs/stories/epics/epic-023-correcoes-15-11/` (EPIC.md e S-A … S-G).
- Autorização do dono (15/11): executar tudo sem parar, migrando e publicando a cada etapa — regra em `CLAUDE.md`.
- Decisões respondidas: (1) autorizado publicar/migrar todas as etapas; (2) colaborador perde o acesso a corretores;
  (3) pode trocar a regra CHECK de vínculo da maquete; (4) pode zerar a leitura das maquetes paradas em "Lendo o projeto".
- Branch de trabalho: `claude/motor-maquetes-3d-hwqvkz` (reiniciar a partir da `main` depois de cada merge).

## Concluído
### Etapa A (correções 1, 2, 3 e 5) — S-A
- CRM Pipeline: a tela ocupa a altura do aparelho; o trilho rola de lado e só os cartões rolam dentro das colunas.
- "Corretores" unificado em "Usuários e acesso": comissão padrão, observações, busca, filtro de situação e cadastro de
  corretor sem convite. Atalho e tela removidos; `/admin/corretores` redireciona. `corretoresRouter` mantido (só admin).
- Filtro por tipo de usuário (Todos + os seis perfis do formulário).
- Maquete 3D: botão excluir na lista (recusa com motivo antes), coluna "Criada em" sem quebra.
- Sem migração nesta etapa.

### Etapa B (correção 4) — S-B
- Mapa operacional na base nova (MapLibre, a mesma da Incorporação): alfinetes por situação, agrupamento que separa ao
  aproximar, lista para pontos no mesmo endereço, Satélite/Ruas, busca, filtro e tabela mantidos. Sem migração.

### Etapa C (correções 6, 7 e 12) — S-C
- Pedido de maquete ligado a projeto OU a cliente do CRM; PDF avulso no novo pedido e dentro do pedido (projeto e
  Incorporação). Migração `0115_maquete_3d_lead_arquivos.sql` aplicada no Neon de produção (6 maquetes existentes válidas).
- Painel "Tipo da maquete e construções": trocar o tipo redesenha; casa (térrea/sobrado) e prédio padrão gerados pelo
  motor, um em cada lote vendável, com a frente para a rua; loteamento tira as construções.
- Visualizador mostra todas as construções (antes só 24).

### Etapa E (correção 9) — S-E
- Camadas do mapa do terreno: cabeçalhos corretos (User-Agent e Accept), repetição automática com espera crescente e
  respeito ao `Retry-After`, quatro servidores do Overpass com uma consulta por vez em cada, e o último resultado bom
  guardado por terreno e camada (`camadas_terreno_cache`, migração 0116 aplicada no Neon). A legenda separa "nada no
  entorno", "fonte fora do ar" e "dado salvo em dd/mm/aaaa".

## Pendências
- Etapas D (leitura sem IA), F (Estudo de Massa: áreas separadas e malha conectada), G (vias 3D).
- Porte para o Grupo Santa Fé das correções 1, 2, 3, 4, 8, 9 e 10 (lista no ROADMAP) — sem acesso àquele repositório.

## Testes
- (a) Automáticos: `tsc --noEmit` sem erros; suíte completa com 1.783 aprovados e 1 falha antiga e sem relação
  (`server/central-vendas-envio.test.ts > sem resposta e reativação 30/60/90 dias`, falha também na `main`).
- (b) Manuais: mapa operacional conferido em navegador de teste com 5 pontos fictícios e imagens de satélite
  simuladas (o ambiente não alcança os servidores de imagem): alfinetes, agrupamento, aproximação e lista do mesmo
  endereço funcionaram. O layout do CRM não foi conferido em navegador nem em iPad.
- Etapa C — automáticos: `maquete-3d-padrao.test.ts` (14) e `maquete-3d.test.ts` (23) aprovados. Manual: maquete aberta em
  navegador de teste com 36 casas padrão nos lotes (inclusive em leque), 10 prédios e um sobrado isolado, sem erro.
- Etapa E — automáticos: 51 testes das camadas (21 novos) aprovados, com rede simulada. Não verificado: a resposta
  real das fontes (EPE, IBAMA, Overpass) — o ambiente de desenvolvimento não as alcança; conferir em produção se o
  406 do OpenStreetMap sumiu.
- (c) Pendentes em produção: novo pedido por cliente do CRM com PDF avulso real; "Gerar e distribuir nos lotes" no
  Polímeros (Morada do Bosque); mapa operacional com as imagens reais de satélite e os pontos reais; CRM no iPad (rolagem e ausência de tela preta); editar um corretor em "Usuários e acesso"
  e conferir a comissão numa obra; excluir um pedido de maquete pela lista.

## Próximo passo exato
Etapa D (`S-D-leitura-pdf-sem-ia.md`): leitor geométrico no servidor com `pdfjs-dist`. A Etapa F está em execução por
um agente em worktree (branch local `etapa-f`); quando terminar, revisar, trazer para a branch de trabalho e publicar.
