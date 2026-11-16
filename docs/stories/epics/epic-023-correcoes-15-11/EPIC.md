# EPIC 023 — 13 correções pedidas pelo dono em 15/11/2026

Status: Planejado — aguardando autorização do dono (4 decisões pendentes, ver abaixo)
Data: 15/11/2026
Paridade: **mista**. Correções 1, 2, 3, 4, 8, 9 e 10 são de CRM, painel, mapa e Incorporação e **precisam ser
portadas ao Grupo Santa Fé** (pendências registradas no `ROADMAP.md`). Correções 5, 6, 7, 11, 12 e 13 são da
Maquete 3D, exceção de paridade já registrada no `ROADMAP.md` (EPIC-022): não portar.

## Objetivo

Entregar as 13 correções listadas pelo dono em 15/11/2026, sem perder funcionalidade nem dado existente, em sete
etapas (A a G). Cada etapa é um PR próprio, com testes, HANDOFF atualizado e publicação.

## Contexto (pedido do dono e causa no código, já conferidos)

| # | Pedido | Onde está a causa |
|---|--------|-------------------|
| 1 | CRM Pipeline no iPad: a página inteira rola/arrasta, sobram vazios, dá para deixar a tela toda preta; só os cartões dentro das colunas devem se mover | `client/src/pages/admin/AdminCRM.tsx` — raiz `min-h-screen` (:216), trilho `overflow-x-auto` sem altura (:487), colunas `w-64` (:492), lista `max-h-[600px] overflow-y-auto` sem `overscroll-contain` (:500) |
| 2 | Remover "Corretores" do painel (redundante com "Usuários e acesso") sem perder função nem lógica | `client/src/pages/admin/AdminBrokerDirectory.tsx` (rota `/admin/corretores`, tile `Admin.tsx:68`), `corretoresRouter` em `server/operacional-router.ts:286-427`, tabela `broker_profiles` |
| 3 | Filtro por tipo de usuário em "Usuários e acesso" | `client/src/pages/admin/AdminConfiguracoes.tsx:17-23` (`PERFIS`/`ROLE_LABEL`) |
| 4 | Mapa operacional (obras) com o mapa novo | `client/src/pages/admin/AdminMapa.tsx` usa Leaflet (`client/src/lib/mapa-leaflet.ts`); mapa novo MapLibre em `client/src/components/incorporacao/estudo/mapa-base-ml.ts`; token em `GET /api/incorporacao/mapa-base` (`server/routes/camadas-terreno.ts:41-51`, hoje exige módulo `incorporacao`) |
| 5 | Lista de pedidos da Maquete 3D: excluir na linha (com recusa antes, quando ainda não recusada); coluna "Criada em" cortada | `client/src/pages/admin/AdminMaquete3D.tsx:103`; servidor `recusar` (`server/maquete-3d/router.ts:224-230`) e `excluir` (:232-238) |
| 6 | Pedido "Projeto de cliente (pago)" vinculado ao projeto **ou** a um cliente do CRM (lead); PDF avulso; nome do cliente duplicado no rótulo | CHECK `maquetes_3d_origem_alvo_ck` (`drizzle/0111_maquete_3d.sql:47-50`); `fonte` dos documentos (`shared/maquete-3d/regras.ts:107-116`); `server/document-upload-chunks.ts`; `server/maquete-3d/venda.ts`; `destinatario` (`server/maquete-3d/avisos.ts:17-27`); rótulo em `AdminMaquete3D.tsx:153` |
| 7 | Pedido de Incorporação também aceita PDF avulso | mesmos arquivos da correção 6 |
| 8 | Estudo de Massa: KML com áreas separadas não pode impedir; gerar para todas | erro em `client/src/components/incorporacao/estudo/massa-tab.tsx:202-204`; `gerarEstudoMassa` (`shared/incorporacao/massa.ts:833`) recebe um único anel, furos ignorados |
| 9 | Camadas do mapa do terreno voltando "indisponível" | `server/_core/geo/camadas-terreno-busca.ts` (sem repetição, cache só em memória por 12 h, sem User-Agent em `obterJson` :27-35), `shared/geo/camadas-terreno.ts`, `mapa-terreno.tsx` |
| 10 | Cenários do Estudo de Massa: ruas sem conexão, sobras sem lote nem via, sem ligação com as ruas do mapa; nada em branco | `massa.ts:373`, `rua-simples.ts:144` (retângulo que cruza a divisa é descartado); sem conectividade (`corredoresGrade` :439-483); AV/INST/não parcelável sem geometria (`classificar` :569-587); notas em `massa.ts:426-431`; rótulos sem colisão (`planta-tecnica.ts:208-233`); vias do OSM em `normalizarOverpass` (`shared/geo/camadas-terreno.ts:355`) não usadas |
| 11 | Leitura do PDF sem IA paga | uma chamada `dependencias().ia` em `server/maquete-3d/leitura.ts:288` (passos inventario/estrutura/ambientes/implantacao); `pdfjs-dist` já é dependência |
| 12 | Trocar o tipo (loteamento/casa/prédio) redesenha a maquete com planta padrão em todos os lotes | sem mutation de troca de tipo; `validarModelo` (`shared/maquete-3d/modelo.ts:276`) exige edificação lida; `umaPorLote` (`EditorPlanta.tsx:119-132`); limite de 24 construções (`visualizador/Implantacao.tsx:41`) |
| 13 | Vias do 3D fiéis: faixas, meio-fio, sarjeta, calçada, árvores, postes, semáforos onde necessário | ruas são tinta em canvas (`visualizador/Implantacao.tsx:86-108`); `imp.vias` não é desenhado |

## Escopo

**Dentro:** as 13 correções acima, exatamente como pedidas. **Fora:** qualquer mudança não listada; estorno no
Asaas; promessa de número de precisão da leitura do PDF (correção 11).

## Etapas (ordem de execução)

| Etapa | Correções | Story | Paridade | Migração prevista |
|-------|-----------|-------|----------|-------------------|
| A | 1, 2, 3, 5 | `S-A-crm-usuarios-pedidos-maquete.md` | 1, 2, 3 portar; 5 exceção | sem migração prevista (campos de corretor já existem em `broker_profiles`) |
| B | 4 | `S-B-mapa-operacional-maplibre.md` | portar | não |
| C | 6, 7, 12 | `S-C-vinculo-lead-pdf-avulso-troca-tipo.md` | exceção (Maquete 3D) | sim — vínculo por lead e PDF avulso (depende da decisão 3) |
| D | 11 | `S-D-leitura-pdf-sem-ia.md` | exceção (Maquete 3D) | não (zerar leituras paradas depende da decisão 4) |
| E | 9 | `S-E-camadas-terreno-resilientes.md` | portar | sim — tabela nova, aditiva (último resultado bom por terreno) |
| F | 8, 10 | `S-F-massa-multiplas-areas-malha-conectada.md` | portar | não prevista |
| G | 13 | `S-G-vias-3d-fieis.md` | exceção (Maquete 3D) | não |
| H | validação de 16/11 | `S-H-validacao-com-dados-reais.md` | parte entra na lista arquivada do Santa Fé | não |

- G depende de F (as vias desenhadas no 3D vêm da malha viária gerada pelo motor do Estudo de Massa).
- F é a etapa de maior risco (motor central da Incorporação, ~124 testes atuais serão revistos).
- Cada etapa só é marcada depois de: código, testes, HANDOFF (`HANDOFF-15-11-CORRECOES.md`) atualizado, commit e push
  confirmados, PR mesclado e publicação na Vercel conferida.

- [x] Etapa A — publicada (PR #222 e #228)
- [x] Etapa B — publicada (PR #223)
- [x] Etapa C — publicada (PR #224 e #227)
- [x] Etapa D — publicada (PR #226)
- [x] Etapa E — publicada (PR #225)
- [x] Etapa F — publicada (PR #230 e #231)
- [x] Etapa G — publicada (PR #229)
- [ ] Etapa H — validação com dados reais (primeira leva publicada no PR #232; leitor de PDF e QA em andamento)
- [ ] Pendências de porte ao Grupo Santa Fé (correções 1, 2, 3, 4, 8, 9, 10) entregues lá

## Decisões pendentes do dono (bloqueios até resposta)

1. **Publicação e migrações fora do EPIC-022.** A regra permanente de 15/11 (`CLAUDE.md`) cobre só a Maquete 3D.
   Etapas A, B, E e F precisam de autorização para merge, publicação e (na E) migração aditiva. Sem resposta, essas
   etapas podem ser implementadas e testadas, mas não publicadas.
2. **Acesso de colaborador a "Corretores".** "Usuários e acesso" é só para administrador. Ao remover "Corretores",
   o colaborador que hoje acessa essa tela perde o acesso. Opções: aceitar a perda, ou liberar ao colaborador a
   parte de corretores. Bloqueia a remoção da tela na Etapa A (a migração das funções pode seguir).
3. **Regra CHECK de vínculo da maquete.** Trocar `maquetes_3d_origem_alvo_ck` para aceitar lead é mudança de regra
   existente (não altera dados), fora do que a regra de 15/11 autoriza ("novos valores de enum/CHECK" cobre adição,
   não troca). Bloqueia a correção 6 na Etapa C.
4. **Zerar a leitura das três maquetes paradas em "Lendo o projeto"** para o leitor novo refazer. Altera dados
   existentes. Bloqueia só esse passo da Etapa D; o leitor novo pode ser publicado antes.

## Riscos

| Risco | Etapa | Mitigação |
|-------|-------|-----------|
| Perder função ao remover "Corretores" (comissão padrão, observações, busca, filtro, criar sem e-mail) | A | migrar tudo para "Usuários e acesso" antes de remover; testes de paridade das funções; `default_commission_pct` continua lido por obra-financeiro-router, juridico-modelos e comissões |
| Correção de rolagem quebrar arrastar cartão entre colunas no iPad | A | `touch-action` por eixo; validação manual em iPad registrada como pendente |
| Token do mapa novo exposto a quem não tem módulo `incorporacao` | B | liberar a rota também para quem tem o módulo do mapa operacional, sem abrir para outros perfis |
| Pedido sem projeto nem lead, ou com os dois | C | CHECK "um dos dois" no banco e validação no servidor |
| Leitor geométrico fraco em PDF escaneado | D | limite declarado na tela; revisão manual continua obrigatória |
| Fontes externas (EPE, IBAMA, MapBiomas, Overpass) continuarem fora do ar | E | último resultado bom persistido com data; mensagem distingue "fonte fora do ar" de "nada no entorno" |
| Regressão no motor do Estudo de Massa e nos consumidores (planta técnica, mapa, unidades, orçamento, implantação 3D) | F | teste de soma das áreas = 100%; revisão dos ~124 testes; conferência de cada consumidor |
| Desempenho em iPad/celular com vias detalhadas e muitas construções | C, G | repetição leve (instancing); conferência em aparelho real registrada como pendente |

## Critérios de entrega

Uma etapa só é marcada depois de código, testes, HANDOFF atualizado e push confirmado. Teste automatizado ou
navegador simulado não equivale a validação em aparelho real e com dados reais: isso fica registrado como pendente
no HANDOFF.

## Change Log

| Data | Autor | Mudança |
|------|-------|---------|
| 15/11/2026 | @pm (Bob) | Epic criado com 7 stories em Draft; apenas planejamento |
