import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { imoveis, imovelFotos } from "../drizzle/schema.js";
import { isPropertyPhoto, MAX_BROKER_PHOTOS } from "../shared/broker-portal.js";
import { getDb } from "./db.js";
import { driveConfigured, enviarParaLixeira, organizarFotosImovel, uploadFotosImovel } from "./drive-documents.js";

// Pedido de 15/10: fotos de imóveis (cadastro do admin e do corretor) ficam no
// Google Drive em Imóveis/<Título (nº id)>/01 - Fotos. O anúncio guarda só o
// endereço /api/imovel-foto/<id>. Sem Drive (ou com falha), a foto fica no banco
// e o "Testar Google Drive" envia as pendentes depois — o upload nunca se perde.

export const MAX_FOTOS_IMOVEL = MAX_BROKER_PHOTOS;
const URL_FOTO = /^\/api\/imovel-foto\/(\d{1,9})$/;
export const urlFotoImovel = (id: number) => `/api/imovel-foto/${id}`;

/** Uma requisição por foto: a chave permite repetir o envio sem criar outra foto. */
export async function adicionarFotoImovel(imovelId: number, dataUrl: string, uploadKey: string, usuarioId: number): Promise<string> {
  const foto = lerDataUrl(dataUrl);
  if (!foto) throw new TRPCError({ code: "BAD_REQUEST", message: "Envie uma foto JPG, PNG ou WebP válida" });
  const db = getDb();
  const [imovel] = await db.select({ id: imoveis.id, titulo: imoveis.titulo }).from(imoveis).where(eq(imoveis.id, imovelId)).limit(1);
  if (!imovel) throw new TRPCError({ code: "NOT_FOUND", message: "Imóvel não encontrado" });
  const insercao = await db.execute(sql`INSERT INTO imovel_fotos (imovel_id, mime, size_bytes, data, created_by, upload_key)
    VALUES (${imovelId}, ${foto.mime}, ${foto.bytes.length}, decode(${foto.bytes.toString("base64")}, 'base64'), ${usuarioId}, ${uploadKey})
    ON CONFLICT (imovel_id, upload_key) WHERE upload_key IS NOT NULL DO NOTHING RETURNING id`);
  const novoId = Number((insercao as unknown as { rows: { id: number }[] }).rows[0]?.id || 0);
  const linha = novoId ? { id: novoId } : (await db.select({ id: imovelFotos.id }).from(imovelFotos)
    .where(and(eq(imovelFotos.imovelId, imovelId), eq(imovelFotos.uploadKey, uploadKey))).limit(1))[0];
  if (!linha) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível localizar a foto enviada" });
  const url = urlFotoImovel(linha.id);
  // UPDATE atômico na linha do imóvel: duas requisições não sobrescrevem a lista entre si.
  const atualizado = await db.execute(sql`UPDATE imoveis SET fotos = (
      COALESCE(NULLIF(fotos, '')::jsonb, '[]'::jsonb) || jsonb_build_array(${url}::text)
    )::text
    WHERE id = ${imovelId}
      AND NOT COALESCE(NULLIF(fotos, '')::jsonb, '[]'::jsonb) @> jsonb_build_array(${url}::text)
      AND jsonb_array_length(COALESCE(NULLIF(fotos, '')::jsonb, '[]'::jsonb)) < ${MAX_FOTOS_IMOVEL}
    RETURNING id`);
  if (!(atualizado as unknown as { rows: { id: number }[] }).rows.length) {
    const [atual] = await db.select({ fotos: imoveis.fotos }).from(imoveis).where(eq(imoveis.id, imovelId)).limit(1);
    if (!lerFotos(atual?.fotos).includes(url)) {
      if (novoId) await db.delete(imovelFotos).where(eq(imovelFotos.id, novoId));
      throw new TRPCError({ code: "BAD_REQUEST", message: `Máximo de ${MAX_FOTOS_IMOVEL} fotos por imóvel` });
    }
  }
  if (novoId && (await driveConfigured().catch(() => false))) {
    try {
      const [driveId] = await uploadFotosImovel(imovel, [{ ordem: 1, mime: foto.mime, data: foto.bytes }]);
      if (driveId) await db.execute(sql`UPDATE imovel_fotos SET drive_file_id = ${driveId}, data = NULL WHERE id = ${novoId}`);
    } catch (erro) {
      console.error("[imovel-fotos] Drive indisponível; foto guardada no banco:", erro instanceof Error ? erro.message : "erro");
    }
  }
  await organizarFotos(imovelId).catch((erro) => console.error("[imovel-fotos] organização:", erro instanceof Error ? erro.message : "erro"));
  return url;
}

type FotoNova = { mime: string; bytes: Buffer };

function lerDataUrl(valor: string): FotoNova | null {
  if (!isPropertyPhoto(valor)) return null;
  const virgula = valor.indexOf(",");
  const mime = valor.slice(5, valor.indexOf(";"));
  const bytes = Buffer.from(valor.slice(virgula + 1), "base64");
  const assinaturaOk =
    (mime === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8) ||
    (mime === "image/png" && bytes.subarray(0, 4).equals(Buffer.from([137, 80, 78, 71]))) ||
    (mime === "image/webp" && bytes.subarray(8, 12).toString() === "WEBP");
  return assinaturaOk && bytes.length > 0 && bytes.length <= 8 * 1024 * 1024 ? { mime, bytes } : null;
}

/** Lista do formulário (data URLs novas + endereços já gravados) → lista final de endereços. */
export async function salvarFotosImovel(imovelId: number, fotos: string[], usuarioId: number | null): Promise<string[]> {
  if (fotos.length > MAX_FOTOS_IMOVEL) throw new TRPCError({ code: "BAD_REQUEST", message: `Máximo de ${MAX_FOTOS_IMOVEL} fotos por imóvel` });
  const db = getDb();
  const [imovel] = await db.select({ id: imoveis.id, titulo: imoveis.titulo }).from(imoveis).where(eq(imoveis.id, imovelId)).limit(1);
  if (!imovel) throw new TRPCError({ code: "NOT_FOUND", message: "Imóvel não encontrado" });
  const existentes = await db.select().from(imovelFotos).where(eq(imovelFotos.imovelId, imovelId));
  const doImovel = new Map(existentes.map((f) => [f.id, f]));

  // Cada posição: foto já gravada (id), foto nova (bytes) ou endereço antigo mantido como está.
  const itens: ({ tipo: "gravada"; id: number } | { tipo: "nova"; foto: FotoNova } | { tipo: "externa"; url: string })[] = [];
  for (const valor of fotos) {
    const gravada = URL_FOTO.exec(valor);
    if (gravada) {
      if (doImovel.has(Number(gravada[1]))) itens.push({ tipo: "gravada", id: Number(gravada[1]) });
      continue; // foto de outro imóvel não é aceita
    }
    if (valor.startsWith("data:")) {
      const foto = lerDataUrl(valor);
      if (!foto) throw new TRPCError({ code: "BAD_REQUEST", message: "Envie fotos JPG, PNG ou WebP de até 8 MiB" });
      itens.push({ tipo: "nova", foto });
      continue;
    }
    if (/^https?:\/\//.test(valor)) itens.push({ tipo: "externa", url: valor });
  }

  const novas = itens.flatMap((it, i) => (it.tipo === "nova" ? [{ ordem: i + 1, ...it.foto }] : []));
  let driveIds: string[] | null = null;
  if (novas.length && (await driveConfigured())) {
    try {
      driveIds = await uploadFotosImovel(imovel, novas.map((n) => ({ ordem: n.ordem, mime: n.mime, data: n.bytes })));
    } catch (erro) {
      console.error("[imovel-fotos] Drive indisponível; fotos guardadas no banco:", erro instanceof Error ? erro.message : "erro");
    }
  }
  const idsNovos: number[] = [];
  for (let k = 0; k < novas.length; k++) {
    const n = novas[k];
    const driveFileId = driveIds?.[k] ?? null;
    const r = await db.execute(sql`INSERT INTO imovel_fotos (imovel_id, mime, size_bytes, drive_file_id, data, created_by)
      VALUES (${imovelId}, ${n.mime}, ${n.bytes.length}, ${driveFileId}, ${driveFileId ? null : sql`decode(${n.bytes.toString("base64")}, 'base64')`}, ${usuarioId})
      RETURNING id`);
    idsNovos.push(Number((r as unknown as { rows: { id: number }[] }).rows[0].id));
  }

  let k = 0;
  const final = itens.map((it) => (it.tipo === "gravada" ? urlFotoImovel(it.id) : it.tipo === "nova" ? urlFotoImovel(idsNovos[k++]) : it.url));

  // Foto retirada do anúncio: sai do banco e vai para a lixeira do Drive.
  const mantidas = new Set(itens.flatMap((it) => (it.tipo === "gravada" ? [it.id] : [])));
  const removidas = existentes.filter((f) => !mantidas.has(f.id));
  if (removidas.length) {
    await db.delete(imovelFotos).where(inArray(imovelFotos.id, removidas.map((f) => f.id)));
    for (const f of removidas) if (f.driveFileId) await enviarParaLixeira(f.driveFileId).catch(() => undefined);
  }
  return final;
}

/** Numeração "Foto 01, 02…" na ordem do anúncio e pasta com o título atual. */
async function organizarFotos(imovelId: number) {
  if (!(await driveConfigured())) return;
  const db = getDb();
  const [imovel] = await db.select({ id: imoveis.id, titulo: imoveis.titulo, fotos: imoveis.fotos }).from(imoveis).where(eq(imoveis.id, imovelId)).limit(1);
  if (!imovel) return;
  const rows = await db.select().from(imovelFotos).where(and(eq(imovelFotos.imovelId, imovelId), isNotNull(imovelFotos.driveFileId)));
  const porId = new Map(rows.map((r) => [r.id, r]));
  const ordem = lerFotos(imovel.fotos).flatMap((u) => {
    const m = URL_FOTO.exec(u);
    const r = m ? porId.get(Number(m[1])) : undefined;
    return r ? [{ driveFileId: r.driveFileId!, mime: r.mime, criadaEm: r.createdAt }] : [];
  });
  await organizarFotosImovel({ id: imovel.id, titulo: imovel.titulo }, ordem);
}

export function lerFotos(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Grava a lista final no anúncio e organiza o Drive (chamado depois de criar/editar o imóvel). */
export async function aplicarFotosImovel(imovelId: number, fotos: string[], usuarioId: number | null): Promise<string[]> {
  const final = await salvarFotosImovel(imovelId, fotos, usuarioId);
  await getDb().update(imoveis).set({ fotos: JSON.stringify(final) }).where(eq(imoveis.id, imovelId));
  await organizarFotos(imovelId).catch((erro) => console.error("[imovel-fotos] organização:", erro instanceof Error ? erro.message : "erro"));
  return final;
}

/**
 * "Testar Google Drive": envia ao Drive as fotos que ficaram no banco (Drive
 * fora do ar no envio ou cadastros antigos com a foto dentro do anúncio).
 */
export async function enviarFotosPendentesAoDrive(): Promise<{ enviadas: number; falhas: number }> {
  const db = getDb();
  let enviadas = 0;
  let falhas = 0;
  const antigos = await db.select({ id: imoveis.id, fotos: imoveis.fotos }).from(imoveis).where(sql`${imoveis.fotos} LIKE '%data:image/%'`);
  for (const im of antigos) {
    try {
      const antes = lerFotos(im.fotos).filter((u) => u.startsWith("data:")).length;
      await aplicarFotosImovel(im.id, lerFotos(im.fotos), null);
      enviadas += antes;
    } catch (erro) {
      falhas += 1;
      console.error("[imovel-fotos] cadastro antigo não migrado:", erro instanceof Error ? erro.message : "erro");
    }
  }
  const pendentes = await db.execute(sql`SELECT f.id, f.imovel_id, f.mime, encode(f.data, 'base64') AS b64, i.titulo
    FROM imovel_fotos f JOIN imoveis i ON i.id = f.imovel_id WHERE f.drive_file_id IS NULL AND f.data IS NOT NULL`);
  for (const p of (pendentes as unknown as { rows: { id: number; imovel_id: number; mime: string; b64: string; titulo: string }[] }).rows) {
    try {
      const [fileId] = await uploadFotosImovel({ id: p.imovel_id, titulo: p.titulo }, [{ ordem: 1, mime: p.mime, data: Buffer.from(p.b64, "base64") }]);
      await db.execute(sql`UPDATE imovel_fotos SET drive_file_id = ${fileId}, data = NULL WHERE id = ${p.id}`);
      await organizarFotos(p.imovel_id).catch(() => undefined);
      enviadas += 1;
    } catch (erro) {
      falhas += 1;
      console.error("[imovel-fotos] foto pendente não enviada:", erro instanceof Error ? erro.message : "erro");
    }
  }
  return { enviadas, falhas };
}

/** Bytes e tipo da foto; `null` quando não existe. */
export async function lerFotoImovel(id: number): Promise<{ mime: string; driveFileId: string | null; bytes: Buffer | null; imovelId: number } | null> {
  const r = await getDb().execute(sql`SELECT imovel_id, mime, drive_file_id, encode(data, 'base64') AS b64 FROM imovel_fotos WHERE id = ${id}`);
  const linha = (r as unknown as { rows: { imovel_id: number; mime: string; drive_file_id: string | null; b64: string | null }[] }).rows[0];
  if (!linha) return null;
  return { mime: linha.mime, driveFileId: linha.drive_file_id, bytes: linha.b64 ? Buffer.from(linha.b64, "base64") : null, imovelId: linha.imovel_id };
}


/** "Testar Google Drive" completo: o diagnóstico e, com o Drive funcionando, o envio das fotos pendentes. */
export async function diagnosticarDriveComFotos() {
  const { diagnosticarDrive } = await import("./drive-documents.js");
  const r = await diagnosticarDrive();
  if (!r.configurado || !r.etapas.some((e) => e.etapa === "Gravação de arquivo de teste" && e.ok)) return r;
  const fotos = await enviarFotosPendentesAoDrive();
  if (fotos.enviadas || fotos.falhas) {
    r.etapas.push({
      etapa: `Fotos de imóveis enviadas ao Drive: ${fotos.enviadas}${fotos.falhas ? `, ${fotos.falhas} pendente(s) — será tentado de novo` : ""}`,
      ok: fotos.falhas === 0,
    });
  }
  return r;
}
