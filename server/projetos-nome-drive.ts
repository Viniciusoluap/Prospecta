// EPIC-031 S-2 — renomeia no Google Drive os arquivos ANTIGOS dos Projetos para o nome padrão curto.
// Autorização do dono (26/11/2026): "Pode renomear os arquivos do Google Drive sim" — só o NOME; nunca conteúdo,
// pasta, permissão nem exclusão.
//
// O nome desejado é EXATAMENTE o que a tela mostra hoje (mesmas funções puras de shared/projeto-documentos.ts, mesma
// lista, mesma ordem, mesmos argumentos):
//   - itens do checklist e documentos antigos: `nomesPadraoArquivosProjeto(files, { clientName, checklist })` sobre
//     operational_projects.files, como em AdminProjetos.tsx;
//   - entregas de revisão: o cálculo de ProjetoRevisoes.tsx (`Rev<ordem da revisão no projeto>`).
// Arquivo já GRAVADO no padrão (tem nome original guardado e nome no padrão) é mostrado como está e nunca é tocado.
// Só é renomeado o arquivo ANTIGO que tem registro em project_documents (ativo ou substituído, com o mesmo drive_file_id
// da tela). Depois de renomear, o nome fica GRAVADO (congelado) nos três lugares, para a tela continuar mostrando o mesmo
// nome para sempre (mesmo que outro arquivo do projeto seja apagado depois):
//   - operational_projects.files (ou project_revision_requests.deliveries): `name`/`nome` = nome novo e
//     `originalName`/`nomeOriginal` = o original (o que já estava, ou project_documents.original_name);
//   - project_documents.canonical_name = nome novo, drive_renamed_at = agora.
// project_documents.original_name NUNCA é alterado: desfazer = voltar o nome no Drive para original_name.
// Falha num arquivo não interrompe os outros e fica registrada (só o código, sem dados pessoais).
import { sql } from "drizzle-orm";
import { getDb } from "./db.js";
import { comPrazoNoDrive, driveConfigured, renomearArquivoNoDrive, type ResultadoRenomearDrive } from "./drive-documents.js";
import { ErroDrive } from "../shared/drive-erro.js";
import { PROJECT_TYPE_LABELS } from "../shared/operacional.js";
import { clienteCurtoArquivoProjeto, ehNomePadraoArquivoProjeto, nomePadraoArquivoProjeto, nomesPadraoArquivosProjeto, projectChecklist, type ProjectCheck } from "../shared/projeto-documentos.js";

export const LOTE_NOMES_DRIVE = 25;
/** Depois de tantas falhas no mesmo arquivo, a rotina deixa de tentar (fica registrado em drive_rename_error). */
export const MAX_FALHAS_NOME_DRIVE = 5;

type Linhas<T> = { rows: T[] };
type Doc = { id: number; project_id: number; original_name: string; canonical_name: string; drive_file_id: string; drive_rename_failures: number };
type Projeto = { id: number; client_name: string | null; types: string | null; checklist: string | null; files: string | null };
type Revisao = { id: number; project_id: number; deliveries: string | null };
type Arquivo = { documentId?: number; driveFileId?: string; url?: string; itemId?: string | null; kind?: string | null; version?: number | null; name?: string | null; originalName?: string | null };
type Entrega = { documentId?: number; driveFileId?: string; url?: string; nome?: string; nomeOriginal?: string; versao?: number; tipo?: string };

/** Onde o nome mostrado está guardado: posição no JSON `files` do projeto ou numa entrega de revisão. */
type Origem = { tipo: "arquivo"; indice: number } | { tipo: "entrega"; revisaoId: number; indice: number };
type Alvo = { doc: Doc; nome: string; origem: Origem };

export interface ResumoNomesDrive {
  conferir: boolean;
  /** Arquivos antigos (nome ainda calculado na tela) com registro, a renomear/gravar (antes deste lote). */
  pendentes: number;
  renomeados: number;
  /** Já tinham o nome padrão no Drive: só o registro e a lista foram gravados. */
  jaEstavam: number;
  /** Na lixeira do Drive ou sem permissão de renomear: não tocados. */
  naoTocados: number;
  falhas: number;
  /** Desistidos depois de MAX_FALHAS_NOME_DRIVE falhas. */
  desistidos: number;
  /** O nome da tela já é de outro arquivo do projeto no Drive: fica para a próxima execução (nunca dois iguais). */
  colisoes: number;
  /** Mudou entre a leitura e a gravação (ex.: alguém enviou/apagou arquivo): fica para a próxima execução. */
  mudaram: number;
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
const minusculo = (s: string) => s.toLowerCase();

/**
 * Nomes da tela de um projeto e, para cada arquivo ANTIGO com registro, o alvo (doc, nome, onde está guardado).
 * `mostrados` = todos os nomes que a tela mostra no projeto (lista + revisões), para conferir colisões.
 */
function planoDoProjeto(projeto: Projeto, revisoes: Revisao[], docs: Doc[]): { alvos: Alvo[]; mostrados: { nome: string; docId?: number }[]; vinculados: Set<number> } {
  const porId = new Map(docs.map(d => [d.id, d]));
  const porArquivo = new Map(docs.map(d => [d.drive_file_id, d]));
  const docDe = (ref: { documentId?: number; driveFileId?: string; url?: string }) => {
    const arquivo = ref.driveFileId || idDaUrl(ref.url);
    const doc = (ref.documentId ? porId.get(ref.documentId) : undefined) ?? (arquivo ? porArquivo.get(arquivo) : undefined);
    // o registro precisa reconhecer o arquivo da tela: mesmo projeto (garantido pelo filtro) e mesmo arquivo do Drive
    return doc && (!arquivo || arquivo === doc.drive_file_id) ? doc : undefined;
  };
  const alvos: Alvo[] = [];
  const mostrados: { nome: string; docId?: number }[] = [];
  const vinculados = new Set<number>();
  const vezes = new Map<number, number>();
  const anotar = (doc: Doc | undefined, nome: string, origem: Origem, antigo: boolean) => {
    mostrados.push({ nome, docId: doc?.id });
    if (!doc) return;
    vinculados.add(doc.id);
    vezes.set(doc.id, (vezes.get(doc.id) ?? 0) + 1);
    if (antigo) alvos.push({ doc, nome, origem });
  };

  // igual a AdminProjetos.tsx
  const checklist = projectChecklist(lista<string>(projeto.types), lista<ProjectCheck>(projeto.checklist), PROJECT_TYPE_LABELS);
  const arquivos = lista<Arquivo>(projeto.files);
  const nomes = nomesPadraoArquivosProjeto(arquivos, { clientName: projeto.client_name, checklist });
  arquivos.forEach((a, i) => anotar(docDe(a), nomes[i], { tipo: "arquivo", indice: i }, !(a.originalName && ehNomePadraoArquivoProjeto(a.name))));

  // igual a ProjetoRevisoes.tsx: ordem da revisão no projeto pelos ids
  const ordem = new Map(revisoes.map(r => Number(r.id)).sort((a, b) => a - b).map((id, i) => [id, i + 1]));
  const cliente = clienteCurtoArquivoProjeto(projeto.client_name);
  for (const r of revisoes) {
    lista<Entrega>(r.deliveries).forEach((d, i) => {
      const gravado = !!d.nomeOriginal && ehNomePadraoArquivoProjeto(d.nome);
      const nome = gravado ? d.nome! : nomePadraoArquivoProjeto({ item: `Rev${ordem.get(Number(r.id)) ?? r.id}`, cliente, n: d.versao || 1, originalName: d.nomeOriginal || d.nome || "", mime: d.tipo === "pdf" ? "application/pdf" : "" });
      anotar(docDe(d), nome, { tipo: "entrega", revisaoId: Number(r.id), indice: i }, !gravado);
    });
  }
  // registro que aparece duas vezes na tela: ambíguo, nunca renomeado
  return { alvos: alvos.filter(a => vezes.get(a.doc.id) === 1), mostrados, vinculados };
}

/** O nome já é de OUTRO arquivo do projeto (no Drive, pelo registro, ou na tela)? */
function colide(alvo: Alvo, docs: Doc[], mostrados: { nome: string; docId?: number }[]): boolean {
  const n = minusculo(alvo.nome);
  return docs.some(d => d.id !== alvo.doc.id && minusculo(d.canonical_name) === n)
    || mostrados.some(m => m.docId !== alvo.doc.id && minusculo(m.nome) === n);
}

function codigoDoErro(e: unknown): { codigo: string; limiteDeTaxa: boolean } {
  if (e instanceof ErroDrive) {
    const limiteDeTaxa = e.status === 429 || /rateLimit/i.test(e.motivo || "");
    return { codigo: `${e.etapa}:${e.status}${e.motivo ? `:${e.motivo}` : ""}`.slice(0, 120), limiteDeTaxa };
  }
  return { codigo: e instanceof Error && e.name === "TimeoutError" ? "tempo_esgotado" : "falha", limiteDeTaxa: false };
}

type Executor = Pick<ReturnType<typeof getDb>, "execute">;
const DOCS_SQL = (projetoId?: number) => sql`SELECT id, project_id, original_name, canonical_name, drive_file_id, drive_rename_failures FROM project_documents
  WHERE status IN ('active', 'substituted') AND drive_file_id IS NOT NULL AND drive_file_id <> ''
  ${projetoId === undefined ? sql`` : sql`AND project_id = ${projetoId}`} ORDER BY project_id, id`;
const lerDocs = async (db: Executor, projetoId?: number) => (await db.execute(DOCS_SQL(projetoId)) as unknown as Linhas<Doc>).rows;

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
  const resumo: ResumoNomesDrive = { conferir: opcoes.conferir, pendentes: 0, renomeados: 0, jaEstavam: 0, naoTocados: 0, falhas: 0, desistidos: 0, colisoes: 0, mudaram: 0, semVinculoNaTela: 0, restante: false };
  if (!opcoes.conferir && !(await deps.configurado())) return { ...resumo, pulado: "drive_nao_configurado" };
  const db = getDb();
  const docs = await lerDocs(db);
  if (!docs.length) return resumo;
  const idsProjetos = Array.from(new Set(docs.map(d => Number(d.project_id))));
  const listaIds = sql.join(idsProjetos.map(id => sql`${id}`), sql`, `);
  const projetos = (await db.execute(sql`SELECT id, client_name, types, checklist, files FROM operational_projects WHERE id IN (${listaIds})`) as unknown as Linhas<Projeto>).rows;
  const revisoes = (await db.execute(sql`SELECT id, project_id, deliveries FROM project_revision_requests WHERE project_id IN (${listaIds}) ORDER BY id`) as unknown as Linhas<Revisao>).rows;

  const candidatos: Alvo[] = [];
  for (const projeto of projetos) {
    const docsDoProjeto = docs.filter(d => Number(d.project_id) === Number(projeto.id));
    const { alvos, vinculados } = planoDoProjeto(projeto, revisoes.filter(r => Number(r.project_id) === Number(projeto.id)), docsDoProjeto);
    resumo.semVinculoNaTela += docsDoProjeto.filter(d => !vinculados.has(d.id)).length;
    for (const alvo of alvos) {
      if (Number(alvo.doc.drive_rename_failures) >= MAX_FALHAS_NOME_DRIVE) { resumo.desistidos++; continue; }
      candidatos.push(alvo);
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
  for (const candidato of candidatos) {
    if (processados >= limite || deps.agora() - inicio >= prazoMs) break;
    processados++;
    const projetoId = Number(candidato.doc.project_id);
    const docId = candidato.doc.id;
    // Sob a MESMA trava do envio de arquivo (linha do projeto): relê tudo, confere que o nome da tela ainda é o mesmo,
    // renomeia no Drive e grava o nome nos três lugares. Erro do Drive → nada é gravado aqui.
    const desfecho = await db.transaction(async tx => {
      const [projeto] = (await tx.execute(sql`SELECT id, client_name, types, checklist, files FROM operational_projects WHERE id = ${projetoId} FOR UPDATE`) as unknown as Linhas<Projeto>).rows;
      if (!projeto) return { tipo: "mudou" as const };
      const revs = (await tx.execute(sql`SELECT id, project_id, deliveries FROM project_revision_requests WHERE project_id = ${projetoId} ORDER BY id`) as unknown as Linhas<Revisao>).rows;
      const docsAgora = await lerDocs(tx, projetoId);
      const plano = planoDoProjeto(projeto, revs, docsAgora);
      const alvo = plano.alvos.find(a => a.doc.id === docId);
      if (!alvo || alvo.nome !== candidato.nome) return { tipo: "mudou" as const };
      if (colide(alvo, docsAgora, plano.mostrados)) return { tipo: "colisao" as const };
      let resultado: ResultadoRenomearDrive;
      try { resultado = await deps.renomear(alvo.doc.drive_file_id, alvo.nome); }
      catch (e) { return { tipo: "erro" as const, ...codigoDoErro(e) }; }
      if (resultado === "lixeira" || resultado === "sem_permissao") return { tipo: "nao_tocado" as const, resultado };
      // grava (congela) o nome mostrado: a tela passa a mostrar este nome como "gravado", sem recalcular
      // (updated_at do projeto/pedido não muda: não é atividade de ninguém)
      if (alvo.origem.tipo === "arquivo") {
        const arquivos = lista<Arquivo>(projeto.files);
        const a = arquivos[alvo.origem.indice];
        arquivos[alvo.origem.indice] = { ...a, name: alvo.nome, originalName: a.originalName || alvo.doc.original_name };
        await tx.execute(sql`UPDATE operational_projects SET files = ${JSON.stringify(arquivos)} WHERE id = ${projetoId}`);
      } else {
        const { revisaoId, indice } = alvo.origem;
        const rev = revs.find(r => Number(r.id) === revisaoId)!;
        const entregas = lista<Entrega>(rev.deliveries);
        const d = entregas[indice];
        entregas[indice] = { ...d, nome: alvo.nome, nomeOriginal: d.nomeOriginal || alvo.doc.original_name };
        await tx.execute(sql`UPDATE project_revision_requests SET deliveries = ${JSON.stringify(entregas)} WHERE id = ${revisaoId}`);
      }
      // só o nome do Drive (canonical_name) muda no registro; original_name fica como estava
      await tx.execute(sql`UPDATE project_documents SET canonical_name = ${alvo.nome}, drive_rename_error = NULL,
        drive_renamed_at = CASE WHEN ${resultado === "renomeado"} THEN now() ELSE drive_renamed_at END, updated_at = now()
        WHERE id = ${docId}`);
      return { tipo: resultado };
    });
    switch (desfecho.tipo) {
      case "renomeado": resumo.renomeados++; break;
      case "ja_estava": resumo.jaEstavam++; break;
      case "mudou": resumo.mudaram++; break;
      case "colisao": resumo.colisoes++; break;
      case "nao_tocado":
        resumo.naoTocados++;
        await db.execute(sql`UPDATE project_documents SET drive_rename_failures = drive_rename_failures + 1, drive_rename_error = ${desfecho.resultado} WHERE id = ${docId}`);
        break;
      case "erro":
        console.error("[projetos/nome-drive] documento", docId, desfecho.codigo);
        if (desfecho.limiteDeTaxa) { processados = limite; break; } // limite de taxa do Google: para o lote sem contar como falha do arquivo
        resumo.falhas++;
        await db.execute(sql`UPDATE project_documents SET drive_rename_failures = drive_rename_failures + 1, drive_rename_error = ${desfecho.codigo} WHERE id = ${docId}`);
        break;
    }
  }
  resumo.restante = resumo.pendentes - resumo.renomeados - resumo.jaEstavam > 0;
  return resumo;
}

/**
 * Dentro do cron que já existe (avisos da Dolores da tarde, 15h–19h de Brasília; sem cron novo e sem botão novo): um lote
 * por execução, só com o segredo do cron (`autorizado` = cronAutorizado do cabeçalho, conferido por quem chama) e com o
 * tempo que sobra. Sem nada pendente, é uma leitura do banco e mais nada. Nunca lança nem muda a resposta do cron.
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
