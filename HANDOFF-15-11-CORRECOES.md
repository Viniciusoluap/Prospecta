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

## Pendências
- Etapas B (mapa operacional), C (vínculo com lead, PDF avulso, casa/prédio padrão), D (leitura sem IA),
  E (camadas do terreno), F (Estudo de Massa: áreas separadas e malha conectada), G (vias 3D).
- Porte para o Grupo Santa Fé das correções 1, 2, 3, 4, 8, 9 e 10 (lista no ROADMAP) — sem acesso àquele repositório.

## Testes
- (a) Automáticos: `tsc --noEmit` sem erros; suíte completa com 1.783 aprovados e 1 falha antiga e sem relação
  (`server/central-vendas-envio.test.ts > sem resposta e reativação 30/60/90 dias`, falha também na `main`).
- (b) Manuais: nenhum — o layout do CRM não foi conferido em navegador nem em iPad nesta sessão.
- (c) Pendentes em produção: CRM no iPad (rolagem e ausência de tela preta); editar um corretor em "Usuários e acesso"
  e conferir a comissão numa obra; excluir um pedido de maquete pela lista.

## Próximo passo exato
Iniciar a Etapa B (`S-B-mapa-operacional-maplibre.md`): mover `mapa-base-ml.ts` para `client/src/lib/`, liberar a rota
do token para o módulo `mapa` e reescrever `AdminMapa.tsx` em MapLibre mantendo agrupamento, busca, filtro, legenda e tabela.
