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

## Rodada de validação de 16/11 (o dono mandou: "teste você mesmo e corrija")

Feito com dados reais: os quatro terrenos do banco (Polímeros, Residencial Cajueiro, Chacreamento e ImperaCity), os dois
PDFs reais do Polímeros (baixados do Drive para a pasta temporária da sessão, **fora do repositório**) e o site real
construído e aberto em navegador de teste (Chromium, com emulação de iPad e iPhone e chamadas tRPC simuladas).

**Defeitos achados e corrigidos**
- **CRM (correção 1):** a página inteira ainda rolava por baixo. Causa: os textos de acessibilidade dos cards
  (`sr-only`, posição absoluta) escapavam das colunas e esticavam o documento para ~9.000 px. Correção: `relative` nos
  três contêineres de rolagem (`AdminCRM.tsx`). Medido antes/depois em iPad retrato e paisagem, iPhone e computador:
  documento = altura da janela; a coluna rola; o trilho rola de lado.
- **Teste antigo da Central de Vendas:** era uma bomba-relógio (leads criados com a data real do banco e relógio do
  teste parado em 12/11/2026). Agora os leads nascem na data do relógio do teste. 8/8.
- **Estacionamento:** o dono achou 25 m² por vaga demais. A vaga é de um carro (12,5 m²); a conta usa 18,75 m²
  (vaga + metade do corredor de manobra), com campo ajustável de 12,5 a 35 m² na tela. Rótulo do pilotis mostrava o
  total de vagas em cada lado: agora mostra as de cada lado, e o resumo usa o número escrito.
- **Maquete 3D — área verde azul:** toda área pública era pintada de azul (parecia água). O lote da maquete ganhou o
  campo opcional `uso` (verde/institucional), vindo do estudo de massa; verde é pintado de verde, com legenda própria.
  Maquetes antigas: clicar em "Atualizar a implantação a partir do estudo".
- **Maquete 3D — rua da divisa sem asfalto:** rua cujo leito afunila (cortado pela divisa ao longo do comprimento)
  virava um toco de 7 m e o resto ficava uma laje cinza. `formaDaRua` agora usa a faixa que cabe no comprimento todo
  (mais estreita). Teste novo em `maquete-3d-vias.test.ts` com as medidas reais do Cajueiro.
- **Estudo de massa:** em terreno estreito (Polímeros) a nota mandava "preferir Grade ou Cul-de-sac" mesmo já estando
  em Grade; agora orienta para a tipologia Vias públicas quando há rua existente na divisa.
- **Fontes do mapa:** o OpenStreetMap passou a ser consultado em todos os servidores ao mesmo tempo (vale o primeiro
  que responder), com repetição e um pedido de reforço após 10 s; a página "Sistema em manutenção" da EPE é
  reconhecida e dita como tal (sem repetir à toa).

**Resultados dos testes com dados reais**
- Motor de cenários nos 4 terrenos, Grade e Cul-de-sac: todos geram, ruas ligadas, fecho de áreas com diferença
  ≤ 0,02 m², nenhuma sobra. ImperaCity (duas áreas, 47,5 ha, APP 12,4 ha): 880 lotes em ~10 s. Cajueiro: 50 lotes,
  APP inteira contada como área verde. Polímeros com as ruas reais do OpenStreetMap: acesso reconhecido pela
  "Avenida das Dalias"; como o terreno é uma faixa em volta de rua existente, a tipologia certa é Vias públicas
  (60 lotes, igual ao projeto real), não Grade (9 lotes).
- Aba Estudo de Massa real (componente `MassaTab`) em navegador, computador e iPad, com o ImperaCity: gera em ~11 s,
  sem erro, cinco seletores de destino das áreas restritas, resumo da economia e nota do acesso.
- Maquete 3D do Cajueiro (50 lotes, casas padrão): 22 chamadas de desenho por quadro; painel do prédio mostra a conta
  do estacionamento (12 andares pedidos → 1, com o motivo).
- Fontes reais a partir deste ambiente: IBAMA responde (um erro 500 foi recuperado pela repetição); OpenStreetMap
  respondeu em 2 de 4 buscas (só o espelho maps.mail.ru responde daqui); EPE devolve sempre a página de manutenção
  (503) — vegetação (MapBiomas) e linhas da EPE ficam indisponíveis até a EPE voltar.

**Não foi possível verificar**
- Como as fontes se comportam a partir da Vercel: a tabela `camadas_terreno_cache` de produção está vazia (ninguém
  abriu o mapa do terreno desde a publicação). Depois que o dono abrir o mapa de um estudo, conferir essa tabela.
- Fluidez em iPad/celular reais (aqui a placa de vídeo é simulada por software) e o Safari de verdade.

## Segunda leva de 16/11 — portão de QA, leitor no PDF real e APP com contorno (AIOX)

O dono perguntou se o AIOX estava em uso: a primeira leva tinha sido feita direto. A partir daqui: story `S-H`
(validação) e `S-I` (APP), @dev nos dois desenvolvimentos e @qa nos portões.

**Portão de QA do PR #232 (@qa): CONCERNS — achados corrigidos (commit `11393d0`)**
- Overpass: as consultas perdedoras ficavam abertas até ~50 s e o reforço saía mesmo depois da resposta. Agora um
  `AbortController` por corrida cancela tudo quando um servidor responde; 1 repetição em vez de 2.
- Pilotis: a conta só pela área dava vaga onde o carro não cabe (ala de 2,5 m). Agora vale o menor entre a área e o que
  cabe na largura da ala, com o carro entrando pela lateral. Mínimo da área por vaga: 15 m² (era 12,5, sem corredor).
- Vagas da garagem: o resumo lia "(N vagas)" do nome do cômodo (editável, e dobrava em maquetes já salvas). Agora há o
  campo opcional `vagas` no cômodo; sem ele, estima pela área.
- Rua em triângulo/cunha voltou a ficar só pintada; "Área pública" antiga ganhou cor própria na legenda.
- Testes novos: corrida do Overpass com cancelamento, página de manutenção da EPE, triângulo, prédio estreito.

**Leitor geométrico no PDF real do Polímeros (@dev) — medido no arquivo real, fora do repositório**
- Antes: 3 "plantas" (uma era o CORTE B), cozinha e banheiro sem nome, nenhuma porta; a folha de urbanismo virava 6
  plantas sem sentido em 16 s.
- Depois: 1 planta ("PLANTA BAIXA", 1:50, 4,90 × 11,41 m), seis cômodos com nome (diferença de área entre +4% e
  +12%; a área desenhada vai ao eixo da parede), 4 portas e 5 janelas, em menos de 1 s. Folha de urbanismo recusada
  em 2 ms com aviso em português.
- Ainda falha no arquivo real: a porta de correr da frente é lida como janela (fica o aviso "marque a entrada");
  banheiro +11,6%; um "Ambiente" de 1,3 m² sem nome; a casa é recortada pela caixa dos cômodos com nome (garagem sem
  nome ficaria de fora, com aviso).
- Portão de QA do leitor: em andamento.

**S-I — APP com o contorno real no Estudo de Massa:** em andamento com @dev (migração `0117` ainda NÃO aplicada).

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
