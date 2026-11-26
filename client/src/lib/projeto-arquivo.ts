// EPIC-031 S-1: baixa o arquivo do projeto em partes de 1 MB (limite de resposta da
// Vercel) e salva com o NOME PADRÃO devolvido pelo servidor (X-Document-Name).
import { PROJECT_UPLOAD_LIMIT } from "@shared/projeto-documentos";

export async function baixarArquivoProjeto(projectId: number, documentId: number, nomeNaTela: string) {
  const partes: Uint8Array[] = [];
  let offset = 0;
  let total = 0;
  let nome = nomeNaTela;
  let mime = "application/octet-stream";
  do {
    const r = await fetch(`/api/projetos/${projectId}/documentos/${documentId}/arquivo?offset=${offset}`, { credentials: "include", cache: "no-store" });
    if (!r.ok) {
      const corpo = await r.json().catch(() => null) as { error?: string } | null;
      throw new Error(corpo?.error || "Não foi possível baixar o arquivo.");
    }
    total = Number(r.headers.get("X-Document-Size"));
    if (!Number.isSafeInteger(total) || total < 1 || total > PROJECT_UPLOAD_LIMIT) throw new Error("Arquivo inválido.");
    nome = r.headers.get("X-Document-Name") || nome;
    mime = r.headers.get("X-Document-Mime") || mime;
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (!bytes.length || offset + bytes.length > total) throw new Error("Arquivo incompleto. Tente novamente.");
    partes.push(bytes);
    offset += bytes.length;
  } while (offset < total);
  const url = URL.createObjectURL(new Blob(partes as BlobPart[], { type: mime }));
  const link = document.createElement("a");
  link.href = url; link.download = nome; document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
