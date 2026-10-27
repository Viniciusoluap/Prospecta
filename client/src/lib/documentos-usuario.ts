// Lote 2, correção 04: leitura dos documentos do usuário em partes de 1 MB (limite de
// resposta da Vercel), para visualizar, baixar o original e montar o ZIP no navegador.
import { LIMITE_DOCUMENTO_USUARIO_BYTES, montarZipDocumentos, nomeZipDocumentos, podeVisualizarNoNavegador } from "@shared/engenheiro";

export async function lerDocumentoUsuario(userId: number, docId: number): Promise<Uint8Array> {
  const partes: Uint8Array[] = [];
  let offset = 0;
  let total = 0;
  do {
    const r = await fetch(`/api/usuarios/${userId}/documentos/${docId}?offset=${offset}`, { credentials: "include", cache: "no-store" });
    if (!r.ok) {
      const corpo = await r.json().catch(() => null) as { error?: string } | null;
      throw new Error(corpo?.error || "Não foi possível ler o documento.");
    }
    total = Number(r.headers.get("X-Document-Size"));
    if (!Number.isSafeInteger(total) || total < 1 || total > LIMITE_DOCUMENTO_USUARIO_BYTES) throw new Error("Documento inválido.");
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (!bytes.length || offset + bytes.length > total) throw new Error("Documento incompleto. Tente novamente.");
    partes.push(bytes);
    offset += bytes.length;
  } while (offset < total);
  const tudo = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) { tudo.set(p, pos); pos += p.length; }
  return tudo;
}

function salvar(bytes: Uint8Array, nome: string, mime: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const link = document.createElement("a");
  link.href = url; link.download = nome; document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function baixarDocumentoUsuario(userId: number, doc: { id: number; nome: string; mime: string }) {
  salvar(await lerDocumentoUsuario(userId, doc.id), doc.nome, doc.mime);
}

/** Abre PDF/imagem numa nova aba. A aba é aberta antes da leitura (bloqueio de pop-up). */
export async function visualizarDocumentoUsuario(userId: number, doc: { id: number; nome: string; mime: string }) {
  if (!podeVisualizarNoNavegador(doc.mime)) return baixarDocumentoUsuario(userId, doc);
  const aba = window.open("", "_blank");
  try {
    const bytes = await lerDocumentoUsuario(userId, doc.id);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: doc.mime }));
    if (aba) aba.location.href = url; else window.open(url, "_blank", "noopener");
    window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  } catch (e) {
    aba?.close();
    throw e;
  }
}

export async function baixarTodosDocumentosUsuario(userId: number, nomeUsuario: string | null, docs: { id: number; nome: string; categoria: string }[]) {
  const arquivos = [];
  for (const d of docs) arquivos.push({ nome: d.nome, categoria: d.categoria, bytes: await lerDocumentoUsuario(userId, d.id) });
  salvar(montarZipDocumentos(arquivos), nomeZipDocumentos(nomeUsuario), "application/zip");
}
