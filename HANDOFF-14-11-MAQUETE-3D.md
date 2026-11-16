# HANDOFF — Maquete 3D (EPIC-022) — 14/11/2026

Branch: `claude/motor-maquetes-3d-hwqvkz`. Exclusivo do Prospecta (exceção de paridade autorizada pelo dono em
14/11/2026 e registrada em `docs/stories/epics/ROADMAP.md`). **Regra do dono (15/11/2026, em `CLAUDE.md`): seguir até o fim das quatro etapas, aplicando as migrações
aditivas e publicando (merge + deploy) ao fim de cada etapa, sem pedir confirmação.**

## Leia primeiro
- `docs/stories/epics/epic-022-maquete-3d/EPIC.md` — decisões do dono, arquitetura e as 4 etapas.
- `docs/stories/epics/epic-022-maquete-3d/PROMPT-MESTRE-14-11.md` — o que o prompt pede e em que etapa entra.

## Situação em 15/11/2026 — as quatro etapas entregues
- **Etapa 1** (base, motor de leitura, revisão): PR #218, migração 0111.
- **Etapas 2 e 3** (visualizador 3D; venda pelo portal com Asaas): PR #219, migrações 0112 e 0113.
- **Etapa 4** (Incorporação: loteamento, condomínio, prédio): este PR, sem migração.
- Todas as migrações foram aplicadas no Neon de produção (projeto `SiteProspecta`, `plain-cake-26372935`) e cada
  etapa foi publicada na `main` (deploy da Vercel conferido).

## Aprimoramentos de 15/11 (S-08) — pedidos pelo dono depois das quatro etapas
Botão "Aprimorar" (oclusão de ambiente, brilho, móveis detalhados, foto em alta), escadas em L/U/caracol, carro na
garagem, tela de posicionar casas do condomínio, implantação seguindo a topografia do estudo, aprovação do pedido
pelo admin antes da cobrança e e-mail automático (aprovado / maquete pronta). Migração 0114 (tipo de e-mail).
Detalhes e arquivos: `docs/stories/epics/epic-022-maquete-3d/S-08-aprimoramentos.md`.
- Testes: `server/maquete-3d.test.ts` (21) e `server/maquete-3d-visualizador.test.ts` (17). Suíte completa: 1782
  passam, 1 falha pré-existente. `pnpm check` e `vite build` sem erros.
- Conferido em navegador automatizado: escada em L com patamar, carro na garagem, modo Aprimorar ligado sem erros,
  loteamento com relevo e três casas assentadas no terreno.
- Não conferido em navegador: a tela de posicionar casas (editor), o portal do cliente com o novo fluxo e a foto em alta.
- O e-mail depende do SMTP já configurado no sistema; nenhum e-mail real foi enviado nos testes.

## EPIC-024 S-04 (16/11) — muro de divisa do condomínio
Story: `docs/stories/epics/epic-024-correcoes-16-11/S-04-muro-condominio.md`. Branch local `epic024-s04` (sem push).
- Feito: `shared/maquete-3d/muro.ts` (geometria pura, portão automático), `implantacao.muro`/`implantacao.acessos`
  opcionais em `modelo.ts` (sem migração), regras do tipo em `aplicarTipo`/`implantacaoDoEstudo`, visualizador
  `visualizador/Muro.tsx`, edição `EditorMuro.tsx` na revisão da planta.
- Testes: (a) `server/maquete-3d-muro.test.ts` 13 passam; `npx vitest run server/maquete-3d` 135 passam; `tsc` e
  `vite build` sem erros. (b) Playwright + SwiftShader num harness com estudo de massa real e relevo: vista de cima,
  perspectiva, portão por dentro e por fora, contorno côncavo. (c) Pendente: estudo real em produção, aparelho real,
  tela de edição aberta por uma pessoa.
- Próximo passo: revisão (@qa), push/PR (@devops), conferir com um condomínio real e ajustar o portão se o acesso
  principal escolhido não for o que o dono espera.
- QA loop 1 (16/11): gate CONCERNS corrigido — muro em todas as áreas do KML (`terrenosExtras`), link publicado antes
  do muro fica igual até nova publicação, portão em toda rua que chega à divisa (portaria + secundários), muro preso
  ao contorno, pé seguindo a malha (fundação 0,5 m), portões reposicionados quando o contorno muda, campos que limitam
  ao sair. Commits 889e5d4, 97c256b, 5a94074, 7711e78, 9af4895. (a) 158 testes (maquete-3d + build gate) passam; tsc e
  vite build ok. (b) capturas no harness (duas áreas/duas ruas; portaria). (c) pendente: condomínio real em produção.
  Regra dos portões corrigida depois (coordenador): condomínio fechado — portão automático só nos acessos ligados
  a via pública (`viaExistente`); sem nenhum, UMA portaria na rua principal; as outras ruas que terminam na divisa
  ficam fechadas pelo muro (editor: "Abrir portão aqui"; validação: UM aviso com a contagem).
  Próximo passo: re-gate do @qa; depois push/PR (@devops).

## Concluído na etapa 4
- `shared/maquete-3d/implantacao.ts`: implantação a partir do terreno e do cenário escolhido do estudo de massa.
- `maquete3d.implantacaoDoEstudo` e situação das unidades no detalhe e no link público (`server/maquete-3d/router.ts`).
- Visualizador: `Implantacao.tsx` (terreno, ruas, lotes por situação, construções), modo "Implantação" e seleção de lote.
- Aba "Maquete 3D" no estudo (`client/src/components/incorporacao/estudo/maquete-3d-tab.tsx`).

## Concluído nas etapas 2 e 3
- Geometria do visualizador e rota do tour: `shared/maquete-3d/geometria3d.ts`.
- Motor de mobília (regras por função do cômodo): `shared/maquete-3d/mobilia.ts`.
- Visualizador: `client/src/components/maquete-3d/visualizador/` — casa, mobília paramétrica (`moveis/`, 34 peças),
  materiais e texturas por código nos três estilos, céu/horário, caminhada com colisão e escadas, tour, trilha sonora.
- Link público `/maquete/<token>` (`client/src/pages/MaquetePublica.tsx`), prévia do admin em `/admin/maquete-3d/:id/3d`,
  dados comerciais, publicar / tirar do ar.
- Venda: `server/maquete-3d/venda.ts` (portal), liquidação em `server/payment-settlement.ts`, tela
  `client/src/components/maquete-3d/PortalMaquete.tsx` (menu "Maquete 3D" do portal do cliente).
- `vite.config.ts`: o plugin que grava `data-loc` foi excluído da pasta do visualizador (quebrava a cena 3D).

## Pendências
- **Validar o motor de leitura com PDFs reais** (precisão e tempo por passo). Nunca rodou contra a API real.
- **Validar o visualizador em aparelhos reais** (celular Android/iPhone, notebook): aqui só rodou em navegador
  automatizado sem placa de vídeo, onde fica lento. Ajustar qualidade padrão conforme o resultado.
- **Um pagamento real pelo portal** (PIX) para confirmar o webhook do Asaas liberando o pedido.
- O realismo da mobília é o de um bom configurador web, não de render de estúdio; refinar peça a peça com retorno do dono.
- Escadas em L/U/caracol desenhadas como lance reto; garagem sem carro; envio automático por WhatsApp não feito;
  estorno é manual no Asaas; a faixa de preço é declarada pelo cliente.
- `vercel.json` mantém `maxDuration: 60` (ver etapa 1).
- Falha **pré-existente**, sem relação: `server/central-vendas-envio.test.ts > sequências > sem resposta e reativação 30/60/90 dias`.

## Testes
- (a) Automáticos: `server/maquete-3d.test.ts` (19) e `server/maquete-3d-visualizador.test.ts` (12) passam: paredes
  recortadas, colisão, escadas, cobertura, rota do tour, mobília sem sobreposição e sem tapar portas, publicação e link
  público, venda pelo portal com cobrança simulada, webhook idempotente, chargeback, implantação montada do estudo com a
  situação das unidades (21 + 12 testes). Suíte completa: 1777 passam, 1 falha pré-existente. `pnpm check` e `vite build` sem erros.
- (b) Manuais (navegador automatizado, router real, banco em memória): tela de apresentação, visão por fora, ocultar
  telhado, vista de cima por andar, por dentro, troca dos três estilos, manhã/pôr do sol/noite, tour com legenda.
  Foi assim que apareceu (e foi corrigido) o erro do `data-loc` ao trocar de estilo. Etapa 4: loteamento de exemplo com
  48 lotes — legenda com contagem por situação, vista de cima, seleção de lote, casa modelo no terreno.
- (c) Pendentes de validação em produção: leitura de PDF real; visualizador em celular real; pagamento real;
  tela do portal com um cliente de verdade e aba "Maquete 3D" do estudo (não foram abertas em navegador);
  implantação de um estudo real (KML e estudo de massa de verdade).

## Próximo passo exato (validação com dados reais — depende do dono)
1. Rodar um projeto real de casa pelo módulo: pedir, liberar, **ler o PDF** e revisar. Ajustar os pedidos à IA em
   `server/maquete-3d/leitura.ts` (constantes `PEDIDO_*`) conforme o que a leitura errar, e o esforço da IA se algum
   passo passar de 60 s.
2. Abrir a maquete publicada num celular e num notebook reais; ajustar a qualidade padrão em
   `Visualizador.tsx` (`QUALIDADES`) e refinar os móveis que o dono apontar (`visualizador/moveis/`).
3. Fazer um pedido real pelo portal do cliente com PIX e confirmar a liberação automática.
4. Num estudo real de loteamento: pedir na aba "Maquete 3D", autorizar, "Montar a implantação a partir do estudo", publicar.
5. Depois disso, as limitações listadas nas stories S-05, S-06 e S-07 (itens desmarcados) são a fila de melhorias.
