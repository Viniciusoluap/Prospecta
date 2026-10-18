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
import { dadosPlsPadrao, ehTipoMedicao, normalizarDadosMedicao, QUADROS_FOTO, type DadosMedicaoCaixa } from "../../shared/medicao-caixa.js";
import { lerPci, type DadosPci } from "../caixa/pci.js";
import { gerarXlsMedicao, type FotoMedicao, type MedicaoHistorica } from "../caixa/medicao-xls.js";
import { gerarPdfMedicao } from "../caixa/medicao-pdf.js";

// Pedido de 18/10 — PCI da CAIXA por obra e arquivos da medição (.xls para o
// SIOPI e .pdf para assinatura). Rotas Express puras, com a mesma verificação
// de sessão das fotos da obra (server/routes/obra-fotos.ts).

const router = Router();
const LIMITE_PCI = 6 * 1024 * 1024;

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

async function arquivoPci(projectId: number): Promise<{ nome: string; bytes: Uint8Array; dados: DadosPci } | null> {
  const r = await getDb().execute(sql`SELECT file_name, encode(data, 'base64') AS b64, parsed FROM construction_pci WHERE project_id = ${projectId}`);
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
    const { arquivo, nome } = (req.body ?? {}) as Record<string, unknown>;
    const base64 = typeof arquivo === "string" ? arquivo.replace(/^data:[^,]*,/, "") : "";
    if (!base64 || !/^[A-Za-z0-9+/=\s]+$/.test(base64)) return res.status(400).json({ error: "Arquivo ausente ou inválido." });
    const bytes = new Uint8Array(Buffer.from(base64, "base64"));
    if (!bytes.length) return res.status(400).json({ error: "Arquivo vazio." });
    if (bytes.length > LIMITE_PCI) return res.status(400).json({ error: "A PCI passa de 6 MB." });
    const nomeArquivo = nomeSeguro(typeof nome === "string" ? nome : "pci.xls");
    let dados: DadosPci;
    try {
      dados = lerPci(bytes);
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível ler a PCI." });
    }
    await getDb().execute(sql`
      INSERT INTO construction_pci (project_id, file_name, size_bytes, data, parsed, uploaded_by, uploaded_at, linked_at, linked_by)
      VALUES (${projectId}, ${nomeArquivo}, ${bytes.length}, decode(${Buffer.from(bytes).toString("base64")}, 'base64'), ${JSON.stringify(dados)}::jsonb, ${acesso.usuario.id}, now(), NULL, NULL)
      ON CONFLICT (project_id) DO UPDATE SET file_name = EXCLUDED.file_name, size_bytes = EXCLUDED.size_bytes, data = EXCLUDED.data,
        parsed = EXCLUDED.parsed, uploaded_by = EXCLUDED.uploaded_by, uploaded_at = now(), linked_at = NULL, linked_by = NULL`);
    const soma = dados.incidencias.reduce((s, v) => s + v, 0);
    return res.json({ arquivo: nomeArquivo, formato: dados.formato, proponente: dados.identificacao.proponente, somaIncidencia: soma });
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

router.get("/obras/medicoes/:medicaoId/arquivo.:formato(xls|pdf)", async (req: Request, res: Response) => {
  try {
    const medicaoId = idValido(String(req.params.medicaoId));
    if (!medicaoId) return res.status(404).json({ error: "Medição não encontrada." });
    const db = getDb();
    const [m] = await db.select().from(constructionProgressHistory).where(eq(constructionProgressHistory.id, medicaoId)).limit(1);
    if (!m) return res.status(404).json({ error: "Medição não encontrada." });
    const acesso = await autorizado(req, m.projectId);
    if (!acesso.ok) return res.status(acesso.erro).json({ error: mensagens[acesso.erro] });
    const pci = await arquivoPci(m.projectId);
    if (!pci) return res.status(400).json({ error: "Envie a PCI da obra (botão PCI na aba Progresso) para gerar os arquivos da CAIXA." });
    const formato = String(req.params.formato);
    if (formato === "xls" && pci.dados.formato !== "xls") {
      return res.status(400).json({ error: "O SIOPI só aceita .xls: envie a PCI em .xls para gerar a planilha preenchida." });
    }

    const tipo = ehTipoMedicao(m.measurementType) ? m.measurementType : "pls";
    const dados: DadosMedicaoCaixa = m.caixaData
      ? normalizarDadosMedicao(tipo, m.caixaData)
      : { pls: { ...dadosPlsPadrao({ alvaraEmissao: pci.dados.alvaraEmissao, alvaraVigencia: pci.dados.alvaraVigencia, seloCasaAzul: pci.dados.seloCasaAzul }), dataLevantamento: dataIso(m.createdAt) }, repactuacao: null, alteracao: null };
    const porChave = new Map(m.items.map((i) => [i.chave, Number(i.execucao)]));
    const execucoes = SERVICOS_PROGRESSO.map((s) => porChave.get(s.chave) ?? 0);

    // Medições anteriores (curva de evolução e "mês anterior").
    const anterioresBrutas = await db.select({ progresso: constructionProgressHistory.progressPct, criadoEm: constructionProgressHistory.createdAt, dados: constructionProgressHistory.caixaData })
      .from(constructionProgressHistory)
      .where(and(eq(constructionProgressHistory.projectId, m.projectId), or(lt(constructionProgressHistory.createdAt, m.createdAt), and(eq(constructionProgressHistory.createdAt, m.createdAt), lt(constructionProgressHistory.id, m.id)))))
      .orderBy(asc(constructionProgressHistory.createdAt), asc(constructionProgressHistory.id));
    const anteriores: MedicaoHistorica[] = anterioresBrutas.map((a) => {
      const pls = (a.dados as DadosMedicaoCaixa | null)?.pls;
      return { data: typeof pls?.dataLevantamento === "string" ? pls.dataLevantamento : dataIso(a.criadoEm), progresso: Number(a.progresso) };
    });

    const r = await db.execute(sql`
      SELECT p.caption, f.mime, encode(f.data, 'base64') AS b64
      FROM construction_photos p JOIN construction_photo_files f ON f.photo_id = p.id
      WHERE p.progress_history_id = ${medicaoId} ORDER BY p.id LIMIT ${QUADROS_FOTO[tipo]}`);
    const fotos: FotoMedicao[] = (r as unknown as { rows: { caption: string | null; mime: string; b64: string }[] }).rows
      .filter((f) => f.mime === "image/jpeg" || f.mime === "image/png")
      .map((f) => ({ dados: new Uint8Array(Buffer.from(f.b64, "base64")), tipo: f.mime === "image/png" ? "png" : "jpeg", legenda: f.caption }));

    const entrada = { tipo, pci: pci.dados, execucoes, progresso: Number(m.progressPct), anteriores, dados, fotos };
    const sufixo = { pls: "PLS", repactuacao: "Repactuacao_Prazo", alteracao: "Alteracao_Projeto" }[tipo];
    const nomeBase = `${sufixo}_${nomeSeguro(acesso.obra.titulo ?? "obra").replace(/\s+/g, "_")}_${dados.pls.dataLevantamento}`;
    if (formato === "xls") return enviarArquivo(res, gerarXlsMedicao(pci.bytes, entrada), `${nomeBase}.xls`, "application/vnd.ms-excel");
    return enviarArquivo(res, gerarPdfMedicao(pci.bytes, entrada), `${nomeBase}.pdf`, "application/pdf");
  } catch (error) {
    console.error("[medicao-caixa] geração:", error);
    return res.status(500).json({ error: error instanceof Error ? `Não foi possível gerar o arquivo: ${error.message}` : "Não foi possível gerar o arquivo." });
  }
});

export default router;
