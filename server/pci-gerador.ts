// Lote 2, correção 03 (AD-06): Gerador de PCI.
// - `pciModelos` (tRPC, só admin — router fora do mapa de módulos) + POST/GET
//   /api/pci-modelos: modelos oficiais versionados ("Sub PCI atual" em Integrações).
// - `pciGerador` (tRPC, módulo Obras) + GET /api/obras/:id/pci-geradas/:gid/:tipo:
//   formulário (rascunho/pré-preenchimento), geração XLS/XLSM + PDF e histórico.
// O envio/upload de PCI da obra (server/routes/obra-medicao-caixa.ts) não muda.
// Gêmeo em Grupo-Santa-Fe/web/src/lib/pci-gerador-dados.ts + rotas de API.
import { createHash } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { constructionProjects, leads } from "../drizzle/schema.js";
import {
  LIMITE_MODELO_PCI_BYTES,
  MENSAGEM_SAIDA_XLS_PCI,
  MENSAGEM_XLSB_SO_LEITURA,
  MIME_MODELO_PCI,
  formatoModeloPci,
  nomeArquivoPciGerada,
  avisosEmpresaNoModeloPci,
  compararPreenchimentoPci,
  conferirProcedenciaPci,
  dadosPessoaisNoModeloPci,
  errosPci,
  extrairModeloPreenchimentoPci,
  faltasPerfilEngenheiroPci,
  formularioPciVazio,
  normalizarFormularioPci,
  pendenciasPci,
  preencherPciAutomatico,
  registrarConfirmacoesPci,
  resumoModeloPreenchimentoPci,
  sugestoesAutomaticasPci,
  validarNomeModeloPci,
  validarNomeModeloPreenchimentoPci,
  type EngenheiroDaObraPci,
  type FontesPreenchimentoPci,
  type FormatoModeloPci,
  type FormularioPci,
} from "../shared/pci-gerador.js";
import { PARTE_PCI_BYTES, validarMontagemPci, validarPartePci } from "../shared/pci-upload.js";
import { sessaoAindaValida } from "../shared/session.js";
import { vgvDaObra } from "../shared/obra-localizacao.js";
import { getTokenFromRequest, verifySessionToken } from "./_core/auth-utils.js";
import { adminProcedure, canAccessAdminProcedure, router } from "./_core/trpc.js";
import { gerarPdfPci, gerarPlanilhaPci, lerFormularioPci, validarModeloPci } from "./caixa/pci-gerador.js";
import { compararEstruturasPci, lerEstruturaModeloPci, xlsCompativelCom, type EstruturaModeloPci, type RelatorioCompatibilidadePci } from "./caixa/pci-modelo-estrutura.js";
import { getDb, getUserById } from "./db.js";
import { copiarParaDrive } from "./drive-organizacao.js";
import { obterLocalizacaoObra } from "./obra-localizacao.js";
import { dadosEngenheiroParaPci, listarEngenheiros } from "./usuario-documentos.js";

type Linhas<T> = { rows: T[] };
const linhas = <T>(r: unknown) => (r as Linhas<T>).rows;

/** Permissões (mesmas checagens do tRPC, usadas também nas rotas Express). */
export const podeGerenciarModelosPci = (u: { role: string; permissions?: string | null; active?: boolean | null }) =>
  canAccessAdminProcedure(u, "pciModelos.listar");
export const podeUsarGeradorPci = (u: { role: string; permissions?: string | null; active?: boolean | null }) =>
  canAccessAdminProcedure(u, "pciGerador.obter");

// ─── modelos ─────────────────────────────────────────────────────────────────

export type ModeloPciResumo = {
  id: number; versao: number; arquivo: string; formato: FormatoModeloPci; tamanho: number; atual: boolean;
  enviadoEm: Date; autor: string | null; observacao: string | null;
  /** Lote 03, correção 10: versão com mudança crítica aguardando confirmação do admin. */
  aguardandoConfirmacao: boolean;
  relatorio: RelatorioCompatibilidadePci | null;
  /** Lote 03, correção 09b: quantas PCIs geradas usam esta versão. */
  pcisGeradas: number;
};

/** Versões não excluídas (a exclusão é lógica: o arquivo fica para as PCIs já geradas). */
export async function listarModelosPci(): Promise<ModeloPciResumo[]> {
  const r = await getDb().execute(sql`
    SELECT m.id, m.version, m.file_name, m.format, m.size_bytes, m.is_current, m.uploaded_at, m.notes, m.awaiting_confirmation, m.compat_report, u.name AS autor,
      (SELECT count(*) FROM pci_generated g WHERE g.model_id = m.id)::int AS usos
    FROM pci_models m LEFT JOIN users u ON u.id = m.uploaded_by WHERE m.deleted_at IS NULL ORDER BY m.version DESC`);
  return linhas<{ id: number; version: number; file_name: string; format: FormatoModeloPci; size_bytes: number; is_current: boolean; uploaded_at: string | Date; notes: string | null; awaiting_confirmation: boolean; compat_report: RelatorioCompatibilidadePci | null; autor: string | null; usos: number }>(r)
    .map((l) => ({ id: l.id, versao: l.version, arquivo: l.file_name, formato: l.format, tamanho: l.size_bytes, atual: l.is_current, enviadoEm: new Date(l.uploaded_at), autor: l.autor, observacao: l.notes,
      aguardandoConfirmacao: !!l.awaiting_confirmation, relatorio: l.compat_report ?? null, pcisGeradas: Number(l.usos) }));
}

export async function modeloAtualPci(): Promise<ModeloPciResumo | null> {
  return (await listarModelosPci()).find((m) => m.atual) ?? null;
}

/** Bytes de uma versão — inclusive excluída (o download da versão usada por uma PCI gerada continua). */
async function bytesDoModelo(id: number): Promise<{ arquivo: string; formato: FormatoModeloPci; versao: number; bytes: Uint8Array } | null> {
  const r = await getDb().execute(sql`SELECT file_name, format, version, encode(data, 'base64') AS b64 FROM pci_models WHERE id = ${id}`);
  const l = linhas<{ file_name: string; format: FormatoModeloPci; version: number; b64: string }>(r)[0];
  return l ? { arquivo: l.file_name, formato: l.format, versao: l.version, bytes: new Uint8Array(Buffer.from(l.b64, "base64")) } : null;
}

async function auditarModeloPci(modeloId: number, acao: "enviar" | "tornar_atual" | "confirmar_critica" | "excluir", usuarioId: number | null, detalhes: Record<string, unknown>) {
  await getDb().execute(sql`INSERT INTO pci_model_audit (model_id, action, user_id, details) VALUES (${modeloId}, ${acao}, ${usuarioId}, ${JSON.stringify(detalhes)}::jsonb)`);
}

export const MENSAGEM_CONFIRMAR_CRITICA_PCI = "Esta versão tem mudanças críticas em relação ao mapeamento (veja o relatório de compatibilidade). Confirme explicitamente para usá-la como atual.";

/**
 * Torna a versão a atual. Versão excluída não pode; versão com mudança crítica
 * só com `confirmarCritica` (Lote 03, correção 10).
 */
export async function definirModeloAtualPci(id: number, opcoes: { usuarioId?: number | null; confirmarCritica?: boolean } = {}) {
  const db = getDb();
  const m = linhas<{ id: number; version: number; deleted_at: string | null; awaiting_confirmation: boolean }>(await db.execute(sql`SELECT id, version, deleted_at, awaiting_confirmation FROM pci_models WHERE id = ${id}`))[0];
  if (!m || m.deleted_at) throw new TRPCError({ code: "NOT_FOUND", message: "Modelo não encontrado." });
  if (m.awaiting_confirmation && !opcoes.confirmarCritica) throw new TRPCError({ code: "PRECONDITION_FAILED", message: MENSAGEM_CONFIRMAR_CRITICA_PCI });
  await db.execute(sql`UPDATE pci_models SET is_current = false WHERE is_current AND id <> ${id}`);
  await db.execute(sql`UPDATE pci_models SET is_current = true, awaiting_confirmation = false,
    confirmed_by = CASE WHEN awaiting_confirmation THEN ${opcoes.usuarioId ?? null}::int ELSE confirmed_by END,
    confirmed_at = CASE WHEN awaiting_confirmation THEN now() ELSE confirmed_at END WHERE id = ${id}`);
  await auditarModeloPci(id, m.awaiting_confirmation ? "confirmar_critica" : "tornar_atual", opcoes.usuarioId ?? null, { versao: m.version });
}

/** Estrutura de uma versão gravada (para comparar e escolher a base .xls). */
async function estruturaDoModelo(id: number): Promise<{ versao: number; formato: FormatoModeloPci; estrutura: EstruturaModeloPci } | null> {
  const m = await bytesDoModelo(id);
  if (!m) return null;
  try { return { versao: m.versao, formato: m.formato, estrutura: lerEstruturaModeloPci(m.bytes, m.formato) }; }
  catch { return null; }
}

/**
 * Grava uma nova versão. Lê a estrutura, compara com a versão atual e guarda o
 * relatório. Sem mudança crítica, vira a atual; com mudança crítica, fica
 * aguardando a confirmação explícita do admin (Lote 03, correção 10).
 * Mesmo arquivo já enviado (não excluído) só volta a ser o atual.
 */
export async function gravarModeloPci(nome: string, bytes: Uint8Array, autorId: number, observacao: string | null) {
  if (!bytes.length || bytes.length > LIMITE_MODELO_PCI_BYTES) throw new Error("Envie um modelo de até 8 MB.");
  const formato = formatoModeloPci(nome, bytes);
  validarModeloPci(bytes, formato);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const db = getDb();
  const igual = linhas<{ id: number; version: number; compat_report: RelatorioCompatibilidadePci | null; awaiting_confirmation: boolean }>(await db.execute(sql`SELECT id, version, compat_report, awaiting_confirmation FROM pci_models WHERE checksum = ${checksum} AND deleted_at IS NULL LIMIT 1`))[0];
  if (igual) {
    if (!igual.awaiting_confirmation) await definirModeloAtualPci(igual.id, { usuarioId: autorId });
    return { id: igual.id, versao: igual.version, formato, repetido: true, aguardandoConfirmacao: igual.awaiting_confirmation, relatorio: igual.compat_report };
  }
  const estrutura = lerEstruturaModeloPci(bytes, formato);
  const atual = await modeloAtualPci();
  const anterior = atual ? await estruturaDoModelo(atual.id) : null;
  const relatorio = compararEstruturasPci(anterior ? { versao: anterior.versao, estrutura: anterior.estrutura } : null, estrutura);
  if (formato !== "xls") {
    const base = await baseXlsCompativel(estrutura, null);
    if (!base) relatorio.avisos.push("Não há versão .xls compatível com este modelo: a geração de PCI ficará bloqueada até o envio da versão .xls.");
    else relatorio.avisos.push(`A PCI será gerada em .xls a partir da versão v${base.versao} (.xls compatível).`);
  }
  const vira = !relatorio.critico;
  if (vira) await db.execute(sql`UPDATE pci_models SET is_current = false WHERE is_current`);
  const r = await db.execute(sql`
    INSERT INTO pci_models (version, file_name, format, size_bytes, checksum, data, is_current, notes, uploaded_by, compat_report, awaiting_confirmation)
    SELECT COALESCE(MAX(version), 0) + 1, ${nome}, ${formato}, ${bytes.length}, ${checksum}, decode(${Buffer.from(bytes).toString("base64")}, 'base64'), ${vira}, ${observacao}, ${autorId},
      ${JSON.stringify(relatorio)}::jsonb, ${!vira}
    FROM pci_models RETURNING id, version`);
  const l = linhas<{ id: number; version: number }>(r)[0];
  await auditarModeloPci(l.id, "enviar", autorId, { versao: l.version, arquivo: nome, formato, critico: relatorio.critico });
  // Pedido de 29/10: cópia em Modelos/PCI CAIXA no Google Drive (falha fica pendente).
  await copiarParaDrive("modelo_pci", Number(l.id));
  return { id: l.id, versao: l.version, formato, repetido: false, aguardandoConfirmacao: !vira, relatorio };
}

/** Prévia da exclusão: nome/versão e quantas PCIs geradas usam a versão. */
export async function previaExclusaoModeloPci(id: number) {
  const m = linhas<{ id: number; version: number; file_name: string; is_current: boolean; deleted_at: string | null; usos: number }>(await getDb().execute(sql`
    SELECT id, version, file_name, is_current, deleted_at, (SELECT count(*) FROM pci_generated g WHERE g.model_id = pci_models.id)::int AS usos FROM pci_models WHERE id = ${id}`))[0];
  if (!m || m.deleted_at) throw new TRPCError({ code: "NOT_FOUND", message: "Modelo não encontrado." });
  return { id: m.id, versao: m.version, arquivo: m.file_name, atual: m.is_current, pcisGeradas: Number(m.usos) };
}

/**
 * Lote 03, correção 09b: exclusão LÓGICA de uma versão (deleted_at/deleted_by). A
 * versão atual não pode ser excluída. O arquivo é preservado: as PCIs geradas
 * continuam vinculadas e o download da versão usada segue funcionando.
 */
export async function excluirModeloPci(id: number, usuarioId: number) {
  const previa = await previaExclusaoModeloPci(id);
  if (previa.atual) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A versão atual não pode ser excluída. Torne outra versão atual antes." });
  const r = await getDb().execute(sql`UPDATE pci_models SET deleted_at = now(), deleted_by = ${usuarioId} WHERE id = ${id} AND deleted_at IS NULL AND NOT is_current RETURNING id`);
  if (!linhas(r).length) throw new TRPCError({ code: "CONFLICT", message: "A versão mudou durante a exclusão. Atualize a lista e tente de novo." });
  await auditarModeloPci(id, "excluir", usuarioId, { versao: previa.versao, arquivo: previa.arquivo, pcisGeradas: previa.pcisGeradas });
  return previa;
}

/**
 * Lote 03, correção 10: base .xls para a saída. Modelo .xls → ele mesmo. Modelo
 * .xlsm/.xlsb → a versão .xls (não excluída) mais recente com a mesma estrutura.
 */
async function baseXlsCompativel(referencia: EstruturaModeloPci, ignorarId: number | null) {
  const xls = linhas<{ id: number; version: number }>(await getDb().execute(sql`SELECT id, version FROM pci_models WHERE format = 'xls' AND deleted_at IS NULL ORDER BY version DESC`));
  for (const c of xls) {
    if (c.id === ignorarId) continue;
    const e = await estruturaDoModelo(c.id);
    if (e && xlsCompativelCom(e.estrutura, referencia)) return { id: c.id, versao: c.version };
  }
  return null;
}

/**
 * Revisão do PR #180 (P2): o que a tela do gerador precisa saber para liberar o botão — com modelo
 * .xlsm/.xlsb atual, a geração só é possível se existir a versão .xls compatível (mesma regra de
 * modeloParaGerarPci). Sem modelo: indisponível.
 */
export async function disponibilidadeGeracaoPci(atual: ModeloPciResumo | null): Promise<{ baseCompativelDisponivel: boolean; baseXlsVersao: number | null; avisoModelo: string | null }> {
  if (!atual) return { baseCompativelDisponivel: false, baseXlsVersao: null, avisoModelo: "Nenhum modelo de PCI cadastrado. O admin envia o modelo oficial em Integrações › PCI da CAIXA." };
  if (atual.formato === "xls") return { baseCompativelDisponivel: true, baseXlsVersao: atual.versao, avisoModelo: null };
  const ref = await estruturaDoModelo(atual.id);
  const base = ref ? await baseXlsCompativel(ref.estrutura, atual.id) : null;
  return base
    ? { baseCompativelDisponivel: true, baseXlsVersao: base.versao, avisoModelo: `Modelo atual em .${atual.formato}: a PCI é gerada em .xls a partir da versão v${base.versao}, de mesma estrutura.` }
    : { baseCompativelDisponivel: false, baseXlsVersao: null, avisoModelo: `Modelo atual em .${atual.formato}: não há versão .xls compatível — a geração fica bloqueada até o admin enviar a versão .xls do modelo oficial em Integrações › PCI da CAIXA.` };
}

export async function modeloParaGerarPci(atual: ModeloPciResumo) {
  if (atual.formato === "xls") {
    const m = await bytesDoModelo(atual.id);
    return m ? { id: atual.id, ...m, aviso: null as string | null } : null;
  }
  const ref = await estruturaDoModelo(atual.id);
  const base = ref ? await baseXlsCompativel(ref.estrutura, atual.id) : null;
  if (!base) throw new TRPCError({ code: "PRECONDITION_FAILED", message: MENSAGEM_SAIDA_XLS_PCI });
  const m = await bytesDoModelo(base.id);
  return m ? { id: base.id, ...m, aviso: `Modelo atual v${atual.versao} (.${atual.formato}): planilha gerada em .xls a partir da versão v${base.versao}, de mesma estrutura.` } : null;
}

// ─── formulário da obra ──────────────────────────────────────────────────────

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

async function obraDoGerador(projectId: number) {
  const [o] = await getDb().select({
    id: constructionProjects.id, title: constructionProjects.title, address: constructionProjects.address, city: constructionProjects.city,
    state: constructionProjects.state, totalArea: constructionProjects.totalArea, vgv: constructionProjects.vgv, leadId: constructionProjects.leadId,
    leadServiceId: constructionProjects.leadServiceId,
    pciLotCost: constructionProjects.pciLotCost, financedAmount: constructionProjects.financedAmount, startDate: constructionProjects.startDate,
    estimatedEndDate: constructionProjects.estimatedEndDate,
  }).from(constructionProjects).where(eq(constructionProjects.id, projectId)).limit(1);
  if (!o) throw new TRPCError({ code: "NOT_FOUND", message: "Obra não encontrada." });
  return o;
}

/**
 * EPIC-024 S-09 (portão de QA): decisão de acesso ao CPF do engenheiro. O dono pediu o CPF do
 * engenheiro preenchido na PCI; quem usa o gerador (admin ou colaborador com Obras) lê o CPF SÓ de
 * quem a própria lista de engenheiros do gerador oferece (`listarEngenheiros`, mesmo filtro).
 * Outro usuário → FORBIDDEN. Cada leitura vira um log estruturado sem dado pessoal (só ids).
 */
async function engenheiroOferecido(userId: number) {
  return (await listarEngenheiros()).some((e) => e.id === userId);
}

function registrarLeituraCpf(evento: { usuarioId: number | null; projectId: number; engenheiroId: number; origem: string; comCpf: boolean }) {
  console.info(JSON.stringify({ evento: "pci.cpf_engenheiro_lido", ...evento, em: new Date().toISOString() }));
}

/** EPIC-024 S-09: engenheiro para a PCI (com CPF), só depois da checagem do módulo Obras. */
export async function engenheiroDaPci(userId: number, contexto: { usuarioId: number | null; projectId: number }) {
  if (!(await engenheiroOferecido(userId))) throw new TRPCError({ code: "FORBIDDEN", message: "Este usuário não está na lista de engenheiros do Gerador de PCI." });
  const e = await dadosEngenheiroParaPci(userId);
  if (!e) throw new TRPCError({ code: "FORBIDDEN", message: "Este usuário não está na lista de engenheiros do Gerador de PCI." });
  registrarLeituraCpf({ ...contexto, engenheiroId: e.id, origem: "selecao", comCpf: !!e.cpf });
  const avisos: string[] = [];
  const nome = e.nome ?? "Este usuário";
  if (!e.temPerfil) avisos.push(`${nome} não tem perfil de Engenheiro: CPF e CREA não estão cadastrados. Complete em Configurações › Usuários.`);
  else if (!e.perfilAtivo) avisos.push(`O perfil de Engenheiro de ${nome} está desativado: CPF, CREA e telefone do perfil não foram usados. Reative em Configurações › Usuários.`);
  else {
    const faltas = faltasPerfilEngenheiroPci(e);
    if (faltas.length) avisos.push(`O perfil de Engenheiro de ${nome} está sem ${faltas.join(", ")}: esses campos ficaram em branco. Complete em Configurações › Usuários.`);
  }
  return { id: String(e.id), nome: e.nome, email: e.email, telefone: e.telefone, crea: e.crea, creaUf: e.creaUf, cpf: e.cpf, perfilAtivo: e.perfilAtivo, temPerfil: e.temPerfil, avisos };
}

type EscolhaEngenheiro = { id: string; fonte: string; escolhido: boolean } | { id: null; motivo: string };

/**
 * Engenheiros da obra para RTP/RTE, só por vínculos que existem: (1) o escolhido no formulário
 * aberto, (2) o do rascunho salvo, (3) o da última PCI gerada desta obra; para o RTP, também
 * (4) o engenheiro do projeto (Projetos, não cancelado) ligado ao MESMO serviço do CRM da obra — só
 * se for um só. Só engenheiros que a lista do gerador oferece; cada CPF lido é registrado.
 */
async function engenheirosDaObra(projectId: number, leadServiceId: number | null, ids: { rtp?: string | null; rte?: string | null }, usuarioId: number | null, origemLeitura = "dados_automaticos") {
  const db = getDb();
  const rascunho = linhas<{ form_data: Partial<FormularioPci> }>(await db.execute(sql`SELECT form_data FROM pci_generator_drafts WHERE project_id = ${projectId}`))[0]?.form_data ?? null;
  const gerada = linhas<{ form_data: Partial<FormularioPci> }>(await db.execute(sql`SELECT form_data FROM pci_generated WHERE project_id = ${projectId} ORDER BY created_at DESC, id DESC LIMIT 1`))[0]?.form_data ?? null;
  let projeto: EscolhaEngenheiro = { id: null, motivo: "A obra não tem serviço do CRM ligado a um projeto com engenheiro." };
  if (leadServiceId) {
    const p = linhas<{ engineer_user_id: number; name: string }>(await db.execute(sql`
      SELECT DISTINCT engineer_user_id, name FROM operational_projects
      WHERE lead_service_id = ${leadServiceId} AND engineer_user_id IS NOT NULL AND COALESCE(status, '') <> 'cancelado'`));
    const distintos = p.map((x) => Number(x.engineer_user_id)).filter((v, i, a) => a.indexOf(v) === i);
    if (distintos.length === 1) projeto = { id: String(distintos[0]), fonte: `Engenheiro do projeto "${p[0].name}" (mesmo serviço do CRM)`, escolhido: false };
    else if (distintos.length > 1) projeto = { id: null, motivo: "Os projetos do mesmo serviço do CRM têm engenheiros diferentes: escolha o engenheiro abaixo." };
  }
  const idValidoEng = (v: unknown) => (typeof v === "string" && /^\d{1,9}$/.test(v) ? v : null);
  const escolher = (papel: "rtp" | "rte"): EscolhaEngenheiro => {
    const chave = papel === "rtp" ? "rtpEngenheiroId" : "rteEngenheiroId";
    const noForm = idValidoEng(ids[papel]);
    if (noForm) return { id: noForm, fonte: "Engenheiro escolhido nesta obra", escolhido: true };
    const noRascunho = idValidoEng(rascunho?.[chave]);
    if (noRascunho) return { id: noRascunho, fonte: "Engenheiro escolhido no rascunho desta obra", escolhido: true };
    const naGerada = idValidoEng(gerada?.[chave]);
    if (naGerada) return { id: naGerada, fonte: "Engenheiro da última PCI gerada desta obra", escolhido: true };
    if (papel === "rtp") return projeto;
    return { id: null, motivo: "Nenhum engenheiro de execução escolhido nesta obra. Escolha abaixo (pode ser o mesmo do RTP)." };
  };
  const oferecidos = new Set((await listarEngenheiros()).map((e) => e.id));
  const resultado: { rtp: EngenheiroDaObraPci | null; rte: EngenheiroDaObraPci | null; motivos: { rtp?: string; rte?: string } } = { rtp: null, rte: null, motivos: {} };
  for (const papel of ["rtp", "rte"] as const) {
    const e = escolher(papel);
    if (e.id === null) { resultado.motivos[papel] = e.motivo; continue; }
    const dados = oferecidos.has(Number(e.id)) ? await dadosEngenheiroParaPci(Number(e.id)) : null;
    if (!dados) { resultado.motivos[papel] = `O engenheiro indicado (usuário nº ${e.id}) não está na lista de engenheiros do gerador (inativo ou sem acesso).`; continue; }
    registrarLeituraCpf({ usuarioId, projectId, engenheiroId: dados.id, origem: origemLeitura, comCpf: !!dados.cpf });
    resultado[papel] = { id: e.id, fonte: e.fonte, escolhido: e.escolhido, dados: { nome: dados.nome, email: dados.email, telefone: dados.telefone, crea: dados.crea, creaUf: dados.creaUf, cpf: dados.cpf, perfilAtivo: dados.perfilAtivo, temPerfil: dados.temPerfil } };
  }
  return resultado;
}

/**
 * EPIC-024 S-09: fontes de "Dados automáticos" com a origem de cada valor e o motivo do que
 * falta. A falha ao ler a PCI vinculada deixa de ser engolida: vira motivo na tela.
 */
export async function fontesAutomaticasPci(projectId: number, ids: { rtp?: string | null; rte?: string | null } = {}, usuarioId: number | null = null, origemLeitura = "dados_automaticos"): Promise<FontesPreenchimentoPci> {
  const o = await obraDoGerador(projectId);
  const db = getDb();
  const [lead] = o.leadId
    ? await db.select({ name: leads.name, cpf: leads.cpf, email: leads.email, phone: leads.phone, address: leads.address, neighborhood: leads.neighborhood, simulationValue: leads.simulationValue })
      .from(leads).where(eq(leads.id, o.leadId)).limit(1)
    : [];
  const motivos: NonNullable<FontesPreenchimentoPci["motivos"]> = {};
  if (!o.leadId) motivos.cliente = "A obra não tem cliente do CRM vinculado.";
  else if (!lead) motivos.cliente = `O cliente do CRM (lead nº ${o.leadId}) não foi encontrado.`;
  let pci: FormularioPci | null = null;
  const arq = linhas<{ b64: string }>(await db.execute(sql`SELECT encode(data, 'base64') AS b64 FROM construction_pci WHERE project_id = ${projectId}`))[0];
  if (!arq) motivos.pci = "A obra não tem PCI vinculada.";
  else {
    try { pci = lerFormularioPci(new Uint8Array(Buffer.from(arq.b64, "base64"))); }
    catch (e) { motivos.pci = `A PCI vinculada não pôde ser lida (${e instanceof Error ? e.message : "arquivo inválido"}).`; }
  }
  let loc: Awaited<ReturnType<typeof obterLocalizacaoObra>> | null = null;
  try { loc = await obterLocalizacaoObra(projectId); }
  catch (e) { motivos.coordenadas = `A localização da obra não pôde ser lida (${e instanceof Error ? e.message : "erro"}).`; }
  const coordenadas = loc?.coords ?? loc?.pontoPci ?? null;
  if (!coordenadas && !motivos.coordenadas) motivos.coordenadas = "A obra não tem localização exata no Mapa operacional.";
  const eng = await engenheirosDaObra(projectId, o.leadServiceId ?? null, ids, usuarioId, origemLeitura);
  return {
    obra: {
      titulo: o.title, endereco: o.address, cidade: o.city, uf: o.state, area: num(o.totalArea),
      valorImovel: num(vgvDaObra({ leadId: o.leadId, simulationValue: lead?.simulationValue ?? null, vgv: o.vgv })),
      valorTerreno: num(o.pciLotCost), valorFinanciado: num(o.financedAmount), inicio: iso(o.startDate), termino: iso(o.estimatedEndDate),
    },
    cliente: lead ? { nome: lead.name, cpf: lead.cpf, email: lead.email, telefone: lead.phone, endereco: lead.address, bairro: lead.neighborhood } : null,
    coordenadas,
    pci,
    rtp: eng.rtp,
    rte: eng.rte,
    rotulos: { cliente: `Cliente do CRM (lead nº ${o.leadId})`, pci: "PCI vinculada à obra" },
    motivos: { ...motivos, ...eng.motivos },
  };
}

/** Pré-preenchimento com o que o sistema já sabe da obra (sem inventar). */
export async function preenchimentoAutomaticoPci(projectId: number, usuarioId: number | null = null): Promise<FormularioPci> {
  return preencherPciAutomatico(await fontesAutomaticasPci(projectId, {}, usuarioId));
}

/** Abertura sem rascunho: o formulário e o relatório (fontes, escolhas de pessoa, o que faltou). */
async function aberturaAutomaticaPci(projectId: number, usuarioId: number | null) {
  const s = sugestoesAutomaticasPci(await fontesAutomaticasPci(projectId, {}, usuarioId));
  const { formulario, ...relatorio } = compararPreenchimentoPci(formularioPciVazio(), s.sugestoes, s.ausencias);
  return { formulario, relatorio };
}

/** "Dados automáticos": sugestões com fonte e o que não foi encontrado (a tela compara e pede confirmação). */
export async function sugestoesAutomaticasDaObraPci(projectId: number, ids: { rtp?: string | null; rte?: string | null }, usuarioId: number | null = null) {
  return sugestoesAutomaticasPci(await fontesAutomaticasPci(projectId, ids, usuarioId));
}

// ─── modelos de preenchimento (EPIC-024 S-09) ────────────────────────────────

type LinhaModeloPreenchimento = {
  id: number; nome: string; versao: number; previous_id: number | null; form_data: unknown; observacao: string | null;
  source_project_id: number | null; obra: string | null; autor: string | null; created_by: number | null; created_at: string | Date;
};

/**
 * Resumo para a tela. O título da obra de origem costuma ter o nome do cliente: só o admin vê
 * (portão de QA, item 5).
 */
const resumoModelo = (l: LinhaModeloPreenchimento, admin: boolean) => {
  const dados = extrairModeloPreenchimentoPci(l.form_data);
  return {
    id: l.id, nome: l.nome, versao: l.versao, anteriorId: l.previous_id, observacao: l.observacao,
    obraOrigemId: admin ? l.source_project_id : null, obraOrigem: admin ? l.obra : null, autor: l.autor, criadoEm: new Date(l.created_at),
    resumo: resumoModeloPreenchimentoPci(dados),
  };
};

const SELECT_MODELO = sql`SELECT m.id, m.nome, m.versao, m.previous_id, m.form_data, m.observacao, m.source_project_id, m.created_by, m.created_at, m.deleted_at,
  p.title AS obra, u.name AS autor
  FROM pci_modelos_preenchimento m LEFT JOIN construction_projects p ON p.id = m.source_project_id LEFT JOIN users u ON u.id = m.created_by`;

async function linhasUltimasVersoes() {
  return linhas<LinhaModeloPreenchimento>(await getDb().execute(sql`${SELECT_MODELO}
    WHERE m.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM pci_modelos_preenchimento n WHERE n.previous_id = m.id)
    ORDER BY lower(m.nome), m.id`));
}

/** Última versão de cada modelo não excluído. */
export async function listarModelosPreenchimentoPci(admin = false) {
  return (await linhasUltimasVersoes()).map((l) => resumoModelo(l, admin));
}

async function linhaModelo(id: number) {
  return linhas<LinhaModeloPreenchimento & { deleted_at: string | null; sucessor: number | null }>(await getDb().execute(sql`
    SELECT x.*, (SELECT n.id FROM pci_modelos_preenchimento n WHERE n.previous_id = x.id) AS sucessor FROM (${SELECT_MODELO} WHERE m.id = ${id}) x`))[0] ?? null;
}

/** Cadeia de versões a partir de `id` para trás (inclusive excluídas), mais nova primeiro. */
async function cadeiaModelo(id: number) {
  return linhas<LinhaModeloPreenchimento & { deleted_at: string | null }>(await getDb().execute(sql`
    WITH RECURSIVE cadeia AS (
      SELECT id, previous_id, 1 AS passo FROM pci_modelos_preenchimento WHERE id = ${id}
      UNION ALL SELECT m.id, m.previous_id, c.passo + 1 FROM pci_modelos_preenchimento m JOIN cadeia c ON m.id = c.previous_id WHERE c.passo < 500
    )
    ${SELECT_MODELO} WHERE m.id IN (SELECT id FROM cadeia) ORDER BY m.versao DESC`));
}

const MENSAGEM_VERSAO_CONCORRENTE = "Outra pessoa salvou uma versão deste modelo agora. Atualize a lista e tente de novo.";

/** Nome do índice/restrição de uma violação de unicidade do Postgres (23505), ou null. */
function violacaoUnica(e: unknown): string | null {
  const erros: unknown[] = [e, (e as { cause?: unknown } | null)?.cause];
  for (const x of erros) {
    const o = x as { code?: unknown; constraint?: unknown; message?: unknown } | null;
    if (!o || typeof o !== "object") continue;
    const texto = String(o.message ?? "");
    if (o.code === "23505" || /duplicate key|unique/i.test(texto)) {
      if (typeof o.constraint === "string") return o.constraint;
      const m = /"([a-z_]+_uidx)"/.exec(texto);
      return m ? m[1] : "desconhecida";
    }
  }
  return null;
}

/**
 * Salva os dados técnicos da obra como modelo (ou nova versão de um modelo). O servidor tira os
 * dados pessoais/específicos (lista de permissão) — não confia no que vem do navegador — e RECUSA
 * texto livre com CPF, CNPJ, e-mail ou telefone (a pessoa vê o campo e corrige; nada some em silêncio).
 */
export async function salvarModeloPreenchimentoPci(entrada: { projectId: number; nome: unknown; formulario: unknown; observacao?: string | null; novaVersaoDe?: number | null }, autorId: number) {
  await obraDoGerador(entrada.projectId);
  const nome = validarNomeModeloPreenchimentoPci(entrada.nome);
  const dados = extrairModeloPreenchimentoPci(normalizarFormularioPci(entrada.formulario));
  if (!Object.keys(dados.campos).length && !dados.custos.some((x) => x !== null) && !dados.cronograma.some((x) => x !== null))
    throw new TRPCError({ code: "BAD_REQUEST", message: "Não há dados técnicos para guardar no modelo (memorial, sistema construtivo, custos ou cronograma)." });
  const observacao = entrada.observacao?.trim() ? entrada.observacao.trim().slice(0, 500) : null;
  const pessoais = dadosPessoaisNoModeloPci({ nome, observacao, dados });
  if (pessoais.length) {
    // O trecho (meio mascarado) ajuda a achar o dado num memorial longo.
    throw new TRPCError({ code: "BAD_REQUEST", message: `O modelo não pode levar dados pessoais. Tire antes de salvar: ${pessoais.map((p) => `${p.campo} (${p.tipos.join(", ")}: ${p.trechos.map((t) => `"${t}"`).join(", ")})`).join("; ")}.` });
  }
  const avisos = avisosEmpresaNoModeloPci({ nome, observacao, dados });
  const db = getDb();
  let versao = 1;
  let anterior: number | null = null;
  if (entrada.novaVersaoDe) {
    const base = await linhaModelo(entrada.novaVersaoDe);
    if (!base || base.deleted_at) throw new TRPCError({ code: "NOT_FOUND", message: "Modelo não encontrado." });
    if (base.sucessor) throw new TRPCError({ code: "CONFLICT", message: "Este modelo já tem uma versão mais nova. Atualize a lista e salve sobre a última versão." });
    versao = base.versao + 1;
    anterior = base.id;
  }
  // Nome único entre os modelos — também na nova versão (não pode tomar o nome de OUTRO modelo).
  const repetido = (await linhasUltimasVersoes()).find((m) => m.id !== anterior && m.nome.toLocaleLowerCase("pt-BR") === nome.toLocaleLowerCase("pt-BR"));
  if (repetido) throw new TRPCError({ code: "CONFLICT", message: `Já existe o modelo "${repetido.nome}". ${anterior ? "Escolha outro nome para esta versão." : "Salve como nova versão dele ou escolha outro nome."}` });
  let id: number;
  try {
    // Nova versão: marca a anterior como substituída na MESMA instrução (o índice único parcial do nome
    // vale só para a versão atual); se outra pessoa já salvou a sucessora, nada é gravado.
    const r = anterior
      ? await db.execute(sql`
        WITH base AS (UPDATE pci_modelos_preenchimento SET substituido = true WHERE id = ${anterior} AND NOT substituido AND deleted_at IS NULL RETURNING id)
        INSERT INTO pci_modelos_preenchimento (nome, versao, previous_id, form_data, observacao, source_project_id, created_by)
        SELECT ${nome}, ${versao}, base.id, ${JSON.stringify(dados)}::jsonb, ${observacao}, ${entrada.projectId}, ${autorId} FROM base RETURNING id`)
      : await db.execute(sql`
        INSERT INTO pci_modelos_preenchimento (nome, versao, previous_id, form_data, observacao, source_project_id, created_by)
        VALUES (${nome}, ${versao}, NULL, ${JSON.stringify(dados)}::jsonb, ${observacao}, ${entrada.projectId}, ${autorId}) RETURNING id`);
    const l = linhas<{ id: number }>(r)[0];
    if (!l) throw new TRPCError({ code: "CONFLICT", message: MENSAGEM_VERSAO_CONCORRENTE });
    id = Number(l.id);
  } catch (e) {
    if (e instanceof TRPCError) throw e;
    const violacao = violacaoUnica(e);
    if (violacao === "pci_modelos_preenchimento_nome_atual_uidx") throw new TRPCError({ code: "CONFLICT", message: `Já existe o modelo "${nome}" (outra pessoa acabou de salvar com este nome). Atualize a lista e salve como nova versão dele ou escolha outro nome.` });
    if (violacao) throw new TRPCError({ code: "CONFLICT", message: MENSAGEM_VERSAO_CONCORRENTE });
    throw e;
  }
  return { id, nome, versao, avisos };
}

/** Dados técnicos de uma versão (inclusive anterior), para aplicar em outra obra. */
export async function obterModeloPreenchimentoPci(id: number, admin = false) {
  const l = await linhaModelo(id);
  if (!l || l.deleted_at) throw new TRPCError({ code: "NOT_FOUND", message: "Modelo não encontrado." });
  return { ...resumoModelo(l, admin), dados: extrairModeloPreenchimentoPci(l.form_data) };
}

/** Versões de um modelo (da indicada para trás), mais nova primeiro. */
export async function historicoModeloPreenchimentoPci(id: number, admin = false) {
  return (await cadeiaModelo(id)).filter((l) => !l.deleted_at).map((l) => resumoModelo(l, admin));
}

/**
 * Exclusão LÓGICA do modelo (todas as versões). Só o admin ou o AUTOR ORIGINAL (quem salvou a
 * versão 1) — quem só acrescentou uma versão não apaga o modelo de outra pessoa.
 */
export async function excluirModeloPreenchimentoPci(id: number, usuario: { id: number; role: string }) {
  const l = await linhaModelo(id);
  if (!l || l.deleted_at) throw new TRPCError({ code: "NOT_FOUND", message: "Modelo não encontrado." });
  if (l.sucessor) throw new TRPCError({ code: "CONFLICT", message: "Exclua pela última versão do modelo (atualize a lista)." });
  const cadeia = await cadeiaModelo(id);
  const original = cadeia[cadeia.length - 1];
  if (usuario.role !== "admin" && original?.created_by !== usuario.id) throw new TRPCError({ code: "FORBIDDEN", message: "Só o administrador ou quem criou o modelo pode excluí-lo." });
  const ativas = cadeia.filter((v) => !v.deleted_at);
  for (const v of ativas) await getDb().execute(sql`UPDATE pci_modelos_preenchimento SET deleted_at = now(), deleted_by = ${usuario.id} WHERE id = ${v.id} AND deleted_at IS NULL`);
  return { nome: l.nome, versoes: ativas.length };
}

export async function historicoPci(projectId: number) {
  const r = await getDb().execute(sql`
    SELECT g.id, g.model_version, g.sheet_file_name, g.sheet_format, g.pdf_file_name, g.warnings, g.created_at, u.name AS autor,
      octet_length(g.sheet_data) AS sheet_size, octet_length(g.pdf_data) AS pdf_size
    FROM pci_generated g LEFT JOIN users u ON u.id = g.created_by WHERE g.project_id = ${projectId} ORDER BY g.created_at DESC, g.id DESC`);
  return linhas<{ id: number; model_version: number; sheet_file_name: string; sheet_format: string; pdf_file_name: string; warnings: string[]; created_at: string | Date; autor: string | null; sheet_size: number; pdf_size: number }>(r)
    .map((l) => ({ id: l.id, modeloVersao: l.model_version, planilha: l.sheet_file_name, formato: l.sheet_format, pdf: l.pdf_file_name, avisos: l.warnings ?? [], geradoEm: new Date(l.created_at), autor: l.autor, tamanhoPlanilha: Number(l.sheet_size), tamanhoPdf: Number(l.pdf_size) }));
}

/** Rascunho gravado (normalizado), para comparar confirmações já registradas. */
async function rascunhoGravado(projectId: number): Promise<FormularioPci | null> {
  const l = linhas<{ form_data: unknown }>(await getDb().execute(sql`SELECT form_data FROM pci_generator_drafts WHERE project_id = ${projectId}`))[0];
  return l ? normalizarFormularioPci(l.form_data) : null;
}

/**
 * EPIC-024 S-09 (portão 2, L3): a procedência que veio do navegador é conferida com as fontes de
 * hoje (as mesmas de "Dados automáticos") — só quando o formulário cita alguma fonte conferível.
 */
async function conferirProcedenciaNoServidor(projectId: number, form: FormularioPci, usuarioId: number): Promise<FormularioPci> {
  const citaFonte = Object.values(form.procedencia ?? {}).some((o) => o.split("+").some((x) => /^(engenheiro:\d+|crm|pci)$/.test(x)));
  if (!citaFonte) return form;
  const s = sugestoesAutomaticasPci(await fontesAutomaticasPci(projectId, { rtp: form.rtpEngenheiroId, rte: form.rteEngenheiroId }, usuarioId, "conferencia_geracao"));
  const r = conferirProcedenciaPci(form, s.sugestoes);
  if (r.rebaixadas.length) console.info(JSON.stringify({ evento: "pci.procedencia_rebaixada", usuarioId, projectId, campos: r.rebaixadas, em: new Date().toISOString() }));
  return r.formulario;
}

/** EPIC-024 S-09 (portão 2, L4): quem confirmou e quando (servidor) + log estruturado só com ids. */
async function registrarConfirmacoes(projectId: number, form: FormularioPci, usuarioId: number): Promise<FormularioPci> {
  const agora = new Date();
  const r = registrarConfirmacoesPci(form, await rascunhoGravado(projectId), usuarioId, agora);
  for (const pessoa of r.novas) console.info(JSON.stringify({ evento: "pci.pessoa_confirmada", usuarioId, projectId, pessoa, em: agora.toISOString() }));
  return r.formulario;
}

async function salvarRascunho(projectId: number, form: FormularioPci, autorId: number) {
  await getDb().execute(sql`
    INSERT INTO pci_generator_drafts (project_id, form_data, updated_by, updated_at) VALUES (${projectId}, ${JSON.stringify(form)}::jsonb, ${autorId}, now())
    ON CONFLICT (project_id) DO UPDATE SET form_data = EXCLUDED.form_data, updated_by = EXCLUDED.updated_by, updated_at = now()`);
}

/**
 * Opções de quem gera fora da tela (EPIC-025, Dolores): `regravarRascunho: false` gera a partir do rascunho SEM regravá-lo
 * (o rascunho é da equipe: autoria e edição em andamento não mudam); `prazoDriveMs` limita cada cópia ao Drive (passou,
 * a cópia fica pendente para o organizador). Sem opções, o comportamento é o da tela (botão "Gerar").
 */
export type OpcoesGeracaoPci = { regravarRascunho?: boolean; prazoDriveMs?: number };

export async function gerarPciDaObra(projectId: number, entrada: unknown, autor: { id: number; name: string | null }, opcoes: OpcoesGeracaoPci = {}) {
  const obra = await obraDoGerador(projectId);
  let form = await conferirProcedenciaNoServidor(projectId, normalizarFormularioPci(entrada), autor.id);
  // Lote 03, correção 06/07: valores inválidos, cronograma incompleto ou fora da lista bloqueiam.
  const erros = errosPci(form, { paraGerar: true });
  if (erros.length) throw new TRPCError({ code: "BAD_REQUEST", message: `Corrija antes de gerar: ${erros.join(" ")}` });
  const atual = await modeloAtualPci();
  if (!atual) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Nenhum modelo de PCI cadastrado. Envie o modelo oficial em Integrações › PCI da CAIXA." });
  const modelo = await modeloParaGerarPci(atual);
  if (!modelo) throw new TRPCError({ code: "NOT_FOUND", message: "Modelo não encontrado." });
  form = await registrarConfirmacoes(projectId, form, autor.id);
  if (opcoes.regravarRascunho !== false) await salvarRascunho(projectId, form, autor.id);
  let planilha;
  try {
    planilha = gerarPlanilhaPci(modelo.bytes, modelo.formato, form);
    if (modelo.aviso) planilha.avisos.unshift(modelo.aviso);
  } catch (e) {
    throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Não foi possível preencher o modelo." });
  }
  const agora = new Date();
  const pdf = gerarPdfPci(form, { obraTitulo: obra.title, modeloVersao: modelo.versao, modeloArquivo: modelo.arquivo, geradoEm: agora, autor: autor.name });
  const nomePlanilha = nomeArquivoPciGerada(form.campos.proponenteNome, obra.title, modelo.versao, planilha.formato);
  const nomePdf = nomeArquivoPciGerada(form.campos.proponenteNome, obra.title, modelo.versao, "pdf");
  const r = await getDb().execute(sql`
    INSERT INTO pci_generated (project_id, model_id, model_version, form_data, warnings, sheet_file_name, sheet_format, sheet_data, pdf_file_name, pdf_data, created_by, created_at)
    VALUES (${projectId}, ${modelo.id}, ${modelo.versao}, ${JSON.stringify(form)}::jsonb, ${JSON.stringify(planilha.avisos)}::jsonb, ${nomePlanilha}, ${planilha.formato},
      decode(${Buffer.from(planilha.bytes).toString("base64")}, 'base64'), ${nomePdf}, decode(${Buffer.from(pdf).toString("base64")}, 'base64'), ${autor.id}, ${agora})
    RETURNING id`);
  const id = Number(linhas<{ id: number }>(r)[0].id);
  // Pedido de 29/10: cópias em Obras/<Obra (nº id)>/Gerador de PCI (falha fica pendente).
  await copiarParaDrive("pci_gerada_planilha", id, undefined, opcoes.prazoDriveMs);
  await copiarParaDrive("pci_gerada_pdf", id, undefined, opcoes.prazoDriveMs);
  return { id, avisos: planilha.avisos, pendencias: pendenciasPci(form) };
}

// ─── tRPC ────────────────────────────────────────────────────────────────────

const projectIdInput = z.object({ projectId: z.number().int().positive() });
const formularioInput = z.object({ projectId: z.number().int().positive(), formulario: z.unknown() });
const erroLegivel = (e: unknown): never => {
  if (e instanceof TRPCError) throw e;
  throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e) });
};

/** Só admin: o router não está no mapa de módulos do colaborador (server/_core/trpc.ts). */
export const pciModelosRouter = router({
  listar: adminProcedure.query(() => listarModelosPci()),
  definirAtual: adminProcedure.input(z.object({ id: z.number().int().positive(), confirmarCritica: z.boolean().optional() })).mutation(async ({ input, ctx }) => {
    await definirModeloAtualPci(input.id, { usuarioId: ctx.user.id, confirmarCritica: input.confirmarCritica === true });
    return { ok: true };
  }),
  previaExclusao: adminProcedure.input(z.object({ id: z.number().int().positive() })).query(({ input }) => previaExclusaoModeloPci(input.id)),
  excluir: adminProcedure.input(z.object({ id: z.number().int().positive(), confirmar: z.literal(true) })).mutation(async ({ input, ctx }) => {
    const r = await excluirModeloPci(input.id, ctx.user.id);
    return { ok: true, versao: r.versao, pcisGeradas: r.pcisGeradas };
  }),
});

/** Módulo Obras (admin ou colaborador com Obras). O empreiteiro não usa o gerador. */
export const pciGeradorRouter = router({
  obter: adminProcedure.input(projectIdInput).query(async ({ input, ctx }) => {
    await obraDoGerador(input.projectId);
    const [rascunho] = linhas<{ form_data: unknown; updated_at: string | Date; autor: string | null }>(await getDb().execute(sql`
      SELECT d.form_data, d.updated_at, u.name AS autor FROM pci_generator_drafts d LEFT JOIN users u ON u.id = d.updated_by WHERE d.project_id = ${input.projectId}`));
    const modelo = await modeloAtualPci();
    // EPIC-024 S-09: sem rascunho, a abertura mostra o mesmo relatório do botão (fontes, escolhas de pessoa).
    const abertura = rascunho ? null : await aberturaAutomaticaPci(input.projectId, ctx.user.id);
    const formulario = rascunho ? normalizarFormularioPci(rascunho.form_data) : abertura!.formulario;
    const engenheiros = (await listarEngenheiros()).map((e) => ({ id: String(e.id), nome: e.name, email: e.email, telefone: e.telefone, crea: e.crea, creaUf: e.creaUf, engenheiro: e.engenheiro }));
    return {
      modelo: modelo ? { versao: modelo.versao, arquivo: modelo.arquivo, formato: modelo.formato, enviadoEm: modelo.enviadoEm } : null,
      ...(await disponibilidadeGeracaoPci(modelo)),
      formulario,
      preenchimento: abertura?.relatorio ?? null,
      origem: rascunho ? ("rascunho" as const) : ("automatico" as const),
      rascunhoEm: rascunho ? new Date(rascunho.updated_at) : null,
      rascunhoAutor: rascunho?.autor ?? null,
      engenheiros,
      historico: await historicoPci(input.projectId),
    };
  }),
  preencherAutomatico: adminProcedure.input(projectIdInput).query(({ input, ctx }) => preenchimentoAutomaticoPci(input.projectId, ctx.user.id)),
  // EPIC-024 S-09: CPF, CREA e telefone de UM engenheiro oferecido na lista (o escolhido em RTP/RTE) — a lista não leva CPF.
  engenheiro: adminProcedure.input(z.object({ projectId: z.number().int().positive(), userId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    await obraDoGerador(input.projectId);
    return engenheiroDaPci(input.userId, { usuarioId: ctx.user.id, projectId: input.projectId });
  }),
  // EPIC-024 S-09: "Dados automáticos" com a fonte de cada valor; a tela compara e confirma conflitos.
  sugestoesAutomaticas: adminProcedure.input(z.object({ projectId: z.number().int().positive(), rtpEngenheiroId: z.string().max(64).nullish(), rteEngenheiroId: z.string().max(64).nullish() }))
    .query(({ input, ctx }) => sugestoesAutomaticasDaObraPci(input.projectId, { rtp: input.rtpEngenheiroId, rte: input.rteEngenheiroId }, ctx.user.id)),
  // EPIC-024 S-09: biblioteca de modelos de preenchimento (só dados técnicos, versionados).
  modelosPreenchimento: adminProcedure.query(({ ctx }) => listarModelosPreenchimentoPci(ctx.user.role === "admin")),
  modeloPreenchimento: adminProcedure.input(z.object({ id: z.number().int().positive() })).query(({ input, ctx }) => obterModeloPreenchimentoPci(input.id, ctx.user.role === "admin")),
  historicoModeloPreenchimento: adminProcedure.input(z.object({ id: z.number().int().positive() })).query(({ input, ctx }) => historicoModeloPreenchimentoPci(input.id, ctx.user.role === "admin")),
  salvarModeloPreenchimento: adminProcedure.input(z.object({
    projectId: z.number().int().positive(), nome: z.string().max(200), formulario: z.unknown(),
    observacao: z.string().max(1000).nullish(), novaVersaoDe: z.number().int().positive().nullish(),
  })).mutation(async ({ input, ctx }) => {
    try { return await salvarModeloPreenchimentoPci(input, ctx.user.id); }
    catch (e) { return erroLegivel(e); }
  }),
  excluirModeloPreenchimento: adminProcedure.input(z.object({ id: z.number().int().positive(), confirmar: z.literal(true) })).mutation(({ input, ctx }) =>
    excluirModeloPreenchimentoPci(input.id, { id: ctx.user.id, role: ctx.user.role })),
  salvarRascunho: adminProcedure.input(formularioInput).mutation(async ({ input, ctx }) => {
    try {
      await obraDoGerador(input.projectId);
      let form = normalizarFormularioPci(input.formulario);
      const erros = errosPci(form, { paraGerar: false });
      if (erros.length) throw new TRPCError({ code: "BAD_REQUEST", message: `Corrija antes de salvar: ${erros.join(" ")}` });
      form = await registrarConfirmacoes(input.projectId, form, ctx.user.id);
      await salvarRascunho(input.projectId, form, ctx.user.id);
      return { ok: true, pendencias: pendenciasPci(form) };
    } catch (e) { return erroLegivel(e); }
  }),
  gerar: adminProcedure.input(formularioInput).mutation(async ({ input, ctx }) => {
    try { return await gerarPciDaObra(input.projectId, input.formulario, { id: ctx.user.id, name: ctx.user.name ?? null }); }
    catch (e) { return erroLegivel(e); }
  }),
  historico: adminProcedure.input(projectIdInput).query(({ input }) => historicoPci(input.projectId)),
});

// ─── rotas Express (envio em partes e downloads) ─────────────────────────────

const rotas = Router();

async function usuarioDaSessao(req: Request) {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  const usuario = await getUserById(payload.userId);
  if (!usuario || !sessaoAindaValida(usuario, payload.sessionVersion) || !usuario.active) return null;
  return usuario;
}

const idValido = (v: string) => (/^\d{1,9}$/.test(v) ? Number(v) : null);
const nomeSeguro = (nome: string) => nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\- ]+/g, "").trim().slice(0, 120) || "arquivo";

/** Envia o arquivo inteiro ou, com ?parte=N, partes de 1 MB (limite de resposta da Vercel). */
function enviarArquivo(req: Request, res: Response, bytes: Uint8Array, nome: string, tipo: string) {
  const versao = createHash("sha256").update(bytes).digest("hex");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `attachment; filename="${nomeSeguro(nome)}"`);
  if (req.query.parte !== undefined) {
    const parte = Number(req.query.parte);
    const total = Math.max(1, Math.ceil(bytes.length / PARTE_PCI_BYTES));
    if (!Number.isInteger(parte) || parte < 0 || parte >= total) return res.status(400).json({ error: "Parte inválida." });
    if (req.query.versao && req.query.versao !== versao) return res.status(409).json({ error: "O arquivo foi alterado durante o download. Tente novamente." });
    res.setHeader("X-Arquivo-Partes", String(total));
    res.setHeader("X-Arquivo-Versao", versao);
    const pedaco = bytes.slice(parte * PARTE_PCI_BYTES, (parte + 1) * PARTE_PCI_BYTES);
    res.setHeader("Content-Type", tipo);
    res.setHeader("Content-Length", String(pedaco.length));
    return res.end(Buffer.from(pedaco));
  }
  res.setHeader("Content-Type", tipo);
  res.setHeader("Content-Length", String(bytes.length));
  return res.end(Buffer.from(bytes));
}

const ESCOPO_MODELO = "pci-modelo";

rotas.post("/pci-modelos", async (req: Request, res: Response) => {
  try {
    const usuario = await usuarioDaSessao(req);
    if (!usuario) return res.status(401).json({ error: "Sessão expirada. Entre novamente." });
    if (!podeGerenciarModelosPci(usuario)) return res.status(403).json({ error: "Só o administrador envia o modelo da PCI." });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const userId = String(usuario.id);
    const db = getDb();
    if (body.finalizar === true) {
      if (typeof body.uploadId !== "string" || !/^[a-zA-Z0-9-]{20,64}$/.test(body.uploadId)) return res.status(400).json({ error: "Identificador de envio inválido." });
      const partes = linhas<{ chunk_index: number; total_chunks: number; file_name: string; b64: string }>(await db.execute(sql`
        SELECT chunk_index, total_chunks, file_name, encode(data,'base64') AS b64 FROM pci_upload_chunks
        WHERE upload_id = ${body.uploadId} AND user_id = ${userId} AND project_id = ${ESCOPO_MODELO} AND created_at > now() - interval '30 minutes' ORDER BY chunk_index`));
      let nome: string;
      try { nome = nomeSeguro(validarNomeModeloPci(validarMontagemPci(partes))); }
      catch (e) { return res.status(400).json({ error: e instanceof Error ? e.message : "Envio incompleto." }); }
      const bytes = new Uint8Array(Buffer.concat(partes.map((p) => Buffer.from(p.b64, "base64"))));
      const observacao = typeof body.observacao === "string" && body.observacao.trim() ? body.observacao.trim().slice(0, 500) : null;
      let r;
      try { r = await gravarModeloPci(nome, bytes, usuario.id, observacao); }
      catch (e) { return res.status(400).json({ error: e instanceof Error ? e.message : "Modelo inválido." }); }
      finally { await db.execute(sql`DELETE FROM pci_upload_chunks WHERE upload_id = ${body.uploadId} AND user_id = ${userId} AND project_id = ${ESCOPO_MODELO}`); }
      return res.json({ ...r, aviso: r.aguardandoConfirmacao ? MENSAGEM_CONFIRMAR_CRITICA_PCI : r.formato === "xlsb" ? MENSAGEM_XLSB_SO_LEITURA : null });
    }
    // Parte do envio: mesmas regras do envio da PCI da obra (1 MB por parte, até 8 MB).
    let parte;
    try {
      const nome = validarNomeModeloPci(body.nome);
      // validarPartePci só aceita .xls/.xlsb no nome; a extensão já foi conferida acima.
      parte = { ...validarPartePci({ ...body, nome: "modelo.xls" }), nome };
    } catch (e) { return res.status(400).json({ error: e instanceof Error ? e.message.replace("da PCI", "do modelo") : "Parte inválida." }); }
    const data = Buffer.from(parte.chunk, "base64");
    if (!data.length || data.length > PARTE_PCI_BYTES) return res.status(400).json({ error: "Parte do modelo maior que 1 MB." });
    await db.execute(sql`DELETE FROM pci_upload_chunks WHERE created_at <= now() - interval '30 minutes'`);
    const inserida = await db.execute(sql`
      INSERT INTO pci_upload_chunks(upload_id, chunk_index, total_chunks, user_id, project_id, file_name, data)
      VALUES (${parte.uploadId}, ${parte.chunkIndex}, ${parte.totalChunks}, ${userId}, ${ESCOPO_MODELO}, ${parte.nome}, decode(${parte.chunk}, 'base64'))
      ON CONFLICT (upload_id, chunk_index) DO UPDATE SET data = EXCLUDED.data
      WHERE pci_upload_chunks.user_id = EXCLUDED.user_id AND pci_upload_chunks.project_id = EXCLUDED.project_id
        AND pci_upload_chunks.total_chunks = EXCLUDED.total_chunks AND pci_upload_chunks.file_name = EXCLUDED.file_name
      RETURNING chunk_index`);
    if (!linhas(inserida).length) return res.status(409).json({ error: "Envio inconsistente. Selecione novamente o modelo." });
    return res.json({ recebida: parte.chunkIndex });
  } catch (error) {
    console.error("[pci-gerador] envio do modelo:", error instanceof Error ? error.message : "erro");
    return res.status(500).json({ error: "Erro ao gravar o modelo. Tente novamente." });
  }
});

rotas.get("/pci-modelos/:id/arquivo", async (req: Request, res: Response) => {
  try {
    const usuario = await usuarioDaSessao(req);
    if (!usuario) return res.status(401).json({ error: "Sessão expirada. Entre novamente." });
    if (!podeGerenciarModelosPci(usuario)) return res.status(403).json({ error: "Sem permissão." });
    const id = idValido(String(req.params.id));
    const m = id ? await bytesDoModelo(id) : null;
    if (!m) return res.status(404).json({ error: "Modelo não encontrado." });
    return enviarArquivo(req, res, m.bytes, m.arquivo, MIME_MODELO_PCI[m.formato]);
  } catch (error) {
    console.error("[pci-gerador] download do modelo:", error instanceof Error ? error.message : "erro");
    return res.status(500).json({ error: "Erro ao baixar o modelo." });
  }
});

rotas.get("/obras/:projectId/pci-geradas/:id/:tipo(planilha|pdf)", async (req: Request, res: Response) => {
  try {
    const usuario = await usuarioDaSessao(req);
    if (!usuario) return res.status(401).json({ error: "Sessão expirada. Entre novamente." });
    if (!podeUsarGeradorPci(usuario)) return res.status(403).json({ error: "Sem permissão nesta obra." });
    const projectId = idValido(String(req.params.projectId));
    const id = idValido(String(req.params.id));
    if (!projectId || !id) return res.status(404).json({ error: "PCI gerada não encontrada." });
    const pdf = req.params.tipo === "pdf";
    const l = linhas<{ nome: string; formato: string; b64: string }>(await getDb().execute(pdf
      ? sql`SELECT pdf_file_name AS nome, 'pdf' AS formato, encode(pdf_data, 'base64') AS b64 FROM pci_generated WHERE id = ${id} AND project_id = ${projectId}`
      : sql`SELECT sheet_file_name AS nome, sheet_format AS formato, encode(sheet_data, 'base64') AS b64 FROM pci_generated WHERE id = ${id} AND project_id = ${projectId}`))[0];
    if (!l) return res.status(404).json({ error: "PCI gerada não encontrada." });
    const tipo = pdf ? "application/pdf" : MIME_MODELO_PCI[l.formato as FormatoModeloPci] ?? "application/octet-stream";
    return enviarArquivo(req, res, new Uint8Array(Buffer.from(l.b64, "base64")), l.nome, tipo);
  } catch (error) {
    console.error("[pci-gerador] download:", error instanceof Error ? error.message : "erro");
    return res.status(500).json({ error: "Erro ao baixar a PCI gerada." });
  }
});

export default rotas;
