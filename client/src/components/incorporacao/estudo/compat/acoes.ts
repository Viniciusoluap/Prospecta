// Camada de compatibilidade: as abas do estudo vieram do Grupo Santa Fé, onde
// salvam por Server Actions com os nomes abaixo. Aqui cada uma chama a rota
// tRPC equivalente do Prospecta e, como o `revalidatePath` do Santa Fé, recarrega
// o estudo na tela. A regra de negócio fica nas abas, idêntica nos dois sistemas.
import { createTRPCClient } from "@trpc/client";
import { linksDoCliente } from "@/lib/trpc-links";
import { toast } from "sonner";
import type { AppRouter } from "../../../../../../server/routers";
import type { DueDiligence } from "@shared/incorporacao/due-diligence";
import { LIMITE_ANEXO_BYTES, LIMITE_ANEXO_ROTULO, MIME_GENERICO, PARTE_ANEXO_BYTES, anexoVisualizavel, mimeDoAnexo, partesDoAnexo } from "@shared/incorporacao/anexos";
import type { ErroAcao } from "./acao-resultado";

const api = createTRPCClient<AppRouter>({ links: linksDoCliente() });

let recarregar: () => Promise<unknown> = async () => undefined;
/** A página do estudo registra aqui como recarregar o estudo depois de cada gravação. */
/** Recarrega o estudo na tela (equivalente ao `router.refresh()` do Santa Fé). */
export function recarregarEstudo() { return recarregar(); }
export function registrarRecarregamentoEstudo(fn: () => Promise<unknown>) {
  recarregar = fn;
  return () => {
    if (recarregar === fn) recarregar = async () => undefined;
  };
}

const id = (estudoId: string) => Number(estudoId);
const mensagem = (e: unknown) => e instanceof Error && e.message ? e.message : "Operação falhou.";

/** Grava, recarrega o estudo e devolve `{ ok: true }`; em erro, avisa e devolve a mensagem. */
async function gravar(fn: () => Promise<unknown>): Promise<{ ok: true } | ErroAcao> {
  try { await fn(); await recarregar(); return { ok: true }; }
  catch (e) { toast.error(mensagem(e)); return { erroAcao: mensagem(e) }; }
}

const json = (procedimento: (input: { id: number; dataJson: string }) => Promise<unknown>) =>
  (estudoId: string, dadosJson: string) => gravar(() => procedimento({ id: id(estudoId), dataJson: dadosJson }));

const inc = api.incorporacao;
export const salvarViabilidade = json((i) => inc.saveViabilidade.mutate(i));
export const salvarPrecificacaoComparaveis = json((i) => inc.savePrecificacao.mutate(i));
export const salvarPesquisaPrimaria = json((i) => inc.savePesquisaPrimaria.mutate(i));
export const salvarQuadroAreas = json((i) => inc.saveAreasBoard.mutate(i));
export const salvarOrcamentoParametrizado = json((i) => inc.saveOrcamentoParametrizado.mutate(i));
export const salvarNegociacaoTerreno = json((i) => inc.saveNegociacaoTerreno.mutate(i));
export const salvarBusinessPlan = json((i) => inc.saveBusinessPlan.mutate(i));
export const salvarProjetistas = json((i) => inc.saveProjetistas.mutate(i));
export const salvarAprovacaoProjeto = json((i) => inc.saveAprovacaoProjeto.mutate(i));
export const salvarRegistroIncorporacao = json((i) => inc.saveRegistroIncorporacao.mutate(i));
export const salvarOrcamentoPreliminar = json((i) => inc.saveOrcamentoPreliminar.mutate(i));
export const salvarPlanejamentoLancamento = json((i) => inc.savePlanejamentoLancamento.mutate(i));
export const salvarFornecedoresLancamento = json((i) => inc.saveFornecedoresLancamento.mutate(i));
export const salvarMaterialPublicitario = json((i) => inc.saveMaterialPublicitario.mutate(i));
export const salvarLancamentoImobiliario = json((i) => inc.saveLancamentoImobiliario.mutate(i));
export const salvarProjetosExecutivos = json((i) => inc.saveProjetosExecutivos.mutate(i));
export const salvarOrcamentoObra = json((i) => inc.saveOrcamentoObra.mutate(i));
export const salvarCronogramaObra = json((i) => inc.saveCronogramaObra.mutate(i));
export const salvarAtendimentoClientes = json((i) => inc.saveAtendimentoClientes.mutate(i));

export function salvarApp(estudoId: string, payload: { areaM2: number; larguraM: number | null; origem: string }) {
  return gravar(() => inc.saveApp.mutate({ id: id(estudoId), ...payload }));
}

/** Larguras de faixa confirmadas no mapa do terreno ({chave: metros}); objeto vazio limpa tudo. */
export function salvarLargurasFaixa(estudoId: string, larguras: Record<string, number>) {
  return gravar(() => inc.saveLargurasFaixa.mutate({ id: id(estudoId), larguras }));
}

export async function salvarMassa(estudoId: string, payload: unknown, cenarioEscolhidoId?: string | null, mix?: unknown) {
  return gravar(async () => {
    await inc.saveMassa.mutate({ id: id(estudoId), dataJson: JSON.stringify(payload), selectedScenarioId: cenarioEscolhidoId ?? null });
    if (mix) await inc.saveMixProdutos.mutate({ id: id(estudoId), dataJson: JSON.stringify(mix) });
  });
}

/** Pesquisa de Cidade & Mercado por IA — no Prospecta o servidor pesquisa e já grava o resultado. */
export async function pesquisarMercado(estudoId: string, municipio: string, estado: string) {
  return inc.pesquisarMercado.mutate({ id: id(estudoId), municipio, estado });
}
/** O resultado já foi gravado por `pesquisarMercado`; aqui só recarrega o estudo. */
export async function salvarMercado(_estudoId: string, _payload: unknown) { return gravar(async () => undefined); }

/** Grade de elevação do terreno — no Prospecta o servidor consulta e já grava. */
export async function obterElevacao(estudoId: string, bbox: { south: number; north: number; west: number; east: number }) {
  return inc.fetchElevation.mutate({ id: id(estudoId), ...bbox });
}
/** A grade já foi gravada por `obterElevacao`; aqui só recarrega o estudo. */
export async function salvarElevacao(_estudoId: string, _elevacaoJson: string) { return gravar(async () => undefined); }

export async function uploadKml(estudoId: string, formData: FormData): Promise<{ ok?: true; error?: string }> {
  const file = formData.get("kml") as File | null;
  if (!file || file.size === 0) return { error: "Selecione um arquivo KML." };
  if (file.size > 10 * 1024 * 1024) return { error: "Arquivo muito grande (máx. 10 MB)." };
  try { await inc.uploadKml.mutate({ id: id(estudoId), kmlContent: await file.text() }); await recarregar(); return { ok: true }; }
  catch (e) { return { error: mensagem(e) }; }
}

// ─── Documentos privados (Registro da Incorporação e levantamento topográfico) ──
type DocumentoProspecta = Awaited<ReturnType<typeof inc.documents.list.query>>[number];
const paraDocumento = (d: DocumentoProspecta) => ({
  id: String(d.id), itemId: d.itemId, nome: d.fileName, mimeType: d.mimeType, enviadoEm: new Date(d.uploadedAt).toISOString(),
});
async function lista(estudoId: string) {
  const [documentos, disponivel] = await Promise.all([inc.documents.list.query({ studyId: id(estudoId) }), inc.documents.available.query()]);
  return { configurado: disponivel.configured, drive: disponivel.drive, documentos: documentos.map(paraDocumento) };
}
async function capturar<T>(fn: () => Promise<T>): Promise<T | ErroAcao> {
  try { return await fn(); } catch (e) { return { erroAcao: mensagem(e) }; }
}
function paraBase64(bytes: Uint8Array) {
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  return btoa(binario);
}
function idDoEnvio() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "");
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

export function listarDocumentosRegistro(estudoId: string) { return capturar(() => lista(estudoId)); }
/** Qualquer tipo de arquivo (foto, DWG, Word...), até 50 MB, enviado em partes de 2 MiB. */
export function enviarDocumentoRegistro(estudoId: string, itemId: string, arquivo: File) {
  return capturar(async () => {
    if (arquivo.size === 0) throw new Error("O arquivo está vazio.");
    if (arquivo.size > LIMITE_ANEXO_BYTES) throw new Error(`Arquivo acima de ${LIMITE_ANEXO_ROTULO}.`);
    // iPad/Arquivos às vezes entrega o arquivo sem tipo: usa a extensão como referência
    const mimeType = mimeDoAnexo(arquivo.name, arquivo.type);
    const uploadId = idDoEnvio();
    const partes = partesDoAnexo(arquivo.size);
    for (let part = 0; part < partes; part++) {
      const pedaco = new Uint8Array(await arquivo.slice(part * PARTE_ANEXO_BYTES, (part + 1) * PARTE_ANEXO_BYTES).arrayBuffer());
      await inc.documents.uploadPart.mutate({ studyId: id(estudoId), itemId, uploadId, part, base64: paraBase64(pedaco) });
    }
    const r = await inc.documents.uploadFinish.mutate({ studyId: id(estudoId), itemId, uploadId, fileName: arquivo.name, mimeType, size: arquivo.size });
    const nota = r.storage === "banco" ? r.storageNote ?? null : null;
    return { ...(await lista(estudoId)), armazenamento: nota ? "banco" : "drive", notaArmazenamento: nota };
  });
}
export function desvincularDocumentoRegistro(estudoId: string, itemId: string, _documentoId: string) {
  return capturar(async () => { await inc.documents.unlink.mutate({ studyId: id(estudoId), itemId }); return lista(estudoId); });
}
/**
 * Abre o arquivo atual do item: PDF/foto/texto numa nova aba; os demais (DWG, Word, HEIC...)
 * são baixados com o nome original. `nome` (quando a tela já sabe) decide antes do servidor responder.
 */
export async function abrirDocumentoRegistro(estudoId: string, itemId: string, nome?: string | null) {
  // a aba é aberta no próprio clique (antes de esperar o servidor): Safari/iPad bloqueia window.open depois de um await
  const abrirEmAba = !nome || anexoVisualizavel(mimeDoAnexo(nome));
  const aba = abrirEmAba && typeof window !== "undefined" ? window.open("", "_blank") : null;
  try {
    const primeira = await inc.documents.contentPart.query({ studyId: id(estudoId), itemId, part: 0 });
    const blocos: BlobPart[] = [Uint8Array.from(atob(primeira.base64), (c) => c.charCodeAt(0))];
    for (let part = 1; part < primeira.parts; part++) {
      const r = await inc.documents.contentPart.query({ studyId: id(estudoId), itemId, part });
      blocos.push(Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0)));
    }
    const visualizavel = anexoVisualizavel(primeira.mimeType);
    const url = URL.createObjectURL(new Blob(blocos, { type: visualizavel ? primeira.mimeType : MIME_GENERICO }));
    if (visualizavel) {
      if (aba) { aba.opener = null; aba.location.href = url; } else window.open(url, "_blank", "noopener,noreferrer");
    } else {
      aba?.close();
      const link = document.createElement("a");
      link.href = url; link.download = primeira.fileName || "arquivo"; link.rel = "noopener";
      document.body.appendChild(link); link.click(); link.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) { aba?.close(); toast.error(mensagem(e)); }
}
const ITEM_LEVANTAMENTO = "levantamento_topografico";
const MIME_LEVANTAMENTO: Record<string, "text/csv" | "text/plain" | "application/dxf"> = { csv: "text/csv", txt: "text/plain", xyz: "text/plain", dxf: "application/dxf" };
/** Levantamento topográfico (CSV/TXT/XYZ/DXF): guardado como documento privado do estudo. */
export async function uploadLevantamento(estudoId: string, formData: FormData): Promise<{ ok?: true; error?: string }> {
  const file = formData.get("arquivo") as File | null;
  if (!file || file.size === 0) return { error: "Selecione um arquivo." };
  const mimeType = MIME_LEVANTAMENTO[file.name.split(".").pop()?.toLowerCase() ?? ""];
  if (!mimeType) return { error: "Envie o levantamento em CSV, TXT, XYZ ou DXF." };
  if (file.size > 3 * 1024 * 1024) { toast.error("Levantamento acima de 3 MiB."); return { error: "Levantamento acima de 3 MiB." }; }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer()); let binario = "";
    for (let i = 0; i < bytes.length; i++) binario += String.fromCharCode(bytes[i]);
    await inc.documents.upload.mutate({ studyId: id(estudoId), itemId: ITEM_LEVANTAMENTO, fileName: file.name, mimeType, base64: btoa(binario) });
    await recarregar();
    return { ok: true };
  } catch (e) { toast.error(mensagem(e)); return { error: mensagem(e) }; }
}
/** Baixa o levantamento enviado. */
export function abrirLevantamento(estudoId: string) { return abrirDocumentoRegistro(estudoId, ITEM_LEVANTAMENTO); }

export function testarGoogleDrive() { return capturar(() => api.leadDocuments.diagnoseDrive.mutate()); }

// ─── Due Diligence (Desmembramento Simples) ────────────────────────────────
/** Mesma gravação otimista do Santa Fé: só grava se o estudo ainda tem o JSON esperado. */
export function salvarDueDiligence(estudoId: string, esperado: string | null, proximo: DueDiligence) {
  return capturar(async () => {
    const r = await inc.dueDiligence.save.mutate({ studyId: id(estudoId), expectedJson: esperado, next: proximo });
    await recarregar();
    return r.json;
  });
}

// ─── Unidades à Venda (Desmembramento Simples) ─────────────────────────────
async function unidades(estudoId: string) {
  const r = await inc.units.list.query({ studyId: id(estudoId) });
  return {
    unidades: r.units.map((u) => ({
      id: String(u.id), codigo: u.code, tipo: u.kind, status: u.status, comprador: u.buyer,
      valorVenda: u.salePrice ?? null, revisao: u.revision, compradorLeadId: u.buyerLeadId ? String(u.buyerLeadId) : null, cenarioId: u.scenarioId, criadoEm: new Date(u.createdAt).toISOString(), atualizadoEm: new Date(u.updatedAt).toISOString(),
    })),
    legacyPending: r.legacyPending, legacyInvalid: r.legacyInvalid,
  };
}
export function listarUnidades(estudoId: string) { return capturar(() => unidades(estudoId)); }
export function criarUnidade(estudoId: string, codigo: string, tipo: string) {
  return capturar(async () => { await inc.units.create.mutate({ studyId: id(estudoId), code: codigo, kind: tipo }); return unidades(estudoId); });
}
export function mudarEstadoUnidade(estudoId: string, unidadeId: string, acao: "reservar" | "vender" | "liberar", comprador?: string, valor?: string) {
  return capturar(async () => {
    await inc.units.transition.mutate({ studyId: id(estudoId), unitId: Number(unidadeId), action: acao, buyer: comprador, salePrice: valor });
    return unidades(estudoId);
  });
}
export function conciliarVendaLegada(estudoId: string, vendaId: string, tipo: string) {
  return capturar(async () => { await inc.units.reconcile.mutate({ studyId: id(estudoId), saleId: vendaId, kind: tipo }); return unidades(estudoId); });
}

// ─── Lote 2 · correção 06: estudo sem KML e lotes avulsos ──────────────────
export function salvarSemKml(estudoId: string, semKml: boolean) {
  return gravar(() => inc.saveSemKml.mutate({ id: id(estudoId), semKml }));
}
export function salvarLotesAvulsos(estudoId: string, dadosJson: string) {
  return gravar(() => inc.saveLotesAvulsos.mutate({ id: id(estudoId), dataJson: dadosJson }));
}

// ─── Lote 2 · correção 11: estudos de massa salvos ─────────────────────────
export type ModoSalvarEstudoMassa = "novo" | "nova_versao" | "atualizar";
export interface DadosEstudoMassa {
  modo: ModoSalvarEstudoMassa;
  id?: string | null;
  nome: string;
  parametros: unknown;
  cenarios: unknown[];
  cenarioEscolhidoId: string | null;
  principal?: boolean;
}
export function listarEstudosMassa(estudoId: string) {
  return capturar(() => inc.massStudies.list.query({ studyId: id(estudoId) }));
}
export function abrirEstudoMassa(estudoId: string, estudoMassaId: string) {
  return capturar(() => inc.massStudies.get.query({ studyId: id(estudoId), id: Number(estudoMassaId) }));
}
export function salvarEstudoMassa(estudoId: string, d: DadosEstudoMassa) {
  return capturar(async () => {
    const r = await inc.massStudies.save.mutate({
      studyId: id(estudoId), mode: d.modo, id: d.id ? Number(d.id) : undefined, name: d.nome,
      paramsJson: d.parametros ? JSON.stringify(d.parametros) : null, scenariosJson: JSON.stringify(d.cenarios),
      selectedScenarioId: d.cenarioEscolhidoId, makePrincipal: !!d.principal,
    });
    await recarregar();
    return r;
  });
}
export function marcarEstudoMassaPrincipal(estudoId: string, estudoMassaId: string) {
  return capturar(async () => {
    await inc.massStudies.setPrincipal.mutate({ studyId: id(estudoId), id: Number(estudoMassaId) });
    await recarregar();
    return { ok: true as const };
  });
}
export function excluirEstudoMassa(estudoId: string, estudoMassaId: string) {
  return capturar(async () => {
    await inc.massStudies.delete.mutate({ studyId: id(estudoId), id: Number(estudoMassaId) });
    await recarregar();
    return { ok: true as const };
  });
}

export function clientesUnidades(query = "") { return capturar(async () => (await inc.units.clients.query({ query })).map((l) => ({ ...l, id: String(l.id) }))); }
export function sincronizarUnidades(estudoId: string) { return capturar(() => inc.units.synchronize.mutate({ studyId: id(estudoId) })); }
export function editarUnidade(estudoId: string, unidadeId: string, d: { status: "disponivel" | "reservada" | "vendida"; comprador: string | null; compradorLeadId: string | null; valor: string | null; revisao: number }) {
  return capturar(() => inc.units.edit.mutate({ studyId: id(estudoId), unitId: Number(unidadeId), status: d.status, buyer: d.comprador, buyerLeadId: d.compradorLeadId ? Number(d.compradorLeadId) : null, salePrice: d.valor, expectedRevision: d.revisao }));
}
export function excluirUnidade(estudoId: string, unidadeId: string) { return capturar(() => inc.units.delete.mutate({ studyId: id(estudoId), unitId: Number(unidadeId) })); }

/** Correção 08: exclui uma proposta gravada (com auditoria no servidor). */
export async function excluirPropostaNegociacao(estudoId: string, propostaId: string, confirmacaoReforcada: boolean) {
  const r = await inc.excluirPropostaNegociacao.mutate({ id: id(estudoId), propostaId, confirmacaoReforcada });
  await recarregar();
  return r;
}

/** Correção 06 — motores independentes da Inteligência de Mercado. */
export async function pesquisarDadosPublicos(estudoId: string, municipio: string, estado: string) {
  const r = await inc.pesquisarDadosPublicos.mutate({ id: id(estudoId), municipio, estado });
  await recarregar();
  return r;
}
export async function salvarDadosPublicos(estudoId: string, dados: Parameters<typeof inc.salvarDadosPublicos.mutate>[0]["dados"]) {
  const r = await inc.salvarDadosPublicos.mutate({ id: id(estudoId), dados });
  await recarregar();
  return r;
}
export async function pesquisarMercadoImobiliario(estudoId: string, c: { municipio: string; estado: string; bairro?: string; tipologia: "lote" | "casa" | "apartamento" | "terreno" | "outro"; areaMinM2?: number; areaMaxM2?: number }) {
  const r = await inc.pesquisarMercadoImobiliario.mutate({ id: id(estudoId), ...c });
  if (r.status === "ok") await recarregar();
  return r;
}
/** Grava e RECARREGA o estudo: Massa e Viabilidade passam a ler o novo preço de referência. */
export async function aplicarPrecoReferenciaMercado(estudoId: string, precoM2Lote: number) {
  return gravar(() => inc.aplicarPrecoReferenciaMercado.mutate({ id: id(estudoId), precoM2Lote }));
}
