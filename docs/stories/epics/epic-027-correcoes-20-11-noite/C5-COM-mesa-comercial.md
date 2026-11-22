# C5-COM — Dolores: mesa comercial ligada à maquete 3D (link, status e rascunho ao cliente)

Status: InReview (ramo `epic027-c5com`, criado do pacote integrado `epic027-c5int` + merge da `origin/main` com a EPIC-028 etapas 1–4).
Epic: EPIC-027 — Correções de 20/11/2026 (noite). Plano: `C5-PLANO-dolores-jarvis.md`. Integração: `C5-INTEGRACAO.md`.
Depende de: EPIC-028 Etapa 4 (`docs/stories/epics/epic-028-maquete-editor/E4-rota-por-lote.md`, migrações 0146/0147 — página pública
por lote) e C5-E2 (proposta com "pode"/"confirmo", migração 0145).
Paridade: Dolores e Maquete 3D são exceções registradas no ROADMAP (sem porte ao Grupo Santa Fé).
Migração: **nenhuma** (usa `maquete_3d_lotes`, `maquete_3d_itens`, `maquetes_3d` e `incorporation_units` como estão).

## Pedido (aprovado pelo dono em 21/11)
A Dolores, na conversa direta do DONO, consegue "gerar o link da maquete 3D do lote, o status do lote e um rascunho de mensagem ao
cliente (que só sai com a aprovação dele)". Ela se INTEGRA à maquete que já existe; não recria nada.

## Critérios de aceite
- [x] AC1 — Leitura `consultar_maquete_lote` (só leitura, transação READ ONLY): busca tolerante ("lote 4 da quadra 18", "qd18 lt4",
      "Vila Esmeralda") ou `loteId`; um resultado → página abre?, LINK completo (só quando abre), status (disponível/reservado/vendido,
      só com unidade ligada) e o motivo em palavras simples quando não abre (sem link, desligada, sem publicação, versão não publicada,
      planta anterior, endereço público não configurado); vários → lista curta para escolher. Nunca comprador, preço ou dado pessoal.
- [x] AC2 — Leitura `listar_maquetes_lotes`: empreendimento, quadra, lote, status, se tem link e se a página abre (sem o link).
- [x] AC3 — `rascunhar_mensagem_lote`: NÃO envia nem grava nada; devolve ao dono um texto curto (modelo fixo + nome do lote + link, por
      código, intactos) que o SISTEMA mostra num quadro abaixo da resposta; sem preço — valor e nome do cliente só se o dono os disse
      na mesma mensagem (conferido por código). Sem "pode". A auditoria registra que um rascunho foi gerado (sem texto, link, nome).
- [x] AC4 — `gerar_link_maquete_lote` (fila): lote sem link → "pode" (registro); lote com link → "confirmo" (sério: o anterior deixa de
      abrir). Mesmo gerador do painel do admin (`novoCodigo`, aleatório criptográfico). Troca condicional: se o link mudou depois da
      proposta, nada muda. Ligar lote a planta/unidade e publicar versão continuam só pela tela do admin.
- [x] AC5 — Segurança: só a conversa direta do dono (porta recusa ponte HTTP e WhatsApp sem a mensagem dele; a própria leitura recusa
      canal grupo/cliente/ponte); fora de `LEITURAS_INTERNAS` (grupos), do grupo do cliente, de parceiros e do atendimento ao cliente;
      fora das ferramentas da ponte; texto colado → gerar link recusado e valor/nome do rascunho não entram; nomes do banco são dado
      (uma linha, sem link, sem marcação); nada de dado pessoal em log.
- [x] AC6 — Testes `server/dolores/c5-mesa-comercial.test.ts` (21) + listas fixas ajustadas.

## Decisões
- [AUTO-DECISION] `rascunhar_mensagem_lote` é uma LEITURA (tipo "leitura", `soConversaDoDono`), não uma ação da fila → (reason: não
  grava nem envia; como ação, o laço do WhatsApp a poria na fila esperando "pode", o que o pedido dispensa). A auditoria da porta
  (`dolores_acoes`, resumo `{ rascunho: "gerado", tom, comNome, comValor, status }`) é o registro pedido. Nível: não se aplica (nunca
  vira item); `nivelDoItem` a trataria como "sério" (desconhecida), o lado seguro.
- [AUTO-DECISION] URL pública do link = `PUBLIC_SITE_URL` (a mesma que o sistema usa para os endereços públicos e a ÚNICA que a saída ao
  dono deixa passar — `shared/dolores/links.ts`), em https e só o host (como a saída mostra). Sem a variável: nenhum link (motivo "o
  endereço público do sistema não está configurado"), nunca o domínio padrão de reserva → (reason: o filtro de saída trocaria um link
  fora da lista por "[link removido]"; e "nunca invente domínio").
- [AUTO-DECISION] Link e rascunho chegam intactos por CÓDIGO: as leituras devolvem `paraODono`; o laço (`cerebro.ts`) junta e o
  `whatsapp.ts` os põe nos quadros do sistema (nunca cortados) quando a resposta do modelo não traz o texto exato.
- [AUTO-DECISION] A conferência "a página abre" repete as condições de `lotePublico` com a conexão somente leitura (o hash da planta
  vem por parâmetro de `server/dolores/maquete-lote.ts`), em vez de chamar `lotePublico` (que usa a conexão comum, fora da transação
  READ ONLY). O teste confere que o link dado abre de fato em `lotePublico` e que o "não abre" de fato não abre.
- [AUTO-DECISION] A gravação do código fica em `server/dolores/maquete-lote.ts` (fora de `acoes/`, que não pode ter `.update(`), na
  transação de escrita da ação (`bancoDaAcao`), com `SELECT … FOR UPDATE` e UPDATE condicional ao código visto na proposta. O item da
  fila guarda só uma marca (sha-256, 16 hex) do código anterior, nunca o código. Reaproveita `novoCodigo` de `server/maquete-3d/lotes.ts`
  (não `gerarCodigo`, que grava pela conexão comum, fora da transação da autoria).
- [AUTO-DECISION] "confirmo CÓDIGO" também exigido no comando antigo ao TROCAR o link (`exigeConfirmoNoCodigo`), como nos grupos (A4).
- Verbos de ação: + "troca/trocar", "regenera" (`shared/dolores/fila.ts`), para "troca o link do lote 4" oferecer a ação.
- Piso da reserva `RESERVA_MINIMA_ENTRADA` 15.000 → 17.000: prefixo fixo medido 14.676 (+500 da API = 15.176 > 15.000).

## Fora desta entrega
- Em grupos de cliente a Dolores não passa link de maquete nem status de lote (conferido por teste que as leituras não entram).
- Ligar lote a planta/unidade e publicar versão (tela do admin). Envio a cliente (proibido; o dono encaminha).

## Testes
- (a) Automáticos: `server/dolores/c5-mesa-comercial.test.ts` (21 verdes): busca por variações; origem do link; link correto e só quando
  abre (conferido contra `lotePublico`); motivos (sem link, desligada, planta anterior, versão não publicada, sem publicação, sem
  endereço); status só com unidade; sem comprador/preço; link intacto pelos filtros de saída; lista; rascunho com link intacto e sem
  preço, valor/nome só ditos, auditoria sem texto/nome; webhook: consulta (link no quadro se o modelo errar), rascunho (só ao dono,
  nenhuma mensagem a terceiro, sem fila), gerar com "pode", trocar com "confirmo" (o "pode" não troca; link antigo deixa de abrir),
  link mudado pela tela depois da proposta, texto colado; ponte/WhatsApp sem mensagem/grupo/cliente/parceiro não alcançam; níveis; piso.
  Ajustados: `leitura-somente`, `acoes`, `correcoes-e3`, `c5-e2-resolve` (listas fixas). Resultados no Change Log.
- (b) Manuais: nenhum (sem banco real).
- (c) Pendentes em produção: conferir `PUBLIC_SITE_URL` na Vercel; conversa real "me manda o link da maquete do lote 4 da quadra 18",
  "faz um texto pro cliente com a maquete do lote 4", "gera o link do lote X" → "pode".

## File List
- `shared/dolores/maquete-lote.ts` (novo), `server/dolores/leitura/maquete-lotes.ts` (novo), `server/dolores/maquete-lote.ts` (novo),
  `server/dolores/acoes/maquete-lote.ts` (novo), `server/dolores/testes-maquete.ts` (novo), `server/dolores/c5-mesa-comercial.test.ts` (novo)
- `server/dolores/funcoes.ts`, `server/dolores/acoes/registro.ts`, `server/dolores/permissoes.ts`, `server/dolores/ponte.ts`,
  `server/dolores/cerebro.ts`, `server/dolores/whatsapp.ts`, `server/dolores/marcacao.ts`, `server/dolores/prompt.ts`
- `shared/dolores/confirmacao.ts`, `shared/dolores/fila.ts`, `shared/dolores/voz.ts`
- Testes ajustados: `server/dolores/leitura-somente.test.ts`, `acoes.test.ts`, `correcoes-e3.test.ts`, `c5-e2-resolve.test.ts`

## Change Log
- 22/11/2026 — @dev (Dex): Ready → InProgress → InReview (YOLO). Merge da `origin/main` (3fbb281, EPIC-028 etapa 4) sem conflitos: migrações 0145 (E2), 0146/0147 (maquete, da main), 0148/0149 (C5) todas presentes.
- 22/11/2026 — testes (vitest `--maxWorkers=2 --minWorkers=1`): `c5-mesa-comercial` (21), `leitura-somente`, `acoes`, `correcoes-e3`,
  `c5-e2-resolve`, `c5-e1-voz`, `c5-e1-memoria`, `ponte` → 8 arquivos/182 verdes; `whatsapp`, `marcacao`, `maquete-3d-lote-publico`,
  `integracoes-anthropic`, `grupos-automaticos`, `grupos-qa-seg-e7`, `c5-e2-qa`, `acoes-whatsapp` → 8/208 verdes; `e8-respostas-e-custo`,
  `c5-e5-gasto-por-funcao`, `c5-memoria-longa`, `c5-e3-grupo-registro`, `revisao-automatica-c5`, `c5-e1-qa-r4` → 6/105 verdes.
  `npx tsc --noEmit` limpo. Sem mudança de tela. Não há script `lint`.
