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

### Etapa F (correções 8 e 10) — S-F
- Motor de cenários do Estudo de Massa (`shared/incorporacao/malha-conectada.ts` novo; `massa.ts` versão 3.0.0):
  malha viária traçada primeiro e conectada (cenário desconectado é descartado), lotes de borda recortados pela divisa,
  toda sobra com destino (lote, via, área verde, institucional ou não parcelável) e fecho de áreas testado; acesso
  posicionado junto às vias existentes do entorno (camada `osm`), quando houver; KML com várias áreas separadas gera
  cenário em todas, com numeração contínua e totais somados; rótulos do desenho técnico sem sobreposição.
- No caso de referência (quadrilátero irregular de ~250 × 150 m, lote 12 × 25): Grade 57 → 70 lotes (45,5% → 57,7%),
  Cul-de-sac 35 → 68 (28,0% → 56,6%), Rua Simples 21 → 43 (16,8% → 36,0%); área sem destino de 13–59% → 0.
- Vias 3D (Etapa G) ajustadas ao motor novo: ponta de rua triangular deixada pelo recorte na divisa fica pintada no
  terreno (não é erguida como via); via reta com cabeceira em viés é encurtada até onde cabe com a largura inteira.
- Parcial: não há lotes de frente direta para a via existente; balão só onde a rua sem saída termina dentro da gleba;
  furos do KML tratados em grade, cul-de-sac e rua simples retangular (as outras tipologias recortam depois); a
  maquete aceita um terreno só (fica o de maior área, com os lotes e ruas de todas). Decisões do agente, a confirmar
  com o dono: testada mínima do lote recortado = max(5 m, metade da testada); acesso "ligado" a até 40 m da via existente.

### Etapa F — revisão do coordenador (forma dos lotes e das áreas públicas)
- Sobra que encosta em vários lotes é REPARTIDA prolongando as divisas laterais de cada lote até a divisa (cada lote
  ganha só o trecho na sua frente/fundo); anexo inteiro só se o lote continuar compacto. Critério de forma para lote
  ampliado/novo: área ≤ 1,6 × nominal; caixa orientada mínima com lado maior ≤ 2,2 × profundidade, ocupação ≥ 60% e
  proporção ≤ 2 × a do lote informado; lote novo com a frente no lado curto. O que não passa vira área pública.
- "a × b (méd.)": testada = trecho real da frente (+ curva do balão; no lote de esquina, a frente medida) e
  profundidade média = área ÷ testada. Rótulo de lote só é desenhado inteiro dentro do próprio lote.
- Área pública: nenhuma doação abaixo de 120 m² (o que faltar sai de lotes contíguos; o corte mínimo é 120 m²);
  peça < 120 m² vai para o lote vizinho (se continuar com forma de lote), para a peça pública vizinha ou para o leito
  da via encostada; se ficar isolada, o cenário avisa com a contagem. Peças contíguas do mesmo uso viram uma só (praça).
- Rua Simples: o aviso diz o % da gleba que ficou como área verde sem frente e recomenda Grade/Cul-de-sac; na seleção,
  só a área vendável é mérito (área verde além do mínimo desempata contra).
- Números (mesmo caso de referência): Grade 73 → 70 lotes (58,8% → 57,7%); Cul-de-sac 72 → 68 (58,2% → 56,6%);
  Rua Simples 44 → 43 (35,3% → 36,0%). A queda vem de deixar de aceitar lotes deformados e de não usar migalhas como doação.

### Áreas restritas aproveitadas nas doações (pedido do dono em 16/11, depois da Etapa F)
- APP, vegetação a preservar e faixas de transmissão/servidão passam a contar, por padrão, como área verde (cada
  restrição tem um seletor na tela: área verde, área institucional ou não conta). O motor desenha a restrição dentro
  da área verde/institucional e só tira da área loteável o que faltar para o mínimo; o quadro de áreas mostra a parte
  aproveitada e a economia, sem contar a área duas vezes. Regra registrada no `CLAUDE.md`.
- Arquivos: `shared/incorporacao/massa-quadro-areas.ts`, `shared/incorporacao/massa.ts`,
  `client/src/components/incorporacao/estudo/massa-tab.tsx`, `server/incorporacao-massa-aproveitamento.test.ts` (novo, 11).
- Limite: as restrições chegam ao motor só em m² (sem a geometria da APP ou da faixa). A área verde desenhada tem o
  tamanho certo, mas a posição dela não é a posição real da APP: isso vem do levantamento.

## Pendências
- **Dono:** abrir o pedido "Polímeros (Morada do Bosque)", clicar em "Gerar maquete (ler o projeto)" e dizer como ficou a
  leitura do "ARQ 01-01-CASA PADRÃO.pdf" (é a primeira medição do leitor num projeto real).
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
- Etapa F — automáticos: suíte completa com 1.908 aprovados e 1 falha antiga e sem relação (a de
  `central-vendas-envio.test.ts`); `incorporacao-massa-malha-conectada.test.ts` novo. Manual: desenhos técnicos das três
  tipologias e de duas áreas separadas conferidos em imagem. Não verificado: a aba Estudo de Massa em navegador, a busca
  das vias do entorno de ponta a ponta e os KML reais do dono.
- Áreas restritas nas doações — automáticos: `incorporacao-massa-aproveitamento.test.ts` (11) e os testes da
  Incorporação e da maquete (560) aprovados; três testes antigos ajustados à regra nova. A tela não foi aberta em navegador.
- (c) Pendentes em produção: gerar cenários num estudo real (Polímeros / Morada do Bosque) e num KML com duas áreas; leitura real do PDF da casa padrão pelo leitor próprio; novo pedido por cliente do CRM com PDF avulso real; "Gerar e distribuir nos lotes" no
  Polímeros (Morada do Bosque); mapa operacional com as imagens reais de satélite e os pontos reais; CRM no iPad (rolagem e ausência de tela preta); editar um corretor em "Usuários e acesso"
  e conferir a comissão numa obra; excluir um pedido de maquete pela lista.

## Próximo passo exato
As sete etapas do EPIC-023 estão publicadas. Falta: (1) o dono validar em produção os itens da lista "Pendentes em
produção" e dizer como o leitor próprio leu o PDF real; (2) portar para o Grupo Santa Fé as correções 1, 2, 3, 4, 8, 9
e 10 (ROADMAP); (3) ajustar o que a validação apontar.
