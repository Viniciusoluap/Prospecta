# HANDOFF — Maquete 3D (EPIC-022) — 14/11/2026

Branch: `claude/motor-maquetes-3d-hwqvkz`. Exclusivo do Prospecta (exceção de paridade autorizada pelo dono em
14/11/2026 e registrada em `docs/stories/epics/ROADMAP.md`). **Regra do dono (15/11/2026, em `CLAUDE.md`): seguir até o fim das quatro etapas, aplicando as migrações
aditivas e publicando (merge + deploy) ao fim de cada etapa, sem pedir confirmação.**

## Leia primeiro
- `docs/stories/epics/epic-022-maquete-3d/EPIC.md` — decisões do dono, arquitetura e as 4 etapas.
- `docs/stories/epics/epic-022-maquete-3d/PROMPT-MESTRE-14-11.md` — o que o prompt pede e em que etapa entra.

## Situação em 15/11/2026
- **Etapa 1 (base, motor de leitura, revisão): publicada.** PR #218 na `main`, migração 0111 aplicada no Neon
  (projeto `SiteProspecta`, `plain-cake-26372935`), deploy de produção da Vercel `READY`.
- **Etapa 2 (visualizador 3D) e etapa 3 (venda pelo portal/Asaas): concluídas neste PR**, migrações 0112 e 0113.
- **Etapa 4 (Incorporação): a fazer** — ver "Próximo passo exato".

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
  público, venda pelo portal com cobrança simulada, webhook idempotente, chargeback. Suíte completa: 1775 passam, 1 falha
  pré-existente. `pnpm check` e `vite build` sem erros.
- (b) Manuais (navegador automatizado, router real, banco em memória): tela de apresentação, visão por fora, ocultar
  telhado, vista de cima por andar, por dentro, troca dos três estilos, manhã/pôr do sol/noite, tour com legenda.
  Foi assim que apareceu (e foi corrigido) o erro do `data-loc` ao trocar de estilo.
- (c) Pendentes de validação em produção: leitura de PDF real; visualizador em celular real; pagamento real;
  tela do portal com um cliente de verdade (não foi aberta em navegador).

## Próximo passo exato (etapa 4 — Incorporação)
1. Aba "Maquete 3D" no estudo (`client/src/components/incorporacao/estudo/`, registrar em `AdminIncorporacaoDetail.tsx`):
   pedir (nasce "aguardando autorização"), ver situação e abrir a maquete. O router já aceita `origem: "incorporacao"`.
2. Implantação a partir do que o estudo já tem (KML/geojson e lotes do parcelamento) em vez de depender só do PDF:
   preencher `modelo.implantacao` (terreno, vias, lotes com `unidade` = `incorporation_units.code`).
3. Visualizador: desenhar a implantação (terreno, vias, lotes coloridos pela situação da unidade, construções
   repetidas por `posicoes`) e entrar numa unidade para andar por dentro; prédio = pavimento-tipo empilhado (já funciona).
4. Editar a implantação na revisão (`EditorPlanta.tsx`, hoje só mostra).
