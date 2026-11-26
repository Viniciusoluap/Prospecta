// EPIC-031 S-2 — renomeia no Google Drive os arquivos ANTIGOS dos Projetos para o nome padrão curto.
// Autorização do dono (26/11/2026): "Pode renomear os arquivos do Google Drive sim" — só o NOME; nunca conteúdo,
// pasta, permissão nem exclusão.
//
// O nome desejado é o MESMO que a tela mostra (mesmas funções puras de shared/projeto-documentos.ts, com a mesma lista
// e a mesma ordem): itens do checklist e documentos antigos vêm de operational_projects.files; entregas de revisão vêm
// de project_revision_requests.deliveries. Só é renomeado o arquivo que tem registro em project_documents (ativo ou
// substituído, com drive_file_id igual ao da tela). original_name NUNCA é alterado: desfazer = voltar o nome no Drive
// para original_name. Depois de renomear, o nome novo fica em canonical_name (a coluna do nome no Drive): rodar de
// novo não faz nada. Falha num arquivo não interrompe os outros e fica registrada (só o código, sem dados pessoais).
import { sql } from "drizzle-orm";
import { getDb } from "./db.js";
import { comPrazoNoDrive, driveConfigured, renomearArquivoNoDrive, type ResultadoRenomearDrive } from "./drive-documents.js";
import { ErroDrive } from "../shared/drive-erro.js";
import { PROJECT_TYPE_LABELS } from "../shared/operacional.js";
import { clienteCurtoArquivoProjeto, nomePadraoArquivoProjeto, nomesPadraoArquivosProjeto, projectChecklist, type ProjectCheck } from "../shared/projeto-documentos.js";

export const LOTE_NOMES_DRIVE = 25;
/** Depois de tantas falhas no mesmo arquivo, a rotina deixa de tentar (fica registrado em drive_rename_error). */
export const MAX_FALHAS_NOME_DRIVE = 5;

type Linhas<T> = { rows: T[] };
type Doc = { id: number; project_id: number; canonical_name: string; drive_file_id: string; drive_rename_failures: number };
type Projeto = { id: number; client_name: string | null; types: string | null; checklist: string | null; files: string | null };
type Arquivo = { documentId?: number; driveFileId?: string; url?: string; itemId?: string | null; kind?: string | null; version?: number | null; name?: string | null; originalName?: string | null };
type Entrega = { documentId?: number; driveFileId?: string; nome?: string; nomeOriginal?: string; versao?: number; tipo?: string };

export interface ResumoNomesDrive {
  conferir: boolean;
  /** Arquivos com nome no Drive diferente do nome da tela (antes deste lote). */
  pendentes: number;
  renomeados: number;
  /** Já tinham o nome padrão no Drive: só o registro foi atualizado. */
  jaEstavam: number;
  /** Na lixeira do Drive ou sem permissão de renomear: não tocados. */
  naoTocados: number;
  falhas: number;
  /** Desistidos depois de MAX_FALHAS_NOME_DRIVE falhas. */
  desistidos: number;
  /** Registros que a tela não mostra (ou que não batem com o arquivo da tela): nunca renomeados. */
  semVinculoNaTela: number;
  /** Ainda falta algum lote. */
  restante: boolean;
  /** Só no modo "conferir": até 10 exemplos antes → depois. */
  exemplos?: { id: number; antes: string; depois: string }[];
  pulado?: "drive_nao_configurado";
}

export interface DependenciasNomesDrive {
  configurado: () => Promise<boolean>;
  renomear: (fileId: string, nome: string) => Promise<ResultadoRenomearDrive>;
  agora: () => number;
}
/** Cada arquivo tem no máximo 8 s (as chamadas ao Drive são canceladas ao passar disso). */
const reais = (): DependenciasNomesDrive => ({ configurado: driveConfigured, renomear: (id, nome) => comPrazoNoDrive(8_000, () => renomearArquivoNoDrive(id, nome)), agora: Date.now });

const lista = <T,>(v: string | null | undefined): T[] => { try { const x = JSON.parse(v || "[]"); return Array.isArray(x) ? x : []; } catch { return []; } };
const idDaUrl = (url?: string) => (url ? /\/file\/d\/([^/?#]+)/.exec(url)?.[1] : undefined);

/** Nome desejado (o da tela) de cada documento do registro, por projeto. Ambíguo (dois nomes para o mesmo registro) → fora. */
function nomesDaTela(projeto: Projeto, entregas: Entrega[], docs: Doc[]): Map<number, string> {
  const porId = new Map(docs.map(d => [d.id, d]));
  const porArquivo = new Map(docs.map(d => [d.drive_file_id, d]));
  const desejado = new Map<number, string>();
  const ambiguos = new Set<number>();
  const vincular = (ref: { documentId?: number; driveFileId?: string; url?: string }, nome: string) => {
    const arquivo = ref.driveFileId || idDaUrl(ref.url);
    const doc = (ref.documentId ? porId.get(ref.documentId) : undefined) ?? (arquivo ? porArquivo.get(arquivo) : undefined);
    // o registro precisa reconhecer o arquivo da tela: mesmo projeto (garantido pelo filtro) e mesmo arquivo do Drive
    if (!doc || (arquivo && arquivo !== doc.drive_file_id)) return;
    const anterior = desejado.get(doc.id);
    if (anterior !== undefined && anterior !== nome) ambiguos.add(doc.id);
    desejado.set(doc.id, nome);
  };
  const checklist = projectChecklist(lista<string>(projeto.types), lista<ProjectCheck>(projeto.checklist), PROJECT_TYPE_LABELS);
  const arquivos = lista<Arquivo>(projeto.files);
  const nomes = nomesPadraoArquivosProjeto(arquivos, { clientName: projeto.client_name, checklist });
  arquivos.forEach((a, i) => vincular(a, nomes[i]));
  const cliente = clienteCurtoArquivoProjeto(projeto.client_name);
  for (const d of entregas) {
    // igual a ProjetoRevisoes.tsx
    vincular(d, nomePadraoArquivoProjeto({ item: "Revisao", cliente, n: d.versao || 1, originalName: d.nomeOriginal || d.nome || "", mime: d.tipo === "pdf" ? "application/pdf" : "" }));
  }
  for (const id of Array.from(ambiguos)) desejado.delete(id);
  return desejado;
}

function codigoDoErro(e: unknown): { codigo: string; limiteDeTaxa: boolean } {
  if (e instanceof ErroDrive) {
    const limiteDeTaxa = e.status === 429 || /rateLimit/i.test(e.motivo || "");
    return { codigo: `${e.etapa}:${e.status}${e.motivo ? `:${e.motivo}` : ""}`.slice(0, 120), limiteDeTaxa };
  }
  return { codigo: e instanceof Error && e.name === "TimeoutError" ? "tempo_esgotado" : "falha", limiteDeTaxa: false };
}

/**
 * Confere (`conferir: true`, sem tocar no Drive nem no banco) ou renomeia um lote (até `limite`, dentro de `prazoMs`).
 */
export async function renomearDocumentosProjetoNoDrive(
  opcoes: { conferir: boolean; limite?: number; prazoMs?: number },
  deps: DependenciasNomesDrive = reais(),
): Promise<ResumoNomesDrive> {
  const inicio = deps.agora();
  const limite = Math.max(1, Math.min(opcoes.limite ?? LOTE_NOMES_DRIVE, 100));
  const prazoMs = opcoes.prazoMs ?? 20_000;
  const resumo: ResumoNomesDrive = { conferir: opcoes.conferir, pendentes: 0, renomeados: 0, jaEstavam: 0, naoTocados: 0, falhas: 0, desistidos: 0, semVinculoNaTela: 0, restante: false };
  if (!opcoes.conferir && !(await deps.configurado())) return { ...resumo, pulado: "drive_nao_configurado" };
  const db = getDb();
  const docs = (await db.execute(sql`SELECT id, project_id, canonical_name, drive_file_id, drive_rename_failures FROM project_documents
    WHERE status IN ('active', 'substituted') AND drive_file_id IS NOT NULL AND drive_file_id <> '' ORDER BY project_id, id`) as unknown as Linhas<Doc>).rows;
  if (!docs.length) return resumo;
  const idsProjetos = Array.from(new Set(docs.map(d => Number(d.project_id))));
  const listaIds = sql.join(idsProjetos.map(id => sql`${id}`), sql`, `);
  const projetos = (await db.execute(sql`SELECT id, client_name, types, checklist, files FROM operational_projects WHERE id IN (${listaIds})`) as unknown as Linhas<Projeto>).rows;
  const revisoes = (await db.execute(sql`SELECT project_id, deliveries FROM project_revision_requests WHERE project_id IN (${listaIds}) ORDER BY id`) as unknown as Linhas<{ project_id: number; deliveries: string | null }>).rows;

  const candidatos: { doc: Doc; nome: string }[] = [];
  for (const projeto of projetos) {
    const docsDoProjeto = docs.filter(d => Number(d.project_id) === Number(projeto.id));
    const entregas = revisoes.filter(r => Number(r.project_id) === Number(projeto.id)).flatMap(r => lista<Entrega>(r.deliveries));
    const desejado = nomesDaTela(projeto, entregas, docsDoProjeto);
    for (const doc of docsDoProjeto) {
      const nome = desejado.get(doc.id);
      if (nome === undefined) { resumo.semVinculoNaTela++; continue; }
      if (nome === doc.canonical_name) continue;
      if (Number(doc.drive_rename_failures) >= MAX_FALHAS_NOME_DRIVE) { resumo.desistidos++; continue; }
      candidatos.push({ doc, nome });
    }
  }
  resumo.semVinculoNaTela += docs.filter(d => !projetos.some(p => Number(p.id) === Number(d.project_id))).length;
  // quem falhou antes vai para o fim: um arquivo com problema não trava o lote dos outros
  candidatos.sort((a, b) => Number(a.doc.drive_rename_failures) - Number(b.doc.drive_rename_failures) || a.doc.id - b.doc.id);
  resumo.pendentes = candidatos.length;
  if (opcoes.conferir) {
    resumo.exemplos = candidatos.slice(0, 10).map(c => ({ id: c.doc.id, antes: c.doc.canonical_name, depois: c.nome }));
    resumo.restante = candidatos.length > 0;
    return resumo;
  }

  let processados = 0;
  for (const { doc, nome } of candidatos) {
    if (processados >= limite || deps.agora() - inicio >= prazoMs) break;
    processados++;
    let resultado: ResultadoRenomearDrive;
    try {
      resultado = await deps.renomear(doc.drive_file_id, nome);
    } catch (e) {
      const { codigo, limiteDeTaxa } = codigoDoErro(e);
      console.error("[projetos/nome-drive] documento", doc.id, codigo);
      if (limiteDeTaxa) { processados--; break; } // limite de taxa do Google: para o lote sem contar como falha do arquivo
      resumo.falhas++;
      await db.execute(sql`UPDATE project_documents SET drive_rename_failures = drive_rename_failures + 1, drive_rename_error = ${codigo} WHERE id = ${doc.id}`);
      continue;
    }
    if (resultado === "lixeira" || resultado === "sem_permissao") {
      resumo.naoTocados++;
      await db.execute(sql`UPDATE project_documents SET drive_rename_failures = drive_rename_failures + 1, drive_rename_error = ${resultado} WHERE id = ${doc.id}`);
      continue;
    }
    // só o nome do Drive (canonical_name) muda no registro; original_name fica como estava
    await db.execute(sql`UPDATE project_documents SET canonical_name = ${nome}, drive_rename_error = NULL,
      drive_renamed_at = CASE WHEN ${resultado === "renomeado"} THEN now() ELSE drive_renamed_at END, updated_at = now()
      WHERE id = ${doc.id} AND canonical_name = ${doc.canonical_name}`);
    if (resultado === "renomeado") resumo.renomeados++; else resumo.jaEstavam++;
  }
  resumo.restante = resumo.pendentes - resumo.renomeados - resumo.jaEstavam > 0;
  return resumo;
}

/**
 * Dentro do cron que já existe (avisos da Dolores da tarde, 15h–19h de Brasília; sem cron novo e sem botão novo): um lote
 * por execução, só com o segredo do cron (`autorizado` = cronAutorizado do cabeçalho, conferido por quem chama) e com o
 * tempo que sobra. Sem nada pendente, é uma leitura do banco e mais nada.
 * Nunca lança nem muda a resposta do cron.
 */
export async function renomearNomesDriveNoCron(autorizado: boolean, prazoMs: number, deps?: DependenciasNomesDrive): Promise<ResumoNomesDrive | { pulado: true } | { erro: true }> {
  if (!autorizado || prazoMs < 3_000) return { pulado: true };
  try {
    return await renomearDocumentosProjetoNoDrive({ conferir: false, limite: LOTE_NOMES_DRIVE, prazoMs }, deps);
  } catch (e) {
    // ex.: migração 0175 ainda não aplicada (coluna ausente) — fica para a próxima execução
    console.error("[projetos/nome-drive]", e instanceof Error ? e.message.slice(0, 200) : "falha");
    return { erro: true };
  }
}
