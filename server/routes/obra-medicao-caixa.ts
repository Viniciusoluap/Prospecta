import { LIMITE_PCI_BYTES, PARTE_PCI_BYTES, validarPartePci, validarMontagemPci } from "../../shared/pci-upload.js";
import { Router, Request, Response } from "express";
import { and, asc, eq, lt, or } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { constructionProgressHistory, constructionProjects } from "../../drizzle/schema.js";
import { getTokenFromRequest, verifySessionToken } from "../_core/auth-utils.js";
import { getDb, getUserById } from "../db.js";
import { sessaoAindaValida } from "../../shared/session.js";
import { podeGerenciarFotos } from "../../shared/obra-fotos.js";
import { canAccessAdminProcedure } from "../_core/trpc.js";
import { SERVICOS_PROGRESSO } from "../../shared/financeiro/progresso.js";
import { dadosPlsPadrao, incidenciasCorrespondem, ehTipoMedicao, normalizarDadosMedicao, QUADROS_FOTO, type DadosMedicaoCaixa } from "../../shared/medicao-caixa.js";
import { lerPci, type DadosPci } from "../caixa/pci.js";
import type { FotoMedicao, MedicaoHistorica } from "../caixa/medicao-xls.js";
import { gerarPdfMedicao } from "../caixa/medicao-pdf.js";
import { tryDriveUpload, uploadArquivoMedicaoObra } from "../drive-documents.js";
import { createHash } from "node:crypto";

// Pedido de 18/10 — PCI da CAIXA por obra e arquivo da medição (.pdf para
// assinatura). Lote 02, correção 01: a medição (PLS, Repactuação e Alteração,
// que compartilham o mesmo arquivo) não é mais gerada em .xls; a PCI continua
// em Excel. Rotas Express puras, com a mesma verificação
// de sessão das fotos da obra (server/routes/obra-fotos.ts).

const router = Router();
const LIMITE_PCI = LIMITE_PCI_BYTES;
/** Resposta das funções da Vercel: até 4,5 MB. Acima disso o arquivo só vai para o Drive. */
const LIMITE_DOWNLOAD = 4.3 * 1024 * 1024;
const MENSAGEM_LIMITE_DOWNLOAD = "O arquivo desta medição passou de 4,3 MB (limite de download do servidor). Com o Google Drive conectado, ele fica completo em Obras/<Obra>/Medições CAIXA; para baixar por aqui, use menos fotos ou fotos menores.";

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

/** Admin, equipe com o módulo Obras ou o empreiteiro vinculado à obra. */
async function autorizado(req: Request, projectId: number) {
  const usuario = await usuarioDaSessao(req);
  if (!usuario) return { ok: false as const, erro: 401 as const };
  const [obra] = await getDb().select({ id: constructionProjects.id, empreiteiroId: constructionProjects.contractorUserId, titulo: constructionProjects.title })
    .from(constructionProjects).where(eq(constructionProjects.id, projectId)).limit(1);
  if (!obra) return { ok: false as const, erro: 404 as const };
  const pode = podeGerenciarFotos(
    { id: usuario.id, papel: usuario.role, acessoObras: canAccessAdminProcedure(usuario, "obraProgresso.salvar") },
    { empreiteiroId: obra.empreiteiroId ?? null }
  );
  if (!pode) return { ok: false as const, erro: 403 as const };
  return { ok: true as const, usuario, obra };
}

const mensagens = { 401: "Sessão expirada. Entre novamente.", 403: "Sem permissão nesta obra.", 404: "Obra não encontrada." } as const;

function nomeSeguro(nome: string) {
  return nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\- ]+/g, "").trim().slice(0, 120) || "arquivo";
}

async function arquivoPci(projectId: number, versionId?: number): Promise<{ nome: string; bytes: Uint8Array; dados: DadosPci } | null> {
  const r = await getDb().execute(versionId
    ? sql`SELECT file_name, encode(data, 'base64') AS b64, parsed FROM construction_pci_versions WHERE project_id = ${projectId} AND id = ${versionId}`
    : sql`SELECT file_name, encode(data, 'base64') AS b64, parsed FROM construction_pci WHERE project_id = ${projectId}`);
  const linha = (r as unknown as { rows: { file_name: string; b64: string; parsed: DadosPci }[] }).rows[0];
  if (!linha) return null;
  return { nome: linha.file_name, bytes: new Uint8Array(Buffer.from(linha.b64, "base64")), dados: linha.parsed };
}

router.post("/obras/:projectId/pci", async (req: Request, res: Response) => {
  try {
    const projectId = idValido(String(req.params.projectId));
    if (!projectId) return res.status(400).json({ error: "Obra inválida." });
    const acesso = await autorizado(req, projectId);
    if (!acesso.ok) return res.status(acesso.erro).json({ error: mensagens[acesso.erro] });
    const body = (req.body ?? {}) as Record<string, unknown>;
    let nomeArquivo: string;
    let bytes: Uint8Array;
    const userId = String(acesso.usuario.id);
    const obraId = String(projectId);
    const db = getDb();
    if (body.finalizar === true) {
      if (typeof body.uploadId !== "string" || !/^[a-zA-Z0-9-]{20,64}$/.test(body.uploadId)) return res.status(400).json({ error: "Identificador de envio inválido." });
      const r = await db.execute(sql`SELECT chunk_index, total_chunks, file_name, encode(data,'base64') AS b64 FROM pci_upload_chunks WHERE upload_id = ${body.uploadId} AND user_id = ${userId} AND project_id = ${obraId} AND created_at > now() - interval '30 minutes' ORDER BY chunk_index`);
      const partes = (r as unknown as { rows: { chunk_index: number; total_chunks: number; file_name: string; b64: string }[] }).rows;
      try { nomeArquivo = nomeSeguro(validarMontagemPci(partes)); }
      catch (e) { return res.status(400).json({ error: e instanceof Error ? e.message : "Envio incompleto." }); }
      bytes = new Uint8Array(Buffer.concat(partes.map(p => Buffer.from(p.b64, "base64"))));
    } else if (body.chunk !== undefined) {
      let parte;
      try { parte = validarPartePci(body); }
      catch (e) { return res.status(400).json({ error: e instanceof Error ? e.message : "Parte inválida." }); }
      const data = Buffer.from(parte.chunk, "base64");
      if (!data.length || data.length > PARTE_PCI_BYTES) return res.status(400).json({ error: "Parte da PCI maior que 1 MB." });
      await db.execute(sql`DELETE FROM pci_upload_chunks WHERE created_at <= now() - interval '30 minutes'`);
      const existentes = await db.execute(sql`SELECT count(DISTINCT upload_id)::int AS n FROM pci_upload_chunks WHERE user_id = ${userId} AND upload_id <> ${parte.uploadId}`);
      if ((existentes as unknown as {rows:{n:number}[]}).rows[0].n >= 4) return res.status(429).json({error:"Aguarde os envios anteriores terminarem."});
      const inserida = await db.execute(sql`INSERT INTO pci_upload_chunks(upload_id,chunk_index,total_chunks,user_id,project_id,file_name,data) VALUES (${parte.uploadId},${parte.chunkIndex},${parte.totalChunks},${userId},${obraId},${parte.nome},decode(${parte.chunk},'base64')) ON CONFLICT(upload_id,chunk_index) DO UPDATE SET data = EXCLUDED.data WHERE pci_upload_chunks.user_id = EXCLUDED.user_id AND pci_upload_chunks.project_id = EXCLUDED.project_id AND pci_upload_chunks.total_chunks = EXCLUDED.total_chunks AND pci_upload_chunks.file_name = EXCLUDED.file_name RETURNING chunk_index`);
      if (!(inserida as unknown as {rows:unknown[]}).rows.length) return res.status(409).json({error:"Envio inconsistente. Selecione novamente a PCI."});
      return res.json({ recebida: parte.chunkIndex });
    } else {
      // Compatibilidade com clientes antigos; arquivos novos usam partes.
      const base64 = typeof body.arquivo === "string" ? body.arquivo.replace(/^data:[^,]*,/, "") : "";
      if (!base64 || base64.length > Math.ceil(LIMITE_PCI / 3) * 4 + 16 || !/^[A-Za-z0-9+/=\s]+$/.test(base64)) return res.status(400).json({ error: "Arquivo ausente ou maior que 8 MB." });
      bytes = new Uint8Array(Buffer.from(base64, "base64"));
      nomeArquivo = nomeSeguro(typeof body.nome === "string" ? body.nome : "pci.xls");
    }
    if (!bytes.length || bytes.length > LIMITE_PCI) return res.status(400).json({ error: "Envie uma PCI de até 8 MB." });
    let dados: DadosPci;
    try {
      dados = lerPci(bytes);
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível ler a PCI." });
    }
    const checksum = createHash("md5").update(bytes).digest("hex");
    const existia = await getDb().execute(sql`SELECT 1 FROM construction_pci_versions WHERE project_id = ${projectId} AND checksum = ${checksum}`);
    const versaoNova = (existia as unknown as { rows: unknown[] }).rows.length === 0;
    await getDb().execute(sql`
      INSERT INTO construction_pci (project_id, file_name, size_bytes, data, parsed, uploaded_by, uploaded_at, linked_at, linked_by)
      VALUES (${projectId}, ${nomeArquivo}, ${bytes.length}, decode(${Buffer.from(bytes).toString("base64")}, 'base64'), ${JSON.stringify(dados)}::jsonb, ${acesso.usuario.id}, now(), NULL, NULL)
      ON CONFLICT (project_id) DO UPDATE SET file_name = EXCLUDED.file_name, size_bytes = EXCLUDED.size_bytes, data = EXCLUDED.data,
        parsed = EXCLUDED.parsed, uploaded_by = EXCLUDED.uploaded_by, uploaded_at = now(), linked_at = CASE WHEN md5(construction_pci.data) = md5(EXCLUDED.data) THEN construction_pci.linked_at ELSE NULL END,
        linked_by = CASE WHEN md5(construction_pci.data) = md5(EXCLUDED.data) THEN construction_pci.linked_by ELSE NULL END`);
    const soma = dados.incidencias.reduce((s, v) => s + v, 0);
    // Pedido de 18/10: a PCI original (intacta) também fica no Google Drive da obra,
    // uma cópia por versão. Sem Drive, a versão continua guardada no banco.
    let drive: "ok" | "indisponivel" | "erro" | null = null;
    if (versaoNova) {
      const mime = dados.formato === "xlsb" ? "application/vnd.ms-excel.sheet.binary.macroEnabled.12" : "application/vnd.ms-excel";
      const r = await tryDriveUpload(() => uploadArquivoMedicaoObra({ id: projectId, titulo: acesso.obra.titulo ?? "Obra" }, { rotulo: "PCI original", nomeOriginal: nomeArquivo, mime, data: Buffer.from(bytes) }));
      drive = r.driveFileId ? "ok" : r.note ? "erro" : "indisponivel";
    }
    if (body.finalizar === true) await db.execute(sql`DELETE FROM pci_upload_chunks WHERE upload_id = ${String(body.uploadId)} AND user_id = ${userId} AND project_id = ${obraId}`);
    return res.json({ arquivo: nomeArquivo, formato: dados.formato, proponente: dados.identificacao.proponente, somaIncidencia: soma, drive });
  } catch (error) {
    console.error("[medicao-caixa] envio da PCI:", error);
    return res.status(500).json({ error: "Erro ao gravar a PCI. Tente novamente." });
  }
});

router.get("/obras/:projectId/pci", async (req: Request, res: Response) => {
  try {
    const projectId = idValido(String(req.params.projectId));
    if (!projectId) return res.status(404).json({ error: "PCI não encontrada." });
    const acesso = await autorizado(req, projectId);
    if (!acesso.ok) return res.status(acesso.erro).json({ error: mensagens[acesso.erro] });
    const pci = await arquivoPci(projectId);
    if (!pci) return res.status(404).json({ error: "PCI não encontrada." });
    const versao = createHash("sha256").update(pci.bytes).digest("hex");
    if (req.query.parte !== undefined) {
      const parte = Number(req.query.parte);
      const total = Math.ceil(pci.bytes.length / PARTE_PCI_BYTES);
      if (!Number.isInteger(parte) || parte < 0 || parte >= total) return res.status(400).json({ error: "Parte inválida." });
      if (req.query.versao && req.query.versao !== versao) return res.status(409).json({ error: "A PCI foi alterada durante o download. Tente novamente." });
      res.setHeader("X-PCI-Partes", String(total));
      res.setHeader("X-PCI-Versao", versao);
      return enviarArquivo(res, pci.bytes.slice(parte * PARTE_PCI_BYTES, (parte + 1) * PARTE_PCI_BYTES), pci.nome, "application/octet-stream");
    }
    enviarArquivo(res, pci.bytes, pci.nome, pci.dados.formato === "xlsb" ? "application/vnd.ms-excel.sheet.binary.macroEnabled.12" : "application/vnd.ms-excel");
  } catch (error) {
    console.error("[medicao-caixa] download da PCI:", error);
    return res.status(500).json({ error: "Erro ao baixar a PCI." });
  }
});

function enviarArquivo(res: Response, bytes: Uint8Array, nome: string, tipo: string) {
  res.setHeader("Content-Type", tipo);
  res.setHeader("Content-Length", String(bytes.length));
  res.setHeader("Content-Disposition", `attachment; filename="${nomeSeguro(nome)}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(Buffer.from(bytes));
}

const dataIso = (d: Date) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
/** Datas do cadastro da obra são gravadas à meia-noite UTC (campo date do formulário). */
const dataUtc = (d: Date) => d.toISOString().slice(0, 10);

type Formato = "pdf";
type ArquivoMedicao =
  | { ok: true; bytes: Uint8Array; nome: string; mime: string; rotulo: string }
  | { ok: false; status: number; error: string };
const ROTULO = { pls: "PLS", repactuacao: "Repactuação de Prazo", alteracao: "Alteração de Projeto" } as const;

/**
 * Pedido de 18/10: a PCI original nunca é alterada; cada medição gera uma CÓPIA
 * preenchida em .pdf a partir da versão da PCI gravada na própria medição
 * (Lote 02, correção 01: sem .xls). O PDF não depende do .xls: lê a PCI .xls
 * ou .xlsb e só usa o BIFF8 para o logotipo, quando houver.
 * Usado pelo download, pelo e-mail e pela cópia no Google Drive.
 * Chamar só depois de autorizar o acesso à obra.
 */
export async function gerarArquivoMedicao(m: typeof constructionProgressHistory.$inferSelect, obraTitulo: string | null, _formato: Formato = "pdf"): Promise<ArquivoMedicao> {
  const db = getDb();
  if (!m.pciVersionId) return { ok: false, status: 409, error: "Esta medição não possui uma versão da PCI vinculada. Revise a medição antes de gerar os arquivos." };
  const pci = await arquivoPci(m.projectId, m.pciVersionId);
  if (!pci) return { ok: false, status: 400, error: "Envie a PCI da obra (botão PCI na aba Progresso) para gerar os arquivos da CAIXA." };
  if (!incidenciasCorrespondem(m.items, SERVICOS_PROGRESSO.map(s => s.chave), pci.dados.incidencias)) return { ok: false, status: 409, error: "As incidências salvas diferem da PCI desta medição. Revise a medição." };

  const tipo = ehTipoMedicao(m.measurementType) ? m.measurementType : "pls";
  const dados: DadosMedicaoCaixa = m.caixaData
    ? normalizarDadosMedicao(tipo, m.caixaData)
    : { pls: { ...dadosPlsPadrao({ alvaraEmissao: pci.dados.alvaraEmissao, alvaraVigencia: pci.dados.alvaraVigencia, seloCasaAzul: pci.dados.seloCasaAzul }), dataLevantamento: dataIso(m.createdAt) }, repactuacao: null, alteracao: null };
  const porChave = new Map(m.items.map((i) => [i.chave, Number(i.execucao)]));
  const execucoes = SERVICOS_PROGRESSO.map((s) => porChave.get(s.chave) ?? 0);

  // Medições anteriores (curva de evolução e "mês anterior").
  const anterioresBrutas = await db.select({ progresso: constructionProgressHistory.progressPct, criadoEm: constructionProgressHistory.createdAt, dados: constructionProgressHistory.caixaData, recebidaEm: constructionProgressHistory.receivedAt })
    .from(constructionProgressHistory)
    .where(and(eq(constructionProgressHistory.projectId, m.projectId), or(lt(constructionProgressHistory.createdAt, m.createdAt), and(eq(constructionProgressHistory.createdAt, m.createdAt), lt(constructionProgressHistory.id, m.id)))))
    .orderBy(asc(constructionProgressHistory.createdAt), asc(constructionProgressHistory.id));
  const anteriores: MedicaoHistorica[] = anterioresBrutas.map((a) => {
    const pls = (a.dados as DadosMedicaoCaixa | null)?.pls;
    // Lote 03, correção 08: "Acumul. Aferido" = medição anterior CONFIRMADA como recebida
    // pela CAIXA (received_at). Sem confirmação, fica em branco e o PDF sinaliza.
    return { data: typeof pls?.dataLevantamento === "string" ? pls.dataLevantamento : dataIso(a.criadoEm), progresso: Number(a.progresso), aferido: !!a.recebidaEm };
  });
  // H6: início e término previsto vêm do Editar Obra.
  const [datas] = await db.select({ inicio: constructionProjects.startDate, termino: constructionProjects.estimatedEndDate })
    .from(constructionProjects).where(eq(constructionProjects.id, m.projectId)).limit(1);
  const obra = { inicio: datas?.inicio ? dataUtc(datas.inicio) : null, termino: datas?.termino ? dataUtc(datas.termino) : null };

  const r = await db.execute(sql`
    SELECT p.caption, f.mime, encode(f.data, 'base64') AS b64
    FROM construction_photos p JOIN construction_photo_files f ON f.photo_id = p.id
    WHERE p.progress_history_id = ${m.id} ORDER BY p.id LIMIT ${QUADROS_FOTO[tipo]}`);
  const fotos: FotoMedicao[] = (r as unknown as { rows: { caption: string | null; mime: string; b64: string }[] }).rows
    .filter((f) => f.mime === "image/jpeg" || f.mime === "image/png")
    .map((f) => ({ dados: new Uint8Array(Buffer.from(f.b64, "base64")), tipo: f.mime === "image/png" ? "png" : "jpeg", legenda: f.caption }));

  // Lote 03, correção 08: relê a PCI desta versão (cronograma, valor e alvará
  // recalculados das entradas, não do cache gravado no envio); falha → dados salvos.
  let dadosPci = pci.dados;
  try { dadosPci = { ...lerPci(pci.bytes), incidencias: pci.dados.incidencias }; } catch { /* mantém os dados salvos */ }
  const entrada = { tipo, pci: dadosPci, execucoes, progresso: Number(m.progressPct), anteriores, dados, fotos, obra };
  const sufixo = { pls: "PLS", repactuacao: "Repactuacao_Prazo", alteracao: "Alteracao_Projeto" }[tipo];
  const nomeBase = `${sufixo}_${nomeSeguro(obraTitulo ?? "obra").replace(/\s+/g, "_")}_${dados.pls.dataLevantamento}`;
  const [a, mes, d] = dados.pls.dataLevantamento.split("-");
  const rotulo = `${ROTULO[tipo]} (levantamento ${d}-${mes}-${a})`;
  return { ok: true, bytes: gerarPdfMedicao(pci.bytes, entrada), nome: `${nomeBase}.pdf`, mime: "application/pdf", rotulo };
}

async function medicaoAutorizada(req: Request, res: Response) {
  const medicaoId = idValido(String(req.params.medicaoId));
  if (!medicaoId) { res.status(404).json({ error: "Medição não encontrada." }); return null; }
  const [m] = await getDb().select().from(constructionProgressHistory).where(eq(constructionProgressHistory.id, medicaoId)).limit(1);
  if (!m) { res.status(404).json({ error: "Medição não encontrada." }); return null; }
  const acesso = await autorizado(req, m.projectId);
  if (!acesso.ok) { res.status(acesso.erro).json({ error: mensagens[acesso.erro] }); return null; }
  return { m, obra: acesso.obra };
}

// Lote 02, correção 01: só .pdf. Pedidos antigos de .xls caem no 404 padrão;
// cópias .xls já gravadas no Drive e e-mails já enviados seguem preservados.
router.get("/obras/medicoes/:medicaoId/arquivo.:formato(pdf)", async (req: Request, res: Response) => {
  try {
    const alvo = await medicaoAutorizada(req, res);
    if (!alvo) return;
    const r = await gerarArquivoMedicao(alvo.m, alvo.obra.titulo, "pdf");
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    if (r.bytes.length > LIMITE_DOWNLOAD) return res.status(413).json({ error: MENSAGEM_LIMITE_DOWNLOAD });
    return enviarArquivo(res, r.bytes, r.nome, r.mime);
  } catch (error) {
    console.error("[medicao-caixa] geração:", error);
    return res.status(500).json({ error: error instanceof Error ? `Não foi possível gerar o arquivo: ${error.message}` : "Não foi possível gerar o arquivo." });
  }
});

/**
 * Pedido de 18/10: depois de salvar a medição (e enviar as fotos), guarda o
 * .pdf preenchido em Obras/<Obra>/Medições CAIXA no Google Drive (Lote 02,
 * correção 01: sem .xls; arquivos antigos no Drive não são apagados). Nunca
 * desfaz a medição: sem Drive, os arquivos seguem no download.
 */
router.post("/obras/medicoes/:medicaoId/drive", async (req: Request, res: Response) => {
  try {
    const alvo = await medicaoAutorizada(req, res);
    if (!alvo) return;
    let algum = false;
    for (const formato of ["pdf"] as const) {
      const arq = await gerarArquivoMedicao(alvo.m, alvo.obra.titulo, formato);
      if (!arq.ok) return res.json({ drive: "erro", nota: arq.error });
      const r = await tryDriveUpload(() => uploadArquivoMedicaoObra({ id: alvo.obra.id, titulo: alvo.obra.titulo ?? "Obra" }, { rotulo: arq.rotulo, nomeOriginal: arq.nome, mime: arq.mime, data: Buffer.from(arq.bytes) }));
      if (!r.driveFileId) return res.json({ drive: r.note ? "erro" : "indisponivel", nota: r.note });
      algum = true;
    }
    return res.json({ drive: algum ? "ok" : "indisponivel", nota: null });
  } catch (error) {
    console.error("[medicao-caixa] cópia no Drive:", error instanceof Error ? error.message : "erro desconhecido");
    return res.json({ drive: "erro", nota: "Não foi possível copiar para o Google Drive agora." });
  }
});

export default router;
