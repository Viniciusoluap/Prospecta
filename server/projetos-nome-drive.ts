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
// sobrescrito): drive_name_before (o nome que o arquivo tinha NO DRIVE, lido antes de renomear), list_name_before (o
// `name`/`nome` que estava na lista) e list_original_added (se a rotina acrescentou `originalName`/`nomeOriginal`).
// Falha num arquivo não interrompe os outros e fica registrada (só o código, sem dados pessoais). Só erro 4xx do Google
// (fora limite de taxa) conta para as MAX_FALHAS_NOME_DRIVE falhas; 5xx e tempo esgotado ficam para a próxima.
import { sql } from "drizzle-orm";
import { getDb } from "./db.js";
import { comPrazoNoDrive, driveConfigured, renomearArquivoNoDrive, type RenomeDrive } from "./drive-documents.js";
import { ErroDrive } from "../shared/drive-erro.js";
import { PROJECT_TYPE_LABELS } from "../shared/operacional.js";
import { clienteCurtoArquivoProjeto, ehNomePadraoArquivoProjeto, nomePadraoArquivoProjeto, nomesPadraoArquivosProjeto, projectChecklist, type ProjectCheck } from "../shared/projeto-documentos.js";

export const LOTE_NOMES_DRIVE = 25;
/** Depois de tantas falhas no mesmo arquivo, a rotina deixa de tentar (fica registrado em drive_rename_error). */
export const MAX_FALHAS_NOME_DRIVE = 5;
/** Prazo máximo de cada chamada ao Drive; o lote só começa um arquivo se ainda couber esse tempo inteiro. */
export const PRAZO_ARQUIVO_DRIVE_MS = 8_000;

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
  /** Projeto ocupado por outra gravação por mais de 5 s (lock_timeout): pulado nesta execução, sem contar falha. */
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
  /** `prazoMs`: no máximo PRAZO_ARQUIVO_DRIVE_MS (as chamadas ao Drive são canceladas ao passar disso). */
  renomear: (fileId: string, nome: string, prazoMs: number) => Promise<RenomeDrive>;
  agora: () => number;
}
const reais = (): DependenciasNomesDrive => ({ configurado: driveConfigured, renomear: (id, nome, prazoMs) => comPrazoNoDrive(prazoMs, () => renomearArquivoNoDrive(id, nome)), agora: Date.now });

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
type NomeGravado = { id: number; project_id: number; canonical_name: string };
function colide(alvo: Alvo, nomesGravados: NomeGravado[], mostrados: { nome: string; docId?: number }[]): boolean {
  const n = minusculo(alvo.nome);
  return nomesGravados.some(d => Number(d.id) !== alvo.doc.id && minusculo(d.canonical_name) === n)
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

/** lock_timeout estourado (SQLSTATE 55P03), direto do driver ou embrulhado pelo Drizzle em `cause`. */
function travaOcupada(e: unknown): boolean {
  for (let x: unknown = e, i = 0; x && typeof x === "object" && i < 4; x = (x as { cause?: unknown }).cause, i++) {
    if ((x as { code?: unknown }).code === "55P03") return true;
  }
  return false;
}
const ate255 = (s: string | null | undefined) => (typeof s === "string" ? s.slice(0, 255) : null);

type Executor = Pick<ReturnType<typeof getDb>, "execute">;
const DOCS_SQL = (projetoId?: number) => sql`SELECT id, project_id, original_name, canonical_name, drive_file_id, drive_rename_failures FROM project_documents
  WHERE status IN ('active', 'substituted') AND drive_file_id IS NOT NULL AND drive_file_id <> ''
  ${projetoId === undefined ? sql`` : sql`AND project_id = ${projetoId}`} ORDER BY project_id, id`;
const lerDocs = async (db: Executor, projetoId?: number) => (await db.execute(DOCS_SQL(projetoId)) as unknown as Linhas<Doc>).rows;
/** Nomes gravados de TODOS os registros (qualquer status) dos projetos: base da conferência de colisão. */
const lerNomesGravados = async (db: Executor, ids: number[]) => ids.length
  ? (await db.execute(sql`SELECT id, project_id, canonical_name FROM project_documents WHERE project_id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`) as unknown as Linhas<NomeGravado>).rows
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
  const prazoMs = opcoes.prazoMs ?? 20_000;
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
  candidatos.sort((a, b) => Number(a.doc.drive_rename_failures) - Number(b.doc.drive_rename_failures) || a.doc.id - b.doc.id);
  resumo.pendentes = candidatos.length;
  if (opcoes.conferir) {
    resumo.exemplos = candidatos.slice(0, 10).map(c => ({ id: c.doc.id, antes: c.doc.canonical_name, depois: c.nome }));
    resumo.restante = candidatos.length > 0;
    return resumo;
  }

  let processados = 0;
  const projetosOcupados = new Set<number>();
  for (const candidato of candidatos) {
    if (processados >= limite) break;
    // só começa um arquivo se ainda couber o prazo inteiro de uma chamada ao Drive (nunca passa do prazo do cron)
    const decorrido = deps.agora() - inicio;
    if (decorrido + PRAZO_ARQUIVO_DRIVE_MS > prazoMs) break;
    const prazoDrive = Math.min(PRAZO_ARQUIVO_DRIVE_MS, prazoMs - decorrido);
    const projetoId = Number(candidato.doc.project_id);
    if (projetosOcupados.has(projetoId)) continue;
    processados++;
    const docId = candidato.doc.id;
    // Sob a MESMA trava do envio de arquivo (pg_advisory_xact_lock do projeto, como em reservarDocumento) e a linha do
    // projeto: relê tudo, confere que o nome da tela ainda é o mesmo e que não colide com nenhum registro do projeto,
    // renomeia no Drive e grava o nome nos três lugares. Erro do Drive → nada é gravado aqui. Esperar mais de 5 s por
    // uma trava → o projeto fica para a próxima execução.
    let desfecho;
    try {
      desfecho = await db.transaction(async tx => {
        await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`project-document:${projetoId}`}))`);
        const [projeto] = (await tx.execute(sql`SELECT id, client_name, types, checklist, files FROM operational_projects WHERE id = ${projetoId} FOR UPDATE`) as unknown as Linhas<Projeto>).rows;
        if (!projeto) return { tipo: "mudou" as const };
        const revs = (await tx.execute(sql`SELECT id, project_id, deliveries FROM project_revision_requests WHERE project_id = ${projetoId} ORDER BY id`) as unknown as Linhas<Revisao>).rows;
        const docsAgora = await lerDocs(tx, projetoId);
        const plano = planoDoProjeto(projeto, revs, docsAgora);
        const alvo = plano.alvos.find(a => a.doc.id === docId);
        if (!alvo || alvo.nome !== candidato.nome) return { tipo: "mudou" as const };
        if (colide(alvo, await lerNomesGravados(tx, [projetoId]), plano.mostrados)) return { tipo: "colisao" as const };
        let renome: RenomeDrive;
        try { renome = await deps.renomear(alvo.doc.drive_file_id, alvo.nome, prazoDrive); }
        catch (e) { return { tipo: "erro" as const, ...codigoDoErro(e) }; }
        const { resultado, nomeAnterior } = renome;
        if (resultado === "lixeira" || resultado === "sem_permissao") return { tipo: "nao_tocado" as const, resultado };
        // grava (congela) o nome mostrado: a tela passa a mostrar este nome como "gravado", sem recalcular
        // (updated_at do projeto/pedido não muda: não é atividade de ninguém)
        let nomeNaLista: string | null;
        let originalAcrescentado: boolean;
        if (alvo.origem.tipo === "arquivo") {
          const arquivos = lista<Arquivo>(projeto.files);
          const a = arquivos[alvo.origem.indice];
          nomeNaLista = a.name ?? null;
          originalAcrescentado = !a.originalName;
          arquivos[alvo.origem.indice] = { ...a, name: alvo.nome, originalName: a.originalName || alvo.doc.original_name };
          await tx.execute(sql`UPDATE operational_projects SET files = ${JSON.stringify(arquivos)} WHERE id = ${projetoId}`);
        } else {
          const { revisaoId, indice } = alvo.origem;
          const rev = revs.find(r => Number(r.id) === revisaoId)!;
          const entregas = lista<Entrega>(rev.deliveries);
          const d = entregas[indice];
          nomeNaLista = d.nome ?? null;
          originalAcrescentado = !d.nomeOriginal;
          entregas[indice] = { ...d, nome: alvo.nome, nomeOriginal: d.nomeOriginal || alvo.doc.original_name };
          await tx.execute(sql`UPDATE project_revision_requests SET deliveries = ${JSON.stringify(entregas)} WHERE id = ${revisaoId}`);
        }
        // só o nome do Drive (canonical_name) muda no registro; original_name fica como estava. O "antes" (para desfazer)
        // é gravado uma vez só: um valor já guardado nunca é sobrescrito.
        await tx.execute(sql`UPDATE project_documents SET canonical_name = ${alvo.nome}, drive_rename_error = NULL,
          drive_renamed_at = CASE WHEN ${resultado === "renomeado"} THEN now() ELSE drive_renamed_at END,
          drive_name_before = COALESCE(drive_name_before, ${ate255(nomeAnterior)}),
          list_name_before = COALESCE(list_name_before, ${ate255(nomeNaLista)}),
          list_original_added = COALESCE(list_original_added, ${originalAcrescentado}),
          updated_at = now()
          WHERE id = ${docId}`);
        return { tipo: resultado };
      });
    } catch (e) {
      if (!travaOcupada(e)) throw e;
      projetosOcupados.add(projetoId);
      resumo.ocupados++;
      continue;
    }
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
    console.error("[projetos/nome-drive]", e instanceof Error ? e.message.slice(0, 200) : "falha");
    return { erro: true };
  }
}
