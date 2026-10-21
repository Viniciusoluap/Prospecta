import { mutarComProgresso } from "./envio-progresso";

export const LIMITE_DOCUMENTO = 20 * 1024 * 1024;
const PARTE = 1024 * 1024;

export async function enviarPartes(file: File, scope: string): Promise<string> {
  if (!file.size || file.size > LIMITE_DOCUMENTO) throw new Error("Envie um arquivo de até 20 MiB.");
  const uploadId = crypto.randomUUID();
  const total = Math.ceil(file.size / PARTE);
  for (let part = 0; part < total; part++) {
    const slice = file.slice(part * PARTE, (part + 1) * PARTE);
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Falha ao ler o arquivo"));
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.readAsDataURL(slice);
    });
    await mutarComProgresso("documentChunks.part", { uploadId, part, total, scope, fileName: file.name, base64 }, { item: `parte ${part + 1}/${total}` });
  }
  return uploadId;
}

export async function baixarPartes(
  ler: (offset: number) => Promise<{ base64: string; total: number; fileName: string; mimeType?: string }>,
  fallback: string,
) {
  const partes: Uint8Array[] = [];
  let offset = 0;
  let nome = fallback;
  let mime = "application/octet-stream";
  let total = 0;
  do {
    const response = await ler(offset);
    total = response.total;
    nome = response.fileName || fallback;
    mime = response.mimeType || mime;
    const bytes = Uint8Array.from(atob(response.base64), char => char.charCodeAt(0));
    if (!bytes.length || offset + bytes.length > total || total > LIMITE_DOCUMENTO) throw new Error("Arquivo incompleto");
    partes.push(bytes);
    offset += bytes.length;
  } while (offset < total);
  const url = URL.createObjectURL(new Blob(partes as BlobPart[], { type: mime }));
  const link = document.createElement("a");
  link.href = url; link.download = nome; document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
