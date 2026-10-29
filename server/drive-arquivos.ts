// Pedido de 29/10: organização completa do Google Drive (mesma regra no Grupo
// Santa Fé). Aqui ficam só as consultas ao banco: quais arquivos do sistema
// existem, onde cada um deve ficar no Drive (caminho + nome) e como gravar a
// referência da cópia. As chamadas ao Drive ficam em drive-documents.ts e a
// orquestração (lotes, prazo, órfãos) em drive-organizacao.ts.
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import {
  caminhoEquipe, caminhoFotosObra, caminhoGeradorPci, caminhoImovel, caminhoMedicoesObra, caminhoModelosPci, caminhoOrcamentoEstudo,
  caminhoWhatsappCliente, caminhoWhatsappSemCliente, nomeArquivo, nomeDocumentoEquipe, nomeFotoImovel, nomeFotoObra, nomeMidiaWhatsapp,
  nomeModeloPci, nomePciGerada, nomePlanilhaOrcamento, ROTULO_DOCUMENTO, type EntidadeRegistro, type PastaAlvo,
} from "../shared/drive-estrutura.js";
import { MIME_MODELO_PCI, type FormatoModeloPci } from "../shared/pci-gerador.js";
import { getDb } from "./db.js";
import { caminhoDocumentoCliente, destinoDocumentoEstudo } from "./drive-pastas.js";

export interface DestinoDrive { caminho: PastaAlvo[]; nome: string }

/** Arquivo que está só no banco: o organizador envia ao Drive e grava a referência. */
export interface ArquivoPendente {
  tipo: string;
  id: number;
  mime: string;
  destino(): Promise<DestinoDrive>;
  carregar(): Promise<Buffer | null>;
  gravar(driveFileId: string): Promise<void>;
  /** Cópia que pode já ter sido gravada antes sem a referência (ex.: PCI original): procura na pasta pelo começo do nome. */
  adotarPrefixo?: string;
}

/** Arquivo já no Drive: o organizador confere/move para o caminho certo. */
export interface ArquivoNoDrive { tipo: string; id: number; driveFileId: string; destino(): Promise<DestinoDrive> }

export interface FonteArquivos {
  tipo: string;
  /** Só no banco, em ordem de id, depois de `aposId` (ou só o registro `id`). */
  pendentes?(filtro: { aposId: number; limite: number; id?: number }): Promise<ArquivoPendente[]>;
  /** Já no Drive, em ordem de id, depois de `aposId`. */
  noDrive(aposId: number, limite: number): Promise<ArquivoNoDrive[]>;
}

type Linha = Record<string, unknown>;
async function linhas<T extends Linha>(consulta: SQL): Promise<T[]> {
  const r = await getDb().execute(consulta);
  return (r as unknown as { rows: T[] }).rows;
}
const data = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));
const num = (v: unknown) => Number(v);
const b64 = async (consulta: SQL): Promise<Buffer | null> => {
  const [l] = await linhas<{ b64: string | null }>(consulta);
  return l?.b64 ? Buffer.from(l.b64, "base64") : null;
};
const filtroId = (coluna: SQL, f: { aposId: number; id?: number }) => (f.id ? sql`${coluna} = ${f.id}` : sql`${coluna} > ${f.aposId}`);
const pronto = (d: DestinoDrive) => () => Promise.resolve(d);

const MIME_PLANILHA: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
};
const mimePlanilha = (nome: string | null | undefined) => MIME_PLANILHA[/\.([a-z0-9]{1,5})$/i.exec(nome ?? "")?.[1]?.toLowerCase() ?? ""] ?? "application/octet-stream";
const mimeModelo = (formato: unknown) => MIME_MODELO_PCI[formato as FormatoModeloPci] ?? "application/octet-stream";

// ─── Equipe (documentos do usuário/engenheiro) ───────────────────────────────

const destinoUsuarioDoc = (l: Linha): DestinoDrive => ({
  caminho: caminhoEquipe({ id: num(l.user_id), numero: num(l.user_id), nome: (l.nome as string | null) ?? null }, String(l.category)),
  nome: nomeDocumentoEquipe(String(l.category), data(l.uploaded_at), l.original_name as string, String(l.mime)),
});

const usuarioDocumentos: FonteArquivos = {
  tipo: "usuario_documento",
  async pendentes(f) {
    const rows = await linhas(sql`SELECT d.id, d.user_id, d.category, d.original_name, d.mime, d.uploaded_at, d.uploaded_at::text AS uploaded_at_exato, u.name AS nome
      FROM user_documents d JOIN users u ON u.id = d.user_id
      WHERE d.drive_file_id IS NULL AND ${filtroId(sql`d.id`, f)} ORDER BY d.id LIMIT ${f.limite}`);
    return rows.map((l) => ({
      tipo: this.tipo, id: num(l.id), mime: String(l.mime), destino: pronto(destinoUsuarioDoc(l)),
      carregar: () => b64(sql`SELECT encode(content, 'base64') AS b64 FROM user_documents WHERE id = ${num(l.id)}`),
      // Só grava se o documento não foi substituído durante o envio.
      gravar: async (id) => { await getDb().execute(sql`UPDATE user_documents SET drive_file_id = ${id} WHERE id = ${num(l.id)} AND drive_file_id IS NULL AND uploaded_at = ${String(l.uploaded_at_exato)}::timestamp`); },
    }));
  },
  async noDrive(aposId, limite) {
    const rows = await linhas(sql`SELECT d.id, d.user_id, d.category, d.original_name, d.mime, d.uploaded_at, d.drive_file_id, u.name AS nome
      FROM user_documents d JOIN users u ON u.id = d.user_id WHERE d.drive_file_id IS NOT NULL AND d.id > ${aposId} ORDER BY d.id LIMIT ${limite}`);
    return rows.map((l) => ({ tipo: this.tipo, id: num(l.id), driveFileId: String(l.drive_file_id), destino: pronto(destinoUsuarioDoc(l)) }));
  },
};

// ─── Modelos de PCI ──────────────────────────────────────────────────────────

const destinoModelo = (l: Linha): DestinoDrive => ({
  caminho: caminhoModelosPci(),
  nome: nomeModeloPci(num(l.version), data(l.uploaded_at), l.file_name as string, mimeModelo(l.format)),
});

const modelosPci: FonteArquivos = {
  tipo: "modelo_pci",
  async pendentes(f) {
    const rows = await linhas(sql`SELECT id, version, file_name, format, uploaded_at FROM pci_models
      WHERE drive_file_id IS NULL AND ${filtroId(sql`id`, f)} ORDER BY id LIMIT ${f.limite}`);
    return rows.map((l) => ({
      tipo: this.tipo, id: num(l.id), mime: mimeModelo(l.format), destino: pronto(destinoModelo(l)),
      carregar: () => b64(sql`SELECT encode(data, 'base64') AS b64 FROM pci_models WHERE id = ${num(l.id)}`),
      gravar: async (id) => { await getDb().execute(sql`UPDATE pci_models SET drive_file_id = ${id} WHERE id = ${num(l.id)} AND drive_file_id IS NULL`); },
    }));
  },
  async noDrive(aposId, limite) {
    const rows = await linhas(sql`SELECT id, version, file_name, format, uploaded_at, drive_file_id FROM pci_models
      WHERE drive_file_id IS NOT NULL AND id > ${aposId} ORDER BY id LIMIT ${limite}`);
    return rows.map((l) => ({ tipo: this.tipo, id: num(l.id), driveFileId: String(l.drive_file_id), destino: pronto(destinoModelo(l)) }));
  },
};

// ─── PCIs geradas (planilha e PDF) ───────────────────────────────────────────

function pciGerada(parte: "planilha" | "pdf"): FonteArquivos {
  const coluna = parte === "planilha" ? sql.raw("g.sheet_drive_file_id") : sql.raw("g.pdf_drive_file_id");
  const colunaSimples = parte === "planilha" ? sql.raw("sheet_drive_file_id") : sql.raw("pdf_drive_file_id");
  const bytes = parte === "planilha" ? sql.raw("sheet_data") : sql.raw("pdf_data");
  const mime = (l: Linha) => (parte === "pdf" ? "application/pdf" : mimeModelo(l.sheet_format));
  const arquivo = (l: Linha) => (parte === "pdf" ? l.pdf_file_name : l.sheet_file_name) as string;
  const destino = (l: Linha): DestinoDrive => ({
    caminho: caminhoGeradorPci({ id: num(l.project_id), numero: num(l.project_id), nome: (l.titulo as string | null) ?? null }),
    nome: nomePciGerada(data(l.created_at), arquivo(l), mime(l)),
  });
  const tipo = parte === "planilha" ? "pci_gerada_planilha" : "pci_gerada_pdf";
  return {
    tipo,
    async pendentes(f) {
      const rows = await linhas(sql`SELECT g.id, g.project_id, g.sheet_format, g.sheet_file_name, g.pdf_file_name, g.created_at, p.title AS titulo
        FROM pci_generated g JOIN construction_projects p ON p.id = g.project_id
        WHERE ${coluna} IS NULL AND ${filtroId(sql`g.id`, f)} ORDER BY g.id LIMIT ${f.limite}`);
      return rows.map((l) => ({
        tipo, id: num(l.id), mime: mime(l), destino: pronto(destino(l)),
        carregar: () => b64(sql`SELECT encode(${bytes}, 'base64') AS b64 FROM pci_generated WHERE id = ${num(l.id)}`),
        gravar: async (id) => { await getDb().execute(sql`UPDATE pci_generated SET ${colunaSimples} = ${id} WHERE id = ${num(l.id)} AND ${colunaSimples} IS NULL`); },
      }));
    },
    async noDrive(aposId, limite) {
      const rows = await linhas(sql`SELECT g.id, g.project_id, g.sheet_format, g.sheet_file_name, g.pdf_file_name, g.created_at, p.title AS titulo, ${coluna} AS drive_file_id
        FROM pci_generated g JOIN construction_projects p ON p.id = g.project_id
        WHERE ${coluna} IS NOT NULL AND g.id > ${aposId} ORDER BY g.id LIMIT ${limite}`);
      return rows.map((l) => ({ tipo, id: num(l.id), driveFileId: String(l.drive_file_id), destino: pronto(destino(l)) }));
    },
  };
}

// ─── Fotos da obra ───────────────────────────────────────────────────────────

/** Foto com a ordem da medição na obra e a ordem da foto dentro da medição (ou de "Sem medição"). */
const consultaFotosObra = (condicao: SQL, limite: number) => sql`
  WITH medicoes AS (
    SELECT id, created_at, row_number() OVER (PARTITION BY project_id ORDER BY created_at, id) AS ordem FROM construction_progress_history
  ), fotos AS (
    SELECT ph.id, ph.project_id, ph.progress_history_id, ph.taken_at, ph.drive_file_id,
      row_number() OVER (PARTITION BY ph.project_id, COALESCE(ph.progress_history_id, 0) ORDER BY ph.id) AS ordem
    FROM construction_photos ph
  )
  SELECT f.id, f.project_id, f.progress_history_id, f.taken_at, f.drive_file_id, f.ordem, pf.mime, p.title AS titulo,
    m.ordem AS medicao_ordem, m.created_at AS medicao_data
  FROM fotos f
  JOIN construction_photo_files pf ON pf.photo_id = f.id
  JOIN construction_projects p ON p.id = f.project_id
  LEFT JOIN medicoes m ON m.id = f.progress_history_id
  WHERE ${condicao} ORDER BY f.id LIMIT ${limite}`;

const destinoFotoObra = (l: Linha): DestinoDrive => ({
  caminho: caminhoFotosObra({ id: num(l.project_id), numero: num(l.project_id), nome: (l.titulo as string | null) ?? null },
    l.progress_history_id && l.medicao_ordem ? { id: num(l.progress_history_id), ordem: num(l.medicao_ordem), data: data(l.medicao_data) } : null),
  nome: nomeFotoObra(num(l.ordem), data(l.taken_at), String(l.mime)),
});

const fotosObra: FonteArquivos = {
  tipo: "foto_obra",
  async pendentes(f) {
    const rows = await linhas(consultaFotosObra(sql`f.drive_file_id IS NULL AND ${filtroId(sql`f.id`, f)}`, f.limite));
    return rows.map((l) => ({
      tipo: this.tipo, id: num(l.id), mime: String(l.mime), destino: pronto(destinoFotoObra(l)),
      carregar: () => b64(sql`SELECT encode(data, 'base64') AS b64 FROM construction_photo_files WHERE photo_id = ${num(l.id)}`),
      gravar: async (id) => { await getDb().execute(sql`UPDATE construction_photos SET drive_file_id = ${id} WHERE id = ${num(l.id)} AND drive_file_id IS NULL`); },
    }));
  },
  async noDrive(aposId, limite) {
    const rows = await linhas(consultaFotosObra(sql`f.drive_file_id IS NOT NULL AND f.id > ${aposId}`, limite));
    return rows.map((l) => ({ tipo: this.tipo, id: num(l.id), driveFileId: String(l.drive_file_id), destino: pronto(destinoFotoObra(l)) }));
  },
};

// ─── PCI original da obra (fica em Medições CAIXA, onde já é gravada) ────────

const mimePciOriginal = (nome: string) => (/\.xlsb$/i.test(nome) ? "application/vnd.ms-excel.sheet.binary.macroEnabled.12" : "application/vnd.ms-excel");
const destinoPciOriginal = (l: Linha): DestinoDrive => ({
  caminho: caminhoMedicoesObra({ id: num(l.project_id), numero: num(l.project_id), nome: (l.titulo as string | null) ?? null }),
  nome: nomeArquivo("PCI original", data(l.uploaded_at), l.file_name as string, mimePciOriginal(String(l.file_name))),
});

const pciOriginal: FonteArquivos = {
  tipo: "pci_original",
  async pendentes(f) {
    const rows = await linhas(sql`SELECT c.project_id, c.file_name, c.uploaded_at, c.uploaded_at::text AS uploaded_at_exato, p.title AS titulo
      FROM construction_pci c JOIN construction_projects p ON p.id = c.project_id
      WHERE c.drive_file_id IS NULL AND ${filtroId(sql`c.project_id`, f)} ORDER BY c.project_id LIMIT ${f.limite}`);
    return rows.map((l) => ({
      tipo: this.tipo, id: num(l.project_id), mime: mimePciOriginal(String(l.file_name)), destino: pronto(destinoPciOriginal(l)),
      // Antes de 29/10 a cópia era gravada sem guardar a referência: adota a que já existe.
      adotarPrefixo: "PCI original — ",
      carregar: () => b64(sql`SELECT encode(data, 'base64') AS b64 FROM construction_pci WHERE project_id = ${num(l.project_id)}`),
      gravar: async (id) => { await getDb().execute(sql`UPDATE construction_pci SET drive_file_id = ${id} WHERE project_id = ${num(l.project_id)} AND drive_file_id IS NULL AND uploaded_at = ${String(l.uploaded_at_exato)}::timestamp`); },
    }));
  },
  async noDrive(aposId, limite) {
    const rows = await linhas(sql`SELECT c.project_id, c.file_name, c.uploaded_at, c.drive_file_id, p.title AS titulo
      FROM construction_pci c JOIN construction_projects p ON p.id = c.project_id
      WHERE c.drive_file_id IS NOT NULL AND c.project_id > ${aposId} ORDER BY c.project_id LIMIT ${limite}`);
    return rows.map((l) => ({ tipo: this.tipo, id: num(l.project_id), driveFileId: String(l.drive_file_id), destino: pronto(destinoPciOriginal(l)) }));
  },
};

// ─── Mídia do WhatsApp ───────────────────────────────────────────────────────

const destinoMidia = (l: Linha): DestinoDrive => ({
  caminho: l.lead_id
    ? caminhoWhatsappCliente({ id: num(l.lead_id), numero: num(l.lead_id), nome: (l.lead_nome as string | null) ?? null })
    : caminhoWhatsappSemCliente(l.destinatario as string),
  nome: nomeMidiaWhatsapp(data(l.created_at), l.midia_nome as string | null, String(l.midia_mime ?? "")),
});

const consultaMidias = (condicao: SQL, limite: number) => sql`
  SELECT m.id, m.drive_file_id, w.lead_id, w.destinatario, w.midia_nome, w.midia_mime, w.created_at, l.name AS lead_nome
  FROM whatsapp_midias m JOIN whatsapp_messages w ON w.id = m.message_id LEFT JOIN leads l ON l.id = w.lead_id
  WHERE ${condicao} ORDER BY m.id LIMIT ${limite}`;

const midiasWhatsapp: FonteArquivos = {
  tipo: "whatsapp_midia",
  async pendentes(f) {
    const rows = await linhas(consultaMidias(sql`m.drive_file_id IS NULL AND ${filtroId(sql`m.id`, f)}`, f.limite));
    return rows.map((l) => ({
      tipo: this.tipo, id: num(l.id), mime: String(l.midia_mime ?? "application/octet-stream"), destino: pronto(destinoMidia(l)),
      carregar: () => b64(sql`SELECT encode(conteudo, 'base64') AS b64 FROM whatsapp_midias WHERE id = ${num(l.id)}`),
      gravar: async (id) => { await getDb().execute(sql`UPDATE whatsapp_midias SET drive_file_id = ${id} WHERE id = ${num(l.id)} AND drive_file_id IS NULL`); },
    }));
  },
  async noDrive(aposId, limite) {
    const rows = await linhas(consultaMidias(sql`m.drive_file_id IS NOT NULL AND m.id > ${aposId}`, limite));
    return rows.map((l) => ({ tipo: this.tipo, id: num(l.id), driveFileId: String(l.drive_file_id), destino: pronto(destinoMidia(l)) }));
  },
};

// ─── Planilha importada do orçamento da incorporação ─────────────────────────

/** Planilha original guardada no JSON do orçamento parametrizado (importacaoExcel.originalBase64). */
export function planilhaImportada(json: string | null | undefined): { nome: string; base64: string; importadoEm: Date; sha256: string } | null {
  if (!json) return null;
  try {
    const p = JSON.parse(json) as { importacaoExcel?: { nome?: string; originalBase64?: string; importadoEm?: string } };
    const a = p.importacaoExcel;
    if (!a?.originalBase64) return null;
    const quando = a.importadoEm ? new Date(a.importadoEm) : new Date();
    return {
      nome: a.nome || "orcamento.xlsx", base64: a.originalBase64,
      importadoEm: Number.isNaN(quando.getTime()) ? new Date() : quando,
      sha256: createHash("sha256").update(a.originalBase64).digest("hex"),
    };
  } catch {
    return null;
  }
}

const orcamentoEstudo: FonteArquivos = {
  tipo: "orcamento_estudo",
  async pendentes(f) {
    const rows = await linhas(sql`SELECT id, name, parameterized_budget_json AS json FROM incorporation_studies
      WHERE budget_import_drive_file_id IS NULL AND parameterized_budget_json LIKE '%"originalBase64"%' AND ${filtroId(sql`id`, f)} ORDER BY id LIMIT ${f.limite}`);
    return rows.flatMap((l) => {
      const p = planilhaImportada(l.json as string);
      if (!p) return [];
      const estudo = { id: num(l.id), numero: num(l.id), nome: (l.name as string | null) ?? null };
      return [{
        tipo: this.tipo, id: num(l.id), mime: mimePlanilha(p.nome),
        destino: pronto({ caminho: caminhoOrcamentoEstudo(estudo), nome: nomePlanilhaOrcamento(p.importadoEm, p.nome, mimePlanilha(p.nome)) }),
        carregar: () => Promise.resolve(Buffer.from(p.base64, "base64")),
        gravar: async (id: string) => {
          await getDb().execute(sql`UPDATE incorporation_studies SET budget_import_drive_file_id = ${id}, budget_import_sha256 = ${p.sha256}
            WHERE id = ${num(l.id)} AND budget_import_drive_file_id IS NULL`);
        },
      }];
    });
  },
  async noDrive(aposId, limite) {
    const rows = await linhas(sql`SELECT id, name, budget_import_drive_file_id AS drive_file_id, parameterized_budget_json AS json FROM incorporation_studies
      WHERE budget_import_drive_file_id IS NOT NULL AND id > ${aposId} ORDER BY id LIMIT ${limite}`);
    return rows.flatMap((l) => {
      const p = planilhaImportada(l.json as string);
      if (!p) return [];
      const estudo = { id: num(l.id), numero: num(l.id), nome: (l.name as string | null) ?? null };
      return [{ tipo: this.tipo, id: num(l.id), driveFileId: String(l.drive_file_id),
        destino: pronto({ caminho: caminhoOrcamentoEstudo(estudo), nome: nomePlanilhaOrcamento(p.importadoEm, p.nome, mimePlanilha(p.nome)) }) }];
    });
  },
};

// ─── Documentos do cliente, contratos, checklist e estudos (já existiam) ─────

const destinoDocLead = (l: Linha) => async (): Promise<DestinoDrive> => ({
  caminho: await caminhoDocumentoCliente(num(l.lead_id), l.service_id ? num(l.service_id) : null, String(l.type)),
  nome: nomeArquivo(ROTULO_DOCUMENTO[String(l.type)] ?? "Documento", data(l.uploaded_at ?? l.created_at), l.file_name as string | null, String(l.mime_type ?? "")),
});

const documentosLead: FonteArquivos = {
  tipo: "documento_cliente",
  /** Documentos que caíram no fallback "banco" quando o Drive recusou a gravação. */
  async pendentes(f) {
    const rows = await linhas(sql`SELECT d.id, d.lead_id, d.service_id, d.type, d.file_name, d.mime_type, d.uploaded_at, d.created_at
      FROM lead_documents d WHERE d.storage = 'banco' AND d.drive_file_id IS NULL
        AND EXISTS (SELECT 1 FROM lead_document_file_data x WHERE x.document_id = d.id) AND ${filtroId(sql`d.id`, f)}
      ORDER BY d.id LIMIT ${f.limite}`);
    return rows.map((l) => ({
      tipo: this.tipo, id: num(l.id), mime: String(l.mime_type ?? "application/octet-stream"), destino: destinoDocLead(l),
      carregar: () => b64(sql`SELECT encode(data, 'base64') AS b64 FROM lead_document_file_data WHERE document_id = ${num(l.id)}`),
      // Continua "banco": o sistema segue lendo do banco; o Drive guarda a cópia organizada.
      gravar: async (id) => { await getDb().execute(sql`UPDATE lead_documents SET drive_file_id = ${id} WHERE id = ${num(l.id)} AND drive_file_id IS NULL`); },
    }));
  },
  /** Cópias do "Duplicar lead" usam o arquivo do original: ficam onde o original está (se o original ainda existe). */
  async noDrive(aposId, limite) {
    const rows = await linhas(sql`SELECT id, lead_id, service_id, type, file_name, mime_type, uploaded_at, created_at, drive_file_id FROM lead_documents
      WHERE drive_file_id IS NOT NULL AND deleted_at IS NULL AND copied_from_document_id IS NULL AND id > ${aposId} ORDER BY id LIMIT ${limite}`);
    return rows.map((l) => ({ tipo: this.tipo, id: num(l.id), driveFileId: String(l.drive_file_id), destino: destinoDocLead(l) }));
  },
};

const destinoContrato = (l: Linha): DestinoDrive => ({
  caminho: [], // preenchido em `destino`
  nome: nomeArquivo(`Contrato ${l.numero}${l.type === "assinado" ? " assinado" : ""}`, data(l.created_at), l.name as string | null, "application/pdf"),
});

const contratos: FonteArquivos = {
  tipo: "contrato",
  async pendentes(f) {
    const rows = await linhas(sql`SELECT d.id, d.type, d.name, d.created_at, c.lead_id, c.number AS numero
      FROM portal_contract_documents d JOIN portal_contracts c ON c.id = d.contract_id
      WHERE d.drive_file_id IS NULL AND d.url IS NULL AND c.lead_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM portal_contract_file_data x WHERE x.document_id = d.id) AND ${filtroId(sql`d.id`, f)}
      ORDER BY d.id LIMIT ${f.limite}`);
    return rows.map((l) => ({
      tipo: this.tipo, id: num(l.id), mime: "application/pdf",
      destino: async () => ({ ...destinoContrato(l), caminho: await caminhoDocumentoCliente(num(l.lead_id), null, "juridico") }),
      carregar: () => b64(sql`SELECT encode(data, 'base64') AS b64 FROM portal_contract_file_data WHERE document_id = ${num(l.id)}`),
      gravar: async (id) => { await getDb().execute(sql`UPDATE portal_contract_documents SET drive_file_id = ${id} WHERE id = ${num(l.id)} AND drive_file_id IS NULL`); },
    }));
  },
  async noDrive(aposId, limite) {
    const rows = await linhas(sql`SELECT d.id, d.type, d.name, d.created_at, d.drive_file_id, c.lead_id, c.number AS numero
      FROM portal_contract_documents d JOIN portal_contracts c ON c.id = d.contract_id
      WHERE d.drive_file_id IS NOT NULL AND c.lead_id IS NOT NULL AND d.id > ${aposId} ORDER BY d.id LIMIT ${limite}`);
    return rows.map((l) => ({ tipo: this.tipo, id: num(l.id), driveFileId: String(l.drive_file_id),
      destino: async () => ({ ...destinoContrato(l), caminho: await caminhoDocumentoCliente(num(l.lead_id), null, "juridico") }) }));
  },
};

const checklistFinanciamento: FonteArquivos = {
  tipo: "checklist_financiamento",
  async noDrive(aposId, limite) {
    const rows = await linhas(sql`SELECT i.id, i.item, i.enviado_em, i.created_at, i.documento_nome, i.documento_mime, i.documento_drive_file_id, f.lead_id
      FROM financiamento_checklist_items i JOIN financiamentos f ON f.id = i.financiamento_id
      WHERE i.documento_drive_file_id IS NOT NULL AND f.lead_id IS NOT NULL AND i.id > ${aposId} ORDER BY i.id LIMIT ${limite}`);
    return rows.map((l) => ({ tipo: this.tipo, id: num(l.id), driveFileId: String(l.documento_drive_file_id),
      destino: async () => ({
        caminho: await caminhoDocumentoCliente(num(l.lead_id), null, "financiamento_checklist"),
        nome: nomeArquivo(String(l.item), data(l.enviado_em ?? l.created_at), l.documento_nome as string | null, String(l.documento_mime ?? "")),
      }) }));
  },
};

const destinoDocEstudo = (l: Linha) => async (): Promise<DestinoDrive> => {
  const d = await destinoDocumentoEstudo(num(l.study_id), String(l.item_id));
  return { caminho: d.caminho, nome: nomeArquivo(d.rotulo, data(l.created_at), l.file_name as string | null, String(l.mime_type ?? "")) };
};

const documentosEstudo: FonteArquivos = {
  tipo: "documento_estudo",
  async pendentes(f) {
    const rows = await linhas(sql`SELECT d.id, d.study_id, d.item_id, d.file_name, d.mime_type, d.created_at FROM incorporation_registration_documents d
      WHERE d.storage = 'banco' AND d.drive_file_id IS NULL AND d.action = 'uploaded'
        AND EXISTS (SELECT 1 FROM incorporation_registration_file_data x WHERE x.document_id = d.id) AND ${filtroId(sql`d.id`, f)}
      ORDER BY d.id LIMIT ${f.limite}`);
    return rows.map((l) => ({
      tipo: this.tipo, id: num(l.id), mime: String(l.mime_type ?? "application/octet-stream"), destino: destinoDocEstudo(l),
      carregar: () => b64(sql`SELECT encode(data, 'base64') AS b64 FROM incorporation_registration_file_data WHERE document_id = ${num(l.id)}`),
      gravar: async (id) => { await getDb().execute(sql`UPDATE incorporation_registration_documents SET drive_file_id = ${id} WHERE id = ${num(l.id)} AND drive_file_id IS NULL`); },
    }));
  },
  async noDrive(aposId, limite) {
    const rows = await linhas(sql`SELECT id, study_id, item_id, file_name, mime_type, created_at, drive_file_id FROM incorporation_registration_documents
      WHERE drive_file_id IS NOT NULL AND id > ${aposId} ORDER BY id LIMIT ${limite}`);
    return rows.map((l) => ({ tipo: this.tipo, id: num(l.id), driveFileId: String(l.drive_file_id), destino: destinoDocEstudo(l) }));
  },
};

/** Pedido de 15/10: fotos do imóvel numeradas na ordem de envio (só as que estão no Drive). */
const fotosImovel: FonteArquivos = {
  tipo: "foto_imovel",
  async noDrive(aposId, limite) {
    const rows = await linhas(sql`SELECT * FROM (
        SELECT f.id, f.imovel_id, f.mime, f.created_at, f.drive_file_id, i.titulo,
          row_number() OVER (PARTITION BY f.imovel_id ORDER BY f.id) AS ordem
        FROM imovel_fotos f JOIN imoveis i ON i.id = f.imovel_id WHERE f.drive_file_id IS NOT NULL
      ) x WHERE x.id > ${aposId} ORDER BY x.id LIMIT ${limite}`);
    return rows.map((l) => ({ tipo: this.tipo, id: num(l.id), driveFileId: String(l.drive_file_id),
      destino: pronto({
        caminho: caminhoImovel({ id: num(l.imovel_id), numero: num(l.imovel_id), nome: (l.titulo as string | null) ?? null }, "fotos"),
        nome: nomeFotoImovel(num(l.ordem), data(l.created_at), String(l.mime)),
      }) }));
  },
};

/** Ordem fixa: o cursor do organizador guarda o índice da fonte. */
export const FONTES_ARQUIVOS: FonteArquivos[] = [
  documentosLead, contratos, checklistFinanciamento, documentosEstudo, fotosImovel,
  usuarioDocumentos, modelosPci, pciGerada("planilha"), pciGerada("pdf"), fotosObra, pciOriginal, midiasWhatsapp, orcamentoEstudo,
];

export const fontePorTipo = (tipo: string) => FONTES_ARQUIVOS.find((f) => f.tipo === tipo);

// ─── Registros existentes e arquivos em uso ──────────────────────────────────

const TABELA_ENTIDADE: Record<EntidadeRegistro, string> = {
  projeto: "operational_projects", // portfólio de projeto sem lead (cliente:projeto-<id>)
  cliente: "leads", // lead apenas arquivado (deleted_at) continua existindo: não é órfão
  obra: "construction_projects",
  incorporacao: "incorporation_studies",
  imovel: "imoveis",
  equipe: "users",
};

/** Quais destes ids ainda existem no banco. */
export async function registrosExistentes(entidade: EntidadeRegistro, ids: number[]): Promise<Set<number>> {
  if (!ids.length) return new Set();
  const lista = sql.join(ids.map((id) => sql`${id}`), sql`, `);
  const rows = await linhas<{ id: number }>(sql`SELECT id FROM ${sql.raw(TABELA_ENTIDADE[entidade])} WHERE id IN (${lista})`);
  return new Set(rows.map((r) => num(r.id)));
}

const COLUNAS_DRIVE: [string, string][] = [
  ["lead_documents", "drive_file_id"], ["portal_contract_documents", "drive_file_id"], ["financiamento_checklist_items", "documento_drive_file_id"],
  ["incorporation_registration_documents", "drive_file_id"], ["imovel_fotos", "drive_file_id"], ["regularizacao_documents", "drive_file_id"],
  ["project_documents", "drive_file_id"], ["user_documents", "drive_file_id"], ["pci_models", "drive_file_id"],
  ["pci_generated", "sheet_drive_file_id"], ["pci_generated", "pdf_drive_file_id"], ["construction_photos", "drive_file_id"],
  ["construction_pci", "drive_file_id"], ["whatsapp_midias", "drive_file_id"], ["incorporation_studies", "budget_import_drive_file_id"],
];

/** Arquivos do Drive ainda usados por algum registro (não podem ir para a lixeira). */
export async function arquivosEmUso(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const lista = sql.join(ids.map((id) => sql`${id}`), sql`, `);
  const partes = COLUNAS_DRIVE.map(([t, c]) => sql`SELECT ${sql.raw(c)}::text AS id FROM ${sql.raw(t)} WHERE ${sql.raw(c)} IN (${lista})`);
  const rows = await linhas<{ id: string }>(sql.join(partes, sql` UNION `));
  return new Set(rows.map((r) => String(r.id)));
}

/**
 * Onde um arquivo ainda usado deve ficar agora (documento de outro lead — cópia
 * do "Duplicar lead" — ou mídia de WhatsApp que perdeu o lead). Usado antes de
 * mandar a pasta de um lead excluído para a lixeira.
 */
export async function destinoAtualDoArquivo(driveFileId: string): Promise<DestinoDrive | null> {
  const [doc] = await linhas(sql`SELECT id, lead_id, service_id, type, file_name, mime_type, uploaded_at, created_at FROM lead_documents
    WHERE drive_file_id = ${driveFileId} ORDER BY deleted_at NULLS FIRST, id LIMIT 1`);
  if (doc) return destinoDocLead(doc)();
  const [midia] = await linhas(consultaMidias(sql`m.drive_file_id = ${driveFileId}`, 1));
  if (midia) return destinoMidia(midia);
  return null;
}

/** Arquivos no Drive ligados ao lead (documentos e mídias de WhatsApp) — lidos antes da exclusão. */
export async function arquivosDoLead(leadId: number): Promise<string[]> {
  const rows = await linhas<{ id: string }>(sql`
    SELECT drive_file_id AS id FROM lead_documents WHERE lead_id = ${leadId} AND drive_file_id IS NOT NULL
    UNION SELECT m.drive_file_id FROM whatsapp_midias m JOIN whatsapp_messages w ON w.id = m.message_id
      WHERE w.lead_id = ${leadId} AND m.drive_file_id IS NOT NULL`);
  return rows.map((r) => String(r.id));
}
