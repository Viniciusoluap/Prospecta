import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { incorporationStudies } from "../drizzle/schema.js";
import { dueDiligenceSchema, lerDueDiligence } from "../shared/incorporacao/due-diligence.js";
import { requireRole } from "./_core/rbac.js";
import { protectedProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";

export const incorporationDueDiligenceRouter = router({
  save: protectedProcedure.input(z.object({
    studyId: z.number().int().positive(),
    expectedJson: z.string().max(500_000).nullable(),
    next: dueDiligenceSchema,
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx, ["admin"]);
    const previous = lerDueDiligence(input.expectedJson);
    if (input.next.versao !== previous.versao + 1)
      throw new TRPCError({ code: "BAD_REQUEST", message: "Versão inválida da Due Diligence" });
    const nextJson = JSON.stringify(input.next);
    if (nextJson.length > 500_000) throw new TRPCError({ code: "BAD_REQUEST", message: "Due Diligence muito extensa" });
    const current = input.expectedJson === null ? isNull(incorporationStudies.dueDiligenceJson)
      : eq(incorporationStudies.dueDiligenceJson, input.expectedJson);
    const [saved] = await getDb().update(incorporationStudies)
      .set({ dueDiligenceJson: nextJson, updatedAt: new Date() })
      .where(and(eq(incorporationStudies.id, input.studyId), current))
      .returning({ id: incorporationStudies.id });
    if (!saved) throw new TRPCError({ code: "CONFLICT", message: "O estudo foi alterado em outra sessão. Recarregue antes de salvar." });
    return { json: nextJson };
  }),
});
