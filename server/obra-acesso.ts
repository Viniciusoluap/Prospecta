import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { constructionPhotos, constructionProgressHistory, constructionProjects, obraMovimentos } from "../drizzle/schema.js";
import { getDb } from "./db.js";

// Portal do Empreiteiro (pedido de 15/10/2026). O empreiteiro usa o mesmo painel
// "Editar Obra" do admin, mas só nas obras em que é o empreiteiro vinculado e só
// nas partes liberadas: lê Informações, Valores e Custos previstos; usa
// Pagamentos, Progresso, Fotos e Relatórios. Gêmeo em
// Grupo-Santa-Fe/web/src/lib/obras/acesso-empreiteiro.ts.

type Alvo = "projectId" | "photoId" | "movimentoId" | "medicaoId";

/** Procedimentos de obra liberados ao empreiteiro e como achar a obra no input. */
export const PROCEDIMENTOS_DO_EMPREITEIRO: Readonly<Record<string, Alvo>> = {
  "obraFinanceiro.resumo": "projectId",
  "obraFinanceiro.adicionarMovimento": "projectId",
  "obraFinanceiro.excluirMovimento": "movimentoId",
  "obraProgresso.obter": "projectId",
  "obraProgresso.galeria": "projectId",
  "obraProgresso.detalhe": "projectId",
  "obraProgresso.salvar": "projectId",
  "obraProgresso.relatorio": "projectId",
  "obraProgresso.atualizarFoto": "photoId",
  "obraProgresso.excluirFoto": "photoId",
  // Pedido de 18/10: o empreiteiro também solicita, confirma, edita e exclui medições.
  "obraProgresso.solicitarMedicao": "medicaoId",
  "obraProgresso.confirmarRecebimento": "medicaoId",
  "obraProgresso.editarMedicao": "medicaoId",
  "obraProgresso.excluirMedicao": "medicaoId",
  "obraProgresso.vincularPci": "projectId",
  "obraProgresso.desvincularPci": "projectId",
};

/** Listas usadas só para exibir nomes nos campos somente leitura do painel. */
export const LISTAS_DO_EMPREITEIRO = new Set(["obraFinanceiro.listarEmpreiteiros", "obraFinanceiro.listarInvestidores"]);

const negar = (message = "Esta obra não está vinculada a você.") => new TRPCError({ code: "FORBIDDEN", message });

function idDo(input: unknown, campo: string): number | null {
  const v = input && typeof input === "object" ? (input as Record<string, unknown>)[campo] : undefined;
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

export async function empreiteiroDaObra(projectId: number): Promise<number | null> {
  const [o] = await getDb().select({ id: constructionProjects.contractorUserId }).from(constructionProjects)
    .where(eq(constructionProjects.id, projectId)).limit(1);
  return o?.id ?? null;
}

/**
 * Libera (ou nega) o procedimento `path` para o empreiteiro `userId`. Retorna
 * `false` quando o procedimento não é do portal do empreiteiro.
 */
export async function autorizarEmpreiteiro(userId: number, path: string, input: unknown): Promise<boolean> {
  if (LISTAS_DO_EMPREITEIRO.has(path)) return true;
  const alvo = PROCEDIMENTOS_DO_EMPREITEIRO[path];
  if (!alvo) return false;
  let projectId: number | null = null;
  if (alvo === "projectId") {
    projectId = idDo(input, "projectId");
    // No Custos, ele só lança pagamentos da obra, sem vincular lançamentos do BPO da empresa.
    if (path === "obraFinanceiro.adicionarMovimento") {
      const i = input as Record<string, unknown>;
      if (i?.natureza !== "pagamento" || i?.bpoLancamentoId != null) throw negar("O empreiteiro lança somente pagamentos da obra.");
    }
  } else if (alvo === "photoId") {
    const id = idDo(input, "photoId");
    if (id) {
      const [f] = await getDb().select({ projectId: constructionPhotos.projectId }).from(constructionPhotos).where(eq(constructionPhotos.id, id)).limit(1);
      projectId = f?.projectId ?? null;
    }
  } else if (alvo === "medicaoId") {
    const id = idDo(input, "medicaoId");
    if (id) {
      const [m] = await getDb().select({ projectId: constructionProgressHistory.projectId }).from(constructionProgressHistory)
        .where(eq(constructionProgressHistory.id, id)).limit(1);
      projectId = m?.projectId ?? null;
    }
  } else {
    const id = idDo(input, "id");
    if (id) {
      const [m] = await getDb().select({ projectId: obraMovimentos.projectId, natureza: obraMovimentos.natureza })
        .from(obraMovimentos).where(eq(obraMovimentos.id, id)).limit(1);
      if (m && m.natureza !== "pagamento") throw negar("O empreiteiro exclui somente pagamentos da obra.");
      projectId = m?.projectId ?? null;
    }
  }
  if (!projectId) throw new TRPCError({ code: "NOT_FOUND", message: "Obra não encontrada" });
  if ((await empreiteiroDaObra(projectId)) !== userId) throw negar();
  return true;
}
