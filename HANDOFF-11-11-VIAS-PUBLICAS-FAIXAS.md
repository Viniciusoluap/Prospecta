# Handoff — Vias públicas: desenho igual ao memorial aprovado (11/11)

## Pedido do dono
"Você leu todo o memorial descritivo? Lá tem a medida exata de cada lote... o seu desenho ainda está errado."
Regra de aceite: "se o resultado der menos de 60 lotes, está errado".

## O que o memorial (SEPLU 1769/2026) mostra — Lote 01 Qd O, 60 lotes
Transcrição por lote: `docs/referencias/memorial-lote01-qdo-60-lotes.md`; a planta aprovada (com carimbos do cartório) não vai para o git — está com o dono (PDF do processo 1769/2026)
(os dois ainda **fora do git** — decidir se entram no repositório; a planta tem carimbo e assinaturas do cartório).
- Rua das Andorinhas (via interna em U com rotatória): fundo fixo 16,81 m (metade dos 33,62 m do braço reto) e frente
  7,44 m (125 ÷ 16,81), dos dois lados do U (36–44 e 50–60). Rotatória (45–49): frente ≈ 5,3–5,5 m, fundo fecha 125 m².
- Rua dos Uirapurus (externa): lotes de costas, laterais na mesma linha (2–12 ↔ 50–60); curva em leque (13–22); no braço
  largo, laterais paralelas à Av. dos Marrecos (23–29).
- Av. dos Marrecos (ponta larga): lotes 30–33 (fundo 20,75), 34 (5,00 de frente, fundo inteiro) e 35 (triangular).

## Concluído (commit local `feat(massa): vias públicas em faixas…` — ver `git log -1`)
- `shared/incorporacao/vias-publicas-faixas.ts` — motor em faixas reescrito por zonas:
  1. referência (`implantarReferencia`): fundo P = metade da largura entre as divisas paralelas; o lote de esquina leva a
     cunha da esquina obtusa (como o lote 60); área conferida no polígono real;
  2. faixa de ponta (`dividirPonta`/`fundoDaPonta`): dividida a partir da esquina com a referência — N lotes de fundo
     inteiro (34 e 35 do aprovado) e depois lotes de fundo `Pe`; `Pe` = menor fundo que rende o máximo de lotes;
  3. via de trás (`dividirPontas`): laterais perpendiculares à própria via (leque na curva), paralelas à via da ponta
     junto da faixa (23–29) e na mesma linha das laterais da referência onde as vias são paralelas (encaixe);
  4. cortes exatos (área medida no polígono, não por amostragem); sobra repartida nos lotes do meio (curva).
- `shared/incorporacao/vias-publicas.ts` — `buscarViasPublicas` roda primeiro o motor em faixas; se chega ao teto
  ⌊área ÷ mínimo⌋ devolve direto; senão roda o motor por trechos e fica com o em faixas quando ele rende ≥ lotes.
  Texto de `limitacoes` novo. `completarAproveitamento`: se o recorte de uma vez falha (erro numérico do polyclip),
  desconta por grupos de lotes (antes a sobra ficava sem dono em silêncio).
- `server/incorporacao-vias-publicas.test.ts` — teste novo do desenho em faixas.
- `docs/stories/epics/ROADMAP.md` — pendência de paridade para o Santa Fé registrada.
- Removidos: logs/variáveis de depuração (DBG_FAIXAS, SO_ARESTAS, SO_BANDA, PES, DBG_U) e a pasta `server/zz/`.

## Resultado no KML do estudo 1 (Lote 01 Qd O, 7.581,69 m²)
- **60 lotes**, todos ≥ 125,00 m², frente real na divisa ≥ 5,00 m, soma = 7.581,69 m² (sem sobra e sem sobreposição).
- 51 lotes com 125,00 m² exatos; 26 deles com 7,44 m de frente (Andorinhas e os de costas na Uirapurus).
- Sobra (81,69 m²) em 9 lotes: 125,08 · 126,68 · 131,58 · 134,51 · 135,26 · 135,31 · 137,27 · 137,27 · 143,72
  (esquina Marrecos/Uirapurus = lote 1 do aprovado, que lá tem 141,96). Maior lote: 143,72 m².
- Variação escolhida: `vp|faixas|P16.79|12..26|pontas:11@19.99+2` (referência = Andorinhas; faixa na Marrecos com fundo
  19,99 m e 2 lotes de fundo inteiro). Tempo: ~5 s nesta máquina (antes ~50–70 s).

## Regra do dono recebida durante a etapa (11/11) — aplicada
Em "vias públicas" só existem duas restrições: frente ≥ testada (5 m) e área ≥ lote mínimo (125 m²). Sem limite de
profundidade, sem medidas iguais; 100% da gleba vira lote; testada = frente real na divisa, área = área do polígono,
profundidadeMedia = área ÷ testada.
- Motor em faixas: nenhum lote é rejeitado nem avisado por fundo; o fundo da referência é a metade da largura entre as
  divisas paralelas **sem** teto na profundidade informada (ela é só a 2ª tentativa de fundo); a faixa de ponta usa fundo
  até área ÷ testada; texto de `limitacoes` diz isso.
- Medidas reportadas: `testada` = frente real medida no polígono; `profundidadeMedia` = área ÷ testada (testado).
- Motor por trechos (alternativa, não usado no estudo 1): a 1ª passada ainda usa 2 × profundidade como alcance inicial
  do fundo (`fundoMaxM` em `vias-publicas.ts`); não rejeita nem avisa, e a sobra é incorporada depois — fica como
  pendência revisar se o dono quiser esse motor também sem esse alcance inicial.

## Diferenças conhecidas em relação ao aprovado (não são erro de contagem)
- O KML tem 10,94 m² a menos que a planta (7.592,63): as sobras não são as mesmas, lote a lote.
- No aprovado a sobra do meio fica nos lotes 27–29/34/35; aqui, duas fatias da curva (137,27 cada) recebem a sobra.
- Faixa da Marrecos: fundo 19,99 m e frente 6,25 m (aprovado: 20,75 × 6,10); o lote da esquina 30 fecha em 125,00.
- Rotatória: frentes de 5,00 m (aprovado 5,29–5,48).

## Pendências / próximo passo exato
1. Dono conferir o desenho novo na tela (Estudo de Massa › tipologia "Vias públicas", estudo 1) contra a planta.
2. Push da branch `claude/intelligent-ptolemy-av0qoh`, atualizar o PR #199 e pedir autorização de merge/deploy
   (inclui a migração 0101 dos anexos) — **não feito nesta etapa** (push/merge/deploy dependem de autorização).
3. (resolvido) Só a transcrição do memorial entra no git; a imagem da planta, com carimbos e assinaturas, fica fora.
4. Paridade: portar o motor em faixas para o Grupo Santa Fé (registrado no ROADMAP).
5. Opcional: glebas em que o motor em faixas rende menos que o por trechos (ex.: "L", triângulo, quadra 60 × 60 nos
   testes de bancada) continuam com o desenho antigo — só o motor em faixas segue a lógica do aprovado.

## Testes
- (a) automáticos: `npx tsc --noEmit -p .` limpo; `npx vitest run` = 190 arquivos / 1585 testes passando (inclui o
  teste novo: 60 lotes, nenhum < 125, frente real ≥ 5, soma = gleba ± 0,5, ≥ 20 lotes 7,44 × 125,00, < 20 s, determinístico);
  `npx vite build` ok.
- (b) manuais (por mim): desenho gerado em SVG/PNG e comparado visualmente com a planta aprovada; bancada com outras
  formas (retângulos, L, triângulo, trapézio, quadra) — sem erro, sem lote abaixo da mínima, soma = gleba.
- (c) pendente de validação em produção: tudo desta frente (nada publicado); tempo real na função da Vercel.

## Merge e deploy (autorizados pelo dono em 11/11)
- PR #199 mergeado em `main` (0d08bc3); deploy de produção `dpl_DF79C2VH5JFmDcrAYwvPMe1JCXzz` READY em
  prospectaconstrucoes.com; sem erros de runtime nos primeiros minutos.
- Decisão do dono registrada no PR: profundidade não é limite; só frente ≥ testada e área ≥ mínima; sem sobras.
- (c) Pendente em produção: abrir o estudo 1 e conferir 60 lotes e o tempo de cálculo na Vercel.
