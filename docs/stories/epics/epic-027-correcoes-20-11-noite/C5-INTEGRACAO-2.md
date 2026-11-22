# C5 — integração 2: avisos proativos (C5-E4) · criadora de mesas (C5-MESAS) · mesa comercial (C5-COM)

Ramo `epic027-c5int2`, a partir de `e8aec79` (pacote da Dolores: E3 + gasto por função + memória de longo prazo + correções do
portão, ver `C5-INTEGRACAO.md`). As três frentes nasceram de `527336e` (antes das correções do portão). Merges, nesta ordem:
`epic027-c5com` (já com a main/EPIC-028) → `epic027-c5mesas` → `epic027-c5pro` → `epic027-c5int` (correção do pedido do dono no grupo
acima de `MAX_PERGUNTA`) → `origin/main`. Nenhuma migração aplicada em banco (0150 e 0151 continuam pendentes no Neon, junto com 0148/0149).

## Conflitos reais → decisão
- `c5com`: merge limpo.
- `c5mesas` (10 arquivos): `funcoes.ts`, `ponte.ts`, `cerebro.ts` — dois mecanismos de "leitura só da conversa do dono" → UM só (abaixo).
  `acoes/registro.ts`, `permissoes.ts` (`LIBERADAS_ETAPA_7_MAQUETE` + `LIBERADAS_ETAPA_7_MESAS`), `confirmacao.ts` (`exigeConfirmoNoCodigo`
  vale para `gerar_link_maquete_lote` e `propor_aprovacao_mesa`; `motivoDoSerio` com os dois motivos), `voz.ts` (rótulos das duas):
  uniões. `RESERVA_MINIMA_ENTRADA`: as duas tinham subido para 17.000 → recalculado depois do último merge (abaixo). Listas fixas
  dos testes (`acoes`, `c5-e2-resolve`, `correcoes-e3`) unidas.
- `c5pro` (14 arquivos): `operacao-gasto.ts`, `rondas.ts`, `whatsapp.ts`, `consumo.ts` (sem conflito de texto, mas incompatível) —
  unificação do envio (abaixo). `drizzle.config.ts` (schemas `…-avisos` e `…-mesas`, nessa ordem), `testes-banco.ts` (0150 e 0151, cada
  uma 2×, nessa ordem, depois da 0149), `fila.ts` (verbos "troca/regenera" + "silenciar/avisar/religar": sem colisão — "troc" é só da
  maquete e "avis/silenci/relig" só dos avisos), `confirmacao.ts` (`silenciar_aviso` = registro), `permissoes.ts`
  (`LIBERADAS_ETAPA_7_AVISOS`), `prompt.ts` (as duas linhas), `DoloresOperacaoCard.tsx` (as duas seções), listas fixas dos testes: uniões.
  `rondas.ts`: o teste da C5-E4 procura `rondaERelatorioDoCron` → o nome da função da ronda ficou esse.
- `server/_core/trpc.ts` continua SEM `"dolores.grupos.definirTipo"`. `vercel.json`: 10 crons existentes + 5 da tarde = **15**.
- `shared/funcoes-anthropic.ts`: linha própria `dolores_avisos`; a chave continua lida só em `resolverCredencialIA` e `bloqueioAtual`
  (`credencialDosAvisos` passa por `bloqueioAtual`), vigiado por `integracoes-anthropic.test.ts`.

## Mecanismo único de leitura só do dono
- `funcoes.ts#LEITURAS_DO_DONO` é o ÚNICO lugar: `listar_mesas`, `consultar_maquete_lote`, `listar_maquetes_lotes`, `rascunhar_mensagem_lote`,
  todas com `soConversaDoDono: true` e FORA de `FUNCOES` (o mais restritivo dos dois: nada que liste `FUNCOES` — ponte HTTP, grupo
  administrativo de `marcacao.ts`, catálogos — as vê). `leituraPorNome` (FUNCOES + só do dono) para a porta e a contaminação.
- `ponte.ts#executarFuncao`: a recusa (403, "só na conversa direta do dono") vem ANTES de olhar a etapa, para qualquer canal que não seja
  o WhatsApp do dono com a mensagem dele. `ferramentasLiberadas` (ponte) sem elas; `ferramentasDaConversa` = ponte + só do dono
  (`leiturasDoWhatsapp` da frente das mesas foi removida). A segunda trava da maquete (a própria leitura recusa canal grupo/cliente/ponte) ficou.
- Grupos (internos, cliente, parceiros), atendimento ao cliente e o pedido do dono no grupo (E3) usam listas próprias, sem elas (teste).

## Unificação do envio de avisos ao dono
- **Proposta aberta**: a C5-E4 tinha a sua consulta (`propostaEsperando`: aberta + adjacente + no prazo). Agora é `pendencia.ts#podeEnviarAvisoAgora`
  (o ponto único do portão, que também segura a pergunta ainda saindo), conferida antes da vaga E de novo logo antes do envio (a IA pode
  levar segundos); se a proposta nasceu no meio, a vaga é devolvida (não conta no teto de 6) e nada sai.
- **Alerta de gasto**: um caminho só, `operacao-gasto.ts#enviarAlertasPendentes` (pendente → envio no fim do webhook e nos crons, com prazo).
  A versão da C5-E4 do `conferirAlertasDoGasto` (registrar e enviar no meio do laço) foi descartada; o silêncio do tipo "gasto" foi
  reaplicado nos DOIS passos: `registrarAlertasDevidos` não registra o 80% com o tipo silenciado; `enviarAlertasPendentes` segura o 80%
  registrado antes do silêncio; o 100% sai sempre (e leva o 80% junto). O cron da tarde (`tratarCronAvisos`) também envia os alertas
  pendentes, ANTES dos avisos (os dois crons: alertas → avisos). O aviso proativo não tem tipo "gasto" na coleta (não duplica).
- **Gasto dos avisos**: `reservarAvisos` agora passa pela mesma `conferirTerceiro` do portão (M1): total comprometido (uso real + reservas
  das mensagens do dono + reservas de classificação/marcação/atendimento + esta) ≤ limite; depois folga do dono e a parte "avisos" (5%).
  Limite conhecido (decisão da C5-E4, mantida): o aviso não grava reserva — uma chamada de aviso (≤ 3.000 + 400) em voo não é vista
  por outro terceiro simultâneo.
- A IA dos avisos continua sem ferramentas e sem histórico: a memória de longo prazo não entra (teste).

## Piso × prefixo medido e custo extra
Medido com a estimativa por cima do código (`memoria.ts#tokensEstimadosDoTexto`; o tokenizador real costuma dar menos):

| | antes (e8aec79) | agora, pior caso (com ações de mesa) | agora, mensagem com ação comum | agora, só leitura |
|---|---|---|---|---|
| texto do sistema | 2.121 | 2.474 | 2.474 | 2.474 |
| ferramentas | 11.177 (32) | 14.527 (42) | 12.965 (38) | 6.776 (21; antes 5.676, 17) |
| prefixo | 13.298 | **17.001** | 15.439 | 9.250 (antes 7.797) |

- Piso `RESERVA_MINIMA_ENTRADA` 17.000 → **19.000** (pior caso 17.001 + 500 da API = 17.501; folga ~1,5 mil). Conferido pelos testes de piso
  de `c5-e1-memoria`, `c5-mesas` e `c5-mesa-comercial` (que medem o pior caso).
- Redução sem perder trava: as 4 AÇÕES de mesa (≈ 1,56 mil tokens) só são oferecidas ao modelo quando a mensagem do dono pede mesa por
  código (`intencaoDeMesa`, sem colagem e sem anexo) — o mesmo `pedidoDeMesa` sem o qual a porta já as recusava. `listar_mesas` e as leituras
  da maquete ficaram sempre (leitura com busca livre, ex.: só o nome do empreendimento; cortar perderia resposta). `silenciar_aviso` ficou
  sempre (o pedido "não quero mais saber de…" não tem palavra fixa). Nenhuma descrição que seja trava foi encurtada.
- O texto do sistema ficou abaixo do teto de 6.500 caracteres do teste da voz encurtando as linhas novas das mesas e dos avisos (2.526 → 2.474).
- Custo extra de entrada fixa por CHAMADA ao modelo (cada mensagem do dono faz de 1 a 7): +2.141 tokens (mensagem com ação comum), +3.703
  (pedido de mesa), +1.453 (só leitura). Ao preço de referência de um modelo médio (US$ 3/MTok de entrada; leitura de cache US$ 0,30;
  escrita de cache US$ 3,75), na mensagem com ação comum: sem cache ≈ US$ 0,0064 a mais por chamada; lida do cache (2ª volta em diante e
  mensagens seguidas em até 5 min) ≈ US$ 0,0006; a chamada que escreve o cache ≈ US$ 0,0080. Ex.: 50 mensagens/dia × 2 chamadas, metade
  pelo cache → ≈ US$ 0,35/dia ≈ US$ 10/mês a mais. Trocar de lista (só leitura ↔ com ações ↔ com mesa) refaz o cache do prefixo daquela chamada.

## Testes cruzados (`server/dolores/c5-integracao2.test.ts`, 13)
- Aviso proativo espera com proposta de MESA aberta e com proposta de LINK DA MAQUETE aberta (webhook de verdade); decidida, sai; o "pode"
  continua valendo. Proposta aberta enquanto a IA redigia → nada sai e a vaga é devolvida.
- Leituras só do dono: as 4 em `LEITURAS_DO_DONO`, com a marca, fora de `FUNCOES` e da ponte; 403 na ponte e no WhatsApp sem mensagem;
  fora de grupos internos/cliente/parceiros, do atendimento e do fluxo E3 (`grupo-pedido-dono.ts` nem usa a porta); ações de mesa só com o
  pedido de mesa.
- Memória de longo prazo fora do pedido à IA dos avisos e do texto enviado.
- Custo: avisos em "avisos"; mesas e maquete (conversa do dono) em "conversa".
- Alerta de gasto: um só, por um caminho, com cron da tarde, da manhã e envio direto; espera com proposta aberta junto com o aviso; "gasto"
  silenciado segura o 80% (antes ou depois do silêncio) e o 100% sai uma vez.

## Teste intermitente (`acoes.test.ts` › "as quatro ações da etapa 3…")
Não reproduzido em 3 tentativas: 2 rodadas com 12 arquivos em paralelo (`--maxWorkers=4`, máquina com carga ~20: 276/276 cada) + a
1ª metade da suíte (inclui `acoes.test.ts`). Análise da causa: as três asserções que podem dar "expected true to be false" nesse teste
(`funcaoLiberada` de uma proibida, `ACOES.some` de uma proibida, regex de nome de ferramenta perigosa) só leem listas fixas de módulo
(`permissoes.ts`, `acoes/registro.ts`, `ponte.ts`), sem banco, relógio, ambiente nem estado mutável; o vitest isola os módulos por arquivo
(`isolate` padrão; `vitest.config.ts` não muda) e nenhum teste grava arquivo do código. Não há estado compartilhado entre arquivos que
explique a falha; a hipótese mais provável é o arquivo ter sido lido no meio de uma edição da própria frente (`registro.ts`/listas
fixas mudando enquanto o vitest rodava — aconteceu igual nesta integração, com `correcoes-e3`, quando um merge correu durante uma rodada).
Nada corrigido (sem causa no código); fica registrado.

## Números
- `npx tsc --noEmit` limpo (antes e depois do merge da `origin/main`); `npx vite build` ok.
- Suíte em duas metades (vitest `--maxWorkers=2 --minWorkers=1`), no código integrado (antes do merge da main — que não mudou a árvore:
  a main tinha a mesma árvore de `epic027-c5int`, já mesclada):
  - `server/dolores/[a-e]*`: **45 arquivos, 774 testes, todos verdes** (2.264 s);
  - `server/dolores/[f-z]*` + `integracoes-anthropic`, `integracoes-modelo-por-funcao`, `admin-permissions`, `operacional`,
    `maquete-3d-lote-publico`, `api-rotas-producao`: **34 arquivos, 669 testes, todos verdes** (1.294 s).
- Ajustes de teste pela integração: `c5-mesa-comercial` e `c5-e1-voz` (leituras só do dono agora fora de `FUNCOES`); `c5-e4-proatividade`
  (o alerta de 100% da parte "avisos" sai no fim do aviso do WhatsApp, pelo caminho único, uma vez); listas fixas unidas.
- `vercel.json`: 15 crons. Migrações 0145–0151 todas no repositório; 0150/0151 aplicadas 2× no banco de teste, depois da 0149.

## Pendências
- Portão de QA de segurança (@qa) do pacote integrado antes da `main` (regra da Dolores de 16/11).
- Na publicação: aplicar 0148, 0149, 0150 e 0151 no Neon (aditivas); conferir os 15 crons no painel da Vercel e `PUBLIC_SITE_URL`.
