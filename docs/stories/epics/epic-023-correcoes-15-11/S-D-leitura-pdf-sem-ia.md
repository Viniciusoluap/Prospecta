# S-D — Leitura do PDF da Maquete 3D sem IA paga

Status: Draft
Epic: EPIC-023 (Etapa D) — correção 11 do dono (15/11/2026)
Paridade: Maquete 3D — exceção já registrada no `ROADMAP.md` (EPIC-022). Não portar.
Tamanho estimado: G
Bloqueios: decisão 4 do dono (zerar a leitura das três maquetes paradas em "Lendo o projeto") bloqueia só esse passo.

## Problema

A leitura do PDF depende de IA paga: uma chamada `dependencias().ia` em `server/maquete-3d/leitura.ts:288`, nos
passos inventario, estrutura, ambientes e implantacao. O dono quer leitura sem custo extra, como já acontece na
geração de cenários. `pdfjs-dist` já é dependência e tem build para Node.

## Critérios de aceite
- [ ] AC1: a leitura do PDF não faz nenhuma chamada de IA paga (`dependencias().ia` não é usado nos quatro passos).
- [ ] AC2: o leitor geométrico próprio, com `pdfjs-dist` no servidor, reconhece: linhas paralelas → paredes; arcos →
      portas; textos → nomes de cômodos; escala por texto de escala ou por cotas.
- [ ] AC3: as pranchas são classificadas pelo texto delas (ex.: planta, corte, implantação).
- [ ] AC4: o resultado entra no mesmo modelo de hoje, e a revisão manual continua obrigatória, com medidas marcadas
      como confirmadas por cota ou estimadas.
- [ ] AC5: a tela declara o limite: PDF escaneado (imagem, sem vetores) terá leitura fraca.
- [ ] AC6: nenhum número de precisão é prometido; a precisão é medida nos PDFs reais do dono e registrada no HANDOFF.
- [ ] AC7: as três maquetes paradas em "Lendo o projeto" só são zeradas para refazer a leitura depois da decisão 4.

## Tarefas
- [ ] T1: extração de vetores e textos com `pdfjs-dist` (build Node).
- [ ] T2: detecção de paredes, portas, cômodos e escala.
- [ ] T3: classificação das pranchas por texto.
- [ ] T4: trocar os quatro passos de `leitura.ts` para o leitor próprio; retirar a dependência da IA na leitura.
- [ ] T5: aviso de limite (PDF escaneado) na tela.
- [ ] T6: após a decisão 4, zerar a leitura das três maquetes paradas e reprocessar.
- [ ] T7: suíte, `pnpm check`, `vite build`; HANDOFF com a precisão medida nos PDFs reais.

## Arquivos principais
- `server/maquete-3d/leitura.ts` e novo leitor geométrico em `server/maquete-3d/`
- `shared/maquete-3d/modelo.ts`
- `client/src/components/maquete-3d/EditorPlanta.tsx` (aviso de limite)

## Testes previstos
- Automáticos: PDFs vetoriais de teste com paredes, portas, textos e escala conhecidos; teste que garante que a IA
  não é chamada na leitura; PDF só com imagem gera leitura fraca com aviso.
- Manuais: leitura dos PDFs reais do dono e revisão no editor.
- Pendente em produção: reprocessar as três maquetes paradas (após decisão 4).

## Riscos
- Leitura pior que a atual em plantas complexas → revisão manual continua; precisão medida e registrada.
- PDFs escaneados → limite declarado.

## File List
_(vazio — preencher na implementação)_

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 15/11/2026 | @pm (Bob) | Story criada em Draft |
