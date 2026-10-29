import { createHash } from "node:crypto";
// Pedido de 29/10: "Organizar Drive" — reconciliação idempotente e retomável
// entre o banco e o Google Drive (mesma regra no Grupo Santa Fé):
//   a) envia ao Drive o que está só no banco (preenche drive_file_id);
//   b) move/renomeia o que já está no Drive para o caminho certo;
//   c) manda para a lixeira as pastas de registros que não existem mais
//      (lead apagado, obra apagada…). Lead só arquivado NÃO é órfão; pasta sem
//      etiqueta do sistema nunca é tocada; pasta com arquivo ainda usado por
//      algum registro fica (é reorganizada antes);
//   d) devolve um relatório sem dados pessoais.
// Cada execução respeita um prazo (~45 s; a função da Vercel tem 60 s) e
// processa em lotes; a próxima continua de onde parou (cursor em drive_sync_state).
// Nada de exclusão permanente: só lixeira do Drive (recuperável por 30 dias).
import { sql } from "drizzle-orm";
import { CATEGORIAS_ENTIDADE, chaveEntidade, chaveProjetoPortfolio, entidadeDaChave, type EntidadeDrive, type EntidadeRegistro } from "../shared/drive-estrutura.js";
import { arquivosDoLead, arquivosEmUso, destinoAtualDoArquivo, FONTES_ARQUIVOS, planilhaImportada, registrosExistentes, type DestinoDrive, type FonteArquivos } from "./drive-arquivos.js";
import {
  arquivoNaPastaPorPrefixo, arquivosNaPasta, driveConfigured, lixeiraPorId, moverArquivoParaDestino, pastaPorChave, subpastasDaCategoria,
  uploadArquivoNoCaminho, type CachePastas,
} from "./drive-documents.js";
import { getDb } from "./db.js";

export interface RelatorioOrganizacao {
  iniciadoEm: string;
  terminadoEm: string;
  /** Arquivos que estavam só no banco e foram enviados ao Drive. */
  enviados: number;
  /** Cópias que já estavam no Drive sem a referência no banco e foram reconhecidas. */
  reconhecidos: number;
  movidos: number;
  /** Arquivos que não existem mais no Drive (apagados pelo dono ou de outra conta). */
  ignorados: number;
  pastasOrfasNaLixeira: number;
  /** Pastas órfãs que ainda têm arquivo usado por algum registro: ficam até a reorganização tirá-lo. */
  pastasAguardando: number;
  arquivosNaLixeira: number;
  falhas: number;
  /** true quando tudo foi percorrido dentro do prazo; false = a próxima execução continua. */
  concluido: boolean;
  motivo: string | null;
  /** Proteção acionada (ex.: órfãs demais numa página) — nada foi apagado. */
  aviso: string | null;
}

export interface CursorOrganizacao {
  mover?: { fonte: number; aposId: number };
  orfaos?: { categoria: number; pagina: string | null };
}

export interface ItemFila { id: number; kind: "arquivo" | "pasta"; target: string }

export interface DependenciasOrganizador {
  configurado(): Promise<boolean>;
  fontes: FonteArquivos[];
  upload(destino: DestinoDrive, mime: string, dados: Buffer, cache: CachePastas): Promise<string>;
  mover(fileId: string, destino: DestinoDrive, cache: CachePastas): Promise<"movido" | "no_lugar" | "ignorado" | "falha">;
  adotar(chavePasta: string, prefixo: string, md5: string): Promise<string | null>;
  subpastas(chaveCategoria: string, pagina: string | null): Promise<{ pastas: { id: string; chave: string | null }[]; proximaPagina: string | null }>;
  arquivosNaPasta(pastaId: string): Promise<string[]>;
  pastaPorChave(chave: string): Promise<{ id: string } | null>;
  emUso(ids: string[]): Promise<Set<string>>;
  existentes(entidade: EntidadeRegistro, ids: number[]): Promise<Set<number>>;
  lixeira(id: string): Promise<void>;
  fila: { listar(limite: number): Promise<ItemFila[]>; remover(id: number): Promise<void>; falhou(id: number): Promise<void> };
  estado: { ler(): Promise<CursorOrganizacao>; gravar(cursor: CursorOrganizacao, relatorio: RelatorioOrganizacao): Promise<void> };
  agora(): number;
}

export interface OpcoesOrganizador {
  /** Tempo máximo de trabalho por execução. */
  prazoMs?: number;
  /** Itens por consulta/rodada de cada fonte. */
  lote?: number;
  /** Teto de pastas órfãs para a lixeira por execução (proteção). */
  maxOrfas?: number;
}

const mensagem = (e: unknown) => (e instanceof Error ? e.message : "erro desconhecido");

/** Pasta → lixeira só se nenhum arquivo dentro dela ainda é usado por um registro. */
async function lixeiraPastaSegura(deps: DependenciasOrganizador, pastaId: string): Promise<"lixeira" | "em_uso"> {
  const ids = await deps.arquivosNaPasta(pastaId);
  if (ids.length && (await deps.emUso(ids)).size) return "em_uso";
  await deps.lixeira(pastaId);
  return "lixeira";
}

/** Todas as pastas com a etiqueta (pode haver duplicadas antigas). */
async function lixeiraPorChave(deps: DependenciasOrganizador, chave: string): Promise<"lixeira" | "sem_pasta" | "em_uso"> {
  let resultado: "lixeira" | "sem_pasta" = "sem_pasta";
  for (let i = 0; i < 5; i++) {
    const pasta = await deps.pastaPorChave(chave);
    if (!pasta) return resultado;
    if ((await lixeiraPastaSegura(deps, pasta.id)) === "em_uso") return "em_uso";
    resultado = "lixeira";
  }
  return resultado;
}

export async function organizarDrive(deps: DependenciasOrganizador, opcoes: OpcoesOrganizador = {}): Promise<RelatorioOrganizacao> {
  const prazoMs = opcoes.prazoMs ?? 45_000;
  const lote = opcoes.lote ?? 25;
  const maxOrfas = opcoes.maxOrfas ?? 50;
  const inicio = deps.agora();
  const temTempo = () => deps.agora() - inicio < prazoMs;
  const r: RelatorioOrganizacao = {
    iniciadoEm: new Date(inicio).toISOString(), terminadoEm: "", enviados: 0, reconhecidos: 0, movidos: 0, ignorados: 0,
    pastasOrfasNaLixeira: 0, pastasAguardando: 0, arquivosNaLixeira: 0, falhas: 0, concluido: false, motivo: null, aviso: null,
  };
  const fim = () => ({ ...r, terminadoEm: new Date(deps.agora()).toISOString() });

  if (!(await deps.configurado())) {
    r.motivo = "Google Drive não configurado: os arquivos continuam guardados no banco do sistema.";
    return fim();
  }
  const cursor = await deps.estado.ler();
  const cache: CachePastas = new Map();

  // 1) Lixeira que falhou na hora da exclusão.
  for (const item of await deps.fila.listar(50)) {
    if (!temTempo()) break;
    try {
      if (item.kind === "arquivo") {
        if (!(await deps.emUso([item.target])).size) { await deps.lixeira(item.target); r.arquivosNaLixeira += 1; }
        await deps.fila.remover(item.id);
      } else {
        const x = await lixeiraPorChave(deps, item.target);
        if (x === "em_uso") { r.pastasAguardando += 1; await deps.fila.falhou(item.id); continue; }
        if (x === "lixeira") r.pastasOrfasNaLixeira += 1;
        await deps.fila.remover(item.id);
      }
    } catch (e) {
      r.falhas += 1;
      console.error("[drive-organizar] lixeira pendente:", mensagem(e));
      await deps.fila.falhou(item.id).catch(() => undefined);
    }
  }

  // 2) Envio do que está só no banco — rodadas alternando as fontes, para nenhuma ficar sem vez.
  const comPendentes = deps.fontes.filter((f) => f.pendentes);
  const posicao = new Map<string, number>(comPendentes.map((f) => [f.tipo, 0]));
  let pendentesEsgotados = false;
  while (temTempo()) {
    let algum = false;
    for (const fonte of comPendentes) {
      if (!temTempo()) break;
      const apos = posicao.get(fonte.tipo);
      if (apos === undefined) continue;
      const itens = await fonte.pendentes!({ aposId: apos, limite: lote });
      if (!itens.length) { posicao.delete(fonte.tipo); continue; }
      algum = true;
      for (const item of itens) {
        if (!temTempo()) break;
        posicao.set(fonte.tipo, item.id);
        try {
          const destino = await item.destino();
          const dados = await item.carregar();
          if (!dados?.length) continue;
          // Só adota cópia antiga com o MESMO conteúdo (MD5); senão envia os bytes do banco.
          let id = item.adotarPrefixo
            ? await deps.adotar(destino.caminho[destino.caminho.length - 1].chave, item.adotarPrefixo, createHash("md5").update(dados).digest("hex"))
            : null;
          if (id) r.reconhecidos += 1;
          else {
            id = await deps.upload(destino, item.mime, dados, cache);
            r.enviados += 1;
          }
          await item.gravar(id);
        } catch (e) {
          r.falhas += 1;
          console.error(`[drive-organizar] envio (${item.tipo}):`, mensagem(e));
        }
      }
    }
    if (!algum) { pendentesEsgotados = true; break; }
  }

  // 3) Reorganização do que já está no Drive (cursor: fonte + último id).
  let moverCompleto = false;
  const m = { fonte: cursor.mover?.fonte ?? 0, aposId: cursor.mover?.aposId ?? 0 };
  while (temTempo()) {
    const fonte = deps.fontes[m.fonte];
    if (!fonte) { moverCompleto = true; m.fonte = 0; m.aposId = 0; break; }
    const itens = await fonte.noDrive(m.aposId, lote);
    if (!itens.length) { m.fonte += 1; m.aposId = 0; continue; }
    for (const item of itens) {
      if (!temTempo()) break;
      try {
        const x = await deps.mover(item.driveFileId, await item.destino(), cache);
        if (x === "movido") r.movidos += 1;
        else if (x === "ignorado") r.ignorados += 1;
        else if (x === "falha") r.falhas += 1;
      } catch (e) {
        r.falhas += 1;
        console.error(`[drive-organizar] reorganização (${item.tipo}):`, mensagem(e));
      }
      m.aposId = item.id;
    }
  }

  // 4) Pastas órfãs: uma página de subpastas por vez em cada categoria.
  let orfaosCompleto = false;
  const o = { categoria: cursor.orfaos?.categoria ?? 0, pagina: cursor.orfaos?.pagina ?? null };
  let orfasNestaExecucao = 0;
  while (temTempo() && orfasNestaExecucao < maxOrfas) {
    const cat = CATEGORIAS_ENTIDADE[o.categoria];
    if (!cat) { orfaosCompleto = true; o.categoria = 0; o.pagina = null; break; }
    try {
      const { pastas, proximaPagina } = await deps.subpastas(cat.chaveCategoria, o.pagina);
      // Só pastas de entidade com etiqueta; em Clientes também o portfólio de projeto sem lead.
      const comId = pastas.flatMap((p) => {
        const e = entidadeDaChave(p.chave);
        return e && (e.entidade === cat.entidade || (cat.entidade === "cliente" && e.entidade === "projeto")) ? [{ pasta: p.id, ...e }] : [];
      });
      const orfas: typeof comId = [];
      for (const entidade of Array.from(new Set(comId.map((p) => p.entidade)))) {
        const doTipo = comId.filter((p) => p.entidade === entidade);
        const existem = await deps.existentes(entidade, doTipo.map((p) => p.id));
        orfas.push(...doTipo.filter((p) => !existem.has(p.id)));
      }
      // Proteção (mesma regra do Santa Fé): muitas "órfãs" de uma vez indicam banco errado/vazio — não apaga nada.
      if (orfas.length > 25 && orfas.length * 2 > comId.length) {
        r.aviso = `Organização das pastas suspensa: ${orfas.length} de ${comId.length} pastas em "${cat.chaveCategoria}" parecem sem registro no banco. Nada foi apagado; confira a conexão do banco e do Drive.`;
        if (proximaPagina) o.pagina = proximaPagina;
        else { o.categoria += 1; o.pagina = null; }
        continue;
      }
      let paginaInteira = true;
      for (const p of orfas) {
        if (!temTempo() || orfasNestaExecucao >= maxOrfas) { paginaInteira = false; break; }
        try {
          if ((await lixeiraPastaSegura(deps, p.pasta)) === "lixeira") { r.pastasOrfasNaLixeira += 1; orfasNestaExecucao += 1; }
          else r.pastasAguardando += 1;
        } catch (e) {
          r.falhas += 1;
          console.error(`[drive-organizar] pasta órfã (${cat.entidade}):`, mensagem(e));
        }
      }
      if (!paginaInteira) break; // a mesma página é revista na próxima execução
      if (proximaPagina) o.pagina = proximaPagina;
      else { o.categoria += 1; o.pagina = null; }
    } catch (e) {
      r.falhas += 1;
      console.error(`[drive-organizar] listagem de pastas (${cat.entidade}):`, mensagem(e));
      o.categoria += 1; o.pagina = null;
    }
  }

  r.concluido = pendentesEsgotados && moverCompleto && orfaosCompleto;
  const relatorio = fim();
  await deps.estado.gravar({ mover: m, orfaos: o }, relatorio);
  return relatorio;
}

// ─── Dependências reais ──────────────────────────────────────────────────────

type Linhas<T> = { rows: T[] };

async function enfileirarLixeira(kind: "arquivo" | "pasta", target: string): Promise<void> {
  await getDb().execute(sql`INSERT INTO drive_trash_queue (kind, target) VALUES (${kind}, ${target}) ON CONFLICT (kind, target) DO NOTHING`)
    .catch((e) => console.error("[drive-organizar] fila da lixeira:", mensagem(e)));
}

async function lerEstado(): Promise<{ cursor: CursorOrganizacao; relatorio: RelatorioOrganizacao | null; executadoEm: Date | null }> {
  const r = await getDb().execute(sql`SELECT cursor, last_report, last_run_at FROM drive_sync_state WHERE id = 1`);
  const l = (r as unknown as Linhas<{ cursor: CursorOrganizacao | null; last_report: RelatorioOrganizacao | null; last_run_at: string | Date | null }>).rows[0];
  return { cursor: l?.cursor ?? {}, relatorio: l?.last_report ?? null, executadoEm: l?.last_run_at ? new Date(l.last_run_at) : null };
}

const TRAVA_MS = 90_000;

/** Evita duas execuções ao mesmo tempo (cron e botão): trava com validade no próprio estado. */
async function travar(): Promise<boolean> {
  const db = getDb();
  await db.execute(sql`INSERT INTO drive_sync_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
  const ate = new Date(Date.now() + TRAVA_MS).toISOString();
  const r = await db.execute(sql`UPDATE drive_sync_state SET cursor = jsonb_set(cursor, '{travaAte}', to_jsonb(${ate}::text)), updated_at = now()
    WHERE id = 1 AND (cursor->>'travaAte' IS NULL OR (cursor->>'travaAte')::timestamptz < now()) RETURNING id`);
  return (r as unknown as Linhas<unknown>).rows.length === 1;
}

export const dependenciasReais = (): DependenciasOrganizador => ({
  configurado: () => driveConfigured(),
  fontes: FONTES_ARQUIVOS,
  upload: (destino, mime, dados, cache) => uploadArquivoNoCaminho(destino, mime, dados, cache),
  mover: (fileId, destino, cache) => moverArquivoParaDestino(fileId, destino, cache),
  adotar: (chavePasta, prefixo, md5) => arquivoNaPastaPorPrefixo(chavePasta, prefixo, md5),
  subpastas: (chave, pagina) => subpastasDaCategoria(chave, pagina),
  arquivosNaPasta: (id) => arquivosNaPasta(id),
  pastaPorChave: (chave) => pastaPorChave(chave),
  emUso: (ids) => arquivosEmUso(ids),
  existentes: (entidade, ids) => registrosExistentes(entidade, ids),
  lixeira: (id) => lixeiraPorId(id),
  fila: {
    async listar(limite) {
      const r = await getDb().execute(sql`SELECT id, kind, target FROM drive_trash_queue ORDER BY attempts, id LIMIT ${limite}`);
      return (r as unknown as Linhas<ItemFila>).rows;
    },
    async remover(id) { await getDb().execute(sql`DELETE FROM drive_trash_queue WHERE id = ${id}`); },
    async falhou(id) { await getDb().execute(sql`UPDATE drive_trash_queue SET attempts = attempts + 1 WHERE id = ${id}`); },
  },
  estado: {
    ler: async () => (await lerEstado()).cursor,
    async gravar(cursor, relatorio) {
      await getDb().execute(sql`INSERT INTO drive_sync_state (id, cursor, last_report, last_run_at, updated_at)
        VALUES (1, ${JSON.stringify(cursor)}::jsonb, ${JSON.stringify(relatorio)}::jsonb, now(), now())
        ON CONFLICT (id) DO UPDATE SET cursor = EXCLUDED.cursor, last_report = EXCLUDED.last_report, last_run_at = now(), updated_at = now()`);
    },
  },
  agora: () => Date.now(),
});

/** Cron diário e botão "Organizar Drive agora". Execução já em andamento → devolve aviso, sem rodar de novo. */
export async function organizarDriveAgora(opcoes: OpcoesOrganizador = {}): Promise<RelatorioOrganizacao | { emAndamento: true }> {
  if (!(await driveConfigured())) return organizarDrive(dependenciasReais(), opcoes);
  if (!(await travar())) return { emAndamento: true };
  return organizarDrive(dependenciasReais(), opcoes);
}

export async function ultimaOrganizacaoDrive(): Promise<{ relatorio: RelatorioOrganizacao | null; executadoEm: Date | null }> {
  try {
    const e = await lerEstado();
    return { relatorio: e.relatorio, executadoEm: e.executadoEm };
  } catch {
    return { relatorio: null, executadoEm: null };
  }
}

// ─── Exclusões: o registro sai do banco primeiro; depois a lixeira do Drive ───

/**
 * Pasta inteira da entidade (cliente:<id>, obra:<id>, incorporacao:<id>,
 * imovel:<id>, equipe:<id>) para a lixeira. Nunca bloqueia a exclusão: sem
 * Drive não faz nada (o organizador acha a pasta órfã depois); falha ou pasta
 * com arquivo ainda em uso → fila, e o organizador resolve.
 */
export async function lixeiraDaEntidade(entidade: EntidadeDrive, id: number, deps: DependenciasOrganizador = dependenciasReais()): Promise<void> {
  await lixeiraDaChave(chaveEntidade(entidade, id), deps);
}

/** Pedido de 29/10: projeto excluído → pasta de portfólio `projeto-<id>` para a lixeira. */
export async function lixeiraDoProjeto(id: number, deps: DependenciasOrganizador = dependenciasReais()): Promise<void> {
  await lixeiraDaChave(chaveProjetoPortfolio(id), deps);
}

async function lixeiraDaChave(chave: string, deps: DependenciasOrganizador): Promise<void> {
  try {
    if (!(await deps.configurado())) return;
    if ((await lixeiraPorChave(deps, chave)) === "em_uso") await enfileirarLixeira("pasta", chave);
  } catch (e) {
    console.error("[drive] pasta não foi para a lixeira agora; fica pendente:", mensagem(e));
    await enfileirarLixeira("pasta", chave);
  }
}

/** Arquivos do lead no Drive, lidos ANTES da exclusão definitiva (depois os vínculos somem). */
export async function arquivosDoLeadNoDrive(leadId: number): Promise<string[]> {
  try { return await arquivosDoLead(leadId); } catch { return []; }
}

/**
 * Lead excluído definitivamente: antes de mandar Clientes/<Nome (nº id)> para a
 * lixeira, tira de dentro dela o que ainda é usado (documento compartilhado com
 * lead duplicado, mídia de WhatsApp que fica na caixa sem o lead). Se algo não
 * puder ser movido, a pasta fica para o sincronizador (fila). Nunca lança.
 */
export async function lixeiraDoLead(
  leadId: number, arquivos: string[], deps: DependenciasOrganizador = dependenciasReais(),
  destinoDe: (driveFileId: string) => Promise<DestinoDrive | null> = destinoAtualDoArquivo,
): Promise<void> {
  const chave = chaveEntidade("cliente", leadId);
  try {
    if (!(await deps.configurado())) return;
    const emUso = arquivos.length ? await deps.emUso(arquivos) : new Set<string>();
    const cache: CachePastas = new Map();
    let pendente = false;
    for (const id of Array.from(emUso)) {
      const destino = await destinoDe(id);
      if (!destino || (await deps.mover(id, destino, cache)) === "falha") pendente = true;
    }
    if (pendente) { await enfileirarLixeira("pasta", chave); return; }
    await lixeiraDaChave(chave, deps);
  } catch (e) {
    console.error("[drive] pasta do lead não foi para a lixeira agora; fica pendente:", mensagem(e));
    await enfileirarLixeira("pasta", chave);
  }
}

/**
 * Fim do cron diário (/api/cron/lead-card-due): organiza o Drive com o tempo que
 * sobra (no máximo 45 s, sem passar de ~50 s desde o início da requisição).
 */
export async function organizarDriveNoCron(inicioRequisicao: number): Promise<RelatorioOrganizacao | { emAndamento: true } | { pulado: true }> {
  const prazoMs = Math.min(45_000, 50_000 - (Date.now() - inicioRequisicao));
  if (prazoMs < 5_000) return { pulado: true };
  return organizarDriveAgora({ prazoMs });
}

/** Arquivo individual para a lixeira, se nenhum outro registro usa o mesmo arquivo. Nunca lança. */
export async function lixeiraDoArquivo(driveFileId: string | null | undefined, deps: DependenciasOrganizador = dependenciasReais()): Promise<void> {
  if (!driveFileId) return;
  try {
    if (!(await deps.configurado())) { await enfileirarLixeira("arquivo", driveFileId); return; }
    if ((await deps.emUso([driveFileId])).size) return;
    await deps.lixeira(driveFileId);
  } catch (e) {
    console.error("[drive] arquivo não foi para a lixeira agora; fica pendente:", mensagem(e));
    await enfileirarLixeira("arquivo", driveFileId);
  }
}

/**
 * Logo depois de gravar no banco: copia o registro para o Drive. Falha (ou Drive
 * não configurado) não impede nada — fica pendente e o organizador envia depois.
 */
export async function copiarParaDrive(tipo: string, id: number, deps: DependenciasOrganizador = dependenciasReais()): Promise<boolean> {
  try {
    const fonte = deps.fontes.find((f) => f.tipo === tipo);
    if (!fonte?.pendentes || !(await deps.configurado())) return false;
    const [item] = await fonte.pendentes({ aposId: 0, limite: 1, id });
    if (!item) return false;
    const dados = await item.carregar();
    if (!dados?.length) return false;
    await item.gravar(await deps.upload(await item.destino(), item.mime, dados, new Map()));
    return true;
  } catch (e) {
    console.error(`[drive] cópia (${tipo}) pendente; o organizador tenta de novo:`, mensagem(e));
    return false;
  }
}

/**
 * Orçamento da incorporação salvo: se a planilha importada mudou (ou foi
 * retirada), a cópia antiga vai para a lixeira e a nova é enviada para
 * Incorporação/<Estudo>/Orçamento. Mesma planilha → nada a fazer. Nunca lança.
 */
export async function atualizarPlanilhaOrcamentoNoDrive(studyId: number): Promise<void> {
  try {
    const db = getDb();
    const r = await db.execute(sql`SELECT parameterized_budget_json AS json, budget_import_drive_file_id AS drive, budget_import_sha256 AS sha
      FROM incorporation_studies WHERE id = ${studyId}`);
    const l = (r as unknown as Linhas<{ json: string | null; drive: string | null; sha: string | null }>).rows[0];
    if (!l) return;
    const planilha = planilhaImportada(l.json);
    if (planilha && planilha.sha256 === l.sha && l.drive) return;
    if (l.drive || l.sha) {
      await db.execute(sql`UPDATE incorporation_studies SET budget_import_drive_file_id = NULL, budget_import_sha256 = NULL WHERE id = ${studyId}`);
      if (l.drive) await lixeiraDoArquivo(l.drive);
    }
    if (planilha) await copiarParaDrive("orcamento_estudo", studyId);
  } catch (e) {
    console.error("[drive] planilha do orçamento pendente:", mensagem(e));
  }
}
