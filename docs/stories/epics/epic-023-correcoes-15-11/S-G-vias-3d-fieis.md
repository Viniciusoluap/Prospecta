# S-G — Vias do 3D com representação fiel

Status: Draft
Epic: EPIC-023 (Etapa G) — correção 13 do dono (15/11/2026)
Paridade: Maquete 3D — exceção já registrada no `ROADMAP.md` (EPIC-022). Não portar.
Tamanho estimado: G
Dependência: S-F (as vias vêm da malha viária gerada pelo motor do Estudo de Massa).

## Problema

No 3D, as ruas são só tinta em canvas (`client/src/components/maquete-3d/visualizador/Implantacao.tsx:86-108`) e
`imp.vias` nem é desenhado. O dono quer representação fiel: faixas pintadas, meio-fio, sarjeta, calçada,
arborização, postes e semáforos onde necessário.

## Critérios de aceite
- [ ] AC1: `imp.vias` é desenhado em 3D, com geometria própria (não só pintura no terreno).
- [ ] AC2: cada via tem faixas pintadas, meio-fio, sarjeta e calçada.
- [ ] AC3: há arborização e postes ao longo das vias.
- [ ] AC4: semáforos aparecem só onde necessário (cruzamentos), com regra de posicionamento documentada no código e
      coberta por teste.
- [ ] AC5: tudo gerado pelo motor, sem pacotes comprados.
- [ ] AC6: as vias e os elementos seguem o relevo da implantação (topografia de S-08 do EPIC-022).
- [ ] AC7: desempenho aceitável em iPad e celular (repetição leve/instancing para árvores, postes e semáforos).

## Tarefas
- [ ] T1: geometria da via (pista, sarjeta, meio-fio, calçada) a partir de `imp.vias`, apoiada no relevo.
- [ ] T2: faixas pintadas.
- [ ] T3: árvores e postes gerados por código, com instancing.
- [ ] T4: regra de semáforo por cruzamento.
- [ ] T5: retirar a pintura de ruas no canvas quando substituída.
- [ ] T6: suíte, `pnpm check`, `vite build`; HANDOFF.

## Arquivos principais
- `client/src/components/maquete-3d/visualizador/Implantacao.tsx` e novos componentes em
  `client/src/components/maquete-3d/visualizador/`
- `shared/maquete-3d/implantacao.ts`, `shared/maquete-3d/geometria3d.ts`

## Testes previstos
- Automáticos (`server/maquete-3d-visualizador.test.ts`): geometria da via gerada para cada trecho; semáforo só em
  cruzamento; elementos assentados na cota do relevo.
- Manuais: loteamento com relevo no navegador; fluidez em iPad e celular.
- Pendente em produção: implantação de estudo real.

## Riscos
- Queda de desempenho em aparelho fraco → instancing e conferência em aparelho real.
- Depende de S-F: sem malha conectada, as vias desenhadas herdam os defeitos atuais.

## File List
_(vazio — preencher na implementação)_

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 15/11/2026 | @pm (Bob) | Story criada em Draft |
