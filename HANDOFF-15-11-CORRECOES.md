# HANDOFF — EPIC-023, 13 correções pedidas pelo dono em 15/11/2026

Branch: `claude/motor-maquetes-3d-hwqvkz` (sincronizada com `main` antes deste plano).

## Leia primeiro
- `docs/stories/epics/epic-023-correcoes-15-11/EPIC.md` — pedidos, causa no código, etapas A–G, decisões pendentes,
  paridade e riscos.
- Stories (todas em Draft): `S-A-crm-usuarios-pedidos-maquete.md`, `S-B-mapa-operacional-maplibre.md`,
  `S-C-vinculo-lead-pdf-avulso-troca-tipo.md`, `S-D-leitura-pdf-sem-ia.md`, `S-E-camadas-terreno-resilientes.md`,
  `S-F-massa-multiplas-areas-malha-conectada.md`, `S-G-vias-3d-fieis.md`.
- `docs/stories/epics/ROADMAP.md` — linha do EPIC-023 e pendências de porte ao Grupo Santa Fé (correções 1, 2, 3, 4,
  8, 9, 10).

## Concluído
- **Só o plano.** Nenhum código, nenhuma migração, nenhum push.
- Commit local de documentação: `docs: EPIC-023 — 13 correções de 15/11 (plano) [EPIC-023]`.

## Pendências
- **Decisões do dono (bloqueios):**
  1. Autorizar publicação e migrações aditivas fora do EPIC-022 (etapas A, B, E, F).
  2. Colaborador que hoje acessa "Corretores" perde o acesso (Usuários e acesso é só admin) — aceitar, ou liberar a
     parte de corretores ao colaborador.
  3. Trocar a regra CHECK `maquetes_3d_origem_alvo_ck` para aceitar lead (muda regra existente, não altera dados).
  4. Zerar a leitura das três maquetes paradas em "Lendo o projeto" para o leitor novo refazer (altera dados).
- Push desta branch com o commit de documentação (fica para quem tem a autoridade de push).
- Implementação das etapas A a G (ordem: A, B, C, D, E, F, G; G depende de F).
- Porte ao Grupo Santa Fé das correções 1, 2, 3, 4, 8, 9 e 10 depois de entregues aqui.

## Testes
- (a) Automáticos: nenhum executado (só documentação).
- (b) Manuais: nenhum.
- (c) Pendentes de validação em produção: todos os critérios de aceite das sete stories.

## Próximo passo exato
1. Obter do dono as respostas das 4 decisões acima e registrá-las em `EPIC.md` (seção "Decisões pendentes").
2. Iniciar a Etapa A (`S-A-crm-usuarios-pedidos-maquete.md`): começar por T1 (layout do CRM em `AdminCRM.tsx`) e T2
   (levar as funções de Corretores para "Usuários e acesso"); a remoção da tela (T5) só depois da decisão 2.
