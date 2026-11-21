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
import { ExecucaoConcorrente, MENSAGEM_INTERROMPIDA, execucaoDe, exigirSemPassoEmCurso, gravarSeIgual, gravarSobreOAtual, novaConfirmacao, modeloDaConfirmacao, pularPassosIA, reservaVencida, type Execucao } from "./execucao-ia.js";
import { adotarAntesDeInterromper, cancelarLoteIA, documentoDoPasso, lerDocumentos, montarModelo, motorDaLeitura, parciaisDasPranchas, passoPrancha, passoPranchaIA, passosDasPranchas, pranchasParaMontagem } from "./leitura.js";
import { gravarModelo } from "./revisoes.js";

/** Situações em que se pode importar e aplicar. Validada e publicada voltam para revisão ao aplicar. */
export const PODE_IMPORTAR: readonly StatusMaquete[] = ["liberada", "em_revisao", "validada", "publicada"];

export type ReferenciaPrancha = { pavimentoId: string; doc: number; pagina: number; arquivo?: { fonte: DocumentoMaquete["fonte"]; id: number; nome: string }; alinhamento: { x: number; y: number; larguraM: number } | null };
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

/** Execução da importação: o estado mora em `importacao`, que só é gravada se ainda for a lida (e a maquete puder importar). */
const execucaoDaImportacao = (m: Maquete3d, imp: Importacao, inicio?: number) => execucaoDe(m, "importacao", e => JSON.stringify({ ...imp, estado: e }), PODE_IMPORTAR, inicio);

/** Grava a importação só se ela ainda for a que foi lida: importação atrasada não regrava a aplicada ou a descartada. */
async function gravar(x: Execucao, imp: Importacao | null, mudou = "A importação mudou enquanto isso (foi aplicada, descartada ou começada de novo). Recarregue a página."): Promise<void> {
  if (!(await gravarSeIgual(x, imp ? JSON.stringify(imp) : null, { deltaIA: -x.devolver }))) throw new LeituraIndisponivel(mudou);
}

/** Importação aberta e a maquete numa situação em que se pode importar; senão, erro claro. */
async function importacaoAberta(id: number): Promise<{ m: Maquete3d; imp: Importacao }> {
  const m = await buscar(id);
  if (!PODE_IMPORTAR.includes(m.status as StatusMaquete)) throw new LeituraIndisponivel("Nesta situação não é possível importar uma planta (a maquete está sendo lida ou não está liberada).");
  const imp = lerImportacao(m.importacao);
  if (!imp) throw new LeituraIndisponivel("Não há importação em andamento nesta maquete.");
  return { m, imp };
}

/**
 * Começa a leitura do PDF importado (índice na lista de PDFs do pedido no momento do clique; daí em diante, o
 * arquivo é seguido pela identidade). Não mexe no modelo em uso. A confirmação da IA começa vazia: vale por execução.
 */
export async function iniciarImportacao(id: number, doc: number, userId: number): Promise<Importacao> {
  const m = await buscar(id);
  if (!PODE_IMPORTAR.includes(m.status as StatusMaquete)) throw new LeituraIndisponivel("Nesta situação não é possível importar uma planta.");
  // QA rodada 2, N1: começar outra importação no meio de uma chamada paga da atual jogaria a resposta fora.
  exigirSemPassoEmCurso(lerImportacao(m.importacao)?.estado);
  const documento = lerDocumentos(m.documentos)[doc];
  if (!documento) throw new LeituraIndisponivel("O PDF escolhido não está na lista deste pedido.");
  const passos = (await passosDasPranchas(m, documento)).map(p => (p.tipo === "montagem" ? { ...p, rotulo: "Montagem da planta importada (candidata)" } : p));
  const imp: Importacao = {
    doc, documento, candidata: null, pranchas: [], avisos: [], iniciadaPor: userId, iniciadaEm: agora().toISOString(),
    estado: { ...leituraVazia(), iniciadaEm: agora().toISOString(), passos, confirmacaoIA: null },
  };
  await gravar(execucaoDaImportacao(m, imp), imp, "A maquete mudou enquanto a importação começava. Recarregue a página e tente de novo.");
  return imp;
}

/**
 * Um passo da leitura do PDF importado. A montagem gera a candidata; o modelo em uso não muda. Passo atrasado (outra
 * aba, importação aplicada/descartada/recomeçada) não grava nada e devolve a importação como está agora.
 */
export async function avancarImportacao(id: number): Promise<Importacao> {
  const inicio = Date.now();
  const { m, imp } = await importacaoAberta(id);
  const estado = imp.estado;
  const passo = estado.passos.find(p => p.estado !== "feito");
  if (!passo) return imp;
  const x = execucaoDaImportacao(m, imp, inicio);
  const atualGravada = async () => lerImportacao((await buscar(id)).importacao) ?? imp;
  if (passo.estado === "executando" && !passo.lote?.id && !passo.loteAProcurar) {
    if (!reservaVencida(passo)) return imp;
    // QA C1, achado 2: antes de dar como interrompido, procura o lote que o envio pode ter criado.
    if (await adotarAntesDeInterromper(estado, passo, x)) return (await gravarSeIgual(x, x.serializar(estado))) ? imp : atualGravada();
    Object.assign(passo, { estado: "erro", erro: MENSAGEM_INTERROMPIDA, reservadoEm: null });
    return (await gravarSeIgual(x, x.serializar(estado))) ? imp : atualGravada();
  }
  let aguardando = false;
  try {
    const config = await carregarConfig();
    const motor = await motorDaLeitura(config);
    if (passo.tipo === "prancha") await passoPrancha(m, estado, passo, motor);
    // "adiado" (N7): sem tempo para a IA neste pedido; o passo segue pendente e a tela chama de novo.
    // "enviado"/"mudou" (EPIC-027 C1): o lote está na Anthropic; a tela consulta de novo. Sem mudança, nada é gravado.
    else if (passo.tipo === "prancha_ia") {
      const r = await passoPranchaIA(m, estado, passo, config, x);
      if (r === "sem_mudanca") return imp;
      aguardando = r !== "feito";
    }
    else {
      // O PDF importado é achado pela identidade; se saiu da lista, para com mensagem clara.
      documentoDoPasso(m, { arquivo: { ...imp.documento } });
      const pranchas = pranchasParaMontagem(m, estado);
      const r = parciaisDasPranchas(pranchas, lerDocumentos(m.documentos).map(d => d.nome));
      if (!(r.parciais.inventario as { edificacoes: unknown[] }).edificacoes.length) {
        throw new LeituraIndisponivel(`Nenhuma planta baixa foi reconhecida no PDF importado. ${r.motivos.slice(0, 3).join(" ")}`.trim());
      }
      imp.candidata = montarModelo(m.tipo as TipoMaquete, r.parciais);
      imp.pranchas = r.referencias;
      imp.avisos = r.motivos;
      estado.concluidaEm = agora().toISOString();
    }
    if (!aguardando) Object.assign(passo, { estado: "feito", erro: null, aguardando: null, reservadoEm: null });
  } catch (e) {
    if (e instanceof ExecucaoConcorrente) return atualGravada();
    Object.assign(passo, { estado: "erro", erro: erroSeguro(e), reservadoEm: null, lote: null, loteAProcurar: null });
  }
  if (!(await gravarSeIgual(x, x.serializar(estado), { deltaIA: -x.devolver }))) {
    // Segunda barreira do N1: a importação mudou durante a chamada paga; se o passo continua reservado por este
    // pedido, o resultado dele vai para a importação atual.
    await gravarSobreOAtual(x, estado, async () => {
      const agoraM = await buscar(id).catch(() => null);
      const atual = agoraM && PODE_IMPORTAR.includes(agoraM.status as StatusMaquete) ? lerImportacao(agoraM.importacao) : null;
      return agoraM && atual ? { estado: atual.estado, x: execucaoDaImportacao(agoraM, atual) } : null;
    });
    return atualGravada();
  }
  return imp;
}

/**
 * Confirmação do custo da IA para ESTA importação (não vale para a leitura nem para outra importação): autoriza as
 * pranchas pendentes dentro do teto da maquete, ou todas com `alemDoTeto`.
 */
export async function confirmarIAImportacao(id: number, userId: number, alemDoTeto = false, modeloVisto?: string): Promise<Importacao> {
  const { m, imp } = await importacaoAberta(id);
  exigirSemPassoEmCurso(imp.estado);
  const config = await carregarConfig();
  const x = execucaoDaImportacao(m, imp);
  // QA S-11 r2, achado 2: só confirma o modelo que a tela mostrou; senão, a tela passa a mostrar o de agora
  const doModelo = await modeloDaConfirmacao(imp.estado, config, x, modeloVisto);
  if ("erro" in doModelo) {
    await gravar(x, imp).catch(() => undefined);
    throw new LeituraIndisponivel(doModelo.erro);
  }
  const r = novaConfirmacao(imp.estado, config, m.iaPranchasLidas ?? 0, userId, alemDoTeto, doModelo.modelo);
  if ("erro" in r) throw new LeituraIndisponivel(r.erro!);
  await gravar(x, imp, "A importação mudou enquanto você confirmava. Confira o que ela pede agora e confirme de novo.");
  return imp;
}

/** Cancela, na Anthropic, a leitura pela IA em andamento nesta importação (o resultado chega na próxima consulta). */
export async function cancelarLeituraIAImportacao(id: number, chave: string): Promise<Importacao> {
  const { m, imp } = await importacaoAberta(id);
  if (await cancelarLoteIA(imp.estado, chave)) await gravarSeIgual(execucaoDaImportacao(m, imp), JSON.stringify(imp));
  return imp;
}

export async function pularIAImportacao(id: number): Promise<Importacao> {
  const { m, imp } = await importacaoAberta(id);
  exigirSemPassoEmCurso(imp.estado);
  pularPassosIA(imp.estado, await carregarConfig());
  await gravar(execucaoDaImportacao(m, imp), imp);
  return imp;
}

/** Edição da candidata no editor, antes de aplicar. */
export async function salvarCandidata(id: number, modelo: ModeloMaquete): Promise<void> {
  const m = await buscar(id);
  const imp = lerImportacao(m.importacao);
  if (!imp?.candidata) throw new LeituraIndisponivel("Não há planta importada pronta para editar.");
  const novo = { ...imp, candidata: modelo };
  await gravar(execucaoDaImportacao(m, imp), novo);
}

/** Descarta a importação (qualquer situação: nada do modelo muda). Uma chamada à IA em curso não regrava depois. */
export async function descartarImportacao(id: number): Promise<void> {
  const m = await buscar(id);
  if (!m.importacao) return;
  exigirSemPassoEmCurso(lerImportacao(m.importacao)?.estado);
  const x = execucaoDe(m, "importacao", e => JSON.stringify(e), ["aguardando_aprovacao", "aguardando_pagamento", "aguardando_autorizacao", "liberada", "em_leitura", "em_revisao", "validada", "publicada", "recusada"]);
  if (!(await gravarSeIgual(x, null))) throw new LeituraIndisponivel("A importação mudou enquanto isso. Recarregue a página e tente de novo.");
}

/** Pranchas ao fundo de cada pavimento no modelo em uso, como gravadas (as do leitor ou as dos passos da IA, na leitura antiga). */
export function pranchasDaLeitura(leitura: EstadoLeitura): ReferenciaPrancha[] {
  return Array.isArray(leitura.parciais.pranchasDosPavimentos)
    ? (leitura.parciais.pranchasDosPavimentos as ReferenciaPrancha[]).map(p => ({ pavimentoId: p.pavimentoId, doc: p.doc, pagina: p.pagina, ...(p.arquivo ? { arquivo: p.arquivo } : {}), alinhamento: p.alinhamento ?? null }))
    : leitura.passos.filter(p => p.tipo === "estrutura" && p.pavimentoId).map(p => ({ pavimentoId: p.pavimentoId!, doc: p.doc ?? 0, pagina: p.pagina ?? 1, alinhamento: null }));
}

/**
 * Fundo para a tela: o índice ATUAL de cada arquivo na lista, achado pela identidade. Arquivo que saiu da lista: o
 * pavimento fica sem fundo (nunca a prancha de outro PDF). Referência antiga, sem identidade: a posição gravada.
 */
export function pranchasParaTela(refs: ReferenciaPrancha[], documentos: string): ReferenciaPrancha[] {
  const docs = lerDocumentos(documentos);
  return refs.flatMap(r => {
    if (!r.arquivo) return r.doc >= 0 && r.doc < docs.length ? [r] : [];
    const i = docs.findIndex(d => d.fonte === r.arquivo!.fonte && d.id === r.arquivo!.id);
    return i < 0 ? [] : [{ ...r, doc: i }];
  });
}

/**
 * Aplica a candidata: substitui só o escolhido (a construção padrão ou um pavimento), mantém a implantação e as
 * posições, grava com a trava otimista e registra a revisão com o PDF de origem. Validada ou publicada volta para
 * revisão (a publicada sai do ar: o link nunca muda em silêncio). As pranchas do PDF importado passam a ser o fundo
 * desses pavimentos na revisão.
 */
export async function aplicarImportacao(p: { id: number; versao: number; destino: DestinoImportacao; motivo: string; autorId: number }): Promise<{ versao: number; modelo: ModeloMaquete; saiuDoAr: boolean }> {
  const m = await buscar(p.id);
  if (!m.importacao) throw new LeituraIndisponivel("Não há planta importada pronta para aplicar.");
  const imp = lerImportacao(m.importacao);
  if (!imp?.candidata) throw new LeituraIndisponivel("Não há planta importada pronta para aplicar.");
  exigirSemPassoEmCurso(imp.estado);
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
    // Só aplica a importação que foi lida (outra aba não aplica uma candidata já trocada ou descartada).
    condicao: eq(maquetes3d.importacao, m.importacao),
    extra: {
      status: "em_revisao" satisfies StatusMaquete, revisadoPor: p.autorId, revisadoEm: agora(), importacao: null,
      leitura: JSON.stringify({ ...leitura, parciais: { ...leitura.parciais, pranchasDosPavimentos: fundo } }),
      ...(saiuDoAr ? { publicadoEm: null } : {}),
    },
  });
  return { versao, modelo: r.modelo, saiuDoAr };
}
