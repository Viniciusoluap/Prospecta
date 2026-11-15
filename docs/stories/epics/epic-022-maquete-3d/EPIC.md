# EPIC 022 — Maquete 3D

Status: em andamento (etapa 1)
Data: 14/11/2026
Paridade: **exclusivo do Prospecta** — exceção autorizada pelo dono em 14/11/2026 e registrada no `ROADMAP.md`.
Não portar ao Grupo Santa Fé sem nova ordem dele.

## Objetivo

Motor que converte o projeto recebido em PDF em uma maquete 3D decorada e navegável (o cliente anda por dentro),
no painel administrativo como **Maquete 3D**. Ligado a **Projetos** (o cliente solicita, paga e recebe depois da
validação do admin) e a **Incorporação** (prédios, condomínios e loteamentos; sem cobrança, com autorização do
admin). Origem: prompt mestre "Planta baixa para tour 3D interativo" (`PROMPT-MESTRE-14-11.md`).

## Decisões do dono (14/11/2026)

1. Preço padrão por faixa, editável pelo admin: casa térrea até 70 m² **R$ 197**; térrea de 70 a 150 m² **R$ 297**;
   acima de 150 m² ou sobrado **R$ 497**.
2. O cliente pode solicitar; ele paga e recebe a maquete depois que o admin valida.
3. Incorporação: sem cobrança, mas precisa de autorização do admin antes de gerar.
4. Escadas e vários pavimentos desde a primeira versão (não só casa térrea).
5. Prédios, condomínios e loteamentos fazem parte da estrutura desde o início.
6. Mobília profissional e realista **gerada pelo próprio motor** (paramétrica). Nenhuma compra de pacote de móveis.
7. IA de leitura: Claude (`ANTHROPIC_API_KEY`, já usada por outros módulos).

## Arquitetura (o que muda em relação ao prompt)

O prompt pede um HTML sob medida por planta. Aqui o **visualizador é construído uma vez** e cada maquete é só um
**modelo de dados** em três camadas (`shared/maquete-3d/modelo.ts`):

1. **implantação** — terreno, vias, lotes e a posição de cada construção;
2. **edificação** — pavimentos empilhados (paredes, aberturas, cômodos, escadas) e cobertura;
3. **tipologia** — a mesma edificação repetida no terreno, ou o mesmo pavimento repetido (pavimento-tipo).

Casa térrea = 1 edificação, 1 pavimento. Sobrado = pavimentos ligados por escada. Prédio = térreo + pavimento-tipo
× N. Condomínio = implantação + tipologias repetidas. Loteamento = implantação com vias e lotes.

Fluxo: pedido → pagamento (projeto) ou autorização (incorporação) → **leitura** do PDF pela IA, em passos curtos
→ **revisão** humana da planta (toda medida diz se é confirmada por cota ou estimada; pendências bloqueiam) →
validação → visualizador e link.

## Etapas

- [x] **Etapa 1 — Base e motor** (`S-01` a `S-04`)
- [ ] **Etapa 2 — Visualizador da casa**: vários níveis com escada, motor de mobília paramétrica nos três estilos
  (Moderno, Escandinavo, Luxo aconchegante), iluminação por horário, tour automático com som, tela comercial,
  link público `/maquete/<token>`.
- [ ] **Etapa 3 — Venda ao cliente**: solicitação no portal, cobrança pelo Asaas (novo propósito em
  `payment_orders`), liberação automática pelo webhook, entrega do link no portal e por WhatsApp.
- [ ] **Etapa 4 — Incorporação**: aba Maquete 3D no estudo, implantação a partir do KML/topografia já salvos,
  condomínio, prédio (volume + apartamento-tipo) e loteamento, unidades coloridas pela situação de venda.

## Stories da etapa 1

- [x] `S-01-modelo-e-regras.md`
- [x] `S-02-banco-e-router.md`
- [x] `S-03-motor-de-leitura.md`
- [x] `S-04-painel-e-revisao.md`

## Critérios de entrega

Uma etapa só é marcada depois de código, testes, HANDOFF atualizado e push confirmado. Leitura com IA simulada em
teste não equivale a validação com um PDF real em produção: essa validação fica registrada como pendente no HANDOFF.
Migração em banco real, merge e deploy: só com autorização do dono.
