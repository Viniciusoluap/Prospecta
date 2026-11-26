export const PROJECT_UPLOAD_LIMIT = 300 * 1024 * 1024;
export const PROJECT_CHUNK_SIZE = 1024 * 1024;
export type ProjectDocumentKind = "editable" | "pdf";
export type ProjectCheck = { id?: string; type?: string; text: string; done: boolean; conclusaoManual?: boolean; pdfDone?: boolean; editableDone?: boolean };
export type ProjectDocumentPresence = { itemId: string; kind: ProjectDocumentKind };
export function projectChecklist(types: string[], current: ProjectCheck[], labels: Record<string, string>): ProjectCheck[] {
  const selected = types.filter(t => t !== "projeto_completo");
  const result = current.map((c, i) => ({ ...c, id: c.id || c.type || `legacy-${i}` }));
  for (const type of selected) {
    const text = labels[type] || type;
    const found = result.find(c => c.type === type || c.id === type || c.text.toLocaleLowerCase("pt-BR") === text.toLocaleLowerCase("pt-BR"));
    if (found) { found.id ||= type; found.type = type; }
    else result.push({ id: type, type, text, done: false });
  }
  return result;
}
export function validateProjectUpload(name: string, size: number, kind: string) {
  if (!name.trim() || name.length > 255 || /[\/\x00-\x1f]/.test(name)) throw new Error("Nome de arquivo inválido.");
  if (!Number.isSafeInteger(size) || size <= 0 || size > PROJECT_UPLOAD_LIMIT) throw new Error("Envie um arquivo de até 300 MB.");
  if (kind !== "editable" && kind !== "pdf") throw new Error("Escolha arquivo editável ou PDF.");
  if (kind === "pdf" && !/\.pdf$/i.test(name)) throw new Error("Nesta opção envie um arquivo PDF.");
  if (kind === "editable" && /\.pdf$/i.test(name)) throw new Error("Envie o arquivo fonte editável nesta opção; o PDF pertence ao campo PDF.");
}

const extensionFrom = (name: string, mime: string) => {
  const match = /\.([a-z0-9]{1,10})$/i.exec(name.trim());
  if (match) return match[1].toLowerCase();
  return mime === "application/pdf" ? "pdf" : "bin";
};

/** Tira acento, emoji e símbolo; devolve só as palavras (letras e números). */
const palavras = (value: string) => value
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
const capitalizar = (palavra: string) => palavra.charAt(0).toUpperCase() + palavra.slice(1).toLowerCase();

/**
 * EPIC-031 S-1: abreviação fixa dos itens do checklist de Projetos. A chave é o tipo
 * (`PROJECT_TYPE_LABELS`) ou o texto do item sem acento, em minúsculas.
 */
export const ITEM_ARQUIVO_PROJETO_CURTO: Record<string, string> = {
  projeto_arquitetonico: "Planta", "projeto arquitetonico": "Planta",
  projeto_estrutural: "Estrutural", "projeto estrutural": "Estrutural",
  projeto_eletrico: "Eletrico", "projeto eletrico": "Eletrico",
  projeto_hidrossanitario: "Hidrossanitario", "projeto hidrossanitario": "Hidrossanitario",
  orcamento_obra: "Orcamento", "orcamento de obra": "Orcamento",
  laudo_tecnico: "Laudo", "laudo tecnico": "Laudo",
  art_rrt: "ART", "art rrt": "ART",
};
const LIMITE_ITEM = 16;
const LIGACOES = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "para", "com"]);
const LIMITE_BASE = 40;

/** Nome curto do item: tabela fixa; senão até duas palavras do texto (sem "Projeto"); sem item → "Doc". */
export function itemCurtoArquivoProjeto(item: { type?: string | null; text?: string | null; itemId?: string | null } | null | undefined): string {
  if (!item) return "Doc";
  if (item.itemId && /^revisao-\d+$/.test(item.itemId)) return "Revisao";
  if (item.type && ITEM_ARQUIVO_PROJETO_CURTO[item.type]) return ITEM_ARQUIVO_PROJETO_CURTO[item.type];
  const partes = palavras(item.text ?? "");
  const chave = partes.join(" ").toLowerCase();
  if (ITEM_ARQUIVO_PROJETO_CURTO[chave]) return ITEM_ARQUIVO_PROJETO_CURTO[chave];
  const semLigacao = partes.filter(p => !LIGACOES.has(p.toLowerCase()));
  const uteis = semLigacao.length > 1 && semLigacao[0].toLowerCase() === "projeto" ? semLigacao.slice(1) : semLigacao;
  if (!uteis.length) return "Doc";
  const formatadas = uteis.slice(0, 2).map(p => (/^[A-Z0-9]{2,5}$/.test(p) ? p : capitalizar(p)));
  // corta na palavra: a segunda só entra se couber inteira
  const texto = formatadas.length > 1 && formatadas.join("-").length <= LIMITE_ITEM ? formatadas.join("-") : formatadas[0].slice(0, LIMITE_ITEM);
  return texto || "Doc";
}

/** Primeiro e último nome do cliente, sem acento nem emoji; vazio → "Cliente". */
export function clienteCurtoArquivoProjeto(clientName: string | null | undefined): string {
  const partes = palavras(clientName ?? "").filter(p => /[A-Za-z]/.test(p));
  if (!partes.length) return "Cliente";
  const nomes = partes.length === 1 ? [partes[0]] : [partes[0], partes[partes.length - 1]];
  return nomes.map(p => capitalizar(p).slice(0, 14)).join("-");
}

/**
 * EPIC-031 S-1 — nome PADRÃO e CURTO de todo arquivo dos Projetos:
 * `<Item>-<Primeiro-Ultimo>-<n>.<ext>` (ex.: `Eletrico-Keilane-Costa-1.pdf`), no máximo
 * 40 caracteres antes da extensão, sem acento, espaço nem símbolo. `n` é a versão do
 * arquivo dentro do item (estável: atribuída no envio). O nome original fica guardado.
 */
export function nomePadraoArquivoProjeto(input: { item: string; cliente: string; n: number; originalName: string; mime?: string | null }) {
  const n = Number.isSafeInteger(input.n) && input.n > 0 ? input.n : 1;
  const sufixo = `-${n}`;
  let base = `${input.item}-${input.cliente}`;
  if (base.length + sufixo.length > LIMITE_BASE) base = base.slice(0, LIMITE_BASE - sufixo.length).replace(/-+$/, "");
  return `${base}${sufixo}.${extensionFrom(input.originalName || "", input.mime || "")}`;
}

/** Nome padrão de um documento do projeto, a partir dos metadados guardados. */
export function nomePadraoDocumentoProjeto(doc: { itemId?: string | null; version?: number | null; originalName?: string | null; name?: string | null; mime?: string | null; kind?: string | null }, projeto: { clientName: string | null | undefined; checklist: ProjectCheck[] }, nFallback = 1) {
  const item = doc.itemId ? projeto.checklist.find(c => (c.id || c.type) === doc.itemId) : undefined;
  const itemCurto = doc.itemId && /^revisao-\d+$/.test(doc.itemId) ? "Revisao" : itemCurtoArquivoProjeto(item ?? null);
  const original = doc.originalName || doc.name || "";
  const mime = doc.mime || (doc.kind === "pdf" ? "application/pdf" : "");
  return nomePadraoArquivoProjeto({ item: itemCurto, cliente: clienteCurtoArquivoProjeto(projeto.clientName), n: doc.version || nFallback, originalName: original, mime });
}

/**
 * Nomes padrão de uma lista de arquivos (lista do projeto). Arquivo antigo sem versão
 * recebe a posição dentro do mesmo item e tipo; nomes repetidos sobem o número até ficarem únicos.
 */
export function nomesPadraoArquivosProjeto<T extends { itemId?: string | null; version?: number | null; originalName?: string | null; name?: string | null; kind?: string | null }>(files: T[], projeto: { clientName: string | null | undefined; checklist: ProjectCheck[] }): string[] {
  const posicao = new Map<string, number>();
  const usados = new Set<string>();
  return files.map(file => {
    const grupo = `${file.itemId ?? ""}:${file.kind ?? ""}`;
    const pos = (posicao.get(grupo) ?? 0) + 1;
    posicao.set(grupo, pos);
    let n = file.version || pos;
    let nome = nomePadraoDocumentoProjeto({ ...file, version: n }, projeto);
    while (usados.has(nome.toLowerCase())) nome = nomePadraoDocumentoProjeto({ ...file, version: ++n }, projeto);
    usados.add(nome.toLowerCase());
    return nome;
  });
}

/** Atualiza os indicadores de anexos e preserva decisões manuais sobre a conclusão. */
export function reconcileProjectChecklist(checks: ProjectCheck[], documents: ProjectDocumentPresence[]): ProjectCheck[] {
  const active = new Set(documents.map(document => `${document.itemId}:${document.kind}`));
  return checks.map((check, index) => {
    const id = check.id || check.type || `legacy-${index}`;
    const pdfDone = active.has(`${id}:pdf`);
    const editableDone = active.has(`${id}:editable`);
    return { ...check, id, pdfDone, editableDone, done: check.conclusaoManual ?? (pdfDone && editableDone) };
  });
}
