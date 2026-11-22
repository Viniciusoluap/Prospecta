/** Capture a referência antes de qualquer await: SyntheticEvent.currentTarget é limpo pelo React. */
export async function anexarPdfDoFormulario(form: HTMLFormElement, salvar: (data: { name: string; type: "anexo" | "assinado" | "contrato_gerado"; base64: string }) => Promise<unknown>) {
  const data = new FormData(form), file = data.get("file");
  if (!(file instanceof File) || !file.size) throw new Error("Selecione um PDF.");
  if (file.size > 3 * 1024 * 1024) throw new Error("Envie um PDF de até 3 MiB.");
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("Não foi possível ler o PDF.")); reader.readAsDataURL(file);
  });
  await salvar({ name: file.name, type: String(data.get("type")) as "anexo" | "assinado" | "contrato_gerado", base64 });
  form.reset();
}
export function bytesBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + 8192)));
  return btoa(binary);
}
