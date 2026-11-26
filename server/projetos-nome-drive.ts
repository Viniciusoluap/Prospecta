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
// project_documents.original_name NUNCA é alterado. Para desfazer, o registro guarda também (uma vez só, nunca
// sobrescrito), numa transação CONFIRMADA ANTES de qualquer escrita no Drive: drive_name_before (o nome que o arquivo
// tinha NO DRIVE, lido no GET; origem 'drive') — ou, se o arquivo já estava com o nome novo e nada foi lido antes, o
// canonical_name anterior (origem 'registro', ESTIMADO) —, canonical_name_before, list_name_before (o `name`/`nome` da
// lista) e list_original_added (se a rotina acrescentou `originalName`/`nomeOriginal`). Assim, se o banco falhar depois
// do PATCH ou o tempo esgotar com o Google já tendo aplicado o nome, o nome real antigo continua guardado.
// Nada da rotina vai para log ou para drive_rename_error com nome de cliente/arquivo: só códigos.
// Falha num arquivo não interrompe os outros e fica registrada (só o código, sem dados pessoais). Só erro 4xx do Google
// (fora limite de taxa) conta para as MAX_FALHAS_NOME_DRIVE falhas; 5xx e tempo esgotado ficam para a próxima.
import { sql } from "drizzle-orm";
import { getDb } from "./db.js";
import { comPrazoNoDrive, driveConfigured, lerArquivoNoDrive, trocarNomeNoDrive, type ArquivoNoDrive } from "./drive-documents.js";
import { ErroDrive } from "../shared/drive-erro.js";
import { PROJECT_TYPE_LABELS } from "../shared/operacional.js";
import { clienteCurtoArquivoProjeto, ehNomePadraoArquivoProjeto, nomePadraoArquivoProjeto, nomesPadraoArquivosProjeto, projectChecklist, type ProjectCheck } from "../shared/projeto-documentos.js";

export const LOTE_NOMES_DRIVE = 25;
/** Depois de tantas falhas no mesmo arquivo, a rotina deixa de tentar (fica registrado em drive_rename_error). */
export const MAX_FALHAS_NOME_DRIVE = 5;
/** Prazo máximo de cada chamada ao Drive (leitura e troca do nome). */
export const PRAZO_ARQUIVO_DRIVE_MS = 8_000;
/** Espera máxima por uma trava do banco (lock_timeout de cada transação). */
export const ESPERA_TRAVA_MS = 2_000;
/**
 * Pior caso de um arquivo: leitura no Drive + 2 transações × 2 travas (advisory + linha do projeto) + troca no Drive.
 * O lote só começa um arquivo se esse tempo inteiro ainda couber no prazo.
 */
export const ORCAMENTO_ARQUIVO_MS = 2 * PRAZO_ARQUIVO_DRIVE_MS + 4 * ESPERA_TRAVA_MS;
/** Rede de segurança: nenhuma consulta das transações da rotina passa disto (as esperas de trava já param em 2 s). */
export const LIMITE_CONSULTA_MS = 3_000;

type Linhas<T> = { rows: T[] };
type Doc = {
  id: number; project_id: number; original_name: string; canonical_name: string; drive_file_id: string; drive_rename_failures: number;
  drive_renamed_at: Date | string | null; drive_name_before: string | null; drive_name_before_origem: string | null;
  drive_name_target: string | null; drive_patch_attempted: boolean | null; drive_rename_error: string | null;
  /** Último nome que SABEMOS ser um PATCH nosso aplicado no Drive (lido lá e reconhecido), enquanto o alvo já é outro. */
  drive_name_applied: string | null;
};
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
  /** Erro 4xx do Google (fora limite de taxa): conta para as MAX_FALHAS_NOME_DRIVE falhas do arquivo. */
  falhas: number;
  /** Erro 5xx ou tempo esgotado: registrado, mas não conta como falha do arquivo; tenta na próxima execução. */
  falhasTemporarias: number;
  /** Desistidos depois de MAX_FALHAS_NOME_DRIVE falhas. */
  desistidos: number;
  /** O nome da tela já é de outro arquivo do projeto no Drive: fica para a próxima execução (nunca dois iguais). */
  colisoes: number;
  /** Mudou entre a leitura e a gravação (ex.: alguém enviou/apagou arquivo): fica para a próxima execução. */
  mudaram: number;
  /** Projeto ocupado por outra gravação por mais de 2 s (lock_timeout): pulado nesta execução, sem contar falha. */
  ocupados: number;
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
  /** Só leitura (GET). `prazoMs`: no máximo PRAZO_ARQUIVO_DRIVE_MS (a chamada é cancelada ao passar disso). */
  ler: (fileId: string, prazoMs: number) => Promise<ArquivoNoDrive>;
  /** Só a troca do nome (PATCH). Mesmo limite de prazo. */
  trocar: (fileId: string, nome: string, prazoMs: number) => Promise<void>;
  agora: () => number;
}
const reais = (): DependenciasNomesDrive => ({
  configurado: driveConfigured,
  ler: (id, prazoMs) => comPrazoNoDrive(prazoMs, () => lerArquivoNoDrive(id)),
  trocar: (id, nome, prazoMs) => comPrazoNoDrive(prazoMs, () => trocarNomeNoDrive(id, nome)),
  agora: Date.now,
});

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

/**
 * O nome já é de OUTRO arquivo do projeto (no Drive, pelo registro, ou na tela)? `nomesGravados` = canonical_name de
 * TODOS os registros do projeto, de qualquer status: apagado ou ainda enviando também continua (ou vai estar) no Drive.
 */
type NomeGravado = { id: number; project_id: number; canonical_name: string; drive_name_target: string | null; drive_name_applied: string | null; drive_patch_attempted: boolean | null };
/**
 * Nomes que o arquivo de um registro tem (ou pode ter) no Drive: o do registro e, com a marca de PATCH tentado, o alvo e o
 * último PATCH nosso aplicado — um PATCH aplicado e não confirmado deixa o arquivo com esse nome no Drive enquanto o
 * `canonical_name` ainda é o antigo (portão de QA de 26/11: sem isto dois arquivos do projeto podiam ficar com o mesmo nome).
 */
const nomesNoDrive = (d: NomeGravado) => [d.canonical_name, ...(d.drive_patch_attempted === true ? [d.drive_name_target, d.drive_name_applied] : [])]
  .filter((x): x is string => !!x).map(minusculo);
function colide(alvo: Alvo, nomesGravados: NomeGravado[], mostrados: { nome: string; docId?: number }[]): boolean {
  const n = minusculo(alvo.nome);
  return nomesGravados.some(d => Number(d.id) !== alvo.doc.id && nomesNoDrive(d).includes(n))
    || mostrados.some(m => m.docId !== alvo.doc.id && minusculo(m.nome) === n);
}

/**
 * `contaFalha`: só erro 4xx do Google que não seja limite de taxa (429, ou 403 com motivo *rateLimit*) é falha DO ARQUIVO.
 * 5xx, tempo esgotado e erro sem código são do momento (Google ou rede) e não contam para a desistência.
 */
function codigoDoErro(e: unknown): { codigo: string; limiteDeTaxa: boolean; contaFalha: boolean } {
  if (e instanceof ErroDrive) {
    const limiteDeTaxa = e.status === 429 || /rateLimit/i.test(e.motivo || "");
    const contaFalha = !limiteDeTaxa && e.status >= 400 && e.status < 500;
    return { codigo: `${e.etapa}:${e.status}${e.motivo ? `:${e.motivo}` : ""}`.slice(0, 120), limiteDeTaxa, contaFalha };
  }
  return { codigo: e instanceof Error && e.name === "TimeoutError" ? "tempo_esgotado" : "falha", limiteDeTaxa: false, contaFalha: false };
}

/** SQLSTATE do erro do banco, direto do driver ou embrulhado pelo Drizzle em `cause`. */
function sqlstate(e: unknown): string | undefined {
  for (let x: unknown = e, i = 0; x && typeof x === "object" && i < 4; x = (x as { cause?: unknown }).cause, i++) {
    const c = (x as { code?: unknown }).code;
    if (typeof c === "string" && /^[0-9A-Z]{5}$/.test(c)) return c;
  }
  return undefined;
}
/** lock_timeout estourado (55P03). */
const travaOcupada = (e: unknown) => sqlstate(e) === "55P03";
/** statement_timeout estourado (57014). */
const consultaLenta = (e: unknown) => sqlstate(e) === "57014";
/**
 * Código do erro do banco para log, SEM a mensagem: o Drizzle põe os parâmetros da consulta (nomes de cliente e de
 * arquivo) na mensagem. Só o SQLSTATE (5 caracteres), direto ou em `cause`; senão um código fixo.
 */
export function codigoDeErroBanco(e: unknown): string {
  for (let x: unknown = e, i = 0; x && typeof x === "object" && i < 4; x = (x as { cause?: unknown }).cause, i++) {
    const c = (x as { code?: unknown }).code;
    if (typeof c === "string" && /^[0-9A-Z]{5}$/.test(c)) return `banco:${c}`;
  }
  return "falha";
}
const ate255 = (s: string | null | undefined) => (typeof s === "string" ? s.slice(0, 255) : null);
/**
 * O arquivo já está com `nome` porque um PATCH NOSSO foi aplicado numa passagem que não terminou? Exige a marca de PATCH
 * tentado, o mesmo alvo e um "antes" lido no Drive diferente do alvo. (A marca só sobrevive a sucesso, 5xx e tempo
 * esgotado; num 4xx ela é limpa.)
 */
function patchNossoAplicado(doc: Doc, nome: string): boolean {
  // o alvo ou o `drive_name_applied` (o alvo mudou, o PATCH novo não foi aplicado e o nome calculado VOLTOU ao anterior)
  return doc.drive_patch_attempted === true && (doc.drive_name_target === nome || doc.drive_name_applied === nome)
    && doc.drive_name_before_origem === "drive" && doc.drive_name_before != null && doc.drive_name_before !== nome;
}

type Executor = Pick<ReturnType<typeof getDb>, "execute">;
const DOCS_SQL = (projetoId?: number) => sql`SELECT id, project_id, original_name, canonical_name, drive_file_id, drive_rename_failures, drive_renamed_at, drive_name_before, drive_name_before_origem, drive_name_target, drive_patch_attempted, drive_rename_error, drive_name_applied FROM project_documents
  WHERE status IN ('active', 'substituted') AND drive_file_id IS NOT NULL AND drive_file_id <> ''
  ${projetoId === undefined ? sql`` : sql`AND project_id = ${projetoId}`} ORDER BY project_id, id`;
const lerDocs = async (db: Executor, projetoId?: number) => (await db.execute(DOCS_SQL(projetoId)) as unknown as Linhas<Doc>).rows;
/** Nomes gravados de TODOS os registros (qualquer status) dos projetos: base da conferência de colisão. */
const lerNomesGravados = async (db: Executor, ids: number[]) => ids.length
  ? (await db.execute(sql`SELECT id, project_id, canonical_name, drive_name_target, drive_name_applied, drive_patch_attempted FROM project_documents WHERE project_id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`) as unknown as Linhas<NomeGravado>).rows
  : [];

/**
 * Confere (`conferir: true`, sem tocar no Drive nem no banco) ou renomeia um lote (até `limite`, dentro de `prazoMs`).
 */
export async function renomearDocumentosProjetoNoDrive(
  opcoes: { conferir: boolean; limite?: number; prazoMs?: number },
  deps: DependenciasNomesDrive = reais(),
): Promise<ResumoNomesDrive> {
  const inicio = deps.agora();
  const limite = Math.max(1, Math.min(opcoes.limite ?? LOTE_NOMES_DRIVE, 100));
  const prazoMs = opcoes.prazoMs ?? 30_000;
  const resumo: ResumoNomesDrive = { conferir: opcoes.conferir, pendentes: 0, renomeados: 0, jaEstavam: 0, naoTocados: 0, falhas: 0, falhasTemporarias: 0, desistidos: 0, colisoes: 0, mudaram: 0, ocupados: 0, semVinculoNaTela: 0, restante: false };
  if (!opcoes.conferir && !(await deps.configurado())) return { ...resumo, pulado: "drive_nao_configurado" };
  const db = getDb();
  const docs = await lerDocs(db);
  if (!docs.length) return resumo;
  const idsProjetos = Array.from(new Set(docs.map(d => Number(d.project_id))));
  const listaIds = sql.join(idsProjetos.map(id => sql`${id}`), sql`, `);
  const projetos = (await db.execute(sql`SELECT id, client_name, types, checklist, files FROM operational_projects WHERE id IN (${listaIds})`) as unknown as Linhas<Projeto>).rows;
  const revisoes = (await db.execute(sql`SELECT id, project_id, deliveries FROM project_revision_requests WHERE project_id IN (${listaIds}) ORDER BY id`) as unknown as Linhas<Revisao>).rows;

  // só no modo conferir: a conferência de colisão do modo de escrita é refeita sob a trava, com tudo relido
  const nomesGravados = opcoes.conferir ? await lerNomesGravados(db, idsProjetos) : [];

  const candidatos: Alvo[] = [];
  for (const projeto of projetos) {
    const docsDoProjeto = docs.filter(d => Number(d.project_id) === Number(projeto.id));
    const { alvos, vinculados, mostrados } = planoDoProjeto(projeto, revisoes.filter(r => Number(r.project_id) === Number(projeto.id)), docsDoProjeto);
    resumo.semVinculoNaTela += docsDoProjeto.filter(d => !vinculados.has(d.id)).length;
    const gravadosDoProjeto = nomesGravados.filter(d => Number(d.project_id) === Number(projeto.id));
    for (const alvo of alvos) {
      if (Number(alvo.doc.drive_rename_failures) >= MAX_FALHAS_NOME_DRIVE) { resumo.desistidos++; continue; }
      if (opcoes.conferir && colide(alvo, gravadosDoProjeto, mostrados)) resumo.colisoes++;
      candidatos.push(alvo);
    }
  }
  resumo.semVinculoNaTela += docs.filter(d => !projetos.some(p => Number(p.id) === Number(d.project_id))).length;
  // quem falhou antes vai para o fim: um arquivo com problema não trava o lote dos outros
  // Quem teve falha TEMPORÁRIA na última tentativa (drive_rename_error preenchido, sem contar para a desistência) também
  // vai para depois dos que nunca falharam, e esse grupo roda a cada hora — um arquivo que sempre esgota o tempo não
  // pode ficar sempre em primeiro e impedir os outros (achado do Codex no PR #346).
  const comErro = (a: Alvo) => (a.doc.drive_rename_error ? 1 : 0);
  candidatos.sort((a, b) => Number(a.doc.drive_rename_failures) - Number(b.doc.drive_rename_failures) || comErro(a) - comErro(b) || a.doc.id - b.doc.id);
  const primeiroComErro = candidatos.findIndex(c => Number(c.doc.drive_rename_failures) === 0 && comErro(c) === 1);
  if (primeiroComErro >= 0) {
    let fim = primeiroComErro;
    while (fim < candidatos.length && Number(candidatos[fim].doc.drive_rename_failures) === 0 && comErro(candidatos[fim]) === 1) fim++;
    const grupo = candidatos.slice(primeiroComErro, fim);
    // avança 1 a cada execução do cron (5 por dia, em horas seguidas): dia × 5 + hora dá inteiros consecutivos de um dia
    // para o outro, então toda posição do grupo chega a ser a primeira, qualquer que seja o tamanho dele
    const giro = (Math.floor(inicio / 86_400_000) * 5 + (Math.floor(inicio / 3_600_000) % 24)) % grupo.length;
    candidatos.splice(primeiroComErro, grupo.length, ...grupo.slice(giro), ...grupo.slice(0, giro));
  }
  resumo.pendentes = candidatos.length;
  if (opcoes.conferir) {
    resumo.exemplos = candidatos.slice(0, 10).map(c => ({ id: c.doc.id, antes: c.doc.canonical_name, depois: c.nome }));
    resumo.restante = candidatos.length > 0;
    return resumo;
  }

  let processados = 0;
  const projetosOcupados = new Set<number>();
  /** Prazo de uma chamada ao Drive agora: no máximo PRAZO_ARQUIVO_DRIVE_MS e nunca além do prazo do lote. */
  const prazoDrive = () => Math.max(1, Math.min(PRAZO_ARQUIVO_DRIVE_MS, prazoMs - (deps.agora() - inicio)));
  /** `naTroca`: o erro veio do PATCH (e não da leitura). */
  type Erro = { tipo: "erro"; codigo: string; limiteDeTaxa: boolean; contaFalha: boolean; naTroca: boolean };
  type Desfecho = { tipo: "renomeado" | "ja_estava" | "mudou" | "colisao" } | { tipo: "nao_tocado"; resultado: "lixeira" | "sem_permissao" } | Erro;

  /**
   * Sob a MESMA trava do envio de arquivo (pg_advisory_xact_lock do projeto, como em reservarDocumento) e a linha do
   * projeto, esperando no máximo ESPERA_TRAVA_MS: relê tudo e confere que o nome da tela ainda é o mesmo e que não colide
   * com nenhum registro do projeto. Devolve o alvo relido (ou o motivo de não seguir).
   */
  type Conferido = { alvo: Alvo; projeto: Projeto; revs: Revisao[] };
  async function sobTrava<T>(tx: Executor, projetoId: number, docId: number, nome: string, fn: (c: Conferido) => Promise<T>): Promise<T | { tipo: "mudou" } | { tipo: "colisao" }> {
    await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${ESPERA_TRAVA_MS}ms'`));
    await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${LIMITE_CONSULTA_MS}ms'`));
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`project-document:${projetoId}`}))`);
    const [projeto] = (await tx.execute(sql`SELECT id, client_name, types, checklist, files FROM operational_projects WHERE id = ${projetoId} FOR UPDATE`) as unknown as Linhas<Projeto>).rows;
    if (!projeto) return { tipo: "mudou" };
    const revs = (await tx.execute(sql`SELECT id, project_id, deliveries FROM project_revision_requests WHERE project_id = ${projetoId} ORDER BY id`) as unknown as Linhas<Revisao>).rows;
    const plano = planoDoProjeto(projeto, revs, await lerDocs(tx, projetoId));
    const alvo = plano.alvos.find(a => a.doc.id === docId);
    if (!alvo || alvo.nome !== nome) return { tipo: "mudou" };
    if (colide(alvo, await lerNomesGravados(tx, [projetoId]), plano.mostrados)) return { tipo: "colisao" };
    return fn({ alvo, projeto, revs });
  }
  /** Nome que está hoje na lista da tela e se o original ainda falta (a rotina vai acrescentá-lo). */
  function naLista(c: Conferido): { nome: string | null; semOriginal: boolean } {
    if (c.alvo.origem.tipo === "arquivo") {
      const a = lista<Arquivo>(c.projeto.files)[c.alvo.origem.indice];
      return { nome: a.name ?? null, semOriginal: !a.originalName };
    }
    const { revisaoId, indice } = c.alvo.origem;
    const d = lista<Entrega>(c.revs.find(r => Number(r.id) === revisaoId)?.deliveries)[indice];
    return { nome: d.nome ?? null, semOriginal: !d.nomeOriginal };
  }

  for (const candidato of candidatos) {
    if (processados >= limite) break;
    // só começa um arquivo se ainda couber o pior caso inteiro (2 chamadas ao Drive + 2 esperas de trava)
    if (deps.agora() - inicio + ORCAMENTO_ARQUIVO_MS > prazoMs) break;
    const projetoId = Number(candidato.doc.project_id);
    if (projetosOcupados.has(projetoId)) continue;
    processados++;
    const docId = candidato.doc.id;
    const fileId = candidato.doc.drive_file_id;
    let desfecho: Desfecho;
    /** O nome lido no Drive é um PATCH nosso, aplicado numa passagem anterior para um alvo que depois mudou. */
    let alvoAnteriorAplicado: string | null = null;
    try {
      desfecho = await (async (): Promise<Desfecho> => {
        // 1. LER no Drive (sem trava): o nome atual, lixeira e permissão
        let info: ArquivoNoDrive;
        try { info = await deps.ler(fileId, prazoDrive()); }
        catch (e) { return { tipo: "erro", ...codigoDoErro(e), naTroca: false }; }
        if (info.lixeira) return { tipo: "nao_tocado", resultado: "lixeira" };
        const jaNoNovo = info.nome === candidato.nome;
        if (!jaNoNovo && !info.podeRenomear) return { tipo: "nao_tocado", resultado: "sem_permissao" };

        // 2. GUARDAR o "antes" e CONFIRMAR (transação própria, curta) ANTES de qualquer escrita no Drive.
        //    - Ainda não renomeado por nós (drive_renamed_at nulo) e o nome lido NÃO é o alvo: o "antes" do Drive é o
        //      nome lido AGORA (sobrescreve um "antes" de passagem anterior que não chegou ao fim — alguém pode ter
        //      renomeado à mão no meio); grava também o alvo e a marca de "PATCH tentado".
        //    - Já está com o nome novo: só é nosso se houver a marca, com o mesmo alvo e um "antes" lido no Drive
        //      diferente dele (PATCH aplicado numa passagem que não terminou). Sem isso, alguém renomeou à mão (ou já
        //      estava): o "antes" segue a regra do registro (canonical_name anterior, ESTIMADO) e marca/alvo são limpos.
        //    - Já renomeado por nós antes (drive_renamed_at preenchido): o "antes" fica como está (COALESCE).
        const guardado = await db.transaction(tx => sobTrava(tx, projetoId, docId, candidato.nome, async c => {
          const l = naLista(c);
          const doc = c.alvo.doc;
          let antes = doc.drive_name_before, origem = doc.drive_name_before_origem;
          let alvoDrive = doc.drive_name_target, marca = doc.drive_patch_attempted;
          let aplicado = doc.drive_name_applied;
          if (!jaNoNovo) {
            // o nome lido é um PATCH NOSSO já aplicado para um alvo anterior (o nome da tela mudou depois): o "antes"
            // real continua o guardado; só o alvo muda
            // (ou o `drive_name_applied`: o alvo já tinha mudado e o PATCH para o alvo novo não foi aplicado — 5xx —,
            // então o Drive continua com o nome do PATCH anterior; Codex #346)
            const lidoEhPatchNosso = doc.drive_patch_attempted === true
              && ((doc.drive_name_target != null && info.nome === doc.drive_name_target) || (doc.drive_name_applied != null && info.nome === doc.drive_name_applied));
            if (lidoEhPatchNosso) alvoAnteriorAplicado = info.nome;
            aplicado = lidoEhPatchNosso ? ate255(info.nome) : null;
            if (doc.drive_renamed_at == null && !lidoEhPatchNosso) { antes = ate255(info.nome); origem = "drive"; }
            alvoDrive = ate255(candidato.nome); marca = true;
          } else if (doc.drive_renamed_at == null && !patchNossoAplicado(doc, candidato.nome)) {
            antes = doc.canonical_name !== candidato.nome ? ate255(doc.canonical_name) : null;
            origem = antes ? "registro" : null;
            alvoDrive = null; marca = null; aplicado = null;
          }
          // já está com o nome novo e é um PATCH nosso (pelo alvo ou pelo `drive_name_applied`): o alvo passa a ser este nome
          else if (jaNoNovo && patchNossoAplicado(doc, candidato.nome)) alvoDrive = ate255(candidato.nome);
          await tx.execute(sql`UPDATE project_documents SET
            drive_name_before = ${antes}, drive_name_before_origem = ${origem},
            drive_name_target = ${alvoDrive}, drive_patch_attempted = ${marca}, drive_name_applied = ${aplicado},
            canonical_name_before = COALESCE(canonical_name_before, canonical_name),
            list_name_before = COALESCE(list_name_before, ${ate255(l.nome)}),
            list_original_added = COALESCE(list_original_added, ${l.semOriginal})
            WHERE id = ${docId}`);
          return { tipo: "guardado" as const };
        }));
        if (guardado.tipo !== "guardado") return guardado;

        // 3. RENOMEAR (se preciso) e GRAVAR o nome nos três lugares, de novo sob a trava e com tudo conferido.
        //    Erro do Drive → nada é gravado aqui (o "antes" já está confirmado).
        return db.transaction(tx => sobTrava(tx, projetoId, docId, candidato.nome, async (c): Promise<Desfecho> => {
          const { alvo, projeto, revs } = c;
          if (!jaNoNovo) {
            try { await deps.trocar(fileId, alvo.nome, prazoDrive()); }
            catch (e) { return { tipo: "erro", ...codigoDoErro(e), naTroca: true }; }
          }
          // grava (congela) o nome mostrado: a tela passa a mostrar este nome como "gravado", sem recalcular
          // (updated_at do projeto/pedido não muda: não é atividade de ninguém)
          if (alvo.origem.tipo === "arquivo") {
            const arquivos = lista<Arquivo>(projeto.files);
            const a = arquivos[alvo.origem.indice];
            arquivos[alvo.origem.indice] = { ...a, name: alvo.nome, originalName: a.originalName || alvo.doc.original_name };
            await tx.execute(sql`UPDATE operational_projects SET files = ${JSON.stringify(arquivos)} WHERE id = ${projetoId}`);
          } else {
            const { revisaoId, indice } = alvo.origem;
            const entregas = lista<Entrega>(revs.find(r => Number(r.id) === revisaoId)!.deliveries);
            const d = entregas[indice];
            entregas[indice] = { ...d, nome: alvo.nome, nomeOriginal: d.nomeOriginal || alvo.doc.original_name };
            await tx.execute(sql`UPDATE project_revision_requests SET deliveries = ${JSON.stringify(entregas)} WHERE id = ${revisaoId}`);
          }
          // "já estava" com a marca de PATCH tentado para este alvo e o nome REAL anterior lido numa passagem antes (banco
          // falhou depois do PATCH, ou o tempo esgotou com o Google já tendo aplicado): o Drive FOI renomeado por nós.
          // Sem a marca (alguém renomeou à mão): não é atribuído à rotina.
          const fomosNos = !jaNoNovo || patchNossoAplicado(alvo.doc, alvo.nome);
          // só o nome do Drive (canonical_name) muda no registro; original_name fica como estava
          await tx.execute(sql`UPDATE project_documents SET canonical_name = ${alvo.nome}, drive_rename_error = NULL, drive_name_applied = NULL,
            list_name_target = ${ate255(alvo.nome)},
            drive_renamed_at = ${!jaNoNovo ? sql`now()` : fomosNos ? sql`COALESCE(drive_renamed_at, now())` : sql`drive_renamed_at`},
            updated_at = now()
            WHERE id = ${docId}`);
          return { tipo: fomosNos ? "renomeado" : "ja_estava" };
        }));
      })();
    } catch (e) {
      if (consultaLenta(e)) {
        // statement_timeout (também depois de um PATCH): a transação foi desfeita; o "antes" e a marca já estavam
        // confirmados, então a passagem seguinte completa. Falha temporária deste arquivo; o lote segue.
        console.error("[projetos/nome-drive] documento", docId, "banco:57014");
        resumo.falhasTemporarias++;
        await db.execute(sql`UPDATE project_documents SET drive_rename_error = 'banco:57014' WHERE id = ${docId}`).catch(() => undefined);
        continue;
      }
      if (!travaOcupada(e)) throw e;
      projetosOcupados.add(projetoId);
      resumo.ocupados++;
      continue;
    }
    switch (desfecho.tipo) {
      case "renomeado": resumo.renomeados++; break;
      case "ja_estava": resumo.jaEstavam++; break;
      case "mudou": resumo.mudaram++; break;
      case "colisao":
        resumo.colisoes++;
        // fica marcado (só o código) para ir para depois dos que nunca falharam: arquivos presos em colisão não podem
        // ocupar o lote inteiro em toda execução (Codex #346). Não conta para a desistência.
        await db.execute(sql`UPDATE project_documents SET drive_rename_error = 'colisao' WHERE id = ${docId}`);
        break;
      case "nao_tocado":
        resumo.naoTocados++;
        await db.execute(sql`UPDATE project_documents SET drive_rename_failures = drive_rename_failures + 1, drive_rename_error = ${desfecho.resultado} WHERE id = ${docId}`);
        break;
      case "erro":
        console.error("[projetos/nome-drive] documento", docId, desfecho.codigo);
        if (desfecho.naTroca && (desfecho.contaFalha || desfecho.limiteDeTaxa)) {
          // PATCH recusado (4xx, inclusive limite de taxa): NÃO foi aplicado — limpa o "antes" do Drive, o alvo e a
          // marca (a passagem seguinte lê de novo). Só se a rotina ainda não renomeou este arquivo antes.
          // Exceção (Codex #346): o arquivo está com um nome que um PATCH NOSSO anterior aplicou — o "antes" real e a
          // marca continuam valendo; só o alvo volta a ser o que está de fato no Drive.
          if (alvoAnteriorAplicado) {
            await db.execute(sql`UPDATE project_documents SET drive_name_target = ${alvoAnteriorAplicado} WHERE id = ${docId} AND drive_renamed_at IS NULL`);
          } else {
            await db.execute(sql`UPDATE project_documents SET drive_name_before = NULL, drive_name_before_origem = NULL,
              drive_name_target = NULL, drive_patch_attempted = NULL, drive_name_applied = NULL WHERE id = ${docId} AND drive_renamed_at IS NULL`);
          }
        }
        if (desfecho.limiteDeTaxa) { processados = limite; break; } // limite de taxa do Google: para o lote sem contar como falha do arquivo
        if (!desfecho.contaFalha) {
          // 5xx / tempo esgotado: registra o código, sem contar para a desistência
          resumo.falhasTemporarias++;
          await db.execute(sql`UPDATE project_documents SET drive_rename_error = ${desfecho.codigo} WHERE id = ${docId}`);
          break;
        }
        resumo.falhas++;
        await db.execute(sql`UPDATE project_documents SET drive_rename_failures = drive_rename_failures + 1, drive_rename_error = ${desfecho.codigo} WHERE id = ${docId}`);
        break;
    }
  }
  resumo.restante = resumo.pendentes - resumo.renomeados - resumo.jaEstavam > 0;
  return resumo;
}

/** Resposta do cron no modo "um dia só conferindo": SÓ contagens (nunca os exemplos, que têm nome de cliente). */
export type ConferenciaNomesDriveCron = Pick<ResumoNomesDrive, "conferir" | "pendentes" | "semVinculoNaTela" | "desistidos" | "colisoes">;

/**
 * Dentro do cron que já existe (avisos da Dolores da tarde, 15h–19h de Brasília; sem cron novo e sem botão novo): um lote
 * por execução, só com o segredo do cron (`autorizado` = cronAutorizado do cabeçalho, conferido por quem chama) e com o
 * tempo que sobra. Sem nada pendente, é uma leitura do banco e mais nada. Nunca lança nem muda a resposta do cron.
 * Só ESCREVE (Drive e banco) com `PROJETOS_NOME_DRIVE_ESCREVER=1`; sem ela, só confere e devolve contagens.
 */
export async function renomearNomesDriveNoCron(autorizado: boolean, prazoMs: number, deps?: DependenciasNomesDrive): Promise<ResumoNomesDrive | ConferenciaNomesDriveCron | { pulado: true } | { erro: true }> {
  if (!autorizado || prazoMs < 3_000) return { pulado: true };
  try {
    if (process.env.PROJETOS_NOME_DRIVE_ESCREVER !== "1") {
      const r = await renomearDocumentosProjetoNoDrive({ conferir: true }, deps);
      return { conferir: true, pendentes: r.pendentes, semVinculoNaTela: r.semVinculoNaTela, desistidos: r.desistidos, colisoes: r.colisoes };
    }
    return await renomearDocumentosProjetoNoDrive({ conferir: false, limite: LOTE_NOMES_DRIVE, prazoMs }, deps);
  } catch (e) {
    // ex.: migração 0175 ainda não aplicada (coluna ausente) — fica para a próxima execução
    // só o código: a mensagem do Drizzle traz os parâmetros da consulta (nomes de cliente e de arquivo)
    console.error("[projetos/nome-drive]", codigoDeErroBanco(e));
    return { erro: true };
  }
}
