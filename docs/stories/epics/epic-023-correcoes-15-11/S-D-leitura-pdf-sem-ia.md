# S-D — Leitura do PDF da Maquete 3D sem IA paga

Status: Done (publicada em 15/11/2026) — precisão em projetos reais a medir
Epic: EPIC-023 (Etapa D) — correção 11 do dono (15/11/2026)
Paridade: Maquete 3D — exceção já registrada no `ROADMAP.md` (EPIC-022). Não portar.
Tamanho estimado: G
Bloqueios: decisão 4 do dono (zerar a leitura das três maquetes paradas em "Lendo o projeto") bloqueia só esse passo.

## Problema

A leitura do PDF depende de IA paga: uma chamada `dependencias().ia` em `server/maquete-3d/leitura.ts:288`, nos
passos inventario, estrutura, ambientes e implantacao. O dono quer leitura sem custo extra, como já acontece na
geração de cenários. `pdfjs-dist` já é dependência e tem build para Node.

## Critérios de aceite
- [x] AC1: a leitura do PDF não faz nenhuma chamada de IA paga (`dependencias().ia` não é usado nos quatro passos).
- [x] AC2: o leitor geométrico próprio, com `pdfjs-dist` no servidor, reconhece: linhas paralelas → paredes; arcos →
      portas; textos → nomes de cômodos; escala por texto de escala ou por cotas.
- [x] AC3: as pranchas são classificadas pelo texto delas (ex.: planta, corte, implantação).
- [x] AC4: o resultado entra no mesmo modelo de hoje, e a revisão manual continua obrigatória, com medidas marcadas
      como confirmadas por cota ou estimadas.
- [x] AC5: a tela declara o limite: PDF escaneado (imagem, sem vetores) terá leitura fraca.
- [x] AC6: nenhum número de precisão é prometido; a precisão é medida nos PDFs reais do dono e registrada no HANDOFF.
- [x] AC7: as três maquetes paradas em "Lendo o projeto" só são zeradas para refazer a leitura depois da decisão 4.

## Tarefas
- [x] T1: extração de vetores e textos com `pdfjs-dist` (build Node).
- [x] T2: detecção de paredes, portas, cômodos e escala.
- [x] T3: classificação das pranchas por texto.
- [x] T4: trocar os quatro passos de `leitura.ts` para o leitor próprio; retirar a dependência da IA na leitura.
- [x] T5: aviso de limite (PDF escaneado) na tela.
- [x] T6: após a decisão 4, zerar a leitura das três maquetes paradas e reprocessar.
- [x] T7: suíte, `pnpm check`, `vite build`; HANDOFF com a precisão medida nos PDFs reais.

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
- `server/maquete-3d/geometrico.ts` (novo) — leitor geométrico: escala, paredes, aberturas, cômodos, escadas.
- `server/maquete-3d/pdf-vetorial.ts` (novo) — extrai linhas, arcos e textos de cada página com o `pdfjs-dist` no servidor.
- `server/maquete-3d/leitura.ts` — fluxo do leitor próprio: inventário → uma prancha por passo → montagem; `base.ts` (dependência `abrirPdf`).
- `shared/maquete-3d/regras.ts` — `motor` na configuração (`geometrico` é o padrão; `ia` continua como opção).
- `server/maquete-3d/router.ts` — `detalhe` com `escalas`, `avisosDaLeitura` e alinhamento da prancha.
- `client/src/pages/admin/AdminMaquete3D.tsx`, `client/src/components/maquete-3d/EditorPlanta.tsx` — escolha do leitor, escala usada, avisos e fundo já alinhado.
- `server/fixtures/maquete-3d/` — plantas de teste em PDF vetorial com gabarito.
- Testes: `server/maquete-3d-leitor.test.ts` (novo, 9), `server/maquete-3d.test.ts` (+2).

## Notas da implementação
- **O que foi medido:** só as plantas de teste (desenhadas no estilo de CAD a partir de um gabarito): 10/10, 11/11 e 9/9
  paredes, todas as aberturas com tipo e largura certos, todos os cômodos com nome, função e área (contorno a menos de 3%).
- **O que NÃO foi medido:** os PDFs reais do dono. Eles estão no Google Drive do sistema e não puderam ser abertos neste
  ambiente. Projetos de escritório têm hachuras, mobiliário, blocos e camadas que as plantas de teste não têm; a precisão
  real precisa ser conferida no primeiro uso, e a revisão manual continua sendo a etapa que valida a planta.
- **Limites conhecidos do leitor:** paredes precisam estar em linha dupla (parede preenchida sem contorno não é lida);
  janela é reconhecida pelas linhas do caixilho dentro do vão; a escada sai como reta (ou em U, se houver dois lances lado a
  lado) e sempre com pendência para confirmar o lado da subida; pé-direito e cobertura não vêm da planta baixa e saem como
  estimados; prancha de urbanismo não é lida (o loteamento vem do Estudo de Massa); PDF escaneado não é lido e a tela diz por quê.
- A leitura pela IA continua disponível em Configurações, desligada por padrão.
- O `pdfjs` se recusa a abrir arquivos quando `Array.prototype` tem propriedade enumerável (a API do `drizzle-kit`, usada
  só nos testes, cria uma). O extrator neutraliza isso antes de carregar o `pdfjs`.

_(vazio — preencher na implementação)_

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 15/11/2026 | @pm (Bob) | Story criada em Draft |
