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

### Etapa D (correção 11) — S-D
- Leitor próprio do PDF, sem IA e sem custo, como padrão (`server/maquete-3d/geometrico.ts` + `pdf-vetorial.ts`): escala,
  paredes, portas, janelas, vãos, cômodos com nome e área, escadas. Uma prancha por passo. A leitura pela IA virou opção
  em Configurações. As três maquetes paradas em "Lendo o projeto" (ids 1, 2 e 3) voltaram para "liberada" para serem lidas de novo.
- Medido só nas plantas de teste (`server/fixtures/maquete-3d/`); os PDFs reais do dono não puderam ser abertos aqui.

### Regra do estacionamento em prédios (pedido do dono em 15/11, depois da Etapa C)
- O prédio padrão só é gerado com os apartamentos que o estacionamento do terreno comporta: vagas no pátio, sob o
  pilotis e em subsolos (25 m² por vaga). Se não fechar, os andares são reduzidos e a conta aparece na tela; se nem um
  andar couber, o prédio não é gerado. Térreo em pilotis vira estacionamento na maquete. Regra registrada no `CLAUDE.md`.
- Subsolos entram na conta das vagas, mas não são desenhados na maquete.

### Etapa G (correção 13) — S-G
- Vias em 3D de verdade no visualizador (`shared/maquete-3d/vias.ts` + `visualizador/Vias.tsx`): asfalto com abaulamento,
  sarjeta, meio-fio, calçada com faixa de serviço, eixo amarelo, bordos brancos, faixas de pedestres e linhas de
  retenção, árvores, postes que acendem à noite, PARE e semáforo (só no cruzamento de duas vias de 14 m ou mais),
  cruzamentos e balões, tudo seguindo o relevo e gerado por código. As vias lidas do PDF (`imp.vias`) passam a aparecer.
- Limites conhecidos: boca do balão em canto vivo; balão cortado pela divisa é desenhado inteiro; dobra fechada da via
  pela divisa fica em quina.

## Pendências
- **Dono:** abrir o pedido "Polímeros (Morada do Bosque)", clicar em "Gerar maquete (ler o projeto)" e dizer como ficou a
  leitura do "ARQ 01-01-CASA PADRÃO.pdf" (é a primeira medição do leitor num projeto real).
- Etapas F (Estudo de Massa: áreas separadas e malha conectada), G (vias 3D).
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
- Etapa D — automáticos: `maquete-3d-leitor.test.ts` (9) e `maquete-3d.test.ts` (25) aprovados. Não verificado: PDFs
  reais; execução do `pdfjs` dentro da função da Vercel (testado só no Node local).
- Estacionamento — automáticos: `maquete-3d-padrao.test.ts` (20) e `maquete-3d.test.ts` (25) aprovados, incluindo a
  varredura de combinações em que os apartamentos nunca passam das vagas. A tela não foi conferida em navegador.
- Etapa G — automáticos: `maquete-3d-vias.test.ts` (24) aprovado junto com os demais testes da maquete. Manual: capturas
  em navegador de teste (cruzamento, balão, rua ao nível do chão, noite) sem via flutuando, faixa torta nem emenda.
  Não verificado: fluidez em iPad e celular reais (medido só com renderização por software).
- (c) Pendentes em produção: leitura real do PDF da casa padrão pelo leitor próprio; novo pedido por cliente do CRM com PDF avulso real; "Gerar e distribuir nos lotes" no
  Polímeros (Morada do Bosque); mapa operacional com as imagens reais de satélite e os pontos reais; CRM no iPad (rolagem e ausência de tela preta); editar um corretor em "Usuários e acesso"
  e conferir a comissão numa obra; excluir um pedido de maquete pela lista.

## Próximo passo exato
Etapa F: o agente (branch local `etapa-f`) está corrigindo a anexação de sobras (lotes em "pente", áreas verdes
minúsculas e contíguas, aviso da rua simples). Quando voltar: rever as imagens, trazer os commits por `git cherry-pick`,
rodar a suíte (os três testes de `maquete-3d-vias.test.ts` que usam o motor de massa podem precisar de ajuste) e publicar.
