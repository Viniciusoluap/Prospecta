# C8 — Logotipo da incorporação gerado pela IA da chave do painel (SVG)

Status: InReview (ramo `epic027-logo`; aguarda portão de QA).
Epic: EPIC-027 — Correções de 20/11/2026 (noite) (o `EPIC.md` vive em outro ramo).
Paridade: a Incorporação existe nos dois sistemas → pendência de porte registrada no `ROADMAP.md` (EPIC-027 C8).
Migração: **nenhuma** (o teto diário é contado em `dashboard_settings`, que já existe).

## Pedido do dono (21/11/2026)
Na Incorporação, o botão "Gerar logotipo com IA" mostrava "IA de imagem não configurada (BUILT_IN_FORGE_API_URL e
BUILT_IN_FORGE_API_KEY ausente)". O dono já cadastrou a chave da Anthropic em Configurações › Integrações › Anthropic e quer
que ESSA IA gere o logotipo.

## Solução
A Anthropic não gera foto, mas escreve SVG. O modelo desenha o logotipo em SVG com a chave do painel; o servidor limpa o SVG
e devolve a proposta, que segue o MESMO caminho do SVG enviado pela pessoa: o navegador converte em PNG de exibição, mostra a
pré-visualização e a pessoa aprova (ou gera outra / cancela) antes de substituir o logotipo atual. O caminho Forge foi
removido da geração de logotipo (`server/_core/imageGeneration.ts` continua no repositório, sem uso por esta função).

- **Função própria no painel**: "Logotipo da incorporação" (`incorporacao_logotipo`) em Integrações › Anthropic › Modelo
  por função. Ordem do modelo: o da função → o preferencial do painel → padrão da função `claude-sonnet-5`. Escolher modelo
  não liga nada; a IA só é chamada quando a pessoa clica no botão.
- **Chave**: lida num único ponto nomeado, `resolverCredencialLogotipo` (`server/incorporacao-logo-ia.ts`), terceiro ponto
  vigiado por `server/integracoes-anthropic.test.ts` (a tela só pergunta SE há chave, por `existeChaveAnthropicPainel`).
  Sem queda para variável de ambiente. A chave nunca vai para log, erro, resposta ou tela (o log guarda só código HTTP e tipo).
- **Dados como DADO**: nome (até 120), cidade (até 80), estado e tipo vão num JSON entre `<dados_do_empreendimento>`, sem
  `<`/`>` nem caracteres de controle; o prompt de sistema diz que o conteúdo é dado, nunca instrução.
- **Limites**: chamada de até 40 s (`timeout` do cliente + `AbortSignal`, sem nova tentativa), `max_tokens` 4.000; teto de
  5 propostas por empreendimento por dia e 5 por pessoa por dia (dia de Imperatriz), reservado ANTES da chamada, numa
  transação com trava (duas abas não passam do teto), e contado mesmo se a IA falhar — o lado seguro do gasto, como na Maquete.
- **SVG não confiável** (`server/incorporacao-logo-svg.ts`, `sanitizarSvg`, lista de permissão): vale para o SVG da IA
  (limite 200 KB) e, a partir de agora, também para o SVG enviado (limite geral do logotipo) — o original guardado é o
  limpo. Recusa: tamanho acima do limite, mais de uma raiz ou raiz que não é `<svg>`, XML malformado, `<!ENTITY`, DOCTYPE
  com declarações internas. Remove: DOCTYPE simples, instruções de processamento (`<?xml-stylesheet?>`), comentários,
  `<script>`, `<foreignObject>`, animações (`<set>`, `<animate>`), `<a>`, metadados e elementos de editores, tudo fora da
  lista; atributos `on*`, `href`/`xlink:href` que não seja `#id` (em `<image>`, só PNG/JPG/GIF/WebP embutido), valores com
  `javascript:`/`vbscript:`/`expression()`/`@import`, `url(...)` que não seja `#id`; `<use>`/`<image>` sem href válido saem.
  A saída da IA só é aceita se for o documento SVG (no máximo cercado por bloco de código) e continuar SVG com desenho
  depois da limpeza; senão, erro amigável.
- **Permissão**: a mesma de quem envia o logotipo (módulo Incorporação).
- **Tela**: o botão fica desabilitado sem chave, com "Cadastre a chave da IA em Configurações › Integrações › Anthropic
  para gerar o logotipo."; durante a geração, "Gerando o logotipo… (pode levar até 40 segundos)" e botões desabilitados;
  na pré-visualização da proposta da IA, "Aprovar e salvar", "Gerar outra" e "Cancelar"; aviso quando restam 1 ou 0
  propostas no dia.

## Critérios de aceite
- [x] Com a chave no painel, o botão gera uma proposta em SVG pela Anthropic; sem a chave, a mensagem em português simples
      (sem nome de variável de ambiente) e nada é chamado.
- [x] Linha própria no painel de modelo por função, com modelo próprio; guarda da chave atualizada de forma explícita.
- [x] Chave nunca em log, erro, resposta ou tela.
- [x] SVG da IA (e o enviado) passa pela limpeza; cada vetor listado no pedido coberto por teste.
- [x] Dados do empreendimento delimitados, limitados e declarados como dado.
- [x] Prazo de 40 s, saída contida, teto de 5/dia por empreendimento e por pessoa, reserva atômica.
- [x] Mesma permissão do envio; a proposta não grava nada até ser aprovada.
- [x] Caminho Forge removido da geração de logotipo.

## File List
- `server/incorporacao-logo-ia.ts` (novo) — ponto único da chave, teto diário, chamada e extração do SVG.
- `server/incorporacao-logo-svg.ts` (novo) — limpeza do SVG (upload e IA).
- `server/incorporacao-logo-router.ts` — `iaDisponivel`/`gerarIa` pela Anthropic; `salvar` limpa SVG enviado.
- `shared/incorporacao/logotipo.ts` — `dadosDoLogotipo`, `SISTEMA_LOGOTIPO`, `pedidoLogotipo`, `TETO_LOGO_IA_POR_DIA` (sai `promptLogotipo`).
- `shared/funcoes-anthropic.ts` — função `incorporacao_logotipo` e `MODELO_PADRAO_DA_FUNCAO`.
- `server/_core/anthropic-painel.ts` — padrão da função no painel; documentação dos três pontos de leitura.
- `client/src/components/incorporacao/LogotipoEmpreendimento.tsx` — SVG da IA no mesmo caminho do enviado; mensagens; "Gerar outra".
- Testes: `server/incorporacao-logo-svg.test.ts` (novo), `server/incorporacao-logotipo.test.ts`,
  `server/integracoes-anthropic.test.ts`, `server/integracoes-modelo-por-funcao.test.ts`.

## Testes
(a) Automáticos — `npx tsc --noEmit` sem erros; `npx vitest run` dos arquivos acima + testes da Dolores ligados ao painel
(`e8-respostas-e-custo`, `operacao`, `e8-qa-seguranca`, `c6-qa-seguranca`): todos passando; `npx vite build` ok.
(b) Manuais — nenhum (sem acesso ao painel com a chave real neste ramo).
(c) Pendentes em produção — gerar um logotipo real num empreendimento; conferir o tempo de resposta do modelo escolhido
(se passar de 40 s, escolher um modelo mais rápido na linha "Logotipo da incorporação"); conferir que `claude-sonnet-5`
existe na conta (se o preferencial estiver escolhido, ele vale antes do padrão).

## Limitações honestas
- É um desenho vetorial simples (formas geométricas e o nome em fonte genérica), não arte de designer nem imagem
  fotográfica; serve como proposta inicial. A fonte do texto é a do navegador de quem gera (sem fonte externa).
- Proposta que falha (tempo, resposta inválida) conta no teto do dia.
