// Maquete 3D (EPIC-022, S-04) — desenha uma página do PDF original como imagem, para ficar ao fundo da planta na
// revisão. O arquivo vem do servidor em partes de 2 MiB; a biblioteca de PDF só é carregada quando necessário.
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

export type FundoPdf = { url: string; largura: number; altura: number };
type Estado = { fundo: FundoPdf | null; carregando: boolean; erro: string | null };

const arquivos = new Map<string, Promise<Uint8Array>>();
const LADO_MAXIMO = 2400; // pixels do maior lado da imagem gerada

export function useFundoPdf(maqueteId: number, prancha: { doc: number; pagina: number } | null, ativo: boolean): Estado {
  const utils = trpc.useUtils();
  const [estado, setEstado] = useState<Estado>({ fundo: null, carregando: false, erro: null });
  const doc = prancha?.doc, pagina = prancha?.pagina;

  useEffect(() => {
    if (!ativo || doc === undefined || pagina === undefined) { setEstado({ fundo: null, carregando: false, erro: null }); return; }
    let cancelado = false, url: string | null = null;
    setEstado({ fundo: null, carregando: true, erro: null });
    (async () => {
      const chave = `${maqueteId}:${doc}`;
      if (!arquivos.has(chave)) {
        arquivos.set(chave, (async () => {
          const primeira = await utils.maquete3d.pdfParte.fetch({ id: maqueteId, doc, parte: 0 });
          const partes = [primeira.base64];
          for (let i = 1; i < primeira.partes; i++) partes.push((await utils.maquete3d.pdfParte.fetch({ id: maqueteId, doc, parte: i })).base64);
          const blocos = partes.map(b => Uint8Array.from(atob(b), c => c.charCodeAt(0)));
          const dados = new Uint8Array(blocos.reduce((s, b) => s + b.length, 0));
          let pos = 0;
          for (const b of blocos) { dados.set(b, pos); pos += b.length; }
          return dados;
        })());
      }
      const dados = await arquivos.get(chave)!;
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      const pdf = await pdfjs.getDocument({ data: dados.slice() }).promise;
      const pg = await pdf.getPage(Math.min(Math.max(1, pagina), pdf.numPages));
      const base = pg.getViewport({ scale: 1 });
      const viewport = pg.getViewport({ scale: LADO_MAXIMO / Math.max(base.width, base.height) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await pg.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
      const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/png"));
      if (!blob) throw new Error("Falha ao desenhar a página.");
      url = URL.createObjectURL(blob);
      if (!cancelado) setEstado({ fundo: { url, largura: canvas.width, altura: canvas.height }, carregando: false, erro: null });
    })().catch(e => {
      arquivos.delete(`${maqueteId}:${doc}`);
      if (!cancelado) setEstado({ fundo: null, carregando: false, erro: e instanceof Error ? e.message : "Não foi possível abrir o PDF original." });
    });
    return () => { cancelado = true; if (url) URL.revokeObjectURL(url); };
  }, [maqueteId, doc, pagina, ativo, utils]);

  return estado;
}
