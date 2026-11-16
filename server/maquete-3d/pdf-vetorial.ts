// Maquete 3D (EPIC-023, S-D): tira de uma página de PDF vetorial as linhas, os arcos e os textos, já na posição
// em que aparecem na página (pontos, y para baixo). É a entrada do leitor geométrico (geometrico.ts). Usa o
// pdfjs-dist no servidor, sem desenhar nada (não precisa de canvas).
import type { Arco, Primitivas, Segmento, Texto } from "./geometrico.js";

type Matriz = [number, number, number, number, number, number];
const mult = (m: Matriz, n: Matriz): Matriz => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const aplicar = (m: Matriz, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Limites para uma prancha muito carregada não estourar o tempo nem a memória da função. */
export const MAX_SEGMENTOS = 250_000;
export const MAX_PAGINAS = 30;

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let carregado: Promise<PdfJs> | null = null;
async function pdfjs(): Promise<PdfJs> {
  carregado ??= (async () => {
    // O pdfjs se recusa a abrir qualquer arquivo se alguma biblioteca tiver deixado uma propriedade visível em
    // Array.prototype (a API do drizzle-kit, usada nos testes, cria `random`). A propriedade continua existindo;
    // só deixa de aparecer em `for...in`, que é o comportamento correto para um método de lista.
    for (const chave in []) {
      const d = Object.getOwnPropertyDescriptor(Array.prototype, chave);
      if (d?.configurable) Object.defineProperty(Array.prototype, chave, { ...d, enumerable: false });
    }
    const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // No servidor o pdfjs roda sem thread separada: o módulo do "worker" é entregue pronto, com importação
    // estática (é ela que garante o arquivo no pacote da função).
    // @ts-expect-error o pacote não publica tipos para o módulo do worker
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return lib;
  })();
  return carregado;
}

export type PdfAberto = { paginas: number; pagina: (numero: number) => Promise<Primitivas>; fechar: () => Promise<void> };

export async function abrirPdf(dados: Buffer): Promise<PdfAberto> {
  const lib = await pdfjs();
  const tarefa = lib.getDocument({ data: new Uint8Array(dados), useSystemFonts: true, disableFontFace: true, verbosity: 0 });
  const doc = await tarefa.promise;
  const O = lib.OPS;
  const desenham = new Set<number>([O.stroke, O.closeStroke, O.fill, O.eoFill, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke]);
  return {
    paginas: doc.numPages,
    fechar: async () => { await tarefa.destroy(); },
    pagina: async numero => {
      const pg = await doc.getPage(numero);
      const vista = pg.getViewport({ scale: 1 }), base = vista.transform as Matriz;
      const segmentos: Segmento[] = [], arcos: Arco[] = [];
      let imagens = 0;
      const linha = (m: Matriz, x1: number, y1: number, x2: number, y2: number) => {
        if (segmentos.length >= MAX_SEGMENTOS) return;
        const [a, b] = aplicar(m, x1, y1), [c, d] = aplicar(m, x2, y2);
        if (Math.hypot(c - a, d - b) > 0.2) segmentos.push({ x1: a, y1: b, x2: c, y2: d });
      };
      /** Curva de Bézier: se for um arco de círculo (folha de porta), guarda centro e raio; senão, vira segmentos. */
      const curva = (m: Matriz, p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number]) => {
        const em = (t: number): [number, number] => {
          const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
          return aplicar(m, a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]);
        };
        const [a, b, c] = [em(0), em(0.5), em(1)];
        const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
        if (Math.abs(d) > 1e-6) {
          const cx = ((a[0] ** 2 + a[1] ** 2) * (b[1] - c[1]) + (b[0] ** 2 + b[1] ** 2) * (c[1] - a[1]) + (c[0] ** 2 + c[1] ** 2) * (a[1] - b[1])) / d;
          const cy = ((a[0] ** 2 + a[1] ** 2) * (c[0] - b[0]) + (b[0] ** 2 + b[1] ** 2) * (a[0] - c[0]) + (c[0] ** 2 + c[1] ** 2) * (b[0] - a[0])) / d;
          const r = Math.hypot(a[0] - cx, a[1] - cy);
          const noCirculo = [0.25, 0.75].every(t => { const q = em(t); return Math.abs(Math.hypot(q[0] - cx, q[1] - cy) - r) < r * 0.03; });
          if (noCirculo && r > 3 && r < 2000) { if (arcos.length < 20000) arcos.push({ cx, cy, r, pontas: [{ x: a[0], y: a[1] }, { x: c[0], y: c[1] }] }); return; }
        }
        let ant = a;
        for (let i = 1; i <= 6; i++) { const q = em(i / 6); if (segmentos.length < MAX_SEGMENTOS) segmentos.push({ x1: ant[0], y1: ant[1], x2: q[0], y2: q[1] }); ant = q; }
      };
      const lista = await pg.getOperatorList();
      let ctm: Matriz = base;
      const pilha: Matriz[] = [];
      for (let i = 0; i < lista.fnArray.length; i++) {
        const fn = lista.fnArray[i], args = lista.argsArray[i] as unknown[];
        if (fn === O.save) pilha.push(ctm);
        else if (fn === O.restore) ctm = pilha.pop() ?? ctm;
        else if (fn === O.transform) ctm = mult(ctm, args as unknown as Matriz);
        else if (fn === O.paintFormXObjectBegin) { pilha.push(ctm); if (Array.isArray(args?.[0]) || ArrayBuffer.isView(args?.[0])) ctm = mult(ctm, Array.from(args[0] as ArrayLike<number>) as Matriz); }
        else if (fn === O.paintFormXObjectEnd) ctm = pilha.pop() ?? ctm;
        else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject || fn === O.paintImageXObjectRepeat) {
          // Imagem que cobre boa parte da página: sinal de prancha escaneada.
          const area = Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]);
          if (area > vista.width * vista.height * 0.25) imagens++;
        } else if (fn === O.constructPath) {
          if (!desenham.has(args[0] as number)) continue;
          const d = (args[1] as ArrayLike<number>[])[0];
          if (!d) continue;
          let x = 0, y = 0, x0 = 0, y0 = 0;
          for (let k = 0; k < d.length;) {
            const op = d[k++];
            if (op === 0) { x = x0 = d[k++]; y = y0 = d[k++]; }
            else if (op === 1) { const nx = d[k++], ny = d[k++]; linha(ctm, x, y, nx, ny); x = nx; y = ny; }
            else if (op === 2) { const c = [d[k++], d[k++], d[k++], d[k++], d[k++], d[k++]]; curva(ctm, [x, y], [c[0], c[1]], [c[2], c[3]], [c[4], c[5]]); x = c[4]; y = c[5]; }
            else if (op === 3) { const c = [d[k++], d[k++], d[k++], d[k++]]; curva(ctm, [x, y], [x + (2 / 3) * (c[0] - x), y + (2 / 3) * (c[1] - y)], [c[2] + (2 / 3) * (c[0] - c[2]), c[3] + (2 / 3) * (c[1] - c[3])], [c[2], c[3]]); x = c[2]; y = c[3]; }
            else if (op === 4) { linha(ctm, x, y, x0, y0); x = x0; y = y0; }
            else break;
          }
        }
      }
      const conteudo = await pg.getTextContent();
      const textos: Texto[] = [];
      for (const item of conteudo.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const t = item.transform as number[], [x, y] = aplicar(base, t[4], t[5]);
        const tam = Math.hypot(t[0], t[1]) || item.height || 1;
        textos.push({ str: item.str, x, y, tam, largura: item.width });
        if (textos.length >= 20000) break;
      }
      pg.cleanup();
      return { largura: vista.width, altura: vista.height, segmentos, arcos, textos, imagens };
    },
  };
}
