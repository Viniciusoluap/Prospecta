// Item 8 (18/10): exclusão definitiva de imóvel (admin e corretor dono).
// O imóvel sai do banco (fotos em cascata) e as fotos vão para a lixeira do
// Drive. Se ele tinha sido recusado e foi cadastrado por um corretor, fica um
// aviso para o corretor continuar vendo "Recusado" até 3 dias após a recusa.

import { eq } from "drizzle-orm";
import { imoveis, imovelFotos, imovelRecusadoAvisos } from "../drizzle/schema.js";
import { recusaAindaVisivel } from "../shared/broker-portal.js";
import { getDb } from "./db.js";
import { lixeiraDaEntidade, lixeiraDoArquivo } from "./drive-organizacao.js";

type Db = ReturnType<typeof getDb>;

/** `avisarCorretor`: false quando é o próprio corretor quem exclui. */
export async function excluirImovelDefinitivo(id: number, { avisarCorretor = true } = {}): Promise<{ excluido: boolean }> {
  const db = getDb();
  const [imovel] = await db
    .select({
      titulo: imoveis.titulo,
      createdByUserId: imoveis.createdByUserId,
      reviewStatus: imoveis.reviewStatus,
      reviewedAt: imoveis.reviewedAt,
      updatedAt: imoveis.updatedAt,
    })
    .from(imoveis)
    .where(eq(imoveis.id, id))
    .limit(1);
  if (!imovel) return { excluido: false };
  const fotos = await db.select({ driveFileId: imovelFotos.driveFileId }).from(imovelFotos).where(eq(imovelFotos.imovelId, id));
  const recusadoEm = imovel.reviewedAt ?? imovel.updatedAt;
  const passos = [
    ...(avisarCorretor && imovel.reviewStatus === "rejected" && imovel.createdByUserId && recusaAindaVisivel(recusadoEm)
      ? [db.insert(imovelRecusadoAvisos).values({ brokerUserId: imovel.createdByUserId, titulo: imovel.titulo, recusadoEm })]
      : []),
    db.delete(imoveis).where(eq(imoveis.id, id)), // imovel_fotos sai em cascata; visitas/contratos ficam sem o imóvel
  ];
  await db.batch(passos as unknown as Parameters<Db["batch"]>[0]);
  // Pedido de 29/10: a pasta Imóveis/<Título (nº id)> inteira vai para a lixeira do Drive;
  // fotos que estejam fora dela também (falha fica pendente para o "Organizar Drive").
  await lixeiraDaEntidade("imovel", id);
  for (const foto of fotos) await lixeiraDoArquivo(foto.driveFileId);
  return { excluido: true };
}
