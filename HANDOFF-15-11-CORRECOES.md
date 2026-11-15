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

### Etapa B (correção 4) — S-B
- Mapa operacional na base nova (MapLibre, a mesma da Incorporação): alfinetes por situação, agrupamento que separa ao
  aproximar, lista para pontos no mesmo endereço, Satélite/Ruas, busca, filtro e tabela mantidos. Sem migração.

## Pendências
- Etapas C (vínculo com lead, PDF avulso, casa/prédio padrão), D (leitura sem IA),
  E (camadas do terreno), F (Estudo de Massa: áreas separadas e malha conectada), G (vias 3D).
- Porte para o Grupo Santa Fé das correções 1, 2, 3, 4, 8, 9 e 10 (lista no ROADMAP) — sem acesso àquele repositório.

## Testes
- (a) Automáticos: `tsc --noEmit` sem erros; suíte completa com 1.783 aprovados e 1 falha antiga e sem relação
  (`server/central-vendas-envio.test.ts > sem resposta e reativação 30/60/90 dias`, falha também na `main`).
- (b) Manuais: mapa operacional conferido em navegador de teste com 5 pontos fictícios e imagens de satélite
  simuladas (o ambiente não alcança os servidores de imagem): alfinetes, agrupamento, aproximação e lista do mesmo
  endereço funcionaram. O layout do CRM não foi conferido em navegador nem em iPad.
- (c) Pendentes em produção: mapa operacional com as imagens reais de satélite e os pontos reais; CRM no iPad (rolagem e ausência de tela preta); editar um corretor em "Usuários e acesso"
  e conferir a comissão numa obra; excluir um pedido de maquete pela lista.

## Próximo passo exato
Iniciar a Etapa C (`S-C-vinculo-lead-pdf-avulso-troca-tipo.md`): migração aditiva (coluna de lead, tabela de arquivos
avulsos, nova regra de vínculo), formulário de novo pedido com cliente do CRM e PDF avulso, gerador de casa/prédio
padrão e troca de tipo.
