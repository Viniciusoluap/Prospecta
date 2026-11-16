# S-H — Validação com dados reais e correção do que ela apontar

Status: InProgress (primeira leva publicada em 16/11/2026 — PR #232; leitor de PDF e portão de QA em andamento)
Epic: EPIC-023 (Etapa H) — pedido do dono em 16/11/2026: "teste você mesmo e corrija os erros"
Paridade: os ajustes do CRM, das fontes do mapa e do Estudo de Massa entram na lista de porte ao Grupo Santa Fé,
arquivada por decisão do dono em 16/11 (ROADMAP). Maquete 3D: exceção já registrada.
Tamanho estimado: M

## Problema

As etapas A–G foram publicadas com testes automáticos, mas vários itens ficaram como "não verificado": telas em
navegador e em iPad, KML reais, PDF real do projeto, fontes externas do mapa. O dono mandou testar tudo e corrigir.

## Critérios de aceite
- [x] AC1: CRM (pipeline) conferido em navegador com emulação de iPad e iPhone: a página não rola, só as colunas.
- [x] AC2: motor de cenários rodado nos terrenos reais do banco (Polímeros, Cajueiro, Chacreamento, ImperaCity com
      duas áreas e APP), com os desenhos conferidos.
- [x] AC3: aba Estudo de Massa real aberta em navegador (computador e iPad), com o seletor das áreas restritas.
- [x] AC4: maquete 3D de um terreno real aberta em navegador; painel do prédio com a conta do estacionamento.
- [x] AC5: estacionamento com a vaga de um carro (12,5 m²) e área por vaga ajustável (pedido do dono).
- [x] AC6: teste antigo da Central de Vendas corrigido.
- [x] AC7: fontes externas do mapa testadas de verdade a partir do ambiente de desenvolvimento; busca mais resistente.
- [x] AC8: leitor geométrico calibrado no PDF real do Polímeros (só a planta baixa vira pavimento; cômodos com nome;
      portas; folha de urbanismo recusada com aviso; leitura em poucos segundos).
- [x] AC9: portão de qualidade (@qa) sobre o PR #232 e sobre o leitor, com os achados corrigidos.
- [ ] AC10: fontes externas conferidas em produção (tabela `camadas_terreno_cache`) depois que o mapa for aberto lá.

## Tarefas
- [x] T1: bancada de teste de tela (site construído + Chromium + tRPC simulado) — temporária, fora do repositório.
- [x] T2: correções da primeira leva (CRM `relative`; vaga 18,75 m²; `uso` do lote; rua afunilada; corrida entre os
      servidores do OpenStreetMap; nota do estudo de massa; teste da Central de Vendas).
- [x] T3: calibragem do leitor no PDF real (@dev) + testes sintéticos que reproduzem os traços do PDF real.
- [x] T4: portão de QA (@qa) e correções.
- [ ] T5: HANDOFF, publicação e conferência da Vercel.

## Arquivos principais
- `client/src/pages/admin/AdminCRM.tsx`, `client/src/pages/admin/AdminMaquete3D.tsx`
- `client/src/components/maquete-3d/visualizador/Implantacao.tsx`
- `shared/maquete-3d/{padrao,modelo,implantacao,vias}.ts`, `shared/incorporacao/massa.ts`
- `server/_core/geo/camadas-terreno-busca.ts`, `server/maquete-3d/{geometrico,leitura,router}.ts`
- Testes: `server/maquete-3d-vias.test.ts`, `server/maquete-3d-padrao.test.ts`, `server/central-vendas-envio.test.ts`,
  `server/maquete-3d-leitor.test.ts`

## QA Results
- PR #232 — @qa em 16/11: **CONCERNS**. Nove achados (1 alto, 5 médios, 3 baixos), todos confirmados rodando código;
  corrigidos no commit `11393d0` (Overpass sem cancelamento; vagas do pilotis; contagem de vagas pelo nome do cômodo;
  rua em triângulo; legenda). Não conferido pelo QA: navegador, banco e rede real.
- Leitor de PDF — @qa em quatro rodadas (16/11): FAIL, FAIL, FAIL, **CONCERNS — "safe to publish: yes"**. Cada rodada
  achou regressões fora da prancha do Polímeros (títulos comuns recusados; corte virando pavimento; regra de hachura
  apagando parede; teto de candidatos cortando prancha grande sem aviso; "PISO" no título; edícula empilhada como
  2º andar; parede com camada de reboco entre pilares virando janela) e todas foram corrigidas com teste sintético.
  Regra que guiou as decisões: nunca devolver em silêncio um prédio errado — na dúvida, ler menos e avisar.
  No PDF real: 1 pavimento "PLANTA BAIXA" 1:50, 4,90 × 11,08 m, seis cômodos com nome, 6 janelas e 3 portas, em
  ~0,6 s; folha de urbanismo recusada em 2 ms.
  Limitações conhecidas, todas avisadas na tela: porta de correr da frente lida como janela (pede para marcar a
  entrada); banheiro +11,6% de área; um "Ambiente" de 1,3 m² sem nome; anexo fechado sem nome e sem porta fica de
  fora; desenho sem título e sem porta de abrir não vira pavimento; PDF que é só imagem não é lido (S-03 do EPIC-024).

## Registro
Detalhes, medições e o que não pôde ser verificado: `HANDOFF-15-11-CORRECOES.md`, seção "Rodada de validação de 16/11".
Os PDFs e KML reais usados nos testes ficaram só na pasta temporária da sessão; não entram no repositório.
