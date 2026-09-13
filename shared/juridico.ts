import { z } from "zod";

export const CONTRATO_STATUS = ["rascunho", "ativo", "vencido", "cancelado", "concluido"] as const;
export const ASSINATURA_STATUS = ["pendente", "solicitado", "assinado", "rejeitado"] as const;
export const CONTRATO_TIPOS = [
  "compra_venda", "construcao", "prestacao_servicos", "corretagem",
  "locacao", "permuta", "consultoria_juridica", "outro",
] as const;

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

export const contratoInputSchema = z.object({
  number: z.string().trim().min(1).max(80).optional(),
  type: z.enum(CONTRATO_TIPOS),
  status: z.enum(CONTRATO_STATUS).default("rascunho"),
  partyA: z.string().trim().min(2).max(255),
  partyADocument: optionalText(40),
  partyB: z.string().trim().min(2).max(255),
  partyBDocument: optionalText(40),
  leadId: z.number().int().positive().optional().nullable(),
  propertyId: z.number().int().positive().optional().nullable(),
  value: z.number().nonnegative(),
  dueAt: z.date().optional().nullable(),
  description: optionalText(4000),
  clauses: optionalText(20000),
  signatureStatus: z.enum(ASSINATURA_STATUS).default("pendente"),
});

export type ContratoInput = z.infer<typeof contratoInputSchema>;
