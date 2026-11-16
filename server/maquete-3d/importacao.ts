// Maquete 3D (EPIC-024 S-05) — "Importar planta arquitetônica (PDF)" na revisão. O PDF importado é lido prancha a
// prancha, com o mesmo roteamento híbrido da S-03 (leitor próprio; IA só nas pranchas que ele não lê), os mesmos
// limites de passo e a mesma retomada; o resultado é uma planta CANDIDATA guardada em maquetes_3d.importacao, sem
// tocar no modelo em uso. A pessoa compara, edita a candidata e escolhe o que ela substitui; só então o modelo muda,
// com a trava otimista, e a mudança entra no histórico ligada ao PDF original.
import { and, eq, isNull } from "drizzle-orm";
import { maquetes3d, type Maquete3d } from "../../drizzle/schema-maquete-3d.js";
import { aplicarCandidata, DestinoInvalido, type DestinoImportacao } from "../../shared/maquete-3d/importacao.js";
import { lerModelo, modeloSchema, modeloVazio, type ModeloMaquete, type TipoMaquete } from "../../shared/maquete-3d/modelo.js";
import { lerEstadoLeitura, leituraVazia, type DocumentoMaquete, type EstadoLeitura, type StatusMaquete } from "../../shared/maquete-3d/regras.js";
import { LeituraIndisponivel, agora, carregarConfig, db, erroSeguro } from "./base.js";
import { lerDocumentos, montarModelo, motorDaLeitura, parciaisDasPranchas, passoPrancha, passoPranchaIA, passosDasPranchas, type PranchaLida } from "./leitura.js";
import { gravarModelo } from "./revisoes.js";

/** Situações em que se pode importar e aplicar. Validada e publicada voltam para revisão ao aplicar. */
export const PODE_IMPORTAR: readonly StatusMaquete[] = ["liberada", "em_revisao", "validada", "publicada"];

export type ReferenciaPrancha = { pavimentoId: string; doc: number; pagina: number; alinhamento: { x: number; y: number; larguraM: number } | null };
export type Importacao = {
  doc: number; documento: DocumentoMaquete; estado: EstadoLeitura;
  candidata: ModeloMaquete | null; pranchas: ReferenciaPrancha[]; avisos: string[];
  iniciadaPor: number | null; iniciadaEm: string;
};

export function lerImportacao(texto: string | null | undefined): Importacao | null {
  try {
    const v = JSON.parse(texto || "null");
    if (!v || typeof v.doc !== "number" || !v.estado) return null;
    return { ...v, estado: lerEstadoLeitura(JSON.stringify(v.estado)), candidata: v.candidata ? modeloSchema.parse(v.candidata) : null, pranchas: v.pranchas ?? [], avisos: v.avisos ?? [] };
  } catch { return null; }
}

async function buscar(id: number): Promise<Maquete3d> {
  const [m] = await db().select().from(maquetes3d).where(and(eq(maquetes3d.id, id), isNull(maquetes3d.deletedAt))).limit(1);
  if (!m) throw new LeituraIndisponivel("Maquete não encontrada.");
  return m;
}

async function gravar(id: number, imp: Importacao | null) {
  await db().update(maquetes3d).set({ importacao: imp ? JSON.stringify(imp) : null, updatedAt: agora() }).where(eq(maquetes3d.id, id));
}

/** Começa a leitura do PDF importado (índice na lista de PDFs do pedido). Não mexe no modelo em uso. */
export async function iniciarImportacao(id: number, doc: number, userId: number): Promise<Importacao> {
  const m = await buscar(id);
  if (!PODE_IMPORTAR.includes(m.status as StatusMaquete)) throw new LeituraIndisponivel("Nesta situação não é possível importar uma planta.");
  const documento = lerDocumentos(m.documentos)[doc];
  if (!documento) throw new LeituraIndisponivel("O PDF escolhido não está na lista deste pedido.");
  const passos = (await passosDasPranchas(m, doc)).map(p => (p.tipo === "montagem" ? { ...p, rotulo: "Montagem da planta importada (candidata)" } : p));
  const imp: Importacao = {
    doc, documento, candidata: null, pranchas: [], avisos: [], iniciadaPor: userId, iniciadaEm: agora().toISOString(),
    // A confirmação do custo da IA é da maquete: vale também aqui.
    estado: { ...leituraVazia(), iniciadaEm: agora().toISOString(), passos, confirmacaoIA: lerEstadoLeitura(m.leitura).confirmacaoIA ?? null },
  };
  await gravar(id, imp);
  return imp;
}

/** Um passo da leitura do PDF importado. A montagem gera a candidata; o modelo em uso não muda. */
export async function avancarImportacao(id: number): Promise<Importacao> {
  const m = await buscar(id);
  const imp = lerImportacao(m.importacao);
  if (!imp) throw new LeituraIndisponivel("Não há importação em andamento nesta maquete.");
  const estado = imp.estado;
  const passo = estado.passos.find(p => p.estado !== "feito");
  if (!passo) return imp;
  let aguardando = false;
  try {
    const config = await carregarConfig();
    const motor = await motorDaLeitura(config);
    if (passo.tipo === "prancha") await passoPrancha(m, estado, passo, motor, config);
    else if (passo.tipo === "prancha_ia") {
      const confirmada = !!(estado.confirmacaoIA ?? lerEstadoLeitura(m.leitura).confirmacaoIA);
      aguardando = (await passoPranchaIA(m, estado, passo, config, confirmada)) === "aguardando";
    } else {
      const pranchas = estado.passos.filter(p => p.tipo === "prancha").map(p => estado.parciais[p.chave] as PranchaLida | undefined).filter((p): p is PranchaLida => !!p);
      const r = parciaisDasPranchas(pranchas, lerDocumentos(m.documentos).map(d => d.nome));
      if (!(r.parciais.inventario as { edificacoes: unknown[] }).edificacoes.length) {
        throw new LeituraIndisponivel(`Nenhuma planta baixa foi reconhecida no PDF importado. ${r.motivos.slice(0, 3).join(" ")}`.trim());
      }
      imp.candidata = montarModelo(m.tipo as TipoMaquete, r.parciais);
      imp.pranchas = r.referencias;
      imp.avisos = r.motivos;
      estado.concluidaEm = agora().toISOString();
    }
    if (!aguardando) Object.assign(passo, { estado: "feito", erro: null, aguardando: null });
  } catch (e) {
    Object.assign(passo, { estado: "erro", erro: erroSeguro(e) });
  }
  await gravar(id, imp);
  return imp;
}

/** Confirmação do custo da IA durante a importação: grava na maquete (vale para as próximas leituras) e destrava os passos. */
export async function confirmarIAImportacao(id: number, userId: number): Promise<Importacao> {
  const m = await buscar(id);
  const imp = lerImportacao(m.importacao);
  if (!imp) throw new LeituraIndisponivel("Não há importação em andamento nesta maquete.");
  const confirmacao = { em: agora().toISOString(), por: userId, pranchas: imp.estado.passos.filter(p => p.tipo === "prancha_ia" && p.estado !== "feito").length };
  imp.estado.confirmacaoIA = confirmacao;
  for (const p of imp.estado.passos) if (p.estado === "aguardando" && p.aguardando === "confirmacao") Object.assign(p, { estado: "pendente", aguardando: null, erro: null });
  const leitura = lerEstadoLeitura(m.leitura);
  await db().update(maquetes3d).set({ importacao: JSON.stringify(imp), leitura: JSON.stringify({ ...leitura, confirmacaoIA: confirmacao }), updatedAt: agora() }).where(eq(maquetes3d.id, id));
  return imp;
}

export async function pularIAImportacao(id: number): Promise<Importacao> {
  const m = await buscar(id);
  const imp = lerImportacao(m.importacao);
  if (!imp) throw new LeituraIndisponivel("Não há importação em andamento nesta maquete.");
  for (const p of imp.estado.passos) if (p.tipo === "prancha_ia" && p.estado !== "feito") Object.assign(p, { estado: "feito", motor: "pulada", aguardando: null, erro: null });
  await gravar(id, imp);
  return imp;
}

/** Edição da candidata no editor, antes de aplicar. */
export async function salvarCandidata(id: number, modelo: ModeloMaquete): Promise<void> {
  const m = await buscar(id);
  const imp = lerImportacao(m.importacao);
  if (!imp?.candidata) throw new LeituraIndisponivel("Não há planta importada pronta para editar.");
  await gravar(id, { ...imp, candidata: modelo });
}

export async function descartarImportacao(id: number): Promise<void> {
  await buscar(id);
  await gravar(id, null);
}

/** Pranchas ao fundo de cada pavimento no modelo em uso (as do leitor ou as dos passos da IA, na leitura antiga). */
export function pranchasDaLeitura(leitura: EstadoLeitura): ReferenciaPrancha[] {
  return Array.isArray(leitura.parciais.pranchasDosPavimentos)
    ? (leitura.parciais.pranchasDosPavimentos as ReferenciaPrancha[]).map(p => ({ pavimentoId: p.pavimentoId, doc: p.doc, pagina: p.pagina, alinhamento: p.alinhamento ?? null }))
    : leitura.passos.filter(p => p.tipo === "estrutura" && p.pavimentoId).map(p => ({ pavimentoId: p.pavimentoId!, doc: p.doc ?? 0, pagina: p.pagina ?? 1, alinhamento: null }));
}

/**
 * Aplica a candidata: substitui só o escolhido (a construção padrão ou um pavimento), mantém a implantação e as
 * posições, grava com a trava otimista e registra a revisão com o PDF de origem. Validada ou publicada volta para
 * revisão (a publicada sai do ar: o link nunca muda em silêncio). As pranchas do PDF importado passam a ser o fundo
 * desses pavimentos na revisão.
 */
export async function aplicarImportacao(p: { id: number; versao: number; destino: DestinoImportacao; motivo: string; autorId: number }): Promise<{ versao: number; modelo: ModeloMaquete; saiuDoAr: boolean }> {
  const m = await buscar(p.id);
  const imp = lerImportacao(m.importacao);
  if (!imp?.candidata) throw new LeituraIndisponivel("Não há planta importada pronta para aplicar.");
  if (!PODE_IMPORTAR.includes(m.status as StatusMaquete)) throw new LeituraIndisponivel("Nesta situação não é possível aplicar a planta importada.");
  const atual = lerModelo(m.modelo) ?? modeloVazio(m.tipo as TipoMaquete);
  let r: ReturnType<typeof aplicarCandidata>;
  try {
    let n = 1;
    while (atual.edificacoes.some(e => e.id === `imp${n}`)) n++;
    r = aplicarCandidata(atual, imp.candidata, p.destino, `imp${n}`, imp.documento.nome);
  } catch (e) {
    if (e instanceof DestinoInvalido) throw new LeituraIndisponivel(e.message);
    throw e;
  }
  const leitura = lerEstadoLeitura(m.leitura);
  const novos = new Set(r.pavimentos.values());
  const fundo = [
    ...pranchasDaLeitura(leitura).filter(x => !novos.has(x.pavimentoId)),
    ...imp.pranchas.filter(x => r.pavimentos.has(x.pavimentoId)).map(x => ({ ...x, pavimentoId: r.pavimentos.get(x.pavimentoId)! })),
  ];
  const saiuDoAr = m.status === "publicada";
  const versao = await gravarModelo({
    de: m, versao: p.versao, modelo: r.modelo, status: PODE_IMPORTAR, origem: "importacao_pdf", motivo: p.motivo || `Planta importada de ${imp.documento.nome}`,
    documento: imp.documento, autorId: p.autorId,
    extra: {
      status: "em_revisao" satisfies StatusMaquete, revisadoPor: p.autorId, revisadoEm: agora(), importacao: null,
      leitura: JSON.stringify({ ...leitura, parciais: { ...leitura.parciais, pranchasDosPavimentos: fundo } }),
      ...(saiuDoAr ? { publicadoEm: null } : {}),
    },
  });
  return { versao, modelo: r.modelo, saiuDoAr };
}
