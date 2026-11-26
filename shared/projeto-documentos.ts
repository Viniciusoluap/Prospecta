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
/** a forma distinta (só usada quando dois itens dariam o mesmo nome) pode ir um pouco além */
const LIMITE_ITEM_DISTINTO = 20;
const LIGACOES = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "para", "com"]);
const LIMITE_BASE = 40;

type ItemArquivo = { type?: string | null; text?: string | null; itemId?: string | null; id?: string | null };
const numeroRevisao = (itemId: string | null | undefined) => (itemId ? /^revisao-(\d+)$/.exec(itemId)?.[1] : undefined);

/** Forma curta e forma "distinta" (com o final do item colado: `Eletrico-BlocoA`) de um item. */
function formasDoItem(item: ItemArquivo | null | undefined): { curto: string; distinto: string } {
  if (!item) return { curto: "Doc", distinto: "Doc" };
  if (item.type && ITEM_ARQUIVO_PROJETO_CURTO[item.type] && !item.text) return { curto: ITEM_ARQUIVO_PROJETO_CURTO[item.type], distinto: ITEM_ARQUIVO_PROJETO_CURTO[item.type] };
  const partes = palavras(item.text ?? "");
  const chave = partes.join(" ").toLowerCase();
  const fixo = (item.type && ITEM_ARQUIVO_PROJETO_CURTO[item.type]) || ITEM_ARQUIVO_PROJETO_CURTO[chave];
  // "de/da/e…" saem, menos a última palavra ("Bloco A": o "A" é o que diferencia)
  const semLigacao = partes.filter((p, i) => i === partes.length - 1 || !LIGACOES.has(p.toLowerCase()));
  const uteis = semLigacao.length > 1 && semLigacao[0].toLowerCase() === "projeto" ? semLigacao.slice(1) : semLigacao;
  const formatadas = uteis.map(p => (/^[A-Z0-9]{2,5}$/.test(p) ? p : capitalizar(p)));
  if (fixo) return { curto: fixo, distinto: fixo };
  if (!formatadas.length) return { curto: "Doc", distinto: "Doc" };
  const duas = formatadas.slice(0, 2);
  // corta na palavra: a segunda só entra se couber inteira
  const curto = (duas.length > 1 && duas.join("-").length <= LIMITE_ITEM ? duas.join("-") : duas[0].slice(0, LIMITE_ITEM)) || "Doc";
  if (formatadas.length < 2) return { curto, distinto: curto };
  // distinto: primeira palavra + resto colado, guardando o FINAL (onde mora o que diferencia: "A", "B", "2")
  const primeira = formatadas[0].slice(0, 10);
  const cabe = LIMITE_ITEM_DISTINTO - primeira.length - 1;
  let resto = "";
  for (const p of formatadas.slice(1).reverse()) { if ((p + resto).length > cabe) break; resto = p + resto; }
  if (!resto) resto = formatadas[formatadas.length - 1].slice(0, cabe);
  const distinto = `${primeira}-${resto}`;
  return { curto, distinto };
}

/**
 * Nome curto do item: tabela fixa; senão até duas palavras do texto (sem "Projeto"); entrega de
 * revisão → `Rev<n>`; sem item → "Doc". Com `checklist` (opcional), dois itens do mesmo projeto que dariam
 * o mesmo nome curto usam a forma distinta (`Eletrico-BlocoA` / `Eletrico-BlocoB`).
 * `numeroDaRevisao` (opcional) troca o id do pedido pela ordem da revisão no projeto.
 */
export function itemCurtoArquivoProjeto(item: ItemArquivo | null | undefined, checklist?: ItemArquivo[], numeroDaRevisao?: (revisionId: number) => number): string {
  const rev = numeroRevisao(item?.itemId);
  if (rev) return `Rev${numeroDaRevisao?.(Number(rev)) ?? rev}`;
  const formas = formasDoItem(item);
  if (!checklist?.length || formas.curto === formas.distinto) return formas.curto;
  const proprio = item?.id ?? item?.itemId ?? null;
  const repetido = checklist.some(outro => (outro.id ?? outro.itemId ?? null) !== proprio && (outro.text ?? "") !== (item?.text ?? "") && formasDoItem(outro).curto === formas.curto);
  return repetido ? formas.distinto : formas.curto;
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

/** O nome já está no padrão novo (gravado no envio)? Então é mostrado como está, nunca recalculado. */
export function ehNomePadraoArquivoProjeto(nome: string | null | undefined): boolean {
  const m = /^([A-Za-z0-9-]+)\.[a-z0-9]{1,10}$/.exec(nome ?? "");
  return !!m && m[1].length <= LIMITE_BASE && /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*-\d+$/.test(m[1]);
}

type ProjetoDoArquivo = { clientName: string | null | undefined; checklist: ProjectCheck[]; numeroDaRevisao?: (revisionId: number) => number };

/** Nome padrão de um documento do projeto, a partir dos metadados guardados (sem olhar colisões). */
export function nomePadraoDocumentoProjeto(doc: { itemId?: string | null; version?: number | null; originalName?: string | null; name?: string | null; mime?: string | null; kind?: string | null }, projeto: ProjetoDoArquivo, nFallback = 1) {
  const item = doc.itemId ? projeto.checklist.find(c => (c.id || c.type) === doc.itemId) : undefined;
  const itemCurto = itemCurtoArquivoProjeto(numeroRevisao(doc.itemId) ? { itemId: doc.itemId } : item ?? null, projeto.checklist, projeto.numeroDaRevisao);
  const original = doc.originalName || doc.name || "";
  const mime = doc.mime || (doc.kind === "pdf" ? "application/pdf" : "");
  return nomePadraoArquivoProjeto({ item: itemCurto, cliente: clienteCurtoArquivoProjeto(projeto.clientName), n: doc.version || nFallback, originalName: original, mime });
}

/**
 * Nome de um arquivo NOVO, único no projeto: tenta o nome padrão; se já existir, tenta a forma
 * distinta do item; depois sobe o número. `usados` = todos os nomes já mostrados do projeto.
 */
export function nomeNovoArquivoProjeto(input: { item: ItemArquivo; checklist: ItemArquivo[]; clientName: string | null | undefined; n: number; originalName: string; mime?: string | null; numeroDaRevisao?: (revisionId: number) => number }, usados: Iterable<string>): string {
  const ocupados = new Set(Array.from(usados, nome => nome.toLowerCase()));
  const cliente = clienteCurtoArquivoProjeto(input.clientName);
  const itens = [itemCurtoArquivoProjeto(input.item, input.checklist, input.numeroDaRevisao)];
  if (!numeroRevisao(input.item.itemId)) itens.push(formasDoItem(input.item).distinto);
  for (const item of itens) {
    const nome = nomePadraoArquivoProjeto({ item, cliente, n: input.n, originalName: input.originalName, mime: input.mime });
    if (!ocupados.has(nome.toLowerCase())) return nome;
  }
  for (let n = input.n + 1; ; n++) {
    const nome = nomePadraoArquivoProjeto({ item: itens[0], cliente, n, originalName: input.originalName, mime: input.mime });
    if (!ocupados.has(nome.toLowerCase())) return nome;
  }
}

/**
 * Nomes mostrados de uma lista de arquivos (lista do projeto). Arquivo cujo nome gravado já está no
 * padrão novo aparece COM esse nome (nunca é renumerado). Só os antigos são calculados, sem colidir com
 * os gravados nem com `reservados` (opcional: outros nomes do projeto, ex.: entregas de revisão).
 * Antigo sem versão recebe a posição dentro do mesmo item e tipo; nome repetido sobe o número.
 */
export function nomesPadraoArquivosProjeto<T extends { itemId?: string | null; version?: number | null; originalName?: string | null; name?: string | null; kind?: string | null }>(files: T[], projeto: ProjetoDoArquivo, reservados: Iterable<string> = []): string[] {
  const usados = new Set(Array.from(reservados, nome => nome.toLowerCase()));
  // Codex #340 (P2): só vale como "gravado no padrão" o arquivo enviado pelo sistema (tem `originalName` guardado). Arquivo
  // antigo só com nome e link, mesmo que o nome PAREÇA do padrão ("planta-1.pdf"), é calculado — e nunca repete nome.
  const gravado = files.map(file => !!file.originalName && ehNomePadraoArquivoProjeto(file.name));
  files.forEach((file, i) => { if (gravado[i]) usados.add(file.name!.toLowerCase()); });
  const posicao = new Map<string, number>();
  return files.map((file, i) => {
    const grupo = `${file.itemId ?? ""}:${file.kind ?? ""}`;
    const pos = (posicao.get(grupo) ?? 0) + 1;
    posicao.set(grupo, pos);
    if (gravado[i]) return file.name!;
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
